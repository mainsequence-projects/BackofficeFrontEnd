# Back Office Command Center application

Command Center application for the Main Sequence document reconciliation platform.
Create and search people, assign published document requirements, upload source
evidence, complete schema-driven attributes, review exact revisions, and evaluate
requirements against the existing backend.

The [frontend project plan](engineering/project-plan.md) defines the screens,
API and agent integration, documentation, and delivery milestones.
The companion `backofficebackend` CodeRepository owns the Pydantic document catalog,
Main Sequence MetaTables, REST/MCP services, processing Jobs, and `ms-tau-sdk` agent.

The backend exposes ten canonical/draft JSON Schema pairs through authenticated
business endpoints. Forms use those fields and descriptions. Source uploads use
bounded chunks and checksum verification. Reviews and evaluations retain immutable
history; changed evidence makes prior evaluations visibly out of date.

## Main Sequence integration

- Use `@dev-mainsequence/command-center-sdk` for the application shell, controls,
  resource views, theme, and authorized embedded FastAPI transport.
- Use `@dev-mainsequence/command-center-ai` for the assistant rail, shared
  conversation engine, expanded Agent page, and model-provider settings.
- Obtain document fields and descriptions from the backend's Pydantic schemas.
- Deploy the application as a Main Sequence Static Site from this repository root.

The [Static Site workflow](.mainsequence/workflows/backoffice-site.yaml) enables
deployment on every push to the registered Production `main` branch, builds
`dist` with Node 24, and supplies the Back Office navigation icon. See the
[deployment guide](engineering/deployment.md) for validation and release checks.
The [assistant right-rail plan](engineering/assistant-right-rail.md) defines the
responsive conversation surface, shared session engine, backend prerequisites,
and acceptance checks. The frontend is implemented; live conversation requires
the API's ADR 0002 Agent and authenticated `/assistant/context` discovery endpoint.

## Current development commands

For the complete local stack, open this repository in VS Code, select
**Back Office: local stack**, and press **F5**. It starts the API, Vite, and local
Main Sequence MetaTables and opens `http://127.0.0.1:5174/` after readiness checks.
Use **Back Office: install local dependencies** for first setup.
See the [local development guide](engineering/local-development.md) for paths,
authentication, local migrations, shared-runtime troubleshooting, and debugging.

```bash
npm ci
npm run dev
npm run build
npm run test:assistant
```

Use Node 24. `npm run check` validates types, SDK theme usage, and guide structure.
`npm run test:browser` verifies the complete manual workflow against an isolated
loopback stack. It creates synthetic local records and refuses a non-loopback URL.
`npm run build` produces both the application and the served user guide.

## Documentation locations

Engineering plans and integration procedures live in `engineering/`. The served
user guide lives under `docs/` and follows the application's four destinations.
