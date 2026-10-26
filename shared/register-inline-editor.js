(function(){
 'use strict';
 const Core=window.RegisterCore,escapeHTML=Core.esc;
 const GENERAL=[['title','Title','text',true],['description','Detailed description','textarea'],['category','Category','text'],['priority','Priority','priority'],['status','Status','status',true],['owner_id','Responsible owner','people'],['department','Department','text'],['opened_on','Date raised','date',true],['target_date','Target date','date'],['closed_at','Resolution date','date'],['task_ref','Linked existing task ID','text']];
 const DETAILS={
  issue:[['root_cause','Root cause','textarea'],['impact_description','Impact description','textarea'],['corrective_action','Corrective action','textarea'],['preventive_action','Preventive action','textarea'],['expected_resolution','Expected resolution date','date'],['resolution_notes','Resolution notes','textarea'],['resolution_evidence','Resolution evidence reference','textarea'],['remarks','Comments / remarks','textarea']],
  risk:[['probability','Probability (1-5)','number',true],['impact','Impact (1-5)','number',true],['mitigation','Mitigation plan','textarea'],['contingency','Contingency plan','textarea'],['impact_description','Impact description','textarea'],['from_issue','Related issue code','text'],['remarks','Remarks','textarea']],
  decision:[['decision_required','Decision required','textarea',true],['requested_by','Requested by','people'],['approver_id','Assigned approver','approver'],['submitted_on','Request date','date'],['required_decision_on','Required decision date','date'],['decision_status','Approval status','decisionStatus'],['decision_notes','Decision outcome','textarea'],['decision_date','Decision date','date'],['related_item','Related issue / risk','related'],['remarks','Comments','textarea']]
 };
 class RegisterInlineEditor{
  constructor({api,context,onSaved}){
   this.api=api;this.context=context;this.onSaved=onSaved;this.records=[];this.weeks=[];this.progressBaseline='[]';this.active=false;this.busy=false;this.counter=0;
   this.panel=document.getElementById('registerEditPanel');
   this.panel.addEventListener('click',event=>this.click(event));
   this.panel.addEventListener('input',event=>{if(event.target.matches('[data-field], [data-week-field]')){event.target.setCustomValidity('');this.syncDecisionStatus(event.target);this.sync();this.updateVariance();this.updateRisk(event.target.closest('[data-record]'));this.validateControl(event.target);}});
   this.panel.addEventListener('change',event=>{this.syncDecisionStatus(event.target);this.sync();this.updateVariance();});
   this.panel.addEventListener('input',event=>{if(event.target.matches('[data-comment]')){const record=this.records.find(item=>item.key===event.target.closest('[data-record]').dataset.record);if(record)record.commentDraft=event.target.value;}});
   window.addEventListener('beforeunload',event=>{if(this.active&&(this.busy||this.dirty())){event.preventDefault();event.returnValue='';}});
   document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(this.active&&link&&!link.hasAttribute('download')&&(this.busy||this.dirty())){event.preventDefault();if(this.busy)return;this.confirm('Discard unsaved register changes and leave this page?').then(ok=>{if(ok){this.close();location.assign(link.href);}});}});
  }
  async confirm(message){return window.notify?.confirm?window.notify.confirm(message):window.confirm(message);}
  status(message,error=false){const element=this.panel.querySelector('[data-edit-state]');if(element){element.textContent=message;element.classList.toggle('error',error);}const saveState=this.panel.querySelector('[data-save-state]');if(saveState){saveState.textContent=message;saveState.style.color=error?'#b42318':'';}}
  editable(row){return this.context.manager||this.context.engineer&&row.owner_id===this.context.user_id;}
  recordChanged(record){return record.deleted||!record.id||JSON.stringify(record.payload)!==record.baseline;}
  syncDecisionStatus(control){
   const element=control.closest('[data-record]'),record=element&&this.records.find(item=>item.key===element.dataset.record);
   if(record?.kind!=='decision'||!record.editable)return;
   const status=element.querySelector('[data-field="status"]'),approval=element.querySelector('[data-field="decision_status"]');
   if(control===approval&&approval.value)status.value=({Requested:'Pending Approval','Under Review':'In Progress',Approved:'Resolved',Rejected:'Rejected'})[approval.value]||status.value;
   else if(control===status)approval.value=({Open:'Requested','Pending Approval':'Requested','In Progress':'Under Review',Resolved:'Approved',Closed:'Approved',Rejected:'Rejected'})[status.value]||approval.value;
   else return;
   const closure=element.querySelector('[data-field="closed_at"]');closure.value=Core.closed({status:status.value})?closure.value||Core.today():'';
  }
  definitions(kind){return [...GENERAL,...DETAILS[kind]];}
  makeRecord(row){
   const payload={archived_at:row.archived_at??null,details:{...(row.details||{})}};
   if(row.kind==='decision'){payload.details.related_kind=payload.details.related_kind??null;payload.details.related_id=payload.details.related_id??null;}
   this.definitions(row.kind).forEach(([key,,type])=>{
    if(key==='related_item')return;
    const top=GENERAL.some(field=>field[0]===key)||['probability','impact'].includes(key);
    let value=(top?row[key]:row.details?.[key])??null;
    if(type==='date'&&value)value=String(value).slice(0,10);
    if(top)payload[key]=value;else payload.details[key]=value;
   });
   return {key:'record-'+(++this.counter),kind:row.kind,id:row.id??null,version:row.version??null,code:row.code||'New '+row.kind,editable:this.editable(row),original:row,payload,baseline:JSON.stringify(payload),deleted:false};
  }
  async open(project){
   if(this.active||!this.context.manager&&!this.context.engineer)return;
   this.project=Number(project);this.active=true;this.busy=true;this.panel.hidden=false;
   document.body.classList.add('register-editing');document.getElementById('projectSelect').disabled=true;
   this.panel.innerHTML='<p class="register-message" role="status">Loading existing project records and shared progress…</p>';
   try{
    const [rows,performance,settings]=await Promise.all([this.api.items(this.project),this.api.performance(this.project),this.api.client.from('register_settings').select('*').eq('project_id',this.project).maybeSingle()]);
    if(settings.error)throw settings.error;
    if(rows.some(row=>Number(row.project_id)!==this.project))throw Error('Project records do not match the selected project.');
    this.bands=settings.data?.risk_bands||[];this.performance=performance;this.originalProgress=structuredClone(performance?.weekly_table??null);
    this.weeks=structuredClone(performance?.weekly_table||[]).map(week=>({...week,plan:week.plan==null||week.plan===''?null:Number(week.plan),actual:week.actual==null||week.actual===''?null:Number(week.actual)}));this.progressBaseline=JSON.stringify(this.weeks);
    this.records=rows.map(row=>this.makeRecord(row));this.render();
   }catch(error){this.records=[];this.panel.innerHTML='<p class="register-message error" role="alert"></p><button type="button" data-edit-action="cancel">Back to Dashboard</button>';this.panel.querySelector('p').textContent='Could not load editor: '+error.message;}
   finally{this.busy=false;}
  }
  render(){
   const supporting=new Map([...this.panel.querySelectorAll('[data-record]')].map(element=>[element.dataset.record,{host:element.querySelector('[data-support]'),open:element.open}]));
   const projectName=this.context.projects.find(project=>Number(project.id)===this.project)?.name||String(this.project);
   this.panel.innerHTML=`<div class="register-edit-toolbar"><div><h2>Edit Data</h2><p>${escapeHTML(projectName)} — changes apply only to this project.</p></div><button type="button" class="register-button" data-edit-action="cancel">Back to Dashboard</button></div><p class="register-message" data-edit-state role="status" aria-live="polite">Edit records, then choose Save Changes. KPI values are calculated automatically.</p><form id="registerInlineForm" novalidate>${[['issue','Issues Management'],['risk','Risks Management'],['decision','Decisions Requested Management']].map(([kind,title])=>`<section class="register-card"><div class="register-edit-toolbar"><h2>${title}</h2><button type="button" class="register-button" data-edit-action="add" data-kind="${kind}">Add ${kind==='decision'?'Decision Request':kind==='risk'?'Risk':'Issue'}</button></div><div data-record-list="${kind}">${this.records.filter(record=>record.kind===kind).map(record=>this.recordHTML(record)).join('')||'<p data-empty>No records for this project.</p>'}</div></section>`).join('')}<section class="register-card"><div class="register-edit-toolbar"><h2>Cumulative Completion — Edit Data</h2><button type="button" class="register-button" data-edit-action="add-week" ${this.context.manager&&this.performance?'':'disabled'}>Add Week</button></div><p>Shared with the Performance Dashboard and live Weekly Report. Variance = Actual % - Planned %. ${!this.performance?'No performance row exists for this project; progress editing is unavailable.':!this.context.manager?'Progress is read-only for your account.':''}</p><div class="register-edit-weeks"><table><thead><tr><th>Reporting Week</th><th>Planned %</th><th>Actual %</th><th>Variance %</th><th>Action</th></tr></thead><tbody data-edit-weeks>${this.weeks.map((week,index)=>this.weekHTML(week,index)).join('')}</tbody></table></div></section><div class="register-savebar"><span data-save-state role="status" aria-live="polite"></span><button type="button" class="register-button" data-edit-action="cancel">Cancel</button><button type="submit" class="register-primary">Save Changes</button></div></form>`;
   this.panel.querySelector('form').onsubmit=event=>{event.preventDefault();this.save();};
   this.records.forEach(record=>{const element=this.panel.querySelector(`[data-record="${record.key}"]`),previous=supporting.get(record.key);if(previous){element.open=previous.open;element.querySelector('[data-support]').replaceWith(previous.host);}element.querySelector('summary').textContent=`${record.code} — ${record.payload.title||'Untitled'}${record.payload.archived_at?' (Archived)':''}${record.deleted?' — Pending deletion':''}${record.editable?'':' — Read only'}`;const archive=element.querySelector('[data-edit-action="archive"]');if(archive)archive.textContent=record.payload.archived_at?'Restore':'Archive';this.updateRisk(element);});this.updateVariance();
  }
  fieldHTML(record,[key,title,type,required]){
   const top=GENERAL.some(field=>field[0]===key)||['probability','impact'].includes(key);
   let value=top?record.payload[key]:record.payload.details[key];
   if(key==='related_item')value=record.payload.details.related_id?`${record.payload.details.related_kind}:${record.payload.details.related_id}`:'';
   const disabled=!record.editable?'disabled':'';
   const attrs=`data-field="${key}" ${disabled} ${required?'required':''} aria-label="${escapeHTML(title)}"`;
   const choices={priority:Core.PRIORITIES,status:Core.STATUSES,people:this.context.people.filter(person=>this.context.manager||person.id===this.context.user_id).map(person=>[person.id,person.name]),approver:this.context.people.filter(person=>person.manager).map(person=>[person.id,person.name]),decisionStatus:['Requested','Under Review','Approved','Rejected'],related:this.records.filter(item=>item.id&&item.kind!=='decision').map(item=>[`${item.kind}:${item.id}`,`${item.code} - ${item.original.title}`])};
   let control;
   if(choices[type]){
    const values=choices[type].map(option=>Array.isArray(option)?option:[option,option]);
    if(value!=null&&value!==''&&!values.some(([id])=>String(id)===String(value)))values.push([value,key==='owner_id'?record.original.owner||value:value]);
    control=`<select ${attrs}><option value="">Not set</option>${values.map(([id,name])=>`<option value="${escapeHTML(id)}" ${String(id)===String(value)?'selected':''} ${!this.context.manager&&record.kind==='decision'&&(type==='status'&&Core.TERMINAL.has(id)||type==='decisionStatus'&&['Approved','Rejected'].includes(id))?'disabled':''}>${escapeHTML(name)}</option>`).join('')}</select>`;
   }else if(type==='textarea')control=`<textarea ${attrs} maxlength="${key==='description'?10000:4000}" rows="3">${escapeHTML(value)}</textarea>`;
   else control=`<input ${attrs} type="${type}" value="${escapeHTML(value)}" ${type==='number'?'min="1" max="5" step="1"':type==='text'?`maxlength="${['category','department'].includes(key)?100:300}"`:''}>`;
   return `<label class="register-field ${type==='textarea'?'wide':''}">${escapeHTML(title)}${required?' *':''}${control}<span class="register-field-error" aria-live="polite"></span></label>`;
  }
  recordHTML(record){
   return `<details class="register-edit-record" data-record="${record.key}" data-deleted="${record.deleted}" ${record.id?'':'open'}><summary>${escapeHTML(record.code)} — ${escapeHTML(record.payload.title||'Untitled')} ${record.original.archived_at?'(Archived)':''}${record.editable?'':' — Read only'}</summary>${this.context.manager&&record.id?`<button type="button" class="register-delete-icon" data-edit-action="delete" aria-label="${record.deleted?'Undo deletion':'Delete this item permanently'}" title="${record.deleted?'Undo deletion':'Delete this item permanently'}"><i class="fa-solid ${record.deleted?'fa-rotate-left':'fa-trash'}" aria-hidden="true"></i></button>`:''}<div class="register-edit-fields"><div class="register-form-grid">${this.definitions(record.kind).map(field=>this.fieldHTML(record,field)).join('')}</div>${record.kind==='risk'?'<p data-risk-score></p>':''}<div class="register-edit-actions">${record.editable?`<button type="button" class="register-button" data-edit-action="lifecycle">Close / Reopen</button>`:''}${this.context.manager&&record.id?`<button type="button" class="register-button" data-edit-action="archive">${record.payload.archived_at||record.original.archived_at?'Restore':'Archive'}</button>`:!record.id?'<button type="button" class="register-button" data-edit-action="remove-new">Remove unsaved record</button>':''}</div><div class="register-edit-support"><button type="button" class="register-button" data-edit-action="support">Attachments, comments and history</button><div data-support></div></div></div></details>`;
  }
  weekHTML(week,index){
   return `<tr data-week="${index}">${[['week','text'],['plan','number'],['actual','number']].map(([key,type])=>`<td><label><input aria-label="${key==='week'?'Reporting Week':key==='plan'?'Planned %':'Actual %'}" data-week-field="${key}" type="${type}" value="${escapeHTML(week[key])}" ${key==='week'?'required maxlength="40"':'min="0" max="100" step="any"'} ${this.context.manager&&this.performance?'':'disabled'}><span class="register-field-error" aria-live="polite"></span></label></td>`).join('')}<td><output data-variance></output></td><td><button type="button" data-edit-action="remove-week" ${this.context.manager&&this.performance?'':'disabled'}>Remove Week</button></td></tr>`;
  }
  sync(){
   this.panel.querySelectorAll('[data-record]').forEach(element=>{
    const record=this.records.find(item=>item.key===element.dataset.record);if(!record||!record.editable)return;
    element.querySelectorAll('[data-field]').forEach(control=>{
     const key=control.dataset.field,top=GENERAL.some(field=>field[0]===key)||['probability','impact'].includes(key);
     const value=control.value===''?null:control.type==='number'?Number(control.value):control.value;
     if(key==='related_item'){const [kind,id]=(value||'').split(':');record.payload.details.related_kind=kind||null;record.payload.details.related_id=id?Number(id):null;}
     else if(top)record.payload[key]=value;else record.payload.details[key]=value;
    });
   });
   this.weeks=[...this.panel.querySelectorAll('[data-week]')].map((element,index)=>{
    const original=this.weeks[index]||{},week={...original};element.querySelectorAll('[data-week-field]').forEach(control=>{week[control.dataset.weekField]=control.dataset.weekField==='week'?control.value:control.value===''?null:Number(control.value);});return week;
   });
  }
  dirty(){return this.records.some(record=>this.recordChanged(record)||record.commentDraft?.trim())||JSON.stringify(this.weeks)!==this.progressBaseline||[...this.panel.querySelectorAll('[data-comment]')].some(control=>control.value.trim())||[...this.panel.querySelectorAll('[data-upload]')].some(control=>control.files.length);}
  updateVariance(){this.panel.querySelectorAll('[data-week]').forEach(element=>{const plan=element.querySelector('[data-week-field="plan"]').value,actual=element.querySelector('[data-week-field="actual"]').value;element.querySelector('[data-variance]').textContent=plan!==''&&actual!==''?(Number(actual)-Number(plan)).toFixed(2)+'%':'Not available';});}
  updateRisk(element){if(!element)return;const scoreElement=element.querySelector('[data-risk-score]');if(!scoreElement)return;const probability=Number(element.querySelector('[data-field="probability"]').value),impact=Number(element.querySelector('[data-field="impact"]').value),score=probability*impact;scoreElement.textContent=score?`Risk score: ${score} — ${this.bands.find(band=>score<=band.max)?.level||'Not configured'}`:'Risk score: Not assessed';}
  validateControl(control){const message=control.validationMessage||'';control.setAttribute('aria-invalid',String(!!message));const error=control.parentElement.querySelector('.register-field-error');if(error)error.textContent=message;return !message;}
  validate(){
   let valid=true,first;
   this.panel.querySelectorAll('[data-record]').forEach(element=>{
    const record=this.records.find(item=>item.key===element.dataset.record);if(!record.editable||record.deleted||!this.recordChanged(record))return;
    const opened=element.querySelector('[data-field="opened_on"]').value;
    const title=element.querySelector('[data-field="title"]');title.setCustomValidity(title.value.trim()?'':'Enter a title.');
    ['target_date','closed_at','expected_resolution'].forEach(key=>{const control=element.querySelector(`[data-field="${key}"]`);if(control)control.setCustomValidity(control.value&&opened&&control.value<opened?'Date cannot precede the date raised.':'');});
    if(record.kind==='decision'){const submitted=element.querySelector('[data-field="submitted_on"]').value,required=element.querySelector('[data-field="required_decision_on"]');required.setCustomValidity(submitted&&required.value&&required.value<submitted?'Required date cannot precede the request date.':'');}
   });
   const weeks=new Set();
   const progressChanged=this.context.manager&&JSON.stringify(this.weeks)!==this.progressBaseline;
   if(progressChanged)this.panel.querySelectorAll('[data-week-field="week"]').forEach(control=>{const parsed=Core.parsePeriod(control.value);control.setCustomValidity(!parsed||!/^\d{4}-\d{2}-\d{2}$/.test(parsed)||!Number.isFinite(Date.parse(parsed))||new Date(parsed).toISOString().slice(0,10)!==parsed?'Enter a valid reporting date.':weeks.has(parsed)?'This reporting week is duplicated.':'');if(parsed)weeks.add(parsed);});
   this.panel.querySelectorAll('[data-field], [data-week-field]').forEach(control=>{if(control.disabled||control.closest('[data-deleted="true"]'))return;const element=control.closest('[data-record]'),record=element&&this.records.find(item=>item.key===element.dataset.record);if(record&&!this.recordChanged(record)||control.dataset.weekField&&!progressChanged)return;if(!this.validateControl(control)){valid=false;first=first||control;control.closest('details')?.setAttribute('open','');}});
   if(first)first.focus();return valid;
  }
  async click(event){
   const button=event.target.closest('[data-edit-action]');if(!button||this.busy)return;
   const action=button.dataset.editAction,element=button.closest('[data-record]'),record=element&&this.records.find(item=>item.key===element.dataset.record);
   this.sync();
   if(action==='cancel'){if(!this.dirty()||await this.confirm('Discard unsaved changes and return to the dashboard?'))this.close();return;}
   if(action==='add'){
    const kind=button.dataset.kind;if(!Core.TYPES.includes(kind))return;
    const added=this.makeRecord({kind,project_id:this.project,owner_id:this.context.user_id,opened_on:Core.today(),priority:'Medium',status:'Open',details:kind==='decision'?{requested_by:this.context.user_id,decision_status:'Requested'}:{}});this.records.push(added);this.render();this.panel.querySelector(`[data-record="${added.key}"] input`).focus();return;
   }
   if(action==='add-week'&&this.context.manager&&this.performance){this.weeks.push({week:'',plan:null,actual:null});this.render();return;}
   if(action==='remove-week'&&this.context.manager){this.weeks.splice(Number(button.closest('[data-week]').dataset.week),1);this.render();return;}
   if(!record)return;
   if(action==='support'){await this.support(record,element);return;}
   if(action==='comment'||action==='upload'||action==='download'){await this.supportAction(action,record,element,button);return;}
   if(!record.editable)return;
   if(action==='remove-new')this.records=this.records.filter(item=>item!==record);
   if(action==='lifecycle'){if(record.kind==='decision'&&!this.context.manager)return;record.payload.status=Core.closed(record.payload)?'Open':record.kind==='decision'?'Resolved':'Closed';record.payload.closed_at=Core.closed(record.payload)?Core.today():null;if(record.kind==='decision')record.payload.details.decision_status=Core.closed(record.payload)?'Approved':'Requested';}
   if(action==='archive'&&this.context.manager)record.payload.archived_at=record.payload.archived_at?null:new Date().toISOString();
   if(action==='delete'&&this.context.manager){if(!record.deleted&&!await this.confirm(`Delete ${record.code} when Save Changes is confirmed? This permanently removes the record, clears links to it from related records, and retains its audit history.`))return;record.deleted=!record.deleted;}
   this.render();
  }
  async support(record,element){
   const host=element.querySelector('[data-support]');if(!record.id){host.textContent='Save this record before adding attachments or comments.';return;}
   if(record.supportLoading)return;
   if(host.querySelector('[data-upload]')?.files.length){this.status('Upload or clear the selected documents before refreshing supporting information.',true);return;}
   const commentDraft=host.querySelector('[data-comment]')?.value??record.commentDraft??'';
   record.commentDraft=commentDraft;record.supportLoading=true;
   try{
   host.textContent='Loading supporting information…';
   const results=await Promise.allSettled([window.currentUserRole==='no_files'?Promise.resolve([]):this.api.attachments(record.kind,record.id),this.api.comments(record.kind,record.id),this.api.all('register_events',query=>query.eq('project_id',this.project).eq('kind',record.kind).eq('item_id',record.id).order('id',{ascending:false}))]);
   record.files=results[0].status==='fulfilled'?results[0].value:[];
   host.innerHTML=results.map((result,index)=>`<h3>${['Attachments','Comments','History'][index]}</h3><div class="register-edit-support-list">${result.status==='rejected'?escapeHTML(result.reason.message):result.value.map((item,fileIndex)=>this.supportEntry(item,index,fileIndex)).join('')||'No entries.'}</div>`).join('')+(record.editable?`<label class="register-field">Add comment<textarea data-comment maxlength="4000">${escapeHTML(commentDraft)}</textarea></label><button type="button" data-edit-action="comment">Post Comment</button>${window.currentUserRole==='no_files'?'':'<label class="register-field">Add supporting documents<input type="file" data-upload multiple accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.webp"></label><button type="button" data-edit-action="upload">Upload Attachments</button>'}`:'');
   }finally{record.supportLoading=false;}
  }
  supportEntry(item,index,fileIndex){
   if(index===0)return `<p><button type="button" data-edit-action="download" data-file="${fileIndex}">${escapeHTML(item.name)}</button><br>${Math.ceil(item.size/1024)} KB · ${escapeHTML(Core.dateTime(item.created_at))}</p>`;
   const actor=this.context.people.find(person=>person.id===(item.author||item.actor))?.name||item.author||item.actor||'System';
   if(index===1)return `<p>${escapeHTML(item.body)}<br>${escapeHTML(actor)} · ${escapeHTML(Core.dateTime(item.created_at))}</p>`;
   return `<div class="register-history-item"><strong>${escapeHTML(item.event)}</strong><p>${escapeHTML(actor)} · ${escapeHTML(Core.dateTime(item.created_at))}</p>${item.before_data||item.after_data?`<details><summary>View change details</summary><p>Before</p><pre>${escapeHTML(JSON.stringify(item.before_data,null,2)||'Not set')}</pre><p>After</p><pre>${escapeHTML(JSON.stringify(item.after_data,null,2)||'Not set')}</pre></details>`:''}</div>`;
  }
  async supportAction(action,record,element,button){
   if(!record.id||action!=='download'&&!record.editable)return;
   button.disabled=true;
   this.busy=true;
   try{
    if(action==='download'){const file=record.files?.[Number(button.dataset.file)];if(file){const link=document.createElement('a');link.href=await this.api.download(file);link.download=file.name;link.target='_blank';link.rel='noopener';link.click();}return;}
    if(action==='comment'){const control=element.querySelector('[data-comment]');if(!control.value.trim())throw Error('Enter a comment first.');await this.api.addComment(record.original,control.value.trim());control.value='';record.commentDraft='';}
    if(action==='upload'){const control=element.querySelector('[data-upload]');if(!control.files.length)throw Error('Choose supporting documents first.');const pending=[...control.files];while(pending.length){await this.api.upload(record.original,pending[0]);pending.shift();const transfer=new DataTransfer();pending.forEach(file=>transfer.items.add(file));control.files=transfer.files;}control.value='';}
    await this.support(record,element);this.status('Supporting information saved. Record field changes still require Save Changes.');
   }catch(error){this.status(error.message,true);}finally{button.disabled=false;this.busy=false;}
  }
  async save(){
   if(this.busy)return;if(this.records.some(record=>record.supportLoading)){this.status('Wait for supporting information to finish loading before saving.');return;}this.sync();if(!this.validate()){this.status('Check the highlighted fields before saving.',true);return;}
   if(this.records.some(record=>record.commentDraft?.trim())||[...this.panel.querySelectorAll('[data-comment]')].some(control=>control.value.trim())){this.status('Post or clear the pending comment before saving record changes.',true);return;}
   if([...this.panel.querySelectorAll('[data-upload]')].some(control=>control.files.length)){this.status('Upload or clear the selected documents before saving record changes.',true);return;}
   const changes=this.records.filter(record=>record.editable&&this.recordChanged(record)).map(record=>({kind:record.kind,id:record.id,version:record.version,operation:record.deleted?'delete':'save',payload:{...record.payload,project_id:this.project}}));
   const progressChanged=this.context.manager&&JSON.stringify(this.weeks)!==this.progressBaseline;
   if(!changes.length&&!progressChanged){this.close();return;}
   this.busy=true;const controls=[...this.panel.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]);controls.forEach(([control])=>control.disabled=true);this.status('Saving changes…');
   let saveTimeout;
   try{
    await Promise.race([
     this.api.rpc('register_save_changes',{p_project:this.project,p_changes:changes,p_progress:progressChanged?this.weeks:null,p_expected_progress:this.originalProgress}),
     new Promise((_,reject)=>{saveTimeout=setTimeout(()=>reject(Object.assign(new Error('The save request did not return within 45 seconds. Reload and check whether the changes were saved before trying again.'),{code:'SAVE_TIMEOUT'})),45000);})
    ]);
    this.close();try{await this.onSaved();window.notify?.success('Changes saved. Dashboard refreshed.');}catch(error){window.notify?.error('Changes were saved, but the dashboard could not refresh: '+error.message);}
   }catch(error){
    console.error('Register changes save failed:',error);
    const message=error?.code==='SAVE_TIMEOUT'||error?.code==='RPC_TIMEOUT'?error.message:
     ['PGRST202','42883'].includes(error?.code)?'The inline editor database migration is required. Apply sql/issue_risk_inline_editor.sql. Your changes are still here.':
     [error?.message,error?.details,error?.hint].filter(Boolean).join(' — ')||'Save failed without a database error message. Check the browser console and Network response.';
    this.status(message,true);
   }
   finally{clearTimeout(saveTimeout);this.busy=false;controls.forEach(([control,disabled])=>control.disabled=disabled);}
  }
  close(){this.active=false;this.records=[];this.weeks=[];this.progressBaseline='[]';this.panel.hidden=true;this.panel.replaceChildren();document.body.classList.remove('register-editing');document.getElementById('projectSelect').disabled=false;document.getElementById('editDataButton')?.focus();}
 }
 window.RegisterInlineEditor=RegisterInlineEditor;
})();
