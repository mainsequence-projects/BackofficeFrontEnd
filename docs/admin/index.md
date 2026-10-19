---
title: Admin
description: Configure classification-confidence thresholds for automatic document acceptance by document type.
audience: end-user
pageType: feature
---

# Admin

Set the extractor's classification confidence required to accept a document
automatically, separately for each document type in this Back Office environment.

## Open this page

Choose **Admin** in Back Office. This entry and its settings are available only
to organization administrators. Reviewer access alone does not grant access.

## What you can do

Choose a **Document type**, enable or disable **Automatic acceptance**, set its
**Acceptance threshold (%)**, and save a new policy version.

## Common tasks

1. Choose **Document type**, then choose **Automatic acceptance on**.
2. Enter **Acceptance threshold (%)**, from 0 to 100 with up to two decimal places.
3. Select **Save parsing settings** and wait for **Parsing settings saved.**
4. To require human review for all new parsing results of this type, choose
   **Automatic acceptance off** and save again.

## Understand what you see

A score is the extractor's confidence in the document's classification, expressed
as one percentage per document. It is not a measure of attribute completeness.
A score equal to or above the saved threshold can automatically accept the exact
document revision. For example, a 60% passport threshold accepts a 60% score and
sends a 59.99% score for review. Required attributes and source evidence must also pass
validation. Missing scores, incomplete attributes and missing evidence need review
regardless of the score. Existing review decisions are never overwritten by parsing.

Automatic acceptance starts off for each type until an administrator configures
its policy. A passport policy does not apply to any other type. Save changes
before switching types; switching loads that type's saved settings. Each save
creates a new policy version for the selected type. Changes apply to later parsing completions; previous
results keep their recorded policy and decision. The document's **Parsing result**
shows its score, threshold, policy version and outcome when a result exists.

These settings apply when a parsing process reports a result. Uploading or manually
editing a document does not create a parsing score or automatically approve it.
The initial application does not run OCR or a parser when you save these settings.

## If something goes wrong

If access is denied, ask an organization administrator to manage the setting.
If another administrator changed the policy, keep your entered values, select
**Reload saved settings**, compare the latest version and save the intended change.
For an interrupted save, use **Check again** or **Resume and reload** before starting
another change. If settings cannot load, retry after the document service is ready.
