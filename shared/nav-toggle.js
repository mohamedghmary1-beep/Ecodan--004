/* =====================================================================
   MDCEO — Sidebar collapse/expand toggle (shared across all pages)
   Adds one floating icon button. Clicking it hides the sidebar nav;
   clicking it again (same icon, now sitting near the edge) brings it
   back. State is remembered per-browser via localStorage.
   ===================================================================== */
(function () {
    function init() {
        var nav = document.querySelector('.nav-container');
        if (!nav) return; // no nav on this page — nothing to toggle

        var btn = document.getElementById('navToggleBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'navToggleBtn';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Toggle menu');
            btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            document.body.appendChild(btn);

            btn.addEventListener('click', function () {
                document.body.classList.toggle('nav-collapsed');
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
