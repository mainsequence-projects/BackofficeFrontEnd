# Local development in VS Code

Open either the backend or this static-site repository as the VS Code workspace.
Both provide **Back Office: local stack**; the frontend
[launch configuration](../.vscode/launch.json) starts the backend checkout,
the installed Main Sequence MetaTables API, the Tau agent in local mode, and Vite together.

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
| Back Office API | `http://127.0.0.1:28641/` |
| MetaTables API | `http://127.0.0.1:18473/` |
| Tau local agent | `http://127.0.0.1:28643/` |
| API health through Vite | `http://127.0.0.1:5174/api/healthz` |

The launcher starts or reuses local MetaTables, verifies Local mode and the selected
SQLite source, explicitly initializes its system schema if needed, and applies
`src.backoffice.migrations:migration`. It creates the local `backoffice` namespace
when absent. This is an explicit local development command; deploying or importing
the application does not execute migrations.

After local migrations succeed, it starts the real Back Office app through a
developer gateway, enables Python reload, and starts Vite with HMR. It verifies
`/api/readyz` through the Vite proxy, including the developer identity and document
catalog, before printing `Back Office ready` and opening the site. The app provides
People, Documents, Document Sets, Reconciliation, and the assistant.

The Documentation button opens the real Docusaurus guide at `/docs/`. Vite builds
it on first use and rebuilds it after guide-source changes; no separate docs server
or additional port is required. `npm run test:docs:local` verifies the six guide
pages, their JavaScript assets, and the local route's path/method handling on an
isolated Vite port.

The VS Code **Debug Console** opens automatically. The launcher prints every
service URL and port before startup, including API docs and MCP. Child stdout and
stderr are forwarded with `[API]`, `[Agent]`, `[Site]`, or `[MetaTables]` prefixes.
For an already-running shared MetaTables process, the console prints its verified
address and reuse status; that process's existing logs remain in its original terminal.

Stop the debugging session to stop the processes
owned by that launch. A pre-existing healthy MetaTables process remains running.
Local records persist across starts. The launcher never deletes a database.

F5 passes `--restart-project-services` to replace only verified Back Office API,
Vite and agent listeners from this user and checkout. This also handles old services
adopted by an app host, whose parent remains alive after the original launch exits.
The process group, command, directory, host and port must match; the legacy Tau CLI
also requires matching local workspace and exclusion settings. Shared MetaTables
and unrelated projects are preserved.

Startup failures print their actual exception chain in the Debug Console and save
a redacted private copy in `.local/dev-stack-error.json` in this frontend checkout.

The agent runs the SDK-owned `api.tau.main:app` through the backend's locked Python
and Uvicorn with `TAU_LOCAL_MODE=true`,
the backend checkout as its workspace, and the existing Main Sequence session.
The launcher waits for its `/ready` endpoint and verifies both helper exclusion
flags before reporting the stack ready. Tau uses local state under the backend's
`.local/tau/` and `.local/tau-home/`; stopping F5 also stops this agent process.
Provider control and inference remain live Main Sequence services. The defaults
are `openai-codex`, `gpt-5.6-luna` (GPT-5.6 Luna), and `medium`.
Both F5 profiles explicitly select `gpt-5.6-luna` with `--agent-model`; that
argument takes precedence over an inherited `TAU_LOCAL_MODEL` value.
Override them with `--agent-provider`, `--agent-model`, and `--agent-thinking`, or
the corresponding `TAU_LOCAL_PROVIDER`, `TAU_LOCAL_MODEL`, and `TAU_LOCAL_THINKING`
environment variables. No model call is made by the launcher verification.

The existing helper policy still requires a verified requester for business tools;
local startup does not bypass that check or register a hosted Agent. The local
assistant rail uses Command Center AI's `createLocalAgentSource` through the SDK's
same-origin `/__agent__` proxy to this Back Office runtime. It does not request
deployed-Agent discovery or create platform sessions. The dev server uses
`MAINSEQUENCE_TAU_LOCAL_ORIGIN`, defaulting to `http://127.0.0.1:28643`; the launcher
sets it from `--agent-port`. Production builds retain the platform connection.
Use `--no-agent` only when deliberately testing the
API and site without Tau.

Python debugging targets the launcher. Child services run normally and their
stdout/stderr is relayed into that same Debug Console. The
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
start. If VS Code terminated the launcher before child cleanup, the next launch
stops an orphaned API, Tau agent or Vite process only after verifying its user, project
directory, isolated process group, command, loopback host, port, and absent parent.
Without `--restart-project-services`, active listeners keep the port-conflict error.
Other projects always keep it. Port checks allow recently closed connections, so immediate restarts work.
Adjust the launch arguments and browser-debugger URL together when changing ports.

The backend pins `mainsequence==9.0.29` and `mainsequence-metatable==0.1.49`.
For these versions, its developer-session adapter uses the same renewing CLI
session helper as `mainsequence auth token`. Its local MetaTables entry point calls
the installed package's `metatables.api.app.development.run_worker`, retaining the
package's loopback admission, runtime controls, catalog, and SQLite initialization.
This avoids the pinned CLI launcher's saved-session mismatch. Recheck these adapter
interfaces when upgrading the pinned packages.

Migration registration creates an absent `backoffice` namespace automatically.
In local human-authenticated development its creator receives `owner`; a hosted
migration Job instead receives `editor`. A human who manages that Job grants the
API workload `data_writer` and an appropriate human or Team `owner` after creation.
Grants never run inside the Job. Repeated upgrades preserve the namespace identity.

The local launcher allows up to 30 seconds per authenticated identity probe within
its bounded readiness wait. The Main Sequence platform must be reachable; a missing
or invalid identity still prevents startup. Use `--verify-only` below after a
dependency or local platform change before treating the stack as verified.

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
