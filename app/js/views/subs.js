/* SUBSCRIPTIONS: recurring money and when it next leaves the account.

   The due date is never stored, only an anchor date and a cycle. A stored
   "next due" goes stale the moment a payment passes with the app closed;
   deriving it means every device is right without anything having to run. */
import { S, save, touch, tombstone } from '../store.js';
import { registerActions, openModal, closeModal, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, uid, fmtDate, ymd } from '../util.js';
import * as E from '../engine.js';

const CYCLES = E.SUB_CYCLES, nextDueFor = E.nextDueFor, monthlyCost = E.monthlyCost;
const dateOnly = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = sub => { const d = nextDueFor(sub); return d ? Math.round((d - dateOnly(new Date())) / 86400000) : null; };
const money = (n, cur) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || S().settings.currency }).format(n); }
  catch { return `${cur || ''} ${Number(n).toFixed(2)}`; }
};
const cycleLabel = s => (s.cycle === 'custom' ? `every ${s.every || 30} days` : (CYCLES[s.cycle] || CYCLES.monthly)[0].toLowerCase());

function openSub(sub) {
  const cur = sub || { name: '', amount: '', currency: S().settings.currency, cycle: 'monthly', every: 30, anchor: today(), remind: true, active: true, note: '' };
  openModal({
    title: sub ? 'Edit subscription' : 'New subscription', submit: sub ? 'Save' : 'Add',
    left: sub ? `<button type="button" class="btn danger" data-act="sub.delete" data-id="${esc(sub.id)}">${icon('trash')} Delete</button>` : '',
    body: `<div class="field"><label>Name</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="60" required autofocus></div>
      <div class="form-row">
        <div class="field"><label>Amount</label><input class="input" type="number" name="amount" min="0" step="0.01" value="${cur.amount}" required></div>
        <div class="field"><label>Currency</label><input class="input" name="currency" value="${esc(cur.currency || S().settings.currency)}" maxlength="3" style="text-transform:uppercase"></div>
        <div class="field"><label>Billed</label><select class="input" name="cycle" id="sub-cycle">${Object.keys(CYCLES).map(k => `<option value="${k}" ${k === cur.cycle ? 'selected' : ''}>${CYCLES[k][0]}</option>`).join('')}</select></div>
        <div class="field" id="sub-every" ${cur.cycle === 'custom' ? '' : 'hidden'}><label>Days between</label><input class="input" type="number" name="every" min="1" max="3650" value="${cur.every || 30}"></div>
      </div>
      <div class="field"><label>A billing date (any past or upcoming one)</label><input class="input" type="date" name="anchor" value="${esc(cur.anchor)}" required>
        <div class="hint">Every future date is worked out from this one, so a subscription billed on the 31st stays on the 31st.</div></div>
      <label class="row"><input type="checkbox" name="remind" ${cur.remind !== false ? 'checked' : ''}> <span>Remind me the day before, at 10:00</span></label>
      <label class="row"><input type="checkbox" name="active" ${cur.active !== false ? 'checked' : ''}> <span>Active (uncheck to pause without deleting)</span></label>
      <div class="field"><label>Note</label><input class="input" name="note" value="${esc(cur.note || '')}" maxlength="200" placeholder="Plan, account, how to cancel…"></div>`,
    onMount: el => el.querySelector('#sub-cycle').addEventListener('change', e => { el.querySelector('#sub-every').hidden = e.target.value !== 'custom'; }),
    onSubmit: d => {
      const name = d.name.trim(), amount = parseFloat(d.amount);
      if (!name || !(amount >= 0) || !d.anchor) return false;
      const fields = { name, amount, currency: (d.currency || S().settings.currency).toUpperCase().slice(0, 3), cycle: d.cycle, every: Math.max(1, parseInt(d.every) || 30), anchor: d.anchor, remind: d.remind, active: d.active, note: d.note.trim() };
      if (sub) { if (sub.anchor !== fields.anchor || sub.cycle !== fields.cycle) fields.paidThrough = null; Object.assign(sub, fields); touch(sub); }
      else S().subs.push(touch({ id: uid(), ...fields, history: [] }));
      save();
    }
  });
}

const view = {
  /** Sidebar badge: anything landing today or tomorrow. */
  dueSoon() { return S().subs.filter(s => s.active !== false && s.remind !== false).filter(s => { const n = daysUntil(s); return n !== null && n <= 1; }).length; },
  render() {
    const st = S(), subs = st.subs.map(s => ({ s, n: daysUntil(s), d: nextDueFor(s) }));
    const active = subs.filter(x => x.s.active !== false).sort((a, b) => (a.n ?? 9e9) - (b.n ?? 9e9));
    const paused = subs.filter(x => x.s.active === false);
    if (!subs.length) return `<div class="view-h"><h2>Subscriptions</h2></div>
      <div class="card empty" style="padding:48px 16px">Nothing here yet. Add anything that bills on a schedule: it shows when the money next leaves, and reminds you the day before.<br><button class="btn primary" data-act="sub.new">${icon('plus')} Add a subscription</button></div>`;
    // totals per currency, so mixed currencies are never added together
    const totals = {};
    active.forEach(({ s }) => { const c = s.currency || st.settings.currency; totals[c] = (totals[c] || 0) + monthlyCost(s); });
    const next = active[0];
    const row = ({ s, n, d }) => `<div class="sub-row ${s.active === false ? 'paused' : ''}">
      <div class="grow"><b>${esc(s.name)}</b><div class="tiny dim">${money(s.amount, s.currency)} · ${cycleLabel(s)}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
      <div class="sub-m tiny dim">${money(monthlyCost(s), s.currency)}/mo</div>
      ${s.active === false ? '<span class="pill">paused</span>' : d ? `<div style="text-align:right"><span class="pill ${n <= 1 ? 'bad' : n <= 7 ? 'warn' : ''}">${n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'}</span><div class="tiny dim" style="margin-top:3px">${fmtDate(ymd(d), { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>` : ''}
      ${s.active !== false ? `<button class="icon-btn sm" data-act="sub.paid" data-id="${esc(s.id)}" title="Mark this payment as paid" aria-label="Mark paid">${icon('check')}</button>` : ''}
      <button class="icon-btn sm" data-act="sub.edit" data-id="${esc(s.id)}" aria-label="Edit">${icon('edit')}</button></div>`;
    return `<div class="view-h"><h2>Subscriptions</h2><button class="btn sm primary" data-act="sub.new">${icon('plus')} Subscription</button></div>
      <div class="grid g3" style="margin-bottom:var(--gap)">
        <div class="card stat"><div class="stat-ico">${icon('subs')}</div><div><span class="eyebrow">Per month</span><b class="num">${Object.keys(totals).map(c => money(totals[c], c)).join(' + ') || '-'}</b><span>${active.length} active</span></div></div>
        <div class="card stat"><div class="stat-ico">${icon('calendar')}</div><div><span class="eyebrow">Per year</span><b class="num">${Object.keys(totals).map(c => money(totals[c] * 12, c)).join(' + ') || '-'}</b><span>every cycle normalised</span></div></div>
        <div class="card stat"><div class="stat-ico">${icon('bell')}</div><div><span class="eyebrow">Next payment</span><b class="num">${next && next.d ? (next.n === 0 ? 'Today' : next.n === 1 ? 'Tomorrow' : next.n + ' days') : '-'}</b><span class="ell">${next ? esc(next.s.name) + ' · ' + money(next.s.amount, next.s.currency) : ''}</span></div></div>
      </div>
      <section class="card">${active.map(row).join('')}${paused.map(row).join('')}</section>`;
  }
};
export default view;

registerActions({
  'sub.new': () => openSub(null),
  'sub.edit': d => { const s = S().subs.find(x => x.id === d.id); if (s) openSub(s); },
  'sub.delete': async d => {
    const st = S(), s = st.subs.find(x => x.id === d.id); if (!s) return;
    if (!(await confirmDialog({ title: `Delete ${s.name}?`, ok: 'Delete', danger: true }))) return;
    st.subs = st.subs.filter(x => x !== s); tombstone(s.id); closeModal(); save();
  },
  'sub.paid': d => {
    const s = S().subs.find(x => x.id === d.id); if (!s) return;
    const due = nextDueFor(s); if (!due) return;
    (s.history || (s.history = [])).push({ d: ymd(due), a: s.amount });
    s.history = s.history.slice(-36);
    s.paidThrough = ymd(due);
    touch(s); save();
    const nx = nextDueFor(s);
    toast('Payment recorded', nx ? `Next: ${fmtDate(ymd(nx), { day: 'numeric', month: 'short', year: 'numeric' })}` : '', { kind: 'good', ms: 4000 });
  }
});
