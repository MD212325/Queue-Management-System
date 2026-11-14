// Public display. Shows tokens only (names stay private unless the administrator turns them on).
import { api } from '../shared/api.js';
import { $, h, icon, mount } from '../shared/dom.js';
import { coalesce, connectLive } from '../shared/live.js';
import { fmtClock } from '../shared/format.js';
import * as sound from './announce.js';

const SHOW_MAX = 6;       // waiting numbers listed per counter
const RECENT_MAX = 6;     // numbers in the "recently called" strip

const state = { services: [], known: new Map(), tickets: [], showNames: false, recent: [], seen: new Map(), first: true, flash: new Set(), conn: false };

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
    if (state.first) { state.recent.unshift({ token: t.displayToken, service: t.called_service, at: t.called_at }); continue; }
    state.recent.unshift({ token: t.displayToken, service: t.called_service, at: t.called_at });
    state.flash.add(t.called_service);
    sound.announce(t.displayToken, labelOf(t.called_service));
  }
  // A counter that became free forgets its last call, so a recalled ticket is announced again.
  for (const svc of [...state.seen.keys()]) if (!calling.some(t => t.called_service === svc)) state.seen.delete(svc);
  state.recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  state.recent = state.recent.slice(0, RECENT_MAX);
  state.first = false;
  render();
}

/* --------------------------------------------------------------- drawing */

function column(svc) {
  const serving = state.tickets.find(t => t.status === 'called' && t.called_service === svc.key);
  const waiting = state.tickets.filter(t => t.status === 'waiting' && t.current_service === svc.key).sort((a, b) => (a.position || 0) - (b.position || 0));
  const flash = state.flash.has(svc.key);
  return h('section', { class: 'col' },
    h('div', { class: 'col-head' }, h('span', { class: 'badge', text: svc.prefix }), h('h2', { text: svc.label })),
    h('div', { class: `serving${flash ? ' flash' : ''}` },
      h('small', { text: 'NOW SERVING' }),
      h('div', { class: serving ? 'token' : 'token none', text: serving ? serving.displayToken : '—' }),
      h('div', { class: 'who', text: state.showNames && serving && serving.name ? serving.name : '' })),
    h('div', { class: 'next' },
      h('h3', { text: waiting.length ? 'Next in line' : 'No one waiting' }),
      waiting.length ? h('div', { class: 'chips' },
        waiting.slice(0, SHOW_MAX).map((t, i) => h('span', { class: i === 0 ? 'chip first' : 'chip', text: t.displayToken })),
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

function live(ok) { state.conn = ok; $('#live').classList.toggle('off', !ok); }

/* ----------------------------------------------------------------- tools */

function paintSound() {
  const btn = $('#sound');
  btn.setAttribute('aria-pressed', String(sound.isEnabled()));
  mount(btn, icon(sound.isEnabled() ? 'volume' : 'volumeOff'), sound.isEnabled() ? 'Sound on' : 'Sound off');
  btn.hidden = !sound.supported();
}

function wireTools() {
  const full = $('#full');
  mount(full, icon('expand'));
  full.addEventListener('click', toggleFullscreen);
  document.addEventListener('dblclick', toggleFullscreen);
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

  try { const c = await api.config(); state.showNames = !!c.showNames; $('#school').textContent = c.schoolName ? `${c.schoolName} · please go to the counter shown when your number is called.` : $('#school').textContent; document.title = `Now serving · ${c.schoolName || ''}`.trim(); } catch { /* defaults */ }
  if (new URLSearchParams(location.search).has('sound') || localStorage.getItem('qms.display.sound') === '1') await sound.tryEnable();
  paintSound();

  await loadServices();
  await refresh();

  const refreshSoon = coalesce(refresh, 80, 250);
  connectLive((name) => {
    if (name === 'services_updated') { loadServices().then(refreshSoon.soon); return; }
    refreshSoon.soon();
  }, ok => { live(ok === 'live'); if (ok === 'live') refreshSoon.soon(); });
  setInterval(refresh, 30000); // safety net if the live connection quietly drops
}

start();
