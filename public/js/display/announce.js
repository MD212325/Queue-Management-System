// Sound for the public display: a two-note chime and a spoken announcement.
// Browsers only allow sound after someone has clicked the page, so this stays off until the
// "Sound" button is pressed once. (A kiosk-mode browser started with
// --autoplay-policy=no-user-gesture-required can use  /display.html?sound  to start with sound on.)
import { spell } from '../shared/format.js';

let ctx = null;
let enabled = false;
let loopTimer = null;
let loopText = '';

export const isEnabled = () => enabled;
export const supported = () => !!(window.AudioContext || window.webkitAudioContext);

/** Must be called from a click. Returns true if sound is now on. */
export async function enable() {
  if (!supported()) return false;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ctx = ctx || new Ctx();
  try { await ctx.resume(); } catch { /* ignore */ }
  enabled = ctx.state === 'running';
  if (enabled) chime(); // let the person hear that it works
  return enabled;
}
export function disable() {
  enabled = false;
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  loopText = '';
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

/** Try to turn sound on without a click (works only when the browser allows autoplay). */
export async function tryEnable() {
  if (!supported()) return false;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ctx = ctx || new Ctx();
  try { await ctx.resume(); } catch { /* ignore */ }
  enabled = ctx.state === 'running';
  return enabled;
}

function chime() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [[880, 0], [659, 0.3]].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + delay);
    gain.gain.linearRampToValueAtTime(0.4, t0 + delay + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + delay);
    osc.stop(t0 + delay + 0.75);
  });
}

function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  u.voice = voices.find(v => /^en[-_]PH/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  u.rate = 0.9;
  synth.speak(u);
}

function playAnnouncement(text) {
  if (!enabled || !text) return;
  chime();
  setTimeout(() => {
    if (!enabled) return;
    speak(text);
  }, 900);
}

/** Chime, then read "Ticket R 0 3 7, please proceed to Registrar." and keep repeating while sound stays on. */
export function announce(token, where) {
  if (!enabled) return;
  const text = `Ticket ${spell(token)}, please proceed to ${where}.`;
  loopText = text;
  if (loopTimer) clearInterval(loopTimer);
  playAnnouncement(text);
  loopTimer = setInterval(() => {
    if (!enabled) {
      clearInterval(loopTimer);
      loopTimer = null;
      loopText = '';
      return;
    }
    playAnnouncement(loopText);
  }, 8000);
}
