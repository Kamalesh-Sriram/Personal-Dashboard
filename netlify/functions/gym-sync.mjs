/* Reads the owner's workouts from Hevy for the Gym tab.

   The Hevy API key is a secret, so it lives here (the HEVY_API_KEY
   environment variable) and never reaches the browser. Only a signed-in
   user of this site's own Supabase project can call this, and it can only
   read: there is no code path that writes to Hevy.

   The key belongs to whoever deployed the site. If sign-ups are open on
   your Supabase project, anyone who makes an account could read these
   workouts, so keep sign-ups off (see SECURITY.md).

   An openGym server you run yourself can be read the same way, with one of
   its scoped API tokens (OPENGYM_URL and OPENGYM_TOKEN). The token should be
   allowed to view workouts and plans and nothing else.

   Modes (query string):
     mode=status                       → { configured, opengym }
     mode=opengym                      → every workout on your openGym server
     mode=opengym-rev                  → its revision, to skip the read when nothing changed
     mode=names&ids=0025,0031          → names of openGym's built-in exercises (public data, no sign-in)
     mode=workouts&page=1&n=3          → up to n pages of 10, newest first
     mode=events&since=ISO&page=1      → what changed since then
     mode=templates&page=1             → exercise names and muscle groups */
import { env, json, userFor } from '../lib/auth.mjs';
import { fromHevy, fromOpenGym } from '../../app/js/gymcalc.js';

const API = 'https://api.hevyapp.com';
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));

/* openGym numbers its built-in exercises ("0025") and keeps their names in its
   public catalogue. This looks a few up. It is the one mode that needs no
   sign-in: it returns nothing but exercise names from a public repository. */
const CATALOGUE = 'https://raw.githubusercontent.com/DuarteSantos8/openGym/main/catalogue/exercises/';
async function exerciseNames(ids) {
  const out = {};
  await Promise.all(ids.map(async id => {
    try {
      const r = await fetch(CATALOGUE + id + '.json', { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      const j = await r.json(), name = typeof j.name === 'string' ? j.name : j.name && (j.name.en || Object.values(j.name)[0]);
      if (typeof name === 'string' && name.trim()) out[id] = name.trim().slice(0, 80);
    } catch { /* leave it unnamed */ }
  }));
  return out;
}

export default async req => {
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  const q = new URL(req.url).searchParams, mode = q.get('mode') || 'status';
  if (mode === 'names') {
    const ids = [...new Set((q.get('ids') || '').split(',').filter(x => /^\d{1,6}$/.test(x)))].slice(0, 40);
    return json({ names: ids.length ? await exerciseNames(ids) : {} });
  }
  if (!(await userFor(req, env()))) return json({ error: 'Sign in first.' }, 401);
  const key = (process.env.HEVY_API_KEY || '').trim();
  const ogUrl = (process.env.OPENGYM_URL || '').trim().replace(/\/+$/, ''), ogToken = (process.env.OPENGYM_TOKEN || '').trim();
  const ogOk = /^https:\/\/[^\s/]+/.test(ogUrl) && !!ogToken;
  if (mode === 'status') return json({ configured: !!key, opengym: ogOk });
  if (mode === 'opengym' || mode === 'opengym-rev') {
    if (!ogOk) return json({ error: 'openGym is not connected yet. Add OPENGYM_URL (https) and OPENGYM_TOKEN to this site\'s environment variables.' }, 400);
    try {
      const r = await fetch(ogUrl + (mode === 'opengym' ? '/api/token/data' : '/api/token/data/rev'), { headers: { Authorization: 'Bearer ' + ogToken, accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) throw new Error('Your openGym server refused the token. Make a new one under Settings > API tokens, allowed to view workouts.');
      if (r.status === 429) throw new Error('Your openGym server is rate-limiting reads. Try again in a minute.');
      if (!r.ok) throw new Error('Your openGym server answered ' + r.status + '.');
      const j = await r.json();
      if (mode === 'opengym-rev') return json({ rev: j.rev ?? null });
      if (!j.state) return json({ rev: j.rev ?? null, workouts: [] });
      let workouts = [];
      try { workouts = fromOpenGym(j.state).workouts; } catch { /* a profile with no workouts yet */ }
      return json({ rev: j.rev ?? null, workouts });
    } catch (e) {
      console.error('gym-sync opengym:', e.message);
      return json({ error: /fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(e.message) ? 'Could not reach your openGym server at OPENGYM_URL. It has to be reachable from the internet over https.' : e.message }, 502);
    }
  }
  if (!key) return json({ error: 'Hevy is not connected yet. Add HEVY_API_KEY to this site\'s environment variables.' }, 400);

  const hevy = async path => {
    const r = await fetch(API + path, { headers: { 'api-key': key, accept: 'application/json' } });
    if (r.status === 404) return null;                       // a page past the end
    if (r.status === 401 || r.status === 403) throw new Error('Hevy rejected the API key. Check HEVY_API_KEY, and that your Hevy Pro subscription is active.');
    if (r.status === 429) throw new Error('Hevy is rate-limiting requests. Try again in a minute.');
    if (!r.ok) throw new Error('Hevy answered ' + r.status + '.');
    return r.json();
  };
  const page = int(q.get('page'), 1, 100000);
  try {
    if (mode === 'workouts') {
      const n = int(q.get('n'), 1, 4);
      const got = await Promise.all(Array.from({ length: n }, (_, i) => hevy(`/v1/workouts?page=${page + i}&pageSize=10`)));
      const pages = Math.max(0, ...got.map(g => (g && g.page_count) || 0));
      return json({ page, page_count: pages, next: page + n <= pages ? page + n : null, workouts: got.flatMap(g => (g && g.workouts ? g.workouts.map(fromHevy) : [])) });
    }
    if (mode === 'events') {
      const since = q.get('since') || '';
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(since)) return json({ error: 'Bad "since".' }, 400);
      const g = await hevy(`/v1/workouts/events?page=${page}&pageSize=10&since=${encodeURIComponent(since)}`);
      const events = (g && g.events) || [], pages = (g && g.page_count) || 0;
      return json({
        page, page_count: pages, next: page < pages ? page + 1 : null,
        updated: events.filter(e => e.type === 'updated' && e.workout).map(e => fromHevy(e.workout)),
        deleted: events.filter(e => e.type === 'deleted' && e.id).map(e => String(e.id))
      });
    }
    if (mode === 'templates') {
      const g = await hevy(`/v1/exercise_templates?page=${page}&pageSize=100`);
      const pages = (g && g.page_count) || 0;
      return json({
        page, page_count: pages, next: page < pages ? page + 1 : null,
        templates: ((g && g.exercise_templates) || []).map(t => ({ id: String(t.id), title: t.title || '', muscle: t.primary_muscle_group || '', kind: t.type || '' }))
      });
    }
    return json({ error: 'Unknown mode.' }, 400);
  } catch (e) {
    console.error('gym-sync:', e.message);
    return json({ error: e.message }, 502);
  }
};
