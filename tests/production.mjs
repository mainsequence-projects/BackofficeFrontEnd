// Test-only Command Center host around the built artifact and the real isolated API.
// This server and its local verification credential are never included in dist.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertCommandCenterApplicationShell } from "@dev-mainsequence/command-center-sdk/navigation/testing";
import { assertCommandCenterPageLayout } from "@dev-mainsequence/command-center-sdk/layout/testing";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const origin = "http://127.0.0.1:15175";
const gateway = "http://127.0.0.1:18001";
const rpcOrigin = "http://127.0.0.1:15176";
const health = await (await fetch(`${gateway}/healthz`)).json();
assert.equal(health.metatables?.local_mode, true);
assert.equal(health.metatables?.dialect, "sqlite");
const viewer = await (await fetch(`${gateway}/me`)).json();
const sdk = resolve(
  root,
  "node_modules/@dev-mainsequence/command-center-sdk/dist",
);
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Back Office verification host</title></head><body style="margin:0"><script type="module">
import {createStaticSiteIframeHost} from '/__sdk__/embed/static-site.js';
const iframe=document.createElement('iframe');iframe.title='Back Office';iframe.style='width:100%;height:100dvh;border:0';document.body.append(iframe);
const theme=new URLSearchParams(location.search).get('theme') || 'main-sequence';
const host=createStaticSiteIframeHost({targetOrigin:location.origin,targetWindow:iframe.contentWindow,
context:{themeId:theme,themeMode:theme==='quartz-light'?'light':'dark',userUid:${JSON.stringify(viewer.user_uid)}},
resolveFastApiCredential:async()=>({resourceReleaseUid:'00000000-0000-4000-8000-000000000001',rpcUrl:${JSON.stringify(rpcOrigin)},token:'local-verification-only',expiresAt:new Date(Date.now()+240000).toISOString()})});
window.addEventListener('message',event=>host.handleMessage(event));iframe.src='/persons';
</script></body></html>`;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === "/__host__/") {
      response.setHeader("Content-Type", "text/html");
      response.end(host);
      return;
    }
    const base = url.pathname.startsWith("/__sdk__/") ? sdk : dist;
    let file = resolve(
      base,
      "." +
        (base === sdk
          ? url.pathname.slice("/__sdk__".length)
          : decodeURIComponent(url.pathname)),
    );
    if (relative(base, file).startsWith("..")) throw Error("Invalid path");
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      file = url.pathname.startsWith("/docs/")
        ? file
        : resolve(dist, "index.html");
    }
    response.setHeader(
      "Content-Type",
      mime[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(15175, "127.0.0.1", resolve));
const apiServer = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type,x-resource-release-uid",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.statusCode = 405;
    response.end();
    return;
  }
  try {
    const url = new URL(request.url, rpcOrigin);

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const upstream = await fetch(gateway + url.pathname + url.search, {
      method: request.method,
      headers: {
        "Content-Type": request.headers["content-type"] ?? "application/json",
        Origin: "http://127.0.0.1:15174",
      },
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : Buffer.concat(chunks),
    });
    response.statusCode = upstream.status;
    response.setHeader(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/json",
    );
    response.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  } catch {
    response.statusCode = 502;
    response.end("Local verification gateway unavailable");
  }
});
await new Promise((resolve) => apiServer.listen(15176, "127.0.0.1", resolve));
const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = resolve(root, ".local/browser-results");
await mkdir(output, { recursive: true });
try {
  await page.goto(origin + "/persons");
  await page
    .getByText("Back Office could not start", { exact: true })
    .waitFor();
  await assertCommandCenterApplicationShell(page, {
    navigationDepth: 1,
    phase: "startup",
  });
  assert.equal(
    await page.getByRole("button", { name: "New person", exact: true }).count(),
    0,
  );
  console.log(
    "Production direct link correctly requires the trusted Command Center host.",
  );
  for (const device of [
    {
      name: "touch",
      hasTouch: true,
      isMobile: true,
      viewports: [
        { width: 320, height: 568, pointer: "coarse" },
        { width: 375, height: 812, pointer: "coarse" },
        { width: 812, height: 375, pointer: "coarse" },
        { width: 768, height: 1024, pointer: "coarse" },
      ],
    },
    {
      name: "desktop",
      hasTouch: false,
      isMobile: false,
      viewports: [
        { width: 1024, height: 768, pointer: "fine" },
        { width: 1280, height: 800, pointer: "fine" },
      ],
    },
  ]) {
    for (const theme of ["main-sequence", "quartz-light"]) {
      // Full-page capture resets Chromium touch emulation; isolate each device/theme
      // and capture only after all geometry assertions for that page.
      await page.close();
      page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        hasTouch: device.hasTouch,
        isMobile: device.isMobile,
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/__host__/?theme=" + theme);
      await page
        .frameLocator("iframe")
        .getByRole("button", { name: "New person", exact: true })
        .waitFor({ timeout: 60000 });
      const frame = page
        .frames()
        .find((f) => f.url().startsWith(origin + "/persons"));
      assert(frame);
      await assertCommandCenterApplicationShell(frame, {
        navigationDepth: 1,
        phase: "ready",
      });
      await frame
        .getByRole("button", { name: "New person", exact: true })
        .click();
      await frame
        .getByRole("button", { name: "Create person", exact: true })
        .waitFor();
      await assertCommandCenterPageLayout(
        {
          evaluate: frame.evaluate.bind(frame),
          setViewportSize: async (size) => {
            await page.setViewportSize(size);
            await frame.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
          },
          viewportSize: page.viewportSize.bind(page),
        },
        { viewports: device.viewports },
      );
      console.log(
        "Embedded production artifact passed SDK shell and responsive form layout: " +
          theme +
          " " +
          device.name,
      );
      await frame
        .getByRole("link", { name: "Document Sets", exact: true })
        .click();
      await frame
        .getByText("New account requirements", { exact: true })
        .click();
      await frame.getByText("Published version", { exact: true }).waitFor();
      await assertCommandCenterPageLayout(
        {
          evaluate: frame.evaluate.bind(frame),
          setViewportSize: async (size) => {
            await page.setViewportSize(size);
            await frame.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
          },
          viewportSize: page.viewportSize.bind(page),
        },
        { viewports: device.viewports },
      );
      console.log(
        "Published policy layout passed: " + theme + " " + device.name,
      );
      await page.screenshot({
        path: resolve(output, `production-${theme}-${device.name}.png`),
        fullPage: true,
      });
    }
  }
  for (const path of [
    "/docs/",
    "/docs/persons/",
    "/docs/documents/",
    "/docs/document-sets/",
    "/docs/reconciliation/",
  ]) {
    const response = await page.goto(origin + path);
    assert.equal(response.status(), 200, path);
    await page.locator("h1").waitFor();
    assert(!(await page.title()).includes("404"), path);
    console.log("Built guide route verified: " + path);
  }
  assert.deepEqual(errors, []);
  console.log("Production artifact verification passed.");
} catch (error) {
  await page.setViewportSize({ width: 320, height: 568 });
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (frame)
    console.log(
      "Layout diagnostic",
      await frame.evaluate(() => {
        const el = document.querySelector(".cc-resource-breadcrumbs button");
        const root = document
          .querySelector("[data-cc-application-page]")
          ?.getBoundingClientRect();
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          width: innerWidth,
          controlSize: getComputedStyle(
            document.documentElement,
          ).getPropertyValue("--application-control-min-size"),
          root: root?.toJSON(),
          breadcrumb: el
            ? {
                minSize: getComputedStyle(el).minBlockSize,
                height: el.getBoundingClientRect().height,
              }
            : null,
          controls: [...document.querySelectorAll("button,input")]
            .slice(-8)
            .map((e) => ({
              id: e.id,
              text: e.textContent?.slice(0, 35),
              box: e.getBoundingClientRect().toJSON(),
            })),
        };
      }),
    );
  await page
    .screenshot({
      path: resolve(output, "production-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  throw new Error(error.message);
} finally {
  await browser.close();
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => apiServer.close(resolve)),
  ]);
}
