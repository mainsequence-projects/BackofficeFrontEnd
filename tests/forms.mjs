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
assert.equal(kinds.length, 10);
const schemas = Object.fromEntries(
  await Promise.all(
    kinds.map(async (kind) => [
      kind,
      JSON.parse(
        await readFile(
          resolve(backend, `schemas/documents/${kind}/v1.json`),
          "utf8",
        ),
      ),
    ]),
  ),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const uid = "00000000-0000-4000-8000-000000000002";
const person = "00000000-0000-4000-8000-000000000003";
let kind = kinds[0],
  payload = {},
  saved;
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname.slice(4);
  let result;
  if (path === "/me") result = { user_uid: person, can_review: true };
  else if (path === "/readyz") result = { status: "ready" };
  else if (path === "/document-types")
    result = {
      items: kinds.map((k) => ({
        document_type: k,
        schema_version: 1,
        name: k,
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
      schema_version: 1,
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
  else if (path.startsWith("/document-types/")) result = schemas[kind];
  else throw Error("Unexpected contract request: " + path);
  await route.fulfill({ json: result });
});
try {
  for (kind of kinds) {
    payload = { document_type: kind };
    await page.goto(`${base}/documents/${uid}`);
    await page.getByText("Document attributes", { exact: true }).waitFor();
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
    await setValues(page, schemas[kind].canonical_schema, fixture);
    const submitted = new Promise((resolve) => (saved = resolve));
    await page
      .getByRole("button", { name: "Save draft revision", exact: true })
      .click();
    const command = await submitted;
    assert.deepEqual(command.payload, fixture, kind);
    assert.equal(command.expected_revision, 1);
    assert.match(command.operation_key, /^[0-9a-f-]{36}$/);
    console.log("Schema-driven field entry preserved backend fixture: " + kind);
  }
  assert.deepEqual(errors, []);
  console.log("All ten backend schema renderer contracts passed.");
} finally {
  await browser.close();
}
