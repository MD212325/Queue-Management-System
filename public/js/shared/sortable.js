// Drag-and-drop reordering that works with mouse, finger and pen (pointer events).
//
// The dragged row follows the pointer and the other rows slide out of the way, but nothing is moved in the DOM
// until the drop. That keeps the browser's pointer capture intact on a touch screen. The page then re-draws the
// list from its own state in the new order. Keyboard users reorder with the arrow keys instead (see the views).
//
//   makeSortable(listParent, { itemSelector: '.row', handleSelector: '.grip', onReorder: keys => ... })
// Each item needs data-key. The handle needs `touch-action: none` in CSS so a finger drag does not scroll the page.

export function makeSortable(container, { itemSelector, handleSelector, onReorder, onStart = () => {}, onEnd = () => {} }) {
  let drag = null;
  const itemsOf = list => [...list.children].filter(c => c.matches(itemSelector));

  container.addEventListener('pointerdown', e => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const handle = e.target.closest(handleSelector);
    const item = handle && handle.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    e.preventDefault();

    const list = item.parentElement;
    const items = itemsOf(list);
    const scroll0 = window.scrollY;
    // Frozen layout (in page coordinates) so scrolling during the drag cannot confuse the maths.
    const rects = items.map(el => { const r = el.getBoundingClientRect(); return { top: r.top + scroll0, height: r.height }; });
    const from = items.indexOf(item);
    drag = { handle, item, items, rects, from, to: from, startPageY: e.clientY + scroll0, clientY: e.clientY, pointerId: e.pointerId, raf: 0 };
    try { handle.setPointerCapture(e.pointerId); } catch { /* not supported: events still arrive */ }
    item.classList.add('dragging');
    document.body.classList.add('is-dragging');
    onStart();
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', cancel);
    drag.raf = requestAnimationFrame(tick);
  });

  function onMove(e) { if (drag && e.pointerId === drag.pointerId) { drag.clientY = e.clientY; update(); } }

  // Near the top or bottom edge of the screen, keep scrolling so a long list can be dragged all the way.
  function tick() {
    if (!drag) return;
    const edge = 80;
    if (drag.clientY < edge) window.scrollBy(0, -14);
    else if (drag.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    update();
    drag.raf = requestAnimationFrame(tick);
  }

  function update() {
    const { items, rects, from } = drag;
    const pageY = drag.clientY + window.scrollY;
    const dy = pageY - drag.startPageY;
    const centre = rects[from].top + rects[from].height / 2 + dy;

    let to = from;
    items.forEach((_, i) => {
      if (i === from) return;
      const mid = rects[i].top + rects[i].height / 2;
      if (i < from && centre < mid) to = Math.min(to, i);
      if (i > from && centre > mid) to = Math.max(to, i);
    });
    drag.to = to;

    items[from].style.transform = `translateY(${dy}px)`;
    const slot = from < items.length - 1 ? rects[from + 1].top - rects[from].top : rects[from].top - rects[from - 1].top;
    items.forEach((el, i) => {
      if (i === from) return;
      let shift = 0;
      if (from < to && i > from && i <= to) shift = -slot;
      if (to < from && i >= to && i < from) shift = slot;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function release(apply) {
    if (!drag) return;
    const { handle, items, from, to, raf, pointerId } = drag;
    cancelAnimationFrame(raf);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', cancel);
    try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }
    const keys = items.map(el => el.dataset.key);
    items.forEach(el => { el.style.transform = ''; el.classList.remove('dragging'); });
    document.body.classList.remove('is-dragging');
    drag = null;
    onEnd();
    if (apply && to !== from) {
      const [moved] = keys.splice(from, 1);
      keys.splice(to, 0, moved);
      onReorder(keys);
    }
  }
  const finish = () => release(true);
  const cancel = () => release(false);
}
