/* ══════════════════════════════════════════════════════════════════════
   FX: motion and sound. Everything here is decoration: the app works the
   same with all of it switched off (Settings > Look).

   Motion rule: nothing lasts longer than about a third of a second, and
   nothing runs on the constant background redraws, only when a tab opens
   or when you did something.

   Sound is synthesised in the browser with Web Audio. There are no audio
   files, so nothing is downloaded and nothing comes from a third party.
   ══════════════════════════════════════════════════════════════════════ */
import { S } from './store.js';

/* ── settings ── */
const osReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** 'full' | 'subtle' | 'off'. The device's own "reduce motion" switch wins. */
export function motion() {
  const s = S().settings;
  if (osReduced() || s.reduceMotion) return 'off';
  return s.motion === 'subtle' || s.motion === 'off' ? s.motion : 'full';
}
const soundCfg = () => S().settings.sound || { on: true, volume: 40 };

/* ── sound ── */
let ctx = null, master = null;
function audio() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) { ctx = new Ctor(); master = ctx.createGain(); master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
/** One soft note. `to` glides the pitch, which is what makes a blip sound like a "pop". */
function note(at, freq, { to = null, dur = 0.12, gain = 0.5, type = 'sine' } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
const SOUNDS = {
  tick: () => { note(0, 740, { to: 1180, dur: 0.11, gain: 0.5 }); note(0.012, 1480, { dur: 0.07, gain: 0.12, type: 'triangle' }); },
  untick: () => note(0, 520, { to: 380, dur: 0.09, gain: 0.28 }),
  done: () => { note(0, 659, { dur: 0.13, gain: 0.42 }); note(0.085, 988, { dur: 0.2, gain: 0.42 }); },
  start: () => { note(0, 196, { to: 294, dur: 0.2, gain: 0.5, type: 'triangle' }); note(0.07, 392, { dur: 0.16, gain: 0.18 }); },
  stop: () => { note(0, 440, { to: 330, dur: 0.16, gain: 0.36, type: 'triangle' }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => note(i * 0.075, f, { dur: 0.3, gain: 0.34 })),
  drop: () => note(0, 300, { to: 220, dur: 0.07, gain: 0.22, type: 'triangle' }),
  lift: () => note(0, 420, { to: 560, dur: 0.06, gain: 0.14, type: 'triangle' })
};
/** Play a named sound. Browsers only allow audio after a click or key press,
 *  so this is silent when called from a background event: that is intended. */
export function sound(name, { force = false } = {}) {
  const cfg = soundCfg();
  if (!force && !cfg.on) return;
  try {
    if (!audio() || !SOUNDS[name]) return;
    master.gain.value = Math.max(0, Math.min(100, cfg.volume == null ? 40 : cfg.volume)) / 100 * 0.6;
    SOUNDS[name]();
  } catch { /* audio is never worth an error */ }
}
export function buzz(ms = 8) {
  if (S().settings.haptics === false || motion() === 'off') return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ }
}

/* ── overlays: drawn on <body>, so a redraw of the page underneath cannot cut them short ── */
function layer() {
  let el = document.getElementById('fx');
  if (!el) { el = document.createElement('div'); el.id = 'fx'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  return el;
}
const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.max(r.width, r.height) / 2 }; };
const colourOf = el => { try { return getComputedStyle(el).getPropertyValue('--c').trim() || getComputedStyle(el).getPropertyValue('--accent').trim(); } catch { return ''; } };

/** A ring and eight short rays leaving a point: the "done" flourish. */
export function burst(el, color) {
  if (motion() !== 'full' || !el) return;
  const { x, y, r } = centre(el), c = color || colourOf(el), n = 8;
  const b = document.createElement('div');
  b.className = 'fx-burst';
  b.style.cssText = `left:${x}px;top:${y}px;--r:${Math.round(r)}px;${c ? `--c:${c};` : ''}`;
  let rays = '<u></u>';
  for (let i = 0; i < n; i++) rays += `<i style="--a:${i * (360 / n) + 22}deg"></i>`;
  b.innerHTML = rays;
  layer().appendChild(b);
  setTimeout(() => b.remove(), 700);
}
/** A short label that rises from an element and fades: "+25 XP". */
export function float(el, text, tone = '') {
  if (motion() === 'off' || !el || !text) return;
  const { x, y, r } = centre(el), f = document.createElement('div');
  f.className = 'fx-float ' + tone;
  f.textContent = text;
  f.style.cssText = `left:${x}px;top:${y - r - 4}px`;
  layer().appendChild(f);
  setTimeout(() => f.remove(), 950);
}
/** A sweep of light across a card for the big moments. */
export function shine(el) {
  if (motion() !== 'full' || !el) return;
  el.classList.remove('fx-shine'); void el.offsetWidth; el.classList.add('fx-shine');
  setTimeout(() => el.classList.remove('fx-shine'), 900);
}

/* ── ticking a box ── */
let popKey = null;
const keyOf = el => { const d = { ...el.dataset }; delete d.flip; return JSON.stringify(Object.keys(d).sort().map(k => [k, d[k]])); };
/** Called for every click before its action runs. If the click ticks a box,
 *  play the flourish now and remember which box, so the redrawn one can
 *  draw its tick in (see `afterRender`). */
export function onAction(el) {
  const box = el.classList.contains('check') ? el : el.querySelector(':scope > .check');
  if (!box || el.disabled) return;
  if (box.classList.contains('on')) { sound('untick'); return; }
  popKey = keyOf(el);
  burst(box); sound('tick'); buzz();
}
/** After a redraw: the box that was just ticked draws itself in. */
export function afterRender(root) {
  if (!popKey) return;
  const key = popKey; popKey = null;
  if (motion() === 'off') return;
  for (const el of root.querySelectorAll('[data-act]')) {
    const box = el.classList.contains('check') ? el : el.querySelector(':scope > .check');
    if (box && box.classList.contains('on') && keyOf(el) === key) { box.classList.add('pop'); break; }
  }
}

/* ── things moving to a new place glide there (FLIP) ── */
export function snapshot(root) {
  const m = new Map();
  if (motion() === 'off') return m;
  root.querySelectorAll('[data-flip]').forEach(el => m.set(el.dataset.flip, el.getBoundingClientRect()));
  return m;
}
/** `hold` keeps a moved element where it was for a moment first, so a tick
 *  can finish drawing before its row slides away. */
export function glide(root, before, { hold = 0, fresh = true } = {}) {
  if (!before || motion() === 'off' || !root.animate) return;
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  root.querySelectorAll('[data-flip]').forEach(el => {
    const was = before.get(el.dataset.flip), now = el.getBoundingClientRect();
    if (!was) { if (fresh && before.size) el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: ease }); return; }
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
    // far-off rows are not worth animating, and would streak across the screen
    if (Math.abs(dy) > innerHeight * 1.5) return;
    const far = Math.hypot(dx, dy) > 60;
    el.animate([{ transform: `translate(${dx}px,${dy}px)`, zIndex: 3 }, { transform: 'none', zIndex: 3 }],
      { duration: far ? 360 : 240, delay: far ? hold : 0, easing: ease, fill: 'backwards' });
  });
}

/* ── a tab opening: its panels rise into place one after another ── */
const BLOCKS = '.card, .hud-cell, .kcol, .hab, .run-bar, .view-h, .set-tabs, .month-card';
export function enter(root) {
  const level = motion();
  if (level === 'off') return;
  let i = 0;
  root.querySelectorAll(BLOCKS).forEach(el => {
    if (el.parentElement.closest(BLOCKS) && !el.matches('.view-h')) return;       // only the outermost panels
    if (el.getBoundingClientRect().top > innerHeight) return;                      // nothing below the fold
    el.style.setProperty('--i', Math.min(i++, 12));
    el.classList.add(level === 'full' ? 'rise' : 'fade');
  });
  root.classList.add('entering');
  countUp(root);
  setTimeout(() => {
    root.classList.remove('entering');
    root.querySelectorAll('.rise, .fade').forEach(el => { el.classList.remove('rise', 'fade'); el.style.removeProperty('--i'); });
  }, ENTER_MS);
}
/** How long a tab counts as "just opened". Views hold off their own
 *  per-second redraws for this long, so the opening motion is not cut short. */
export const ENTER_MS = 1150;
/** Numbers marked data-count run up from zero while their gauge fills. */
function countUp(root) {
  if (motion() !== 'full') return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count;
    if (!(to > 0)) return;
    const t0 = performance.now(), dur = 900;
    el.textContent = '0';
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(to * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
