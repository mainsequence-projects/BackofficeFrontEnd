"""VS Code launcher: local MetaTables, Back Office API, Tau agent, and Vite."""

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
DEFAULT_METATABLES_CONFIGURATION = SITE_DIR / "dev/metatables.yaml"
LOCAL_LAUNCH_STATE = SITE_DIR / ".local/dev-stack.json"


def selected_configuration(requested):
    requested = requested.resolve()
    if requested != DEFAULT_METATABLES_CONFIGURATION.resolve() or not LOCAL_LAUNCH_STATE.exists():
        return requested
    try:
        saved = json.loads(LOCAL_LAUNCH_STATE.read_text())
        configuration = Path(saved["metatables_configuration"]).resolve()
        if not configuration.is_file():
            raise ValueError("Configuration is missing")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimeError(
            "The saved local MetaTables configuration is unavailable; check .local/dev-stack.json before retrying."
        ) from exc
    return configuration


def remember_configuration(configuration):
    from metatables.local_files import write_private_json

    write_private_json(
        LOCAL_LAUNCH_STATE, {"metatables_configuration": str(configuration.resolve())}
    )


def relay_to_backend_python(backend, argv):
    """VS Code may launch its adapter with a globally selected interpreter."""
    expected_prefix = (backend / ".venv").resolve()
    if Path(sys.prefix).resolve() == expected_prefix:
        return
    python = backend / ".venv/bin/python"
    if not python.is_file():
        raise RuntimeError("Install the backend dependencies before starting the local stack.")
    print(f"Using backend Python: {python}", flush=True)
    child = subprocess.Popen([str(python), str(Path(__file__).resolve()), *argv], cwd=backend)
    try:
        code = child.wait()
    except KeyboardInterrupt:
        if child.poll() is None:
            child.send_signal(signal.SIGINT)
        code = child.wait(timeout=30)
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=30)
    raise SystemExit(code)


def is_identity_failure(error):
    payload = getattr(error, "payload", None)
    return (
        getattr(error, "status_code", None) == 503
        and isinstance(payload, dict)
        and payload.get("detail")
        in {
            "Current platform identity facts are unavailable.",
            "Local SDK identity is unavailable.",
        }
    )


def recovery_configuration(command, cwd):
    """Keep the failed launcher's configuration and its saved database selection."""
    candidate = Path(cwd) / "configuration.yaml"
    for index, arg in enumerate(command):
        if arg == "--configuration" and index + 1 < len(command):
            candidate = Path(command[index + 1])
            break
        if arg.startswith("--configuration="):
            candidate = Path(arg.split("=", 1)[1])
            break
    if not candidate.is_absolute():
        candidate = Path(cwd) / candidate
    candidate = candidate.resolve()
    if not candidate.is_file():
        raise RuntimeError(
            "Cannot verify the failed MetaTables launcher's configuration; stop that launch manually."
        )
    return candidate


def restart_failed_runtime(existing):
    """Stop only the same-user launcher verified by MetaTables' private connection."""
    import psutil
    from metatables.api.app.configuration import DeploymentConfiguration
    from metatables.local_connection import running_server

    process = psutil.Process(existing["pid"])
    if process.create_time() != existing["process_created"] or process.uids().real != os.getuid():
        raise RuntimeError(
            "The failed MetaTables process identity changed; refusing to restart it."
        )
    configuration = recovery_configuration(process.cmdline(), process.cwd())
    DeploymentConfiguration.load(configuration).require_development()
    current = running_server()
    if current is None or any(
        current[key] != existing[key] for key in ("pid", "process_created", "launch_id")
    ):
        raise RuntimeError("The local MetaTables launcher changed; retry Back Office.")
    print(
        "Restarting local MetaTables after its identity failure; retaining its database configuration.",
        flush=True,
    )
    process.terminate()
    try:
        process.wait(timeout=25)
    except psutil.TimeoutExpired as exc:
        raise RuntimeError(
            "The old MetaTables launcher did not stop gracefully; stop it manually and retry."
        ) from exc
    return configuration


def port_available(port):
    with socket.socket() as probe:
        # Match Uvicorn/MetaTables so a recently closed TCP connection does not
        # make an otherwise free listener port fail the restart preflight.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
        return True


def ensure_ports_free(ports):
    if any(not 1 <= port <= 65535 for port in ports):
        raise RuntimeError("Ports must be between 1 and 65535.")
    if len(set(ports)) != len(ports):
        raise RuntimeError("The API, static site, Tau agent and MetaTables ports must differ.")
    for port in ports:
        if not port_available(port):
            raise RuntimeError(
                f"Port {port} is already in use. Stop its server or change the launch arguments."
            )


def orphaned_service(process, *, cwd, port, target):
    """Only a same-user, isolated service whose original launcher has exited."""
    if (
        process.ppid() != 1
        or process.uids().real != os.getuid()
        or os.getpgid(process.pid) != process.pid
        or Path(process.cwd()).resolve() != cwd.resolve()
    ):
        return False
    command = process.cmdline()
    if target not in command:
        return False
    arguments = command[command.index(target) + 1 :]
    return any(
        arguments[index : index + 2] == ["--port", str(port)] for index in range(len(arguments) - 1)
    ) and any(
        arguments[index : index + 2] == ["--host", "127.0.0.1"]
        for index in range(len(arguments) - 1)
    )


def recover_orphaned_services(backend, api_port, site_port):
    """F5 can kill the launcher without running its child cleanup."""
    import psutil

    for port, cwd, target, label in (
        (api_port, backend, "scripts.local_api:create_app", "API"),
        (site_port, SITE_DIR, str(SITE_DIR / "node_modules/vite/bin/vite.js"), "site"),
    ):
        if port_available(port):
            continue
        listeners = subprocess.run(
            ["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
        if listeners.returncode != 0:
            continue
        for value in set(listeners.stdout.split()):
            try:
                process = psutil.Process(int(value))
                created = process.create_time()
                if not orphaned_service(process, cwd=cwd, port=port, target=target):
                    continue
                print(
                    f"Stopping orphaned Back Office {label} from an ended debug session (PID {process.pid}).",
                    flush=True,
                )
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except psutil.TimeoutExpired:
                    current = psutil.Process(process.pid)
                    if current.create_time() != created or not orphaned_service(
                        current, cwd=cwd, port=port, target=target
                    ):
                        raise RuntimeError(
                            "The orphaned service changed during cleanup; retry."
                        ) from None
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
            except (psutil.NoSuchProcess, ProcessLookupError):
                continue
            except (psutil.AccessDenied, PermissionError):
                # An unverifiable listener keeps the normal port-conflict error.
                continue


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


def read_url(url, *, as_json=False, timeout=2):
    with urlopen(url, timeout=timeout) as response:
        return json.load(response) if as_json else response.status == 200


def tau_environment(backend, args, environment):
    """Start the SDK in its local mode with the project's helper restrictions."""
    return dict(
        environment,
        MAINSEQUENCE_AUTH_MODE="jwt",
        MAINSEQUENCE_CLI=str(backend / ".venv/bin/mainsequence"),
        MAINSEQUENCE_TAU_HOST="127.0.0.1",
        MAINSEQUENCE_TAU_PORT=str(args.agent_port),
        MAINSEQUENCE_TAU_WORKSPACE=str(backend),
        MAINSEQUENCE_TAU_STATE_ROOT=str(backend / ".local/tau-home"),
        TAU_LOCAL_MODE="true",
        TAU_LOCAL_STATE_ROOT=str(backend / ".local/tau"),
        TAU_LOCAL_PROVIDER=args.agent_provider,
        TAU_LOCAL_MODEL=args.agent_model,
        TAU_LOCAL_THINKING=args.agent_thinking,
        TAU_EXCLUDE_BASE_TOOLS="true",
        TAU_EXCLUDE_MAINSEQUENCE_MCP="true",
    )


def local_agent_ready(origin):
    state = read_url(f"{origin}/ready", as_json=True, timeout=30)
    if state.get("mode") != "local" or any(
        state.get(flag) is not True for flag in ("exclude_base_tools", "exclude_mainsequence_mcp")
    ):
        raise RuntimeError("The Tau agent did not start in the restricted local helper mode.")
    return state.get("ok") is True


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
    relay_to_backend_python(backend, sys.argv[1:])
    print(f"Backend Python: {sys.executable}", flush=True)
    if sys.version_info < (3, 13):  # noqa: UP036 - diagnose a wrongly selected IDE interpreter
        raise RuntimeError("Use the backend's Python 3.13+ environment.")
    vite = SITE_DIR / "node_modules/vite/bin/vite.js"
    if not vite.is_file():
        raise RuntimeError("Run the 'Back Office: install local dependencies' VS Code task first.")
    tau = backend / ".venv/bin/ms-tau"
    if not args.no_agent and not tau.is_file():
        raise RuntimeError(
            "The Tau SDK is missing. Run the 'Back Office: install backend dependencies' VS Code task."
        )
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
    agent_origin = f"http://127.0.0.1:{args.agent_port}"
    existing = running_server()
    ports = [args.api_port, args.site_port]
    if not args.no_agent:
        ports.append(args.agent_port)
    if not existing:
        ports.append(args.metatables_port)
    recover_orphaned_services(backend, args.api_port, args.site_port)
    ensure_ports_free(ports)
    children = []

    def start(command, *, cwd=backend, env=None):
        process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        children.append(process)
        return process

    def start_metatables(configuration):
        return start(
            [
                sys.executable,
                "-m",
                "scripts.local_metatables",
                "--configuration",
                str(configuration.resolve()),
                "--port",
                str(args.metatables_port),
            ]
        )

    try:
        state = None
        if existing:
            print(f"Checking local MetaTables: {existing['api_url']}", flush=True)
            configure_local_client()
            try:
                state = get_runtime_status()
            except ApiError as exc:
                if not (args.restart_unhealthy_metatables and is_identity_failure(exc)):
                    raise RuntimeError(
                        "The existing local MetaTables API is unavailable; inspect its launcher output."
                    ) from exc
                # Verify the current developer before stopping any other service.
                from mainsequence.client import User

                user = User.get_authenticated_user_details()
                if not user.is_active:
                    raise RuntimeError(
                        "The developer session is inactive; leaving the existing runtime running."
                    ) from exc
                configuration = restart_failed_runtime(existing)
                remember_configuration(configuration)
                wait_for(
                    lambda: port_available(args.metatables_port),
                    [],
                    "the old MetaTables listener to stop",
                    timeout=15,
                )
                start_metatables(configuration)
                existing = None
            else:
                print(f"Reusing verified local MetaTables: {existing['api_url']}", flush=True)
        else:
            start_metatables(selected_configuration(args.metatables_configuration))

        def runtime():
            if running_server() is None:
                return None
            configure_local_client()
            try:
                return get_runtime_status()
            except ApiError as exc:
                if exc.status_code in {500, 502, 503, 504}:
                    return None
                raise RuntimeError(
                    f"Local MetaTables refused startup (HTTP {exc.status_code})."
                ) from exc

        print("Preparing local MetaTables and Back Office migrations...", flush=True)
        if state is None:
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
        result = upgrade_application("src.backoffice.migrations:migration")
        if (
            str(result["data_source_uid"]) != source_uid
            or require_local_runtime(get_runtime_status()) != source_uid
        ):
            raise RuntimeError("The local MetaTables DataSource changed during preparation.")
        from src.backoffice.services.application import publish_catalog

        publish_catalog()
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
        if not args.no_agent:
            print(f"Starting local Tau agent: {agent_origin}", flush=True)
            start([str(tau)], env=tau_environment(backend, args, os.environ))
            wait_for(
                lambda: local_agent_ready(agent_origin),
                children,
                "the local Tau agent (authentication, provider and local storage)",
            )
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
        if not args.no_agent:
            site_env["MAINSEQUENCE_TAU_LOCAL_ORIGIN"] = agent_origin
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
            identity = wait_for(
                lambda: read_url(f"{site_origin}/api/readyz", as_json=True, timeout=30),
                children,
                "the migrated Back Office API and authenticated developer identity",
            )
        except HTTPError as exc:
            raise RuntimeError(
                "Local API identity is unavailable. Check your Main Sequence login and platform connection."
            ) from exc
        if not identity.get("user_uid"):
            raise RuntimeError("The local API did not verify the developer identity.")
        print(f"Back Office ready: {site_origin}/", flush=True)
        print(f"API: {api_origin} | MetaTables: {state['api_endpoint']}", flush=True)
        if not args.no_agent:
            print(f"Tau agent: {agent_origin} (local mode)", flush=True)
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
    parser.add_argument("--api-port", type=int, default=28641)
    parser.add_argument("--site-port", type=int, default=5174)
    parser.add_argument("--metatables-port", type=int, default=18473)
    parser.add_argument("--agent-port", type=int, default=28643)
    parser.add_argument(
        "--agent-provider", default=os.environ.get("TAU_LOCAL_PROVIDER", "openai-codex")
    )
    parser.add_argument("--agent-model", default=os.environ.get("TAU_LOCAL_MODEL", "gpt-5.5"))
    parser.add_argument("--agent-thinking", default=os.environ.get("TAU_LOCAL_THINKING", "medium"))
    parser.add_argument(
        "--no-agent", action="store_true", help="Explicitly run only the API, MetaTables and site."
    )
    parser.add_argument(
        "--restart-unhealthy-metatables",
        action="store_true",
        help="Gracefully replace a verified same-user MetaTables launcher only after its specific identity-unavailable error.",
    )
    parser.add_argument(
        "--metatables-configuration", type=Path, default=DEFAULT_METATABLES_CONFIGURATION
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
