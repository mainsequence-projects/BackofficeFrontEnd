"""Process lifecycle and readiness failures for the VS Code launcher."""

import importlib.util
import socket
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location(
    "dev_stack", Path(__file__).resolve().parents[1] / "scripts/dev_stack.py"
)
stack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stack)


class LocalStackTests(unittest.TestCase):
    def test_port_conflicts_and_invalid_numbers_fail_before_starting_services(self):
        for ports in ([0], [65536], [8001, 8001]):
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
