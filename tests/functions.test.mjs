/* The gym and bank functions, run against a faked network: no real Hevy,
   bank or database is contacted. Checks that nothing is answered without a
   sign-in, that the bank token verifies with the application key, and the
   whole link flow: start, finish, read two pages, read again, unlink. */
import { test } from 'node:test';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import assert from 'node:assert/strict';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
Object.assign(process.env, {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  HEVY_API_KEY: 'hevy-key', ENABLEBANKING_APP_ID: 'app-123', ENABLEBANKING_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'), URL: 'https://site.example'
});
const UID = '11111111-2222-3333-4444-555555555555', LINK = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const calls = [];
const tables = { bank_links: [], transactions: [] };
const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url: String(url), headers: init.headers || {}, body });
  if (u.host === 'proj.supabase.co' && u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer good' ? J({ id: UID }) : J({}, 401);
  if (u.host === 'proj.supabase.co' && u.pathname.startsWith('/rest/v1/')) {
    assert.equal(init.headers.apikey, 'service');
    const table = u.pathname.split('/').pop();
    if (method === 'GET') {
      let rows = tables[table];
      for (const [k, v] of u.searchParams) { if (k === 'select' || k === 'order') continue; const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)]; rows = rows.filter(r => (op === 'eq' ? String(r[k]) === val : op === 'neq' ? String(r[k]) !== val : true)); }
      return J(rows);
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body], added = [];
      list.forEach(r => { if (table === 'transactions' && tables.transactions.some(x => x.id === r.id)) return; const row = { id: table === 'bank_links' ? LINK : r.id, created_at: 'now', accounts: [], ...r }; tables[table].push(row); added.push(row); });
      return /representation/.test(init.headers.Prefer || '') ? J(added) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') { const id = u.searchParams.get('id').slice(3); Object.assign(tables[table].find(r => r.id === id), body); return new Response(null, { status: 204 }); }
    if (method === 'DELETE') { const st = u.searchParams.get('status'); tables[table] = tables[table].filter(r => (st ? r.status !== st.slice(3) : r.id !== (u.searchParams.get('id') || '').slice(3))); return new Response(null, { status: 204 }); }
  }
  if (u.host === 'api.enablebanking.com') {
    const [h, p, sig] = init.headers.Authorization.slice(7).split('.');
    assert.ok(createVerify('RSA-SHA256').update(h + '.' + p).verify(publicKey, sig, 'base64url'), 'the token must verify with the application key');
    const head = JSON.parse(Buffer.from(h, 'base64url')), pay = JSON.parse(Buffer.from(p, 'base64url'));
    assert.deepEqual(head, { typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    assert.equal(pay.iss, 'enablebanking.com'); assert.equal(pay.aud, 'api.enablebanking.com'); assert.ok(pay.exp - pay.iat <= 86400);
    if (u.pathname === '/aspsps') return J({ aspsps: [{ name: 'ABN AMRO', country: 'NL', maximum_consent_validity: 15552000 }, { name: 'Revolut', country: 'NL', maximum_consent_validity: 7776000 }] });
    if (u.pathname === '/auth') { assert.equal(body.redirect_url, 'https://site.example/'); assert.equal(body.aspsp.name, 'ABN AMRO'); assert.ok(Date.parse(body.access.valid_until) > Date.now() + 170 * 86400000); return J({ url: 'https://bank.example/login?x=1', authorization_id: 'a1' }); }
    if (u.pathname === '/sessions' && method === 'POST') { assert.equal(body.code, 'the-code'); return J({ session_id: 'sess-1', accounts: [{ uid: 'acc-uid-1', name: 'Main', currency: 'EUR', account_id: { iban: 'NL00ABNA0123456789' } }], access: { valid_until: '2027-05-01T00:00:00Z' } }); }
    if (u.pathname === '/accounts/acc-uid-1/transactions') {
      assert.ok(/^\d{4}-\d\d-\d\d$/.test(u.searchParams.get('date_from')));
      if (!u.searchParams.get('continuation_key')) return J({ continuation_key: 'next-1', transactions: [
        { entry_reference: 'E1', transaction_amount: { currency: 'EUR', amount: '23.45' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-03', creditor: { name: 'Albert Heijn' }, remittance_information: ['Betaalpas'] },
        { entry_reference: 'E2', transaction_amount: { currency: 'EUR', amount: '5.00' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-11-04', creditor: { name: 'Pending shop' } }] });
      return J({ transactions: [{ entry_reference: 'E3', transaction_amount: { currency: 'EUR', amount: '2450.00' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-25', debtor: { name: 'Werkgever BV' }, remittance_information: ['Salaris'] }] });
    }
    if (u.pathname === '/sessions/sess-1' && method === 'DELETE') return J({ message: 'OK' });
  }
  if (u.host === 'api.hevyapp.com') {
    assert.equal(init.headers['api-key'], 'hevy-key');
    const page = +u.searchParams.get('page');
    if (u.pathname === '/v1/workouts') return page > 2 ? new Response(null, { status: 404 }) : J({ page, page_count: 2, workouts: [{ id: 'w' + page, title: 'Push', start_time: '2026-11-10T17:00:00Z', end_time: '2026-11-10T18:00:00Z', exercises: [{ title: 'Bench', exercise_template_id: 'T1', sets: [{ type: 'normal', weight_kg: 80, reps: 8 }] }] }] });
    if (u.pathname === '/v1/workouts/events') return J({ page: 1, page_count: 1, events: [{ type: 'updated', workout: { id: 'w9', title: 'Pull', start_time: '2026-11-12T17:00:00Z', end_time: '2026-11-12T18:00:00Z', exercises: [] } }, { type: 'deleted', id: 'w1' }] });
    if (u.pathname === '/v1/exercise_templates') return J({ page: 1, page_count: 1, exercise_templates: [{ id: 'T1', title: 'Bench', primary_muscle_group: 'chest', type: 'weight_reps' }] });
  }
  throw new Error('unexpected request: ' + method + ' ' + url);
};

const gym = (await import('../netlify/functions/gym-sync.mjs')).default;
const bank = (await import('../netlify/functions/bank.mjs')).default;
const req = (fn, q, { method = 'GET', body, token = 'good' } = {}) => fn(new Request('https://site.example/.netlify/functions/x?' + q, { method, headers: { Authorization: 'Bearer ' + token, 'user-agent': 'test', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).then(async r => ({ status: r.status, body: await r.json() }));

test('gym and bank functions: sign-in gate, signed bank token, full link flow', async () => {
  // nobody gets anything without signing in
  assert.equal((await req(gym, 'mode=workouts', { token: 'bad' })).status, 401);
  assert.equal((await req(bank, 'mode=status', { token: 'bad' })).status, 401);
  
  // gym
  assert.deepEqual((await req(gym, 'mode=status')).body, { configured: true });
  let r = await req(gym, 'mode=workouts&page=1&n=3');
  assert.equal(r.body.workouts.length, 2); assert.equal(r.body.next, null); assert.equal(r.body.workouts[0].ex[0].sets[0].kg, 80);
  r = await req(gym, 'mode=events&since=2026-11-01T00:00:00Z');
  assert.equal(r.body.updated[0].id, 'w9'); assert.deepEqual(r.body.deleted, ['w1']);
  assert.equal((await req(gym, 'mode=events&since=yesterday')).status, 400);
  assert.equal((await req(gym, 'mode=templates')).body.templates[0].muscle, 'chest');
  
  // bank: status, list, start, finish, sync (two pages), sync again (nothing new), unlink
  r = await req(bank, 'mode=status'); assert.equal(r.body.configured, true); assert.deepEqual(r.body.links, []);
  r = await req(bank, 'mode=banks&country=nl'); assert.deepEqual(r.body.banks.map(b => b.name), ['ABN AMRO', 'Revolut']); assert.equal(r.body.banks[0].days, 180);
  assert.equal((await req(bank, 'mode=start', { method: 'POST', body: { name: 'Nope Bank', country: 'NL' } })).status, 400);
  r = await req(bank, 'mode=start', { method: 'POST', body: { name: 'ABN AMRO', country: 'NL' } });
  assert.equal(r.body.url, 'https://bank.example/login?x=1');
  const state = tables.bank_links[0].state; assert.match(state, /^[0-9a-f]{48}$/); assert.equal(tables.bank_links[0].status, 'pending');
  assert.equal((await req(bank, 'mode=finish', { method: 'POST', body: { code: 'the-code', state: 'f'.repeat(48) } })).status, 400);   // someone else's state
  r = await req(bank, 'mode=finish', { method: 'POST', body: { code: 'the-code', state } });
  assert.deepEqual(r.body, { ok: true, accounts: 1 }); assert.equal(tables.bank_links[0].status, 'active'); assert.equal(tables.bank_links[0].state, null);
  r = await req(bank, 'mode=status');
  assert.equal(r.body.links[0].accounts[0].iban, '••6789'); assert.equal(JSON.stringify(r.body).includes('sess-1'), false, 'the session never goes to the browser');
  r = await req(bank, 'mode=sync', { method: 'POST', body: { link: LINK, account: 0, key: '' } });
  assert.deepEqual(r.body, { added: 1, next: 'next-1' });                                    // the pending one is skipped
  r = await req(bank, 'mode=sync', { method: 'POST', body: { link: LINK, account: 0, key: 'next-1' } });
  assert.deepEqual(r.body, { added: 1, next: null }); assert.ok(tables.bank_links[0].last_sync);
  assert.equal(tables.transactions.length, 2);
  assert.deepEqual(tables.transactions.map(t => [t.amount, t.name, t.source, t.user_id === UID]), [[-23.45, 'Albert Heijn', 'bank', true], [2450, 'Werkgever BV', 'bank', true]]);
  r = await req(bank, 'mode=sync', { method: 'POST', body: { link: LINK, account: 0, key: '' } });
  assert.equal(r.body.added, 0);                                                            // already there: left alone
  const psu = calls.filter(c => c.url.includes('enablebanking.com/accounts/')).pop().headers;
  assert.equal(psu['Psu-User-Agent'], 'test');
  r = await req(bank, 'mode=unlink', { method: 'POST', body: { id: LINK } });
  assert.deepEqual(r.body, { ok: true }); assert.equal(tables.bank_links.length, 0);
});
