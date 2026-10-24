/*
  MDCEO Portal - Shared Access Control Script (v2 - hardened)
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
    const ADMIN_ONLY_PAGES = ['team_overview.html', 'final-approval.html', 'permissions.html'];

    // approvals.html: open to any admin-permission role (admin AND super_admin -
    // matches public.is_portal_admin() on the database side, which already
    // treats them the same for RLS). This is also where the full engineer
    // directory is loaded (for the "المهندس المختص" override dropdown), so
    // any admin can see all engineers from here, not just the super-admin.
    const ADMIN_AND_SUPER_ADMIN_PAGES = ['approvals.html'];

    // Pages every logged-in user can always reach, no matter what.
    const ALWAYS_ALLOWED_PAGES = ['index.html', 'settings.html'];

    // Contractor accounts always see this page (their core page). Any OTHER
    // role can also be granted it explicitly via the page_contractor_submit
    // checkbox in permissions.html - e.g. an admin who wants to preview the
    // contractor's submission form, or an employee who occasionally submits
    // on a contractor's behalf.
    const CONTRACTOR_ONLY_PAGES = ['contractor-submit.html'];

    // Engineer review page - open to whichever profiles have is_engineer = true
    // (checked against the `profiles` row itself, not the permissions role,
    // since an engineer keeps their normal admin/limited/no_files role too).
    const ENGINEER_ONLY_PAGES = ['engineer-review.html'];

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

    // SECURITY FIX (Aug 2026): username/email بييجوا من الـ DB (أو من
    // document.referrer اللي في نظرية بيكون قابل للتلاعب) وبيتحطوا جوه
    // innerHTML - escapeHtml() بيمنع أي HTML/سكريبت فيهم من إنه يتنفّذ.
    function escapeHtml(str) {
        return String(str == null ? "" : str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // ---------------------------------------------------------------------
    // "أي صفحة يقدر يشوفها فعلاً" - مش صفحة واحدة متحددة مسبقًا. مستخدمة في
    // حالتين: (1) بعد تسجيل الدخول مباشرة (index.html) - عشان ميدخلش على
    // صفحة افتراضية زي home.html وهو أصلاً مالوش صلاحية عليها فيتفاجئ
    // برسالة "ماعندكش صلاحية" أول ما يدخل. (2) كـ fallback لما نرفض دخوله
    // لصفحة ومفيش referrer نرجعه له - بدل ما نرمي "performance.html" ثابتة
    // (اللي هو أصلاً ممكن يكون مالوش صلاحية عليها برضه ويدخل في حلقة رفض).
    //
    // الترتيب هنا بيمثل أولوية منطقية بس (مين الأنسب كصفحة هبوط)، مش قايمة
    // صلاحيات - كل صفحة لسه بتتفحص بـ pageIsAllowed() الحقيقية قبل ما تترشح.
    const REDIRECT_PRIORITY_PAGES = [
        'home.html', 'task-list.html', 'summary.html', 'performance.html', 'issue-risk-register.html',
        'general_by_activity.html', 'weekly_report.html', 'weekly_report_view.html',
        'approvals.html', 'team_overview.html', 'engineer-review.html',
        'contractor-submit.html', 'permissions.html'
    ];

    function firstAccessiblePage(profile, role) {
        if (!profile || !role || role === 'blocked') return null;
        for (const page of REDIRECT_PRIORITY_PAGES) {
            if (role !== 'super_admin' && ADMIN_ONLY_PAGES.includes(page)) continue;
            if (pageIsAllowed(profile, role, page)) return page;
        }
        return null; // literally لا صفحة متاحة له - المتصل لازم يتعامل مع الحالة دي
    }
    // متاحة لأي صفحة تانية (زي index.html بعد نجاح تسجيل الدخول) عن طريق
    // window.getFirstAccessiblePage(profile, role)
    window.getFirstAccessiblePage = firstAccessiblePage;

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
        document.body.classList.add('mdceo-page-ready');
    }

    function showWelcome(username, userId) {
        const storageKey = `mdceo-welcomed-${userId}`;
        try {
            if (sessionStorage.getItem(storageKey)) return;
            sessionStorage.setItem(storageKey, '1');
        } catch (e) { /* private browsing can deny storage; still show once */ }

        const arabic = document.documentElement.dir === 'rtl' || document.documentElement.lang === 'ar';
        const label = (username || (arabic ? 'مستخدم MDCEO' : 'MDCEO user')).trim();
        const toast = document.createElement('div');
        toast.className = 'mdceo-welcome-toast';
        toast.setAttribute('role', 'status');
        toast.innerHTML = '<i class="fa-solid fa-hand-sparkles" aria-hidden="true"></i>';
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = arabic ? `أهلاً وسهلاً، ${label}` : `Welcome, ${label}`;
        const note = document.createElement('span');
        note.textContent = arabic ? 'مرحبًا بك في حسابك على MDCEO' : 'Welcome to your MDCEO account';
        content.append(title, note);
        toast.appendChild(content);
        document.body.appendChild(toast);
        window.setTimeout(function () {
            toast.classList.add('is-hiding');
            window.setTimeout(function () { toast.remove(); }, 300);
        }, 3600);
    }

    function setupPageTransitions() {
        document.addEventListener('click', function (event) {
            const link = event.target.closest('a[href]');
            if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (link.target && link.target !== '_self' || link.hasAttribute('download')) return;
            const destination = new URL(link.href, window.location.href);
            if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
            if (!destination.pathname.endsWith('.html') && !destination.pathname.endsWith('/')) return;
            event.preventDefault();
            document.body.classList.add('mdceo-page-leaving');
            window.setTimeout(function () { window.location.assign(destination.href); }, 165);
        });
    }

    // Figures out where "the page he came from" actually is, so the
    // access-denied screen can send the user back there instead of to a
    // hardcoded page. A referrer alone isn't proof he can actually see that
    // page (permissions can change between tabs/sessions), so we still run
    // it through pageIsAllowed(). Falls back to the first page he's
    // genuinely allowed to see if we have no usable/allowed referrer.
    function previousPageUrl() {
        const ref = document.referrer;
        const profile = window.__currentProfile;
        const role = window.currentUserRole;
        if (ref) {
            try {
                const refUrl = new URL(ref);
                const here = window.location.pathname.split('/').pop();
                const refPage = refUrl.pathname.split('/').pop();
                // Don't send them right back to the very page that just
                // denied them (can happen on a hard refresh).
                if (refUrl.origin === window.location.origin && refPage && refPage !== here) {
                    if (!profile || !role || pageIsAllowed(profile, role, refPage)) {
                        return ref;
                    }
                }
            } catch (e) { /* malformed/opaque referrer - ignore, use fallback */ }
        }
        const fallbackPage = firstAccessiblePage(profile, role);
        return fallbackPage || 'index.html';
    }

    function showAccessDenied() {
        const backUrl = previousPageUrl();
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;
                        font-family:'Segoe UI',system-ui,-apple-system,sans-serif;flex-direction:column;
                        gap:14px;background:#f8fafc;text-align:center;padding:24px;">
                <div style="font-size:52px;">&#128683;</div>
                <div style="font-size:20px;font-weight:800;color:#0f172a;">ليست لديك صلاحية للدخول إلى هذه الصفحة</div>
                <div style="font-size:14px;color:#64748b;">You don't have permission to view this page.</div>
                <div style="font-size:13px;color:#94a3b8;">سيتم إعادتك تلقائيًا...</div>
                <a id="authguard-back-link" href="${escapeHtml(backUrl)}" style="margin-top:8px;color:#2563eb;font-weight:700;text-decoration:none;
                   background:#eff6ff;padding:10px 20px;border-radius:8px;">الرجوع للصفحة السابقة</a>
            </div>
        `;
        reveal();
        // Auto-return after a couple of seconds so the user isn't stuck -
        // give them just enough time to read the message first.
        setTimeout(function () {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = backUrl;
            }
        }, 2500);
    }

    function pageIsAllowed(profile, role, pageName) {
        if (role === 'super_admin') return true;
        if (ALWAYS_ALLOWED_PAGES.includes(pageName)) return true;

        // Contractor accounts: always allowed (their core page). Everyone
        // else needs the explicit page_contractor_submit = 'yes' flag - if
        // it's not checked in permissions.html, this link/page is fully
        // off-limits, same as any other page_* flag.
        if (CONTRACTOR_ONLY_PAGES.includes(pageName)) {
            if (role === 'contractor') return true;
            const contractorFlag = (profile.page_contractor_submit || '').toString().trim().toLowerCase();
            return contractorFlag === 'yes';
        }
        if (role === 'contractor') return false;
        if (pageName === 'issue-risk-register.html' || pageName === 'issue-risk-editor.html') {
            return profile.page_register === 'yes';
        }

        // Engineer review page: gated on the is_engineer flag, not on role,
        // so it layers on top of whatever normal role the engineer already has.
        if (ENGINEER_ONLY_PAGES.includes(pageName)) return !!profile.is_engineer;

        if (ADMIN_AND_SUPER_ADMIN_PAGES.includes(pageName)) return role === 'admin' || role === 'super_admin';
        if (ADMIN_ONLY_PAGES.includes(pageName)) return false;
        const col = PAGE_COLUMNS[pageName];
        if (!col) return false;
        const val = (profile[col] || '').toString().trim().toLowerCase();
        return val === 'yes';
    }

    // Add shared account actions inside the existing navigation section.
    function injectNavAccountActions() {
        const nav = document.querySelector('.nav-container');
        if (!nav || document.getElementById('mdceoNavAccountMenu')) return;
        if (!document.getElementById('mdceoNavAccountStyle')) {
            const style = document.createElement('style');
            style.id = 'mdceoNavAccountStyle';
            style.textContent = '.mdceo-nav-account{position:relative}.mdceo-nav-account summary{list-style:none;cursor:pointer}.mdceo-nav-account summary::-webkit-details-marker{display:none}.mdceo-nav-account-menu{position:absolute;z-index:100;inset-inline-end:0;top:calc(100% + 6px);min-width:205px;padding:5px;background:#fff;border:1px solid #dce8ff;border-radius:10px;box-shadow:0 10px 24px #14213d24}.mdceo-nav-account-menu button{display:flex;width:100%;gap:9px;align-items:center;padding:11px 12px;border:0;background:transparent;color:#14213d;text-align:start;font:inherit;cursor:pointer}.mdceo-nav-account-menu button:hover{background:#f0f5ff}.mdceo-nav-account-menu button:last-child{color:#b42318}';
            document.head.appendChild(style);
        }
        const details = document.createElement('details');
        details.id = 'mdceoNavAccountMenu';
        details.className = 'mdceo-nav-account';
        details.innerHTML = '<summary class="nav-btn" aria-haspopup="menu"><span data-i18n="accountMenuLabel">Account</span></summary><div class="mdceo-nav-account-menu" role="menu"><button type="button" role="menuitem" data-account-action="password"><i class="fa-solid fa-key" aria-hidden="true"></i><span data-i18n="navChangePassword">Change Password</span></button><button type="button" role="menuitem" data-account-action="logout"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span data-i18n="navLogout">Log Out</span></button></div>';
        const logout = nav.querySelector('.logout-btn');
        if (logout && logout.parentElement) logout.parentElement.insertBefore(details, logout);
        else nav.appendChild(details);
        details.querySelector('[data-account-action="password"]').addEventListener('click', function () {
            details.open = false;
            window.openChangePasswordModal();
        });
        details.querySelector('[data-account-action="logout"]').addEventListener('click', function () {
            details.open = false;
            window.logoutUser();
        });
        document.addEventListener('click', function (event) { if (!details.contains(event.target)) details.open = false; });
    }

    function injectSettingsNavItem() {
        const nav = document.querySelector('.nav-container');
        if (!nav) return;
        const page = currentPage();
        let link = Array.from(nav.querySelectorAll('a[href]')).find(function (item) {
            try { return new URL(item.href, window.location.href).pathname.endsWith('/settings.html'); }
            catch (e) { return false; }
        });
        if (!link) {
            link = document.createElement('a');
            link.href = 'settings.html';
            link.className = 'nav-btn';
            link.innerHTML = '<span data-i18n="navSettings"></span>';
            const logout = nav.querySelector('.logout-btn');
            if (logout && logout.parentElement) logout.parentElement.insertBefore(link, logout);
            else nav.appendChild(link);
        }
        link.classList.add('nav-btn');
        link.classList.toggle('active', page === 'settings.html');
        if (page === 'settings.html') link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        const label = link.querySelector('[data-i18n="navSettings"]') || link;
        label.textContent = (window.getCurrentLang && window.getCurrentLang() === 'ar') ? 'الإعدادات' : 'Settings';
    }

    async function init() {
        const page = currentPage();

        // 1) Real Supabase Auth session (a signed JWT, not user-editable JSON).
        const { data: { session } } = await guardClient.auth.getSession();
        if (!session) {
            if (page !== 'index.html') {
                window.location.href = '../index.html';
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
            .select('permissions, page_performance, page_summary, page_task, page_home, page_weekly_report, page_general_by_activity, page_contractor_submit, username, is_engineer, company_name, is_blocked')
            .eq('id', session.user.id)
            .single();

        if (error || !profile) {
            console.error('AuthGuard: could not load profile', error);
            if (page !== 'index.html') {
                await guardClient.auth.signOut();
                window.location.href = '../index.html';
            } else {
                reveal();
            }
            return;
        }

        // Optional module permission: older deployments keep working before its migration.
        {
            const registerProfile = await guardClient.from('profiles').select('page_register').eq('id', session.user.id).maybeSingle();
            if (!registerProfile.error) profile.page_register = registerProfile.data?.page_register;
        }

        const rawPerm = (profile.permissions || '').trim().toLowerCase();
        let role;
        // is_blocked overrides whatever the stored role is - this way blocking
        // someone never destroys/overwrites their real `permissions` value,
        // so unblocking them later restores their exact previous role.
        if (profile.is_blocked) role = 'blocked';
        else if (rawPerm === 'administrator') role = 'super_admin';
        else if (rawPerm === 'admin' || rawPerm === '') role = 'admin';
        else if (rawPerm === 'no_files') role = 'no_files';
        else if (rawPerm === 'limited') role = 'limited';
        else if (rawPerm === 'contractor') role = 'contractor';
        else role = 'blocked';

        window.currentUserRole = role;
        window.__currentProfile = profile;
        window.currentUsername = profile.username;
        window.currentUserEmail = session.user.email;
        window.currentUserIsEngineer = !!profile.is_engineer;
        window.currentCompanyName = (profile.company_name || '').trim() || null;
        window.canAccessFiles = (role === 'admin' || role === 'super_admin');
        window.canEditDashboard = (role === 'admin' || role === 'super_admin');

        if (page !== 'index.html') {
            if (role === 'blocked') { showAccessDenied(); return; }
            if (role !== 'super_admin' && ADMIN_ONLY_PAGES.includes(page)) { showAccessDenied(); return; }
            if (!pageIsAllowed(profile, role, page)) { showAccessDenied(); return; }
        }

        reveal();
        injectNavAccountActions();
        injectSettingsNavItem();
        showWelcome(profile.username, session.user.id);
        setupPageTransitions();

        document.dispatchEvent(new CustomEvent('authguard:ready', { detail: { role, profile } }));

        function applyElementGuards() {
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
        }

        // BUGFIX (Aug 2026): this used to only run inside a
        // document.addEventListener('DOMContentLoaded', ...) handler. Because
        // init() is async and awaits two network round-trips (getSession,
        // then the profiles select) before reaching this point, the DOM has
        // almost always already finished loading by the time we get here -
        // so that listener was registered AFTER the event had already fired
        // and never actually ran. Nav links were never being hidden. Now we
        // just check document.readyState: if the DOM is already parsed, run
        // immediately; only attach the listener if we somehow got here
        // before DOMContentLoaded (e.g. a very fast/cached profile fetch).
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyElementGuards);
        } else {
            applyElementGuards();
        }
    }

    window.logoutUser = async function () {
        const arabic = (window.getCurrentLang && window.getCurrentLang() === 'ar');
        const confirmed = await new Promise(function (resolve) {
            const dialog = document.createElement('dialog');
            dialog.className = 'mdceo-confirm-dialog';
            dialog.innerHTML = `<form method="dialog" style="padding:24px;min-width:min(360px,calc(100vw - 48px));font:inherit;color:#14213d"><h2 style="margin:0 0 8px">${arabic ? 'تأكيد تسجيل الخروج' : 'Confirm log out'}</h2><p style="margin:0 0 20px;color:#657491">${arabic ? 'هل تريد تسجيل الخروج من حسابك؟' : 'Are you sure you want to log out of your account?'}</p><div style="display:flex;gap:10px;justify-content:flex-end"><button value="cancel">${arabic ? 'إلغاء' : 'Cancel'}</button><button value="confirm" style="background:#002bff;color:white;border:0">${arabic ? 'تسجيل الخروج' : 'Log out'}</button></div></form>`;
            document.body.appendChild(dialog);
            dialog.addEventListener('close', function () { const ok = dialog.returnValue === 'confirm'; dialog.remove(); resolve(ok); }, { once: true });
            dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close('cancel'); });
            dialog.showModal();
        });
        if (!confirmed) return;
        try {
            const { error } = await guardClient.auth.signOut();
            if (error) throw error;
            try { sessionStorage.clear(); } catch (e) { /* storage may be unavailable */ }
            // Keep the language preference; clear only app-owned cached state.
            try { Object.keys(localStorage).filter(key => key.startsWith('mdceo-') || key === 'userSession').forEach(key => localStorage.removeItem(key)); } catch (e) { /* ignore */ }
            window.location.href = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
        } catch (error) {
            console.error('Sign out failed', error);
            if (window.notify && window.notify.error) window.notify.error(arabic ? 'تعذر تسجيل الخروج. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not sign out. Check your connection and try again.');
            else window.alert(arabic ? 'تعذر تسجيل الخروج. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not sign out. Check your connection and try again.');
        }
    };

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
            notify.error('ليست لديك صلاحية لحفظ أو تعديل هذه البيانات.');
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
            if (!typed) { errBox.innerText = 'يرجى إدخال كلمة المرور'; return; }
            try {
                const ok = await window.reauthPassword(typed);
                if (ok) {
                    modal.remove();
                    onConfirmed();
                } else {
                    errBox.innerText = 'كلمة المرور غير صحيحة';
                }
            } catch (e) {
                errBox.innerText = 'حدث خطأ في الاتصال، يرجى المحاولة مرة أخرى';
            }
        };

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') modal.querySelector('#guard-pass-confirm').click();
        });
    };

    // Keep every legacy password entry point on the same policy-enforcing form.
    window.openChangePasswordModal = function () {
        const destination = new URL('settings.html#securitySection', window.location.href);
        if (currentPage() === 'settings.html') {
            const trigger = document.getElementById('openPassword');
            if (trigger) trigger.click();
            return;
        }
        window.location.assign(destination.href);
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
