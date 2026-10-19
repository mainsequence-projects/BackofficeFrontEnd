---
title: Documents
description: Preserve original evidence, complete document attributes, and record revision-specific reviews.
audience: end-user
pageType: feature
---

# Documents

Keep the original evidence beside its structured attributes and record an
explicit review decision for the exact revision you checked.

## Open this page

Choose **Documents** and select a **Person**, or open a person's **Documents**
tab from **People**. Preparing evidence is available to the case owner;
accepting or rejecting a submitted revision requires reviewer access.

## What you can do

Upload a PDF, PNG, JPEG, or text source up to 10 MiB. Reuse an existing verified
source, select the document type, complete its attributes, preserve incomplete
drafts, submit a completed revision, and review its evidence.

## Common tasks

1. In **Add a document**, choose the **Document type** and a **Source file**.
   You can instead choose an existing source when no new file is selected.
2. Select **Create document**. Upload progress and source verification finish
   before the document detail opens.
3. In **Attributes and source**, compare the original source with the attributes.
   The form explains each field. Use the add controls for addresses, amounts,
   repeated entries, and other structured details.
4. Select **Save draft revision** to retain incomplete work, or **Submit for
   review** when the required information is complete.
5. An authorized reviewer opens **Review** and selects **Accept revision** or
   **Reject revision**. **Review comments** are optional; leaving them blank does
   not prevent the decision from being submitted.

Use **Download source** to retain a copy of the verified original. The same
document can be linked to an assignment under the person's **Requirements** tab.

## Understand what you see

Portrait references and face comparison are planned for V2 and are absent from
V1 forms and completion requirements, including forms for older documents.
Original source files remain available to read.

Document attributes are editable inputs. Missing required values have a red border, which clears when you supply a value. Empty optional fields are yellow and labelled “Optional — not provided”; they do not prevent completion. You can save incomplete drafts; submission applies the document's required-field rules. The case review workspace provides the same editing controls under **Document fields**.

Submission and review are separate. A draft can be incomplete. Submission
validates required information and freezes that revision. A pending review means
no decision is recorded for that revision. Acceptance applies only to the
reviewed revision. Saving a correction creates a new draft that requires its own
submission and review.

Leave optional information blank when it is not printed. For example, an identity
card does not need an issue date; a newly created payslip can omit gross pay while
still recording net pay and its currency. New documents also allow an absent
utility category, permit category, loan contract number or employer income basis.
External questionnaires can omit an outflow estimate, completion time and form
version. Never enter zero or invent a date to make a document complete.

The accepted happy-case examples determine which information is obligatory. A
new national identity card can omit issuing country and a separate validity category;
its expiry date still supports the validity check. A bank statement can omit bank
name and a separate account currency, but any amount you enter still needs its
currency. A tax certificate can record the authority's arrears statement without
requiring a duplicate word-for-word transcription. Missing validity evidence
still needs resolution, and absent tax wording never means the person has no debt.

New documents use the latest available requirements. Existing documents retain
the requirements under which they were created; recreate an older draft to use
the relaxed fields. Case requirements are evaluated separately: an undated
questionnaire can be submitted but cannot satisfy a case that requires a recent
completion date. Existing cases keep their selected Document Set version until
explicitly upgraded.

An evaluation's **View revision** action opens the exact retained attributes,
source, and recorded review used for that result. This view is read-only. Select
**Open latest revision** to prepare a correction or a new decision.

Identifiers retain leading zeros. Amounts retain their entered precision.
Source files are checked for size, completeness, and integrity before use.
Choose **Extract from source** for a PDF, PNG or JPEG to classify and extract its
attributes through Back Office. This uses the same document and review workflow
for every document set; the selected document type only affects manual creation.
Upload one logical document per file. A package containing multiple document types
requires separate files before processing can continue.

The **Document processing** panel shows progress and offers **Review extracted
document** when complete. Keep its URL to return after leaving the page. Use
**Retry processing** for a failed job. A **Needs input** result requires attention
to the source before starting new work.

Open **Extraction evidence** to inspect each reader's values, agreement and cited
pages for the selected revision. **Page** buttons open the preserved source. Manual
revisions without extraction evidence say so; corrections never inherit the old
revision's citations. Extraction alone does not grant acceptance; the recorded
Back Office policy and review determine the result.

## If something goes wrong

For an interrupted upload, reselect the same file and retry **Create document**
in the same browser session. Missing chunks resume without replacing verified
content. If integrity verification fails, check the source file before retrying.

Validation messages name fields needing attention; entered attributes stay visible.
For a changed revision, select **Reload latest** before reviewing or editing it.
If review controls are unavailable, submit the draft or ask an authorized reviewer.
Use **Resume and reload** when an interrupted change needs recovery.

## Document and evidence dates

The **Document dates** panel shows when the document was first recorded, when the
selected revision was recorded and submitted, and when it was last reviewed.
These timestamps are recorded by the service and displayed in your local timezone.
An unsubmitted draft says **Not submitted**; retained revisions show their own dates.

The original evidence's issue date or completion date remains in its attributes.
It is different from the upload/recording timestamp. Re-uploading an old bill or
reviewing it again does not make it fresh. Check **Current requirements and
renewals** on the person's Requirements tab for policy-specific deadlines.
For a review renewal, open **Review document**, inspect the evidence, and record a
new acceptance with a reason. An expired or stale source still needs replacement.
