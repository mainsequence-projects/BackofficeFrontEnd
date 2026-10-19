// Real application and SDK, with policy responses isolated from live settings.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { assertCommandCenterPageLayout, COMMAND_CENTER_LAYOUT_VIEWPORTS } from "@dev-mainsequence/command-center-sdk/layout/testing";

const root = resolve(import.meta.dirname, "..");
const origin = "http://127.0.0.1:15191";
const output = resolve(root, ".local/admin-overview");
await mkdir(output, { recursive: true });
const kinds = ["passport", "utility_bill", "national_identity_card", "employer_confirmation", ...Array.from({ length: 25 }, (_, i) => `verification_document_${i + 1}`)];
const types = kinds.map((document_type) => ({ document_type, name: document_type, schema_version: 1, description: "Synthetic policy verification" }));
const policies = new Map(kinds.map((document_type) => [document_type, {
  document_type, score_kind: "classification_confidence", revision: 2,
  automatic_acceptance_enabled: true, acceptance_threshold_percent: document_type === "passport" ? "60.00" : "90.00",
  changed_at: "2026-10-19T12:00:00Z",
}]));
const writes = [];
policies.set("national_identity_card", {
  ...policies.get("national_identity_card"), revision: 0,
  automatic_acceptance_enabled: true, acceptance_threshold_percent: "80.00", changed_at: null,
});
const errors = [];
let failedType = "employer_confirmation";
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 15191, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
async function mock(target, { admin = true, catalog = types, onSettings = () => {} } = {}) {
  await target.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(4);
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (path === "/admin/parsing-settings") {
      onSettings();
      if (!admin) return send({ detail: "organization_admin_required" }, 403);
      if (request.method() === "GET") {
        const kind = url.searchParams.get("document_type");
        if (kind === failedType) return send({ detail: "This policy is temporarily unavailable" }, 503);
        return send(policies.get(kind));
      }
      assert.equal(request.method(), "PUT");
      const body = request.postDataJSON();
      writes.push(body);
      const current = policies.get(body.document_type);
      if (body.expected_revision !== current.revision) return send({ detail: "parsing_policy_revision_conflict" }, 409);
      const next = { ...current, revision: current.revision + 1, automatic_acceptance_enabled: body.automatic_acceptance_enabled,
        acceptance_threshold_percent: body.acceptance_threshold_percent === null ? null : Number(body.acceptance_threshold_percent).toFixed(2) };
      policies.set(body.document_type, next);
      return send(next);
    }
    assert.equal(request.method(), "GET", `Unexpected mutation: ${path}`);
    if (path === "/me") return send({ user_uid: "00000000-0000-4000-8000-000000000001", can_review: true, is_organization_admin: admin });
    if (path === "/readyz") return send({ status: "ready" });
    if (path === "/document-types") return send({ items: catalog });
    if (path === "/person-schema") return send({ type: "object", properties: {} });
    return send({ items: [], total_items: 0, has_more: false });
  });
}
const card = (kind) => page.locator(`[data-document-type="${kind}"]`);
const threshold = (kind) => card(kind).getByRole("spinbutton", { name: /^Acceptance threshold/ });
const save = (kind) => card(kind).getByRole("button", { name: "Save parsing settings", exact: true }).click();
async function valueIs(kind, value) {
  await page.waitForFunction(({ kind, value }) => document.getElementById(`parsing-threshold-${kind}`)?.value === value, { kind, value });
}
try {
  await mock(page);
  await page.goto(`${origin}/admin`);
  await threshold("passport").waitFor();
  await valueIs("national_identity_card", "80.00");
  assert.equal(await card("national_identity_card").getByRole("button", { name: "Automatic acceptance", exact: true }).getAttribute("aria-pressed"), "true");
  await card("national_identity_card").getByText("Default · On at 80%", { exact: true }).waitFor();
  await card(failedType).getByRole("button", { name: "Retry settings" }).waitFor();
  assert.equal(await page.locator("[data-document-type]").count(), types.length, "The complete catalog must be shown, including types beyond the default page size.");
  const listRows = await page.locator("[data-document-type]").evaluateAll((rows) => rows.map((row) => {
    const bounds = row.getBoundingClientRect();
    return { x: bounds.x, top: bounds.top, bottom: bounds.bottom, width: bounds.width, inTable: Boolean(row.closest("tr")) };
  }));
  assert.ok(listRows.every((row) => row.inTable), "Every policy belongs to a list row, not a card grid.");
  assert.ok(listRows.every((row, index) => row.x === listRows[0].x && row.width === listRows[0].width && (!index || row.top >= listRows[index - 1].bottom)), "Policies must form one vertical list with one full-width row per document type.");
  assert.equal(await page.getByLabel("Document type", { exact: true }).count(), 0);
  assert.equal(await threshold("passport").inputValue(), "60.00");
  await threshold("utility_bill").fill("91");
  await threshold("passport").fill("61");
  await save("passport");
  await valueIs("passport", "61.00");
  assert.equal(writes.at(-1).document_type, "passport");
  assert.equal(writes.at(-1).expected_revision, 2);
  assert.equal(await threshold("utility_bill").inputValue(), "91", "Saving one card must preserve another card's draft.");
  assert.equal(policies.get("utility_bill").acceptance_threshold_percent, "90.00");
  await card("utility_bill").getByText("Unsaved changes", { exact: true }).waitFor();

  policies.set("passport", { ...policies.get("passport"), revision: 4, acceptance_threshold_percent: "65.00" });
  await threshold("passport").fill("62");
  await save("passport");
  await card("passport").getByRole("button", { name: "Reload saved settings" }).waitFor();
  assert.equal(await threshold("passport").inputValue(), "62");
  await card("passport").getByRole("button", { name: "Reload saved settings" }).click();
  await valueIs("passport", "65.00");
  assert.equal(await threshold("utility_bill").inputValue(), "91");
  const beforeInvalid = writes.length;
  await threshold("passport").fill("101");
  await save("passport");
  assert.equal(await threshold("passport").evaluate((input) => input.validity.rangeOverflow), true);
  assert.equal(writes.length, beforeInvalid);
  await threshold("passport").fill("64");
  await save("passport");
  await valueIs("passport", "64.00");
  assert.equal(writes.at(-1).expected_revision, 4);

  const retryKind = failedType;
  failedType = null;
  await card(retryKind).getByRole("button", { name: "Retry settings" }).click();
  await threshold(retryKind).waitFor();
  assert.equal(await threshold("utility_bill").inputValue(), "91");
  assert.equal(await page.getByRole("spinbutton").count(), types.length);
  await page.reload();
  await valueIs("passport", "64.00");
  await valueIs("utility_bill", "90.00");
  await page.screenshot({ path: resolve(output, "overview-dark.png"), fullPage: false });

  for (const theme of ["main-sequence", "quartz-light"]) {
    for (const pointer of ["fine", "coarse"]) {
      const context = await browser.newContext({ hasTouch: pointer === "coarse", isMobile: pointer === "coarse" });
      const responsive = await context.newPage();
      await mock(responsive);
      await responsive.goto(`${origin}/admin?theme=${theme}`);
      await responsive.locator("[data-document-type=passport]").getByRole("spinbutton").waitFor();
      await assertCommandCenterPageLayout(responsive, { viewports: COMMAND_CENTER_LAYOUT_VIEWPORTS.filter((size) => size.pointer === pointer) });
      if (pointer === "coarse") {
        await responsive.setViewportSize({ width: 375, height: 812 });
        await responsive.screenshot({ path: resolve(output, `overview-phone-${theme}.png`), fullPage: false });
      }
      await context.close();
    }
  }
  for (const mode of ["restricted", "empty"]) {
    const isolated = await browser.newPage();
    let settingsReads = 0;
    await mock(isolated, { admin: mode !== "restricted", catalog: mode === "empty" ? [] : types, onSettings: () => settingsReads++ });
    await isolated.goto(`${origin}/admin`);
    await isolated.getByText(mode === "restricted" ? "Organization administrator access is required." : "No document types are available. Reload the document catalog before configuring acceptance.", { exact: true }).waitFor();
    assert.equal(settingsReads, 0);
    await isolated.close();
  }
  assert.deepEqual(errors, []);
  console.log("Admin overview passed: full catalog, isolated saves and drafts, revision conflicts, validation, row retries, reload, admin guard, empty catalog, and SDK geometry in dark/light across phone/tablet/desktop.");
} catch (error) {
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: false }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await server.close();
}
