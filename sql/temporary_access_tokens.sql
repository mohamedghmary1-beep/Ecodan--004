-- Temporary links for contractor-request downloads.
-- Apply after security_migration.sql in the Supabase SQL editor.

alter table public.contractor_requests
    add column if not exists drive_file_url text;

create table if not exists public.temporary_access_tokens (
    token uuid primary key,
    request_id bigint not null,
    source_table text not null check (source_table in ('submittals', 'upload_requests', 'contractor_requests')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz
);

alter table public.temporary_access_tokens enable row level security;
revoke all on public.temporary_access_tokens from anon, authenticated;

-- Compatibility for installations that ran the earlier contractor-only
-- version of this migration. Tokens are now scoped by source_table.
alter table public.temporary_access_tokens
    add column if not exists source_table text;
alter table public.temporary_access_tokens
    add column if not exists used_at timestamptz;
update public.temporary_access_tokens
    set source_table = 'contractor_requests'
    where source_table is null;
alter table public.temporary_access_tokens
    alter column source_table set not null;
do $$
declare fk record;
begin
    -- Remove only the legacy contractor_requests foreign key. Never remove
    -- unrelated constraints that another migration may have added.
    for fk in select conname from pg_constraint
        where conrelid = 'public.temporary_access_tokens'::regclass
          and contype = 'f'
          and confrelid = 'public.contractor_requests'::regclass
    loop
        execute format('alter table public.temporary_access_tokens drop constraint %I', fk.conname);
    end loop;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.temporary_access_tokens'::regclass
          and conname = 'temporary_access_tokens_source_table_check'
    ) then
        alter table public.temporary_access_tokens add constraint temporary_access_tokens_source_table_check
            check (source_table in ('submittals', 'upload_requests', 'contractor_requests'));
    end if;
end;
$$;

-- Deliberately no client RLS policies: only the Edge Function's service-role
-- client creates and validates tokens after it has checked the requesting user.
create index if not exists temporary_access_tokens_expires_at_idx
    on public.temporary_access_tokens (expires_at);
