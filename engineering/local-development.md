# Local development in VS Code

Open this static-site repository as the VS Code workspace. Its
[launch configuration](../.vscode/launch.json) starts the backend checkout,
the installed Main Sequence MetaTables API, and Vite together.

## First setup

1. Install the recommended Python and Python Debugger extensions when VS Code
   offers them. Node.js, npm, uv, and Python 3.13+ must be available.
2. Check `backoffice.backendPath` in [.vscode/settings.json](../.vscode/settings.json).
   It is a path relative to this repository and already points to this workspace's
   sibling backend checkout. Change it if either checkout moves.
3. Run **Tasks: Run Task → Back Office: install local dependencies**. This executes
   `uv sync --locked` in the backend and `npm ci --ignore-scripts` in the static site.
   Package install scripts are skipped to preserve the existing managed skill files.
4. Use the existing Main Sequence sign-in. If it is unavailable, sign in through
   the Main Sequence extension or run the backend's `.venv/bin/mainsequence login`.

## Start and stop

Select **Back Office: local stack** in Run and Debug, then press **F5**.
The launch pins both the debugger launcher and the application to the backend's
`.venv`. If VS Code still starts the script with a globally selected Python, the
script relaunches itself with the backend interpreter before importing SDKs.

| Service | Default address |
| --- | --- |
| Static site | `http://127.0.0.1:5174/` |
| Back Office API | `http://127.0.0.1:8001/` |
| MetaTables API | `http://127.0.0.1:18473/` |
| API health through Vite | `http://127.0.0.1:5174/api/healthz` |

The launcher starts or reuses local MetaTables, verifies Local mode and the selected
SQLite source, explicitly initializes its system schema if needed, and applies
`src.backoffice.migrations:migration`. It creates the local `backoffice` namespace
when absent. This is an explicit local development command; deploying or importing
the application does not execute migrations.

After local migrations succeed, it starts the real Back Office app through a
developer gateway, enables Python reload, and starts Vite with HMR. It verifies
`/api/` through the Vite proxy, including the developer identity, before printing
`Back Office ready` and opening the site. The UI currently shows the existing
starter; document-management screens remain subsequent work.

Stop the debugging session or use Ctrl+C in its terminal to stop the processes
owned by that launch. A pre-existing healthy MetaTables process remains running.
Local records persist across starts. The launcher never deletes a database.

Python debugging includes subprocesses, including the API reload worker. The
optional **Back Office: browser debugger** configuration opens Chrome against the
running Vite app with frontend source maps.

## Local identity and API transport

Browser code calls relative `/api/...` URLs. Vite forwards them to the loopback
Back Office API and removes the `/api` prefix, so `/api/` reaches the existing `/`
route and `/api/healthz` reaches the local readiness endpoint. Set
`BACKOFFICE_API_ORIGIN` in the dev-server process to override the target; the stack
launcher sets it from `--api-port`. Keep the browser on the launcher's printed
`127.0.0.1` URL so its origin matches the local gateway.

The backend gateway resolves the developer's saved Main Sequence session on the
server. It supplies its current credential internally, while the real app retains
Main Sequence request-identity verification. Foreign origins, non-loopback peers
and browser-supplied identity headers cannot choose the developer. No credential
is returned to the browser or passed to the Vite process.

The gateway also verifies the local MetaTables DataSource and detects a later
source change. `/healthz` returns readiness and the local source UID, without
credentials. Missing developer identity returns an unavailable response.

## Shared runtime and troubleshooting

The default uses the laptop's shared MetaTables SQLite store. An already-running
API is reused only after its runtime can be verified; failure never redirects to
hosted MetaTables or another database.

The VS Code profile enables `--restart-unhealthy-metatables`. If the registered
local runtime returns the specific `503` identity-unavailable error, the launcher
first verifies the current developer session, then gracefully stops only the
same-user process identified by MetaTables' private connection record. Its PID,
creation time, and launch ID must still match. Other errors do not trigger a restart.

Recovery reuses the original configuration file and its saved database selection;
it never deletes or replaces the database. A non-secret configuration-path pointer
is saved in `.local/dev-stack.json` so later F5 launches use the same configuration.
An explicit `--metatables-configuration` argument takes precedence. A missing saved
configuration fails with an error instead of selecting another database.

The stopped legacy launch may also own an Admin dev server; that server stops with
it. Back Office starts the corrected MetaTables API. Healthy pre-existing runtimes
continue to be reused. Occupied API or Vite ports fail before additional services
start. Port checks allow recently closed connections, so immediate restarts work.
Adjust the launch arguments and browser-debugger URL together when changing ports.

The backend pins `mainsequence==9.0.29` and `mainsequence-metatable==0.1.47`.
For these versions, its developer-session adapter uses the same renewing CLI
session helper as `mainsequence auth token`. Its local MetaTables entry point calls
the installed package's `metatables.api.app.development.run_worker`, retaining the
package's loopback admission, runtime controls, catalog, and SQLite initialization.
This avoids the pinned CLI launcher's saved-session mismatch. Recheck these adapter
interfaces when upgrading the pinned packages.

No MetaTables Admin frontend is installed or launched by this configuration.
Table operations are available through the local MetaTables client/API.

## Verification commands

The launcher accepts `--verify-only` to run readiness and identity checks, then
shut down the processes it started:

```bash
../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118/.venv/bin/python \
  scripts/dev_stack.py \
  --backend-dir ../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118 \
  --restart-unhealthy-metatables \
  --verify-only
```

For an isolated integration test, the installed MetaTables package supports a
separate `METATABLES_LOCAL_STORAGE_DIR`. Use alternate ports and a configuration
file copied into a temporary directory with `--metatables-configuration`; its
private runtime selection then stays in that temporary directory. This explicit
test setup was used to verify first initialization, namespace/table creation,
`backoffice_0001`, actual API identity through Vite, and shutdown without changing
the pre-existing shared runtime. Repeating it verifies retained local migrations.

Frontend launcher tests use only the backend's Python environment:

```bash
../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118/.venv/bin/python \
  -m unittest discover -s tests -v
npm run build
```

Run `uv run pytest -q` in the backend for document contracts, migrations, developer
identity, local-source selection, and origin isolation tests.
