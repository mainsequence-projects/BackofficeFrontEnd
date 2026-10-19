---
title: Reconciliation
description: Evaluate assigned evidence and follow precise findings to resolve outstanding requirements.
audience: end-user
pageType: feature
---

# Reconciliation

See which assigned requirements are satisfied and which documents or reference
details still need attention.

## Open this page

Choose **Reconciliation** and select a **Person** and **Assignment**. You can
also open it with **Evaluate requirements** on the person's assignment.

## What you can do

Run a fresh evaluation, inspect individual findings, open referenced document
revisions, and review retained evaluation history.

## Common tasks

1. Under the person's **Requirements** tab, link the evidence you want evaluated.
2. Choose **Evaluate requirements**, or use **Run fresh evaluation** here.
3. If **Evaluation processing** appears, wait for completion and select **View evaluation**.
   Keep this page's URL to return to the same processing run after a reload.
4. Read **Requirement findings**. Open **View revision** to inspect evidence.
   Use **Complete reference profile** or **Add supporting evidence** when offered.
5. Submit or review corrected documents, then run a fresh evaluation.
6. Open a row in **Evaluation history** to inspect a retained result.

## Understand what you see

- **Satisfied**: enough distinct, qualifying evidence meets the requirement.
- **Missing**: required evidence is absent or the distinct count is insufficient.
- **Failed**: evidence conflicts with the reference information or fails a rule.
- **Pending review**: an authorized reviewer still needs to decide on the revision.
- **Needs information**: required attributes or applicability information are missing.
- **Not applicable**: the policy condition does not apply to the person.

The result identifies the policy version, profile revision, assignment revision,
and evaluation time. **Out of date** means the case changed after evaluation.
Completion requires every applicable mandatory requirement to be satisfied.

## If something goes wrong

If no assignment is available, choose **Assign document requirements**. If the
result is out of date, choose **Run fresh evaluation**. If evaluation reports a
changed assignment, reload the current case before trying again. A failed or
interrupted evaluation never means the case is complete; follow the displayed
recovery action or use **Resume and reload**.

## Current status and renewal reminders

**Current requirements and renewals** checks evidence against today's UTC date
when opened, when the window regains focus, and every minute while open. It is
also available on the person's Requirements tab. Use its reload control for an
immediate check. Missing or failed checks remain visible rather than showing a
previous successful result as current.

Each evidence reference can show **Evidence dated**, **Fresh through**,
**Expires on**, **Renewal due on**, and the next action date. **Due soon** means
within 30 days; **Due today** and **Overdue** require action. A still-valid
alternative can satisfy a requirement even when another document needs renewal.
These are in-app reminders; no email or background notifications are sent.

Saved evaluations remain historical snapshots. Their dates and findings do not
change after a new review. An **Out of date** badge means that evidence, reviews,
the evaluation date, or evaluation rules have changed; run a fresh evaluation
to retain a new audit result.

## Cross-document comparisons

For comparison-enabled policies, **Cited cross-document comparisons** shows the
retained values, context, source pages and exact revisions side by side. The parser
reports observations and uncertainty; Back Office determines the finding using the
assigned policy. **Page** opens the checksum-verified source, and each revision link
opens its read-only record. Completing the checks is not loan or account approval.

Use **Retry processing** after a failed job. If inputs changed during processing,
the result requires a fresh evaluation. An old successful report cannot stand in
for changed evidence. Current status reads retained comparisons; it does not launch
new work. Reviewed documents without cited extraction remain unresolved when a
comparison requires that evidence.
