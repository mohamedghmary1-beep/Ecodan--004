function paginateRegisterReport(container) {
  const budget = 259 * 96 / 25.4;
  container.querySelectorAll('.register-report-page').forEach(first => {
    const main = first.querySelector('.register-main');
    const section = main?.querySelector('.register-table-section');
    const source = section?.querySelector('tbody');
    if (!source) return;
    const analytics=main.querySelector('.register-analytics');
    if(analytics)main.querySelector('.register-kpis')?.before(analytics);
    main.querySelector('.register-kpis')?.after(section);
    const rows = [...source.children];
    const supplements = [...main.children].filter(node => node.matches('.register-financial-kpis, .register-source'));
    supplements.forEach(node => node.remove());
    source.replaceChildren();
    const template = first.cloneNode(true);
    template.querySelector('.register-kpis')?.remove();
    template.querySelector('.register-analytics')?.remove();
    let current = first;
    let target = source;
    const height = () => current.querySelector('.pf-body').getBoundingClientRect().height;
    const next = () => {
      const continuation = template.cloneNode(true);
      current.after(continuation);
      current = continuation;
      target = current.querySelector('tbody');
    };
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
    supplements.forEach(node => {
      current.querySelector('.register-main').append(node);
      if (height() > budget) {
        node.remove();
        next();
        current.querySelector('.register-table-section').remove();
        current.querySelector('.register-main').append(node);
      }
    });
    let summaryPage = first;
    while (summaryPage?.classList.contains('register-report-page')) {
      if (!summaryPage.querySelector('.register-table-section') && summaryPage.querySelector('.register-analytics')) {
        summaryPage.classList.add('register-summary-page');
        if (summaryPage.querySelector('.pf-body').getBoundingClientRect().height > budget) {
          summaryPage.classList.remove('register-summary-page');
        }
      }
      summaryPage = summaryPage.nextElementSibling;
    }
    delete first.dataset.printFitError;
  });
  container.querySelectorAll('.report-page').forEach((page, index) => {
    const number = page.querySelector('.pf-pagenum');
    if (number) number.textContent = index + 1;
  });
}
