# Back Office assistant right rail

Status: frontend implemented with Command Center SDK 0.5.18 and Command Center AI
0.0.16 on 2026-10-19. The API's ADR 0002 owns the read-only Back Office Agent.
Local chat was verified through the SDK proxy with a real GPT-5.6 Luna response.
Hosted conversation verification still awaits that Agent and its discovery endpoint.

File-support release check on 2026-10-19: upgraded AI from 0.0.15 to the published
0.0.16 and TAU SDK from 2.0.19 to 2.0.20. SDK 0.5.18 remains latest, and
`application update-sdk --dry-run` proposes no SDK change. AI 0.0.16's changelog
states that its attachment ADR 018 is documentation only and no attachment feature
ships. Its composer still exposes no file input; TAU still extracts text only and
has no attachment upload route.

Local verification used the real application, SDK proxy and upgraded Tau runtime.
Text chat returned `LOCAL SDK CHECK OK`. A synthetic file-only payload returned
HTTP 400 (`Request does not contain a user message`); a text-plus-file request
returned `NO ATTACHMENT CONTENT`, and the file's token was absent from history.
Application checks, the combined app/docs build and both assistant browser suites
passed. Attachments remain unavailable pending the package-owned capability,
upload/reference/history contracts and composer implementation described in ADR 018;
the application keeps the package-owned composer and transport.

Top-level loopback development uses `createLocalAgentSource` and the SDK's
`localAgentProxy` at `/__agent__`, targeting Back Office Tau on port 28643 (or
`MAINSEQUENCE_TAU_LOCAL_ORIGIN`). It skips hosted discovery and platform sessions;
the SDK owns local readiness, streaming, session history and the model picker.
Provider settings follow the engine's capabilities. Local business MCP binding and
verified-requester authorization remain required before case queries can work.

## Current integration decision

| Input | Application decision |
| --- | --- |
| Purpose | Explain a case's pinned document set and missing requirements using ADR 0002's read-only agent. |
| Deployment | Static site embedded in Command Center; explicit loopback Vite development transport. |
| Surfaces | Package launcher, resizable right rail, expanded `/agent` page and session explorer over one engine. |
| Placement | Dock from 1400px; overlay below; width is retained above the conditional rail mount. |
| Agent and Environment | One authenticated `/assistant/context` response from the Back Office API. |
| Default session | Stable `backoffice_assistant` handle, scoped by the package to person and Agent. |
| Platform sender | SDK iframe `sendPlatformRequest`; local Vite `platformRequestProxy` only in development on loopback. |
| Runtime transport | Package-owned runtime access and streaming to its authorized runtime URL. |
| Model providers | Package settings inside the conversation, with the same connection, person and Environment. |
| Context | Route-derived record references only; retained when the conversation expands. |
| Notifications | Visible status/error notices with a dismiss control. |
| Guidance | `mount-agent-conversation`, `compose-command-center-ai-rail`, `manage-agent-sessions`, `manage-model-providers`, and `connect-command-center-ai-to-the-platform`. |

The application does not select a different Agent when discovery fails. Missing,
denied or malformed configuration leaves the assistant unavailable while the
business screens remain usable. All business authority remains in the API's MCP
checks. The initial read-only agent needs no mutation-driven record invalidation.

## API integration contract

Implement authenticated `GET /assistant/context` alongside ADR 0002. Return:

```json
{"environmentUid":"<API Environment UUID>","agentUid":"<Back Office Agent UUID>"}
```

Resolve both values server-side in the API's own Environment, including access
to the current deployed Agent; never use the person's selected host Environment.
Return an explicit unavailable error when no compatible Agent exists. No browser
build value contains either UID. The frontend resolves the endpoint on opening
the assistant, explicit retry and network reconnection. This contract applies to
the hosted source; local development selects its same-origin Tau source explicitly.

`src/assistant/connection.ts` owns discovery and the authenticated platform sender.
`src/assistant/Assistant.tsx` owns the single provider, rail, expanded page,
context and navigation. `src/assistant/assistant.css` places the package surfaces
without recreating their chrome. `tests/assistant.mjs` uses the published package's
scripted platform/runtime through the actual SDK iframe bridge in test code only;
it is absent from production bundles. `tests/assistant-local.mjs` verifies the local
source through the actual Vite proxy, including reload history and proxy guards.

The remaining sections retain the broader delivery plan. Backend agent rollout,
live Environment verification and any future write tools remain separate work.

## Outcome and placement

Reviewers can ask the Back Office assistant about the person, assignment,
document revision, or reconciliation finding they are viewing without leaving
their work. Use the package's `ChatLauncher`, `ChatRail`, and `ChatThread`.
Keep the proposed Agent navigation destination as an expanded conversation at
`/agent`, using `ChatPageLayout` and its session explorer.

The Command Center host keeps ownership of global navigation and branding.
Choose a single depth-one application navigation panel for People, Documents,
Document Sets, Reconciliation, and Agent; the assistant is an adjacent surface,
not another navigation level. Mount the entire ready shell only after the
existing planned host → delegated API → application readiness gate succeeds.

| Viewport | Conversation presentation |
| --- | --- |
| At least 1400px wide | Docked right rail; content shrinks using `minmax(0, 1fr) auto`. |
| Below 1400px | Overlay rail; main content keeps its width. |
| Phone, including 375 × 812 | Package overlay, constrained to the viewport; composer and close/expand actions remain reachable. |

Keep the package's initial width of 540px and its 360–900px resize bounds.
Store preferred width above the conditional rail mount so closing and reopening
preserves it; let the package constrain the rendered width on smaller screens.
Use pointer and keyboard resizing. Load SDK styles first, then AI styles; use
the host theme and package frame without recreating its chrome.

## Dependencies and backend contract

1. Recheck the AI package's public exports and peer ranges before implementation.
   Version 0.0.16 accepts SDK `^0.5.3` and React/React DOM `>=18 <20`, which
   includes the installed SDK 0.5.18 and React 19. Install one compatible AI
   package, refresh its packaged skills with `command-center-ai skills install`,
   and use `command-center-sdk code-repository sync` to refresh the root lockfile.
   Command Center AI 0.0.16 is now pinned beside SDK 0.5.18; its packaged skills
   and the root lockfile have been refreshed.
2. Implement and deploy the backend's repository-owned `ms-tau-sdk` reconciliation
   agent, business REST/MCP operations, and readiness contract. Reuse the backend
   plan's permissions and review restrictions. Declare API access to the agent
   through its workflow and verify same-Environment discovery.
3. Add an authenticated application endpoint, proposed as `GET /assistant/context`,
   returning `{ environmentUid, agentUid }` from runtime configuration and the
   backend branch's current deployed Agent. Return an explicit unavailable state
   when the agent is absent. Resolve this on startup and reconnect; do not compile
   Agent or Environment UIDs into the browser build or use the host's currently
   selected Environment. Recreating the Agent must require no frontend rebuild.
4. When the business API is ready, bind its workflow resource by repository/key
   in the site's public `build_environment`. Verify delegated access and the API's
   stored CORS policy against the site's backend-returned origin. The initial
   static starter deployment has no business API binding.

## Frontend implementation

Add these application-owned modules with the shell milestone:

| Module | Responsibility |
| --- | --- |
| `src/assistant/Assistant.tsx` | One provider; launcher, responsive rail, expanded page, sessions, notifications and route-derived references. |
| `src/assistant/connection.ts` | Shared backend connection, authenticated discovery and local viewer verification. |
| `src/assistant/assistant.css` | Application placement around the package-owned surfaces. |
| Future write-tool integration | Refresh authoritative records only after confirmed completed business mutations. |

Supply the connection's `sendPlatformRequest` through the SDK iframe client's
`sendPlatformRequest`. Pass `auth: { userUid }` from the trusted identity;
the child holds no platform token. For explicit top-level local development,
add the SDK's `platformRequestProxy()` to Vite and use `/__mainsequence__`
only under `import.meta.env.DEV && window.parent === window`. Obtain local
identity from that proxy's `/api/v1/users/me/`. Preserve the existing `/api`
business proxy. Never ship developer credentials or turn this into a hosted
authentication fallback. The AI package owns runtime access, streaming and
runtime credentials.

Use the stable default session handle `backoffice_assistant` for the signed-in
person and current Agent. Keep a single engine alive while switching surfaces;
set `isVisible` when either surface is visible. `onRequestVisible` opens the
rail when session/model selection needs attention. Supply notifications,
viewer identity, application copy, and the package's model-provider settings.

Expand stores the current path, query and hash, closes the rail, and navigates
to `/agent?session=<id>`. Minimize restores that location and reopens the rail.
The expanded route never renders a second rail. Closing hides the surface;
explicit Stop uses the engine's cancellation action. Let the engine own session
selection/removal and expose stale or unauthorized session failures truthfully.

Send only supported record references in `viewContext`: selected person UID,
assignment UID, document UID plus revision, and evaluation UID/version. Update
them on navigation without replacing the engine or silently starting a new
session. Display which case the context describes; omit raw documents and
unnecessary personal information. Context is advisory, never authorization.

The assistant may explain requirements and evidence, propose corrections, and
initiate permitted processing/evaluation. It cannot accept or reject documents
in the first release. Use backend permission checks for every operation.
After confirmed tool mutations, invalidate the affected person, document,
assignment and reconciliation queries; resolve conflicts by fetching the latest
revision. Never treat assistant prose as an authoritative business update.

## Delivery and acceptance

1. **Backend readiness:** implement the context endpoint and agent prerequisites;
   verify absent-agent, denied-access, recreated-agent and Environment isolation.
2. **Engine and rail:** implement the connection/provider, launcher and responsive
   rail. Verify on the package's scripted stand-in before live-agent testing.
3. **Expanded route and context:** wire the Agent destination, session URL,
   return location, evidence links, context and post-mutation refresh.
4. **Documentation and release:** write `docs/agent/index.md` against observed UI,
   update the actual navigation manifest and operations guide, and deploy through
   the existing static-site workflow after the combined application/docs build.

Acceptance checks cover:

- 1440 × 900 docked, 1280 × 800 overlay, and 375 × 812 phone layouts in light
  and dark themes; no horizontal overflow or obscured composer/actions.
- Drag, keyboard arrows/Shift-arrows/Home/End, minimum/maximum and double-click
  width reset; docked content follows the actual rail width.
- Expand/send/minimize retains the same conversation and restores path/query/hash;
  session switches, new sessions, deletion and browser navigation stay consistent.
- Loading, no Agent, model selection, permission denial, offline/reconnect,
  expired access, interruption, queued input, cancellation and tool failure.
- Context follows record/revision changes, users cannot cross case permissions,
  accepted/rejected state cannot be changed by the assistant, and completed
  authorized mutations refresh records and flag stale reconciliation results.
- Startup/reconnect shell conformance, keyboard focus on open/close, accessible
  names and resize controls, production build, theme audit, and focused browser
  tests using both the scripted stand-in and an authorized deployed Agent.

Package guidance used: `compose-command-center-ai-rail`,
`mount-agent-conversation`, and `connect-command-center-ai-to-the-platform` from
Command Center AI 0.0.16, plus the installed SDK application-shell and iframe
skills. Re-read the installed versions when implementing.
