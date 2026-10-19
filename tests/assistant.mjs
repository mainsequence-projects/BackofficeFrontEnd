// Exercises the real published AI components against their packaged scripted
// platform/runtime. No model call, credentials, or production fixtures are used.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".local/assistant-verification");
await mkdir(output, { recursive: true });
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: resolve(output, "stand-in"),
    lib: {
      entry: resolve(root, "node_modules/@dev-mainsequence/command-center-ai/standalone/stand-in/index.ts"),
      name: "BackOfficeStandIn",
      formats: ["iife"],
      fileName: () => "stand-in.js",
    },
  },
});
const scripted = await readFile(resolve(output, "stand-in/stand-in.js"), "utf8");
// Vite's programmatic build sets NODE_ENV when it was absent. This server must
// exercise the explicit top-level development transport, not the hosted gate.
process.env.NODE_ENV = "development";
const server = await createServer({ root, server: { port: 15178, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const errors = [];
const identity = {
  userUid: "00000000-0000-4000-8000-000000000001",
  environmentUid: "00000000-0000-4000-8000-000000000002",
  agentUid: "00000000-0000-4000-8000-000000000003",
};
let contextStatus = 200;
async function newPage(viewport = { width: 1440, height: 900 }, theme = "main-sequence") {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript({ content: `${scripted}\n{
    const network = window.fetch.bind(window);
    const standIn = BackOfficeStandIn.createStandIn({ latencyMs: 10, chunkDelayMs: 15, passThrough: network });
    window.chatStandIn = standIn;
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/__mainsequence__/api/v1/users/me/')
        return Response.json({uid: standIn.identity.userUid});
      if (url.pathname.startsWith('/__mainsequence__/')) {
        url.pathname = url.pathname.replace('/__mainsequence__', '');
        const forwarded = new Request(url, request);
        forwarded.headers.set('Authorization', 'Bearer scripted-verification-only');
        return standIn.fetch(forwarded);
      }
      return standIn.fetch(request);
    };
  }` });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = { items: [], total_items: 0, has_more: false };
    if (path === "/api/me") data = { user_uid: identity.userUid, can_review: false };
    if (path === "/api/readyz") data = { status: "ready" };
    if (path === "/api/person-schema") data = { type: "object", properties: {} };
    if (path === "/api/assistant/context") {
      await route.fulfill({ status: contextStatus, json: contextStatus === 200 ? identity : { detail: "not configured" } });
      return;
    }
    await route.fulfill({ json: data });
  });
  await page.goto(`http://127.0.0.1:15178/persons?theme=${theme}#case-list`);
  try {
    await page.getByRole("button", { name: "Ask Back Office", exact: true }).waitFor();
  } catch (error) {
    console.error(errors, await page.locator("body").innerText());
    throw error;
  }
  return page;
}
async function send(page, text) {
  const priorTurns = await page.evaluate(() => window.chatStandIn.turns.length);
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  const composer = page.locator(".ms-chat-composer__input");
  await composer.waitFor();
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction((count) => window.chatStandIn.turns.length > count, priorTurns);
}
async function geometry(page, docked) {
  const rail = page.locator("[data-chat-rail]");
  assert.equal(await rail.getAttribute("data-chat-rail"), docked ? "docked" : "overlay");
  const box = await rail.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
  const close = await page.getByRole("button", { name: "Close chat rail" }).boundingBox();
  assert.ok(close && close.x + close.width <= page.viewportSize().width);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const composer = await page.locator(".ms-chat-composer").boundingBox();
  assert.ok(composer && composer.y >= 0 && composer.y + composer.height <= page.viewportSize().height + 1,
    `Composer outside viewport: ${JSON.stringify(composer)}`);
}
try {
  const page = await newPage();
  await page.getByRole("button", { name: "Ask Back Office", exact: true }).click();
  await send(page, "What is missing from this case?");
  await page.getByText(/The scripted stand-in answered/).waitFor();
  await geometry(page, true);
  const separator = page.getByRole("separator", { name: "Resize chat rail" });
  await separator.focus();
  await separator.press("ArrowLeft");
  await page.waitForFunction(() => document.querySelector('[aria-label="Resize chat rail"]')?.getAttribute("aria-valuenow") === "560");
  assert.equal(await separator.getAttribute("aria-valuenow"), "560");
  await separator.press("Home");
  await page.waitForFunction(() => document.querySelector('[aria-label="Resize chat rail"]')?.getAttribute("aria-valuenow") === "360");
  assert.equal(await separator.getAttribute("aria-valuenow"), "360");
  await separator.press("End");
  await page.waitForFunction(() => document.querySelector('[aria-label="Resize chat rail"]')?.getAttribute("aria-valuenow") === "900");
  assert.equal(await separator.getAttribute("aria-valuenow"), "900");
  await separator.dblclick();
  await page.waitForFunction(() => document.querySelector('[aria-label="Resize chat rail"]')?.getAttribute("aria-valuenow") === "540");
  assert.equal(await separator.getAttribute("aria-valuenow"), "540");
  const edge = await separator.boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 60, edge.y + edge.height / 2);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[aria-label="Resize chat rail"]')?.getAttribute("aria-valuenow") === "600");
  const layout = await page.locator(".backoffice-assistant-content").boundingBox();
  const resizedRail = await page.locator("[data-chat-rail]").boundingBox();
  assert.ok(Math.abs(layout.x + layout.width - resizedRail.x) <= 1);
  const session = await page.evaluate(() => window.chatStandIn.turns[0].sessionUid);
  const context = await page.evaluate(() => window.chatStandIn.turns[0].body.context);
  assert.equal(context.app, "backoffice");
  assert.equal(context.section, "persons");
  assert.equal(await page.evaluate(() => window.chatStandIn.sessions[0].handle.handleUniqueId), "backoffice_assistant");
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await page.waitForURL(/\/agent\?session=/);
  assert.equal(new URL(page.url()).searchParams.get("session"), session);
  assert.equal(await page.locator("[data-chat-rail]").count(), 0);
  await send(page, "Explain the current policy.");
  await page.waitForFunction(() => window.chatStandIn.turns.at(-1)?.status === "completed");
  await page.getByRole("button", { name: "Minimize to rail", exact: true }).click();
  await page.waitForURL(/\/persons\?theme=main-sequence#case-list$/);
  await page.getByText(/The scripted stand-in answered/).first().waitFor();
  assert.equal(await page.evaluate(() => window.chatStandIn.turns.at(-1).sessionUid), session);
  await page.evaluate(() => window.chatStandIn.holdReplies());
  await send(page, "Pause this response.");
  await page.waitForFunction(() => window.chatStandIn.turns.at(-1)?.status === "held");
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await page.waitForFunction(() => window.chatStandIn.turns.at(-1)?.status === "stopped");
  await page.evaluate(() => { window.chatStandIn.releaseReplies(); window.chatStandIn.failNextTurn(); });
  await send(page, "Show a tool failure.");
  await page.getByText("The model provider refused the request.", { exact: false }).first().waitFor();
  const failedTurns = await page.evaluate(() => window.chatStandIn.turns.length);
  await page.locator(".ms-chat-message__retry").click();
  await page.waitForFunction((count) => window.chatStandIn.turns.length > count && window.chatStandIn.turns.at(-1)?.status === "completed", failedTurns);
  await page.getByRole("button", { name: "Close chat rail" }).click();
  await page.getByRole("button", { name: "Ask Back Office", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes("Ask Back Office")), true);
  await page.close();

  for (const theme of ["main-sequence", "quartz-light"]) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      const responsive = await newPage(viewport, theme);
      await responsive.getByRole("button", { name: "Ask Back Office", exact: true }).click();
      await send(responsive, "Explain missing evidence.");
      await responsive.getByText(/The scripted stand-in answered/).waitFor();
      await geometry(responsive, viewport.width >= 1400);
      await responsive.screenshot({ path: resolve(output, `${theme}-${viewport.width}.png`) });
      await responsive.close();
    }
  }
  contextStatus = 404;
  const unavailable = await newPage();
  await unavailable.getByRole("button", { name: "Ask Back Office", exact: true }).click();
  await unavailable.getByText("The Back Office agent is not available yet. Try again after it has been deployed.", { exact: true }).waitFor();
  assert.equal(await unavailable.evaluate(() => window.chatStandIn.sessions.length), 0);
  contextStatus = 200;
  await unavailable.getByRole("button", { name: "Retry assistant connection" }).click();
  await send(unavailable, "Reconnect to the agent.");
  await unavailable.getByText(/The scripted stand-in answered/).waitFor();
  const scopedRequests = await unavailable.evaluate(() => window.chatStandIn.findRequests("GET", "/api/v1/agent-sessions/").map((request) => request.query.get("organization_environment_uid")));
  assert.ok(scopedRequests.length > 0);
  assert.ok(scopedRequests.every((uid) => uid === identity.environmentUid));
  // AI 0.0.15 also emits its intentionally refused stream as an unhandled
  // rejection. Its failure UI is asserted above; no other browser error is allowed.
  assert.deepEqual(errors, ["Source: Receiving the Agent's reply. The model provider refused the request."]);
  console.log("Assistant passed: streaming, context, shared expanded/rail session, path restoration, resize controls, stop, failure, reconnect, phone and desktop themes.");
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.error("Assistant browser failure:", errors, (await page.locator("body").innerText()).slice(0, 6000));
      await page.screenshot({ path: resolve(output, "failure.png") });
    }
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
}
