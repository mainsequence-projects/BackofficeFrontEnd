"""Process lifecycle and readiness failures for the VS Code launcher."""

import importlib.util
import io
import os
import socket
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location(
    "dev_stack", Path(__file__).resolve().parents[1] / "scripts/dev_stack.py"
)
stack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stack)


class LocalStackTests(unittest.TestCase):
    def test_child_stdout_and_stderr_are_relayed_with_a_service_label(self):
        children, readers = [], []
        output = io.StringIO()
        with redirect_stdout(output):
            child = stack.start_service(
                [
                    sys.executable,
                    "-c",
                    "import sys; print('startup'); print('diagnostic', file=sys.stderr)",
                ],
                label="Agent",
                cwd=Path.cwd(),
                env=None,
                children=children,
                readers=readers,
            )
            child.wait(timeout=10)
            readers[0].join(timeout=5)
        self.assertEqual(child.returncode, 0)
        self.assertIn("[Agent] startup", output.getvalue())
        self.assertIn("[Agent] diagnostic", output.getvalue())
        self.assertFalse(readers[0].is_alive())
        self.assertTrue(child.stdout.closed)

    def test_global_python_relays_to_the_backend_environment(self):
        with TemporaryDirectory() as directory:
            backend = Path(directory)
            python = backend / ".venv/bin/python"
            python.parent.mkdir(parents=True)
            python.touch()
            child = Mock()
            child.wait.return_value = 0
            child.poll.return_value = 0
            with (
                patch.object(stack.sys, "prefix", "/global-python"),
                patch.object(stack.subprocess, "Popen", return_value=child) as start,
            ):
                with self.assertRaises(SystemExit) as result:
                    stack.relay_to_backend_python(backend, ["--backend-dir", str(backend)])
                self.assertEqual(result.exception.code, 0)
                self.assertEqual(start.call_args.args[0][0], str(python))
                self.assertEqual(start.call_args.args[0][-2:], ["--backend-dir", str(backend)])

    def test_backend_python_does_not_relaunch_itself(self):
        backend = Path("/example/backend")
        with (
            patch.object(stack.sys, "prefix", str(backend / ".venv")),
            patch.object(stack.subprocess, "Popen") as start,
        ):
            stack.relay_to_backend_python(backend, [])
            start.assert_not_called()

    def test_tau_uses_local_workspace_and_cannot_enable_the_excluded_tools(self):
        backend = Path("/example/backend")
        args = SimpleNamespace(
            agent_port=28643,
            agent_provider="configured-provider",
            agent_model="configured-model",
            agent_thinking="medium",
        )
        inherited = {
            "MAINSEQUENCE_ENDPOINT": "http://platform.invalid",
            "TAU_EXCLUDE_BASE_TOOLS": "false",
        }
        result = stack.tau_environment(backend, args, inherited)
        self.assertEqual(result["TAU_LOCAL_MODE"], "true")
        self.assertEqual(result["MAINSEQUENCE_TAU_HOST"], "127.0.0.1")
        self.assertEqual(result["MAINSEQUENCE_TAU_PORT"], "28643")
        self.assertEqual(result["MAINSEQUENCE_TAU_WORKSPACE"], str(backend))
        self.assertEqual(result["MAINSEQUENCE_CLI"], str(backend / ".venv/bin/mainsequence"))
        self.assertEqual(result["MAINSEQUENCE_ENDPOINT"], inherited["MAINSEQUENCE_ENDPOINT"])
        self.assertEqual(result["TAU_EXCLUDE_BASE_TOOLS"], "true")
        self.assertEqual(result["TAU_EXCLUDE_MAINSEQUENCE_MCP"], "true")
        self.assertEqual(result["TAU_LOCAL_MODEL"], "configured-model")
        self.assertEqual(inherited["TAU_EXCLUDE_BASE_TOOLS"], "false")

    def test_agent_readiness_requires_the_restricted_local_runtime(self):
        ready = {
            "mode": "local",
            "ok": True,
            "exclude_base_tools": True,
            "exclude_mainsequence_mcp": True,
        }
        with patch.object(stack, "read_url", return_value=ready) as read:
            self.assertTrue(stack.local_agent_ready("http://127.0.0.1:28643"))
            read.assert_called_once_with("http://127.0.0.1:28643/ready", as_json=True, timeout=30)
        for change in (
            {"mode": "managed"},
            {"exclude_base_tools": False},
            {"exclude_mainsequence_mcp": False},
        ):
            with patch.object(stack, "read_url", return_value=ready | change):
                with self.assertRaisesRegex(RuntimeError, "restricted local helper"):
                    stack.local_agent_ready("http://127.0.0.1:28643")
        with patch.object(stack, "read_url", return_value=ready | {"ok": False}):
            self.assertFalse(stack.local_agent_ready("http://127.0.0.1:28643"))

    def test_only_the_specific_metatables_identity_error_allows_recovery(self):
        for status, detail, expected in (
            (503, "Current platform identity facts are unavailable.", True),
            (503, "Local SDK identity is unavailable.", True),
            (503, "Maintenance in progress", False),
            (403, "Current platform identity facts are unavailable.", False),
        ):
            error = SimpleNamespace(status_code=status, payload={"detail": detail})
            self.assertEqual(stack.is_identity_failure(error), expected)

    def test_recovery_keeps_the_original_configuration(self):
        with TemporaryDirectory() as directory:
            config = (Path(directory) / "custom.yaml").resolve()
            config.write_text("local_mode_available: true\n")
            self.assertEqual(
                stack.recovery_configuration(
                    ["python", "--configuration", "custom.yaml"], directory
                ),
                config,
            )
            self.assertEqual(
                stack.recovery_configuration(["python", f"--configuration={config}"], directory),
                config,
            )
            with self.assertRaises(RuntimeError):
                stack.recovery_configuration(["python"], directory)

    def test_recovery_only_stops_the_verified_registered_launcher(self):
        with TemporaryDirectory() as directory:
            config = (Path(directory) / "configuration.yaml").resolve()
            config.write_text("local_mode_available: true\n")
            record = dict(pid=12345, process_created=1.0, launch_id="original-launch")
            process = Mock()
            process.create_time.return_value = 1.0
            process.uids.return_value = SimpleNamespace(real=os.getuid())
            process.cmdline.return_value = ["python", "metatables"]
            process.cwd.return_value = directory
            with (
                patch("psutil.Process", return_value=process),
                patch("metatables.local_connection.running_server", return_value=record),
            ):
                self.assertEqual(stack.restart_failed_runtime(record), config)
                process.terminate.assert_called_once()
            process.reset_mock()
            changed = dict(record, launch_id="different-launch")
            with (
                patch("psutil.Process", return_value=process),
                patch("metatables.local_connection.running_server", return_value=changed),
            ):
                with self.assertRaises(RuntimeError):
                    stack.restart_failed_runtime(record)
                process.terminate.assert_not_called()

    def test_recovered_configuration_persists_without_overriding_explicit_test_config(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            configuration = root / "original.yaml"
            configuration.write_text("local_mode_available: true\n")
            with patch.object(stack, "LOCAL_LAUNCH_STATE", root / "state.json"):
                stack.remember_configuration(configuration)
                self.assertEqual(
                    stack.selected_configuration(stack.DEFAULT_METATABLES_CONFIGURATION),
                    configuration.resolve(),
                )
                self.assertEqual(
                    stack.selected_configuration(root / "explicit.yaml"),
                    (root / "explicit.yaml").resolve(),
                )
                configuration.unlink()
                with self.assertRaises(RuntimeError):
                    stack.selected_configuration(stack.DEFAULT_METATABLES_CONFIGURATION)

    def test_port_conflicts_and_invalid_numbers_fail_before_starting_services(self):
        for ports in ([0], [65536], [28641, 28641]):
            with self.assertRaises(RuntimeError):
                stack.ensure_ports_free(ports)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            with self.assertRaises(RuntimeError):
                stack.ensure_ports_free([listener.getsockname()[1]])

    def orphan(self, backend):
        process = Mock(pid=12345)
        process.ppid.return_value = 1
        process.uids.return_value = SimpleNamespace(real=os.getuid())
        process.cwd.return_value = str(backend)
        process.create_time.return_value = 1.0
        process.cmdline.return_value = [
            "python",
            "-m",
            "uvicorn",
            "scripts.local_api:create_app",
            "--host",
            "127.0.0.1",
            "--port",
            "28641",
        ]
        return process

    def test_orphan_identity_requires_the_same_user_checkout_target_host_and_port(self):
        backend = Path("/example/backend")
        checks = dict(cwd=backend, port=28641, target="scripts.local_api:create_app")
        process = self.orphan(backend)
        with patch.object(stack.os, "getpgid", return_value=process.pid):
            self.assertTrue(stack.orphaned_service(process, **checks))
            for method, wrong, original in (
                (process.ppid, 999, 1),
                (
                    process.uids,
                    SimpleNamespace(real=os.getuid() + 1),
                    SimpleNamespace(real=os.getuid()),
                ),
                (process.cwd, "/another/backend", str(backend)),
                (process.cmdline, ["unrelated-server"], process.cmdline.return_value),
            ):
                method.return_value = wrong
                self.assertFalse(stack.orphaned_service(process, **checks))
                method.return_value = original
            self.assertFalse(stack.orphaned_service(process, **(checks | {"port": 28642})))
            process.cmdline.return_value[-3] = "0.0.0.0"
            self.assertFalse(stack.orphaned_service(process, **checks))
        with patch.object(stack.os, "getpgid", return_value=process.pid + 1):
            self.assertFalse(stack.orphaned_service(process, **checks))

    def test_explicit_restart_can_replace_verified_services_adopted_by_an_app_host(self):
        backend = Path("/example/backend")
        process = self.orphan(backend)
        process.ppid.return_value = 9000
        checks = dict(cwd=backend, port=28641, target="scripts.local_api:create_app")
        with patch.object(stack.os, "getpgid", return_value=process.pid):
            self.assertFalse(stack.orphaned_service(process, **checks))
            self.assertTrue(stack.orphaned_service(process, **checks, restart_existing=True))
            process.cwd.return_value = "/another/project"
            self.assertFalse(stack.orphaned_service(process, **checks, restart_existing=True))

    def test_relative_vite_entry_is_resolved_in_the_verified_project_directory(self):
        process = self.orphan(stack.SITE_DIR)
        process.cmdline.return_value = [
            "node",
            "node_modules/vite/bin/vite.js",
            "--host",
            "127.0.0.1",
            "--port",
            "5174",
        ]
        with patch.object(stack.os, "getpgid", return_value=process.pid):
            self.assertTrue(
                stack.orphaned_service(
                    process,
                    cwd=stack.SITE_DIR,
                    port=5174,
                    target=str(stack.SITE_DIR / "node_modules/vite/bin/vite.js"),
                )
            )

    def test_legacy_tau_restart_requires_exact_local_workspace_port_and_exclusions(self):
        backend = Path("/example/backend")
        process = self.orphan(backend)
        process.ppid.return_value = 9000
        process.cmdline.return_value = ["python", str(backend / ".venv/bin/ms-tau")]
        environment = {
            "MAINSEQUENCE_TAU_WORKSPACE": str(backend),
            "MAINSEQUENCE_TAU_HOST": "127.0.0.1",
            "MAINSEQUENCE_TAU_PORT": "28643",
            "TAU_LOCAL_MODE": "true",
            "TAU_EXCLUDE_BASE_TOOLS": "true",
            "TAU_EXCLUDE_MAINSEQUENCE_MCP": "true",
        }
        process.environ.return_value = environment
        checks = dict(cwd=backend, port=28643, target="api.tau.main:app", restart_existing=True)
        with patch.object(stack.os, "getpgid", return_value=process.pid):
            self.assertTrue(stack.orphaned_service(process, **checks))
            for key in environment:
                process.environ.return_value = environment | {key: "different"}
                self.assertFalse(stack.orphaned_service(process, **checks))

    def test_launch_failure_keeps_the_cause_and_redacts_credentials_in_private_error_file(self):
        output = io.StringIO()
        with TemporaryDirectory() as directory:
            error_file = Path(directory) / "error.json"
            try:
                try:
                    raise ValueError("Bearer synthetic-secret eyJhbGciOiJIUzI1NiJ9.e30.c2ln")
                except ValueError as cause:
                    raise RuntimeError("Preparation failed") from cause
            except RuntimeError as error:
                with patch.object(stack, "LOCAL_ERROR_LOG", error_file), redirect_stderr(output):
                    stack.record_launch_error(error)
            detail = error_file.read_text()
            self.assertIn("ValueError", output.getvalue())
            self.assertIn("RuntimeError", output.getvalue())
            self.assertNotIn("synthetic-secret", output.getvalue() + detail)
            self.assertNotIn("eyJhbGciOiJIUzI1NiJ9.e30.c2ln", output.getvalue() + detail)
            self.assertEqual(error_file.stat().st_mode & 0o777, 0o600)

    def test_recovery_stops_only_a_verified_orphan_and_preserves_live_launches(self):
        backend = Path("/example/backend")
        for parent, terminated in ((1, True), (999, False)):
            process = self.orphan(backend)
            process.ppid.return_value = parent
            with (
                patch.object(stack, "port_available", side_effect=[False, True]),
                patch.object(
                    stack.subprocess,
                    "run",
                    return_value=SimpleNamespace(returncode=0, stdout="12345\n"),
                ),
                patch("psutil.Process", return_value=process),
                patch.object(stack.os, "getpgid", return_value=process.pid),
                patch.object(stack.os, "killpg") as kill,
            ):
                stack.recover_orphaned_services(backend, 28641, 5174)
                if terminated:
                    kill.assert_called_once_with(process.pid, stack.signal.SIGTERM)
                    process.wait.assert_called_once_with(timeout=10)
                else:
                    kill.assert_not_called()

    def test_orphan_cleanup_refuses_to_force_stop_a_reused_process_id(self):
        import psutil

        backend = Path("/example/backend")
        original = self.orphan(backend)
        original.wait.side_effect = psutil.TimeoutExpired(10)
        replacement = self.orphan(backend)
        replacement.create_time.return_value = 2.0
        with (
            patch.object(stack, "port_available", return_value=False),
            patch.object(
                stack.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0, stdout="12345\n"),
            ),
            patch("psutil.Process", side_effect=[original, replacement]),
            patch.object(stack.os, "getpgid", return_value=original.pid),
            patch.object(stack.os, "killpg") as kill,
        ):
            with self.assertRaisesRegex(RuntimeError, "changed during cleanup"):
                stack.recover_orphaned_services(backend, 28641, 5174)
            kill.assert_called_once_with(original.pid, stack.signal.SIGTERM)

    def test_recovery_includes_an_orphaned_local_agent(self):
        backend = Path("/example/backend")
        process = self.orphan(backend)
        process.cmdline.return_value = [
            "python",
            "-m",
            "uvicorn",
            "api.tau.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "28643",
        ]
        with (
            patch.object(stack, "port_available", side_effect=[True, True, False]),
            patch.object(
                stack.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0, stdout="12345\n"),
            ),
            patch("psutil.Process", return_value=process),
            patch.object(stack.os, "getpgid", return_value=process.pid),
            patch.object(stack.os, "killpg") as kill,
        ):
            stack.recover_orphaned_services(backend, 28641, 5174, 28643)
            kill.assert_called_once_with(process.pid, stack.signal.SIGTERM)

    def test_stopping_the_stack_stops_its_owned_processes(self):
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True
        )
        try:
            stack.stop_children([child])
            self.assertIsNotNone(child.poll())
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_recently_closed_local_connection_does_not_block_a_restart(self):
        with socket.socket() as listener, socket.socket() as client:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
            listener.listen()
            client.connect(("127.0.0.1", port))
            accepted, _ = listener.accept()
            accepted.close()
        self.assertTrue(stack.port_available(port))

    def test_exited_service_fails_readiness_without_waiting_for_timeout(self):
        child = subprocess.Popen([sys.executable, "-c", "raise SystemExit(7)"])
        child.wait()
        with self.assertRaisesRegex(RuntimeError, "code 7"):
            stack.wait_for(lambda: False, [child], "test service")

    def test_forbidden_readiness_does_not_retry(self):
        def forbidden():
            raise HTTPError("http://127.0.0.1/", 403, "Forbidden", {}, None)

        with self.assertRaisesRegex(RuntimeError, "403"):
            stack.wait_for(forbidden, [], "test service")


if __name__ == "__main__":
    unittest.main()
