/*
  Company switcher (loaded by auth-guard.js on every page).

  1) Scopes data: every query on the tables listed in SCOPED_TABLES is
     automatically limited to the selected company (project_id = selected),
     and inserts get project_id filled in. The database (RLS) still decides
     which companies a user may see - this only picks WHICH ONE of the
     allowed companies the pages show right now.

  2) Renders a "Company" dropdown at the top of the navigation, listing only
     the companies the signed-in user is allowed to see:
       - general staff / admins: all companies
       - company accounts (e.g. ITQAN): their own company only
     Changing it reloads the page for the new company.

  Public helpers: window.getSelectedCompanyId(), window.setSelectedCompany(id, {reload}).
  Selection is kept in localStorage under "mdceo-company-id" (cleared on logout).
*/
(function () {
    'use strict';

    var client = window.__guardClient;
    if (!client || client.__companyScoped) return;
    client.__companyScoped = true;

    var STORAGE_KEY = 'mdceo-company-id';
    // Tables whose rows carry a project_id. Register tables are handled by the
    // register pages themselves (they have their own project parameter).
    var SCOPED_TABLES = {
        submittals: 1,
        upload_requests: 1,
        contractor_requests: 1,
        weekly_reports: 1,
        printed_reports: 1
    };

    var memoryId = null; // fallback when localStorage is unavailable

    function selectedId() {
        try {
            var v = localStorage.getItem(STORAGE_KEY);
            if (v && /^\d+$/.test(v)) return Number(v);
        } catch (e) { /* storage may be blocked */ }
        return memoryId;
    }

    function storeId(id) {
        memoryId = Number(id);
        try { localStorage.setItem(STORAGE_KEY, String(id)); } catch (e) { /* ignore */ }
    }

    function withProject(rows, id) {
        function one(row) {
            if (!row || typeof row !== 'object' || row.project_id !== undefined) return row;
            return Object.assign({}, row, { project_id: id });
        }
        return Array.isArray(rows) ? rows.map(one) : one(rows);
    }

    // ---- 1) scope queries ---------------------------------------------------
    var originalFrom = client.from.bind(client);
    client.from = function (table) {
        var builder = originalFrom(table);
        var id = selectedId();
        if (!SCOPED_TABLES[table] || id === null) return builder;

        ['select', 'update', 'delete'].forEach(function (method) {
            var original = builder[method];
            builder[method] = function () {
                return original.apply(builder, arguments).eq('project_id', id);
            };
        });
        ['insert', 'upsert'].forEach(function (method) {
            var original = builder[method];
            builder[method] = function () {
                var args = Array.prototype.slice.call(arguments);
                args[0] = withProject(args[0], id);
                return original.apply(builder, args);
            };
        });
        return builder;
    };

    window.getSelectedCompanyId = selectedId;

    // Storage folder for a company: every company keeps its files in its own folder
    // ("company-<id>"). Pass a row's project_id to file under that row's company,
    // otherwise the currently selected company is used.
    window.getCompanyFolder = function (projectId) {
        var id = (projectId !== undefined && projectId !== null && projectId !== '') ? Number(projectId) : selectedId();
        return 'company-' + (id || 1);
    };

    // ---- 2) the dropdown ----------------------------------------------------
    var companies = [];
    var selectEl = null;

    // Company name for a row's project_id (or the selected company). Used as the
    // top-level Google Drive folder name. Null if the company list isn't loaded yet.
    window.getCompanyName = function (projectId) {
        var id = (projectId !== undefined && projectId !== null && projectId !== '') ? Number(projectId) : selectedId();
        for (var i = 0; i < companies.length; i++) {
            if (companies[i].id === id) return companies[i].name || companies[i].code || null;
        }
        return null;
    };

    function isArabic() {
        try { return !!(window.getCurrentLang && window.getCurrentLang() === 'ar'); } catch (e) { return false; }
    }

    window.setSelectedCompany = function (id, options) {
        var reload = !options || options.reload !== false;
        if (selectedId() === Number(id)) return;
        storeId(id);
        if (selectEl) selectEl.value = String(id);
        document.dispatchEvent(new CustomEvent('company-changed', { detail: { id: Number(id) } }));
        if (reload) window.location.reload();
    };

    function injectStyle() {
        if (document.getElementById('mdceoCompanyStyle')) return;
        var style = document.createElement('style');
        style.id = 'mdceoCompanyStyle';
        style.textContent =
            '.mdceo-company{display:flex;flex-direction:column;gap:5px;margin:0 0 10px;padding:9px 10px;' +
            'border:1px solid #dce8ff;border-radius:10px;background:#f7faff;box-sizing:border-box;max-width:100%}' +
            '.mdceo-company label{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5b6b8a}' +
            '.mdceo-company select{width:100%;padding:8px 10px;border:1px solid #c9d8f5;border-radius:8px;background:#fff;' +
            'color:#14213d;font:inherit;font-weight:600;cursor:pointer}' +
            '.mdceo-company select:disabled{cursor:default;opacity:1;background:#f0f5ff}' +
            '.mdceo-company.floating{position:fixed;top:10px;inset-inline-end:10px;z-index:9999;margin:0;' +
            'flex-direction:row;align-items:center;box-shadow:0 6px 18px #14213d22}' +
            '.mdceo-company.floating select{width:auto}';
        document.head.appendChild(style);
    }

    function render() {
        if (!companies.length || document.getElementById('mdceoCompany')) return;
        injectStyle();

        var wrap = document.createElement('div');
        wrap.id = 'mdceoCompany';
        wrap.className = 'mdceo-company';

        var label = document.createElement('label');
        label.htmlFor = 'mdceoCompanySelect';
        label.textContent = isArabic() ? 'الشركة' : 'Company';

        selectEl = document.createElement('select');
        selectEl.id = 'mdceoCompanySelect';
        selectEl.setAttribute('aria-label', label.textContent);
        companies.forEach(function (c) {
            var option = document.createElement('option');
            option.value = String(c.id);
            option.textContent = c.name || c.code || ('#' + c.id);
            selectEl.appendChild(option);
        });
        selectEl.value = String(selectedId());
        selectEl.disabled = companies.length < 2;
        selectEl.addEventListener('change', function () { window.setSelectedCompany(selectEl.value); });

        wrap.appendChild(label);
        wrap.appendChild(selectEl);

        var nav = document.querySelector('.nav-container');
        if (nav) nav.insertBefore(wrap, nav.firstChild);
        else { wrap.classList.add('floating'); document.body.appendChild(wrap); }
    }

    async function init() {
        if (/\/index\.html$/.test(window.location.pathname) || !/\/pages\//.test(window.location.pathname)) return;

        var result;
        try {
            result = await originalFrom('projects').select('id, code, name, is_active').eq('is_active', true).order('id');
        } catch (e) { return; }
        if (!result || result.error || !result.data || !result.data.length) return;
        companies = result.data;

        var current = selectedId();
        var valid = companies.some(function (c) { return c.id === current; });
        if (!valid) {
            // First visit (or the saved company is no longer available to this user):
            // pick the first allowed company, then reload once so every query on the
            // page runs for it.
            storeId(companies[0].id);
            var flag = 'mdceo-company-init';
            var alreadyReloaded = false;
            try { alreadyReloaded = sessionStorage.getItem(flag) === '1'; sessionStorage.setItem(flag, '1'); } catch (e) { alreadyReloaded = true; }
            if (!alreadyReloaded) { window.location.reload(); return; }
        }
        try { sessionStorage.removeItem('mdceo-company-init'); } catch (e) { /* ignore */ }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
        else render();
        document.dispatchEvent(new CustomEvent('company-ready', { detail: { id: selectedId(), companies: companies } }));
    }

    document.addEventListener('authguard:ready', function () { init(); });
})();
