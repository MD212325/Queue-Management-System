// Light / dark theme switch for the customer pages. The page's <html data-theme-key> names where the choice is saved.
export const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(document.documentElement.getAttribute('data-theme-key') || 'qms_theme', currentTheme()); } catch { /* private mode */ }
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  return currentTheme();
}
