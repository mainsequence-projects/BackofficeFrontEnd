import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const origin = 'http://127.0.0.1:15209';
const server = await createServer({root, logLevel:'error', server:{host:'127.0.0.1',port:15209,strictPort:true,hmr:false}});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1360,height:1000}});
page.setDefaultTimeout(10000);
const rows = [], writes = [], uploadKeys = [], errors=[];
page.on('pageerror', e=>errors.push(e.message));
const subject='00000000-0000-4000-8000-000000000001';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lwAAAABJRU5ErkJggg==','base64');
await page.route(`${origin}/api/**`, async route=>{
  const r=route.request(), url=new URL(r.url()), path=url.pathname.slice(4);
  const send=(json,status=200)=>route.fulfill({json,status});
  if(path==='/me')return send({user_uid:subject,can_review:true});
  if(path==='/readyz')return send({status:'ready'});
  if(path==='/document-types'||path==='/document-sets')return send({items:[]});
  if(path==='/person-schema')return send({type:'object',properties:{}});
  if(path==='/document-intakes/config')return send({max_bytes:15728640,max_pages:20,media_types:['image/png','image/jpeg','application/pdf'],upload_concurrency:2});
  if(path==='/document-intakes'&&r.method()==='GET')return send({items:rows,total_items:rows.length,has_more:false});
  if(path==='/document-intakes'){
    assert.match(r.headers()['content-type'],/^multipart\/form-data; boundary=/);
    const text=r.postDataBuffer().toString('latin1');
    assert.match(text,/name="operation_key"/);
    const filename=text.match(/filename="([^"]+)"/)[1];
    writes.push(filename);
    uploadKeys.push(text.match(/name="operation_key"\r\n\r\n([^\r]+)/)[1]);
    const uncertain=filename==='uncertain.png';
    const uid=crypto.randomUUID();
    const row={uid,filename,revision:3,document_type:'passport',status:uncertain?'needs_input':'completed',stage:uncertain?'resolving_person':'completed',resolution_required:uncertain,
      subject_uid:uncertain?null:subject,candidates:uncertain?[{uid:subject,full_name:'Alex Morgan'}]:[],
      completion:uncertain?null:{decision:'accepted'},target_count:uncertain?0:2,
      targets:uncertain?[]:[1,2].map(n=>({case_uid:`00000000-0000-4000-8000-00000000000${n}`,status:'completed',evaluation_uid:crypto.randomUUID()}))};
    rows.unshift(row);return send(row,202);
  }
  if(path.endsWith('/resolve')){
    const body=r.postDataJSON();assert.equal(body.subject_uid,subject);assert.equal(body.expected_revision,3);
    const row=rows.find(x=>path.includes(x.uid));Object.assign(row,{status:'completed',stage:'unallocated',resolution_required:false,subject_uid:subject});
    return send(row,202);
  }
  if(path==='/persons')return send({items:[],has_more:false});
  throw Error(`Unexpected route ${r.method()} ${path}`);
});
try{
  await page.goto(`${origin}/drop-files`);
  await page.getByRole('button',{name:'Choose files',exact:true}).waitFor();
  const files=[{name:'passport.png',mimeType:'image/png',buffer:png},{name:'uncertain.png',mimeType:'image/png',buffer:png},{name:'bad.exe',mimeType:'application/octet-stream',buffer:Buffer.from('bad')}];
  await page.getByLabel('Choose documents').setInputFiles(files);
  await page.getByText('Unsupported file',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Confirm person and continue'}).waitFor();
  assert.equal(writes.length,2);
  assert.equal(new Set(uploadKeys).size,2,'Different files need distinct upload commands even when bytes match');
  const resolved=page.locator('[data-intake]').filter({has:page.getByRole('heading',{name:'passport.png',exact:true})});
  await resolved.getByText('Accepted',{exact:true}).waitFor();
  assert.equal(await resolved.getByRole('button',{name:/^Case /}).count(),2);
  await page.getByRole('radio').check();
  await page.getByRole('button',{name:'Confirm person and continue'}).click();
  await page.getByText('Unallocated',{exact:true}).first().waitFor();
  await page.reload();
  await page.getByRole('heading',{name:'passport.png',exact:true}).waitFor();
  assert.equal(writes.length,2,'Refresh must not upload originals again');
  for(const width of [320,768,1360]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})));
    if (overflow.length) console.log(overflow);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
  }
  await mkdir(resolve(root,'.local/drop-files'),{recursive:true});
  await page.screenshot({path:resolve(root,'.local/drop-files/queue.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Multi-file upload, independent outcomes, identity resolution, multipart transport, refresh recovery and responsive layout passed.');
}finally{await browser.close();await server.close();}
