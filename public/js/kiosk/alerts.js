// Getting a person's attention without a push service: sound, vibration, and keeping the screen awake.
const SOUND = '/sound/notif.wav';

// Browsers refuse to vibrate until the person has tapped the page once. Skip quietly instead of logging an error.
const canVibrate = () => !!navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive);
const vibrate = pattern => { try { if (canVibrate()) navigator.vibrate(pattern); } catch { /* ignore */ } };
let audio = null;
let stopTimer = null;
let buzzTimer = null;
let wakeLock = null;
let wantAwake = false;

function player() {
  if (!audio) { audio = new Audio(SOUND); audio.loop = true; }
  return audio;
}

/** Browsers only allow sound after a tap. Call this from the "Get my number" tap so the later alert can play. */
export function unlockAudio() {
  try {
    const a = player();
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  } catch { /* no audio support */ }
}

/** Ring and buzz until stopAlarm(), but never for more than maxMs (nobody wants a phone screaming for ten minutes). */
export function startAlarm(maxMs = 45000) {
  stopAlarm();
  try { const a = player(); a.currentTime = 0; a.muted = false; a.play().catch(() => {}); } catch { /* ignore */ }
  const buzz = () => vibrate([400, 200, 400]);
  buzz();
  buzzTimer = setInterval(buzz, 2500);
  stopTimer = setTimeout(stopAlarm, maxMs);
}

export function stopAlarm() {
  clearTimeout(stopTimer);
  clearInterval(buzzTimer);
  stopTimer = buzzTimer = null;
  try { if (audio) { audio.pause(); audio.currentTime = 0; } } catch { /* ignore */ }
  vibrate(0);
}

export const nudge = () => vibrate([60, 40, 60]);

/** Keep the screen on while the person is waiting, so the page keeps receiving updates. */
export async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not supported or refused: harmless */ }
}
document.addEventListener('visibilitychange', () => { if (wantAwake && document.visibilityState === 'visible') keepAwake(true); });
