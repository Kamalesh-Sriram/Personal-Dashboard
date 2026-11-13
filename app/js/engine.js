/* ══════════════════════════════════════════════════════════════════════
   ENGINE: every number on the dashboard is computed here.

   Nothing in this file touches the DOM, so it runs unchanged under
   `node --test` (see /tests).

   Design rule carried over from v4: store facts, derive scores. Sessions,
   habit check-offs and settled-day verdicts are stored; XP, streaks,
   reputation, rank and records are folded from them on demand. Derived
   numbers cannot drift between devices because there is nothing to drift.
   ══════════════════════════════════════════════════════════════════════ */
import { S, save, saveQuiet, touch, tombstone, onChange } from './store.js';
import { today, ymd, addDays, parseYmd, daysBetween, clamp, avg, hmToMin, uid, slug } from './util.js';

/* ── constants ── */
export const TIERS = {
  deep:    { label: 'Deep',    mult: 1,    focus: true,  note: 'Full rate. Starts the day clock and builds combo.' },
  upkeep:  { label: 'Upkeep',  mult: 0.5,  focus: true,  note: 'Half rate. Counts as work and builds combo.' },
  tracked: { label: 'Tracked', mult: 0.15, focus: false, note: 'Token rate. Logged, but breaks a combo chain.' }
};
export const COMBO = { gapMs: 10 * 60000, minMs: 5 * 60000, step: 0.2, cap: 3 };
export const MIN_SESSION_MS = 15 * 1000;       // shorter is a mis-tap
export const MAX_RUN_MS = 12 * 3600000;        // a forgotten timer is capped, not trusted
export const FOCUS_GATE_MS = 25 * 60000;       // focus needed before a break goes unchallenged
export const LOCK_MIN_MS = 90 * 1000;          // lock-in minimum before exit unlocks

export const HABIT_DIFF = {
  trivial: { label: 'Trivial', gain: 50, loss: 15, days: 21 },
  easy:    { label: 'Easy',    gain: 35, loss: 10, days: 30 },
  medium:  { label: 'Medium',  gain: 25, loss: 8,  days: 45 },
  hard:    { label: 'Hard',    gain: 15, loss: 5,  days: 66 }
};
export const HABIT_LEVELS = [
  { level: 1, name: 'Seedling', min: 0 },
  { level: 2, name: 'Sprout', min: 200 },
  { level: 3, name: 'Growing', min: 500 },
  { level: 4, name: 'Established', min: 800 },
  { level: 5, name: 'Mastered', min: 1000 }
];
export const STREAK_MILESTONES = [7, 14, 21, 30, 66];
export const OBJ_WEIGHT = { critical: 0.5, primary: 0.35, fallback: 0.15 };

/* ── caches, dropped whenever the document changes ── */
let _idx = null;
const _memo = new Map();
export function invalidate() { _idx = null; _memo.clear(); }
onChange(invalidate);
function memo(key, fn) {
  if (_memo.has(key)) return _memo.get(key);
  if (_memo.size > 600) _memo.clear();          // live keys are per-second; never let them pile up
  const v = fn(); _memo.set(key, v); return v;
}
function index() {
  if (_idx) return _idx;
  const byDate = new Map(), byCard = new Map();
  S().activities.forEach(a => (a.sessions || []).forEach(s => {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push({ a, s });
    if (s.cardId) byCard.set(s.cardId, (byCard.get(s.cardId) || 0) + s.dur);
  }));
  _idx = { byDate, byCard };
  return _idx;
}

/* ══════════════════════ TIME & SESSIONS ══════════════════════ */

export function winMinutes() {
  const w = S().settings.window;
  const start = hmToMin(w.start);
  let end = hmToMin(w.end);
  if (end <= start) end = 24 * 60;
  return { start, end, total: end - start };
}
export function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

/** Name with the owner's own icon in front, if they gave it one. */
export const label = x => (x ? (x.emoji ? x.emoji + ' ' : '') + x.name : '');
export const tierOf = a => (a && TIERS[a.weight] ? a.weight : 'upkeep');
export const isEscape = a => !!(a && a.isEscape);
export const countsAsFocus = a => TIERS[tierOf(a)].focus && !isEscape(a);
export const isDeep = a => tierOf(a) === 'deep' && !isEscape(a);
export const runningActivity = () => S().activities.find(a => a.isRunning && a.lastStart) || null;

/** Sessions on a date, oldest first. A running timer appears as a live
 *  session holding only what it has accrued today, capped. */
export function sessionsOn(date, includeRunning = true) {
  const out = (index().byDate.get(date) || []).slice();
  if (includeRunning && date === today()) {
    const a = runningActivity();
    if (a) {
      const start = Math.max(a.lastStart, parseYmd(date).getTime());
      const dur = clamp(Date.now() - start, 0, MAX_RUN_MS);
      out.push({ a, s: { date, start, end: start + dur, dur, eff: null, live: true, cardId: a.runCardId || null } });
    }
  }
  return out.sort((x, y) => x.s.start - y.s.start);
}
export const focusMsOn = date => sessionsOn(date).reduce((n, { a, s }) => n + (countsAsFocus(a) ? s.dur : 0), 0);
export const trackedMsOn = date => sessionsOn(date).reduce((n, { s }) => n + s.dur, 0);
export const actMsOn = (a, date) => sessionsOn(date).reduce((n, x) => n + (x.a === a ? x.s.dur : 0), 0);

/** Time logged against a board card, from sessions that carry its id. */
export function cardMs(cardId) {
  let ms = index().byCard.get(cardId) || 0;
  const a = runningActivity();
  if (a && a.runCardId === cardId) ms += clamp(Date.now() - a.lastStart, 0, MAX_RUN_MS);
  return ms;
}

/** Duration-weighted mean of the sessions that were rated (0..1), or null. */
export function efficiencyOn(date) {
  let ws = 0, td = 0;
  sessionsOn(date, false).forEach(({ s }) => { if (s.eff != null) { ws += s.eff * s.dur; td += s.dur; } });
  return td ? ws / td : null;
}

/** Minutes from the window opening to the first deep block: the direct
 *  measure of activation energy. Breaks and upkeep do not count as starting. */
export function ttfbFor(date) {
  const starts = sessionsOn(date).filter(({ a }) => isDeep(a)).map(({ s }) => s.start);
  if (!starts.length) return null;
  const first = new Date(Math.min(...starts));
  return Math.max(0, Math.round(first.getHours() * 60 + first.getMinutes() - winMinutes().start));
}

/** Walk a day's sessions and work out the combo chain each one sat in.
 *  Uninterrupted work compounds, so back-to-back blocks pay more; a long
 *  gap or anything that is not work resets the chain. */
export function comboWalk(date) {
  const list = sessionsOn(date).map(x => ({ ...x, mult: 1, chain: 0 }));
  let chain = 0, prevEnd = null, longest = 0;
  for (const it of list) {
    if (!countsAsFocus(it.a)) { chain = 0; prevEnd = null; continue; }
    if (!it.s.live && it.s.dur < COMBO.minMs) continue;            // too short to join, too short to break
    if (prevEnd !== null && it.s.start - prevEnd > COMBO.gapMs) chain = 0;
    chain++; prevEnd = it.s.end;
    longest = Math.max(longest, chain);
    it.chain = chain;
    it.mult = chain > 1 ? Math.min(COMBO.cap, 1 + COMBO.step * (chain - 1)) : 1;
  }
  const alive = date === today() && prevEnd !== null && Date.now() - prevEnd <= COMBO.gapMs;
  const cur = alive ? chain : 0;
  return { list, longest, chain: cur, mult: cur > 1 ? Math.min(COMBO.cap, 1 + COMBO.step * (cur - 1)) : 1, dropsAt: alive ? prevEnd + COMBO.gapMs : null };
}

/* ══════════════════════ ACTIVITY TIMERS ══════════════════════ */

/** Record [start, end) against an activity, split at midnight so each
 *  calendar day owns only its own time. */
function recordSpan(a, start, end, extra = {}) {
  if (!a.sessions) a.sessions = [];
  let kept = false, s = start;
  while (s < end) {
    const dayEnd = new Date(s); dayEnd.setHours(24, 0, 0, 0);
    const e = Math.min(end, dayEnd.getTime());
    if (e - s >= MIN_SESSION_MS) { a.sessions.push({ date: ymd(new Date(s)), start: s, end: e, dur: e - s, eff: null, ...extra }); kept = true; }
    s = e;
  }
  return kept;
}
function stopOne(a, at = Date.now()) {
  const start = a.lastStart, extra = a.runCardId ? { cardId: a.runCardId } : {};
  a.isRunning = false; a.lastStart = 0; a.runCardId = null;
  touch(a);
  return recordSpan(a, start, Math.min(at, start + MAX_RUN_MS), extra);
}
/** Stop whatever is running. Returns { activity, kept } or null. */
export function stopRunning() {
  const a = runningActivity();
  if (!a) return null;
  const kept = stopOne(a);
  invalidate(); save();
  return { activity: a, kept };
}
/** Start an activity (stopping any other first). `cardId` links the time to a board task. */
export function startActivity(id, { cardId = null } = {}) {
  const a = S().activities.find(x => x.id === id);
  if (!a) return null;
  S().activities.forEach(o => { if (o.isRunning && o !== a) stopOne(o); });
  if (!a.isRunning) { a.isRunning = true; a.lastStart = Date.now(); }
  a.runCardId = cardId;
  touch(a);
  invalidate(); save();
  return a;
}
/** A break needs challenging when little real work is on the board yet. */
export const needsEscapeChallenge = a =>
  S().game.campaign.on && isEscape(a) && !isRest(today()) && focusMsOn(today()) < FOCUS_GATE_MS;

/** Timers left running across midnight or past the cap are closed where
 *  they should have ended, so they neither inflate today nor grow forever. */
export function closeStaleTimers() {
  let changed = false;
  S().activities.forEach(a => {
    if (!a.isRunning || !a.lastStart) return;
    const startDay = ymd(new Date(a.lastStart));
    if (startDay === today() && Date.now() - a.lastStart <= MAX_RUN_MS) return;
    const endOfStartDay = new Date(a.lastStart); endOfStartDay.setHours(23, 59, 59, 999);
    stopOne(a, Math.min(Date.now(), endOfStartDay.getTime()));
    changed = true;
  });
  if (changed) { invalidate(); save(); }
  return changed;
}

/** The activity LOCK IN falls back to when a task has no linked tag.
 *  Rendering only needs to name it; it is created for real (`create`) the
 *  first time a timer actually starts. */
export function focusActivity(create = false) {
  const st = S();
  let a = st.activities.find(x => x.id === st.game.focusActId) || st.activities.find(x => isDeep(x));
  if (!a) {
    a = { id: slug('act', 'Deep Work'), name: 'Deep Work', emoji: '', color: '#2BD4F0', weight: 'deep', isEscape: false, isRunning: false, lastStart: 0, sessions: [] };
    if (create) st.activities.unshift(a);
  }
  return a;
}
/** A task's tag decides which activity its time is logged under. */
export function activityForCard(card, create = false) {
  const st = S();
  const tag = card && st.tags.find(t => t.id === card.tagId);
  return (tag && st.activities.find(a => a.id === tag.activityId)) || focusActivity(create);
}

/* ══════════════════════ BOARD ══════════════════════ */

export function findCard(id) {
  const st = S();
  for (const col of st.columns) {
    const i = (st.cards[col.id] || []).findIndex(c => c.id === id);
    if (i >= 0) return { card: st.cards[col.id][i], col: col.id, index: i };
  }
  return null;
}
export function moveCard(id, toCol, toIndex = null) {
  const f = findCard(id);
  if (!f) return;
  const st = S();
  st.cards[f.col].splice(f.index, 1);
  const dest = st.cards[toCol] || (st.cards[toCol] = []);
  if (toCol === 'done') { if (!f.card.doneAt) f.card.doneAt = today(); } else delete f.card.doneAt;
  dest.splice(toIndex === null ? dest.length : clamp(toIndex, 0, dest.length), 0, touch(f.card));
  invalidate(); save();
}
/** Tasks completed on a date: the ones still sitting in Done, plus any
 *  that were cleared out of it since (counted when they were cleared). */
export const tasksDoneOn = date => (S().cards.done || []).filter(c => c.doneAt === date).length + ((S().days[date] || {}).tasksArchived || 0);

/** Empty the Done column. `before` limits it to tasks finished before that
 *  date; the day each one was finished keeps the credit. */
export function clearDone(before = null) {
  const st = S();
  let n = 0;
  st.cards.done = (st.cards.done || []).filter(c => {
    if (before && (c.doneAt || '') >= before) return true;
    const d = c.doneAt || today(), day = st.days[d] || (st.days[d] = {});
    day.tasksArchived = (day.tasksArchived || 0) + 1;
    tombstone(c.id); n++;
    return false;
  });
  if (n) { invalidate(); save(); }
  return n;
}

/* ── main goals for the day: free text, fresh every morning ── */
export const dayGoals = date => ((S().days[date] || {}).goals || []);
/** The most recent earlier day that had goals: shown faintly as a prompt. */
export function prevDayGoals(date) {
  for (let i = 1; i <= 21; i++) {
    const g = dayGoals(addDays(date, -i)).filter(x => x && x.t);
    if (g.length) return g;
  }
  return [];
}
export function setDayGoal(date, i, patch) {
  const st = S(), day = st.days[date] || (st.days[date] = {});
  const list = (day.goals || []).slice();
  while (list.length <= i) list.push({ t: '', done: false });
  list[i] = { ...list[i], ...patch };
  if (!list[i].t) list[i].done = false;
  while (list.length && !list[list.length - 1].t) list.pop();
  day.goals = list;
  save();
}

/* ══════════════════════ REST DAYS ══════════════════════ */

export const isRest = date => !!(S().days[date] && S().days[date].rest);

/** Rest days used in the 7 days ending on `date`, against the allowance. */
export function restBudget(date = today()) {
  let used = 0;
  for (let i = 0; i < 7; i++) if (isRest(addDays(date, -i))) used++;
  const allowed = S().settings.restPerWeek;
  return { used, allowed, left: Math.max(0, allowed - used) };
}
/** Mark or unmark a rest day. A rest day is scored as nothing at all:
 *  no win, no loss, no reputation change, and habit streaks freeze. */
export function setRest(date, on) {
  const st = S();
  const day = st.days[date] || (st.days[date] = {});
  day.rest = !!on;                   // an explicit false, so a merge cannot resurrect it
  if (date < today()) {
    st.habits.forEach(h => {
      if (!isHabitDueOn(h, date)) return;
      if (on && h.history[date] !== 'done') { h.history[date] = 'rest'; touch(h); }
      if (!on && h.history[date] === 'rest') { h.history[date] = 'missed'; touch(h); }
    });
    delete st.game.days[date];      // re-settled below under the new rule
  }
  invalidate(); save();
  settlePending();
}

/* ══════════════════════ HABITS ══════════════════════ */

export function isHabitDueOn(h, date) {
  if (date < (h.startDate || date)) return false;
  const sch = h.schedule || { type: 'daily' };
  if (sch.type === 'interval') return daysBetween(h.startDate || date, date) % Math.max(1, sch.every || 1) === 0;
  if (sch.type === 'weekdays') return (sch.days || []).includes(parseYmd(date).getDay());
  return true;
}
export const habitsDue = date => S().habits.filter(h => isHabitDueOn(h, date));
export const habitsDoneOn = date => S().habits.filter(h => h.history[date] === 'done').length;

export function streakBonus(streak) {
  if (streak >= 66) return 2;
  if (streak >= 30) return 1.75;
  if (streak >= 21) return 1.5;
  if (streak >= 14) return 1.25;
  if (streak >= 7) return 1.1;
  return 1;
}
export function levelInfo(xp) {
  const lv = [...HABIT_LEVELS].reverse().find(l => xp >= l.min) || HABIT_LEVELS[0];
  const next = HABIT_LEVELS.find(l => l.level === lv.level + 1) || null;
  return { lv, next, pct: next ? clamp(Math.round((xp - lv.min) / (next.min - lv.min) * 100), 0, 100) : 100 };
}

/** Fold a habit's history into XP, streak and level. 'rest' entries are
 *  skipped entirely, which is what freezes a streak across a rest day. */
export function habitStats(h) {
  return memo('hab:' + h.id, () => {
    const diff = HABIT_DIFF[h.difficulty] || HABIT_DIFF.easy;
    let xp = 0, streak = 0, longest = 0, done = 0, missed = 0, frozen = false;
    Object.keys(h.history || {}).sort().forEach(d => {
      const v = h.history[d];
      if (v === 'done') { streak++; longest = Math.max(longest, streak); xp += Math.round(diff.gain * streakBonus(streak)); done++; frozen = false; }
      else if (v === 'missed') { streak = 0; xp = Math.max(0, xp - diff.loss); missed++; frozen = false; }
      else if (v === 'rest') frozen = true;
    });
    const t = today();
    const doneToday = h.history[t] === 'done';
    const nextGain = Math.round(diff.gain * streakBonus(streak + 1));
    const milestone = STREAK_MILESTONES.find(m => m > streak) || null;
    return { xp, streak, longest, done, missed, doneToday, nextGain, milestone, bonus: streakBonus(streak),
             frozen: frozen || (isRest(t) && !doneToday), rate: done + missed ? Math.round(done / (done + missed) * 100) : null, ...levelInfo(xp) };
  });
}

/** Check or uncheck a habit for a date. Returns the XP swing for the UI. */
export function toggleHabit(id, date = today()) {
  const h = S().habits.find(x => x.id === id);
  if (!h) return 0;
  const before = habitStats(h).xp;
  if (h.history[date] === 'done') {
    if (date === today()) delete h.history[date];
    else h.history[date] = isRest(date) ? 'rest' : 'missed';
  } else h.history[date] = 'done';
  touch(h); invalidate(); save();
  return habitStats(h).xp - before;
}

/** Fill in every due day that passed without a check-off. */
export function processHabitMisses() {
  const st = S(), t = today();
  let d = st.lastActiveDay || t, changed = false, guard = 0;
  while (d < t && guard++ < 800) {
    st.habits.forEach(h => {
      if (!isHabitDueOn(h, d) || h.history[d]) return;
      h.history[d] = isRest(d) ? 'rest' : 'missed';
      changed = true;
    });
    d = addDays(d, 1);
  }
  if (st.lastActiveDay !== t) { st.lastActiveDay = t; changed = true; }
  if (changed) { invalidate(); saveQuiet(); }
}

/* ── consistency rewards ── */

/** Count back consecutive days satisfying `ok`, skipping rest days and days
 *  where `applies` is false (nothing was asked of that day). */
function chainBack(from, ok, applies, floor) {
  let n = 0, d = from, guard = 0;
  while (d >= floor && guard++ < 800) {
    if (isRest(d) || !applies(d)) { d = addDays(d, -1); continue; }
    if (!ok(d)) break;
    n++; d = addDays(d, -1);
  }
  return n;
}
const habitFloor = () => S().habits.reduce((m, h) => (h.startDate && h.startDate < m ? h.startDate : m), today());

/** Every habit that was due got done. */
export function isSweep(date) {
  const due = habitsDue(date);
  return due.length > 0 && due.every(h => h.history[date] === 'done');
}
/** Consecutive clean sweeps ending on `date`. */
export const sweepChain = date => memo('sweep:' + date, () =>
  chainBack(date, isSweep, d => habitsDue(d).length > 0, habitFloor()));
/** The chain as it stands right now: today's if earned, else yesterday's (still alive). */
export function sweepStatus() {
  const t = today();
  const done = isSweep(t);
  const chain = done ? sweepChain(t) : sweepChain(addDays(t, -1));
  const x = S().settings.xp;
  const bonusFor = n => (n > 0 ? Math.min(x.sweepCap, x.sweep + x.sweepStep * (n - 1)) : 0);
  return { done, chain, bonus: bonusFor(done ? chain : chain + 1), earned: done };
}
export function sweepBonus(date) {
  if (!isSweep(date)) return 0;
  const x = S().settings.xp;
  return Math.min(x.sweepCap, x.sweep + x.sweepStep * (sweepChain(date) - 1));
}

/** The four things worth writing down each day. Paid for being logged,
 *  never for the value entered: the reward is for evidence, not a high
 *  self-rating. */
export function logbook(date) {
  const st = S(), day = st.days[date] || {}, j = st.journal[date] || {};
  const real = sessionsOn(date, false).filter(({ s }) => s.dur >= COMBO.minMs);
  const items = {
    sleep: !!(day.sleep && day.sleep.hrs > 0),
    rated: real.length > 0 && real.every(({ s }) => s.eff != null),
    efficacy: day.efficacy != null,
    journal: !!(j.w || j.l || j.f)
  };
  const count = Object.values(items).filter(Boolean).length;
  return { ...items, count, complete: count === 4, unrated: real.filter(({ s }) => s.eff == null).length };
}
export const logChain = date => memo('log:' + date, () =>
  chainBack(date, d => logbook(d).complete, () => true, S().profile.createdAt || today()));
export function logStatus() {
  const t = today(), lb = logbook(t);
  return { ...lb, chain: lb.complete ? logChain(t) : logChain(addDays(t, -1)) };
}

/* ══════════════════════ SCORING ══════════════════════ */

export const socialMinsOn = date => (S().journal[date] || {}).sm || 0;
export function socialPenalty(date) {
  const x = S().settings.xp;
  return Math.round(Math.max(0, socialMinsOn(date) - x.socialFreeMins) * x.socialPerMin);
}

/** A day's XP with its parts, so the dashboard can explain the number. */
export function dayScore(date) {
  const live = date === today();
  const key = 'score:' + date + (live ? ':' + Math.floor(Date.now() / 1000) : '');
  return memo(key, () => {
    const x = S().settings.xp;
    const walk = comboWalk(date);
    let focus = 0;
    walk.list.forEach(it => { focus += (it.s.dur / 3600000) * TIERS[tierOf(it.a)].mult * it.mult * x.perHour; });
    const habits = habitsDoneOn(date) * x.habit;
    const tasks = tasksDoneOn(date) * x.task;
    const eff = (efficiencyOn(date) || 0) * x.efficiency;
    const sweep = sweepBonus(date);
    const log = logbook(date).count * x.log;
    const penalty = socialPenalty(date);
    const total = Math.max(0, Math.round(habits + focus + tasks + eff + sweep + log - penalty));
    return { total, habits, focus: Math.round(focus), tasks, eff: Math.round(eff), sweep, log, penalty, combo: walk };
  });
}
export const dayXP = date => dayScore(date).total;

/** What a full day at target would pay. Used for scale, never as a bar. */
export function maxXP(date) {
  const st = S(), x = st.settings.xp, due = habitsDue(date).length;
  return Math.round(due * x.habit + st.settings.targets.hours * x.perHour + st.settings.targets.tasks * x.task +
    x.efficiency + (due ? x.sweep : 0) + 4 * x.log);
}

/* ══════════════════════ THE SHADOW ══════════════════════
   He is rebuilt every morning from what you actually did:

     recent form = 60% of your 7-day average + 40% of your last day
     his bar     = recent form × (1 + edge)

   so he is always a step ahead of how you have been performing, and a
   strong week raises him the next day. Three guard rails keep him fair:

     • never above your best day of the last 30: you have already done it
     • never falls more than 8% in one day: a slump is not rewarded at once
     • never below a quarter of a full target day

   Rest days are invisible to him. Until three days are on record he runs
   at 60% of a full target day. */
export function shadowInfo(date = today()) {
  return memo('shadow:' + date, () => {
    const g = S().game, edge = S().settings.shadow.edge;
    const full = maxXP(date);
    const floor = Math.round(full * 0.25);
    const cut = addDays(date, -30);
    const hist = Object.keys(g.days).filter(d => d < date && d >= cut && g.days[d].v !== 'R').sort();
    if (hist.length < 3) return { xp: Math.round(full * 0.6), calibrating: true, need: 3 - hist.length, floor };
    const xs = hist.map(d => g.days[d].x || 0);
    const last = xs[xs.length - 1], avg7 = avg(xs.slice(-7)), best = Math.max(...xs);
    const prev = g.days[hist[hist.length - 1]].s || 0;
    const raw = (0.6 * avg7 + 0.4 * last) * (1 + edge / 100);
    const cap = Math.max(best, floor);
    const held = prev * 0.92 > raw;
    const xp = Math.round(Math.min(cap, Math.max(raw, prev * 0.92, floor)));
    return { xp, calibrating: false, last, avg7: Math.round(avg7), best, edge, prev, floor,
             capped: Math.max(raw, prev * 0.92) > cap, held, delta: prev ? xp - prev : 0 };
  });
}
export const shadowXP = date => shadowInfo(date).xp;
export function shadowBasis(date = today()) {
  const i = shadowInfo(date);
  if (i.calibrating) return `Calibrating: ${i.need} more scored day${i.need === 1 ? '' : 's'} until he adapts to you`;
  const tail = i.capped ? ' · capped at your 30-day best' : i.held ? ' · easing down slowly' : '';
  return `7-day avg ${i.avg7} · last day ${i.last} · +${i.edge}% edge${tail}`;
}
/** He works the whole window evenly, so his pace is knowable at any minute. */
export function shadowPaceNow() {
  const w = winMinutes();
  return Math.round(shadowXP(today()) * clamp((nowMinutes() - w.start) / w.total, 0, 1));
}

/* ══════════════════════ MISSION / EXECUTION / REPUTATION ══════════════════════ */

export const missionFor = d => S().game.missions[d] || null;
export function hasMission(d) {
  const m = missionFor(d);
  return !!(m && ((m.c && m.c.t) || (m.p || []).some(x => x.t) || (m.f && m.f.t)));
}
/** Weighted completion of the declared mission. Tiers left blank hand their
 *  weight to the ones that were declared, so a critical-only day can reach 100%. */
export function execScoreFor(d) {
  const m = missionFor(d);
  if (!m) return null;
  const parts = [];
  if (m.c && m.c.t) parts.push({ w: OBJ_WEIGHT.critical, done: m.c.done ? 1 : 0 });
  const ps = (m.p || []).filter(x => x.t);
  if (ps.length) parts.push({ w: OBJ_WEIGHT.primary, done: ps.filter(x => x.done).length / ps.length });
  if (m.f && m.f.t) parts.push({ w: OBJ_WEIGHT.fallback, done: m.f.done ? 1 : 0 });
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.w, 0);
  return Math.round(parts.reduce((s, p) => s + p.w * p.done, 0) / total * 100);
}
/** Asymmetric on purpose: earned slowly, lost quickly. Declaring nothing
 *  is its own kind of failure and costs more than a weak day. */
export function repDelta(exec) {
  if (exec === null || exec === undefined) return -2;
  if (exec >= 80) return 3;
  if (exec >= 60) return 1.5;
  if (exec >= 40) return 0.5;
  if (exec >= 20) return -1;
  return -3;
}

/* ── settlement: freeze the verdict for each day that has ended ── */
function settleDay(date) {
  const g = S().game;
  if (g.days[date] || date >= today() || date < g.start) return null;
  const score = dayScore(date);
  const base = { x: score.total, h: Math.round(focusMsOn(date) / 36000) / 100, tt: ttfbFor(date), cb: Math.max(g.combo[date] || 0, score.combo.longest) };
  if (isRest(date)) return (g.days[date] = { ...base, v: 'R', s: 0, ex: null, rd: 0 });
  const s = shadowXP(date);
  const missions = S().settings.modules.mission;
  const ex = missions ? execScoreFor(date) : null;
  return (g.days[date] = { ...base, v: score.total >= s ? 'W' : 'L', s, ex: missions ? (ex ?? 0) : null, nd: missions && ex === null ? 1 : 0, rd: missions ? repDelta(ex) : 0 });
}
/** Settle every day from the scoreboard start to yesterday, in order.
 *  A day the app was never opened is still a day that happened. */
export function settlePending() {
  const g = S().game, t = today(), out = [];
  const before = scoreboard().rep;
  let d = g.start, guard = 0;
  while (d < t && guard++ < 1200) {
    if (!g.days[d]) { invalidate(); const r = settleDay(d); if (r) out.push({ date: d, ...r }); }
    d = addDays(d, 1);
  }
  if (out.length) { invalidate(); saveQuiet(); }
  return { settled: out, repBefore: before, repAfter: scoreboard().rep };
}

/** Everything folded from the settled days. Reputation is lifetime; the
 *  win-loss record and streak are scoped to the current scoreboard start. */
export function scoreboard() {
  return memo('board', () => {
    const g = S().game;
    let rep = 0, peak = 0, w = 0, l = 0, r = 0, streak = 0;
    Object.keys(g.days).sort().forEach(d => {
      const day = g.days[d];
      rep = Math.max(0, rep + (day.rd || 0)); peak = Math.max(peak, rep);
      if (d < g.start) return;
      if (day.v === 'W') { w++; streak++; } else if (day.v === 'L') { l++; streak = 0; } else r++;
    });
    return { rep, peak, w, l, r, streak };
  });
}
export function rankFor(rep) {
  const ranks = [...S().settings.ranks].sort((a, b) => a.at - b.at);
  let cur = ranks[0], next = null;
  ranks.forEach((rk, i) => { if (rep >= rk.at) { cur = rk; next = ranks[i + 1] || null; } });
  return { cur, next, pct: next ? clamp(Math.round((rep - cur.at) / (next.at - cur.at) * 100), 0, 100) : 100 };
}

const scoredDays = (n) => {
  const g = S().game;
  return Object.keys(g.days).filter(d => d >= g.start && g.days[d].v !== 'R' && g.days[d].ex != null).sort().slice(-n);
};
/** Trajectory over the last five scored days. One bad day inside a good
 *  run leaves the state intact: that is the point of using it over a streak. */
export function momentum() {
  const g = S().game, days = scoredDays(5);
  if (days.length < 3) return { key: 'establishing', label: 'Establishing', tone: 'mute', sub: `${days.length}/3 days of data` };
  const vals = days.map(d => g.days[d].ex);
  const a = avg(vals), sub = `${Math.round(a)}% avg over ${vals.length}d`;
  if (a >= 75 && Math.min(...vals) >= 40) return { key: 'peak', label: 'Peak', tone: 'good', sub };
  if (a >= 60) return { key: 'high', label: 'High', tone: 'good', sub };
  if (a >= 40) return { key: 'building', label: 'Building', tone: 'accent', sub };
  if (a >= 25) return { key: 'weakening', label: 'Weakening', tone: 'warn', sub };
  return { key: 'lost', label: 'Lost', tone: 'bad', sub };
}
export function exec7() {
  const g = S().game, days = scoredDays(7);
  return days.length ? Math.round(avg(days.map(d => g.days[d].ex))) : null;
}

/* ── records ── */
export const RECORD_DEFS = {
  xp:    { label: 'Highest day XP',     lower: false, unit: 'xp' },
  hours: { label: 'Most focused hours', lower: false, unit: 'h' },
  combo: { label: 'Longest combo',      lower: false, unit: 'blocks' },
  exec:  { label: 'Best execution',     lower: false, unit: '%' },
  ttfb:  { label: 'Fastest start',      lower: true,  unit: 'min' },
  rep:   { label: 'Peak reputation',    lower: false, unit: '' }
};
const DAY_FIELD = { xp: 'x', hours: 'h', combo: 'cb', exec: 'ex', ttfb: 'tt' };
/** Best settled value per record, before today. */
export function records() {
  return memo('records', () => {
    const g = S().game, out = {};
    Object.keys(g.days).sort().forEach(d => {
      const day = g.days[d];
      Object.keys(DAY_FIELD).forEach(k => {
        const v = day[DAY_FIELD[k]];
        if (v === null || v === undefined || (k !== 'ttfb' && v <= 0)) return;
        const cur = out[k];
        if (!cur || (RECORD_DEFS[k].lower ? v < cur.v : v > cur.v)) out[k] = { v, d };
      });
    });
    const peak = scoreboard().peak;
    if (peak > 0) out.rep = { v: Math.round(peak * 10) / 10, d: null };
    return out;
  });
}
/** Today's live values against the standing records. Returns the records
 *  broken for the first time today: celebration is budgeted, so each is
 *  reported once. */
export function checkLiveRecords() {
  const g = S().game, t = today(), rec = records(), broken = [];
  const score = dayScore(t);
  if (score.combo.longest > (g.combo[t] || 0)) { g.combo[t] = score.combo.longest; saveQuiet(); }
  const live = { xp: score.total, hours: Math.round(focusMsOn(t) / 36000) / 100, combo: g.combo[t] || 0, ttfb: ttfbFor(t) };
  if (Object.keys(g.days).length < 3) return broken;
  Object.keys(live).forEach(k => {
    const v = live[k], cur = rec[k];
    if (v === null || !cur) return;
    const better = RECORD_DEFS[k].lower ? v < cur.v : v > cur.v;
    if (better && g.notif['rec:' + k] !== t) { g.notif['rec:' + k] = t; broken.push({ key: k, v, prev: cur.v, prevDate: cur.d }); }
  });
  if (broken.length) saveQuiet();
  return broken;
}
export function fmtRecord(key, v) {
  if (v === null || v === undefined) return '-';
  if (key === 'ttfb') return v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v}m`;
  if (key === 'hours') return `${Number(v).toFixed(1)}h`;
  if (key === 'combo') return `${v} blocks`;
  if (key === 'exec') return `${v}%`;
  if (key === 'xp') return `${v} XP`;
  return String(Math.round(v));
}

export function logFriction() {
  const g = S().game, t = today();
  g.friction[t] = (g.friction[t] || 0) + 1;
  save();
  return g.friction[t];
}

/* ══════════════════════ CAMPAIGN ══════════════════════ */

export const campaignDay = () => daysBetween(S().game.campaign.start, today()) + 1;
export function campaignStats() {
  const g = S().game, sb = scoreboard();
  const days = Object.keys(g.days).filter(d => d >= g.start);
  const ex = days.map(d => g.days[d].ex).filter(v => v != null);
  const hours = days.reduce((n, d) => n + (g.days[d].h || 0), 0) + focusMsOn(today()) / 3600000;
  return { days: days.length, execAvg: ex.length ? Math.round(avg(ex)) : 0, hours: Math.round(hours * 10) / 10, w: sb.w, l: sb.l };
}
/** Starting a campaign restarts the scoreboard from its first day. */
export function startCampaign({ name, start, len }) {
  const g = S().game;
  g.campaign = { ...g.campaign, on: true, name: name || g.campaign.name, start, len: Math.max(1, len || 60) };
  g.start = start;
  invalidate(); save();
  settlePending();
}
/** Archive the campaign and return to the owner's own theme. */
export function concludeCampaign() {
  const g = S().game, s = campaignStats();
  const verdict = s.w > s.l && s.execAvg >= 50 ? 'Victory' : 'Defeat';
  g.campaigns.push({ n: g.campaign.no, name: g.campaign.name, start: g.campaign.start, end: today(), w: s.w, l: s.l, execAvg: s.execAvg, hours: s.hours, verdict });
  g.campaign.on = false; g.campaign.no++;
  g.start = today();
  invalidate(); save();
  return verdict;
}

/** Identity as cumulative evidence rather than affirmation. */
export function serviceRecord() {
  return memo('service', () => {
    const st = S(), g = st.game;
    let hours = 0, blocks = 0;
    st.activities.forEach(a => { if (countsAsFocus(a)) (a.sessions || []).forEach(s => { hours += s.dur / 3600000; blocks++; }); });
    const stats = st.habits.map(habitStats);
    const ex = Object.values(g.days).map(d => d.ex).filter(v => v != null);
    const tt = Object.values(g.days).map(d => d.tt).filter(v => v != null);
    return {
      hours: Math.round(hours), blocks,
      habitDays: stats.reduce((n, s) => n + s.done, 0),
      mastered: stats.filter(s => s.lv.level >= 5).length,
      execAvg: ex.length ? Math.round(avg(ex)) : null,
      ttfbAvg: tt.length ? Math.round(avg(tt)) : null,
      daysScored: Object.values(g.days).filter(d => d.v !== 'R').length,
      campaigns: g.campaigns.length
    };
  });
}

/* ══════════════════════ SUBSCRIPTIONS ══════════════════════
   The due date is never stored, only an anchor date and a cycle. A stored
   "next due" goes stale the moment a payment passes with the app closed;
   deriving it means every device is right without anything having to run. */
export const SUB_CYCLES = { weekly: ['Weekly', 52], monthly: ['Monthly', 12], quarterly: ['Quarterly', 4], yearly: ['Yearly', 1], custom: ['Every N days', null] };

/** `n` months after `from`, on `day`, clamped into short months. Always
 *  measured from the original anchor: stepping month by month makes the
 *  clamp sticky (31 Jan, 28 Feb, 28 Mar, for ever). */
function addMonthsFrom(from, n, day) {
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  d.setHours(0, 0, 0, 0);
  return d;
}
/** Next occurrence on or after `from` (default: today, or the day after the last one marked paid). */
export function nextDueFor(sub, from) {
  let floor = new Date(from || Date.now()); floor.setHours(0, 0, 0, 0);
  if (!from && sub.paidThrough) { const p = parseYmd(addDays(sub.paidThrough, 1)); if (p > floor) floor = p; }
  const anchor = parseYmd(sub.anchor);
  if (isNaN(anchor)) return null;
  if (anchor >= floor) return anchor;
  let guard = 0;
  if (sub.cycle === 'weekly' || sub.cycle === 'custom') {
    const step = sub.cycle === 'weekly' ? 7 : Math.max(1, sub.every || 30);
    let d = anchor;
    while (d < floor && guard++ < 6000) { d = new Date(d); d.setDate(d.getDate() + step); d.setHours(0, 0, 0, 0); }   // whole days: safe across clock changes
    return d;
  }
  const stepM = sub.cycle === 'quarterly' ? 3 : sub.cycle === 'yearly' ? 12 : 1, day = anchor.getDate();
  let n = 0, d;
  do { n += stepM; d = addMonthsFrom(anchor, n, day); } while (d < floor && guard++ < 3000);
  return d;
}
/** Every cycle normalised to a monthly figure, so totals mean something. */
export function monthlyCost(sub) {
  const amt = Number(sub.amount) || 0;
  return sub.cycle === 'custom' ? amt * (365 / Math.max(1, sub.every || 30)) / 12 : amt * (SUB_CYCLES[sub.cycle] || SUB_CYCLES.monthly)[1] / 12;
}

/* ══════════════════════ VOICE ══════════════════════
   Two registers plus silence. "Cold" speaks in telemetry. "Ruthless" is
   contempt, kept from v4 for those who asked for it. Plain arrays: edit
   freely. */
const VOICE = {
  cold: {
    idle: ['No timer running. The window is still open.', 'Idle time is accumulating. Nothing is being logged.', 'Still idle. One block changes the reading.', 'The window does not pause when you do.', 'No block started. The gap is widening.'],
    behind: ['He is ahead. The gap closes one block at a time.', 'Behind pace. He has not stopped.', 'The scoreboard reads against you. It is not final yet.'],
    ahead: ['Ahead of pace. Hold it.', 'You are in front. He is still moving.', 'Lead confirmed. Do not spend it.'],
    escape: ['Under 25 minutes of focus logged. This reads as an exit, not a break.', 'The request is logged. So is the timing.', 'Fifteen minutes of work first. Then take it.'],
    pb: ['New record. That is now the standard.', 'Record logged. It will be harder to call that a fluke twice.'],
    morning: ['Window open. The first block decides the day.', 'Start delay is being measured from now.', 'You know the first move. Make it.'],
    night: ['Debrief. Record what happened, not what was intended.', 'Close the day. Declare the next one.'],
    nomission: ['No mission declared. An undeclared day cannot be executed.', 'Nothing was committed to today. Nothing can be kept.'],
    habits: ['{n} still unchecked today.', 'Habits open: {n}. The day is not closed.'],
    social: ['That time is logged as lost.', 'Logged. It bought nothing.'],
    rest: ['Rest day logged. Nothing is scored. He waits.']
  },
  harsh: {
    idle: ["Nothing running. Again. You are exactly the person you keep promising you're not.", "Still nothing. All that talk about what you're going to build, and you can't start one block.", "You've been 'about to start' for hours. That's your whole personality now.", "Look at the timer. Zero. That's not bad luck, that's you.", "Everyone you want to be ahead of is working right now. You're reading this.", "You're not tired. You're soft. There's a difference and you know which one applies.", 'Another day of being average. You said you were done with average.', 'You talk like someone with a plan and work like someone with an excuse.'],
    behind: ["I'm ahead of you and I'm not special. That's the humiliating part.", 'Losing to yourself. Not to talent, not to circumstance: to your own laziness.', "Every excuse you're assembling right now, I had too. I worked anyway.", "You're behind because you chose comfort. Say it plainly, it stings more that way.", "The scoreboard doesn't care about your potential. It never has."],
    ahead: ['Ahead. For once you look like who you claim to be.', 'Good. Now do it tomorrow, and the day after, before you start celebrating.', "One good day doesn't erase the record. Keep going.", "This is the baseline, not an achievement. Don't get comfortable."],
    escape: ["Hungry? You're not hungry. You're looking for a door.", 'Here it is. The exact moment you always fold. Same excuse, same hour, every time.', 'Tired after doing nothing. Do you hear yourself?', 'This is why nothing changes. Not luck. This. Right here.', 'Take the break. Add it to the list of things you quit early.'],
    pb: ['New record. So you CAN do it. Which makes every other day worse.', "Best day yet. Remember it: that's the standard you've been dodging.", 'Finally. Now stop acting like this is rare.'],
    morning: ['New day. Same you, unless you do something about it in the next ten minutes.', "The whole day gets decided in the first hour. Don't waste it deciding.", "Yesterday's excuses expired. Go."],
    night: ['Debrief. Be honest: lying to your own scoreboard is a new low.', 'Log what actually happened. Intentions are worthless here.'],
    nomission: ['No mission declared. Drifting, again.', "You committed to nothing today, so you'll achieve nothing. Simple maths.", 'No objective. No plan. Just vibes and excuses.'],
    social: ["Hours on your phone. That's the career you're actually building.", 'You scrolled instead of working, then wonder why nothing moves.', 'That time is gone. You traded it for nothing and you know it.'],
    habits: ['{n} still unchecked. Streaks die quietly.', '{n} left. You said these were non-negotiable.'],
    rest: ['Rest day. Earn the next one.']
  }
};
/** Every situation that speaks, in the order Settings lists them. */
export const VOICE_KINDS = [
  ['idle', 'Nothing is running', 'Sent when no timer has run for a while inside your window.'],
  ['behind', 'You are behind pace', 'Sent when the rival passes you; also shown on Home while you trail.'],
  ['ahead', 'You are ahead of pace', 'Shown on Home while you lead.'],
  ['nomission', 'No mission declared', 'Sent three hours into the window if nothing was declared.'],
  ['morning', 'Morning brief', 'Shown at the top of the brief.'],
  ['night', 'Debrief reminder', 'Sent thirty minutes before the window closes.'],
  ['habits', 'Habits still open', 'Sent at the reminder time. {n} becomes the number left.'],
  ['escape', 'A break is requested early', 'Shown in the break challenge during a campaign.'],
  ['pb', 'A record is broken', 'Added to the new-record notification.'],
  ['social', 'Social media time logged', 'Shown after a debrief that costs XP.'],
  ['rest', 'Rest day', 'Shown when a rest day is declared.']
];
export const voicePreset = (register, kind) => ((VOICE[register] || VOICE.cold)[kind] || []).slice();
/** One line for a situation. The owner's own lines (Settings → Notifications)
 *  replace the built-in ones for that situation. {n} and {rival} are filled in. */
export function voice(kind, vars = {}) {
  const st = S(), sh = st.settings.shadow;
  if (sh.voice === 'off') return '';
  const custom = (st.settings.lines || {})[kind];
  const pool = custom && custom.length ? custom : voicePreset(sh.voice, kind);
  if (!pool.length) return '';
  const all = { rival: st.settings.labels.shadow, ...vars };
  return pool[Math.floor(Math.random() * pool.length)].replace(/\{(\w+)\}/g, (m, k) => (all[k] !== undefined ? all[k] : m));
}

export { tombstone, uid };
