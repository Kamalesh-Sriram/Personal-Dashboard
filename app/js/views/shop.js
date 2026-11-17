/* SHOPPING: what to buy and what you have. Tick something and it moves to
   Bought; untick it, or let its expiry date pass, and it comes back. The
   rules are in shop.js. */
import { S, save } from '../store.js';
import { registerActions, openModal, closeModal, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, fmtDate } from '../util.js';
import { ui, refresh } from '../bus.js';
import * as Shop from '../shop.js';

const short = d => fmtDate(d, { day: 'numeric', month: 'short' });
function expiryPill(it) {
  const n = Shop.daysLeft(it);
  if (n === null) return '';
  return `<span class="pill tiny-pill ${n <= 0 ? 'bad' : n <= 2 ? 'warn' : ''}" title="Expires ${esc(short(it.expires))}">${n < 0 ? 'expired' : n === 0 ? 'expires today' : n === 1 ? 'expires tomorrow' : `${n} days left`}</span>`;
}
function rowHtml(it) {
  return `<div class="shop-row ${it.bought ? 'done' : ''}" data-flip="s-${esc(it.id)}">
    <button class="check ${it.bought ? 'on' : ''}" data-act="shop.toggle" data-id="${esc(it.id)}" aria-pressed="${it.bought}" aria-label="${it.bought ? 'Put ' + esc(it.name) + ' back on the list' : 'Mark ' + esc(it.name) + ' as bought'}">${icon('check')}</button>
    <button class="shop-n grow" data-act="shop.edit" data-id="${esc(it.id)}" title="Edit"><span class="ell">${esc(it.name)}${it.qty ? ` <span class="dim">· ${esc(it.qty)}</span>` : ''}</span>
      ${it.bought ? `<span class="tiny dim">bought ${it.boughtAt ? esc(short(it.boughtAt)) : ''}</span>` : it.expired ? `<span class="tiny tone-warn">ran out ${esc(short(it.expired))}</span>` : ''}</button>
    ${it.bought ? `${expiryPill(it)}<label class="shop-date" title="Set an expiry date">${icon('calendar')}<input type="date" value="${esc(it.expires || '')}" min="${today()}" data-change="shop.expiry" data-id="${esc(it.id)}" aria-label="Expiry date for ${esc(it.name)}"></label>` : ''}
  </div>`;
}
function sideHtml(items, bought) {
  const q = (ui.shopQuery || '').trim().toLowerCase();
  let list = items.filter(x => !!x.bought === bought && (!q || x.name.toLowerCase().includes(q)));
  if (bought) list.sort((a, b) => ((a.expires || '9999') < (b.expires || '9999') ? -1 : (a.expires || '9999') > (b.expires || '9999') ? 1 : (b.boughtAt || '') < (a.boughtAt || '') ? -1 : 1));   // soonest to expire first
  const total = list.length, cap = ui.shopAll || q ? 1000 : 80;
  list = list.slice(0, cap);
  const groups = Shop.kinds().map(k => [k, list.filter(x => x.kind === k)]);
  const stray = list.filter(x => !Shop.kinds().includes(x.kind));
  if (stray.length) groups.push(['Other', stray]);
  return `<section class="card shop-side"><div class="card-h"><span class="eyebrow">${bought ? 'Bought' : 'To buy'}</span><span class="pill ${!bought && total ? 'accent' : ''}">${total}</span></div>
    ${total ? groups.filter(([, l]) => l.length).map(([k, l]) => `<div class="shop-group"><div class="shop-k">${esc(k)} <span class="dim">${l.length}</span></div>${l.map(rowHtml).join('')}</div>`).join('')
      : `<div class="empty">${q ? 'Nothing matches.' : bought ? 'Nothing here yet. Things you tick off land here.' : 'Nothing to buy. Add something above.'}</div>`}
    ${total > cap ? `<button class="btn sm ghost" data-act="shop.all" style="margin-top:8px">Show all ${total}</button>` : ''}
  </section>`;
}

function openItem(it) {
  openModal({
    title: 'Edit item', submit: 'Save',
    left: `<button type="button" class="btn danger" data-act="shop.delete" data-id="${esc(it.id)}">${icon('trash')} Delete</button>`,
    body: `<div class="field"><label>Name</label><input class="input" name="name" value="${esc(it.name)}" maxlength="80" required autofocus></div>
      <div class="form-row"><div class="field"><label>List</label><select class="input" name="kind">${Shop.kinds().map(k => `<option ${k === it.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        <div class="field"><label>Amount (optional)</label><input class="input" name="qty" value="${esc(it.qty || '')}" maxlength="20" placeholder="2, 500 g, 1 pack"></div></div>
      ${it.bought ? `<div class="field"><label>Expires (optional)</label><input class="input" type="date" name="expires" value="${esc(it.expires || '')}" min="${today()}">
        <div class="hint">When the date passes, this goes back on your to-buy list by itself. The dashboard remembers how long it lasted and fills the date in next time you buy it.</div></div>`
        : it.life ? `<div class="hint">Last time this lasted ${it.life} day${it.life === 1 ? '' : 's'}. That is filled in as the expiry date when you tick it off.</div>` : ''}`,
    onSubmit: f => {
      if (!f.name.trim()) return false;
      Shop.updateItem(it.id, { name: f.name, kind: f.kind, qty: f.qty });
      if (it.bought && (f.expires || '') !== (it.expires || '')) Shop.setExpiry(it.id, f.expires || null);
    }
  });
}

export default {
  render() {
    const items = S().shopping, kinds = Shop.kinds();
    const kind = kinds.includes(ui.shopKind) ? ui.shopKind : kinds[0];
    return `<div class="view-h"><h2>Shopping</h2>
        <input class="input" style="max-width:240px;height:34px" placeholder="Search both lists" value="${esc(ui.shopQuery || '')}" data-input="shop.query" data-fk="shop-q" aria-label="Search both lists">
        <button class="btn sm ghost" data-act="shop.kinds">${icon('list')} Lists</button></div>
      <form class="card shop-add" data-shopadd>
        <input class="input grow" name="name" placeholder="Add something to buy" maxlength="80" data-fk="shop-add" aria-label="Add something to buy" autocomplete="off">
        <input class="input" name="qty" placeholder="Amount" maxlength="20" style="width:110px" data-fk="shop-qty" aria-label="Amount">
        <div class="seg" role="group">${kinds.map(k => `<button type="button" class="${k === kind ? 'on' : ''}" data-act="shop.kind" data-k="${esc(k)}" aria-pressed="${k === kind}">${esc(k)}</button>`).join('')}</div>
        <button class="btn primary" type="submit">${icon('plus')} Add</button>
      </form>
      <div class="shop-grid">${sideHtml(items, false)}${sideHtml(items, true)}</div>`;
  },
  mount(root) {
    const f = root.querySelector('[data-shopadd]');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const kinds = Shop.kinds(), kind = kinds.includes(ui.shopKind) ? ui.shopKind : kinds[0];
      const r = Shop.addItem({ name: f.elements.name.value, kind, qty: f.elements.qty.value });
      if (!r) return;
      f.elements.name.value = ''; f.elements.qty.value = '';
      if (r.how === 'again') toast('Back on the list', `${r.item.name} was in Bought.`, { ms: 3000 });
      else if (r.how === 'there') toast('Already on the list', r.item.name, { ms: 3000 });
    });
  }
};

registerActions({
  'shop.toggle': d => {
    const it = S().shopping.find(x => x.id === d.id);
    if (!it) return;
    ui.flipHold = 260;                                  // let the tick draw before the row slides across
    const now = Shop.setBought(d.id, !it.bought);
    if (now.bought && now.expires) toast(`${now.name} expires ${short(now.expires)}`, 'Filled in from last time. Change the date on its row if this one differs.', { ms: 5000 });
  },
  'shop.expiry': (d, e, el) => { Shop.setExpiry(d.id, el.value || null); },
  'shop.edit': d => { const it = S().shopping.find(x => x.id === d.id); if (it) openItem(it); },
  'shop.delete': async d => {
    const it = S().shopping.find(x => x.id === d.id); if (!it) return;
    if (!(await confirmDialog({ title: `Delete "${it.name}"?`, body: 'It leaves both lists. Untick it instead if you only need to buy it again.', ok: 'Delete', danger: true }))) return;
    Shop.removeItem(d.id); closeModal();
  },
  'shop.query': (d, e, el) => { ui.shopQuery = el.value; refresh(); },
  'shop.kind': d => { ui.shopKind = d.k; refresh(); },
  'shop.all': () => { ui.shopAll = true; refresh(); },
  'shop.kinds': () => {
    openModal({
      title: 'Your lists', submit: 'Save',
      body: `<p class="muted">The shopping tab is divided into these lists. One per line, in the order you want them.</p>
        <div class="field"><textarea class="input" name="kinds" rows="5" maxlength="400" aria-label="Lists, one per line">${esc(Shop.kinds().join('\n'))}</textarea>
          <div class="hint">Renaming a list here does not rename it on the items already in it: they show under "Other" until you move them.</div></div>`,
      onSubmit: f => {
        const list = [...new Set(f.kinds.split('\n').map(x => x.trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
        if (!list.length) return false;
        S().settings.shopKinds = list; save();
      }
    });
  }
});
