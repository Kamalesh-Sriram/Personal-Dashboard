/* Small, dependency-free helpers shared by every module. */

export const pad = n => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. All day keys in the app use this. */
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => new Date(s + 'T00:00:00');

/* When does a day begin?  Normally at midnight. If the working hours run
   past midnight (07:00 to 01:00, say) the day has to as well, or the last
   hour of work would be scored as tomorrow's. The day then turns over
   halfway between the end of one window and the start of the next (04:00
   in that example), and until then it is still "today".

   Everything that maps a moment to a day goes through the helpers below,
   so there is exactly one definition. The store keeps the offset in step
   with the settings. */
let _off = 0;                                   // ms after midnight at which the day turns over
export const setDayOffset = min => { _off = clamp(Math.round(min) || 0, 0, 12 * 60) * 60000; };
export const dayOffsetMin = () => _off / 60000;
/** Minutes after midnight at which the day should turn over for these hours. */
export function dayOffsetFor(win) {
  const s = hmToMin(win && win.start), e = hmToMin(win && win.end);
  if (e === 0 || e >= s) return 0;                               // ends the same calendar day it starts
  return Math.max(e, Math.floor((e + (s - e) / 2) / 30) * 30);
}
/** The day a moment belongs to, as YYYY-MM-DD. */
export const dateOf = ts => ymd(new Date(ts - _off));
export const today = () => dateOf(Date.now());
/** The first and one-past-the-last instant of a day. */
export const dayStartTs = date => { const d = parseYmd(date); d.setMinutes(_off / 60000); return d.getTime(); };
export const dayEndTs = date => dayStartTs(addDays(date, 1));
/** Minutes since the midnight that opened `date`. After midnight on a late
 *  day this runs past 1440: 00:30 is minute 1470 of the day before. */
export function minOfDay(ts, date) {
  const d = new Date(ts), m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, cal = ymd(d);
  return cal === date ? m : m + 1440 * daysBetween(date, cal);
}
/** A clock time as minutes into the current kind of day ("00:30" on a late day is 1470). */
export const clockToDayMin = hm => { const m = hmToMin(hm); return m < _off / 60000 ? m + 1440 : m; };

/** Whole calendar days, never milliseconds: adding 86,400,000 ms across a
 *  daylight-saving boundary lands an hour short and rolls the date back. */
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sum = arr => arr.reduce((a, b) => a + b, 0);
export const avg = arr => (arr.length ? sum(arr) / arr.length : 0);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const slug = (prefix, name) =>
  prefix + '-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Escape text for insertion into HTML. Every piece of user content goes
 *  through this before it touches innerHTML. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Only allow real hex colours into style attributes. */
export const safeColor = (c, fallback = '#888888') => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fallback);

export function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
/** A running clock: mm:ss for the first hour, hh:mm:ss after it. */
export function fmtTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
export function fmtMins(m) {
  if (m === null || m === undefined) return '-';
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}
export function fmtClock(ts, h24 = true) {
  const d = new Date(ts);
  if (h24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`;
}
export function fmtMinOfDay(mins, h24 = true) {
  const hh = Math.floor(mins / 60) % 24, mm = Math.round(mins % 60);
  if (h24) return `${pad(hh)}:${pad(mm)}`;
  return `${hh % 12 || 12}:${pad(mm)}${hh < 12 ? 'am' : 'pm'}`;
}
export const hmToMin = hm => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export function fmtDate(s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return parseYmd(s).toLocaleDateString(undefined, opts);
}

/* ── colour ── */
export function hexToRgb(hex) {
  const n = parseInt(safeColor(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Black or white, whichever reads better on top of `hex`. */
export const onColor = hex => (luminance(hex) > 0.42 ? '#141414' : '#FFFFFF');

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const deepClone = o => JSON.parse(JSON.stringify(o));
