/* ══════════════════════════════════════════════════════════════════════
   FINANCE: where transactions live and how they get here.

   Ways in:
   • A statement file from any bank (CSV, ABN AMRO TXT, Revolut CSV, CAMT.053).
     Works with nothing set up.
   • A linked bank, through this site's own `bank` function and the Enable
     Banking service (read-only). Needs sync on and the function configured.

   Storage:
   • Always: a copy in IndexedDB on this device, which is what the tab reads.
   • With sync on and the `transactions` table present (supabase/schema.sql):
     every row is also kept in your own database, protected by the same
     row-level rules as the dashboard, so all your devices show the same.

   Categories and the rules that sort merchants into them are small, so they
   live in the synced dashboard document (S().finance).
   ══════════════════════════════════════════════════════════════════════ */
import { idbGet, idbSet, idbDel } from './idb.js';
import { S, save } from './store.js';
import * as Sync from './sync.js';
import * as F from './fincalc.js';

const KEY = 'fin';
const blank = () => ({ txs: [], pulledAt: null, remote: null });
let data = null;
export const status = { busy: false, progress: '', error: '', bank: null };   // bank: { configured, needSchema, links }
const listeners = new Set();
export const onFin = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export const cached = () => data;
export const cats = () => S().finance.cats;
export const rules = () => S().finance.rules;
export async function load() {
  if (!data) data = { ...blank(), ...((await idbGet(KEY)) || {}) };
  return data;
}
const store = async () => { data.txs.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)); await idbSet(KEY, data); changed(); };

/* ── your own database (optional) ── */
const toRow = t => ({ id: t.id, booked: t.d, amount: t.a, currency: t.cur, name: t.n, memo: t.m, account: t.acc, category: t.cat || '', manual: !!t.man, source: t.src || 'file', updated_at: new Date().toISOString() });
const fromRow = r => ({ id: r.id, d: r.booked, a: +r.amount, cur: r.currency, n: r.name, m: r.memo, acc: r.account, cat: r.category || '', man: !!r.manual, src: r.source });
const missing = e => /PGRST205|42P01|404|does not exist|schema cache/i.test(e.message);
const remoteOn = () => Sync.signedIn() && data && data.remote !== false;

async function pushRows(list) {
  if (!remoteOn() || !list.length) return;
  try {
    for (let i = 0; i < list.length; i += 400) {
      await Sync.rest('POST', 'transactions?on_conflict=user_id,id', list.slice(i, i + 400).map(toRow), 'resolution=merge-duplicates,return=minimal');
    }
    data.remote = true;
  } catch (e) { if (missing(e)) data.remote = false; else throw e; }
}
/* "The database has no transactions table" is remembered so it is not asked
   on every change, but it is asked again once each time the app opens: the
   table may have been added since (by running supabase/schema.sql). */
let retried = false;
/** Bring this device in line with the account's copy. */
export async function pull({ full = false } = {}) {
  await load();
  if (!Sync.signedIn()) return;
  if (data.remote === false) { if (retried) return; retried = true; }
  try {
    const since = full ? null : data.pulledAt, started = new Date(Date.now() - 60000).toISOString();
    const got = [];
    for (let off = 0; off < 200000; off += 1000) {
      const res = await Sync.rest('GET', `transactions?select=id,booked,amount,currency,name,memo,account,category,manual,source${since ? `&updated_at=gt.${encodeURIComponent(since)}` : ''}&order=updated_at.asc,id.asc&limit=1000&offset=${off}`, undefined, 'count=exact');
      const rows = await res.json();
      rows.forEach(r => got.push(fromRow(r)));
      if (rows.length < 1000) {
        // fewer rows in the account than here means something was deleted elsewhere: start over from its copy
        const total = +(res.headers.get('content-range') || '').split('/')[1];
        if (since && isFinite(total) && !got.length && total < data.txs.filter(t => t.src !== 'local').length) return pull({ full: true });
        break;
      }
    }
    data.remote = true;
    if (!since) {
      // anything only this device holds (imported before sync was on) goes up
      const have = new Set(got.map(t => t.id)), mine = data.txs.filter(t => !have.has(t.id));
      data.txs = [...got, ...mine];
      await pushRows(mine);
    } else if (got.length) {
      const by = new Map(data.txs.map(t => [t.id, t]));
      got.forEach(t => by.set(t.id, t));
      data.txs = [...by.values()];
    }
    data.pulledAt = started;
    // rows that arrived from the bank have no category yet
    const fixed = F.recategorise(data.txs.filter(t => !t.cat), rules());
    await pushRows(fixed);
    await store();
  } catch (e) {
    if (missing(e)) { data.remote = false; await store(); } else status.error = e.message;
    changed();
  }
}

/* ── files ── */
/** Read a statement. Returns { added, format } or { needMap, header, rows, guess }. */
export async function importFile(file, map = null) {
  if (!file) return { added: 0 };
  if (file.size > 40 * 1024 * 1024) throw new Error('That file is too large to be a statement.');
  const text = typeof file === 'string' ? file : await file.text();
  const res = F.readStatement(text, { rules: rules(), map, xml: t => new DOMParser().parseFromString(t, 'application/xml') });
  if (res.needMap) return { ...res, text };
  return { added: await addTxs(res.txs), format: res.format, total: res.txs.length };
}
async function addTxs(list) {
  await load();
  const have = new Set(data.txs.map(t => t.id)), fresh = list.filter(t => !have.has(t.id));
  if (!fresh.length) return 0;
  data.txs = [...data.txs, ...fresh];
  await store();
  try { await pushRows(fresh); await store(); } catch (e) { status.error = 'Saved on this device, but not to your account: ' + e.message; changed(); }
  return fresh.length;
}

/* ── categories ── */
/** Put a transaction in a category. With `always`, every transaction from
 *  that merchant follows, now and in future. */
export async function setCategory(id, cat, always = false) {
  await load();
  const t = data.txs.find(x => x.id === id);
  if (!t) return 0;
  t.cat = cat; t.man = true;
  const touched = [t];
  if (always) {
    const match = F.ruleKey(t);
    if (match) {
      const st = S();
      st.finance.rules = [{ id: 'r' + Date.now().toString(36), match, cat }, ...st.finance.rules.filter(r => r.match !== match)].slice(0, 500);
      save();
      touched.push(...F.recategorise(data.txs, st.finance.rules));
    }
  }
  await store();
  try { await pushRows(touched); } catch (e) { status.error = e.message; changed(); }
  return touched.length;
}
export async function reapplyRules() {
  await load();
  const touched = F.recategorise(data.txs, rules());
  await store();
  try { await pushRows(touched); } catch (e) { status.error = e.message; changed(); }
  return touched.length;
}
export async function clearAll() {
  await load();
  if (remoteOn() && data.remote) { try { await Sync.rest('DELETE', 'transactions?id=neq.'); } catch (e) { if (!missing(e)) throw e; } }
  data = blank(); await idbDel(KEY); changed();
}

/* ── a linked bank ── */
async function bank(method, query, body) {
  const r = await fetch('/.netlify/functions/bank?' + query, {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + (await Sync.token()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'The bank function is not deployed on this site.' : `Request failed (${r.status})`));
  return j;
}
export async function bankStatus() {
  if (!Sync.signedIn()) { status.bank = null; return null; }
  try { status.bank = await bank('GET', 'mode=status'); } catch { status.bank = null; }
  changed();
  return status.bank;
}
export const bankList = country => bank('GET', 'mode=banks&country=' + encodeURIComponent(country));
/** Leaves the app for the bank's own sign-in page. It comes back with a code (see finishLink). */
export async function bankStart(name, country) {
  const j = await bank('POST', 'mode=start', { name, country });
  if (!/^https:\/\//.test(j.url || '')) throw new Error('The bank service did not return a sign-in page.');
  location.href = j.url;
}
/** Called once at start-up: if the address carries a bank's answer, finish the link. */
export async function finishLink() {
  const q = new URLSearchParams(location.search), code = q.get('code'), state = q.get('state'), err = q.get('error');
  if (!state || (!code && !err)) return null;
  history.replaceState(null, '', location.pathname + '#/finance');
  if (err) return { ok: false, error: q.get('error_description') || err };
  try { const j = await bank('POST', 'mode=finish', { code, state }); await bankStatus(); return { ok: true, accounts: j.accounts || 0 }; }
  catch (e) { return { ok: false, error: e.message }; }
}
/** Read new transactions from every linked account, a page at a time. */
export async function bankSync() {
  if (status.busy) return 0;
  status.busy = true; status.error = ''; status.progress = 'Asking your bank'; changed();
  let added = 0;
  try {
    const st = await bankStatus();
    for (const link of (st && st.links) || []) {
      if (link.status !== 'active') continue;
      for (let i = 0; i < (link.accounts || []).length; i++) {
        let key = '';
        for (let guard = 0; guard < 60; guard++) {
          const j = await bank('POST', 'mode=sync', { link: link.id, account: i, key });
          added += j.added || 0;
          status.progress = `Reading ${link.aspsp}: ${added} new`; changed();
          if (!j.next) break;
          key = j.next;
        }
      }
    }
    if (data.remote === false) data.remote = null;   // the bank just wrote to the table, so it exists
    await pull();
    await bankStatus();
  } catch (e) { status.error = e.message; }
  finally { status.busy = false; status.progress = ''; changed(); }
  return added;
}
export async function bankUnlink(id) { await bank('POST', 'mode=unlink', { id }); await bankStatus(); }
