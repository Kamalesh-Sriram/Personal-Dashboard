/* GYM: progress per exercise and what to try next, from your Hevy history
   or an imported file. The numbers are worked out in gymcalc.js. */
import { registerActions, openModal, closeModal, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { esc, fmtDur } from '../util.js';
import { ui, refresh } from '../bus.js';
import { lineChart, sparkLine } from '../charts.js';
import * as Gym from '../gym.js';
import * as G from '../gymcalc.js';
import * as Sync from '../sync.js';

const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtFull = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tonnes = kg => (kg >= 10000 ? (kg / 1000).toFixed(1) + ' t' : Math.round(kg).toLocaleString() + ' kg');
const setText = s => (s.kg > 0 ? `${G.fmtKg(s.kg)} kg × ${s.reps || 0}` : s.reps ? `${s.reps} reps` : s.sec ? `${s.sec}s` : '-');
const ago = ts => { const d = Math.floor((Date.now() - ts) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 70 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`; };

let wired = false, asked = false;
function ensure() {
  if (!wired) { wired = true; Gym.onGym(() => { if (ui.tab === 'gym') refresh(); }); }
  if (!Gym.cached()) { Gym.load().then(() => { if (ui.tab === 'gym') refresh(); }); return false; }
  if (!asked) {
    asked = true;
    // connected: top up quietly when the tab opens, at most every half hour
    Gym.checkConfigured().then(ok => { const d = Gym.cached(); if (ok && d && Date.now() - (d.syncedAt || 0) > 30 * 60000) Gym.syncHevy(); });
  }
  return true;
}

function setupHtml() {
  const s = Gym.status, signed = Sync.signedIn();
  return `<div class="card gym-setup">
      <div class="h3">Bring in your training history</div>
      <p class="muted">Two ways. Either works on its own.</p>
      <div class="gym-ways">
        <div><div class="label">Sync from Hevy</div>
          <p class="hint">Keeps itself up to date. Needs Hevy Pro for the API key.</p>
          ${!signed ? `<p class="hint">Turn on sync first (Settings > Sync): the key is kept on your site, and it only answers when you are signed in.</p><button class="btn sm" data-act="nav.go" data-tab="settings" data-sub="sync">Open sync settings</button>`
            : s.configured ? `<button class="btn primary" data-act="gym.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} ${s.busy ? esc(s.progress || 'Syncing') : 'Sync now'}</button>`
            : `<ol class="hint gym-steps"><li>On hevy.com open Settings > Developer and copy your API key.</li><li>In Netlify open your site > Site configuration > Environment variables and add <b>HEVY_API_KEY</b> with that key.</li><li>Redeploy the site, then come back here.</li></ol>
               <button class="btn sm" data-act="gym.check">${icon('refresh')} Check again</button>`}</div>
        <div><div class="label">Import a file</div>
          <p class="hint">The CSV export from Hevy or Strong. It stays on this device.</p>
          <label class="btn">${icon('upload')} Choose file<input type="file" accept=".csv,text/csv,text/plain" data-change="gym.file" hidden></label></div>
      </div>
      ${s.error ? `<div class="notice bad">${esc(s.error)}</div>` : ''}
    </div>`;
}

function statsHtml(sum) {
  const delta = sum.volPrev ? Math.round((sum.vol30 - sum.volPrev) / sum.volPrev * 100) : null;
  const stat = (ico, label, big, small) => `<div class="card stat"><div class="stat-ico">${icon(ico)}</div><div><span class="eyebrow">${label}</span><b class="num">${big}</b><span>${small}</span></div></div>`;
  return `<div class="hab-sum">
    ${stat('gym', 'This week', `${sum.thisWeek}<small> workout${sum.thisWeek === 1 ? '' : 's'}</small>`, `${sum.count30} in the last 30 days`)}
    ${stat('gauge', 'Volume, 30 days', tonnes(sum.vol30), delta === null ? 'No earlier month to compare' : `${delta >= 0 ? '+' : ''}${delta}% on the 30 days before`)}
    ${stat('zap', 'Records this month', sum.records, sum.records ? 'New estimated maxes' : 'None yet this month')}
    ${stat('flame', 'Weeks in a row', `${sum.weekStreak}<small> week${sum.weekStreak === 1 ? '' : 's'}</small>`, 'With at least one workout')}
  </div>`;
}

function nextHtml(list) {
  if (!list.length) return `<div class="empty">Suggestions appear once an exercise has two sessions in the last few weeks.</div>`;
  return `<div class="list">${list.map(({ e, s }) => {
    const last = e.sessions[e.sessions.length - 1];
    const sets = last.sets.filter(x => (x.kg || 0) >= (last.top.kg || 0) * 0.95).slice(0, 5).map(x => x.reps || 0).join(', ');
    return `<button class="li gym-next" data-act="gym.exercise" data-key="${esc(e.key)}">
      <div class="grow"><div class="row"><b class="ell">${esc(e.name)}</b><span class="pill tiny-pill ${s.kind === 'add' ? 'good' : s.kind === 'deload' ? 'warn' : ''}">${s.kind === 'add' ? 'Add weight' : s.kind === 'deload' ? 'Back off' : s.kind === 'time' ? 'Longer' : 'More reps'}</span></div>
        <div class="gym-tip">${esc(s.text)}</div>
        <div class="tiny dim">Last time, ${ago(last.ts)}: ${last.top.kg > 0 ? `${G.fmtKg(last.top.kg)} kg × ${esc(sets)}` : esc(setText(last.top))}</div></div>
      <div class="gym-spark">${sparkLine(e.sessions.slice(-10).map(x => x.e1rm || x.reps))}</div>
    </button>`; }).join('')}</div>`;
}

function weeksHtml(wk) {
  const max = Math.max(1, ...wk.map(w => w.vol));
  return `<div class="gym-weeks">${wk.map((w, i) => `<div class="gym-week" title="Week of ${fmtDay(w.start)}: ${w.count} workout${w.count === 1 ? '' : 's'}, ${tonnes(w.vol)}">
      <div class="gym-week-bar"><i class="${i === wk.length - 1 ? 'now' : ''}" style="height:${Math.max(w.vol ? 4 : 0, w.vol / max * 100)}%"></i></div>
      <b>${w.count || '·'}</b></div>`).join('')}</div>
    <div class="tiny dim" style="margin-top:8px">Bars are weekly volume. The number is workouts that week.</div>`;
}

function exercisesHtml(all, templates) {
  const q = (ui.gymQuery || '').trim().toLowerCase();
  const rows = all.filter(e => !q || e.name.toLowerCase().includes(q)).sort((a, b) => b.sessions.length - a.sessions.length).slice(0, ui.gymAll ? 400 : 12);
  return `<div class="card-h"><span class="eyebrow">Exercises · ${all.length}</span>
      <input class="input" style="max-width:220px;height:32px" placeholder="Search" value="${esc(ui.gymQuery || '')}" data-input="gym.query" data-fk="gym-q" aria-label="Search exercises"></div>
    <div class="list">${rows.map(e => { const last = e.sessions[e.sessions.length - 1], m = (templates[e.tid] || {}).muscle;
      return `<button class="li gym-ex" data-act="gym.exercise" data-key="${esc(e.key)}">
        <div class="grow"><div class="ell"><b>${esc(e.name)}</b></div><div class="tiny dim">${m ? esc(m.replace(/_/g, ' ')) + ' · ' : ''}${e.sessions.length} session${e.sessions.length === 1 ? '' : 's'} · last ${ago(last.ts)}</div></div>
        <div class="gym-num"><b>${e.best ? G.fmtKg(Math.round(e.best * 2) / 2) + ' kg' : '-'}</b><span class="tiny dim">est. max</span></div>
        <div class="gym-num"><b>${esc(setText(last.top))}</b><span class="tiny dim">last top set</span></div>
      </button>`; }).join('') || '<div class="empty">Nothing matches.</div>'}</div>
    ${!ui.gymAll && !q && all.length > 12 ? `<button class="btn sm ghost" data-act="gym.all" style="margin-top:8px">Show all ${all.length}</button>` : ''}`;
}

function recentHtml(workouts, exs) {
  const prAt = new Map();
  exs.forEach(e => e.prs.forEach(p => { const s = e.sessions.find(x => x.ts === p.ts); if (s) prAt.set(s.wid, (prAt.get(s.wid) || 0) + 1); }));
  return `<div class="list">${workouts.slice(-8).reverse().map(w => `<button class="li gym-ex" data-act="gym.workout" data-id="${esc(w.id)}">
      <div class="grow"><div class="ell"><b>${esc(w.title)}</b>${prAt.get(w.id) ? ` <span class="pill tiny-pill good">${prAt.get(w.id)} record${prAt.get(w.id) === 1 ? '' : 's'}</span>` : ''}</div>
        <div class="tiny dim">${fmtFull(w.start)}${w.end > w.start ? ' · ' + fmtDur(w.end - w.start) : ''}</div></div>
      <div class="gym-num"><b>${G.setsOf(w)}</b><span class="tiny dim">sets</span></div>
      <div class="gym-num"><b>${tonnes(G.volumeOf(w))}</b><span class="tiny dim">volume</span></div>
    </button>`).join('')}</div>`;
}

function openExercise(key) {
  const d = Gym.cached(), e = d && G.exercises(d.workouts).find(x => x.key === key);
  if (!e) return;
  const s = G.suggest(e.sessions), weighted = e.best > 0;
  const pts = e.sessions.map(x => ({ x: x.ts, y: weighted ? x.e1rm : x.reps, t: `${fmtDay(x.ts)}: ${weighted ? G.fmtKg(Math.round(x.e1rm * 2) / 2) + ' kg' : x.reps + ' reps'}` }));
  openModal({
    title: e.name, cancel: 'Close', wide: true,
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
      <p class="hint">The estimated max uses the Epley formula on your best set of the day. The suggestion follows double progression: more reps at the same weight until every set reaches your usual top, then more weight.</p>`
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

export default {
  render() {
    const ready = ensure(), d = Gym.cached(), s = Gym.status;
    if (!ready || !d) return `<div class="view-h"><h2>Gym</h2></div><div class="card empty">Loading your training history.</div>`;
    if (!d.workouts.length) return `<div class="view-h"><h2>Gym</h2></div>${setupHtml()}`;
    const exs = G.exercises(d.workouts), sum = G.summary(d.workouts), hevy = d.source === 'hevy';
    return `<div class="view-h"><h2>Gym</h2>
        <span class="tiny dim">${s.busy ? esc(s.progress || 'Syncing') : hevy && d.syncedAt ? `Synced with Hevy ${ago(d.syncedAt) === 'today' ? 'today at ' + new Date(d.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ago(d.syncedAt)}` : `${sum.total} workouts from a file`}</span>
        ${Sync.signedIn() && s.configured ? `<button class="btn sm ghost" data-act="gym.sync" ${s.busy ? 'disabled' : ''}>${icon('refresh')} Sync</button>` : ''}
        <label class="btn sm ghost">${icon('upload')} Import file<input type="file" accept=".csv,text/csv,text/plain" data-change="gym.file" hidden></label>
        <button class="icon-btn sm" data-act="gym.manage" title="Manage gym data" aria-label="Manage gym data">${icon('settings')}</button></div>
      ${s.error ? `<div class="notice bad" style="margin-bottom:var(--gap)">${esc(s.error)}</div>` : ''}
      ${statsHtml(sum)}
      <div class="gym-grid">
        <section class="card"><div class="card-h"><span class="eyebrow">Next session</span><span class="tiny dim">what to try on your regular lifts</span></div>${nextHtml(G.upNext(d.workouts))}</section>
        <div class="stack">
          <section class="card"><div class="card-h"><span class="eyebrow">Last 12 weeks</span></div>${weeksHtml(G.weeks(d.workouts, 12))}</section>
          <section class="card"><div class="card-h"><span class="eyebrow">Recent workouts</span></div>${recentHtml(d.workouts, exs)}</section>
        </div>
      </div>
      <section class="card" style="margin-top:var(--gap)">${exercisesHtml(exs, d.templates || {})}</section>`;
  }
};

registerActions({
  'gym.sync': () => Gym.syncHevy(),
  'gym.check': async () => { const ok = await Gym.checkConfigured(); toast(ok ? 'Hevy is connected' : 'Not connected yet', ok ? 'Press Sync now to read your history.' : 'HEVY_API_KEY was not found on the site. Add it in Netlify and redeploy.', { kind: ok ? 'good' : '', ms: 7000 }); },
  'gym.file': async (d, e, el) => {
    const file = el.files && el.files[0]; el.value = '';
    try { const n = await Gym.importFile(file); toast(n ? `Added ${n} workout${n === 1 ? '' : 's'}` : 'Nothing new in that file', n ? '' : 'Every workout in it was already here.', { kind: n ? 'good' : '', ms: 5000 }); }
    catch (err) { toast('Could not read that file', err.message, { kind: 'bad', ms: 10000 }); }
  },
  'gym.query': (d, e, el) => { ui.gymQuery = el.value; refresh(); },
  'gym.all': () => { ui.gymAll = true; refresh(); },
  'gym.exercise': d => openExercise(d.key),
  'gym.workout': d => openWorkout(d.id),
  'gym.manage': () => {
    const d = Gym.cached() || { workouts: [] };
    openModal({
      title: 'Gym data', cancel: 'Close',
      body: `<p class="muted">${d.workouts.length} workouts are stored on this device. They are not part of your synced dashboard: with Hevy connected, each device reads them from Hevy.</p>
        <div class="row wrap">${Sync.signedIn() && Gym.status.configured ? `<button type="button" class="btn" data-act="gym.resync">${icon('refresh')} Read everything from Hevy again</button>` : ''}
          <button type="button" class="btn danger" data-act="gym.clear">${icon('trash')} Remove gym data from this device</button></div>`
    });
  },
  'gym.resync': () => { closeModal(); Gym.syncHevy({ full: true }); },
  'gym.clear': async () => {
    if (!(await confirmDialog({ title: 'Remove gym data from this device?', body: 'Nothing is deleted in Hevy. You can sync or import again at any time.', ok: 'Remove', danger: true }))) return;
    closeModal(); await Gym.clearGym();
  }
});
