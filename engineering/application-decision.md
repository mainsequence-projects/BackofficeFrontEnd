# Back Office implementation decision

The application manages people, assigned document requirements, source uploads,
revision-specific document review and reproducible reconciliation findings.
Production runs only inside Command Center. Standalone mode is enabled explicitly
for local development and browser tests, using the existing loopback API gateway.

Use depth-one `ApplicationNavigationPanelShell` with People, Documents, Document
Sets and Reconciliation destinations. Person and document detail sections use
`ResourceDetailShell`. Collections use `ResourceListPage`; forms and actions use
SDK controls; page composition uses SDK layout. The host owns global chrome.

Startup verifies host context/theme, delegated transport through `/me`, and `/readyz`
with its storage/catalog checks. A context identity change or authorization loss
unmounts the shell and restarts readiness. Obsolete requests are aborted. Transient
local startup failures retry up to three times. Hosted transport uses the SDK's
bounded retries; terminal failures expose manual Retry.
The application consumes the host theme and uses closed SDK semantic tokens.

The existing Pydantic models and MetaTables are authoritative. The API adds shared
business services and parameterized MetaTables operations. Case creators own their
records; explicitly configured reviewers can access/review cases. Browser-supplied
identity never authorizes operations. Immutable schema/policy publication happens
in the explicit migration/bootstrap command. Application startup never migrates.

The first usable release supports the complete manual review workflow. OCR/model
extraction and the Tau assistant retain their separate prerequisite milestones;
their absence must never be represented as a working extraction/chat button.
The existing assistant plan remains the implementation contract for that milestone.
User documentation ships at `/docs/` in the same artifact and describes verified UI.
No sample records are populated in production.
