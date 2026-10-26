function paginateRegisterReport(container) {
  const budget = 259 * 96 / 25.4;
  container.querySelectorAll('.register-report-page').forEach(first => {
    const main = first.querySelector('.register-main');
    const section = main?.querySelector('.register-table-section');
    const source = section?.querySelector('tbody');
    if (!source) return;
    first.classList.add('register-summary-page');
    const analytics=main.querySelector('.register-analytics');
    if(analytics)main.querySelector('.register-kpis')?.before(analytics);
    const rows = [...source.children];
    const supplements = [...main.children].filter(node => node.matches('.register-financial-kpis, .register-source'));
    supplements.forEach(node => node.remove());
    const financialKpis = supplements.find(node => node.matches('.register-financial-kpis'));
    const reportSource = supplements.find(node => node.matches('.register-source'));
    if(financialKpis)main.querySelector('.register-analytics')?.after(financialKpis);
    main.querySelector('.register-kpis')?.after(section);
    source.replaceChildren();
    const template = first.cloneNode(true);
    template.classList.remove('register-summary-page');
    template.querySelector('.register-kpis')?.remove();
    template.querySelector('.register-analytics')?.remove();
    template.querySelector('.register-financial-kpis')?.remove();
    section.remove();
    let current = first;
    let target = null;
    const height = () => current.querySelector('.pf-body').getBoundingClientRect().height;
    const next = () => {
      const continuation = template.cloneNode(true);
      current.after(continuation);
      current = continuation;
      target = current.querySelector('tbody');
    };
    next();
    rows.forEach(row => {
      target.append(row);
      if (height() > budget && (target.children.length > 1 || current === first)) {
        const previous = current;
        row.remove();
        next();
        target.append(row);
        if (height() > budget && previous === first && !previous.querySelector('tbody').children.length) {
          row.remove();
          current.remove();
          current = previous;
          target = current.querySelector('tbody');
          target.append(row);
        }
      }
      let fragment = row;
      while (height() > budget) {
        const texts = [...fragment.cells].map(cell => cell.innerText);
        const remainder = fragment.cloneNode(true);
        const cut = (text, ratio) => {
          const limit = Math.min(text.length, Math.max(64, Math.floor(text.length * ratio)));
          if (limit === text.length) return limit;
          const space = text.lastIndexOf(' ', limit);
          return space > 0 ? space + 1 : limit;
        };
        const setPrefix = ratio => [...fragment.cells].forEach((cell, index) => {
          cell.textContent = texts[index].slice(0, cut(texts[index], ratio));
        });
        let lower = 0;
        let upper = 1;
        for (let attempt = 0; attempt < 20; attempt++) {
          const middle = (lower + upper) / 2;
          setPrefix(middle);
          if (height() <= budget) lower = middle;
          else upper = middle;
        }
        setPrefix(lower);
        if (height() > budget) {
          [...fragment.cells].forEach((cell, index) => { cell.textContent = texts[index]; });
          break;
        }
        [...remainder.cells].forEach((cell, index) => {
          cell.textContent = texts[index].length <= 64 ? texts[index] : texts[index].slice(cut(texts[index], lower));
        });
        next();
        target.append(remainder);
        fragment = remainder;
      }
    });
    if(reportSource){
      current.querySelector('.register-main').append(reportSource);
      if(height()>budget){
        reportSource.remove();
        next();
        current.querySelector('.register-main').append(reportSource);
      }
    }
    delete first.dataset.printFitError;
  });
  container.querySelectorAll('.report-page').forEach((page, index) => {
    const number = page.querySelector('.pf-pagenum');
    if (number) number.textContent = index + 1;
  });
}
