/* REVIEW: the week in numbers, the journal, and the long record. */
import { S, save } from '../store.js';
import * as E from '../engine.js';
import { registerActions, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, parseYmd, fmtDate, fmtMins, avg, clamp } from '../util.js';
import { ui, refresh } from '../bus.js';
import { L } from '../flows.js';

/** ISO week key, e.g. 2026-W46: ratings are kept per week. */
function weekKey(date = today()) {
  const d = parseYmd(date), day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const first = new Date(d.getFullYear(), 0, 4);
  const wk = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

function weekStats() {
  const st = S(), g = st.game, t = today(), days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
  let focus = 0, tasks = 0, due = 0, done = 0, w = 0, l = 0, rest = 0;
  const ex = [], sleep = [], eff = [], tt = [];
  days.forEach(d => {
    focus += E.focusMsOn(d); tasks += E.tasksDoneOn(d);
    if (E.isRest(d)) { rest++; return; }
    const dd = E.habitsDue(d); due += dd.length; done += dd.filter(h => h.history[d] === 'done').length;
    const s = g.days[d];
    if (s) { if (s.v === 'W') w++; else if (s.v === 'L') l++; if (s.ex != null) ex.push(s.ex); if (s.tt != null) tt.push(s.tt); }
    const log = st.days[d] || {};
    if (log.sleep && log.sleep.hrs) sleep.push(log.sleep.hrs);
    const e = E.efficiencyOn(d); if (e !== null) eff.push(e * 100);
  });
  return { days, focus, tasks, habitPct: due ? Math.round(done / due * 100) : null, w, l, rest,
    exec: ex.length ? Math.round(avg(ex)) : null, sleep: sleep.length ? Math.round(avg(sleep) * 10) / 10 : null,
    eff: eff.length ? Math.round(avg(eff)) : null, ttfb: tt.length ? Math.round(avg(tt)) : null };
}
function reportText() {
  const st = S(), w = weekStats(), lv = E.levelState(), r = st.weekRatings[weekKey()] || {};
  const lines = [
    `${st.profile.name || 'Dashboard'}: week to ${fmtDate(today(), { day: 'numeric', month: 'long', year: 'numeric' })}`, '',
    `Focus: ${(w.focus / 3600000).toFixed(1)}h (target ${st.settings.targets.hours}h/day)`,
    `Tasks completed: ${w.tasks}`,
    `Habits kept: ${w.habitPct === null ? 'n/a' : w.habitPct + '%'}`,
    `Days vs ${L().shadow}: ${w.w} won, ${w.l} lost${w.rest ? `, ${w.rest} rest` : ''}`,
    `Execution of declared missions: ${w.exec === null ? 'n/a' : w.exec + '%'}`,
    `Average start delay: ${fmtMins(w.ttfb)}`,
    `Average sleep: ${w.sleep === null ? 'not logged' : w.sleep + 'h'}`,
    `Average session efficiency: ${w.eff === null ? 'not rated' : w.eff + '%'}`,
    `Level ${lv.level}, ${lv.rank.cur.name} (${lv.xp} XP in total)`, '',
    'Self-ratings (1-5): ' + (st.settings.ratings.map(c => `${c} ${r[c] || '-'}`).join(', ')), ''
  ];
  w.days.forEach(d => { const j = st.journal[d]; if (j && (j.w || j.l || j.f)) lines.push(`${fmtDate(d)}: right: ${j.w || '-'} | wrong: ${j.l || '-'} | fix: ${j.f || '-'}`); });
  if (r._note) lines.push('', 'Pushed / re-plan: ' + r._note);
  return lines.join('\n');
}

function weekHtml() {
  const w = weekStats(), st = S();
  const cell = (label, value, sub = '') => `<div class="hud-cell"><span class="eyebrow">${label}</span><b class="num">${value}</b><span>${sub}</span></div>`;
  return `<section class="hud" style="margin-bottom:var(--gap)">
    ${cell('Focus · 7 days', (w.focus / 3600000).toFixed(1) + 'h', `${(w.focus / 3600000 / 7).toFixed(1)}h a day · target ${st.settings.targets.hours}h`)}
    ${cell('Tasks done', w.tasks, `target ${st.settings.targets.tasks} a day`)}
    ${cell('Habits kept', w.habitPct === null ? '-' : w.habitPct + '%', w.rest ? `${w.rest} rest day${w.rest > 1 ? 's' : ''} excluded` : 'of everything due')}
    ${st.settings.modules.shadow ? cell(`vs ${esc(L().shadow)}`, `${w.w}-${w.l}`, 'days won - lost') : ''}
    ${st.settings.modules.mission ? cell('Execution', w.exec === null ? '-' : w.exec + '%', 'of declared missions') : ''}
    ${cell('Sleep', w.sleep === null ? '-' : w.sleep + 'h', w.sleep === null ? 'not logged this week' : 'average of logged nights')}
  </section>`;
}
function ratingsHtml() {
  const st = S(), key = weekKey(), r = st.weekRatings[key] || {};
  return `<section class="card"><div class="card-h"><span class="eyebrow">Weekly check-in · ${key}</span>
      <button class="btn sm ghost" data-act="review.copy">${icon('copy')} Copy weekly report</button></div>
    <div class="col" style="gap:12px">${st.settings.ratings.map(c => `<div class="row between"><span>${esc(c)}</span>
      <span class="rate big" role="group" aria-label="${esc(c)}">${[1, 2, 3, 4, 5].map(n => `<button class="${(r[c] || 0) >= n ? 'on' : ''}" data-act="review.rate" data-c="${esc(c)}" data-v="${n}" aria-label="${n} of 5"></button>`).join('')}</span></div>`).join('')}</div>
    <div class="field" style="margin-top:14px"><label>What got pushed, and where it goes next week</label>
      <textarea class="input" data-change="review.note" maxlength="2000" placeholder="Be specific about what moves and to which day.">${esc(r._note || '')}</textarea></div>
    <div class="hint" style="margin-top:8px">“Copy weekly report” puts this week's numbers, ratings and journal on the clipboard as plain text: paste it wherever you do your review. Categories are editable in Settings.</div></section>`;
}
function journalHtml() {
  const st = S(), date = ui.journalDate || today(), j = st.journal[date] || {}, q = ui.journalQuery.toLowerCase();
  const entries = Object.keys(st.journal).filter(d => { const e = st.journal[d]; return e && (e.w || e.l || e.f); }).sort().reverse()
    .filter(d => !q || JSON.stringify(st.journal[d]).toLowerCase().includes(q));
  return `<section class="card"><div class="card-h"><span class="eyebrow">Journal</span>
      <input class="input" type="date" value="${date}" max="${today()}" data-change="journal.date" style="width:auto" aria-label="Entry date"></div>
    <form data-journal class="col" style="gap:12px">
      <div class="form-row"><div class="field"><label>What went right</label><textarea class="input" name="w" maxlength="2000">${esc(j.w || '')}</textarea></div>
        <div class="field"><label>What went wrong</label><textarea class="input" name="l" maxlength="2000">${esc(j.l || '')}</textarea></div></div>
      <div class="form-row"><div class="field"><label>The fix for tomorrow</label><input class="input" name="f" value="${esc(j.f || '')}" maxlength="300"></div>
        <div class="field" style="max-width:140px"><label>Energy 1-5</label><input class="input" type="number" name="e" min="1" max="5" value="${j.e || ''}"></div></div>
      <div class="row"><button class="btn primary sm" type="submit">Save entry</button><span class="grow"></span>
        <button class="btn sm ghost" type="button" data-act="journal.export">${icon('download')} Export as Markdown</button></div>
    </form>
    <div class="sep"></div>
    <input class="input" placeholder="Search past entries…" value="${esc(ui.journalQuery)}" data-input="journal.search" data-fk="jq" aria-label="Search journal">
    <div class="list" style="margin-top:8px">${entries.slice(0, 40).map(d => { const e = st.journal[d], v = st.game.days[d];
      return `<button class="li jr" data-act="journal.open" data-date="${d}"><span style="min-width:96px"><b>${fmtDate(d)}</b>${v ? `<i class="v ${v.v}"></i>` : ''}</span>
        <span class="grow muted small" style="text-align:left">${esc([e.w && 'Right: ' + e.w, e.l && 'Wrong: ' + e.l, e.f && 'Fix: ' + e.f].filter(Boolean).join('  ·  ').slice(0, 220))}</span></button>`; }).join('') || '<div class="empty">No entries yet. The night debrief writes here too.</div>'}</div></section>`;
}
function recordsHtml() {
  const rec = E.records(), sr = E.serviceRecord(), st = S();
  const fmtD = d => (d ? fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  return `<div class="grid g3" style="margin-top:var(--gap)">
    <section class="card"><div class="card-h"><span class="eyebrow">Service record</span></div><div class="list">
      ${[['Focused hours, all time', sr.hours + 'h'], ['Blocks completed', sr.blocks], ['Habit check-offs', sr.habitDays], ['Habits mastered', sr.mastered],
         ['Days scored', sr.daysScored], ['Lifetime execution', sr.execAvg === null ? '-' : sr.execAvg + '%'], ['Average start delay', fmtMins(sr.ttfbAvg)], ['Campaigns completed', sr.campaigns]]
        .map(([k, v]) => `<div class="li"><span class="grow muted">${k}</span><b>${v}</b></div>`).join('')}</div></section>
    <section class="card"><div class="card-h"><span class="eyebrow">Personal records</span></div><div class="list">
      ${Object.keys(E.RECORD_DEFS).map(k => `<div class="li"><span class="grow muted">${E.RECORD_DEFS[k].label}</span><span style="text-align:right"><b>${rec[k] ? E.fmtRecord(k, rec[k].v) : '-'}</b>${rec[k] && rec[k].d ? `<div class="tiny dim">${fmtD(rec[k].d)}</div>` : ''}</span></div>`).join('')}</div></section>
    <section class="card"><div class="card-h"><span class="eyebrow">Campaign history</span></div>
      ${st.game.campaigns.length ? `<div class="list">${st.game.campaigns.slice().reverse().map(c => `<div class="li"><div class="grow"><b>${esc(c.name || 'Campaign')} ${String(c.n).padStart(2, '0')}</b>
          <div class="tiny dim">${fmtD(c.start)} to ${fmtD(c.end)} · ${c.w}-${c.l} · ${c.execAvg}% exec · ${c.hours}h</div></div><span class="pill ${c.verdict === 'Victory' ? 'good' : 'bad'}">${c.verdict}</span></div>`).join('')}</div>`
        : `<div class="empty">No campaigns finished yet.${st.game.campaign.on ? '' : '<br><button class="btn sm" data-act="nav.go" data-tab="settings" data-sub="game">Start a campaign</button>'}</div>`}</section>
  </div>`;
}

export default {
  render() {
    return `<div class="view-h"><h2>Review</h2></div>${weekHtml()}
      <div class="grid g2">${ratingsHtml()}${journalHtml()}</div>${recordsHtml()}`;
  },
  mount(root) {
    const f = root.querySelector('form[data-journal]');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const st = S(), date = ui.journalDate || today(), prev = st.journal[date] || {}, out = {};
      ['w', 'l', 'f'].forEach(k => { const v = f.elements[k].value.trim(); if (v) out[k] = v; });
      const en = clamp(parseInt(f.elements.e.value) || 0, 0, 5); if (en) out.e = en;
      if (prev.sm) out.sm = prev.sm;
      st.journal[date] = out;
      E.invalidate(); save();
      toast('Entry saved', fmtDate(date), { kind: 'good', ms: 3000 });
    });
  }
};

registerActions({
  'review.rate': d => {
    const st = S(), key = weekKey(), r = st.weekRatings[key] || (st.weekRatings[key] = {});
    r[d.c] = r[d.c] === +d.v ? 0 : +d.v;
    save();
  },
  'review.note': (d, e, el) => { const st = S(), key = weekKey(); (st.weekRatings[key] || (st.weekRatings[key] = {}))._note = el.value.trim(); save(); },
  'review.copy': async () => {
    try { await navigator.clipboard.writeText(reportText()); toast('Weekly report copied', 'Paste it into your notes or review tool.', { kind: 'good', ms: 4000 }); }
    catch { toast('Could not reach the clipboard', 'Your browser blocked it.', { kind: 'bad' }); }
  },
  'journal.date': (d, e, el) => { ui.journalDate = el.value || null; refresh(); },
  'journal.open': d => { ui.journalDate = d.date; refresh(); window.scrollTo({ top: 0 }); },
  'journal.search': (d, e, el) => { ui.journalQuery = el.value; refresh(); },
  'journal.export': () => {
    const st = S(), days = Object.keys(st.journal).filter(d => { const e = st.journal[d]; return e && (e.w || e.l || e.f); }).sort();
    if (!days.length) { toast('Nothing to export yet'); return; }
    const md = `# Journal: ${st.profile.name || 'Dashboard'}\n\n` + days.map(d => { const e = st.journal[d], v = st.game.days[d];
      return `## ${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${v ? `: ${v.v === 'W' ? 'won' : v.v === 'L' ? 'lost' : 'rest'}, ${v.x} XP` : ''}\n\n` +
        (e.w ? `**Right:** ${e.w}\n\n` : '') + (e.l ? `**Wrong:** ${e.l}\n\n` : '') + (e.f ? `**Fix:** ${e.f}\n\n` : '') + (e.e ? `Energy ${e.e}/5\n\n` : ''); }).join('');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `journal-${today()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
});
