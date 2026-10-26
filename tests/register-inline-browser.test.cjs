const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.REGISTER_PLAYWRIGHT_MODULE||require.resolve('playwright',{paths:[path.join(__dirname,'../tmp/register-qa'),__dirname]}));
const {fixture}=require('./register-inline-fixture.cjs');
(async()=>{
 const state=await fixture(),{db,rpc,signIn,issue}=state;
 await rpc('register_save',{p_kind:'decision',p_id:state.decision.id,p_payload:{details:{}},p_version:state.decision.version});
 const browser=await chromium.launch({executablePath:process.env.REGISTER_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const html=fs.readFileSync(path.join(__dirname,'../pages/issue-risk-register.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://register.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.exposeFunction('fixtureCall',async(action,args)=>{
   if(action==='rpc')return rpc(args.name,args.args);
   if(action==='comment'){await db.query('insert into register_comments(project_id,kind,item_id,body) values($1,$2,$3,$4)',[args.row.project_id,args.row.kind,args.row.id,args.body]);return;}
   if(action==='select'){
    assert.ok(['register_items_v','register_events','project_performance','register_settings','register_comments','register_attachments','register_notifications'].includes(args.table));
    const values=[],conditions=(args.filters||[]).map(([key,value])=>{assert.match(key,/^[a-z_]+$/);values.push(value);return `${key}=$${values.length}`;});
    const query=`select * from ${args.table}${conditions.length?' where '+conditions.join(' and '):''}`;
    const rows=JSON.parse(JSON.stringify((await db.query(query,values)).rows));return args.single?{data:rows[0]||null,error:null}:rows;
   }
  });
  async function load(role='admin'){
   await signIn(role);
   await page.goto('http://register.test/issue-risk-register.html?project=1');
   for(const name of ['design-system','apple-ui','issue-risk-register','register-inline-editor','mdceo-ui'])await page.addStyleTag({path:path.join(__dirname,`../shared/${name}.css`)});
   await page.locator('.register-brand img').evaluate((image,source)=>image.src=source,'data:image/jpeg;base64,'+fs.readFileSync(path.join(__dirname,'../images/WhatsApp Image 2025-11-24 at 10.33.58 AM.jpeg')).toString('base64'));
   await page.addScriptTag({path:path.join(__dirname,'../shared/register-core.js')});
   await page.evaluate(role=>{
    window.__currentProfile={};window.currentUserRole=role==='admin'?'super_admin':'limited';window.confirmations=0;
    window.notify={error(message){window.lastError=message;},success(message){window.lastSuccess=message;},info(){},async confirm(){window.confirmations++;return window.allowConfirm!==false;}};
    function builder(table){return {filters:[],select(){return this;},eq(key,value){this.filters.push([key,value]);return this;},order(){return this;},maybeSingle(){return window.fixtureCall('select',{table,filters:this.filters,single:true});}};}
    window.RegisterCore.API=class{
     constructor(){this.client={from:builder};}
     rpc(name,args={}){return window.fixtureCall('rpc',{name,args});}
     context(){return this.rpc('register_context');}
     async all(table,configure=query=>query){const query=configure(builder(table));return window.fixtureCall('select',{table,filters:query.filters});}
     items(project){return this.all('register_items_v',query=>query.eq('project_id',project));}
     events(project){return this.all('register_events',query=>query.eq('project_id',project));}
     async performance(project){return (await this.client.from('project_performance').eq('id',project).maybeSingle()).data;}
     async schedule(){return {rows:[],date:null,source:'No imported schedule in isolated test database'};}
     attachments(kind,id){return this.all('register_attachments',query=>query.eq('kind',kind).eq('item_id',id));}
     comments(kind,id){return this.all('register_comments',query=>query.eq('kind',kind).eq('item_id',id));}
     addComment(row,body){return window.fixtureCall('comment',{row,body});}
    };
   },role);
   await page.addScriptTag({path:path.join(__dirname,'../tmp/register-qa/node_modules/chart.js/dist/chart.umd.js')});
   await page.addScriptTag({path:path.join(__dirname,'../shared/register-inline-editor.js')});
   await page.addScriptTag({path:path.join(__dirname,'../shared/issue-risk-register.js')});
   const expectedCount=(await db.query('select count(*)::int total from register_items_v where project_id=1')).rows[0].total;
   try{await page.waitForFunction(count=>document.querySelectorAll('#registerRows tr').length===count,expectedCount,{timeout:5000});}catch(error){console.error(await page.locator('#registerState').innerText(),errors);throw error;}
  }
  await load();
  const originalURL=page.url();
  await page.locator('#editDataButton').click();
  await page.waitForSelector('#registerInlineForm');
  assert.equal(page.url(),originalURL);assert.equal(await page.locator('#projectSelect').inputValue(),'1');assert.ok(await page.locator('#projectSelect').isDisabled());
  await page.locator('[data-edit-action="cancel"]').first().click();
  assert.equal(await page.evaluate(()=>window.confirmations),0);
  assert.ok(await page.locator('#registerEditPanel').isHidden());
  await page.locator('#editDataButton').click();await page.waitForSelector('#registerInlineForm');
  const issueRecord=page.locator('[data-record-list="issue"] details').first();await issueRecord.locator('summary').click();
  await page.screenshot({path:path.join(__dirname,'../tmp/register-inline-desktop.png'),fullPage:true});
  await issueRecord.locator('[data-field="title"]').fill('Updated inside dashboard');
  await issueRecord.locator('[data-field="status"]').selectOption('Closed');
  const riskRecord=page.locator('[data-record-list="risk"] details').first();await riskRecord.locator('summary').click();await riskRecord.locator('[data-field="probability"]').fill('4');await riskRecord.locator('[data-field="impact"]').fill('5');assert.match(await riskRecord.locator('[data-risk-score]').innerText(),/20.*Critical/);
  await issueRecord.locator('[data-edit-action="support"]').click();await page.waitForSelector('[data-comment]');await page.locator('[data-comment]').fill('Pending supporting comment');
  await page.locator('[data-edit-action="add-week"]').click();assert.equal(await page.locator('[data-comment]').inputValue(),'Pending supporting comment');
  const week=page.locator('[data-week]').last();await week.locator('[data-week-field="week"]').fill('2026-10-08');await week.locator('[data-week-field="plan"]').fill('50');await week.locator('[data-week-field="actual"]').fill('45');assert.equal(await week.locator('[data-variance]').innerText(),'-5.00%');
  await page.locator('#registerInlineForm button[type="submit"]').click();assert.match(await page.locator('[data-edit-state]').innerText(),/pending comment/);
  await issueRecord.locator('[data-edit-action="comment"]').click();await page.waitForFunction(()=>!document.querySelector('[data-comment]').value);
  await page.locator('[data-edit-action="add"][data-kind="issue"]').click();const added=page.locator('[data-record-list="issue"] details').last();await added.locator('[data-field="title"]').fill('New inline issue');
  await page.locator('#registerInlineForm button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#registerEditPanel').hidden);await page.waitForFunction(()=>document.querySelectorAll('#registerRows tr').length===4);
  await page.locator('#registerTabs [data-tab="issues"]').click();await page.locator('#pageSize').selectOption('all');
  assert.equal(await page.locator('#registerRows tr').count(),Number(await page.locator('#registerTabs [data-tab="issues"] .register-tab-count').innerText()));
  assert.match(await page.locator('#pageSummary').innerText(),/^All \d+ records$/);
  await page.locator('#registerTabs [data-tab="all"]').click();await page.locator('#pageSize').selectOption('25');
  const rows=(await db.query('select * from register_items_v where project_id=1')).rows;assert.equal(rows.find(row=>row.id===issue.id&&row.kind==='issue').title,'Updated inside dashboard');assert.equal(rows.find(row=>row.kind==='risk').risk_score,20);assert.equal((await db.query('select weekly_table from project_performance where id=1')).rows[0].weekly_table.length,2);assert.equal((await db.query('select count(*)::int total from register_comments')).rows[0].total,1);
  assert.match(await page.locator('#progressSummary').innerText(),/45.00%/);assert.match(await page.locator('#progressHighlights').innerText(),/increased by 20\.00 percentage points to 45\.00%/);assert.match(await page.locator('#progressHighlights').innerText(),/5\.00 percentage points behind plan/);assert.equal(await page.locator('#topKpis .register-kpi-value').first().innerText(),'4');
  assert.equal(await page.evaluate(()=>Chart.getChart(document.getElementById('registerProgressChart')).data.datasets[1].data.at(-1)),45);
  assert.deepEqual(await page.evaluate(()=>Chart.getChart(document.getElementById('financialTrendChart')).data.datasets.map(dataset=>dataset.data)),[[4000000,4422634],[2500000,3097846]]);
  assert.ok(await page.locator('#financialTrendCard').isVisible());
  assert.equal(await page.locator('#financialKpis').evaluate(element=>element.parentElement.id),'financialTrendCard');
  assert.equal(await page.locator('#registerTable thead').innerText().then(text=>text.includes('Days left')),false);
  await page.locator('#editDataButton').click();await page.waitForSelector('#registerInlineForm');
  const decisionRecord=page.locator('[data-record-list="decision"] details').first();await decisionRecord.locator('summary').click();await decisionRecord.locator('[data-field="decision_required"]').fill('Confirm the requested design');await decisionRecord.locator('[data-field="decision_status"]').selectOption('Approved');assert.equal(await decisionRecord.locator('[data-field="status"]').inputValue(),'Resolved');
  await page.locator('#registerInlineForm button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#registerEditPanel').hidden);await page.waitForFunction(()=>document.querySelectorAll('#topKpis .register-kpi-value')[3].textContent==='0');
  await page.locator('#editDataButton').click();await page.waitForSelector('#registerInlineForm');
  const changed=page.locator('[data-record-list="issue"] details').first();await changed.locator('summary').click();await changed.locator('[data-field="title"]').fill('Draft kept on conflict');
  const current=(await db.query('select * from register_items_v where kind=$1 and id=$2',['issue',issue.id])).rows[0];await rpc('register_save',{p_kind:'issue',p_id:issue.id,p_payload:{title:'Concurrent update'},p_version:current.version});
  await page.locator('#registerInlineForm button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-edit-state]').textContent.includes('record changed'));assert.equal(await changed.locator('[data-field="title"]').inputValue(),'Draft kept on conflict');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.screenshot({path:path.join(__dirname,'../tmp/register-inline-mobile.png'),fullPage:true});
  await page.evaluate(()=>{window.print=()=>{};document.getElementById('exportPdf').click();});
  await page.waitForFunction(()=>!!document.getElementById('registerPrintOrientation'));
  assert.match(await page.locator('#registerPrintOrientation').textContent(),/A4 portrait/);
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('#registerEditPanel').evaluate(element=>getComputedStyle(element).display),'none');assert.equal(await page.locator('#topKpis').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length),3);assert.equal(await page.locator('.register-analytics').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length),1);assert.notEqual(await page.locator('#financialKpis').evaluate(element=>getComputedStyle(element).display),'none');assert.equal(await page.locator('#financialKpis .register-kpi').count(),6);assert.equal(await page.locator('#financialKpis').evaluate(element=>getComputedStyle(element).breakInside),'avoid');assert.equal(await page.locator('#scheduleSource').evaluate(element=>getComputedStyle(element).display),'none');assert.notEqual(await page.locator('.register-table-section').evaluate(element=>getComputedStyle(element).display),'none');assert.equal(await page.locator('body').evaluate(element=>getComputedStyle(element,'::before').borderTopColor),'rgb(41, 169, 224)');assert.match(await page.locator('.register-table-section').evaluate(element=>getComputedStyle(element).borderTopColor),/169, 200, 229/);assert.ok(await page.locator('.register-table-section').evaluate(element=>parseFloat(getComputedStyle(element).paddingTop)>=30));assert.equal(await page.locator('.register-table-title h2').evaluate(element=>getComputedStyle(element).textAlign),'center');
  assert.equal(await page.locator('#financialKpis').evaluate(element=>element.parentElement.id),'financialTrendCard');
  await page.pdf({path:path.join(__dirname,'../tmp/register-inline-saved-data.pdf'),format:'A4',preferCSSPageSize:true,printBackground:true,margin:{top:'8mm',right:'8mm',bottom:'8mm',left:'8mm'}});
  await page.emulateMedia({media:'screen'});
  await page.locator('[data-edit-action="cancel"]').first().click();
  await load('viewer');assert.ok(await page.locator('#editDataButton').isHidden());
  await load('engineer');await page.locator('#editDataButton').click();await page.waitForSelector('#registerInlineForm');assert.ok(await page.locator('[data-record-list="decision"] [data-field="title"]').isDisabled());assert.ok(await page.locator('[data-week-field="plan"]').first().isDisabled());
  await page.setViewportSize({width:718,height:1100});await load('admin');
  const weeklySource=fs.readFileSync(path.join(__dirname,'../pages/weekly_report.html'),'utf8');
  const bakeSource=weeklySource.match(/function bakeCanvasesIntoImages\(doc, contentWrap\) \{[\s\S]*?\n\}/)[0];
  await page.addScriptTag({content:bakeSource});
  const copied=await page.evaluate(()=>{
   document.body.classList.add('register-print-embed');
   window.dispatchEvent(new Event('beforeprint'));
   const copy=document.body.cloneNode(true);
   bakeCanvasesIntoImages(document,copy);
   copy.querySelectorAll('script,#registerEditPanel,dialog').forEach(element=>element.remove());
   return copy.innerHTML;
  });
  const report=await browser.newPage();
  const weeklyStyles=[...weeklySource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
  await report.setContent(`<style>${weeklyStyles}</style><body class="printing-full-report"><div id="externalPagesContainer"><section class="report-page register-report-page"><div class="pf-page"><div class="pf-body"></div><div class="pf-pagenum">1</div></div></section></div></body>`);
  for(const name of ['issue-risk-register','register-report-print'])await report.addStyleTag({path:path.join(__dirname,`../shared/${name}.css`)});
  await report.evaluate(markup=>{const body=document.createElement('body');body.className='register-page register-print-embed';body.innerHTML=markup;document.querySelector('.pf-body').append(body);},copied);
  await report.addScriptTag({path:path.join(__dirname,'../shared/register-report-print.js')});
  assert.ok(await report.locator('#financialTrendCard').isVisible());
  assert.equal(await report.locator('#financialTrendCard canvas').count(),0);
  assert.equal(await report.locator('#financialTrendCard img').count(),1);
  assert.ok(await report.locator('.register-table-section').evaluate(element=>parseFloat(getComputedStyle(element).paddingTop)>=30));
  await report.evaluate(()=>paginateRegisterReport(document.querySelector('#externalPagesContainer')));
  await report.emulateMedia({media:'print'});
  assert.ok(await report.locator('.register-report-page').first().locator('#financialTrendCard').isVisible());
  assert.equal(await report.locator('.register-report-page').first().locator('#financialKpis .register-kpi').count(),6);
  assert.equal(await report.locator('.register-report-page').nth(1).locator('#financialTrendCard').count(),0);
  assert.equal(await report.locator('.register-report-page').first().evaluate(page=>page.classList.contains('register-summary-page')),true);
  assert.equal(await report.locator('.register-archived-marker').count(),0);
  assert.equal(await report.locator('.register-report-page').first().locator('.register-analytics .register-card').count(),3);
  assert.equal(await report.locator('.register-report-page').first().locator('#topKpis .register-kpi').count(),5);
  assert.equal(await report.locator('#financialKpis').evaluate(element=>getComputedStyle(element).breakInside),'avoid');
  const kpiCounts=await report.locator('.register-report-page').evaluateAll(pages=>pages.map(page=>page.querySelectorAll('#financialKpis .register-kpi').length));
  assert.equal(kpiCounts.reduce((total,count)=>total+count,0),6);
  assert.equal(kpiCounts.filter(Boolean).length,1);
  const pageHeights=await report.locator('.register-report-page .pf-body').evaluateAll(bodies=>bodies.map(body=>body.getBoundingClientRect().height));
  assert.ok(pageHeights.every(height=>height<=259*96/25.4+1));
  assert.equal(await report.locator('#registerRows tr').count(),4);
  assert.equal(await report.locator('.register-report-page').first().locator('#registerTable').count(),0);
  assert.deepEqual((await report.locator('.register-report-page').nth(1).locator('#registerTable thead th').allInnerTexts()).slice(0,5),['Type','Title','Priority','Status','Target date']);
  assert.equal(await report.locator('.register-report-page').nth(1).locator('#registerTable thead').innerText().then(text=>text.includes('Days left')),false);
  assert.ok(await report.locator('.register-report-page').nth(1).locator('#registerTable thead th:nth-child(2)').evaluate(header=>header.getBoundingClientRect().width/header.closest('table').getBoundingClientRect().width>.4));
  const order=await report.locator('.register-main').first().evaluate(element=>[...element.children].map(child=>child.className));
  assert.equal(await report.locator('.register-report-page').first().locator('.register-analytics #financialKpis').count(),1);
  assert.ok(order.indexOf('register-analytics')<order.findIndex(name=>name.includes('register-kpis')));
  assert.equal(order.some(name=>name.includes('register-table-section')),false);
  await report.pdf({path:path.join(__dirname,'../tmp/register-inline-weekly-section.pdf'),preferCSSPageSize:true,printBackground:true});
  assert.match(await report.locator('#registerRows').allInnerTexts().then(values=>values.join(' ')),/Concurrent update/);
  await report.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: same-page editing, project lock, clean cancel, untouched legacy records, preserved comment drafts, real database save, decision approvals, risk scoring, weekly variance, recalculated dashboard, conflict draft retention, mobile layout, saved-data/Weekly Report PDFs and role restrictions.');
 }finally{await browser.close();await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
