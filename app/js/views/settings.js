/* SETTINGS: everything that can be personalised lives here. */
import { S, save, saveQuiet, replaceState, normalize, defaultState, DEFAULT_XP, DEFAULT_RANKS, APP_VERSION, LS_KEY } from '../store.js';
import * as E from '../engine.js';
import { registerActions, openModal, confirmDialog, toast, switchHtml, segHtml } from '../ui.js';
import { icon } from '../icons.js';
import { esc, today, addDays, uid, safeColor, clamp, deepClone } from '../util.js';
import { ui, refresh } from '../bus.js';
import { applyTheme, ACCENTS, setBgImage, clearBgImage, hasBgImage } from '../theme.js';
import { TAB_META } from './tabs.js';
import * as Sync from '../sync.js';
import { pushState, enableNotifications, testNotification } from '../notify.js';

const TABS = [['look', 'Look'], ['layout', 'Layout'], ['day', 'Day & scoring'], ['game', 'Game'], ['notify', 'Notifications'], ['sync', 'Sync'], ['data', 'Data'], ['about', 'About']];
const set = () => S().settings;

/* ── small builders ── */
const row = (title, hint, control) => `<div class="set-row"><div class="grow"><div class="set-t">${title}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div><div class="set-c">${control}</div></div>`;
const text = (path, value, attrs = '') => `<input class="input" value="${esc(value)}" data-change="set.text" data-path="${path}" ${attrs}>`;
const num = (path, value, min, max, step = 1) => `<input class="input" type="number" value="${esc(value)}" min="${min}" max="${max}" step="${step}" data-change="set.num" data-path="${path}" style="width:96px">`;
const toggle = (path, on) => switchHtml('set.toggle', on, `data-path="${path}"`);
const seg = (path, options, cur) => segHtml('set.pick', options, cur).replace(/data-act="set.pick"/g, `data-act="set.pick" data-path="${path}"`);
const range = (path, value, min, max, unit = '') => `<div class="row" style="min-width:210px"><input type="range" min="${min}" max="${max}" value="${value}" data-input="set.range" data-change="set.rangeDone" data-path="${path}" aria-label="${path}"><span class="tiny dim" style="width:42px;text-align:right" data-out="${path}">${value}${unit}</span></div>`;

function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S()); }
function setPath(path, value) {
  const keys = path.split('.'), last = keys.pop();
  const obj = keys.reduce((o, k) => (o[k] == null ? (o[k] = {}) : o[k]), S());
  obj[last] = value;
}

/* ── sections ── */
function lookHtml() {
  const s = set(), st = S(), camp = st.game.campaign.on;
  return `<section class="card"><div class="card-h"><span class="eyebrow">Identity</span></div>
      ${row('Dashboard name', 'Shown at the top of every page and as the browser tab title.', text('profile.name', st.profile.name, 'maxlength="40"'))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Theme</span></div>
      ${camp ? `<div class="notice">${icon('flag')} A campaign is running, so the red campaign theme is in force. Your own theme below returns the moment the campaign ends.</div>` : ''}
      ${row('Mode', 'System follows your device and switches by itself at night.', seg('settings.theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme))}
      ${row('Accent colour', 'Used for buttons, progress and highlights. Text on it switches between black and white automatically.',
        `<div class="swatches">${ACCENTS.map(([n, c]) => `<button class="swatch ${s.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-act="set.accent" data-c="${c}" title="${n}" aria-label="${n}"></button>`).join('')}
          <input type="color" class="input" value="${safeColor(s.accent)}" data-change="set.accentCustom" title="Any colour" aria-label="Custom accent colour"></div>`)}
      ${row('Typeface', 'Classic is the look of the earlier versions (Rajdhani, Inter, JetBrains Mono) and loads from Google Fonts. The other four are already on your device, so nothing is fetched.', seg('settings.font', [['classic', 'Classic'], ['system', 'System'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Mono']], s.font))}
      ${row('Corners', '', seg('settings.corners', [['soft', 'Soft'], ['sharp', 'Sharp']], s.corners))}
      ${row('Density', 'Compact fits more on screen.', seg('settings.density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], s.density))}
      ${row('Reduce motion', 'Turns off the few transitions there are.', toggle('settings.reduceMotion', s.reduceMotion))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Background image</span></div>
      ${row('Image', 'Stays on this device only: it is never uploaded or synced. Location data in the photo is stripped.',
        `<div class="row wrap"><label class="btn sm">${icon('image')} ${hasBgImage() ? 'Replace' : 'Choose image'}<input type="file" accept="image/jpeg,image/png,image/webp" data-change="set.bgFile" hidden></label>
          ${hasBgImage() ? `<button class="btn sm danger" data-act="set.bgClear">Remove</button>` : ''}</div>`)}
      ${hasBgImage() ? `
        ${row('Show it', '', toggle('settings.bg.on', s.bg.on))}
        ${row('Dim', 'How strongly the image is darkened or lightened toward your theme. Kept at 35% or more so text always stays readable.', range('settings.bg.dim', s.bg.dim, 35, 95, '%'))}
        ${row('Blur', 'A little blur keeps a busy photo from fighting the content.', range('settings.bg.blur', s.bg.blur, 0, 30, 'px'))}
        ${row('Panel opacity', 'How solid the cards are over the image. Never below 55%.', range('settings.bg.glass', s.bg.glass, 55, 100, '%'))}` : ''}
    </section>`;
}
function layoutHtml() {
  const s = set();
  return `<section class="card"><div class="card-h"><span class="eyebrow">Sidebar</span></div>
      ${row('Style', 'Rail keeps a slim strip of icons at the left that expands to show names. Hidden removes it entirely until you press the menu button. Phones always use the hidden style.', seg('settings.sidebar', [['rail', 'Icon rail'], ['hidden', 'Hidden']], s.sidebar))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Tabs</span><span class="tiny dim">order sets the 1-9 shortcuts</span></div>
      <div class="list">${s.tabs.order.map((t, i) => `<div class="li"><span class="nav-ico">${icon(TAB_META[t].icon)}</span><span class="grow">${esc(TAB_META[t].label)}</span>
        <button class="icon-btn sm" data-act="set.tabMove" data-tab="${t}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
        <button class="icon-btn sm" data-act="set.tabMove" data-tab="${t}" data-d="1" ${i === s.tabs.order.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
        ${t === 'home' ? '<span style="width:42px"></span>' : switchHtml('set.tabShow', !s.tabs.hidden.includes(t), `data-tab="${t}" aria-label="Show ${esc(TAB_META[t].label)}"`)}</div>`).join('')}</div>
    </section>`;
}
function dayHtml() {
  const s = set(), x = s.xp;
  const xpRow = (k, label, hint, min, max, step = 1) => row(label, hint, num('settings.xp.' + k, x[k], min, max, step));
  return `<section class="card"><div class="card-h"><span class="eyebrow">Your day</span></div>
      ${row('Productive window', 'The hours you intend to be working. The rival paces himself across it, and start delay is measured from its opening.',
        `<div class="row"><input class="input" type="time" value="${esc(s.window.start)}" data-change="set.text" data-path="settings.window.start" aria-label="Window start"><span>to</span><input class="input" type="time" value="${esc(s.window.end)}" data-change="set.text" data-path="settings.window.end" aria-label="Window end"></div>`)}
      ${row('24-hour clock', '', toggle('settings.clock24', s.clock24))}
      ${row('Empty the Done column each morning', 'Yesterday\'s finished tasks are removed from the board at the start of each day. The day they were finished keeps the credit.', toggle('settings.autoClearDone', s.autoClearDone))}
      ${row('Target focus hours a day', 'A full day at target is what the scale is drawn against. It is a reference, not the bar you are judged by.', num('settings.targets.hours', s.targets.hours, 1, 16, 0.5))}
      ${row('Target tasks a day', '', num('settings.targets.tasks', s.targets.tasks, 0, 30))}
      ${row('Currency', 'Three-letter code, used in Subscriptions.', text('settings.currency', s.currency, 'maxlength="3" style="width:96px;text-transform:uppercase"'))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">How XP is paid</span><button class="btn sm ghost" data-act="set.xpReset">Reset to defaults</button></div>
      ${xpRow('perHour', 'Per focus hour', 'Deep activities earn this in full, Upkeep half, Tracked a token 15%. Back-to-back blocks multiply it up to 3×.', 0, 100)}
      ${xpRow('habit', 'Per habit checked', '', 0, 100)}
      ${xpRow('task', 'Per task completed', '', 0, 100)}
      ${xpRow('efficiency', 'Efficiency bonus (max)', 'Scaled by the average focus rating of your sessions.', 0, 100)}
      ${xpRow('sweep', 'Clean sweep', 'Paid when every habit due that day is done: a full set is worth more than its parts, because the one you skip is always the same one.', 0, 200)}
      ${xpRow('sweepStep', 'Sweep chain bonus per day', `Added for each consecutive clean sweep, up to the cap below.`, 0, 50)}
      ${xpRow('sweepCap', 'Sweep bonus cap', '', 0, 500)}
      ${xpRow('goal', 'Per main goal written', 'For writing your main goals out each day.', 0, 50)}
      ${xpRow('goalCap', 'Main goals that count', 'How many goals a day can earn XP. You can still write as many as you like.', 0, 50)}
      ${xpRow('log', 'Per logbook entry', 'Sleep, session ratings, efficacy and the debrief: paid for being written down, never for the value entered.', 0, 50)}
      ${xpRow('socialFreeMins', 'Social media: free minutes', 'A short check is not the problem; hours are.', 0, 600)}
      ${xpRow('socialPerMin', 'Social media: XP lost per minute over', '', 0, 5, 0.1)}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Weekly check-in categories</span></div>
      <div class="field"><textarea class="input" data-change="set.ratings" aria-label="Weekly check-in categories">${esc(s.ratings.join('\n'))}</textarea><div class="hint">One per line. These are the things you rate 1-5 on the Review tab each week.</div></div>
    </section>`;
}
function gameHtml() {
  const s = set(), st = S(), g = st.game, c = g.campaign, sb = E.scoreboard();
  const info = E.shadowInfo(today());
  return `<section class="card"><div class="card-h"><span class="eyebrow">Parts of the game</span></div>
      ${row(`The rival (${esc(s.labels.shadow)})`, 'A daily target built from your own recent performance, and a win or loss when the day closes.', toggle('settings.modules.shadow', s.modules.shadow))}
      ${row('Missions and execution', 'Declare what today is for; be scored on how much of it you kept.', toggle('settings.modules.mission', s.modules.mission))}
      ${row('Rank and reputation', 'A standing that rises with kept commitments and falls with broken ones.', toggle('settings.modules.rank', s.modules.rank))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Names</span></div>
      ${row('The rival is called', '', text('settings.labels.shadow', s.labels.shadow, 'maxlength="30"'))}
      ${row('The start button says', '', text('settings.labels.lockIn', s.labels.lockIn, 'maxlength="24"'))}
      ${row('The mission panel is titled', '', text('settings.labels.mission', s.labels.mission, 'maxlength="30"'))}
      ${row('Rank is called', '', text('settings.labels.rank', s.labels.rank, 'maxlength="20"'))}
      ${row('Reputation is called', '', text('settings.labels.rep', s.labels.rep, 'maxlength="20"'))}
      <div class="set-row" style="align-items:flex-start"><div class="grow"><div class="set-t">Rank ladder</div><div class="hint">Name and the ${esc(s.labels.rep.toLowerCase())} needed to hold each one. You currently have ${Math.round(sb.rep)}.</div></div>
        <div class="set-c col" style="gap:6px">${[...s.ranks].map((r, i) => `<div class="row"><input class="input" value="${esc(r.name)}" data-change="set.rank" data-i="${i}" data-k="name" maxlength="24" aria-label="Rank name"><input class="input" type="number" value="${r.at}" min="0" max="100000" data-change="set.rank" data-i="${i}" data-k="at" style="width:84px" ${i === 0 ? 'disabled' : ''} aria-label="Reputation needed">
            <button class="icon-btn sm" data-act="set.rankDel" data-i="${i}" ${s.ranks.length <= 2 || i === 0 ? 'disabled' : ''} aria-label="Remove rank">${icon('x')}</button></div>`).join('')}
          <div class="row"><button class="btn sm" data-act="set.rankAdd">${icon('plus')} Add rank</button><button class="btn sm ghost" data-act="set.rankReset">Reset</button></div></div></div>
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">${esc(s.labels.shadow)}</span><span class="tiny dim">today's bar: ${info.xp} XP</span></div>
      ${row('His edge', `How far ahead of your recent form he stays. He is rebuilt each morning from 60% of your 7-day average and 40% of your last day, plus this. He never asks for more than your best day of the last 30. <button class="btn sm ghost" data-act="home.shadowInfo" style="height:24px;padding:0 8px">See today's numbers</button>`, range('settings.shadow.edge', s.shadow.edge, 0, 25, '%'))}
      ${row('Voice', 'Direct is plain and to the point. Ruthless is harsh on purpose, so only pick it if that is what gets you moving. Silent removes his lines.', seg('settings.shadow.voice', [['cold', 'Direct'], ['harsh', 'Ruthless'], ['off', 'Silent']], s.shadow.voice))}
      <p class="hint" style="margin-top:12px">Every line he and the notifications can say is editable: Settings > Notifications > What they say.</p>
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Rest days</span></div>
      ${row('Allowed in any 7 days', 'A rest day is not scored at all: no win or loss, no reputation change, and habit streaks freeze instead of breaking. The allowance is what stops it becoming an escape hatch.', num('settings.restPerWeek', s.restPerWeek, 0, 7))}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Campaign</span>${c.on ? `<span class="pill accent">Day ${Math.max(1, E.campaignDay())} of ${c.len}</span>` : ''}</div>
      <p class="hint" style="margin-bottom:12px">A campaign is a fixed-length push. While it runs the whole dashboard switches to the red tactical theme, breaks are challenged before 25 minutes of focus are on the board, and the win-loss record counts from its first day. Ending it archives the result under Review.</p>
      ${row('Name', '', text('game.campaign.name', c.name, 'maxlength="30"'))}
      ${c.on
        ? `${row('Started', 'Changing this restarts the scoreboard from the new date.', `<input class="input" type="date" value="${c.start}" max="${today()}" data-change="set.campStart" aria-label="Campaign start">`)}
           ${row('Length (days)', '', num('game.campaign.len', c.len, 1, 730))}
           <div class="row" style="margin-top:14px"><button class="btn danger" data-act="campaign.conclude">${icon('flag')} Conclude campaign</button></div>`
        : `<form class="row wrap" data-campaign style="margin-top:8px;align-items:flex-end">
             <div class="field"><label>Start</label><input class="input" type="date" name="start" value="${today()}" max="${today()}" required></div>
             <div class="field"><label>Length (days)</label><input class="input" type="number" name="len" value="${c.len}" min="1" max="730" style="width:110px" required></div>
             <button class="btn primary" type="submit">${icon('flag')} Start campaign</button></form>`}
    </section>`;
}
function notifyHtml() {
  const s = set(), n = s.notify, ps = pushState();
  const stateCopy = {
    subscribed: ['good', 'On, including when the app is closed.'],
    granted: ['warn', 'On while the app is open. To get them with the app closed, set up sync and sign in: then tap Enable again.'],
    default: ['', 'Off. Turn them on with the button.'],
    denied: ['bad', 'Blocked in the browser. Allow notifications for this site in your browser or system settings, then come back.'],
    'needs-install': ['warn', 'On iPhone and iPad, install the app first: Share > Add to Home Screen, then open it from the home screen.'],
    unsupported: ['bad', 'This browser does not support notifications.']
  }[ps];
  return `<section class="card"><div class="card-h"><span class="eyebrow">This device</span></div>
      <div class="notice ${stateCopy[0]}">${icon(ps === 'subscribed' || ps === 'granted' ? 'bell' : 'bellOff')} ${stateCopy[1]}</div>
      <div class="row wrap" style="margin-top:12px"><button class="btn primary" data-act="set.notifyEnable">${icon('bell')} ${ps === 'subscribed' ? 'Re-register this device' : 'Enable notifications'}</button>
        <button class="btn" data-act="set.notifyTest">Send a test</button></div>
      <p class="hint" style="margin-top:10px">Each device is enabled separately. Works in Chrome, Edge and Firefox on Windows, macOS and Android; in Safari on macOS 13 or later; and on iPhone/iPad (iOS 16.4+) once installed to the home screen.</p>
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">What to send</span></div>
      ${row('Idle callouts', `From ${esc(s.labels.shadow)}, when nothing has been running for a while inside your window.`, seg('settings.notify.idle', [['off', 'Off'], ['campaign', 'Campaign only'], ['always', 'Always']], n.idle))}
      ${row('…after this many idle minutes', '', num('settings.nudgeMins', s.nudgeMins, 10, 240, 5))}
      ${row('When he passes you', 'Once a day, at the moment his pace overtakes your XP.', toggle('settings.notify.overtake', n.overtake))}
      ${row('Habits still open', '', `<div class="row">${toggle('settings.notify.habits', n.habits)}<input class="input" type="time" value="${esc(n.habitsAt)}" data-change="set.text" data-path="settings.notify.habitsAt" aria-label="Habit reminder time"></div>`)}
      ${row('Morning brief', 'Opens near the start of your window, and reminds you if no mission is declared three hours in.', toggle('settings.notify.brief', n.brief))}
      ${row('Night debrief', 'Thirty minutes before your window closes.', toggle('settings.notify.debrief', n.debrief))}
      ${row('Subscription payments', 'The day before, at 10:00.', toggle('settings.notify.subs', n.subs))}
      ${row('Running timer', 'Keeps a notification showing what is running and for how long. Refreshes every couple of minutes; it cannot tick live.', toggle('settings.notify.timer', n.timer))}
    </section>
    ${linesHtml()}`;
}
const linesOpen = new Set();
function linesHtml() {
  const s = set(), reg = s.shadow.voice === 'harsh' ? 'harsh' : 'cold';
  return `<section class="card"><div class="card-h"><span class="eyebrow">What they say</span>
      <button class="btn sm ghost" data-act="set.linesReset">Use the built-in lines everywhere</button></div>
    <p class="hint" style="margin-bottom:6px">Every line that ${esc(s.labels.shadow)} and the notifications can say, by situation. One line per row. One is picked at random each time. Edit a box to replace the built-in lines for that situation with your own.${s.shadow.voice === 'off' ? ' The voice is set to Silent in Settings > Game, so none of these are used right now.' : ''}</p>
    ${E.VOICE_KINDS.map(([k, title, hint]) => {
      const custom = (s.lines || {})[k], mine = !!(custom && custom.length), lines = mine ? custom : E.voicePreset(reg, k);
      return `<details class="lines" data-k="${k}" ${linesOpen.has(k) ? 'open' : ''}><summary><span class="grow"><b>${title}</b><span class="hint">${hint}</span></span>
          <span class="pill ${mine ? 'accent' : ''}">${mine ? 'Your lines: ' + custom.length : 'Built-in: ' + lines.length}</span></summary>
        <textarea class="input" data-change="set.lines" data-k="${k}" rows="${Math.min(12, lines.length + 2)}" maxlength="6000" aria-label="${title}">${esc(lines.join('\n'))}</textarea>
        ${mine ? `<button class="btn sm ghost" data-act="set.linesClear" data-k="${k}">Back to the built-in lines</button>` : ''}</details>`;
    }).join('')}
  </section>`;
}
function syncHtml() {
  const sy = Sync.status(), mc = Sync.manualConfig();
  const when = sy.lastSync ? new Date(sy.lastSync).toLocaleTimeString() : 'not yet';
  return `<section class="card"><div class="card-h"><span class="eyebrow">Where your data lives</span></div>
      <div class="notice">${icon('shield')} Everything is stored in this browser, on this device. Nothing is sent anywhere unless you turn on sync below.</div>
      <p class="hint" style="margin-top:10px">Sync is optional. It keeps your phone and computer in step and lets notifications arrive with the app closed. It uses <b>your own</b> free Supabase project, behind your own login: the setup guide walks through it in about ten minutes.</p>
    </section>
    ${sy.signedIn ? `<section class="card"><div class="card-h"><span class="eyebrow">Account</span><span class="pill ${sy.state === 'error' ? 'bad' : sy.state === 'idle' ? 'good' : ''}">${{ idle: 'Synced', syncing: 'Syncing…', error: 'Problem', offline: 'Offline', off: 'Off' }[sy.state]}</span></div>
        ${row('Signed in as', `Last synced: ${when}${sy.error ? ' · ' + esc(sy.error) : ''}`, `<b>${esc(sy.email)}</b>`)}
        <div class="row wrap" style="margin-top:12px"><button class="btn" data-act="sync.now">${icon('refresh')} Sync now</button><button class="btn" data-act="sync.password">Change password</button><button class="btn danger" data-act="sync.signOut">Sign out</button></div>
        <p class="hint" style="margin-top:10px">Signing out leaves the data on this device untouched.</p></section>`
    : `<section class="card"><div class="card-h"><span class="eyebrow">1 · Your Supabase project</span></div>
        <p class="hint" style="margin-bottom:10px">If you added <span class="mono">SUPABASE_URL</span> and <span class="mono">SUPABASE_ANON_KEY</span> to your Netlify site, leave these blank: the site already knows them. Otherwise paste them here (per device).</p>
        <form data-synccfg class="form-row"><div class="field"><label>Project URL</label><input class="input" name="url" value="${esc(mc.url)}" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
          <div class="field"><label>Publishable (anon) key</label><input class="input" name="key" value="${esc(mc.key)}" autocomplete="off" placeholder="sb_publishable_… or eyJ…"></div>
          <div class="field" style="justify-content:flex-end"><button class="btn" type="submit">Save</button></div></form>
        <p class="hint" style="margin-top:8px">This key is designed to be public. Never paste the <b>service role / secret</b> key into a browser: that one belongs only in Netlify's environment variables.</p></section>
      <section class="card"><div class="card-h"><span class="eyebrow">2 · Sign in</span></div>
        <form data-signin class="form-row"><div class="field"><label>Email</label><input class="input" type="email" name="email" autocomplete="username" required></div>
          <div class="field"><label>Password</label><input class="input" type="password" name="password" autocomplete="current-password" minlength="8" required></div></form>
        <div class="row wrap" style="margin-top:12px"><button class="btn primary" data-act="sync.signIn">Sign in</button><button class="btn" data-act="sync.signUp">Create account</button><button class="btn ghost" data-act="sync.forgot">Forgot password</button></div>
        <p class="hint" style="margin-top:10px">On first sign-in this device's data is merged with whatever is already in your account: nothing is overwritten.</p></section>`}`;
}
function dataHtml() {
  const hasV4 = (() => { try { return !!localStorage.getItem('commandCenterV2'); } catch { return false; } })();
  let size = 0; try { size = (localStorage.getItem(LS_KEY) || '').length; } catch { /* ignore */ }
  return `<section class="card"><div class="card-h"><span class="eyebrow">Backup</span><span class="tiny dim">${(size / 1024).toFixed(0)} KB stored on this device</span></div>
      ${row('Export', 'Downloads everything as one JSON file. Keep it somewhere safe: it is the whole dashboard.', `<button class="btn" data-act="data.export">${icon('download')} Export backup</button>`)}
      ${row('Import', 'Replaces what is on this device with a backup file.', `<label class="btn">${icon('upload')} Import backup<input type="file" accept="application/json,.json" data-change="data.import" hidden></label>`)}
      ${hasV4 ? row('Bring over v4 data', 'A version 4 dashboard was found in this browser. Imports its activities and sessions, habits and history, board, goals, subscriptions and journal. The scoreboard starts fresh.', `<button class="btn" data-act="data.importV4">Import from v4</button>`) : ''}
    </section>
    <section class="card"><div class="card-h"><span class="eyebrow">Start over</span></div>
      ${row('Erase everything on this device', 'Deletes the dashboard from this browser. If sync is on, sign out first or the cloud copy will come straight back.', `<button class="btn danger" data-act="data.erase">${icon('trash')} Erase</button>`)}
    </section>`;
}
function aboutHtml() {
  return `<section class="card"><div class="card-h"><span class="eyebrow">About</span><span class="pill">v${APP_VERSION}</span></div>
      <p class="muted">A private, self-hosted personal dashboard. No accounts unless you add your own, no analytics, no third-party scripts, no tracking.</p>
      <div class="row wrap" style="margin-top:14px"><button class="btn" data-act="help.shortcuts">Keyboard shortcuts</button><button class="btn" data-act="set.replayOnboarding">Run the welcome setup again</button></div>
      <p class="hint" style="margin-top:14px">Setup and usage guide: <span class="mono">HOW-TO-USE.md</span> in the project repository. Open source under the MIT licence.</p></section>`;
}

/* ── v4 → v5 import ── */
function importV4() {
  let old; try { old = JSON.parse(localStorage.getItem('commandCenterV2') || 'null'); } catch { old = null; }
  if (!old) { toast('No v4 data found on this device', '', { kind: 'bad' }); return; }
  const st = S(), w = old.war || {};
  const tierMap = { high: 'deep', medium: 'upkeep', low: 'tracked' };
  const ESC = /eat|food|meal|snack|lunch|dinner|breakfast|nap|sleep|rest|doom|scroll|social/i;
  st.activities = (old.activities || []).map(a => {
    const esc_ = a.isEscape === true || (a.isEscape === undefined && ESC.test(a.name || ''));
    return { id: String(a.id), name: a.name, emoji: a.emoji || '', color: safeColor(a.color, '#6FB1F0'), weight: esc_ ? 'tracked' : (tierMap[a.weight] || 'upkeep'), isEscape: esc_, isRunning: false, lastStart: 0,
      sessions: (a.sessions || []).filter(s => s && s.start && s.dur > 0).map(s => ({ date: s.date, start: s.start, end: s.end || s.start + s.dur, dur: s.dur, eff: s.eff == null ? null : clamp(+s.eff, 0, 1), ...(s.manual ? { manual: true } : {}) })) };
  });
  st.habits = (old.habits || []).map(h => ({ id: String(h.id), name: h.name, emoji: h.emoji || '', difficulty: E.HABIT_DIFF[h.difficulty] ? h.difficulty : 'easy', schedule: h.schedule || { type: 'daily' }, color: safeColor(h.color, '#F0A44B'), startDate: h.startDate || today(), history: { ...(h.history || {}) } }));
  st.tags = (old.tags || []).map(t => ({ id: String(t.id), name: t.name, color: safeColor(t.color, '#8B7CF6'), activityId: (st.activities.find(a => a.name.toLowerCase() === String(t.name).toLowerCase()) || {}).id || null }));
  const colMap = { today: 'today', a48: 'soon', bweek: 'week', csomeday: 'someday', dwaiting: 'waiting', reminder: 'someday', done: 'done' };
  st.columns = deepClone(defaultState().columns);
  st.cards = {}; st.columns.forEach(c => { st.cards[c.id] = []; });
  Object.keys(old.cards || {}).forEach(col => (old.cards[col] || []).forEach(c => {
    const dest = colMap[col] || 'someday';
    st.cards[dest].push({ id: String(c.id), text: c.text || '', tagId: c.tagId ? String(c.tagId) : null, est: c.timeEstimate ? +c.timeEstimate : null, deadline: c.deadline || null, notes: '', subs: [], ...(dest === 'done' ? { doneAt: c.doneAt && c.doneAt > '2001' ? c.doneAt : addDays(today(), -31) } : {}) });
  }));
  st.goals = (old.goals || []).map(g => ({ id: String(g.id), name: g.name, deadline: g.deadline || null, color: safeColor(g.color, '#E0B25A'), milestones: (g.milestones || []).map(m => ({ id: String(m.id || uid()), name: m.name, done: !!m.done, tasks: (m.tasks || []).map(t => ({ id: String(t.id || uid()), name: t.name, done: !!t.done })) })) }));
  st.subs = (old.subs || []).map(s => ({ id: String(s.id), name: s.name, amount: +s.amount || 0, currency: s.currency || st.settings.currency, cycle: s.cycle || 'monthly', every: s.every || 30, anchor: s.anchor || today(), remind: s.remind !== false, active: s.active !== false, note: s.note || '', history: [] }));
  st.journal = { ...(old.journal || {}) };
  Object.keys(old.dailyProgress || {}).forEach(d => {
    const p = old.dailyProgress[d] || {}, day = st.days[d] || (st.days[d] = {});
    if (p.sleep > 0) day.sleep = { start: p.sleepStart || '', end: p.sleepEnd || '', hrs: +p.sleep };
    if (p.emojis && p.emojis.length) day.emojis = p.emojis.slice(0, 6);
  });
  if (old.window) st.settings.window = { start: old.window.start || '07:00', end: old.window.end === '23:59' ? '23:59' : (old.window.end || '23:00') };
  if (w.targetHours) st.settings.targets.hours = w.targetHours;
  if (w.targetTasks) st.settings.targets.tasks = w.targetTasks;
  Object.keys(w.missions || {}).forEach(d => { if (d >= today()) st.game.missions[d] = w.missions[d]; });
  st.game.holds = w.holds || 0; st.game.folds = w.folds || 0;
  st.game.days = {}; st.game.start = today(); st.lastActiveDay = today();
  E.invalidate(); save();
  toast('v4 data imported', `${st.activities.length} activities, ${st.habits.length} habits, ${Object.values(st.cards).reduce((n, l) => n + l.length, 0)} tasks. The scoreboard starts fresh today.`, { kind: 'good', ms: 9000 });
}

async function concludeCampaign() {
  const s = E.campaignStats(), c = S().game.campaign;
  if (!(await confirmDialog({ title: `Conclude ${c.name}?`, ok: 'Conclude', body: `${s.w}-${s.l} over ${s.days} scored days · ${s.execAvg}% execution · ${s.hours}h focused. It is archived under Review, the red theme lifts, and a fresh scoreboard starts today.` }))) return;
  const verdict = E.concludeCampaign();
  toast(`Campaign archived: ${verdict}`, `${s.w}-${s.l} · ${s.execAvg}% execution · ${s.hours}h.`, { kind: verdict === 'Victory' ? 'good' : '', ms: 12000 });
}
function newPasswordModal() {
  openModal({ title: 'Choose a new password', submit: 'Set password',
    body: `<div class="field"><label>New password (8+ characters)</label><input class="input" type="password" name="p" minlength="8" autocomplete="new-password" required autofocus></div>`,
    onSubmit: d => { if (d.p.length < 8) return false; Sync.updatePassword(d.p).then(() => toast('Password updated', '', { kind: 'good' })).catch(e => toast('Could not update the password', e.message, { kind: 'bad' })); } });
}
const creds = () => { const f = document.querySelector('form[data-signin]'); return f ? { email: f.elements.email.value.trim(), password: f.elements.password.value } : null; };
const busy = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg, '', { kind: 'good' }); refresh(); return r; } catch (e) { toast('That did not work', e.message, { kind: 'bad', ms: 10000 }); } };

const view = {
  concludeCampaign, newPasswordModal,
  render() {
    const tab = TABS.some(t => t[0] === ui.settingsTab) ? ui.settingsTab : 'look';
    const body = { look: lookHtml, layout: layoutHtml, day: dayHtml, game: gameHtml, notify: notifyHtml, sync: syncHtml, data: dataHtml, about: aboutHtml }[tab]();
    return `<div class="view-h"><h2>Settings</h2></div>
      <div class="set-tabs" role="tablist">${TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}" data-act="set.tab" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="settings">${body}</div>`;
  },
  mount(root) {
    const cf = root.querySelector('form[data-campaign]');
    if (cf) cf.addEventListener('submit', e => { e.preventDefault(); E.startCampaign({ name: S().game.campaign.name, start: cf.elements.start.value || today(), len: parseInt(cf.elements.len.value) || 60 }); toast(`${S().game.campaign.name} has begun`, 'The red theme is on until it ends.', { ms: 6000 }); });
    const sc = root.querySelector('form[data-synccfg]');
    if (sc) sc.addEventListener('submit', e => { e.preventDefault(); try { Sync.setManualConfig(sc.elements.url.value, sc.elements.key.value); toast('Saved', 'Now sign in or create an account below.', { kind: 'good' }); } catch (err) { toast('Check the URL', err.message, { kind: 'bad' }); } });
    root.querySelectorAll('details.lines').forEach(dt => dt.addEventListener('toggle', () => { dt.open ? linesOpen.add(dt.dataset.k) : linesOpen.delete(dt.dataset.k); }));
    const sf = root.querySelector('form[data-signin]');
    if (sf) sf.addEventListener('submit', e => { e.preventDefault(); root.querySelector('[data-act="sync.signIn"]').click(); });
  }
};
export default view;

registerActions({
  'set.tab': d => { ui.settingsTab = d.v; refresh(); window.scrollTo(0, 0); },
  'set.text': (d, e, el) => {
    let v = el.value;
    if (d.path === 'profile.name') v = v.trim().slice(0, 40) || 'Dashboard';
    if (d.path === 'settings.currency') v = v.trim().toUpperCase().slice(0, 3) || 'EUR';
    if (/labels\./.test(d.path)) v = v.trim() || getPath(d.path);
    setPath(d.path, v); save();
  },
  'set.num': (d, e, el) => { const v = clamp(parseFloat(el.value), +el.min, +el.max); if (!isFinite(v)) return; setPath(d.path, v); E.invalidate(); save(); },
  'set.toggle': d => { setPath(d.path, !getPath(d.path)); E.invalidate(); save(); },
  'set.pick': d => { setPath(d.path, d.v); save(); },
  'set.range': (d, e, el) => {                        // live preview while dragging; saved on release
    setPath(d.path, +el.value);
    const out = document.querySelector(`[data-out="${d.path}"]`); if (out) out.textContent = el.value + out.textContent.replace(/^[\d.]+/, '');
    applyTheme();
  },
  'set.rangeDone': () => { E.invalidate(); save(); },
  'set.accent': d => { set().accent = d.c; save(); },
  'set.accentCustom': (d, e, el) => { set().accent = safeColor(el.value); save(); },
  'set.bgFile': async (d, e, el) => {
    const file = el.files && el.files[0]; if (!file) return;
    try { await setBgImage(file); set().bg.on = true; save(); toast('Background set', 'Tune dim, blur and panel opacity below.', { kind: 'good', ms: 4000 }); }
    catch (err) { toast('Could not use that image', err.message, { kind: 'bad' }); }
  },
  'set.bgClear': async () => { await clearBgImage(); set().bg.on = false; save(); },
  'set.tabMove': d => { const o = set().tabs.order, i = o.indexOf(d.tab), j = i + +d.d; if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save(); },
  'set.tabShow': d => { const h = set().tabs.hidden, i = h.indexOf(d.tab); if (i >= 0) h.splice(i, 1); else h.push(d.tab); save(); },
  'set.xpReset': () => { set().xp = { ...DEFAULT_XP }; E.invalidate(); save(); },
  'set.ratings': (d, e, el) => { const list = el.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10); if (list.length) { set().ratings = list; save(); } },
  'set.rank': (d, e, el) => {
    const r = set().ranks[+d.i]; if (!r) return;
    if (d.k === 'name') r.name = el.value.trim() || r.name; else r.at = Math.max(0, parseInt(el.value) || 0);
    set().ranks.sort((a, b) => a.at - b.at); set().ranks[0].at = 0;
    E.invalidate(); save();
  },
  'set.rankAdd': () => { const r = set().ranks, top = r[r.length - 1]; r.push({ at: Math.round(top.at * 1.5) + 50, name: 'New rank' }); E.invalidate(); save(); },
  'set.rankDel': d => { set().ranks.splice(+d.i, 1); E.invalidate(); save(); },
  'set.rankReset': () => { set().ranks = deepClone(DEFAULT_RANKS); E.invalidate(); save(); },
  'set.campStart': (d, e, el) => { if (!el.value || el.value > today()) return; const c = S().game.campaign; E.startCampaign({ name: c.name, start: el.value, len: c.len }); },
  'set.lines': (d, e, el) => {
    const s = set(), list = el.value.split('\n').map(x => x.trim().slice(0, 240)).filter(Boolean).slice(0, 60);
    const builtIn = E.voicePreset(s.shadow.voice === 'harsh' ? 'harsh' : 'cold', d.k);
    if (!s.lines) s.lines = {};
    if (!list.length || list.join('\n') === builtIn.join('\n')) delete s.lines[d.k]; else s.lines[d.k] = list;
    save();
  },
  'set.linesClear': d => { if (set().lines) delete set().lines[d.k]; save(); },
  'set.linesReset': async () => { if (await confirmDialog({ title: 'Go back to the built-in lines?', body: 'Your own lines for every situation are removed.', ok: 'Reset', danger: true })) { set().lines = {}; save(); } },
  'set.notifyEnable': async () => { await enableNotifications(); refresh(); },
  'set.notifyTest': () => testNotification(),
  'set.replayOnboarding': () => { S().profile.onboarded = false; saveQuiet(); location.reload(); },
  'sync.signIn': () => { const c = creds(); if (!c || !c.email || !c.password) { toast('Enter your email and password'); return; } busy(() => Sync.signIn(c.email, c.password), 'Signed in: sync is on'); },
  'sync.signUp': () => {
    const c = creds(); if (!c || !c.email || c.password.length < 8) { toast('Enter an email and a password of 8+ characters'); return; }
    busy(async () => { const inNow = await Sync.signUp(c.email, c.password); toast(inNow ? 'Account created: sync is on' : 'Check your inbox', inNow ? '' : 'Confirm your email address from the message Supabase just sent, then sign in here.', { kind: 'good', ms: 12000 }); });
  },
  'sync.forgot': () => { const c = creds(); if (!c || !c.email) { toast('Type your email address first'); return; } busy(() => Sync.resetPassword(c.email), 'Reset link sent: check your inbox'); },
  'sync.signOut': () => busy(() => Sync.signOut(), 'Signed out'),
  'sync.now': () => busy(() => Sync.pushNow()),
  'sync.password': newPasswordModal,
  'data.export': () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S(), null, 1)], { type: 'application/json' }));
    a.download = `dashboard-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'data.import': async (d, e, el) => {
    const file = el.files && el.files[0]; el.value = '';
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('That file is too large to be a backup.');
      const doc = JSON.parse(await file.text());
      if (!doc || typeof doc !== 'object' || doc.v !== 5 || !doc.settings || !doc.game) throw new Error('This is not a version 5 backup file.');
      if (!(await confirmDialog({ title: 'Replace this device\'s data?', body: `The backup “${(doc.profile && doc.profile.name) || 'Dashboard'}” replaces everything currently here.`, ok: 'Replace', danger: true }))) return;
      const next = normalize(doc); next._rev = Math.max(next._rev || 0, S()._rev || 0) + 1; next._at = Date.now();
      replaceState(next, 'replace');
      toast('Backup imported', '', { kind: 'good' });
    } catch (err) { toast('Import failed', err.message, { kind: 'bad', ms: 9000 }); }
  },
  'data.importV4': async () => { if (await confirmDialog({ title: 'Import from v4?', body: 'Activities, habits, the board, goals, subscriptions and the journal on this device are replaced with the v4 ones. Appearance settings are kept.', ok: 'Import' })) importV4(); },
  'data.erase': async () => {
    if (Sync.signedIn()) { toast('Sign out of sync first', 'Otherwise the cloud copy is restored immediately.', { kind: 'bad' }); return; }
    if (!(await confirmDialog({ title: 'Erase everything on this device?', body: 'This cannot be undone. Export a backup first if there is any chance you will want it.', ok: 'Erase everything', danger: true }))) return;
    await clearBgImage();
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem('hq.v5.look'); localStorage.removeItem('hq.v5.mark'); } catch { /* ignore */ }
    location.hash = ''; location.reload();
  }
});
