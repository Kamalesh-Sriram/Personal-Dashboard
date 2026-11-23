/* ══════════════════════════════════════════════════════════════════════
   NOTIFICATIONS

   Three layers, each a fallback for the one above it:

   1. In-app toasts: always.
   2. System notifications raised by the page: when permission is granted
      and the tab is alive but not on screen.
   3. Web Push: arrives with the app fully closed. A browser cannot
      schedule a notification for later, so this needs a server: the page
      PLANS the day's notifications into a queue (it holds all the logic),
      and a scheduled Netlify function sends whatever has come due. Needs
      the optional sync setup; see HOW-TO-USE.md.

   Platform notes
   • Chrome / Edge / Firefox on Windows, macOS, Android: works in a tab or
     installed.
   • Safari on macOS 13+: works in a tab or from the Dock.
   • iPhone / iPad (iOS 16.4+): only after "Add to Home Screen", and the
     permission prompt must come from a tap: which is why enabling is a
     button, never automatic.
   ══════════════════════════════════════════════════════════════════════ */
import { S, save, saveQuiet, onChange, DEVICE_ID } from './store.js';
import * as E from './engine.js';
import { toast, runAction, modalOpen } from './ui.js';
import { today, debounce, ymd, parseYmd, dateOf, minOfDay, clockToDayMin } from './util.js';
import * as Sync from './sync.js';

const hasNotif = typeof Notification !== 'undefined';
const hasSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
const isIOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let reg = null, sub = null;
const PIN_KEY = 'hq.v5.pinnedTimer';
const PLAN = 'plan:';

/** Where this device stands. Drives the bell icon and the Settings copy. */
export function pushState() {
  if (!hasNotif || !hasSW) return isIOS && !standalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'default';
  return sub ? 'subscribed' : 'granted';
}
export const pushSubscribed = () => !!sub;

/** Toast always. When the app is not on screen it reaches the device too:
 *  as a push when this device is registered (unless `planned`, which the
 *  server already sends at its time), otherwise as a system notification. */
export function notify(title, body = '', opts = {}) {
  toast(title, body, { ms: 11000, ...opts });
  if (document.visibilityState === 'visible') return;
  if (sub && Sync.signedIn()) { if (!opts.planned) pushEvent(opts.key || `${opts.tag || 'hq'}:${today()}:${title}`, title, body, { tag: opts.tag, raw: opts.raw }); return; }
  try {
    if (!hasNotif || Notification.permission !== 'granted') return;
    const o = { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: opts.tag || 'hq' };
    if (reg) reg.showNotification(title, o); else new Notification(title, o);
  } catch { /* Android Chrome throws on `new Notification`; the toast already showed */ }
}

/** The device's own system notification, with no server involved: for what
 *  a push cannot carry, such as being signed out of the account. Shows when
 *  notifications are allowed and the app is open somewhere, even out of sight. */
export function deviceNotify(title, body = '', tag = 'hq') {
  try {
    if (!hasNotif || Notification.permission !== 'granted') return;
    const o = { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag };
    if (reg) reg.showNotification(title, o); else new Notification(title, o);
  } catch { /* the toast already showed it */ }
}

/* ══════════════════════ IN-APP NUDGES ══════════════════════
   Runs on a slow tick. Every branch is rate-limited so it informs rather
   than nags. */
function idleAllowed() {
  const v = S().settings.notify.idle;
  return v === 'always' || (v === 'campaign' && S().game.campaign.on);
}
/** How long a quiet spell may run before "Nothing is running" speaks. With
 *  little done it is the gap you set; as focus adds up toward the day's
 *  target it stretches, up to three times as long, and once the target is
 *  reached it says nothing more. Being ahead of the rival stretches it a
 *  little further. At most IDLE_MAX reminders a day. */
const IDLE_MAX = 5;
export function idleGapMs() {
  const st = S(), t = today();
  const target = Math.max(0.5, Number(st.settings.targets.hours) || 6) * 3600000;
  const done = E.focusMsOn(t) / target;
  if (done >= 1) return null;
  let gap = Math.max(20, Number(st.settings.nudgeMins) || 60) * 60000 * (1 + 2 * done);
  if (st.settings.modules.shadow && E.dayXP(t) > E.shadowPaceNow()) gap *= 1.25;
  return gap;
}
export function nudgeTick() {
  const st = S(), g = st.game, n = g.notif, cfg = st.settings.notify;
  if (!st.profile.onboarded) return;
  const t = today(), now = Date.now(), w = E.winMinutes(), nowMin = E.nowMinutes();
  const inWindow = nowMin >= w.start && nowMin <= w.end;
  const rest = E.isRest(t), name = st.settings.labels.shadow;
  let dirty = false;

  if (!rest && inWindow && idleAllowed() && !E.runningActivity()) {
    const ends = E.sessionsOn(t, false).map(x => x.s.end);
    const since = ends.length ? Math.max(...ends) : (n.dayOpened && n.dayOpenedOn === t ? n.dayOpened : now);
    if (n.dayOpenedOn !== t) { n.dayOpenedOn = t; n.dayOpened = now; n.idleN = 0; dirty = true; }
    const gap = idleGapMs();
    if (gap && (n.idleN || 0) < IDLE_MAX && now - since > gap && now - (n.lastIdle || 0) > gap) {
      n.lastIdle = now; n.idleN = (n.idleN || 0) + 1; dirty = true;
      notify(name, E.voice('idle') || 'Nothing is running right now.', { tag: 'hq-idle', planned: true });
    }
  }

  if (!rest && st.settings.modules.shadow && cfg.overtake && inWindow) {
    const you = E.dayXP(t), pace = E.shadowPaceNow();
    if (pace > you && you > 0 && n.overtake !== t) { n.overtake = t; dirty = true; notify(`${name} just passed you`, `${name} is on ${pace} XP and you're on ${you}. ${E.voice('behind')}`.trim(), { tag: 'hq-overtake', planned: true }); }
    // the other way round: the first time in a day you pull ahead of his pace
    if (cfg.ahead !== false && you > pace && pace > 0 && n.ahead !== t) { n.ahead = t; dirty = true; notify(`You're ahead of ${name}`, `You're on ${you} XP and ${name} is on ${pace}. ${E.voice('ahead')}`.trim(), { tag: 'hq-ahead', raw: PLAN + `ahead:${t}` }); }
  }

  if (!rest && cfg.habits && nowMin >= hm(cfg.habitsAt) && n.habits !== t) {
    const open = E.habitsDue(t).filter(h => h.history[t] !== 'done').length;
    if (open > 0) { n.habits = t; dirty = true; notify('Habits left today', E.voice('habits', { n: open }) || `You still have ${open} habit${open > 1 ? 's' : ''} to check off today.`, { tag: 'hq-habits', planned: true }); }
  }

  if (st.settings.modules.mission && !rest) {
    // The brief opens the first time the app is on screen within two hours of its
    // time; later than that it would interrupt the work it was meant to start.
    const bAt = E.briefMin(), dAt = E.debriefMin();
    if (cfg.brief && n.brief !== t && nowMin >= bAt && nowMin <= bAt + 120 && nowMin < dAt && !modalOpen()) { n.brief = t; dirty = true; runAction('brief.open'); }
    if (cfg.brief && !E.hasMission(t) && n.nomission !== t && nowMin >= bAt + 180 && nowMin < dAt) { n.nomission = t; dirty = true; notify('No mission yet', E.voice('nomission') || 'Set one so the day has a target.', { tag: 'hq-mission', planned: true }); }
    if (cfg.debrief && nowMin >= dAt && n.debrief !== t && !modalOpen()) { n.debrief = t; dirty = true; notify('Time to close the day', E.voice('night') || 'Write up the day and plan tomorrow.', { tag: 'hq-debrief', planned: true }); runAction('debrief.open'); }
  }
  // A payment leaving tomorrow, said once, at 10:00 or the first time the app is open after that.
  if (cfg.subs && nowMin >= 10 * 60) {
    (st.subs || []).filter(x => x.active !== false && x.remind !== false).forEach(x => {
      const due = E.nextDueFor(x);
      if (!due || Math.round((due - new Date(t + 'T00:00:00')) / 86400000) !== 1) return;
      const key = 'sub:' + x.id;
      if (n[key] === t) return;
      n[key] = t; dirty = true;
      notify('Payment tomorrow', `${x.name} will charge ${x.amount} ${x.currency || st.settings.currency} tomorrow.`, { tag: 'hq-sub', planned: true });
    });
  }
  if (dirty) saveQuiet();
}
const hm = s => clockToDayMin(s || '20:00');

/* ══════════════════════ WEB PUSH ══════════════════════ */
function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function initNotify() {
  if (!hasSW) return;
  try {
    reg = await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'notification-click') Sync.pullNow(); });
    if (hasNotif && Notification.permission === 'granted' && Sync.signedIn()) await subscribe(false);
  } catch (e) { console.warn('service worker unavailable:', e.message); }
  onChange(kind => { if (kind !== 'quota') schedulePlan(); });
}

async function subscribe(interactive) {
  const cfg = await Sync.config();
  if (!reg || !cfg || !cfg.vapid || !Sync.signedIn()) return false;
  let s = await reg.pushManager.getSubscription();
  if (!s && interactive) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapid) });
  if (!s) return false;
  const res = await fetch('/.netlify/functions/push-subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await Sync.token()) },
    body: JSON.stringify({ device_id: DEVICE_ID, endpoint: s.endpoint, p256dh: b64u(s.getKey('p256dh')), auth: b64u(s.getKey('auth')), user_agent: navigator.userAgent })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not register this device');
  sub = s;
  schedulePlan();
  return true;
}

/** Called from a tap (required on iOS). Returns the resulting state. */
export async function enableNotifications() {
  const state = pushState();
  if (state === 'needs-install') { toast('Install the app first', 'On iPhone and iPad, notifications only work after Share > Add to Home Screen. Then open it from the home screen and tap the bell again.', { ms: 12000 }); return state; }
  if (state === 'unsupported') { toast('Not supported here', 'This browser has no notification support.', { kind: 'bad' }); return state; }
  if (state === 'denied') { toast('Notifications are blocked', 'Allow them for this site in your browser or system settings, then tap the bell again.', { kind: 'bad', ms: 10000 }); return state; }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') { toast('Notifications are still off', 'You can turn them on any time from the bell.'); return pushState(); }
  try {
    if (await subscribe(true)) toast('Notifications are on', "You'll get them even when the app is closed.", { kind: 'good' });
    else toast('Notifications are on while the app is open', 'To get them with the app closed, set up sync and sign in under Settings > Sync.', { ms: 10000 });
  } catch (e) { toast('Could not finish push setup', e.message, { kind: 'bad', ms: 10000 }); }
  return pushState();
}

export async function testNotification() {
  if (!sub) { notify('Test notification', 'This is what a reminder looks like.'); if (document.visibilityState === 'visible') toast('Test sent', "You only see system notifications when the app isn't on screen.", { ms: 5000 }); return; }
  try {
    await Sync.rest('POST', 'push_queue?on_conflict=user_id,dedupe_key', [{
      dedupe_key: 'test:' + Date.now(), send_at: new Date().toISOString(), expires_at: null, repeat_sec: null,
      kind: 'test', title: 'Test notification', body: 'Notifications are working on this device.', tag: 'hq-test', ongoing: false, silent: false, data: {}
    }], 'resolution=merge-duplicates,return=minimal');
    flush();
    toast('Test sent', 'It should appear as a system notification in a few seconds.', { ms: 8000 });
  } catch (e) { toast('Test failed', e.message, { kind: 'bad', ms: 10000 }); }
}
const flush = async () => {
  try { await fetch('/.netlify/functions/push-now', { method: 'POST', headers: { Authorization: 'Bearer ' + (await Sync.token()) } }); } catch { /* the minute tick will get it */ }
};

/** Queue one push for an event: now, or at `at` (ms). Each key is sent once.
 *  Rows are not "plan:" rows, so re-planning the day never removes them. */
export async function pushEvent(key, title, body = '', { tag = 'hq', at = Date.now(), raw = '' } = {}) {
  if (!sub || !Sync.signedIn()) return false;
  try {
    // `raw` reuses a planned row's key: if the server has not sent it yet it is moved to now, and if
    // it has, the database refuses the change, so the same news never arrives twice
    await Sync.rest('POST', 'push_queue?on_conflict=user_id,dedupe_key', [{
      dedupe_key: raw || 'ev:' + key, send_at: new Date(at).toISOString(), expires_at: null, repeat_sec: null,
      kind: 'nudge', title, body, tag, ongoing: false, silent: false, data: {}
    }], `resolution=${raw ? 'merge' : 'ignore'}-duplicates,return=minimal`);
    if (at <= Date.now() + 2000) flush();
    return true;
  } catch { return false; }
}
export const pushReady = () => !!sub && Sync.signedIn();

/* ── the plan: everything still ahead of us today ── */
function pinned(v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(PIN_KEY) || 'null');
    if (v === null) localStorage.removeItem(PIN_KEY); else localStorage.setItem(PIN_KEY, JSON.stringify(v));
  } catch { /* ignore */ }
  return null;
}
// minutes are counted from the midnight that opened the working day, so 1470 is 00:30 the next morning
const atMin = mins => { const d = parseYmd(today()); d.setMinutes(Math.round(mins)); return d.toISOString(); };

function buildPlan() {
  const st = S(), g = st.game, cfg = st.settings.notify, name = st.settings.labels.shadow;
  const t = today(), w = E.winMinutes(), nowMin = E.nowMinutes(), now = new Date();
  const rows = [];
  // Every row carries the same keys: PostgREST rejects a batch of mixed shapes.
  const add = r => rows.push({ send_at: '', expires_at: null, repeat_sec: null, kind: 'nudge', title: '', body: '', tag: 'hq', ongoing: false, silent: false, data: {}, ...r, dedupe_key: PLAN + r.dedupe_key });
  const running = E.runningActivity();
  const rest = E.isRest(t);

  if (!rest) {
    const step = idleGapMs(), left = IDLE_MAX - (g.notif.idleN && g.notif.dayOpenedOn === t ? g.notif.idleN : 0);
    if (idleAllowed() && !running && step && left > 0) {
      const ends = E.sessionsOn(t, false).map(x => x.s.end);
      const base = ends.length ? Math.max(...ends) : Date.now();
      for (let k = 1, n = 0; k <= 40 && n < Math.min(3, left); k++) {
        const when = new Date(base + k * step);
        if (when <= now) continue;
        const m = minOfDay(when.getTime(), t);
        if (dateOf(when.getTime()) !== t || m > w.end) break;
        if (m < w.start) continue;
        // keyed by the minute it is due, so a sent row is never reused
        add({ dedupe_key: `idle:${t}:${m}`, send_at: when.toISOString(), title: name, body: E.voice('idle') || 'Nothing is running right now.', tag: 'hq-idle' });
        n++;
      }
    }
    if (st.settings.modules.shadow && cfg.overtake) {
      // His pace is linear, so the moment he passes you is solvable in advance.
      const you = E.dayXP(t), sx = E.shadowXP(t);
      if (you > 0 && sx > 0 && !running) {
        const cross = w.start + w.total * (you / sx);
        if (cross > nowMin && cross <= w.end) add({ dedupe_key: `overtake:${t}`, send_at: atMin(cross), title: `${name} just passed you`, body: E.voice('behind') || "You're behind pace.", tag: 'hq-overtake' });
      }
    }
    if (st.settings.modules.shadow && cfg.ahead !== false && running && g.notif.ahead !== t) {
      // With a work timer running you gain XP at a steady rate and he at his, so the minute you
      // pass his pace can be worked out now and sent with the app closed. Re-planned on any change.
      const you = E.dayXP(t), sx = E.shadowXP(t), pace = E.shadowPaceNow(), x = st.settings.xp;
      const tier = E.TIERS[E.tierOf(running)], combo = E.dayScore(t).combo.mult;
      const rate = E.countsAsFocus(running) ? x.perHour / 60 * tier.mult * combo * E.blockRate(running, { date: t, dur: E.COMBO.minMs, live: true }) : 0;
      const his = sx / Math.max(1, w.total);
      if (you <= pace && rate > his) {
        const at = nowMin + (pace - you) / (rate - his) + 1;
        if (at > nowMin && at <= w.end) add({ dedupe_key: `ahead:${t}`, send_at: atMin(at), title: `You're ahead of ${name}`, body: E.voice('ahead') || "You're ahead of pace. Keep going.", tag: 'hq-ahead' });
      }
    }
    if (st.settings.modules.mission) {
      const bAt = E.briefMin(), dAt = E.debriefMin();
      if (cfg.brief && !E.hasMission(t) && g.notif.brief !== t && nowMin < bAt) add({ dedupe_key: `brief:${t}`, send_at: atMin(bAt), title: 'Morning brief', body: E.voice('morning') || "Set today's mission.", tag: 'hq-mission' });
      if (cfg.brief && !E.hasMission(t) && nowMin < bAt + 180 && bAt + 180 < dAt) add({ dedupe_key: `nomission:${t}`, send_at: atMin(bAt + 180), title: 'No mission yet', body: E.voice('nomission') || 'Set one so the day has a target.', tag: 'hq-mission' });
      if (cfg.debrief && nowMin < dAt && g.notif.debrief !== t) add({ dedupe_key: `debrief:${t}`, send_at: atMin(dAt), title: 'Time to close the day', body: E.voice('night') || 'Write up the day and plan tomorrow.', tag: 'hq-debrief' });
    }
    if (cfg.habits && nowMin < hm(cfg.habitsAt)) {
      const open = E.habitsDue(t).filter(h => h.history[t] !== 'done').length;
      if (open > 0) add({ dedupe_key: `habits:${t}`, send_at: atMin(hm(cfg.habitsAt)), title: 'Habits left today', body: E.voice('habits', { n: open }) || `You still have ${open} habit${open > 1 ? 's' : ''} to check off today.`, tag: 'hq-habits' });
    }
  }
  if (cfg.subs) {
    (st.subs || []).filter(x => x.active !== false && x.remind !== false).forEach(x => {
      const due = E.nextDueFor(x);
      if (!due) return;
      const days = Math.round((due - new Date(t + 'T00:00:00')) / 86400000);
      if (days !== 1) return;
      const at = Math.max(10 * 60, nowMin + 1);
      if (at > 23 * 60) return;
      add({ dedupe_key: `sub:${x.id}:${ymd(due)}`, send_at: atMin(at), title: 'Payment tomorrow', body: `${x.name} will charge ${x.amount} ${x.currency || st.settings.currency} tomorrow.`, tag: 'hq-sub' });
    });
  }
  if (cfg.timer) {
    if (running) {
      const end = parseYmd(t); end.setMinutes(w.end);
      // The task if there is one, otherwise the activity. The function that
      // sends it adds how long it has been running, since only it knows the time.
      const task = E.runningTaskName(running);
      // keyed by when this run began, so a second timer the same day is a new row, not a clash with the first
      add({ dedupe_key: `timer:${running.lastStart}`, send_at: new Date().toISOString(), repeat_sec: 55, kind: 'timer', ongoing: true, silent: true, tag: 'hq-timer',
            expires_at: new Date(Math.min(running.lastStart + E.MAX_RUN_MS, Math.max(end.getTime(), Date.now() + 3600000))).toISOString(),
            title: (task || E.label(running)).slice(0, 120), data: { started_at: running.lastStart, sub: task ? E.label(running) : '' } });
      pinned({ name: task || running.name, lastStart: running.lastStart });
    } else {
      const prior = pinned();
      if (prior) {
        add({ dedupe_key: `timer_clear:${t}:${Date.now()}`, send_at: new Date().toISOString(), kind: 'timer_clear', tag: 'hq-timer', silent: true, title: 'Session logged', body: prior.name || '' });
        pinned(null);
      }
    }
  }
  return rows;
}
let lastPrint = '';
function fingerprint() {
  const st = S(), t = today(), r = E.runningActivity();
  return [t, st.game.campaign.on, st.settings.window.start, st.settings.window.end, st.settings.nudgeMins, JSON.stringify(st.settings.notify), Math.round(E.focusMsOn(t) / 900000),
    r ? r.id + '@' + r.lastStart + '@' + E.runningTaskName(r) : '-', E.hasMission(t), E.isRest(t), st.game.notif.debrief === t,
    E.habitsDue(t).filter(h => h.history[t] !== 'done').length, Math.round(E.dayXP(t) / 25), st.game.notif.ahead === t, Math.round(E.dayScore(t).combo.mult * 10),
    (st.subs || []).map(x => x.id + ':' + x.anchor + ':' + (x.remind !== false)).join(',')].join('|');
}
/** What the last planning run did, for Settings > Notifications. */
const planInfo = { at: 0, count: 0, error: '', next: null };
export const planStatus = () => ({ ...planInfo, subscribed: !!sub, signedIn: Sync.signedIn() });
let planning = false, planAgain = false;
async function plan(force) {
  if (!sub || !Sync.signedIn()) return;
  if (planning) { planAgain = true; return; }
  const p = fingerprint();
  if (!force && p === lastPrint) return;
  lastPrint = p;
  planning = true;
  try {
    const rows = buildPlan();
    await Sync.rest('DELETE', `push_queue?sent_at=is.null&dedupe_key=like.${encodeURIComponent(PLAN)}*`);
    // "ignore-duplicates", not "merge": a notification that has already gone out
    // today keeps its row, and updating a sent row is forbidden by the database.
    // Merging made that one clash reject the WHOLE batch, so after the first
    // "he passed you" of the day nothing else was queued: no timer, no callouts.
    if (rows.length) await Sync.rest('POST', 'push_queue?on_conflict=user_id,dedupe_key', rows, 'resolution=ignore-duplicates,return=minimal');
    if (rows.some(r => new Date(r.send_at) <= new Date())) flush();
    const upcoming = rows.filter(r => r.kind === 'nudge').map(r => Date.parse(r.send_at)).filter(x => x > Date.now()).sort((a, b) => a - b);
    Object.assign(planInfo, { at: Date.now(), count: rows.length, error: '', next: upcoming[0] || null });
  } catch (e) {
    lastPrint = '';                                    // the next change retries
    Object.assign(planInfo, { at: Date.now(), error: /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Offline: it will be planned again when you are back online.' : e.message });
  } finally {
    planning = false;
    if (planAgain) { planAgain = false; plan(false); }
  }
}
const planSoon = debounce(() => plan(false), 6000);
let lastRun = '';
/** Most changes can wait a few seconds. A timer starting or stopping cannot:
 *  the app is often closed straight afterwards. */
export function schedulePlan() {
  const r = E.runningActivity(), key = r ? r.id + '@' + r.lastStart : '-';
  if (key !== lastRun) { lastRun = key; plan(false); } else planSoon();
}
export const replanNow = () => plan(true);
// leaving the app: make sure what is planned matches what is true right now
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') plan(false); });
