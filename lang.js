/*
  MDECO Portal - Shared Language Persistence & Translation Script
  ------------------------------------------------------------------
  Include this on EVERY page, right after the Supabase script tag:

      <script src="./lang.js"></script>

  WHAT IT DOES
  1. Keeps the chosen language ("ar" or "en") in localStorage under the key
     "portalLang", so switching language on one page keeps it applied when
     navigating to any other page that includes this script.
  2. Ships a COMMON_DICTIONARY with the shared nav-bar labels (Home, Summary,
     Tasks, General, Approvals, Team Overview, Dashboard) so every page's nav
     translates consistently without repeating the same 7 strings everywhere.
  3. Provides a generic translation engine that works with plain
     `data-i18n="key"` attributes (for text) and `data-i18n-placeholder="key"`
     (for input placeholders) - no page-specific code required for simple
     pages.

  HOW TO USE ON A NEW/SIMPLE PAGE
  ---------------------------------
  1. Add `<span data-i18n="navHome">الرئيسية</span>` style attributes to any
     translatable element (the text shown is just the initial/default value).
  2. If the page has its own extra strings beyond the common nav labels,
     call once near the top of your page's <script>:
         window.registerDictionary({
             ar: { myKey: "..." },
             en: { myKey: "..." }
         });
     Page keys always win over common ones if there's a name clash.
  3. Add a toggle button anywhere:
         <button onclick="toggleLanguage()" class="nav-btn translate-btn">
             <i class="fa-solid fa-language"></i> <span id="lang-btn-text">English</span>
         </button>
  4. If the page renders dynamic content (tables/cards built in JS) that also
     needs to re-translate when the language flips, define:
         window.onLanguageChanged = function (lang) {
             // e.g. re-run your render()/build() function here
         };
     This script calls it automatically after applying the static
     translations, both on page load and every time the language is toggled.
  5. Use `T('someKey')` anywhere in your JS (including inside render functions)
     to look up the current-language text for any dictionary key.

  BACKWARD COMPATIBILITY (used by index.html)
  ---------------------------------------------
  If a page defines its OWN full `window.applyLanguage(lang)` function (the
  older, fully custom approach), this script calls that instead of the
  generic engine above - so existing pages built that way keep working
  unchanged.
*/
(function () {
    const LANG_KEY = 'portalLang';
    const DEFAULT_LANG = 'ar';

    // Shared nav-bar dictionary used by every page's navigation menu.
    // Individual pages can override/extend this via window.registerDictionary().
    const COMMON_DICTIONARY = {
        ar: {
            navHome: "الرئيسية",
            navSummary: "الملخص",
            navTasks: "المهام",
            navGeneral: "عام",
            navApprovals: "طلبات الموافقة",
            navTeam: "نظرة عامة على الموظفين",
            navDashboard: "لوحة التحكم",
            navReport: "التقرير الأسبوعي",
            navLogout: "تسجيل الخروج",
            langBtnText: "English"
        },
        en: {
            navHome: "Home",
            navSummary: "Summary",
            navTasks: "Tasks",
            navGeneral: "General",
            navApprovals: "Approvals",
            navTeam: "Team Overview",
            navDashboard: "Dashboard",
            navReport: "Weekly Report",
            navLogout: "Logout",
            langBtnText: "العربية"
        }
    };

    let pageDictionary = null;

    function getStoredLang() {
        return localStorage.getItem(LANG_KEY) || DEFAULT_LANG;
    }
    window.getCurrentLang = getStoredLang;

    function getMergedDictionary() {
        if (!pageDictionary) return COMMON_DICTIONARY;
        return {
            ar: Object.assign({}, COMMON_DICTIONARY.ar, pageDictionary.ar || {}),
            en: Object.assign({}, COMMON_DICTIONARY.en, pageDictionary.en || {})
        };
    }
    window.getDictionary = getMergedDictionary;

    // Page-specific extra dictionary entries (merged on top of COMMON_DICTIONARY)
    window.registerDictionary = function (dict) {
        pageDictionary = dict;
    };

    // Quick lookup helper for use inside render()/build() functions
    window.T = function (key) {
        const dict = getMergedDictionary();
        const lang = getStoredLang();
        return (dict[lang] && dict[lang][key] !== undefined) ? dict[lang][key] : key;
    };

    function applyLanguageGeneric(lang) {
        const dict = getMergedDictionary();
        const t = dict[lang] || dict[DEFAULT_LANG];

        document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);

        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            if (t[key] !== undefined) el.textContent = t[key];
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-placeholder');
            if (t[key] !== undefined) el.placeholder = t[key];
        });

        const langBtnText = document.getElementById('lang-btn-text');
        if (langBtnText) langBtnText.textContent = t.langBtnText || (lang === 'ar' ? 'English' : 'العربية');

        if (typeof window.onLanguageChanged === 'function') {
            window.onLanguageChanged(lang);
        }
    }

    function applyLanguage(lang) {
        // Backward compatibility: pages with their own full custom applyLanguage()
        // (e.g. index.html) keep using it untouched.
        if (typeof window.applyLanguage === 'function') {
            window.applyLanguage(lang);
        } else {
            applyLanguageGeneric(lang);
        }
    }

    window.setLanguage = function (lang) {
        localStorage.setItem(LANG_KEY, lang);
        applyLanguage(lang);
    };

    window.toggleLanguage = function () {
        const next = (getStoredLang() === 'en') ? 'ar' : 'en';
        window.setLanguage(next);
    };

    function applyOnLoad() {
        applyLanguage(getStoredLang());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyOnLoad);
    } else {
        applyOnLoad();
    }

    // Shared logout button handler, available to every page that includes
    // this script. Clears the saved session and returns to the login page.
    // Pages that need custom logout behavior (e.g. their own confirmation
    // wording tied to a page-specific dictionary) can still define their
    // own window.logout BEFORE this script runs and it will be left alone.
    if (typeof window.logout !== 'function') {
        window.logout = function () {
            const lang = getStoredLang();
            const msg = (lang === 'en')
                ? 'Are you sure you want to log out?'
                : 'هل أنت متأكد من تسجيل الخروج؟';
            if (!confirm(msg)) return;
            localStorage.removeItem('userSession');
            window.location.href = 'index.html';
        };
    }
})();

/*
  Shared "pending approvals" nav badge
  ------------------------------------------------------------------
  Every page's nav bar shows the same Approvals badge
  (<span id="pendingNavBadge" class="nav-badge">) so the pending
  count is visible everywhere, not just on pages that happen to
  query it themselves.

  Pages that already manage the badge with their own richer logic
  (task-list.html, team_overview.html - which also build local
  pending-request maps) define a global loadPendingRequests() or
  loadPendingBadge() function; this script detects that and steps
  aside so the badge isn't fetched twice. Every other page gets the
  count for free with zero page-specific code.
*/
(function () {
    const SUPABASE_URL = "https://uhhtvpxtpayovbtmnstz.supabase.co";
    const SUPABASE_KEY = "sb_publishable_QsS0UhLBORy6mOaBDgW62g_9OacC3oO";
    let sharedClient = null;

    function setBadge(count) {
        const badge = document.getElementById('pendingNavBadge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? "99+" : String(count);
            badge.style.display = "flex";
        } else {
            badge.style.display = "none";
        }
    }
    // Let pages reuse this if they want, without overriding a page-level version.
    if (typeof window.updatePendingBadge !== 'function') {
        window.updatePendingBadge = setBadge;
    }

    async function refreshPendingApprovalsBadge() {
        const badge = document.getElementById('pendingNavBadge');
        if (!badge) return; // this page's nav has no badge slot

        // Don't double-fetch on pages that already own this logic.
        if (typeof window.loadPendingRequests === 'function' ||
            typeof window.loadPendingBadge === 'function') return;

        try {
            if (!sharedClient) {
                if (typeof window.supabase === 'undefined') return;
                sharedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            }
            const { data, error } = await sharedClient
                .from('upload_requests')
                .select('id')
                .eq('status', 'pending');
            if (error) throw error;
            setBadge((data || []).length);
        } catch (err) {
            console.error('Error refreshing pending approvals badge:', err);
        }
    }
    window.refreshPendingApprovalsBadge = refreshPendingApprovalsBadge;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshPendingApprovalsBadge);
    } else {
        refreshPendingApprovalsBadge();
    }
})();
