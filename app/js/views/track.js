/* TRACK: start and stop activity timers, see the day as a 24-hour ring,
   and correct or rate any session. */
import { S, save, touch, tombstone } from '../store.js';
import * as E from '../engine.js';
import { registerActions, openModal, closeModal, confirmDialog, segHtml, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, uid, fmtDur, fmtTimer, fmtClock, fmtMinOfDay, fmtDate, safeColor, parseYmd, pad, minOfDay, dayOffsetMin, dayEndTs, hmToMin } from '../util.js';
import { ui, refresh } from '../bus.js';
import { dayRing } from '../charts.js';
import { makeSortable, reorderWithin } from '../drag.js';

const COLORS = ['#E0B25A', '#F2793A', '#F26D63', '#EE5D8C', '#8B7CF6', '#6FB1F0', '#2BC4E0', '#56CFB2', '#5FCB8B', '#A3C94F', '#C9A27A', '#9AA0A8'];
const viewDate = () => ui.trackDate || today();
const h24 = () => S().settings.clock24;
/** Minutes into the day a session belongs to. A late day runs past 1440. */
const minOf = (ts, date) => minOfDay(ts, date);
const dayLen = () => 1440 + dayOffsetMin();

function tileHtml(a) {
  const t = today(), ms = E.actMsOn(a, t), run = a.isRunning;
  return `<div class="tile ${run ? 'run' : ''}" data-id="${esc(a.id)}" data-flip="a-${esc(a.id)}" style="--c:${safeColor(a.color)}">
    <button class="tile-main" data-act="activity.toggle" data-id="${esc(a.id)}" aria-pressed="${run}" title="${run ? 'Stop' : 'Start'} ${esc(a.name)}">
      ${a.emoji ? `<span class="tile-e">${esc(a.emoji)}</span>` : ''}
      <span class="tile-n ell">${esc(a.name)}</span>
      <span class="tile-t" ${run ? `data-live-act="${esc(a.id)}"` : ''}>${ms > 0 ? (run ? fmtTimer(ms) : fmtDur(ms)) : '-'}</span>
      <span class="tile-s">${icon(run ? 'stop' : 'play')}</span>
    </button>
    <button class="icon-btn sm tile-edit" data-act="activity.edit" data-id="${esc(a.id)}" aria-label="Edit ${esc(a.name)}">${icon('edit')}</button>
  </div>`;
}
function tilesHtml() {
  const acts = S().activities;
  if (!acts.length) return `<div class="empty">No activities yet. An activity is anything you want to time: work, study, the gym, a meal.<br><button class="btn primary sm" data-act="activity.new">${icon('plus')} Add your first activity</button></div>`;
  return Object.keys(E.TIERS).map(k => {
    const list = acts.filter(a => E.tierOf(a) === k);
    if (!list.length) return '';
    const rate = Math.round(S().settings.xp.perHour * E.TIERS[k].mult * 10) / 10;
    return `<div class="tier"><div class="tier-h"><span class="eyebrow">${E.TIERS[k].label}</span><span class="tiny dim">${rate} XP per hour</span></div>
      <div class="tiles">${list.map(tileHtml).join('')}</div></div>`;
  }).join('') + (acts.length > 1 ? `<div class="tiny dim" style="margin-top:12px">${matchMedia('(hover: none)').matches ? 'Press and hold a block, then drag to move it.' : 'Drag a block to move it.'}</div>` : '');
}

/* ── drag to reorder: a tile stays inside its own XP group ── */
function wireSort(box) {
  makeSortable(box, {
    item: '.tile', container: '.tiles', grid: true, ignore: '.tile-edit',
    onDrop({ to }) {
      const st = S();
      st.activities = reorderWithin(st.activities, [...to.querySelectorAll('.tile')].map(t => t.dataset.id));
      save();
    }
  });
}

function dayData(date) {
  const w = E.winMinutes(), rows = E.sessionsOn(date);
  const spans = rows.map(({ s }) => [minOf(s.start, date), Math.min(dayLen(), minOf(s.start, date) + s.dur / 60000)]).sort((a, b) => a[0] - b[0]);
  // largest untracked stretch inside the productive window: the honest number
  let cursor = w.start, biggest = 0, at = w.start;
  spans.forEach(([s0, s1]) => {
    if (s1 <= w.start || s0 >= w.end) return;
    const gap = Math.max(0, Math.min(s0, w.end) - cursor);
    if (gap > biggest) { biggest = gap; at = cursor; }
    cursor = Math.max(cursor, Math.min(s1, w.end));
  });
  const tail = Math.min(w.end, date === today() ? E.nowMinutes() : w.end);
  if (tail - cursor > biggest) { biggest = tail - cursor; at = cursor; }
  return { w, rows, biggest, at };
}
function ringHtmlFor(date) {
  const { w, rows, biggest, at } = dayData(date);
  const sessions = rows.map(({ a, s }) => {
    const m0 = minOf(s.start, date), m1 = Math.min(dayLen(), m0 + s.dur / 60000), tier = E.tierOf(a);
    return { startMin: m0, endMin: m1, color: a.color, opacity: tier === 'deep' ? 1 : tier === 'upkeep' ? 0.75 : 0.45,
      title: `${a.name} · ${fmtMinOfDay(m0, h24())}-${fmtMinOfDay(m1, h24())} · ${fmtDur(s.dur)}`, act: s.live ? '' : 'session.edit', id: a.id, start: s.start };
  });
  const tracked = E.trackedMsOn(date);
  return `${dayRing({ sessions, win: w, nowMin: date === today() ? E.nowMinutes() : null, center: fmtDur(tracked), centerSub: 'tracked', h24: h24() })}
    <div class="ring-stats">
      <div><span>Focus</span><b>${fmtDur(E.focusMsOn(date))}</b></div>
      <div><span>Largest gap</span><b class="tone-${biggest >= 120 ? 'bad' : biggest >= 60 ? 'warn' : 'good'}">${fmtDur(biggest * 60000)}</b>${biggest > 0 ? `<i>from ${fmtMinOfDay(at, h24())}</i>` : ''}</div>
      <div><span>First deep block</span><b>${E.ttfbFor(date) === null ? '-' : '+' + E.ttfbFor(date) + 'm'}</b></div>
    </div>`;
}

function sessionsHtml(date) {
  const rows = E.sessionsOn(date);
  if (!rows.length) return `<div class="empty">${date === today() ? "You haven't tracked anything yet today." : 'Nothing was tracked on this day.'}</div>`;
  if (ui.sessView === 'timeline') return timelineHtml(date, rows);
  return `<div class="sess-list">${rows.map(({ a, s }) => {
    const tier = E.tierOf(a), fc = s.cardId ? E.findCard(s.cardId) : null, gt = fc ? null : E.findGoalTask(s.taskId);
    const what = fc ? fc.card.text : gt ? gt.t.name : '';
    const pips = s.live ? '<span class="tiny dim">running</span>' : `<span class="rate" role="group" aria-label="Focus rating">${[1, 2, 3, 4, 5].map(n =>
      `<button class="${s.eff != null && s.eff * 5 >= n - 0.01 ? 'on' : ''}" data-act="session.rate" data-id="${esc(a.id)}" data-start="${s.start}" data-v="${n}" title="Focus ${n}/5" aria-label="Rate ${n} of 5"></button>`).join('')}</span>`;
    return `<div class="sess" style="--c:${safeColor(a.color)}">
      ${a.emoji ? `<span class="sess-e">${esc(a.emoji)}</span>` : ''}
      <div class="grow"><div class="ell"><b>${esc(a.name)}</b>${what ? ` <span class="dim">· ${esc(what)}</span>` : ''}</div>
        <div class="tiny dim">${fmtClock(s.start, h24())} to ${s.live ? 'now' : fmtClock(s.end, h24())}${s.manual ? ' · logged by hand' : ''}</div></div>
      <span class="pill tiny-pill ${tier === 'deep' ? 'good' : tier === 'upkeep' ? 'warn' : ''}">${E.TIERS[tier].label}</span>
      ${pips}
      <b class="sess-d">${fmtDur(s.dur)}</b>
      ${s.live ? `<button class="icon-btn sm" data-act="track.stop" title="Stop" aria-label="Stop">${icon('stop')}</button>`
        : `<button class="icon-btn sm" data-act="session.edit" data-id="${esc(a.id)}" data-start="${s.start}" title="Edit" aria-label="Edit session">${icon('edit')}</button>`}
    </div>`;
  }).join('')}</div>`;
}
/** Linear strip, one lane per tier, zoomed to the hours that matter. */
function timelineHtml(date, rows) {
  const w = E.winMinutes();
  const lo = Math.floor(Math.min(w.start, ...rows.map(r => minOf(r.s.start, date))) / 60) * 60;
  const hi = Math.ceil(Math.max(w.end, ...rows.map(r => minOf(r.s.start, date) + r.s.dur / 60000)) / 60) * 60;
  const span = Math.max(60, Math.min(dayLen(), hi) - lo), pct = m => ((m - lo) / span * 100).toFixed(3);
  let grid = '';
  const step = span > 14 * 60 ? 180 : span > 7 * 60 ? 120 : 60;
  for (let m = Math.ceil(lo / step) * step; m <= lo + span; m += step) grid += `<i style="left:${pct(m)}%"><span>${fmtMinOfDay(m, h24())}</span></i>`;
  const lane = k => `<div class="tl-lane"><span class="tl-l">${E.TIERS[k].label}</span><div class="tl-track">
      ${rows.filter(r => E.tierOf(r.a) === k).map(({ a, s }) => { const m0 = minOf(s.start, date), m1 = Math.min(dayLen(), m0 + s.dur / 60000);
        return `<button class="tl-b" style="left:${pct(m0)}%;width:${Math.max(0.5, (m1 - m0) / span * 100).toFixed(3)}%;background:${safeColor(a.color)}"
          ${s.live ? '' : `data-act="session.edit" data-id="${esc(a.id)}" data-start="${s.start}"`} title="${esc(a.name)} · ${fmtMinOfDay(m0, h24())}-${fmtMinOfDay(m1, h24())} · ${fmtDur(s.dur)}">${m1 - m0 >= span / 22 ? esc(a.emoji || '') : ''}</button>`; }).join('')}
    </div></div>`;
  const now = date === today() ? E.nowMinutes() : null;
  return `<div class="tl"><div class="tl-grid"><div class="tl-win" style="left:${pct(Math.max(lo, w.start))}%;width:${((Math.min(w.end, lo + span) - Math.max(lo, w.start)) / span * 100).toFixed(3)}%"></div>${grid}
      ${now !== null && now >= lo && now <= lo + span ? `<u style="left:${pct(now)}%"></u>` : ''}</div>
    ${Object.keys(E.TIERS).map(lane).join('')}</div>
    <div class="tiny dim" style="margin-top:8px">The shaded band is your working day. Click a block to edit it.</div>`;
}

/* ── editors ── */
function openActivity(a) {
  const isNew = !a;
  const cur = a || { name: '', emoji: '', color: COLORS[S().activities.length % COLORS.length], weight: 'upkeep', isEscape: false };
  let weight = cur.weight, color = cur.color;
  const tierUi = () => Object.keys(E.TIERS).map(k => `<button type="button" class="${k === weight ? 'on' : ''}" data-w="${k}">${E.TIERS[k].label}</button>`).join('');
  openModal({
    title: isNew ? 'New activity' : 'Edit activity', submit: isNew ? 'Add activity' : 'Save',
    left: isNew ? '' : `<button type="button" class="btn danger" data-act="activity.delete" data-id="${esc(a.id)}">${icon('trash')} Delete</button>`,
    body: `<div class="form-row" style="grid-template-columns:84px 1fr">
        <div class="field"><label>Icon (optional)</label><input class="input" name="emoji" value="${esc(cur.emoji || '')}" maxlength="4" style="text-align:center;font-size:20px"></div>
        <div class="field"><label>Name</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="40" required autofocus></div></div>
      <div class="field"><label>XP weight</label><div class="seg" id="act-w">${tierUi()}</div><div class="hint" id="act-w-note"></div></div>
      <div class="field"><label>Colour</label><div class="swatches" id="act-c">${COLORS.map(c => `<button type="button" class="swatch sm ${c === color ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></div>
      <label class="row"><input type="checkbox" name="isEscape" ${cur.isEscape ? 'checked' : ''}> <span>This is a break: a meal, a nap, scrolling</span></label>
      <div class="hint">Breaks never count as work and reset the combo. During a campaign, starting one with under 25 minutes of focus on the board is challenged (never blocked).</div>`,
    onMount: el => {
      const note = el.querySelector('#act-w-note'), seg = el.querySelector('#act-w'), sw = el.querySelector('#act-c');
      const paint = () => { seg.innerHTML = tierUi(); note.textContent = `${Math.round(S().settings.xp.perHour * E.TIERS[weight].mult * 10) / 10} XP per hour. ${E.TIERS[weight].note}`; };
      seg.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) { weight = b.dataset.w; paint(); } });
      sw.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { color = b.dataset.c; sw.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); } });
      paint();
    },
    onSubmit: d => {
      const name = d.name.trim(); if (!name) return false;
      const fields = { name, emoji: d.emoji.trim(), color, weight: d.isEscape ? 'tracked' : weight, isEscape: !!d.isEscape };
      if (isNew) S().activities.push(touch({ id: uid(), ...fields, isRunning: false, lastStart: 0, sessions: [] }));
      else { Object.assign(a, fields); touch(a); }
      E.invalidate(); save();
    }
  });
}
function openSession(a, s) {
  const st = S(), isNew = !s, date = s ? s.date : viewDate();
  const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const now = Date.now();
  if (!st.activities.length) { toast('Add an activity first'); return; }
  openModal({
    title: isNew ? 'Log time by hand' : 'Edit session', submit: isNew ? 'Log it' : 'Save',
    left: isNew ? '' : `<button type="button" class="btn danger" data-act="session.delete" data-id="${esc(a.id)}" data-start="${s.start}">${icon('trash')} Delete</button>`,
    body: `<div class="field"><label>Activity</label><select class="input" name="act">${st.activities.map(x => `<option value="${esc(x.id)}" ${a && x.id === a.id ? 'selected' : ''}>${esc(E.label(x))}</option>`).join('')}</select></div>
      <div class="form-row">
        <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${date}" max="${today()}" required></div>
        <div class="field"><label>Start</label><input class="input" type="time" name="start" value="${s ? hm(s.start) : hm(now - 30 * 60000)}" required></div>
        <div class="field"><label>End</label><input class="input" type="time" name="end" value="${s ? hm(s.end) : hm(now)}" required></div>
        <div class="field"><label>Focus (1-5)</label><input class="input" type="number" name="eff" min="1" max="5" value="${s && s.eff != null ? Math.round(s.eff * 5) : ''}" placeholder="-"></div>
      </div><div class="hint">If the end is earlier than the start, the session is taken to run to the end of that day.${dayOffsetMin() ? ` Your days run until ${fmtMinOfDay(dayOffsetMin(), h24())}, so a time before that belongs to the night of the date you pick.` : ''}</div>`,
    onSubmit: d => {
      const target = st.activities.find(x => x.id === d.act);
      if (!target || !d.date || !d.start || !d.end) return false;
      // on a late day, a time after midnight belongs to the night of the date picked
      const at = hm => new Date(`${hmToMin(hm) < dayOffsetMin() ? addDays(d.date, 1) : d.date}T${hm}:00`).getTime();
      const start = at(d.start);
      let end = at(d.end);
      if (end <= start) end = dayEndTs(d.date);
      end = Math.min(end, Date.now());
      if (end - start < E.MIN_SESSION_MS) { toast('That session is in the future or has no length', '', { kind: 'bad', ms: 4000 }); return false; }
      const overlap = E.sessionsOn(d.date, false).some(x => x.s !== s && start < x.s.end && end > x.s.start);
      if (overlap) { toast('That overlaps another session', 'Adjust the times, or edit the other one first.', { kind: 'bad', ms: 5000 }); return false; }
      if (s) { a.sessions = a.sessions.filter(x => x !== s); tombstone('s:' + s.start); touch(a); }
      const eff = d.eff === '' ? (s ? s.eff : null) : Math.max(1, Math.min(5, parseInt(d.eff))) / 5;
      target.sessions.push({ date: d.date, start, end, dur: end - start, eff, manual: isNew || !!(s && s.manual), ...(s && s.cardId ? { cardId: s.cardId } : {}), ...(s && s.taskId ? { taskId: s.taskId } : {}) });
      target.sessions.sort((x, y) => x.start - y.start);
      delete S().tomb['s:' + start];
      touch(target); E.invalidate(); save();
    }
  });
}
const findSession = d => {
  const a = S().activities.find(x => x.id === d.id);
  return { a, s: a && (a.sessions || []).find(x => String(x.start) === String(d.start)) };
};

export default {
  render() {
    const date = viewDate(), isToday = date === today(), run = E.runningActivity();
    return `<div class="view-h"><h2>Track</h2>
        <button class="btn sm ghost" data-act="session.new">${icon('clock')} Log time by hand</button>
        <button class="btn sm primary" data-act="activity.new">${icon('plus')} Activity</button></div>
      ${run ? `<button class="run-bar" data-act="track.stop" style="--c:${safeColor(run.color)}" aria-label="Stop ${esc(run.name)}">
          ${run.emoji ? `<span class="tile-e">${esc(run.emoji)}</span>` : ''}
          <span class="run-main"><b class="run-n ell">${esc(run.name)}</b>
            <span class="run-s ell">Started ${fmtClock(run.lastStart, h24())}${E.runningTaskName(run) ? ' · ' + esc(E.runningTaskName(run)) : ''}</span></span>
          <span class="run-side"><b class="num run-t" data-live-run>${fmtTimer(Date.now() - run.lastStart)}</b>
            <span class="run-hint">Press anywhere to stop</span></span></button>` : ''}
      <div class="track">
        <section class="card" id="track-tiles">${tilesHtml()}</section>
        <section class="card"><div class="card-h"><span class="eyebrow">${isToday ? 'Today' : fmtDate(date)} · 24 hours</span>
            <button class="icon-btn sm" data-act="track.day" data-d="-1" aria-label="Previous day">${icon('left')}</button>
            <button class="btn sm ghost" data-act="track.day" data-d="0" ${isToday ? 'disabled' : ''}>Today</button>
            <button class="icon-btn sm" data-act="track.day" data-d="1" ${isToday ? 'disabled' : ''} aria-label="Next day">${icon('right')}</button></div>
          <div id="track-ring">${ringHtmlFor(date)}</div></section>
      </div>
      <section class="card" style="margin-top:var(--gap)"><div class="card-h"><span class="eyebrow">Sessions · ${isToday ? 'today' : fmtDate(date)}</span>
          ${segHtml('track.view', [['list', 'List'], ['timeline', 'Timeline']], ui.sessView)}</div>
        ${sessionsHtml(date)}</section>`;
  },
  mount(root) {
    const box = root.querySelector('#track-tiles');
    if (box) wireSort(box);
  },
  tick(root) {
    const run = E.runningActivity();
    root.querySelectorAll('[data-live-act]').forEach(el => { const a = S().activities.find(x => x.id === el.dataset.liveAct); if (a) el.textContent = fmtTimer(E.actMsOn(a, today())); });
    const rb = root.querySelector('[data-live-run]');
    if (rb && run) rb.textContent = fmtTimer(Date.now() - run.lastStart);
    if (viewDate() === today() && new Date().getSeconds() % 20 === 0) { const r = root.querySelector('#track-ring'); if (r) r.innerHTML = ringHtmlFor(today()); }
  }
};

registerActions({
  'activity.new': () => openActivity(null),
  'activity.edit': d => { const a = S().activities.find(x => x.id === d.id); if (a) openActivity(a); },
  'activity.delete': async d => {
    const st = S(), a = st.activities.find(x => x.id === d.id); if (!a) return;
    const n = (a.sessions || []).length;
    if (!(await confirmDialog({ title: `Delete ${a.name}?`, body: n ? `Its ${n} logged session${n > 1 ? 's' : ''} go with it. Days already scored keep their numbers.` : 'It has no logged time.', ok: 'Delete', danger: true }))) return;
    st.activities = st.activities.filter(x => x !== a); tombstone(a.id);
    st.tags.forEach(t => { if (t.activityId === a.id) t.activityId = null; });
    closeModal(); E.invalidate(); save();
  },
  'session.new': () => openSession(null, null),
  'session.edit': d => { const { a, s } = findSession(d); if (a && s) openSession(a, s); },
  'session.delete': d => {
    const { a, s } = findSession(d); if (!a || !s) return;
    a.sessions = a.sessions.filter(x => x !== s); tombstone('s:' + s.start); touch(a);
    closeModal(); E.invalidate(); save();
  },
  'track.view': d => { ui.sessView = d.v; refresh(); },
  'track.day': d => {
    const n = +d.d;
    ui.trackDate = n === 0 ? null : addDays(viewDate(), n);
    if (ui.trackDate && ui.trackDate >= today()) ui.trackDate = null;
    refresh();
  }
});
