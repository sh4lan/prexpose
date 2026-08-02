// Virtualized list that scrolls with the page (no internal scrollbar): it renders
// only the rows intersecting the viewport, plus a buffer on each side, and keeps
// a spacer holding the full list height so the page scrolls the right amount.

const BUFFER = 8;

export function createVirtualList(container, { renderRow, estimateRowHeight = 56 }) {
  container.classList.add('vlist');

  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  container.appendChild(spacer);

  let items = [];
  let rowHeight = estimateRowHeight;
  let measured = false;
  let start = -1;
  let end = -1;
  let rafId = null;

  function measure() {
    if (measured || !items.length) return;
    const probe = renderRow(items[0], 0);
    probe.style.position = 'absolute';
    probe.style.top = '-9999px';
    probe.style.visibility = 'hidden';
    probe.style.height = 'auto';
    spacer.appendChild(probe);
    const h = probe.offsetHeight;
    spacer.removeChild(probe);
    if (h > 0) { rowHeight = h; measured = true; }
  }

  function render() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    measure();

    const count = items.length;
    container.dataset.vcount = String(count);
    spacer.style.height = count * rowHeight + 'px';

    if (!count) {
      spacer.innerHTML = '';
      start = end = -1;
      return;
    }

    // Visible slice of the list within the page viewport.
    const rect = container.getBoundingClientRect();
    const listTop = rect.top;
    const listBottom = rect.bottom;
    const visTop = Math.max(listTop, 0);
    const visBottom = Math.min(listBottom, window.innerHeight);

    if (visTop >= visBottom) {
      if (start !== -1) { spacer.innerHTML = ''; start = end = -1; }
      return;
    }

    const first = Math.max(0, Math.floor((visTop - listTop) / rowHeight) - BUFFER);
    const last = Math.min(count - 1, Math.ceil((visBottom - listTop) / rowHeight) + BUFFER);

    if (first === start && last === end) return;

    const frag = document.createDocumentFragment();
    for (let i = first; i <= last; i++) {
      const el = renderRow(items[i], i);
      el.style.position = 'absolute';
      el.style.top = i * rowHeight + 'px';
      el.style.left = '0';
      el.style.right = '0';
      el.style.height = rowHeight + 'px';
      if (i === count - 1) el.setAttribute('data-last', '');
      frag.appendChild(el);
    }
    spacer.innerHTML = '';
    spacer.appendChild(frag);
    start = first;
    end = last;
  }

  function onScroll() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  const observer = new ResizeObserver(() => render());
  observer.observe(container);

  return {
    setItems(next) {
      items = next || [];
      measured = false;
      start = end = -1; // force a rebuild even if the window is unchanged
      render();
    },
    refresh() { render(); },
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer.disconnect();
      spacer.remove();
      container.classList.remove('vlist');
    },
  };
}
