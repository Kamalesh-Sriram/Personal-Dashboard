/* Gym and finance arithmetic. No browser needed:  npm test  */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../app/js/gymcalc.js';
import * as F from '../app/js/fincalc.js';
import { parseCsv, parseAmount } from '../app/js/csv.js';

/* ── csv ── */
test('csv: quotes, doubled quotes, semicolons and a byte-order mark', () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCsv('a;b;c\r\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});
test('amounts are read whichever way the bank writes them', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('-12,5'), -12.5);
  assert.equal(parseAmount('€ 12.50'), 12.5);
  assert.equal(parseAmount('(12.50)'), -12.5);
  assert.equal(parseAmount(''), null);
});

/* ── gym ── */
const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push","10 Nov 2026, 18:00","10 Nov 2026, 19:05","","Bench Press (Barbell)",,"",0,"warmup",40,10,,,
"Push","10 Nov 2026, 18:00","10 Nov 2026, 19:05","","Bench Press (Barbell)",,"",1,"normal",80,8,,,
"Push","10 Nov 2026, 18:00","10 Nov 2026, 19:05","","Bench Press (Barbell)",,"",2,"normal",80,7,,,
"Push","10 Nov 2026, 18:00","10 Nov 2026, 19:05","","Pull Up",,"",0,"normal",,9,,,
"Push","13 Nov 2026, 18:00","13 Nov 2026, 19:00","","Bench Press (Barbell)",,"",0,"normal",80,8,,,
"Push","13 Nov 2026, 18:00","13 Nov 2026, 19:00","","Bench Press (Barbell)",,"",1,"normal",80,8,,,`;

test('a Hevy export becomes workouts, warm-ups apart from working sets', () => {
  const { source, workouts } = G.fromCsv(HEVY);
  assert.equal(source, 'Hevy');
  assert.equal(workouts.length, 2);
  assert.equal(workouts[0].ex.length, 2);
  assert.equal(workouts[0].ex[0].sets.length, 3);
  assert.equal(G.setsOf(workouts[0]), 3);                       // the warm-up is not counted
  assert.equal(G.volumeOf(workouts[0]), 80 * 8 + 80 * 7);       // bodyweight pull-ups add no volume
  const bench = G.exercises(workouts).find(e => e.name.startsWith('Bench'));
  assert.equal(bench.sessions.length, 2);
  assert.ok(Math.abs(bench.best - 80 * (1 + 8 / 30)) < 0.01);
});
test('a Strong export is read too, in pounds if it says so', () => {
  const csv = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE,Weight Unit\n2026-11-10 18:00:00,Legs,1h 5m,Squat (Barbell),1,220,5,0,0,,,,lbs\n2026-11-10 18:00:00,Legs,1h 5m,Squat (Barbell),W,135,5,0,0,,,,lbs';
  const { source, workouts } = G.fromCsv(csv);
  assert.equal(source, 'Strong');
  assert.equal(workouts[0].end - workouts[0].start, 65 * 60000);
  assert.ok(Math.abs(workouts[0].ex[0].sets[0].kg - 99.79) < 0.01);
  assert.equal(workouts[0].ex[0].sets[1].t, 'warmup');
  assert.throws(() => G.fromCsv('a,b\n1,2'), /not a Hevy or Strong export/);
});
test('the next-session suggestion follows double progression', () => {
  const se = (ts, ...sets) => ({ ts, sets: sets.map(([kg, reps]) => ({ t: 'normal', kg, reps })) });
  // every set at the ceiling (usual 8, so 10): add weight
  let s = G.suggest([se(1, [80, 8], [80, 8]), se(2, [80, 9], [80, 8]), se(3, [80, 10], [80, 10])]);
  assert.equal(s.kind, 'add'); assert.equal(s.kg, 82.5);
  // short of it: one more rep on every set
  s = G.suggest([se(1, [80, 8], [80, 7]), se(2, [80, 8], [80, 8])]);
  assert.equal(s.kind, 'reps'); assert.equal(s.kg, 80); assert.equal(s.reps, 9);
  // three flat sessions: back off by a tenth, in plate steps
  s = G.suggest([se(1, [100, 5], [100, 5]), se(2, [100, 5], [100, 4]), se(3, [100, 5], [100, 4])]);
  assert.equal(s.kind, 'deload'); assert.equal(s.kg, 90);
  // no weight: a rep more
  s = G.suggest([se(1, [0, 9]), se(2, [0, 10])]);
  assert.equal(s.kind, 'reps'); assert.equal(s.reps, 11);
  assert.equal(G.suggest([]), null);
});
test('weeks and the summary count workouts where they fall', () => {
  const now = new Date(2026, 10, 15, 12).getTime(), w = d => ({ id: 'w' + d, title: 'x', start: new Date(2026, 10, d, 18).getTime(), end: 0, ex: [{ name: 'Row', tid: '', sets: [{ t: 'normal', kg: 50, reps: 10 }] }] });
  const list = [w(2), w(4), w(10), w(13)];
  const wk = G.weeks(list, 3, now);
  assert.deepEqual(wk.map(x => x.count), [0, 2, 2]);              // the weeks beginning Mon 26 Oct, 2 Nov and 9 Nov
  const sum = G.summary(list, now);
  assert.equal(sum.count30, 4); assert.equal(sum.vol30, 2000); assert.equal(sum.thisWeek, 2);
});

/* ── finance ── */
test('a Revolut statement: completed rows only, fees included, transfers recognised', () => {
  const csv = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCARD_PAYMENT,Current,2026-11-03 10:00:00,2026-11-04 08:00:00,Albert Heijn,-23.45,0.00,EUR,COMPLETED,100\nCARD_PAYMENT,Current,2026-11-05 10:00:00,2026-11-05 11:00:00,Uber,-12.00,0.50,EUR,COMPLETED,87\nCARD_PAYMENT,Current,2026-11-05 10:00:00,,Declined shop,-99.00,0.00,EUR,DECLINED,87\nTOPUP,Current,2026-11-06 09:00:00,2026-11-06 09:00:00,Top-Up by *1234,200.00,0.00,EUR,COMPLETED,287';
  const { format, txs } = F.readStatement(csv);
  assert.equal(format, 'Revolut'); assert.equal(txs.length, 3);
  const ah = txs.find(t => t.n === 'Albert Heijn'), uber = txs.find(t => t.n === 'Uber'), top = txs.find(t => t.a > 0);
  assert.equal(ah.d, '2026-11-04'); assert.equal(ah.cat, 'groceries');
  assert.equal(uber.a, -12.5); assert.equal(uber.cat, 'transport');
  assert.equal(top.cat, 'transfer');
  const again = F.readStatement(csv).txs;
  assert.deepEqual(again.map(t => t.id), txs.map(t => t.id));     // importing twice gives the same ids
});
test('ABN AMRO: the TXT download has no header and hides the name in the description', () => {
  const txt = '123456789\tEUR\t20261103\t1000,00\t976,55\t20261103\t-23,45\tBEA, Betaalpas   Jumbo Delft,PAS123   NR:XY12, 03.11.26/12:01\n123456789\tEUR\t20261105\t976,55\t2976,55\t20261105\t2000,00\t/TRTP/SEPA OVERBOEKING/IBAN/NL00BANK0123456789/BIC/BANKNL2A/NAME/Werkgever BV/REMI/Salaris november/EREF/123';
  const { format, txs } = F.readStatement(txt);
  assert.equal(format, 'ABN AMRO');
  assert.equal(txs[0].n, 'Jumbo Delft'); assert.equal(txs[0].a, -23.45); assert.equal(txs[0].d, '2026-11-03'); assert.equal(txs[0].cat, 'groceries');
  assert.equal(txs[1].n, 'Werkgever BV'); assert.equal(txs[1].m, 'Salaris november'); assert.equal(txs[1].cat, 'income');
});
test('any other CSV: columns are guessed from the header, or you are asked', () => {
  const ing = 'Datum;Naam / Omschrijving;Rekening;Af Bij;Bedrag (EUR);Mededelingen\n20261103;NS GROEP IZ NS REIZIGERS;NL01;Af;14,20;Pasvolgnr 1\n20261104;J. Jansen;NL01;Bij;50,00;Tikkie';
  const r = F.readStatement(ing);
  assert.equal(r.format, 'CSV');
  assert.equal(r.txs[0].a, -14.2); assert.equal(r.txs[0].cat, 'transport');
  assert.equal(r.txs[1].a, 50);
  const odd = F.readStatement('foo,bar,baz\n1,2,3');
  assert.equal(odd.needMap, true);
  const told = F.readStatement('when,what,how much\n03/11/2026,Coffee,-3.20', { map: { date: 0, name: 1, amount: 2 } });
  assert.equal(told.txs[0].d, '2026-11-03'); assert.equal(told.txs[0].a, -3.2);
});
test('your own rules beat the built-in hints, and never touch what you sorted by hand', () => {
  const txs = F.readStatement('date,description,amount\n2026-11-01,Shell Delft,-40\n2026-11-02,Corner shop 0042,-8\n2026-11-03,Corner shop 0077,-6', {}).txs;
  assert.equal(txs[0].cat, 'transport'); assert.equal(txs[1].cat, '');
  assert.equal(F.ruleKey(txs[1]), 'corner shop');
  txs[2].cat = 'eating'; txs[2].man = true;
  const changed = F.recategorise(txs, [{ id: 'r1', match: 'corner shop', cat: 'groceries' }, { id: 'r2', match: 'shell', cat: 'travel' }]);
  assert.equal(changed.length, 2);
  assert.equal(txs[0].cat, 'travel'); assert.equal(txs[1].cat, 'groceries'); assert.equal(txs[2].cat, 'eating');
});
test('totals leave transfers out, and a refund lowers its category', () => {
  const tx = (a, cat) => ({ id: String(Math.random()), d: '2026-11-10', a, cur: 'EUR', n: '', m: '', acc: '', cat });
  const t = F.totals([tx(-100, 'groceries'), tx(-40, 'shopping'), tx(15, 'shopping'), tx(2000, 'income'), tx(-500, 'transfer'), tx(500, 'transfer'), tx(-10, '')], F.DEFAULT_CATS);
  assert.equal(t.spent, 135); assert.equal(t.income, 2000); assert.equal(t.net, 1865);
  assert.deepEqual(t.rows.map(r => [r.id, r.v]), [['groceries', 100], ['shopping', 25], ['', 10]]);
});
test('a transaction from the bank link takes the same shape as one from a file', () => {
  const t = F.fromBank({ entry_reference: 'E1', transaction_amount: { currency: 'EUR', amount: '23.45' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-03', creditor: { name: 'Albert Heijn 1234' }, remittance_information: ['Betaalpas'] }, 'ABN ••1234');
  assert.equal(t.a, -23.45); assert.equal(t.d, '2026-11-03'); assert.equal(t.n, 'Albert Heijn 1234'); assert.equal(t.cat, 'groceries'); assert.equal(t.src, 'bank');
  assert.ok(t.id.startsWith('b-'));
  assert.equal(F.fromBank({ transaction_amount: {} }, 'x'), null);
});
test('dates in the spellings banks use', () => {
  assert.equal(F.parseDate('2026-11-03 10:00:00'), '2026-11-03');
  assert.equal(F.parseDate('20261103'), '2026-11-03');
  assert.equal(F.parseDate('03-11-2026'), '2026-11-03');
  assert.equal(F.parseDate('3/11/2026'), '2026-11-03');
  assert.equal(F.parseDate('11/25/2026'), '2026-11-25');            // only one reading is possible
  assert.equal(F.parseDate('nonsense'), '');
});
