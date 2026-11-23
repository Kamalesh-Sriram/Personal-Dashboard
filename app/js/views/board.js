/* BOARD: kanban. Each task can carry a tag (which decides what activity
   its time is logged under), an estimate, a deadline, notes and sub-tasks. */
import { S, save, touch, tombstone } from '../store.js';
import * as E from '../engine.js';
import { registerActions, openModal, closeModal, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, uid, fmtDur, fmtMins, fmtDate, safeColor, daysBetween, addDays } from '../util.js';
import { ui, refresh } from '../bus.js';
import { L } from '../flows.js';
import { makeSortable } from '../drag.js';

const open = new Set();          // cards whose sub-tasks are expanded on the board
/* The tag colours of the earlier versions. A new tag takes the next one
   that is not in use yet, and the cycle button steps through them. */
const TAG_COLORS = ['#8AB4F8', '#2BD4F0', '#2BF0A0', '#C58AF9', '#F28B82', '#F5A623', '#FFD93D', '#FF4D5E', '#9B6EF0', '#56CFB2'];
const nextTagColor = used => TAG_COLORS.find(c => !used.some(u => (u || '').toLowerCase() === c.toLowerCase())) || TAG_COLORS[used.length % TAG_COLORS.length];
const DONE_SHOWN = 25;
/** Priority: green low, yellow medium, red high. Shown as a small flag in
 *  that colour: a different shape from the tag's dot, so the two never mix. */
export const PRIORITY = { low: { label: 'Low' }, med: { label: 'Medium' }, high: { label: 'High' } };
export function priHtml(p, withLabel = false) {
  const P = PRIORITY[p];
  if (!P) return '';
  return `<span class="pri pri-${p}" title="${P.label} priority">${icon('flag')}${withLabel ? `<span>${P.label}</span>` : `<span class="sr">${P.label} priority</span>`}</span>`;
}

function cardHtml(c, colId) {
  const st = S(), tag = st.tags.find(t => t.id === c.tagId);
  const subs = c.subs || [], sd = subs.filter(s => s.done).length, ms = E.cardMs(c.id);
  const run = E.runningActivity(), live = run && run.runCardId === c.id;
  const dl = c.deadline ? daysBetween(today(), c.deadline) : null;
  return `<article class="kcard ${tag ? 'tagged' : ''} ${live ? 'live' : ''} ${c.pri && colId !== 'done' ? 'p-' + c.pri : ''}" ${tag ? `style="--c:${safeColor(tag.color)}"` : ''} data-card="${esc(c.id)}" data-flip="c-${esc(c.id)}" data-act="card.edit" data-id="${esc(c.id)}" tabindex="0">
    <div class="kcard-top">${tag ? `<span class="tag" style="color:${safeColor(tag.color)}" title="${esc(tag.name)}"><i></i><span class="ell">${esc(tag.name)}</span></span>` : ''}<span class="grow"></span>
        ${colId !== 'done' ? `<button class="icon-btn sm" data-act="lock.in" data-card="${esc(c.id)}" title="${esc(L().lockIn)} on this task" aria-label="Start timer">${icon(live ? 'zap' : 'play')}</button>
        <button class="icon-btn sm" data-act="card.complete" data-id="${esc(c.id)}" title="Mark done" aria-label="Mark done">${icon('check')}</button>` : ''}</div>
    <div class="kcard-t">${esc(c.text)}${c.pri && colId !== 'done' ? ` ${priHtml(c.pri)}` : ''}</div>
    ${subs.length ? `<button class="sub-prog" data-act="card.subs" data-id="${esc(c.id)}" title="Show steps" aria-expanded="${open.has(c.id)}">
        <div class="bar thin grow"><i style="width:${sd / subs.length * 100}%"></i></div><span>${sd}/${subs.length}</span></button>` : ''}
    ${subs.length && open.has(c.id) ? `<div class="kcard-subs">${subs.map(s => `<button class="kcard-sub ${s.done ? 'done' : ''}" data-act="card.subToggle" data-id="${esc(c.id)}" data-sub="${esc(s.id)}">
        <span class="check sq ${s.done ? 'on' : ''}">${icon('check')}</span><span>${esc(s.t)}</span></button>`).join('')}</div>` : ''}
    <div class="kcard-m">
      ${c.est ? `<span title="Estimate">${icon('clock')}${fmtMins(c.est)}</span>` : ''}
      ${ms > 0 ? `<span title="Time logged" class="${c.est && ms > c.est * 60000 ? 'tone-warn' : ''}">${icon('track')}${fmtDur(ms)}</span>` : ''}
      ${dl !== null && colId !== 'done' ? `<span class="${dl < 0 ? 'tone-bad' : dl <= 2 ? 'tone-warn' : ''}" title="Deadline">${icon('calendar')}${dl < 0 ? Math.abs(dl) + 'd late' : dl === 0 ? 'today' : fmtDate(c.deadline, { day: 'numeric', month: 'short' })}</span>` : ''}
      ${colId === 'done' && c.doneAt ? `<span>${icon('check')}${fmtDate(c.doneAt, { day: 'numeric', month: 'short' })}</span>` : ''}
    </div>
  </article>`;
}

function columnHtml(col) {
  const st = S();
  let cards = st.cards[col.id] || [], hidden = 0;
  if (col.id === 'done') {
    cards = [...cards].sort((a, b) => ((b.doneAt || '') < (a.doneAt || '') ? -1 : 1));
    hidden = Math.max(0, cards.length - DONE_SHOWN);
    cards = cards.slice(0, DONE_SHOWN);
  }
  const est = cards.reduce((n, c) => n + (c.est || 0), 0);
  return `<section class="kcol" data-col="${esc(col.id)}" style="--cc:${safeColor(col.color, '#6FB1F0')}" aria-label="${esc(col.name)}">
    <header class="kcol-h"><span class="dot" style="background:${safeColor(col.color)}"></span><b class="grow ell">${esc(col.name)}</b>
      <span class="dim tiny">${(st.cards[col.id] || []).length}${est && col.id !== 'done' ? ' · ' + fmtMins(est) : ''}</span>
      ${col.id !== 'done' ? `<button class="icon-btn sm" data-act="card.new" data-col="${esc(col.id)}" title="Add a task here" aria-label="Add task to ${esc(col.name)}">${icon('plus')}</button>`
        : (st.cards.done || []).length ? `<button class="btn sm ghost" data-act="board.clearDone" title="Remove every task from this column. The day each was finished keeps the credit.">Clear</button>` : ''}</header>
    <div class="kcards" data-scroll="col-${esc(col.id)}">${cards.map(c => cardHtml(c, col.id)).join('')}
      ${hidden ? `<div class="tiny dim" style="text-align:center;padding:6px">${hidden} more not shown</div>` : ''}</div>
  </section>`;
}

/* ── card editor ── */
function openCard({ card = null, col = 'today', draft = null }) {
  const st = S();
  const c = draft || card || { text: '', tagId: '', activityId: '', est: '', deadline: '', notes: '', subs: [], pri: '' };
  let pri = c.pri || '';
  const priUi = () => [['', 'None'], ...Object.entries(PRIORITY).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button type="button" class="${k === pri ? 'on' : ''}" data-pri="${k}">${k ? priHtml(k) : ''}${l}</button>`).join('');
  const subs = (c.subs || []).map(s => ({ ...s }));
  const subsHtml = () => subs.map((s, i) => `<div class="row sub-row">
      <button type="button" class="check sq ${s.done ? 'on' : ''}" data-sub-toggle="${i}" aria-label="Toggle step">${icon('check')}</button>
      <input class="input" value="${esc(s.t)}" data-sub-text="${i}" maxlength="200" aria-label="Step ${i + 1}">
      <button type="button" class="icon-btn sm" data-sub-del="${i}" aria-label="Remove step">${icon('x')}</button></div>`).join('');
  openModal({
    title: card ? 'Edit task' : draft ? 'Duplicate task' : 'New task', submit: card ? 'Save' : 'Add task', wide: true,
    left: card ? `<button type="button" class="btn danger" data-act="card.delete" data-id="${esc(card.id)}">${icon('trash')} Delete</button>
                  <button type="button" class="btn" data-act="card.duplicate" data-id="${esc(card.id)}">${icon('copy')} Duplicate</button>` : '',
    body: `<div class="field"><label>Task</label><input class="input" name="text" value="${esc(c.text)}" maxlength="200" required autofocus></div>
      <div class="form-row">
        <div class="field"><label>Tag</label><select class="input" name="tagId"><option value="">No tag</option>${st.tags.map(t => `<option value="${esc(t.id)}" ${t.id === c.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Activity</label><select class="input" name="activityId"><option value="">Follow the tag</option>${st.activities.filter(a => !E.isEscape(a)).map(a => `<option value="${esc(a.id)}" ${a.id === c.activityId ? 'selected' : ''}>${esc(E.label(a))}</option>`).join('')}</select></div>
        <div class="field"><label>Column</label><select class="input" name="col">${st.columns.map(k => `<option value="${esc(k.id)}" ${k.id === col ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Estimate (min)</label><input class="input" type="number" name="est" min="0" max="6000" step="5" value="${c.est || ''}"></div>
        <div class="field"><label>Deadline</label><input class="input" type="date" name="deadline" value="${esc(c.deadline || '')}"></div>
      </div>
      <div class="field"><label>Priority</label><div class="seg pri-seg" id="card-pri">${priUi()}</div></div>
      <div class="hint" id="card-logs"></div>
      <div class="field"><label>Steps</label><div id="subs" class="col" style="gap:6px">${subsHtml()}</div>
        <div class="row"><input class="input" id="sub-new" placeholder="Add a step and press Enter" maxlength="200"><button type="button" class="btn" id="sub-add" aria-label="Add step">${icon('plus')}</button></div></div>
      <div class="field"><label>Notes</label><textarea class="input" name="notes" maxlength="4000">${esc(c.notes || '')}</textarea></div>`,
    onMount: el => {
      const box = el.querySelector('#subs'), inp = el.querySelector('#sub-new'), tagSel = el.elements.tagId, logs = el.querySelector('#card-logs');
      const redraw = () => { box.innerHTML = subsHtml(); };
      const actSel = el.elements.activityId, priBox = el.querySelector('#card-pri');
      priBox.addEventListener('click', e => { const b = e.target.closest('[data-pri]'); if (b) { pri = b.dataset.pri; priBox.innerHTML = priUi(); } });
      const logHint = () => {
        const own = st.activities.find(x => x.id === actSel.value), tag = st.tags.find(t => t.id === tagSel.value);
        const linked = tag && st.activities.find(x => x.id === tag.activityId);
        const a = own || linked || E.focusActivity();
        logs.textContent = `${L().lockIn} on this task logs time under ${E.label(a)}` + (own ? ' (set on this task)' : linked ? ' (from its tag)' : ' (the default)') + '.';
      };
      actSel.addEventListener('change', logHint);
      const add = () => { const t = inp.value.trim(); if (!t) return; subs.push({ id: uid(), t, done: false }); inp.value = ''; redraw(); inp.focus(); };
      el.querySelector('#sub-add').addEventListener('click', add);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      box.addEventListener('click', e => {
        const tg = e.target.closest('[data-sub-toggle]'), dl = e.target.closest('[data-sub-del]');
        if (tg) { subs[+tg.dataset.subToggle].done = !subs[+tg.dataset.subToggle].done; redraw(); }
        if (dl) { subs.splice(+dl.dataset.subDel, 1); redraw(); }
      });
      box.addEventListener('input', e => { const t = e.target.closest('[data-sub-text]'); if (t) subs[+t.dataset.subText].t = t.value; });
      tagSel.addEventListener('change', logHint); logHint();
    },
    onSubmit: d => {
      const text = d.text.trim();
      if (!text) return false;
      const fields = { text, tagId: d.tagId || null, activityId: d.activityId || null, est: Math.max(0, parseInt(d.est) || 0) || null, deadline: d.deadline || null, pri: pri || null, notes: d.notes.trim(), subs: subs.filter(s => s.t.trim()).map(s => ({ ...s, t: s.t.trim() })) };
      // A task that becomes High (added as High, raised to High, or moved
      // while High) goes to the top of its column. From there it can be
      // dragged anywhere; nothing re-sorts it again.
      const toTop = fields.pri === 'high' && d.col !== 'done';
      if (card) {
        const wasHigh = card.pri === 'high';
        Object.assign(card, fields); touch(card);
        const f = E.findCard(card.id);
        if (f && f.col !== d.col) { save(); E.moveCard(card.id, d.col, toTop ? 0 : null); return; }
        if (f && toTop && !wasHigh && f.index > 0) { E.moveCard(card.id, d.col, 0); return; }
      } else {
        const nc = touch({ id: uid(), ...fields });
        if (d.col === 'done') nc.doneAt = today();
        const list = st.cards[d.col] || st.cards.today;
        if (toTop) list.unshift(nc); else list.push(nc);
      }
      E.invalidate(); save();
    }
  });
}

/* ── tags: name, colour, and the activity a tag's time is logged under ── */
function openTags() {
  const st = S();
  const tags = st.tags.map(t => ({ ...t }));
  const removed = [];
  const rows = () => tags.map((t, i) => `<div class="row tag-row">
      <input type="color" class="input" value="${safeColor(t.color)}" data-k="color" data-i="${i}" aria-label="Colour">
      <button type="button" class="icon-btn sm" data-cycle="${i}" title="Next colour" aria-label="Next colour">${icon('refresh')}</button>
      <input class="input" value="${esc(t.name)}" data-k="name" data-i="${i}" maxlength="40" aria-label="Tag name">
      <select class="input" data-k="activityId" data-i="${i}" aria-label="Logs time under"><option value="">Default focus activity</option>
        ${st.activities.map(a => `<option value="${esc(a.id)}" ${a.id === t.activityId ? 'selected' : ''}>${esc(E.label(a))}</option>`).join('')}</select>
      <button type="button" class="icon-btn sm" data-del="${i}" aria-label="Remove tag">${icon('x')}</button></div>`).join('') || '<div class="empty">No tags yet.</div>';
  openModal({
    title: 'Tags', wide: true,
    body: `<p class="hint">A tag groups tasks and decides where their time goes: when you ${esc(L().lockIn.toLowerCase())} on a tagged task, the timer runs under the linked activity instead of the default.</p>
      <div class="row tiny dim" style="padding:0 2px"><span style="width:92px">Colour</span><span class="grow">Name</span><span class="grow">Logs time under</span><span style="width:28px"></span></div>
      <div id="tag-rows" class="col" style="gap:8px">${rows()}</div>
      <button type="button" class="btn sm" id="tag-add" style="align-self:flex-start">${icon('plus')} Add tag</button>`,
    onMount: el => {
      const box = el.querySelector('#tag-rows');
      const sync = e => { const t = e.target.closest('[data-k]'); if (t) tags[+t.dataset.i][t.dataset.k] = t.value; };
      box.addEventListener('input', sync); box.addEventListener('change', sync);
      box.addEventListener('click', e => {
        const d = e.target.closest('[data-del]'), cy = e.target.closest('[data-cycle]');
        if (d) { removed.push(tags[+d.dataset.del].id); tags.splice(+d.dataset.del, 1); box.innerHTML = rows(); }
        if (cy) { const t = tags[+cy.dataset.cycle], at = TAG_COLORS.findIndex(c => c.toLowerCase() === (t.color || '').toLowerCase()); t.color = TAG_COLORS[(at + 1) % TAG_COLORS.length]; box.innerHTML = rows(); }
      });
      el.querySelector('#tag-add').addEventListener('click', () => { tags.push({ id: uid(), name: 'New tag', color: nextTagColor(tags.map(t => t.color)), activityId: '' }); box.innerHTML = rows(); });
    },
    onSubmit: () => {
      st.tags = tags.filter(t => t.name.trim()).map(t => touch({ ...t, name: t.name.trim(), color: safeColor(t.color), activityId: t.activityId || null }));
      removed.forEach(tombstone);
      save();
    }
  });
}

/* ── columns ── */
function openColumns() {
  const st = S();
  const cols = st.columns.map(c => ({ ...c }));
  const fixed = id => id === 'today' || id === 'done';
  const rows = () => cols.map((c, i) => `<div class="row">
      <input type="color" class="input" value="${safeColor(c.color)}" data-k="color" data-i="${i}" aria-label="Colour">
      <input class="input" value="${esc(c.name)}" data-k="name" data-i="${i}" maxlength="30" aria-label="Column name">
      <button type="button" class="icon-btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move left">${icon('up')}</button>
      <button type="button" class="icon-btn sm" data-down="${i}" ${i === cols.length - 1 ? 'disabled' : ''} aria-label="Move right">${icon('down')}</button>
      <button type="button" class="icon-btn sm" data-del="${i}" ${fixed(c.id) ? 'disabled title="Today and Done are built in"' : ''} aria-label="Remove column">${icon('x')}</button></div>`).join('');
  openModal({
    title: 'Columns',
    body: `<p class="hint">Rename, recolour, reorder, add or remove columns. “Today” feeds the Home tab and “Done” is what scores completed tasks, so those two stay (rename them freely). Tasks in a removed column move to the first column.</p>
      <div id="col-rows" class="col" style="gap:8px">${rows()}</div>
      <button type="button" class="btn sm" id="col-add" style="align-self:flex-start">${icon('plus')} Add column</button>`,
    onMount: el => {
      const box = el.querySelector('#col-rows');
      box.addEventListener('input', e => { const t = e.target.closest('[data-k]'); if (t) cols[+t.dataset.i][t.dataset.k] = t.value; });
      box.addEventListener('click', e => {
        const u = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]'), dl = e.target.closest('[data-del]');
        if (u) { const i = +u.dataset.up; [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; }
        if (dn) { const i = +dn.dataset.down; [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; }
        if (dl) cols.splice(+dl.dataset.del, 1);
        if (u || dn || dl) box.innerHTML = rows();
      });
      el.querySelector('#col-add').addEventListener('click', () => { cols.splice(Math.max(0, cols.length - 1), 0, { id: 'col-' + uid(), name: 'New column', color: '#6FB1F0' }); box.innerHTML = rows(); });
    },
    onSubmit: () => {
      const keep = new Set(cols.map(c => c.id)), first = cols[0].id;
      st.columns.forEach(c => { if (!keep.has(c.id)) { (st.cards[c.id] || []).forEach(k => st.cards[first].push(touch(k))); delete st.cards[c.id]; } });
      st.columns = cols.map(c => ({ id: c.id, name: c.name.trim() || 'Untitled', color: safeColor(c.color) }));
      st.columns.forEach(c => { if (!st.cards[c.id]) st.cards[c.id] = []; });
      E.invalidate(); save();
    }
  });
}

/* ── drag and drop: the shared engine (js/drag.js) does the moving ── */
function wireDrag(board) {
  makeSortable(board, {
    item: '.kcard', container: '.kcards', zone: '.kcol', group: true, scrollX: '.board',
    onDrop({ el, to, index }) {
      const col = to.closest('.kcol').dataset.col, from = E.findCard(el.dataset.card);
      if (!from) return;
      // the Done column is shown sorted, so a position inside it means nothing
      if (from.col !== col || from.index !== index) E.moveCard(el.dataset.card, col, col === 'done' ? null : index);
    }
  });
}

const view = {
  wide: true,
  render() {
    const st = S();
    return `<div class="view-h"><h2>Tasks</h2>
        <button class="btn sm ghost" data-act="board.tags">${icon('list')} Tags</button>
        <button class="btn sm ghost" data-act="board.columns">${icon('board')} Columns</button>
        <button class="btn sm primary" data-act="card.new" data-col="today">${icon('plus')} New task <span class="kbd" style="border-color:currentColor;color:inherit;opacity:.7">N</span></button></div>
      <div class="board ${st.settings.colTint ? 'tinted' : ''} ${st.settings.priGlow ? 'breathe' : ''}" data-scroll="board">${st.columns.map(columnHtml).join('')}</div>`;
  },
  mount(root) { const b = root.querySelector('.board'); if (b) wireDrag(b); },
  newCard(col = 'today') { openCard({ col }); }
};
export default view;

registerActions({
  'card.new': d => openCard({ col: d.col || 'today' }),
  'card.edit': (d, e) => {
    if (e && e.target.closest('button')) return;
    const f = E.findCard(d.id); if (f) openCard({ card: f.card, col: f.col });
  },
  'card.delete': async d => {
    if (!(await confirmDialog({ title: 'Delete this task?', body: 'Time already logged against it stays in Track.', ok: 'Delete', danger: true }))) return;
    const f = E.findCard(d.id); if (!f) return;
    S().cards[f.col].splice(f.index, 1); tombstone(d.id);
    closeModal(); E.invalidate(); save();
  },
  'card.duplicate': d => {
    const f = E.findCard(d.id); if (!f) return;
    closeModal();
    const c = f.card;
    openCard({ col: f.col === 'done' ? 'today' : f.col, draft: { text: c.text, tagId: c.tagId, activityId: c.activityId, est: c.est, deadline: c.deadline, pri: c.pri, notes: c.notes, subs: (c.subs || []).map(s => ({ id: uid(), t: s.t, done: false })) } });
  },
  'card.subs': d => { open.has(d.id) ? open.delete(d.id) : open.add(d.id); refresh(); },
  'card.subToggle': d => {
    const f = E.findCard(d.id), s = f && (f.card.subs || []).find(x => x.id === d.sub);
    if (!s) return;
    s.done = !s.done; touch(f.card); save();
  },
  'board.tags': openTags,
  'board.columns': openColumns,
  'board.clearDone': async () => {
    const n = (S().cards.done || []).length;
    if (!n) return;
    if (!(await confirmDialog({ title: `Clear ${n} done task${n > 1 ? 's' : ''}?`, body: 'They leave the board. The day each one was finished keeps its credit, so no score changes.', ok: 'Clear' }))) return;
    E.clearDone();
    toast('Done column cleared', '', { ms: 2500 });
  }
});
void ui;
