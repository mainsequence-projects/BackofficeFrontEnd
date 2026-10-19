"""VS Code launcher: local MetaTables, the real backend API, and the Vite static site."""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

SITE_DIR = Path(__file__).resolve().parents[1]


def ensure_ports_free(ports):
    if any(not 1 <= port <= 65535 for port in ports):
        raise RuntimeError("Ports must be between 1 and 65535.")
    if len(set(ports)) != len(ports):
        raise RuntimeError("The API, static site and MetaTables ports must differ.")
    for port in ports:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise RuntimeError(
                    f"Port {port} is already in use. Stop its server or change the launch arguments."
                ) from exc


def wait_for(check, children, label, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for child in children:
            if child.poll() is not None:
                raise RuntimeError(
                    f"A local service exited with code {child.returncode} while waiting for {label}."
                )
        try:
            value = check()
            if value:
                return value
        except HTTPError as exc:
            if exc.code < 500:
                raise RuntimeError(
                    f"Readiness check for {label} returned HTTP {exc.code}."
                ) from exc
        except (ConnectionError, URLError, TimeoutError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {label}; inspect the service output above.")


def read_url(url, *, as_json=False):
    with urlopen(url, timeout=2) as response:
        return json.load(response) if as_json else response.status == 200


def stop_children(children):
    # Each process group belongs to this launch. An already-running shared
    # MetaTables API is never added, so stopping F5 does not stop someone else's API.
    for child in reversed(children):
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=10)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def run(args):
    backend = args.backend_dir.expanduser().resolve()
    if not (backend / "api/app/main.py").is_file():
        raise RuntimeError(
            "Backend checkout not found; set backoffice.backendPath in .vscode/settings.json."
        )
    if sys.version_info < (3, 13):  # noqa: UP036 - diagnose a wrongly selected IDE interpreter
        raise RuntimeError("Use the backend's Python 3.13+ environment.")
    vite = SITE_DIR / "node_modules/vite/bin/vite.js"
    if not vite.is_file():
        raise RuntimeError("Run the 'Back Office: install local dependencies' VS Code task first.")
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    os.environ.setdefault("TDAG_ROOT_PATH", str(backend / ".local/sdk"))
    from metatables.cli.local import SDK_TOKEN_VARIABLES, sdk_session_environment

    # Select the saved session before importing SDK models. Credentials stay in
    # Python processes; the frontend receives only a loopback API address.
    session = sdk_session_environment(args.sdk_session_source, project_dir=backend)
    for name in SDK_TOKEN_VARIABLES:
        os.environ.pop(name, None)
    os.environ.update(session)

    from mainsequence.client.exceptions import ApiError
    from metatables import (
        Namespace,
        configure_local_client,
        get_runtime_status,
        initialize_runtime,
        upgrade_application,
    )
    from metatables.local_connection import running_server

    from scripts.developer_session import configure_developer_session
    from scripts.local_api import require_local_runtime

    configure_developer_session()

    api_origin = f"http://127.0.0.1:{args.api_port}"
    site_origin = f"http://127.0.0.1:{args.site_port}"
    existing = running_server()
    ports = [args.api_port, args.site_port]
    if not existing:
        ports.append(args.metatables_port)
    ensure_ports_free(ports)
    children = []

    def start(command, *, cwd=backend, env=None):
        process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        children.append(process)
        return process

    try:
        if existing:
            print(f"Reusing local MetaTables: {existing['api_url']}", flush=True)
        else:
            start(
                [
                    sys.executable,
                    "-m",
                    "scripts.local_metatables",
                    "--configuration",
                    str(args.metatables_configuration.resolve()),
                    "--port",
                    str(args.metatables_port),
                ]
            )

        def runtime():
            if running_server() is None:
                return None
            configure_local_client()
            try:
                return get_runtime_status()
            except ApiError as exc:
                if existing:
                    raise RuntimeError(
                        "The existing shared MetaTables API is unavailable. Restart its local launcher with a working developer session, then retry Back Office."
                    ) from exc
                if exc.status_code in {500, 502, 503, 504}:
                    return None
                raise RuntimeError(
                    f"Local MetaTables refused startup (HTTP {exc.status_code})."
                ) from exc

        print("Preparing local MetaTables and Back Office migrations...", flush=True)
        state = wait_for(runtime, children, "the local MetaTables API")
        require_local_runtime(state, ready=False)
        bootstrap = state.get("bootstrap") or {}
        if bootstrap.get("status") != "ready" or bootstrap.get("active") is not True:
            if bootstrap.get("status") not in {"migration_required", "registration_required"}:
                raise RuntimeError(
                    "The selected local runtime cannot be initialized; inspect it with 'metatables --local runtime status'."
                )
            initialize_runtime()
        source_uid = require_local_runtime(get_runtime_status())
        if not any(
            namespace.name == "backoffice" for namespace in Namespace.filter(search="backoffice")
        ):
            Namespace.create(
                "backoffice", description="Local Back Office document reconciliation tables."
            )
        result = upgrade_application("src.backoffice.migrations:migration")
        if (
            str(result["data_source_uid"]) != source_uid
            or require_local_runtime(get_runtime_status()) != source_uid
        ):
            raise RuntimeError("The local MetaTables DataSource changed during preparation.")
        print(f"Local Back Office migration: {result['revision']}", flush=True)

        backend_env = dict(
            os.environ,
            BACKOFFICE_API_ORIGIN=api_origin,
            BACKOFFICE_SITE_ORIGIN=site_origin,
            BACKOFFICE_LOCAL_SOURCE_UID=source_uid,
        )
        start(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "scripts.local_api:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                str(args.api_port),
                "--reload",
                "--reload-dir",
                str(backend / "api"),
                "--reload-dir",
                str(backend / "src"),
                "--reload-dir",
                str(backend / "scripts"),
            ],
            env=backend_env,
        )
        wait_for(lambda: read_url(f"{api_origin}/healthz"), children, "the Back Office API")
        site_env = {
            key: value
            for key, value in os.environ.items()
            if key
            in {
                "PATH",
                "HOME",
                "USER",
                "SHELL",
                "TMPDIR",
                "TEMP",
                "TMP",
                "LANG",
                "LC_ALL",
                "TERM",
                "NODE_EXTRA_CA_CERTS",
            }
        }
        site_env["BACKOFFICE_API_ORIGIN"] = api_origin
        start(
            [
                "node",
                str(vite),
                "--host",
                "127.0.0.1",
                "--port",
                str(args.site_port),
                "--strictPort",
            ],
            cwd=SITE_DIR,
            env=site_env,
        )
        wait_for(lambda: read_url(f"{site_origin}/"), children, "Vite")
        try:
            identity = read_url(f"{site_origin}/api/", as_json=True)
        except HTTPError as exc:
            raise RuntimeError(
                "Local API identity is unavailable. Check your Main Sequence login and platform connection."
            ) from exc
        if not identity.get("user_uid"):
            raise RuntimeError("The local API did not verify the developer identity.")
        print(f"Back Office ready: {site_origin}/", flush=True)
        print(f"API: {api_origin} | MetaTables: {state['api_endpoint']}", flush=True)
        if args.verify_only:
            from metatables import MetaTable

            from src.backoffice.tables import metatable_models

            registered = {
                table.identifier: table for table in MetaTable.filter(namespace="backoffice")
            }
            for model in metatable_models():
                table = registered.get(model.__metatable_identifier__)
                if table is None or table.data_source_uid != source_uid:
                    raise RuntimeError(
                        "A Back Office table is missing from the verified local DataSource."
                    )
            print(f"Verified {len(metatable_models())} Back Office MetaTables.", flush=True)
            return
        while True:
            for child in children:
                if child.poll() is not None:
                    raise RuntimeError(f"A local service stopped with code {child.returncode}.")
            time.sleep(0.5)
    finally:
        stop_children(children)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-dir", type=Path, required=True)
    parser.add_argument("--sdk-session-source", choices=["cli", "vscode"], default="vscode")
    parser.add_argument("--api-port", type=int, default=8001)
    parser.add_argument("--site-port", type=int, default=5174)
    parser.add_argument("--metatables-port", type=int, default=18473)
    parser.add_argument(
        "--metatables-configuration", type=Path, default=SITE_DIR / "dev/metatables.yaml"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify all services and the API proxy, then stop processes owned by this launch.",
    )
    args = parser.parse_args()

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        run(args)
    except KeyboardInterrupt:
        pass
    except (RuntimeError, OSError) as exc:
        parser.exit(1, f"Back Office launch failed: {exc}\n")
    except Exception as exc:
        parser.exit(
            1,
            f"Local preparation failed ({type(exc).__name__}); check Main Sequence login, runtime status, and migration permissions.\n",
        )


if __name__ == "__main__":
    main()
