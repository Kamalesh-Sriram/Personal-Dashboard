/* Engine and merge tests. No browser needed:  npm test  */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, _setStateForTests, S, resyncClock } from '../app/js/store.js';
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

test('main goals start empty each day, show the last ones as a prompt, and earn XP up to a cap', () => {
  fresh(st => { st.days[Y] = { goals: [{ t: 'Make my first million' }] }; });
  assert.deepEqual(E.dayGoals(T), []);
  assert.equal(E.prevDayGoals(T)[0].t, 'Make my first million');
  assert.equal(E.goalXP(T), 0);
  for (let i = 0; i < 8; i++) E.setDayGoal(T, i, { t: 'Goal ' + i });
  assert.equal(E.dayGoals(T).length, 8);          // as many as you like
  assert.equal(E.goalXP(T), 10);                  // but only five of them pay, at 2 XP each
  assert.equal(E.dayScore(T).goals, 10);
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

test('the month has its own record, and says how many more days win it', () => {
  const month = T.slice(0, 7), first = month + '-01';
  fresh(st => { st.game.start = addDays(first, -5); st.game.days[addDays(first, -1)] = { v: 'W', x: 10, s: 5 }; });   // last month's win is not counted
  let b = E.monthBoard(month);
  assert.equal(b.w + b.l, 0);
  assert.equal(b.days.length, new Date(+month.slice(0, 4), +month.slice(5), 0).getDate());
  assert.equal(b.days.find(d => d.date === T).v, 'T');
  assert.equal(b.need, Math.floor(b.open / 2) + 1);
  if (T > first) {
    fresh(st => { st.game.start = first; st.game.days[first] = { v: 'L', x: 1, s: 5 }; });
    b = E.monthBoard(month);
    assert.equal(b.l, 1);
    assert.equal(b.need, Math.floor((1 + b.open) / 2) + 1);
  }
});

test('the brief and the debrief follow the window until given their own times', () => {
  const st = fresh(s => { s.settings.window = { start: '07:00', end: '23:00' }; });
  assert.equal(E.briefMin(), 7 * 60);
  assert.equal(E.debriefMin(), 22 * 60 + 30);
  st.settings.notify.briefAt = '06:15'; st.settings.notify.debriefAt = '21:00';
  assert.equal(E.briefMin(), 6 * 60 + 15);
  assert.equal(E.debriefMin(), 21 * 60);
});

test('time on a goal task adds up on the task, and a card sent from a goal counts toward it', () => {
  const st = fresh(s => {
    s.activities.push(activity('thesis'));
    s.goals.push({ id: 'g1', name: 'Thesis', color: '#8B7CF6', activityId: 'thesis', milestones: [{ id: 'm1', name: 'Draft', done: false, tasks: [{ id: 'k1', name: 'Intro', done: false }, { id: 'k2', name: 'Method', done: false }] }] });
    s.activities[0].sessions.push(session(Y, 9, 0, 10, 0, { taskId: 'k1' }), session(Y, 11, 0, 11, 30, { taskId: 'k2' }), session(Y, 12, 0, 13, 0));
  });
  assert.equal(E.taskMs('k1'), 3600000);
  assert.equal(E.taskMs('k2'), 1800000);
  assert.equal(E.taskMs('k1', T), 0);                                  // nothing since today
  assert.equal(E.activityForGoal(st.goals[0]).id, 'thesis');
  st.cards.today.push({ id: 'c1', text: 'Intro', tagId: null, subs: [], goalTask: 'k1' });
  assert.equal(E.activityForCard(st.cards.today[0]).id, 'thesis');
  E.moveCard('c1', 'done');
  assert.equal(st.goals[0].milestones[0].tasks[0].done, true);          // finishing the card ticks the goal task
  assert.equal(st.goals[0].milestones[0].done, false);
});

test('working hours that run past midnight take the day with them', async () => {
  const U = await import('../app/js/util.js');
  assert.equal(U.dayOffsetFor({ start: '07:00', end: '23:00' }), 0);
  assert.equal(U.dayOffsetFor({ start: '07:00', end: '00:00' }), 0);
  assert.equal(U.dayOffsetFor({ start: '07:00', end: '01:00' }), 240);            // halfway between 01:00 and 07:00
  const st = fresh(s => { s.settings.window = { start: '07:00', end: '01:00' }; s.activities.push(activity('work')); });
  resyncClock();                                                                  // the app does this on every save
  assert.equal(U.dayOffsetMin(), 240);
  const w = E.winMinutes();
  assert.equal(w.end, 25 * 60); assert.equal(w.total, 18 * 60);
  const D = '2026-03-10', late = at(D, 24, 30), early = at(D, 27, 0), morning = at(D, 28, 0);
  assert.equal(U.dateOf(late), D);                                                // 00:30 still belongs to the 10th
  assert.equal(U.dateOf(early), D);                                               // so does 03:00
  assert.equal(U.dateOf(morning), '2026-03-11');                                  // 04:00 opens the 11th
  assert.equal(U.minOfDay(late, D), 1470);
  assert.equal(U.clockToDayMin('00:30'), 1470);
  assert.equal(U.clockToDayMin('20:00'), 1200);
  assert.equal(U.dayEndTs(D), morning);
  st.settings.notify.debriefAt = '00:30';
  assert.equal(E.debriefMin(), 1470);
  fresh();                                                                        // back to a midnight day for the other tests
  assert.equal(U.dayOffsetMin(), 0);
});

test('a task can name its own activity, ahead of its tag', () => {
  const st = fresh(s => {
    s.activities.push(activity('thesis'), activity('gym'));
    s.tags.push({ id: 'tg', name: 'Thesis', color: '#8AB4F8', activityId: 'thesis' });
  });
  const card = { id: 'c1', text: 'x', tagId: 'tg', subs: [] };
  assert.equal(E.activityForCard(card).id, 'thesis');
  card.activityId = 'gym';
  assert.equal(E.activityForCard(card).id, 'gym');
  card.activityId = 'gone';                                                       // a deleted activity falls back to the tag
  assert.equal(E.activityForCard(card).id, 'thesis');
  void st;
});

test('shopping: ticking moves an item to bought, and its expiry date brings it back', async () => {
  const Shop = await import('../app/js/shop.js');
  const st = fresh();
  const milk = Shop.addItem({ name: 'Milk', kind: 'groceries', qty: '2' }).item;
  assert.equal(milk.kind, 'Groceries'); assert.equal(milk.bought, false);
  assert.equal(Shop.addItem({ name: ' milk ', kind: 'Groceries' }).how, 'there');   // not listed twice
  assert.equal(st.shopping.length, 1);
  Shop.setBought(milk.id, true, '2026-11-10');
  assert.equal(milk.bought, true); assert.equal(milk.boughtAt, '2026-11-10'); assert.equal(milk.expires, null);
  Shop.setExpiry(milk.id, '2026-11-17');
  assert.equal(milk.life, 7);
  assert.equal(Shop.daysLeft(milk, '2026-11-15'), 2);
  assert.equal(Shop.expireItems('2026-11-17').length, 0);                         // the day it expires it is still good
  const moved = Shop.expireItems('2026-11-18');
  assert.equal(moved.length, 1); assert.equal(milk.bought, false); assert.equal(milk.expired, '2026-11-17'); assert.equal(milk.expires, null);
  Shop.setBought(milk.id, true, '2026-11-20');                                     // bought again: the same shelf life is filled in
  assert.equal(milk.expires, '2026-11-27'); assert.equal(milk.expired, null);
  assert.equal(Shop.addItem({ name: 'Milk', kind: 'Groceries' }).how, 'again');    // adding it while bought puts it back on the list
  assert.equal(milk.bought, false);
  Shop.removeItem(milk.id);
  assert.equal(st.shopping.length, 0); assert.ok(st.tomb[milk.id]);
});

test('level: Habitica\'s costs, earnings that grow with the level, and ranks as bands of levels', () => {
  const st = fresh();
  assert.deepEqual([1, 2, 3, 4, 5, 10, 50, 99].map(E.levelCost), [150, 160, 170, 180, 200, 260, 1260, 3580]);
  assert.equal(E.levelStart(1), 0); assert.equal(E.levelStart(3), 310); assert.equal(E.levelStart(100), 145410);
  assert.deepEqual(E.levelAt(0), { level: 1, into: 0, need: 150, pct: 0 });
  assert.equal(E.levelAt(309).level, 2); assert.equal(E.levelAt(310).level, 3);
  assert.equal(E.levelAt(1e9).level, 100);
  // what you earn grows as the square root of what a level costs
  assert.equal(E.levelGain(1), 1); assert.ok(Math.abs(E.levelGain(99) - Math.sqrt(3580 / 150)) < 1e-9);
  // a day halfway between the best (every source maxed) and the worst (a lost day) reaches level 100 in about two years
  const c = st.settings.level, best = c.mission + c.habits100 + c.deepHour * c.deepCap + c.win, mid = (best - c.loss) / 2;
  const daysTo100 = perDay => { let xp = 0, n = 0; while (E.levelAt(xp).level < 100 && n < 5000) { xp += Math.round(perDay * E.levelGain(E.levelAt(xp).level)); n++; } return n; };
  assert.ok(daysTo100(mid) > 650 && daysTo100(mid) < 810, 'two years at the middle: ' + daysTo100(mid));
  assert.ok(daysTo100(best) > 300 && daysTo100(best) < 400, 'about eleven months of perfect days: ' + daysTo100(best));
  st.settings.level.growth = 0; assert.equal(E.levelGain(99), 1);
  st.settings.level.growth = 50;
  assert.equal(E.rankForLevel(1).cur.name, 'Novice'); assert.equal(E.rankForLevel(5).cur.name, 'Novice');
  assert.equal(E.rankForLevel(6).cur.name, 'Apprentice'); assert.equal(E.rankForLevel(100).cur.name, 'Grand Master');
  assert.equal(E.rankForLevel(6).next.name, 'Expert');
});
test('level XP for a day comes from the mission, habits, linked habits, deep work, milestones and the result', () => {
  const st = fresh(s => {
    s.game.start = Y;
    s.activities.push(activity('work'), activity('admin', 'upkeep'));
    s.activities[0].sessions.push(session(Y, 9, 0, 11, 30));                 // 2.5 deep hours
    s.activities[1].sessions.push(session(Y, 12, 0, 14, 0));                 // upkeep earns nothing here
    s.habits.push(habit('a', Y, { [Y]: 'done' }), habit('b', Y, { [Y]: 'done' }), habit('gym', Y, { [Y]: 'done' }), habit('c', Y, {}), habit('d', Y, {}));
    s.habits[2].lvXp = 15;
    s.game.missions[Y] = { c: { t: 'Big thing', done: true }, p: [{ t: 'One', done: true }, { t: 'Two', done: false }], f: { t: 'Least', done: false } };
    s.goals.push({ id: 'g', name: 'G', milestones: [{ id: 'm1', name: 'M1', done: true, doneAt: Y, tasks: [] }, { id: 'm2', name: 'M2', done: false, tasks: [] }] });
    s.game.days[Y] = { v: 'W', x: 100, s: 80 };
  });
  const day = E.levelDay(Y);
  assert.equal(day.parts.mission, Math.round(40 * 0.675));                   // critical 50% + half of the primaries' 35%
  assert.equal(day.parts.habits, 6);                                         // 3 of 5 done is past half, short of 80%
  assert.equal(day.parts.linked, 15);
  assert.equal(day.parts.deep, 15);
  assert.equal(day.parts.milestones, 25);
  assert.equal(day.parts.result, 20);
  assert.equal(day.total, 27 + 6 + 15 + 15 + 25 + 20);
  assert.equal(E.levelState().xp, day.total + E.levelDay(T).total);
  st.game.days[Y].v = 'L'; E.invalidate();
  assert.equal(E.levelDay(Y).parts.result, -13);
  assert.equal(E.levelDay(Y, 2).parts.result, -26);                          // at a level that pays double, it costs double too
});
test('a lost day costs XP but, by default, never a level already reached', () => {
  const d2 = addDays(T, -2), d1 = addDays(T, -1);
  const st = fresh(s => {
    s.game.start = d2;
    s.activities.push(activity('work'));
    s.settings.level.deepHour = 20; s.settings.level.loss = 60;
    s.activities[0].sessions.push(session(d2, 8, 0, 16, 0));                 // eight deep hours: 160 XP
    s.game.days[d2] = { v: 'W', x: 1, s: 0 };                                // +20: 180 in all, which is level 2 (from 150)
    s.game.days[d1] = { v: 'L', x: 0, s: 1 };                                // level 2 pays x1.03: -62 would be 118, back in level 1
  });
  assert.equal(E.levelState().level, 2);
  assert.equal(E.levelState().xp, 150);                                      // held at the start of level 2
  st.settings.level.keepLevel = false; E.invalidate();
  assert.equal(E.levelState().xp, 118); assert.equal(E.levelState().level, 1);
});
test('clearing a milestone stamps the day, and unticking takes the stamp away', () => {
  const st = fresh(s => { s.goals.push({ id: 'g', name: 'G', milestones: [{ id: 'm', name: 'M', done: false, tasks: [{ id: 'k1', name: 'a', done: true }, { id: 'k2', name: 'b', done: false }] }] }); });
  const m = st.goals[0].milestones[0];
  E.completeGoalTask('k2');
  assert.equal(m.done, true); assert.equal(m.doneAt, T);
  assert.equal(E.levelDay(T).parts.milestones, 25 + 65);                     // the milestone, and the goal it completed
  m.tasks[1].done = false; E.stampMilestone(m);
  assert.equal(m.doneAt, undefined);
});

/* ── 5.4 ── */
test('merge: copies of a day that agree on the result are kept, whatever else differs', () => {
  const [local, remote] = pair();
  local.game.days[Y] = { x: 207, h: 3.1, v: 'W', s: 152, ex: 50 };
  remote.game.days[Y] = { v: 'W', x: 207, s: 152, ex: 50, nd: 0, h: 3.1 };   // another field order, an extra field
  const m = mergeStates(local, remote, 'dev');
  assert.ok(m.game.days[Y]);
  assert.equal(m.game.days[Y].v, 'W');
});

test('merge: the last announced day only moves forward', () => {
  const [local, remote] = pair();
  local.game.notif.ann = addDays(T, -1);
  remote.game.notif.ann = addDays(T, -7);
  remote._rev = 99;                                                        // the older stamp is on the newer copy
  assert.equal(mergeStates(local, remote, 'dev').game.notif.ann, addDays(T, -1));
});

test('a deep block pays by its focus rating; an unrated one as a 3/5', () => {
  const a = activity('deep');
  const s = session(T, 9, 0, 10, 0);
  fresh(st => { st.activities.push(a); a.sessions.push(s); });
  const full = S().settings.xp.perHour;
  assert.equal(E.dayScore(T).focus, Math.round(full * E.UNRATED_RATE));
  s.eff = 1; E.invalidate();
  assert.equal(E.dayScore(T).focus, full);
  s.eff = 0.4; E.invalidate();
  assert.equal(E.dayScore(T).focus, Math.round(full * 0.4));
});

test('focus rating does not change blocks from before the rule began', () => {
  const a = activity('deep'), d = addDays(E.RATED_FROM, -1);
  fresh(st => { st.activities.push(a); a.sessions.push(session(d, 9, 0, 10, 0, { eff: 0.2 })); });
  assert.equal(E.blockRate(a, a.sessions[0]), 1);
});

test('a habit can be done on a day it is not due, and undone without a miss', () => {
  const h = { ...habit('h', addDays(T, -10)), schedule: { type: 'weekdays', days: [] } };
  fresh(st => st.habits.push(h));
  assert.ok(E.toggleHabit('h') > 0);
  assert.equal(h.history[T], 'done');
  E.toggleHabit('h', T);
  assert.equal(h.history[T], undefined);
});

/* ── 5.6 ── */
test('a break is challenged every time by default, and not in the while after holding the line', () => {
  const brk = activity('break', 'tracked', true);
  fresh(st => st.activities.push(brk));
  assert.equal(E.needsEscapeChallenge(brk), true);                         // no campaign, no minimum focus needed
  S().game.notif.holdUntil = Date.now() - 1000;                            // held the line, and the 15 minutes are up
  assert.equal(E.needsEscapeChallenge(brk), false);
  S().game.notif.holdUntil = Date.now() + 60000;                           // still inside the 15 minutes
  assert.equal(E.needsEscapeChallenge(brk), true);
  S().game.notif.holdUntil = 0;
  S().settings.breakCheck = 'campaign';
  assert.equal(E.needsEscapeChallenge(brk), false);
  S().settings.breakCheck = 'off';
  assert.equal(E.needsEscapeChallenge(brk), false);
  S().settings.breakCheck = 'always';
  assert.equal(E.needsEscapeChallenge(activity('work')), false);           // only breaks are challenged
});

test('before a replace, what each copy holds that the other does not is counted', async () => {
  const P = await import('../app/js/snapshots.js');
  const a = defaultState(), b = defaultState();
  a.goals = [{ id: 'g1' }, { id: 'g2' }]; b.goals = [{ id: 'g1' }];
  a.cards.today = [{ id: 'c1' }, { id: 'c2' }]; b.cards.today = [{ id: 'c1' }];
  const lose = P.missingFrom(a, b);
  assert.equal(lose.goals, 1); assert.equal(lose.tasks, 1);
  assert.equal(P.total(lose), 2);
  assert.equal(P.describe(lose), '1 task and 1 goal');
  assert.equal(P.total(P.missingFrom(b, a)), 0);
  assert.equal(P.total(P.missingFrom(a, null)), 4);                        // an empty account would lose everything
});
