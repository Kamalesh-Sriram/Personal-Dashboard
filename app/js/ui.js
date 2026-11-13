/* ══════════════════════════════════════════════════════════════════════
   UI PLUMBING: action delegation, modals, toasts.

   No inline event handlers anywhere: markup carries data-act="name" and
   one listener on <document> dispatches it. That is what lets the site
   run under a Content-Security-Policy with no 'unsafe-inline' scripts.
   ══════════════════════════════════════════════════════════════════════ */
import { esc } from './util.js';
import { icon } from './icons.js';

const actions = {};
/** Register handlers: { 'habit.toggle': (dataset, event, element) => … } */
export function registerActions(map) { Object.assign(actions, map); }
export function runAction(name, data = {}) { if (actions[name]) return actions[name](data, null, null); }

export function initDelegation() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    fn(el.dataset, e, el);
  });
  const onField = attr => e => {
    const el = e.target.closest(`[data-${attr}]`);
    if (!el) return;
    const fn = actions[el.dataset[attr]];
    if (fn) fn(el.dataset, e, el);
  };
  document.addEventListener('change', onField('change'));
  document.addEventListener('input', onField('input'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); closeModal(); }
  });
}

/* ── toasts ── */
export function toast(title, body = '', { ms = 7000, kind = '', buttons = [] } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return () => {};
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<div class="toast-t">${esc(title)}</div>${body ? `<div class="toast-b">${esc(body)}</div>` : ''}` +
    (buttons.length ? `<div class="toast-a">${buttons.map((b, i) => `<button class="btn sm" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>` : '');
  const kill = () => el.remove();
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) buttons[+b.dataset.i].run();
    kill();
  });
  host.appendChild(el);
  while (host.children.length > 4) host.firstChild.remove();
  if (ms) setTimeout(kill, ms);
  return kill;
}

/* ── modals ── */
const stack = [];
export const modalOpen = () => stack.length > 0;

/**
 * openModal({ title, body, submit, left, wide, onSubmit(data, form), onMount(el), onClose })
 * `body` is an HTML string. If onSubmit is given the modal is a <form> and
 * gets Cancel / submit buttons; returning false from onSubmit keeps it open.
 */
export function openModal({ title, body, submit = 'Save', cancel = 'Cancel', left = '', wide = false, onSubmit, onMount, onClose, footer }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const foot = footer !== undefined ? footer
    : `<div class="left">${left}</div>${cancel ? `<button type="button" class="btn ghost" data-act="modal.close">${esc(cancel)}</button>` : ''}` +
      (onSubmit ? `<button type="submit" class="btn primary">${esc(submit)}</button>` : '');
  back.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-h"><h3>${esc(title)}</h3><button type="button" class="icon-btn sm" data-act="modal.close" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>
      ${foot ? `<div class="modal-f">${foot}</div>` : ''}
    </form>`;
  const form = back.firstElementChild;
  const entry = { back, onClose, restore: document.activeElement };
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!onSubmit) return;
    if (onSubmit(readForm(form), form) !== false) closeModal(entry);
  });
  let downOnBack = false;
  back.addEventListener('mousedown', e => { downOnBack = e.target === back; });
  back.addEventListener('click', e => { if (e.target === back && downOnBack) closeModal(entry); });
  document.getElementById('modal-root').appendChild(back);
  stack.push(entry);
  if (onMount) onMount(form);
  const first = form.querySelector('[autofocus]') || form.querySelector('input:not([type=hidden]):not([type=color]), textarea, select');
  if (first && !matchMedia('(pointer: coarse)').matches) { first.focus(); if (first.select && first.type === 'text') first.select(); }
  return { el: form, close: () => closeModal(entry) };
}
export function closeModal(entry) {
  const e = entry && stack.includes(entry) ? entry : stack[stack.length - 1];
  if (!e) return;
  stack.splice(stack.indexOf(e), 1);
  e.back.remove();
  if (e.onClose) e.onClose();
  if (e.restore && e.restore.focus && document.contains(e.restore)) e.restore.focus();
}
registerActions({ 'modal.close': () => closeModal() });

/** Named form fields → plain object. Checkboxes become booleans. */
export function readForm(form) {
  const out = {};
  form.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}

export function confirmDialog({ title, body = '', ok = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal({
      title, body: `<p class="muted">${esc(body)}</p>`, footer:
        `<button type="button" class="btn ghost" data-act="modal.close">Cancel</button>
         <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-confirm autofocus>${esc(ok)}</button>`,
      onMount: el => el.querySelector('[data-confirm]').addEventListener('click', () => { answered = true; m.close(); resolve(true); }),
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

/* ── small render helpers shared by views ── */
export const switchHtml = (act, on, data = '') =>
  `<button type="button" class="switch" role="switch" aria-checked="${on ? 'true' : 'false'}" data-act="${act}" ${data}></button>`;

export const segHtml = (act, options, current, key = 'v') =>
  `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button type="button" class="${v === current ? 'on' : ''}" data-act="${act}" data-${key}="${esc(v)}" aria-pressed="${v === current}">${esc(label)}</button>`).join('')}</div>`;

/** SVG ring gauge. pct 0..100. */
export function ringHtml(pct, { size = 64, stroke = 6, color = 'var(--accent)', label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || p + '%')}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
