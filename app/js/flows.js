/* ══════════════════════════════════════════════════════════════════════
   FLOWS: the things that cut across tabs: starting and stopping timers,
   Lock in, the morning brief, the night debrief, the break challenge,
   rest days and the daily logbook.
   ══════════════════════════════════════════════════════════════════════ */
import { S, save, touch } from './store.js';
import * as E from './engine.js';
import { registerActions, openModal, closeModal, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { esc, today, addDays, fmtTimer, fmtDur, fmtMins, fmtDate, hmToMin, clamp } from './util.js';
import { ui, refresh } from './bus.js';
import { notify } from './notify.js';
import * as fx from './fx.js';

export const L = () => S().settings.labels;
const shadowName = () => L().shadow;

/* ── the month's record: one cell per day, and what it takes to win it ── */
export function monthHtml(month, { link = false } = {}) {
  const b = E.monthBoard(month), cur = month === today().slice(0, 7), n = esc(shadowName());
  const name = new Date(+month.slice(0, 4), +month.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'long' });
  const title = { W: 'won', L: 'lost', R: 'rest day', T: 'today' };
  const cells = b.days.map(d => `<i class="${d.v === '-' ? 'x' : d.v}" title="${esc(fmtDate(d.date, { day: 'numeric', month: 'short' }))}${title[d.v] ? ': ' + title[d.v] : ''}"></i>`).join('');
  const days = k => `${k} day${k === 1 ? '' : 's'}`;
  let line;
  if (!cur || b.over) line = b.w + b.l === 0 ? 'No days were scored.' : b.result === 'won' ? 'You won the month.' : b.result === 'lost' ? `${n} won the month.` : 'The month ended level.';
  else if (b.secured) line = `Month won. ${days(b.open)} left.`;
  else if (b.outOfReach) line = `Out of reach this month. Best finish: ${b.w + b.open} wins.`;
  else line = `${b.need}/${b.open} days needed to win.`;
  const inner = `<div class="month-h"><span class="eyebrow">${esc(name)}</span><span class="month-rec"><b class="tone-good">${b.w}</b> won<span class="dim"> · </span><b class="tone-bad">${b.l}</b> lost${b.r ? `<span class="dim"> · ${b.r} rest</span>` : ''}</span></div>
    <div class="month-days" style="--n:${b.days.length}">${cells}</div>
    <div class="month-s">${line}</div>`;
  return link ? `<button class="month" data-act="nav.go" data-tab="calendar" title="Open the calendar">${inner}</button>` : `<div class="month">${inner}</div>`;
}

/* ── session rating: quick, optional, never blocks ── */
function offerRating(activity) {
  const s = (activity.sessions || [])[activity.sessions.length - 1];
  if (!s || s.dur < E.COMBO.minMs || s.eff != null) return;
  toast(`You logged ${fmtDur(s.dur)} of ${E.label(activity)}`, 'How focused were you?', {
    ms: 14000,
    buttons: [1, 2, 3, 4, 5].map(n => ({ label: String(n), run: () => { s.eff = n / 5; touch(activity); E.invalidate(); save(); } }))
  });
}
function stopAndRate() {
  const r = E.stopRunning();
  if (!r) return null;
  fx.sound('stop');
  if (!r.kept) toast('Not saved', 'That was under 15 seconds, so it was left out.', { ms: 3500 });
  else offerRating(r.activity);
  return r;
}

/* ══════════════════════ LOCK IN ══════════════════════ */
let focusInt = null, focusCardId = null, focusTaskId = null, focusStart = 0;

function pickCard(id) {
  const st = S();
  const f = id ? E.findCard(id) : null;
  if (f && f.col !== 'done') return f.card;
  const sel = ui.selCard && E.findCard(ui.selCard);
  if (sel && sel.col !== 'done') return sel.card;
  return (st.cards.today || [])[0] || null;
}
function renderFocus() {
  const el = document.getElementById('focus');
  const a = E.runningActivity();
  const f = focusCardId ? E.findCard(focusCardId) : null;
  const card = f ? f.card : null;
  const tag = card && S().tags.find(t => t.id === card.tagId);
  const gt = E.findGoalTask(focusTaskId);
  const title = card ? card.text : gt ? gt.t.name : '';
  const subs = card && card.subs && card.subs.length ? `<div class="focus-subs">${card.subs.map(s =>
    `<button class="focus-sub ${s.done ? 'done' : ''}" data-act="focus.sub" data-id="${esc(s.id)}"><span class="check sq ${s.done ? 'on' : ''}">${icon('check')}</span><span>${esc(s.t)}</span></button>`).join('')}</div>` : '';
  el.innerHTML = `<div class="focus-in">
      <div class="eyebrow">${a ? esc(E.label(a)) : 'Focus'}${tag && (!a || tag.name !== a.name) ? ' · ' + esc(tag.name) : ''}</div>
      <div class="focus-task">${title ? esc(title) : 'No task picked. Just work.'}</div>
      ${gt ? `<div class="muted" style="margin-top:-10px">${esc(gt.g.name)}${gt.t === gt.m ? '' : ' · ' + esc(gt.m.name)}</div>` : ''}
      <div class="focus-timer" id="focus-timer">00:00</div>
      <div class="muted" id="focus-hint"></div>
      ${subs}
      ${title ? `<button class="btn primary focus-done" data-act="focus.done">${icon('check')} Mark task as done</button>` : ''}
      <div class="row wrap" style="justify-content:center;gap:10px">
        <button class="btn" data-act="focus.stop" id="focus-stop" disabled>${icon('stop')} Stop</button>
        <button class="btn ghost" data-act="focus.hide" id="focus-hide" disabled>Keep the timer running and hide this</button>
      </div>
    </div>`;
}
function tickFocus() {
  const a = E.runningActivity();
  if (!a) { closeFocus(); return; }
  const el = Date.now() - focusStart;
  const t = document.getElementById('focus-timer');
  if (!t) return;
  t.textContent = fmtTimer(Date.now() - a.lastStart);
  const hint = document.getElementById('focus-hint'), stop = document.getElementById('focus-stop'), hide = document.getElementById('focus-hide');
  if (el < E.LOCK_MIN_MS) hint.textContent = `You can stop in ${Math.ceil((E.LOCK_MIN_MS - el) / 1000)}s`;
  else { if (stop.disabled) { stop.disabled = false; hide.disabled = false; } hint.textContent = 'You can stop whenever you like now.'; }
}
function openFocus() {
  focusStart = Date.now();
  renderFocus();
  document.getElementById('focus').classList.add('open');
  clearInterval(focusInt);
  focusInt = setInterval(tickFocus, 250);
  tickFocus();
}
function closeFocus() {
  clearInterval(focusInt); focusInt = null;
  document.getElementById('focus').classList.remove('open');
}
export const focusOpen = () => document.getElementById('focus').classList.contains('open');

function lockIn(cardId, taskId = null) {
  // started from a goal: no board card, the time goes to that goal task
  const gt = taskId ? E.findGoalTask(taskId) : null;
  const card = gt ? null : pickCard(cardId);
  const a = gt ? E.activityForGoal(gt.g, true) : card ? E.activityForCard(card, true) : E.focusActivity(true);
  focusCardId = card ? card.id : null;
  focusTaskId = gt ? gt.t.id : card && E.findGoalTask(card.goalTask) ? card.goalTask : null;
  E.startActivity(a.id, { cardId: focusCardId, taskId: focusTaskId });
  fx.sound('start');
  openFocus();
}
const completeGoalTask = id => { if (E.completeGoalTask(id)) save(); };
function bailCheck() {
  if (Date.now() - focusStart < 5 * 60000) {
    const n = E.logFriction();
    if (n === 3 || n === 6) notify(`That's ${n} false starts today`, E.voice('idle'));
  }
}
export function completeCard(id) {
  const f = E.findCard(id);
  if (!f || f.col === 'done') return;
  if (ui.selCard === id) ui.selCard = null;
  E.moveCard(id, 'done');
}

/* ══════════════════════ MISSION: BRIEF ══════════════════════ */
function statusLines() {
  const t = today(), sb = E.scoreboard(), rk = E.rankFor(sb.rep), mom = E.momentum();
  const y = S().game.days[addDays(t, -1)];
  const yLine = !y ? 'No data' : y.v === 'R' ? 'Rest day' : `${y.v === 'W' ? 'Won' : 'Lost'} · ${y.ex ?? 0}% execution · ${y.x} XP`;
  return `<div class="telemetry">
    <div><span>${esc(L().rank)}</span><b class="tone-accent">${esc(rk.cur.name)}</b>${rk.next ? `<i>${Math.ceil(rk.next.at - sb.rep)} to ${esc(rk.next.name)}</i>` : ''}</div>
    <div><span>Momentum</span><b class="tone-${mom.tone}">${mom.label}</b><i>${esc(mom.sub)}</i></div>
    <div><span>Yesterday</span><b>${esc(yLine)}</b></div>
    <div><span>${esc(shadowName())} today</span><b>${E.shadowXP(t)} XP</b><i>${esc(E.shadowBasis(t))}</i></div>
    <div><span>Average start delay</span><b>${fmtMins(E.serviceRecord().ttfbAvg)}</b></div>
  </div>`;
}
function openBrief() {
  const t = today(), m = E.missionFor(t) || {};
  const line = E.voice(E.hasMission(t) ? 'morning' : 'nomission');
  const v = o => esc((o && o.t) || '');
  openModal({
    title: E.hasMission(t) ? "Good morning. Is this still today's mission?" : 'Good morning. What is today for?',
    submit: 'Set mission', wide: true,
    body: `${statusLines()}
      ${line ? `<blockquote class="quote">${esc(line)}<cite>${esc(shadowName())}</cite></blockquote>` : ''}
      <div class="field"><label>Critical: the one thing that makes today count</label><input class="input" name="c" value="${v(m.c)}" maxlength="140" autofocus></div>
      <div class="field"><label>Primary: up to three more</label>
        <input class="input" name="p0" value="${v((m.p || [])[0])}" maxlength="140" placeholder="Optional">
        <input class="input" name="p1" value="${v((m.p || [])[1])}" maxlength="140" placeholder="Optional">
        <input class="input" name="p2" value="${v((m.p || [])[2])}" maxlength="140" placeholder="Optional"></div>
      <div class="field"><label>Fallback: the least you'll accept from today</label><input class="input" name="f" value="${v(m.f)}" maxlength="140">
        <div class="hint">Having a fallback keeps a bad morning from becoming a wasted day.</div></div>`,
    onSubmit: d => {
      const prev = E.missionFor(t) || {};
      const keep = (txt, old) => ({ t: txt.trim(), done: !!(txt.trim() && old && old.t === txt.trim() && old.done) });
      const p = ['p0', 'p1', 'p2'].map((k, i) => keep(d[k], (prev.p || [])[i])).filter(x => x.t);
      const mission = { c: keep(d.c, prev.c), p, f: keep(d.f, prev.f), src: prev.src || 'morning', at: prev.at || Date.now() };
      if (!mission.c.t && !p.length && !mission.f.t) { toast('Add at least one objective first', '', { kind: 'bad', ms: 4000 }); return false; }
      S().game.missions[t] = mission;
      S().game.notif.brief = t;
      save();
      toast('Mission set', mission.c.t ? 'Your critical task: ' + mission.c.t : 'Your objectives are saved.', { kind: 'good' });
    }
  });
}
function toggleObjective(path) {
  const m = E.missionFor(today());
  if (!m) return;
  if (path === 'c') m.c.done = !m.c.done;
  else if (path === 'f') m.f.done = !m.f.done;
  else { const o = m.p[+path.slice(1)]; if (o) o.done = !o.done; }
  save();
}
export function objectiveRows(m) {
  const row = (tier, o, path, tone) => `<div class="obj ${o.done ? 'done' : ''}">
      <button class="check ${o.done ? 'on' : ''}" data-act="mission.toggle" data-path="${path}" aria-label="Toggle objective" aria-pressed="${!!o.done}">${icon('check')}</button>
      <span class="obj-tier tone-${tone}">${tier}</span><span class="obj-t">${esc(o.t)}</span></div>`;
  let h = '';
  if (m.c && m.c.t) h += row('Critical', m.c, 'c', 'bad');
  (m.p || []).forEach((o, i) => { if (o.t) h += row('Primary', o, 'p' + i, 'accent'); });
  if (m.f && m.f.t) h += row('Fallback', m.f, 'f', 'warn');
  return h;
}

/* ══════════════════════ MISSION: DEBRIEF ══════════════════════ */
function debriefExecHtml() {
  if (!S().settings.modules.mission) return '';
  const ex = E.execScoreFor(today()), d = E.repDelta(ex);
  if (E.isRest(today())) return `<div class="pill">It's a rest day, so nothing is scored.</div>`;
  return ex === null
    ? `<div class="pill bad">No mission was set, so execution is 0% (${esc(L().rep)} ${d})</div>`
    : `<div class="pill ${ex >= 60 ? 'good' : ex >= 40 ? 'warn' : 'bad'}">Execution ${ex}% · ${esc(L().rep)} ${d > 0 ? '+' : ''}${d}</div>`;
}
function openDebrief() {
  const t = today(), st = S(), sc = E.dayScore(t), m = E.missionFor(t);
  const j = st.journal[t] || {}, day = st.days[t] || {};
  const tm = E.missionFor(addDays(t, 1)) || {};
  const x = st.settings.xp;
  const modal = openModal({
    title: 'Close the day', submit: 'Save', wide: true,
    body: `<div class="telemetry">
        <div><span>Focus</span><b>${fmtDur(E.focusMsOn(t))}</b></div>
        <div><span>Tasks</span><b>${E.tasksDoneOn(t)}</b></div>
        <div><span>Habits</span><b>${E.habitsDoneOn(t)}/${E.habitsDue(t).length}</b></div>
        <div><span>XP vs ${esc(shadowName())}</span><b>${sc.total} / ${E.shadowXP(t)}</b></div>
        <div><span>Start delay</span><b>${fmtMins(E.ttfbFor(t))}</b></div>
        <div><span>Hesitations</span><b>${st.game.friction[t] || 0}</b></div>
      </div>
      ${m && st.settings.modules.mission ? `<div><div class="label" style="margin-bottom:6px">Tick off what you finished</div><div id="debrief-obj">${objectiveRows(m)}</div></div>` : ''}
      <div id="debrief-exec">${debriefExecHtml()}</div>
      <div class="form-row">
        <div class="field"><label>What went right</label><textarea class="input" name="w" maxlength="2000">${esc(j.w || '')}</textarea></div>
        <div class="field"><label>What went wrong</label><textarea class="input" name="l" maxlength="2000">${esc(j.l || '')}</textarea></div>
      </div>
      <div class="field"><label>The fix for tomorrow</label><input class="input" name="f" value="${esc(j.f || '')}" maxlength="300"></div>
      <div class="form-row">
        <div class="field"><label>How effective was today? (0-100)</label><input class="input" type="number" min="0" max="100" name="efficacy" value="${day.efficacy ?? ''}" placeholder="Your honest read">
          <div class="hint">An honest number is worth more than a high one.</div></div>
        <div class="field"><label>Energy (1-5)</label><input class="input" type="number" min="1" max="5" name="e" value="${j.e || ''}"></div>
        <div class="field"><label>Minutes lost to social media</label><input class="input" type="number" min="0" max="1440" name="sm" value="${j.sm || ''}">
          <div class="hint">First ${x.socialFreeMins} min free, then ${x.socialPerMin} XP per minute.</div></div>
      </div>
      ${st.settings.modules.mission ? `<div class="sep" style="margin:2px 0"></div>
      <div class="form-row">
        <div class="field"><label>Tomorrow's critical objective</label><input class="input" name="tc" value="${esc((tm.c && tm.c.t) || '')}" maxlength="140"></div>
        <div class="field"><label>Tomorrow's fallback</label><input class="input" name="tf" value="${esc((tm.f && tm.f.t) || '')}" maxlength="140"></div>
      </div><div class="hint">Set these tonight and tomorrow starts with a plan.</div>` : ''}`,
    onSubmit: d => {
      const e = {};
      ['w', 'l', 'f'].forEach(k => { if (d[k].trim()) e[k] = d[k].trim(); });
      const sm = clamp(parseInt(d.sm) || 0, 0, 1440), en = clamp(parseInt(d.e) || 0, 0, 5);
      if (sm) e.sm = sm; if (en) e.e = en;
      st.journal[t] = e;               // kept even when empty, so a merge cannot bring an old entry back
      const dd = st.days[t] || (st.days[t] = {});
      if (d.efficacy !== '') dd.efficacy = clamp(parseInt(d.efficacy) || 0, 0, 100);
      if (st.settings.modules.mission && (d.tc.trim() || d.tf.trim())) {
        const tom = addDays(t, 1), ex = E.missionFor(tom) || {};
        st.game.missions[tom] = { c: { t: d.tc.trim(), done: false }, p: ex.p || [], f: { t: d.tf.trim(), done: false }, src: 'night', at: Date.now() };
      }
      st.game.notif.debrief = t;
      E.invalidate(); save();
      const pen = E.socialPenalty(t);
      toast('Day saved', pen ? `${sm} minutes of social media cost you ${pen} XP. ${E.voice('social')}`.trim() : (d.tc && d.tc.trim() ? 'Tomorrow starts with: ' + d.tc.trim() : 'See you tomorrow.'), { kind: 'good' });
    }
  });
  modal.el.dataset.debrief = '1';
}
function refreshDebrief() {
  const o = document.getElementById('debrief-obj'), e = document.getElementById('debrief-exec'), m = E.missionFor(today());
  if (o && m) o.innerHTML = objectiveRows(m);
  if (e) e.innerHTML = debriefExecHtml();
}

/* ══════════════════════ BREAK CHALLENGE ══════════════════════ */
let escTimer = null;
function escapeChallenge(a) {
  const g = S().game, line = E.voice('escape');
  openModal({
    title: 'Taking a break already?', cancel: '',
    body: `${line ? `<blockquote class="quote">${esc(line)}<cite>${esc(shadowName())}</cite></blockquote>` : ''}
      <div class="telemetry">
        <div><span>Focus logged today</span><b class="tone-bad">${fmtDur(E.focusMsOn(today()))}</b><i>the gate is 25m</i></div>
        <div><span>Held the line</span><b class="tone-good">${g.holds}</b></div>
        <div><span>Folded</span><b class="tone-bad">${g.folds}</b></div>
        <div><span>Requested</span><b>${esc(E.label(a))}</b></div>
      </div>
      <p class="hint">It's your call. Either choice is recorded.</p>`,
    footer: `<button type="button" class="btn ghost" data-act="escape.fold" data-id="${esc(a.id)}">Take it anyway</button>
             <button type="button" class="btn primary" data-act="escape.hold" autofocus>Work 15 minutes first</button>`
  });
}

/* ══════════════════════ REST DAY ══════════════════════ */
async function toggleRest(date = today()) {
  const on = !E.isRest(date), b = E.restBudget(date);
  if (on && b.left <= 0) {
    toast('You have no rest days left this week', `You get ${b.allowed} every 7 days. You can change that in Settings > Game.`, { kind: 'bad' });
    return;
  }
  const ok = await confirmDialog(on
    ? { title: `Make ${date === today() ? 'today' : fmtDate(date)} a rest day?`, ok: 'Rest day',
        body: `Nothing is scored: no win or loss, no ${L().rep.toLowerCase()} change, and habit streaks freeze instead of breaking. ${b.left - 1} of ${b.allowed} left this week after this.` }
    : { title: 'Cancel the rest day?', ok: 'Cancel rest day', body: 'The day goes back to being scored normally.' });
  if (!ok) return;
  E.setRest(date, on);
  if (on && E.runningActivity() === null) toast('Rest day set', E.voice('rest'), { ms: 5000 });
}

/* ══════════════════════ LOGBOOK ENTRIES ══════════════════════ */
function openSleep(date = today()) {
  const day = S().days[date] || {}, sl = day.sleep || {};
  openModal({
    title: `Sleep: night before ${date === today() ? 'today' : fmtDate(date)}`,
    body: `<div class="form-row">
        <div class="field"><label>Asleep at</label><input class="input" type="time" name="start" value="${esc(sl.start || '23:30')}" required></div>
        <div class="field"><label>Awake at</label><input class="input" type="time" name="end" value="${esc(sl.end || S().settings.window.start)}" required></div>
      </div><div class="hint">Logging sleep counts toward the day's logbook.</div>`,
    left: sl.hrs ? `<button type="button" class="btn danger" data-act="log.sleepClear" data-date="${date}">Clear</button>` : '',
    onSubmit: d => {
      if (!d.start || !d.end) return false;
      let mins = hmToMin(d.end) - hmToMin(d.start);
      if (mins <= 0) mins += 1440;
      const dd = S().days[date] || (S().days[date] = {});
      dd.sleep = { start: d.start, end: d.end, hrs: Math.round(mins / 6) / 10 };
      E.invalidate(); save();
    }
  });
}
function openEfficacy(date = today()) {
  const day = S().days[date] || {};
  openModal({
    title: 'How well did today go?',
    body: `<div class="field"><label>Efficacy: <span id="eff-out">${day.efficacy ?? 50}</span>%</label>
        <input type="range" min="0" max="100" step="5" name="efficacy" value="${day.efficacy ?? 50}" data-input="log.effPreview"></div>
      <div class="hint">Did your hours go to the right things? This is only a record. It doesn't change your XP beyond the logbook entry.</div>`,
    onSubmit: d => {
      const dd = S().days[date] || (S().days[date] = {});
      dd.efficacy = clamp(parseInt(d.efficacy) || 0, 0, 100);
      E.invalidate(); save();
    }
  });
}

registerActions({
  'lock.in': d => lockIn(d.card || null, d.task || null),
  'focus.done': () => { const id = focusCardId, task = focusTaskId; closeFocus(); stopAndRate(); if (id) completeCard(id); else if (task) completeGoalTask(task); fx.sound('done'); toast('Task done', 'Start another block soon to keep your combo.', { kind: 'good', ms: 4500 }); },
  'focus.stop': () => { bailCheck(); closeFocus(); stopAndRate(); },
  'focus.hide': () => closeFocus(),
  'focus.show': () => { const a = E.runningActivity(); if (a) { focusCardId = a.runCardId || null; focusTaskId = a.runTaskId || null; openFocus(); focusStart = Date.now() - E.LOCK_MIN_MS; tickFocus(); } },
  'focus.sub': d => {
    const f = focusCardId && E.findCard(focusCardId);
    const s = f && (f.card.subs || []).find(x => x.id === d.id);
    if (!s) return;
    s.done = !s.done; touch(f.card); save(); renderFocus(); tickFocus();
  },
  'activity.toggle': d => {
    const a = S().activities.find(x => x.id === d.id);
    if (!a) return;
    if (a.isRunning) { stopAndRate(); return; }
    if (E.needsEscapeChallenge(a)) { escapeChallenge(a); return; }
    const prev = E.runningActivity();
    E.startActivity(a.id);
    fx.sound('start');
    if (prev && prev !== a) offerRating(prev);
  },
  'track.stop': () => stopAndRate(),
  'card.complete': (d, e, el) => {
    // the round tick already had its flourish; the board's small button gets one here
    if (el && !el.classList.contains('check')) { fx.burst(el); fx.sound('tick'); }
    if (el) fx.float(el, `+${S().settings.xp.task} XP`);
    completeCard(d.id);
  },
  'brief.open': openBrief,
  'debrief.open': openDebrief,
  'mission.toggle': d => { toggleObjective(d.path); refreshDebrief(); },
  'escape.hold': () => {
    closeModal(); S().game.holds++; save();
    clearTimeout(escTimer);
    escTimer = setTimeout(() => notify('15 minutes done', 'Take your break now if you still want it.'), 15 * 60000);
    toast('Good call', 'Do 15 minutes of work, then the break is yours.', { kind: 'good', ms: 5000 });
  },
  'escape.fold': d => {
    closeModal(); const g = S().game; g.folds++; save();
    E.logFriction();
    E.startActivity(d.id);
    toast('Break started', 'Your combo has been reset.', { ms: 5000 });
  },
  'rest.toggle': d => toggleRest(d.date || today()),
  'log.sleep': d => openSleep(d.date || today()),
  'log.sleepClear': d => { const dd = S().days[d.date]; if (dd) dd.sleep = null; E.invalidate(); save(); closeModal(); },
  'log.efficacy': d => openEfficacy(d.date || today()),
  'log.effPreview': (d, e, el) => { const o = document.getElementById('eff-out'); if (o) o.textContent = el.value; },
  'session.rate': d => {
    const a = S().activities.find(x => x.id === d.id);
    const s = a && (a.sessions || []).find(x => String(x.start) === d.start);
    if (!s) return;
    const v = +d.v / 5;
    s.eff = s.eff === v ? null : v;
    touch(a); E.invalidate(); save();
  }
});

export { openBrief, openDebrief, stopAndRate };
