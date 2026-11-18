// Applies the saved light/dark theme before the page paints, so there is no flash of the wrong theme.
// Used by the admin console and the customer pages. Each page names its own storage key with
// <html data-theme-key="...">; the admin console uses the default. ?theme=dark or ?theme=light overrides it.
// (An external file, because the Content-Security-Policy does not allow inline scripts.)
(function () {
  try {
    var root = document.documentElement;
    var key = root.getAttribute('data-theme-key') || 'qms_theme';
    var forced = new URLSearchParams(location.search).get('theme');
    var saved = localStorage.getItem(key);
    var theme = forced === 'dark' || forced === 'light' ? forced : saved;
    root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
