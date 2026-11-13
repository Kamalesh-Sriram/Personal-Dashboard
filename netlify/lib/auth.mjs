/* Shared by the functions: environment, sign-in checks, database access.

   Every function that changes anything first asks Supabase "whose token
   is this?". A request without a valid signed-in session gets nothing. */

export function env() {
  const e = process.env;
  return {
    url: (e.SUPABASE_URL || '').replace(/\/+$/, ''),
    anonKey: e.SUPABASE_ANON_KEY || '',
    serviceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
    vapidPublic: e.VAPID_PUBLIC_KEY || '',
    vapidPrivate: e.VAPID_PRIVATE_KEY || '',
    // Push services want a way to reach the sender. The site's own address is a valid one.
    vapidSubject: e.VAPID_SUBJECT || e.URL || 'https://example.com'
  };
}
export const pushConfigured = cfg => !!(cfg.url && cfg.serviceKey && cfg.vapidPublic && cfg.vapidPrivate);

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The signed-in user's id for this request, or null. */
export async function userFor(req, cfg) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 4096 || !cfg.url) return null;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey || cfg.serviceKey, Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const user = await res.json();
    return user && typeof user.id === 'string' ? user.id : null;
  } catch { return null; }
}

/** Thin PostgREST wrapper. The service role key bypasses row level
 *  security, which is why it lives only in the function environment. */
export function db(cfg) {
  const call = async (method, path, body, extra) => {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method,
      headers: { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} returned ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    select: path => call('GET', path),
    upsert: (path, body) => call('POST', path, body, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    patch: (path, body) => call('PATCH', path, body, { Prefer: 'return=minimal' }),
    remove: path => call('DELETE', path, undefined, { Prefer: 'return=minimal' })
  };
}
