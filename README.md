# Back Office Command Center application

Frontend for the Main Sequence document reconciliation platform. The application
will let reviewers manage people, assign document sets, upload and review documents,
inspect reconciliation findings, and work with the Main Sequence reconciliation agent.

The repository currently contains a Vite/React starter. The
[frontend project plan](engineering/project-plan.md) defines the planned screens,
folder structure, API and agent integration, documentation, and delivery milestones.
The companion `backofficebackend` CodeRepository owns the Pydantic document catalog,
Main Sequence MetaTables, REST/MCP services, processing Jobs, and `ms-tau-sdk` agent.

The backend foundation now contains ten canonical/draft JSON Schema pairs under
`schemas/documents/<type>/v1.json`, including English field descriptions and schema
checksums. Its generated references are `docs/model-reference.md` and
`docs/metatable-dictionary.md`. Business endpoints and the agent remain planned;
the frontend integration milestone will expose these contracts through the API.

## Main Sequence integration

- Use `@dev-mainsequence/command-center-sdk` for the application shell, controls,
  resource views, theme, and authorized embedded FastAPI transport.
- Add a compatible `@dev-mainsequence/command-center-ai` version for Main Sequence
  Agent conversations during implementation.
- Obtain document fields and descriptions from the backend's Pydantic schemas.
- Deploy the application as a Main Sequence Static Site from this repository root.

The [Static Site workflow](.mainsequence/workflows/backoffice-site.yaml) enables
deployment on every push to the registered Production `main` branch, builds
`dist` with Node 24, and supplies the Back Office navigation icon. See the
[deployment guide](engineering/deployment.md) for validation and release checks.
The [assistant right-rail plan](engineering/assistant-right-rail.md) defines the
responsive conversation surface, shared session engine, backend prerequisites,
and acceptance checks; the assistant is not implemented yet.

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
```

These commands run/build the current starter. Planned documentation, integration,
and browser checks are listed in the engineering plan and will be added with their
corresponding features.

## Documentation locations

Engineering plans and integration procedures live in `engineering/`. The future
served user guide lives under `docs/` and follows the application's actual visible
navigation. Each feature's guide is written and verified with the implemented UI.
