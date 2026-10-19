# Back Office assistant right rail

Status: implementation plan, verified against Command Center SDK 0.5.18 and
the published Command Center AI 0.0.15 package on 2026-10-19. The rail is not
implemented. The backend business API and Tau agent are prerequisites.

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
   Version 0.0.15 accepts SDK `^0.5.3` and React/React DOM `>=18 <20`, which
   includes the installed SDK 0.5.18 and React 19. Install one compatible AI
   package, refresh its packaged skills with `command-center-ai skills install`,
   and use `command-center-sdk code-repository sync` to refresh the root lockfile.
   No dependency is added by this plan.
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
| `src/app/providers.tsx` | One `ChatEngineProvider` above routes and both assistant surfaces. |
| `src/features/agent/connection.ts` | One `createChatBackendConnection` shared with provider settings. |
| `src/features/agent/AssistantRail.tsx` | Launcher, responsive rail, controlled width, close and expand. |
| `src/features/agent/AssistantPage.tsx` | Expanded page, session URL selection, minimize and return location. |
| `src/features/agent/context.ts` | Small, typed, JSON-safe business context derived from the selected record. |
| `src/features/agent/refresh.ts` | Refresh authoritative records affected by confirmed completed tool mutations. |

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
Command Center AI 0.0.15, plus the installed SDK application-shell and iframe
skills. Re-read the installed versions when implementing.
