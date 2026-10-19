// Renderer contract checks use the backend's generated schemas and fixtures.
// The separate browser workflow exercises the real API and authoritative results.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { setValues } from "./form-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend =
  process.env.BACKOFFICE_BACKEND_DIR ??
  resolve(root, "../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
const base = process.env.BACKOFFICE_TEST_URL ?? "http://127.0.0.1:15174";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const kinds = (await readdir(resolve(backend, "schemas/documents"))).sort();
assert.equal(kinds.length, 13);
const contracts = (
  await Promise.all(
    kinds.map(async (kind) => {
      const folder = resolve(backend, `schemas/documents/${kind}`);
      const files = (await readdir(folder))
        .filter((name) => /^v\d+\.json$/.test(name))
        .sort();
      return Promise.all(
        files.map(async (name) =>
          JSON.parse(await readFile(resolve(folder, name), "utf8")),
        ),
      );
    }),
  )
).flat();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const uid = "00000000-0000-4000-8000-000000000002";
const person = "00000000-0000-4000-8000-000000000003";
let kind = kinds[0],
  schema = contracts[0],
  payload = {},
  saved;
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname.slice(4);
  let result;
  if (path === "/me") result = { user_uid: person, can_review: true };
  else if (path === "/readyz") result = { status: "ready" };
  else if (path === "/document-types")
    result = {
      items: contracts.map((contract) => ({
        document_type: contract.document_type,
        schema_version: contract.version,
        name: contract.document_type,
      })),
    };
  else if (path === "/person-schema")
    result = { type: "object", properties: {} };
  else if (path === "/document-sets") result = { items: [] };
  else if (path === `/documents/${uid}/draft`) {
    const command = route.request().postDataJSON();
    payload = command.payload;
    saved(command);
    result = { uid, revision: 2 };
  } else if (path === `/documents/${uid}`)
    result = {
      uid,
      person_uid: person,
      document_type: kind,
      revision: 1,
      schema_version: schema.version,
      status: "draft",
      review_status: "not_reviewed",
      accepted: false,
      payload,
      raw_document_refs: [],
    };
  else if (path === `/persons/${person}`)
    result = {
      uid: person,
      full_name: "Schema contract verification",
      revision: 1,
    };
  else if (path.startsWith("/document-types/")) {
    const version = Number(new URL(route.request().url()).searchParams.get("version"));
    result = contracts.find(
      (contract) => path === `/document-types/${contract.document_type}/schema`
        && version === contract.version,
    );
    assert(result, `Unknown schema request: ${route.request().url()}`);
  } else throw Error("Unexpected contract request: " + path);
  await route.fulfill({ json: result });
});
try {
  for (schema of contracts) {
    kind = schema.document_type;
    payload = { document_type: kind };
    const expectedPath = `/api/document-types/${kind}/schema`;
    const expectedVersion = String(schema.version);
    const schemaLoaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === expectedPath && url.searchParams.get("version") === expectedVersion;
    });
    await page.goto(`${base}/documents/${uid}`);
    await schemaLoaded;
    await page.getByText("Document attributes", { exact: true }).waitFor();
    await page.locator('[id^="document."]').first().waitFor();
    for (const key of Object.keys(schema.canonical_schema.properties)) {
      if (schema.canonical_schema.required?.includes(key)) continue;
      const labels = page.locator(
        `label[for="document.${key}"], label[for^="document.${key}."]`,
      );
      for (const label of await labels.all()) {
        const field = label.locator("..");
        assert.equal(await field.getAttribute("aria-invalid"), null,
          `${kind} v${schema.version}: absent optional ${await label.getAttribute("for")} must not be invalid`);
        assert.equal(await field.getAttribute("data-required"), null,
          `${kind} v${schema.version}: absent optional ${key} must not require nested fields`);
      }
    }
    if (kind === "national_identity_card") {
      assert.equal(await page.locator('[id="document.full_name"]').getAttribute("aria-invalid"), "true");
      assert.equal(await page.locator('[id="document.issue_date"]').getAttribute("aria-invalid"), null);
      assert.equal(await page.locator('label[for="document.issue_date"]').locator("..").locator(".schema-optional-hint").innerText(), "Optional — not provided");
      assert.equal(await page.locator('label[for="document.validity_type"]').locator("..").getAttribute("data-required"),
        schema.version === 1 ? "" : null);
    }
    if (kind === "bank_statement") {
      // Optional money becomes subject to its nested requirements only when entered.
      const amount = page.locator('[id="document.opening_balance.amount"]');
      const currency = page.locator('label[for="document.opening_balance.currency"]').locator("..");
      await amount.fill("100");
      assert.equal(await currency.getAttribute("aria-invalid"), "true");
      await page.getByRole("button", { name: "Remove opening balance", exact: true }).click();
      assert.equal(await currency.getAttribute("aria-invalid"), null);
    }
    const fixture = JSON.parse(
      await readFile(
        resolve(backend, `tests/fixtures/documents/${kind}.json`),
        "utf8",
      ),
    );
    // Include nested object arrays and high precision money in addition to fixtures.
    if (kind === "bank_statement")
      fixture.transactions = [
        {
          booking_date: "2026-08-20",
          amount: { amount: "123456789.123456789", currency: "EUR" },
          description: "Nested transaction verification",
        },
      ];
    await setValues(page, schema.canonical_schema, fixture, schema.canonical_schema, page, "document");
    const submitted = new Promise((resolve) => (saved = resolve));
    await page
      .getByRole("button", { name: "Save draft revision", exact: true })
      .click();
    const command = await submitted;
    await page.getByText("New draft revision saved.", { exact: true }).waitFor();
    assert.deepEqual(command.payload, fixture, kind);
    assert.equal(command.expected_revision, 1);
    assert.match(command.operation_key, /^[0-9a-f-]{36}$/);
    // Stop the previous document's post-save refresh before switching fixtures.
    await page.goto("about:blank");
    console.log(`Schema-driven field entry preserved backend fixture: ${kind} v${schema.version}`);
  }
  assert.deepEqual(errors, []);
  console.log(`All ${contracts.length} backend schema renderer contracts passed.`);
} finally {
  await browser.close();
}
