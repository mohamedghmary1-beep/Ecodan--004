-- Read-only diagnostics. Run in Supabase SQL Editor; no access is granted.
-- Replace YOUR_USERNAME with the exact username used to sign in to the portal.
with account as (
 select id,username,permissions,page_register,is_blocked
 from public.profiles where username='YOUR_USERNAME'
)
select p.username,p.permissions,p.page_register,p.is_blocked,
 (select count(*) from public.project_performance) as project_count,
 (select count(*) from public.project_performance r
  where r.id=1 or exists(select 1 from public.register_project_access a
                        where a.project_id=r.id and a.user_id=p.id)) as assigned_project_count,
 case
 when p.is_blocked is distinct from false then 'Account blocked or missing active flag'
 when p.page_register is distinct from 'yes' then 'Enable Issues & Risks and save this account in Permissions'
 when lower(coalesce(p.permissions,'admin')) not in ('admin','administrator','limited','no_files','') then 'Account role is not supported by the register'
 when not exists(select 1 from public.project_performance) then 'No project_performance records exist'
 when not exists(select 1 from public.project_performance r where r.id=1 or exists(select 1 from public.register_project_access a where a.project_id=r.id and a.user_id=p.id)) then 'No register project assigned to this account'
 else 'Database access checks pass: verify the browser uses this account and this Supabase project'
 end as diagnosis
from account p;
-- No rows means the supplied username was not found in this database.
