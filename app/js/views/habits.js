/* HABITS: streaks and XP made impossible to miss, plus the habit map. */
import { S, save, touch, tombstone } from '../store.js';
import * as E from '../engine.js';
import { registerActions, openModal, closeModal, confirmDialog, ringHtml } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, uid, fmtDate, safeColor, parseYmd, clamp } from '../util.js';
import { ui, refresh } from '../bus.js';

const COLORS = ['#F0A44B', '#F26D63', '#EE5D8C', '#8B7CF6', '#6FB1F0', '#2BC4E0', '#56CFB2', '#5FCB8B', '#E0B25A', '#9AA0A8'];
const WEEKS = 18;
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function scheduleLabel(sch) {
  if (!sch || sch.type === 'daily') return 'Every day';
  if (sch.type === 'interval') return sch.every === 2 ? 'Every other day' : `Every ${sch.every} days`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (sch.days || []).slice().sort().map(d => names[d]).join(' · ') || 'No days set';
}

/** Week-column grid ending this week, Monday on top. `cell(date)` → {cls, style, title, attrs}. */
function heatmap(cell, weeks = WEEKS) {
  const t = today(), dow = (parseYmd(t).getDay() + 6) % 7;            // 0 = Monday
  const start = addDays(t, -(dow + (weeks - 1) * 7));
  let cols = '', months = '', lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    let col = '';
    const first = addDays(start, w * 7), m = parseYmd(first).getMonth();
    months += `<span>${m !== lastMonth ? parseYmd(first).toLocaleDateString(undefined, { month: 'short' }) : ''}</span>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > t) { col += '<i class="hc future"></i>'; continue; }
      const c = cell(date);
      col += `<i class="hc ${c.cls || ''}" ${c.style ? `style="${c.style}"` : ''} title="${esc(fmtDate(date) + ': ' + c.title)}" ${c.attrs || ''}></i>`;
    }
    cols += `<div class="hcol">${col}</div>`;
  }
  return `<div class="heat"><div class="heat-m">${months}</div><div class="heat-g"><div class="heat-d"><span>M</span><span></span><span>W</span><span></span><span>F</span><span></span><span></span></div>${cols}</div></div>`;
}
function overallMap() {
  return heatmap(date => {
    if (E.isRest(date)) return { cls: 'rest', title: 'rest day' };
    const due = E.habitsDue(date);
    if (!due.length) return { cls: 'nd', title: 'nothing due' };
    const done = due.filter(h => h.history[date] === 'done').length, r = done / due.length;
    return { cls: r === 1 ? 'full' : '', style: r > 0 ? `background:color-mix(in srgb, var(--accent) ${Math.round(18 + r * 82)}%, var(--card-3))` : '', title: `${done}/${due.length} done${r === 1 ? ' · clean sweep' : ''}` };
  });
}
function habitMap(h) {
  const t = today();
  return heatmap(date => {
    const v = h.history[date], due = E.isHabitDueOn(h, date);
    const attrs = due ? `data-act="habit.toggle" data-id="${esc(h.id)}" data-date="${date}" role="button"` : '';
    if (v === 'done') return { cls: 'on', style: `background:${safeColor(h.color)}`, title: 'done: click to undo', attrs };
    if (v === 'rest') return { cls: 'rest', title: 'rest day (streak frozen)', attrs };
    if (v === 'missed') return { cls: 'miss', title: 'missed: click to correct', attrs };
    if (!due) return { cls: 'nd', title: 'not due' };
    return { cls: date === t ? 'today' : '', title: date === t ? 'due today' : 'no record', attrs };
  });
}

function habitHtml(h, dueToday) {
  const s = E.habitStats(h), t = today(), diff = E.HABIT_DIFF[h.difficulty] || E.HABIT_DIFF.easy;
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(t, -i), v = h.history[d], due = E.isHabitDueOn(h, d);
    week.push(`<span class="wk ${v === 'done' ? 'on' : v === 'missed' ? 'miss' : v === 'rest' ? 'rest' : !due ? 'nd' : ''} ${i === 0 ? 'now' : ''}" title="${fmtDate(d)}"><i></i><b>${DOW[parseYmd(d).getDay()]}</b></span>`);
  }
  const gained = s.doneToday ? Math.round(diff.gain * s.bonus) : 0;
  const toNext = s.milestone ? s.milestone - s.streak : null;
  const openMap = ui.habOpen.has(h.id);
  return `<article class="hab ${s.doneToday ? 'done' : ''} ${dueToday ? '' : 'off'}" style="--c:${safeColor(h.color)}">
    <button class="check lg ${s.doneToday ? 'on' : ''}" data-act="habit.toggle" data-id="${esc(h.id)}" ${dueToday ? '' : 'disabled title="Not due today"'} aria-pressed="${s.doneToday}" aria-label="${esc(h.name)}">${icon('check')}</button>
    <div class="hab-main">
      <div class="hab-n">${esc(E.label(h))}</div>
      <div class="tiny dim">${esc(scheduleLabel(h.schedule))} · ${diff.label}${dueToday ? '' : ' · not due today'}</div>
      <div class="hab-week">${week.join('')}</div>
    </div>
    <div class="hab-streak ${s.streak >= 7 ? 'hot' : ''} ${s.frozen ? 'frozen' : ''}" title="${s.frozen ? 'Frozen for a rest day' : 'Current streak'}">
      <div class="row" style="gap:4px;justify-content:center">${icon(s.frozen ? 'snow' : 'flame')}<b class="num">${s.streak}</b></div>
      <span>${s.frozen ? 'streak frozen' : 'day streak'}</span>
      <span class="dim">best ${s.longest}${s.bonus > 1 ? ` · ${s.bonus}× XP` : ''}</span>
    </div>
    <div class="hab-xp">
      <div class="row between"><span><b>${s.lv.name}</b> <span class="dim">Lv ${s.lv.level}</span></span>
        <span class="${gained ? 'xp-gain' : 'dim'}">${gained ? `+${gained} XP today` : dueToday ? `+${s.nextGain} XP when done` : ''}</span></div>
      <div class="bar"><i style="width:${s.pct}%;background:var(--c)"></i></div>
      <div class="row between tiny dim"><span><b style="color:var(--text)">${s.xp}</b>${s.next ? ` / ${s.next.min} XP` : ' XP · mastered'}</span>
        <span>${toNext ? `${s.milestone}-day bonus in ${toNext} day${toNext === 1 ? '' : 's'}` : 'all streak bonuses unlocked'}</span></div>
    </div>
    <div class="hab-act">
      <button class="icon-btn sm ${openMap ? 'on' : ''}" data-act="habit.map" data-id="${esc(h.id)}" title="Habit map" aria-expanded="${openMap}" aria-label="Show map">${icon('calendar')}</button>
      <button class="icon-btn sm" data-act="habit.edit" data-id="${esc(h.id)}" title="Edit" aria-label="Edit habit">${icon('edit')}</button>
    </div>
    ${openMap ? `<div class="hab-map">${habitMap(h)}<div class="tiny dim">Click any due day to correct it. ${s.rate !== null ? `${s.rate}% kept overall · ${s.done} done, ${s.missed} missed.` : ''}</div></div>` : ''}
  </article>`;
}

function summaryHtml() {
  const st = S(), t = today(), due = E.habitsDue(t), done = due.filter(h => h.history[t] === 'done').length;
  const sw = E.sweepStatus(), stats = st.habits.map(h => ({ h, s: E.habitStats(h) }));
  const totalXp = stats.reduce((n, x) => n + x.s.xp, 0);
  const todayXp = stats.reduce((n, x) => n + (x.s.doneToday ? Math.round((E.HABIT_DIFF[x.h.difficulty] || E.HABIT_DIFF.easy).gain * x.s.bonus) : 0), 0);
  const best = stats.slice().sort((a, b) => b.s.streak - a.s.streak)[0];
  let dueN = 0, doneN = 0;
  for (let i = 1; i <= 30; i++) { const d = addDays(t, -i); if (E.isRest(d)) continue; const dd = E.habitsDue(d); dueN += dd.length; doneN += dd.filter(h => h.history[d] === 'done').length; }
  const rest = E.isRest(t);
  return `<div class="hab-sum">
    <div class="card stat"><div>${ringHtml(due.length ? done / due.length * 100 : 0, { size: 62, stroke: 7, label: `${done} of ${due.length} habits done` })}</div>
      <div><span class="eyebrow">Today</span><b class="num">${done}<small>/${due.length}</small></b><span>${rest ? 'Rest day, streaks are frozen' : done === due.length && due.length ? 'All done' : `${due.length - done} to go`}</span></div></div>
    <div class="card stat ${sw.done ? 'lit' : ''}"><div class="stat-ico">${icon('flame')}</div>
      <div><span class="eyebrow">Clean-sweep chain</span><b class="num">${sw.chain}<small> day${sw.chain === 1 ? '' : 's'}</small></b>
        <span>${!due.length ? 'no habits due' : sw.done ? `+${sw.bonus} XP earned today` : `Do all ${due.length} today for +${sw.bonus} XP`}</span></div></div>
    <div class="card stat"><div class="stat-ico">${icon('zap')}</div>
      <div><span class="eyebrow">Habit XP</span><b class="num">${totalXp}</b><span>${todayXp ? `+${todayXp} earned today` : 'Nothing earned yet today'}</span></div></div>
    <div class="card stat"><div class="stat-ico">${icon('gauge')}</div>
      <div><span class="eyebrow">Longest live streak</span><b class="num">${best ? best.s.streak : 0}<small> days</small></b><span class="ell">${best && best.s.streak ? esc(best.h.name) : '-'} · 30-day rate ${dueN ? Math.round(doneN / dueN * 100) + '%' : '-'}</span></div></div>
  </div>`;
}

function openHabit(h) {
  const isNew = !h;
  const cur = h || { name: '', emoji: '', difficulty: 'easy', schedule: { type: 'daily' }, color: COLORS[S().habits.length % COLORS.length], startDate: today() };
  let diff = cur.difficulty, sch = JSON.parse(JSON.stringify(cur.schedule || { type: 'daily' })), color = cur.color;
  const body = () => `
    <div class="field"><label>Difficulty</label><div class="seg" data-g="diff">${Object.keys(E.HABIT_DIFF).map(k => `<button type="button" class="${k === diff ? 'on' : ''}" data-v="${k}">${E.HABIT_DIFF[k].label}</button>`).join('')}</div>
      <div class="hint">${E.HABIT_DIFF[diff].label}: +${E.HABIT_DIFF[diff].gain} XP per check-off, -${E.HABIT_DIFF[diff].loss} for a miss. Harder habits take longer to master: about ${E.HABIT_DIFF[diff].days} days at this setting.</div></div>
    <div class="field"><label>Schedule</label><div class="seg" data-g="sch">${[['daily', 'Every day'], ['interval', 'Every N days'], ['weekdays', 'Chosen weekdays']].map(([k, l]) => `<button type="button" class="${k === sch.type ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      ${sch.type === 'interval' ? `<div class="row" style="margin-top:8px"><span>Every</span><input class="input" type="number" min="2" max="60" id="hab-every" value="${sch.every || 2}" style="width:84px"><span>days, counted from the start date</span></div>` : ''}
      ${sch.type === 'weekdays' ? `<div class="seg" data-g="dow" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="${(sch.days || []).includes(d) ? 'on' : ''}" data-v="${d}">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]}</button>`).join('')}</div>` : ''}</div>
    <div class="field"><label>Colour</label><div class="swatches" data-g="color">${COLORS.map(c => `<button type="button" class="swatch sm ${c === color ? 'on' : ''}" style="background:${c}" data-v="${c}" aria-label="${c}"></button>`).join('')}</div></div>`;
  openModal({
    title: isNew ? 'New habit' : 'Edit habit', submit: isNew ? 'Add habit' : 'Save',
    left: isNew ? '' : `<button type="button" class="btn danger" data-act="habit.delete" data-id="${esc(h.id)}">${icon('trash')} Delete</button>`,
    body: `<div class="form-row" style="grid-template-columns:84px 1fr">
        <div class="field"><label>Icon (optional)</label><input class="input" name="emoji" value="${esc(cur.emoji || '')}" maxlength="4" style="text-align:center;font-size:20px"></div>
        <div class="field"><label>Habit</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="60" required autofocus placeholder="e.g. Read 10 pages"></div></div>
      <div id="hab-dyn" class="col" style="gap:14px">${body()}</div>
      <div class="field"><label>Counts from</label><input class="input" type="date" name="startDate" value="${esc(cur.startDate || today())}" max="${today()}"></div>`,
    onMount: el => {
      const dyn = el.querySelector('#hab-dyn');
      dyn.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        const g = b.closest('[data-g]').dataset.g, v = b.dataset.v;
        if (g === 'diff') diff = v;
        if (g === 'color') color = v;
        if (g === 'sch') sch = v === 'interval' ? { type: v, every: sch.every || 2 } : v === 'weekdays' ? { type: v, days: sch.days || [1, 2, 3, 4, 5] } : { type: 'daily' };
        if (g === 'dow') { const d = +v, set = new Set(sch.days || []); set.has(d) ? set.delete(d) : set.add(d); sch.days = [...set]; }
        dyn.innerHTML = body();
      });
      dyn.addEventListener('input', e => { if (e.target.id === 'hab-every') sch.every = clamp(parseInt(e.target.value) || 2, 2, 60); });
    },
    onSubmit: d => {
      const name = d.name.trim(); if (!name) return false;
      const fields = { name, emoji: d.emoji.trim(), difficulty: diff, schedule: sch, color, startDate: d.startDate || today() };
      if (isNew) S().habits.push(touch({ id: uid(), ...fields, history: {} }));
      else { Object.assign(h, fields); touch(h); }
      E.invalidate(); save();
    }
  });
}

export default {
  // the newest weeks are on the right: start there when the map has to scroll
  mount(root) { root.querySelectorAll('.heat').forEach(el => { el.scrollLeft = el.scrollWidth; }); },
  render() {
    const st = S(), t = today();
    const due = st.habits.filter(h => E.isHabitDueOn(h, t)), off = st.habits.filter(h => !E.isHabitDueOn(h, t));
    if (!st.habits.length) return `<div class="view-h"><h2>Habits</h2></div>
      <div class="card empty" style="padding:48px 16px">No habits yet. Start with one or two you can actually keep.<br><button class="btn primary" data-act="habit.new">${icon('plus')} Add a habit</button></div>`;
    return `<div class="view-h"><h2>Habits</h2><button class="btn sm primary" data-act="habit.new">${icon('plus')} Habit</button></div>
      ${summaryHtml()}
      <section class="card" style="margin:var(--gap) 0"><div class="card-h"><span class="eyebrow">Habit map · all habits · last ${WEEKS} weeks</span>
        <span class="heat-legend tiny dim">none <i class="hc"></i><i class="hc" style="background:color-mix(in srgb, var(--accent) 45%, var(--card-3))"></i><i class="hc full" style="background:var(--accent)"></i> all · <i class="hc rest"></i> rest</span></div>
        ${overallMap()}</section>
      <div class="habs">${due.map(h => habitHtml(h, true)).join('')}</div>
      ${off.length ? `<div class="eyebrow" style="margin:22px 0 10px">Not due today</div><div class="habs">${off.map(h => habitHtml(h, false)).join('')}</div>` : ''}`;
  }
};

registerActions({
  'habit.new': () => openHabit(null),
  'habit.edit': d => { const h = S().habits.find(x => x.id === d.id); if (h) openHabit(h); },
  'habit.map': d => { ui.habOpen.has(d.id) ? ui.habOpen.delete(d.id) : ui.habOpen.add(d.id); refresh(); },
  'habit.delete': async d => {
    const st = S(), h = st.habits.find(x => x.id === d.id); if (!h) return;
    if (!(await confirmDialog({ title: `Delete “${h.name}”?`, body: 'Its history, streak and XP go with it.', ok: 'Delete', danger: true }))) return;
    st.habits = st.habits.filter(x => x !== h); tombstone(h.id);
    closeModal(); E.invalidate(); save();
  }
});
