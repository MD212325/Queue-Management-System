/** 640 -> "about 11 min". Estimates are rounded on purpose: they are guesses. */
export function fmtWait(seconds) {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 45) return 'under 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

export const fmtMinutes = seconds => `${Math.max(1, Math.round(seconds / 60))} min`;
export const fmtClock = (date = new Date()) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "R037" -> "R 0 3 7", so a speech engine reads each character. */
export const spell = token => String(token).split('').join(' ');
