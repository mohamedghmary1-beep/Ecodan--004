begin;

create or replace function public.register_progress_date(p_value text) returns date
language plpgsql immutable strict set search_path=public as $$
declare parts text[];month_number int;year_number int;
begin
 p_value:=btrim(p_value);
 if p_value ~ '^\d{4}-\d{2}-\d{2}$' then return p_value::date;end if;
 if p_value ~ '^\d{1,2}[./]\d{1,2}[./]\d{4}$' then
  parts:=regexp_split_to_array(p_value,'[./]');
  return make_date(parts[3]::int,parts[2]::int,parts[1]::int);
 end if;
 if p_value ~ '^\d{1,2}[- ][A-Za-z]{3}[- ](\d{2}|\d{4})$' then
  parts:=regexp_split_to_array(p_value,'[- ]');
  month_number:=array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],lower(parts[2]));
  year_number:=case when length(parts[3])=2 then 2000+parts[3]::int else parts[3]::int end;
  if month_number is not null then return make_date(year_number,month_number,parts[1]::int);end if;
 end if;
 raise exception 'Invalid reporting week: %',p_value using errcode='22007';
end $$;

create or replace function public.register_save_changes(
 p_project bigint,p_changes jsonb,p_progress jsonb default null,p_expected_progress jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare change jsonb;payload jsonb;oldrow jsonb;table_name text;record_id bigint;
 saved jsonb:='[]'::jsonb;old_progress jsonb;week jsonb;related_project bigint;
begin
 if not public.is_active_user() or not public.register_can_read(p_project) then
  raise exception 'No access to this project register' using errcode='42501';
 end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>1000 then
  raise exception 'Changes must be an array of at most 1000 records';
 end if;
 if exists(select 1 from jsonb_array_elements(p_changes) entry
  where entry->>'id' is not null group by entry->>'kind',entry->>'id' having count(*)>1) then
  raise exception 'A record cannot appear twice in one save';
 end if;
 if p_progress is not null and p_progress<>'null'::jsonb then
  if not public.can_edit() then raise exception 'Only managers can edit shared progress' using errcode='42501';end if;
  if jsonb_typeof(p_progress)<>'array' or jsonb_array_length(p_progress)>1000 then raise exception 'Invalid progress rows';end if;
  select weekly_table::jsonb into old_progress from public.project_performance where id=p_project for update;
  if not found then raise exception 'Project performance record not found';end if;
  if coalesce(old_progress,'null'::jsonb) is distinct from coalesce(p_expected_progress,'null'::jsonb) then
   raise exception 'Shared progress changed. Cancel and reopen Edit Data before saving.' using errcode='40001';
  end if;
  for week in select value from jsonb_array_elements(p_progress) loop
   if jsonb_typeof(week)<>'object' or jsonb_typeof(week->'week') is distinct from 'string'
    or not week ? 'plan' or not week ? 'actual' then raise exception 'Each progress row requires a reporting week, plan and actual';end if;
   perform public.register_progress_date(week->>'week');
   if jsonb_typeof(week->'plan') not in ('number','null') or jsonb_typeof(week->'actual') not in ('number','null')
    or (week->>'plan')::numeric not between 0 and 100 or (week->>'actual')::numeric not between 0 and 100 then
    raise exception 'Progress percentages must be numbers from 0 to 100, or empty';
   end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_progress) entry group by public.register_progress_date(entry->>'week') having count(*)>1) then
   raise exception 'Reporting weeks must be unique';
  end if;
 end if;
 for change in select value from jsonb_array_elements(p_changes) order by value->>'kind',(value->>'id')::bigint nulls last loop
  if jsonb_typeof(change)<>'object' or change->>'operation' is null or change->>'operation' not in ('save','delete')
   or change->>'kind' is null or change->>'kind' not in ('issue','risk','decision') then raise exception 'Invalid register change';end if;
  table_name:=public.register_table(change->>'kind');record_id:=nullif(change->>'id','')::bigint;oldrow:=null;
  if record_id is not null then
   execute format('select to_jsonb(item) from public.%I item where id=$1 and project_id=$2 for update',table_name)
    into oldrow using record_id,p_project;
   if oldrow is null then raise exception 'Record not found in the selected project' using errcode='42501';end if;
   if change->>'version' is null or (oldrow->>'version')::int<>(change->>'version')::int then
    raise exception 'A record changed. Cancel and reopen Edit Data before saving.' using errcode='40001';
   end if;
  end if;
  if change->>'operation'='delete' then
   if not public.can_edit() or record_id is null then raise exception 'Only managers can delete existing records' using errcode='42501';end if;
   if exists(select 1 from public.project_decisions where project_id=p_project and details->>'related_kind'=change->>'kind' and details->>'related_id'=record_id::text)
    or (change->>'kind'='issue' and exists(select 1 from public.project_risks where project_id=p_project and coalesce(details->>'from_issue',from_issue)=oldrow->>'code')) then
    raise exception 'This record is linked to another record. Remove the link or archive it instead.';
   end if;
   insert into public.register_events(project_id,kind,item_id,event,before_data,after_data,actor)
    values(p_project,change->>'kind',record_id,'deleted',oldrow,null,auth.uid());
   execute format('delete from public.%I where id=$1 and project_id=$2',table_name) using record_id,p_project;
   saved:=saved||jsonb_build_array(jsonb_build_object('id',record_id,'kind',change->>'kind','deleted',true));
  else
   payload:=change->'payload';
   if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid record fields';end if;
   if payload ? 'project_id' and (payload->>'project_id')::bigint is distinct from p_project then raise exception 'Project cannot be changed';end if;
   payload:=payload||jsonb_build_object('project_id',p_project);
   if change->>'kind'='decision' then
    if not public.can_edit() and payload->'details'->>'decision_status' in ('Approved','Rejected') then
     raise exception 'Decision approval requires manager permission' using errcode='42501';
    end if;
    if nullif(payload->'details'->>'related_id','') is not null then
     if payload->'details'->>'related_kind' is null or payload->'details'->>'related_kind' not in ('issue','risk') then raise exception 'Invalid related item type';end if;
     execute format('select project_id from public.%I where id=$1',public.register_table(payload->'details'->>'related_kind'))
      into related_project using (payload->'details'->>'related_id')::bigint;
     if related_project is distinct from p_project then raise exception 'Related item must belong to this project';end if;
    end if;
    if nullif(payload->'details'->>'required_decision_on','')::date < nullif(payload->'details'->>'submitted_on','')::date then
     raise exception 'Required decision date precedes the request date';
    end if;
   end if;
   saved:=saved||jsonb_build_array(public.register_save(change->>'kind',record_id,payload,(change->>'version')::int));
  end if;
 end loop;
 if p_progress is not null and p_progress<>'null'::jsonb then
  update public.project_performance set weekly_table=(select coalesce(jsonb_agg(value order by public.register_progress_date(value->>'week')),'[]'::jsonb) from jsonb_array_elements(p_progress)),updated_at=now() where id=p_project;
 end if;
 return jsonb_build_object('records',saved,'project_id',p_project,'progress_saved',p_progress is not null and p_progress<>'null'::jsonb);
end $$;

revoke all on function public.register_progress_date(text) from public,anon;
revoke all on function public.register_save_changes(bigint,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.register_progress_date(text) to authenticated;
grant execute on function public.register_save_changes(bigint,jsonb,jsonb,jsonb) to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
  select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_performance'
 ) then alter publication supabase_realtime add table public.project_performance;end if;
end $$;
notify pgrst,'reload schema';
commit;
