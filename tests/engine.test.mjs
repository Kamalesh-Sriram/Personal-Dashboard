/* Engine and merge tests. No browser needed:  npm test  */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, _setStateForTests, S } from '../app/js/store.js';
import * as E from '../app/js/engine.js';
import { mergeStates } from '../app/js/merge.js';
import { today, addDays, parseYmd, ymd, deepClone } from '../app/js/util.js';

const T = today(), Y = addDays(T, -1);
function fresh(mutate) {
  const st = _setStateForTests(defaultState());
  st.profile.onboarded = true;
  if (mutate) mutate(st);
  E.invalidate();
  return st;
}
const activity = (id, weight = 'deep', isEscape = false) => ({ id, name: id, emoji: '', color: '#2BD4F0', weight, isEscape, isRunning: false, lastStart: 0, sessions: [] });
const at = (date, h, m = 0) => parseYmd(date).getTime() + (h * 60 + m) * 60000;
const session = (date, h0, m0, h1, m1, extra = {}) => ({ date, start: at(date, h0, m0), end: at(date, h1, m1), dur: at(date, h1, m1) - at(date, h0, m0), eff: null, ...extra });
const habit = (id, start, history = {}) => ({ id, name: id, emoji: '', difficulty: 'easy', schedule: { type: 'daily' }, color: '#F0A44B', startDate: start, history });

test('habit streak and XP are folded from history, and a rest day freezes the streak', () => {
  const h = habit('h', addDays(T, -5), { [addDays(T, -4)]: 'done', [addDays(T, -3)]: 'done', [addDays(T, -2)]: 'rest', [Y]: 'done' });
  fresh(st => st.habits.push(h));
  let s = E.habitStats(h);
  assert.equal(s.streak, 3);
  assert.equal(s.xp, 105);                       // three easy check-offs at 35
  h.history[Y] = 'missed'; E.invalidate();
  s = E.habitStats(h);
  assert.equal(s.streak, 0);
  assert.equal(s.xp, 60);                        // 70 earned, 10 lost
});

test('toggling a habit today can be undone without leaving a miss behind', () => {
  const h = habit('h', Y);
  fresh(st => st.habits.push(h));
  assert.ok(E.toggleHabit('h') > 0);
  assert.equal(h.history[T], 'done');
  E.toggleHabit('h');
  assert.equal(h.history[T], undefined);
});

test('the rival runs at 60% of a full day until three days are on record', () => {
  fresh();
  const i = E.shadowInfo(T);
  assert.equal(i.calibrating, true);
  assert.equal(i.xp, Math.round(E.maxXP(T) * 0.6));
});

test('the rival is 60% of the 7-day average plus 40% of the last day, plus his edge', () => {
  fresh(st => {
    st.settings.shadow.edge = 8;
    [100, 120, 140, 160, 200].forEach((x, k) => { st.game.days[addDays(T, k - 5)] = { v: 'W', x, s: 150 }; });
  });
  const i = E.shadowInfo(T);
  assert.equal(i.avg7, 144);
  assert.equal(i.last, 200);
  assert.equal(i.xp, 180);                       // (0.6*144 + 0.4*200) * 1.08 = 179.7
});

test('the rival never asks for more than the best day of the last 30', () => {
  fresh(st => {
    st.settings.shadow.edge = 25;
    for (let k = 1; k <= 5; k++) st.game.days[addDays(T, -k)] = { v: 'W', x: 100, s: 90 };
  });
  assert.equal(E.shadowXP(T), 100);
  assert.equal(E.shadowInfo(T).capped, true);
});

test('the rival eases down at most 8% a day after a slump, and ignores rest days', () => {
  fresh(st => {
    st.settings.shadow.edge = 8;
    [200, 200, 200, 50, 50].forEach((x, k) => { st.game.days[addDays(T, k - 6)] = { v: 'L', x, s: 190 }; });
    st.game.days[Y] = { v: 'R', x: 0, s: 0 };     // yesterday was a rest day: invisible to him
  });
  const i = E.shadowInfo(T);
  assert.equal(i.last, 50);
  assert.equal(i.xp, 175);                       // 190 * 0.92, not the 112 his formula alone would give
  assert.equal(i.held, true);
});

test('execution redistributes the weight of tiers that were not declared', () => {
  fresh(st => { st.game.missions[T] = { c: { t: 'a', done: true }, p: [], f: { t: '', done: false } }; });
  assert.equal(E.execScoreFor(T), 100);
  S().game.missions[T] = { c: { t: 'a', done: true }, p: [{ t: 'b', done: true }, { t: 'c', done: false }], f: { t: 'd', done: false } };
  assert.equal(E.execScoreFor(T), 68);           // 0.5 + 0.35 * 0.5
  assert.equal(E.repDelta(68), 1.5);
  assert.equal(E.repDelta(null), -2);
});

test('a rest day is settled as nothing: no win, no loss, no reputation change', () => {
  const D2 = addDays(T, -2);
  fresh(st => {
    st.game.start = D2;
    const a = activity('work'); a.sessions.push(session(D2, 9, 0, 11, 0)); st.activities.push(a);
    st.days[Y] = { rest: true };
  });
  const r = E.settlePending();
  assert.equal(r.settled.length, 2);
  const g = S().game.days;
  assert.equal(g[D2].v, 'L');                    // 28 XP against a calibrating rival
  assert.equal(g[D2].x, 28);
  assert.equal(g[Y].v, 'R');
  assert.equal(g[Y].rd, 0);
  const sb = E.scoreboard();
  assert.deepEqual([sb.w, sb.l, sb.r], [0, 1, 1]);
});

test('marking a past day as rest re-settles it and freezes the habit instead of breaking it', () => {
  const h = habit('h', addDays(T, -3), { [addDays(T, -3)]: 'done', [addDays(T, -2)]: 'done', [Y]: 'missed' });
  fresh(st => { st.game.start = addDays(T, -3); st.habits.push(h); st.settings.restPerWeek = 2; });
  E.settlePending();
  assert.equal(S().game.days[Y].v, 'L');
  assert.equal(E.habitStats(h).streak, 0);
  E.setRest(Y, true);
  assert.equal(S().game.days[Y].v, 'R');
  assert.equal(h.history[Y], 'rest');
  assert.equal(E.habitStats(h).streak, 2);
  assert.equal(E.restBudget(T).left, 1);
});

test('a clean-sweep chain counts across a rest day and pays a growing bonus', () => {
  const D3 = addDays(T, -3), D2 = addDays(T, -2);
  const mk = id => habit(id, D3, { [D3]: 'done', [D2]: 'rest', [Y]: 'done', [T]: 'done' });
  fresh(st => { st.habits.push(mk('a'), mk('b')); st.days[D2] = { rest: true }; });
  assert.equal(E.isSweep(T), true);
  assert.equal(E.sweepChain(T), 3);
  assert.equal(E.sweepBonus(T), 21);             // 15 + 3 for each of the two earlier days
  S().habits[1].history[T] = 'missed'; E.invalidate();
  assert.equal(E.sweepBonus(T), 0);
});

test('back-to-back blocks build a combo and a break resets it', () => {
  const work = activity('work'), brk = activity('break', 'tracked', true);
  work.sessions.push(session(Y, 9, 0, 10, 0), session(Y, 10, 5, 11, 0), session(Y, 11, 15, 12, 0));
  brk.sessions.push(session(Y, 11, 0, 11, 10));
  fresh(st => st.activities.push(work, brk));
  const w = E.comboWalk(Y);
  assert.deepEqual(w.list.map(x => x.mult), [1, 1.2, 1, 1]);
  assert.equal(w.longest, 2);
  assert.equal(E.dayScore(Y).focus, 40);         // 14 + 15.4 + 0.35 + 10.5
});

test('the logbook pays for writing things down', () => {
  const work = activity('work'); work.sessions.push(session(Y, 9, 0, 10, 0, { eff: 0.8 }));
  fresh(st => { st.activities.push(work); st.days[Y] = { sleep: { start: '23:00', end: '07:00', hrs: 8 }, efficacy: 70 }; st.journal[Y] = { w: 'ok' }; });
  const lb = E.logbook(Y);
  assert.equal(lb.complete, true);
  assert.equal(E.dayScore(Y).log, 12);
});

test('clearing the Done column keeps the credit for the day the task was finished', () => {
  fresh(st => { st.cards.done.push({ id: 'c1', text: 'x', doneAt: Y }, { id: 'c2', text: 'y', doneAt: T }); });
  assert.equal(E.tasksDoneOn(Y), 1);
  assert.equal(E.clearDone(T), 1);               // only what was finished before today
  assert.equal(S().cards.done.length, 1);
  assert.equal(E.tasksDoneOn(Y), 1);
  assert.ok(S().tomb.c1);
});

test('a timer running across midnight is split so each day owns its own time', () => {
  const work = activity('work');
  work.isRunning = true; work.lastStart = parseYmd(T).getTime() - 30 * 60000;
  fresh(st => st.activities.push(work));
  E.stopRunning();
  assert.equal(work.sessions[0].date, Y);
  assert.equal(work.sessions[0].dur, 30 * 60000);
  assert.equal(work.isRunning, false);
});

test('a task logs its time under the activity its tag is linked to', () => {
  const thesis = activity('thesis'), deep = activity('deep');
  fresh(st => { st.activities.push(deep, thesis); st.tags.push({ id: 't', name: 'Thesis', color: '#8B7CF6', activityId: 'thesis' }); });
  assert.equal(E.activityForCard({ id: 'c', tagId: 't' }).id, 'thesis');
  assert.equal(E.activityForCard({ id: 'c', tagId: null }).id, 'deep');
});

test('daily goals start empty and yesterday is offered as the prompt', () => {
  fresh(st => { st.days[Y] = { goals: [{ t: 'Ship it', done: true }] }; });
  assert.deepEqual(E.dayGoals(T), []);
  assert.equal(E.prevDayGoals(T)[0].t, 'Ship it');
  E.setDayGoal(T, 0, { t: 'Ship it' });
  assert.equal(E.dayGoals(T)[0].done, false);
});

test('custom notification lines replace the built-in ones and fill in placeholders', () => {
  fresh(st => { st.settings.lines = { habits: ['{n} left, {rival} is watching'] }; st.settings.labels.shadow = 'Rex'; });
  assert.equal(E.voice('habits', { n: 2 }), '2 left, Rex is watching');
  S().settings.shadow.voice = 'off';
  assert.equal(E.voice('habits', { n: 2 }), '');
});

test('a subscription billed on the 31st keeps its day, and weekly cycles survive a clock change', () => {
  const sub = { anchor: '2026-01-31', cycle: 'monthly' };
  assert.equal(ymd(E.nextDueFor(sub, new Date(2026, 1, 1))), '2026-02-28');
  assert.equal(ymd(E.nextDueFor(sub, new Date(2026, 2, 1))), '2026-03-31');
  assert.equal(ymd(E.nextDueFor({ anchor: '2026-10-19', cycle: 'weekly' }, new Date(2026, 9, 27))), '2026-11-02');
  assert.equal(Math.round(E.monthlyCost({ amount: 120, cycle: 'yearly' })), 10);
});

/* ── merge ── */
function pair() {
  const base = defaultState();
  base.cards.today.push({ id: 'x', text: 'task', _m: 100 }, { id: 'y', text: 'other', _m: 100 });
  base.habits.push(habit('h', Y, { [T]: 'done' }));
  base.habits[0]._m = 100;
  return [deepClone(base), deepClone(base)];
}

test('merge: a card belongs to whichever copy moved it last, whatever the revision', () => {
  const [local, remote] = pair();
  local.cards.today = local.cards.today.filter(c => c.id !== 'x');
  local.cards.done.push({ id: 'x', text: 'task', _m: 200, doneAt: T });
  local._rev = 3; remote._rev = 9;                 // the stale copy has the higher revision
  const m = mergeStates(local, remote, 'dev');
  assert.ok(m.cards.done.some(c => c.id === 'x'));
  assert.ok(!m.cards.today.some(c => c.id === 'x'));
  assert.ok(m.cards.today.some(c => c.id === 'y'));
});

test('merge: a deleted item is not resurrected by an older copy', () => {
  const [local, remote] = pair();
  local.cards.today = local.cards.today.filter(c => c.id !== 'y');
  local.tomb.y = Date.now();
  remote._rev = 5;
  const m = mergeStates(local, remote, 'dev');
  assert.ok(!Object.values(m.cards).flat().some(c => c.id === 'y'));
});

test('merge: un-checking a habit today is not undone by the other device', () => {
  const [local, remote] = pair();
  delete local.habits[0].history[T];
  local.habits[0]._m = 500;
  remote._rev = 7;
  const m = mergeStates(local, remote, 'dev');
  assert.equal(m.habits[0].history[T], undefined);
});

test('merge: where two devices froze a day differently, the verdict is dropped for re-settling', () => {
  const [local, remote] = pair();
  local.game.days[Y] = { v: 'W', x: 200, s: 150 };
  remote.game.days[Y] = { v: 'L', x: 90, s: 150 };
  const m = mergeStates(local, remote, 'dev');
  assert.equal(m.game.days[Y], undefined);
});

test('merge: merging twice changes nothing more (two devices settle instead of ping-ponging)', () => {
  const [local, remote] = pair();
  local.cards.week.push({ id: 'z', text: 'new', _m: 300 });
  remote.journal[Y] = { w: 'note' };
  const once = mergeStates(local, remote, 'a');
  const twice = mergeStates(remote, once, 'b');
  const strip = s => { const { _rev, _at, _dev, ...rest } = s; return rest; };
  const canon = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, key) => { a[key] = v[key]; return a; }, {}) : v));
  assert.equal(canon(strip(twice)), canon(strip(once)));
});
