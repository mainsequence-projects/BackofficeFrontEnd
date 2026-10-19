# Manual casework release verification

Verified on 2026-10-19 against the real Back Office API and an isolated local
MetaTables 0.1.49 SQLite runtime. Synthetic cases remain local; production is not
populated with demo people or uploaded documents.

`npm run test:browser` exercises the SDK startup gate and application shell,
creates a reference profile, assigns a published policy version, and uploads,
completes, submits and accepts four document types through their screens. It links
the actual accepted evidence, checks the backend's completed evaluation, changes
the profile, and confirms the retained result is stale. The final run and
screenshots are saved under ignored `.local/browser-results/`.

`npm run test:forms` checks field entry for all ten generated backend schemas.
It uses contract fixtures to cover references, nullable objects, arrays and nested
object arrays, choices, dates, full timezone-aware timestamps, and high precision
decimal strings. This renderer check is separate from the real API workflow.

`npm run test:revisions` creates a new draft through the UI and checks that the
previous revision retains its original payload, verified source and accepted
review. Retained views expose no save or decision actions. The backend's exact
revision endpoint also has tests beyond its list pagination limits.

`npm run test:production` serves the built artifact in a test-only SDK iframe
host around the real local API. It verifies a standalone production link's
unavailable state, trusted handshake, ready shell, new-person and published-policy
geometry in light/dark themes, actual touch/desktop contexts, and all five guide
routes. Each device/theme has a fresh browser context; screenshots run after
geometry checks because full-page capture resets Chromium pointer emulation.
The test host, its loopback proxy and verification credential never enter `dist`.

`npm run check`, the combined app/guide build, the 11 local-launcher checks, and
both live platform workflow validators pass. Backend commit `8b772a8` passes
79 tests, lint/format, generated contracts and lockfile checks.

Hosted release verification follows `deployment.md`: observe the migration Job,
grant the API workload namespace access from the human operator session, verify
API readiness and the actual authenticated Command Center launch. A successful
build alone does not establish that the hosted application works.

OCR extraction and the live Tau Agent remain backend milestones documented in
`assistant-right-rail.md`. The application exposes no simulated agent replies
or extraction actions.

## Assistant frontend verification

Command Center AI 0.0.15 is installed with the existing SDK 0.5.18. The rail,
expanded `/agent` page and six-page guide build together. `npm run test:assistant`
uses the published package's scripted platform/runtime from test code only.
It verifies streamed reasoning/tool/text output, a stable session handle,
Environment-scoped session reads, expanding/minimizing with the same conversation
and return URL, pointer/keyboard resizing with matching docked content, stop,
failed-turn retry, absent-agent recovery, focus restoration, and 1440px/1280px/
375px layouts in both light and dark themes. Screenshots are under ignored
`.local/assistant-verification/`.

AI 0.0.15 emits the deliberately refused provider stream as an unhandled rejection
in addition to rendering its error. The suite permits only that exact intentional
error and verifies successful retry; it does not suppress other browser errors.
No dependency internals were patched. This remains a package issue.

Live verification awaits the ADR 0002 Agent and authenticated API discovery at
`GET /assistant/context`. The frontend fails closed until the API returns both
the Agent UID and its own Environment UID. It never uses a guessed Agent or the
host's selected Environment, and business screens remain usable when unavailable.

## Local app check after startup recovery

On 2026-10-19 the shared local site at `http://127.0.0.1:5174` initially returned
502 for its API requests because no API listened on port 28641. After restoring
the owned local stack, real Chrome checks verified People, the nested New person
form, Documents, both published Document Set versions, and Reconciliation. The
shared People list remained empty; no synthetic case was added to that database.

The Documentation button also exposed a real local routing error: Vite returned
the application shell for `/docs/`. The local documentation plugin now builds and
serves the Docusaurus guide at that path, refreshes it after source changes, and
supports Node 25's SSR compatibility requirement without experimental WebStorage.
Chrome verified the guide's sidebar navigation and return to the app.
`npm run test:docs:local` checks all six pages, compiled assets, concurrent first
requests, canonical redirect, HEAD, missing routes, unsupported methods, and path
traversal rejection. Node 24 remains the declared application toolchain.

The current local code passed `npm run check`, all ten schema form contracts, and
the complete real-API casework browser flow on the disposable SQLite source
`fe037dd5-c954-5ea2-aaba-c3e1aa3c3a5b`, isolated at ports 15174/18001/18474 with
storage under `/private/tmp/backoffice-app-verification`. This includes accepted
source evidence, completed reconciliation, and stale retained results after a
profile change. These write checks did not use the shared local database.
`npm run test:renewals` also passed against this same disposable source, including
six-calendar-month freshness, overdue actions, pinned policy versions, mobile
layout, stale reports, and exact retained submission dates.
The current `npm run test:revisions` passed as well: a new draft leaves the
accepted older payload, verified source, and review available in a read-only view.
