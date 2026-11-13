/* Registers this device for push, for the signed-in user only.

   The page cannot write the subscriptions table itself: those rows are
   effectively "send anything to this phone" credentials, so the table has
   no browser-facing policies at all. This function checks who is asking,
   then writes with the service role key. */
import { env, json, userFor, db, pushConfigured } from '../lib/auth.mjs';

/* Only real push services. Without this the endpoint would be an arbitrary
   URL that the drainer POSTs to on a schedule: a relay pointed wherever
   the caller likes. */
const ALLOWED_HOSTS = [
  /(^|\.)googleapis\.com$/,                  // Chrome, Edge, Android
  /\.push\.services\.mozilla\.com$/,         // Firefox
  /\.notify\.windows\.com$/,                 // Edge (legacy)
  /\.push\.apple\.com$/                      // Safari, iPhone, iPad
];

export default async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const cfg = env();
  if (!pushConfigured(cfg)) return json({ error: 'Push is not set up on this site yet.' }, 503);
  const userId = await userFor(req, cfg);
  if (!userId) return json({ error: 'Sign in first.' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { device_id, endpoint, p256dh, auth, user_agent } = body || {};
  if (![device_id, endpoint, p256dh, auth].every(v => typeof v === 'string' && v.length > 0 && v.length < 2048)) return json({ error: 'Missing fields' }, 400);

  let url;
  try { url = new URL(endpoint); } catch { return json({ error: 'Invalid endpoint' }, 400); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some(re => re.test(url.hostname))) return json({ error: 'Endpoint host not allowed' }, 400);

  const sql = db(cfg);
  try {
    // One endpoint, one row: clearing site data mints a new device id while
    // the browser hands back the same endpoint, which would double every send.
    await sql.remove(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&device_id=neq.${encodeURIComponent(device_id)}`);
    await sql.upsert('push_subscriptions?on_conflict=device_id', {
      device_id: device_id.slice(0, 128), user_id: userId, endpoint, p256dh, auth,
      user_agent: String(user_agent || '').slice(0, 300), last_seen: new Date().toISOString()
    });
  } catch (e) {
    console.error('push-subscribe:', e.message);
    return json({ error: 'Could not store the subscription.' }, 502);
  }
  return json({ ok: true });
};
