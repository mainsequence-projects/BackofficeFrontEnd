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

OCR extraction and the Tau assistant remain separate milestones documented in
`assistant-right-rail.md`; the manual application does not expose simulated agent
or extraction actions.
