# Admin parsing policies

The `/admin` destination uses Command Center SDK navigation, layouts and controls.
It is visible only when REST `/me` reports `is_organization_admin === true`. The
route also checks this fact before mounting any settings reader. Reviewer access
does not grant Admin access. The API independently authorizes all policy reads
and writes; hiding navigation alone is not an authorization boundary.

The canonical `/document-types` catalog supplies the type picker. Each type has
an independent, versioned policy with no global fallback:

- `GET /admin/parsing-settings?document_type=passport`
- `PUT /admin/parsing-settings` with `document_type`, `expected_revision`,
  `automatic_acceptance_enabled`, `acceptance_threshold_percent` and the existing
  operation key from `api.command`.

Responses identify `document_type` and `score_kind: classification_confidence`.
The UI rejects a mismatched type or score kind, resets form state when changing
type, and disables switching while saving. An unconfigured type starts at
revision 0 with automatic acceptance off. Percentages are submitted as decimal
strings, 0–100 with at most two decimal places. A 409 preserves entered values
and offers an explicit reload of the latest saved policy. Interrupted writes use
the shared operation recovery flow.

A trusted parsing completion reports one classification-confidence percentage per
document. Its actual document type selects the policy. At or above the threshold,
the backend may accept the exact revision only after canonical attributes and
finalized source evidence pass validation. Lower or missing confidence, missing
policy, disabled acceptance or failed validation needs review. A previous human
decision cannot be overwritten. The document screen displays the retained score,
threshold, policy version and outcome for the selected revision. Policy changes
are prospective. Uploading or editing a document does not run an extractor.

`tests/admin.mjs` verifies the UI against an explicitly identified disposable
local SQLite source: independent saved policies, reload, concurrent edits,
inclusive acceptance, below-threshold review, exact revision display and phone
layout. It also verifies that nonadmins, including reviewers, cannot see Admin
navigation or trigger settings reads through a direct URL. Role enforcement and
processor isolation are separately covered by backend API tests.

Run with an owned private development stack, never the shared developer source:

```sh
BACKOFFICE_TEST_URL=http://127.0.0.1:15174 \
BACKOFFICE_TEST_SOURCE_UID=fe037dd5-c954-5ea2-aaba-c3e1aa3c3a5b \
node tests/admin.mjs
```

Verified locally on 2026-10-19 against that exact private SQLite source at
`backoffice_0004`. UI saves retained independent passport 60% and utility bill 90%
policies. Concurrent edits returned 409 and explicit reload recovered. Real
completion accepted 60.00%, sent 59.99% and missing confidence for review, and
preserved the original result after a policy change and a new draft. Nonadmin and
reviewer direct-route checks made no settings reads; the 390px layout fit without
horizontal overflow. Results and screenshots are written to
`.local/admin-results/`. Frontend checks, the full app/documentation build and all
seven local guide routes passed. The coordinated backend suite passed 186 tests
with the pinned helper contract unchanged.

The same provider was then applied to the verified shared **local** SQLite source
`b3416a7c-8f80-5cc4-bd25-b07ff8f96018`, without restarting its services or adding
fixtures or policies. Chrome verified the real `http://127.0.0.1:5174/admin`
screen and its unconfigured passport policy. No hosted verification or deployment
was performed.
