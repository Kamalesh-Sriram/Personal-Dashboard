/* Builds a believable three-week dashboard as a backup file, for trying the
   app out or taking screenshots:

     node tools/demo-state.mjs > demo-backup.json

   then Settings > Data > Import backup. Everything in it is made up. */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = off => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const slug = (p, n) => p + '-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const T = ymd(day(0)), DAYS = 21;
const act = (name, color, weight, isEscape = false) => ({ id: slug('act', name), name, emoji: '', color, weight, isEscape, isRunning: false, lastStart: 0, sessions: [] });
const activities = [
  act('Deep Work', '#2BD4F0', 'deep'), act('Thesis', '#8B7CF6', 'deep'), act('Client Project', '#2BF0A0', 'deep'), act('Gym', '#F26D63', 'deep'),
  act('Reading', '#56CFB2', 'deep'), act('Admin', '#9AA0A8', 'upkeep'), act('Cooking', '#F0A44B', 'upkeep'),
  act('Meal', '#C9A27A', 'tracked', true), act('Break', '#7C86C8', 'tracked', true)
];
const A = Object.fromEntries(activities.map(a => [a.name, a]));
const addSession = (a, off, startMin, mins, eff = null, cardId = null) => {
  const s = day(off).getTime() + startMin * 60000, e = s + mins * 60000;
  if (e > Date.now()) return;
  a.sessions.push({ date: ymd(day(off)), start: s, end: e, dur: e - s, eff, ...(cardId ? { cardId } : {}) });
};

const habit = (name, difficulty, color, schedule = { type: 'daily' }) => ({ id: slug('hab', name), name, emoji: '', difficulty, color, schedule, startDate: ymd(day(-DAYS)), history: {} });
const habits = [
  habit('Up on the first alarm', 'easy', '#F0A44B'), habit('Phone-free first hour', 'medium', '#2BF0A0'),
  habit('Train', 'hard', '#F26D63', { type: 'interval', every: 2 }), habit('Read 10 pages', 'easy', '#6FB1F0'), habit('Sit in silence 15 min', 'medium', '#8B7CF6')
];

const days = {}, journal = {}, gameDays = {}, missions = {};
const restOff = -9;
let prevS = 0;
const xs = [];
for (let off = -DAYS; off <= 0; off++) {
  const d = ymd(day(off)), rest = off === restOff, strong = rnd() > 0.28;
  days[d] = {};
  if (rest) days[d].rest = true;
  if (off < 0 || true) days[d].sleep = { start: pick(['23:10', '23:40', '00:15', '22:50']), end: pick(['06:45', '07:05', '07:30']), hrs: 6.5 + Math.round(rnd() * 20) / 10 };
  // sessions
  if (!rest) {
    const start = 7 * 60 + 20 + Math.floor(rnd() * (strong ? 40 : 150));
    addSession(A['Deep Work'], off, start, 70 + Math.floor(rnd() * 50), off < 0 ? pick([0.6, 0.8, 0.8, 1]) : 0.8, off === 0 ? 'card-brief' : null);
    addSession(A['Break'], off, start + 125, 12, off < 0 ? 0.6 : null);
    addSession(A['Thesis'], off, start + 140, strong ? 95 : 40, off < 0 ? pick([0.6, 0.8, 1]) : null);
    addSession(A['Meal'], off, 12 * 60 + 45, 35, off < 0 ? 0.8 : null);
    if (strong) addSession(A['Client Project'], off, 13 * 60 + 30, 80 + Math.floor(rnd() * 60), off < 0 ? pick([0.8, 1]) : null);
    if (off % 2 === 0) addSession(A['Gym'], off, 17 * 60 + 15, 65, off < 0 ? 1 : null);
    if (strong) addSession(A['Reading'], off, 20 * 60 + 30, 30, off < 0 ? 0.8 : null);
    addSession(A['Admin'], off, 16 * 60, 25, off < 0 ? 0.6 : null);
  }
  // habits
  habits.forEach((h, i) => {
    const due = h.schedule.type === 'daily' || (off + DAYS) % h.schedule.every === 0;
    if (!due) return;
    if (off === 0) { if (i < 2) h.history[d] = 'done'; return; }
    h.history[d] = rest ? 'rest' : (rnd() < (strong ? 0.93 : 0.6) || off > -6 ? 'done' : 'missed');
  });
  if (off === 0) break;
  // verdicts
  const x = rest ? 40 : Math.round(strong ? 150 + rnd() * 70 : 70 + rnd() * 50);
  if (rest) { gameDays[d] = { v: 'R', x, s: 0, ex: null, rd: 0, h: 0, tt: null, cb: 0 }; }
  else {
    const hist = xs.slice(-7), avg7 = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const s = hist.length < 3 ? 110 : Math.round(Math.min(Math.max(...xs), Math.max((0.6 * avg7 + 0.4 * xs[xs.length - 1]) * 1.08, prevS * 0.92)));
    const ex = strong ? pick([100, 85, 85, 65]) : pick([50, 35, 15, 0]);
    const rd = ex >= 80 ? 3 : ex >= 60 ? 1.5 : ex >= 40 ? 0.5 : ex >= 20 ? -1 : -3;
    gameDays[d] = { v: x >= s ? 'W' : 'L', x, s, ex, rd, h: Math.round((strong ? 5.2 + rnd() * 1.6 : 2.4 + rnd()) * 100) / 100, tt: strong ? 20 + Math.floor(rnd() * 40) : 70 + Math.floor(rnd() * 90), cb: strong ? 3 : 2 };
    xs.push(x); prevS = s;
    days[d].efficacy = strong ? pick([70, 75, 80, 85]) : pick([40, 50, 55]);
    journal[d] = { w: pick(['Started inside the first half hour.', 'Three blocks back to back before lunch.', 'Phone stayed in the other room.']), l: pick(['Lost the afternoon after the meal.', 'Checked messages between blocks.', 'Went to bed late again.']), f: pick(['Lay out the first task tonight.', 'Eat at the desk, walk after.', 'Lights out by 23:15.']), e: pick([3, 4, 4, 5]) };
  }
}
days[ymd(day(-1))].goals = [{ t: 'Make my first million' }, { t: 'Graduate with distinction' }, { t: 'Bench 100 kg' }, { t: 'Run my own studio' }];
days[T].goals = [{ t: 'Make my first million' }, { t: 'Graduate with distinction' }];
missions[T] = { c: { t: 'Results section: first full draft', done: false }, p: [{ t: 'Reply to supervisor comments', done: true }, { t: 'Invoice for October', done: false }], f: { t: 'Two focused hours on the thesis', done: true }, src: 'night', at: Date.now() - 12 * 3600000 };

const tag = (name, color, a) => ({ id: slug('tag', name), name, color, activityId: slug('act', a) });
const tags = [tag('Thesis', '#8B7CF6', 'Thesis'), tag('Client', '#2BF0A0', 'Client Project'), tag('Health', '#F26D63', 'Gym'), tag('Admin', '#9AA0A8', 'Admin')];
const card = (id, text, tagName, est, extra = {}) => ({ id, text, tagId: tagName ? slug('tag', tagName) : null, est, deadline: null, notes: '', subs: [], ...extra });
const cards = {
  today: [
    card('card-brief', 'Write the results section', 'Thesis', 120, { subs: [{ id: 's1', t: 'Tables 4 and 5', done: true }, { id: 's2', t: 'Figure captions', done: true }, { id: 's3', t: 'Discussion of outliers', done: false }, { id: 's4', t: 'Read through once', done: false }], deadline: ymd(day(2)) }),
    card('card-2', 'Reply to supervisor comments', 'Thesis', 30),
    card('card-3', 'Invoice for October', 'Client', 20, { deadline: ymd(day(0)) }),
    card('card-4', 'Book physio appointment', 'Health', 10)
  ],
  soon: [card('card-5', 'Prepare slides for Thursday', 'Client', 90, { deadline: ymd(day(3)) }), card('card-6', 'Renew gym membership', 'Health', 10)],
  week: [card('card-7', 'Literature table update', 'Thesis', 60), card('card-8', 'Tax paperwork', 'Admin', 45, { deadline: ymd(day(6)) }), card('card-9', 'Clean up project repo', 'Client', 40)],
  someday: [card('card-10', 'Read the new review paper', 'Thesis', 60), card('card-11', 'Plan the spring trip', null, 30)],
  waiting: [card('card-12', 'Feedback from Anna on chapter 2', 'Thesis', null)],
  done: [card('card-13', 'Backup the laptop', 'Admin', 15, { doneAt: T }), card('card-14', 'Morning review', null, 10, { doneAt: T })]
};

const state = {
  v: 5,
  profile: { name: 'Headquarters', owner: '', onboarded: true, createdAt: ymd(day(-DAYS)) },
  settings: { accent: '#2BD4F0', theme: 'dark', targets: { hours: 6, tasks: 4 }, window: { start: '07:00', end: '23:00' } },
  columns: [
    { id: 'today', name: 'Today', color: '#2BD4F0' }, { id: 'soon', name: 'Next 48h', color: '#F26D63' }, { id: 'week', name: 'This week', color: '#F0A44B' },
    { id: 'someday', name: 'Someday', color: '#8B7CF6' }, { id: 'waiting', name: 'Waiting on', color: '#56CFB2' }, { id: 'done', name: 'Done', color: '#72726D' }
  ],
  cards, tags, activities, habits,
  goals: [
    { id: 'goal-1', name: 'Hand in the thesis', deadline: ymd(day(47)), color: '#8B7CF6', milestones: [
      { id: 'm1', name: 'Chapter 3: results', done: false, tasks: [{ id: 't1', name: 'Run the last experiment', done: true }, { id: 't2', name: 'Write the results section', done: false }, { id: 't3', name: 'Figures final', done: false }] },
      { id: 'm2', name: 'Chapter 4: discussion', done: false, tasks: [{ id: 't4', name: 'Outline', done: true }, { id: 't5', name: 'First draft', done: false }] },
      { id: 'm3', name: 'Supervisor sign-off', done: false, tasks: [] }] },
    { id: 'goal-2', name: 'Bench 100 kg', deadline: ymd(day(90)), color: '#F26D63', milestones: [{ id: 'm4', name: '85 kg for 5', done: true, tasks: [] }, { id: 'm5', name: '92.5 kg for 3', done: false, tasks: [] }, { id: 'm6', name: '100 kg single', done: false, tasks: [] }] }
  ],
  subs: [
    { id: 'sub-1', name: 'Cloud storage', amount: 2.99, currency: 'EUR', cycle: 'monthly', every: 30, anchor: ymd(day(1)), remind: true, active: true, note: '', history: [] },
    { id: 'sub-2', name: 'Music', amount: 10.99, currency: 'EUR', cycle: 'monthly', every: 30, anchor: ymd(day(9)), remind: true, active: true, note: 'Family plan', history: [] },
    { id: 'sub-3', name: 'Domain name', amount: 14, currency: 'EUR', cycle: 'yearly', every: 30, anchor: ymd(day(64)), remind: true, active: true, note: '', history: [] },
    { id: 'sub-4', name: 'Gym', amount: 29.9, currency: 'EUR', cycle: 'custom', every: 28, anchor: ymd(day(17)), remind: true, active: true, note: '', history: [] }
  ],
  days, journal, weekRatings: {},
  game: { start: ymd(day(-DAYS)), campaign: { on: false, name: 'War Mode', start: T, len: 60, no: 1 }, campaigns: [], days: gameDays, missions, friction: {}, combo: {}, notif: { brief: T, 'sub:sub-1': T, overtake: T, habits: T, nomission: T, debrief: T, dayOpenedOn: T, dayOpened: Date.now(), lastIdle: Date.now() }, holds: 4, folds: 1, focusActId: slug('act', 'Deep Work') },
  lastActiveDay: T, tomb: {}, _rev: 1, _at: Date.now(), _dev: 'demo'
};
process.stdout.write(JSON.stringify(state));
