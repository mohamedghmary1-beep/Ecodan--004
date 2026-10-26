(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RegisterCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const TERMINAL=new Set(['Closed','Resolved','Rejected']);
 const TYPES=['issue','risk','decision'],PRIORITIES=['Low','Medium','High','Critical'],STATUSES=['Open','In Progress','Pending Approval','Resolved','Closed','Rejected'],STATUS_SORT_ORDER=['Open','In Progress','Pending Approval','Rejected','Resolved','Closed'];
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const dateTime=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const days=(date,asof=today())=>date?Math.round((Date.parse(date.slice(0,10)+'T00:00:00Z')-Date.parse(asof+'T00:00:00Z'))/86400000):null;
 const closed=r=>TERMINAL.has(r.status);
 const overdue=(r,asof=today())=>!closed(r)&&!!r.target_date&&days(r.target_date,asof)<0;
 const bucket=r=>closed(r)?'Closed':r.kind==='decision'?'Decisions Requested':r.status==='In Progress'?'In Progress':r.kind==='risk'?'Open Risks':'Open Issues';
 const matchesTab=(r,tab,asof=today())=>tab==='all'||tab==='issues'&&r.kind==='issue'||tab==='risks'&&r.kind==='risk'||tab==='decisions'&&r.kind==='decision'||tab==='overdue'&&overdue(r,asof)||tab==='closed'&&closed(r)||tab==='critical'&&r.kind==='risk'&&!closed(r)&&(r.risk_level==='Critical'||r.priority==='Critical');
 function counts(rows,asof=today()){
  const active=rows.filter(r=>!r.archived_at);
  return {total:active.length,issues:active.filter(r=>r.kind==='issue'&&!closed(r)).length,risks:active.filter(r=>r.kind==='risk'&&!closed(r)).length,decisions:active.filter(r=>r.kind==='decision'&&!closed(r)).length,overdue:active.filter(r=>overdue(r,asof)).length,critical:active.filter(r=>matchesTab(r,'critical',asof)).length,closed:active.filter(closed).length};
 }
 function breakdown(rows){const result={'Open Issues':0,'Open Risks':0,'In Progress':0,'Closed':0,'Decisions Requested':0};rows.filter(r=>!r.archived_at).forEach(r=>result[bucket(r)]++);return result;}
 function filter(rows,f={}){
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
  const terms=normalize(f.search).trim().split(/\s+/).filter(Boolean);
  return rows.filter(r=>(f.archived?!!r.archived_at:!r.archived_at)&&(!f.project||String(r.project_id)===String(f.project))&&(!f.from||(r.opened_on||r.created_at||'').slice(0,10)>=f.from)&&(!f.to||(r.opened_on||r.created_at||'').slice(0,10)<=f.to)&&(!f.tab||matchesTab(r,f.tab,f.asof))&&(!f.bucket||bucket(r)===f.bucket)&&(!f.priority||r.priority===f.priority)&&(!f.status||r.status===f.status)&&(!f.owner||r.owner_id===f.owner)&&(!f.category||r.category===f.category)&&terms.every(term=>normalize([r.code,r.id,r.kind,r.status,r.priority,r.target_date,r.title,r.category,r.owner,r.description].join(' ')).includes(term)));
 }
 function sort(rows,key='created_at',direction='desc',groupByKind=false){
  const compare=(a,b)=>{
   let comparison;
   if(key==='priority'||key==='status'){
    const order=key==='priority'?PRIORITIES:STATUS_SORT_ORDER,ai=order.indexOf(a[key]),bi=order.indexOf(b[key]);
    if(ai<0||bi<0){if(ai<0&&bi<0)comparison=0;else return ai<0?1:-1;}
    else comparison=ai-bi;
   }else comparison=String(a[key]??'').localeCompare(String(b[key]??''),undefined,{numeric:true});
   return comparison*(direction==='asc'?1:-1)||Number(a.id)-Number(b.id);
  };
  return [...rows].sort((a,b)=>{
   if(groupByKind){
    const order=['issue','risk','decision'],ai=order.indexOf(a.kind),bi=order.indexOf(b.kind);
    if(ai!==bi)return (ai<0?order.length:ai)-(bi<0?order.length:bi);
    if(key==='kind')return Number(a.id)-Number(b.id);
   }
   return compare(a,b);
  });
 }
 function parsePeriod(value){
  const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];
  m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/);if(m){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase());if(month>=0)return `${m[3].length===2?'20'+m[3]:m[3]}-${String(month+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}return null;
 }
 function progress(rows,monthly=false){
  const values=(rows||[]).map(r=>({...r,date:parsePeriod(r.week)}));if(!monthly)return values;
  const groups=new Map();values.filter(r=>r.date).forEach(r=>groups.set(r.date.slice(0,7),{...r,week:r.date.slice(0,7)}));return [...groups.values()];
 }
 function historical(rows,events,cutoff){
  if(!rows.length||!events.length)return null;
  const result=[];
  for(const r of rows){const history=events.filter(e=>e.kind===r.kind&&String(e.item_id)===String(r.id)).sort((a,b)=>a.created_at.localeCompare(b.created_at));
   const prior=history.filter(e=>e.created_at<=cutoff).at(-1);
   if(prior?.after_data){const s=prior.after_data;result.push({...r,...s,kind:r.kind,status:s.is_closed?'Closed':s.status});}
   else if(history[0]?.event==='created'&&history[0].created_at>cutoff)continue;
   else return null;
  }return result;
 }
 function scheduleCounts(rows,date){const active=rows.filter(r=>r.kind==='activity');return {overdue:active.filter(r=>r.bl_finish&&r.bl_finish<date&&Number(r.physical_pct||0)<1).length,critical:active.filter(r=>r.total_float!=null&&Number(r.total_float)<=0).length};}
 function formulaSafe(value){return typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;}
 function fileType(bytes){
  if(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46)return 'pdf';
  if(bytes[0]===0x50&&bytes[1]===0x4b)return 'office';
  if(bytes[0]===0xd0&&bytes[1]===0xcf&&bytes[2]===0x11&&bytes[3]===0xe0)return 'office';
  if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'png';
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';return null;
 }
 class API{
  constructor(client){this.client=client;}
  async rpc(name,args={},options={}){
   const timeoutMs=Number(options.timeoutMs)||30000,controller=new AbortController();let timedOut=false,timer;
   try{
    const request=this.client.rpc(name,args);
    if(typeof request.abortSignal==='function')request.abortSignal(controller.signal);
    timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    const result=await request;
    if(result.error)throw result.error;
    return result.data;
   }catch(error){
    if(timedOut){const timeoutError=new Error(`Supabase request ${name} timed out after ${Math.round(timeoutMs/1000)} seconds. Check the database response before retrying.`);timeoutError.code='RPC_TIMEOUT';throw timeoutError;}
    throw error;
   }finally{clearTimeout(timer);}
  }
  async all(table,configure=q=>q){const rows=[];for(let offset=0;;offset+=500){const r=await configure(this.client.from(table).select('*')).range(offset,offset+499);if(r.error)throw r.error;rows.push(...(r.data||[]));if(!r.data||r.data.length<500)break;}return rows;}
  context(){return this.rpc('register_context');}
  async items(project){const rows=await this.all('register_items_v',q=>q.eq('project_id',project).order('kind').order('id'));return rows.map(r=>({...r,...Object.fromEntries(['opened_on','target_date','closed_at'].map(k=>[k,r[k]?String(r[k]).slice(0,10):null]))}));}
  events(project){return this.all('register_events',q=>q.eq('project_id',project).order('id'));}
  async performance(project){const r=await this.client.from('project_performance').select('*').eq('id',project).maybeSingle();if(r.error)throw r.error;return r.data;}
  async schedule(project){
   if(Number(project)!==1)return {rows:[],date:null,source:'No project schedule available'};
   const r=await this.client.from('schedule_imports').select('id,data_date,file_name').eq('is_current',true).maybeSingle();
   if(!r.error&&r.data)return {rows:await this.all('schedule_activities',q=>q.eq('import_id',r.data.id).order('id')),date:r.data.data_date,source:r.data.file_name||'Current import'};
   if(r.error&&!['PGRST205','42P01'].includes(r.error.code))throw r.error;
   const response=await fetch('../data/schedule-pms-2026-10-15.json');if(!response.ok)return {rows:[],date:null,source:'No imported schedule'};
   const data=await response.json();return {rows:data.activities,date:data.data_date,source:'Reference: '+data.file_name};
  }
  save(kind,id,payload,version){return this.rpc('register_save',{p_kind:kind,p_id:id??null,p_payload:payload,p_version:version??null});}
  async comments(kind,id){return this.all('register_comments',q=>q.eq('kind',kind).eq('item_id',id).order('id'));}
  async attachments(kind,id){return this.all('register_attachments',q=>q.eq('kind',kind).eq('item_id',id).order('created_at'));}
  async addComment(row,body){const r=await this.client.from('register_comments').insert({project_id:row.project_id,kind:row.kind,item_id:row.id,body});if(r.error)throw r.error;}
  async upload(row,file){
   const types={pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
   const ext=file.name.split('.').pop().toLowerCase(),mime=types[ext];if(!mime||file.size<=0||file.size>10485760)throw new Error('Use PDF, Excel, Word, PNG, JPEG or WebP files up to 10 MB.');
   const signature=fileType(new Uint8Array(await file.slice(0,16).arrayBuffer()));if(signature!==(ext==='jpg'?'jpeg':['xlsx','xls','docx','doc'].includes(ext)?'office':ext))throw new Error('File contents do not match its extension.');
   const path=`${row.project_id}/${row.kind}/${row.id}/${crypto.randomUUID()}.${ext}`;
   const r=await this.client.storage.from('register-evidence').upload(path,file,{contentType:mime,upsert:false});if(r.error)throw r.error;
   const meta=await this.client.from('register_attachments').insert({project_id:row.project_id,kind:row.kind,item_id:row.id,path,name:file.name,size:file.size,mime});
   if(meta.error){await this.client.storage.from('register-evidence').remove([path]);throw meta.error;}
  }
  async download(attachment){const r=await this.client.storage.from('register-evidence').createSignedUrl(attachment.path,60,{download:attachment.name});if(r.error)throw r.error;return r.data.signedUrl;}
 }
 return {TYPES,PRIORITIES,STATUSES,TERMINAL,today,dateTime,esc,days,closed,overdue,bucket,matchesTab,counts,breakdown,filter,sort,parsePeriod,progress,historical,scheduleCounts,formulaSafe,fileType,API};
});
