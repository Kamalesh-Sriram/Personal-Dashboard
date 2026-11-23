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
  const s = Fin.status, active = ((s.bank && s.bank.links) || []).filter(l => l.status === 'active');
  const linked = [...new Set(active.map(l => l.aspsp))];
  return `<div class="card gym-setup">
      <div class="h3">See where your money goes</div>
      <p class="muted">Bring in your transactions and they are sorted into categories, by month and by year. Two ways, and either works on its own.</p>
      <div class="gym-ways">
        <div><div class="label">Import a statement</div>
          <p class="hint">Download your transactions from your bank's website and choose the file here. Works with any bank: CSV, ABN AMRO's TXT, Revolut's CSV and CAMT.053 are read as they are.</p>
          <label class="btn primary">${icon('upload')} Choose file<input type="file" accept=".csv,.txt,.xml,.tab,text/csv,text/plain,application/xml,text/xml" data-change="fin.file" hidden></label></div>
        <div><div class="label">Link your bank</div>
          <p class="hint">New transactions then arrive by themselves. Read-only, through Enable Banking, for most European banks.</p>
          ${linked.length ? `<p class="hint">${linked.map(esc).join(', ')} linked. Its transactions are read when you press Sync.</p>
          <button class="btn primary" data-act="fin.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} ${s.busy ? esc(s.progress || 'Syncing') : 'Sync'}</button>`
            : `<button class="btn" data-act="fin.link">${icon('link')} Link a bank</button>`}</div>
      </div>
      ${Fin.status.error ? `<div class="notice bad">${esc(Fin.status.error)}</div>` : ''}
      <p class="hint">Nothing here is shared with anyone. Files are read on this device. If sync is on, transactions are also kept in your own database so your other devices show them.</p>
    </div>`;
}

function statsHtml(t, prev, cur, label) {
  const delta = prev.spent > 0 ? Math.round((t.spent - prev.spent) / prev.spent * 100) : null;
  const stat = (ico, eyebrow, big, small, tone = '') => `<div class="card stat"><div class="stat-ico">${icon(ico)}</div><div><span class="eyebrow">${eyebrow}</span><b class="num ${tone}">${big}</b><span>${small}</span></div></div>`;
  return `<div class="fin-stats">
    ${stat('wallet', 'Spent', money(t.spent, cur), delta === null ? `No earlier ${label} to compare` : `${delta > 0 ? '+' : ''}${delta}% on the ${label} before`)}
    ${stat('down', 'Income', money(t.income, cur), 'Money in, without transfers')}
    ${stat('gauge', 'Left over', money(t.net, cur), t.income > 0 ? `${Math.round(t.net / t.income * 100)}% of income kept` : 'No income recorded', t.net >= 0 ? 'tone-good' : 'tone-bad')}
    ${stat('list', 'Biggest category', t.rows[0] ? esc(catOf(t.rows[0].id).name) : '-', t.rows[0] ? money(t.rows[0].v, cur) : 'Nothing spent')}
  </div>`;
}
const picked = () => ui.finCats || [];
function catsHtml(t, cur) {
  if (!t.rows.length) return '<div class="empty">Nothing was spent in this period.</div>';
  const rows = t.rows.filter(r => r.v > 0), sum = rows.reduce((n, r) => n + r.v, 0) || 1, on = picked();
  const parts = rows.map(r => ({ id: r.id || '-', label: catOf(r.id).name, value: r.v, color: catOf(r.id).color }));
  const draw = ui.finDraw !== false || ui.entering; ui.finDraw = false;
  const chosen = t.rows.filter(r => on.includes(r.id || '-')), chosenSum = chosen.reduce((n, r) => n + r.v, 0);
  return `<div class="fin-pie">
      <div class="pie-wrap">${donut(parts, { on, act: 'fin.filter', draw })}
        <div class="pie-mid" id="pie-mid" data-total="${esc(money(t.spent, cur))}" data-picked="${chosen.length ? esc(money(chosenSum, cur)) : ''}" data-pn="${chosen.length}" data-ppct="${Math.round(Math.max(0, chosenSum) / sum * 100)}">
          <div class="pie-txt"></div></div></div>
      <div class="fin-cats">${t.rows.map(r => { const c = catOf(r.id), sel = on.includes(r.id || '-');
        return `<button class="fin-cat ${sel ? 'on' : ''}" data-act="fin.filter" data-cat="${esc(r.id || '-')}" data-row="${rows.indexOf(r)}" data-name="${esc(c.name)}" data-amount="${esc(money(r.v, cur))}" data-pct="${Math.round(Math.max(0, r.v) / sum * 100)}" style="--c:${safeColor(c.color)}" aria-pressed="${sel}">
          <span class="fin-tick">${icon('check')}</span><span class="fin-cat-n ell">${esc(c.name)}</span>
          <b>${money(r.v, cur)}</b><span class="tiny dim" style="width:34px;text-align:right">${Math.round(Math.max(0, r.v) / sum * 100)}%</span></button>`; }).join('')}
        ${on.length ? `<div class="fin-picked"><span>${on.length} picked · <b>${esc(money(chosenSum, cur))}</b></span><button class="btn sm ghost" data-act="fin.filterClear">Clear</button></div>` : ''}</div>
    </div>`;
}
function yearHtml(months, cur) {
  const max = Math.max(1, ...months.map(m => Math.max(m.spent, m.income)));
  return `<div class="fin-year">${months.map(m => `<button class="fin-m ${m.ym === today().slice(0, 7) ? 'now' : ''}" data-act="fin.month" data-ym="${m.ym}" title="${esc(monthName(m.ym))}: spent ${esc(money(m.spent, cur))}, income ${esc(money(m.income, cur))}">
      <div class="fin-m-bars"><i class="in" style="height:${m.income / max * 100}%"></i><i class="out" style="height:${Math.max(0, m.spent) / max * 100}%"></i></div>
      <span>${new Date(+m.ym.slice(0, 4), +m.ym.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'narrow' })}</span></button>`).join('')}</div>
    <div class="tiny dim" style="margin-top:8px">Green is income, the accent is spending. Press a month to open it.</div>`;
}
/** Money out and money in for each day of a month. Same rules as the totals:
 *  transfers are left out, a refund lowers that day's spending. */
function perDay(txs, ym) {
  const n = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate(), out = Array(n).fill(0), inc = Array(n).fill(0);
  txs.forEach(t => {
    const k = (Fin.cats().find(c => c.id === t.cat) || {}).kind, i = +t.d.slice(8) - 1;
    if (k === 'transfer' || i < 0 || i >= n) return;
    if (k === 'income' && t.a > 0) inc[i] += t.a; else out[i] -= t.a;
  });
  return { n, out, inc };
}
/** A round step above `v` for the top of the scale: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
/** A scale in round steps (1, 2, 2.5 or 5 times a power of ten), at most five of them above zero. */
function niceScale(max) {
  const p = Math.pow(10, Math.floor(Math.log10(max / 5)));
  const step = [1, 2, 2.5, 5, 10, 20].map(f => f * p).find(st => Math.ceil(max / st) <= 5) || niceMax(max);
  const steps = Math.max(1, Math.ceil(max / step));
  return { top: step * steps, steps };
}
const compact = (v, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch { return String(Math.round(v)); } };
const dayLabel = (ym, d) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/* Day by day, in one of two views (Settings keeps the choice):
     together  one bar a day, red for spending to green for income. Spending
               sets the scale; a bigger day (a salary, the rent) is cut at the
               top with a break mark and its amount written above it.
     split     spending rises from a middle line in red, income hangs below it
               in green, each on its own scale, so neither squashes the other. */
const CAP = 84, OVER = 90;            // together: % of the bar area the scale fills, and how far a capped bar reaches
const UP = 62, DOWN = 32, MID = 36;   // split: room above the line, room below it, and where the line sits (from the bottom)
function dailyHtml(txs, ym, cur, draw) {
  const { n, out, inc } = perDay(txs, ym);
  const spentDay = out.map(o => Math.max(0, o)), tot = spentDay.map((o, i) => o + inc[i]);
  const split = S().settings.finChart === 'split';
  const sel = ui.finDay && ui.finDay.slice(0, 7) === ym ? +ui.finDay.slice(8) : 0;
  const t = today(), now = t.slice(0, 7) === ym ? +t.slice(8) : ym < t.slice(0, 7) ? n + 1 : 0;
  const maxOut = Math.max(...spentDay), maxIn = Math.max(...inc);
  const sOut = niceScale(Math.max(1, maxOut > 0 ? maxOut : Math.max(...tot)));      // expenses set the scale
  const sIn = niceScale(Math.max(1, maxIn));
  let cols = '';
  for (let i = 0; i < n; i++) {
    const d = i + 1, o = spentDay[i], m = inc[i], label = dayLabel(ym, d), sum = o + m;
    let bar = '';
    if (split) {
      bar = `${o > 0 ? `<i class="up" style="height:${(o / sOut.top * UP).toFixed(2)}%"></i>` : ''}${m > 0 ? `<i class="down" style="height:${(m / sIn.top * DOWN).toFixed(2)}%"></i>` : ''}`;
    } else if (sum > 0) {
      const over = sum > sOut.top, share = Math.round(m / sum * 100);
      bar = `<i class="${over ? 'over' : ''}" style="--mix:${share}%;height:${over ? OVER : (sum / sOut.top * CAP).toFixed(2)}%">${over ? '<u></u>' : ''}</i>${over ? `<b class="fd-tag ${m > o ? 'in' : ''}" style="--mix:${share}%">${m > o ? '+' : ''}${esc(compact(m > o ? m : sum, cur))}</b>` : ''}`;
    }
    cols += `<button class="fd-col ${sel === d ? 'on' : ''} ${d > now ? 'later' : ''}" data-act="fin.day" data-day="${ym}-${String(d).padStart(2, '0')}"
        data-label="${esc(label)}" data-out="${esc(money(o, cur))}" data-in="${esc(money(m, cur))}" style="--i:${i}"
        aria-label="${esc(label)}: spent ${esc(money(o, cur))}${m ? `, income ${esc(money(m, cur))}` : ''}" aria-pressed="${sel === d}">
      <span class="fd-bar">${bar}</span><span class="fd-d">${d}</span></button>`;
  }
  let ys = '', grid = '';
  const tick = (at, txt, cls = '') => { ys += `<span class="${cls}" style="bottom:${at.toFixed(2)}%">${esc(txt)}</span>`; grid += `<i class="${cls}" style="bottom:${at.toFixed(2)}%"></i>`; };
  if (split) {
    for (let k = 1; k <= sOut.steps; k++) tick(MID + k / sOut.steps * UP, compact(sOut.top * k / sOut.steps, cur));
    tick(MID, compact(0, cur), 'base');
    if (maxIn > 0) { tick(MID - DOWN / 2, '+' + compact(sIn.top / 2, cur), 'in'); tick(MID - DOWN, '+' + compact(sIn.top, cur), 'in'); }
  } else {
    for (let k = 0; k <= sOut.steps; k++) tick(k / sOut.steps * CAP, compact(sOut.top * k / sOut.steps, cur), k === 0 ? 'base' : '');
  }
  const spent = out.reduce((a2, v) => a2 + v, 0), days = Math.max(1, Math.min(n, now > n ? n : now || n));
  return `<div class="fd-read" id="fd-read" data-avg="${esc(money(spent / days, cur))}">${dailyRead(sel ? { label: dayLabel(ym, sel), out: money(Math.max(0, out[sel - 1]), cur), in: money(inc[sel - 1], cur), picked: true } : null, money(spent / days, cur))}</div>
    <div class="fd-plot ${split ? 'split' : ''}"><div class="fd-y">${ys}</div>
      <div class="fd-area"><div class="fd-grid" aria-hidden="true">${grid}</div>
        <div class="fd-cols ${draw ? 'draw' : ''}" style="--n:${n}" role="group" aria-label="Spending and income for each day of ${esc(monthName(ym))}">${cols}</div></div></div>`;
}
function dailyRead(d, avg) {
  if (!d) return `<span class="fd-when">Average a day</span><b>${esc(avg)}</b>`;
  return `<span class="fd-when">${esc(d.label)}</span><b>${esc(d.out)}</b><span class="fd-in-v">${d.in && !/^\D*0([.,]00)?\D*$/.test(d.in) ? `+${esc(d.in)} in` : ''}</span>${d.picked ? '<button class="btn sm ghost" data-act="fin.dayClear">Clear</button>' : ''}`;
}
function listHtml(txs, cur) {
  const q = (ui.finQuery || '').trim().toLowerCase(), cats = picked(), day = ui.finDay;
  let rows = txs.filter(t => (!cats.length || cats.includes(t.cat || '-')) && (!day || t.d === day) && (!q || (t.n + ' ' + t.m).toLowerCase().includes(q)));
  const total = rows.length; rows = rows.slice(0, ui.finAll ? 2000 : 60);
  const options = id => `<option value="">No category</option>${Fin.cats().map(c => `<option value="${esc(c.id)}" ${c.id === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const sel = ui.finSel, shownSel = rows.filter(t => sel.has(t.id)).length, all = rows.length && shownSel === rows.length;
  return `<div class="card-h"><span class="eyebrow">Transactions · ${total}</span>
      ${cats.map(c => `<button class="pill accent" data-act="fin.filter" data-cat="${esc(c)}" title="Stop filtering by this">${esc(catOf(c === '-' ? '' : c).name)} ${icon('x')}</button>`).join('')}
      ${day ? `<button class="pill accent" data-act="fin.dayClear">${esc(dayLabel(day.slice(0, 7), +day.slice(8)))} ${icon('x')}</button>` : ''}
      <input class="input" style="max-width:220px;height:32px" placeholder="Search" value="${esc(ui.finQuery || '')}" data-input="fin.query" data-fk="fin-q" aria-label="Search transactions"></div>
    ${sel.size ? `<div class="fin-bulk"><b>${sel.size} selected</b>
        <select class="input" id="fin-bulk-cat" aria-label="Category for the selected transactions"><option value="" disabled selected>Choose a category</option>${Fin.cats().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}<option value="__none">No category</option></select>
        <button class="btn sm primary" data-act="fin.bulkCat">Set category</button><span class="grow"></span><button class="btn sm ghost" data-act="fin.selClear">Clear selection</button></div>` : ''}
    <div class="fin-list">${rows.length ? `<label class="fin-all tiny dim"><input type="checkbox" data-change="fin.pickAll" ${all ? 'checked' : ''} aria-label="Select every transaction shown"> Select all shown</label>` : ''}${rows.map(t => { const c = catOf(t.cat), on = sel.has(t.id);
      return `<div class="fin-tx ${on ? 'sel' : ''}" style="--c:${safeColor(c.color)}">
        <input type="checkbox" class="fin-pick" data-change="fin.pick" data-id="${esc(t.id)}" ${on ? 'checked' : ''} aria-label="Select this transaction">
        <span class="fin-d">${+t.d.slice(8)} ${new Date(t.d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' })}</span>
        <div class="grow"><div class="ell fin-n">${esc(t.n || t.m || 'Unknown')}</div>${t.m && t.m !== t.n ? `<div class="tiny dim ell">${esc(t.m)}</div>` : ''}</div>
        <select class="input fin-sel ${t.cat ? '' : 'none'}" data-change="fin.cat" data-id="${esc(t.id)}" aria-label="Category">${options(t.cat)}</select>
        <b class="fin-a ${t.a > 0 ? 'tone-good' : ''}">${t.a > 0 ? '+' : ''}${esc(money(t.a, t.cur || cur))}</b>
      </div>`; }).join('') || '<div class="empty">No transactions match.</div>'}</div>
    ${total > rows.length ? `<button class="btn sm ghost" data-act="fin.all" style="margin-top:8px">Show all ${total}</button>` : ''}`;
}
export default {
  mount(root) {
    // Hovering a slice (or its line in the list) lifts it and names it in the middle of the ring.
    const mid = root.querySelector('#pie-mid'), pie = root.querySelector('.pie');
    if (mid && pie) {
      const txt = mid.querySelector('.pie-txt');
      const rows = [...root.querySelectorAll('.fin-cat[data-row]')].filter(el => +el.dataset.row >= 0);
      const rest = () => (mid.dataset.picked
        ? `<b>${esc(mid.dataset.picked)}</b><span>${mid.dataset.pn === '1' ? esc((rows.find(el => el.classList.contains('on')) || { dataset: { name: '1 category' } }).dataset.name) : mid.dataset.pn + ' categories'} · ${esc(mid.dataset.ppct)}%</span>`
        : `<b>${esc(mid.dataset.total)}</b><span>Spent</span>`);
      const show = i => {
        pie.querySelectorAll('.seg').forEach(sg => sg.classList.toggle('hot', +sg.dataset.seg === i));
        rows.forEach(el => el.classList.toggle('hot', +el.dataset.row === i));
        const el = i >= 0 ? rows.find(x => +x.dataset.row === i) : null;
        txt.innerHTML = el ? `<b>${esc(el.dataset.amount)}</b><span>${esc(el.dataset.name)} · ${esc(el.dataset.pct)}%</span>` : rest();
      };
      pie.querySelectorAll('.seg').forEach(sg => { sg.addEventListener('mouseenter', () => show(+sg.dataset.seg)); sg.addEventListener('focus', () => show(+sg.dataset.seg)); });
      rows.forEach(el => el.addEventListener('mouseenter', () => show(+el.dataset.row)));
      root.querySelector('.fin-pie').addEventListener('mouseleave', () => show(-1));
      show(-1);
    }
    // Pointing at a day names its totals above the chart; leaving shows the picked day again.
    const chart = root.querySelector('.fd-cols'), read = root.querySelector('#fd-read');
    if (chart && read) {
      const back = read.innerHTML;
      chart.addEventListener('pointerover', e => { const g = e.target.closest('.fd-col'); if (g) read.innerHTML = dailyRead({ label: g.dataset.label, out: g.dataset.out, in: g.dataset.in }, read.dataset.avg); });
      chart.addEventListener('pointerleave', () => { read.innerHTML = back; });
    }
    if (ui.finScroll) { ui.finScroll = false; const tx = root.querySelector('#fin-tx'); if (tx) tx.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  },
  render() {
    const ready = ensure(), d = Fin.cached(), s = Fin.status;
    if (!ready || !d) return `<div class="view-h"><h2>Finance</h2></div><div class="card empty" data-loading>Loading your transactions.</div>`;
    if (!d.txs.length) return `<div class="view-h"><h2>Finance</h2></div>${setupHtml()}`;
    const cur = mainCurrency(d.txs), all = d.txs.filter(t => t.cur === cur), other = d.txs.length - all.length;
    const year = ui.finView === 'year', ym = month(), y = +ym.slice(0, 4), cats = Fin.cats();
    const set = year ? F.inYear(all, y) : F.inMonth(all, ym);
    const drawChart = ui.finDraw !== false || ui.entering;
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
      <div class="fin-top">${statsHtml(t, prev, cur, year ? 'year' : 'month')}
        <section class="card fin-chart"><div class="card-h"><span class="eyebrow">${year ? 'Month by month' : 'Day by day'}</span>${year ? '' : segHtml('fin.chart', [['together', 'Mixed'], ['split', 'Split']], S().settings.finChart === 'split' ? 'split' : 'together')}</div>${year ? yearHtml(F.yearMonths(all, y, cats), cur) : dailyHtml(set, ym, cur, drawChart)}</section></div>
      ${loose ? `<div class="notice fin-loose" style="margin-top:var(--gap)">${icon('help')} <span>${loose} transaction${loose === 1 ? ' has' : 's have'} no category yet.</span><button class="btn sm" data-act="fin.filterOnly" data-cat="-">Show ${loose === 1 ? 'it' : 'them'}</button></div>` : ''}
      <section class="card" style="margin-top:var(--gap)"><div class="card-h"><span class="eyebrow">Where it went</span></div>${catsHtml(t, cur)}</section>
      <section class="card" id="fin-tx" style="margin-top:var(--gap)">${listHtml(set, cur)}</section>
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
      ${st.links.some(l => l.status === 'active') ? `<div class="hint">Already linked: ${[...new Set(st.links.filter(l => l.status === 'active').map(l => l.aspsp))].map(esc).join(', ')}.</div>` : ''}`,
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
  'fin.view': d => { ui.finView = d.v; ui.finCats = []; ui.finSel = new Set(); ui.finDay = null; ui.finDraw = true; refresh(); },
  'fin.month': d => { ui.finMonth = d.ym; ui.finView = 'month'; ui.finCats = []; ui.finSel = new Set(); ui.finDay = null; ui.finDraw = true; window.scrollTo({ top: 0, behavior: 'smooth' }); refresh(); },
  'fin.nav': d => {
    const ym = month(), y = +ym.slice(0, 4), m = +ym.slice(5), n = +d.d;
    const next = ui.finView === 'year' ? new Date(y + n, m - 1, 1) : new Date(y, m - 1 + n, 1);
    ui.finMonth = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`; ui.finCats = []; ui.finSel = new Set(); ui.finDay = null; ui.finAll = false; ui.finDraw = true; refresh();
  },
  'fin.filter': d => { const c = picked(); ui.finCats = c.includes(d.cat) ? c.filter(x => x !== d.cat) : [...c, d.cat]; ui.finAll = false; refresh(); },
  'fin.filterOnly': d => { ui.finCats = [d.cat]; ui.finAll = false; ui.finScroll = true; refresh(); },
  'fin.chart': d => { S().settings.finChart = d.v; ui.finDraw = true; save(); },
  'fin.filterClear': () => { ui.finCats = []; refresh(); },
  'fin.day': d => { ui.finDay = ui.finDay === d.day ? null : d.day; ui.finAll = false; refresh(); },
  'fin.dayClear': () => { ui.finDay = null; refresh(); },
  'fin.pick': (d, e, el) => { el.checked ? ui.finSel.add(d.id) : ui.finSel.delete(d.id); refresh(); },
  'fin.pickAll': (d, e, el) => { document.querySelectorAll('.fin-pick').forEach(b => { el.checked ? ui.finSel.add(b.dataset.id) : ui.finSel.delete(b.dataset.id); }); refresh(); },
  'fin.selClear': () => { ui.finSel = new Set(); refresh(); },
  'fin.bulkCat': async () => {
    const box = document.getElementById('fin-bulk-cat'), v = box && box.value;
    if (!v) { toast('Choose a category first', '', { ms: 3000 }); return; }
    const cat = v === '__none' ? '' : v, n = await Fin.setCategories([...ui.finSel], cat);
    ui.finSel = new Set();
    toast(`${n} transaction${n === 1 ? '' : 's'} moved`, `Now in ${catOf(cat).name}.`, { kind: 'good', ms: 4000 });
    refresh();
  },
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
