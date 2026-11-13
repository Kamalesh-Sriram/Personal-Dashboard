/* ══════════════════════════════════════════════════════════════════════
   MAIN: boot, shell (sidebar + header), routing, the clock tick.

   Rendering model: a view is a function that returns an HTML string. Any
   save() re-renders the current view on the next frame. That keeps every
   view stateless and makes tab switches instant: there are no
   transitions to wait for.
   ══════════════════════════════════════════════════════════════════════ */
import { S, saveQuiet, onChange, APP_VERSION } from './store.js';
import * as E from './engine.js';
import { applyTheme, loadBgImage } from './theme.js';
import { initDelegation, registerActions, toast, modalOpen, openModal } from './ui.js';
import { icon } from './icons.js';
import { esc, today, fmtTimer, fmtDate, pad } from './util.js';
import { ui, setRefresh, go } from './bus.js';
import { VIEWS, TAB_META } from './views/index.js';
import { focusOpen, stopAndRate } from './flows.js';
import { initNotify, nudgeTick, notify, pushState, enableNotifications, testNotification } from './notify.js';
import * as Sync from './sync.js';
import { startOnboarding } from './views/onboarding.js';

const $ = id => document.getElementById(id);
const isDrawer = () => S().settings.sidebar === 'hidden' || matchMedia('(max-width: 760px)').matches;
const visibleTabs = () => S().settings.tabs.order.filter(t => !S().settings.tabs.hidden.includes(t));

/* ── shell ── */
function badgeFor(tab) {
  if (tab === 'habits') { const n = E.habitsDue(today()).filter(h => h.history[today()] !== 'done').length; return n && !E.isRest(today()) ? n : 0; }
  if (tab === 'subs') return VIEWS.subs.dueSoon ? VIEWS.subs.dueSoon() : 0;
  return 0;
}
function renderSide() {
  const st = S(), open = sideOpen();
  const item = (tab, key) => {
    const m = TAB_META[tab], b = badgeFor(tab);
    return `<button class="nav-item ${ui.tab === tab ? 'on' : ''}" data-act="nav.go" data-tab="${tab}" title="${esc(m.label)}${key ? ` (${key})` : ''}" ${ui.tab === tab ? 'aria-current="page"' : ''}>
      <span class="nav-ico">${icon(m.icon)}</span><span class="nav-lbl">${esc(m.label)}</span>${b ? `<span class="nav-badge">${b}</span>` : ''}${key ? `<span class="nav-key">${key}</span>` : ''}</button>`;
  };
  $('side').innerHTML = `
    <button class="nav-item side-toggle" data-act="nav.toggle" title="${open ? 'Collapse the sidebar' : 'Show all tab names'}" aria-expanded="${open}">
      <span class="nav-ico">${icon(open ? 'collapse' : 'expand')}</span><span class="nav-lbl brand-name">${esc(st.profile.name || 'Dashboard')}</span></button>
    <nav class="nav">${visibleTabs().map((t, i) => item(t, i < 9 ? String(i + 1) : '')).join('')}</nav>
    <div class="side-foot">
      ${item('settings', '0')}
    </div>`;
  $('shell').classList.toggle('side-open', open);
}
const sideOpen = () => (isDrawer() ? ui.drawer : !!S().settings.sidebarOpen);

function statusInfo() {
  const a = E.runningActivity(), t = today();
  if (a) return { cls: 'run', text: `${E.label(a)} · ${fmtTimer(Date.now() - a.lastStart)}`, act: 'focus.show', title: 'Your timer is running. Open the focus view.' };
  if (E.isRest(t)) return { cls: 'rest', text: 'Rest day' };
  const w = E.winMinutes(), n = E.nowMinutes();
  if (n < w.start) return { cls: '', text: 'Before hours' };
  if (n > w.end) return { cls: '', text: 'Day closed' };
  const left = Math.max(0, w.end - n);
  return { cls: 'live', text: `Live · ${Math.floor(left / 60)}h ${pad(Math.floor(left % 60))}m left` };
}
function clockText() {
  const d = new Date();
  if (S().settings.clock24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
let lastStatusCls = null;
function renderTop() {
  const st = S(), s = statusInfo(); lastStatusCls = s.cls;
  const sy = Sync.status(), ps = pushState();
  const bellOn = ps === 'subscribed' || ps === 'granted';
  const syncTitle = { idle: 'Synced', syncing: 'Syncing…', error: 'Sync problem: ' + sy.error, offline: 'Offline: changes are saved on this device', off: 'Sync is off' }[sy.state];
  $('top').innerHTML = `
    <button class="icon-btn menu-btn" data-act="nav.toggle" aria-label="Open menu">${icon('menu')}</button>
    <h1 class="top-name">${esc(st.profile.name || 'Dashboard')}</h1>
    <div class="top-meta">
      <div><div class="meta-l">Local time</div><div class="meta-v" id="clock">${clockText()}</div></div>
      <div><div class="meta-l">Date</div><div class="meta-v">${esc(new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</div></div>
      <div><div class="meta-l">Status</div><div class="meta-v status ${s.cls}" id="status" ${s.act ? `data-act="${s.act}" role="button" tabindex="0" title="${esc(s.title)}" style="cursor:pointer"` : ''}><i class="status-dot"></i><span>${esc(s.text)}</span></div></div>
    </div>
    <div class="top-actions">
      ${sy.signedIn ? `<button class="icon-btn ${sy.state === 'error' ? 'tone-bad' : ''}" data-act="nav.go" data-tab="settings" data-sub="sync" title="${esc(syncTitle)}" aria-label="${esc(syncTitle)}">${icon(sy.state === 'error' || sy.state === 'offline' ? 'cloudOff' : 'cloud')}</button>` : ''}
      <button class="icon-btn ${bellOn ? 'on' : ''}" data-act="notify.bell" title="${bellOn ? 'Notifications on: tap to send a test' : 'Turn on notifications'}" aria-label="Notifications">${icon(bellOn ? 'bell' : 'bellOff')}</button>
    </div>`;
}
function renderStrip() {
  const c = S().game.campaign;
  if (!c.on) { $('strip').innerHTML = ''; return; }
  const day = Math.max(1, E.campaignDay()), left = Math.max(0, c.len - day), sb = E.scoreboard(), e7 = E.exec7();
  $('strip').innerHTML = `<div class="strip">
    <span>${esc(c.name)}</span><span><b>Day ${day}</b> of ${c.len}</span><span><b>${left}</b> left</span>
    <span>Record <b>${sb.w}-${sb.l}</b></span>${e7 !== null ? `<span>Exec 7d <b>${e7}%</b></span>` : ''}
    ${day > c.len ? `<button class="btn sm primary" data-act="campaign.conclude" style="margin-left:auto">Conclude campaign</button>` : ''}
  </div>`;
}

/* ── view rendering ── */
function renderView() {
  const root = $('view'), view = VIEWS[ui.tab] || VIEWS.home;
  // keep inner scroll positions and the focused field across a re-render
  const scrolls = {};
  root.querySelectorAll('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]; });
  const ae = document.activeElement;
  const fk = ae && root.contains(ae) && ae.dataset ? ae.dataset.fk : null;
  root.className = 'view' + (view.wide ? ' wide' : '');
  root.innerHTML = view.render();
  if (view.mount) view.mount(root);
  Object.keys(scrolls).forEach(k => { const el = root.querySelector(`[data-scroll="${CSS.escape(k)}"]`); if (el) { el.scrollLeft = scrolls[k][0]; el.scrollTop = scrolls[k][1]; } });
  if (fk) {
    const el = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not a text field */ } }
  }
}
function renderAll() { renderSide(); renderTop(); renderStrip(); renderView(); }

let queued = false, deferred = false;
function scheduleRender(kind) {
  // A change arriving from another device must not yank a view out from
  // under someone typing in it; it is applied when they leave the field.
  const ae = document.activeElement;
  if ((kind === 'sync' || kind === 'replace') && ae && $('view').contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.value) { deferred = true; return; }
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; deferred = false; renderAll(); });
}
document.addEventListener('focusout', () => { if (deferred) setTimeout(() => { if (deferred) scheduleRender('ui'); }, 0); });

function route() {
  const raw = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0];
  const tab = VIEWS[raw] ? raw : 'home';
  const changed = tab !== ui.tab;
  ui.tab = tab;
  if (isDrawer()) ui.drawer = false;
  deferred = false;
  renderAll();
  if (changed) window.scrollTo(0, 0);
}

/* ── time ── */
function tick() {
  const c = $('clock'); if (c) c.textContent = clockText();
  const s = $('status');
  if (s) { const i = statusInfo(); if (i.cls !== lastStatusCls) renderTop(); else s.lastElementChild.textContent = i.text; }
  const v = VIEWS[ui.tab];
  if (v && v.tick && !document.hidden) v.tick($('view'));
}
function announceSettlement(r) {
  if (!r.settled.length) return;
  const st = S(), L = st.settings.labels;
  const before = E.rankFor(r.repBefore).cur, after = E.rankFor(r.repAfter).cur;
  if (r.settled.length <= 3) {
    const d = r.settled[r.settled.length - 1];
    const body = d.v === 'R' ? 'Nothing was scored.'
      : `You scored ${d.x} XP and ${L.shadow} scored ${d.s}.` + (d.ex != null ? ` You finished ${d.ex}% of your mission.` : '');
    toast(`${fmtDate(d.date)}: ${d.v === 'R' ? 'rest day' : d.v === 'W' ? 'you won' : 'you lost'}`, body, { kind: d.v === 'W' ? 'good' : '', ms: 12000 });
  }
  if (st.settings.modules.rank && before.name !== after.name) {
    notify(after.at > before.at ? `You've been promoted to ${after.name}` : `You've dropped to ${after.name}`, `Your ${L.rep.toLowerCase()} is now ${Math.round(r.repAfter)}.`, { kind: after.at > before.at ? 'good' : 'bad' });
  }
}
function dayStart() {
  ui.day = today();
  E.closeStaleTimers();
  E.processHabitMisses();
  announceSettlement(E.settlePending());
  // Yesterday is scored; its finished tasks no longer need to sit on the board.
  if (S().settings.autoClearDone) E.clearDone(today());
}
function housekeeping() {
  if (!S().profile.onboarded) return;
  if (ui.day !== today()) { dayStart(); renderAll(); }
  nudgeTick();
  E.checkLiveRecords().forEach(b => {
    const def = E.RECORD_DEFS[b.key];
    notify('You set a new record', `${def.label}: ${E.fmtRecord(b.key, b.v)}. Your previous best was ${E.fmtRecord(b.key, b.prev)}. ${b.key === 'xp' ? E.voice('pb') : ''}`.trim(), { kind: 'good' });
  });
}

/* ── actions ── */
function shortcutsModal() {
  const rows = [['1 - 9', 'Jump to a tab'], ['0', 'Settings'], ['L', S().settings.labels.lockIn + ' on the top task'], ['N', 'New task'], ['S', 'Stop the running timer'], ['[', 'Expand / collapse the sidebar'], ['?', 'This list'], ['Esc', 'Close a dialog']];
  openModal({ title: 'Keyboard shortcuts', cancel: 'Close', body: `<div class="list">${rows.map(([k, v]) => `<div class="li"><span class="kbd">${k}</span><span>${esc(v)}</span></div>`).join('')}</div>` });
}
registerActions({
  'nav.go': d => { if (d.sub) ui.settingsTab = d.sub; go(d.tab); },
  'nav.toggle': () => {
    if (isDrawer()) ui.drawer = !ui.drawer;
    else { S().settings.sidebarOpen = !S().settings.sidebarOpen; saveQuiet(); }
    renderSide();
  },
  'nav.close': () => { ui.drawer = false; renderSide(); },
  'notify.bell': async () => {
    const ps = pushState();
    if (ps === 'subscribed' || ps === 'granted') { if (ps === 'granted' && Sync.signedIn()) await enableNotifications(); else await testNotification(); }
    else await enableNotifications();
    renderTop();
  },
  'help.shortcuts': shortcutsModal,
  'campaign.conclude': () => VIEWS.settings.concludeCampaign()
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || modalOpen() || focusOpen() || !S().profile.onboarded) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const k = e.key;
  if (k === 'Enter' && t && t.id === 'status') { t.click(); return; }
  if (/^[1-9]$/.test(k)) { const tab = visibleTabs()[+k - 1]; if (tab) { e.preventDefault(); go(tab); } return; }
  const map = {
    '0': () => go('settings'),
    l: () => document.querySelector('[data-act="lock.in"]') ? document.querySelector('[data-act="lock.in"]').click() : (go('home')),
    n: () => VIEWS.board.newCard('today'),
    s: () => { if (E.runningActivity()) stopAndRate(); },
    '[': () => document.querySelector('.side-toggle').click(),
    '?': shortcutsModal
  };
  const fn = map[k.toLowerCase()] || map[k];
  if (fn) { e.preventDefault(); fn(); }
});

/* ── boot ── */
async function boot() {
  initDelegation();
  setRefresh(() => scheduleRender('ui'));
  applyTheme();
  loadBgImage();
  const landed = Sync.initSync();
  Sync.onStatus(() => renderTop());

  // With sync on, wait briefly for the cloud copy before settling any days,
  // so a day is never frozen from half the facts.
  if (Sync.signedIn()) await Promise.race([Sync.ready, new Promise(r => setTimeout(r, 5000))]);

  if (S().profile.onboarded) dayStart();
  onChange(kind => {
    if (kind === 'quota') { toast("Your browser's storage is full", 'That change could not be saved. Export a backup under Settings > Data.', { kind: 'bad', ms: 15000 }); return; }
    if (kind !== 'quiet') applyTheme();
    if (kind === 'sync' || kind === 'replace') { E.invalidate(); if (S().profile.onboarded) announceSettlement(E.settlePending()); }
    if (kind !== 'quiet') scheduleRender(kind);
  });
  window.addEventListener('hashchange', route);
  matchMedia('(max-width: 760px)').addEventListener('change', () => renderSide());
  route();

  if (!S().profile.onboarded) startOnboarding(() => { dayStart(); renderAll(); });
  if (landed === 'recovery') VIEWS.settings.newPasswordModal();
  if (landed === 'confirmed') toast('Your email is confirmed', "You're signed in and sync is on.", { kind: 'good' });

  setInterval(tick, 1000);
  setInterval(housekeeping, 20000);
  setTimeout(housekeeping, 2500);
  initNotify().then(() => renderTop());
  console.info(`Dashboard v${APP_VERSION}`);
}
boot();
