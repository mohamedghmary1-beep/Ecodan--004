(function(){
 'use strict';
 const C=window.RegisterCore,E=C.esc,$=id=>document.getElementById(id),params=new URLSearchParams(location.search);
 let api,context,row=null,project,bands=[],attachments=[],started=false,dirty=false,busy=false;
 const mayEdit=r=>context.manager||context.engineer&&(!r||r.owner_id===context.user_id);
 const label=x=>x.split('_').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' ');
 const options=(values,selected='')=>values.map(v=>{const [value,text]=Array.isArray(v)?v:[v,v];return `<option value="${E(value)}" ${String(value)===String(selected)?'selected':''}>${E(text)}</option>`;}).join('');
 const GENERAL=[['project_id','Project','project'],['code','Item ID','readonly'],['kind','Type','kind'],['title','Title','text',true],['description','Description','textarea'],['category','Category','text'],['priority','Priority','priority'],['status','Status','status'],['owner_id','Responsible employee / risk owner','people'],['department','Department','text'],['opened_on','Created date','date',true],['target_date','Target date','date'],['closed_at','Actual closure date','date'],['task_ref','Linked existing task','task']];
 const RISK=[['probability','Probability (1–5)','number',true],['impact','Impact (1–5)','number',true],['mitigation','Mitigation plan','textarea'],['contingency','Contingency plan','textarea'],['impact_description','Impact description','textarea'],['from_issue','Related issue code','text']];
 const ISSUE=[['root_cause','Root cause','textarea'],['impact_description','Impact description','textarea'],['corrective_action','Corrective action','textarea'],['preventive_action','Preventive action','textarea'],['expected_resolution','Expected resolution date','date'],['resolution_evidence','Resolution evidence / attachment reference','textarea']];
 const DECISION=[['decision_required','Decision required','textarea',true],['requested_by','Requested by','people'],['approver_id','Assigned approver','approver'],['submitted_on','Submission date','date'],['required_decision_on','Required decision date','date'],['decision_status','Decision status','decisionStatus'],['decision_notes','Decision notes','textarea'],['decision_date','Approval / rejection date','date']];
 let tasks=[];
 function state(text,error=false){$('editorState').textContent=text;$('editorState').classList.toggle('error',error);}
 function value(key){if(row)return row[key]??row.details?.[key]??'';return ({project_id:project,kind:params.get('kind')||'issue',opened_on:C.today(),priority:'Medium',status:'Open',owner_id:context.user_id,requested_by:context.user_id,code:'Generated when saved'}[key]??'');}
 function field([key,title,type,required],detail=false,scope=''){
  const raw=value(key),v=type==='date'&&raw?String(raw).slice(0,10):raw,name=(detail?'detail_'+scope+'_':'')+key,id='f_'+(scope?scope+'_':'')+key;let control='';
  const sets={project:context.projects.map(p=>[p.id,p.name]),kind:[['issue','Issue'],['risk','Risk'],['decision','Decision Request']],priority:C.PRIORITIES,status:C.STATUSES,people:context.people.filter(p=>context.manager||p.id===context.user_id).map(p=>[p.id,p.name]),approver:context.people.filter(p=>p.manager).map(p=>[p.id,p.name]),task:tasks.map(t=>[String(t.id),(t.no||t.id)+' · '+(t.title||'Task')]),decisionStatus:['Requested','Under Review','Approved','Rejected']};
  if(sets[type]){sets[type]=[...sets[type]];if(v!==''&&!sets[type].some(option=>String(Array.isArray(option)?option[0]:option)===String(v)))sets[type].push([v,key==='owner_id'?row?.owner||v:v]);control=`<select id="${id}" name="${name}" ${required?'required':''} ${(row&&['project_id','kind'].includes(key))?'disabled':''}>${['people','approver','task'].includes(type)||type==='priority'&&row&&!row.priority?'<option value="">Unassigned / none</option>':''}${options(sets[type],v)}</select>`;}
  else if(type==='textarea')control=`<textarea id="${id}" name="${name}" maxlength="${key==='description'?10000:4000}" rows="3" ${required?'required':''}>${E(v)}</textarea>`;
  else control=`<input id="${id}" name="${name}" type="${type==='readonly'?'text':type}" value="${E(v)}" ${type==='readonly'?'readonly':''} ${required?'required':''} ${type==='number'?'min="1" max="5" step="1"':''} ${type==='text'?'maxlength="300"':''}>`;
  return `<label class="register-field ${type==='textarea'?'wide':''}">${E(title)}${required?' *':''}${control}</label>`;
 }
 function kindUI(){const kind=$('f_kind').value;[['risk','riskFields'],['issue','issueFields'],['decision','decisionFields']].forEach(([key,id])=>{$(id).hidden=kind!==key;$(id).querySelectorAll('input,select,textarea').forEach(e=>e.disabled=kind!==key);});riskScore();}
 function riskScore(){const p=Number($('f_risk_probability').value),i=Number($('f_risk_impact').value),score=p&&i?p*i:null;$('riskScore').textContent=score??'—';$('riskLevel').textContent=score?bands.find(b=>score<=b.max)?.level||'Not configured':'Not assessed';}
 function changedFields(before,after,prefix=''){
  return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].flatMap(key=>{
   if(['updated_at','updated_by','version'].includes(key))return [];
   const previous=before?.[key],next=after?.[key],name=prefix+key;
   if(JSON.stringify(previous)===JSON.stringify(next))return [];
   if(key==='details')return changedFields(previous,next,'details.');
   return [{name,previous,next}];
  });
 }
 function displayValue(value){return value==null||value===''?'Not set':typeof value==='object'?JSON.stringify(value,null,2):String(value);}
 async function children(){
  for(const id of ['evidenceSection','commentsSection','historySection'])$(id).hidden=false;
  $('evidenceSection').hidden=window.currentUserRole==='no_files';
  $('attachmentInput').disabled=!row||!mayEdit(row);$('commentForm').querySelectorAll('textarea,button').forEach(control=>control.disabled=!row||!mayEdit(row));
  if(!row){for(const id of ['attachmentList','commentList','activityHistory'])$(id).textContent='Save this record first to add attachments, post comments and view its history.';return;}
  for(const id of ['attachmentList','commentList','activityHistory'])$(id).textContent='Loading…';
  const results=await Promise.allSettled([window.currentUserRole==='no_files'?Promise.resolve([]):api.attachments(row.kind,row.id),api.comments(row.kind,row.id),api.all('register_events',q=>q.eq('kind',row.kind).eq('item_id',row.id).order('id',{ascending:false}))]);
  const [files,comments,history]=results.map(result=>result.status==='fulfilled'?result.value:[]);attachments=files;
  $('attachmentList').innerHTML=files.map((f,i)=>`<div class="register-history-item"><button type="button" data-file="${i}">${E(f.name)}</button><p>${Math.ceil(f.size/1024)} KB · ${E(C.dateTime(f.created_at))}</p></div>`).join('')||'<p class="register-subtitle">No attachments yet.</p>';
  $('commentList').innerHTML=comments.map(c=>`<div class="register-history-item">${E(c.body)}<p>${E(context.people.find(p=>p.id===c.author)?.name||c.author)} · ${E(C.dateTime(c.created_at))}</p></div>`).join('')||'<p class="register-subtitle">No comments yet.</p>';
  $('activityHistory').innerHTML=history.map(h=>{const changes=h.before_data&&h.after_data?changedFields(h.before_data,h.after_data):[];return `<div class="register-history-item"><strong>${E(h.event)}</strong><p>${E(context.people.find(p=>p.id===h.actor)?.name||h.actor||'System')} · ${E(C.dateTime(h.created_at))}</p>${changes.length?`<dl class="register-change-list">${changes.map(change=>`<div><dt>${E(label(change.name.replace('details.','')))}</dt><dd><span>Before</span><pre>${E(displayValue(change.previous))}</pre><span>After</span><pre>${E(displayValue(change.next))}</pre></dd></div>`).join('')}</dl>`:''}</div>`;}).join('')||'<p class="register-subtitle">No historical changes recorded yet.</p>';
  ['attachmentList','commentList','activityHistory'].forEach((id,index)=>{if(results[index].status==='rejected')$(id).textContent='Could not load this section: '+(results[index].reason?.message||'Please try again using Refresh supporting information.');});
 }
 async function refreshRow(kind,id){const r=await api.client.from('register_items_v').select('*').eq('kind',kind).eq('id',id).single();if(r.error)throw r.error;row=r.data;}
 async function render(){
  $('generalFields').innerHTML=GENERAL.map(f=>field(f)).join('');$('riskFieldGrid').innerHTML=RISK.map(f=>field(f,true,'risk')).join('');$('issueFieldGrid').innerHTML=ISSUE.map(f=>field(f,true,'issue')).join('');$('decisionFieldGrid').innerHTML=DECISION.map(f=>field(f,true,'decision')).join('');
  $('f_kind').onchange=kindUI;$('f_risk_probability').oninput=riskScore;$('f_risk_impact').oninput=riskScore;
  $('f_project_id').onchange=async()=>{project=$('f_project_id').value;await loadSettings();};
  $('riskMatrixHelp').textContent='Configured 5 × 5 matrix: probability × impact. '+bands.map((b,i)=>`${i?bands[i-1].max+1:1}–${b.max}: ${b.level}`).join(' · ');
  kindUI();$('itemEditor').hidden=false;
  if(!mayEdit(row)){state('Read-only access. Open this item from the register to view its details.',true);$('itemEditor').querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=true);$('attachmentInput').disabled=true;$('commentForm').querySelector('button').disabled=true;}
  else state(row?`Editing ${row.code}. Version ${row.version}.`:'New record. The item ID is generated securely when saved.');
  $('backToRegister').href='issue-risk-register.html?project='+project;
  $('recordMetadata').hidden=!row;
  if(row)$('recordMetadata').innerHTML='<h2>Record information</h2><dl class="register-details-grid">'+[['Item ID',row.code],['Created by',context.people.find(person=>person.id===row.created_by)?.name||row.created_by],['Created at',C.dateTime(row.created_at)],['Last updated by',context.people.find(person=>person.id===row.updated_by)?.name||row.updated_by],['Last updated at',C.dateTime(row.updated_at)],['Version',row.version],['Archived at',row.archived_at?C.dateTime(row.archived_at):'Not archived']].map(([name,content])=>`<div><dt>${E(name)}</dt><dd>${E(displayValue(content))}</dd></div>`).join('')+'</dl>';
  await children();
 }
 async function loadSettings(){const r=await api.client.from('register_settings').select('*').eq('project_id',project).maybeSingle();if(r.error)throw r.error;bands=r.data?.risk_bands||[];$('riskMatrixHelp').textContent='Configured matrix: '+bands.map(b=>`${b.level} ≤ ${b.max}`).join(' · ');riskScore();}
 async function save(event){event.preventDefault();if(busy||!mayEdit(row)||!$('itemEditor').reportValidity())return;busy=true;$('saveItem').disabled=true;$('saveState').textContent='Saving…';
  try{const form=$('itemEditor'),payload={};GENERAL.filter(([k])=>!['code','kind'].includes(k)).forEach(([key])=>{const v=form.querySelector('#f_'+key).value;payload[key]=v===''?null:v;});payload.project_id=Number(project);const kind=$('f_kind').value;payload.details={...(row?.details||{})};
   for(const [key] of kind==='risk'?RISK:kind==='issue'?ISSUE:DECISION){const e=$('f_'+kind+'_'+key);const v=e.value;if(['probability','impact'].includes(key))payload[key]=v===''?null:Number(v);else payload.details[key]=v||null;}
   const result=await api.save(kind,row?.id??null,payload,row?.version);await refreshRow(kind,result.id);project=row.project_id;history.replaceState(null,'',`issue-risk-editor.html?project=${project}&kind=${kind}&id=${row.id}`);dirty=false;await render();$('saveState').textContent='Saved. Changes persist in the project database.';notify.success('Item saved.');
  }catch(e){$('saveState').textContent='Save failed: '+e.message;notify.error(e.message);}finally{busy=false;$('saveItem').disabled=false;}
 }
 async function start(){if(started)return;started=true;api=new C.API(window.__guardClient);
  try{context=await api.context();if(!context.projects.length)throw new Error('No accessible projects.');const requested=params.get('project');project=context.projects.some(p=>String(p.id)===requested)?requested:context.projects[0].id;
   if(params.get('id')){if(!C.TYPES.includes(params.get('kind')))throw new Error('Invalid item type.');await refreshRow(params.get('kind'),params.get('id'));project=row.project_id;}
   if(!row&&!context.manager&&!context.engineer)throw new Error('This account has read-only access.');
   if(context.manager||window.__currentProfile?.page_task==='yes'){try{tasks=await api.all('submittals',q=>q.order('id'));}catch{tasks=[];}}
   const settings=await api.client.from('register_settings').select('*').eq('project_id',project).maybeSingle();if(settings.error)throw settings.error;bands=settings.data?.risk_bands||[];await render();
  }catch(e){const permissionDenied=e.message==='Register permission is not enabled';state(permissionDenied?'Editor unavailable: this account has no accessible register project. In Permissions, enable Issues & Risks for the account you are signed in with and save its row. If it is already enabled, verify the account role and project access.':'Editor unavailable: '+e.message+(['PGRST202','PGRST205','42P01','42883'].includes(e.code)?' · Apply sql/issue_risk_register.sql in the connected Supabase project.':''),true);}
 }
 $('itemEditor').onsubmit=save;$('itemEditor').oninput=()=>dirty=true;window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 $('reloadHistory').onclick=async()=>{const button=$('reloadHistory');button.disabled=true;try{await children();}finally{button.disabled=false;}};
 $('attachmentInput').onchange=async e=>{if(!row||!mayEdit(row))return;const files=[...e.target.files];e.target.disabled=true;try{for(const file of files){$('attachmentState').textContent='Uploading '+file.name+'…';await api.upload(row,file);}$('attachmentState').textContent='Evidence uploaded securely.';await children();}catch(error){$('attachmentState').textContent=error.message;notify.error(error.message);}finally{e.target.value='';e.target.disabled=false;}};
 $('attachmentList').onclick=async e=>{const b=e.target.closest('[data-file]');if(!b)return;try{location.assign(await api.download(attachments[Number(b.dataset.file)]));}catch(error){notify.error(error.message);}};
 $('commentForm').onsubmit=async e=>{e.preventDefault();const body=$('commentBody').value.trim();if(!row||!body||!mayEdit(row))return;const button=e.target.querySelector('button');button.disabled=true;try{await api.addComment(row,body);$('commentBody').value='';await children();}catch(error){notify.error(error.message);}finally{button.disabled=false;}};
 document.addEventListener('authguard:ready',start);if(window.__currentProfile)start();
})();
