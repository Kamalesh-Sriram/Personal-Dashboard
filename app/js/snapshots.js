/* ══════════════════════════════════════════════════════════════════════
   RESTORE POINTS: copies of the whole dashboard kept on this device, so a
   bad sync, a wrong button or a lost sign-in can always be undone.

   One is taken at the start of each day, and one just before anything
   replaces the dashboard wholesale: loading the account's copy, sending
   this device's copy over the account's (the account's copy is kept),
   importing a backup, or restoring an earlier point. The newest 14 are
   kept, in IndexedDB, which holds far more than localStorage.
   ══════════════════════════════════════════════════════════════════════ */
import { idbGet, idbSet } from './idb.js';
import { S } from './store.js';
import { today } from './util.js';

const KEY = 'restore-points', KEEP = 14;

/** How much a copy holds, for the list and for the warnings before a replace. */
export function counts(st) {
  return {
    tasks: Object.values((st && st.cards) || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0),
    goals: ((st && st.goals) || []).length,
    habits: ((st && st.habits) || []).length,
    activities: ((st && st.activities) || []).length
  };
}
const worthKeeping = st => { const c = counts(st); return !!(st && st.profile && st.profile.onboarded) && c.tasks + c.goals + c.habits + c.activities > 0; };

export async function list() {
  const all = await idbGet(KEY);
  return Array.isArray(all) ? all : [];
}
/** Keep a copy. A daily point replaces an earlier one from the same day. */
export async function keep(reason, state = S()) {
  try {
    if (!worthKeeping(state)) return;
    const copy = JSON.parse(JSON.stringify(state)), day = today();
    const rest = (await list()).filter(p => !(reason === 'daily' && p.reason === 'daily' && p.day === day));
    rest.unshift({ id: Date.now().toString(36), at: Date.now(), day, reason, counts: counts(copy), state: copy });
    await idbSet(KEY, rest.slice(0, KEEP));
  } catch { /* storage full or blocked: never let a safety copy break the app */ }
}
export async function get(id) {
  return (await list()).find(p => p.id === id) || null;
}

/** Items in `a` that `b` does not have, by kind. Used to warn before a replace. */
export function missingFrom(a, b) {
  const ids = (list, key = 'id') => new Set((list || []).map(x => x && String(x[key])));
  const cards = st => Object.values((st && st.cards) || {}).flat().filter(Boolean);
  const gone = (from, to) => from.filter(x => x && x.id != null && !ids(to).has(String(x.id))).length;
  return {
    tasks: gone(cards(a), cards(b)),
    goals: gone((a && a.goals) || [], (b && b.goals) || []),
    habits: gone((a && a.habits) || [], (b && b.habits) || []),
    activities: gone((a && a.activities) || [], (b && b.activities) || [])
  };
}
export const total = c => Object.values(c || {}).reduce((n, v) => n + (v || 0), 0);
export function describe(c) {
  const parts = [['tasks', 'task'], ['goals', 'goal'], ['habits', 'habit'], ['activities', 'activity']]
    .filter(([k]) => c[k] > 0).map(([k, one]) => `${c[k]} ${c[k] === 1 ? one : k}`);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || 'nothing';
}
