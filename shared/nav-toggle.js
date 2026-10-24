/* =====================================================================
   MDCEO — Sidebar collapse/expand toggle (shared across all pages)
   Adds one floating icon button. Clicking it hides the sidebar nav;
   clicking it again (same icon, now sitting near the edge) brings it
   back. State is remembered per-browser via localStorage.
   ===================================================================== */
(function () {
    function buildNavigation(nav) {
        if (nav.dataset.organized === 'true') return;

        var links = Array.prototype.slice.call(nav.querySelectorAll(':scope > .nav-btn'));
        if (!links.length) return;

        var brand = document.createElement('div');
        brand.className = 'nav-brand';
        brand.innerHTML = '<span class="nav-brand-icon"><i class="fa-solid fa-drafting-compass" aria-hidden="true"></i></span>' +
            '<span class="nav-brand-copy"><strong>MDCEO</strong><small>PROJECT PORTAL</small></span>';
        nav.appendChild(brand);

        var primary = createSection(nav, 'primary');
        var organization = createSection(nav, 'organization');
        var reports = createSection(nav, 'reports');
        var utilities = document.createElement('div');
        utilities.className = 'nav-utilities';
        var utilityHeading = document.createElement('div');
        utilityHeading.className = 'nav-section-heading nav-utilities-heading';
        utilities.appendChild(utilityHeading);

        links.forEach(function (link) {
            if (link.classList.contains('translate-btn') ||
                link.classList.contains('logout-btn') ||
                (link.getAttribute('onclick') || '').indexOf('openChangePasswordModal') !== -1) {
                utilities.appendChild(link);
                return;
            }

            var href = (link.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop();
            if (href === 'home.html' || href === 'summary.html') {
                primary.appendChild(link);
            } else if (href === 'weekly_report.html' || href === 'weekly_report_view.html') {
                reports.appendChild(link);
            } else {
                organization.appendChild(link);
            }
        });

        nav.appendChild(primary);
        nav.appendChild(organization);
        nav.appendChild(reports);
        nav.appendChild(utilities);
        nav.dataset.organized = 'true';
        nav.querySelectorAll('.nav-section').forEach(function (section) {
            section.hidden = section.querySelectorAll('.nav-btn').length === 0;
        });
        utilities.hidden = utilities.querySelectorAll('.nav-btn').length === 0;

        function createSection(container, name) {
            var section = document.createElement('div');
            section.className = 'nav-section nav-section-' + name;
            section.setAttribute('data-nav-section', name);
            var heading = document.createElement('div');
            heading.className = 'nav-section-heading';
            section.appendChild(heading);
            container.appendChild(section);
            return section;
        }
    }

    function updateSectionLabels() {
        var isRtl = document.documentElement.getAttribute('dir') === 'rtl';
        var labels = isRtl
            ? { primary: 'مساحة العمل', organization: 'إدارة المشروع', reports: 'التقارير', utilities: 'الإعدادات' }
            : { primary: 'WORKSPACE', organization: 'ORGANISATION', reports: 'REPORTS', utilities: 'PREFERENCES' };

        document.querySelectorAll('.nav-section-heading').forEach(function (heading) {
            var section = heading.parentElement.getAttribute('data-nav-section');
            heading.textContent = labels[section] || '';
        });

        var utilityHeading = document.querySelector('.nav-utilities-heading');
        if (utilityHeading) utilityHeading.textContent = labels.utilities;
    }

    function init() {
        var nav = document.querySelector('.nav-container');
        if (!nav) return; // no nav on this page — nothing to toggle
        if (!nav.querySelector('a[href="issue-risk-register.html"]')) {
            var registerLink = document.createElement('a');
            registerLink.href = 'issue-risk-register.html';
            registerLink.className = 'nav-btn';
            registerLink.innerHTML = '<i class="fa-solid fa-list-check" aria-hidden="true"></i><span>Issues &amp; Risks</span>';
            nav.appendChild(registerLink);
        }
        if (!document.querySelector('script[data-register-integration]')) {
            var registerScript = document.createElement('script');
            registerScript.src = '../shared/register-integration.js?v=2';
            registerScript.dataset.registerIntegration = 'true';
            document.head.appendChild(registerScript);
        }
        var header = nav.closest('.topbar');
        if (header && header.parentNode) {
            header.parentNode.insertBefore(nav, header.nextSibling);
        }
        buildNavigation(nav);
        updateSectionLabels();
        new MutationObserver(updateSectionLabels).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['dir']
        });
        if (!nav.id) nav.id = 'primaryNavigation';
        if (nav.tagName !== 'NAV') nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Main navigation');
        nav.querySelectorAll('a.active').forEach(function (link) {
            link.setAttribute('aria-current', 'page');
        });

        var btn = document.getElementById('navToggleBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'navToggleBtn';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Toggle menu');
            btn.setAttribute('aria-controls', nav.id);
            btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            document.body.appendChild(btn);

            btn.addEventListener('click', function () {
                document.body.classList.toggle('nav-collapsed');
                syncAccessibility();
                try {
                    localStorage.setItem(
                        'mdceoNavCollapsed',
                        document.body.classList.contains('nav-collapsed') ? '1' : '0'
                    );
                } catch (e) {}
            });
        }

        try {
            if (localStorage.getItem('mdceoNavCollapsed') === '1') {
                document.body.classList.add('nav-collapsed');
            }
        } catch (e) {}
        function syncAccessibility() {
            var collapsed = document.body.classList.contains('nav-collapsed') &&
                window.matchMedia('(min-width: 781px)').matches;
            btn.setAttribute('aria-expanded', String(!collapsed));
            nav.inert = collapsed;
        }
        syncAccessibility();
        window.matchMedia('(min-width: 781px)').addEventListener('change', syncAccessibility);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
