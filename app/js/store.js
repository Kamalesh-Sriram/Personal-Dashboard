/* ══════════════════════════════════════════════════════════════════════
   STATE STORE

   One JSON document, kept in localStorage on this device. Nothing leaves
   the browser unless the owner turns on sync (see sync.js).

   save()       a real user action: advances the revision clock.
   saveQuiet()  housekeeping (snapshots, settlement): persists without
                advancing it, so an idle device can never out-rank the
                one actually being used when two copies are merged.
   ══════════════════════════════════════════════════════════════════════ */
import { today, uid, slug, deepClone, setDayOffset, dayOffsetFor } from './util.js';
import { mergeStates } from './merge.js';
import { DEFAULT_CATS } from './fincalc.js';

export const APP_VERSION = '5.2.0';
export const LS_KEY = 'hq.v5.state';
const DEVICE_KEY = 'hq.v5.device';

const hasLS = typeof localStorage !== 'undefined';
const lsGet = k => { try { return hasLS ? localStorage.getItem(k) : null; } catch { return null; } };
const lsSet = (k, v) => { try { if (hasLS) localStorage.setItem(k, v); return true; } catch { return false; } };

export const DEVICE_ID = (() => {
  let d = lsGet(DEVICE_KEY);
  if (!d) { d = 'dev-' + uid(); lsSet(DEVICE_KEY, d); }
  return d;
})();

export const DEFAULT_COLUMNS = [
  { id: 'today',   name: 'Today',      color: '#2BD4F0' },
  { id: 'soon',    name: 'Next 48h',   color: '#F26D63' },
  { id: 'week',    name: 'This week',  color: '#F0A44B' },
  { id: 'someday', name: 'Someday',    color: '#8B7CF6' },
  { id: 'waiting', name: 'Waiting on', color: '#56CFB2' },
  { id: 'done',    name: 'Done',       color: '#72726D' }
];

export const DEFAULT_RANKS = [
  { at: 0,   name: 'Novice' },
  { at: 25,  name: 'Apprentice' },
  { at: 60,  name: 'Expert' },
  { at: 120, name: 'Elite' },
  { at: 200, name: 'Master' },
  { at: 320, name: 'Grand Master' }
];

export const DEFAULT_XP = {
  habit: 12, perHour: 14, task: 9, efficiency: 10,
  sweep: 15, sweepStep: 3, sweepCap: 45, log: 3,
  goal: 2, goalCap: 5,
  socialPerMin: 0.4, socialFreeMins: 20
};

export const ALL_TABS = ['home', 'board', 'track', 'habits', 'goals', 'calendar', 'gym', 'finance', 'subs', 'review'];

export function defaultSettings() {
  return {
    theme: 'system',            // system | light | dark
    accent: '#2BD4F0',          // the bluish look of the earlier versions; change it in Settings
    font: 'classic',           // classic | system | rounded | serif | mono
    corners: 'soft',            // soft | sharp
    density: 'comfortable',     // comfortable | compact
    reduceMotion: false,        // from before 5.2: true still means motion off
    motion: 'full',             // full | subtle | off
    sound: { on: true, volume: 40 },
    haptics: true,              // a short vibration on a tick, where the device has one
    bg: { on: false, dim: 60, blur: 0, glass: 78 },
    sidebar: 'rail',            // rail | hidden
    sidebarOpen: false,
    tabs: { order: [...ALL_TABS], hidden: [] },
    window: { start: '07:00', end: '23:00' },
    clock24: true,
    currency: 'EUR',
    targets: { hours: 6, tasks: 4 },
    labels: {
      shadow: 'The Shadow', lockIn: 'Lock in', mission: "Today's mission",
      rank: 'Rank', rep: 'Reputation', campaign: 'Campaign'
    },
    ranks: deepClone(DEFAULT_RANKS),
    shadow: { edge: 8, voice: 'cold' },   // edge = % he stays ahead of your recent form
    lines: {},                  // situation -> the owner's own notification lines (overrides the built-in ones)
    autoClearDone: true,        // empty the board's Done column each morning
    modules: { shadow: true, mission: true, rank: true },
    restPerWeek: 1,
    nudgeMins: 45,
    notify: { idle: 'campaign', overtake: true, habits: true, habitsAt: '20:00', brief: true, debrief: true, subs: true, timer: true },
    xp: { ...DEFAULT_XP },
    ratings: ['Morning routine', 'Deep work', 'Health', 'Sleep quality', 'Relationships']
  };
}

export function defaultState() {
  const t = today();
  const cards = {};
  DEFAULT_COLUMNS.forEach(c => { cards[c.id] = []; });
  return {
    v: 5,
    profile: { name: '', owner: '', onboarded: false, createdAt: t },
    settings: defaultSettings(),
    columns: deepClone(DEFAULT_COLUMNS),
    cards,
    tags: [],
    activities: [],
    habits: [],
    goals: [],
    finance: { cats: deepClone(DEFAULT_CATS), rules: [] },   // the transactions themselves are not in this document (see fin.js)
    subs: [],
    days: {},          // date -> { sleep:{start,end,hrs}, efficacy, emojis:[], rest, goals:[{t,done}], tasksArchived }
    journal: {},       // date -> { w, l, f, e, sm }
    weekRatings: {},   // isoWeek -> { category: 1..5 }
    game: {
      start: t,                                          // scoreboard start
      campaign: { on: false, name: 'War Mode', start: t, len: 60, no: 1 },
      campaigns: [],                                     // archive
      days: {},                                          // date -> frozen verdict {x,s,v,ex,rd,h,tt,cb}
      missions: {},                                      // date -> {c,p[],f,src,at}
      friction: {},                                      // date -> hesitation count
      combo: {},                                         // date -> longest chain
      notif: {},                                         // rate-limit stamps
      holds: 0, folds: 0,
      focusActId: null
    },
    lastActiveDay: t,
    tomb: {},
    _rev: 0, _at: 0, _dev: DEVICE_ID
  };
}

/** Starter content offered during onboarding. Ids are derived from names so
 *  two devices that both seed independently converge on the same rows. */
export function starterContent() {
  const t = today();
  const act = (name, emoji, color, weight, isEscape = false) =>
    ({ id: slug('act', name), name, emoji, color, weight, isEscape, isRunning: false, lastStart: 0, sessions: [] });
  const activities = [
    act('Deep Work', '', '#2BD4F0', 'deep'),
    act('Study', '', '#6FB1F0', 'deep'),
    act('Project', '', '#8B7CF6', 'deep'),
    act('Exercise', '', '#5FCB8B', 'deep'),
    act('Reading', '', '#56CFB2', 'deep'),
    act('Admin', '', '#A9A8A2', 'upkeep'),
    act('Cooking', '', '#F0A44B', 'upkeep'),
    act('Errands', '', '#F08CB4', 'upkeep'),
    act('Meal', '', '#C9A27A', 'tracked', true),
    act('Break', '', '#9AA0A8', 'tracked', true),
    act('Nap', '', '#7C86C8', 'tracked', true),
    act('Social Media', '', '#F26D63', 'tracked', true)
  ];
  const tag = (name, color, actName) => ({ id: slug('tag', name), name, color, activityId: slug('act', actName) });
  const tags = [
    tag('Work', '#2BD4F0', 'Deep Work'),
    tag('Study', '#6FB1F0', 'Study'),
    tag('Project', '#8B7CF6', 'Project'),
    tag('Health', '#5FCB8B', 'Exercise'),
    tag('Admin', '#A9A8A2', 'Admin')
  ];
  const hab = (name, emoji, difficulty, color, schedule = { type: 'daily' }) =>
    ({ id: slug('hab', name), name, emoji, difficulty, color, schedule, startDate: t, history: {} });
  const habits = [
    hab('Up on the first alarm', '', 'easy', '#F0A44B'),
    hab('Phone-free first hour', '', 'medium', '#5FCB8B'),
    hab('Move for 20 minutes', '', 'hard', '#F26D63'),
    hab('Read 10 pages', '', 'easy', '#6FB1F0')
  ];
  return { activities, tags, habits };
}

/* ── normalise: fill anything a stored document is missing ── */
function fill(target, defaults) {
  Object.keys(defaults).forEach(k => {
    const dv = defaults[k];
    if (target[k] === undefined || target[k] === null) { target[k] = deepClone(dv); return; }
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && typeof target[k] === 'object' && !Array.isArray(target[k])) fill(target[k], dv);
  });
  return target;
}
export function normalize(st) {
  const d = defaultState();
  const fresh = fill(st || {}, d);
  // Maps whose keys are data, not schema, must not be "filled": but they must exist.
  fresh.columns.forEach(c => { if (!fresh.cards[c.id]) fresh.cards[c.id] = []; });
  const order = fresh.settings.tabs.order.filter(t => ALL_TABS.includes(t));
  ALL_TABS.forEach(t => { if (!order.includes(t)) order.push(t); });
  fresh.settings.tabs.order = order;
  if (!Array.isArray(fresh.settings.ranks) || !fresh.settings.ranks.length) fresh.settings.ranks = deepClone(DEFAULT_RANKS);
  return fresh;
}

/* ── the live document ── */
let state = normalize(JSON.parse(lsGet(LS_KEY) || 'null'));
/** The day's turnover follows the working hours (see util.js). */
const syncClock = () => setDayOffset(dayOffsetFor(state.settings.window));
syncClock();
const listeners = new Set();

export const S = () => state;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = kind => listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } });

/* Two contexts on one device (a tab and the installed app) share
   localStorage but hold separate in-memory copies. A small marker records
   who wrote last; if it is not us, merge their copy in before writing so
   neither side silently overwrites the other. */
const MARK_KEY = 'hq.v5.mark';
let lastMark = lsGet(MARK_KEY);
function persist() {
  syncClock();
  const mark = lsGet(MARK_KEY);
  if (mark && mark !== lastMark) {
    try { const other = JSON.parse(lsGet(LS_KEY) || 'null'); if (other) state = normalize(mergeStates(state, other, DEVICE_ID)); } catch { /* unreadable: ours stands */ }
  }
  if (!lsSet(LS_KEY, JSON.stringify(state))) { emit('quota'); return; }
  lastMark = uid();
  lsSet(MARK_KEY, lastMark);
}
/** Another tab wrote: take its copy into memory without writing back. */
export function adoptFromStorage() {
  const mark = lsGet(MARK_KEY);
  if (!mark || mark === lastMark) return false;
  try {
    const other = JSON.parse(lsGet(LS_KEY) || 'null');
    if (!other) return false;
    state = normalize(other);
    syncClock();
    lastMark = mark;
    emit('replace');
    return true;
  } catch { return false; }
}
export function save() {
  state._rev = (state._rev || 0) + 1;
  state._at = Date.now();
  state._dev = DEVICE_ID;
  persist();
  emit('save');
}
export function saveQuiet() {
  persist();
  emit('quiet');
}
/** Swap the whole document (sync merge, import, reset). */
export function replaceState(next, kind = 'replace') {
  state = normalize(next);
  persist();
  emit(kind);
}
/** Test hook: point the store at an in-memory document. */
export function _setStateForTests(next) { state = normalize(next); syncClock(); return state; }
/** For code that changes the working hours and needs the new day at once. */
export const resyncClock = syncClock;

/** Stamp an item so a merge can tell which copy was edited last. */
export const touch = o => { if (o) o._m = Date.now(); return o; };
/** Record a deletion so a merge with an older copy cannot resurrect it. */
export const tombstone = id => { if (id != null) state.tomb[String(id)] = Date.now(); };
