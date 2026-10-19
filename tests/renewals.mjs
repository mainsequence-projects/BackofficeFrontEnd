// Real API/browser verification. Fixtures are confined to a verified local SQLite runtime.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BACKOFFICE_TEST_URL;
assert(base && ["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Set an explicit local BACKOFFICE_TEST_URL");
const backend = resolve(process.env.BACKOFFICE_BACKEND_DIR ?? "../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
async function call(path, body, method = "POST") {
  const response = await fetch(base + "/api" + path, body === undefined ? {} : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation_key: randomUUID(), ...body }),
  });
  assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
const health = await call("/healthz");
assert.equal(health.metatables.local_mode, true);
assert.equal(health.metatables.dialect, "sqlite");
assert.equal((await call("/me")).can_review, true);
const policyVersions = (await call("/document-sets")).items;
assert.deepEqual(policyVersions.map((p) => p.version), [2, 1]);
const profile = {
  full_name: "Alex Morgan", external_reference: `renewal-verification-${randomUUID()}`,
  date_of_birth: "1990-03-12", employment_status: "retired", residency_permit_required: false,
  residential_address: { address_line_1: "14 Example Street", city: "Prague", postal_code: "11000", country_code: "CZ" },
};
const person = (await call("/persons", { profile })).uid;
async function bill(age) {
  const payload = JSON.parse(await readFile(resolve(backend, "tests/fixtures/documents/utility_bill.json"), "utf8"));
  const date = new Date(); date.setUTCDate(date.getUTCDate() - age);
  payload.issue_date = date.toISOString().slice(0, 10);
  const content = Buffer.from(JSON.stringify(payload));
  const source = await call("/source-documents/uploads", {
    person_uid: person, filename: `synthetic-bill-${age}.txt`, media_type: "text/plain", byte_count: content.length,
    content_sha256: createHash("sha256").update(content).digest("hex"),
  });
  const chunk = await fetch(`${base}/api/source-documents/uploads/${source.uid}/chunks/0`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content_base64: content.toString("base64") }),
  });
  assert(chunk.ok);
  await call(`/source-documents/uploads/${source.uid}/finalize`, {});
  const created = await call(`/persons/${person}/documents`, { document_type: "utility_bill", payload, raw_document_refs: [{ raw_document_uid: source.uid }] });
  await call(`/documents/${created.uid}/submit`, { expected_revision: 1 });
  await call(`/documents/${created.uid}/reviews`, { expected_revision: 1, expected_decision_sequence: 0, decision: "accepted", reason: "Synthetic local renewal verification" });
  return call(`/documents/${created.uid}`);
}
const old = await bill(220);
assert(old.created_at && old.revision_created_at && old.submitted_at && old.latest_review.reviewed_at);
const assigned = await call(`/persons/${person}/document-sets`, { document_set_key: "new_account_requirements", document_set_version: 2 });
await call(`/assignments/${assigned.uid}/documents`, { expected_revision: 1, document_uids: [old.uid] }, "PUT");
const address = (result) => result.findings.find((f) => f.requirement_key === "address");
const due = address(await call(`/assignments/${assigned.uid}/status`));
assert.equal(due.reason_code, "DOCUMENT_OUTSIDE_FRESHNESS_WINDOW");
assert.equal(due.document_references[0].dates.due_status, "overdue");
assert.equal(due.document_references[0].dates.action, "replace_evidence");
const saved = await call(`/assignments/${assigned.uid}/evaluations`, { expected_revision: 2 });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = resolve(".local/renewal-results"); await mkdir(output, { recursive: true });
try {
  await page.goto(`${base}/document-sets/new_account_requirements?version=2`);
  await page.getByText(/Review again every 6 calendar months/).first().waitFor();
  await page.getByText(/At most 6 calendar months old/).first().waitFor();
  await page.getByText(/Age measured from completed at/).waitFor();
  await page.screenshot({ path: resolve(output, "policy-v2.png"), fullPage: true });
  await page.goto(`${base}/document-sets/new_account_requirements?version=1`);
  await page.getByText(/At most 90 days old/).first().waitFor();
  assert.equal(await page.getByText(/Review again every 6 calendar months/).count(), 0);
  await page.goto(`${base}/documents/${old.uid}`);
  await page.getByRole("heading", { name: "Document dates", exact: true }).waitFor();
  for (const label of ["Document recorded", "Revision recorded", "Revision submitted", "Last reviewed"])
    await page.getByText(label, { exact: true }).waitFor();
  assert(!await page.getByText("Not submitted", { exact: true }).count());
  await page.screenshot({ path: resolve(output, "document-dates.png"), fullPage: true });
  await page.goto(`${base}/persons/${person}?tab=requirements`);
  await page.getByText("Overdue", { exact: true }).waitFor();
  await page.getByText(`Replace evidence on ${due.document_references[0].dates.action_due_on}.`, { exact: false }).waitFor();
  await page.screenshot({ path: resolve(output, "overdue.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: resolve(output, "overdue-mobile.png"), fullPage: true });

  // A newer qualifying document satisfies v2 while v1 remains pinned to 90 days.
  const fresh = await bill(120);
  await call(`/assignments/${assigned.uid}/documents`, { expected_revision: 2, document_uids: [old.uid, fresh.uid] }, "PUT");
  const live = address(await call(`/assignments/${assigned.uid}/status`));
  assert.equal(live.status, "satisfied");
  assert.equal(live.document_references[0].document_uid, fresh.uid);
  const v1 = await call(`/persons/${person}/document-sets`, { document_set_key: "new_account_requirements", document_set_version: 1 });
  await call(`/assignments/${v1.uid}/documents`, { expected_revision: 1, document_uids: [fresh.uid] }, "PUT");
  assert.equal(address(await call(`/assignments/${v1.uid}/status`)).reason_code, "DOCUMENT_OUTSIDE_FRESHNESS_WINDOW");
  const retained = await call(`/evaluations/${saved.uid}`);
  assert.equal(retained.stale, true);
  assert.equal(address(retained).reason_code, due.reason_code);
  assert.deepEqual(address(retained).document_references, due.document_references);

  // A new draft exposes its own timestamp without overwriting the retained submission date.
  await call(`/documents/${old.uid}/revisions`, { expected_revision: 1, payload: old.payload, raw_document_refs: old.raw_document_refs });
  await page.goto(`${base}/documents/${old.uid}`);
  await page.getByText("Not submitted", { exact: true }).waitFor();
  await page.goto(`${base}/documents/${old.uid}?revision=1`);
  await page.getByText(/^Retained revision 1\./).waitFor();
  assert.equal(await page.getByText("Not submitted", { exact: true }).count(), 0);
  assert.equal((await call(`/documents/${old.uid}/revisions/1`)).submitted_at, old.submitted_at);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "Real API and browser renewal checks passed", local_data_source: health.metatables.data_source_uid, person, screenshots: output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
