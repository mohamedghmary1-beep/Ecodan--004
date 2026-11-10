(function(){
 'use strict';
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const GROUPS=[['issue','Issues'],['risk','Risks'],['decision','Decision requests']];
 const KIND={issue:'Issue',risk:'Risk',decision:'Decision Request'};
 function render({rows,counts,date,project}){
  let host=document.getElementById('printSheet');
  if(!host){host=document.createElement('div');host.id='printSheet';host.setAttribute('aria-hidden','true');document.body.appendChild(host);}
  const C=window.RegisterCore||{};
  const high=rows.filter(r=>/^(high|critical)$/i.test(r.priority||'')&&!(C.closed&&C.closed(r))).length;
  const late=rows.filter(r=>C.overdue&&C.overdue(r)).length;
  const kpis=[['Total items',rows.length,''],['Open issues',counts.issues,'ps-k-issue'],['Open risks',counts.risks,'ps-k-risk'],['High priority',high,'ps-k-high'],['Overdue',late,'ps-k-over']];
  let n=0;
  const groups=GROUPS.map(([kind,label])=>{
   const list=rows.filter(r=>r.kind===kind);if(!list.length)return '';
   const cards=list.map(r=>{
    n++;
    const p=String(r.priority||'').toLowerCase().replace(/[^a-z]/g,'')||'medium';
    const same=String(r.description||'').trim().replace(/\s+/g,' ').toLowerCase()===String(r.title||'').trim().replace(/\s+/g,' ').toLowerCase();
    const isLate=C.overdue&&C.overdue(r);
    return `<li class="ps-card ps-${esc(r.kind)}"><div class="ps-num">${n}</div><div class="ps-body"><div class="ps-top"><span class="ps-kind">${KIND[r.kind]}</span><span class="ps-badge ps-${p}">${esc(r.priority||'—')}</span></div><div class="ps-name">${esc(r.title)}</div>${r.description&&!same?`<div class="ps-desc">${esc(r.description)}</div>`:''}<div class="ps-meta"><span>Status<span class="ps-status">${esc(r.status||'—')}</span></span><span class="${isLate?'ps-late':''}">Target date <b>${esc(r.target_date||'—')}</b>${isLate?' · Overdue':''}</span></div></div></li>`;
   }).join('');
   return `<section class="ps-group ps-g-${kind}"><div class="ps-group-head"><h2>${label}</h2><span class="ps-count">${list.length}</span></div><ol class="ps-list">${cards}</ol></section>`;
  }).join('');
  host.innerHTML=`<div class="ps-head"><div><div class="ps-brand">MDCEO · Project Portal</div><h1 class="ps-title">Issue &amp; Risk Register</h1>${project?`<div class="ps-project">${esc(project)}</div>`:''}</div><div class="ps-date">Report date<strong>${esc(date)}</strong></div></div>
  <div class="ps-kpis">${kpis.map(([l,v,c])=>`<div class="ps-kpi ${c}"><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
  ${groups||'<div class="ps-empty">No matching records.</div>'}`;
 }
 window.RegisterPrintSheet={render};
})();
