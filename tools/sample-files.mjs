/* Writes two made-up files for trying the Gym and Finance tabs without your
   own data:

     node tools/sample-files.mjs      (or: npm run samples)

   sample-gym.csv   a Hevy-style export: import it on the Gym tab
   sample-bank.csv  a Revolut-style statement: import it on the Finance tab
   Everything in them is invented. */
import fs from 'node:fs';
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = off => { const d = new Date(); d.setHours(18, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
const hv = d => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* gym: 14 weeks, three sessions a week, slow progress */
const plans = {
  Push: [['Bench Press (Barbell)', 70, 8], ['Overhead Press (Barbell)', 40, 8], ['Triceps Pushdown', 25, 12]],
  Pull: [['Deadlift (Barbell)', 110, 5], ['Lat Pulldown (Cable)', 55, 10], ['Pull Up', 0, 8]],
  Legs: [['Squat (Barbell)', 85, 6], ['Leg Press', 140, 10], ['Plank', 0, 0]]
};
let g = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n';
const state = {};
for (let w = 14; w >= 0; w--) {
  ['Push', 'Pull', 'Legs'].forEach((name, i) => {
    const off = -w * 7 + [0, 2, 4][i] - 6;
    if (off > 0 || rnd() < 0.12) return;
    const s = day(off), e = new Date(s.getTime() + (55 + Math.floor(rnd() * 25)) * 60000);
    plans[name].forEach(([ex, kg0, reps0]) => {
      const st = state[ex] || (state[ex] = { kg: kg0, reps: reps0 });
      const row = (idx, type, kg, reps, sec) => { g += `"${name}","${hv(s)}","${hv(e)}","","${ex}",,"",${idx},"${type}",${kg || ''},${reps || ''},,${sec || ''},\n`; };
      if (ex === 'Plank') { [60 + (14 - w) * 3, 55 + (14 - w) * 3].forEach((sec, k) => row(k, 'normal', 0, 0, sec)); return; }
      if (kg0) row(0, 'warmup', Math.round(st.kg * 0.5 / 2.5) * 2.5, 10);
      const sets = [st.reps, st.reps - (rnd() < 0.5 ? 1 : 0), st.reps - (rnd() < 0.6 ? 1 : 0)];
      sets.forEach((r, k) => row(k + 1, 'normal', st.kg, Math.max(1, r)));
      // progress: reps climb, then weight goes up and reps reset
      if (rnd() < 0.7) st.reps++;
      const top = reps0 <= 6 ? 8 : reps0 <= 9 ? 10 : 15;
      if (kg0 && st.reps > top) { st.kg += 2.5; st.reps = reps0; }
    });
  });
}
fs.writeFileSync('sample-gym.csv', g);

/* bank: five months of a plausible account, Revolut's layout */
const shops = [['Albert Heijn 1021', 18, 55, 9], ['Jumbo Delft', 12, 40, 4], ['NS Reizigers', 6, 28, 5], ['Thuisbezorgd.nl', 14, 32, 3], ['Bol.com', 15, 90, 1], ['Basic-Fit', 24.99, 24.99, 1], ['Spotify', 10.99, 10.99, 1], ['Netflix', 13.99, 13.99, 1], ['Vattenfall', 96, 96, 1], ['Cafe De Ruif', 8, 26, 3], ['Shell Delft', 40, 70, 1], ['Kapsalon Mo', 22, 22, 0.4], ['Pathe Delft', 13, 26, 0.7], ['Coolblue', 30, 220, 0.4], ['Wibbe & Zn', 5, 19, 2]];
let b = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n';
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
let bal = 1800;
const now = new Date();
for (let m = 4; m >= 0; m--) {
  const first = new Date(now.getFullYear(), now.getMonth() - m, 1), last = m === 0 ? now.getDate() : new Date(now.getFullYear(), now.getMonth() - m + 1, 0).getDate();
  const rows = [];
  const add = (dd, type, desc, amt) => { const d = new Date(first.getFullYear(), first.getMonth(), Math.min(last, Math.max(1, dd)), 9 + Math.floor(rnd() * 11), Math.floor(rnd() * 60)); rows.push([d, type, desc, amt]); };
  if (last >= 25 || m > 0) add(25, 'TRANSFER', 'Payment from Werkgever BV', 2450);
  add(1, 'TRANSFER', 'To Huur Woning Delft', -780);
  add(2, 'TRANSFER', 'To pocket Savings', -150);
  shops.forEach(([n, lo, hi, per]) => { const k = Math.floor(per * (last / 30) + rnd()); for (let i = 0; i < k; i++) add(1 + Math.floor(rnd() * last), 'CARD_PAYMENT', n, -(lo + rnd() * (hi - lo))); });
  rows.sort((x, y) => x[0] - y[0]).forEach(([d, type, desc, amt]) => { bal += amt; b += `${type},Current,${iso(d)},${iso(d)},${desc},${amt.toFixed(2)},0.00,EUR,COMPLETED,${bal.toFixed(2)}\n`; });
}
fs.writeFileSync('sample-bank.csv', b);
console.log('Wrote sample-gym.csv and sample-bank.csv');
