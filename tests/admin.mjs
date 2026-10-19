// Writes are confined to an explicitly identified disposable local SQLite source.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BACKOFFICE_TEST_URL;
const sourceUid = process.env.BACKOFFICE_TEST_SOURCE_UID;
assert(base && ["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Set an explicit local BACKOFFICE_TEST_URL.");
assert(sourceUid, "Set BACKOFFICE_TEST_SOURCE_UID to the disposable runtime's exact source UID.");
const backend = resolve(process.env.BACKOFFICE_BACKEND_DIR ?? "../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
const output = resolve(".local/admin-results");
await mkdir(output, { recursive: true });
async function call(path, body, method = "POST") {
  const response = await fetch(`${base}/api${path}`, body === undefined ? {} : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation_key: randomUUID(), ...body }),
  });
  assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
const health = await call("/healthz");
assert.equal(health.metatables.local_mode, true);
assert.equal(health.metatables.dialect, "sqlite");
assert.equal(health.metatables.data_source_uid, sourceUid);
const viewer = await call("/me");
assert.equal(viewer.is_organization_admin, true);
const types = (await call("/document-types")).items;
const policy = (kind) => call(`/admin/parsing-settings?document_type=${kind}`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function choose(kind) {
  await page.getByLabel("Document type", { exact: true }).click();
  const name = types.find((type) => type.document_type === kind).name;
  await page.getByRole("option", { name: new RegExp(name, "i") }).click();
  await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).waitFor();
}
async function enableAndSave(value) {
  const toggle = page.getByRole("button", { name: "Automatic acceptance", exact: true });
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).fill(value);
  await page.getByRole("button", { name: "Save parsing settings", exact: true }).click();
  await page.getByText("Parsing settings saved.", { exact: true }).waitFor();
  // Refresh after the write must finish before another type is selected.
  await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).waitFor();
  assert.equal(await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).inputValue(), Number(value).toFixed(2));
}

try {
  console.log("Verified private SQLite source and administrator identity.");
  await page.goto(`${base}/admin`);
  await page.getByRole("heading", { name: "Admin", exact: true }).waitFor();
  await page.getByRole("link", { name: "Admin", exact: true }).waitFor();
  await choose("passport");
  await enableAndSave("60");
  const first = await policy("passport");
  assert.equal(first.document_type, "passport");
  assert.equal(first.score_kind, "classification_confidence");
  assert.equal(first.acceptance_threshold_percent, "60.00");
  assert.equal(first.automatic_acceptance_enabled, true);
  console.log("Saved passport threshold through the Admin screen.");

  await choose("utility_bill");
  await enableAndSave("90");
  const billPolicy = await policy("utility_bill");
  await choose("passport");
  assert.equal(await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).inputValue(), "60.00");
  await page.reload();
  await choose("passport");
  assert.equal(await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).inputValue(), "60.00");

  // Another administrator changes this type after the form loaded.
  await call("/admin/parsing-settings", { document_type: "passport", expected_revision: first.revision, automatic_acceptance_enabled: true, acceptance_threshold_percent: "65.00" }, "PUT");
  await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).fill("61");
  await page.getByRole("button", { name: "Save parsing settings", exact: true }).click();
  await page.getByRole("button", { name: "Reload saved settings", exact: true }).waitFor();
  assert.equal(await page.getByRole("spinbutton", { name: /^Acceptance threshold/ }).inputValue(), "61");
  await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#parsing-threshold")?.value === "65.00");
  await enableAndSave("60");
  assert.deepEqual(await policy("utility_bill"), billPolicy, "Changing passport policy must not change utility bill policy.");
  console.log("Independent policies, reload and concurrent update recovery passed.");
  await page.screenshot({ path: resolve(output, "admin.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: resolve(output, "admin-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const person = await call("/persons", { profile: {
    full_name: "Admin Policy Verification", external_reference: `admin-verification-${randomUUID()}`,
    date_of_birth: "1990-03-12", employment_status: "retired", residency_permit_required: false,
    residential_address: { address_line_1: "14 Example Street", city: "Prague", postal_code: "11000", country_code: "CZ" },
  } });
  const payload = JSON.parse(await readFile(resolve(backend, "tests/fixtures/documents/passport.json"), "utf8"));
  const content = Buffer.from(JSON.stringify(payload));
  const source = await call("/source-documents/uploads", { person_uid: person.uid, filename: "synthetic-admin-policy.txt", media_type: "text/plain", byte_count: content.length, content_sha256: createHash("sha256").update(content).digest("hex") });
  const chunk = await fetch(`${base}/api/source-documents/uploads/${source.uid}/chunks/0`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content_base64: content.toString("base64") }) });
  assert(chunk.ok);
  await call(`/source-documents/uploads/${source.uid}/finalize`, {});
  const outcomes = [];
  let acceptedDocument;
  for (const score of ["60.00", "59.99", null]) {
    const doc = await call(`/persons/${person.uid}/documents`, { document_type: "passport", payload, raw_document_refs: [{ raw_document_uid: source.uid }] });
    await call(`/documents/${doc.uid}/parsing-results`, { expected_revision: 1, parsing_score_percent: score, extractor: "synthetic-local-classification-verification" });
    const saved = await call(`/documents/${doc.uid}`);
    const qualifies = score === "60.00";
    assert.equal(saved.accepted, qualifies);
    assert.equal(saved.parsing_result.decision, qualifies ? "accepted" : "needs_review");
    assert.equal(saved.parsing_result.parsing_score_percent, score);
    assert.equal(saved.parsing_result.acceptance_threshold_percent, "60.00");
    await page.goto(`${base}/documents/${doc.uid}`);
    await page.getByRole("heading", { name: "Parsing result", exact: true }).waitFor();
    await page.getByText("Classification confidence", { exact: true }).waitFor();
    if (qualifies) {
      acceptedDocument = saved;
      await page.getByText("This exact document revision was accepted automatically under the recorded parsing policy.", { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, "auto-accepted.png"), fullPage: true });
    } else await page.getByText("Needs review", { exact: true }).waitFor();
    outcomes.push({ score, decision: saved.parsing_result.decision, document_uid: doc.uid });
  }

  // A later policy or draft cannot rewrite the previously accepted revision.
  const savedPassportPolicy = await policy("passport");
  await call("/admin/parsing-settings", { document_type: "passport", expected_revision: savedPassportPolicy.revision, automatic_acceptance_enabled: true, acceptance_threshold_percent: "70.00" }, "PUT");
  await call(`/documents/${acceptedDocument.uid}/revisions`, { expected_revision: 1, payload, raw_document_refs: acceptedDocument.raw_document_refs });
  const newDraft = await call(`/documents/${acceptedDocument.uid}`);
  assert.equal(newDraft.accepted, false);
  assert.equal(newDraft.parsing_result, null);
  const retained = await call(`/documents/${acceptedDocument.uid}/revisions/1`);
  assert.equal(retained.accepted, true);
  assert.deepEqual(retained.parsing_result, acceptedDocument.parsing_result);
  await page.goto(`${base}/documents/${acceptedDocument.uid}?revision=1`);
  await page.getByText(/^Retained revision 1\./).waitFor();
  await page.getByText("This exact document revision was accepted automatically under the recorded parsing policy.", { exact: true }).waitFor();
  console.log("Inclusive, below-threshold, missing-score and retained revision outcomes passed.");

  // UI checks only: API authorization is separately exercised in backend tests.
  for (const canReview of [false, true]) {
    const context = await browser.newContext();
    const restricted = await context.newPage();
    let settingsReads = 0;
    await restricted.route("**/api/me", (route) => route.fulfill({ json: { ...viewer, can_review: canReview, is_organization_admin: false } }));
    await restricted.route("**/api/admin/parsing-settings**", (route) => { settingsReads++; return route.fulfill({ status: 403, json: { detail: "organization_admin_required" } }); });
    await restricted.goto(`${base}/admin`);
    await restricted.getByText("Organization administrator access is required.", { exact: true }).waitFor();
    assert.equal(await restricted.getByRole("link", { name: "Admin", exact: true }).count(), 0);
    assert.equal(settingsReads, 0, "Restricted direct URL must not mount a settings reader.");
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, local_data_source: sourceUid, person_uid: person.uid, outcomes, verified_at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ result: "Admin UI and real API verification passed", local_data_source: sourceUid, outcomes, screenshots: output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
