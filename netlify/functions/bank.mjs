/* ══════════════════════════════════════════════════════════════════════
   BANK LINK: read-only access to your own bank accounts, for the Finance
   tab, through Enable Banking (https://enablebanking.com), a licensed
   account-information provider that covers most European banks.

   What this can do: list your accounts and read their transactions.
   What it cannot do: move money. No payment permission is ever requested,
   and there is no payment code in this file.

   Security
   • The Enable Banking application id and private key live in this
     function's environment (ENABLEBANKING_APP_ID, ENABLEBANKING_PRIVATE_KEY)
     and never reach the browser.
   • Only a signed-in user of this site's own Supabase project is answered.
   • You sign in at your bank's own page. This site never sees your bank
     password; it receives a session that expires (180 days at most).
   • The session is stored in the bank_links table, which the browser has
     no access to at all (see supabase/schema.sql).

   Modes (query string `mode`):
     GET  status                 → { configured, needSchema, links }
     GET  banks&country=NL       → the banks you can link in that country
     POST start  {name,country}  → { url }: your bank's sign-in page
     POST finish {code,state}    → completes the link after the bank sends you back
     POST sync   {link,account,key} → reads one page of transactions
     POST unlink {id}            → ends the session and forgets the link
   ══════════════════════════════════════════════════════════════════════ */
import { createSign, randomBytes } from 'node:crypto';
import { env, json, userFor, db } from '../lib/auth.mjs';
import { fromBank } from '../../app/js/fincalc.js';

const EB = 'https://api.enablebanking.com';
const DAY = 86400000;
const b64u = v => Buffer.from(v).toString('base64url');

function credentials() {
  const appId = (process.env.ENABLEBANKING_APP_ID || '').trim();
  let pem = (process.env.ENABLEBANKING_PRIVATE_KEY || '').trim();
  if (pem && !pem.includes('BEGIN')) { try { pem = Buffer.from(pem, 'base64').toString('utf8'); } catch { /* leave as is */ } }
  // A settings box may flatten the file's line breaks into spaces or "\n".
  // Rebuild it: the header, the key in lines of 64, the footer.
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(pem);
  if (m) {
    const body = m[2].replace(/\\n/g, '').replace(/\s+/g, '');
    pem = `-----BEGIN ${m[1]}-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END ${m[1]}-----\n`;
  }
  return { appId, pem, ok: !!(appId && pem.includes('PRIVATE KEY')) };
}
/** Enable Banking authenticates each request with a short-lived token signed by your application's key. */
function token({ appId, pem }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const body = b64u(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 600 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(pem).toString('base64url');
  return `${head}.${body}.${sig}`;
}
async function eb(cred, method, path, body, psu = {}) {
  const r = await fetch(EB + path, {
    method,
    headers: { Authorization: 'Bearer ' + token(cred), accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...psu },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!r.ok) {
    const e = new Error(j.message || j.error || `The bank service answered ${r.status}.`);
    e.status = r.status; e.code = j.error || j.code || '';
    throw e;
  }
  return j;
}
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const publicLink = l => ({
  id: l.id, aspsp: l.aspsp, country: l.country, status: l.status, valid_until: l.valid_until, last_sync: l.last_sync, last_error: l.last_error,
  accounts: (l.accounts || []).map(a => ({ name: a.name || '', iban: a.iban ? '••' + String(a.iban).slice(-4) : '', currency: a.currency || '' }))
});

export default async req => {
  const cfg = env();
  const uid = await userFor(req, cfg);
  if (!uid) return json({ error: 'Sign in first.' }, 401);
  const cred = credentials(), sql = db(cfg);
  const q = new URL(req.url).searchParams, mode = q.get('mode') || 'status';
  const mine = `user_id=eq.${uid}`;
  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); } }

  try {
    if (mode === 'status') {
      let links = [], needSchema = false;
      try { links = await sql.select(`bank_links?select=*&${mine}&status=neq.pending&order=created_at.asc`); }
      catch { needSchema = true; }
      return json({ configured: cred.ok, needSchema, links: links.map(publicLink) });
    }
    if (!cred.ok) return json({ error: 'The bank link is not set up yet. Add ENABLEBANKING_APP_ID and ENABLEBANKING_PRIVATE_KEY to this site\'s environment variables.' }, 400);

    if (mode === 'banks') {
      const country = str(q.get('country'), 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json({ error: 'Pick a country.' }, 400);
      const j = await eb(cred, 'GET', `/aspsps?country=${country}&psu_type=personal`);
      return json({ banks: (j.aspsps || []).map(a => ({ name: a.name, country: a.country, days: Math.floor((a.maximum_consent_validity || 0) / 86400), beta: !!a.beta })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    if (mode === 'start') {
      const name = str(body.name), country = str(body.country, 2).toUpperCase();
      if (!name || !/^[A-Z]{2}$/.test(country)) return json({ error: 'Pick a bank.' }, 400);
      const list = await eb(cred, 'GET', `/aspsps?country=${country}&psu_type=personal`);
      const bank = (list.aspsps || []).find(a => a.name === name);
      if (!bank) return json({ error: 'That bank is not available.' }, 400);
      const secs = Math.min(bank.maximum_consent_validity || 90 * 86400, 180 * 86400) - 3600;
      const state = randomBytes(24).toString('hex');
      // where the bank sends you back: this site's own address, which must also be listed in your Enable Banking application
      const redirect = (process.env.BANK_REDIRECT_URL || (process.env.URL || new URL(req.url).origin) + '/').trim();
      const auth = await eb(cred, 'POST', '/auth', {
        access: { valid_until: new Date(Date.now() + secs * 1000).toISOString() },
        aspsp: { name: bank.name, country: bank.country }, state, redirect_url: redirect, psu_type: 'personal'
      });
      await sql.remove(`bank_links?${mine}&status=eq.pending`);              // an abandoned attempt
      await sql.insert('bank_links', { user_id: uid, aspsp: bank.name, country: bank.country, state, status: 'pending' });
      return json({ url: auth.url });
    }

    if (mode === 'finish') {
      const code = str(body.code, 2000), state = str(body.state, 100);
      if (!code || !/^[0-9a-f]{48}$/.test(state)) return json({ error: 'That link attempt is not valid. Start again.' }, 400);
      const rows = await sql.select(`bank_links?select=*&${mine}&state=eq.${state}&status=eq.pending`);
      if (!rows.length) return json({ error: 'That link attempt has expired. Start again.' }, 400);
      const s = await eb(cred, 'POST', '/sessions', { code });
      const accounts = (s.accounts || []).map(a => ({ uid: a.uid, name: a.name || '', iban: (a.account_id && a.account_id.iban) || '', currency: a.currency || '' })).filter(a => a.uid);
      await sql.patch(`bank_links?id=eq.${rows[0].id}`, { status: 'active', state: null, session_id: s.session_id, accounts, valid_until: (s.access && s.access.valid_until) || null });
      return json({ ok: true, accounts: accounts.length });
    }

    if (mode === 'sync') {
      const id = str(body.link, 60), index = Math.max(0, parseInt(body.account, 10) || 0), key = str(body.key, 2000);
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Unknown link.' }, 400);
      const rows = await sql.select(`bank_links?select=*&${mine}&id=eq.${id}&status=eq.active`);
      const link = rows[0], acct = link && (link.accounts || [])[index];
      if (!acct) return json({ error: 'Unknown account.' }, 400);
      // first time: a year back (the bank may give less). After that: from ten days before the last read, to catch late bookings.
      const from = new Date(link.last_sync ? Date.parse(link.last_sync) - 10 * DAY : Date.now() - 365 * DAY).toISOString().slice(0, 10);
      // telling the bank you are present lifts its limit on unattended reads
      const ip = req.headers.get('x-nf-client-connection-ip') || '', ua = req.headers.get('user-agent') || '';
      const psu = { ...(ip ? { 'Psu-Ip-Address': ip } : {}), ...(ua ? { 'Psu-User-Agent': ua.slice(0, 200) } : {}) };
      let page;
      try {
        page = await eb(cred, 'GET', `/accounts/${encodeURIComponent(acct.uid)}/transactions?date_from=${from}${key ? `&continuation_key=${encodeURIComponent(key)}` : ''}`, null, psu);
      } catch (e) {
        const expired = e.status === 401 || /EXPIRED|REVOKED|CLOSED|INVALID_SESSION|UNAUTHORIZED/i.test(e.code + ' ' + e.message);
        await sql.patch(`bank_links?id=eq.${link.id}`, { last_error: e.message.slice(0, 200), ...(expired ? { status: 'expired' } : {}) });
        return json({ error: expired ? `Your link to ${link.aspsp} has expired. Link it again.` : e.message }, 502);
      }
      const label = `${link.aspsp}${acct.iban ? ' ••' + String(acct.iban).slice(-4) : ''}`;
      const txs = (page.transactions || []).filter(t => !t.status || t.status === 'BOOK').map(t => fromBank(t, label)).filter(Boolean);
      const unique = [...new Map(txs.map(t => [t.id, t])).values()];
      let added = 0;
      if (unique.length) {
        // rows already there are left alone, so a category you chose is never overwritten
        const res = await sql.insert('transactions?on_conflict=user_id,id&select=id', unique.map(t => ({ user_id: uid, id: t.id, booked: t.d, amount: t.a, currency: t.cur, name: t.n, memo: t.m, account: t.acc, category: '', manual: false, source: 'bank' })), 'resolution=ignore-duplicates,return=representation');
        added = Array.isArray(res) ? res.length : 0;
      }
      const next = page.continuation_key || null;
      if (!next && index === (link.accounts || []).length - 1) await sql.patch(`bank_links?id=eq.${link.id}`, { last_sync: new Date().toISOString(), last_error: null });
      return json({ added, next });
    }

    if (mode === 'unlink') {
      const id = str(body.id, 60);
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Unknown link.' }, 400);
      const rows = await sql.select(`bank_links?select=*&${mine}&id=eq.${id}`);
      if (rows[0] && rows[0].session_id) { try { await eb(cred, 'DELETE', `/sessions/${encodeURIComponent(rows[0].session_id)}`); } catch { /* already closed */ } }
      await sql.remove(`bank_links?${mine}&id=eq.${id}`);
      return json({ ok: true });
    }
    return json({ error: 'Unknown mode.' }, 400);
  } catch (e) {
    console.error('bank:', mode, e.message);
    const schema = /bank_links|transactions/.test(e.message) && /40[04]|returned/.test(e.message);
    return json({ error: schema ? 'The finance tables are missing. Run supabase/schema.sql again in your Supabase project.' : e.message }, 502);
  }
};
