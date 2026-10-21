-- MDCEO register. Run after security_migration.sql; reuses profiles, project_performance,
-- submittals and the existing project_issues/project_risks tables. No sample records.
begin;
create table if not exists public.project_issues(id bigint generated always as identity primary key,code text unique,title text,in_charge text,status text,action_requested text,severity text,raised_on date,due_date date,is_closed boolean default false,sort_order int,created_at timestamptz default now());
create table if not exists public.project_risks(id bigint generated always as identity primary key,code text unique,title text,from_issue text,impact_label text,mitigation text,likelihood int check(likelihood between 1 and 5),impact int check(impact between 1 and 5),owner text,status text default 'Open',is_closed boolean default false,sort_order int,created_at timestamptz default now());
create table if not exists public.project_decisions(id bigint generated always as identity primary key,code text unique,title text,status text default 'Open',is_closed boolean default false,sort_order int,created_at timestamptz default now());
alter table public.profiles add column if not exists page_register text not null default 'no';
create sequence if not exists public.register_code_seq;
create table if not exists public.register_project_access(project_id bigint references public.project_performance(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,primary key(project_id,user_id));
create table if not exists public.register_settings(project_id bigint primary key references public.project_performance(id),risk_bands jsonb not null default '[{"max":4,"level":"Low"},{"max":9,"level":"Medium"},{"max":16,"level":"High"},{"max":25,"level":"Critical"}]');
insert into public.register_settings(project_id) select id from public.project_performance on conflict do nothing;
do $$ declare t text;had_priority boolean;begin foreach t in array array['project_issues','project_risks','project_decisions'] loop
 select exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='priority') into had_priority;
 execute format('alter table public.%I add column if not exists project_id bigint not null default 1 references public.project_performance(id), add column if not exists description text, add column if not exists category text, add column if not exists priority text, add column if not exists owner_id uuid references public.profiles(id), add column if not exists department text, add column if not exists opened_on date, add column if not exists target_date date, add column if not exists closed_at date, add column if not exists archived_at timestamptz, add column if not exists task_ref text, add column if not exists details jsonb not null default ''{}'', add column if not exists created_by uuid references public.profiles(id), add column if not exists updated_by uuid references public.profiles(id), add column if not exists updated_at timestamptz default now(), add column if not exists version int not null default 1',t);
 if not had_priority then execute format('update public.%I x set priority=case lower(to_jsonb(x)->>''severity'') when ''critical'' then ''Critical'' when ''high'' then ''High'' when ''medium'' then ''Medium'' when ''low'' then ''Low'' else null end',t);end if;
 execute format('update public.%I x set opened_on=coalesce(nullif(to_jsonb(x)->>''raised_on'','''')::date,(created_at at time zone ''Asia/Riyadh'')::date) where opened_on is null',t);
 execute format('alter table public.%I alter column opened_on set default (now() at time zone ''Asia/Riyadh'')::date',t);
 execute format('create index if not exists %I on public.%I(project_id,archived_at,target_date)',t||'_register_project',t);
 end loop;end $$;

create or replace function public.register_can_read(p_project bigint) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p where p.id=auth.uid() and not p.is_blocked
 and p.page_register='yes' and lower(coalesce(p.permissions,'admin')) in ('admin','administrator','limited','no_files','')
 and (p_project=1 or exists(select 1 from register_project_access a where a.project_id=p_project and a.user_id=p.id)));
$$;
create or replace function public.register_can_write(p_project bigint,p_owner uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.register_can_read(p_project) and (public.can_edit() or exists(select 1 from profiles where id=auth.uid() and is_engineer and p_owner=auth.uid()));
$$;
create or replace function public.register_table(p_kind text) returns text language plpgsql immutable set search_path=public as $$begin
 if p_kind not in ('issue','risk','decision') then raise exception 'Invalid item type';end if;
 return case p_kind when 'issue' then 'project_issues' when 'risk' then 'project_risks' else 'project_decisions' end;
end $$;
create or replace function public.register_normal_status(s text,c boolean) returns text language sql immutable as $$
 select case when lower(coalesce(s,''))='resolved' then 'Resolved' when lower(coalesce(s,''))='rejected' then 'Rejected' when c or lower(coalesce(s,''))='closed' then 'Closed'
 when lower(coalesce(s,'')) in ('in progress','worsening') then 'In Progress'
 when lower(coalesce(s,'')) in ('pending approval','awaiting reply','pending submission','requested') then 'Pending Approval'
 when lower(coalesce(s,''))='rejected' then 'Rejected' else 'Open' end;
$$;
create or replace function public.register_risk_level(p_project bigint,p_score int) returns text language sql stable security definer set search_path=public as $$
 select band->>'level' from register_settings s cross join lateral jsonb_array_elements(s.risk_bands) band
 where s.project_id=p_project and p_score<= (band->>'max')::int order by (band->>'max')::int limit 1;
$$;
-- RLS applies even when these tables are queried outside this module.
do $$ declare t text;pol record;begin foreach t in array array['project_issues','project_risks','project_decisions'] loop
 execute format('alter table public.%I enable row level security',t);
 for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',pol.policyname,t);end loop;
 execute format('create policy register_read on public.%I for select to authenticated using(public.register_can_read(project_id))',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;end $$;
create or replace function public.register_person_name(p_project bigint,p_user uuid) returns text language sql stable security definer set search_path=public as $$
 select username from profiles where id=p_user and not is_blocked and public.register_can_read(p_project);
$$;
create or replace view public.register_items_v with(security_invoker=true) as
 select 'issue'::text kind,i.id,i.code,i.project_id,i.title,i.description,i.category,i.priority,public.register_normal_status(i.status,i.is_closed) status,i.owner_id,coalesce(public.register_person_name(i.project_id,i.owner_id),i.in_charge) owner,i.department,i.opened_on,coalesce(i.target_date,i.due_date) target_date,i.closed_at,i.archived_at,i.task_ref,jsonb_build_object('corrective_action',i.action_requested)||i.details details,i.created_at,i.updated_at,i.created_by,i.updated_by,i.version,null::int probability,null::int impact,null::int risk_score,null::text risk_level from project_issues i left join profiles p on p.id=i.owner_id
 union all select 'risk',i.id,i.code,i.project_id,i.title,i.description,i.category,i.priority,public.register_normal_status(i.status,i.is_closed),i.owner_id,coalesce(public.register_person_name(i.project_id,i.owner_id),i.owner),i.department,i.opened_on,i.target_date,i.closed_at,i.archived_at,i.task_ref,jsonb_build_object('mitigation',i.mitigation,'impact_description',i.impact_label,'from_issue',i.from_issue)||i.details,i.created_at,i.updated_at,i.created_by,i.updated_by,i.version,i.likelihood,i.impact,i.likelihood*i.impact,public.register_risk_level(i.project_id,i.likelihood*i.impact) from project_risks i left join profiles p on p.id=i.owner_id
 union all select 'decision',i.id,i.code,i.project_id,i.title,i.description,i.category,i.priority,public.register_normal_status(i.status,i.is_closed),i.owner_id,public.register_person_name(i.project_id,i.owner_id),i.department,i.opened_on,i.target_date,i.closed_at,i.archived_at,i.task_ref,i.details,i.created_at,i.updated_at,i.created_by,i.updated_by,i.version,null::int,null::int,null::int,null::text from project_decisions i left join profiles p on p.id=i.owner_id;
grant select on public.register_items_v to authenticated;
revoke all on public.register_items_v from anon;

create table if not exists public.register_events(id bigint generated always as identity primary key,project_id bigint references public.project_performance(id),kind text not null,item_id bigint not null,event text not null,before_data jsonb,after_data jsonb,actor uuid references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.register_comments(id bigint generated always as identity primary key,project_id bigint references public.project_performance(id),kind text not null,item_id bigint not null,body text not null check(length(trim(body)) between 1 and 4000),author uuid not null default auth.uid() references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.register_notifications(id bigint generated always as identity primary key,recipient uuid not null references public.profiles(id),project_id bigint references public.project_performance(id),kind text,item_id bigint,message text,event_key text unique,is_read boolean not null default false,created_at timestamptz not null default now());
create table if not exists public.register_attachments(id uuid primary key default gen_random_uuid(),project_id bigint references public.project_performance(id),kind text not null,item_id bigint not null,name text not null,path text unique not null,size bigint not null check(size between 1 and 10485760),mime text not null,uploaded_by uuid not null default auth.uid() references public.profiles(id),created_at timestamptz not null default now());
create index if not exists register_event_lookup on public.register_events(kind,item_id,created_at);
create index if not exists register_notification_inbox on public.register_notifications(recipient,is_read,created_at);
create or replace function public.register_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare k text;v_event text;v_approver uuid;begin
 k:=case tg_table_name when 'project_issues' then 'issue' when 'project_risks' then 'risk' else 'decision' end;
 v_event:=case when tg_op='INSERT' then 'created' when new.archived_at is not null and old.archived_at is null then 'archived' when new.status is distinct from old.status then 'status changed' else 'updated' end;
 insert into register_events(project_id,kind,item_id,event,before_data,after_data,actor) values(new.project_id,k,new.id,v_event,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new),auth.uid());
 if new.owner_id is not null and (tg_op='INSERT' or new.owner_id is distinct from old.owner_id) then
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key) values(new.owner_id,new.project_id,k,new.id,new.code||': assigned to you',k||new.id||':owner:'||new.version) on conflict do nothing;end if;
 if k='risk' then
 if public.register_risk_level(new.project_id,new.likelihood*new.impact)='Critical' and (tg_op='INSERT' or new.likelihood*new.impact is distinct from old.likelihood*old.impact) then
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key) select p.id,new.project_id,k,new.id,new.code||': critical risk',k||new.id||':critical:'||new.version||':'||p.id from profiles p where not p.is_blocked and (p.id=new.owner_id or lower(coalesce(p.permissions,'admin')) in ('admin','administrator')) on conflict do nothing;end if;
 end if;
 if k='decision' then
 v_approver:=nullif(new.details->>'approver_id','')::uuid;
 if v_approver is not null and (tg_op='INSERT' or new.details is distinct from old.details or new.status is distinct from old.status) then
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key) values(v_approver,new.project_id,k,new.id,new.code||': decision '||new.status,k||new.id||':decision:'||new.version) on conflict do nothing;end if;
 if new.status in ('Resolved','Rejected') and new.created_by is not null then
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key) values(new.created_by,new.project_id,k,new.id,new.code||': approval '||new.status,k||new.id||':result:'||new.version) on conflict do nothing;end if;
 end if;
 return new;
end $$;
do $$ declare t text;begin foreach t in array array['project_issues','project_risks','project_decisions'] loop
 execute format('drop trigger if exists register_audit on public.%I',t);
 execute format('create trigger register_audit after insert or update on public.%I for each row execute function public.register_audit()',t);
 end loop;end $$;

create or replace function public.register_save(p_kind text,p_id bigint,p_payload jsonb,p_version int default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare t text;oldrow jsonb;payload jsonb;v_id bigint;v_project bigint;v_owner uuid;v_status text;v_code text;v_details jsonb;v_approver uuid;v_today date:=(now() at time zone 'Asia/Riyadh')::date;begin
 t:=public.register_table(p_kind);
 if not public.is_active_user() then raise exception 'Authentication required' using errcode='42501';end if;
 if p_id is not null then execute format('select to_jsonb(x) from public.%I x where id=$1 for update',t) into oldrow using p_id;
 if oldrow is null then raise exception 'Item not found';end if;
 if p_version is null or (oldrow->>'version')::int<>p_version then raise exception 'This item changed. Reload before saving.' using errcode='40001';end if;
 if not public.register_can_write((oldrow->>'project_id')::bigint,(oldrow->>'owner_id')::uuid) then raise exception 'No edit permission' using errcode='42501';end if;
 end if;
 payload:=coalesce(oldrow,'{}')||p_payload;
 v_project:=(payload->>'project_id')::bigint;v_owner:=nullif(payload->>'owner_id','')::uuid;v_status:=coalesce(p_payload->>'status',public.register_normal_status(oldrow->>'status',coalesce((oldrow->>'is_closed')::boolean,false)),'Open');v_details:=coalesce(payload->'details','{}');
 if p_kind='risk' then payload:=jsonb_build_object('probability',oldrow->'likelihood')||payload;v_details:=jsonb_build_object('mitigation',oldrow->>'mitigation','impact_description',oldrow->>'impact_label','from_issue',oldrow->>'from_issue')||v_details;end if;
 if p_kind='issue' then v_details:=jsonb_build_object('corrective_action',oldrow->>'action_requested')||v_details;end if;
 if not public.register_can_write(v_project,v_owner) then raise exception 'No project edit permission' using errcode='42501';end if;
 if oldrow is not null and (oldrow->>'project_id')::bigint<>v_project then raise exception 'Project cannot be changed';end if;
 if v_owner is not null and not exists(select 1 from profiles where id=v_owner and not is_blocked and lower(coalesce(permissions,'admin')) in ('admin','administrator','limited','no_files','') and page_register='yes' and (v_project=1 or exists(select 1 from register_project_access a where a.project_id=v_project and a.user_id=v_owner))) then raise exception 'Owner is not active';end if;
 if length(trim(coalesce(payload->>'title',''))) not between 1 and 300 then raise exception 'Title must be 1–300 characters';end if;
 if length(coalesce(payload->>'description',''))>10000 or length(v_details::text)>64000 or jsonb_typeof(v_details)<>'object' then raise exception 'Description/details too large or invalid';end if;
 if coalesce(payload->>'priority','Medium') not in ('Low','Medium','High','Critical') or v_status not in ('Open','In Progress','Pending Approval','Resolved','Closed','Rejected') then raise exception 'Invalid priority/status';end if;
 if not public.can_edit() and v_status in ('Resolved','Closed','Rejected') and p_kind='decision' then raise exception 'Decision approval requires manager permission';end if;
 if p_kind='decision' then
 v_approver:=nullif(v_details->>'approver_id','')::uuid;
 if v_approver is not null and not exists(select 1 from profiles p where p.id=v_approver and not p.is_blocked and p.page_register='yes' and lower(coalesce(p.permissions,'admin')) in ('admin','administrator') and (v_project=1 or exists(select 1 from register_project_access a where a.project_id=v_project and a.user_id=p.id))) then raise exception 'Approver must be an active manager with register access to this project';end if;
 end if;
 if p_kind='risk' and ((payload->>'probability')::int not between 1 and 5 or (payload->>'impact')::int not between 1 and 5 or payload->>'probability' is null or payload->>'impact' is null) then raise exception 'Probability and impact must be 1–5';end if;
 if nullif(payload->>'target_date','')::date < coalesce(nullif(payload->>'opened_on','')::date,v_today) then raise exception 'Target date precedes created date';end if;
 if nullif(payload->>'task_ref','') is not null then
 if v_project<>1 or not exists(select 1 from public.submittals where id::text=payload->>'task_ref' and (public.can_edit() or lower(action_by)=(select lower(username) from profiles where id=auth.uid()))) then raise exception 'Linked task does not belong to this project';end if;end if;
 if (oldrow->>'archived_at' is distinct from payload->>'archived_at') and not public.can_edit() then raise exception 'Only managers can archive';end if;
 v_code:=coalesce(oldrow->>'code',case p_kind when 'issue' then 'ISS-' when 'risk' then 'RSK-' else 'DEC-' end||lpad(nextval('public.register_code_seq')::text,6,'0'));
 if oldrow is null then execute format('insert into public.%I(code,title,project_id,created_by,owner_id) values($1,$2,$3,$4,$5) returning id',t) into v_id using v_code,trim(payload->>'title'),v_project,auth.uid(),v_owner;else v_id:=p_id;end if;
 execute format('update public.%I set code=$17,title=$1,description=$2,category=$3,priority=$4,status=$5,is_closed=$6,owner_id=$7,department=$8,opened_on=$9,target_date=$10,closed_at=$11,archived_at=$12,task_ref=$13,details=$14,updated_by=$15,updated_at=now(),version=version+1 where id=$16',t)
 using trim(payload->>'title'),payload->>'description',left(payload->>'category',100),case when p_id is null then coalesce(payload->>'priority','Medium') else payload->>'priority' end,v_status,v_status in ('Resolved','Closed','Rejected'),v_owner,left(payload->>'department',100),coalesce(nullif(payload->>'opened_on','')::date,v_today),nullif(payload->>'target_date','')::date,case when v_status in ('Resolved','Closed','Rejected') then coalesce(nullif(payload->>'closed_at','')::date,v_today) else null end,nullif(payload->>'archived_at','')::timestamptz,nullif(payload->>'task_ref',''),v_details,auth.uid(),v_id,v_code;
 if p_kind='risk' then execute 'update public.project_risks set likelihood=$1,impact=$2,mitigation=$3,impact_label=$4 where id=$5' using (payload->>'probability')::int,(payload->>'impact')::int,v_details->>'mitigation',v_details->>'impact_description',v_id;end if;
 if p_kind='issue' then update public.project_issues set action_requested=v_details->>'corrective_action' where id=v_id;end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1',t) into payload using v_id;
 return jsonb_build_object('id',v_id,'kind',p_kind,'code',v_code,'version',(payload->>'version')::int);
end $$;

-- Child records are scoped to the parent; audit rows cannot be edited/deleted.
create or replace function public.register_item_access(p_kind text,p_id bigint,p_write boolean default false) returns boolean language plpgsql stable security definer set search_path=public as $$
declare j jsonb;begin execute format('select to_jsonb(x) from public.%I x where id=$1',public.register_table(p_kind)) into j using p_id;
 return j is not null and case when p_write then public.register_can_write((j->>'project_id')::bigint,(j->>'owner_id')::uuid) else public.register_can_read((j->>'project_id')::bigint) end;end $$;
create or replace function public.register_file_access(p_kind text,p_id bigint,p_write boolean default false) returns boolean language sql stable security definer set search_path=public as $$
 select public.register_item_access(p_kind,p_id,p_write) and exists(select 1 from profiles where id=auth.uid() and lower(coalesce(permissions,'admin'))<>'no_files' and not is_blocked);
$$;
create or replace function public.register_child_validate() returns trigger language plpgsql security definer set search_path=public as $$
declare j jsonb;begin
 if not public.register_item_access(new.kind,new.item_id,true) then raise exception 'No parent item permission' using errcode='42501';end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1',public.register_table(new.kind)) into j using new.item_id;
 new.project_id:=(j->>'project_id')::bigint;
 if tg_table_name='register_comments' then new.author:=auth.uid();else
 new.uploaded_by:=auth.uid();
 if not public.register_file_access(new.kind,new.item_id,true) then raise exception 'File access is disabled' using errcode='42501';end if;
 if new.path not like new.project_id||'/'||new.kind||'/'||new.item_id||'/%' then raise exception 'Attachment path mismatch';end if;
 if not exists(select 1 from storage.objects where bucket_id='register-evidence' and name=new.path and coalesce((metadata->>'size')::bigint,0)=new.size and metadata->>'mimetype'=new.mime) then raise exception 'Uploaded object does not match attachment';end if;
 end if;
 insert into register_events(project_id,kind,item_id,event,after_data,actor) values(new.project_id,new.kind,new.item_id,case tg_table_name when 'register_comments' then 'comment added' else 'attachment added' end,to_jsonb(new),auth.uid());
 return new;
end $$;
do $$ declare t text;begin foreach t in array array['register_events','register_comments','register_attachments','register_notifications','register_project_access','register_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;end $$;
drop policy if exists register_read on public.register_events;
create policy register_read on public.register_events for select to authenticated using(public.register_can_read(project_id));
drop policy if exists register_read on public.register_comments;
create policy register_read on public.register_comments for select to authenticated using(public.register_item_access(kind,item_id));
drop policy if exists register_add on public.register_comments;
create policy register_add on public.register_comments for insert to authenticated with check(public.register_item_access(kind,item_id,true) and author=auth.uid());
drop policy if exists register_read on public.register_attachments;
create policy register_read on public.register_attachments for select to authenticated using(public.register_file_access(kind,item_id));
drop policy if exists register_add on public.register_attachments;
create policy register_add on public.register_attachments for insert to authenticated with check(public.register_file_access(kind,item_id,true) and uploaded_by=auth.uid());
drop trigger if exists register_validate on public.register_comments;
create trigger register_validate before insert on public.register_comments for each row execute function public.register_child_validate();
drop trigger if exists register_validate on public.register_attachments;
create trigger register_validate before insert on public.register_attachments for each row execute function public.register_child_validate();
drop policy if exists register_own on public.register_notifications;
create policy register_own on public.register_notifications for select to authenticated using(recipient=auth.uid() and public.register_can_read(project_id));
drop policy if exists register_mark_read on public.register_notifications;
create policy register_mark_read on public.register_notifications for update to authenticated using(recipient=auth.uid()) with check(recipient=auth.uid());
drop policy if exists register_settings_read on public.register_settings;
create policy register_settings_read on public.register_settings for select to authenticated using(public.register_can_read(project_id));
grant select on public.register_events,public.register_comments,public.register_attachments,public.register_notifications,public.register_settings to authenticated;
grant insert on public.register_comments,public.register_attachments to authenticated;
grant usage,select on sequence public.register_comments_id_seq to authenticated;
grant update(is_read) on public.register_notifications to authenticated;

-- Use the existing project and user identifiers; no projects/users replicas.
create or replace function public.register_context() returns jsonb language plpgsql stable security definer set search_path=public as $$begin
 if not public.is_active_user() then raise exception 'Authentication required';end if;
 if not exists(select 1 from project_performance where public.register_can_read(id)) then raise exception 'Register permission is not enabled';end if;
 return jsonb_build_object('projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',case when id=1 then 'ECODAN OFFICES COMPLEX' else 'Project '||id end)),'[]') from project_performance where public.register_can_read(id)),
 'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',username,'manager',lower(coalesce(permissions,'admin')) in ('admin','administrator'))),'[]') from profiles where not is_blocked and lower(coalesce(permissions,'admin')) in ('admin','administrator','limited','no_files','') and (page_register='yes' or id=auth.uid())),
 'manager',public.can_edit(),'engineer',(select is_engineer from profiles where id=auth.uid()),'user_id',auth.uid());
end $$;
create or replace function public.register_deadlines(p_project bigint) returns void language plpgsql security definer set search_path=public as $$begin
 if not public.can_edit() or not public.register_can_read(p_project) then raise exception 'Manager permission required';end if;
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key)
 select owner_id,project_id,kind,id,code||case when target_date<(now() at time zone 'Asia/Riyadh')::date then ': overdue' else ': due within 3 days' end,kind||id||':deadline:'||(now() at time zone 'Asia/Riyadh')::date from register_items_v where project_id=p_project and owner_id is not null and archived_at is null and status not in ('Closed','Resolved','Rejected') and target_date<=(now() at time zone 'Asia/Riyadh')::date+3 on conflict do nothing;
end $$;

-- Private evidence. Signed URLs expire after 60 seconds. No public file URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('register-evidence','register-evidence',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','image/png','image/jpeg','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.register_storage_access(p_path text,p_write boolean) returns boolean language plpgsql stable security definer set search_path=public as $$
declare j jsonb;begin
 if p_path !~ '^[0-9]+/(issue|risk|decision)/[0-9]+/[a-zA-Z0-9_.-]+$' then return false;end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1',public.register_table(split_part(p_path,'/',2))) into j using split_part(p_path,'/',3)::bigint;
 return j is not null and j->>'project_id'=split_part(p_path,'/',1) and public.register_file_access(split_part(p_path,'/',2),split_part(p_path,'/',3)::bigint,p_write);
end $$;
drop policy if exists register_evidence_read on storage.objects;
create policy register_evidence_read on storage.objects for select to authenticated using(bucket_id='register-evidence' and public.register_storage_access(name,false));
drop policy if exists register_evidence_upload on storage.objects;
create policy register_evidence_upload on storage.objects for insert to authenticated with check(bucket_id='register-evidence' and public.register_storage_access(name,true));
drop policy if exists register_evidence_cleanup on storage.objects;
create policy register_evidence_cleanup on storage.objects for delete to authenticated using(bucket_id='register-evidence' and public.register_storage_access(name,true) and not exists(select 1 from public.register_attachments a where a.path=storage.objects.name));

create or replace function public.register_configure(p_project bigint,p_bands jsonb) returns void language plpgsql security definer set search_path=public as $$
declare i int;previous_max int:=0;entry jsonb;begin
 if not public.is_admin() or not public.register_can_read(p_project) then raise exception 'Administrator permission required';end if;
 if jsonb_typeof(p_bands)<>'array' or jsonb_array_length(p_bands)<>4 then raise exception 'Four assessment bands required';end if;
 for i in 0..3 loop entry:=p_bands->i;
 if entry->>'max' is null or entry->>'level' is null or entry->>'level'<>(array['Low','Medium','High','Critical'])[i+1] or (entry->>'max')::int<=previous_max or (entry->>'max')::int>25 then raise exception 'Invalid assessment bands';end if;
 previous_max:=(entry->>'max')::int;end loop;
 if previous_max<>25 then raise exception 'Critical band must include score 25';end if;
 insert into register_settings(project_id,risk_bands) values(p_project,p_bands) on conflict(project_id) do update set risk_bands=excluded.risk_bands;
 insert into register_events(project_id,kind,item_id,event,after_data,actor) values(p_project,'settings',0,'assessment matrix changed',p_bands,auth.uid());
end $$;
-- Callable only by the service role / database scheduler, never a browser user.
create or replace function public.register_process_deadlines() returns void language sql security definer set search_path=public as $$
 insert into register_notifications(recipient,project_id,kind,item_id,message,event_key)
 select r.owner_id,r.project_id,r.kind,r.id,r.code||case when r.target_date<(now() at time zone 'Asia/Riyadh')::date then ': overdue' else ': due within 3 days' end,r.kind||r.id||':deadline:'||(now() at time zone 'Asia/Riyadh')::date
 from register_items_v r join profiles p on p.id=r.owner_id where not p.is_blocked and r.archived_at is null and r.status not in ('Closed','Resolved','Rejected') and r.target_date<=(now() at time zone 'Asia/Riyadh')::date+3 on conflict do nothing;
$$;
-- Enable automatic deadlines only when the project's pg_cron extension already exists.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 execute $job$select cron.schedule('mdceo-register-deadlines','0 5 * * *','select public.register_process_deadlines()')$job$;
 end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_issues') then alter publication supabase_realtime add table public.project_issues;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_risks') then alter publication supabase_realtime add table public.project_risks;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_decisions') then alter publication supabase_realtime add table public.project_decisions;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='register_notifications') then alter publication supabase_realtime add table public.register_notifications;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='register_settings') then alter publication supabase_realtime add table public.register_settings;end if;
 end if;
end $$;

-- Nothing here grants permanent deletion of register items.
do $$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'register_%' loop
 execute format('revoke all on function %s from public,anon',f.sig);execute format('grant execute on function %s to authenticated',f.sig);
 end loop;end $$;
revoke all on function public.register_process_deadlines() from public,anon,authenticated;
grant execute on function public.register_process_deadlines() to service_role;
commit;
