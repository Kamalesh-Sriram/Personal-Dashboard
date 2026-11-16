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
export function duelDial({ you, shadow, pace, dayFrac, showShadow = true, rest = false, label = 'XP today', sub = '' }) {
  const cx = 150, cy = 150, A0 = 135, SW = 270;
  const scale = Math.max(shadow * 1.18, you * 1.06, 1);
  const ang = v => A0 + SW * clamp(v / scale, 0, 1);
  const N = 72, lit = Math.round(N * clamp(dayFrac, 0, 1));
  let ticks = '';
  for (let i = 0; i <= N; i++) {
    const a = A0 + SW * (i / N), major = i % 6 === 0;
    const [x0, y0] = polar(cx, cy, major ? 127 : 131, a), [x1, y1] = polar(cx, cy, 140, a);
    ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${i <= lit ? 'var(--accent)' : 'var(--card-3)'}" stroke-opacity="${i <= lit ? 0.7 : 1}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`;
  }
  const ahead = you >= pace;
  let shadowBits = '';
  if (showShadow && !rest) {
    const [nx0, ny0] = polar(cx, cy, 96, ang(shadow)), [nx1, ny1] = polar(cx, cy, 120, ang(shadow));
    shadowBits = `
      <path d="${arcPath(cx, cy, 91, A0, A0 + SW)}" stroke="var(--card-3)" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${pace > 0 ? `<path class="dial-pace" pathLength="1" d="${arcPath(cx, cy, 91, A0, ang(pace))}" stroke="var(--text-2)" stroke-width="3" fill="none" stroke-linecap="round"/>` : ''}
      <line x1="${nx0}" y1="${ny0}" x2="${nx1}" y2="${ny1}" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `<svg class="dial" viewBox="0 0 300 258" role="img" aria-label="${esc(`${you} XP today` + (showShadow ? `, rival at ${pace} now and ${shadow} by close` : ''))}">
    ${ticks}
    <path d="${arcPath(cx, cy, 108, A0, A0 + SW)}" stroke="var(--card-3)" stroke-width="13" fill="none" stroke-linecap="round"/>
    ${you > 0 ? `<path class="dial-xp" pathLength="1" d="${arcPath(cx, cy, 108, A0, ang(you))}" stroke="${rest ? 'var(--info)' : ahead || !showShadow ? 'var(--accent)' : 'var(--bad)'}" stroke-width="13" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 7px ${rest ? 'var(--info)' : ahead || !showShadow ? 'var(--accent-glow)' : 'var(--bad)'})"/>` : ''}
    ${shadowBits}
    <text x="150" y="116" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="1.2" fill="var(--text-3)" style="fill:var(--text-3);text-transform:uppercase">${esc(label)}</text>
    <text x="150" y="168" text-anchor="middle" font-size="58" font-weight="650" letter-spacing="-2.5" data-count="${you}">${you}</text>
    <text x="150" y="192" text-anchor="middle" font-size="12.5" style="fill:var(--text-2)">${esc(sub)}</text>
  </svg>`;
}

/**
 * 24-hour ring for Track. Midnight at the top, clockwise. Each session is
 * an arc in its activity's colour; the productive window is the faint band
 * behind; the hand is now. Arcs are buttons (data-act) for editing.
 */
export function dayRing({ sessions, win, nowMin = null, center = '', centerSub = '', h24 = true }) {
  const cx = 150, cy = 150, R = 112, toA = m => -90 + (m / 1440) * 360;
  let marks = '';
  for (let h = 0; h < 24; h++) {
    const a = toA(h * 60), major = h % 6 === 0;
    const [x0, y0] = polar(cx, cy, major ? 130 : 133, a), [x1, y1] = polar(cx, cy, 138, a);
    marks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--line-2)" stroke-width="${major ? 1.8 : 1}" stroke-linecap="round"/>`;
    if (major) {
      const [tx, ty] = polar(cx, cy, 149, a);
      const lbl = h24 ? String(h).padStart(2, '0') : (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p');
      marks += `<text x="${tx}" y="${ty + 3.5}" text-anchor="middle" font-size="10" style="fill:var(--text-3)">${lbl}</text>`;
    }
  }
  const arcs = sessions.map(s => {
    const a0 = toA(s.startMin), a1 = toA(Math.max(s.endMin, s.startMin + 2));
    return `<path d="${arcPath(cx, cy, R, a0, a1)}" stroke="${safeColor(s.color)}" stroke-opacity="${s.opacity}" stroke-width="22" fill="none"
      ${s.act ? `data-act="${s.act}" data-id="${esc(s.id)}" data-start="${s.start}" style="cursor:pointer"` : ''}><title>${esc(s.title)}</title></path>`;
  }).join('');
  let hand = '';
  if (nowMin !== null) {
    const [x0, y0] = polar(cx, cy, 94, toA(nowMin)), [x1, y1] = polar(cx, cy, 130, toA(nowMin));
    hand = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `<svg class="dial" viewBox="-8 -8 316 316" role="img" aria-label="24-hour view of tracked time">
    <circle cx="${cx}" cy="${cy}" r="${R}" stroke="var(--card-2)" stroke-width="22" fill="none"/>
    <path d="${arcPath(cx, cy, R, toA(win.start), toA(win.end))}" stroke="var(--card-3)" stroke-width="22" fill="none"/>
    ${marks}${arcs}${hand}
    <text x="150" y="150" text-anchor="middle" font-size="34" font-weight="650" letter-spacing="-1.2">${esc(center)}</text>
    <text x="150" y="172" text-anchor="middle" font-size="11.5" style="fill:var(--text-2)">${esc(centerSub)}</text>
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
