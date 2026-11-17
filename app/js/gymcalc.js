/* ══════════════════════════════════════════════════════════════════════
   GYM: the arithmetic. No DOM and no storage, so it runs under node --test.

   A workout, however it arrived (Hevy sync or a file), is kept as

     { id, title, start, end,                         // ms since 1970
       ex: [{ name, tid, sets: [{ t, kg, reps, sec, m, rpe }] }] }

   `t` is the set type: normal | warmup | dropset | failure.
   ══════════════════════════════════════════════════════════════════════ */
import { parseCsv, toObjects, parseAmount } from './csv.js';

const LB = 0.45359237;
export const round = (v, step = 0.5) => Math.round(v / step) * step;
export const fmtKg = v => (v == null ? '-' : String(Math.round(v * 10) / 10).replace(/\.0$/, ''));

/** Estimated one-rep max (Epley). Past 12 reps the estimate stops meaning much. */
export const e1rm = (kg, reps) => (!(kg > 0) || !(reps > 0) ? 0 : reps === 1 ? kg : kg * (1 + Math.min(reps, 12) / 30));
const working = sets => sets.filter(s => s.t !== 'warmup');
export const volumeOf = w => w.ex.reduce((n, x) => n + working(x.sets).reduce((k, s) => k + (s.kg || 0) * (s.reps || 0), 0), 0);
export const setsOf = w => w.ex.reduce((n, x) => n + working(x.sets).length, 0);

/* ── imports ── */
/** One workout from the Hevy API, reduced to what is used. */
export function fromHevy(w) {
  return {
    id: String(w.id), title: w.title || 'Workout', start: Date.parse(w.start_time) || 0, end: Date.parse(w.end_time) || 0,
    ex: (w.exercises || []).map(x => ({
      name: x.title || 'Exercise', tid: x.exercise_template_id || '',
      sets: (x.sets || []).map(s => ({ t: s.type || 'normal', kg: s.weight_kg ?? null, reps: s.reps ?? null, sec: s.duration_seconds ?? null, m: s.distance_meters ?? null, rpe: s.rpe ?? null }))
    }))
  };
}
const dur = s => {                                   // "1h 5m", "45m", "3600", "01:05:00" → seconds
  const v = String(s || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return +v;
  if (/^\d+:\d+(:\d+)?$/.test(v)) { const p = v.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  const h = /(\d+)\s*h/.exec(v), m = /(\d+)\s*m/.exec(v), sc = /(\d+)\s*s/.exec(v);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (sc ? +sc[1] : 0);
};
const when = s => { const t = Date.parse(String(s).replace(/^(\d{4}-\d\d-\d\d) /, '$1T')); return isFinite(t) ? t : 0; };

/** A Hevy or Strong export file → workouts. Throws if it is neither. */
export function fromCsv(text) {
  const { header, items } = toObjects(parseCsv(text));
  const has = k => header.includes(k);
  const byKey = new Map();
  const add = (key, base, exName, set) => {
    if (!byKey.has(key)) byKey.set(key, { ...base, ex: [] });
    const w = byKey.get(key);
    let x = w.ex[w.ex.length - 1];
    if (!x || x.name !== exName) { x = { name: exName, tid: '', sets: [] }; w.ex.push(x); }
    x.sets.push(set);
  };
  let source;
  if (has('exercise_title') && has('start_time')) {                        // Hevy
    source = 'Hevy';
    const lbs = has('weight_lbs') && !has('weight_kg'), miles = has('distance_miles');
    items.forEach(r => {
      const start = when(r.start_time); if (!start || !r.exercise_title) return;
      const kg = parseAmount(lbs ? r.weight_lbs : r.weight_kg), dist = parseAmount(miles ? r.distance_miles : r.distance_km);
      add(r.title + '|' + r.start_time, { id: 'csv-' + start, title: r.title || 'Workout', start, end: when(r.end_time) || start },
        r.exercise_title, { t: (r.set_type || 'normal').toLowerCase(), kg: kg == null ? null : lbs ? kg * LB : kg, reps: parseAmount(r.reps), sec: parseAmount(r.duration_seconds), m: dist == null ? null : dist * (miles ? 1609.344 : 1000), rpe: parseAmount(r.rpe) });
    });
  } else if (has('exercise name') && has('date')) {                        // Strong
    source = 'Strong';
    const unitCol = header.find(h => h === 'weight unit');
    items.forEach(r => {
      const start = when(r.date); if (!start || !r['exercise name']) return;
      const lbs = unitCol ? /lb/i.test(r[unitCol]) : false, kg = parseAmount(r.weight);
      const order = String(r['set order'] || '').toUpperCase();
      add((r['workout name'] || '') + '|' + r.date, { id: 'csv-' + start, title: r['workout name'] || 'Workout', start, end: start + dur(r.duration || r['workout duration']) * 1000 },
        r['exercise name'], { t: order === 'W' ? 'warmup' : order === 'D' ? 'dropset' : order === 'F' ? 'failure' : 'normal', kg: kg == null ? null : lbs ? kg * LB : kg, reps: parseAmount(r.reps), sec: parseAmount(r.seconds), m: parseAmount(r.distance), rpe: parseAmount(r.rpe) });
    });
  } else throw new Error('That file is not a Hevy or Strong export. In Hevy: Profile > Settings > Export & Import Data > Export Workouts.');
  const workouts = [...byKey.values()].filter(w => w.ex.length).sort((a, b) => a.start - b.start);
  if (!workouts.length) throw new Error('No workouts were found in that file.');
  return { source, workouts };
}

/* ── per-exercise history ── */
const keyOf = name => String(name).trim().toLowerCase();
/** Every exercise with its sessions, oldest first. */
export function exercises(workouts) {
  const map = new Map();
  [...workouts].sort((a, b) => a.start - b.start).forEach(w => w.ex.forEach(x => {
    const sets = working(x.sets).filter(s => (s.reps || 0) > 0 || (s.sec || 0) > 0);
    if (!sets.length) return;
    const k = keyOf(x.name);
    if (!map.has(k)) map.set(k, { key: k, name: x.name, tid: x.tid, sessions: [], best: 0, bestAt: 0, prs: [] });
    const e = map.get(k);
    const est = Math.max(0, ...sets.map(s => e1rm(s.kg, s.reps)));
    const top = sets.reduce((b, s) => ((s.kg || 0) > (b.kg || 0) || ((s.kg || 0) === (b.kg || 0) && (s.reps || 0) > (b.reps || 0)) ? s : b), sets[0]);
    const session = { ts: w.start, wid: w.id, sets, e1rm: est, top, vol: sets.reduce((n, s) => n + (s.kg || 0) * (s.reps || 0), 0), reps: sets.reduce((n, s) => n + (s.reps || 0), 0) };
    if (est > e.best + 0.01) { if (e.sessions.length) e.prs.push({ ts: w.start, e1rm: est, was: e.best, kg: top.kg, reps: top.reps }); e.best = est; e.bestAt = w.start; }
    if (x.tid && !e.tid) e.tid = x.tid;
    e.sessions.push(session);
  }));
  return [...map.values()];
}

/** What to try next time, from the sessions of one exercise.
 *
 *  Double progression: stay at a weight until every set reaches your rep
 *  ceiling, then add weight and start again from lower reps. The ceiling is the
 *  top of the rep range you started that weight in. Three flat sessions: back off. */
export function suggest(sessions) {
  const last = sessions[sessions.length - 1];
  if (!last || !last.sets.length) return null;
  const recent = sessions.slice(-5);
  const maxKg = se => Math.max(0, ...se.sets.map(s => s.kg || 0));
  const top = maxKg(last);
  if (!(top > 0)) {
    const reps = Math.max(0, ...last.sets.map(s => s.reps || 0));
    if (reps) return { kind: 'reps', kg: 0, reps: reps + 1, text: `Aim for ${reps + 1} reps on your first set, one more than last time.` };
    const sec = Math.max(0, ...last.sets.map(s => s.sec || 0));
    return sec ? { kind: 'time', kg: 0, reps: 0, text: `Hold or go ${Math.round(sec * 1.05)}s, a little longer than last time.` } : null;
  }
  const near = se => se.sets.filter(s => (s.kg || 0) >= maxKg(se) * 0.95 && (s.reps || 0) > 0);
  const atTop = near(last);
  if (!atTop.length) return null;
  const worst = Math.min(...atTop.map(s => s.reps));
  // The ceiling comes from where you started at this weight: the reps you
  // managed the first session you used it decide which rep range you are in.
  let first = last;
  for (let i = sessions.length - 1; i >= 0 && Math.abs(maxKg(sessions[i]) - top) < 0.01; i--) first = sessions[i];
  const base = Math.min(...near(first).map(s => s.reps));
  const ceiling = base <= 3 ? 5 : base <= 6 ? 8 : base <= 9 ? 10 : base <= 12 ? 15 : 20;
  const step = top >= 20 ? 2.5 : 1;
  if (worst >= ceiling) {
    const kg = top + step;
    return { kind: 'add', kg, reps: Math.max(3, ceiling - 4), text: `Go up to ${fmtKg(kg)} kg. You got ${worst} or more on every set at ${fmtKg(top)} kg.` };
  }
  const same = recent.filter(se => Math.abs(maxKg(se) - top) < 0.01).slice(-3);
  const total = se => near(se).reduce((n, s) => n + s.reps, 0);
  if (same.length === 3 && sessions.length >= 3 && recent.slice(-3).every(se => same.includes(se)) && total(same[2]) <= total(same[0])) {
    const kg = round(top * 0.9, step === 1 ? 1 : 2.5);
    return { kind: 'deload', kg, reps: ceiling, text: `Three sessions at ${fmtKg(top)} kg without progress. Drop to ${fmtKg(kg)} kg for a week, then build back up.` };
  }
  return { kind: 'reps', kg: top, reps: worst + 1, text: `Stay at ${fmtKg(top)} kg and get ${worst + 1} on every set. ${ceiling} on all sets earns more weight.` };
}

/* ── overview ── */
const DAY = 86400000;
const weekStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };   // Monday
/** The last `n` weeks, oldest first: { start, count, vol }. */
export function weeks(workouts, n = 12, now = Date.now()) {
  const cur = weekStart(now), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(cur); d.setDate(d.getDate() - i * 7); out.push({ start: d.getTime(), count: 0, vol: 0 }); }
  const idx = new Map(out.map((w, i) => [w.start, i]));
  workouts.forEach(w => { const i = idx.get(weekStart(w.start)); if (i != null) { out[i].count++; out[i].vol += volumeOf(w); } });
  return out;
}
export function summary(workouts, now = Date.now()) {
  const within = (a, b) => workouts.filter(w => w.start >= a && w.start < b);
  const last30 = within(now - 30 * DAY, now + DAY), prev30 = within(now - 60 * DAY, now - 30 * DAY);
  const wk = weeks(workouts, 104, now);
  let streak = 0;
  for (let i = wk.length - 1; i >= 0; i--) { if (wk[i].count) streak++; else if (i === wk.length - 1) continue; else break; }   // this week may not have started yet
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const records = exercises(workouts).reduce((n, e) => n + e.prs.filter(p => p.ts >= monthStart.getTime()).length, 0);
  const vol = a => a.reduce((n, w) => n + volumeOf(w), 0);
  return { thisWeek: wk[wk.length - 1].count, count30: last30.length, vol30: vol(last30), volPrev: vol(prev30), records, weekStreak: streak, total: workouts.length };
}
/** Exercises worth a suggestion: done at least twice, and recently. */
export function upNext(workouts, limit = 6, now = Date.now()) {
  return exercises(workouts)
    .filter(e => e.sessions.length >= 2 && now - e.sessions[e.sessions.length - 1].ts < 35 * DAY)
    .map(e => ({ e, recent: e.sessions.filter(s => now - s.ts < 56 * DAY).length, s: suggest(e.sessions) }))
    .filter(x => x.s)
    .sort((a, b) => b.recent - a.recent || b.e.sessions[b.e.sessions.length - 1].ts - a.e.sessions[a.e.sessions.length - 1].ts)
    .slice(0, limit);
}

/* ── openGym backups ── */
const human = id => String(id || 'Exercise').replace(/^(ex|custom|c)[-_:]/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, c => c.toUpperCase()) || 'Exercise';
/** openGym's "Export backup (JSON)" → workouts. The app stores the whole
 *  profile as one document: workouts with entries (an exercise id and its
 *  sets), plus the names of exercises you made yourself. */
export function fromOpenGym(doc) {
  const st = (doc && (doc.state || doc.data)) || doc || {};
  const list = Array.isArray(st.workouts) ? st.workouts : null;
  if (!list) throw new Error('No workouts were found in that backup.');
  const lb = st.unit === 'lb';
  const names = new Map();
  (st.customEx || []).forEach(x => { if (x && x.id) names.set(String(x.id), x.n || x.name); });
  (st.routines || []).forEach(r => (r.ex || []).forEach(x => { if (x && x.id && (x.n || x.name)) names.set(String(x.id), x.n || x.name); }));
  const routine = new Map((st.routines || []).map(r => [String(r.id), r.name]));
  const workouts = list.map((w, i) => {
    const start = Number(w.start) || (w.d ? Date.parse(w.d + 'T12:00:00') : 0);
    return {
      id: 'og-' + (w.id || start || i), title: w.name || routine.get(String(w.routineId)) || 'Workout', start, end: Number(w.end) || start,
      ex: (w.entries || []).map(e => ({
        name: e.n || e.name || names.get(String(e.id)) || (/^\d+$/.test(String(e.id)) ? 'Exercise ' + e.id : human(e.id)), tid: String(e.id || ''),
        sets: (e.sets || []).filter(s => s && s.done !== false && (s.r > 0 || s.w > 0 || s.t > 0 || s.sec > 0)).map(s => ({
          t: s.warm || s.warmup || s.type === 'warmup' ? 'warmup' : 'normal', kg: s.w == null ? null : lb ? s.w * LB : s.w, reps: s.r ?? null,
          sec: s.sec ?? s.t ?? null, m: s.dist ?? null, rpe: s.rpe ?? null }))
      })).filter(x => x.sets.length)
    };
  }).filter(w => w.start && w.ex.length).sort((a, b) => a.start - b.start);
  if (!workouts.length) throw new Error('That backup has no finished workouts in it.');
  return { source: 'openGym', workouts };
}
/** Any file the Gym tab accepts: an openGym backup (JSON), or a Hevy or Strong export (CSV). */
export function fromFile(text) {
  const t = String(text || '').replace(/^﻿/, '').trimStart();
  if (t[0] === '{' || t[0] === '[') {
    let doc; try { doc = JSON.parse(t); } catch { throw new Error('That JSON file could not be read.'); }
    return fromOpenGym(doc);
  }
  return fromCsv(text);
}

/* ── the coach: which session comes next in your split, and what to do in it ── */
const norm = s => String(s || '').trim().toLowerCase();
/** A first guess at the split from the titles of recent workouts: the
 *  shortest repeating pattern, or failing that each title once. */
export function guessSplit(workouts) {
  const titles = [...workouts].sort((a, b) => a.start - b.start).slice(-24).map(w => w.title);
  if (titles.length < 2) return titles;
  for (let p = 2; p <= 8 && p * 2 <= titles.length; p++) {
    let ok = 0, n = 0;
    for (let i = titles.length - 1; i - p >= 0 && n < p * 2; i--, n++) if (norm(titles[i]) === norm(titles[i - p])) ok++;
    if (n >= p && ok / n >= 0.85) return titles.slice(-p);
  }
  const seen = [];
  titles.forEach(t => { if (!seen.some(s => norm(s) === norm(t))) seen.push(t); });
  return seen.slice(-7);
}
/** Where you are in the split: line the cycle up with your latest workouts
 *  (the longest run that matches, counting back from the last one) and take
 *  the slot after it. Then build that session from the last time you did it. */
export function nextWorkout(workouts, split) {
  const hist = [...workouts].sort((a, b) => a.start - b.start), n = (split || []).length;
  if (!n || !hist.length) return null;
  let best = -1, bestRun = -1;
  for (let k = 0; k < n; k++) {
    let run = 0;
    for (let i = 0; i < Math.min(hist.length, n * 2); i++) {
      if (norm(hist[hist.length - 1 - i].title) === norm(split[((k - i) % n + n) % n])) run++; else break;
    }
    if (run > bestRun) { bestRun = run; best = k; }
  }
  const slot = bestRun > 0 ? (best + 1) % n : 0, title = split[slot];
  // the same slot one cycle ago, if that workout carries this title; otherwise the latest with the title
  const same = hist.filter(w => norm(w.title) === norm(title));
  const cycleAgo = hist[hist.length - n];
  const template = cycleAgo && norm(cycleAgo.title) === norm(title) ? cycleAgo : same[same.length - 1] || null;
  const all = new Map(exercises(hist).map(e => [e.key, e]));
  const items = !template ? [] : template.ex.map(x => {
    const sets = x.sets.filter(s => s.t !== 'warmup' && ((s.reps || 0) > 0 || (s.sec || 0) > 0));
    if (!sets.length) return null;
    const e = all.get(String(x.name).trim().toLowerCase()), s = e ? suggest(e.sessions) : null;
    const lastTop = sets.reduce((b, v) => ((v.kg || 0) > (b.kg || 0) ? v : b), sets[0]);
    return { name: x.name, key: e ? e.key : '', sets: sets.length, kind: s ? s.kind : 'same',
      kg: s ? s.kg : lastTop.kg || 0, reps: s ? s.reps : lastTop.reps || 0, sec: s && s.kind === 'time' ? Math.round((lastTop.sec || 0) * 1.05) : 0,
      last: lastTop, text: s ? s.text : 'Same as last time.' };
  }).filter(Boolean);
  return { title, slot, of: n, known: bestRun > 0, template, lastDone: same.length ? same[same.length - 1].start : 0, items };
}
