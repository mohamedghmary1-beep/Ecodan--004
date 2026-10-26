const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.REGISTER_PGLITE_MODULE || '../tmp/register-qa/node_modules/@electric-sql/pglite');
const users = { admin: '00000000-0000-0000-0000-000000000001', engineer: '00000000-0000-0000-0000-000000000002', viewer: '00000000-0000-0000-0000-000000000003' };
async function fixture() {
 const db = new PGlite();
 await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.user',true),'')::uuid $$;
  grant usage on schema auth,storage to authenticated,anon;
  create table profiles(id uuid primary key,username text,permissions text,is_blocked boolean default false,is_engineer boolean default false,page_register text default 'no');
  create table project_performance(id bigint primary key,weekly_table jsonb,scurve_data jsonb,updated_at timestamptz default now(),contract_value_no_vat numeric,cash_flow_ev numeric,cash_flow_ai numeric,cash_flow_pv numeric);
  create table submittals(id bigint primary key,title text,no text,action_by text);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
  create function public.is_active_user() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and not is_blocked)$$;
  create function public.can_edit() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and not is_blocked and permissions in ('admin','administrator'))$$;
  create function public.is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and not is_blocked and permissions='administrator')$$;
  grant select on profiles,project_performance,submittals to authenticated;
  insert into profiles values('${users.admin}','Admin','administrator',false,false,'yes'),('${users.engineer}','Engineer','limited',false,true,'yes'),('${users.viewer}','Viewer','limited',false,false,'yes');
  insert into project_performance(id,weekly_table,scurve_data) values(1,'[{"week":"2026-10-01","plan":30,"actual":25}]','[{"week":"2026-10-01","planned_cost":4000000,"actual_cost":2500000},{"week":"2026-10-08","planned_cost":4422634,"actual_cost":3097846}]'),(2,'[{"week":"2026-10-01","plan":10,"actual":5}]','[]');
  update project_performance set contract_value_no_vat=12345678,cash_flow_ev=3500000,cash_flow_ai=2500000,cash_flow_pv=4000000 where id=1;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname, '../sql/issue_risk_register.sql'), 'utf8'));
 const migration = fs.readFileSync(path.join(__dirname, '../sql/issue_risk_inline_editor.sql'), 'utf8');
 await db.exec(migration);
 await db.exec(migration);
 await db.exec(`insert into register_project_access values(2,'${users.admin}');`);
 async function signIn(role) {
  await db.exec('reset role');
  await db.query("select set_config('app.user',$1,false)", [users[role] || role]);
  await db.exec('set role authenticated');
 }
 async function rpc(name,args={}) {
  const keys=Object.keys(args), parameters=keys.map((key,index)=>`${key} => $${index+1}`).join(',');
  return (await db.query(`select public.${name}(${parameters}) as result`,Object.values(args).map(value=>typeof value==='object'&&value!==null?JSON.stringify(value):value))).rows[0].result;
 }
 await signIn('admin');
 const issue=await rpc('register_save',{p_kind:'issue',p_id:null,p_payload:{project_id:1,title:'Existing issue',description:'Original description',priority:'High',owner_id:users.engineer,opened_on:'2026-10-01',details:{corrective_action:'Inspect equipment'}},p_version:null});
 const risk=await rpc('register_save',{p_kind:'risk',p_id:null,p_payload:{project_id:1,title:'Existing risk',probability:2,impact:3,owner_id:users.engineer,opened_on:'2026-10-01',details:{mitigation:'Existing plan'}},p_version:null});
 const decision=await rpc('register_save',{p_kind:'decision',p_id:null,p_payload:{project_id:1,title:'Existing decision',opened_on:'2026-10-01',details:{decision_required:'Confirm design',requested_by:users.admin,decision_status:'Requested'}},p_version:null});
 const other=await rpc('register_save',{p_kind:'issue',p_id:null,p_payload:{project_id:2,title:'Other project issue',opened_on:'2026-10-01'},p_version:null});
 return {db,users,signIn,rpc,issue,risk,decision,other};
}
module.exports={fixture,users};
