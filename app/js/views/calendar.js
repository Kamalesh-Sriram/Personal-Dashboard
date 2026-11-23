/* CALENDAR: the month at a glance: each day's verdict, XP, focus and
   sleep. Open a day to log sleep, mark a rest day or pin an emoji. */
import { S, save } from '../store.js';
import * as E from '../engine.js';
import { registerActions, runAction, openModal, closeModal } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, ymd, parseYmd, fmtDate, fmtDur, fmtMins, pad } from '../util.js';
import { ui, refresh } from '../bus.js';
import { L, monthHtml } from '../flows.js';

const month = () => ui.calMonth || today().slice(0, 7);

/** Numbers for any day: the frozen verdict if it was settled, live figures otherwise. */
function dayInfo(date) {
  const st = S(), settled = st.game.days[date], log = st.days[date] || {};
  const t = today(), future = date > t;
  const x = settled ? settled.x : future ? 0 : E.dayXP(date);
  const hours = settled ? settled.h : future ? 0 : Math.round(E.focusMsOn(date) / 36000) / 100;
  return { settled, log, x, hours, future, rest: !!log.rest, v: settled ? settled.v : null, sleep: log.sleep && log.sleep.hrs ? log.sleep.hrs : null };
}

function cellHtml(date, inMonth) {
  const i = dayInfo(date), t = today(), d = parseYmd(date).getDate();
  const dueH = E.habitsDue(date).length, doneH = E.habitsDoneOn(date);
  const v = i.rest ? 'R' : i.v === 'W' || i.v === 'L' ? i.v : '';
  const word = { W: 'Won', L: 'Lost', R: 'Rest' }[v] || '';
  return `<button class="cal-c ${inMonth ? '' : 'out'} ${date === t ? 'now' : ''} ${i.future ? 'future' : ''} ${i.rest ? 'rest' : ''} ${v === 'R' ? '' : v}" data-act="cal.day" data-date="${date}" aria-label="${esc(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}${word ? ', ' + word.toLowerCase() : ''}">
    <span class="cal-n">${d}${word ? `<span class="cal-v ${v}">${word}</span>` : ''}</span>
    ${!i.future && (i.x || i.hours) ? `<span class="cal-x"><b>${i.x}</b> xp</span><span class="cal-s">${i.hours ? i.hours.toFixed(1) + 'h' : ''}${dueH ? ` · ${doneH}/${dueH}` : ''}</span>` : '<span class="cal-x"></span>'}
    <span class="cal-e">${i.sleep ? `<small title="Sleep">${icon('moon')}${i.sleep}h</small>` : ''}${(i.log.emojis || []).slice(0, 4).map(esc).join('')}</span>
  </button>`;
}

function openDay(date) {
  const st = S(), i = dayInfo(date), t = today(), log = i.log, j = st.journal[date] || {};
  const sess = E.sessionsOn(date), byAct = new Map();
  sess.forEach(({ a, s }) => byAct.set(a, (byAct.get(a) || 0) + s.dur));
  const canRest = date <= t && date >= st.game.start;
  const b = E.restBudget(date);
  const emojis = () => (st.days[date] && st.days[date].emojis) || [];
  const emojiRow = () => `${emojis().map(e => `<button type="button" class="emo on" data-emo="${esc(e)}" title="Remove">${esc(e)}</button>`).join('')}`;
  openModal({
    title: fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), cancel: 'Close', wide: true,
    body: `<div class="telemetry">
        <div><span>XP</span><b>${i.x}</b>${i.settled && i.settled.s ? `<i>${esc(L().shadow)} ${i.settled.s} · ${i.v === 'W' ? 'won' : 'lost'}</i>` : i.rest ? '<i>rest day: not scored</i>' : ''}</div>
        <div><span>Focus</span><b>${i.hours ? i.hours.toFixed(1) + 'h' : '-'}</b></div>
        <div><span>Tasks done</span><b>${E.tasksDoneOn(date)}</b></div>
        <div><span>Habits</span><b>${E.habitsDoneOn(date)}/${E.habitsDue(date).length}</b></div>
        <div><span>Execution</span><b>${i.settled && i.settled.ex != null ? i.settled.ex + '%' : date === t && E.execScoreFor(t) !== null ? E.execScoreFor(t) + '%' : '-'}</b></div>
        <div><span>Start delay</span><b>${fmtMins(i.settled ? i.settled.tt : E.ttfbFor(date))}</b></div>
        <div><span>Sleep</span><b>${i.sleep ? i.sleep + 'h' : '-'}</b>${log.sleep && log.sleep.hrs ? `<i>${esc(log.sleep.start)} to ${esc(log.sleep.end)}</i>` : ''}</div>
        <div><span>Efficacy</span><b>${log.efficacy != null ? log.efficacy + '%' : '-'}</b></div>
      </div>
      ${byAct.size ? `<div><div class="label" style="margin-bottom:6px">Time</div><div class="row wrap">${[...byAct.entries()].sort((a, b2) => b2[1] - a[1]).map(([a, ms]) => `<span class="pill">${esc(E.label(a))} · ${fmtDur(ms)}</span>`).join('')}</div></div>` : ''}
      ${j.w || j.l || j.f ? `<div><div class="label" style="margin-bottom:6px">Journal</div><div class="muted small">${j.w ? `<p><b>Right:</b> ${esc(j.w)}</p>` : ''}${j.l ? `<p><b>Wrong:</b> ${esc(j.l)}</p>` : ''}${j.f ? `<p><b>Fix:</b> ${esc(j.f)}</p>` : ''}</div></div>` : ''}
      <div><div class="label" style="margin-bottom:6px">Mark the day</div>
        <div class="row wrap" id="emo-on">${emojiRow()}</div>
        <div class="row" style="margin-top:8px"><input class="input" id="emo-custom" maxlength="4" placeholder="Type an emoji or a short mark, then press Enter" aria-label="Add a mark to this day"></div></div>`,
    footer: `<div class="left">
        ${date <= t ? `<button type="button" class="btn" data-act="cal.sleep" data-date="${date}">${icon('bed')} ${i.sleep ? 'Edit sleep' : 'Log sleep'}</button>` : ''}
        ${canRest ? `<button type="button" class="btn ${i.rest ? 'primary' : ''}" data-act="cal.rest" data-date="${date}" title="${b.left} of ${b.allowed} rest days left in this 7-day window">${icon('moon')} ${i.rest ? 'Rest day on' : 'Make it a rest day'}</button>` : ''}
        ${date < t ? `<button type="button" class="btn ghost" data-act="cal.track" data-date="${date}">${icon('track')} Sessions</button>` : ''}
      </div><button type="button" class="btn ghost" data-act="modal.close">Close</button>`,
    onMount: el => {
      const on = el.querySelector('#emo-on');
      const set = list => { const d = st.days[date] || (st.days[date] = {}); d.emojis = list.slice(0, 6); save(); on.innerHTML = emojiRow(); };
      el.addEventListener('click', e => {
        const rm = e.target.closest('[data-emo]');
        if (rm) set(emojis().filter(x => x !== rm.dataset.emo));
      });
      el.querySelector('#emo-custom').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
      el.querySelector('#emo-custom').addEventListener('change', e => { const v = e.target.value.trim(); if (v && !emojis().includes(v)) set([...emojis(), v]); e.target.value = ''; });
    }
  });
}

export default {
  render() {
    const m = month(), [y, mo] = m.split('-').map(Number), t = today();
    const first = new Date(y, mo - 1, 1), lead = (first.getDay() + 6) % 7;           // Monday-first
    const start = addDays(ymd(first), -lead), daysIn = new Date(y, mo, 0).getDate();
    const cells = Math.ceil((lead + daysIn) / 7) * 7;
    let grid = '';
    for (let i = 0; i < cells; i++) { const d = addDays(start, i); grid += cellHtml(d, d.slice(0, 7) === m); }
    // month totals from settled days + today
    let xp = 0, hrs = 0;
    for (let d = 1; d <= daysIn; d++) {
      const date = `${m}-${pad(d)}`; if (date > t) break;
      const i = dayInfo(date);
      xp += i.x; hrs += i.hours;
    }
    return `<div class="view-h"><h2>${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2>
        <span class="pill">${xp} XP</span><span class="pill">${hrs.toFixed(1)}h focus</span>
        <button class="icon-btn" data-act="cal.nav" data-d="-1" aria-label="Previous month">${icon('left')}</button>
        <button class="btn sm ghost" data-act="cal.nav" data-d="0" ${m === t.slice(0, 7) ? 'disabled' : ''}>Today</button>
        <button class="icon-btn" data-act="cal.nav" data-d="1" aria-label="Next month">${icon('right')}</button></div>
      ${S().settings.modules.shadow && m <= t.slice(0, 7) ? `<section class="card month-card" aria-label="The month's record">${monthHtml(m)}</section>` : ''}
      <div class="card flush cal"><div class="cal-h">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
        <div class="cal-g">${grid}</div></div>`;
  }
};

registerActions({
  'cal.nav': d => {
    const n = +d.d;
    if (n === 0) ui.calMonth = null;
    else { const [y, mo] = month().split('-').map(Number); const nd = new Date(y, mo - 1 + n, 1); ui.calMonth = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}`; }
    refresh();
  },
  'cal.day': d => openDay(d.date),
  'cal.sleep': d => { closeModal(); runAction('log.sleep', { date: d.date }); },
  'cal.rest': d => { closeModal(); runAction('rest.toggle', { date: d.date }); },
  'cal.track': d => { closeModal(); ui.trackDate = d.date; location.hash = '#/track'; }
});
