// Tree reader and builder verification: isolated API fixtures, real SDK and browser.
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { assertCommandCenterPageLayout } from "@dev-mainsequence/command-center-sdk/layout/testing";

const backend = resolve("../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
const policy = JSON.parse(await readFile(resolve(backend, "schemas/document_sets/loan_requirements.v5.json"), "utf8"));
const schemas = [];
for (const type of await readdir(resolve(backend, "schemas/documents"))) {
  for (const file of await readdir(resolve(backend, "schemas/documents", type))) {
    if (/^v\d+\.json$/.test(file)) schemas.push(JSON.parse(await readFile(resolve(backend, "schemas/documents", type, file), "utf8")));
  }
}
const latest = schemas.filter((s) => !schemas.some((n) => n.document_type === s.document_type && n.version > s.version));
const origin = "http://127.0.0.1:15193";
const output = resolve(".local/document-set-verification");
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 15193, strictPort: true, hmr: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let admin = true, failure = false, created, saved, posts = 0;
const sets = Array.from({length: 101}, (_, i) => ({ ...structuredClone(policy), key: i === 0 ? policy.key : "fixture_" + i, name: i === 0 ? policy.name : "Fixture " + i }));
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url()), path = url.pathname.slice(4);
  let result;
  if (path === "/me") result = { user_uid: "00000000-0000-4000-8000-000000000001", can_review: true, is_organization_admin: admin };
  else if (path === "/readyz") result = { status: "ready" };
  else if (path === "/person-schema") result = {};
  else if (path === "/document-types") result = { items: latest.map((s) => ({ document_type: s.document_type, schema_version: s.version, name: s.document_type })) };
  else if (path.startsWith("/document-types/")) result = schemas.find((s) => path === "/document-types/" + s.document_type + "/schema" && s.version === Number(url.searchParams.get("version")));
  else if (path === "/case-types") result = { items: [{ key: "new_loan", name: "New loan", document_sets: sets.map((s) => ({key:s.key, version:s.version})) }] };
  else if (path === "/document-sets") {
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 50);
    const all = created ? [...sets, created] : sets;
    result = { items: all.slice(offset, offset + limit), total_items: all.length, has_more: offset + limit < all.length };
  } else if (path.startsWith("/document-sets/")) {
    result = [policy, created].filter(Boolean).find((s) => path === "/document-sets/" + s.key + "/versions/" + s.version);
    if (!result) return route.fulfill({ status: 404, json: {detail:"document_set_version_not_found"} });
  } else if (path === "/admin/document-sets") {
    posts++;
    saved = route.request().postDataJSON();
    if (failure) return route.fulfill({ status: 409, json: {detail:"document_set_key_already_exists_choose_a_new_key"} });
    created = saved.definition;
    result = created;
  } else if (path === "/assistant/context") return route.fulfill({status:503,json:{detail:"not_configured"}});
  else return route.fulfill({status:404,json:{detail:"unhandled_test_route"}});
  await route.fulfill({ json: result });
});
function settled(target) { return { viewportSize: () => target.viewportSize(), evaluate: (fn,arg) => target.evaluate(fn,arg), async setViewportSize(size) { await target.setViewportSize(size); await target.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); } }; }
async function pick(label, name, multi = false) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  if (multi) await page.keyboard.press("Escape");
}
try {
  await page.goto(origin + "/document-sets/" + policy.key + "?version=5");
  const tree = page.getByRole("navigation", {name:"Document set explorer"});
  const detail = page.getByRole("region", {name:"Selected item details"});
  await tree.getByRole("button", {name:"Identity Required · 1 min", exact:true}).click();
  await detail.getByRole("button", {name:/National identity card/}).click();
  await detail.getByRole("heading", {name:"National identity card", exact:true}).waitFor();
  assert.equal(await detail.getByText("full_name", {exact:true}).count(),0);
  await page.screenshot({path:resolve(output,"tree-dark.png"),fullPage:true});
  await page.getByRole("button", {name:"Collapse all",exact:true}).click();
  assert.equal(await tree.getByRole("button",{name:"Passport v2",exact:true}).count(),0);
  await page.getByLabel("Find a requirement or document").fill("passport");
  await tree.getByRole("button",{name:"Passport v2",exact:true}).waitFor();
  await page.getByLabel("Find a requirement or document").fill("");
  await tree.getByRole("button",{name:/Monthly net income consistency/}).click();
  await detail.getByRole("heading",{name:"Fields compared",exact:true}).waitFor();
  await assertCommandCenterPageLayout(settled(page), {viewports:[{width:1440,height:1000,pointer:"fine"},{width:768,height:1024,pointer:"fine"},{width:390,height:844,pointer:"coarse"},{width:320,height:740,pointer:"coarse"}]});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("button",{name:"Use as template",exact:true}).click();
  await page.getByLabel("Name",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Name",{exact:true}).inputValue(), policy.name + " copy");
  assert.equal(await page.getByLabel("Identifier",{exact:true}).inputValue(), "");
  await page.getByLabel("Name",{exact:true}).fill("Team loan evidence");
  await page.getByLabel("Description",{exact:true}).fill("A synthetic tree builder verification.");
  await pick("Available for case types","New loan",true);
  await page.getByRole("button",{name:"+ Requirement",exact:true}).click();
  await page.getByLabel("Requirement name",{exact:true}).fill("Extra identity");
  await page.getByLabel("Why this evidence is needed",{exact:true}).fill("Additional identity evidence for a test.");
  await pick("Applies","When employment status matches");
  await pick("Expected value","Employed");
  const newBranch = page.locator(".set-tree-branch").last();
  await newBranch.getByRole("button",{name:/Bank statement v2/}).click();
  await pick("Document type","National identity card");
  await pick("Additional required fields","Full name",true);
  await page.getByRole("button",{name:"Must be currently valid",exact:true}).click();
  await page.getByLabel("Renew every (months, optional)",{exact:true}).fill("6");
  await pick("Renewal measured from","Last accepted review");
  await page.screenshot({path:resolve(output,"builder-dark.png"),fullPage:true});
  await page.getByRole("button",{name:"+ Check",exact:true}).click();
  await page.getByLabel("Check name",{exact:true}).fill("Name alignment");
  await page.getByLabel("What this check establishes",{exact:true}).fill("Compare subject names.");
  await page.getByLabel("Comparison topic",{exact:true}).fill("Subject identity name");
  await pick("Left Document type","National identity card");
  await pick("Left field","Full name");
  await pick("Right Document type","Passport");
  await pick("Right field","Full name");
  failure = true;
  await page.getByRole("button",{name:"Create document set",exact:true}).click();
  await page.getByText(/document set key already exists/).waitFor();
  assert.equal(await page.getByLabel("Check name",{exact:true}).inputValue(),"Name alignment");
  failure = false;
  await page.getByRole("button",{name:"Create document set",exact:true}).click();
  await page.getByRole("heading",{name:"Team loan evidence",exact:true}).waitFor();
  assert.equal(posts,2);
  assert.equal(saved.definition.version,1);
  assert.equal(saved.definition.requirements.length, policy.requirements.length + 1);
  assert.deepEqual(saved.case_type_keys,["new_loan"]);
  assert(saved.definition.requirements.at(-1).options[0].required_fields.includes("full_name"));
  assert.equal(saved.definition.comparisons.at(-1).left.field,"full_name");
  assert(saved.operation_key);
  await page.reload();
  await page.getByRole("heading",{name:"Team loan evidence",exact:true}).waitFor();
  // Fresh builder shares the same tree and handles an empty definition.
  await page.getByRole("button",{name:"New document set",exact:true}).click();
  assert.equal(await page.getByRole("navigation",{name:"Document set explorer"}).getByRole("button",{name:/Required ·/}).count(),0);
  await page.getByRole("button",{name:"Create document set",exact:true}).click();
  await page.getByText(/Enter a name, description/).waitFor();
  await assertCommandCenterPageLayout(settled(page), {viewports:[{width:1440,height:1000,pointer:"fine"},{width:390,height:844,pointer:"coarse"},{width:320,height:740,pointer:"coarse"}]});
  // Read-only users can explore, but cannot reach the builder or creation actions.
  admin = false;
  await page.goto(origin + "/document-sets/new");
  await page.getByText("Organization administrator access is required to create document sets.",{exact:true}).waitFor();
  await page.goto(origin + "/document-sets/loan_requirements?version=5");
  await tree.waitFor();
  assert.equal(await page.getByRole("button",{name:"New document set",exact:true}).count(),0);
  await page.goto(origin + "/document-sets/loan_requirements?version=999");
  await page.getByText("document set version not found",{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:"Document set tree, builder, persistence, permissions, validation and responsive checks passed",screenshots:output}));
} catch(e) { await page.screenshot({path:resolve(output,"failure.png"),fullPage:true}).catch(()=>{}); throw e; }
finally { await browser.close(); await server.close(); }
