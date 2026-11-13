/* ONBOARDING: the first three screens. Name it, pick a look, set the day.
   Every choice here can be changed later in Settings. */
import { S, save, starterContent } from '../store.js';
import { applyTheme, ACCENTS } from '../theme.js';
import { icon } from '../icons.js';
import { esc, today } from '../util.js';
import { toast } from '../ui.js';
import * as Sync from '../sync.js';

export function startOnboarding(done) {
  const root = document.getElementById('onb-root'), st = S(), s = st.settings;
  let step = 0;
  const draft = { name: st.profile.name || '', starter: st.activities.length === 0 && st.habits.length === 0, rival: s.labels.shadow };

  const steps = [
    () => `<div><div class="eyebrow">Welcome</div><h1 class="onb-title">This is your dashboard.<br>What should it be called?</h1></div>
      <div class="field"><input class="input" id="onb-name" value="${esc(draft.name)}" maxlength="40" placeholder="e.g. Headquarters, Mission Control, Alex’s Desk" autocomplete="off" style="height:52px;font-size:18px" aria-label="Dashboard name">
        <div class="hint">It appears at the top of every page. You can rename it any time.</div></div>
      <p class="muted">Tasks, time tracking, habits, goals and a rival built from your own track record: all stored privately in this browser.</p>`,
    () => `<div><div class="eyebrow">Look</div><h1 class="onb-title">Make it yours.</h1></div>
      <div class="field"><label>Theme</label><div class="seg" id="onb-theme">${[['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" class="${s.theme === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Accent colour</label><div class="swatches" id="onb-accent">${ACCENTS.map(([n, c]) => `<button type="button" class="swatch ${s.accent === c ? 'on' : ''}" style="background:${c}" data-c="${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
        <div class="hint">More in Settings afterwards: any colour, four typefaces, and your own background image.</div></div>`,
    () => `<div><div class="eyebrow">Your day</div><h1 class="onb-title">When do you work?</h1></div>
      <div class="form-row"><div class="field"><label>Day starts</label><input class="input" type="time" id="onb-start" value="${esc(s.window.start)}"></div>
        <div class="field"><label>Day ends</label><input class="input" type="time" id="onb-end" value="${esc(s.window.end)}"></div>
        <div class="field"><label>Focus hours you aim for</label><input class="input" type="number" id="onb-hours" min="1" max="16" step="0.5" value="${s.targets.hours}"></div></div>
      <div class="field"><label>Your rival is called</label><input class="input" id="onb-rival" value="${esc(draft.rival)}" maxlength="30">
        <div class="hint">Each morning the rival sets a bar a step ahead of how you have actually been performing. Beat it and the day is a win.</div></div>
      <label class="row"><input type="checkbox" id="onb-starter" ${draft.starter ? 'checked' : ''}> <span>Start me with a few example activities, tags and habits (all editable)</span></label>`
  ];

  function capture() {
    const g = id => root.querySelector('#' + id);
    if (step === 0) draft.name = g('onb-name').value.trim();
    if (step === 2) {
      s.window.start = g('onb-start').value || '07:00';
      s.window.end = g('onb-end').value || '23:00';
      s.targets.hours = Math.max(1, Math.min(16, parseFloat(g('onb-hours').value) || 6));
      draft.rival = g('onb-rival').value.trim() || 'The Shadow';
      draft.starter = g('onb-starter').checked;
    }
  }
  function finish() {
    st.profile.name = draft.name || 'Headquarters';
    st.profile.onboarded = true;
    if (!st.profile.createdAt) st.profile.createdAt = today();
    s.labels.shadow = draft.rival;
    if (!Object.keys(st.game.days).length) st.game.start = today();
    st.lastActiveDay = today();
    if (draft.starter && !st.activities.length && !st.habits.length) {
      const c = starterContent();
      st.activities = c.activities; st.habits = c.habits; if (!st.tags.length) st.tags = c.tags;
    }
    root.innerHTML = '';
    save();
    done();
  }
  function render() {
    root.innerHTML = `<div class="onb"><form class="onb-card" novalidate>
        <div class="onb-steps">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
        ${steps[step]()}
        <div class="row"><span class="grow"></span>
          ${step > 0 ? `<button type="button" class="btn ghost" id="onb-back">Back</button>` : ''}
          <button type="submit" class="btn primary" style="height:46px;padding:0 22px">${step === steps.length - 1 ? 'Open my dashboard' : 'Continue'} ${icon('right')}</button></div>
      </form></div>`;
    const form = root.querySelector('form');
    form.addEventListener('submit', e => { e.preventDefault(); capture(); if (step === steps.length - 1) finish(); else { step++; render(); } });
    const back = root.querySelector('#onb-back');
    if (back) back.addEventListener('click', () => { capture(); step--; render(); });
    const th = root.querySelector('#onb-theme');
    if (th) th.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; s.theme = b.dataset.v; applyTheme(); render(); });
    const ac = root.querySelector('#onb-accent');
    if (ac) ac.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; s.accent = b.dataset.c; applyTheme(); render(); });
    const first = root.querySelector('#onb-name');
    if (first) first.focus();
    // If this site has sync set up, a second device can sign in and skip all of this.
    if (step === 0) Sync.config().then(cfg => {
      const card = root.querySelector('.onb-card');
      if (!cfg || step !== 0 || !card || card.querySelector('#onb-have')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'onb-have'; b.className = 'btn ghost'; b.style.alignSelf = 'flex-start';
      b.textContent = 'I already have a dashboard. Sign in';
      b.addEventListener('click', signInScreen);
      card.appendChild(b);
    });
  }
  function signInScreen() {
    root.innerHTML = `<div class="onb"><form class="onb-card" novalidate>
        <div><div class="eyebrow">Welcome back</div><h1 class="onb-title">Sign in to load your dashboard.</h1></div>
        <div class="field"><label>Email</label><input class="input" type="email" name="email" autocomplete="username" required></div>
        <div class="field"><label>Password</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>
        <div class="row"><span class="grow"></span><button type="button" class="btn ghost" id="onb-back">Back</button>
          <button type="submit" class="btn primary" style="height:46px;padding:0 22px">Sign in</button></div>
      </form></div>`;
    const form = root.querySelector('form');
    root.querySelector('#onb-back').addEventListener('click', render);
    form.elements.email.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Signing in';
      try {
        await Sync.signIn(form.elements.email.value.trim(), form.elements.password.value);
        if (!S().profile.onboarded) {             // signed in, but the account holds no dashboard yet
          toast('You are signed in', 'There is no dashboard in your account yet, so set one up here.', { ms: 9000 });
          render();
        }
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        toast('That did not work', err.message, { kind: 'bad', ms: 9000 });
      }
    });
  }
  render();
}
