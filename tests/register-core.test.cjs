const assert=require('node:assert/strict');
const C=require('../shared/register-core.js');
const asof='2026-10-21';
const rows=[
 {id:1,kind:'issue',project_id:1,code:'I-1',title:'Material review',priority:'High',status:'Open',target_date:'2026-10-20'},
 {id:2,kind:'risk',project_id:1,title:'Resource risk',priority:'Critical',risk_level:'Critical',status:'In Progress'},
 {id:3,kind:'decision',project_id:1,title:'Approval',priority:'Medium',status:'Pending Approval',target_date:'2026-10-25'},
 {id:4,kind:'risk',project_id:1,title:'Resolved risk',priority:'Low',status:'Resolved',target_date:'2026-10-01'},
 {id:5,kind:'issue',project_id:1,title:'Archived item',status:'Open',archived_at:'2026-10-19'},
];
assert.deepEqual(C.counts(rows,asof),{total:4,issues:1,risks:1,decisions:1,overdue:1,critical:1,closed:1});
const buckets=C.breakdown(rows);assert.equal(Object.values(buckets).reduce((a,b)=>a+b,0),4);assert.equal(buckets['In Progress'],1);assert.equal(buckets['Open Risks'],0);
assert.equal(C.filter(rows,{tab:'overdue',asof}).length,1);assert.equal(C.filter(rows,{archived:true}).length,1);assert.equal(C.filter(rows,{search:'MATERIAL',priority:'High'}).length,1);assert.equal(C.filter(rows,{project:2}).length,0);
assert.equal(C.days('2026-10-20',asof),-1);assert.equal(C.days('2026-10-21',asof),0);assert.equal(C.days(null,asof),null);
assert.equal(C.parsePeriod('07.07.2026'),'2026-07-07');assert.equal(C.parsePeriod('23-Jun-20'),'2020-06-23');assert.equal(C.parsePeriod('2026-10-15'),'2026-10-15');
const progress=[{week:'07.07.2026',plan:1,actual:.5},{week:'14.07.2026',plan:2,actual:1.5},{week:'01.08.2026',plan:4,actual:3}];
assert.deepEqual(C.progress(progress,true).map(r=>r.actual),[1.5,3]);assert.deepEqual(C.progress(progress).map(r=>r.actual),[.5,1.5,3]);
assert.equal(C.sort(rows,'priority','desc')[0].priority,'Critical');
assert.equal(C.formulaSafe('=HYPERLINK("x")'),'\'=HYPERLINK("x")');assert.equal(C.formulaSafe(' +SUM(1)'),"' +SUM(1)");assert.equal(C.formulaSafe(-20),-20);assert.equal(C.formulaSafe('Normal title'),'Normal title');
assert.equal(C.esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
assert.equal(C.fileType(Uint8Array.from([0x25,0x50,0x44,0x46])),'pdf');assert.equal(C.fileType(Uint8Array.from([60,115,99,114,105,112,116])),null);
assert.equal(C.historical([rows[0]],[],'2026-10-01'),null);
assert.equal(C.historical([],[],'2026-10-01'),null);
assert.deepEqual(C.historical([rows[0]],[{kind:'issue',item_id:1,event:'created',created_at:'2026-10-10',after_data:rows[0]}],'2026-10-01'),[]);
const schedule=[{kind:'activity',bl_finish:'2026-10-01',physical_pct:0,total_float:0},{kind:'activity',bl_finish:'2026-10-01',physical_pct:1,total_float:null},{kind:'wbs',bl_finish:'2026-10-01',physical_pct:0,total_float:-1}];
assert.deepEqual(C.scheduleCounts(schedule,asof),{overdue:1,critical:1});
(async()=>{
 const fake={from(){return {
  select(){return this;},
  range(a,b){return Promise.resolve({data:Array.from({length:Math.min(502,b+1)-a},(_,i)=>({id:a+i})),error:null});}
 };}};
 const result=await new C.API(fake).all('fixture');assert.equal(result.length,502);assert.equal(new Set(result.map(r=>r.id)).size,502);
 const rejectClient={storage:{from(){throw Error('Should not upload rejected file')}}};
 await assert.rejects(()=>new C.API(rejectClient).upload({project_id:1,kind:'issue',id:1},new File(['<script>'],'bad.pdf',{type:'application/pdf'})),/contents do not match/);
 console.log('PASS: KPIs, exclusive donut categories, overdue rules, filters, chronological progress, monthly aggregation, priority sorting, dates, historical coverage, formula safety, safe text, schedule definitions, 502-row pagination, attachment content validation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
