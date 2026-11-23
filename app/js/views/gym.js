/* GYM: what to do next, and how each lift is going, from your training
   history (Hevy sync, or a file from Hevy, Strong or openGym). The numbers
   are worked out in gymcalc.js. */
import { S, save } from '../store.js';
import { registerActions, openModal, closeModal, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmtDur } from '../util.js';
import { ui, refresh } from '../bus.js';
import { lineChart, sparkLine } from '../charts.js';
import * as Gym from '../gym.js';
import * as G from '../gymcalc.js';
import * as Sync from '../sync.js';

const FILES = '.csv,.json,text/csv,text/plain,application/json';
const cfg = () => S().gym;
const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtFull = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tonnes = kg => (kg >= 10000 ? (kg / 1000).toFixed(1) + ' t' : Math.round(kg).toLocaleString() + ' kg');
const setText = s => (s.kg > 0 ? `${G.fmtKg(s.kg)} kg × ${s.reps || 0}` : s.reps ? `${s.reps} reps` : s.sec ? `${s.sec}s` : '-');
const ago = ts => { const d = Math.floor((Date.now() - ts) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 70 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`; };
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const kindPill = k => `<span class="pill tiny-pill ${k === 'add' ? 'good' : k === 'deload' ? 'warn' : ''}">${k === 'add' ? 'Add weight' : k === 'deload' ? 'Back off' : k === 'time' ? 'Longer' : k === 'same' ? 'Repeat' : 'More reps'}</span>`;

let wired = false, asked = false;
function ensure() {
  if (!wired) { wired = true; Gym.onGym(() => { if (ui.tab === 'gym') refresh(); }); }
  if (!Gym.cached()) { Gym.load().then(() => { if (ui.tab === 'gym') refresh(); }); return false; }
  if (!asked) {
    asked = true;
    // connected: top up quietly when the tab opens, at most every half hour
    Gym.checkConfigured().then(ok => { const d = Gym.cached(); if (ok && d && Date.now() - (d.syncedAt || 0) > 30 * 60000) Gym.syncAll(); });
    Gym.resolveNames();
  }
  return true;
}

function setupHtml() {
  const s = Gym.status, signed = Sync.signedIn();
  return `<div class="card gym-setup">
      <div class="h3">Bring in your training history</div>
      <p class="muted">Two ways. Either works on its own.</p>
      <div class="gym-ways">
        <div><div class="label">Import a file</div>
          <p class="hint">A backup from openGym (Settings > Data & backup > Export backup), or the CSV export from Hevy or Strong. It is read on this device and stays here. Import a newer one any time.</p>
          <label class="btn primary">${icon('upload')} Choose file<input type="file" accept="${FILES}" data-change="gym.file" hidden></label></div>
        <div><div class="label">Sync by itself</div>
          <p class="hint">From Hevy (needs Hevy Pro for its API key), from an openGym server you run yourself, or from openGym backups in a bucket or a WebDAV folder. Each keeps the tab up to date without importing files.</p>
          ${!signed ? `<p class="hint">Turn on sync first (Settings > Sync): the keys are kept on your site, and it only answers when you are signed in.</p><button class="btn sm" data-act="nav.go" data-tab="settings" data-sub="sync">Open sync settings</button>`
            : s.configured || s.opengym ? `<button class="btn" data-act="gym.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} ${s.busy ? esc(s.progress || 'Syncing') : `Sync from ${s.configured ? 'Hevy' : 'openGym'}`}</button>`
            : `<p class="hint">Add <b>HEVY_API_KEY</b>, or <b>OPENGYM_URL</b> and <b>OPENGYM_TOKEN</b>, or the <b>OPENGYM_S3_</b> or <b>OPENGYM_DAV_</b> settings for openGym backups, to your site's environment variables in Netlify and redeploy. The steps for each are in HOW-TO-USE.md.</p>
               <button class="btn sm" data-act="gym.check">${icon('refresh')} Check again</button>`}</div>
      </div>
      ${s.error ? `<div class="notice bad">${esc(s.error)}</div>` : ''}
    </div>`;
}

const goal = () => Math.max(1, Math.min(14, Number(cfg().weekGoal) || 3));
function statsHtml(sum, workouts) {
  const ww = G.weeksWon(workouts, goal());
  const delta = sum.volPrev ? Math.round((sum.vol30 - sum.volPrev) / sum.volPrev * 100) : null;
  const stat = (label, big, small) => `<div><b class="num">${big}</b><span class="eyebrow">${label}</span><i>${small}</i></div>`;
  return `<div class="gym-stats">
    ${stat('This week', `${sum.thisWeek}`, `workout${sum.thisWeek === 1 ? '' : 's'}, ${sum.count30} in 30 days`)}
    ${stat('Volume, 30 days', tonnes(sum.vol30), delta === null ? 'no earlier month yet' : `${delta >= 0 ? '+' : ''}${delta}% on the month before`)}
    ${stat('Records this month', sum.records, sum.records ? 'new estimated maxes' : 'none yet')}
    ${stat('Weeks won', ww.won, `${goal()} or more workouts`)}
  </div>`;
}

/* ── the coach: your next session, exercise by exercise ── */
/** What to do, as (sets) x (reps) | (weight). */
function target(it) {
  if (it.kind === 'time' || (!it.kg && !it.reps && it.sec)) return `${it.sets} x ${it.sec || it.last.sec || 0}s`;
  return it.kg > 0 ? `${it.sets} x ${it.reps} | ${G.fmtKg(it.kg)} kg` : `${it.sets} x ${it.reps}`;
}
function coachHtml(workouts) {
  const split = cfg().split.length ? cfg().split : G.guessSplit(workouts), mine = cfg().split.length > 0;
  // a session you picked holds until a newer workout is logged, then the cycle takes over again
  const latest = workouts.reduce((m, w) => Math.max(m, w.start), 0), p = cfg().pick;
  const pick = p && p.after >= latest && split[p.slot] && split[p.slot] === p.title ? p.slot : null;
  const n = G.nextWorkout(workouts, split, pick);
  const head = (right = '') => `<div class="card-h"><span class="eyebrow">Next workout</span>${right}
      <button class="btn sm ghost" data-act="gym.split">${icon('edit')} ${mine ? 'Edit split' : 'Set your split'}</button></div>`;
  if (!n || !n.title) return `${head()}<div class="empty">Tell the dashboard your split and it will line up your next session from the last time you did it.</div>`;
  return `${head(`<span class="tiny dim">${n.slot + 1} of ${n.of} in your split</span>`)}
    <div class="coach-h"><b class="coach-t">${esc(n.title)}</b>
      <span class="muted">${n.lastDone ? `last done ${ago(n.lastDone)}` : 'not done before'}</span></div>
    <div class="coach-split" role="group" aria-label="Choose the session">${split.map((t, i) => `<button class="${i === n.slot ? 'on' : ''} ${i === n.due && n.due !== n.slot ? 'due' : ''}" data-act="gym.pick" data-i="${i}" aria-pressed="${i === n.slot}" title="${i === n.due ? 'Up next in your split' : ''}">${esc(t)}</button>`).join('')}</div>
    ${n.items.length ? `<div class="list coach-list">${n.items.map(it => `<button class="li coach-row" data-act="gym.exercise" data-key="${esc(it.key)}" ${it.key ? '' : 'disabled'}>
        <div class="grow"><div class="row"><b class="ell">${esc(it.name)}</b>${kindPill(it.kind)}</div></div>
        <div class="coach-do">${esc(target(it))}</div></button>`).join('')}</div>
`
      : `<div class="empty">No earlier workout called "${esc(n.title)}" was found, so there is nothing to build it from. Check the names in your split.</div>`}`;
}

/* ── the lifts you care about ── */
function liftsHtml(workouts, exs) {
  const focus = cfg().focus || [], byKey = new Map(exs.map(e => [e.key, e]));
  const list = focus.length ? focus.map(k => byKey.get(k)).filter(Boolean).map(e => ({ e, s: G.suggest(e.sessions) })) : G.upNext(workouts);
  const head = `<div class="card-h"><span class="eyebrow">${focus.length ? 'Your lifts' : 'Your regular lifts'}</span>
      <button class="btn sm ghost" data-act="gym.focus">${icon('edit')} Choose lifts</button></div>`;
  if (!list.length) return `${head}<div class="empty">${focus.length ? 'None of the lifts you chose are in your history yet.' : 'Pick the lifts that matter most to you, or log an exercise twice and it shows up here.'}</div>`;
  return `${head}<div class="list">${list.map(({ e, s }) => {
    const last = e.sessions[e.sessions.length - 1];
    const sets = last.sets.filter(x => (x.kg || 0) >= (last.top.kg || 0) * 0.95).slice(0, 5).map(x => x.reps || 0).join(', ');
    return `<button class="li gym-next" data-act="gym.exercise" data-key="${esc(e.key)}">
      <div class="grow"><div class="row"><b class="ell">${esc(e.name)}</b>${s ? kindPill(s.kind) : ''}</div>
        ${s ? `<div class="gym-tip">${esc(s.text)}</div>` : ''}
        <div class="tiny dim">${cap(ago(last.ts))}: ${last.top.kg > 0 ? `${G.fmtKg(last.top.kg)} kg × ${esc(sets)}` : esc(setText(last.top))}${e.best ? ` · best est. max ${G.fmtKg(Math.round(e.best * 2) / 2)} kg` : ''}</div></div>
      <div class="gym-spark">${sparkLine(e.sessions.slice(-10).map(x => x.e1rm || x.reps))}</div>
    </button>`; }).join('')}</div>
`;
}

/** Workouts per week, against the goal: the bar's height is the number of
 *  workouts, so weeks with the same count stand level, and the goal is a
 *  line across them. Volume is in each bar's tooltip. */
function weeksHtml(wk) {
  const g = goal(), top = Math.max(g, ...wk.map(w => w.count)) * 1.2, pct = v => (v / top * 100).toFixed(2);
  const tone = (w, i) => (w.count >= g ? 'won' : i === wk.length - 1 ? 'now' : 'lost');
  return `<div class="gym-weeks" style="--goal:${pct(g)}%">${wk.map((w, i) => `<div class="gym-week" title="Week of ${fmtDay(w.start)}: ${w.count} workout${w.count === 1 ? '' : 's'}, ${tonnes(w.vol)}${w.count >= g ? ', goal met' : i === wk.length - 1 ? ', under way' : ', below your goal'}">
      <div class="gym-week-bar"><i class="${tone(w, i)}" style="height:${pct(w.count)}%"></i><u class="gym-goal-line" aria-hidden="true"></u></div>
      <b>${w.count || '·'}</b></div>`).join('')}</div>`;
}

function exercisesHtml(all, templates) {
  const q = (ui.gymQuery || '').trim().toLowerCase(), focus = new Set(cfg().focus || []);
  const rows = all.filter(e => !q || e.name.toLowerCase().includes(q)).sort((a, b) => b.sessions.length - a.sessions.length).slice(0, ui.gymAll || q ? 400 : 12);
  return `<div class="row" style="margin:4px 0 8px"><input class="input" style="max-width:320px;height:34px" placeholder="Search your exercises" value="${esc(ui.gymQuery || '')}" data-input="gym.query" data-fk="gym-q" aria-label="Search your exercises"></div>
    <div class="list">${rows.map(e => { const last = e.sessions[e.sessions.length - 1], m = (templates[e.tid] || {}).muscle, on = focus.has(e.key);
      return `<div class="li gym-ex-row"><button class="gym-ex grow" data-act="gym.exercise" data-key="${esc(e.key)}">
          <div class="grow"><div class="ell"><b>${esc(e.name)}</b></div><div class="tiny dim">${m ? esc(m.replace(/_/g, ' ')) + ' · ' : ''}${e.sessions.length} session${e.sessions.length === 1 ? '' : 's'} · last ${ago(last.ts)}</div></div>
          <div class="gym-num"><b>${e.best ? G.fmtKg(Math.round(e.best * 2) / 2) + ' kg' : '-'}</b><span class="tiny dim">est. max</span></div>
          <div class="gym-num"><b>${esc(setText(last.top))}</b><span class="tiny dim">last top set</span></div></button>
        <button class="icon-btn sm ${on ? 'on' : ''}" data-act="gym.pin" data-key="${esc(e.key)}" title="${on ? 'Remove from your lifts' : 'Add to your lifts'}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} your lifts">${icon(on ? 'check' : 'plus')}</button></div>`; }).join('') || '<div class="empty">Nothing matches.</div>'}</div>
    ${!ui.gymAll && !q && all.length > 12 ? `<button class="btn sm ghost" data-act="gym.all" style="margin-top:8px">Show all ${all.length}</button>` : ''}`;
}

function recentHtml(workouts, exs, count = 6) {
  const prAt = new Map();
  exs.forEach(e => e.prs.forEach(p => { const s = e.sessions.find(x => x.ts === p.ts); if (s) prAt.set(s.wid, (prAt.get(s.wid) || 0) + 1); }));
  return `<div class="list">${workouts.slice(-count).reverse().map(w => `<button class="li gym-ex" data-act="gym.workout" data-id="${esc(w.id)}">
      <div class="grow"><div class="ell"><b>${esc(w.title)}</b>${prAt.get(w.id) ? ` <span class="pill tiny-pill good">${prAt.get(w.id)} record${prAt.get(w.id) === 1 ? '' : 's'}</span>` : ''}</div>
        <div class="tiny dim">${fmtFull(w.start)}${w.end > w.start ? ' · ' + fmtDur(w.end - w.start) : ''}</div></div>
      <div class="gym-num"><b>${G.setsOf(w)}</b><span class="tiny dim">sets</span></div>
      <div class="gym-num"><b>${tonnes(G.volumeOf(w))}</b><span class="tiny dim">volume</span></div>
    </button>`).join('')}</div>`;
}

/* ── dialogs ── */
function openExercise(key) {
  const d = Gym.cached(), e = d && G.exercises(d.workouts).find(x => x.key === key);
  if (!e) return;
  const s = G.suggest(e.sessions), weighted = e.best > 0, on = (cfg().focus || []).includes(e.key);
  const pts = e.sessions.map(x => ({ x: x.ts, y: weighted ? x.e1rm : x.reps, t: `${fmtDay(x.ts)}: ${weighted ? G.fmtKg(Math.round(x.e1rm * 2) / 2) + ' kg' : x.reps + ' reps'}` }));
  openModal({
    title: e.name, cancel: 'Close', wide: true,
    left: `<button type="button" class="btn" data-act="gym.pin" data-key="${esc(e.key)}" data-close="1">${icon(on ? 'x' : 'plus')} ${on ? 'Remove from your lifts' : 'Add to your lifts'}</button>`,
    body: `${s ? `<div class="notice ${s.kind === 'add' ? 'good' : s.kind === 'deload' ? 'warn' : ''}">${icon('zap')} <span><b>Next time.</b> ${esc(s.text)}</span></div>` : ''}
      <div class="telemetry">
        <div><span>${weighted ? 'Best estimated max' : 'Sessions'}</span><b>${weighted ? G.fmtKg(Math.round(e.best * 2) / 2) + ' kg' : e.sessions.length}</b>${weighted ? `<i>${fmtDay(e.bestAt)}</i>` : ''}</div>
        <div><span>Sessions</span><b>${e.sessions.length}</b><i>since ${fmtDay(e.sessions[0].ts)}</i></div>
        <div><span>Records</span><b>${e.prs.length}</b>${e.prs.length ? `<i>last ${fmtDay(e.prs[e.prs.length - 1].ts)}</i>` : ''}</div>
      </div>
      <div><div class="label" style="margin-bottom:6px">${weighted ? 'Estimated one-rep max' : 'Reps per session'}</div>${lineChart(pts)}</div>
      <div><div class="label" style="margin-bottom:6px">Last sessions</div>
        <div class="list">${e.sessions.slice(-6).reverse().map(x => `<div class="li"><span style="width:92px" class="dim">${fmtDay(x.ts)}</span>
          <span class="grow">${x.sets.map(setText).map(esc).join('<span class="dim"> · </span>')}</span>${weighted ? `<b>${G.fmtKg(Math.round(x.e1rm * 2) / 2)}</b>` : ''}</div>`).join('')}</div></div>
      <p class="hint">The estimated max uses the Epley formula on your best set of the day. The suggestion follows double progression: more reps at the same weight until every set reaches the top of your rep range, then more weight.</p>`
  });
}
function openWorkout(id) {
  const d = Gym.cached(), w = d && d.workouts.find(x => x.id === id);
  if (!w) return;
  openModal({
    title: w.title, cancel: 'Close', wide: true,
    body: `<div class="tiny dim">${fmtFull(w.start)}${w.end > w.start ? ' · ' + fmtDur(w.end - w.start) : ''} · ${G.setsOf(w)} sets · ${tonnes(G.volumeOf(w))}</div>
      <div class="list">${w.ex.map(x => `<div class="li" style="align-items:flex-start"><b style="width:38%;min-width:120px">${esc(x.name)}</b>
        <span class="grow muted">${x.sets.map(s => (s.t === 'warmup' ? '<span class="dim">w </span>' : '') + esc(setText(s))).join('<span class="dim"> · </span>')}</span></div>`).join('')}</div>`
  });
}
/** Your split, in order: each line is the name you give that workout in your gym app. */
function openSplit() {
  const d = Gym.cached(), titles = [];
  [...((d && d.workouts) || [])].reverse().forEach(w => { if (!titles.some(t => t.toLowerCase() === w.title.toLowerCase())) titles.push(w.title); });
  let rows = (cfg().split.length ? cfg().split : G.guessSplit((d && d.workouts) || [])).slice();
  if (!rows.length) rows = [''];
  const html = () => rows.map((t, i) => `<div class="row"><span class="dim" style="width:18px">${i + 1}</span>
      <input class="input" value="${esc(t)}" list="gym-titles" data-i="${i}" maxlength="60" placeholder="Workout name, for example Upper" aria-label="Session ${i + 1}">
      <button type="button" class="icon-btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
      <button type="button" class="icon-btn sm" data-down="${i}" ${i === rows.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
      <button type="button" class="icon-btn sm" data-del="${i}" ${rows.length <= 1 ? 'disabled' : ''} aria-label="Remove">${icon('x')}</button></div>`).join('');
  openModal({
    title: 'Your split', submit: 'Save split',
    body: `<p class="muted">List your sessions in the order you do them, one cycle long. Use the names your workouts have in your gym app, so the dashboard can recognise them. The same name can appear more than once: upper, lower, upper, lower, arms is five lines.</p>
      <div id="sp-rows" class="col" style="gap:8px">${html()}</div>
      <datalist id="gym-titles">${titles.slice(0, 40).map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      <button type="button" class="btn sm" id="sp-add" style="align-self:flex-start">${icon('plus')} Add a session</button>
      <div class="hint">Names seen in your history: ${titles.slice(0, 12).map(esc).join(', ') || 'none yet'}.</div>`,
    onMount: el => {
      const box = el.querySelector('#sp-rows');
      box.addEventListener('input', e => { const t = e.target.closest('[data-i]'); if (t) rows[+t.dataset.i] = t.value; });
      box.addEventListener('click', e => {
        const u = e.target.closest('[data-up]'), dn = e.target.closest('[data-down]'), dl = e.target.closest('[data-del]');
        if (u) { const i = +u.dataset.up; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; }
        if (dn) { const i = +dn.dataset.down; [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; }
        if (dl) rows.splice(+dl.dataset.del, 1);
        if (u || dn || dl) box.innerHTML = html();
      });
      el.querySelector('#sp-add').addEventListener('click', () => { rows.push(''); box.innerHTML = html(); const all = box.querySelectorAll('input'); all[all.length - 1].focus(); });
    },
    onSubmit: () => { S().gym.split = rows.map(t => t.trim()).filter(Boolean).slice(0, 14); save(); }
  });
}
/** Pick the lifts shown under "Your lifts". */
function openFocus() {
  const d = Gym.cached(), exs = G.exercises((d && d.workouts) || []).sort((a, b) => b.sessions.length - a.sessions.length);
  const chosen = new Set(cfg().focus || []);
  const html = q => exs.filter(e => !q || e.name.toLowerCase().includes(q)).slice(0, 200).map(e => `<label class="li" style="padding:8px 0;cursor:pointer"><input type="checkbox" data-key="${esc(e.key)}" ${chosen.has(e.key) ? 'checked' : ''}>
      <span class="grow ell">${esc(e.name)}</span><span class="tiny dim">${e.sessions.length} session${e.sessions.length === 1 ? '' : 's'}</span></label>`).join('') || '<div class="empty">Nothing matches.</div>';
  openModal({
    title: 'Choose your lifts', submit: 'Save',
    body: `<p class="muted">Tick the exercises you want to follow. They are listed with what to aim for next time. Leave everything unticked and the dashboard picks your most frequent ones.</p>
      <input class="input" id="fo-q" placeholder="Search your exercises" aria-label="Search your exercises" autofocus>
      <div id="fo-list" class="list" style="max-height:46vh;overflow:auto">${html('')}</div>`,
    onMount: el => {
      const box = el.querySelector('#fo-list');
      el.querySelector('#fo-q').addEventListener('input', e => { box.innerHTML = html(e.target.value.trim().toLowerCase()); });
      box.addEventListener('change', e => { const c = e.target.closest('[data-key]'); if (c) { c.checked ? chosen.add(c.dataset.key) : chosen.delete(c.dataset.key); } });
    },
    onSubmit: () => { const keep = (cfg().focus || []).filter(k => chosen.has(k)); S().gym.focus = [...keep, ...[...chosen].filter(k => !keep.includes(k))].slice(0, 30); save(); }
  });
}

export default {
  render() {
    const ready = ensure(), d = Gym.cached(), s = Gym.status;
    if (!ready || !d) return `<div class="view-h"><h2>Gym</h2></div><div class="card empty">Loading your training history.</div>`;
    if (!d.workouts.length) return `<div class="view-h"><h2>Gym</h2></div>${setupHtml()}`;
    const exs = G.exercises(d.workouts), sum = G.summary(d.workouts), hevy = d.source === 'hevy', og = d.source === 'opengym' && d.syncedAt && d.ogRev != null;
    return `<div class="view-h"><h2>Gym</h2>
        <span class="tiny dim">${s.busy ? esc(s.progress || 'Syncing') : (hevy || og) && d.syncedAt ? `Synced with ${hevy ? 'Hevy' : 'openGym'} ${ago(d.syncedAt) === 'today' ? 'today at ' + new Date(d.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ago(d.syncedAt)}` : `${sum.total} workouts, latest ${ago(d.workouts[d.workouts.length - 1].start)}`}</span>
        ${Sync.signedIn() && (s.configured || s.opengym) ? `<button class="btn sm ghost" data-act="gym.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} Sync</button>` : ''}
        <label class="btn sm ghost">${icon('upload')} Import file<input type="file" accept="${FILES}" data-change="gym.file" hidden></label>
        <button class="icon-btn sm" data-act="gym.manage" title="Manage gym data" aria-label="Manage gym data">${icon('settings')}</button></div>
      ${s.error ? `<div class="notice bad" style="margin-bottom:var(--gap)">${esc(s.error)}</div>` : ''}
      <section class="card gym-weeks-card"><div class="card-h"><span class="eyebrow">Last 12 weeks</span>
          <span class="gym-goal" role="group" aria-label="Workouts a week goal"><span class="tiny dim">Goal</span><button class="icon-btn sm" data-act="gym.goal" data-d="-1" aria-label="Lower the goal" ${goal() <= 1 ? 'disabled' : ''}>−</button><b class="num">${goal()}</b><button class="icon-btn sm" data-act="gym.goal" data-d="1" aria-label="Raise the goal" ${goal() >= 14 ? 'disabled' : ''}>+</button><span class="tiny dim">a week</span></span></div>
        <div class="gym-weeks-in">${weeksHtml(G.weeks(d.workouts, 12))}</div>${statsHtml(sum, d.workouts)}</section>
      <section class="card" style="margin-top:var(--gap)">${coachHtml(d.workouts)}</section>
      <div class="gym-grid">
        <section class="card">${liftsHtml(d.workouts, exs)}</section>
        <section class="card"><div class="card-h"><span class="eyebrow">Recent workouts</span></div>${recentHtml(d.workouts, exs, recentCount(d.workouts, exs))}</section>
      </div>
      <details class="card fold" data-fold="gymEx" ${ui.gymExOpen || ui.gymQuery ? 'open' : ''} style="margin-top:var(--gap)">
        <summary><span class="eyebrow">All exercises · ${exs.length}</span><span class="tiny dim">search, charts and records for anything you have logged</span>${icon('down')}</summary>
        ${ui.gymExOpen || ui.gymQuery ? exercisesHtml(exs, d.templates || {}) : ''}
      </details>`;
  },
  mount(root) {
    // remember whether the exercise list is open, and fill it in when it opens
    root.querySelectorAll('details[data-fold]').forEach(el => el.addEventListener('toggle', () => { const open = el.open; if (ui.gymExOpen !== open) { ui.gymExOpen = open; if (!open) ui.gymQuery = ''; refresh(); } }));
  }
};
/** As many recent workouts as it takes to stand level with the lifts beside them. */
function recentCount(workouts, exs) {
  const focus = (cfg().focus || []).filter(k => exs.some(e => e.key === k)).length;
  const lifts = focus || G.upNext(workouts).length;
  return Math.max(3, Math.min(10, Math.round(lifts * 1.42)));
}

registerActions({
  'gym.pick': d => {
    const d0 = Gym.cached(), ws = (d0 && d0.workouts) || [], g = cfg();
    const split = g.split.length ? g.split : G.guessSplit(ws), i = +d.i;
    const due = (G.nextWorkout(ws, split) || {}).slot;
    g.pick = i === due ? null : { slot: i, title: split[i], after: ws.reduce((m, w) => Math.max(m, w.start), 0) };
    save();
  },
  'gym.goal': d => { const g = cfg(); g.weekGoal = Math.max(1, Math.min(14, goal() + +d.d)); save(); },
  'gym.sync': () => Gym.syncAll(),
  'gym.check': async () => { const ok = await Gym.checkConfigured(); toast(ok ? 'Connected' : 'Not connected yet', ok ? 'Press Sync to read your history.' : 'No Hevy key, openGym server, or openGym backup bucket or WebDAV folder was found on the site. Add the settings in Netlify and redeploy.', { kind: ok ? 'good' : '', ms: 8000 }); },
  'gym.file': async (d, e, el) => {
    const file = el.files && el.files[0]; el.value = '';
    try { const r = await Gym.importFile(file); toast(r.added ? `Added ${r.added} workout${r.added === 1 ? '' : 's'}` : 'Nothing new in that file', r.added ? `Read as ${r.source}.` : 'Every workout in it was already here.', { kind: r.added ? 'good' : '', ms: 5000 }); }
    catch (err) { toast('Could not read that file', err.message, { kind: 'bad', ms: 10000 }); }
  },
  'gym.query': (d, e, el) => { ui.gymQuery = el.value; refresh(); },
  'gym.all': () => { ui.gymAll = true; refresh(); },
  'gym.exercise': d => openExercise(d.key),
  'gym.workout': d => openWorkout(d.id),
  'gym.split': () => openSplit(),
  'gym.focus': () => openFocus(),
  'gym.pin': d => {
    const g = S().gym, has = (g.focus || []).includes(d.key);
    g.focus = has ? g.focus.filter(k => k !== d.key) : [...(g.focus || []), d.key].slice(0, 30);
    if (d.close) closeModal();
    save();
  },
  'gym.manage': () => {
    const d = Gym.cached() || { workouts: [] };
    openModal({
      title: 'Gym data', cancel: 'Close',
      body: `<p class="muted">${d.workouts.length} workouts are stored on this device. They are not part of your synced dashboard, but a backup (Settings > Data) carries them. Your split and the lifts you chose do sync.</p>
        <div class="row wrap">${Sync.signedIn() && (Gym.status.configured || Gym.status.opengym) ? `<button type="button" class="btn" data-act="gym.resync">${icon('refresh')} Read everything again</button>` : ''}
          <button type="button" class="btn danger" data-act="gym.clear">${icon('trash')} Remove gym data from this device</button></div>`
    });
  },
  'gym.resync': () => { closeModal(); Gym.syncAll({ full: true }); },
  'gym.clear': async () => {
    if (!(await confirmDialog({ title: 'Remove gym data from this device?', body: 'Nothing is deleted in your gym app. You can sync or import again at any time.', ok: 'Remove', danger: true }))) return;
    closeModal(); await Gym.clearGym();
  }
});
