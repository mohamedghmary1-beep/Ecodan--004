# Issue & Risk Register — deployment and verification

## Enable the module

1. Use the same Supabase project already connected to the portal. The existing `sql/security_migration.sql` and its `profiles`, `is_active_user`, `can_edit`, `is_admin` helpers must be installed.
2. Run **`sql/issue_risk_register.sql`** in Supabase SQL Editor. It is transactional and rerunnable. It extends the existing `project_issues` and `project_risks`, preserves their IDs and legacy fields, and adds decisions, comments, private evidence, audit events, notification inbox and assessment settings. It adds no example records.
3. If Primavera import tables are not installed, run the existing **`sql/schedule_risk_migration.sql` before the register migration**. That file contains the existing report-derived register seeds; it is not required for the register CRUD itself. The optional PMS workbook importer reuses those tables and `activate_schedule_import`.
4. In the existing Permissions page, explicitly enable **Issues & Risks** for the intended users, including administrators who need this module. New `page_register` flags default to `no`; no accounts inherit register data access automatically.
5. Refresh the portal. Open **Issues & Risks** in Project Management. New routes: `pages/issue-risk-register.html` and `pages/issue-risk-editor.html`.

The SQL migration has **not** been run against the live project by the implementation agent. It needs to be applied by the project owner. There are no service-role credentials or database admin credentials in the frontend.

## Existing architecture and permissions

The portal is buildless HTML/JavaScript with the existing Supabase client and access guard. There are no duplicate users, projects or task tables. Projects use `project_performance.id`; tasks use `submittals.id`. Current production data belongs to ECODAN, project ID 1. The selector lists real accessible performance rows; it does not invent additional projects.

| Existing role | Register access |
|---|---|
| `administrator` / `admin` | Manage project records; assign owners; approve decisions; close/reopen; archive/restore |
| Engineer (`profiles.is_engineer`) | Read authorized projects; create self-owned records; update/comment/upload to assigned records; cannot approve decisions or archive |
| Viewer explicitly granted register permission | Read-only register, analytics, details and export |
| Blocked / anonymous / contractor without access | Denied by database helpers and the access guard |

The explicit `profiles.page_register = 'yes'` permission is required for register data access, including management accounts. It is never granted by the migration or inherited from Performance access. For additional project IDs, each user also needs an entry in `register_project_access(project_id,user_id)`. This references existing project/user IDs; it does not replicate either table. Task links currently belong to the legacy single ECODAN task space. Project 2+ cannot link project-1 tasks.

Single-record writes use the transactional `register_save` RPC with server validation, optimistic version checks, immutable code generation, server actor/timestamps and audit triggers. Direct REST writes/deletes on the three item tables remain revoked. Inline editing uses the additional migration described below; only managers can permanently delete a record, with confirmation and a retained audit snapshot. Archive preserves the searchable record and its history. Existing SPI/financial/progress formulas and source APIs are not changed.

## Screen behavior and data definitions

- Top KPIs and tab counts come from actual visible register rows. Archived records are excluded from active-project KPIs; the Archived filter displays them in the register table.
- Open Issue/Risk indicators mean unresolved items, including items in progress/pending approval. Closed includes Closed, Resolved and Rejected.
- Donut groups are exclusive: terminal items, then outstanding decisions, then in-progress items, then open issues/risks. Its sum equals total unarchived items.
- Historical comparisons reconstruct actual audited snapshots seven days earlier. Unknown pre-migration history is labelled unavailable; it is not manufactured. Sparklines appear only when those snapshots can be reconstructed.
- The completion chart reuses `project_performance.weekly_table`. Monthly view takes the last real report in each month. If weekly history is absent but a Primavera project summary exists, only that actual import point is shown. No artificial historical points are generated.
- Financial cards read existing contract/EV/PV/AI fields. AI versus EV remains `cash_flow_ai - cash_flow_ev`.
- Schedule cards use current imported activities where available; otherwise the existing bundled reference schedule is explicitly labelled. Overdue = incomplete activity whose baseline finish is before the schedule data date; critical = activity with non-null total float <= 0. WBS/project rows are excluded.
- Report dates/deadlines use Asia/Riyadh. Search, type tabs, column sorts, date range, priority/status/owner/category filters, archived view and pagination operate on the same complete paginated API dataset.
- All Excel/PDF exports include **all matching rows**, not just the current table page. Excel text is protected against formula injection.

## Editor and evidence

### Inline Edit Data

After the base migration, apply **`sql/issue_risk_inline_editor.sql`** in the same Supabase project. It is transactional and rerunnable. It adds no tables, sample records, project copies or progress copies. It provides the authenticated `register_save_changes` RPC and enables Realtime updates for the existing performance table when that publication is available. The implementation agent has not applied this migration to the live project.

On `pages/issue-risk-register.html`, **Edit Data** beside **+ Add New** opens the editor inside the existing main area. It temporarily hides the dashboard, keeps its components in the DOM, locks the selected project and loads all project records, including archived records, the configured risk bands and `project_performance.weekly_table`. There is no new editor route, popup or modal. The existing single-record editor remains available through existing links.

- Issues, risks and decisions have expandable forms with general and type-specific fields, close/reopen, archive/restore and manager-only staged deletion. Existing IDs and project IDs cannot be edited. Decision links must resolve to an issue/risk in the same project. Linked records cannot be deleted until links are removed; archiving remains available.
- The editor exposes private attachments, comments and attributed history inline. Comments and attachments use their existing APIs and save independently through explicit buttons; new records must first be saved. Pending comments and selected uploads must be posted/uploaded or cleared before saving field changes. Deletion preserves audit snapshots and existing supporting data under their original keys; archive should be used when the record and evidence must remain searchable in the UI.
- Only new or changed records are validated and submitted, so incomplete fields in untouched legacy records do not block unrelated edits. Record saves, confirmed deletions and optional progress changes commit in one database transaction. Existing per-record versions and a comparison with the original weekly data reject stale edits. Any validation/permission/conflict error rolls back the complete submission, leaves the form open and preserves drafts. Repeated Save clicks are disabled while saving. Decision approval controls synchronize with workflow status and closure date so KPIs use the same status definitions.
- Progress rows reuse the existing `weekly_table`, preserve unrelated performance fields, accept percentages from 0 to 100 (or empty values), reject invalid/duplicate reporting dates and save in chronological order. Variance is derived as actual minus planned. There are no editable KPI counters. Engineers can edit their own records, but cannot approve decisions, archive, delete or edit shared progress; viewers cannot open edit mode or mutate data through the RPC.
- Save Changes returns to the refreshed dashboard only after confirmed success. Cancel discards field drafts after confirmation. Navigation/unload warns about drafts, and rerendering preserves pending supporting-information controls. The Performance dashboard receives shared-progress changes through Realtime or on focus, while preserving its open edit form. The register refreshes from the same tables. New Weekly Report exports query saved records; frozen historical report snapshots remain unchanged.
- Print hides the inline editor, includes saved data and charts, retains A4 Portrait and repeats table headers. Weekly-report register charts begin the section, followed by calculated KPIs and paginated rows. There is no editor state or editable KPI source in exported reports.

### Inline verification

Modified application files: `pages/issue-risk-register.html`, `shared/issue-risk-register.js`, `shared/issue-risk-register.css`, new `shared/register-inline-editor.js` and `shared/register-inline-editor.css`, `pages/performance.html`, `pages/weekly_report.html`, `shared/register-report-print.js` and `shared/register-report-print.css`. Deployment and tests: new `sql/issue_risk_inline_editor.sql`, `tests/register-inline-fixture.cjs`, `tests/register-inline-db.test.cjs`, `tests/register-inline-browser.test.cjs`, and this document.

Install test-only dependencies with `npm install --prefix tmp/register-qa --no-audit --no-fund @electric-sql/pglite chart.js@4.4.4 playwright`. Run `node tests/register-core.test.cjs`, `node tests/register-inline-db.test.cjs` and `node tests/register-inline-browser.test.cjs`. The browser test requires Chrome (`REGISTER_CHROME` can override its executable path); `REGISTER_PGLITE_MODULE` and `REGISTER_PLAYWRIGHT_MODULE` can override module locations.

`.gitignore` excludes `tmp/`, which contains only local test dependencies and generated QA files.

These tests use an isolated PostgreSQL database, Supabase-style authenticated roles, the actual base/inline migrations, the actual register page and Chart.js 4.4.4. They cover migration reruns, atomic issue/risk/decision/progress updates, stale versions and progress, rollback, project isolation, input validation, read-only/engineer restrictions, denied direct writes, create/archive/delete/audit behavior, same-page UI, drafts, supporting comments, recalculated KPIs/charts, responsive layout and print exclusion. The generated PDF is a test artifact using fixture records, not production project data. Live authenticated Supabase CRUD, Storage transfer, Realtime delivery and a production Weekly Report smoke test remain deployment checks after applying the SQL.

The dedicated editor includes general fields, risk assessment/mitigation/contingency, issue root cause/actions/evidence, decision requester/approver/dates/notes, links to existing tasks, comments and attributed change history. Type/project are locked after creation. Save before uploading evidence.

Decision approvers must be active managers with explicit register permission and access to the decision's project. The server rejects assignments to disabled accounts or managers outside that project.

Evidence uses the private `register-evidence` bucket. PDF, Excel, Word, PNG, JPEG and WebP are limited to 10 MB. File extension/content signatures are validated in the client; bucket MIME/size constraints, object metadata checks, parent item/project ownership and RLS are validated server-side. Signed downloads expire after 60 seconds. There are no public evidence URLs. Existing `no_files` accounts cannot list, upload or download register evidence; this restriction is enforced by the file RLS helpers. Orphan uploads are cleaned up if metadata registration fails. Attachments are supporting documents for any type, including decisions.

The default assessment is a configurable 5x5 probability × impact matrix: Low 1–4, Medium 5–9, High 10–16, Critical 17–25. Administrators can change the four increasing bands in **Assessment settings**. The score and level are derived; source values are not replaced with reference-image values.

## Integrations and notifications

The shared existing sidebar gains Issues & Risks. Home, overview, performance and tasks gain project summary links once records exist; blank widgets stay hidden. The weekly report's **Print Full Report** includes a read-only Issues & Risks page after Performance by default; its position can be changed in Report Pages Print Order. The weekly PDF uses separate A4 portrait pages for Performance and the register, includes the full item descriptions and archived records alongside KPI cards, charts and financial indicators, and stops with a fit warning rather than clipping or shrinking either page. Disable browser print headers/footers in the print dialog to suppress generated URLs and timestamps. The register snapshot hides interactive controls. A task link opens its existing task page and the responsible employee, rather than creating a second task workflow. No unrelated calculation functions are modified.

Toast messages reuse `notify.js`. The new durable, per-user register inbox is separate because the existing website has no database-backed notification inbox. Assignment, critical-risk creation, decision requests and completed decisions create internal notifications transactionally. No emails or external messages are sent.

When `pg_cron` is already enabled, the migration schedules `register_process_deadlines()` daily at 05:00 UTC (08:00 Riyadh). Otherwise, deadline notices are checked on manager dashboard loads; enable pg_cron and rerun the migration for unattended delivery. This background function is service-role/database-scheduler only. A deterministic event key prevents duplicate daily notices.

Where `supabase_realtime` exists, the migration publishes the three item tables, per-user notifications and project assessment settings. The register subscribes through the existing authenticated client and refreshes on project changes. RLS still determines visibility. If Realtime is disabled in the environment, manual refresh continues to work.

## Printing

Full register: A4 landscape with the complete filtered table and KPI totals. Executive summary: A4 portrait with completion/status charts and KPI totals. Print styling is scoped to the register routes, hides sidebar/edit controls, keeps charts functional, repeats table headers and avoids splitting rows. Browser-controlled headers/footers must be disabled in the print dialog; a web page cannot override that user setting. Large registers naturally continue on additional pages, rather than being scaled to unreadable text.

## Verification performed

- `node tests/register-core.test.cjs`: business counts, exclusive breakdown, overdue and null rules, date/period parsing, monthly aggregation, chronology, historical coverage, priority sort, HTML escaping, Excel formula safety, schedule definitions, multi-page API loading and attachment signature rejection.
- The migration was run **twice** against an isolated PostgreSQL-compatible engine (PGlite) with Supabase-style auth roles/functions. Create/update, conflicting versions, risk score, ownership/project permissions, direct-write denial, comments, archive and immutable audit were exercised. Settings validation, parent attachment metadata/path checks, notification writes and service-only scheduler permissions were exercised.
- A headless browser used the actual two page sources against that isolated database: search, tabs, calculated KPIs/donut, risk score, add/save/reopen persistence, comments, archive/restore, downloaded XLSX contents and formula safety, responsive desktop/tablet/mobile checks and PDF export. Fixtures exist only in workspace QA scripts, not application pages or the live database.
- Live Supabase authenticated CRUD, Storage uploads/downloads, scheduled cron execution, Realtime delivery and multi-user production sessions still need a deployment smoke test **after** the owner applies the migration. No successful live integrations are claimed before that step.
- Follow-up verification covered saving and reopening assessment settings in the browser, and server rejection of approvers without register permission or membership in the decision's project.

No framework build step existed or was introduced. Shared scripts and inline scripts were checked with `node --check`. Existing Performance source values/calculations remain unchanged.


## Changed files and routes

- New routes: `pages/issue-risk-register.html`, `pages/issue-risk-editor.html`.
- Module logic/design: `shared/register-core.js`, `shared/issue-risk-register.js`, `shared/issue-risk-editor.js`, `shared/issue-risk-register.css`, `shared/register-schedule-import.js`.
- Existing-page integration: `shared/register-integration.js`, `shared/register-integration.css`, the existing `shared/nav-toggle.js`, and its asset version on HTML pages.
- Login/access integration only: existing `shared/auth-guard.js`, `index.html`, `pages/permissions.html`. The optional permission lookup tolerates deployments before the migration; no account is automatically granted register data access.
- Database: `sql/issue_risk_register.sql`. Tests: `tests/register-core.test.cjs`.
- No source performance formulas or API connections were changed by this module.
