/* HOME: the day at a glance: you against the rival, the mission, the
   next task to lock in on, habits, and the logbook. */
import { S, save, touch } from '../store.js';
import * as E from '../engine.js';
import { registerActions, toast, openModal } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, fmtDur, fmtMins, fmtDate, fmtTimer, clamp, uid, safeColor, daysBetween } from '../util.js';
import { ui, refresh } from '../bus.js';
import { duelDial } from '../charts.js';
import { L, objectiveRows, monthHtml } from '../flows.js';
import { makeSortable } from '../drag.js';
import { priHtml } from './board.js';
import * as fx from '../fx.js';

const tone = (ok, warn) => (ok ? 'good' : warn ? 'warn' : 'bad');

/* ── main goals: the lasting ones, written out again each morning ── */
function goalsHtml() {
  const t = today(), cur = E.dayGoals(t), prev = E.prevDayGoals(t), x = S().settings.xp;
  // Three lines to start with (or as many as you wrote last time). More only when you ask.
  const asked = (S().days[t] || {}).goalRows;
  const n = Math.max(1, cur.length, asked != null ? asked : Math.max(3, prev.length));
  let rows = '';
  for (let i = 0; i < n; i++) {
    const g = cur[i] || { t: '' }, ghost = prev[i] ? prev[i].t : '';
    rows += `<div class="dg-row"><input class="input dg" value="${esc(g.t)}" placeholder="${esc(ghost || 'A goal you are working toward')}" maxlength="140" data-change="home.goal" data-i="${i}" data-fk="dg${i}" aria-label="Main goal ${i + 1}" autocomplete="off">
      <button class="icon-btn sm dg-x" data-act="home.goalDel" data-i="${i}" data-n="${n}" title="Remove this goal" aria-label="Remove goal ${i + 1}">${icon('x')}</button></div>`;
  }
  const earned = E.goalXP(t);
  return `<div class="card-h"><span class="eyebrow">Main goals</span>
      <span class="pill ${earned ? 'good' : ''}" title="Writing your goals out each day earns ${x.goal} XP each, for up to ${x.goalCap} goals.">${earned ? `+${earned} XP` : `+${x.goal} XP each`}</span>
      <button class="btn sm ghost" data-act="home.goalAdd" data-n="${n}" title="Add another goal">${icon('plus')} Add goal</button></div>
    <div class="dgs">${rows}</div>`;
}

/* ── you vs the rival ── */
function duelHtml() {
  const st = S(), t = today(), rest = E.isRest(t), show = st.settings.modules.shadow, name = esc(L().shadow);
  const sc = E.dayScore(t), him = E.shadowXP(t), pace = E.shadowPaceNow(), w = E.winMinutes();
  const gap = sc.total - pace;
  // the outer ring is the working day: lit as it passes, with what is left written at the top
  const now = E.nowMinutes(), leftMin = clamp(w.end - Math.max(now, w.start), 0, w.total), pct = Math.round(leftMin / w.total * 100);
  const dayNote = now < w.start ? 'Day not started' : now >= w.end ? 'Day closed' : `${pct}% of day left`;
  const dayTime = now < w.start ? `starts in ${fmtMins(Math.ceil(w.start - now))}` : now >= w.end ? '' : fmtMins(Math.floor(leftMin));
  const dayTitle = now < w.start ? `Your day starts in ${fmtMins(Math.ceil(w.start - now))}` : now >= w.end ? 'Your working day has ended' : `${fmtMins(Math.floor(leftMin))} left of the ${fmtMins(w.total)} you set`;
  const sub = rest ? 'rest day' : show ? `${him} to beat` : '';
  const line = rest ? E.voice('rest') : E.voice(sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind');
  const tier = rest ? 'rest' : sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind';
  if (duelHtml.tier !== tier) { duelHtml.tier = tier; duelHtml.line = line; }     // stable until the situation changes
  const standing = gap === 0 ? "You're level." : `You're ${Math.abs(gap)} XP ${gap > 0 ? 'ahead' : 'behind'}.`;
  const his = pace >= him ? `${name} has finished the day with ${him} XP.` : `${name} is at ${pace} XP and will end the day with ${him} XP.`;
  return `
    <div class="dial-day" title="${esc(dayTitle)}"><b>${esc(dayNote)}</b>${dayTime ? `<span>${esc(dayTime)}</span>` : ''}</div>
    <div class="dial-wrap">${duelDial({ you: sc.total, shadow: him, pace, dayFrac: (now - w.start) / w.total, showShadow: show, rest, sub, dayNote, dayTitle })}</div>
    ${rest ? `<div class="pace tone-info">It's a rest day. Nothing is scored.</div>`
      : show ? `<div class="pace tone-${gap >= 0 ? 'good' : 'bad'}">${standing}</div><div class="small muted" style="text-align:center">${his}</div>` : ''}
    ${show && duelHtml.line ? `<blockquote class="quote">${esc(duelHtml.line)}<cite>${name}</cite></blockquote>` : ''}`;
}
/** Streak and what it takes to win the month. Kept apart from the month's
 *  record above it, which is a button and must not be redrawn every second
 *  under the pointer. */
function statsHtml() {
  if (!S().settings.modules.shadow) return '';
  const sb = E.scoreboard(), b = E.monthBoard(today().slice(0, 7));
  const win = b.secured ? 'Won' : b.outOfReach ? '-' : `${b.need}<small>/${b.open}</small>`;
  const tip = b.secured ? 'You have already won this month.' : b.outOfReach ? `The month is out of reach. Best finish: ${b.w + b.open} wins.` : `Win ${b.need} of the ${b.open} days left to win the month.`;
  return `<div><b class="num">${sb.streak}</b><span>Win streak</span></div>
      <div title="${esc(tip)}"><b class="num ${b.secured ? 'tone-good' : b.outOfReach ? 'tone-mute' : ''}">${win}</b><span>Days to win</span></div>`;
}
/** The combo beside Lock in: back-to-back blocks multiply what they pay. */
function comboHtml() {
  const c = E.dayScore(today()).combo;
  return `<b class="num">${c.mult.toFixed(1)}×</b><span>${c.chain > 1 ? `Combo · ${c.chain} in a row` : 'Combo · chain blocks'}</span>`;
}
const comboTitle = 'Working in back-to-back blocks multiplies your XP. A gap of more than 10 minutes, or a break, resets it.';

/* ── mission + lock in ── */
function missionHtml() {
  const st = S(), t = today();
  if (!st.settings.modules.mission) return '';
  const m = E.missionFor(t), has = E.hasMission(t), ex = E.execScoreFor(t);
  return `<div class="card-h"><span class="eyebrow">${esc(L().mission)}</span>
      ${has ? `<span class="pill ${ex >= 60 ? 'good' : ex >= 40 ? 'warn' : 'bad'}">${ex}% done</span>` : ''}
      <button class="icon-btn sm" data-act="brief.open" title="${has ? 'Edit the mission' : 'Set the mission'}" aria-label="${has ? 'Edit the mission' : 'Set the mission'}">${icon('edit')}</button></div>
    ${has ? `<div class="objs">${objectiveRows(m)}</div>`
      : `<div class="empty" style="padding:10px 0 4px">${E.isRest(t) ? "It's a rest day, so you don't need one." : "You haven't set a mission for today yet."}
          <br><button class="btn sm primary" data-act="brief.open">${icon('flag')} Set today's mission</button></div>`}
    <div class="sep"></div>`;
}
const TOP_TASKS = 3;
function lockHtml() {
  const st = S(), cards = st.cards.today || [];
  const sel = cards.find(c => c.id === ui.selCard) || cards[0] || null;
  const act = sel ? E.activityForCard(sel) : E.focusActivity();
  const running = E.runningActivity();
  const rows = cards.slice(0, TOP_TASKS).map(c => {
    const tag = st.tags.find(x => x.id === c.tagId), isSel = sel && sel.id === c.id;
    const live = running && running.runCardId === c.id;
    return `<div class="task ${tag ? 'tagged' : ''} ${isSel ? 'sel' : ''} ${live ? 'live' : ''}" ${tag ? `style="--c:${safeColor(tag.color)}"` : ''} data-act="home.select" data-nofx data-id="${esc(c.id)}" data-flip="c-${esc(c.id)}" role="button" tabindex="0" aria-pressed="${isSel}">
      <button class="check" data-act="card.complete" data-id="${esc(c.id)}" title="Mark as done" aria-label="Mark as done">${icon('check')}</button>
      <div class="grow"><div class="task-t">${esc(c.text)}</div>
        <div class="task-m">${tag ? `<span class="tag" style="color:${safeColor(tag.color)}"><i></i>${esc(tag.name)}</span>` : ''}${priHtml(c.pri, true)}
          ${c.est ? `<span>${fmtMins(c.est)}</span>` : ''}
          ${c.deadline ? `<span class="${c.deadline < today() ? 'tone-bad' : ''}">due ${fmtDate(c.deadline, { day: 'numeric', month: 'short' })}</span>` : ''}</div></div>
      <button class="icon-btn sm" data-act="lock.in" data-card="${esc(c.id)}" title="Start this task" aria-label="Start this task">${icon('play')}</button>
    </div>`;
  }).join('');
  const up = E.dayScore(today()).combo.mult > 1;
  const combo = `<span class="lock-combo ${up ? 'up' : ''}" id="home-combo" title="${esc(comboTitle)}">${comboHtml()}</span>`;
  // the whole bar is one button: Lock in, or open the running timer; the combo is part of it
  return `
    ${running
      ? `<button class="lock-row running" data-act="focus.show"><span class="lockin running"><span class="lockin-t">${icon('zap')} ${esc(E.label(running))} · <span id="home-run">${fmtTimer(Date.now() - running.lastStart)}</span></span>
           <span class="lockin-s">Tap to open the focus view</span></span>${combo}</button>`
      : `<button class="lock-row" data-act="lock.in"><span class="lockin"><span class="lockin-t">${icon('lock')} ${esc(L().lockIn)}</span>
           <span class="lockin-s">${sel ? `${esc(sel.text.slice(0, 60))} · ${esc(E.label(act))}` : esc(E.label(act))}</span></span>${combo}</button>`}
    <div class="card-h" style="margin:16px 0 8px"><span class="eyebrow">Top tasks</span>
      <button class="btn sm ghost" data-act="nav.go" data-tab="board">${cards.length > TOP_TASKS ? `${cards.length - TOP_TASKS} more in Tasks` : 'Open Tasks'}</button></div>
    <div class="tasks">${rows || `<div class="empty" style="padding:10px 0 6px">No tasks for today yet.</div>`}</div>
    <form class="row" data-quickadd style="margin-top:10px">
      <input class="input" name="text" placeholder="Add a task for today" maxlength="200" data-fk="home-add" aria-label="Add a task for today">
      <button class="btn" type="submit" aria-label="Add task">${icon('plus')}</button>
    </form>`;
}

/* ── logbook ── */
function logbookHtml() {
  const lb = E.logStatus(), x = S().settings.xp, day = S().days[today()] || {};
  const item = (ok, label, act, ico, hint, val = '') => `<button class="log-item ${ok ? 'ok' : ''}" data-act="${act}" title="${esc(hint)}">${icon(ok ? 'check' : ico)}<span>${label}</span>${val ? `<i>${esc(val)}</i>` : ''}</button>`;
  return `<div class="card-h" style="margin-bottom:10px"><span class="eyebrow">Logbook</span>
      <span class="pill ${lb.complete ? 'good' : ''}" title="Each entry you fill in earns ${x.log} XP.">${lb.count} of 4</span>
      ${lb.chain ? `<span class="streak ${lb.chain >= 7 ? 'hot' : ''}" title="${lb.chain} days in a row with a full logbook">${icon('flame')}${lb.chain}</span>` : ''}</div>
    <div class="logbook">
      ${item(lb.sleep, 'Sleep', 'log.sleep', 'bed', "Log last night's sleep", lb.sleep && day.sleep && day.sleep.hrs ? day.sleep.hrs + 'h' : '')}
      ${item(lb.rated, lb.unrated ? `${lb.unrated} to rate` : 'Sessions rated', 'home.rate', 'gauge', 'Rate how focused each deep work session was')}
      ${item(lb.efficacy, 'Efficacy', 'log.efficacy', 'goals', 'Rate how well the day went', lb.efficacy && day.efficacy != null ? day.efficacy + '%' : '')}
      ${item(lb.journal, 'Debrief', 'debrief.open', 'note', 'Write up the day')}
    </div>`;
}

/* ── identity strip ── */
function hudHtml() {
  const st = S(), t = today();
  const ex = E.execScoreFor(t), e7 = E.exec7(), tt = E.ttfbFor(t), avgT = E.serviceRecord().ttfbAvg;
  const due = E.habitsDue(t), left = due.filter(h => h.history[t] !== 'done').length, sw = E.sweepStatus(), rest = E.isRest(t);
  const cells = [];
  // habits are a count here; the list lives on its own tab
  cells.push(`<button class="hud-cell" data-act="nav.go" data-tab="habits"><span class="eyebrow">Habits</span>
    <b class="num ${!due.length || rest ? 'tone-mute' : left ? '' : 'tone-good'}">${!due.length ? 'None due' : rest ? 'Rest day' : left ? left + ' left' : 'All done'}</b>
    <span>${!due.length ? 'Nothing is due today' : rest ? 'Your streaks are frozen' : left ? (sw.chain ? `Keep your ${sw.chain}-day sweep` : `${due.length - left} of ${due.length} done`) : `${sw.chain}-day sweep, +${sw.bonus} XP`}</span></button>`);
  if (st.settings.modules.rank) {
    const lv = E.levelState();
    cells.push(`<button class="hud-cell" data-act="level.open"><span class="eyebrow">Level XP today</span><b class="num ${lv.today.total < 0 ? 'tone-bad' : lv.today.total ? 'tone-good' : 'tone-mute'}">${lv.today.total >= 0 ? '+' : ''}${lv.today.total}</b>
      <span>${lv.level >= E.LEVEL_MAX ? 'You are at the top level' : `${lv.need - lv.into} XP to level ${lv.level + 1}`}</span></button>`);
  }
  if (st.settings.modules.mission) {
    cells.push(`<div class="hud-cell"><span class="eyebrow">Execution</span><b class="num tone-${ex === null ? 'mute' : tone(ex >= 60, ex >= 40)}">${ex === null ? '-' : ex + '%'}</b><span>${e7 !== null ? `Your 7-day average is ${e7}%` : ex === null ? 'Set a mission to score this' : 'Of the mission you set'}</span></div>`);
  }
  cells.push(`<div class="hud-cell"><span class="eyebrow">Time to first block</span><b class="num tone-${tt === null ? 'mute' : tone(avgT === null || tt <= avgT, true)}">${fmtMins(tt)}</b><span>${tt === null ? 'No deep work yet today' : avgT !== null ? `Your average is ${fmtMins(avgT)}` : 'Your first record'}</span></div>`);
  cells.push(`<div class="hud-cell"><span class="eyebrow">Focus today</span><b class="num">${fmtDur(E.focusMsOn(t))}</b><span>Target ${st.settings.targets.hours}h · ${E.tasksDoneOn(t)} of ${st.settings.targets.tasks} tasks</span></div>`);
  return cells.join('');
}
const fmtSigned = n => (n > 0 ? '+' : '') + n;

/* ── lower row ── */
function weekHtml() {
  const g = S().game, t = today(), days = [];
  for (let i = 6; i >= 1; i--) days.push(addDays(t, -i));
  const rows = days.map(d => ({ d, x: (g.days[d] || {}).x || 0, s: (g.days[d] || {}).s || 0, v: (g.days[d] || {}).v || '' }));
  rows.push({ d: t, x: E.dayXP(t), s: E.shadowXP(t), v: E.isRest(t) ? 'R' : 'T' });
  const max = Math.max(1, ...rows.map(r => Math.max(r.x, r.s)));
  return `<div class="card-h"><span class="eyebrow">Last 7 days</span>${S().settings.modules.shadow ? `<span class="tiny dim">The line is ${esc(L().shadow)}</span>` : ''}</div>
    <div class="week">${rows.map(r => `<div class="week-d" title="${fmtDate(r.d)}: you ${r.x} XP${r.s ? ', ' + esc(L().shadow) + ' ' + r.s : ''}">
        <div class="week-bar">${r.s ? `<u style="bottom:${r.s / max * 100}%"></u>` : ''}<i class="${r.v === 'W' ? 'w' : r.v === 'L' ? 'l' : r.v === 'R' ? 'r' : r.v === 'T' ? 't' : ''}" style="height:${Math.max(2, r.x / max * 100)}%"></i></div>
        <b>${r.x || '·'}</b><span>${parseDay(r.d)}</span></div>`).join('')}</div>`;
}
const parseDay = d => fmtDate(d, { weekday: 'narrow' });

function deadlinesHtml() {
  const st = S(), t = today(), items = [];
  st.goals.forEach(g => { if (g.deadline) items.push({ name: g.name, d: g.deadline, color: g.color }); });
  st.columns.forEach(c => { if (c.id !== 'done') (st.cards[c.id] || []).forEach(k => { if (k.deadline) items.push({ name: k.text, d: k.deadline, color: null }); }); });
  items.sort((a, b) => (a.d < b.d ? -1 : 1));
  const row = it => { const n = daysBetween(t, it.d);
    return `<div class="li"><span class="dot" style="background:${safeColor(it.color, '#888888')}"></span><span class="grow ell">${esc(it.name)}</span>
      <span class="pill ${n < 0 ? 'bad' : n <= 2 ? 'warn' : ''}">${n < 0 ? Math.abs(n) + 'd late' : n === 0 ? 'today' : n + 'd'}</span></div>`; };
  return `<div class="card-h"><span class="eyebrow">Deadlines</span></div>
    <div class="list">${items.slice(0, 5).map(row).join('') || '<div class="empty">No deadlines coming up.</div>'}</div>`;
}
export default {
  render() {
    const st = S(), t = today(), rest = E.isRest(t), b = E.restBudget(t);
    return `<div class="home">
      <section class="card home-goals" aria-label="Main goals">${goalsHtml()}</section>
      <section class="card home-duel" aria-label="Today's score">
        <div class="card-h"><span class="eyebrow">${st.settings.modules.shadow ? `You vs ${esc(L().shadow)}` : 'Today'}</span>
          <button class="btn sm ${rest ? 'primary' : 'ghost'}" data-act="rest.toggle" title="A rest day is not scored. You have ${b.left} of ${b.allowed} left this week.">${icon('moon')} ${rest ? 'Rest day on' : 'Rest day'}</button>
          ${st.settings.modules.shadow ? `<button class="icon-btn sm" data-act="home.shadowInfo" title="Today's numbers" aria-label="Today's numbers">${icon('help')}</button>` : ''}</div>
        <div id="home-duel">${duelHtml()}</div>
        ${st.settings.modules.shadow ? monthHtml(t.slice(0, 7), { link: true, line: false }) : ''}
        ${st.settings.modules.shadow ? `<div class="mini-stats" id="home-stats">${statsHtml()}</div>` : ''}
      </section>
      <section class="card home-main" aria-label="Mission and tasks">${missionHtml()}<div id="home-lock">${lockHtml()}</div></section>
      <section class="hud" id="home-hud" aria-label="Standing">${hudHtml()}</section>
      <div class="home-row">
        <section class="card" aria-label="Logbook">${logbookHtml()}</section>
        <section class="card">${weekHtml()}</section>
        <section class="card">${deadlinesHtml()}</section>
      </div>
    </div>`;
  },
  mount(root) {
    if (ui.selPulse) { const el = root.querySelector(`.task[data-id="${CSS.escape(ui.selPulse)}"]`); ui.selPulse = null; if (el && fx.motion() !== 'off') el.classList.add('fx-pick'); }
    if (ui.dgFocus != null) { const el = root.querySelector(`.dg[data-i="${ui.dgFocus}"]`); ui.dgFocus = null; if (el) el.focus(); }
    const tasks = root.querySelector('.tasks');
    if (tasks) makeSortable(tasks, {
      item: '.task', container: '.tasks',
      onDrop({ el, index }) { E.moveCard(el.dataset.id, 'today', index); }
    });
    const f = root.querySelector('[data-quickadd]');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const text = f.elements.text.value.trim();
      if (!text) return;
      S().cards.today.push(touch({ id: uid(), text, tagId: null, subs: [] }));
      f.elements.text.value = '';
      save();
    });
  },
  tick(root) {
    // while Home is still opening, the dial is left alone so its fill can finish
    const duel = root.querySelector('#home-duel');
    if (duel && !root.classList.contains('entering')) duel.innerHTML = duelHtml();
    const stats = root.querySelector('#home-stats');
    if (stats) stats.innerHTML = statsHtml();
    const combo = root.querySelector('#home-combo');
    if (combo) { combo.innerHTML = comboHtml(); combo.classList.toggle('up', E.dayScore(today()).combo.mult > 1); }
    const run = root.querySelector('#home-run'), a = E.runningActivity();
    if (run && a) run.textContent = fmtTimer(Date.now() - a.lastStart);
    if (new Date().getSeconds() % 15 === 0) { const hud = root.querySelector('#home-hud'); if (hud) hud.innerHTML = hudHtml(); }
  }
};

registerActions({
  'home.select': (d, e) => { if (e && e.target.closest('button')) return; ui.selCard = d.id; ui.selPulse = d.id; fx.sound('lift'); refresh(); },
  'home.goal': (d, e, el) => E.setDayGoal(today(), +d.i, { t: el.value.trim() }),
  // Open one more line and put the cursor in it. If a line is already empty, use that one.
  'home.goalAdd': d => {
    const empty = [...document.querySelectorAll('.dgs .dg')].find(el => !el.value.trim());
    if (empty) { empty.focus(); return; }
    const t = today(), day = S().days[t] || (S().days[t] = {});
    day.goalRows = +d.n + 1; ui.dgFocus = +d.n; save();
  },
  // Remove a goal, or an empty line you do not want.
  'home.goalDel': d => {
    const t = today(), day = S().days[t] || (S().days[t] = {}), i = +d.i;
    day.goalRows = Math.max(1, +d.n - 1);
    E.removeDayGoal(t, i);
  },
  'home.rate': () => { ui.sessView = 'list'; location.hash = '#/track'; },
  'habit.toggle': (d, e, el) => {
    const gain = E.toggleHabit(d.id, d.date || today());
    if (!d.date) ui.flipHold = 280;                        // let the tick finish drawing before the row slides to its new section
    if (gain > 0 && el) fx.float(el, `+${gain} XP`);
    if (gain > 0 && (!d.date || d.date === today())) {
      const sw = E.sweepStatus();
      if (sw.done && E.habitsDue(today()).length > 1) toast('Every habit done', `That's a ${sw.chain}-day sweep. You earned an extra ${sw.bonus} XP.`, { kind: 'good', ms: 5000, sound: 'win' });
    }
    void el;
  },
  'home.shadowInfo': () => {
    const t = today(), i = E.shadowInfo(t), n = esc(L().shadow), sc = E.dayScore(t);
    const parts = [['Habits', sc.habits], ['Focus', sc.focus], ['Tasks', sc.tasks], ['Efficiency', sc.eff], ['Clean sweep', sc.sweep], ['Logbook', sc.log], ['Main goals', sc.goals]].filter(p => p[1] > 0);
    openModal({
      title: "Today's numbers", cancel: 'Close',
      body: `<div><div class="label" style="margin-bottom:6px">Your ${sc.total} XP so far</div>
        <div class="row wrap">${parts.map(([k, v]) => `<span class="pill">${k} ${v}</span>`).join('') || '<span class="muted">Nothing yet.</span>'}${sc.penalty ? `<span class="pill bad">Social media -${sc.penalty}</span>` : ''}</div></div>
        <div><div class="label" style="margin-bottom:6px">How ${n} gets his target</div>
        <p class="muted">Every morning ${n} sets a target a little above how you have been doing lately.</p></div>
        <div class="telemetry">
          ${i.calibrating ? `<div><span>Still learning your pace</span><b>${i.need} more day${i.need === 1 ? '' : 's'}</b><i>Until then he aims for 60% of a full day.</i></div>`
            : `<div><span>Your 7-day average</span><b>${i.avg7} XP</b><i>Counts for 60%</i></div>
               <div><span>Your last scored day</span><b>${i.last} XP</b><i>Counts for 40%</i></div>
               <div><span>His edge</span><b>+${i.edge}%</b><i>You can change this in Settings.</i></div>
               <div><span>Your best in 30 days</span><b>${i.best} XP</b><i>He never asks for more than this.</i></div>`}
          <div><span>His target today</span><b class="tone-accent">${i.xp} XP</b></div>
        </div>`
    });
  },
});
void clamp;
