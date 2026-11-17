/* ══════════════════════════════════════════════════════════════════════
   SHOPPING: the rules behind the list. No DOM, so it runs under node --test.

   An item is either to buy or bought. Ticking it moves it to bought;
   unticking it, or its expiry date passing, moves it back. An item
   remembers how long it lasted the last time you gave it an expiry date,
   and fills that in for you the next time you buy it.

     { id, name, kind, qty, bought, boughtAt, expires, life, expired }

   `life` is days from buying to expiry. `expired` is the date it ran out,
   kept as a note on the item once it is back on the to-buy side.
   ══════════════════════════════════════════════════════════════════════ */
import { S, save, touch, tombstone } from './store.js';
import { today, addDays, daysBetween, uid } from './util.js';

export const kinds = () => { const k = S().settings.shopKinds; return Array.isArray(k) && k.filter(Boolean).length ? k.filter(Boolean) : ['Groceries', 'Products']; };
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const find = id => S().shopping.find(x => x.id === id);

/** Add something to buy. If it is already known, it comes back instead of
 *  being listed twice. Returns { item, how: 'added' | 'again' | 'there' }. */
export function addItem({ name, kind, qty = '' }) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n) return null;
  const k = kinds().find(x => same(x, kind)) || kinds()[0];
  const it = S().shopping.find(x => same(x.name, n) && same(x.kind, k));
  if (it) {
    const how = it.bought ? 'again' : 'there';
    Object.assign(it, { bought: false, expires: null, qty: String(qty || it.qty || '').slice(0, 20) });
    touch(it); save();
    return { item: it, how };
  }
  const item = touch({ id: uid(), name: n, kind: k, qty: String(qty || '').slice(0, 20), bought: false, boughtAt: null, expires: null, life: null, expired: null });
  S().shopping.push(item);
  save();
  return { item, how: 'added' };
}
/** Tick or untick. Buying something you gave an expiry date before sets the same shelf life again. */
export function setBought(id, bought, on = today()) {
  const it = find(id);
  if (!it) return null;
  if (bought) Object.assign(it, { bought: true, boughtAt: on, expires: it.life ? addDays(on, it.life) : null, expired: null });
  else Object.assign(it, { bought: false, expires: null });
  touch(it); save();
  return it;
}
/** Give a bought item an expiry date (or clear it with null). */
export function setExpiry(id, date) {
  const it = find(id);
  if (!it) return null;
  const ok = /^\d{4}-\d\d-\d\d$/.test(date || '');
  it.expires = ok ? date : null;
  it.life = ok ? Math.max(1, daysBetween(it.boughtAt || today(), date)) : null;
  touch(it); save();
  return it;
}
export function updateItem(id, fields) {
  const it = find(id);
  if (!it) return null;
  if (fields.name != null) it.name = String(fields.name).trim().slice(0, 80) || it.name;
  if (fields.kind != null) it.kind = kinds().find(x => same(x, fields.kind)) || it.kind;
  if (fields.qty != null) it.qty = String(fields.qty).trim().slice(0, 20);
  touch(it); save();
  return it;
}
export function removeItem(id) {
  const st = S();
  st.shopping = st.shopping.filter(x => x.id !== id);
  tombstone(id); save();
}
/** Anything bought whose date has passed goes back on the list. Returns the items that moved. */
export function expireItems(on = today()) {
  const moved = S().shopping.filter(x => x.bought && x.expires && x.expires < on);
  moved.forEach(x => { Object.assign(x, { bought: false, expired: x.expires, expires: null }); touch(x); });
  if (moved.length) save();
  return moved;
}
/** Days until a bought item expires (negative once past), or null. */
export const daysLeft = (it, on = today()) => (it.bought && it.expires ? daysBetween(on, it.expires) : null);
