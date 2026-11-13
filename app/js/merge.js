/* ══════════════════════════════════════════════════════════════════════
   MERGE: combine two copies of the document without losing either side.

   Pure functions, no DOM, no storage. Used when the cloud copy and the
   local copy have both changed, and when two tabs on one device have.

   Rules (earned the hard way in v4):
   • Never replace the whole document: merge collection by collection.
   • Each item carries its own edit stamp (_m). The copy edited last wins
     that item, whichever device has the higher overall revision.
   • Deletions leave a tombstone so an older copy cannot resurrect them.
   • Stored values are facts (sessions, check-offs, verdicts). Scores are
     derived, so there are no counters here to drift.
   ══════════════════════════════════════════════════════════════════════ */
import { today } from './util.js';

const TOMB_TTL_DAYS = 60;
const alive = (tomb, key) => !tomb[String(key)];
const newerOf = (a, b) => ((a._m || 0) >= (b._m || 0) ? a : b);

export function pruneTombs(t) {
  const cutoff = Date.now() - TOMB_TTL_DAYS * 86400000, out = {};
  Object.keys(t || {}).forEach(k => { if ((t[k] || 0) > cutoff) out[k] = t[k]; });
  return out;
}

/** Union by id. Items both sides know are resolved by `combine`
 *  (default: whichever was edited last). Order follows `primary`. */
export function mergeById(primary, secondary, tomb, combine = newerOf) {
  const out = new Map();
  (primary || []).forEach(it => { if (it && it.id != null) out.set(String(it.id), it); });
  (secondary || []).forEach(it => {
    if (!it || it.id == null) return;
    const k = String(it.id), mine = out.get(k);
    out.set(k, mine ? combine(mine, it) : it);
  });
  return [...out.entries()].filter(([k]) => alive(tomb, k)).map(([, v]) => v);
}

/** Sessions have no id; identity is their start instant. */
export function mergeSessions(a, b, tomb) {
  const m = new Map();
  [...(b || []), ...(a || [])].forEach(s => { if (s && s.start != null) m.set(String(s.start), s); });
  // `a` is written last, so the primary's copy (e.g. a newer efficiency rating) wins
  return [...m.entries()].filter(([k]) => alive(tomb, 's:' + k)).map(([, v]) => v).sort((x, y) => x.start - y.start);
}

/** Run state belongs to whichever copy was started or stopped most
 *  recently: otherwise a stale copy restarts a timer you just stopped. */
function mergeActivity(p, s, tomb) {
  const newer = newerOf(p, s), older = newer === p ? s : p;
  return { ...older, ...newer, sessions: mergeSessions(newer.sessions, older.sessions, tomb),
           isRunning: !!newer.isRunning, lastStart: newer.lastStart || 0, runCardId: newer.runCardId || null };
}
/** History is unioned; today's entry belongs to the copy touched last, so
 *  un-checking a habit is not undone by the other device. */
function mergeHabit(p, s) {
  const newer = newerOf(p, s), older = newer === p ? s : p;
  const history = { ...(older.history || {}) };
  delete history[today()];
  return { ...older, ...newer, history: { ...history, ...(newer.history || {}) } };
}

/** A card can sit in a different column on each device. Its placement is
 *  decided by when that card was last moved; ordering follows the primary. */
export function mergeCards(pc, sc, tomb, columns) {
  const chosen = new Map();
  const consider = (src, isPrimary) => Object.keys(src || {}).forEach(col => (src[col] || []).forEach(card => {
    if (!card || card.id == null || !alive(tomb, card.id)) return;
    const k = String(card.id), m = card._m || 0, prev = chosen.get(k);
    if (!prev || m > prev.m || (m === prev.m && isPrimary)) chosen.set(k, { card, col, m });
  }));
  consider(sc, false); consider(pc, true);
  const out = {}, emitted = new Set();
  columns.forEach(c => { out[c.id] = []; });
  const fallback = columns[0] ? columns[0].id : 'today';
  const emit = src => Object.keys(src || {}).forEach(col => (src[col] || []).forEach(card => {
    if (!card || card.id == null) return;
    const k = String(card.id), win = chosen.get(k);
    if (!win || emitted.has(k)) return;
    emitted.add(k);
    (out[win.col] || out[fallback]).push(win.card);
  }));
  emit(pc); emit(sc);
  return out;
}

const mergeMap = (p, s) => ({ ...(s || {}), ...(p || {}) });
const mergeMapDeep = (p, s) => {
  const out = { ...(s || {}) };
  Object.keys(p || {}).forEach(k => { out[k] = { ...(out[k] || {}), ...p[k] }; });
  return out;
};
const mergeMax = (p, s) => {
  const out = { ...(s || {}) };
  Object.keys(p || {}).forEach(k => { out[k] = Math.max(out[k] || 0, p[k] || 0); });
  return out;
};

/** Settled verdicts are frozen, but two devices can freeze the same day
 *  from different information. Where they disagree the entry is dropped,
 *  and the app re-settles that day from the merged facts. */
function mergeVerdicts(p, s) {
  const out = { ...(s || {}) };
  Object.keys(p || {}).forEach(d => {
    if (out[d] && JSON.stringify(out[d]) !== JSON.stringify(p[d])) delete out[d];
    else out[d] = p[d];
  });
  return out;
}

export function mergeStates(local, remote, deviceId = '') {
  if (!local) return remote;
  if (!remote) return local;
  const localNewer = (local._rev || 0) > (remote._rev || 0) ||
    ((local._rev || 0) === (remote._rev || 0) && (local._at || 0) >= (remote._at || 0));
  const p = localNewer ? local : remote, s = localNewer ? remote : local;
  const tomb = pruneTombs({ ...(s.tomb || {}), ...(p.tomb || {}) });

  const out = { ...s, ...p };
  out.tomb = tomb;
  out.profile = { ...(s.profile || {}), ...(p.profile || {}), onboarded: !!((p.profile || {}).onboarded || (s.profile || {}).onboarded) };
  out.columns = (p.columns && p.columns.length) ? p.columns : s.columns;
  out.cards = mergeCards(p.cards, s.cards, tomb, out.columns || []);
  out.tags = mergeById(p.tags, s.tags, tomb);
  out.activities = mergeById(p.activities, s.activities, tomb, (a, b) => mergeActivity(a, b, tomb));
  out.habits = mergeById(p.habits, s.habits, tomb, mergeHabit);
  out.goals = mergeById(p.goals, s.goals, tomb);
  out.subs = mergeById(p.subs, s.subs, tomb);
  out.days = mergeMapDeep(p.days, s.days);
  out.journal = mergeMap(p.journal, s.journal);
  out.weekRatings = mergeMap(p.weekRatings, s.weekRatings);

  const pg = p.game || {}, sg = s.game || {};
  out.game = {
    ...sg, ...pg,
    days: mergeVerdicts(pg.days, sg.days),
    missions: mergeMap(pg.missions, sg.missions),
    friction: mergeMax(pg.friction, sg.friction),
    combo: mergeMax(pg.combo, sg.combo),
    notif: mergeMap(pg.notif, sg.notif),
    holds: Math.max(pg.holds || 0, sg.holds || 0),
    folds: Math.max(pg.folds || 0, sg.folds || 0),
    campaigns: (pg.campaigns || []).length >= (sg.campaigns || []).length ? (pg.campaigns || []) : (sg.campaigns || [])
  };
  out.lastActiveDay = [p.lastActiveDay, s.lastActiveDay].filter(Boolean).sort()[0] || null;   // the earlier one, so no day's misses are skipped
  out._rev = Math.max(local._rev || 0, remote._rev || 0) + 1;
  out._at = Date.now();
  out._dev = deviceId;
  return out;
}
