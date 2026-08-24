-- =====================================================================
-- ECODAN Portal - Security Remediation Migration
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to run top-to-bottom once. Read the comments before running.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 0 - order matters: run migrate_users.mjs FIRST (creates one
-- Supabase Auth user + one `profiles` row per existing row in `users`).
-- This script assumes the `profiles` table already has your real users
-- in it. If you haven't run migrate_users.mjs yet, do that first.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- STEP 1 - profiles table (created by migrate_users.mjs, but this is
-- here too so the migration is self-contained / re-runnable)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique not null,
    permissions text default 'admin',
    page_performance text default 'no',
    page_summary text default 'no',
    page_task text default 'no',
    page_home text default 'no',
    page_weekly_report text default 'no',
    page_general_by_activity text default 'no',
    created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Helper: is the CURRENTLY AUTHENTICATED caller an "administrator"?
-- security definer so it can read profiles regardless of the caller's
-- own RLS visibility (avoids recursive-policy problems).
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and lower(coalesce(permissions,'')) = 'administrator'
    );
$$;

-- Helper: can the caller add/edit/delete dashboard data? (administrator
-- or admin role - mirrors window.canEditDashboard in auth-guard.js)
create or replace function public.can_edit()
returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid()
          and lower(coalesce(permissions,'admin')) in ('administrator','admin')
    );
$$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
    for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
    for update using (public.is_admin());

-- No INSERT/DELETE policy on purpose: create/remove users only from the
-- Supabase Dashboard (Auth) + migrate_users.mjs / SQL, never from the
-- public app.

-- ---------------------------------------------------------------------
-- STEP 2 - Retire the old plaintext-password `users` table.
-- Finding #1 / #3 in the audit: weak login + a credential exposed in
-- code both trace back to this table being directly queryable (and its
-- `password` column selectable) with the public anon/publishable key.
-- We keep the table temporarily as a backup/reference, but cut off ALL
-- client access to it - the app no longer touches it at all (it now
-- uses Supabase Auth + `profiles`, see index.html / auth-guard.js).
-- Once you've confirmed every user can log in via the new flow, DROP
-- this table entirely (see STEP 2b).
-- ---------------------------------------------------------------------
alter table public.users enable row level security;
revoke all on public.users from anon, authenticated;
-- (no policies created -> default is "deny all" for anon/authenticated)

-- STEP 2b (run ONLY after you've verified every user can log in via the
-- new Supabase-Auth flow for a few days):
-- drop table public.users;

-- ---------------------------------------------------------------------
-- STEP 3 - RLS on every business table.
-- Findings #4 (insufficient access control) and #5 (RLS review) - these
-- tables currently have RLS disabled, meaning the SAME anon/publishable
-- key that ships in every page's HTML can read AND write every row in
-- every table directly, with no server-side check of who's asking.
--
-- Adjust the exact rules below to your real business policy - these are
-- a reasonable, safe-by-default starting point:
--   - any logged-in (authenticated) user can READ dashboard data
--   - only "admin"/"administrator" roles can WRITE (insert/update/delete)
--   - upload_requests (used by approvals.html, an ADMIN_ONLY page) is
--     readable/writable by administrators only
-- ---------------------------------------------------------------------
alter table public.submittals          enable row level security;
alter table public.upload_requests     enable row level security;
alter table public.project_performance enable row level security;
alter table public.weekly_reports      enable row level security;
alter table public.printed_reports     enable row level security;

drop policy if exists "submittals_select_auth" on public.submittals;
create policy "submittals_select_auth" on public.submittals
    for select using (auth.role() = 'authenticated');
drop policy if exists "submittals_write_editors" on public.submittals;
create policy "submittals_write_editors" on public.submittals
    for all using (public.can_edit()) with check (public.can_edit());

drop policy if exists "upload_requests_admin_only" on public.upload_requests;
create policy "upload_requests_admin_only" on public.upload_requests
    for all using (public.is_admin()) with check (public.is_admin());
-- If regular employees also need to submit their OWN upload requests
-- from task-list.html/task.html (not just admins reviewing them in
-- approvals.html), replace the policy above with two narrower ones:
--   for insert: using (auth.role() = 'authenticated')   -- anyone can submit
--   for select/update/delete: using (public.is_admin()) -- only admin reviews

drop policy if exists "project_performance_select_auth" on public.project_performance;
create policy "project_performance_select_auth" on public.project_performance
    for select using (auth.role() = 'authenticated');
drop policy if exists "project_performance_write_editors" on public.project_performance;
create policy "project_performance_write_editors" on public.project_performance
    for all using (public.can_edit()) with check (public.can_edit());

drop policy if exists "weekly_reports_select_auth" on public.weekly_reports;
create policy "weekly_reports_select_auth" on public.weekly_reports
    for select using (auth.role() = 'authenticated');
drop policy if exists "weekly_reports_write_editors" on public.weekly_reports;
create policy "weekly_reports_write_editors" on public.weekly_reports
    for all using (public.can_edit()) with check (public.can_edit());

drop policy if exists "printed_reports_select_auth" on public.printed_reports;
create policy "printed_reports_select_auth" on public.printed_reports
    for select using (auth.role() = 'authenticated');
drop policy if exists "printed_reports_insert_editors" on public.printed_reports;
create policy "printed_reports_insert_editors" on public.printed_reports
    for insert with check (public.can_edit());

-- ---------------------------------------------------------------------
-- STEP 4 - Storage: task-attachments bucket, currently PUBLIC.
-- Finding #6 (public access to files/attachments): anyone with a file's
-- URL - or who enumerates predictable paths - can download it forever,
-- with no login at all. Switch the bucket to private and require the
-- caller to be authenticated to read/write; the app already asks for a
-- freshly generated, time-limited signed URL instead of the old
-- permanent public URL (see auth-guard.js: getAttachmentSignedUrl).
-- ---------------------------------------------------------------------
update storage.buckets set public = false where id = 'task-attachments';

drop policy if exists "attachments_select_auth" on storage.objects;
create policy "attachments_select_auth" on storage.objects
    for select using (bucket_id = 'task-attachments' and auth.role() = 'authenticated');

drop policy if exists "attachments_insert_auth" on storage.objects;
create policy "attachments_insert_auth" on storage.objects
    for insert with check (bucket_id = 'task-attachments' and auth.role() = 'authenticated');

drop policy if exists "attachments_delete_editors" on storage.objects;
create policy "attachments_delete_editors" on storage.objects
    for delete using (bucket_id = 'task-attachments' and public.can_edit());

-- =====================================================================
-- After running this file:
--   1) Test logging in as each role (administrator / admin / no_files /
--      limited) and confirm every page still behaves as expected.
--   2) Confirm attachments still preview/open/approve correctly in
--      approvals.html (uses the new signed-URL helper).
--   3) Only then run STEP 2b to drop the old `users` table.
-- =====================================================================
