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
export async function rest(method, path, body, prefer, keepalive = false) {
  const cfg = await config(), tok = await token();
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method, keepalive,
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Prefer: prefer || 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/* ── the document ── */
const uidq = () => `user_id=eq.${local.session.user.id}`;

async function fetchRemote() {
  const rows = await (await rest('GET', `dashboards?select=state,updated_at&${uidq()}`, undefined, 'return=representation')).json();
  return rows.length && rows[0].state && typeof rows[0].state === 'object' ? rows[0] : null;
}
function adopt(next) { applying = true; try { replaceState(next, 'sync'); } finally { applying = false; } }

/* Linking. The first time a device meets an account, the two copies are
   not merged blindly: a fresh device takes the account's dashboard, a full
   device fills an empty account, and when both hold a real dashboard the
   owner is asked which one to keep. After that, changes merge item by item. */
const hasContent = st => !!(st && st.profile && st.profile.onboarded) &&
  ((st.activities || []).length + (st.habits || []).length + (st.goals || []).length +
   Object.values(st.cards || {}).reduce((n, l) => n + l.length, 0) + Object.keys(st.journal || {}).length) > 0;
let chooser = async () => 'merge', askedThisLoad = false;
export const onLinkChoice = fn => { chooser = fn; };
const isLinked = () => !!local.session && local.linked === local.session.user.id;
const markLinked = () => { local.linked = local.session.user.id; persist(); };
/** Put this device's copy ahead of the account's, so it replaces it on the next upload. */
function takeOver(remote) {
  const mine = S();
  mine._rev = Math.max(mine._rev || 0, (remote && remote._rev) || 0) + 1;
  mine._at = Date.now(); mine._dev = DEVICE_ID;
}

async function pull() {
  const head = await (await rest('GET', `dashboards?select=updated_at&${uidq()}`, undefined, 'return=representation')).json();
  if (!head.length) { markLinked(); return 'empty'; }
  if (isLinked() && head[0].updated_at === seenStamp) return 'same';
  const row = await fetchRemote();
  if (!row) { markLinked(); return 'empty'; }
  seenStamp = row.updated_at;
  const remote = row.state, mine = S();
  if (!isLinked()) {
    let choice;
    if (!hasContent(mine)) choice = 'remote';
    else if (!hasContent(remote)) choice = 'local';
    else {
      if (askedThisLoad) return 'wait';
      askedThisLoad = true;
      choice = await chooser({ local: mine.profile.name || 'Dashboard', remote: (remote.profile || {}).name || 'Dashboard', updated: row.updated_at });
      if (!choice) return 'wait';
    }
    markLinked();
    if (choice === 'remote') { adopt(remote); dirty = false; return 'adopted'; }
    if (choice === 'local') { takeOver(remote); return 'merged'; }
  }
  if (remote._rev === mine._rev && remote._at === mine._at) return 'same';
  adopt(mergeStates(mine, remote, DEVICE_ID));
  // If the merge holds anything the cloud copy does not, it must go back up.
  // Compared in a canonical form: key order differs between merges, and a
  // naive string compare would have two devices re-pushing to each other forever.
  return canon(S()) !== canon(remote) ? 'merged' : 'adopted';
}
/** Make this device's dashboard the one every device uses. */
export async function useThisDevice() {
  const row = await fetchRemote();
  takeOver(row && row.state); markLinked();
  await push();
  lastSync = Date.now(); setState('idle');
}
/** Replace this device's dashboard with the one in the account. */
export async function useAccountCopy() {
  const row = await fetchRemote();
  if (!row) throw new Error('There is no dashboard in your account yet.');
  seenStamp = row.updated_at; markLinked();
  adopt(row.state); dirty = false;
  lastSync = Date.now(); setState('idle');
}
const canon = s => JSON.stringify(s, (k, v) => {
  if (k === '_rev' || k === '_at' || k === '_dev') return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {});
  return v;
});

async function push(leaving = false) {
  const doc = S(), stamp = new Date().toISOString();
  const payload = { user_id: local.session.user.id, state: doc, rev: doc._rev || 0, updated_at: stamp };
  // "keepalive" lets a request finish after the page closes, but browsers
  // refuse it for bodies over 64 KB. A real dashboard is bigger than that,
  // so it is only used for a small one that is being sent on the way out.
  const keepalive = leaving && JSON.stringify(payload).length < 60000;
  await rest('POST', 'dashboards?on_conflict=user_id', payload, 'resolution=merge-duplicates,return=minimal', keepalive);
  seenStamp = stamp;
  dirty = false;
}

let busy = false, again = false;
/** Pull, merge, and push back if needed. Single-flight. */
async function cycle(wantPush, leaving = false) {
  if (!signedIn()) return;
  if (busy) { again = again || wantPush; return; }
  busy = true;
  setState('syncing');
  try {
    const r = await pull();
    // a device still on the welcome screens has nothing worth uploading
    if (r !== 'wait' && S().profile.onboarded && (wantPush || dirty || r === 'empty' || r === 'merged')) await push(leaving);
    lastSync = Date.now();
    setState('idle');
  } catch (e) {
    const unreachable = /Failed to fetch|NetworkError|Load failed/i.test(e.message);
    setState(navigator.onLine === false ? 'offline' : 'error', unreachable ? 'Could not reach your sync project. It will try again.' : e.message);
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
    else if (dirty && signedIn()) cycle(true, true);      // leaving: send it now
  });
  window.addEventListener('online', () => cycle(false));
  window.addEventListener('pagehide', () => { if (dirty && signedIn()) cycle(true, true); });
  setInterval(() => { if (document.visibilityState === 'visible') cycle(false); }, POLL_MS);

  start();
  return landed;
}
