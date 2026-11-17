/* FINANCE: where the money went, by month and by year. Transactions come
   from statement files or a linked bank (see fin.js); the sums and the
   sorting into categories are in fincalc.js. */
import { S, save, tombstone } from '../store.js';
import { registerActions, openModal, closeModal, toast, confirmDialog, segHtml } from '../ui.js';
import { icon } from '../icons.js';
import { esc, safeColor, today, uid, pad } from '../util.js';
import { ui, refresh } from '../bus.js';
import { donut } from '../charts.js';
import * as Fin from '../fin.js';
import * as F from '../fincalc.js';
import * as Sync from '../sync.js';

const COUNTRIES = [['NL', 'Netherlands'], ['BE', 'Belgium'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['AT', 'Austria'], ['LU', 'Luxembourg'], ['FI', 'Finland'], ['SE', 'Sweden'], ['DK', 'Denmark'], ['NO', 'Norway'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['EE', 'Estonia'], ['LV', 'Latvia'], ['LT', 'Lithuania'], ['GR', 'Greece'], ['HU', 'Hungary'], ['RO', 'Romania'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['SI', 'Slovenia'], ['SK', 'Slovakia'], ['MT', 'Malta'], ['CY', 'Cyprus'], ['GB', 'United Kingdom']];
const month = () => ui.finMonth || today().slice(0, 7);
const money = (v, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v); } catch { return v.toFixed(2) + ' ' + cur; } };
const monthName = ym => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const catOf = id => Fin.cats().find(c => c.id === id) || { id: '', name: 'No category', color: '#6B7480' };
/** Sums are done in one currency: yours, or whichever the statements mostly use. */
function mainCurrency(txs) {
  const want = (S().settings.currency || 'EUR').toUpperCase();
  if (txs.some(t => t.cur === want)) return want;
  const n = new Map(); txs.forEach(t => n.set(t.cur, (n.get(t.cur) || 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || want;
}

let wired = false, asked = false;
function ensure() {
  if (!wired) { wired = true; Fin.onFin(() => { if (ui.tab === 'finance') refresh(); }); }
  if (!Fin.cached()) { Fin.load().then(() => { if (ui.tab === 'finance') refresh(); }); return false; }
  if (!asked) {
    asked = true;
    // signed in: fetch the account's copy, and read the bank if it has been a while
    Fin.pull().then(() => Fin.bankStatus()).then(st => {
      const links = (st && st.links) || [];
      if (links.some(l => l.status === 'active' && (!l.last_sync || Date.now() - Date.parse(l.last_sync) > 6 * 3600000))) Fin.bankSync();
    });
  }
  return true;
}

function setupHtml() {
  return `<div class="card gym-setup">
      <div class="h3">See where your money goes</div>
      <p class="muted">Bring in your transactions and they are sorted into categories, by month and by year. Two ways, and either works on its own.</p>
      <div class="gym-ways">
        <div><div class="label">Import a statement</div>
          <p class="hint">Download your transactions from your bank's website and choose the file here. Works with any bank: CSV, ABN AMRO's TXT, Revolut's CSV and CAMT.053 are read as they are.</p>
          <label class="btn primary">${icon('upload')} Choose file<input type="file" accept=".csv,.txt,.xml,.tab,text/csv,text/plain,application/xml,text/xml" data-change="fin.file" hidden></label></div>
        <div><div class="label">Link your bank</div>
          <p class="hint">New transactions then arrive by themselves. Read-only, through Enable Banking, for most European banks.</p>
          <button class="btn" data-act="fin.link">${icon('link')} Link a bank</button></div>
      </div>
      ${Fin.status.error ? `<div class="notice bad">${esc(Fin.status.error)}</div>` : ''}
      <p class="hint">Nothing here is shared with anyone. Files are read on this device. If sync is on, transactions are also kept in your own database so your other devices show them.</p>
    </div>`;
}

function statsHtml(t, prev, cur, label) {
  const delta = prev.spent > 0 ? Math.round((t.spent - prev.spent) / prev.spent * 100) : null;
  const stat = (ico, eyebrow, big, small, tone = '') => `<div class="card stat"><div class="stat-ico">${icon(ico)}</div><div><span class="eyebrow">${eyebrow}</span><b class="num ${tone}">${big}</b><span>${small}</span></div></div>`;
  return `<div class="hab-sum">
    ${stat('wallet', 'Spent', money(t.spent, cur), delta === null ? `No earlier ${label} to compare` : `${delta > 0 ? '+' : ''}${delta}% on the ${label} before`)}
    ${stat('down', 'Income', money(t.income, cur), 'Money in, without transfers')}
    ${stat('gauge', 'Left over', money(t.net, cur), t.income > 0 ? `${Math.round(t.net / t.income * 100)}% of income kept` : 'No income recorded', t.net >= 0 ? 'tone-good' : 'tone-bad')}
    ${stat('list', 'Biggest category', t.rows[0] ? esc(catOf(t.rows[0].id).name) : '-', t.rows[0] ? money(t.rows[0].v, cur) : 'Nothing spent')}
  </div>`;
}
function catsHtml(t, cur) {
  if (!t.rows.length) return '<div class="empty">Nothing was spent in this period.</div>';
  const rows = t.rows.filter(r => r.v > 0), sum = rows.reduce((n, r) => n + r.v, 0) || 1;
  const parts = rows.map(r => ({ id: r.id || '-', label: catOf(r.id).name, value: r.v, color: catOf(r.id).color }));
  const draw = ui.finDraw !== false; ui.finDraw = false;
  return `<div class="fin-pie">
      <div class="pie-wrap">${donut(parts, { on: ui.finCat || null, act: 'fin.filter', draw })}
        <div class="pie-mid" id="pie-mid" data-total="${esc(money(t.spent, cur))}"><b>${esc(money(t.spent, cur))}</b><span>spent</span></div></div>
      <div class="fin-cats">${t.rows.map((r, i) => { const c = catOf(r.id), on = ui.finCat === (r.id || '-');
        return `<button class="fin-cat ${on ? 'on' : ''}" data-act="fin.filter" data-cat="${esc(r.id || '-')}" data-row="${rows.indexOf(r)}" data-name="${esc(c.name)}" data-amount="${esc(money(r.v, cur))}" data-pct="${Math.round(Math.max(0, r.v) / sum * 100)}" style="--c:${safeColor(c.color)}" aria-pressed="${on}">
          <span class="dot" style="background:var(--c)"></span><span class="fin-cat-n ell">${esc(c.name)}</span>
          <b>${money(r.v, cur)}</b><span class="tiny dim" style="width:34px;text-align:right">${Math.round(Math.max(0, r.v) / sum * 100)}%</span></button>`; }).join('')}</div>
    </div>`;
}
function yearHtml(months, cur) {
  const max = Math.max(1, ...months.map(m => Math.max(m.spent, m.income)));
  return `<div class="fin-year">${months.map(m => `<button class="fin-m ${m.ym === today().slice(0, 7) ? 'now' : ''}" data-act="fin.month" data-ym="${m.ym}" title="${esc(monthName(m.ym))}: spent ${esc(money(m.spent, cur))}, income ${esc(money(m.income, cur))}">
      <div class="fin-m-bars"><i class="in" style="height:${m.income / max * 100}%"></i><i class="out" style="height:${Math.max(0, m.spent) / max * 100}%"></i></div>
      <span>${new Date(+m.ym.slice(0, 4), +m.ym.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'narrow' })}</span></button>`).join('')}</div>
    <div class="tiny dim" style="margin-top:8px">Green is income, the accent is spending. Press a month to open it.</div>`;
}
function daysHtml(txs, ym, cur) {
  const n = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate(), per = Array(n).fill(0);
  txs.forEach(t => { const k = (Fin.cats().find(c => c.id === t.cat) || {}).kind; if (k !== 'transfer' && !(k === 'income' && t.a > 0)) per[+t.d.slice(8) - 1] -= t.a; });
  const max = Math.max(1, ...per);
  return `<div class="fin-days" style="--n:${n}">${per.map((v, i) => `<i title="${i + 1}: ${esc(money(Math.max(0, v), cur))}" style="height:${Math.max(v > 0 ? 3 : 0, v / max * 100)}%"></i>`).join('')}</div>
    <div class="row between tiny dim" style="margin-top:6px"><span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span></div>`;
}
function listHtml(txs, cur) {
  const q = (ui.finQuery || '').trim().toLowerCase(), cat = ui.finCat;
  let rows = txs.filter(t => (!cat || (t.cat || '-') === cat) && (!q || (t.n + ' ' + t.m).toLowerCase().includes(q)));
  const total = rows.length; rows = rows.slice(0, ui.finAll ? 2000 : 60);
  const options = id => `<option value="">No category</option>${Fin.cats().map(c => `<option value="${esc(c.id)}" ${c.id === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  return `<div class="card-h"><span class="eyebrow">Transactions · ${total}</span>
      ${cat ? `<button class="pill accent" data-act="fin.filter" data-cat="${esc(cat)}">${esc(catOf(cat === '-' ? '' : cat).name)} ${icon('x')}</button>` : ''}
      <input class="input" style="max-width:220px;height:32px" placeholder="Search" value="${esc(ui.finQuery || '')}" data-input="fin.query" data-fk="fin-q" aria-label="Search transactions"></div>
    <div class="fin-list">${rows.map(t => { const c = catOf(t.cat);
      return `<div class="fin-tx" style="--c:${safeColor(c.color)}">
        <span class="fin-d">${+t.d.slice(8)} ${new Date(t.d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' })}</span>
        <div class="grow"><div class="ell fin-n">${esc(t.n || t.m || 'Unknown')}</div>${t.m && t.m !== t.n ? `<div class="tiny dim ell">${esc(t.m)}</div>` : ''}</div>
        <select class="input fin-sel ${t.cat ? '' : 'none'}" data-change="fin.cat" data-id="${esc(t.id)}" aria-label="Category">${options(t.cat)}</select>
        <b class="fin-a ${t.a > 0 ? 'tone-good' : ''}">${t.a > 0 ? '+' : ''}${esc(money(t.a, t.cur || cur))}</b>
      </div>`; }).join('') || '<div class="empty">No transactions match.</div>'}</div>
    ${total > rows.length ? `<button class="btn sm ghost" data-act="fin.all" style="margin-top:8px">Show all ${total}</button>` : ''}`;
}

export default {
  mount(root) {
    // Hovering a slice (or its line in the list) lifts the slice and names it in the middle of the ring.
    const mid = root.querySelector('#pie-mid'), pie = root.querySelector('.pie');
    if (mid && pie) {
      const rows = [...root.querySelectorAll('.fin-cat[data-row]')].filter(el => +el.dataset.row >= 0);
      const picked = rows.find(el => el.classList.contains('on')), rest = picked ? +picked.dataset.row : -1;   // the chosen slice stays named when nothing is pointed at
      const show = i => {
        if (i < 0) i = rest;
        pie.querySelectorAll('.seg').forEach(sg => sg.classList.toggle('hot', +sg.dataset.seg === i));
        rows.forEach(el => el.classList.toggle('hot', +el.dataset.row === i));
        const el = rows.find(x => +x.dataset.row === i);
        mid.innerHTML = el ? `<b>${esc(el.dataset.amount)}</b><span>${esc(el.dataset.name)} · ${esc(el.dataset.pct)}%</span>` : `<b>${esc(mid.dataset.total)}</b><span>spent</span>`;
      };
      pie.querySelectorAll('.seg').forEach(sg => { sg.addEventListener('mouseenter', () => show(+sg.dataset.seg)); sg.addEventListener('focus', () => show(+sg.dataset.seg)); });
      rows.forEach(el => el.addEventListener('mouseenter', () => show(+el.dataset.row)));
      root.querySelector('.fin-pie').addEventListener('mouseleave', () => show(-1));
      if (rest >= 0) show(-1);
    }
    if (ui.finScroll) { ui.finScroll = false; const tx = root.querySelector('#fin-tx'); if (tx) tx.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  },
  render() {
    const ready = ensure(), d = Fin.cached(), s = Fin.status;
    if (!ready || !d) return `<div class="view-h"><h2>Finance</h2></div><div class="card empty">Loading your transactions.</div>`;
    if (!d.txs.length) return `<div class="view-h"><h2>Finance</h2></div>${setupHtml()}`;
    const cur = mainCurrency(d.txs), all = d.txs.filter(t => t.cur === cur), other = d.txs.length - all.length;
    const year = ui.finView === 'year', ym = month(), y = +ym.slice(0, 4), cats = Fin.cats();
    const set = year ? F.inYear(all, y) : F.inMonth(all, ym);
    const prevYm = (() => { const p = new Date(y, +ym.slice(5) - 2, 1); return `${p.getFullYear()}-${pad(p.getMonth() + 1)}`; })();
    const t = F.totals(set, cats), prev = F.totals(year ? F.inYear(all, y - 1) : F.inMonth(all, prevYm), cats);
    const loose = set.filter(x => !x.cat).length, links = (s.bank && s.bank.links) || [], active = links.filter(l => l.status === 'active'), expired = links.filter(l => l.status === 'expired');
    return `<div class="view-h"><h2>Finance</h2>
        <span class="tiny dim">${s.busy ? esc(s.progress || 'Working') : active.length ? `${active.map(l => esc(l.aspsp)).join(', ')} linked` : `${d.txs.length} transactions`}</span>
        ${active.length ? `<button class="btn sm ghost" data-act="fin.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} Sync</button>` : ''}
        <label class="btn sm ghost">${icon('upload')} Import file<input type="file" accept=".csv,.txt,.xml,.tab,text/csv,text/plain,application/xml,text/xml" data-change="fin.file" hidden></label>
        <button class="btn sm ghost" data-act="fin.link">${icon('link')} Link a bank</button>
        <button class="icon-btn sm" data-act="fin.manage" title="Categories, rules and data" aria-label="Categories, rules and data">${icon('settings')}</button></div>
      ${s.error ? `<div class="notice bad" style="margin-bottom:var(--gap)">${esc(s.error)}</div>` : ''}
      ${expired.length ? `<div class="notice warn" style="margin-bottom:var(--gap)">${icon('link')} <span>Your link to ${expired.map(l => esc(l.aspsp)).join(' and ')} has expired. Banks ask you to renew it about every 180 days. <button class="btn sm" data-act="fin.link">Link again</button></span></div>` : ''}
      <div class="fin-bar"><button class="icon-btn" data-act="fin.nav" data-d="-1" aria-label="Earlier">${icon('left')}</button>
        <b class="fin-period">${year ? y : esc(monthName(ym))}</b>
        <button class="icon-btn" data-act="fin.nav" data-d="1" aria-label="Later">${icon('right')}</button>
        <span class="grow"></span>${segHtml('fin.view', [['month', 'Month'], ['year', 'Year']], year ? 'year' : 'month')}</div>
      ${statsHtml(t, prev, cur, year ? 'year' : 'month')}
      ${loose ? `<div class="notice" style="margin-top:var(--gap)">${icon('help')} <span>${loose} transaction${loose === 1 ? ' has' : 's have'} no category yet. Pick one in the list and choose "Always" to teach the dashboard that merchant. <button class="btn sm" data-act="fin.filter" data-cat="-">Show ${loose === 1 ? 'it' : 'them'}</button></span></div>` : ''}
      <section class="card" style="margin-top:var(--gap)"><div class="card-h"><span class="eyebrow">Where it went</span><span class="tiny dim">${ui.finCat ? 'press the slice again to show everything' : 'press a slice to see its transactions'}</span></div>${catsHtml(t, cur)}</section>
      <section class="card" id="fin-tx" style="margin-top:var(--gap)">${listHtml(set, cur)}</section>
      <section class="card" style="margin-top:var(--gap)"><div class="card-h"><span class="eyebrow">${year ? 'Month by month' : 'Day by day'}</span></div>${year ? yearHtml(F.yearMonths(all, y, cats), cur) : daysHtml(set, ym, cur)}</section>
      ${other ? `<p class="hint" style="margin-top:10px">${other} transaction${other === 1 ? '' : 's'} in another currency ${other === 1 ? 'is' : 'are'} stored but not counted in these ${esc(cur)} totals.</p>` : ''}`;
  }
};

/* ── dialogs ── */
function mapDialog(res) {
  const opts = (sel, none = false) => `${none ? '<option value="">None</option>' : ''}${res.header.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}`;
  const g = res.guess || {};
  openModal({
    title: 'Which column is which?', submit: 'Import',
    body: `<p class="muted">This file's columns could not be recognised. Tell the dashboard where the date, the amount and the description are.</p>
      <div class="tiny dim ell">First row: ${esc((res.rows[0] || []).join('  |  ').slice(0, 200))}</div>
      <div class="form-row"><div class="field"><label>Date</label><select class="input" name="date">${opts(g.date)}</select></div>
        <div class="field"><label>Amount</label><select class="input" name="amount">${opts(g.amount)}</select></div></div>
      <div class="form-row"><div class="field"><label>Name or description</label><select class="input" name="name">${opts(g.name)}</select></div>
        <div class="field"><label>Extra details (optional)</label><select class="input" name="memo">${opts(g.memo, true)}</select></div></div>
      <div class="hint">Money out should be negative in the amount column. If your bank uses separate columns for money in and out, export as CAMT.053 instead, which is read without questions.</div>`,
    onSubmit: f => {
      const map = { date: +f.date, amount: +f.amount, name: +f.name, ...(f.memo !== '' ? { memo: +f.memo } : {}) };
      Fin.importFile(res.text, map).then(r => importDone(r)).catch(e => toast('Could not read that file', e.message, { kind: 'bad', ms: 10000 }));
    }
  });
}
function importDone(r) {
  if (r.needMap) { mapDialog(r); return; }
  toast(r.added ? `Added ${r.added} transaction${r.added === 1 ? '' : 's'}` : 'Nothing new in that file', r.added ? `Read as ${r.format}.` : 'Every transaction in it was already here.', { kind: r.added ? 'good' : '', ms: 6000 });
  if (r.added && Fin.cached()) { const newest = Fin.cached().txs[0]; if (newest) ui.finMonth = newest.d.slice(0, 7); refresh(); }
}
async function linkDialog() {
  const st = Sync.signedIn() ? (Fin.status.bank || await Fin.bankStatus()) : null;
  if (!Sync.signedIn() || !st || !st.configured || st.needSchema) {
    openModal({
      title: 'Link a bank', cancel: 'Close', wide: true,
      body: `<p class="muted">Linking reads your transactions automatically, read-only, through Enable Banking: a licensed provider that connects to most European banks. It is free for your own accounts. It takes about fifteen minutes to set up, once.</p>
        <ol class="gym-steps muted">
          <li class="${Sync.signedIn() ? 'dim' : ''}">Turn on sync and sign in (Settings > Sync).${Sync.signedIn() ? ' Done.' : ''}</li>
          <li class="${st && !st.needSchema ? 'dim' : ''}">Run the newest <b>supabase/schema.sql</b> in your Supabase project (SQL Editor). It adds the two finance tables.${st && !st.needSchema ? ' Done.' : ''}</li>
          <li>Make a free account at enablebanking.com and register an application. Choose "Production", set the redirect URL to your site's address (for example https://your-site.netlify.app/), and let it generate a key: you get an <b>application id</b> and a <b>private key file</b>.</li>
          <li>In the Enable Banking control panel, link your own accounts to that application (this is what keeps it free).</li>
          <li>In Netlify, add two environment variables: <b>ENABLEBANKING_APP_ID</b> and <b>ENABLEBANKING_PRIVATE_KEY</b> (the whole contents of the key file), then redeploy.</li>
        </ol>
        <p class="hint">Until then, importing statement files gives you the same tab. The full walkthrough is in HOW-TO-USE.md.</p>`
    });
    return;
  }
  const guess = (navigator.language || '').split('-')[1] || 'NL';
  const m = openModal({
    title: 'Link a bank', submit: 'Continue to your bank',
    body: `<p class="muted">You sign in on your bank's own page and approve read-only access. This site never sees your bank password. Banks ask you to renew the link about every 180 days.</p>
      <div class="field"><label>Country</label><select class="input" name="country" id="bk-c">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === guess.toUpperCase() ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label>Bank</label><select class="input" name="bank" id="bk-b" required><option value="">Loading</option></select></div>
      ${st.links.length ? `<div class="hint">Already linked: ${st.links.map(l => esc(l.aspsp)).join(', ')}.</div>` : ''}`,
    onMount: el => {
      const c = el.querySelector('#bk-c'), b = el.querySelector('#bk-b');
      const fill = async () => {
        b.innerHTML = '<option value="">Loading</option>';
        try { const j = await Fin.bankList(c.value); b.innerHTML = j.banks.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('') || '<option value="">No banks listed</option>'; }
        catch (e) { b.innerHTML = '<option value="">Could not load</option>'; toast('Could not load the bank list', e.message, { kind: 'bad', ms: 9000 }); }
      };
      c.addEventListener('change', fill); fill();
    },
    onSubmit: f => {
      if (!f.bank) return false;
      Fin.bankStart(f.bank, f.country).catch(e => toast('Could not start the link', e.message, { kind: 'bad', ms: 10000 }));
      return false;                                  // stay open until the browser leaves for the bank
    }
  });
  void m;
}
function manageDialog() {
  const st = S(), cats = st.finance.cats.map(c => ({ ...c })), removed = [];
  const rows = () => cats.map((c, i) => `<div class="row"><input type="color" class="input" value="${safeColor(c.color)}" data-k="color" data-i="${i}" aria-label="Colour">
      <input class="input" value="${esc(c.name)}" data-k="name" data-i="${i}" maxlength="30" aria-label="Category name">
      <span class="tiny dim" style="width:64px">${c.kind === 'income' ? 'income' : c.kind === 'transfer' ? 'not counted' : ''}</span>
      <button type="button" class="icon-btn sm" data-del="${i}" ${c.kind ? 'disabled' : ''} aria-label="Remove category">${icon('x')}</button></div>`).join('');
  const links = (Fin.status.bank && Fin.status.bank.links) || [];
  openModal({
    title: 'Finance settings', wide: true,
    body: `<div><div class="label" style="margin-bottom:8px">Categories</div><div id="fc-rows" class="col" style="gap:8px">${rows()}</div>
        <button type="button" class="btn sm" id="fc-add" style="margin-top:8px">${icon('plus')} Add category</button></div>
      <div><div class="label" style="margin-bottom:8px">Your rules · ${st.finance.rules.length}</div>
        ${st.finance.rules.length ? `<div class="list" style="max-height:180px;overflow:auto">${st.finance.rules.map(r => `<div class="li" style="padding:6px 0"><span class="grow ell">"${esc(r.match)}"</span><span class="dim">${esc(catOf(r.cat).name)}</span>
          <button type="button" class="icon-btn sm" data-act="fin.ruleDel" data-id="${esc(r.id)}" aria-label="Remove rule">${icon('x')}</button></div>`).join('')}</div>` : '<div class="hint">None yet. Choose a category for a transaction, then press "Always", and that merchant is sorted for you from then on.</div>'}</div>
      ${links.length ? `<div><div class="label" style="margin-bottom:8px">Linked banks</div><div class="list">${links.map(l => `<div class="li" style="padding:8px 0"><div class="grow"><b>${esc(l.aspsp)}</b>
          <div class="tiny dim">${l.accounts.map(a => esc(a.name || a.iban)).join(', ')} · ${l.status === 'active' ? `valid until ${l.valid_until ? new Date(l.valid_until).toLocaleDateString() : 'unknown'}` : esc(l.status)}${l.last_error ? ' · ' + esc(l.last_error) : ''}</div></div>
          <button type="button" class="btn sm danger" data-act="fin.unlink" data-id="${esc(l.id)}">Unlink</button></div>`).join('')}</div></div>` : ''}
      <div class="row wrap"><button type="button" class="btn sm" data-act="fin.reapply">${icon('refresh')} Sort everything again with the rules</button>
        <button type="button" class="btn sm danger" data-act="fin.clear">${icon('trash')} Remove all transactions</button></div>`,
    onMount: el => {
      const box = el.querySelector('#fc-rows');
      box.addEventListener('input', e => { const t = e.target.closest('[data-k]'); if (t) cats[+t.dataset.i][t.dataset.k] = t.value; });
      box.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d && !d.disabled) { removed.push(cats[+d.dataset.del].id); cats.splice(+d.dataset.del, 1); box.innerHTML = rows(); } });
      el.querySelector('#fc-add').addEventListener('click', () => { cats.splice(Math.max(0, cats.length - 2), 0, { id: 'c' + uid(), name: 'New category', color: '#6FB1F0' }); box.innerHTML = rows(); });
    },
    onSubmit: () => {
      st.finance.cats = cats.filter(c => c.name.trim()).map(c => ({ ...c, name: c.name.trim(), color: safeColor(c.color) }));
      removed.forEach(id => { tombstone(id); st.finance.rules = st.finance.rules.filter(r => r.cat !== id); });
      save();
      if (removed.length) Fin.reapplyRules();
    }
  });
}

registerActions({
  'fin.file': async (d, e, el) => {
    const file = el.files && el.files[0]; el.value = '';
    try { importDone(await Fin.importFile(file)); } catch (err) { toast('Could not read that file', err.message, { kind: 'bad', ms: 10000 }); }
  },
  'fin.link': () => linkDialog(),
  'fin.sync': async () => { const n = await Fin.bankSync(); if (!Fin.status.error) toast(n ? `${n} new transaction${n === 1 ? '' : 's'}` : 'Nothing new from your bank', '', { kind: n ? 'good' : '', ms: 4000 }); },
  'fin.manage': () => manageDialog(),
  'fin.view': d => { ui.finView = d.v; ui.finCat = ''; ui.finDraw = true; refresh(); },
  'fin.month': d => { ui.finMonth = d.ym; ui.finView = 'month'; ui.finCat = ''; ui.finDraw = true; window.scrollTo({ top: 0, behavior: 'smooth' }); refresh(); },
  'fin.nav': d => {
    const ym = month(), y = +ym.slice(0, 4), m = +ym.slice(5), n = +d.d;
    const next = ui.finView === 'year' ? new Date(y + n, m - 1, 1) : new Date(y, m - 1 + n, 1);
    ui.finMonth = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`; ui.finCat = ''; ui.finAll = false; ui.finDraw = true; refresh();
  },
  'fin.filter': d => { ui.finCat = ui.finCat === d.cat ? '' : d.cat; ui.finAll = false; ui.finScroll = !!ui.finCat; refresh(); },
  'fin.query': (d, e, el) => { ui.finQuery = el.value; refresh(); },
  'fin.all': () => { ui.finAll = true; refresh(); },
  'fin.cat': async (d, e, el) => {
    const cat = el.value, tx = (Fin.cached() || { txs: [] }).txs.find(t => t.id === d.id);
    await Fin.setCategory(d.id, cat, false);
    if (!tx || !cat) return;
    const who = F.ruleKey(tx);
    if (who) toast(`Moved to ${catOf(cat).name}`, `Do the same for everything from "${who}"?`, { ms: 9000, buttons: [{ label: 'Always', run: async () => { const n = await Fin.setCategory(d.id, cat, true); toast('Rule saved', `${Math.max(0, n - 1)} other transaction${n - 1 === 1 ? '' : 's'} moved with it.`, { kind: 'good', ms: 4000 }); } }, { label: 'Just this one', run: () => {} }] });
  },
  'fin.ruleDel': d => { const st = S(); st.finance.rules = st.finance.rules.filter(r => r.id !== d.id); tombstone(d.id); save(); closeModal(); manageDialog(); },
  'fin.reapply': async () => { const n = await Fin.reapplyRules(); toast('Sorted again', `${n} transaction${n === 1 ? '' : 's'} changed category. The ones you set by hand were left alone.`, { ms: 5000 }); },
  'fin.unlink': async d => {
    if (!(await confirmDialog({ title: 'Unlink this bank?', body: 'New transactions stop arriving. The ones already here stay.', ok: 'Unlink', danger: true }))) return;
    try { await Fin.bankUnlink(d.id); closeModal(); toast('Bank unlinked', '', { ms: 3000 }); } catch (e) { toast('Could not unlink', e.message, { kind: 'bad' }); }
  },
  'fin.clear': async () => {
    if (!(await confirmDialog({ title: 'Remove all transactions?', body: 'They are deleted from this device and from your account. A linked bank stays linked. This cannot be undone.', ok: 'Remove all', danger: true }))) return;
    try { await Fin.clearAll(); closeModal(); } catch (e) { toast('Could not remove them', e.message, { kind: 'bad' }); }
  }
});
