/* Reads the owner's workouts from Hevy for the Gym tab.

   The Hevy API key is a secret, so it lives here (the HEVY_API_KEY
   environment variable) and never reaches the browser. Only a signed-in
   user of this site's own Supabase project can call this, and it can only
   read: there is no code path that writes to Hevy.

   The key belongs to whoever deployed the site. If sign-ups are open on
   your Supabase project, anyone who makes an account could read these
   workouts, so keep sign-ups off (see SECURITY.md).

   Modes (query string):
     mode=status                       → { configured }
     mode=workouts&page=1&n=3          → up to n pages of 10, newest first
     mode=events&since=ISO&page=1      → what changed since then
     mode=templates&page=1             → exercise names and muscle groups */
import { env, json, userFor } from '../lib/auth.mjs';
import { fromHevy } from '../../app/js/gymcalc.js';

const API = 'https://api.hevyapp.com';
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));

export default async req => {
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (!(await userFor(req, env()))) return json({ error: 'Sign in first.' }, 401);
  const key = (process.env.HEVY_API_KEY || '').trim();
  const q = new URL(req.url).searchParams, mode = q.get('mode') || 'status';
  if (mode === 'status') return json({ configured: !!key });
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
