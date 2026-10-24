(function(){
 'use strict';
 const page=location.pathname.split('/').pop();
 if(!['general_by_activity.html','task-list.html'].includes(page))return;
 let started=false;
 async function init(){if(started)return;started=true;
  try{
   if(!window.RegisterCore)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='../shared/register-core.js?v=1';s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
   const C=window.RegisterCore,api=new C.API(window.__guardClient),context=await api.context();if(!context.projects.some(p=>Number(p.id)===1))return;
   const taskId=new URLSearchParams(location.search).get('registerTask');
   if(page==='task-list.html'){
    if(taskId){
     const q=api.client.from('submittals').select('id,title,no,action_by').eq('id',taskId);const r=await (context.manager?q:q.eq('action_by',window.currentUsername||window.__currentProfile?.username||'')).maybeSingle();
     if(r.data){
      const style=document.createElement('link');style.rel='stylesheet';style.href='../shared/register-integration.css?v=2';document.head.appendChild(style);
      const task=document.createElement('div');task.className='register-linked-task';task.innerHTML=`<strong>Linked task ${C.esc(r.data.no||r.data.id)}</strong><p>${C.esc(r.data.title)}</p><button type="button">Show responsible employee</button>`;task.querySelector('button').onclick=()=>{if(typeof window.selectEmployee==='function')window.selectEmployee(r.data.action_by);};
      (document.querySelector('main')||document.querySelector('.container')||document.body).appendChild(task);
     }
    }
    return;
   }
   const rows=await api.items(1),counts=C.counts(rows);if(!rows.length)return;
   const style=document.createElement('link');style.rel='stylesheet';style.href='../shared/register-integration.css?v=2';document.head.appendChild(style);
   const host=document.createElement('section');host.className='register-integration';host.setAttribute('aria-label','Project issues and risks');
   host.innerHTML='<h2>Issue &amp; Risk Register — Decisions Requested</h2><div class="register-integration-links">'+[['issues','Open Issues'],['risks','Active Risks'],['critical','Critical Risks'],['decisions','Pending Decisions'],['overdue','Overdue Items']].map(([key,label])=>`<a href="issue-risk-register.html?project=1&tab=${key}"><strong>${counts[key]}</strong>${label}</a>`).join('')+'</div>';
   const report=['weekly_report.html','weekly_report_view.html'].includes(page);
   if(report){const active=rows.filter(r=>!r.archived_at&&!C.closed(r));host.innerHTML+='<div class="register-report-table"><table><thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Status</th><th>Owner</th><th>Target date</th></tr></thead><tbody>'+active.map(r=>`<tr><td>${C.esc(r.code)}</td><td>${C.esc(r.kind)}</td><td>${C.esc(r.title)}</td><td>${C.esc(r.status)}</td><td>${C.esc(r.owner||'Unassigned')}</td><td>${C.esc(r.target_date||'—')}</td></tr>`).join('')+'</tbody></table></div>';}
   if(page==='performance.html')document.getElementById('dashboard')?.appendChild(host);else (document.querySelector('main')||document.querySelector('.container')||document.body).appendChild(host);
  }catch{/* Optional integration remains hidden until the module migration is deployed. */}
 }
 document.addEventListener('authguard:ready',init);if(window.__currentProfile)init();
})();
