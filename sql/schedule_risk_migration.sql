begin;
create table if not exists public.schedule_imports(id bigint generated always as identity primary key,data_date date not null,file_name text,imported_by uuid default auth.uid(),imported_at timestamptz default now(),is_current boolean default false);
create unique index if not exists schedule_one_current on public.schedule_imports(is_current) where is_current;
create table if not exists public.schedule_activities(
 id bigint generated always as identity primary key,import_id bigint references public.schedule_imports(id) on delete cascade,row_no int,kind text check(kind in ('project','wbs','activity')),level int,wbs_code text,parent_wbs_code text,activity_id text,name text,original_duration int,remaining_duration int,bl_start date,bl_finish date,start_date date,start_is_actual boolean,finish_date date,finish_is_actual boolean,total_float int,physical_pct numeric(6,4),budgeted_cost numeric(16,2),planned_value numeric(16,2),earned_value numeric(16,2),schedule_pct numeric(6,4),performance_pct numeric(6,4),schedule_variance numeric(16,2));
create index if not exists schedule_import_idx on public.schedule_activities(import_id);
create index if not exists schedule_kind_idx on public.schedule_activities(import_id,kind);
create index if not exists schedule_baseline_idx on public.schedule_activities(import_id,bl_finish);
create or replace view public.schedule_activity_delay_v with(security_invoker=true) as select a.*,i.data_date,
 a.finish_date-a.bl_finish as finish_variance_days,
 (a.kind='activity' and a.bl_finish<i.data_date and coalesce(a.physical_pct,0)<1) as is_overdue,
 case when a.kind='activity' and a.bl_finish<i.data_date and coalesce(a.physical_pct,0)<1 then i.data_date-a.bl_finish else 0 end days_overdue,
 coalesce(a.total_float,9999)<=0 is_critical,a.start_is_actual is not true not_started
 from public.schedule_activities a join public.schedule_imports i on i.id=a.import_id where i.is_current;
create table if not exists public.project_issues(id bigint generated always as identity primary key,code text unique,title text,in_charge text,status text,action_requested text,severity text,raised_on date,due_date date,is_closed boolean default false,sort_order int,created_at timestamptz default now());
create table if not exists public.project_risks(id bigint generated always as identity primary key,code text unique,title text,from_issue text,impact_label text,mitigation text,likelihood int check(likelihood between 1 and 5),impact int check(impact between 1 and 5),owner text,status text default 'Open',is_closed boolean default false,sort_order int,created_at timestamptz default now());
-- Same access rules as sql/security_migration.sql project_performance:
-- profiles.permissions administrator maps to super_admin; admin/empty maps to admin.
do $$ declare t text;begin foreach t in array array['schedule_imports','schedule_activities','project_issues','project_risks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('drop policy if exists read_active on public.%I',t);
 execute format('create policy read_active on public.%I for select using(auth.role()=''authenticated'' and public.is_active_user())',t);
 execute format('drop policy if exists write_editors on public.%I',t);
 execute format('create policy write_editors on public.%I for all using(public.can_edit()) with check(public.can_edit())',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('grant usage,select on sequence public.%I to authenticated',t||'_id_seq');
 end loop;end $$;
grant select on public.schedule_activity_delay_v to authenticated;
-- Atomic publication: incomplete uploads never replace the current schedule.
create or replace function public.activate_schedule_import(new_import_id bigint,expected_rows int) returns void language plpgsql security invoker set search_path=public as $$ begin
 if not public.can_edit() then raise exception 'Edit permission required';end if;
 perform pg_advisory_xact_lock(815206);
 if not exists(select 1 from public.schedule_imports where id=new_import_id) or (select count(*) from public.schedule_activities where import_id=new_import_id)<>expected_rows then raise exception 'Import is incomplete';end if;
 update public.schedule_imports set is_current=false where is_current;
 update public.schedule_imports set is_current=true where id=new_import_id;
end $$;
revoke all on function public.activate_schedule_import(bigint,int) from public;
grant execute on function public.activate_schedule_import(bigint,int) to authenticated;
-- Consultant Weekly Report No.14, issued 12 Oct 2026. No invented risk scores.
insert into public.project_issues(code,title,in_charge,status,severity,action_requested,raised_on,sort_order) values
('I1','Buildings works contractor not appointed — consultant warns it ''may affect the project timeline''','AHC','Open','critical','Confirm award date for the Buildings works package and its link to the Phase 01 finish date (23 Oct 2026)','2026-10-12',1),
('I2','Separate contractors for Elevators, Car Parking Shade, HVAC and Fire Fighting & Fire Alarm awaiting appointment','AHC','Open',null,'Set a procurement schedule for the four packages; define interfaces with the infrastructure works','2026-10-12',2),
('I3','Detailed drawings RFI — electrical drawings submitted to SPARK ECOC, approval requested','SPARK','Awaiting reply',null,'Follow up with SPARK ECOC for a response date','2026-10-12',3),
('I4','MODON plan modification — designer (Abdulwali Alyahya) to submit the Safety Plan to the MODON platform','ECC','Pending submission',null,'Request submission date from the designer through ECC','2026-10-12',4),
('I5','Progress behind plan; gap widening for consecutive weeks','Itqan Al-Arabia','Worsening',null,'Request a recovery plan / updated programme from the contractor through the consultant','2026-10-12',5)
on conflict(code) do nothing;
insert into public.project_risks(code,title,from_issue,impact_label,mitigation,sort_order) values
('R1','Phase 01 finish (23 Oct 2026) missed — finish date not re-forecast in the report','I5','Completion delay','Consultant to issue a realistic forecast finish date',1),
('R2','Building works start late, idle site after infrastructure works','I1','Programme delay','Fast-track the award decision',2),
('R3','Interface clash: infrastructure contractor is building parking-shade footings while the shade contractor is not yet appointed','I2','Rework / anchor-bolt mismatch','Freeze shade design & anchor-bolt layout before award',3),
('R4','Electrical works held by pending drawing approval','I3','Electrical delay','Escalate RFI with SPARK ECOC',4)
on conflict(code) do nothing;
commit;
