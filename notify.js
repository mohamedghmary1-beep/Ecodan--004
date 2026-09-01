(function () {
    if (window.notify) return;

    const FONT = "'Tajawal','Cairo','Segoe UI',system-ui,-apple-system,sans-serif";

    function isRtl() {
        if (typeof window.getCurrentLang === 'function') {
            return window.getCurrentLang() !== 'en';
        }
        return (document.documentElement.getAttribute('dir') || 'rtl') !== 'ltr';
    }

    function ensureToastHost() {
        let host = document.getElementById('notifyToastHost');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'notifyToastHost';
        host.style.cssText = [
            'position:fixed', 'top:18px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:99999', 'display:flex', 'flex-direction:column', 'gap:10px',
            'align-items:center', 'width:min(92vw,420px)', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(host);
        return host;
    }

    const ICONS = {
        success: { glyph: '&#10003;', bg: 'var(--success, #2DCEB9)' },
        error: { glyph: '&#10005;', bg: 'var(--danger, #FB6340)' },
        info: { glyph: '&#8505;', bg: 'var(--primary, #5E72E4)' }
    };

    function toast(type, message, opts) {
        opts = opts || {};
        const host = ensureToastHost();
        const cfg = ICONS[type] || ICONS.info;
        const duration = opts.duration || (type === 'error' ? 5500 : 3200);

        const card = document.createElement('div');
        card.setAttribute('role', type === 'error' ? 'alert' : 'status');
        card.style.cssText = [
            'pointer-events:auto', 'display:flex', 'align-items:flex-start', 'gap:10px',
            'background:var(--bg-card,#fff)', 'color:var(--text-main,#1E2A4A)',
            'border:1px solid var(--border,#E6EBF5)', 'border-inline-start:4px solid ' + cfg.bg,
            'border-radius:var(--radius-md,12px)', 'box-shadow:0 12px 28px rgba(15,23,42,0.16)',
            'padding:13px 16px', 'font-family:' + FONT, 'font-size:14px', 'font-weight:600',
            'line-height:1.5', 'width:100%', 'box-sizing:border-box',
            'opacity:0', 'transform:translateY(-10px)', 'transition:opacity .2s ease, transform .2s ease'
        ].join(';');

        card.innerHTML =
            '<span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:' + cfg.bg + ';' +
            'color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;">' +
            cfg.glyph + '</span>' +
            '<span style="flex:1;word-break:break-word;"></span>' +
            '<button aria-label="close" style="flex-shrink:0;background:none;border:none;cursor:pointer;' +
            'color:var(--text-muted,#6B7A99);font-size:16px;line-height:1;padding:0;">&#10005;</button>';
        card.querySelector('span:nth-child(2)').textContent = String(message == null ? '' : message);

        host.appendChild(card);
        requestAnimationFrame(function () {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        });

        let dismissed = false;
        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            card.style.opacity = '0';
            card.style.transform = 'translateY(-10px)';
            setTimeout(function () { card.remove(); }, 200);
        }
        card.querySelector('button').addEventListener('click', dismiss);
        const timer = setTimeout(dismiss, duration);
        card.addEventListener('mouseenter', function () { clearTimeout(timer); });
    }

    function confirmModal(message, opts) {
        opts = opts || {};
        const rtl = isRtl();
        const confirmLabel = opts.confirmLabel || (rtl ? 'تأكيد' : 'Confirm');
        const cancelLabel = opts.cancelLabel || (rtl ? 'إلغاء' : 'Cancel');

        return new Promise(function (resolve) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);' +
                'display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;';
            overlay.innerHTML =
                '<div style="background:var(--bg-card,#fff);padding:26px;border-radius:var(--radius-lg,16px);' +
                'max-width:380px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.2);font-family:' + FONT + ';">' +
                '<div data-role="message" style="font-weight:800;font-size:16px;color:var(--text-main,#1E2A4A);margin-bottom:18px;' +
                'line-height:1.5;"></div>' +
                '<div style="display:flex;gap:8px;">' +
                '<button data-act="cancel" style="flex:1;padding:10px;border-radius:var(--radius-sm,8px);' +
                'border:1px solid var(--border,#E6EBF5);background:#f8fafc;cursor:pointer;font-weight:700;' +
                'font-family:' + FONT + ';"></button>' +
                '<button data-act="confirm" style="flex:1;padding:10px;border-radius:var(--radius-sm,8px);' +
                'border:none;background:var(--primary,#2563eb);color:#fff;cursor:pointer;font-weight:700;' +
                'font-family:' + FONT + ';"></button>' +
                '</div></div>';
            overlay.querySelector('[data-role="message"]').textContent = String(message == null ? '' : message);
            const cancelBtn = overlay.querySelector('[data-act="cancel"]');
            const confirmBtn = overlay.querySelector('[data-act="confirm"]');
            cancelBtn.textContent = cancelLabel;
            confirmBtn.textContent = confirmLabel;

            function close(result) {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') close(false);
                if (e.key === 'Enter') close(true);
            }
            cancelBtn.addEventListener('click', function () { close(false); });
            confirmBtn.addEventListener('click', function () { close(true); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
            confirmBtn.focus();
        });
    }

    function promptModal(message, opts) {
        opts = opts || {};
        const rtl = isRtl();
        const confirmLabel = opts.confirmLabel || (rtl ? 'تأكيد' : 'Confirm');
        const cancelLabel = opts.cancelLabel || (rtl ? 'إلغاء' : 'Cancel');

        return new Promise(function (resolve) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);' +
                'display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;';
            overlay.innerHTML =
                '<div style="background:var(--bg-card,#fff);padding:26px;border-radius:var(--radius-lg,16px);' +
                'max-width:400px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.2);font-family:' + FONT + ';">' +
                '<div data-role="message" style="font-weight:800;font-size:16px;color:var(--text-main,#1E2A4A);margin-bottom:12px;' +
                'line-height:1.5;"></div>' +
                '<textarea rows="3" style="width:100%;box-sizing:border-box;padding:10px 12px;' +
                'border:1px solid var(--border,#E6EBF5);border-radius:var(--radius-sm,8px);font-size:14px;' +
                'font-family:' + FONT + ';margin-bottom:14px;resize:vertical;"></textarea>' +
                '<div style="display:flex;gap:8px;">' +
                '<button data-act="cancel" style="flex:1;padding:10px;border-radius:var(--radius-sm,8px);' +
                'border:1px solid var(--border,#E6EBF5);background:#f8fafc;cursor:pointer;font-weight:700;' +
                'font-family:' + FONT + ';"></button>' +
                '<button data-act="confirm" style="flex:1;padding:10px;border-radius:var(--radius-sm,8px);' +
                'border:none;background:var(--primary,#2563eb);color:#fff;cursor:pointer;font-weight:700;' +
                'font-family:' + FONT + ';"></button>' +
                '</div></div>';
            overlay.querySelector('[data-role="message"]').textContent = String(message == null ? '' : message);
            const textarea = overlay.querySelector('textarea');
            if (opts.defaultValue) textarea.value = opts.defaultValue;
            const cancelBtn = overlay.querySelector('[data-act="cancel"]');
            const confirmBtn = overlay.querySelector('[data-act="confirm"]');
            cancelBtn.textContent = cancelLabel;
            confirmBtn.textContent = confirmLabel;

            function close(result) {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') close(null);
            }
            cancelBtn.addEventListener('click', function () { close(null); });
            confirmBtn.addEventListener('click', function () { close(textarea.value); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
            textarea.focus();
        });
    }

    window.notify = {
        success: function (msg, opts) { toast('success', msg, opts); },
        error: function (msg, opts) { toast('error', msg, opts); },
        info: function (msg, opts) { toast('info', msg, opts); },
        confirm: confirmModal,
        prompt: promptModal
    };

    window.alert = function (msg) { toast('info', msg); };
})();
