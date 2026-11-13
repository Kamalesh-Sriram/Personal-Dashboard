/* On-demand drain, called by the page when it queues something that
   should not wait for the next minute (a timer starting, a test). It only
   ever delivers notifications that were already due, and only a signed-in
   user can trigger it. */
import { env, json, userFor } from '../lib/auth.mjs';
import { drain } from '../lib/drain.mjs';

export default async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await userFor(req, env()))) return json({ error: 'Sign in first.' }, 401);
  try { return json(await drain()); }
  catch (e) { console.error('push-now:', e.message); return json({ error: 'Drain failed. See the function log.' }, 500); }
};
