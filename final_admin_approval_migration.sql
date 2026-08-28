-- =====================================================================
-- MDECO Portal - Final Admin Approval Migration
-- -----------------------------------------------------------------------
-- Run this ONCE in Supabase -> SQL Editor -> New query -> Run.
-- Depends on contractor_engineer_migration.sql AND
-- company_login_migration.sql having already been run.
--
-- New flow after this migration:
--   pending_admin -> (admin routes) -> pending_engineer
--   -> (engineer writes on the PDF anywhere he likes + picks A/B/C/D)
--   -> pending_final_admin   <-- NEW STATUS, waits for YOUR approval
--   -> (you approve)  -> completed  (THEN it's inserted into submittals
--                                     and pushed to Google Drive)
--   -> (you reject)   -> back to pending_engineer, with your note, so
--                        the engineer can redo it
-- =====================================================================

alter table public.contractor_requests
    add column if not exists final_file_link text;       -- the ALREADY-ANNOTATED pdf, sitting in
                                                            -- Supabase Storage, waiting for your approval
alter table public.contractor_requests
    add column if not exists admin_final_reviewed_by text;
alter table public.contractor_requests
    add column if not exists admin_final_reviewed_at timestamptz;
alter table public.contractor_requests
    add column if not exists admin_final_note text;        -- your rejection reason, shown back to the engineer

-- No new RLS policies needed:
--   - "admin can update any request" (is_portal_admin) already covers you
--     approving/rejecting a pending_final_admin row.
--   - "engineer can update own assigned request" already covers the
--     engineer setting status = 'pending_final_admin' with the annotated
--     file link.
--   - The annotated PDF is uploaded to the SAME task-attachments bucket,
--     under the SAME contractor-requests/ folder, so the existing storage
--     policies (upload/read/cleanup for any authenticated user) already
--     cover it - no new storage policy required.
