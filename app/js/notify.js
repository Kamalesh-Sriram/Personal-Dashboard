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

/** Toast always; system notification only when the app is not on screen
 *  and push is not already going to deliver the same thing. */
export function notify(title, body = '', opts = {}) {
  toast(title, body, { ms: 11000, ...opts });
  try {
    if (sub || !hasNotif || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    const o = { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: opts.tag || 'hq' };
    if (reg) reg.showNotification(title, o); else new Notification(title, o);
  } catch { /* Android Chrome throws on `new Notification`; the toast already showed */ }
}

/* ══════════════════════ IN-APP NUDGES ══════════════════════
   Runs on a slow tick. Every branch is rate-limited so it informs rather
   than nags. */
function idleAllowed() {
  const v = S().settings.notify.idle;
  return v === 'always' || (v === 'campaign' && S().game.campaign.on);
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
    if (n.dayOpenedOn !== t) { n.dayOpenedOn = t; n.dayOpened = now; dirty = true; }
    const gap = st.settings.nudgeMins * 60000;
    if (now - since > gap && now - (n.lastIdle || 0) > gap) { n.lastIdle = now; dirty = true; notify(name, E.voice('idle') || 'Nothing is running right now.', { tag: 'hq-idle' }); }
  }

  if (!rest && st.settings.modules.shadow && cfg.overtake && inWindow) {
    const you = E.dayXP(t), pace = E.shadowPaceNow();
    if (pace > you && you > 0 && n.overtake !== t) { n.overtake = t; dirty = true; notify(`${name} just passed you`, `${name} is on ${pace} XP and you're on ${you}. ${E.voice('behind')}`.trim(), { tag: 'hq-overtake' }); }
  }

  if (!rest && cfg.habits && nowMin >= hm(cfg.habitsAt) && n.habits !== t) {
    const open = E.habitsDue(t).filter(h => h.history[t] !== 'done').length;
    if (open > 0) { n.habits = t; dirty = true; notify('Habits left today', E.voice('habits', { n: open }) || `You still have ${open} habit${open > 1 ? 's' : ''} to check off today.`, { tag: 'hq-habits' }); }
  }

  if (st.settings.modules.mission && !rest) {
    // The brief opens the first time the app is on screen within two hours of its
    // time; later than that it would interrupt the work it was meant to start.
    const bAt = E.briefMin(), dAt = E.debriefMin();
    if (cfg.brief && n.brief !== t && nowMin >= bAt && nowMin <= bAt + 120 && nowMin < dAt && !modalOpen()) { n.brief = t; dirty = true; runAction('brief.open'); }
    if (cfg.brief && !E.hasMission(t) && n.nomission !== t && nowMin >= bAt + 180 && nowMin < dAt) { n.nomission = t; dirty = true; notify('No mission yet', E.voice('nomission') || 'Set one so the day has a target.', { tag: 'hq-mission' }); }
    if (cfg.debrief && nowMin >= dAt && n.debrief !== t && !modalOpen()) { n.debrief = t; dirty = true; notify('Time to close the day', E.voice('night') || 'Write up the day and plan tomorrow.', { tag: 'hq-debrief' }); runAction('debrief.open'); }
  }
  // A payment leaving tomorrow, said once, at 10:00 or the first time the app is open after that.
  if (cfg.subs && nowMin >= 10 * 60) {
    (st.subs || []).filter(x => x.active !== false && x.remind !== false).forEach(x => {
      const due = E.nextDueFor(x);
      if (!due || Math.round((due - new Date(t + 'T00:00:00')) / 86400000) !== 1) return;
      const key = 'sub:' + x.id;
      if (n[key] === t) return;
      n[key] = t; dirty = true;
      notify('Payment tomorrow', `${x.name} will charge ${x.amount} ${x.currency || st.settings.currency} tomorrow.`, { tag: 'hq-sub' });
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
    if (idleAllowed() && !running) {
      const ends = E.sessionsOn(t, false).map(x => x.s.end);
      const base = ends.length ? Math.max(...ends) : Date.now();
      const step = Math.max(10, st.settings.nudgeMins) * 60000;
      for (let k = 1, n = 0; k <= 40 && n < 8; k++) {
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
      add({ dedupe_key: `timer:${t}`, send_at: new Date().toISOString(), repeat_sec: 55, kind: 'timer', ongoing: true, silent: true, tag: 'hq-timer',
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
  return [t, st.game.campaign.on, st.settings.window.start, st.settings.window.end, st.settings.nudgeMins, JSON.stringify(st.settings.notify),
    r ? r.id + '@' + r.lastStart + '@' + E.runningTaskName(r) : '-', E.hasMission(t), E.isRest(t), st.game.notif.debrief === t,
    E.habitsDue(t).filter(h => h.history[t] !== 'done').length, Math.round(E.dayXP(t) / 25),
    (st.subs || []).map(x => x.id + ':' + x.anchor + ':' + (x.remind !== false)).join(',')].join('|');
}
async function plan(force) {
  if (!sub || !Sync.signedIn()) return;
  const p = fingerprint();
  if (!force && p === lastPrint) return;
  lastPrint = p;
  try {
    const rows = buildPlan();
    await Sync.rest('DELETE', `push_queue?sent_at=is.null&dedupe_key=like.${encodeURIComponent(PLAN)}*`);
    if (rows.length) await Sync.rest('POST', 'push_queue?on_conflict=user_id,dedupe_key', rows, 'resolution=merge-duplicates,return=minimal');
    if (rows.some(r => new Date(r.send_at) <= new Date())) flush();
  } catch { lastPrint = ''; /* offline: the next change retries */ }
}
export const schedulePlan = debounce(() => plan(false), 6000);
export const replanNow = () => plan(true);
