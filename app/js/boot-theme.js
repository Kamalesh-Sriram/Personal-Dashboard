/* Runs before first paint (a classic script, deliberately not a module).
   theme.js keeps a tiny mirror of the look in localStorage so this can set
   the right attributes without parsing the whole state document. */
(function () {
  var FONTS = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';
  function classicFonts() {
    if (document.getElementById('hq-fonts')) return;
    var l = document.createElement('link');
    l.id = 'hq-fonts'; l.rel = 'stylesheet'; l.href = FONTS;
    document.head.appendChild(l);
  }
  try {
    var look = JSON.parse(localStorage.getItem('hq.v5.look') || 'null');
    var root = document.documentElement;
    if (!look) {
      root.dataset.theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      classicFonts();
      return;
    }
    var theme = look.theme === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : look.theme;
    root.dataset.theme = look.campaign ? 'dark' : theme;
    root.dataset.campaign = look.campaign ? 'on' : 'off';
    root.dataset.font = look.font || 'classic';
    if (root.dataset.font === 'classic') classicFonts();
    root.dataset.corners = look.corners || 'soft';
    root.dataset.density = look.density || 'comfortable';
    root.dataset.sidebar = look.sidebar || 'rail';
    if (!look.campaign && /^#[0-9a-fA-F]{6}$/.test(look.accent || '')) {
      root.style.setProperty('--accent', look.accent);
      if (look.onAccent) root.style.setProperty('--on-accent', look.onAccent);
    }
  } catch (e) { /* first run, or storage blocked: the defaults are fine */ }
})();
