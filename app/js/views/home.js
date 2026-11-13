/* HOME: the day at a glance: you against the rival, the mission, the
   next task to lock in on, habits, and the logbook. */
import { S, save, touch } from '../store.js';
import * as E from '../engine.js';
import { registerActions, toast, openModal } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, fmtDur, fmtMins, fmtDate, fmtTimer, clamp, uid, safeColor, daysBetween } from '../util.js';
import { ui, refresh } from '../bus.js';
import { duelDial } from '../charts.js';
import { L, objectiveRows } from '../flows.js';

const tone = (ok, warn) => (ok ? 'good' : warn ? 'warn' : 'bad');

/* ── main goals: the lasting ones, written out again each morning ── */
function goalsHtml() {
  const t = today(), cur = E.dayGoals(t), prev = E.prevDayGoals(t), x = S().settings.xp;
  const written = cur.filter(g => g && g.t).length;
  const n = Math.max(3, written + 1, prev.length);          // always one empty line to add another
  let rows = '';
  for (let i = 0; i < n; i++) {
    const g = cur[i] || { t: '' }, ghost = prev[i] ? prev[i].t : '';
    rows += `<input class="input dg" value="${esc(g.t)}" placeholder="${esc(ghost || 'A goal you are working toward')}" maxlength="140" data-change="home.goal" data-i="${i}" data-fk="dg${i}" aria-label="Main goal ${i + 1}" autocomplete="off">`;
  }
  const earned = E.goalXP(t);
  return `<div class="card-h"><span class="eyebrow">Main goals</span>
      <span class="pill ${earned ? 'good' : ''}" title="Writing your goals out each day earns ${x.goal} XP each, for up to ${x.goalCap} goals.">${earned ? `+${earned} XP` : `+${x.goal} XP each`}</span></div>
    <div class="dgs">${rows}</div>`;
}

/* ── you vs the rival ── */
function duelHtml() {
  const st = S(), t = today(), rest = E.isRest(t), show = st.settings.modules.shadow, name = esc(L().shadow);
  const sc = E.dayScore(t), him = E.shadowXP(t), pace = E.shadowPaceNow(), w = E.winMinutes();
  const gap = sc.total - pace, sb = E.scoreboard(), c = sc.combo;
  const sub = rest ? 'rest day' : show ? `${him} to beat` : '';
  const line = rest ? E.voice('rest') : E.voice(sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind');
  const tier = rest ? 'rest' : sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind';
  if (duelHtml.tier !== tier) { duelHtml.tier = tier; duelHtml.line = line; }     // stable until the situation changes
  const standing = gap === 0 ? "You're level." : `You're ${Math.abs(gap)} XP ${gap > 0 ? 'ahead' : 'behind'}.`;
  const his = pace >= him ? `${name} has finished the day with ${him} XP.` : `${name} is at ${pace} XP and will end the day with ${him} XP.`;
  return `
    <div class="dial-wrap">${duelDial({ you: sc.total, shadow: him, pace, dayFrac: (E.nowMinutes() - w.start) / w.total, showShadow: show, rest, sub })}</div>
    ${rest ? `<div class="pace tone-info">It's a rest day. Nothing is scored.</div>`
      : show ? `<div class="pace tone-${gap >= 0 ? 'good' : 'bad'}">${standing}</div><div class="small muted" style="text-align:center">${his}</div>` : ''}
    ${show && duelHtml.line ? `<blockquote class="quote">${esc(duelHtml.line)}<cite>${name}</cite></blockquote>` : ''}
    <div class="mini-stats">
      ${show ? `<div><b class="num">${sb.w}</b><span>Days won</span></div><div><b class="num">${sb.l}</b><span>Days lost</span></div><div><b class="num">${sb.streak}</b><span>Win streak</span></div>` : ''}
      <div title="Working in back-to-back blocks multiplies your XP. A gap of more than 10 minutes, or a break, resets it."><b class="num ${c.mult > 1 ? 'tone-good' : ''}">${c.mult.toFixed(1)}×</b><span>${c.chain > 1 ? c.chain + ' blocks in a row' : 'Combo'}</span></div>
    </div>`;
}

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
    return `<div class="task ${tag ? 'tagged' : ''} ${isSel ? 'sel' : ''} ${live ? 'live' : ''}" ${tag ? `style="--c:${safeColor(tag.color)}"` : ''} data-act="home.select" data-id="${esc(c.id)}" role="button" tabindex="0" aria-pressed="${isSel}">
      <button class="check" data-act="card.complete" data-id="${esc(c.id)}" title="Mark as done" aria-label="Mark as done">${icon('check')}</button>
      <div class="grow"><div class="task-t">${esc(c.text)}</div>
        <div class="task-m">${tag ? `<span class="tag" style="color:${safeColor(tag.color)}"><i></i>${esc(tag.name)}</span>` : ''}
          ${c.est ? `<span>${fmtMins(c.est)}</span>` : ''}
          ${c.deadline ? `<span class="${c.deadline < today() ? 'tone-bad' : ''}">due ${fmtDate(c.deadline, { day: 'numeric', month: 'short' })}</span>` : ''}</div></div>
      <button class="icon-btn sm" data-act="lock.in" data-card="${esc(c.id)}" title="Start this task" aria-label="Start this task">${icon('play')}</button>
    </div>`;
  }).join('');
  return `
    ${running
      ? `<button class="lockin running" data-act="focus.show"><span class="lockin-t">${icon('zap')} ${esc(E.label(running))} · <span id="home-run">${fmtTimer(Date.now() - running.lastStart)}</span></span>
           <span class="lockin-s">Tap to open the focus view</span></button>`
      : `<button class="lockin" data-act="lock.in"><span class="lockin-t">${icon('lock')} ${esc(L().lockIn)}</span>
           <span class="lockin-s">${sel ? `${esc(sel.text.slice(0, 60))} · ${esc(E.label(act))}` : esc(E.label(act))}</span></button>`}
    <div class="card-h" style="margin:16px 0 8px"><span class="eyebrow">Top tasks</span>
      <button class="btn sm ghost" data-act="nav.go" data-tab="board">${cards.length > TOP_TASKS ? `${cards.length - TOP_TASKS} more on the board` : 'Open the board'}</button></div>
    <div class="tasks">${rows || `<div class="empty" style="padding:10px 0 6px">No tasks for today yet.</div>`}</div>
    <form class="row" data-quickadd style="margin-top:10px">
      <input class="input" name="text" placeholder="Add a task for today" maxlength="200" data-fk="home-add" aria-label="Add a task for today">
      <button class="btn" type="submit" aria-label="Add task">${icon('plus')}</button>
    </form>`;
}

/* ── logbook ── */
function logbookHtml() {
  const lb = E.logStatus(), x = S().settings.xp;
  const item = (ok, label, act, ico, hint) => `<button class="log-item ${ok ? 'ok' : ''}" data-act="${act}" title="${esc(hint)}">${icon(ok ? 'check' : ico)}<span>${label}</span></button>`;
  return `<div class="card-h" style="margin-bottom:10px"><span class="eyebrow">Logbook</span>
      <span class="pill ${lb.complete ? 'good' : ''}" title="Each entry you fill in earns ${x.log} XP.">${lb.count} of 4</span>
      ${lb.chain ? `<span class="streak ${lb.chain >= 7 ? 'hot' : ''}" title="${lb.chain} days in a row with a full logbook">${icon('flame')}${lb.chain}</span>` : ''}</div>
    <div class="logbook">
      ${item(lb.sleep, 'Sleep', 'log.sleep', 'bed', "Log last night's sleep")}
      ${item(lb.rated, lb.unrated ? `${lb.unrated} to rate` : 'Sessions rated', 'home.rate', 'gauge', 'Rate how focused each session was')}
      ${item(lb.efficacy, 'Efficacy', 'log.efficacy', 'goals', 'Rate how well the day went')}
      ${item(lb.journal, 'Debrief', 'debrief.open', 'note', 'Write up the day')}
    </div>`;
}

/* ── identity strip ── */
function hudHtml() {
  const st = S(), t = today(), sb = E.scoreboard(), rk = E.rankFor(sb.rep), mom = E.momentum();
  const ex = E.execScoreFor(t), e7 = E.exec7(), tt = E.ttfbFor(t), avgT = E.serviceRecord().ttfbAvg;
  const due = E.habitsDue(t), left = due.filter(h => h.history[t] !== 'done').length, sw = E.sweepStatus(), rest = E.isRest(t);
  const cells = [];
  // habits are a count here; the list lives on its own tab
  cells.push(`<button class="hud-cell" data-act="nav.go" data-tab="habits"><span class="eyebrow">Habits</span>
    <b class="num ${!due.length || rest ? 'tone-mute' : left ? '' : 'tone-good'}">${!due.length ? 'None due' : rest ? 'Rest day' : left ? left + ' left' : 'All done'}</b>
    <span>${!due.length ? 'Nothing is due today' : rest ? 'Your streaks are frozen' : left ? (sw.chain ? `Keep your ${sw.chain}-day sweep` : `${due.length - left} of ${due.length} done`) : `${sw.chain}-day sweep, +${sw.bonus} XP`}</span></button>`);
  if (st.settings.modules.rank) {
    cells.push(`<button class="hud-cell" data-act="home.ranks"><span class="eyebrow">${esc(L().rank)}</span><b class="tone-accent">${esc(rk.cur.name)}</b>
      <div class="bar thin"><i style="width:${rk.pct}%"></i></div><span>${Math.round(sb.rep)} ${esc(L().rep.toLowerCase())}${rk.next ? `, ${Math.ceil(rk.next.at - sb.rep)} more to ${esc(rk.next.name)}` : ''}</span></button>`);
  }
  if (st.settings.modules.mission) {
    cells.push(`<div class="hud-cell"><span class="eyebrow">Execution</span><b class="num tone-${ex === null ? 'mute' : tone(ex >= 60, ex >= 40)}">${ex === null ? '-' : ex + '%'}</b><span>${e7 !== null ? `Your 7-day average is ${e7}%` : ex === null ? 'Set a mission to score this' : 'Of the mission you set'}</span></div>`);
    cells.push(`<div class="hud-cell"><span class="eyebrow">Momentum</span><b class="tone-${mom.tone}">${mom.label}</b><span>${esc(mom.sub)}</span></div>`);
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
    const duel = root.querySelector('#home-duel');
    if (duel) duel.innerHTML = duelHtml();
    const run = root.querySelector('#home-run'), a = E.runningActivity();
    if (run && a) run.textContent = fmtTimer(Date.now() - a.lastStart);
    if (new Date().getSeconds() % 15 === 0) { const hud = root.querySelector('#home-hud'); if (hud) hud.innerHTML = hudHtml(); }
  }
};

registerActions({
  'home.select': (d, e) => { if (e && e.target.closest('button')) return; ui.selCard = d.id; refresh(); },
  'home.goal': (d, e, el) => E.setDayGoal(today(), +d.i, { t: el.value.trim() }),
  'home.rate': () => { ui.sessView = 'list'; location.hash = '#/track'; },
  'habit.toggle': (d, e, el) => {
    const gain = E.toggleHabit(d.id, d.date || today());
    if (gain > 0 && (!d.date || d.date === today())) {
      const sw = E.sweepStatus();
      if (sw.done && E.habitsDue(today()).length > 1) toast('Every habit done', `That's a ${sw.chain}-day sweep. You earned an extra ${sw.bonus} XP.`, { kind: 'good', ms: 5000 });
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
  'home.ranks': () => {
    const sb = E.scoreboard(), ranks = [...S().settings.ranks].sort((a, b) => a.at - b.at), cur = E.rankFor(sb.rep).cur;
    openModal({
      title: `${L().rank} and ${L().rep.toLowerCase()}`, cancel: 'Close',
      body: `<div class="list">${ranks.map(r => `<div class="li"><span class="grow ${r === cur ? 'tone-accent' : ''}"><b>${esc(r.name)}</b>${r === cur ? ' (you are here)' : ''}</span><span class="dim">${r.at}+</span></div>`).join('')}</div>
        <div class="sep"></div>
        <p class="hint">${esc(L().rep)} changes once a day, when the day ends, based on how much of your mission you finished. 80% or more adds 3. 60% adds 1.5. 40% adds 0.5. 20% takes 1 away. Under 20% takes 3. No mission at all takes 2. Rest days change nothing.</p>`
    });
  }
});
void clamp;
