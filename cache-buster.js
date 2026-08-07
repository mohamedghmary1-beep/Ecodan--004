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
    4. If they differ (a newer version was published since last visit),
       forces a hard, cache-bypassing reload of the page right away —
       so the visitor always ends up on the latest version, automatically,
       with no manual Ctrl+F5 needed.
*/
(function () {
    var path = location.pathname;
    var VKEY = 'pageFingerprint::' + path;
    var bust = '_cb=' + Date.now();
    var checkUrl = path + (location.search ? location.search + '&' + bust : '?' + bust);

    fetch(checkUrl, { method: 'HEAD', cache: 'no-store' })
        .then(function (res) {
            var fp = res.headers.get('etag') || res.headers.get('last-modified');
            if (!fp) return;
            var prev = localStorage.getItem(VKEY);
            localStorage.setItem(VKEY, fp);
            if (prev && prev !== fp) {
                location.replace(path + location.search + (location.search ? '&' : '?') + '_r=' + Date.now());
            }
        })
        .catch(function () { /* network hiccup — ignore, don't block the page */ });
})();
