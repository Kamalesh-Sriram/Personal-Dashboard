/* ══════════════════════════════════════════════════════════════════════
   GYM: where the workout history lives and how it gets here.

   Two ways in:
   • Hevy sync, through this site's own gym-sync function (which holds the
     Hevy API key). Needs sync to be on, because the function only answers
     a signed-in user.
   • A file: the export from Hevy or Strong. Works with nothing set up.

   The history is kept in IndexedDB on this device. It is not part of the
   synced dashboard document (it can run to megabytes). With Hevy connected
   every device simply syncs from Hevy itself.
   ══════════════════════════════════════════════════════════════════════ */
import { idbGet, idbSet, idbDel } from './idb.js';
import * as Sync from './sync.js';
import { fromFile } from './gymcalc.js';

const KEY = 'gym';
const blank = () => ({ workouts: [], templates: {}, since: null, syncedAt: 0, source: '' });
let data = null;
export const status = { configured: null, opengym: null, opengymFrom: '', busy: false, error: '', progress: '' };
const listeners = new Set();
export const onGym = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export const cached = () => data;
export async function load() {
  if (!data) data = { ...blank(), ...((await idbGet(KEY)) || {}) };
  return data;
}
const store = async () => { data.workouts.sort((a, b) => a.start - b.start); await idbSet(KEY, data); changed(); };

async function call(query) {
  const r = await fetch('/.netlify/functions/gym-sync?' + query, { headers: { Authorization: 'Bearer ' + (await Sync.token()) }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'The gym-sync function is not deployed on this site.' : `Request failed (${r.status})`));
  return j;
}
/** Is Hevy connected on this site? null = cannot tell (not signed in, or offline). */
export async function checkConfigured() {
  if (!Sync.signedIn()) { status.configured = null; return null; }
  try { const j = await call('mode=status'); status.configured = !!j.configured; status.opengym = !!j.opengym; status.opengymFrom = j.opengymFrom || ''; } catch { status.configured = null; status.opengym = null; }
  changed();
  return status.configured || status.opengym;
}
/** openGym numbers its built-in exercises. Look up the names of any that are still "Exercise 0025". */
export async function resolveNames() {
  await load();
  data.names = data.names || {};
  const need = new Set();
  data.workouts.forEach(w => w.ex.forEach(x => { if (/^Exercise \d+$/.test(x.name) && /^\d+$/.test(x.tid) && !data.names[x.tid]) need.add(x.tid); }));
  const ids = [...need];
  try {
    for (let i = 0; i < ids.length; i += 40) {
      const r = await fetch('/.netlify/functions/gym-sync?mode=names&ids=' + ids.slice(i, i + 40).join(','), { cache: 'force-cache' });
      if (!r.ok) break;
      Object.assign(data.names, (await r.json()).names || {});
    }
  } catch { /* offline, or no functions on this host: the numbers stay until next time */ }
  let n = 0;
  data.workouts.forEach(w => w.ex.forEach(x => { if (/^Exercise \d+$/.test(x.name) && data.names[x.tid]) { x.name = data.names[x.tid]; n++; } }));
  if (n) await store();
  return n;
}
/** Read everything from your own openGym server, or from the newest openGym backup in your
 *  bucket (see HOW-TO-USE.md). Skipped when nothing changed there. */
export async function syncOpenGym({ full = false } = {}) {
  if (status.busy) return;
  await load();
  status.busy = true; status.error = ''; status.progress = status.opengymFrom === 'backup' ? 'Reading your openGym backup' : 'Asking your openGym server'; changed();
  try {
    const rev = (await call('mode=opengym-rev')).rev;
    if (full || rev == null || rev !== data.ogRev || !data.workouts.some(w => String(w.id).startsWith('og-'))) {
      const j = await call('mode=opengym');
      const near = (a, b) => Math.abs(a.start - b.start) < 120000;
      const others = data.workouts.filter(w => !String(w.id).startsWith('og-') && !j.workouts.some(o => near(o, w)));
      data.workouts = [...others, ...j.workouts];
      data.ogRev = j.rev;
      if (data.source !== 'hevy') data.source = 'opengym';
    }
    data.syncedAt = Date.now();
    await store();
  } catch (e) {
    status.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the site. Check your connection and try again.' : e.message;
  } finally { status.busy = false; status.progress = ''; changed(); }
  await resolveNames();
}
/** Sync from whatever is connected on this site. */
export async function syncAll(opts) {
  if (status.configured) await syncHevy(opts);
  if (status.opengym) await syncOpenGym(opts);
}

/** Bring this device up to date with Hevy. The first run reads the whole
 *  history in batches; later runs ask only for what changed. */
export async function syncHevy({ full = false } = {}) {
  if (status.busy) return;
  await load();
  status.busy = true; status.error = ''; status.progress = 'Connecting'; changed();
  const started = Date.now();
  try {
    if (full || !data.since || data.source !== 'hevy') {
      const all = new Map();
      let page = 1, pages = 1;
      while (page) {
        const j = await call(`mode=workouts&page=${page}&n=3`);
        j.workouts.forEach(w => all.set(w.id, w));
        pages = j.page_count || pages; page = j.next;
        status.progress = `Reading your history: ${all.size} workouts`; changed();
      }
      // history imported from a file gives way to the same workouts from Hevy
      const fromFile = data.workouts.filter(w => String(w.id).startsWith('csv-') && ![...all.values()].some(h => Math.abs(h.start - w.start) < 120000));
      data.workouts = [...all.values(), ...fromFile];
    } else {
      let page = 1;
      const byId = new Map(data.workouts.map(w => [w.id, w]));
      while (page) {
        const j = await call(`mode=events&since=${encodeURIComponent(data.since)}&page=${page}`);
        j.updated.forEach(w => byId.set(w.id, w));
        j.deleted.forEach(id => byId.delete(id));
        page = j.next;
      }
      data.workouts = [...byId.values()];
    }
    // exercise names → muscle groups, fetched once and topped up when something new appears
    const unknown = data.workouts.some(w => w.ex.some(x => x.tid && !data.templates[x.tid]));
    if (unknown) {
      let page = 1;
      status.progress = 'Reading exercise details'; changed();
      while (page) {
        const j = await call(`mode=templates&page=${page}`);
        j.templates.forEach(t => { data.templates[t.id] = { title: t.title, muscle: t.muscle }; });
        page = j.next;
      }
    }
    data.since = new Date(started - 5 * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
    data.syncedAt = Date.now(); data.source = 'hevy';
    await store();
  } catch (e) {
    status.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach the site. Check your connection and try again.' : e.message;
  } finally {
    status.busy = false; status.progress = ''; changed();
  }
}

/** Add the workouts from a file: an openGym backup, or a Hevy or Strong
 *  export. A workout already here (same start time) is replaced by the
 *  file's copy, so a corrected session comes through; the rest are added. */
export async function importFile(file) {
  if (!file) return { added: 0, source: '' };
  if (file.size > 60 * 1024 * 1024) throw new Error('That file is too large to be a workout export.');
  const { workouts, source } = fromFile(await file.text());
  await load();
  const near = (a, b) => Math.abs(a.start - b.start) < 120000;
  const fresh = workouts.filter(w => !data.workouts.some(h => near(h, w)));
  // from the same kind of file, the newer copy wins; a Hevy-synced workout is left as Hevy has it
  const kept = data.workouts.filter(h => String(h.id).startsWith('csv-') || String(h.id).startsWith('og-') ? !workouts.some(w => near(h, w)) : true);
  const updated = workouts.filter(w => !fresh.includes(w) && !kept.some(h => near(h, w)));
  data.workouts = [...kept, ...updated, ...fresh];
  if (!data.source || data.source !== 'hevy') data.source = source.toLowerCase();
  await store();
  resolveNames();                                   // in the background: openGym's numbered exercises get their names
  return { added: fresh.length, source };
}
export async function clearGym() { data = blank(); await idbDel(KEY); changed(); }
