/* Hand-drawn SVG charts. No chart library: these three shapes are all the
   dashboard needs, and drawing them directly keeps them themeable through
   the same CSS variables as everything else. */
import { esc, clamp, safeColor } from './util.js';

const polar = (cx, cy, r, deg) => { const a = deg * Math.PI / 180; return [+(cx + r * Math.cos(a)).toFixed(2), +(cy + r * Math.sin(a)).toFixed(2)]; };
export function arcPath(cx, cy, r, a0, a1) {
  if (a1 - a0 >= 359.99) a1 = a0 + 359.99;
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/**
 * The Day Dial: the dashboard's signature. A 270° gauge:
 *   outer ticks   the productive window; lit ticks are time already spent
 *   thick arc     your XP today
 *   thin arc      where the rival's pace is right now
 *   notch         the rival's bar for the whole day
 */
export function duelDial({ you, shadow, pace, dayFrac, showShadow = true, rest = false, label = 'XP today', sub = '', dayNote = '', dayTitle = '' }) {
  const cx = 150, cy = 150, A0 = 135, SW = 270;
  const scale = Math.max(shadow * 1.18, you * 1.06, 1);
  const ang = v => A0 + SW * clamp(v / scale, 0, 1);
  const N = 72, lit = Math.round(N * clamp(dayFrac, 0, 1));
  let ticks = '';
  for (let i = 0; i <= N; i++) {
    const a = A0 + SW * (i / N), major = i % 6 === 0;
    const [x0, y0] = polar(cx, cy, major ? 127 : 131, a), [x1, y1] = polar(cx, cy, 140, a);
    ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${i <= lit ? 'var(--dial-day, var(--accent))' : 'var(--card-3)'}" stroke-opacity="${i <= lit ? 0.7 : 1}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`;
  }
  const ahead = you >= pace;
  let shadowBits = '';
  if (showShadow && !rest) {
    const [nx0, ny0] = polar(cx, cy, 96, ang(shadow)), [nx1, ny1] = polar(cx, cy, 120, ang(shadow));
    shadowBits = `
      <path d="${arcPath(cx, cy, 91, A0, A0 + SW)}" stroke="var(--card-3)" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${pace > 0 ? `<path class="dial-pace" pathLength="1" d="${arcPath(cx, cy, 91, A0, ang(pace))}" stroke="var(--dial-rival, var(--text-2))" stroke-width="3" fill="none" stroke-linecap="round"/>` : ''}
      <line x1="${nx0}" y1="${ny0}" x2="${nx1}" y2="${ny1}" stroke="var(--dial-rival, var(--text))" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `<svg class="dial" viewBox="0 0 300 258" role="img" aria-label="${esc(`${you} XP today` + (showShadow ? `, rival at ${pace} now and ${shadow} by close` : ''))}">
    ${ticks}
    <path d="${arcPath(cx, cy, 108, A0, A0 + SW)}" stroke="var(--card-3)" stroke-width="13" fill="none" stroke-linecap="round"/>
    ${you > 0 ? `<path class="dial-xp" pathLength="1" d="${arcPath(cx, cy, 108, A0, ang(you))}" stroke="${rest ? 'var(--info)' : `var(--dial-xp, ${ahead || !showShadow ? 'var(--accent)' : 'var(--bad)'})`}" stroke-width="13" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 7px ${rest ? 'var(--info)' : `var(--dial-xp, ${ahead || !showShadow ? 'var(--accent-glow)' : 'var(--bad)'})`})"/>` : ''}
    ${shadowBits}
    <text x="150" y="116" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="1.2" fill="var(--text-3)" style="fill:var(--text-3);text-transform:uppercase">${esc(label)}</text>
    <text x="150" y="168" text-anchor="middle" font-size="58" font-weight="650" letter-spacing="-2.5" data-count="${you}">${you}</text>
    <text x="150" y="192" text-anchor="middle" font-size="12.5" style="fill:var(--text-2)">${esc(sub)}</text>
  </svg>`;
}

/** Degrees a round stroke cap reaches past the end of an arc. */
const capDeg = (sw, r) => (sw / 2) / r * 180 / Math.PI;
/** Trim an arc so its round caps land inside [a0, a1] with `gap` degrees
 *  spare; one too short for that becomes a dot at its middle. */
function capped(a0, a1, cap, gap) {
  let b0 = a0 + cap + gap / 2, b1 = a1 - cap - gap / 2;
  if (b1 - b0 < 0.02) { const m = (a0 + a1) / 2; b0 = m - 0.01; b1 = m + 0.01; }
  return [b0, b1];
}
/** Draw-in timing for parts laid end to end: each starts as the one before
 *  it is nearly done, so the ring grows from one point, piece by piece. */
function drawTimes(sweeps, total = 1100) {
  let t = 0;
  return sweeps.map(sw => { const dur = Math.max(150, Math.min(520, sw / 360 * total)); const d = t; t += dur * 0.82; return { d: Math.round(d), dur: Math.round(dur) }; });
}

/** A band of a ring from angle a0 to a1 (degrees) between radii ri and ro,
 *  with its four corners rounded. Unlike a round stroke cap this stays
 *  exactly inside its angles, so a 20-minute block on a clock face still
 *  covers 20 minutes. */
export function sectorPath(cx, cy, ro, ri, a0, a1, rmax = 4.5) {
  const D = Math.PI / 180, span = Math.max(0.05, a1 - a0);
  const half = Math.sin(Math.min(span * D / 2, Math.PI / 2));
  const rc = Math.max(0, Math.min(rmax, (ro - ri) / 2 - 0.01, ri * half / (1 - half) * 0.95, ro * half / (1 + half) * 0.95));
  const to = Math.asin(rc / (ro - rc)) / D, ti = Math.asin(rc / (ri + rc)) / D;
  const eo = Math.sqrt((ro - rc) ** 2 - rc * rc), ei = Math.sqrt((ri + rc) ** 2 - rc * rc);
  const P = (r, a) => polar(cx, cy, r, a).join(' ');
  const lo = span - 2 * to > 180 ? 1 : 0, li = span - 2 * ti > 180 ? 1 : 0;
  return `M${P(eo, a0)}A${rc} ${rc} 0 0 1 ${P(ro, a0 + to)}A${ro} ${ro} 0 ${lo} 1 ${P(ro, a1 - to)}A${rc} ${rc} 0 0 1 ${P(eo, a1)}`
    + `L${P(ei, a1)}A${rc} ${rc} 0 0 1 ${P(ri, a1 - ti)}A${ri} ${ri} 0 ${li} 0 ${P(ri, a0 + ti)}A${rc} ${rc} 0 0 1 ${P(ei, a0)}Z`;
}

/**
 * 24-hour ring for Track. Midnight at the top, clockwise. Each session is a
 * band with softly rounded corners in its activity's colour, glowing a
 * little; the productive window is the brighter band behind; the hand is
 * now. Blocks draw in from midnight, one after the other, and grow outward
 * when pointed at or picked. The figure in the middle is HTML laid over the
 * ring (see track.js), so pointing at a block can name it there.
 */
export function dayRing({ sessions, win, nowMin = null, h24 = true, sel = null }) {
  const cx = 150, cy = 150, R = 112, SW = 20, ro = R + SW / 2, ri = R - SW / 2, toA = m => -90 + (m / 1440) * 360;
  let marks = '';
  for (let h = 0; h < 24; h++) {
    const a = toA(h * 60), major = h % 6 === 0;
    const [x0, y0] = polar(cx, cy, major ? 130 : 133, a), [x1, y1] = polar(cx, cy, 137, a);
    marks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--line-2)" stroke-width="${major ? 1.8 : 1}" stroke-linecap="round" opacity="${major ? 1 : .7}"/>`;
    if (major) {
      const [tx, ty] = polar(cx, cy, 149, a);
      const lbl = h24 ? String(h).padStart(2, '0') : (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p');
      marks += `<text x="${tx}" y="${ty + 3.5}" text-anchor="middle" font-size="10" font-weight="600" style="fill:var(--text-3)">${lbl}</text>`;
    }
  }
  const times = drawTimes(sessions.map(s => (Math.max(s.endMin, s.startMin + 2) - s.startMin) / 4), 1300);
  let masks = '';
  const arcs = sessions.map((s, i) => {
    let a0 = toA(s.startMin), a1 = toA(Math.max(s.endMin, s.startMin + 2));
    if (a1 - a0 > 1.2) { a0 += 0.3; a1 -= 0.3; }                     // a hair of space between blocks that touch
    const c = safeColor(s.color), id = `rgm${i}`;
    masks += `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="340" height="340"><path class="ring-draw" pathLength="1" d="${arcPath(cx, cy, R, a0 - 0.5, a1 + 0.5)}" stroke="#fff" stroke-width="${SW + 16}" fill="none" style="--d:${times[i].d}ms;--t:${times[i].dur}ms"/></mask>`;
    return `<g class="ring-seg ${sel != null && String(sel) === String(s.start) ? 'on' : ''}" style="--i:${i};--o:${s.opacity};color:${c}" stroke="${c}"
      data-seg="${i}" data-id="${esc(s.id)}" data-start="${s.start}" data-live="${s.live ? 1 : ''}" data-name="${esc(s.name)}" data-range="${esc(s.range)}" data-dur="${esc(s.dur)}"
      tabindex="0" role="button" aria-label="${esc(s.title)}"><path d="${sectorPath(cx, cy, ro, ri, a0, a1)}" mask="url(#${id})"/></g>`;
  }).join('');
  let hand = '';
  if (nowMin !== null) {
    const a = toA(nowMin), [x0, y0] = polar(cx, cy, ri - 9, a), [x1, y1] = polar(cx, cy, ro + 4, a);
    hand = `<g class="ring-hand"><line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--text)" stroke-width="2" stroke-linecap="round"/><circle cx="${x0}" cy="${y0}" r="3" fill="var(--text)"/></g>`;
  }
  return `<svg class="dial ring24" viewBox="-8 -8 316 316" role="img" aria-label="24-hour view of tracked time">
    <defs>${masks}</defs>
    <circle cx="${cx}" cy="${cy}" r="${R}" stroke="var(--card-2)" stroke-width="${SW}" fill="none"/>
    <path d="${arcPath(cx, cy, R, toA(win.start), toA(win.end))}" stroke="var(--card-3)" stroke-width="${SW}" fill="none"/>
    <circle cx="${cx}" cy="${cy}" r="${ri - 14}" stroke="var(--line)" stroke-width="1" fill="none"/>
    ${marks}<g class="ring-segs">${arcs}</g>${hand}
  </svg>`;
}

/** A line with a soft fill under it, for a value over time.
 *  points: [{ x, y, t }] where t is the hover title. */
export function lineChart(points, { color = 'var(--accent)' } = {}) {
  if (points.length < 2) return '<div class="empty" style="padding:14px">A chart appears after two sessions.</div>';
  const W = 600, H = 150, px = 10, py = 12;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = x => px + (W - 2 * px) * (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0));
  const Y = y => H - py - (H - 2 * py) * (y1 === y0 ? 0.5 : (y - y0) / (y1 - y0));
  const d = points.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('');
  const best = points.reduce((b, p) => (p.y > b.y ? p : b), points[0]);
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
    <path d="${d}L${X(x1).toFixed(1)} ${H}L${X(x0).toFixed(1)} ${H}Z" fill="${color}" fill-opacity=".1"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p === best ? 4.5 : 2.6}" fill="${p === best ? 'var(--good)' : color}"><title>${esc(p.t || '')}</title></circle>`).join('')}
  </svg>`;
}
/** A bare trend line, small enough to sit in a list row. */
export function sparkLine(values, { color = 'var(--accent)' } = {}) {
  const v = values.filter(x => isFinite(x));
  if (v.length < 2) return '';
  const W = 84, H = 26, lo = Math.min(...v), hi = Math.max(...v);
  const d = v.map((y, i) => (i ? 'L' : 'M') + (2 + (W - 4) * i / (v.length - 1)).toFixed(1) + ' ' + (H - 3 - (H - 6) * (hi === lo ? 0.5 : (y - lo) / (hi - lo))).toFixed(1)).join('');
  const up = v[v.length - 1] >= v[0];
  return `<svg class="spark-line" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? 'var(--good)' : color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
/** Stacked horizontal share bar: [{ label, value, color }]. */
export function shareBar(parts) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
  return `<div class="share">${parts.filter(p => p.value > 0).map(p => `<i style="width:${(p.value / total * 100).toFixed(2)}%;background:${safeColor(p.color)}" title="${esc(p.label)}"></i>`).join('')}</div>`;
}

/** Sweeps for a ring of rounded parts. Every part gets at least `min`
 *  degrees, so a small one stays a short pill instead of vanishing into a
 *  dot; the rest share what is left in proportion. */
function ringSweeps(values, min) {
  const n = values.length, total = values.reduce((a, v) => a + v, 0) || 1;
  if (n * min >= 360) return values.map(() => 360 / n);
  let small = values.map(() => false), sw = values.map(v => v / total * 360);
  for (let k = 0; k < 6; k++) {
    small = sw.map((x, i) => small[i] || x < min);
    const fixed = small.filter(Boolean).length * min, big = values.reduce((a, v, i) => a + (small[i] ? 0 : v), 0) || 1;
    sw = values.map((v, i) => (small[i] ? min : v / big * (360 - fixed)));
  }
  return sw;
}
/** A donut chart. parts: [{ id, label, value, color }]. Each slice is its
 *  own rounded, glowing arc, so it can grow on hover and be pressed. `on`
 *  lists the chosen slices. With `draw`, the ring grows in from the top,
 *  one slice after the next. */
export function donut(parts, { on = [], act = '', draw = false, label = 'Spending by category' } = {}) {
  const list = parts.filter(p => p.value > 0);
  const cx = 120, cy = 120, r = 86, SW = 20, cap = capDeg(SW, r), gap = list.length > 1 ? 3.4 : 0;
  const sweeps = list.length > 1 ? ringSweeps(list.map(p => p.value), 2 * cap + gap + 3) : [360];
  const times = drawTimes(sweeps);
  let a = -90;
  const segs = list.map((p, i) => {
    const [a0, a1] = list.length > 1 ? capped(a, a + sweeps[i], cap, gap) : [-90, 269.99];
    a += sweeps[i];
    const c = safeColor(p.color);
    return `<path class="seg ${on.includes(p.id) ? 'on' : ''}" pathLength="1" d="${arcPath(cx, cy, r, a0, a1)}" stroke="${c}" style="--i:${i};--d:${times[i].d}ms;--t:${times[i].dur}ms;color:${c}" data-seg="${i}" ${act ? `data-act="${act}" data-cat="${esc(p.id)}" role="button" tabindex="0" aria-pressed="${on.includes(p.id)}" aria-label="${esc(p.label)}"` : ''}><title>${esc(p.label)}</title></path>`;
  }).join('');
  return `<svg class="pie ${draw ? 'draw' : ''} ${on.length ? 'picking' : ''}" viewBox="0 0 240 240" role="img" aria-label="${esc(label)}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--card-3)" stroke-width="${SW}" opacity=".35"/>
    <circle cx="${cx}" cy="${cy}" r="${r - SW / 2 - 12}" fill="none" stroke="var(--line)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${r + SW / 2 + 9}" fill="none" stroke="var(--line)" stroke-width="1" opacity=".6"/>
    ${segs}</svg>`;
}
