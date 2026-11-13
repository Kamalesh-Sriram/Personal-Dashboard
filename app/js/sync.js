/* ══════════════════════════════════════════════════════════════════════
   SYNC: optional. Off until the owner connects their own Supabase
   project and signs in.

   Security model
   • The dashboard document lives in ONE row, keyed by the signed-in
     user's id. Row Level Security in the database (supabase/schema.sql)
     means a request can only ever read or write its own row.
   • The "anon"/publishable key shipped to the browser is not a secret. It
     identifies the project; it grants nothing without a signed-in session.
   • The session (access + refresh token) is kept in localStorage on this
     device, separate from the document, and is never exported.

   Talks to Supabase's REST endpoints directly with fetch: no SDK, so
   there is no third-party script on the page.
   ══════════════════════════════════════════════════════════════════════ */
import { S, replaceState, onChange, adoptFromStorage, DEVICE_ID, LS_KEY } from './store.js';
import { mergeStates } from './merge.js';
import { debounce } from './util.js';

const CFG_KEY = 'hq.v5.sync';
const PUSH_DEBOUNCE = 1500, POLL_MS = 40000;

let local = (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch { return {}; } })();
const persist = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(local)); } catch { /* ignore */ } };

let serverCfg;                 // undefined = not asked yet, null = none
let state = 'off', lastError = '', lastSync = 0, seenStamp = null, applying = false, dirty = false;
let resolveReady; export const ready = new Promise(r => { resolveReady = r; });
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const setState = (s, err = '') => { state = s; lastError = err; listeners.forEach(fn => fn()); };

/** Project settings: typed in on this device, or served by the site's own
 *  /config function from Netlify environment variables. */
export async function config() {
  if (local.url && local.key) return { url: local.url, key: local.key, vapid: local.vapid || (serverCfg && serverCfg.vapid) || '' };
  if (serverCfg === undefined) {
    try {
      const r = await fetch('/.netlify/functions/config', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      serverCfg = j && j.supabaseUrl && j.supabaseAnonKey ? { url: j.supabaseUrl.replace(/\/+$/, ''), key: j.supabaseAnonKey, vapid: j.vapidPublicKey || '' } : null;
    } catch { serverCfg = null; }
  }
  return serverCfg;
}
export function setManualConfig(url, key) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https:\/\/[a-z0-9.-]+$/i.test(u)) throw new Error('The project URL should look like https://xxxx.supabase.co');
  local.url = u; local.key = String(key || '').trim();
  persist();
}
export const manualConfig = () => ({ url: local.url || '', key: local.key || '' });
export const signedIn = () => !!(local.session && local.session.refresh_token);
export function status() {
  return { state, error: lastError, lastSync, signedIn: signedIn(), email: signedIn() ? local.session.user.email : '', configured: !!(local.url || serverCfg) };
}

/* ── auth ── */
async function authCall(path, body, bearer) {
  const cfg = await config();
  if (!cfg) throw new Error('Sync is not set up yet. Add your Supabase project first.');
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.msg || json.error_description || json.message || json.error || `Request failed (${res.status})`);
  return json;
}
function storeSession(j) {
  if (!j || !j.access_token) return false;
  local.session = {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user.id, email: j.user.email }
  };
  persist();
  return true;
}
export async function signIn(email, password) {
  storeSession(await authCall('token?grant_type=password', { email, password }));
  await start();
}
/** Returns true if signed in straight away, false if the project wants the
 *  address confirmed by email first. */
export async function signUp(email, password) {
  const j = await authCall('signup', { email, password });
  if (storeSession(j)) { await start(); return true; }
  return false;
}
export async function resetPassword(email) {
  await authCall('recover', { email });
}
export async function updatePassword(password) {
  const cfg = await config(), tok = await token();
  const res = await fetch(`${cfg.url}/auth/v1/user`, { method: 'PUT', headers: { apikey: cfg.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).msg || 'Could not update the password');
}
export async function signOut() {
  try { if (signedIn()) await authCall('logout', {}, local.session.access_token); } catch { /* already invalid */ }
  delete local.session; persist();
  seenStamp = null;
  setState('off');
}

let refreshing = null;
export async function token() {
  if (!signedIn()) throw new Error('Not signed in');
  if (local.session.expires_at - 60 > Date.now() / 1000) return local.session.access_token;
  if (!refreshing) {
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: local.session.refresh_token })
      .then(storeSession)
      .catch(e => {
        // A rejected refresh token means the session is over; a network error does not.
        if (!/fetch|network|Failed/i.test(e.message)) { delete local.session; persist(); setState('error', 'Signed out: sign in again'); }
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  return local.session.access_token;
}

/** Authenticated PostgREST call. */
export async function rest(method, path, body, prefer) {
  const cfg = await config(), tok = await token();
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method, keepalive: method !== 'GET',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Prefer: prefer || 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/* ── the document ── */
const uidq = () => `user_id=eq.${local.session.user.id}`;

async function pull() {
  const head = await (await rest('GET', `dashboards?select=updated_at&${uidq()}`, undefined, 'return=representation')).json();
  if (!head.length) return 'empty';
  if (head[0].updated_at === seenStamp) return 'same';
  const rows = await (await rest('GET', `dashboards?select=state,updated_at&${uidq()}`, undefined, 'return=representation')).json();
  if (!rows.length) return 'empty';
  seenStamp = rows[0].updated_at;
  const remote = rows[0].state;
  if (!remote || typeof remote !== 'object') return 'empty';
  const mine = S();
  if (remote._rev === mine._rev && remote._at === mine._at) return 'same';
  const merged = mergeStates(mine, remote, DEVICE_ID);
  applying = true;
  try { replaceState(merged, 'sync'); } finally { applying = false; }
  // If the merge holds anything the cloud copy does not, it must go back up.
  // Compared in a canonical form: key order differs between merges, and a
  // naive string compare would have two devices re-pushing to each other forever.
  return canon(S()) !== canon(remote) ? 'merged' : 'adopted';
}
const canon = s => JSON.stringify(s, (k, v) => {
  if (k === '_rev' || k === '_at' || k === '_dev') return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {});
  return v;
});

async function push() {
  const doc = S(), stamp = new Date().toISOString();
  await rest('POST', 'dashboards?on_conflict=user_id', { user_id: local.session.user.id, state: doc, rev: doc._rev || 0, updated_at: stamp }, 'resolution=merge-duplicates,return=minimal');
  seenStamp = stamp;
  dirty = false;
}

let busy = false, again = false;
/** Pull, merge, and push back if needed. Single-flight. */
async function cycle(wantPush) {
  if (!signedIn()) return;
  if (busy) { again = again || wantPush; return; }
  busy = true;
  setState('syncing');
  try {
    const r = await pull();
    if (wantPush || dirty || r === 'empty' || r === 'merged') await push();
    lastSync = Date.now();
    setState('idle');
  } catch (e) {
    setState(navigator.onLine === false ? 'offline' : 'error', e.message);
  } finally {
    busy = false;
    if (again) { again = false; cycle(true); }
  }
}
export const pullNow = () => cycle(false);
export const pushNow = () => cycle(true);
const schedulePush = debounce(() => cycle(true), PUSH_DEBOUNCE);

async function start() {
  if (!signedIn() || !(await config())) { setState('off'); resolveReady(); return; }
  await cycle(false);
  resolveReady();
}

/** A password-reset or email-confirmation link lands back here with the
 *  session in the URL fragment. Returns 'recovery' when a new password is due. */
function consumeAuthHash() {
  if (!/access_token=/.test(location.hash)) return null;
  const q = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname);
  const access_token = q.get('access_token'), refresh_token = q.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  try {
    const claims = JSON.parse(atob(access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    storeSession({ access_token, refresh_token, expires_at: claims.exp, user: { id: claims.sub, email: claims.email } });
  } catch { return null; }
  return q.get('type') === 'recovery' ? 'recovery' : 'confirmed';
}

export function initSync() {
  const landed = consumeAuthHash();

  // Another tab or the installed app on this device wrote: adopt it.
  window.addEventListener('storage', e => { if (e.key === LS_KEY || e.key === 'hq.v5.mark') adoptFromStorage(); });

  onChange(kind => {
    if (applying || kind === 'quota' || !signedIn()) return;
    if (kind === 'save') { dirty = true; schedulePush(); }
    else if (kind === 'quiet' || kind === 'replace') { dirty = true; schedulePush(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cycle(false);
    else if (dirty && signedIn()) cycle(true);        // leaving: get it out now (fetch keepalive)
  });
  window.addEventListener('online', () => cycle(false));
  window.addEventListener('pagehide', () => { if (dirty && signedIn()) cycle(true); });
  setInterval(() => { if (document.visibilityState === 'visible') cycle(false); }, POLL_MS);

  start();
  return landed;
}
