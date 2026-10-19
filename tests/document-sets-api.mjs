// Full browser -> HTTP API -> relational persistence verification in disposable SQLite.
// The shared local user database is never selected or written.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
const backend = resolve("../backofficebackend-75d8081d-5e8f-4dc6-ab09-60bc832d0118");
const python = `
from uuid import UUID
from fastapi import FastAPI
import uvicorn
from api.app.main import router, application, app
from tests.api.test_workflows import SQLStorage
from src.backoffice.services.application import Application
store = SQLStorage()
service = Application(UUID("00000000-0000-4000-8000-000000000001"), organization_admin=True, store=store)
# The disposable in-memory fixture uses StaticPool's single connection.
# Serialize its short statements across concurrent browser GETs and writes.
from threading import RLock
statement_lock = RLock()
execute = store.execute
def serial_execute(*args, **kwargs):
    with statement_lock:
        return execute(*args, **kwargs)
store.execute = serial_execute
fixture = FastAPI()
fixture.include_router(router)
fixture.exception_handlers.update(app.exception_handlers)
fixture.dependency_overrides[application] = lambda: service
uvicorn.run(fixture, host="127.0.0.1", port=15194, log_level="error")
`;
const child = spawn(resolve(backend, ".venv/bin/python"), ["-c", python], {cwd: backend, stdio:["ignore","pipe","pipe"]});
let logs = "";
child.stdout.on("data",(chunk)=>{logs+=chunk;});
child.stderr.on("data",(chunk)=>{logs+=chunk;});
process.env.BACKOFFICE_API_ORIGIN = "http://127.0.0.1:15194";
let server, browser, page;
try {
  let ready=false;
  for(let n=0;n<100;n++){
    try {const result=await fetch("http://127.0.0.1:15194/me"); if(result.ok){ready=true;break;}} catch {}
    if(child.exitCode!==null) throw new Error(logs);
    await new Promise((r)=>setTimeout(r,100));
  }
  assert(ready, logs);
  const fixtureTypes = await fetch("http://127.0.0.1:15194/case-types");
  assert(fixtureTypes.ok, "Fixture case types: " + await fixtureTypes.text());
  server=await createServer({server:{host:"127.0.0.1",port:15195,strictPort:true,hmr:false},logLevel:"error"});
  await server.listen();
  browser=await chromium.launch();
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(20000);
  page.on("response", async (r) => { if(r.status() >= 400 && !r.url().includes("assistant")) console.error(r.status(), r.url(), await r.text()); });
  await page.route("**/api/assistant/context", (route)=>route.fulfill({status:503,json:{detail:"test_fixture_no_agent"}}));
  const before=await (await fetch("http://127.0.0.1:15194/document-sets?limit=100")).json();
  await page.goto("http://127.0.0.1:15195/document-sets/loan_requirements?version=5");
  await page.getByRole("button",{name:"Use as template",exact:true}).click();
  await page.getByLabel("Name",{exact:true}).fill("Local end to end evidence");
  await page.getByLabel("Description",{exact:true}).fill("Disposable synthetic policy verification.");
  await page.getByRole("button",{name:"Available for case types",exact:true}).click();
  await page.getByRole("option",{name:"New loan",exact:true}).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"+ Requirement",exact:true}).click();
  await page.getByLabel("Requirement name",{exact:true}).fill("Additional identity");
  await page.getByLabel("Why this evidence is needed",{exact:true}).fill("Additional subject identity evidence.");
  await page.locator(".set-tree-branch").last().getByRole("button",{name:"National identity card v3",exact:true}).click();
  await page.getByRole("button",{name:"Additional required fields",exact:true}).click();
  await page.getByRole("option",{name:"Full name",exact:true}).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Create document set",exact:true}).click();
  await page.getByRole("heading",{name:"Local end to end evidence",exact:true}).waitFor();
  const result=await (await fetch("http://127.0.0.1:15194/document-sets/local_end_to_end_evidence/versions/1")).json();
  assert.equal(result.requirements.length,8);
  assert.equal(result.comparisons.length,1);
  assert.deepEqual(result.requirements.at(-1).options[0].required_fields,["full_name"]);
  const types=await (await fetch("http://127.0.0.1:15194/case-types")).json();
  assert(types.items.find((t)=>t.key==="new_loan").document_sets.some((s)=>s.key===result.key&&s.version===1));
  await page.reload();
  await page.getByRole("heading",{name:"Local end to end evidence",exact:true}).waitFor();
  const after=await (await fetch("http://127.0.0.1:15194/document-sets?limit=100")).json();
  for(const policy of before.items) assert.deepEqual(after.items.find((p)=>p.key===policy.key&&p.version===policy.version),policy);
  console.log("Full browser-to-API publication, relational persistence, case-type availability, reload and immutable catalog checks passed in disposable SQLite.");
} catch (error) {
  await page?.screenshot({path:resolve(".local/document-set-verification/api-failure.png"),fullPage:true}).catch(()=>{});
  console.error(logs); throw error;
} finally {
  await browser?.close(); await server?.close(); child.kill("SIGTERM");
  await new Promise((r)=>{if(child.exitCode!==null)r();else child.once("exit",r);});
}
