(function(){
 'use strict';
 const C=window.RegisterCore,$=id=>document.getElementById(id),E=C.esc;
 let api,context,items=[],events=[],performance=null,schedule={rows:[]},project,tab=new URLSearchParams(location.search).get('tab')||'all',page=0,sortKey='created_at',direction='desc',progressChart,statusChart,printing=new URLSearchParams(location.search).get('print')==='1',started=false,filtered=[],bucketFilter='',detailAttachments=[],channel=null,refreshTimer,loadEpoch=0;
 const COLORS={'Open Issues':'#ef4768','Open Risks':'#ffb21b','In Progress':'#007fff','Closed':'#10b981','Decisions Requested':'#7c3aed'};
 const notifyError=e=>window.notify?.error(e.message||String(e));
 function state(text,error=false){$('registerState').textContent=text;$('registerState').classList.toggle('error',error);}
 function reportPageReady(error=''){if(new URLSearchParams(location.search).get('print')!=='1')return;document.body.classList.add('register-print-embed');const message={type:'print-page-ready',height:document.body.scrollHeight,error};window.parent.postMessage(message,'*');setTimeout(()=>window.parent.postMessage(message,'*'),300);}
 async function refreshNotificationCount(){try{const rows=await api.all('register_notifications',q=>q.eq('is_read',false).order('id'));$('notificationCount').textContent=rows.length;}catch{}}
 const manager=()=>!!context?.manager,mayCreate=()=>manager()||!!context?.engineer;
 let inlineEditor;
 const mayEdit=r=>manager()||context?.engineer&&r.owner_id===context.user_id;
 const filters=()=>({project,from:$('dateFrom').value,to:$('dateTo').value,archived:$('showArchived').checked});
 function base(){return C.filter(items,filters());}
 function currentFilters(){return {...filters(),tab,search:$('registerSearch').value,priority:$('priorityFilter').value,status:$('statusFilter').value,owner:$('ownerFilter').value,category:$('categoryFilter').value,bucket:bucketFilter};}
 function badge(text,type=''){const cls=type||(/Critical|High|Overdue|Rejected/.test(text)?'red':/Medium|Pending/.test(text)?'amber':/Closed|Resolved|Low/.test(text)?'green':/Progress/.test(text)?'blue':'purple');return `<span class="register-badge ${cls}">${E(text||'—')}</span>`;}
 function renderKpis(){
  const tabRows=base(),rows=C.filter(items,{...filters(),archived:false}),k=C.counts(rows),cutoff=new Date(Date.now()-7*86400000).toISOString(),previous=C.historical(items,events,cutoff),old=previous?C.counts(C.filter(previous,{...filters(),archived:false}),cutoff.slice(0,10)):null;
  const snapshots=old?[7,6,5,4,3,2,1].map(d=>C.historical(items,events,new Date(Date.now()-d*86400000).toISOString())).map(r=>r?C.counts(C.filter(r,{...filters(),archived:false})):null):[];
  const fields=[['total','Total Items','all'],['issues','Open Issues','issues'],['risks','Open Risks','risks'],['decisions','Decisions Requested','decisions'],['overdue','Overdue Items','overdue']];
  $('topKpis').innerHTML=fields.map(([key,label,to])=>{let note='History not yet available',cls='';if(old){const delta=k[key]-old[key];note=old[key]?`${delta>0?'+':''}${(delta/old[key]*100).toFixed(0)}% vs 7 days ago`:`${delta>0?'+':''}${delta} items vs 7 days ago`;cls=(key==='total'?delta>=0:delta<=0)?'positive':'negative';}
   const series=snapshots.every(Boolean)&&snapshots.length?[...snapshots.map(n=>n[key]),k[key]]:[];const max=Math.max(...series,1),min=Math.min(...series,0);const spark=series.length?`<svg class="register-spark" viewBox="0 0 44 24" aria-hidden="true"><polyline fill="none" stroke="#007fff" stroke-width="2" points="${series.map((n,i)=>`${i*44/(series.length-1)},${22-(n-min)/(max-min||1)*20}`).join(' ')}"/></svg>`:'';return `<a class="register-kpi" href="#registerTable" data-tab="${to}" aria-label="${label}: ${k[key]}"><div class="register-kpi-title">${label}</div><div class="register-kpi-value">${k[key]}</div><div class="register-kpi-trend ${cls}">${note}</div>${spark}</a>`;}).join('');
  $('registerTabs').innerHTML=[['all','All Items',tabRows.length],['issues','Issues',tabRows.filter(r=>r.kind==='issue').length],['risks','Risks',tabRows.filter(r=>r.kind==='risk').length],['decisions','Decisions',tabRows.filter(r=>r.kind==='decision').length],['overdue','Overdue',tabRows.filter(r=>C.overdue(r)).length],['closed','Closed',tabRows.filter(C.closed).length]].map(([key,label,count])=>`<button type="button" data-tab="${key}" aria-pressed="${tab===key}">${label}<span class="register-tab-count">${count}</span></button>`).join('');
 }
 function renderTable(){
  const activeFilters=currentFilters(),matching=printing
   ?[...C.filter(items,{...activeFilters,archived:false}),...C.filter(items,{...activeFilters,archived:true})]
   :C.filter(items,activeFilters);
  filtered=C.sort(matching,sortKey,direction);const size=Number($('pageSize').value),pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.min(page,pages-1);
  const rows=printing?filtered:filtered.slice(page*size,page*size+size);
  $('registerRows').innerHTML=rows.map(r=>{const left=C.days(r.target_date),key=`${r.kind}:${r.id}`,type=r.kind==='decision'?'Decision Request':r.kind==='risk'?'Risk':'Issue',archived=printing&&r.archived_at?'<span class="register-archived-marker">ARCHIVED · </span>':'',description=printing&&r.description?`<div class="register-item-description">${E(r.description)}</div>`:'';return `<tr><td>${E(r.code||key)}</td><td>${type}</td><td>${archived}${E(r.title)}${description}</td><td>${E(r.category||'—')}</td><td>${badge(r.priority)}</td><td>${badge(r.status)}</td><td>${E(r.owner||'Unassigned')}</td><td>${E(r.target_date||'—')}</td><td>${left==null?'—':C.closed(r)?badge('Closed','green'):badge(String(left),left<0?'red':left<=3?'amber':'blue')}</td><td class="no-print"><div class="register-row-actions"><button data-action="view" data-key="${key}">Details</button>${mayEdit(r)?`<a class="register-button" href="issue-risk-editor.html?project=${r.project_id}&kind=${r.kind}&id=${r.id}">Edit</a>${r.kind!=='decision'||manager()?`<button data-action="lifecycle" data-key="${key}">${C.closed(r)?'Reopen':'Close'}</button>`:''}`:''}${manager()?`<button data-action="archive" data-key="${key}">${r.archived_at?'Restore':'Archive'}</button>`:''}</div></td></tr>`;}).join('')||'<tr><td colspan="10">No matching records. Change the filters or add your first item.</td></tr>';
  $('resultCount').textContent=`${filtered.length} matching records${bucketFilter?' · '+bucketFilter:''}`;$('pageSummary').textContent=`Page ${page+1} of ${pages}`;$('previousPage').disabled=page===0;$('nextPage').disabled=page>=pages-1;
  $('printMeta').textContent=`${context.projects.find(p=>String(p.id)===String(project))?.name||'Project'} · Report date: ${C.today()} · ${filtered.length} records · All matching rows included`;
  document.querySelectorAll('#registerTable th button[data-sort]').forEach(b=>b.closest('th').setAttribute('aria-sort',b.dataset.sort===sortKey?direction==='asc'?'ascending':'descending':'none'));
 }
 function renderProgress(){
  const summary=schedule.rows.find(r=>r.kind==='project');const source=performance?.weekly_table?.length?performance.weekly_table:summary&&schedule.date?[{week:schedule.date,plan:summary.schedule_pct==null?null:Number(summary.schedule_pct)*100,actual:summary.performance_pct==null?null:Number(summary.performance_pct)*100}]:[];
  const rows=C.progress(source,$('progressPeriod').value==='monthly');const has=rows.length>0&&rows.some(r=>r.actual!=null||r.plan!=null);
  $('progressChartBox').hidden=!has;$('progressEmpty').hidden=has;$('importScheduleAction').hidden=!manager();progressChart?.destroy();progressChart=null;
  if(!has){$('progressSummary').textContent='Progress uses the existing project performance source.';return;}
  const last=rows.at(-1),valid=v=>v!=null&&Number.isFinite(Number(v))?Number(v):null;
  $('progressSummary').textContent=`Latest planned: ${valid(last.plan)?.toFixed(2)??'—'}% · Actual: ${valid(last.actual)?.toFixed(2)??'—'}% · Variance: ${valid(last.actual)!=null&&valid(last.plan)!=null?(valid(last.actual)-valid(last.plan)).toFixed(2):'—'} percentage points`;
  if(typeof Chart==='undefined'){state('Chart library unavailable. Table records remain available.',true);return;}
  progressChart=new Chart($('registerProgressChart'),{type:'line',data:{labels:rows.map(r=>r.week),datasets:[{label:'Planned %',data:rows.map(r=>valid(r.plan)),borderColor:'#10b981',backgroundColor:'#10b981',borderDash:[6,4],borderWidth:2,pointRadius:3,tension:0},{label:'Actual %',data:rows.map(r=>valid(r.actual)),borderColor:'#002bff',backgroundColor:'#002bff',borderWidth:2,pointRadius:3,tension:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,devicePixelRatio:Math.max(2,devicePixelRatio||1),plugins:{legend:{position:'top',align:'start',labels:{usePointStyle:true,boxWidth:8,font:{size:10}}},tooltip:{callbacks:{label:x=>`${x.dataset.label}: ${Number(x.raw).toFixed(2)}%`}}},scales:{y:{beginAtZero:true,title:{display:true,text:'Completion (%)'},grid:{color:'#edf1f8'},ticks:{maxTicksLimit:6,callback:v=>v.toFixed(0)+'%',font:{size:10}}},x:{grid:{color:'#f1f4fa'},ticks:{maxTicksLimit:8,maxRotation:30,font:{size:9}}}}}});
 }
 function renderStatus(){
  const data=C.breakdown(C.filter(items,{...filters(),archived:false})),labels=Object.keys(data),total=Object.values(data).reduce((a,b)=>a+b,0);$('statusTotal').textContent=total;
  $('statusLegend').innerHTML=labels.map(k=>`<button type="button" data-bucket="${k}" aria-pressed="${bucketFilter===k}"><span><i class="register-legend-dot" style="background:${COLORS[k]}" aria-hidden="true"></i>${k}</span><strong>${data[k]}</strong></button>`).join('');
  statusChart?.destroy();if(typeof Chart==='undefined')return;
  statusChart=new Chart($('registerStatusChart'),{type:'doughnut',data:{labels:total?labels:['No items'],datasets:[{data:total?Object.values(data):[1],backgroundColor:total?labels.map(k=>COLORS[k]):['#edf2fb'],borderWidth:2,borderColor:'#fff'}]},options:{cutout:'70%',responsive:true,maintainAspectRatio:false,animation:false,devicePixelRatio:Math.max(2,devicePixelRatio||1),plugins:{legend:{display:false},tooltip:{enabled:total>0}},onClick:(event,points)=>{if(points.length&&total){bucketFilter=labels[points[0].index];page=0;renderTable();}}}});
 }
 function renderFinancial(){
  const money=v=>v==null?'—':Number(v).toLocaleString('en-SA',{maximumFractionDigits:0}),pct=v=>performance?.contract_value_no_vat?`${(v/performance.contract_value_no_vat*100).toFixed(2)}% of contract`:'SAR';const s=schedule.date?C.scheduleCounts(schedule.rows,schedule.date):null;
  const list=[['Contract Value',money(performance?.contract_value_no_vat),'SAR excluding VAT'],['Earned Value (EV)',money(performance?.cash_flow_ev),performance?.cash_flow_ev!=null?pct(performance.cash_flow_ev):'Unavailable'],['Planned Value (PV)',money(performance?.cash_flow_pv),performance?.cash_flow_pv!=null?pct(performance.cash_flow_pv):'Unavailable'],['Actual Invoiced (AI)',money(performance?.cash_flow_ai),performance?.cash_flow_ai!=null&&performance?.cash_flow_ev!=null?money(performance.cash_flow_ai-performance.cash_flow_ev)+' SAR vs earned':'SAR'],['Overdue Activities',s?.overdue??'—','Incomplete · baseline finish before data date'],['Critical Activities',s?.critical??'—','Total float ≤ 0 · null float excluded']];
  $('financialKpis').innerHTML=list.map(([title,value,note])=>`<div class="register-kpi"><div class="register-kpi-title">${title}</div><div class="register-kpi-value">${E(value)}</div><p>${E(note)}</p></div>`).join('');$('scheduleSource').textContent=schedule.date?`${schedule.source} · Data date: ${schedule.date}`:schedule.source||'Schedule not available';
 }
 function update(){renderKpis();renderTable();renderStatus();}
 async function load(){
  const epoch=++loadEpoch;
  state('Loading project records…');const results=await Promise.allSettled([api.items(project),api.events(project),api.performance(project),api.schedule(project)]);
  if(epoch!==loadEpoch)return;
  if(results[0].status==='rejected')throw results[0].reason;items=results[0].value;events=results[1].status==='fulfilled'?results[1].value:[];performance=results[2].status==='fulfilled'?results[2].value:null;schedule=results[3].status==='fulfilled'?results[3].value:{rows:[],source:'Schedule unavailable'};
  const owner=$('ownerFilter').value,category=$('categoryFilter').value;$('ownerFilter').innerHTML='<option value="">All owners</option>'+[...new Map(items.filter(r=>r.owner_id).map(r=>[r.owner_id,r.owner])).entries()].map(([id,name])=>`<option value="${id}">${E(name||id)}</option>`).join('');$('ownerFilter').value=owner;
  $('categoryFilter').innerHTML='<option value="">All categories</option>'+[...new Set(items.map(r=>r.category).filter(Boolean))].sort().map(c=>`<option>${E(c)}</option>`).join('');$('categoryFilter').value=category;
  $('dataDateLabel').textContent=`Report date: ${C.today()}`;$('addItem').hidden=!mayCreate();$('addItem').href=`issue-risk-editor.html?project=${project}`;
  $('editDataButton').hidden=!mayCreate()||printing;
  $('assessmentSettings').hidden=window.currentUserRole!=='super_admin';
  state(results.slice(1).some(r=>r.status==='rejected')?'Some analytics are unavailable; register records are current.':'');update();renderProgress();renderFinancial();reportPageReady();
  if(manager())api.rpc('register_deadlines',{p_project:Number(project)}).then(refreshNotificationCount).catch(()=>{});
  else refreshNotificationCount();
 }
 async function details(row){
  $('detailsTitle').textContent=`${row.code} · ${row.title}`;$('detailsContent').textContent='Loading details…';$('registerDetails').showModal();
  try{const [attachments,comments,history]=await Promise.all([api.attachments(row.kind,row.id),api.comments(row.kind,row.id),api.all('register_events',q=>q.eq('kind',row.kind).eq('item_id',row.id).order('id'))]);detailAttachments=attachments;
   const fields={Type:row.kind,Status:row.status,Priority:row.priority,Owner:row.owner,Category:row.category,Description:row.description,'Target date':row.target_date,'Risk score':row.risk_score,'Risk level':row.risk_level,...row.details};
   $('detailsContent').innerHTML=`<dl class="register-details-grid">${Object.entries(fields).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`<div><dt>${E(k.replace(/_/g,' '))}</dt><dd>${E(v)}</dd></div>`).join('')}</dl>${row.task_ref?`<p><a href="task-list.html?registerTask=${encodeURIComponent(row.task_ref)}">Open linked task ${E(row.task_ref)}</a></p>`:''}<h3>Attachments</h3>${attachments.map((a,i)=>`<p><button data-download="${i}">${E(a.name)}</button> · ${Math.ceil(a.size/1024)} KB</p>`).join('')||'<p>No attachments.</p>'}<h3>Comments</h3>${comments.map(c=>`<div class="register-history-item">${E(c.body)}<p>${E(context.people.find(p=>p.id===c.author)?.name||c.author)} · ${E(C.dateTime(c.created_at))}</p></div>`).join('')||'<p>No comments.</p>'}<h3>Activity history</h3>${history.map(e=>`<div class="register-history-item">${E(e.event)}<p>${E(context.people.find(p=>p.id===e.actor)?.name||e.actor||'System')} · ${E(C.dateTime(e.created_at))}</p></div>`).join('')}`;
  }catch(e){$('detailsContent').textContent='Could not load details: '+e.message;}
 }
 async function rowAction(event){const b=event.target.closest('[data-action]');if(!b)return;const row=items.find(r=>`${r.kind}:${r.id}`===b.dataset.key);if(!row)return;if(b.dataset.action==='view')return details(row);
  if(!mayEdit(row))return;const archive=b.dataset.action==='archive';if(archive&&!manager())return;
  if(!await notify.confirm(archive?(row.archived_at?'Restore this item?':'Archive this item? Its history will be preserved.'):(C.closed(row)?'Reopen this item?':'Close this item?')))return;
  b.disabled=true;try{await api.save(row.kind,row.id,archive?{archived_at:row.archived_at?null:new Date().toISOString()}:{status:C.closed(row)?'Open':'Closed'},row.version);await load();notify.success('Record updated.');}catch(e){notifyError(e);}finally{b.disabled=false;}
 }
 async function notifications(){
  $('notificationDialog').showModal();$('notificationList').textContent='Loading…';try{const rows=await api.all('register_notifications',q=>q.order('created_at',{ascending:false}));$('notificationList').innerHTML=rows.map(r=>`<div class="register-history-item"><a href="issue-risk-editor.html?project=${r.project_id}&kind=${r.kind}&id=${r.item_id}">${E(r.message)}</a><p>${E(C.dateTime(r.created_at))}</p>${!r.is_read?`<button data-read="${r.id}">Mark read</button>`:''}</div>`).join('')||'No notifications.';}catch(e){$('notificationList').textContent=e.message;}
 }
 function excel(){if(!window.XLSX)return notifyError(new Error('Excel export library did not load. Reload with an internet connection.'));
  const rows=[['ID','Type','Title','Category','Priority','Status','Owner','Target Date','Days Left'],...filtered.map(r=>[r.code,r.kind,r.title,r.category,r.priority,r.status,r.owner,r.target_date,C.days(r.target_date)])].map(row=>row.map(C.formulaSafe));const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Register');XLSX.writeFile(book,`MDCEO-register-${project}-${C.today()}.xlsx`);
 }
 async function print(summary){document.body.classList.toggle('register-summary',summary);let style=$('registerPrintOrientation');if(!style){style=document.createElement('style');style.id='registerPrintOrientation';document.head.appendChild(style);}style.textContent='@media print{@page{size:A4 portrait;margin:8mm}}';await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.print();}
 async function start(){if(started)return;started=true;api=new C.API(window.__guardClient);
  try{context=await api.context();if(!context.projects.length)throw new Error('You do not have access to a project register.');const requested=new URLSearchParams(location.search).get('project');project=context.projects.some(p=>String(p.id)===requested)?requested:String(context.projects[0].id);$('projectSelect').innerHTML=context.projects.map(p=>`<option value="${p.id}">${E(p.name)}</option>`).join('');$('projectSelect').value=project;
   $('priorityFilter').innerHTML+=C.PRIORITIES.map(x=>`<option>${x}</option>`).join('');$('statusFilter').innerHTML+=C.STATUSES.map(x=>`<option>${x}</option>`).join('');await load();watchProject();
   inlineEditor=new window.RegisterInlineEditor({api,context,onSaved:load});
   try{const notes=await api.all('register_notifications',q=>q.eq('is_read',false).order('id'));$('notificationCount').textContent=notes.length;}catch{}
  }catch(e){state(manager()||window.canEditDashboard?'Register access/setup is unavailable. Apply sql/issue_risk_register.sql and explicitly enable Issues & Risks in Permissions. '+e.message:'The register is not available. Contact your project administrator.',true);reportPageReady(e.message);}
 }
 function watchProject(){
  if(channel&&api.client.removeChannel)api.client.removeChannel(channel);
  if(!api.client.channel)return;
  channel=api.client.channel('mdceo-register-'+project);
  ['project_issues','project_risks','project_decisions'].forEach(table=>channel.on('postgres_changes',{event:'*',schema:'public',table,filter:'project_id=eq.'+project},()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>load().catch(notifyError),250);}));
  channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'register_notifications',filter:'recipient=eq.'+context.user_id},payload=>{refreshNotificationCount();if(payload.new?.message)notify.info(payload.new.message);});
  channel.on('postgres_changes',{event:'*',schema:'public',table:'register_settings',filter:'project_id=eq.'+project},()=>load().catch(notifyError));
  channel.on('postgres_changes',{event:'UPDATE',schema:'public',table:'project_performance',filter:'id=eq.'+project},()=>load().catch(notifyError));
  channel.subscribe();
 }
 $('editDataButton').onclick=()=>inlineEditor?.open(project);
 window.addEventListener('focus',()=>{if(context&&!inlineEditor?.active)load().catch(notifyError);});
 $('assessmentSettings').onclick=async()=>{try{const r=await api.client.from('register_settings').select('*').eq('project_id',project).maybeSingle();if(r.error)throw r.error;const bands=r.data?.risk_bands||[];$('assessmentFields').innerHTML=bands.map((b,i)=>`<label class="register-field">${E(b.level)} maximum<input type="number" name="band${i}" required min="1" max="25" step="1" value="${b.max}"></label>`).join('');$('assessmentDialog').showModal();}catch(e){notifyError(e);}};
 $('closeAssessment').onclick=()=>$('assessmentDialog').close();
 $('assessmentForm').onsubmit=async e=>{e.preventDefault();try{const bands=['Low','Medium','High','Critical'].map((level,i)=>({level,max:Number(e.target.elements.namedItem('band'+i).value)}));await api.rpc('register_configure',{p_project:Number(project),p_bands:bands});$('assessmentState').textContent='Assessment settings saved.';await load();}catch(error){$('assessmentState').textContent=error.message;}};
 window.addEventListener('beforeunload',()=>{if(channel&&api?.client.removeChannel)api.client.removeChannel(channel);});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;if(b.tagName==='A')e.preventDefault();tab=b.dataset.tab;bucketFilter='';page=0;update();});
 $('registerRows').addEventListener('click',rowAction);$('registerSearch').oninput=()=>{page=0;renderTable();};
 ['priorityFilter','statusFilter','ownerFilter','categoryFilter'].forEach(id=>$(id).onchange=()=>{page=0;renderTable();});
 ['dateFrom','dateTo','showArchived'].forEach(id=>$(id).onchange=()=>{if($('dateFrom').value&&$('dateTo').value&&$('dateFrom').value>$('dateTo').value)return state('Choose a valid date range.',true);state('');page=0;update();});
 $('clearDates').onclick=()=>{$('dateFrom').value='';$('dateTo').value='';state('');update();};
 $('resetFilters').onclick=()=>{['priorityFilter','statusFilter','ownerFilter','categoryFilter','registerSearch'].forEach(id=>$(id).value='');$('showArchived').checked=false;bucketFilter='';tab='all';page=0;update();};
 $('toggleFilters').onclick=()=>{$('filterPanel').hidden=!$('filterPanel').hidden;$('toggleFilters').setAttribute('aria-expanded',String(!$('filterPanel').hidden));};
 $('projectSelect').onchange=async()=>{project=$('projectSelect').value;page=0;items=[];events=[];performance=null;schedule={rows:[],date:null,source:'No schedule loaded for this project'};$('addItem').href='issue-risk-editor.html?project='+project;update();renderProgress();renderFinancial();watchProject();try{await load();}catch(e){state(e.message,true);}};
 $('progressPeriod').onchange=renderProgress;$('clearBucket').onclick=()=>{bucketFilter='';renderTable();};$('statusLegend').onclick=e=>{const b=e.target.closest('[data-bucket]');if(b){bucketFilter=b.dataset.bucket;page=0;renderTable();}};
 $('registerTable').querySelector('thead').onclick=e=>{const b=e.target.closest('[data-sort]');if(b){direction=sortKey===b.dataset.sort&&direction==='asc'?'desc':'asc';sortKey=b.dataset.sort;renderTable();}};
 $('pageSize').onchange=()=>{page=0;renderTable();};$('previousPage').onclick=()=>{page--;renderTable();};$('nextPage').onclick=()=>{page++;renderTable();};
 $('closeDetails').onclick=()=>$('registerDetails').close();$('closeNotifications').onclick=()=>$('notificationDialog').close();$('notificationsButton').onclick=notifications;
 $('detailsContent').onclick=async e=>{const b=e.target.closest('[data-download]');if(b)try{const url=await api.download(detailAttachments[Number(b.dataset.download)]);location.assign(url);}catch(error){notifyError(error);}};
 $('notificationList').onclick=async e=>{const b=e.target.closest('[data-read]');if(b){const r=await api.client.from('register_notifications').update({is_read:true}).eq('id',b.dataset.read);if(r.error)notifyError(r.error);else{b.remove();$('notificationCount').textContent=Math.max(0,Number($('notificationCount').textContent)-1);}}};
 $('exportExcel').onclick=excel;$('exportPdf').onclick=()=>print(false);$('exportSummary').onclick=()=>print(true);
 window.addEventListener('beforeprint',()=>{
  printing=true;renderTable();
  // Chromium can dispatch beforeprint while containers still have screen dimensions.
  // Size the live canvases to the known A4 content boxes instead of measuring those boxes.
  if(document.body.classList.contains('register-summary')){
   if(progressChart){progressChart.options.responsive=false;progressChart.resize(194*96/25.4-20,210);progressChart.update('none');}
   if(statusChart){statusChart.options.responsive=false;statusChart.resize(190,190);statusChart.update('none');}
  }else{
   const embedded=document.body.classList.contains('register-print-embed');
   if(progressChart){const box=$('registerProgressChart').parentElement.getBoundingClientRect();progressChart.options.responsive=false;progressChart.resize(embedded&&box.width?box.width:194*96/25.4*.6-28,embedded?105:125);progressChart.update('none');}
   if(statusChart){const box=$('registerStatusChart').parentElement.getBoundingClientRect();statusChart.options.responsive=false;statusChart.resize(embedded&&box.width?box.width:125,embedded?90:125);statusChart.update('none');}
  }
 });
 window.addEventListener('afterprint',()=>{printing=false;renderTable();[progressChart,statusChart].forEach(chart=>{if(chart){chart.options.responsive=true;chart.resize();chart.update('none');}});document.body.classList.remove('register-summary');$('registerPrintOrientation')?.remove();});
 document.addEventListener('register:schedule-imported',()=>load().catch(notifyError));
 document.addEventListener('authguard:ready',start);if(window.__currentProfile)start();
})();
