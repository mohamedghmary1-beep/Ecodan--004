/*
  MDECO Portal - Shared Access Control Script (v2 - hardened)
  -------------------------------------------------------------
  SECURITY REWRITE (Aug 2026): this file used to trust whatever was sitting
  in localStorage ("userSession": { permissions, page_xxx: 'yes'/'no', ... }).
  Anyone could open DevTools, edit those fields, and grant themselves
  administrator rights or access to any page/data - nothing on the server
  ever re-checked it. This version fixes that by:

    1) Using real Supabase Auth (supabase.auth.signInWithPassword at login,
       see index.html) instead of a home-grown username/password table
       check. The session Supabase keeps in localStorage is a signed JWT -
       a user can look at it but cannot forge or edit it, unlike the old
       plain JSON blob.
    2) Re-reading the user's role/page-access from the `profiles` table on
       EVERY page load, straight from Supabase (protected by RLS - see
       security_migration.sql), instead of trusting a cached value.
    3) Never selecting/handling the `password` column from the client at
       all - password re-confirmation (guardUpload) now works by asking
       Supabase Auth to re-verify the password (signInWithPassword again),
       so the plaintext password is never read out of the database.

  Include this on EVERY protected page, right after the Supabase JS library
  <script> tag in <head>:

      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <script src="auth-guard.js"></script>

  This file is now ASYNC: it hides the page (body starts hidden via CSS
  injected below) until the server-side check finishes, then either shows
  the page or renders the access-denied screen. Pages should NOT assume
  window.currentUserRole / window.canAccessFiles / window.canEditDashboard
  are available synchronously at <script> time anymore - wait for the
  'authguard:ready' event on `document` if you need them early:

      document.addEventListener('authguard:ready', function () {
          // window.currentUserRole, window.canAccessFiles, window.canEditDashboard
          // are guaranteed to be set at this point.
      });
*/
(function () {
    const SUPABASE_URL = "https://uhhtvpxtpayovbtmnstz.supabase.co";
    const SUPABASE_KEY = "sb_publishable_QsS0UhLBORy6mOaBDgW62g_9OacC3oO";
    const guardClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.__guardClient = guardClient; // reused by pages that need the same authed client

    // Pages that ONLY the "administrator" (super-admin) role can open.
    const ADMIN_ONLY_PAGES = ['approvals.html', 'team_overview.html'];

    // Pages every logged-in user can always reach, no matter what.
    const ALWAYS_ALLOWED_PAGES = ['index.html'];

    // Maps each controllable page filename to its yes/no column in `profiles`.
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

    // Hide the page body until we've verified the session server-side, so
    // protected content can't flash on screen before an access-denied
    // screen replaces it.
    const style = document.createElement('style');
    style.id = 'authguard-hide-style';
    style.textContent = 'body{visibility:hidden !important;}';
    document.documentElement.appendChild(style);
    function reveal() {
        const el = document.getElementById('authguard-hide-style');
        if (el) el.remove();
    }

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
        reveal();
    }

    function pageIsAllowed(profile, role, pageName) {
        if (role === 'super_admin') return true;
        if (ALWAYS_ALLOWED_PAGES.includes(pageName)) return true;
        if (ADMIN_ONLY_PAGES.includes(pageName)) return false;
        const col = PAGE_COLUMNS[pageName];
        if (!col) return false;
        const val = (profile[col] || '').toString().trim().toLowerCase();
        return val === 'yes';
    }

    async function init() {
        const page = currentPage();

        // 1) Real Supabase Auth session (a signed JWT, not user-editable JSON).
        const { data: { session } } = await guardClient.auth.getSession();
        if (!session) {
            if (page !== 'index.html') {
                window.location.href = 'index.html';
            } else {
                reveal();
            }
            return;
        }
        window.__guardSession = session;

        // 2) Always re-fetch role/page-access from the server (RLS-protected
        //    `profiles` table), never from anything cached client-side.
        const { data: profile, error } = await guardClient
            .from('profiles')
            .select('permissions, page_performance, page_summary, page_task, page_home, page_weekly_report, page_general_by_activity, username')
            .eq('id', session.user.id)
            .single();

        if (error || !profile) {
            console.error('AuthGuard: could not load profile', error);
            if (page !== 'index.html') {
                await guardClient.auth.signOut();
                window.location.href = 'index.html';
            } else {
                reveal();
            }
            return;
        }

        const rawPerm = (profile.permissions || '').trim().toLowerCase();
        let role;
        if (rawPerm === 'administrator') role = 'super_admin';
        else if (rawPerm === 'admin' || rawPerm === '') role = 'admin';
        else if (rawPerm === 'no_files') role = 'no_files';
        else if (rawPerm === 'limited') role = 'limited';
        else role = 'blocked';

        window.currentUserRole = role;
        window.currentUsername = profile.username;
        window.currentUserEmail = session.user.email;
        window.canAccessFiles = (role === 'admin' || role === 'super_admin');
        window.canEditDashboard = (role === 'admin' || role === 'super_admin');

        if (page !== 'index.html') {
            if (role === 'blocked') { showAccessDenied(); return; }
            if (role !== 'super_admin' && ADMIN_ONLY_PAGES.includes(page)) { showAccessDenied(); return; }
            if (!pageIsAllowed(profile, role, page)) { showAccessDenied(); return; }
        }

        reveal();

        if (page !== 'index.html') {
            startIdleWatcher();
        }

        document.dispatchEvent(new CustomEvent('authguard:ready', { detail: { role, profile } }));

        document.addEventListener('DOMContentLoaded', function () {
            if (!window.canAccessFiles) {
                document.querySelectorAll('.file-protected, [data-file-link]').forEach(function (el) {
                    el.style.display = 'none';
                });
            }
            if (!window.canEditDashboard) {
                document.querySelectorAll('.admin-only').forEach(function (el) {
                    el.style.display = 'none';
                });
            }
            document.querySelectorAll('.nav-btn[href]').forEach(function (a) {
                let href = a.getAttribute('href');
                if (!href) return;
                if (!pageIsAllowed(profile, role, href.trim().toLowerCase())) {
                    a.style.display = 'none';
                }
            });
        });
    }

    window.logoutUser = function () {
        stopIdleWatcher();
        guardClient.auth.signOut().finally(function () {
            window.location.href = 'index.html';
        });
    };

    // ---- Idle session timeout: auto logout after 20 minutes of no activity ----
    const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
    const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    let idleTimer = null;

    function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    }

    function stopIdleWatcher() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        IDLE_EVENTS.forEach(function (evt) {
            document.removeEventListener(evt, resetIdleTimer, true);
        });
    }

    function handleIdleTimeout() {
        stopIdleWatcher();
        guardClient.auth.signOut().finally(function () {
            alert('انتهت الجلسة بسبب عدم النشاط لمدة 20 دقيقة، من فضلك سجّل الدخول مرة أخرى.');
            window.location.href = 'index.html';
        });
    }

    function startIdleWatcher() {
        IDLE_EVENTS.forEach(function (evt) {
            document.addEventListener(evt, resetIdleTimer, true);
        });
        resetIdleTimer();
    }

    // Re-verify identity by asking Supabase Auth to check the password again
    // (never reads the stored password/hash out to the client).
    window.reauthPassword = async function (typedPassword) {
        const email = window.currentUserEmail;
        if (!email) return false;
        const { error } = await guardClient.auth.signInWithPassword({ email: email, password: typedPassword });
        return !error;
    };

    // Wrap any "add / upload / save" action with this. Shows a password
    // re-entry modal and only runs onConfirmed() if the password matches.
    window.guardUpload = function (onConfirmed) {
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
                const ok = await window.reauthPassword(typed);
                if (ok) {
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

    // Builds a short-lived signed URL for a file stored in the (now private)
    // task-attachments bucket, given either a bare storage path or the old
    // public-style URL string (kept for backward compatibility with rows
    // created before this fix - see security_migration.sql).
    window.getAttachmentSignedUrl = async function (storedValue, bucket, expirySeconds) {
        bucket = bucket || 'task-attachments';
        expirySeconds = expirySeconds || 3600;
        let path = storedValue || '';
        let marker = `/storage/v1/object/public/${bucket}/`;
        let idx = path.indexOf(marker);
        if (idx !== -1) path = decodeURIComponent(path.substring(idx + marker.length));
        const { data, error } = await guardClient.storage.from(bucket).createSignedUrl(path, expirySeconds);
        if (error || !data) return storedValue; // fall back rather than break the UI
        return data.signedUrl;
    };

    init();
})();
