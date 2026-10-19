// Browser contract tests: real site and SDK, controlled Back Office responses.
// No records, provider calls or business decisions are created by this test.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { chromium } from "playwright";
const root = process.cwd();
const backend = resolve(
  root,
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
const origin = "http://127.0.0.1:15189";
const out = resolve(root, ".local/comparison-verification");
await mkdir(out, { recursive: true });
const server = await createServer({
  root,
  server: { port: 15189, strictPort: true, hmr: false },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = id(1),
  assignment = id(2),
  run = id(3),
  evaluation = id(4),
  left = id(5),
  right = id(6),
  source = id(7);
const bytes = Buffer.from("Synthetic cited source content");
const sha = createHash("sha256").update(bytes).digest("hex");
let policy = policies[0],
  state = "pending",
  polls = 0,
  posts = [],
  stale = false,
  mode = "compare",
  badHash = false,
  observedAssignment;
const cite = {
  source_id: source,
  source_sha256: sha,
  page_sha256: "b".repeat(64),
  page: 1,
};
function report() {
  const rule = policy.comparisons[0];
  const fact = (doc, value) => ({
    document_id: doc,
    revision: 2,
    pointer:
      "/" +
      (doc === left ? rule.left.field : rule.right.field).replaceAll(".", "/"),
    value,
    citations: [cite],
  });
  return {
    uid: evaluation,
    person_uid: person,
    assignment_uid: assignment,
    set_key: policy.key,
    set_version: policy.version,
    person_revision: 1,
    assignment_revision: 2,
    status: "completed",
    stale,
    created_at: "2026-10-19T12:00:00Z",
    summary: { complete: false },
    input_snapshot: {
      policy,
      comparison_result: {
        observations: [
          {
            key: "pair",
            comparability: "comparable",
            relationship: "different",
            explanation: "The cited values differ.",
            left: fact(
              left,
              rule.operator === "numeric" ? "56000" : "Eva Horáková",
            ),
            right: fact(
              right,
              rule.operator === "numeric" ? "41000" : "Eva Nováková",
            ),
            context: [],
          },
        ],
      },
    },
    findings: [
      {
        uid: id(10),
        requirement_key: rule.key,
        status: "failed",
        reason_code: "COMPARISON_RULE_FAILED",
        explanation:
          "Back Office found a difference outside this policy's allowance.",
        field_paths: [rule.left.field, rule.right.field],
        document_references: [
          { document_uid: left, revision: 2 },
          { document_uid: right, revision: 2 },
          ...[left, right].map((doc) => ({
            document_uid: doc,
            revision: 2,
            comparison_key: "pair",
            citations: [cite],
          })),
        ],
      },
    ],
  };
}
await page.route("**/api/**", async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.slice(4);
  let result,
    status = 200;
  if (request.method() === "POST")
    posts.push({ path, body: request.postDataJSON() });
  if (path === "/me") result = { user_uid: person, can_review: true };
  else if (path === "/readyz") result = { status: "ready" };
  else if (path === "/person-schema")
    result = { type: "object", properties: {} };
  else if (path === "/document-types")
    result = {
      items: [
        { document_type: "passport", schema_version: 1, name: "Passport" },
      ],
    };
  else if (path === "/document-sets") result = { items: policies };
  else if (path === "/persons")
    result = {
      items: [{ uid: person, full_name: "Synthetic comparison case" }],
      total_items: 1,
    };
  else if (path === `/persons/${person}`)
    result = {
      uid: person,
      full_name: "Synthetic comparison case",
      revision: 1,
    };
  else if (path === `/persons/${person}/assignments`)
    result = {
      items: [
        { uid: id(99), set_key: "older", set_version: 1 },
        {
          uid: assignment,
          set_key: policy.key,
          set_version: policy.version,
          revision: 2,
        },
      ],
    };
  else if (path.match(/^\/assignments\/[^/]+\/status$/))
    result = {
      set_version: policy.version,
      summary: { evaluation_date: "2026-10-19", complete: false },
      findings: report().findings,
    };
  else if (path === `/assignments/${assignment}`)
    result = { uid: assignment, revision: 2 };
  else if (path.match(/^\/assignments\/[^/]+\/evaluations$/)) {
    observedAssignment = path.split("/")[2];
    if (request.method() === "POST") {
      result =
        mode === "sync"
          ? { uid: evaluation }
          : {
              uid: run,
              processing_run_uid: run,
              assignment_uid: assignment,
              status: "pending",
            };
      status = mode === "sync" ? 201 : 202;
    } else result = { items: [report()] };
  } else if (path === `/processing-runs/${run}/retry`) {
    state = "completed";
    result = { uid: run, status: "pending" };
    status = 202;
  } else if (path === `/processing-runs/${run}`) {
    polls++;
    result = {
      uid: run,
      assignment_uid: assignment,
      status: state,
      stage: state,
      error_code:
        state === "needs_input"
          ? "comparison_inputs_changed_start_new_evaluation"
          : state === "failed"
            ? "processing_unavailable"
            : null,
      evaluation:
        state === "completed" && mode !== "extract"
          ? { uid: evaluation }
          : null,
      document:
        state === "completed" && mode === "extract" ? { uid: left } : null,
    };
  } else if (path === `/evaluations/${evaluation}`) result = report();
  else if (path === `/source-documents/${source}`)
    result = {
      uid: source,
      status: "ready",
      filename: "cited-source.txt",
      media_type: "text/plain",
      chunk_count: 1,
      byte_count: bytes.length,
      content_sha256: badHash ? "c".repeat(64) : sha,
    };
  else if (path === `/source-documents/${source}/chunks/0`)
    result = { content_base64: bytes.toString("base64"), content_sha256: sha };
  else if (path === `/source-documents/${source}/process`) {
    mode = "extract";
    state = "completed";
    result = { uid: run, status: "pending" };
    status = 202;
  } else if (path === `/persons/${person}/documents`)
    result = { items: [], total_items: 0 };
  else if (path === `/persons/${person}/sources`)
    result = {
      items: [
        {
          uid: source,
          status: "ready",
          filename: "source.pdf",
          media_type: "application/pdf",
        },
      ],
    };
  else if (
    path === `/documents/${left}` ||
    path === `/documents/${left}/revisions/2`
  )
    result = {
      uid: left,
      person_uid: person,
      document_type: "passport",
      schema_version: 1,
      revision: 2,
      status: "submitted",
      review_status: "accepted",
      accepted: true,
      payload: {},
      raw_document_refs: [],
    };
  else if (path === "/document-types/passport/schema")
    result = { canonical_schema: { type: "object", properties: {} } };
  else if (path === `/documents/${left}/revisions/2/extraction-evidence`)
    result = {
      evidence: {
        source_mapping: { "source.pdf": source },
        extraction: {
          pages: [{ source_file: "source.pdf", page: 1, source_sha256: sha }],
          field_evidence: [
            {
              pointer: "/full_name",
              agreement: "single_reader",
              selected_reader_id: "primary",
              candidates: [
                {
                  reader_id: "primary",
                  value: "Synthetic Name",
                  locations: [{ source_file: "source.pdf", page: 1 }],
                },
              ],
            },
          ],
        },
      },
    };
  else {
    errors.push(`Unexpected API: ${request.method()} ${path}`);
    result = { detail: "Unexpected route" };
    status = 404;
  }
  await route.fulfill({ status, json: result });
});
try {
  for (policy of policies) {
    mode = "compare";
    state = "pending";
    await page.goto(
      `${origin}/reconciliation?person=${person}&assignment=${assignment}`,
    );
    await page.getByRole("button", { name: "Run fresh evaluation" }).click();
    await page
      .getByRole("heading", { name: "Evaluation processing" })
      .waitFor();
    assert.equal(new URL(page.url()).searchParams.get("run"), run);
    assert(!page.url().includes("evaluation=undefined"));
    assert.equal(observedAssignment, assignment);
    assert.equal(posts.at(-1).body.expected_revision, 2);
    assert(posts.at(-1).body.operation_key);
    await page.reload(); // URL retains the work after a reload.
    state = "completed";
    await page
      .getByRole("button", { name: "View evaluation", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Cited cross-document comparisons" })
      .waitFor();
    await page
      .getByRole("cell", {
        name:
          policy.comparisons[0].operator === "numeric"
            ? "56000"
            : "Eva Horáková",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("cell", {
        name:
          policy.comparisons[0].operator === "numeric"
            ? "41000"
            : "Eva Nováková",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Page 1", exact: true })
      .first()
      .click();
    await page
      .getByText("Synthetic cited source content", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close source", exact: true })
      .click();
  }
  await page.screenshot({
    path: resolve(out, "comparisons-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const comparisonCard = page
    .locator(".evidence-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Cited cross-document comparisons",
      }),
    });
  assert(
    await comparisonCard.evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll("p, .evidence-table-scroll")].every(
        (element) => {
          const box = element.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right + 1;
        },
      );
    }),
    "Comparison copy and the table viewport must fit inside the mobile card",
  );
  await comparisonCard.screenshot({
    path: resolve(out, "comparisons-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `${origin}/reconciliation?person=${person}&assignment=${assignment}&evaluation=${evaluation}&theme=quartz-light`,
  );
  await page
    .getByRole("heading", { name: "Cited cross-document comparisons" })
    .waitFor();
  await comparisonCard.screenshot({
    path: resolve(out, "comparisons-light.png"),
  });
  badHash = true;
  await page
    .getByRole("button", { name: "Page 1", exact: true })
    .first()
    .click();
  await page
    .getByText("This source does not match the cited checksum.")
    .waitFor();
  badHash = false;
  stale = true;
  await page.reload();
  await page.getByText("Out of date", { exact: true }).waitFor();
  state = "needs_input";
  await page.goto(
    `${origin}/reconciliation?person=${person}&assignment=${assignment}&run=${run}`,
  );
  await page
    .getByText("The case changed during processing.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Retry processing", exact: true })
      .count(),
    0,
  );
  const stoppedPolls = polls;
  await page.waitForTimeout(2800);
  assert.equal(polls, stoppedPolls);
  state = "failed";
  await page.reload();
  await page
    .getByRole("button", { name: "Retry processing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View evaluation", exact: true })
    .waitFor();
  assert.equal(posts.at(-1).path, `/processing-runs/${run}/retry`);
  mode = "sync";
  await page.goto(
    `${origin}/reconciliation?person=${person}&assignment=${assignment}`,
  );
  await page.getByRole("button", { name: "Run fresh evaluation" }).click();
  await page
    .getByRole("heading", { name: "Requirement findings", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("evaluation"), evaluation);
  await page.goto(
    `${origin}/document-sets/${policy.key}?version=${policy.version}`,
  );
  await page
    .getByRole("heading", { name: "Cross-document checks", exact: true })
    .waitFor();
  // An existing verified source uses Back Office's processing endpoint.
  await page.goto(`${origin}/documents?person=${person}`);
  await page.getByLabel("Existing source", { exact: true }).click();
  await page.getByRole("option", { name: /source.pdf/ }).click();
  await page
    .getByRole("button", { name: "Extract from source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review extracted document", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Extraction evidence", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Synthetic Name", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Page 1", exact: true }).click();
  await page
    .getByText("Synthetic cited source content", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Passed: both policies, 201/202 navigation, resume/poll/retry, stale input, citation integrity, extraction handoff and responsive evidence tables.",
  );
} finally {
  await browser.close();
  await server.close();
}
