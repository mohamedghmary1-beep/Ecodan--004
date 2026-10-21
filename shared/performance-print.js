/* Freeze rendered charts before print layout changes their canvas dimensions. */
(function () {
  let report;
  function fitReport() {
    const copy = report.firstElementChild;
    const width = 281 * 96 / 25.4;
    const height = 192 * 96 / 25.4;
    report.style.width = '281mm';
    report.style.height = '192mm';
    report.style.display = 'block';
    report.style.position = 'relative';
    copy.style.width = width + 'px';
    copy.style.position = 'absolute';
    copy.style.top = '0';
    copy.style.left = '0';
    copy.style.transform = 'none';
    // Measure the laid-out report, not canvas overflow or a pre-print layout.
    const contentHeight = Math.max(copy.getBoundingClientRect().height, 1);
    const scale = Math.min(1, height / contentHeight);
    copy.style.transformOrigin = 'top left';
    copy.style.transform = 'scale(' + scale + ')';
    copy.style.left = ((width - width * scale) / 2) + 'px';
  }
  function prepare() {
    if (report) { fitReport(); return; }
    const source = document.getElementById('dashboard');
    if (!source || source.style.display === 'none') return;
    report = document.createElement('div');
    report.id = 'performancePrintReport';
    const copy = source.cloneNode(true);
    copy.id = 'printDashboard';
    const charts = source.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((canvas, index) => {
      const original = charts[index];
      const chart = typeof Chart !== 'undefined' ? Chart.getChart(original) : null;
      // Draw synchronously: print must not wait for data-URL image decoding.
      chart?.stop();
      chart?.render();
      canvas.width = original.width;
      canvas.height = original.height;
      canvas.getContext('2d').drawImage(original, 0, 0);
      canvas.removeAttribute('style');
      canvas.className = 'print-chart-image';
    });
    copy.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    report.appendChild(copy);
    document.body.appendChild(report);
    document.body.classList.add('printing-performance');
    fitReport();
  }
  function restore() {
    report?.remove(); report = null;
    document.body.classList.remove('printing-performance');
    if (typeof Chart !== 'undefined') document.querySelectorAll('#dashboard canvas').forEach(canvas => Chart.getChart(canvas)?.resize());
  }
  window.addEventListener('beforeprint', prepare);
  window.addEventListener('afterprint', restore);
  window.matchMedia('print').addEventListener('change', event => {
    if (!event.matches) restore();
  });
})();
