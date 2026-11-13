/* GOALS: a goal breaks into milestones, a milestone into tasks. Progress
   is counted in the smallest units there are. */
import { S, save, touch, tombstone } from '../store.js';
import { registerActions, openModal, closeModal, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, uid, fmtDate, safeColor, daysBetween } from '../util.js';
import { ui, refresh } from '../bus.js';

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

function goalHtml(g) {
  const u = goalUnits(g), open = ui.goalOpen.has(g.id);
  const dl = g.deadline ? daysBetween(today(), g.deadline) : null;
  const ms = (g.milestones || []).map(m => {
    const mo = ui.goalOpen.has(m.id), ts = m.tasks || [], d = msDone(m);
    return `<div class="ms ${d ? 'done' : ''}">
      <div class="row">
        <button class="check sq ${d ? 'on' : ''}" data-act="goal.msToggle" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-pressed="${d}" aria-label="Toggle milestone">${icon('check')}</button>
        <button class="ms-n grow ell" data-act="goal.open" data-id="${esc(m.id)}" aria-expanded="${mo}">${esc(m.name)}</button>
        <span class="tiny dim">${ts.length ? `${ts.filter(t => t.done).length}/${ts.length}` : ''}</span>
        <button class="icon-btn sm" data-act="goal.msEdit" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-label="Rename milestone">${icon('edit')}</button>
        <button class="icon-btn sm" data-act="goal.msDel" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" aria-label="Delete milestone">${icon('x')}</button>
      </div>
      ${mo ? `<div class="ms-tasks">${ts.map(t => `<div class="row ${t.done ? 'tdone' : ''}">
          <button class="check sq ${t.done ? 'on' : ''}" data-act="goal.taskToggle" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="Toggle task">${icon('check')}</button>
          <span class="grow">${esc(t.name)}</span>
          <button class="icon-btn sm" data-act="goal.toBoard" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" title="Send to the board's Today column" aria-label="Send to board">${icon('board')}</button>
          <button class="icon-btn sm" data-act="goal.taskDel" data-goal="${esc(g.id)}" data-ms="${esc(m.id)}" data-task="${esc(t.id)}" aria-label="Delete task">${icon('x')}</button></div>`).join('')}
        <form class="row" data-addtask data-goal="${esc(g.id)}" data-ms="${esc(m.id)}"><input class="input" name="name" placeholder="Add a task…" maxlength="160" data-fk="t-${esc(m.id)}" aria-label="Add a task"><button class="btn sm" type="submit" aria-label="Add">${icon('plus')}</button></form></div>` : ''}
    </div>`;
  }).join('');
  return `<article class="card goal" style="--c:${safeColor(g.color)}">
    <div class="row">
      <button class="goal-n grow" data-act="goal.open" data-id="${esc(g.id)}" aria-expanded="${open}"><span class="dot" style="background:var(--c)"></span><span class="ell">${esc(g.name)}</span></button>
      ${dl !== null ? `<span class="pill ${dl < 0 ? 'bad' : dl <= 7 ? 'warn' : ''}">${dl < 0 ? Math.abs(dl) + 'd overdue' : dl === 0 ? 'due today' : dl + 'd left'}</span>` : ''}
      <b class="num" style="font-size:20px">${u.pct}%</b>
      <button class="icon-btn sm" data-act="goal.edit" data-id="${esc(g.id)}" aria-label="Edit goal">${icon('edit')}</button>
    </div>
    <div class="bar" style="margin-top:12px"><i style="width:${u.pct}%;background:var(--c)"></i></div>
    <div class="tiny dim" style="margin-top:6px">${u.done} of ${u.tot} done · ${(g.milestones || []).length} milestone${(g.milestones || []).length === 1 ? '' : 's'}${g.deadline ? ' · due ' + fmtDate(g.deadline, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
    ${open ? `<div class="goal-body">${ms || '<div class="empty" style="padding:8px 0">No milestones yet.</div>'}
      <form class="row" data-addms data-goal="${esc(g.id)}"><input class="input" name="name" placeholder="Add a milestone…" maxlength="120" data-fk="m-${esc(g.id)}" aria-label="Add a milestone"><button class="btn sm" type="submit">${icon('plus')} Milestone</button></form></div>` : ''}
  </article>`;
}

function openGoal(g) {
  const cur = g || { name: '', deadline: '', color: COLORS[S().goals.length % COLORS.length] };
  let color = cur.color;
  openModal({
    title: g ? 'Edit goal' : 'New goal', submit: g ? 'Save' : 'Add goal',
    left: g ? `<button type="button" class="btn danger" data-act="goal.delete" data-id="${esc(g.id)}">${icon('trash')} Delete</button>` : '',
    body: `<div class="field"><label>Goal</label><input class="input" name="name" value="${esc(cur.name)}" maxlength="120" required autofocus></div>
      <div class="field"><label>Deadline (optional)</label><input class="input" type="date" name="deadline" value="${esc(cur.deadline || '')}"></div>
      <div class="field"><label>Colour</label><div class="swatches" id="g-c">${COLORS.map(c => `<button type="button" class="swatch sm ${c === color ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div></div>`,
    onMount: el => el.querySelector('#g-c').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; el.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); }),
    onSubmit: d => {
      const name = d.name.trim(); if (!name) return false;
      if (g) { Object.assign(g, { name, deadline: d.deadline || null, color }); touch(g); }
      else { const n = touch({ id: uid(), name, deadline: d.deadline || null, color, milestones: [] }); S().goals.push(n); ui.goalOpen.add(n.id); }
      save();
    }
  });
}

export default {
  render() {
    const goals = S().goals;
    return `<div class="view-h"><h2>Goals</h2><button class="btn sm primary" data-act="goal.new">${icon('plus')} Goal</button></div>
      ${goals.length ? `<div class="goals">${goals.map(goalHtml).join('')}</div>`
        : `<div class="card empty" style="padding:48px 16px">No goals yet. A goal here is something with an end: break it into milestones and tasks, and send tasks to the board when it is time.<br><button class="btn primary" data-act="goal.new">${icon('plus')} Add a goal</button></div>`}`;
  },
  mount(root) {
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
  }
};

registerActions({
  'goal.new': () => openGoal(null),
  'goal.edit': d => { const g = S().goals.find(x => x.id === d.id); if (g) openGoal(g); },
  'goal.open': d => { ui.goalOpen.has(d.id) ? ui.goalOpen.delete(d.id) : ui.goalOpen.add(d.id); refresh(); },
  'goal.delete': async d => {
    const st = S(), g = st.goals.find(x => x.id === d.id); if (!g) return;
    if (!(await confirmDialog({ title: `Delete “${g.name}”?`, body: 'Its milestones and tasks go with it.', ok: 'Delete', danger: true }))) return;
    st.goals = st.goals.filter(x => x !== g); tombstone(g.id); closeModal(); save();
  },
  'goal.msToggle': d => {
    const { g, m } = find(d); if (!m) return;
    const ts = m.tasks || [];
    if (ts.length) { const all = ts.every(t => t.done); ts.forEach(t => { t.done = !all; }); m.done = !all; } else m.done = !m.done;
    commit(g);
  },
  'goal.msEdit': d => {
    const { g, m } = find(d); if (!m) return;
    openModal({ title: 'Rename milestone', body: `<div class="field"><label>Milestone</label><input class="input" name="name" value="${esc(m.name)}" maxlength="120" required autofocus></div>`,
      onSubmit: f => { if (!f.name.trim()) return false; m.name = f.name.trim(); commit(g); } });
  },
  'goal.msDel': async d => {
    const { g, m } = find(d); if (!m) return;
    if ((m.tasks || []).length && !(await confirmDialog({ title: `Delete “${m.name}”?`, body: 'Its tasks go with it.', ok: 'Delete', danger: true }))) return;
    g.milestones = g.milestones.filter(x => x !== m); commit(g);
  },
  'goal.taskToggle': d => { const { g, m, t } = find(d); if (!t) return; t.done = !t.done; m.done = m.tasks.every(x => x.done); commit(g); },
  'goal.taskDel': d => { const { g, m, t } = find(d); if (!t) return; m.tasks = m.tasks.filter(x => x !== t); commit(g); },
  'goal.toBoard': d => {
    const { g, t } = find(d); if (!t) return;
    S().cards.today.push(touch({ id: uid(), text: t.name, tagId: null, subs: [], notes: `From goal: ${g.name}` }));
    save();
    toast('Added to Today', t.name, { kind: 'good', ms: 3500 });
  }
});
