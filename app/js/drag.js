/* ══════════════════════════════════════════════════════════════════════
   DRAG: one sortable engine for every list and grid (mouse + touch, no
   library).

   What you drag lifts off the page and follows the pointer. The slot it
   will land in opens up live, and the neighbours glide out of the way, so
   what you see when you let go is exactly what you get.

     makeSortable(root, {
       item: '.kcard',            // what can be dragged
       container: '.kcards',      // the list an item sits in (its direct parent)
       zone: '.kcol',             // optional larger area that counts as that list
       grid: false,               // true when items wrap into rows
       group: true,               // may items move between containers?
       ignore: 'button, input',   // presses starting here never begin a drag
       scrollX: '.board',         // optional sideways scroller to nudge at the edges
       onDrop({ el, from, to, index }) {}
     })

   A mouse drag starts after a few pixels of movement. On a touch screen it
   starts after a short press-and-hold, so swiping still scrolls.
   ══════════════════════════════════════════════════════════════════════ */
import { sound, buzz, motion } from './fx.js';

const EASE = 'cubic-bezier(.2,.8,.2,1)', SETTLE = 150;
const DEFAULT_IGNORE = 'button, input, textarea, select, a, [contenteditable]';
let d = null, pend = null, pressTimer = null, droppedAt = 0;

const itemsOf = (cont, o) => [...cont.children].filter(el => el.matches(o.item));
const rectsOf = els => new Map(els.map(el => [el, el.getBoundingClientRect()]));
function flip(before) {
  if (motion() === 'off') return;
  before.forEach((was, el) => {
    if (!el.isConnected || !el.animate) return;
    const now = el.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: SETTLE, easing: EASE });
  });
}

function begin(p, x, y) {
  const src = p.el, r = src.getBoundingClientRect();
  const ghost = src.cloneNode(true);
  ghost.removeAttribute('data-flip');
  ghost.classList.add('drag-ghost');
  ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
  ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
  document.body.appendChild(ghost);
  src.classList.add('drag-src');
  document.documentElement.classList.add('dragging-on');
  d = { o: p.o, root: p.root, src, ghost, left: r.left, top: r.top, ox: x - r.left, oy: y - r.top,
        from: src.parentNode, next: src.nextSibling, moved: false, lastMove: 0, x, y, raf: 0, late: null };
  sound('lift'); buzz(10);
  move(x, y);
  d.raf = requestAnimationFrame(edgeLoop);
}
const ghostAt = (x, y, lift = true) => `translate(${x - d.ox - d.left}px, ${y - d.oy - d.top}px)${lift ? ' scale(1.03) rotate(.8deg)' : ''}`;
function move(x, y) {
  if (!d) return;
  d.x = x; d.y = y;
  d.ghost.style.transform = ghostAt(x, y);
  place();
}

/** Open the slot under the pointer. Neighbours are left to finish gliding
 *  before the next change, or their moving outlines would be hit-tested. */
function place() {
  if (!d) return;
  const { o, src } = d, wait = SETTLE + 10 - (performance.now() - d.lastMove);
  if (wait > 0) { clearTimeout(d.late); d.late = setTimeout(place, wait); return; }
  if (!src.isConnected) { finish(false); return; }                     // the page was redrawn under the drag
  const hit = document.elementFromPoint(d.x, d.y);
  if (!hit) return;
  let cont = hit.closest(o.container);
  if (!cont && o.zone) {
    // inside a zone, or level with one: a short column still takes a drop held below its last card
    let z = hit.closest(o.zone);
    if (!z && d.root.contains(hit)) z = [...d.root.querySelectorAll(o.zone)].find(el => { const r = el.getBoundingClientRect(); return d.x >= r.left && d.x <= r.right; });
    cont = z && z.querySelector(o.container);
  }
  if (!cont || !d.root.contains(cont)) return;
  if (!o.group && cont !== d.from) return;
  const items = itemsOf(cont, o).filter(el => el !== src);
  let i = 0;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const passed = o.grid ? (r.bottom < d.y || (r.top <= d.y && r.left + r.width / 2 < d.x)) : (r.top + r.height / 2 < d.y);
    if (!passed) break;
    i++;
  }
  const here = src.parentNode === cont ? itemsOf(cont, o).indexOf(src) : -1;
  if (here === i) return;
  const before = rectsOf([...new Set([...items, ...itemsOf(src.parentNode, o)])].filter(el => el !== src));
  cont.insertBefore(src, items[i] || (items.length ? items[items.length - 1].nextSibling : cont.firstChild));
  flip(before);
  d.lastMove = performance.now();
  d.moved = true;
}

/** Hold the pointer near an edge and the list keeps scrolling. */
function edgeLoop() {
  if (!d) return;
  const { o } = d, M = 56, step = 14;
  let scrolled = false;
  const cont = d.src.parentNode;
  if (cont && cont.scrollHeight > cont.clientHeight + 2) {
    const r = cont.getBoundingClientRect();
    if (d.y > r.bottom - M && d.y < r.bottom + 40) { cont.scrollTop += step; scrolled = true; }
    else if (d.y < r.top + M && d.y > r.top - 40) { cont.scrollTop -= step; scrolled = true; }
  }
  const sx = o.scrollX && document.querySelector(o.scrollX);
  if (sx) {
    const r = sx.getBoundingClientRect();
    if (d.x > r.right - M) { sx.scrollLeft += step; scrolled = true; } else if (d.x < r.left + M) { sx.scrollLeft -= step; scrolled = true; }
  }
  if (!scrolled) {
    if (d.y > innerHeight - M) { scrollBy(0, step); scrolled = true; } else if (d.y < M + 60) { scrollBy(0, -step); scrolled = true; }
  }
  if (scrolled) place();
  d.raf = requestAnimationFrame(edgeLoop);
}

function finish(commit) {
  if (!d) return;
  // a quick flick can be released before the slot caught up: place it where the pointer is now
  if (commit && d.src.isConnected) { clearTimeout(d.late); d.lastMove = 0; place(); }
  if (!d) return;
  const cur = d; d = null;
  cancelAnimationFrame(cur.raf); clearTimeout(cur.late);
  droppedAt = Date.now();
  const { src, ghost, o } = cur;
  const clean = () => { ghost.remove(); src.classList.remove('drag-src'); document.documentElement.classList.remove('dragging-on'); };
  if (!src.isConnected) { clean(); return; }
  if (!commit && cur.moved) cur.from.insertBefore(src, cur.next && cur.next.parentNode === cur.from ? cur.next : null);
  const done = () => {
    clean();
    if (commit && cur.moved && src.isConnected) {
      sound('drop');
      o.onDrop({ el: src, from: cur.from, to: src.parentNode, index: itemsOf(src.parentNode, o).indexOf(src) });
    }
  };
  // the lifted copy settles into the slot before the page is told
  const r = src.getBoundingClientRect();
  if (motion() === 'off' || !ghost.animate) { done(); return; }
  const a = ghost.animate([{ transform: ghost.style.transform }, { transform: `translate(${r.left - cur.left}px, ${r.top - cur.top}px)` }], { duration: 140, easing: EASE, fill: 'forwards' });
  a.onfinish = done; a.oncancel = done;
}

/* one set of window listeners serves every sortable on the page */
window.addEventListener('mousemove', e => {
  if (d) { e.preventDefault(); move(e.clientX, e.clientY); return; }
  if (pend && !pend.touch && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > 5) { const p = pend; pend = null; begin(p, e.clientX, e.clientY); }
});
window.addEventListener('mouseup', () => { if (pend && !pend.touch) pend = null; if (d) finish(true); });
window.addEventListener('keydown', e => { if (d && e.key === 'Escape') { e.preventDefault(); finish(false); } });
window.addEventListener('blur', () => { pend = null; if (d) finish(false); });

export function makeSortable(root, opts) {
  const o = { grid: false, group: false, ignore: DEFAULT_IGNORE, ...opts };
  const pick = e => {
    if (o.ignore && e.target.closest(o.ignore)) return null;
    const el = e.target.closest(o.item);
    return el && root.contains(el) && el.parentNode.matches(o.container) ? el : null;
  };
  root.addEventListener('mousedown', e => {
    if (e.button !== 0 || d) return;
    const el = pick(e);
    if (el) pend = { el, o, root, x: e.clientX, y: e.clientY, touch: false };
  });
  root.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || d) return;
    const el = pick(e); if (!el) return;
    const t = e.touches[0];
    pend = { el, o, root, x: t.clientX, y: t.clientY, touch: true };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { if (pend && pend.touch) { const p = pend; pend = null; begin(p, p.x, p.y); } }, 280);
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (d) { e.preventDefault(); move(t.clientX, t.clientY); return; }
    if (pend && pend.touch && Math.hypot(t.clientX - pend.x, t.clientY - pend.y) > 10) { pend = null; clearTimeout(pressTimer); }   // it was a scroll
  }, { passive: false });
  const end = commit => () => { clearTimeout(pressTimer); pend = null; if (d) finish(commit); };
  root.addEventListener('touchend', end(true));
  root.addEventListener('touchcancel', end(false));
  root.addEventListener('contextmenu', e => { if (d) e.preventDefault(); });
  // the click that ends a drag must not open or start whatever was dragged
  root.addEventListener('click', e => { if (Date.now() - droppedAt < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
}
export const dragging = () => !!d;

/** After a drop inside one group of a longer list: the group's slots in the
 *  full list are refilled in the new order, everything else stays put. */
export function reorderWithin(list, ids) {
  const moved = new Set(ids), byId = new Map(list.map(x => [String(x.id), x]));
  let i = 0;
  return list.map(x => (moved.has(String(x.id)) ? byId.get(ids[i++]) : x));
}
