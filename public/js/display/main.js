// Public display. Shows tokens only (names stay private unless the administrator turns them on).
//
// Announcements: the sound is opt-in on this screen (the "Announcements" button), because browsers need one click
// before they allow sound. Staff decide whether calls are announced automatically (Settings), and can always announce
// a ticket again or send a message from the admin console; those arrive as live events.
import { api } from '../shared/api.js';
import { $, h, icon, mount } from '../shared/dom.js';
import { coalesce, connectLive } from '../shared/live.js';
import { fmtClock } from '../shared/format.js';
import { currentTheme, toggleTheme } from '../shared/theme.js';
import * as sound from './announce.js';

const SHOW_MAX = 6;       // waiting numbers listed per counter
const RECENT_MAX = 6;     // numbers in the "recently called" strip

const state = {
  services: [], known: new Map(), tickets: [], recent: [], seen: new Map(), first: true, flash: new Set(),
  showNames: false, autoAnnounce: true, message: null,
};

const callKey = t => `${t.id}:${t.called_at}`;
const titleCase = key => String(key || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// Names seen earlier in this session are remembered, so a service that gets switched off keeps its proper name.
const labelOf = key => (state.known.get(key) || {}).label || titleCase(key);

/* ----------------------------------------------------------------- data */

async function loadServices() {
  try {
    state.services = await api.services();
    for (const s of state.services) state.known.set(s.key, s);
  } catch { /* keep the last list */ }
}

function applyConfig(c) {
  state.showNames = !!c.showNames;
  state.autoAnnounce = c.autoAnnounce !== false;
  $('#manual').hidden = state.autoAnnounce;
}

async function refresh() {
  try {
    state.tickets = await api.queue();
    live(true);
  } catch { live(false); return; }

  // Spot calls we have not seen yet. The first load only records what is already at the counters.
  const calling = state.tickets.filter(t => t.status === 'called');
  for (const t of calling) {
    const key = callKey(t);
    if (state.seen.get(t.called_service) === key) continue;
    state.seen.set(t.called_service, key);
    state.recent.unshift({ token: t.displayToken, service: t.called_service, at: t.called_at });
    if (state.first) continue;
    state.flash.add(t.called_service);
    if (state.autoAnnounce) sound.announce(t.displayToken, labelOf(t.called_service)); // otherwise staff announce by hand
  }
  // A counter that became free forgets its last call, so a recalled ticket is announced again.
  for (const svc of [...state.seen.keys()]) if (!calling.some(t => t.called_service === svc)) state.seen.delete(svc);
  state.recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  state.recent = state.recent.slice(0, RECENT_MAX);
  state.first = false;
  render();
}

/** Staff pressed "Announce" on a ticket that is already at the counter. Always spoken (if sound is on here). */
function onAnnounce(p) {
  state.flash.add(p.service);
  sound.announce(p.displayToken, p.label || labelOf(p.service));
  render();
}

/** A message from staff: show a banner for as long as the server says; speak it unless staff turned speech off. */
let messageTimer = null;
function showMessage(m, { speak = true } = {}) {
  clearTimeout(messageTimer);
  const ms = m && !m.cleared && m.text ? (m.seconds_left ?? 20) * 1000 : 0;
  const bar = $('#message');
  if (!ms) { state.message = null; bar.hidden = true; return; }
  state.message = m;
  mount(bar, icon('megaphone', 40), h('span', { text: m.text }));
  bar.hidden = false;
  if (speak && m.speak !== false) sound.say(m.text);
  messageTimer = setTimeout(() => { state.message = null; bar.hidden = true; }, ms);
}

/* --------------------------------------------------------------- drawing */

function chip(t, first) {
  return h('span', { class: `chip${first ? ' first' : ''}` }, t.priority ? icon('star', 16, { filled: true }) : null, t.displayToken);
}

function column(svc) {
  const serving = state.tickets.find(t => t.status === 'called' && t.called_service === svc.key);
  const waiting = state.tickets.filter(t => t.status === 'waiting' && t.current_service === svc.key).sort((a, b) => (a.position || 0) - (b.position || 0));
  const flash = state.flash.has(svc.key);
  const onBreak = !!svc.paused;
  return h('section', { class: `col${onBreak ? ' paused' : ''}` },
    h('div', { class: 'col-head' }, h('span', { class: 'badge', text: svc.prefix }), h('h2', { text: svc.label })),
    h('div', { class: `serving${flash ? ' flash' : ''}` },
      onBreak && !serving
        ? h('div', { class: 'break' }, icon('coffee', 44), h('b', { text: 'ON BREAK' }), h('span', { text: svc.pause_note || 'We will be back soon' }))
        : [h('small', { text: 'NOW SERVING' }),
          h('div', { class: serving ? 'token' : 'token none', text: serving ? serving.displayToken : '—' }),
          h('div', { class: 'who', text: state.showNames && serving && serving.name ? serving.name : (onBreak ? 'Break after this visit' : '') })]),
    h('div', { class: 'next' },
      h('h3', { text: waiting.length ? 'Next in line' : 'No one waiting' }),
      waiting.length ? h('div', { class: 'chips' },
        waiting.slice(0, SHOW_MAX).map((t, i) => chip(t, i === 0)),
        waiting.length > SHOW_MAX ? h('span', { class: 'more', text: `+${waiting.length - SHOW_MAX} more` }) : null) : null));
}

function render() {
  // A service switched off by the administrator still needs a column while customers are waiting there.
  const known = new Set(state.services.map(s => s.key));
  const orphans = [...new Set(state.tickets.map(t => t.current_service).filter(k => k && !known.has(k)))]
    .map(k => state.known.get(k) || { key: k, label: titleCase(k), prefix: titleCase(k).charAt(0) });
  const all = [...state.services, ...orphans];
  mount($('#board'), all.length ? all.map(column) : h('p', { class: 'empty', text: 'No services are open right now.' }));
  state.flash.clear();

  const recent = $('#recent');
  recent.hidden = state.recent.length === 0;
  if (!recent.hidden) mount(recent, h('strong', { text: 'Recently called' }),
    h('ul', {}, state.recent.map(r => h('li', {}, h('b', { text: r.token }), h('span', { text: labelOf(r.service) })))));
}

function live(ok) { $('#live').classList.toggle('off', !ok); }

/* ----------------------------------------------------------------- tools */

function paintSound() {
  const btn = $('#sound');
  btn.setAttribute('aria-pressed', String(sound.isEnabled()));
  mount(btn, icon(sound.isEnabled() ? 'volume' : 'volumeOff'), sound.isEnabled() ? 'Announcements on' : 'Announcements off');
  btn.hidden = !sound.supported();
}

function paintTheme() {
  const dark = currentTheme() === 'dark';
  const btn = $('#theme');
  mount(btn, icon(dark ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  btn.title = dark ? 'Light theme' : 'Dark theme';
}

function wireTools() {
  const full = $('#full');
  mount(full, icon('expand'));
  full.addEventListener('click', toggleFullscreen);
  document.addEventListener('dblclick', toggleFullscreen);
  paintTheme();
  $('#theme').addEventListener('click', () => { toggleTheme(); paintTheme(); });
  $('#sound').addEventListener('click', async () => {
    if (sound.isEnabled()) sound.disable(); else await sound.enable();
    localStorage.setItem('qms.display.sound', sound.isEnabled() ? '1' : '0');
    paintSound();
  });
  // Hide the mouse pointer and buttons when nobody is using them.
  let idle;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 4000); };
  ['mousemove', 'keydown', 'pointerdown'].forEach(e => document.addEventListener(e, wake));
  wake();
  // After a reload the browser forgets the click that allowed sound; the first click anywhere restores it.
  document.addEventListener('pointerdown', async () => {
    if (!sound.isEnabled() && localStorage.getItem('qms.display.sound') === '1') { await sound.enable(); paintSound(); }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
}

/* ------------------------------------------------------------------ boot */

async function start() {
  wireTools();
  const tick = () => { $('#clock').textContent = fmtClock(); };
  tick(); setInterval(tick, 15000);

  try {
    const c = await api.config();
    applyConfig(c);
    $('#school').textContent = c.schoolName ? `${c.schoolName} · please go to the counter shown when your number is called.` : $('#school').textContent;
    document.title = `Now serving · ${c.schoolName || ''}`.trim();
  } catch { /* defaults */ }
  if (new URLSearchParams(location.search).has('sound') || localStorage.getItem('qms.display.sound') === '1') await sound.tryEnable();
  paintSound();

  await loadServices();
  await refresh();
  api.announcement().then(r => showMessage(r.announcement, { speak: false })).catch(() => {}); // a message already on screen is not read out again

  const refreshSoon = coalesce(refresh, 80, 250);
  connectLive((name, payload) => {
    if (name === 'services_updated') { loadServices().then(refreshSoon.soon); return; }
    if (name === 'settings_updated') { applyConfig({ showNames: state.showNames, ...payload }); return; }
    if (name === 'announcement') { showMessage(payload); return; }
    if (name === 'announce') { onAnnounce(payload); return; }
    refreshSoon.soon();
  }, ok => { live(ok === 'live'); if (ok === 'live') refreshSoon.soon(); });
  setInterval(refresh, 30000); // safety net if the live connection quietly drops
}

start();
