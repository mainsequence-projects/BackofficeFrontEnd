---
title: Document Sets
description: Understand a published policy's requirements, evidence alternatives, and applicability conditions.
audience: end-user
pageType: feature
---

# Document Sets

Understand which evidence a published policy requires before assigning it to a person.

## Open this page

Choose **Document Sets** and open a document set by its name. You can also
select **View requirements** on a person's case.

## What you can do

Inspect the published version, mandatory requirements, accepted document
alternatives, minimum distinct counts, validity rules, age limits, and conditions.

## Common tasks

1. Open **New account requirements** and read its description.
2. Check each requirement's alternatives and whether it applies to the person.
3. Return to **Subjects**, open the person's **Requirements** tab, choose a
   **Case type** and permitted **Document Set version**, then select **Create case**.

The initial policy is illustrative. Review its age limits and evidence choices
with your organization before using it for business decisions.

## Understand what you see

An alternative means one qualifying document type can satisfy that requirement.
A minimum count may require several distinct documents or reporting periods;
uploading duplicate evidence does not increase the qualifying count.

Conditional requirements apply only when the reference profile meets the stated
condition. Missing information produces a finding asking for clarification.
An existing case does not silently move to another published version.
Published versions are read-only. Organization administrators can create a new set or use a published set as a template.

## If something goes wrong

If a policy is unavailable, use **Document Sets** to inspect available published
versions. If you are unsure whether a condition applies, complete the person's
reference profile and run a fresh evaluation. Ask your policy owner to resolve
an unsuitable requirement; do not substitute fabricated evidence.

## Freshness and periodic renewal

A requirement accepts any qualifying alternative; identity can be satisfied by a
passport or national identity card. Check the version in the list and on the
case: existing cases retain their original version.

Version 1 retains its original 90-day address rule. Version 2 accepts address
evidence and completed questionnaires up to six calendar months old, and requires
identity evidence to be reviewed again every six calendar months. These are
illustrative policy choices, not universal legal requirements.

Freshness measures the age of the evidence from the named issue, statement-end,
or completion field. Uploading a file or accepting it again does not reset that
age. Datetime fields use their UTC calendar date. Evidence qualifies through the
age-limit date and needs replacement the next day.

Periodic renewal is separate. A rule may require another review measured from
the latest accepted review, or a new submitted revision measured from submission.
Renewal is due on the anniversary, so evidence no longer qualifies on that date.
Six calendar months is not 180 days: August 31 plus six months is February 28
(or February 29 in a leap year).

Select an accepted document in the tree to see its age basis, additional fields and renewal interval. Published versions retain their original rules.

## Cross-document checks

Policies that include comparisons show a **Cross-document checks** branch in the tree. It names
the two document fields, the comparison method, whether the check is mandatory,
and any numeric tolerances. Those rules are applied by Back Office.

Loan requirements version 2 and new account requirements version 3 include
illustrative comparison rules. Choose the published version explicitly when
assigning it. Existing cases keep their selected version. Loans and new
accounts use the same processing, review and evaluation screens.

## Explore the requirement tree

Requirements appear as compact rows on the left. Expand a requirement to see the
document types it accepts, then select a document to inspect its exact schema,
additional required fields, validity and renewal rules on the right. Select a
requirement to see its applicability and minimum distinct document count.

Use **Find a requirement or document**, **Expand all** and **Collapse all** to
navigate a large set. Cross-document checks open their two field selectors,
comparison method, applicability and tolerances in the same detail area.

## Create a document set

Organization administrators see **New document set** in the list and detail page.
**Use as template** copies all requirements and checks into a new set.

1. Enter a name, unique permanent identifier and description. Choose the case
   types allowed to use the set and whether documents may satisfy several requirements.
2. Select **+ Requirement**. Set its name, purpose, minimum count and applicability.
3. Expand the requirement and select **+ Accepted document** to add alternatives.
   Select each document to configure its schema, extra required fields, date
   limits and periodic renewal. Field choices come from its canonical schema.
4. Optionally select **+ Check** to configure a cross-document comparison. Choose
   both document fields, context and currency fields, the method and tolerances.
5. Select **Create document set** to validate and publish version 1. Errors keep
   your entries available for correction. The new set is available for the
   selected case types and opens in the same tree for inspection.

A new identifier is required even when using a template. Creating a set never
replaces an existing published definition or changes an existing case. Reviewer
access alone does not permit creation; the API requires organization admin access.
