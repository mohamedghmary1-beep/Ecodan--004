/*
  MDECO Portal - Force-Fresh-Version Script
  ------------------------------------------
  Include this as the VERY FIRST thing inside <head>, before any other
  <script> or <link> tag, on EVERY page of the portal:

      <script>
        document.write('<script src="./cache-buster.js?v=' + Date.now() + '"><' + '/script>');
      </script>

  Loading it this way (via document.write with a Date.now() query string)
  means the browser can never serve a cached copy of THIS file itself.

  What it does on every single page load:
    1. Sends a HEAD request for the current page's own URL, with a
       cache-busting query string AND cache:'no-store'. This defeats BOTH
       the browser's local cache and GitHub Pages' CDN edge cache (which
       normally caches files for several minutes) — the request always
       reaches the real, current file on the server.
    2. Reads the server's ETag / Last-Modified header for that file — this
       changes every time you push a new version to GitHub.
    3. Compares it to the fingerprint saved from the last time this exact
       page was opened on this browser/device.
    4. If they genuinely differ (a newer version was published since last
       visit), forces a hard, cache-bypassing reload of the page right away —
       so the visitor always ends up on the latest version, automatically,
       with no manual Ctrl+F5 needed.

  ------------------------------------------------------------------------
  FIX (see change log below): this used to cause a visible "shake" — the
  page would sometimes reload itself repeatedly right after loading.
  Root causes and fixes:
    a) GitHub Pages' CDN can hand back slightly different ETag values for
       the SAME file depending on which edge node served the request, or
       depending on gzip/brotli content-negotiation (a well-known GH Pages
       quirk) — even though the file itself hasn't changed. That made this
       script "detect a new version" that didn't really exist, and reload
       repeatedly. -> normalizeFingerprint() below strips the weak "W/"
       prefix and known compression-variant suffixes before comparing, so
       encoding differences alone no longer look like a real change.
    b) Every forced reload appended a NEW "_r=" cache-busting param onto
       the URL WITHOUT removing the previous one, so the address bar query
       string grew a little longer on every reload. -> stripCacheBustParams()
       below removes any old "_cb"/"_r" params before rebuilding the URL.
    c) There was no cooldown, so if (a) still produced a false mismatch on
       two consecutive loads, the page could reload back-to-back with no
       limit. -> a short per-tab cooldown (RELOAD_COOLDOWN_MS) now makes
       sure this page can force at most one reload within that window,
       which turns any residual edge-case flicker into a single, silent,
       one-time refresh instead of a repeating "shake".
*/
(function () {
    var RELOAD_COOLDOWN_MS = 5 * 60 * 1000;  // at most one forced reload per 5 minutes for this page
    var CHECK_INTERVAL_MS = 60 * 1000;       // don't even run the check again within 1 minute of the last one

    var path = location.pathname;
    var VKEY = 'pageFingerprint::' + path;          // last CONFIRMED fingerprint
    var PKEY = 'pagePendingFingerprint::' + path;   // a new value seen once, awaiting confirmation
    var RKEY = 'pageLastForcedReload::' + path;      // sessionStorage: last time we forced a reload
    var CKEY = 'pageLastCheckedAt::' + path;         // sessionStorage: last time we ran a check at all

    // Throttle: don't even hit the server to check more than once a minute
    // per tab. This alone stops any "every couple seconds" behavior, since
    // fast successive page loads/navigations in the same tab will just skip
    // the check entirely until the interval has passed.
    var lastChecked = Number(sessionStorage.getItem(CKEY) || 0);
    if (Date.now() - lastChecked < CHECK_INTERVAL_MS) return;
    sessionStorage.setItem(CKEY, String(Date.now()));

    // Strips old "_cb" / "_r" cache-busting params this script itself adds,
    // so they don't pile up in the address bar across repeated reloads.
    function stripCacheBustParams(search) {
        if (!search) return '';
        var kept = search
            .replace(/^\?/, '')
            .split('&')
            .filter(function (part) {
                return part && part.indexOf('_cb=') !== 0 && part.indexOf('_r=') !== 0;
            });
        return kept.length ? '?' + kept.join('&') : '';
    }

    // Normalizes an ETag/Last-Modified value so that harmless variance
    // (weak-validator prefix, quoting, gzip/br compression-variant suffixes
    // some CDNs append) doesn't get mistaken for a genuinely new deployment.
    function normalizeFingerprint(fp) {
        if (!fp) return fp;
        return fp
            .replace(/^W\//, '')
            .replace(/"/g, '')
            .replace(/-(gzip|br|deflate)$/i, '')
            .trim();
    }

    var cleanSearch = stripCacheBustParams(location.search);
    var bustParam = '_cb=' + Date.now();
    var checkUrl = path + cleanSearch + (cleanSearch ? '&' : '?') + bustParam;

    fetch(checkUrl, { method: 'HEAD', cache: 'no-store' })
        .then(function (res) {
            var rawFp = res.headers.get('etag') || res.headers.get('last-modified');
            if (!rawFp) return;
            var fp = normalizeFingerprint(rawFp);
            var prev = localStorage.getItem(VKEY);

            // First time ever checking this page on this device: just record
            // a baseline, never reload on a "first sight".
            if (!prev) {
                localStorage.setItem(VKEY, fp);
                return;
            }

            if (prev === fp) {
                // Confirmed stable — clear any leftover pending candidate.
                localStorage.removeItem(PKEY);
                return;
            }

            // fp differs from the last CONFIRMED value. Don't trust a single
            // mismatch on its own (CDN edge-node variance can produce a
            // one-off false positive) — only act once we see the SAME new
            // value on two separate checks in a row.
            var pending = localStorage.getItem(PKEY);
            if (pending !== fp) {
                localStorage.setItem(PKEY, fp);
                return;
            }

            // Seen this exact new value twice now — treat it as a real
            // deploy. Still respect the reload cooldown as a last safeguard.
            var lastReload = Number(sessionStorage.getItem(RKEY) || 0);
            if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;

            localStorage.setItem(VKEY, fp);
            localStorage.removeItem(PKEY);
            sessionStorage.setItem(RKEY, String(Date.now()));
            location.replace(path + cleanSearch + (cleanSearch ? '&' : '?') + '_r=' + Date.now());
        })
        .catch(function () { /* network hiccup — ignore, don't block the page */ });
})();
