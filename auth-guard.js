/*
  MDECO Portal - Shared Access Control Script
  ---------------------------------------------
  Include this on EVERY protected page, right after the Supabase JS library
  <script> tag in <head>:

      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <script src="auth-guard.js"></script>

  It reads the session saved by index.html (localStorage "userSession":
  { username, permissions, ...one 'yes'/'no' field per page, see PAGE_COLUMNS
  below }) and enforces access in two layers:

  1) Role (from the "permissions" column):
    - "administrator"           -> super-admin. Sees EVERY page, no matter what,
                                    including ADMIN_ONLY_PAGES (approvals.html,
                                    team_overview.html) and ignores the per-page
                                    yes/no columns entirely. Use window.guardUpload()
                                    to require a password re-check before any
                                    add/upload action.
    - "admin" / "no_files" / "limited" (or empty/NULL -> "admin")
                                 -> regular roles. ALWAYS blocked from
                                    ADMIN_ONLY_PAGES. For every other page, access
                                    now depends on layer 2 below.
    - anything else / logged out -> blocked / redirected to index.html.

  2) Per-page yes/no columns on the users table (see PAGE_COLUMNS): one text
     column per page, holding literally "yes" or "no" (or empty = same as "no").
    - For any page that ISN'T in ADMIN_ONLY_PAGES, a non-administrator user can
      only open it if that page's column says "yes" for their row. Otherwise
      they're blocked AND the matching nav-btn link is hidden.
    - Add a new page to the portal? Add its filename + a new column name to
      PAGE_COLUMNS below, then add that column to the users table.
    - index.html (the login page) is always reachable regardless of this.

  index.html must be updated to copy every PAGE_COLUMNS column from the users
  table into the saved session at login time, same as it already does for
  "permissions" — see index.html for that part.
*/
(function () {
    const SUPABASE_URL = "https://uhhtvpxtpayovbtmnstz.supabase.co";
    const SUPABASE_KEY = "sb_publishable_QsS0UhLBORy6mOaBDgW62g_9OacC3oO";
    const guardClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Pages that ONLY the "administrator" (super-admin) role can open.
    // Every other role (admin, no_files, limited) gets the access-denied
    // screen automatically, and the matching nav-btn link is hidden for
    // them too — regardless of their PAGE_COLUMNS values below.
    // Add more page filenames here any time you need to lock a
    // page to the administrator role.
    // NOTE: change 'team_overview.html' below if your "نظرة عامة على الموظفين"
    // page has a different filename.
    const ADMIN_ONLY_PAGES = ['approvals.html', 'team_overview.html'];

    // Pages every logged-in user can always reach, no matter what — the
    // login page itself.
    const ALWAYS_ALLOWED_PAGES = ['index.html'];

    // Maps each controllable page filename to its yes/no column in the
    // users table. To add a new page: add a row here, then add that same
    // column to the users table in Supabase (text, values "yes" or "no").
    const PAGE_COLUMNS = {
        'performance.html': 'page_performance',
        'summary.html': 'page_summary',
        'task-list.html': 'page_task',
        'home.html': 'page_home',
        'weekly_report.html': 'page_weekly_report',
        'weekly_report_view.html': 'page_weekly_report',
        'general_by_activity.html': 'page_general_by_activity'
    };

    function currentPage() {
        let path = window.location.pathname.split('/').pop();
        return path || 'home.html';
    }

    function getSession() {
        try {
            const raw = localStorage.getItem('userSession');
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    const session = getSession();
    const page = currentPage();

    // Not logged in -> bounce to login immediately (skip check on login page itself)
    if (!session || !session.username) {
        if (page !== 'index.html') {
            window.location.href = 'index.html';
        }
        return;
    }

    const rawPerm = (session.permissions || '').trim().toLowerCase();
    let role;
    if (rawPerm === 'administrator') {
        role = 'super_admin';
    } else if (rawPerm === 'admin' || rawPerm === '') {
        role = 'admin';
    } else if (rawPerm === 'no_files') {
        role = 'no_files';
    } else if (rawPerm === 'limited') {
        role = 'limited';
    } else {
        role = 'blocked'; // unknown/unrecognized permission value -> safest default
    }

    // Per-page yes/no columns: session[PAGE_COLUMNS[pageName]] must be the
    // literal string "yes" (case-insensitive) for a non-administrator user
    // to be allowed onto that page. Anything else ("no", empty, missing) blocks it.
    function pageIsAllowed(pageName) {
        if (role === 'super_admin') return true;
        if (ALWAYS_ALLOWED_PAGES.includes(pageName)) return true;
        if (ADMIN_ONLY_PAGES.includes(pageName)) return false; // handled below, never via PAGE_COLUMNS
        const col = PAGE_COLUMNS[pageName];
        if (!col) return false; // page has no yes/no column defined -> deny by default
        const val = (session[col] || '').toString().trim().toLowerCase();
        return val === 'yes';
    }

    window.currentUserRole = role;
    window.currentUsername = session.username;
    // Who can see file/attachment links: admin/super_admin can, restricted roles cannot
    window.canAccessFiles = (role === 'admin' || role === 'super_admin');
    // Who can edit/save dashboard data (e.g. performance.html "Edit Data" + "Save" buttons):
    // admin and super_admin only. Restricted roles can VIEW the dashboard but not edit it.
    window.canEditDashboard = (role === 'admin' || role === 'super_admin');

    function showAccessDenied() {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;
                        font-family:'Segoe UI',system-ui,-apple-system,sans-serif;flex-direction:column;
                        gap:14px;background:#f8fafc;text-align:center;padding:24px;">
                <div style="font-size:52px;">&#128683;</div>
                <div style="font-size:20px;font-weight:800;color:#0f172a;">ماعندكش صلاحية تدخل الصفحة دي</div>
                <div style="font-size:14px;color:#64748b;">You don't have permission to view this page.</div>
                <a href="performance.html" style="margin-top:8px;color:#2563eb;font-weight:700;text-decoration:none;
                   background:#eff6ff;padding:10px 20px;border-radius:8px;">الرجوع للداشبورد</a>
            </div>
        `;
    }

    if (role === 'blocked') {
        document.addEventListener('DOMContentLoaded', showAccessDenied);
        return;
    }

    // super_admin: no restrictions at all, sees every page including ADMIN_ONLY_PAGES.
    // Everyone else (admin, no_files, limited) is blocked from ADMIN_ONLY_PAGES.
    if (role !== 'super_admin' && ADMIN_ONLY_PAGES.includes(page)) {
        document.addEventListener('DOMContentLoaded', showAccessDenied);
        return;
    }

    // Per-page yes/no columns: any page not in ADMIN_ONLY_PAGES/ALWAYS_ALLOWED_PAGES
    // now requires this user's matching PAGE_COLUMNS column to say "yes".
    if (!pageIsAllowed(page)) {
        document.addEventListener('DOMContentLoaded', showAccessDenied);
        return;
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Hide file/attachment links for roles without file access
        if (!window.canAccessFiles) {
            document.querySelectorAll('.file-protected, [data-file-link]').forEach(function (el) {
                el.style.display = 'none';
            });
        }
        // Hide edit/save controls (e.g. dashboard "Edit Data" button) for roles that
        // cannot edit — mark those elements with class="admin-only" in the page HTML.
        if (!window.canEditDashboard) {
            document.querySelectorAll('.admin-only').forEach(function (el) {
                el.style.display = 'none';
            });
        }
        // Hide nav links this user isn't allowed to open (ADMIN_ONLY_PAGES
        // restriction, or simply "no"/missing in their PAGE_COLUMNS value).
        document.querySelectorAll('.nav-btn[href]').forEach(function (a) {
            let href = a.getAttribute('href');
            if (!href) return;
            if (!pageIsAllowed(href.trim().toLowerCase())) {
                a.style.display = 'none';
            }
        });
    });

    // Call this from anywhere to log the current user out
    window.logoutUser = function () {
        localStorage.removeItem('userSession');
        window.location.href = 'index.html';
    };

    // Wrap any "add / upload / save" action with this. It shows a password
    // re-entry modal and only runs onConfirmed() if the password matches.
    // Usage:
    //     document.getElementById('upload-btn').onclick = function () {
    //         guardUpload(function () {
    //             // ...actual upload/save logic here...
    //         });
    //     };
    window.guardUpload = function (onConfirmed) {
        // Defense-in-depth: even if a hidden button gets triggered some other way,
        // block the save here too if this role isn't allowed to edit.
        if (window.canEditDashboard === false) {
            alert('ماعندكش صلاحية تحفظ أو تعدّل البيانات دي.');
            return;
        }

        let modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);' +
            'display:flex;align-items:center;justify-content:center;z-index:9999;';
        modal.innerHTML = `
            <div style="background:#fff;padding:28px;border-radius:14px;max-width:360px;width:90%;
                        box-shadow:0 20px 40px rgba(0,0,0,0.2);font-family:'Segoe UI',system-ui,sans-serif;">
                <div style="font-weight:800;font-size:17px;margin-bottom:6px;color:#0f172a;">تأكيد الهوية</div>
                <div style="color:#64748b;font-size:13px;margin-bottom:16px;">من فضلك أدخل كلمة المرور مرة أخرى قبل المتابعة</div>
                <input type="password" id="guard-pass-input" style="width:100%;box-sizing:border-box;padding:10px 12px;
                       border:1px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:8px;" placeholder="كلمة المرور">
                <div id="guard-pass-error" style="color:#ef4444;font-size:12px;min-height:16px;margin-bottom:10px;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="guard-pass-cancel" style="flex:1;padding:10px;border-radius:8px;border:1px solid #e2e8f0;
                            background:#f8fafc;cursor:pointer;font-weight:700;">إلغاء</button>
                    <button id="guard-pass-confirm" style="flex:1;padding:10px;border-radius:8px;border:none;
                            background:#2563eb;color:#fff;cursor:pointer;font-weight:700;">تأكيد</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = modal.querySelector('#guard-pass-input');
        const errBox = modal.querySelector('#guard-pass-error');
        input.focus();

        modal.querySelector('#guard-pass-cancel').onclick = function () { modal.remove(); };

        modal.querySelector('#guard-pass-confirm').onclick = async function () {
            const typed = input.value.trim();
            errBox.innerText = '';
            if (!typed) { errBox.innerText = 'اكتب كلمة المرور'; return; }
            try {
                const { data: rows, error } = await guardClient
                    .from('users')
                    .select('password')
                    .eq('username', window.currentUsername)
                    .limit(1);
                if (error) throw error;
                if (rows && rows.length > 0 && rows[0].password === typed) {
                    modal.remove();
                    onConfirmed();
                } else {
                    errBox.innerText = 'كلمة المرور غير صحيحة';
                }
            } catch (e) {
                errBox.innerText = 'خطأ في الاتصال، حاول تاني';
            }
        };

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') modal.querySelector('#guard-pass-confirm').click();
        });
    };
})();
