// Real UI and SDK, controlled synthetic API responses. No production records.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";
import {
  assertCommandCenterPageLayout,
  COMMAND_CENTER_LAYOUT_VIEWPORTS,
} from "@dev-mainsequence/command-center-sdk/layout/testing";
const backend = resolve(
  "../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118",
);
const policies = await Promise.all(
  ["loan_requirements.v2", "new_account_requirements.v3"].map(async (name) =>
    JSON.parse(
      await readFile(
        resolve(backend, `schemas/document_sets/${name}.json`),
        "utf8",
      ),
    ),
  ),
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = id(101),
  colleague = id(102),
  subject = id(1),
  assignment = id(2),
  left = id(3),
  right = id(4),
  run = id(8);
const caseTypes = policies.map((p, i) => ({
  key: i ? "account_opening" : "new_loan",
  name: i ? "Account opening" : "New loan",
  description: "Business case type",
  document_sets: [{ key: p.key, version: p.version, name: p.name }],
}));
const output = resolve(".local/casework-verification");
await mkdir(output, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  server: { port: 15191, strictPort: true, hmr: false },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
page.setDefaultTimeout(12000);
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let policy = policies[0],
  stale = false,
  assigned = false,
  memberRevision = 0,
  reviewed = false,
  canReview = true;
let editRevision = 2,
  editedPayload,
  editingDraft = false,
  rejectEdit = false;
const fieldSchema = {
  type: "object",
  required: ["full_name"],
  properties: {
    document_type: { type: "string", const: "loan_contract" },
    full_name: { type: "string", title: "Full name" },
    issue_date: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
      title: "Issue date",
    },
    dependents: { type: "integer", title: "Dependents" },
    verified: { type: "boolean", title: "Verified" },
    category: {
      type: "string",
      title: "Category",
      enum: ["current", "expired"],
    },
    note: { type: "string", title: "Note" },
    address: {
      type: "object",
      title: "Address",
      properties: { city: { type: "string", title: "City" } },
    },
  },
};
const sourceBytes = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="white"/><g fill="#182434" font-family="sans-serif"><text x="45" y="40" font-size="10">SYNTHETIC TEST DOCUMENT · No real customer information</text><text x="45" y="115" font-size="20" font-weight="bold">EMPLOYMENT AND INCOME</text><text x="45" y="145" font-size="14">Confirmation of monthly net income</text><rect x="45" y="195" width="510" height="320" fill="#f3f5f7" stroke="#83909c"/><text x="65" y="228" font-size="12">Employee</text><text x="65" y="258" font-size="19">Eva Horáková</text><text x="65" y="310" font-size="12">Employer</text><text x="65" y="340" font-size="18">Example Energy s.r.o.</text><text x="65" y="395" font-size="12">Monthly net income</text><text x="65" y="432" font-size="25" font-weight="bold">41 000,00 CZK</text><text x="65" y="485" font-size="12">Issued 25 September 2026</text><rect x="330" y="590" width="225" height="100" fill="none" stroke="#83909c"/><text x="345" y="615" font-size="11">Employer signature</text></g></svg>`,
);
const sha = createHash("sha256").update(sourceBytes).digest("hex");
const citation = (doc) => ({
  source_id: id(doc === left ? 5 : 6),
  source_sha256: sha,
  page_sha256: "b".repeat(64),
  page: doc === left ? 1 : 2,
});
const members = () => ({
  items: [
    { reviewer_uid: colleague, display_name: "Marta · Operations" },
    ...(assigned
      ? [{ reviewer_uid: staff, display_name: "Carlos · Reviewer" }]
      : []),
  ],
  my_revision: memberRevision,
  assigned_to_me: assigned,
});
const fact = (doc, value) => ({
  document_id: doc,
  revision: 2,
  pointer: "/monthly_net_income",
  value,
  citations: [citation(doc)],
});
function observation() {
  return {
    key: "income_pair",
    explanation: "The readers identified different net income amounts.",
    left: fact(left, "56000.00 CZK"),
    right: fact(right, "41000.00 CZK"),
    context: [],
  };
}
function findings() {
  return [
    {
      uid: id(20),
      requirement_key: policy.comparisons[0].key,
      status: stale ? "pending_review" : "failed",
      mandatory: true,
      explanation: stale
        ? "Run current cross-document checks."
        : "The declared income differs from the employer confirmation outside the policy allowance.",
      next_action: "Resolve the income inconsistency, then run checks.",
      document_references: [
        {
          document_uid: left,
          revision: 2,
          comparison_key: "income_pair",
          pointer: "/monthly_net_income",
          value: "56000.00 CZK",
          citations: [citation(left)],
        },
        {
          document_uid: right,
          revision: 2,
          comparison_key: "income_pair",
          pointer: "/monthly_net_income",
          value: "41000.00 CZK",
          citations: [citation(right)],
        },
      ],
    },
    {
      uid: id(21),
      requirement_key: "identity",
      status: "missing",
      mandatory: true,
      explanation: "No identity document is linked to this requirement.",
      document_references: [],
      next_action: "Add an identity document.",
    },
    {
      uid: id(22),
      requirement_key: "income_document",
      status: "pending_review",
      mandatory: true,
      explanation: "Review the submitted employer confirmation.",
      document_references: [{ document_uid: right, revision: 2 }],
      next_action: "Inspect the income source.",
    },
  ];
}
function workspace() {
  const docs = [left, right].map((uid, i) => ({
    uid,
    person_uid: subject,
    document_type: i ? "employer_confirmation" : "loan_contract",
    schema_version: 1,
    revision: i ? editRevision : 2,
    status: i && editingDraft ? "draft" : "submitted",
    payload:
      i && editedPayload
        ? editedPayload
        : {
            document_type: i ? "employer_confirmation" : "loan_contract",
            full_name: "Eva Horáková",
            issue_date: null,
            dependents: 0,
            verified: false,
            note: "",
            address: null,
          },
    accepted: i === 0 || (reviewed && !editingDraft),
    review_status:
      i === 0 || (reviewed && !editingDraft) ? "accepted" : "pending",
    latest_review:
      i === 0
        ? { decision_sequence: 1, reason: "Verified source." }
        : reviewed
          ? { decision_sequence: 1, reason: "Checked cited source." }
          : null,
    raw_document_refs: [{ raw_document_uid: citation(uid).source_id }],
    evidence_summary: {
      pages: [
        {
          source_uid: citation(uid).source_id,
          source_sha256: sha,
          page: i + 1,
        },
      ],
      field_count: 4,
      has_evidence: true,
    },
  }));
  return {
    case: { uid: assignment, case_type: caseTypes[policies.indexOf(policy)] },
    assignment: {
      uid: assignment,
      person_uid: subject,
      set_key: policy.key,
      set_version: policy.version,
      revision: 2,
    },
    subject: {
      uid: subject,
      full_name: "Eva Horáková",
      external_reference: "SYN-LOAN-10569",
    },
    policy,
    documents: docs,
    status: {
      findings: findings(),
      summary: {
        mandatory_requirements: 3,
        satisfied_requirements: 1,
        complete: false,
      },
    },
    workflow_state: stale ? "review_required" : "discrepancy",
    reviewers: members(),
    page_count: 2,
    page_count_complete: true,
    latest_evaluation: {
      uid: id(9),
      assignment_uid: assignment,
      set_version: policy.version,
      person_revision: 1,
      created_at: "2026-10-19T12:00:00Z",
      stale,
      summary: { complete: false },
      findings: findings(),
      input_snapshot: {
        person: { full_name: "Eva Horáková" },
        policy,
        comparison_result: { observations: [observation()] },
      },
    },
    subject_history: {
      total_items: 3,
      items: [
        {
          uid: id(30),
          action: "document.reviewed",
          occurred_at: "2026-10-19T12:01:00Z",
          actor_uid: colleague,
        },
        {
          uid: id(31),
          action: "assignment.evaluated",
          occurred_at: "2026-10-19T12:00:00Z",
          actor_uid: staff,
        },
        {
          uid: id(32),
          action: "case.reviewer_changed",
          occurred_at: "2026-10-19T11:55:00Z",
          actor_uid: colleague,
        },
      ],
    },
  };
}
function queue(url) {
  let rows = Array.from({ length: 12 }, (_, i) => ({
    uid: i ? id(200 + i) : assignment,
    subject: {
      uid: i ? id(300 + i) : subject,
      full_name: [
        "Eva Horáková",
        "Petr Dvořák",
        "Lucie Černá",
        "Tomáš Procházka",
        "Martin Kučera",
        "Kateřina Veselá",
        "Pavel Novotný",
        "Lenka Pokorná",
        "Jiří Marek",
        "Alena Krejčí",
        "Ondřej Fiala",
        "Jana Nováková",
      ][i],
      external_reference: `SYN-${10569 + i}`,
    },
    case_type: caseTypes[i % 2],
    case_type_key: caseTypes[i % 2].key,
    set_key: policies[i % 2].key,
    set_version: policies[i % 2].version,
    document_count: 7 - (i % 3),
    summary: { satisfied_requirements: 4 - (i % 3), mandatory_requirements: 4 },
    finding_counts: {
      failed: i % 4 === 0 ? 1 : 0,
      pending_review: i % 4 === 1 ? 2 : 0,
    },
    reviewers: i % 3 ? [] : members().items,
    workflow_state: [
      "discrepancy",
      "review_required",
      "missing_evidence",
      "checks_satisfied",
    ][i % 4],
    top_finding:
      i % 4 === 3
        ? null
        : {
            requirement_key: [
              "income_comparison",
              "income_review",
              "identity_document",
            ][i % 3],
          },
    latest_evaluated_at: "2026-10-19T12:00:00Z",
  }));
  const q = url.searchParams;
  if (q.get("responsibility") === "mine")
    rows = rows.filter((r) =>
      r.reviewers.some((m) => m.reviewer_uid === staff),
    );
  if (q.get("responsibility") === "unassigned")
    rows = rows.filter((r) => !r.reviewers.length);
  if (q.get("case_type_key"))
    rows = rows.filter((r) => r.case_type_key === q.get("case_type_key"));
  if (q.get("search"))
    rows = rows.filter((r) =>
      r.subject.full_name.toLowerCase().includes(q.get("search").toLowerCase()),
    );
  const total = rows.length,
    offset = Number(q.get("offset") || 0);
  return {
    items: rows.slice(offset, offset + 10),
    total_items: total,
    has_more: offset + 10 < total,
  };
}
async function mockApi(route) {
  const req = route.request(),
    url = new URL(req.url()),
    path = url.pathname.slice(4);
  requests.push({
    path,
    query: url.search,
    method: req.method(),
    body: req.postData() ? JSON.parse(req.postData()) : undefined,
  });
  let result,
    status = 200;
  if (path === "/me") result = { user_uid: staff, can_review: canReview };
  else if (path === "/readyz") result = { status: "ready" };
  else if (path === "/person-schema")
    result = { type: "object", properties: {} };
  else if (path === "/document-types") result = { items: [] };
  else if (path.startsWith("/document-types/") && path.endsWith("/schema")) {
    assert.equal(url.searchParams.get("version"), "1");
    result = { canonical_schema: fieldSchema };
  } else if (path === `/documents/${right}/draft`) {
    assert.equal(req.method(), "PATCH");
    const body = req.postDataJSON();
    assert.equal(body.expected_revision, editRevision);
    assert.deepEqual(body.raw_document_refs, [
      { raw_document_uid: citation(right).source_id },
    ]);
    if (rejectEdit) {
      status = 409;
      result = { detail: "stale_document_revision" };
    } else {
      editedPayload = body.payload;
      editRevision++;
      editingDraft = true;
      stale = true;
      result = { uid: right, revision: editRevision };
    }
  } else if (path === `/documents/${right}/submit`) {
    assert.equal(req.postDataJSON().expected_revision, editRevision);
    editingDraft = false;
    result = { uid: right, revision: editRevision };
  } else if (path === "/document-sets") result = { items: policies };
  else if (path === "/case-types") result = { items: caseTypes };
  else if (path === `/persons/${subject}`)
    result = { ...workspace().subject, revision: 1 };
  else if (path === `/persons/${subject}/history`)
    result = workspace().subject_history;
  else if (path === `/persons/${subject}/documents`)
    result = { items: workspace().documents };
  else if (
    [`/persons/${subject}/cases`, `/persons/${subject}/sources`].includes(path)
  )
    result = { items: [] };
  else if (path === "/persons")
    result = { items: [{ uid: subject, full_name: "Eva Horáková" }] };
  else if (path === "/cases" && req.method() === "POST") {
    const body = req.postDataJSON();
    assert.equal(body.subject_uid, subject);
    assert.equal(body.case_type_key, "account_opening");
    assert.equal(body.document_set_key, policies[1].key);
    assert.equal(body.document_set_version, policies[1].version);
    result = { uid: assignment, revision: 1 };
    status = 201;
  } else if (path === "/cases") result = queue(url);
  else if (path === `/cases/${assignment}/workspace`) result = workspace();
  else if (path === `/cases/${assignment}/reviewers/me`) {
    assert.equal(req.method(), "PUT");
    const body = req.postDataJSON();
    assert.equal(body.expected_revision, memberRevision);
    assert.equal(body.reviewer_uid, undefined);
    assigned = body.assigned;
    memberRevision++;
    result = { revision: memberRevision };
  } else if (path === `/documents/${right}/reviews`) {
    const body = req.postDataJSON();
    assert.equal(body.expected_revision, 2);
    assert.equal(body.expected_decision_sequence, 0);
    assert.equal(body.reason, "Checked cited source.");
    reviewed = true;
    result = { uid: id(44) };
    status = 201;
  } else if (path === `/cases/${assignment}`)
    result = { uid: assignment, revision: 2 };
  else if (path === `/cases/${assignment}/evaluations`) {
    result = { processing_run_uid: run };
    status = 202;
  } else if (path === `/processing-runs/${run}`) {
    stale = false;
    result = {
      status: "completed",
      assignment_uid: assignment,
      evaluation: { uid: id(9) },
    };
  } else if (path.endsWith("/extraction-evidence"))
    result = {
      evidence: {
        classification: { pages: [{}] },
        extraction: {
          field_evidence: [
            {
              pointer: "/monthly_net_income",
              agreement: "exact",
              selected_reader_id: "textract",
              candidates: [
                {
                  reader_id: "textract",
                  value: "41 000,00 CZK",
                  confidence: 0.68,
                },
                { reader_id: "bedrock", value: "41000.00", confidence: null },
              ],
            },
            {
              pointer: "/full_name",
              agreement: "exact",
              candidates: [
                {
                  reader_id: "textract",
                  value: "Eva Horáková",
                  confidence: 0.99,
                },
                { reader_id: "bedrock", value: "Eva Horáková" },
              ],
            },
          ],
        },
      },
    };
  else if (path.startsWith("/source-documents/") && path.endsWith("/chunks/0"))
    result = {
      content_base64: sourceBytes.toString("base64"),
      content_sha256: sha,
    };
  else if (path.startsWith("/source-documents/"))
    result = {
      uid: path.split("/")[2],
      status: "ready",
      filename: "Synthetic employer confirmation.svg",
      media_type: "image/svg+xml",
      chunk_count: 1,
      byte_count: sourceBytes.length,
      content_sha256: sha,
    };
  else {
    errors.push(`Unexpected API request ${req.method()} ${path}`);
    status = 404;
    result = { detail: "Missing test route" };
  }
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
}
await page.route("**/api/**", mockApi);
async function visible(selector) {
  await page.locator(selector).waitFor({ state: "visible" });
}
// Let the SDK viewport subscription finish its responsive render before measuring.
function settledLayoutPage(target) {
  return {
    viewportSize: () => target.viewportSize(),
    evaluate: (fn, arg) => target.evaluate(fn, arg),
    async setViewportSize(size) {
      await target.setViewportSize(size);
      await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  };
}
async function geometry() {
  const bad = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".case-dashboard,.case-panel,.case-review-grid,.case-responsibility",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > innerWidth + 2 || r.right > innerWidth + 2;
      })
      .map((el) => el.className),
  );
  assert.deepEqual(bad, []);
}
try {
  await page.goto("http://127.0.0.1:15191/queue?theme=quartz-light");
  await page.getByRole("heading", { name: "Case review queue" }).waitFor();
  await page.getByText("1–10 of 12").waitFor();
  assert.equal(await page.locator(".case-table tbody tr").count(), 10);
  assert.equal(
    await page.locator(".case-stat").first().innerText(),
    "Accessible cases\n12\nMatching search and responsibility",
  );
  await geometry();
  await page.screenshot({
    path: resolve(output, "queue-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("11–12 of 12").waitFor();
  assert.equal(await page.locator(".case-table tbody tr").count(), 2);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("button", { name: "Eva Horáková", exact: true }).click();
  await page
    .getByRole("heading", { name: "Eva Horáková", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Inspect page 2", exact: true })
    .click();
  await page
    .locator(".case-focus-value")
    .getByText("41000.00 CZK", { exact: true })
    .waitFor();
  assert.match(
    await page.locator(".case-document-summary").innerText(),
    /Employer confirmation/,
  );
  await visible(".source-preview img");
  await page.getByRole("textbox", { name: "Full name", exact: true }).waitFor();
  assert(
    !/full_name|monthly_net_income/.test(
      await page.locator(".case-evidence-detail").innerText(),
    ),
  );
  const nav = page.locator(".case-evidence-navigation");
  const fields = page.getByRole("form", {
    name: "Document fields",
    exact: true,
  });
  const issue = fields.getByLabel("Issue date", { exact: true });
  assert.equal(await issue.getAttribute("aria-invalid"), null);
  const missingBorder = await issue.evaluate((input) => ({
    border: getComputedStyle(input).borderColor,
    error: getComputedStyle(
      input.closest(".cc-field").querySelector(".schema-optional-hint"),
    ).color,
  }));
  assert.equal(
    missingBorder.border,
    missingBorder.error,
    "Missing optional input must use the advisory color.",
  );
  assert.equal(
    await fields
      .getByLabel("Category", { exact: true })
      .evaluate((control) =>
        control.closest(".cc-field").getAttribute("aria-invalid"),
      ),
    null,
  );
  assert.equal(
    await fields
      .getByLabel("Category", { exact: true })
      .evaluate((control) => getComputedStyle(control).borderColor),
    missingBorder.border,
    "Missing optional selections must also have advisory borders.",
  );
  assert.notEqual(
    await fields
      .getByLabel("Dependents", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
    "Zero is a supplied value.",
  );
  assert.notEqual(
    await fields
      .getByLabel("Verified", { exact: true })
      .getAttribute("aria-invalid"),
    "true",
    "False is a supplied value.",
  );
  assert.equal(
    await fields
      .getByLabel("City", { exact: true })
      .getAttribute("aria-invalid"),
    null,
    "Missing optional nested fields must not be invalid.",
  );
  await page.locator(".case-document-detail-grid").screenshot({ path: resolve(output, "document-fields-editable.png") });
  await issue.fill("2026-10-01");
  assert.notEqual(await issue.getAttribute("aria-invalid"), "true");
  assert.notEqual(
    await issue.evaluate((input) => getComputedStyle(input).borderColor),
    missingBorder.border,
  );
  assert(
    await page
      .getByRole("button", { name: "Run checks", exact: true })
      .isDisabled(),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Accept revision", exact: true })
      .count(),
    0,
  );
  await nav
    .locator(`[data-requirement-key="${policy.comparisons[0].key}"]`)
    .getByRole("button", { name: /^Loan contract Revision/ })
    .click();
  await fields
    .getByRole("button", { name: "Save document fields", exact: true })
    .waitFor();
  assert.equal(
    await fields.getByLabel("Issue date", { exact: true }).inputValue(),
    "",
  );
  await nav
    .locator('[data-requirement-key="income_document"]')
    .getByRole("button", { name: /^Employer confirmation/ })
    .click();
  await issue.waitFor();
  assert.equal(
    await issue.inputValue(),
    "2026-10-01",
    "Switching documents must preserve the previous document's field draft.",
  );
  await fields
    .getByRole("button", { name: "Discard field changes", exact: true })
    .click();
  assert.equal(await issue.inputValue(), "");
  assert.equal(await issue.getAttribute("aria-invalid"), null);

  assert.match(
    await nav.locator('[data-requirement-key="income_document"]').innerText(),
    /Employer confirmation/,
  );
  assert.match(
    await nav.locator('[data-requirement-key="identity"]').innerText(),
    /No linked document.*National identity card or Passport/,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Subject activity", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.locator(".case-processing-evidence, .case-pipeline").count(),
    0,
  );
  assert.match(
    await page.locator(".case-document-states").innerText(),
    /Extraction retained/,
  );
  await nav
    .locator('[data-requirement-key="identity"]')
    .getByRole("button", { name: /^Identity/ })
    .click();
  await page.locator(".case-no-document").waitFor();
  assert.equal(
    await page.locator(".case-selected-document").count(),
    0,
    "A missing requirement must not show the previous requirement's document.",
  );
  await nav
    .locator('[data-requirement-key="income_document"]')
    .getByRole("button", { name: /^Employer confirmation/ })
    .click();
  assert.equal(
    await page
      .locator(".case-selected-document")
      .getAttribute("data-document-uid"),
    right,
  );
  assert.equal(
    await page.locator(".case-selected-document .case-document-review").count(),
    1,
  );
  await visible(".source-preview img");
  await geometry();
  await page.getByRole("button", { name: "Assign to me", exact: true }).click();
  await page.getByRole("button", { name: "Leave case", exact: true }).waitFor();
  assert.equal(
    await page.locator(".case-responsibility .case-reviewer").count(),
    2,
  );
  assert.match(
    await page.locator(".case-responsibility").innerText(),
    /Carlos · Reviewer · you/,
  );
  await page.screenshot({
    path: resolve(output, "review-light.png"),
    fullPage: true,
  });
  await assertCommandCenterPageLayout(settledLayoutPage(page), {
    viewports: COMMAND_CENTER_LAYOUT_VIEWPORTS.filter(
      (size) => size.pointer === "fine",
    ),
  });
  await page.getByLabel("Review reason").fill("Checked cited source.");
  await page
    .getByRole("button", { name: "Accept revision", exact: true })
    .click();
  await page.getByText("Revision review recorded.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Control report", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Checks and cited evidence" })
    .waitFor();
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: resolve(output, "control-report.pdf"),
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Back to review", exact: true })
    .click();
  await page.getByRole("button", { name: "Leave case", exact: true }).click();
  await page
    .getByRole("button", { name: "Assign to me", exact: true })
    .waitFor();
  assert.equal(assigned, false);
  stale = true;
  await page.reload();
  await page.getByText(/The last retained evaluation is out of date/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Inspect page 2", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Run checks", exact: true }).click();
  await page
    .getByRole("button", { name: "View evaluation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect page 2", exact: true })
    .waitFor();
  policy = policies[1];
  await page.goto(`http://127.0.0.1:15191/review/${assignment}`);
  await page
    .getByRole("heading", { name: "Eva Horáková", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".case-page-heading").innerText(),
    new RegExp(policy.name),
  );
  await visible(".source-preview img");
  await geometry();
  await page.screenshot({
    path: resolve(output, "review-dark.png"),
    fullPage: true,
  });
  for (const theme of ["main-sequence", "quartz-light"]) {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
    });
    const responsive = await context.newPage();
    await responsive.route("**/api/**", mockApi);
    await responsive.goto(
      `http://127.0.0.1:15191/review/${assignment}?theme=${theme}`,
    );
    await responsive
      .getByRole("textbox", { name: "Full name", exact: true })
      .waitFor();
    try {
      await assertCommandCenterPageLayout(settledLayoutPage(responsive), {
        viewports: COMMAND_CENTER_LAYOUT_VIEWPORTS.filter(
          (size) => size.pointer === "coarse",
        ),
      });
    } catch (error) {
      await responsive.setViewportSize({ width: 320, height: 568 });
      console.log(
        await responsive.evaluate(() =>
          Array.from(document.querySelectorAll(".case-selected-document *"))
            .filter((el) => el.getBoundingClientRect().right > innerWidth)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              width: el.getBoundingClientRect().width,
              right: el.getBoundingClientRect().right,
              min: getComputedStyle(el).minWidth,
            }))
            .slice(0, 30),
        ),
      );
      await responsive.screenshot({
        path: resolve(output, "fields-phone-failure.png"),
        fullPage: false,
      });
      throw new Error(error.message);
    }
    await responsive.setViewportSize({ width: 375, height: 812 });
    await responsive
      .locator('[data-requirement-key="identity"]')
      .getByRole("button", { name: /^Identity/ })
      .click();
    await responsive.locator(".case-no-document").waitFor();
    await responsive.screenshot({
      path: resolve(output, `missing-evidence-phone-${theme}.png`),
      fullPage: false,
    });
    await context.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await geometry();
  await page.screenshot({
    path: resolve(output, "review-mobile.png"),
    fullPage: true,
  });
  canReview = false;
  await page.reload();
  await page
    .getByRole("heading", { name: "Eva Horáková", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Assign to me", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Accept revision", exact: true })
      .count(),
    0,
  );
  await page.goto("http://127.0.0.1:15191/queue");
  await page.getByRole("heading", { name: "Case review queue" }).waitFor();
  await geometry();
  await page.screenshot({
    path: resolve(output, "queue-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "Search case subjects" }).fill("Eva");
  await page.getByText("1–1 of 1").waitFor();
  assert.equal(await page.locator(".case-table tbody tr").count(), 1);
  await page.getByRole("textbox", { name: "Search case subjects" }).fill("");
  await page.getByText("1–10 of 12").waitFor();
  await page
    .getByRole("button", { name: "Reviewer responsibility", exact: true })
    .click();
  await page.getByRole("option", { name: "Unassigned", exact: true }).click();
  await page.getByText("1–8 of 8").waitFor();
  assert.equal(
    await page.locator(".case-table tbody .case-reviewer").count(),
    0,
  );
  await page
    .getByRole("button", { name: "Reviewer responsibility", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Assigned to me", exact: true })
    .click();
  await page.getByText("0 cases", { exact: true }).waitFor();

  assert(
    requests.some((r) => r.path === "/cases" && r.query.includes("offset=10")),
  );
  assert(
    requests.some((r) => r.path === "/cases" && r.query.includes("search=Eva")),
  );
  await page
    .getByRole("button", { name: "Reviewer responsibility", exact: true })
    .click();
  await page
    .getByRole("option", { name: "All accessible cases", exact: true })
    .click();
  await page.getByText("1–10 of 12").waitFor();
  await page.getByRole("button", { name: "Case type", exact: true }).click();
  await page.getByRole("option", { name: "New loan", exact: true }).click();
  await page.getByText("1–6 of 6").waitFor();
  assert.equal(await page.locator(".case-table tbody tr").count(), 6);
  await page.getByRole("button", { name: "Case type", exact: true }).click();
  await page
    .getByRole("option", { name: "Account opening", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".case-table tbody tr")].every((row) =>
      row.textContent.includes("Account opening"),
    ),
  );
  assert(
    requests.some(
      (r) =>
        r.path === "/cases" &&
        r.query.includes("case_type_key=account_opening"),
    ),
  );
  assert(!requests.some((r) => r.path === "/persons"));
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.getByRole("button", { name: "New case", exact: true }).click();
  const createButton = page.getByRole("button", {
    name: "Create case",
    exact: true,
  });
  assert(await createButton.isDisabled());
  await page.getByRole("button", { name: "Case subject", exact: true }).click();
  await page.getByRole("option", { name: /Eva Horáková/ }).click();
  await page
    .getByRole("button", { name: "New case type", exact: true })
    .click();
  await page.getByRole("option", { name: /^New loan/ }).click();
  await page
    .getByRole("button", { name: "Document Set version", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("option", { name: new RegExp(policies[1].name) })
      .count(),
    0,
  );
  await page
    .getByRole("option", { name: new RegExp(policies[0].name) })
    .click();
  assert(await createButton.isEnabled());
  await page
    .getByRole("button", { name: "New case type", exact: true })
    .click();
  await page.getByRole("option", { name: /^Account opening/ }).click();
  assert(await createButton.isDisabled());
  await page
    .getByRole("button", { name: "Document Set version", exact: true })
    .click();
  await page
    .getByRole("option", { name: new RegExp(policies[1].name) })
    .click();
  await page.screenshot({
    path: resolve(output, "case-creation.png"),
    fullPage: true,
  });
  await createButton.click();
  await page.waitForURL(/\/review\//);
  assert(requests.some((r) => r.path === "/cases" && r.method === "POST"));
  await page
    .getByRole("button", { name: "Subject details", exact: true })
    .click();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await page
    .getByRole("heading", { name: "Subject activity", exact: true })
    .waitFor();
  assert.equal(await page.locator("table tbody tr").count(), 3);
  assert.equal(await page.locator("table thead th").count(), 2);
  assert.match(await page.locator("table").innerText(), /Document reviewed/);
  assert(
    !/document\.reviewed|assignment\.evaluated/.test(
      await page.locator("table").innerText(),
    ),
  );
  await page.screenshot({
    path: resolve(output, "subject-activity-list.png"),
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Case dashboards passed: queue pagination/search, distinct subject/staff, multi-reviewer membership, cited source selection, revision review, retained report, stale comparison exclusion, async checks, both workflows, permissions, light/dark/mobile.",
  );
} finally {
  await browser.close();
  await server.close();
}
