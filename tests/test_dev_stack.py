"""Process lifecycle and readiness failures for the VS Code launcher."""

import importlib.util
import os
import socket
import subprocess
import sys
import unittest
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
