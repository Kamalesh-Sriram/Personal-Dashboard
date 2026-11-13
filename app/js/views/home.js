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

/* ── main goals: typed fresh each morning, yesterday's shown faintly ── */
function goalsHtml() {
  const t = today(), cur = E.dayGoals(t), prev = E.prevDayGoals(t);
  const n = Math.min(5, Math.max(3, cur.filter(g => g && g.t).length + 1, prev.length));
  let rows = '';
  for (let i = 0; i < n; i++) {
    const g = cur[i] || { t: '', done: false }, ghost = prev[i] ? prev[i].t : '';
    rows += `<div class="dg ${g.done ? 'done' : ''}">
      <button class="check sq ${g.done ? 'on' : ''}" data-act="home.goalDone" data-i="${i}" ${g.t ? '' : 'disabled'} aria-pressed="${!!g.done}" aria-label="Mark goal ${i + 1} done">${icon('check')}</button>
      <input class="input" value="${esc(g.t)}" placeholder="${esc(ghost || 'Main goal ' + (i + 1))}" maxlength="140" data-change="home.goal" data-i="${i}" data-fk="dg${i}" aria-label="Main goal ${i + 1}" autocomplete="off">
    </div>`;
  }
  return `<div class="card-h"><span class="eyebrow">Main goals today</span>
      <span class="tiny dim">${prev.length ? 'The faint text is what you wrote last time. Type it again to keep it.' : 'Clears every morning.'}</span></div>
    <div class="dgs">${rows}</div>`;
}

/* ── you vs the rival ── */
function duelHtml() {
  const st = S(), t = today(), rest = E.isRest(t), show = st.settings.modules.shadow;
  const sc = E.dayScore(t), him = E.shadowXP(t), pace = E.shadowPaceNow(), w = E.winMinutes();
  const gap = sc.total - pace, sb = E.scoreboard(), c = sc.combo;
  const sub = rest ? 'rest day: not scored' : show ? `${him} to beat` : `full day ≈ ${E.maxXP(t)}`;
  const line = rest ? E.voice('rest') : E.voice(sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind');
  const tier = rest ? 'rest' : sc.total === 0 ? 'idle' : gap >= 0 ? 'ahead' : 'behind';
  if (duelHtml.tier !== tier) { duelHtml.tier = tier; duelHtml.line = line; }     // stable until the situation changes
  const parts = [['Habits', sc.habits], ['Focus', sc.focus], ['Tasks', sc.tasks], ['Efficiency', sc.eff], ['Sweep', sc.sweep], ['Logbook', sc.log]].filter(p => p[1] > 0);
  return `
    <div class="dial-wrap">${duelDial({ you: sc.total, shadow: him, pace, dayFrac: (E.nowMinutes() - w.start) / w.total, showShadow: show, rest, sub })}</div>
    ${rest ? `<div class="pace tone-info">Rest day. Nothing counts for or against you.</div>`
      : show ? `<div class="pace tone-${gap >= 0 ? 'good' : 'bad'}">${gap >= 0 ? 'Ahead of' : 'Behind'} ${esc(L().shadow)}'s pace by ${Math.abs(gap)} XP</div>
         <div class="small muted" style="text-align:center">He is at ${pace} XP now and finishes on ${him}</div>
         <div class="tiny dim" style="text-align:center">${esc(E.shadowBasis(t))}</div>` : ''}
    ${parts.length ? `<div class="xp-parts">${parts.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}${sc.penalty ? `<span class="tone-bad">Social <b>-${sc.penalty}</b></span>` : ''}</div>` : ''}
    ${show && duelHtml.line ? `<blockquote class="quote">${esc(duelHtml.line)}<cite>${esc(L().shadow)}</cite></blockquote>` : ''}
    <div class="mini-stats">
      ${show ? `<div><b class="num">${sb.w}</b><span>Days won</span></div><div><b class="num">${sb.l}</b><span>Days lost</span></div><div><b class="num">${sb.streak}</b><span>Win streak</span></div>` : ''}
      <div title="Back-to-back blocks pay more. A gap over 10 minutes or a break resets it."><b class="num ${c.mult > 1 ? 'tone-good' : ''}">${c.mult.toFixed(1)}×</b><span>${c.chain > 1 ? c.chain + ' blocks chained' : 'Combo'}</span></div>
    </div>`;
}

/* ── mission + lock in ── */
function missionHtml() {
  const st = S(), t = today();
  if (!st.settings.modules.mission) return '';
  const m = E.missionFor(t), has = E.hasMission(t), ex = E.execScoreFor(t);
  return `<div class="card-h"><span class="eyebrow">${esc(L().mission)}${has ? ` · ${m.src === 'night' ? 'declared last night' : 'declared this morning'}` : ''}</span>
      ${has ? `<span class="pill ${ex >= 60 ? 'good' : ex >= 40 ? 'warn' : 'bad'}">${ex}% executed</span>` : ''}
      <button class="icon-btn sm" data-act="brief.open" title="${has ? 'Edit mission' : 'Declare mission'}" aria-label="Edit mission">${icon('edit')}</button></div>
    ${has ? `<div class="objs">${objectiveRows(m)}</div>`
      : `<div class="empty" style="padding:10px 0 4px">${E.isRest(t) ? 'Rest day: no mission needed.' : `No mission declared. An undeclared day scores 0% execution.`}
          <br><button class="btn sm primary" data-act="brief.open">${icon('flag')} Declare mission</button></div>`}
    <div class="sep"></div>`;
}
function lockHtml() {
  const st = S(), cards = st.cards.today || [];
  const sel = cards.find(c => c.id === ui.selCard) || cards[0] || null;
  const act = sel ? E.activityForCard(sel) : E.focusActivity();
  const running = E.runningActivity();
  const rows = cards.slice(0, 6).map(c => {
    const tag = st.tags.find(x => x.id === c.tagId), isSel = sel && sel.id === c.id;
    const subs = c.subs || [], sd = subs.filter(s => s.done).length;
    const live = running && running.runCardId === c.id;
    return `<div class="task ${tag ? 'tagged' : ''} ${isSel ? 'sel' : ''} ${live ? 'live' : ''}" ${tag ? `style="--c:${safeColor(tag.color)}"` : ''} data-act="home.select" data-id="${esc(c.id)}" role="button" tabindex="0" aria-pressed="${isSel}">
      <button class="check" data-act="card.complete" data-id="${esc(c.id)}" title="Mark done" aria-label="Mark done">${icon('check')}</button>
      <div class="grow"><div class="task-t">${esc(c.text)}</div>
        <div class="task-m">${tag ? `<span class="tag" style="color:${safeColor(tag.color)}"><i></i>${esc(tag.name)}</span>` : ''}
          ${c.est ? `<span>${fmtMins(c.est)}</span>` : ''}${subs.length ? `<span>${sd}/${subs.length} steps</span>` : ''}
          ${E.cardMs(c.id) > 0 ? `<span>${fmtDur(E.cardMs(c.id))} logged</span>` : ''}
          ${c.deadline ? `<span class="${c.deadline < today() ? 'tone-bad' : ''}">due ${fmtDate(c.deadline, { day: 'numeric', month: 'short' })}</span>` : ''}</div></div>
      <button class="icon-btn sm" data-act="lock.in" data-card="${esc(c.id)}" title="${esc(L().lockIn)} on this task" aria-label="Start this task">${icon('play')}</button>
    </div>`;
  }).join('');
  return `
    ${running
      ? `<button class="lockin running" data-act="focus.show"><span class="lockin-t">${icon('zap')} ${esc(E.label(running))} · <span id="home-run">${fmtTimer(Date.now() - running.lastStart)}</span></span>
           <span class="lockin-s">Running: open the focus view</span></button>`
      : `<button class="lockin" data-act="lock.in"><span class="lockin-t">${icon('lock')} ${esc(L().lockIn)}</span>
           <span class="lockin-s">${sel ? `${esc(sel.text.slice(0, 60))} · logs to ${esc(E.label(act))}` : `No task queued: logs to ${esc(E.label(act))}`}</span></button>`}
    <div class="tasks">${rows || `<div class="empty" style="padding:14px 0 6px">Nothing in Today yet.</div>`}</div>
    <form class="row" data-quickadd style="margin-top:10px">
      <input class="input" name="text" placeholder="Add a task for today…" maxlength="200" data-fk="home-add" aria-label="Add a task for today">
      <button class="btn" type="submit" aria-label="Add task">${icon('plus')}</button>
    </form>
    ${cards.length > 6 ? `<button class="btn ghost sm block" data-act="nav.go" data-tab="board" style="margin-top:8px">${cards.length - 6} more on the board</button>` : ''}`;
}

/* ── habits + logbook ── */
function habitsHtml() {
  const t = today(), due = E.habitsDue(t), done = due.filter(h => h.history[t] === 'done').length;
  const sw = E.sweepStatus(), rest = E.isRest(t);
  const rows = due.map(h => {
    const s = E.habitStats(h);
    return `<div class="li ${s.doneToday ? 'done' : ''}">
      <button class="check ${s.doneToday ? 'on' : ''}" data-act="habit.toggle" data-id="${esc(h.id)}" aria-pressed="${s.doneToday}" aria-label="${esc(h.name)}">${icon('check')}</button>
      <span class="li-t grow ell">${esc(E.label(h))}</span>
      <span class="streak ${s.streak >= 7 ? 'hot' : ''}" title="Current streak">${icon(s.frozen ? 'snow' : 'flame')}${s.streak}</span>
      <span class="tiny ${s.doneToday ? 'tone-good' : 'dim'}" style="min-width:44px;text-align:right">${s.doneToday ? 'done' : '+' + s.nextGain + ' XP'}</span>
    </div>`;
  }).join('');
  return `<div class="card-h"><span class="eyebrow">Habits today</span><span class="num" style="font-size:18px">${done}<span class="dim" style="font-size:13px">/${due.length}</span></span>
      <button class="icon-btn sm" data-act="nav.go" data-tab="habits" title="Open habits" aria-label="Open habits">${icon('right')}</button></div>
    <div class="bar"><i style="width:${due.length ? done / due.length * 100 : 0}%"></i></div>
    ${due.length ? `<div class="sweep ${sw.done ? 'on' : ''}">${icon('flame')}<div class="grow"><b>${sw.done ? `Clean sweep · ${sw.chain}-day chain` : sw.chain ? `${sw.chain}-day sweep chain on the line` : 'Clean sweep'}</b>
        <span>${rest ? 'Frozen for the rest day' : sw.done ? `+${sw.bonus} XP banked today` : `Finish all ${due.length} for +${sw.bonus} XP`}</span></div></div>` : ''}
    <div class="list" style="margin-top:6px">${rows || `<div class="empty">No habits due today.<br><button class="btn sm" data-act="nav.go" data-tab="habits">Add a habit</button></div>`}</div>`;
}
function logbookHtml() {
  const lb = E.logStatus(), x = S().settings.xp;
  const item = (ok, label, act, ico, hint) => `<button class="log-item ${ok ? 'ok' : ''}" data-act="${act}" title="${esc(hint)}">${icon(ok ? 'check' : ico)}<span>${label}</span></button>`;
  return `<div class="card-h" style="margin-bottom:10px"><span class="eyebrow">Logbook</span>
      <span class="pill ${lb.complete ? 'good' : ''}">${lb.count}/4 · +${lb.count * x.log} XP</span>
      ${lb.chain ? `<span class="streak ${lb.chain >= 7 ? 'hot' : ''}" title="Days in a row with a complete logbook">${icon('flame')}${lb.chain}</span>` : ''}</div>
    <div class="logbook">
      ${item(lb.sleep, 'Sleep', 'log.sleep', 'bed', 'Log last night\'s sleep')}
      ${item(lb.rated, lb.unrated ? `Rate ${lb.unrated}` : 'Sessions rated', 'home.rate', 'gauge', 'Rate how focused each session was')}
      ${item(lb.efficacy, 'Efficacy', 'log.efficacy', 'goals', 'Rate how effective the day was')}
      ${item(lb.journal, 'Debrief', 'debrief.open', 'note', 'Write the day\'s debrief')}
    </div>
    <div class="tiny dim" style="margin-top:8px">Paid for being written down, not for the value: the record is the point.</div>`;
}

/* ── identity strip ── */
function hudHtml() {
  const st = S(), t = today(), sb = E.scoreboard(), rk = E.rankFor(sb.rep), mom = E.momentum();
  const ex = E.execScoreFor(t), e7 = E.exec7(), tt = E.ttfbFor(t), avgT = E.serviceRecord().ttfbAvg;
  const cells = [];
  if (st.settings.modules.rank) {
    cells.push(`<button class="hud-cell" data-act="home.ranks"><span class="eyebrow">${esc(L().rank)}</span><b class="tone-accent">${esc(rk.cur.name)}</b>
      <div class="bar thin"><i style="width:${rk.pct}%"></i></div><span>${rk.next ? `${Math.ceil(rk.next.at - sb.rep)} to ${esc(rk.next.name)}` : 'Top rank'}</span></button>`);
    cells.push(`<div class="hud-cell"><span class="eyebrow">${esc(L().rep)}</span><b class="num">${Math.round(sb.rep)}</b><span>${st.settings.modules.mission && !E.isRest(t) ? `today ${fmtSigned(E.repDelta(ex))} if closed now` : 'earned by kept commitments'}</span></div>`);
  }
  if (st.settings.modules.mission) {
    cells.push(`<div class="hud-cell"><span class="eyebrow">Execution</span><b class="num tone-${ex === null ? 'mute' : tone(ex >= 60, ex >= 40)}">${ex === null ? '-' : ex + '%'}</b><span>${e7 !== null ? `7-day avg ${e7}%` : ex === null ? 'no mission declared' : 'of declared mission'}</span></div>`);
    cells.push(`<div class="hud-cell"><span class="eyebrow">Momentum</span><b class="tone-${mom.tone}">${mom.label}</b><span>${esc(mom.sub)}</span></div>`);
  }
  cells.push(`<div class="hud-cell"><span class="eyebrow">Time to first block</span><b class="num tone-${tt === null ? 'mute' : tone(avgT === null || tt <= avgT, true)}">${fmtMins(tt)}</b><span>${tt === null ? 'no deep block yet today' : avgT !== null ? `average ${fmtMins(avgT)}` : 'first record'}</span></div>`);
  cells.push(`<div class="hud-cell"><span class="eyebrow">Focus today</span><b class="num">${fmtDur(E.focusMsOn(t))}</b><span>target ${st.settings.targets.hours}h · ${E.tasksDoneOn(t)}/${st.settings.targets.tasks} tasks</span></div>`);
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
  return `<div class="card-h"><span class="eyebrow">Last 7 days</span><span class="tiny dim">bar = you · line = ${esc(L().shadow)}</span></div>
    <div class="week">${rows.map(r => `<div class="week-d" title="${fmtDate(r.d)}: ${r.x} XP${r.s ? ' vs ' + r.s : ''}">
        <div class="week-bar">${r.s ? `<u style="bottom:${r.s / max * 100}%"></u>` : ''}<i class="${r.v === 'W' ? 'w' : r.v === 'L' ? 'l' : r.v === 'R' ? 'r' : r.v === 'T' ? 't' : ''}" style="height:${Math.max(2, r.x / max * 100)}%"></i></div>
        <b>${r.x || '·'}</b><span>${parseDay(r.d)}</span></div>`).join('')}</div>`;
}
const parseDay = d => fmtDate(d, { weekday: 'narrow' });

function deadlinesHtml() {
  const st = S(), t = today(), items = [];
  st.goals.forEach(g => { if (g.deadline) items.push({ name: g.name, d: g.deadline, color: g.color, kind: 'Goal' }); });
  st.columns.forEach(c => { if (c.id !== 'done') (st.cards[c.id] || []).forEach(k => { if (k.deadline) items.push({ name: k.text, d: k.deadline, color: null, kind: 'Task' }); }); });
  items.sort((a, b) => (a.d < b.d ? -1 : 1));
  const row = it => { const n = daysBetween(t, it.d);
    return `<div class="li"><span class="dot" style="background:${safeColor(it.color, '#888888')}"></span><span class="grow ell">${esc(it.name)}</span>
      <span class="tiny dim">${it.kind}</span><span class="pill ${n < 0 ? 'bad' : n <= 2 ? 'warn' : ''}">${n < 0 ? Math.abs(n) + 'd late' : n === 0 ? 'today' : n + 'd'}</span></div>`; };
  return `<div class="card-h"><span class="eyebrow">Deadlines</span></div>
    <div class="list">${items.slice(0, 6).map(row).join('') || '<div class="empty">No deadlines set.</div>'}</div>`;
}
function timeHtml() {
  const t = today(), map = new Map();
  E.sessionsOn(t).forEach(({ a, s }) => map.set(a, (map.get(a) || 0) + s.dur));
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), max = Math.max(1, ...rows.map(r => r[1]));
  const eff = E.efficiencyOn(t);
  return `<div class="card-h"><span class="eyebrow">Time today</span><span class="tiny dim">${fmtDur(E.trackedMsOn(t))} tracked${eff !== null ? ` · ${Math.round(eff * 100)}% efficient` : ''}</span></div>
    ${rows.length ? rows.map(([a, ms]) => `<div class="time-row"><span class="ell">${esc(E.label(a))}</span><div class="bar"><i style="width:${ms / max * 100}%;background:${safeColor(a.color)}"></i></div><b>${fmtDur(ms)}</b></div>`).join('')
      : `<div class="empty">Nothing tracked yet.<br><button class="btn sm" data-act="nav.go" data-tab="track">Open Track</button></div>`}`;
}

export default {
  render() {
    const st = S(), t = today(), rest = E.isRest(t), b = E.restBudget(t);
    return `<div class="home">
      <section class="card home-goals" aria-label="Main goals today">${goalsHtml()}</section>
      <section class="card" aria-label="Today's score">
        <div class="card-h"><span class="eyebrow">${st.settings.modules.shadow ? `You vs ${esc(L().shadow)}` : 'Today'}</span>
          <button class="btn sm ${rest ? 'primary' : 'ghost'}" data-act="rest.toggle" title="Rest days are not scored. ${b.left} of ${b.allowed} left this week.">${icon('moon')} ${rest ? 'Rest day on' : 'Rest day'}</button>
          ${st.settings.modules.shadow ? `<button class="icon-btn sm" data-act="home.shadowInfo" title="How ${esc(L().shadow)} is set" aria-label="How the rival is set">${icon('help')}</button>` : ''}</div>
        <div id="home-duel">${duelHtml()}</div>
      </section>
      <section class="card" aria-label="Mission and tasks">${missionHtml()}<div id="home-lock">${lockHtml()}</div></section>
      <div class="stack">
        <section class="card" aria-label="Habits">${habitsHtml()}</section>
        <section class="card" aria-label="Logbook">${logbookHtml()}</section>
      </div>
      <section class="hud" id="home-hud" aria-label="Standing">${hudHtml()}</section>
      <section class="card">${weekHtml()}</section>
      <section class="card">${deadlinesHtml()}</section>
      <section class="card">${timeHtml()}</section>
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
  'home.goalDone': d => { const g = E.dayGoals(today())[+d.i]; if (g && g.t) E.setDayGoal(today(), +d.i, { done: !g.done }); },
  'home.rate': () => { ui.sessView = 'list'; location.hash = '#/track'; },
  'habit.toggle': (d, e, el) => {
    const gain = E.toggleHabit(d.id, d.date || today());
    if (gain > 0 && (!d.date || d.date === today())) {
      const sw = E.sweepStatus();
      if (sw.done && E.habitsDue(today()).length > 1) toast(`Clean sweep · ${sw.chain}-day chain`, `Every habit done. +${sw.bonus} XP on top of +${gain}.`, { kind: 'good', ms: 5000 });
    }
    void el;
  },
  'home.shadowInfo': () => {
    const i = E.shadowInfo(today()), n = L().shadow;
    openModal({
      title: `How ${n} is set`, cancel: 'Close',
      body: `<p class="muted">${esc(n)} is rebuilt every morning from what you actually did, so he is always one step ahead of your recent form.</p>
        <div class="telemetry">
          ${i.calibrating ? `<div><span>Status</span><b>Calibrating</b><i>${i.need} more scored day${i.need === 1 ? '' : 's'} needed: until then he runs at 60% of a full target day</i></div>`
            : `<div><span>Your 7-day average</span><b>${i.avg7} XP</b><i>60% of his bar</i></div>
               <div><span>Your last scored day</span><b>${i.last} XP</b><i>40% of his bar</i></div>
               <div><span>His edge</span><b>+${i.edge}%</b><i>how far ahead of your form he stays: change it in Settings</i></div>
               <div><span>Your best in 30 days</span><b>${i.best} XP</b><i>his ceiling: he never asks for more than you have already done</i></div>
               <div><span>Yesterday's bar</span><b>${i.prev} XP</b><i>he can drop at most 8% a day, so a slump is not rewarded at once</i></div>`}
          <div><span>Today's bar</span><b class="tone-accent">${i.xp} XP</b></div>
        </div>
        <p class="hint">Rest days are invisible to him. A strong week raises him the next morning; that is the point.</p>`
    });
  },
  'home.ranks': () => {
    const sb = E.scoreboard(), ranks = [...S().settings.ranks].sort((a, b) => a.at - b.at), cur = E.rankFor(sb.rep).cur;
    openModal({
      title: `${L().rank} and ${L().rep.toLowerCase()}`, cancel: 'Close',
      body: `<div class="list">${ranks.map(r => `<div class="li"><span class="grow ${r === cur ? 'tone-accent' : ''}"><b>${esc(r.name)}</b>${r === cur ? ': current' : ''}</span><span class="dim">${r.at}+</span></div>`).join('')}</div>
        <div class="sep"></div>
        <p class="hint">${esc(L().rep)} moves once a day, when the day closes, from how much of the declared mission you kept: 80% or more: +3. 60%: +1.5. 40%: +0.5. 20%: -1. Under 20%: -3. Nothing declared: -2. Rest days change nothing. Earned slowly, lost quickly: which is why a rank is worth holding.</p>`
    });
  }
});
void clamp;
