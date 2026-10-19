import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertCommandCenterApplicationShell } from "@dev-mainsequence/command-center-sdk/navigation/testing";
import { assertCommandCenterPageLayout } from "@dev-mainsequence/command-center-sdk/layout/testing";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend =
  process.env.BACKOFFICE_BACKEND_DIR ??
  resolve(root, "../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
const base = process.env.BACKOFFICE_TEST_URL ?? "http://127.0.0.1:15174";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Mutation verification requires an explicitly isolated local stack.",
);
const output = resolve(root, ".local/browser-results");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
const expectedProfile = {
  full_name: "Alex Morgan",
  external_reference: `browser-verification-${Date.now()}`,
  date_of_birth: "1990-03-12",
  employment_status: "retired",
  residency_permit_required: false,
  residential_address: {
    address_line_1: "14 Example Street",
    city: "Prague",
    postal_code: "11000",
    country_code: "CZ",
  },
};
const request = async (path, init) => {
  const response = await page.request.fetch(`${base}/api${path}`, init);
  assert(
    response.ok(),
    `${path}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
};
import { setValues, text } from "./form-helpers.mjs";

try {
  const health = await request("/healthz");
  assert.equal(health.metatables.local_mode, true);
  assert.equal(health.metatables.dialect, "sqlite");
  console.log("Verified isolated local SQLite runtime.");
  let releaseReady;
  const delay = new Promise((r) => (releaseReady = r));
  await page.route("**/api/readyz", async (route) => {
    await delay;
    await route.continue();
  });
  await page.goto(`${base}/persons`);
  await page.getByText("Preparing your workspace", { exact: true }).waitFor();
  await assertCommandCenterApplicationShell(page, {
    navigationDepth: 1,
    phase: "startup",
  });
  releaseReady();
  await page.unroute("**/api/readyz");
  await page.getByRole("button", { name: "New person", exact: true }).waitFor();
  await assertCommandCenterApplicationShell(page, {
    navigationDepth: 1,
    phase: "ready",
  });
  let personUid = process.env.BACKOFFICE_TEST_PERSON;
  if (personUid) {
    const person = await request(`/persons/${personUid}`);
    assert(
      person.external_reference?.startsWith("browser-verification-"),
      "Resume only a synthetic browser verification case.",
    );
    if (person.full_name !== expectedProfile.full_name) {
      await page.goto(`${base}/persons/${personUid}`);
      await page
        .getByLabel("Full name", { exact: true })
        .fill(expectedProfile.full_name);
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page
        .getByText("Reference profile saved.", { exact: true })
        .waitFor();
    }
  } else {
    await page.getByRole("button", { name: "New person", exact: true }).click();
    const personSchema = await request("/person-schema");
    await setValues(page, personSchema, expectedProfile);
    await page
      .getByRole("button", { name: "Create person", exact: true })
      .click();
    await page.waitForURL(/\/persons\/[0-9a-f-]{36}/);
    personUid = new URL(page.url()).pathname.split("/")[2];
    await page.getByRole("tab", { name: /^Requirements/ }).click();
    await page
      .getByRole("button", { name: "New case type", exact: true })
      .click();
    await page.getByRole("option", { name: /^Account opening/ }).click();
    await page
      .getByRole("button", { name: "Document Set version", exact: true })
      .click();
    await page.getByRole("option").first().click();
    await page
      .getByRole("button", { name: "Create case", exact: true })
      .click();
    await page
      .getByText("Case created with its pinned Document Set.", {
        exact: true,
      })
      .waitFor();
  }
  const assignment = (await request(`/persons/${personUid}/assignments`))
    .items[0];
  assert(assignment.uid);
  console.log(
    process.env.BACKOFFICE_TEST_PERSON
      ? "Resumed the synthetic case after checking its stored identity and assignment."
      : "Created a subject and typed case with its pinned policy through the SDK screens.",
  );
  const types = (await request("/document-types")).items;
  const existingDocuments = process.env.BACKOFFICE_TEST_PERSON
    ? (await request(`/persons/${personUid}/documents`)).items
    : [];
  const submitted = [];
  for (const kind of [
    "national_identity_card",
    "utility_bill",
    "source_of_funds_evidence",
    "kyc_questionnaire",
  ]) {
    const existing = existingDocuments.find(
      (d) =>
        d.document_type === kind &&
        (kind !== "kyc_questionnaire" ||
          d.payload?.employment_status === expectedProfile.employment_status),
    );
    if (existing?.accepted) {
      submitted.push(existing.uid);
      console.log("Retained previously verified accepted revision: " + kind);
      continue;
    }
    const data = JSON.parse(
      await readFile(
        resolve(backend, `tests/fixtures/documents/${kind}.json`),
        "utf8",
      ),
    );
    if (kind === "kyc_questionnaire")
      data.employment_status = expectedProfile.employment_status;
    if (existing) await page.goto(`${base}/documents/${existing.uid}`);
    else {
      await page.goto(`${base}/persons/${personUid}?tab=documents`);
      await page.getByLabel("Document type", { exact: true }).click();
      const option = types.find((t) => t.document_type === kind);
      await page
        .getByRole("option", { name: new RegExp(text(option.name)) })
        .click();
      await page.getByLabel("Source file", { exact: true }).setInputFiles({
        name: `synthetic-${kind}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(JSON.stringify(data, null, 2)),
      });
      await page
        .getByRole("button", { name: "Create document", exact: true })
        .click();
      await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);
    }
    const docUid = new URL(page.url()).pathname.split("/")[2];
    await page.getByText("Document attributes", { exact: true }).waitFor();
    const schema = await request(`/document-types/${kind}/schema`);
    if (existing?.status !== "submitted") {
      await setValues(page, schema.canonical_schema, data);
      await page
        .getByRole("button", { name: "Submit for review", exact: true })
        .click();
      await page
        .getByText("Document submitted for review.", { exact: true })
        .waitFor();
    }
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page
      .getByLabel(/^Review reason/)
      .fill(
        "Synthetic verification: attributes checked against the original source.",
      );
    await page
      .getByRole("button", { name: "Accept revision", exact: true })
      .click();
    await page.getByText("Revision accepted.", { exact: true }).waitFor();
    const document = await request(`/documents/${docUid}`);
    assert.equal(document.accepted, true);
    assert.equal(document.status, "submitted");
    submitted.push(docUid);
    console.log(
      `Uploaded, completed, submitted and accepted ${kind} through the UI.`,
    );
  }
  await page.goto(`${base}/persons/${personUid}?tab=requirements`);
  const currentAssignment = await request(`/assignments/${assignment.uid}`);
  const unlinked = submitted.filter(
    (uid) => !currentAssignment.document_uids.includes(uid),
  );
  if (unlinked.length) {
    await page.getByLabel("Evidence documents", { exact: true }).click();
    for (const uid of unlinked) {
      const document = await request(`/documents/${uid}`);
      await page
        .getByRole("option", {
          disabled: false,
          name: new RegExp(
            text(
              document.document_type
                .replaceAll("_", " ")
                .replace(/^./, (c) => c.toUpperCase()),
            ),
          ),
        })
        .click();
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Add selected evidence", exact: true })
      .click();
    await page
      .getByText("Evidence linked to case.", { exact: true })
      .waitFor();
  }
  await page
    .getByRole("button", { name: "Evaluate requirements", exact: true })
    .click();
  await page.waitForURL(/evaluation=/);
  await page
    .getByText("All applicable mandatory requirements are satisfied.", {
      exact: true,
    })
    .waitFor();
  const evaluationUid = new URL(page.url()).searchParams.get("evaluation");
  const evaluation = await request(`/evaluations/${evaluationUid}`);
  assert.equal(evaluation.summary.complete, true);
  assert.equal(evaluation.stale, false);
  await page.screenshot({
    path: resolve(output, "reconciliation.png"),
    fullPage: true,
  });
  console.log(
    "Linked the actual evidence and reached completed reconciliation through the UI.",
  );
  await page.goto(`${base}/persons/${personUid}`);
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Alex Morgan Updated");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Reference profile saved.", { exact: true }).waitFor();
  await page.goto(
    `${base}/reconciliation?person=${personUid}&evaluation=${evaluationUid}`,
  );
  await page.getByText("Out of date", { exact: true }).waitFor();
  console.log(
    "Changed the reference profile and verified the retained evaluation becomes stale.",
  );
  await page.goto(`${base}/document-sets/new_account_requirements`);
  await page
    .getByText("New account requirements", { exact: true })
    .last()
    .waitFor();
  await assertCommandCenterPageLayout(page, {
    viewports: [
      { width: 1024, height: 768, pointer: "fine" },
      { width: 1280, height: 800, pointer: "fine" },
    ],
  });
  console.log(
    "SDK desktop layout verifier passed; production checks cover actual touch contexts.",
  );
  for (const theme of ["main-sequence", "quartz-light"]) {
    await page.goto(`${base}/persons?theme=${theme}`);
    await page
      .getByRole("button", { name: "New person", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(output, `people-${theme}-phone.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(runtimeErrors, []);
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        personUid,
        assignmentUid: assignment.uid,
        evaluationUid,
        documents: submitted,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Browser workflow verification passed. Artifacts: " + output);
} catch (error) {
  await page
    .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw error;
} finally {
  await browser.close();
}
