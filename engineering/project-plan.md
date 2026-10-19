# Main Sequence Back Office frontend plan

Status: implementation plan for the accepted document reconciliation product.
The backend foundation now provides version 1 canonical/draft schema pairs and a
generated Pydantic reference. Those are code artifacts; the REST/MCP schema endpoint
and Tau agent will be implemented in later backend milestones.
The current application is a Vite/React starter. Screens, contracts, and guide
paths below are proposed until implemented and verified.

## Responsibilities and dependencies

This CodeRepository owns the Command Center application, schema-driven forms,
document review experience, agent conversation surface, and user documentation.
The companion backend owns the Pydantic definitions, Main Sequence MetaTables,
business REST/MCP services, processing Jobs, and Tau agent.

Use `@dev-mainsequence/command-center-sdk` for navigation, layout, controls,
resource lists/details, feedback, theme, and authorized embedded API transport.
Use the separate `@dev-mainsequence/command-center-ai` package for conversations
with Main Sequence Agents. Select compatible versions from their actual peer
contracts and retain one SDK dependency graph and lockfile.

The browser reads business data through the backend's authorized application
interfaces. It does not duplicate metatable operations or document reconciliation
rules. TypeScript interfaces are generated or checked against backend schemas;
schema descriptions and assignment-specific requirements drive the forms.

## Proposed navigation

| Navigation ID | Label | User outcome | Guide ownership |
| --- | --- | --- | --- |
| `persons` | People | Find a person, maintain reference details, and open their cases. | `docs/persons/index.md` |
| `documents` | Documents | Upload, inspect, correct, submit, and review documents. | `docs/documents/index.md` |
| `document-sets` | Document Sets | Inspect requirement definitions and their published versions. | `docs/document-sets/index.md` |
| `reconciliation` | Reconciliation | See outstanding requirements, run evaluations, and understand findings. | `docs/reconciliation/index.md` |
| `agent` | Agent | Ask the Main Sequence agent to explain or assist with a case. | `docs/agent/index.md` |

These are proposed IDs and labels. Final documentation must use the implemented
navigation's exact IDs, labels, order, nesting, and supported-role superset.
Person details can show tabs for reference information, documents, assignments,
evaluations, and history without creating unrelated top-level guide categories.

## Feature contracts

### People

The list supports authorized search, pagination, and selecting a person. The detail
view displays reference information and assigned document sets. Creating or editing
a person uses backend-defined fields and validation. Missing reference information
is visible and distinguishable from a completed profile.

Assign an exact published document-set version. Display that version on the case;
a newer published template must not silently change an existing assignment. Show
what selecting a different version will change before the explicit update.

### Documents

Start an upload through the backend and send bounded chunks with resumable progress.
Show uploading, validating, ready, processing, and failed states with supported
retry/recovery actions. Never present an incomplete upload as a reviewable source.
Source access uses the authorized application route and stable source UID.

The document detail view presents the raw source beside its structured attributes.
Selecting a field highlights its source page/evidence when available. Display
missing fields, extraction proposals, conflicting values, and manual corrections
with their provenance. Drafts remain editable; submission creates a versioned
revision. Keep processing state and review state visibly distinct.

Only authorized reviewers receive acceptance/rejection actions, and the backend
enforces the same restriction. Each action names the exact revision and records a
reason. If a revision changed during review, show the conflict and reload the
current record rather than applying the old decision to new content.

### Document Sets

Display the set's purpose, version, requirement groups, accepted alternatives,
additional required attributes, minimum counts, freshness limits, and applicability
conditions. The initial catalog includes `NewAccountRequirements`.

The initial release reads definitions authored and versioned by backend code.
Publishing an arbitrary visual policy editor is a separate capability. Optional
documents must not be displayed as universally mandatory. Explain unknown
applicability as information still needed.

### Reconciliation

Show each requirement as satisfied, missing, failed, pending review, needing
information, or not applicable. Findings link to the affected document revision,
field, and evidence. Display evaluation time and whether the result has become
stale following a profile, assignment, document, review, or policy change.

Offer the relevant next action: upload an accepted alternative, correct a field,
submit a revision, ask a reviewer, provide missing reference information, or run a
fresh evaluation. A numerical completion indicator must agree with the backend's
applicable mandatory requirements.

### Agent

The [assistant right-rail implementation plan](assistant-right-rail.md) specifies
the responsive rail and expanded Agent route, shared engine, runtime Agent and
Environment discovery, business context, delivery order, and acceptance checks.

Use Command Center AI's documented Agent/session integration for the deployed
backend agent. Carry only supported business context, such as the selected person,
assignment, document revision, and evaluation reference. A business record UID is
not an authentication identity or permission grant.

The agent can explain requirements, propose extraction/corrections with evidence,
initiate permitted processing/evaluation, and explain findings. Its first-release
role does not accept or reject documents. Render loading, reconnection,
cancellation, tool failure, unavailable-agent, and permission states using the
supported AI package interfaces. Refresh affected business views after a completed
mutation. Agent prose does not itself update the displayed authoritative record.

## Schema-driven forms

The backend owns a form contract containing the canonical and draft JSON schemas,
document/schema version, assignment-specific requiredness, read-only fields, and
optional UI metadata. The frontend uses:

| Schema information | Form behavior |
| --- | --- |
| `title` | Field label. |
| `description` | Help text visible beside the field or through an accessible help affordance. |
| Type and format | Matching SDK control for text, dates, numbers, choices, and other supported values. |
| Required and conditional rules | Clear required-state indicators for the selected workflow. |
| `enum`, numeric/string constraints | Available choices and immediate input feedback. |
| Nested definitions and references | Address, money, employer, period, and repeated-field editors. |
| Nullable/omittable values | Empty drafts without substituting fabricated defaults. |
| Read-only metadata | Server-managed identity, timestamps, revision and review state. |
| UI hints | Grouping/order/widget preferences within the supported rendering contract. |

Implement only the schema vocabulary actually emitted by the backend and document
it. Verify `$ref`, nested objects, nullable values, arrays, enums, decimals, dates,
and validation error paths. Monetary values travel without floating-point
precision loss. Client validation helps the user; the backend remains authoritative.

The document-type selector chooses the correct discriminated schema. Preserve
human-entered values when background extraction completes; show a reviewable
proposal and detect revision conflicts. Field-level help must remain readable in
both normal and narrow layouts.

## Main Sequence transport and delivery

The hosted application completes the Command Center SDK's embedded handshake and
uses the supported delegated FastAPI transport. The SDK owns credential refresh,
bounded retries, cancellation, and connection state. The application configures
the correct backend release per Environment through its Static Site workflow.

Verify Environment and release ownership together; do not copy an example UID or
assume branch names isolate data. The backend's selected MetaTables runtime is
part of the environment configuration, not a browser-selected connection.

Local development follows the SDK's supported local backend/proxy flow. Keep local
and hosted transport configuration explicit. A standalone hosted URL without its
trusted host integration shows the documented unavailable state rather than
inventing credentials or impersonating a developer.

The initial Static Site declaration now lives in
`.mainsequence/workflows/backoffice-site.yaml` and enables deployment on every
push to the registered Production branch with the Back Office icon. See the
[deployment guide](deployment.md) for validation and release observation. The
current artifact remains the starter; the complete release will include the
implemented application and its user guide. API bindings are added when the
business backend is ready.

## Frontend folder scaffolding

```text
backofficefrontend/
├── README.md
├── package.json
├── package-lock.json
├── vite.config.ts
├── .mainsequence/workflows/backoffice-site.yaml
├── .agents/skills/                  # Package-managed guidance; preserve ownership
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── app/{navigation.ts,routes.ts,providers.tsx}
│   ├── api/{client.ts,contracts.ts,errors.ts}
│   ├── features/
│   │   ├── persons/
│   │   ├── documents/
│   │   ├── document-sets/
│   │   ├── reconciliation/
│   │   └── agent/
│   ├── schema-forms/{renderer.tsx,fields,validation.ts}
│   └── generated/                  # Backend-derived contracts
├── tests/{forms,contracts,workflows}/
├── e2e/
├── engineering/
│   ├── project-plan.md
│   ├── integration.md              # Added with executable integration
│   └── operations.md               # Added with verified delivery/recovery
├── documentation/                  # Official Command Center docs scaffold
│   ├── navigation.json
│   └── sidebars.mjs                # Generated by docs:sync
└── docs/                           # Served end-user guide
    ├── index.md
    ├── persons/index.md
    ├── documents/
    │   ├── index.md
    │   ├── upload-a-document.md
    │   └── review-a-document.md
    ├── document-sets/index.md
    ├── reconciliation/index.md
    └── agent/index.md
```

The application remains at the Git/npm repository root. The user-guide scaffold
is initialized with the installed SDK's documented `application docs init`
workflow when feature implementation begins. The diagram shows the intended layout,
not files already created by this planning change.

## Documentation for every feature

Every implemented feature has an engineering contract and a verified user guide.
Engineering material stays in `engineering/`; served `/docs/` pages explain the
application in user terms and follow the actual navigation.

| Feature | Engineering documentation | User-guide tasks and states |
| --- | --- | --- |
| People | Reference-profile schema, permissions, assignment/version contract | Create/find a person, complete missing details, assign a document set. |
| Documents | Upload protocol, source access, schema forms, revisions, evidence and reviews | Upload, resume, inspect, correct, submit, accept/reject, resolve changed revisions. |
| Document Sets | Requirement alternatives, applicability, published versions | Understand accepted documents and why a requirement applies. |
| Reconciliation | Reason codes, status transitions, stale-result detection | Evaluate a case, interpret findings, resolve outstanding requirements. |
| Agent | AI package integration, supported context and authoritative refresh behavior | Start a conversation, interpret proposals, follow evidence, recover from interruption. |

Each guide records entry requirements, exact navigation, available actions, expected
results, meaningful empty/loading/error states, and recovery actions a user can
actually perform. Observe the implemented UI before writing those instructions;
do not publish planned features as available.

Use `documentation/navigation.json` as the ordered projection of the visible menu.
Generate `docs/SUMMARY.md` and the sidebars with `docs:sync`. Authored root content
is `docs/index.md`; task pages belong inside their owning feature folder. Follow
the SDK's `audience: end-user` and `home`/`section`/`feature`/`task` conventions.

## Delivery sequence and validation

1. Establish compatible SDK and AI package versions, root application shell, and
   the backend form/resource contracts. Record the chosen public package exports.
2. Implement people, documents, source upload/preview, and schema forms with
   incomplete-data and error handling. Add the corresponding guide pages.
3. Add assignments, revision-specific review, and reconciliation findings, with
   working next actions and stale-state handling. Document each workflow.
4. Integrate the backend's Main Sequence Tau Agent through Command Center AI and
   verify context, authorization, reconnection, cancellation, and result refresh.
5. Complete the Static Site workflow, environment bindings, combined app/docs
   artifact, and operational runbook.

Validation includes schema-form examples for all ten document types, dates and
decimals, nested arrays, field descriptions, draft preservation, authorization
failures, stale review conflicts, source upload interruption, and a full onboarding
scenario using the backend's authoritative result.

With the docs toolchain implemented, run `docs:sync`, `docs:check`, the application
build, type checks, focused workflow tests, SDK theme checks, and production-artifact
browser verification. Check the built app, `/docs/`, all navigation entries, a
nested guide URL loaded directly, app/help links, narrow layout, and supported
light/dark themes. Both `dist/index.html` and `dist/docs/index.html` must exist.

The first complete scenario is a reviewer opening a person, assigning new-account
requirements, uploading evidence, correcting attributes, accepting a revision,
and seeing exactly which requirements remain. The agent must explain the same
stored findings and link to the same evidence.
