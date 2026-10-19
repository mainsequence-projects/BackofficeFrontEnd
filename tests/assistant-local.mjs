// Exercise the local source through the real SDK Vite proxy. Only the Tau
// runtime is scripted; this makes missing/misdirected proxies a test failure.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, createServer } from "vite";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".local/assistant-local-verification");
await mkdir(output, { recursive: true });
await build({
  configFile: false,
  logLevel: "error",
  build: {
    outDir: resolve(output, "runtime"),
    lib: {
      entry: resolve(root, "node_modules/@dev-mainsequence/command-center-ai/standalone/stand-in/local-runtime.ts"),
      formats: ["es"],
      fileName: () => "runtime.mjs",
    },
  },
});
const { createLocalRuntimeStandIn } = await import(pathToFileURL(resolve(output, "runtime/runtime.mjs")));
const runtime = createLocalRuntimeStandIn({ agentName: "Back Office Helper", chunkDelayMs: 10 });
let online = true;
const forwarded = [];
const tau = createHttpServer(async (request, response) => {
  forwarded.push({ path: request.url, headers: request.headers });
  if (!online) { response.writeHead(503).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const result = await runtime.fetch(`http://127.0.0.1:15179/__agent__${request.url}`, {
    method: request.method,
    body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
  });
  response.writeHead(result.status, Object.fromEntries(result.headers));
  if (result.body) for await (const chunk of result.body) response.write(chunk);
  response.end();
});
await new Promise((done) => tau.listen(15179, "127.0.0.1", done));
process.env.NODE_ENV = "development";
process.env.MAINSEQUENCE_TAU_LOCAL_ORIGIN = "http://127.0.0.1:15179";
const server = await createServer({ root, logLevel: "error", server: { port: 15180, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch();
const errors = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.route("http://127.0.0.1:15180/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = path === "/api/me" ? { user_uid: "00000000-0000-4000-8000-000000000001", can_review: false }
        : path === "/api/readyz" ? { status: "ready" }
        : path === "/api/person-schema" ? { type: "object", properties: {} }
        : { items: [], total_items: 0, has_more: false };
      return route.fulfill({ json: data });
    });
    await page.goto("http://127.0.0.1:15180/persons?theme=main-sequence#case-list");
    await page.getByRole("button", { name: "Ask Back Office", exact: true }).click();
    const prompt = `Local rail verification ${viewport.width}`;
    await page.locator(".ms-chat-composer__input").fill(prompt);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText(/The scripted stand-in answered/).first().waitFor();
    await page.getByRole("button", { name: "Stop session", exact: true }).waitFor({ state: "hidden" });
    const turn = runtime.requests.filter((request) => request.method === "POST" && request.path === "/api/chat").at(-1);
    assert.equal(turn.body.context.app, "backoffice");
    assert.equal(turn.body.context.section, "persons");
    const session = runtime.sessions.find((candidate) => candidate.messages.some((message) =>
      message.role === "user" && message.content.some((part) => part.type === "text" && part.text === prompt)));
    assert.ok(session);
    await page.getByRole("button", { name: "Expand", exact: true }).click();
    await page.waitForURL(/\/agent\?session=/);
    assert.equal(new URL(page.url()).searchParams.get("session"), session.uid);
    if (!(await page.getByRole("button", { name: "Minimize to rail", exact: true }).isVisible()))
      await page.getByRole("button", { name: "Open Agents", exact: true }).click();
    await page.getByRole("button", { name: "Minimize to rail", exact: true }).click();
    await page.waitForURL(/\/persons\?theme=main-sequence#case-list$/);
    await page.getByRole("button", { name: "Close chat rail" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Ask Back Office", exact: true }).click();
    await page.getByText(prompt, { exact: true }).first().waitFor();
    assert.equal(requests.includes("/api/assistant/context"), false);
    assert.equal(requests.some((path) => path.startsWith("/__mainsequence__/")), false);
    assert.equal(requests.some((path) => path.startsWith("/__agent__/")), true);
    await page.screenshot({ path: resolve(output, `local-${viewport.width}.png`) });
    await page.close();
  }
  const origin = "http://127.0.0.1:15180";
  const denied = await fetch(`${origin}/__agent__/api/a2a/v1/tasks`, { headers: { Origin: origin } });
  assert.equal(denied.status, 404);
  const foreign = await fetch(`${origin}/__agent__/ready`, { headers: { Origin: "https://example.com" } });
  assert.equal(foreign.status, 403);
  await fetch(`${origin}/__agent__/ready`, { headers: { Origin: origin, Authorization: "Bearer test-only", "X-Caller-Uid": "test-only" } });
  assert.equal(forwarded.at(-1).headers.authorization, undefined);
  assert.equal(forwarded.at(-1).headers["x-caller-uid"], undefined);
  online = false;
  const unavailable = await fetch(`${origin}/__agent__/ready`, { headers: { Origin: origin } });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(errors, []);
  console.log("Local assistant passed: SDK proxy, streamed reply, case context, expanded/rail continuity, reload history, desktop/phone, local route and origin guards, credential stripping and unavailable runtime.");
} finally {
  await browser.close();
  await server.close();
  await new Promise((done) => tau.close(done));
}
