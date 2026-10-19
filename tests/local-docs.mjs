import assert from "node:assert/strict";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 15181, strictPort: true, hmr: false },
});
await server.listen();
const origin = "http://127.0.0.1:15181";
try {
  const redirect = await fetch(origin + "/docs?theme=dark", { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/docs/?theme=dark");
  const pages = ["", "persons/", "documents/", "document-sets/", "reconciliation/", "agent/", "admin/"];
  const responses = await Promise.all(pages.map((path) => fetch(origin + "/docs/" + path)));
  for (const response of responses) {
    assert.equal(response.status, 200, response.url);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /docusaurus/i);
    assert.doesNotMatch(html, /\/src\/main\.tsx/);
    const script = html.match(/src="(\/docs\/assets\/js\/[^"\s]+)"/);
    assert.ok(script, "The guide includes its actual compiled JavaScript.");
    const asset = await fetch(origin + script[1]);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
  }
  const head = await fetch(origin + "/docs/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(origin + "/docs/missing-page/")).status, 404);
  assert.equal((await fetch(origin + "/docs/", { method: "POST" })).status, 405);
  const traversalStatus = await new Promise((resolve, reject) => {
    request(origin, { path: "/docs/..%2Fpackage.json" }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject).end();
  });
  assert.equal(traversalStatus, 403);
  console.log("Local guide passed: seven real pages, compiled assets, concurrent first build, redirect, HEAD, missing pages, method and path guards.");
} finally {
  await server.close();
}
