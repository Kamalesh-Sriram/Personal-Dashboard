/* GOALS: a goal breaks into milestones, a milestone into tasks. Progress
   is counted in the smallest units there are, and any task can be timed,
   so a milestone and a goal show the hours that actually went into them. */
import { S, save, touch, tombstone } from '../store.js';
import * as E from '../engine.js';
import { registerActions, openModal, closeModal, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, uid, fmtDate, fmtDur, safeColor, daysBetween } from '../util.js';
import { ui, refresh } from '../bus.js';
import { makeSortable } from '../drag.js';

const COLORS = ['#E0B25A', '#F2793A', '#F26D63', '#EE5D8C', '#8B7CF6', '#6FB1F0', '#2BC4E0', '#56CFB2', '#5FCB8B', '#9AA0A8'];

export function goalUnits(g) {
  let tot = 0, done = 0;
  (g.milestones || []).forEach(m => {
    const ts = m.tasks || [];
    if (ts.length) ts.forEach(t => { tot++; if (t.done) done++; });
    else { tot++; if (m.done) done++; }
  });
  return { tot, done, pct: tot ? Math.round(done / tot * 100) : 0 };
}
const msDone = m => ((m.tasks || []).length ? m.tasks.every(t => t.done) : !!m.done);
const find = d => {
  const g = S().goals.find(x => x.id === d.goal), m = g && (g.milestones || []).find(x => x.id === d.ms), t = m && (m.tasks || []).find(x => x.id === d.task);
  return { g, m, t };
};
const commit = g => { touch(g); save(); };
/** A link as typed: "example.com/x" gets https:// in front; anything that is not web is refused. */
export function cleanUrl(v) {
  let u = String(v || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : ''; } catch { return ''; }
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
/** The first line of a note, shown faintly beside a name. */
const notePeek = note => { const t = String(note || '').trim().split('\n')[0]; return t ? `<span class="g-peek" title="${esc(String(note).trim())}">${icon('note')}<span class="ell">${esc(t)}</span></span>` : ''; };
/** Links as small chips under a goal or milestone; each opens in a new tab. */
const linkChips = (links, cls = '') => ((links || []).length ? `<div class="g-chips ${cls}">${links.map(l => `<a class="g-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${icon('link')}<span class="ell">${esc(l.t || hostOf(l.url))}</span></a>`).join('')}</div>` : '');
/** On Save, a link still sitting in the milestone dialog's field is added, not lost. Returns true to keep the dialog open. */
function el_pending() {
  const u = document.getElementById('ms-url');
  if (!u || !u.value.trim()) return false;
  document.getElementById('ms-ladd').click();
  return !!u.value.trim();          // still there: it was refused
}
const hasExtra = x => !!(String(x.notes || '').trim() || (x.links || []).length);
/** The editable list of links in a dialog or panel, with the field to add one. */
const linkRows = (links, del) => links.map((l, i) => `<div class="g-link"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${icon('link')}<span class="ell">${esc(l.t || hostOf(l.url))}</span><span class="tiny dim ell">${esc(hostOf(l.url))}</span></a>
    <button type="button" class="icon-btn sm" ${del(l, i)} aria-label="Remove link">${icon('x')}</button></div>`).join('');

/** Notes and links: what the goal is for, and where its material lives.
 *  The section folds away with its header; folded, the goal shows them in
 *  brief instead (the note beside the name, the links under the progress). */
function notesHtml(g) {
  const links = g.links || [], shut = ui.goalNotesShut.has(g.id);
  return `<div class="g-notes ${shut ? 'shut' : ''}">
    <button class="g-notes-h" data-act="goal.notesToggle" data-id="${esc(g.id)}" aria-expanded="${!shut}"><span class="label">Notes and links</span>${shut && hasExtra(g) ? `<span class="tiny dim">${[String(g.notes || '').trim() ? 'note' : '', links.length ? `${links.length} link${links.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>` : ''}<span class="goal-chev">${icon('down')}</span></button>
    ${shut ? '' : `<textarea class="input" placeholder="Why this goal, what done looks like, anything to remember" maxlength="6000" data-change="goal.noteSave" data-id="${esc(g.id)}" data-fk="gn-${esc(g.id)}" aria-label="Notes for ${esc(g.name)}">${esc(g.notes || '')}</textarea>
    ${links.length ? `<div class="g-links">${linkRows(links, l => `data-act="goal.linkDel" data-goal="${esc(g.id)}" data-id="${esc(l.id)}"`)}</div>` : ''}
    <form class="row g-link-add" data-addlink data-goal="${esc(g.id)}"><input class="input" name="url" placeholder="Paste a link" maxlength="2000" aria-label="Link address" data-fk="gl-${esc(g.id)}"><input class="input" name="t" placeholder="Name (optional)" maxlength="80" aria-label="Link name" data-fk="glt-${esc(g.id)}"><button class="btn sm" type="submit">${icon('plus')} Link</button></form>`}
  </div>`;
}

/* ── time: a task's own, a milestone's tasks added up, a goal's milestones added up ── */
const msMs = (m, since) => E.taskMs(m.id, since) + (m.tasks || []).reduce((n, t) => n + E.taskMs(t.id, since), 0);
const goalMs = (g, since) => (g.milestones || []).reduce((n, m) => n + msMs(m, since), 0);
const weekStart = () => addDays(today(), -6);
const spent = ms => (ms >= 1000 ? fmtDur(ms) : '');
/** Each time on screen names what it measures, so the clock can refresh it in place. */
function timeFor(key) {
  const [kind, id] = key.split(':');
  if (kind === 'all') return S().goals.reduce((n, g) => n + goalMs(g), 0);
  if (kind === 'week') return S().goals.reduce((n, g) => n + goalMs(g, weekStart()), 0);
  if (kind === 't') return E.taskMs(id);
  for (const g of S().goals) {
    if (kind === 'g' && g.id === id) return goalMs(g);
    if (kind === 'm') { const m = (g.milestones || []).find(x => x.id === id); if (m) return msMs(m); }
  }
  return 0;
}
const timeEl = (key, cls = 'g-time') => `<span class="${cls}" data-tm="${esc(key)}">${spent(timeFor(key))}</span>`;

/** Start or stop the timer for one task. */
function timerBtn(id, name) {
  const run = E.runningActivity(), live = !!run && run.runTaskId === id;
  return live
    ? `<button class="icon-btn sm keep live" data-act="track.stop" title="Stop the timer" aria-label="Stop the timer">${icon('stop')}</button>`
    : `<button class="icon-btn sm keep" data-act="lock.in" data-task="${esc(id)}" title="Start a timer for this" aria-label="Start a timer for ${esc(name)}">${icon('play')}</button>`;
}

function goalHtml(g) {
  const u = goalUnits(g), open = ui.goalOpen.has(g.id);
  const brief = !open || ui.goalNotesShut.has(g.id);       // notes and links in brief, when their section is not showing them
  const dl = g.deadline ? daysBetween(today(), g.deadline) : null;
  const run = E.runningActivity(), liveId = run ? run.runTaskId : null;
  const n = (g.milestones || []).length;
  const ms = !open ? '' : (g.milestones || []).map(m => {
    const mo = ui.goalOpen.has(m.id), ts = m.tasks || [], d = msDone(m);
    return `<div class="ms ${d ? 'done' : ''} ${liveId === m.id ? 'live' : ''}" data-id="${esc(m.id)}" data-goal="${esc(g.id)}" data-flip="m-${esc(m.id)}">
      <div class="row">
        <button class="check sq ${d ? 'on' : ''}" data-act="goal.msToggle" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-pressed="${d}" aria-label="Toggle milestone">${icon('check')}</button>
        <button class="ms-n grow" data-act="goal.open" data-id="${esc(m.id)}" aria-expanded="${mo}"><span class="ms-name ell">${esc(m.name)}</span>${notePeek(m.notes)}</button>
        ${timeEl('m:' + m.id)}
        ${ts.length ? `<span class="tiny dim">${ts.filter(t => t.done).length}/${ts.length}</span>` : (d ? '' : timerBtn(m.id, m.name))}
        <button class="icon-btn sm" data-act="goal.msEdit" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-label="Edit milestone">${icon('edit')}</button>
        <button class="icon-btn sm" data-act="goal.msDel" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-label="Delete milestone">${icon('x')}</button>
      </div>
      ${linkChips(m.links, 'ms-chips')}
      ${mo ? `<div class="ms-tasks" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}">${ts.map(t => `<div class="row g-task ${t.done ? 'tdone' : ''} ${liveId === t.id ? 'live' : ''}" data-id="${esc(t.id)}" data-flip="t-${esc(t.id)}">
          <button class="check sq ${t.done ? 'on' : ''}" data-act="goal.taskToggle" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="Toggle task">${icon('check')}</button>
          <span class="grow">${esc(t.name)}</span>
          ${timeEl('t:' + t.id)}
          ${t.done ? '' : timerBtn(t.id, t.name)}
          <button class="icon-btn sm" data-act="goal.toBoard" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" title="Send to Today on the Tasks tab" aria-label="Send to Tasks">${icon('board')}</button>
          <button class="icon-btn sm" data-act="goal.taskDel" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" aria-label="Delete task">${icon('x')}</button></div>`).join('')}
        <form class="row" data-addtask data-goal="${esc(g.id)}" data-ms="${esc(m.id)}"><input class="input" name="name" placeholder="Add a task" maxlength="160" data-fk="t-${esc(m.id)}" aria-label="Add a task"><button class="btn sm" type="submit" aria-label="Add">${icon('plus')}</button></form></div>` : ''}
    </div>`;
  }).join('');
  return `<article class="card goal ${open ? 'open' : ''}" data-id="${esc(g.id)}" data-flip="g-${esc(g.id)}" style="--c:${safeColor(g.color)}">
    <div class="row">
      <button class="goal-n grow" data-act="goal.open" data-id="${esc(g.id)}" aria-expanded="${open}"><span class="dot" style="background:var(--c)"></span><span class="goal-name ell">${esc(g.name)}</span><span class="goal-chev">${icon('down')}</span>${brief ? notePeek(g.notes) : ''}</button>
      ${dl !== null ? `<span class="pill ${dl < 0 ? 'bad' : dl <= 7 ? 'warn' : ''}">${dl < 0 ? Math.abs(dl) + 'd overdue' : dl === 0 ? 'due today' : dl + 'd left'}</span>` : ''}
      <b class="num" style="font-size:20px">${u.pct}%</b>
      <button class="icon-btn sm" data-act="goal.edit" data-id="${esc(g.id)}" aria-label="Edit goal">${icon('edit')}</button>
    </div>
    <div class="bar" style="margin-top:12px"><i style="width:${u.pct}%;background:var(--c)"></i></div>
    <div class="goal-meta"><span>${u.done} of ${u.tot} done</span><span>${n} milestone${n === 1 ? '' : 's'}</span>${g.deadline ? `<span>due ${fmtDate(g.deadline, { day: 'numeric', month: 'short', year: 'numeric' })}</span>` : ''}${timeEl('g:' + g.id, 'goal-spent')}</div>
    ${brief ? linkChips(g.links) : ''}
    ${open ? `<div class="goal-body" data-goal="${esc(g.id)}">${ms || '<div class="empty" style="padding:8px 0">No milestones yet.</div>'}
      <form class="row" data-addms data-goal="${esc(g.id)}"><input class="input" name="name" placeholder="Add a milestone" maxlength="120" data-fk="m-${esc(g.id)}" aria-label="Add a milestone"><button class="btn sm" type="submit">${icon('plus')} Milestone</button></form>
      ${notesHtml(g)}</div>` : ''}
  </article>`;
}

/* ── the side panel: where all of it stands, and where the hours went ── */
function nextUp(g) {
  for (const m of g.milestones || []) {
    if (msDone(m)) continue;
    const ts = m.tasks || [];
    if (!ts.length) return { id: m.id, name: m.name, under: '' };
    const t = ts.find(x => !x.done);
    if (t) return { id: t.id, name: t.name, under: m.name };
  }
  return null;
}
function sideHtml() {
  const goals = S().goals;
  let tot = 0, done = 0;
  goals.forEach(g => { const u = goalUnits(g); tot += u.tot; done += u.done; });
  const pct = tot ? Math.round(done / tot * 100) : 0;
  const times = goals.map(g => ({ g, ms: goalMs(g) })), top = Math.max(1, ...times.map(x => x.ms)), any = times.some(x => x.ms >= 1000);
  const next = goals.map(g => ({ g, n: nextUp(g) })).filter(x => x.n).slice(0, 5);
  return `<section class="card" aria-label="Overview">
      <div class="card-h"><span class="eyebrow">Overview</span><span class="tiny dim">${goals.length} goal${goals.length === 1 ? '' : 's'}</span></div>
      <div class="gs-top"><b class="num">${pct}%</b><span>${done} of ${tot} done</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="mini-stats"><div><b class="num" data-tm="all:">${spent(timeFor('all:')) || '0m'}</b><span>Time spent</span></div>
        <div><b class="num" data-tm="week:">${spent(timeFor('week:')) || '0m'}</b><span>Last 7 days</span></div></div>
    </section>
    <section class="card" aria-label="Time spent">
      <div class="card-h"><span class="eyebrow">Time spent</span></div>
      ${any ? `<div class="gs-times">${times.map(({ g, ms }) => `<div class="gs-time" style="--c:${safeColor(g.color)}">
          <div class="row"><span class="dot" style="background:var(--c)"></span><span class="grow ell">${esc(g.name)}</span><b data-tm="g:${esc(g.id)}">${spent(ms) || '-'}</b></div>
          <div class="bar thin"><i data-tw="${esc(g.id)}" style="width:${(ms / top * 100).toFixed(1)}%;background:var(--c)"></i></div></div>`).join('')}</div>`
        : `<div class="empty" style="padding:6px 0 2px">Nothing timed yet. Press play on a task and its time adds up here.</div>`}
    </section>
    ${next.length ? `<section class="card" aria-label="Next up">
      <div class="card-h"><span class="eyebrow">Next up</span></div>
      <div class="list">${next.map(({ g, n }) => `<div class="li gs-next"><span class="dot" style="background:${safeColor(g.color)}"></span>
          <div class="grow"><div class="ell">${esc(n.name)}</div><div class="tiny dim ell">${esc(g.name)}${n.under ? ' · ' + esc(n.under) : ''}</div></div>
          ${timerBtn(n.id, n.name)}</div>`).join('')}</div>
    </section>` : ''}`;
}

function openGoal(g) {
  const st = S(), cur = g || { name: '', deadline: '', color: COLORS[st.goals.length % COLORS.length], activityId: '' };
  let color = cur.color;
  const acts = st.activities.filter(a => !E.isEscape(a));
  openModal({
    title: g ? 'Edit goal' : 'New goal', submit: g ? 'Save' : 'Add goal',
    left: g ? `<button type="button" class="btn danger" data-act="goal.delete" data-id="${esc(g.id)}">${icon('trash')} Delete</button>` : '',
    body: `<div class="field"><label>Goal</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="120" required autofocus></div>
      <div class="field"><label>Deadline (optional)</label><input class="input" type="date" name="deadline" value="${esc(cur.deadline || '')}"></div>
      <div class="field"><label>Activity</label><select class="input" name="activityId">
          <option value="">${esc(E.label(E.focusActivity()))} (default)</option>
          ${acts.map(a => `<option value="${esc(a.id)}" ${a.id === cur.activityId ? 'selected' : ''}>${esc(E.label(a))}</option>`).join('')}</select>
        <div class="hint">Time on this goal's tasks is logged under this activity on the Track tab.</div></div>
      <div class="field"><label>Colour</label><div class="swatches" id="g-c">${COLORS.map(c => `<button type="button" class="swatch sm ${c === color ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></div>`,
    onMount: el => el.querySelector('#g-c').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; el.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); }),
    onSubmit: d => {
      const name = d.name.trim(); if (!name) return false;
      const fields = { name, deadline: d.deadline || null, color, activityId: d.activityId || null };
      if (g) { Object.assign(g, fields); touch(g); }
      else { const n = touch({ id: uid(), ...fields, milestones: [] }); S().goals.push(n); ui.goalOpen.add(n.id); }
      save();
    }
  });
}

export default {
  render() {
    const goals = S().goals;                 // every goal starts closed; opening one is remembered until the page reloads
    return `<div class="view-h"><h2>Goals</h2><button class="btn sm primary" data-act="goal.new">${icon('plus')} Goal</button></div>
      ${goals.length ? `<div class="goals-wrap"><div class="goals">${goals.map(goalHtml).join('')}</div><aside class="goals-side">${sideHtml()}</aside></div>`
        : `<div class="card empty" style="padding:48px 16px">No goals yet. A goal here is something with an end: break it into milestones and tasks, time the work, and send tasks to the Tasks tab when it is time.<br><button class="btn primary" data-act="goal.new">${icon('plus')} Add a goal</button></div>`}`;
  },
  mount(root) {
    // Three lists nest here, and each can be put in order by dragging: the
    // tasks of a milestone, the milestones of a goal, and the goals themselves.
    const list = root.querySelector('.goals');
    if (list) {
      const order = (arr, box, sel) => { const ids = [...box.querySelectorAll(':scope > ' + sel)].map(el => el.dataset.id), by = new Map(arr.map(x => [x.id, x])); return [...ids.map(id => by.get(id)).filter(Boolean), ...arr.filter(x => !ids.includes(x.id))]; };
      const KEEP = 'input, textarea, select, a, .icon-btn, .check, form, .g-notes';
      makeSortable(list, { item: '.g-task', container: '.ms-tasks', ignore: KEEP,
        onDrop({ to }) { const { g, m } = find(to.dataset); if (m) { m.tasks = order(m.tasks, to, '.g-task'); commit(g); } } });
      makeSortable(list, { item: '.ms', container: '.goal-body', ignore: KEEP + ', .ms-tasks',
        onDrop({ to }) { const g = S().goals.find(x => x.id === to.dataset.goal); if (g) { g.milestones = order(g.milestones, to, '.ms'); commit(g); } } });
      makeSortable(list, { item: '.goal', container: '.goals', ignore: KEEP + ', .goal-body',
        onDrop({ to }) { const st = S(); st.goals = order(st.goals, to, '.goal'); save(); } });
    }
    root.querySelectorAll('form[data-addlink]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const g = S().goals.find(x => x.id === f.dataset.goal); if (!g) return;
      const url = cleanUrl(f.elements.url.value);
      if (!url) { toast('That is not a web link', 'Paste an address that starts with http:// or https://, or a site like example.com.', { kind: 'bad', ms: 5000 }); return; }
      (g.links || (g.links = [])).push({ id: uid(), url, t: f.elements.t.value.trim() });
      f.elements.url.value = ''; f.elements.t.value = '';
      commit(g);
    }));
    root.querySelectorAll('form[data-addms], form[data-addtask]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const name = f.elements.name.value.trim(); if (!name) return;
      const { g, m } = find(f.dataset);
      if (!g) return;
      if (f.hasAttribute('data-addms')) { const ms = { id: uid(), name, done: false, tasks: [] }; (g.milestones || (g.milestones = [])).push(ms); ui.goalOpen.add(ms.id); }
      else if (m) (m.tasks || (m.tasks = [])).push({ id: uid(), name, done: false });
      f.elements.name.value = '';
      commit(g);
    }));
  },
  /** While a goal task is being timed, its numbers count up in place. */
  tick(root) {
    const run = E.runningActivity();
    if (!run || !run.runTaskId) return;
    root.querySelectorAll('[data-tm]').forEach(el => {
      const txt = spent(timeFor(el.dataset.tm)) || (el.tagName === 'B' ? '0m' : '');
      if (el.textContent !== txt) el.textContent = txt;
    });
  }
};

registerActions({
  'goal.new': () => openGoal(null),
  'goal.edit': d => { const g = S().goals.find(x => x.id === d.id); if (g) openGoal(g); },
  'goal.open': d => { ui.goalOpen.has(d.id) ? ui.goalOpen.delete(d.id) : ui.goalOpen.add(d.id); refresh(); },
  'goal.delete': async d => {
    const st = S(), g = st.goals.find(x => x.id === d.id); if (!g) return;
    if (!(await confirmDialog({ title: `Delete “${g.name}”?`, body: 'Its milestones and tasks go with it. The time you logged stays on the Track tab.', ok: 'Delete', danger: true }))) return;
    st.goals = st.goals.filter(x => x !== g); tombstone(g.id); closeModal(); save();
  },
  'goal.noteSave': (d, e, el) => { const g = S().goals.find(x => x.id === d.id); if (!g || (g.notes || '') === el.value.trim()) return; g.notes = el.value.trim(); commit(g); },
  'goal.linkDel': d => { const g = S().goals.find(x => x.id === d.goal); if (!g) return; g.links = (g.links || []).filter(l => l.id !== d.id); commit(g); },
  'goal.msToggle': d => {
    const { g, m } = find(d); if (!m) return;
    const ts = m.tasks || [];
    if (ts.length) { const all = ts.every(t => t.done); ts.forEach(t => { t.done = !all; }); m.done = !all; } else m.done = !m.done;
    E.stampMilestone(m);
    commit(g);
  },
  'goal.msEdit': d => {
    const { g, m } = find(d); if (!m) return;
    const links = (m.links || []).map(l => ({ ...l }));
    const rows = () => linkRows(links, (l, i) => `data-ldel="${i}"`) || '<div class="tiny dim">No links yet.</div>';
    openModal({ title: 'Edit milestone', wide: true,
      body: `<div class="field"><label>Milestone</label><input class="input" name="name" value="${esc(m.name)}" maxlength="120" required autofocus></div>
        <div class="field"><label>Notes</label><textarea class="input" name="notes" maxlength="6000" placeholder="What done looks like, anything to remember">${esc(m.notes || '')}</textarea></div>
        <div class="field"><label>Links</label><div class="g-links" id="ms-links">${rows()}</div>
          <div class="row g-link-add" style="margin-top:6px"><input class="input" id="ms-url" placeholder="Paste a link" maxlength="2000" aria-label="Link address"><input class="input" id="ms-lt" placeholder="Name (optional)" maxlength="80" aria-label="Link name"><button type="button" class="btn sm" id="ms-ladd">${icon('plus')} Link</button></div></div>`,
      onMount: el => {
        const box = el.querySelector('#ms-links'), url = el.querySelector('#ms-url'), lt = el.querySelector('#ms-lt');
        const add = () => {
          if (!url.value.trim()) return;
          const u = cleanUrl(url.value);
          if (!u) { toast('That is not a web link', 'Paste an address that starts with http:// or https://, or a site like example.com.', { kind: 'bad', ms: 5000 }); return; }
          links.push({ id: uid(), url: u, t: lt.value.trim() }); url.value = ''; lt.value = ''; box.innerHTML = rows(); url.focus();
        };
        el.querySelector('#ms-ladd').addEventListener('click', add);
        [url, lt].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
        box.addEventListener('click', e => { const x = e.target.closest('[data-ldel]'); if (x) { links.splice(+x.dataset.ldel, 1); box.innerHTML = rows(); } });
      },
      onSubmit: f => {
        if (!f.name.trim()) return false;
        if (el_pending(f)) return false;
        m.name = f.name.trim(); m.notes = (f.notes || '').trim(); m.links = links;
        commit(g);
      } });
  },
  'goal.notesToggle': d => { ui.goalNotesShut.has(d.id) ? ui.goalNotesShut.delete(d.id) : ui.goalNotesShut.add(d.id); refresh(); },
  'goal.msDel': async d => {
    const { g, m } = find(d); if (!m) return;
    if ((m.tasks || []).length && !(await confirmDialog({ title: `Delete “${m.name}”?`, body: 'Its tasks go with it.', ok: 'Delete', danger: true }))) return;
    g.milestones = g.milestones.filter(x => x !== m); commit(g);
  },
  'goal.taskToggle': d => { const { g, m, t } = find(d); if (!t) return; t.done = !t.done; m.done = m.tasks.every(x => x.done); E.stampMilestone(m); commit(g); },
  'goal.taskDel': d => { const { g, m, t } = find(d); if (!t) return; m.tasks = m.tasks.filter(x => x !== t); commit(g); },
  'goal.toBoard': d => {
    const { g, t } = find(d); if (!t) return;
    // the card remembers where it came from, so time on it counts toward this task
    S().cards.today.push(touch({ id: uid(), text: t.name, tagId: null, subs: [], notes: `From goal: ${g.name}`, goalTask: t.id }));
    save();
    toast('Added to Today', t.name, { kind: 'good', ms: 3500 });
  }
});
