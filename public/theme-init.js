// Runs before the admin console paints, so there is no light/dark flash. (External file: the page's
// Content-Security-Policy does not allow inline scripts.)
try { document.documentElement.dataset.theme = localStorage.getItem('qms_theme') || 'light'; } catch (e) { /* ignore */ }
