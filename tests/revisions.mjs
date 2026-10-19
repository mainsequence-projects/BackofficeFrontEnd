import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BACKOFFICE_TEST_URL ?? "http://127.0.0.1:15174";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const uid =
  process.env.BACKOFFICE_TEST_DOCUMENT ??
  JSON.parse(
    await readFile(resolve(root, ".local/browser-results/result.json"), "utf8"),
  ).documents[0];
async function get(path) {
  const response = await fetch(base + "/api" + path);
  assert(response.ok, path + " " + response.status);
  return response.json();
}
const health = await get("/healthz");
assert.equal(health.metatables.local_mode, true);
assert.equal(health.metatables.dialect, "sqlite");
const current = await get(`/documents/${uid}`);
const existingDraft=current.status==='draft'&&current.payload.identity_number==='009988';
const original=existingDraft?await get(`/documents/${uid}/revisions/${current.revision-1}`):current;
const person = await get(`/persons/${original.person_uid}`);
assert(person.external_reference?.startsWith("browser-verification-"));
assert.equal(original.document_type, "national_identity_card");
assert.equal(original.accepted, true);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = resolve(root, ".local/browser-results");
await mkdir(output, { recursive: true });
try {
  if(!existingDraft){
  await page.goto(`${base}/documents/${uid}`);
  await page.getByLabel(/^Identity number/).fill("009988");
  await page
    .getByRole("button", { name: "Save draft revision", exact: true })
    .click();
  await page.getByText("New draft revision saved.", { exact: true }).waitFor();
  }
  const latest = await get(`/documents/${uid}`);
  assert.equal(latest.revision, original.revision + 1);
  assert.equal(latest.status, "draft");
  assert.equal(latest.accepted, false);
  await page.goto(`${base}/documents/${uid}?revision=${original.revision}`);
  await page
    .getByText(new RegExp(`^Retained revision ${original.revision}\\.`))
    .waitFor();
  assert.equal(
    await page.getByLabel(/^Identity number/).inputValue(),
    original.payload.identity_number,
  );
  assert.equal(await page.getByLabel(/^Identity number/).isDisabled(), true);
  await page.getByText(/Verified source$/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Save draft revision", exact: true })
      .count(),
    0,
  );
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await page.getByText("Accepted", { exact: true }).last().waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Accept revision", exact: true })
      .count(),
    0,
  );
  const retained = await get(
    `/documents/${uid}/revisions/${original.revision}`,
  );
  assert.deepEqual(retained.payload, original.payload);
  assert.equal(retained.accepted, true);
  assert.equal((await get(`/documents/${uid}`)).revision, latest.revision);
  await page.screenshot({
    path: resolve(output, "retained-revision.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "New draft creation and exact retained revision/source/review view passed against the real API.",
  );
} catch (error) {
  await page
    .screenshot({
      path: resolve(output, "revision-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
