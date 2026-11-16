/* ══════════════════════════════════════════════════════════════════════
   THEME: turns settings into attributes and CSS variables on <html>.

   The background image is stored in IndexedDB on this device only (it is
   far too large for the synced document, and it never leaves the browser).
   Uploads are downscaled and re-encoded through a canvas, which also
   strips any EXIF/location metadata from the photo.
   ══════════════════════════════════════════════════════════════════════ */
import { S } from './store.js';
import { onColor, safeColor, clamp, hexToRgb } from './util.js';

export const ACCENTS = [
  ['Cyan', '#2BD4F0'], ['Gold', '#E0B25A'], ['Ember', '#F2793A'], ['Vision blue', '#2F7BFF'],
  ['Violet', '#8B7CF6'], ['Mint', '#2BF0A0'], ['Rose', '#EE5D8C'], ['Slate', '#C5C9D0']
];

const LOOK_KEY = 'hq.v5.look';
const CLASSIC_FONTS = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';
const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: light)') : null;
let bgUrl = null;
/** The dark backdrop is #07090C with 3% of the accent mixed in (see tokens.css). */
function tintedBg(accent) {
  const rgb = hexToRgb(accent), base = [7, 9, 12];
  return '#' + rgb.map((v, i) => Math.round(base[i] + (v - base[i]) * 0.03).toString(16).padStart(2, '0')).join('');
}

export function resolvedTheme() {
  const st = S();
  if (st.game.campaign.on) return 'dark';
  if (st.settings.theme === 'system') return mq && mq.matches ? 'light' : 'dark';
  return st.settings.theme;
}

export function applyTheme() {
  const st = S(), s = st.settings, root = document.documentElement;
  const campaign = !!st.game.campaign.on;
  root.dataset.theme = resolvedTheme();
  root.dataset.campaign = campaign ? 'on' : 'off';
  root.dataset.font = s.font;
  // The classic faces are the only thing fetched from a third party, and
  // only while that typeface is selected.
  const link = document.getElementById('hq-fonts');
  if (s.font === 'classic' && !link) {
    const l = document.createElement('link');
    l.id = 'hq-fonts'; l.rel = 'stylesheet'; l.href = CLASSIC_FONTS;
    document.head.appendChild(l);
  } else if (s.font !== 'classic' && link) link.remove();
  root.dataset.corners = s.corners;
  root.dataset.density = s.density;
  root.dataset.sidebar = s.sidebar;
  root.dataset.motion = s.reduceMotion ? 'off' : (s.motion || 'full');

  const accent = safeColor(s.accent, '#E0B25A');
  if (campaign) {                       // the stylesheet's campaign red must win
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
  } else {
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', onColor(accent));
  }

  // Background image. Floors on dim and glass are what guarantee legibility.
  const on = !!(s.bg.on && bgUrl);
  root.dataset.bg = on ? 'on' : 'off';
  root.style.setProperty('--bg-dim', String(clamp(s.bg.dim, 35, 95) / 100));
  root.style.setProperty('--bg-blur', clamp(s.bg.blur, 0, 30) + 'px');
  root.style.setProperty('--glass', clamp(s.bg.glass, 55, 100) + '%');
  const bg = document.getElementById('bg');
  if (bg) bg.style.backgroundImage = on ? `url("${bgUrl}")` : '';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = campaign ? '#0A0707' : root.dataset.theme === 'light' ? '#EEEDE8' : tintedBg(accent);
  document.title = st.profile.name || 'Dashboard';

  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify({
      theme: s.theme, campaign, font: s.font, corners: s.corners, density: s.density,
      sidebar: s.sidebar, accent, onAccent: onColor(accent)
    }));
  } catch { /* storage blocked: the only cost is a flash on next load */ }
}
if (mq) mq.addEventListener('change', () => applyTheme());

/* ── IndexedDB: one tiny key/value store for device-local assets ── */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hq-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBgImage() {
  try {
    const blob = await kv('readonly', s => s.get('bg'));
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = blob ? URL.createObjectURL(blob) : null;
  } catch { bgUrl = null; }
  applyTheme();
  return !!bgUrl;
}
export const hasBgImage = () => !!bgUrl;

/** The stored copy is as sharp as this screen can show, up to 4K. Anything
 *  finer is thrown away by the display, and a huge bitmap behind a blur
 *  makes scrolling stutter on a phone. */
function bgTargetPx() {
  const longest = Math.max(screen.width || 0, screen.height || 0) * (window.devicePixelRatio || 1);
  return Math.round(Math.min(3840, Math.max(2560, longest * 1.25)));
}
export async function setBgImage(file) {
  if (!file || !/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 150 * 1024 * 1024) throw new Error('That file is over 150 MB. Export a smaller copy and try again.');
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error('This device could not open that image. It may be too large for its memory. Try a smaller copy.'); }
  const scale = Math.min(1, bgTargetPx() / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('This browser could not process that image.');
  await kv('readwrite', s => s.put(blob, 'bg'));
  await loadBgImage();
}
export async function clearBgImage() {
  try { await kv('readwrite', s => s.delete('bg')); } catch { /* nothing stored */ }
  await loadBgImage();
}
