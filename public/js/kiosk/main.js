// Kiosk / customer page controller.
//
// Design rule: the server is the single source of truth. This page remembers only the ticket id and its
// private code; every screen is drawn from a fresh `GET /ticket/:id`. Live events and timers are just
// reasons to ask again, so there is no local state that can drift out of step with the queue.
import { api } from '../shared/api.js';
import { $, mount } from '../shared/dom.js';
import { coalesce, connectLive } from '../shared/live.js';
import * as alerts from './alerts.js';
import * as push from './push.js';
import * as store from './store.js';
import { buildHome, calledScreen, cancelSheet, endView, labelOf, slipView, ticketView } from './views.js';

const params = new URLSearchParams(location.search);
const LOBBY = params.has('lobby'); // ?lobby : a shared tablet. No tracking, no cancel, resets between people.
const LINE_EVENTS = new Set(['created', 'called', 'served', 'moved', 'reassigned', 'deleted', 'hold', 'recalled']);

const state = {
  lobby: LOBBY,
  config: { schoolName: '', customerTypes: ['Student', 'Faculty', 'Staff', 'Visitor', 'Other'] },
  services: [], selected: [], name: '', type: '',
  screen: 'boot', conn: 'connecting', busy: false, error: '',
  mine: null, ticket: null, slip: null, push: 'unknown', cancel: null,
};

let home = null;
let calledUI = null;
let cancelUI = null;
let lastFetch = 0;
let toastTimer = null;
let slipTimer = null;
let idleTimer = null;

const screenEl = () => $('#screen');

/* ------------------------------------------------------------- small UI */

function toast(text, ms = 4500) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function paintChrome() {
  const net = $('#net');
  net.className = `net ${state.conn}`;
  net.lastElementChild.textContent = state.conn === 'live' ? 'Live' : state.conn === 'offline' ? 'Reconnecting…' : 'Connecting…';
  const banner = $('#banner');
  banner.hidden = !state.error || state.screen === 'home';
  banner.textContent = state.screen === 'home' ? '' : state.error;
}

function setTitle() {
  const t = state.ticket;
  const base = state.config.schoolName ? `${state.config.schoolName} · Queue` : 'Queue';
  document.title = t && state.screen === 'ticket' ? `${t.status === 'called' ? '▶ Your turn · ' : ''}${t.displayToken} · ${base}` : base;
}

function go(screen) {
  state.screen = screen;
  if (screen !== 'home') home = null;
  document.body.classList.toggle('lobby', LOBBY);
  document.body.classList.toggle('has-cta', screen === 'home');
  screenEl().classList.toggle('has-ticket', screen !== 'home');
  render();
  window.scrollTo(0, 0);
}

function render() {
  const a = actions;
  if (state.screen === 'home') {
    if (!home) { home = buildHome(state, homeHandlers); mount(screenEl(), home.root); }
    home.paint.all();
  } else if (state.screen === 'ticket' && state.ticket) mount(screenEl(), ticketView(state, a));
  else if (state.screen === 'slip' && state.slip) mount(screenEl(), slipView(state, a));
  else if (state.screen === 'served') mount(screenEl(), endView('served', a));
  else if (state.screen === 'gone') mount(screenEl(), endView('gone', a));
  paintChrome();
  setTitle();
}

/* --------------------------------------------------------------- loading */

async function loadConfig() {
  try {
    const c = await api.config();
    state.config = { ...state.config, ...c };
    $('#org-name').textContent = c.schoolName || 'Queue';
    if (!state.type) state.type = state.config.customerTypes[0] || '';
  } catch { if (!state.type) state.type = state.config.customerTypes[0]; }
}

async function loadServices() {
  try {
    state.services = await api.services();
    // Drop picks for a service that has just been switched off.
    state.selected = state.selected.filter(k => state.services.some(s => s.key === k));
    state.error = state.screen === 'home' ? state.error : '';
    if (state.screen === 'home' && home) { home.paint.services(); home.paint.route(); home.paint.cta(); }
  } catch (e) { if (state.screen === 'home' && !state.services.length) state.error = e.message; }
  lastFetch = Date.now();
}

async function refreshTicket() {
  if (!state.mine) return;
  lastFetch = Date.now();
  try {
    const t = await api.ticket(state.mine.id);
    state.error = '';
    applyTicket(t);
  } catch (e) {
    if (e.status === 404) { finish('gone'); return; }
    state.error = 'Cannot reach the server. Your number is safe; we will keep trying.';
    paintChrome();
  }
}

function applyTicket(t) {
  const prev = state.ticket;
  state.ticket = t;
  if (t.status === 'served') { finish('served'); return; }

  if (prev && prev.current_service !== t.current_service && t.status !== 'called') {
    toast(`Next stop: ${labelOf(state, t.current_service)}. Your number is now ${t.displayToken}.`);
    alerts.nudge();
  }
  if (prev && prev.cancel_requested && !t.cancel_requested) toast('Staff kept your ticket in the line.');

  alerts.keepAwake(true);
  if (t.status === 'called') {
    if (store.ackedCall() !== t.called_at) showCalled(t);
  } else hideCalled();

  if (state.screen !== 'ticket') go('ticket'); else render();
}

function finish(kind) {
  store.clearTicket();
  state.mine = null; state.ticket = null;
  hideCalled(); closeCancel();
  alerts.keepAwake(false);
  if (kind === 'served') alerts.nudge();
  go(kind);
}

/* --------------------------------------------------------------- overlays */

function showCalled(t) {
  if (calledUI) { return; }
  calledUI = calledScreen(state, t, () => { store.ackCall(t.called_at); hideCalled(); });
  mount($('#overlay'), calledUI.root);
  calledUI.focus();
  alerts.startAlarm();
}
function hideCalled() {
  if (!calledUI) return;
  calledUI = null;
  alerts.stopAlarm();
  mount($('#overlay'));
}

function openCancel(error = '', busy = false) {
  cancelUI = cancelSheet({ onSend: sendCancel, onClose: closeCancel, busy, error });
  mount($('#overlay'), cancelUI.root);
  cancelUI.focus();
}
function closeCancel() {
  if (!cancelUI) return;
  cancelUI = null;
  if (!calledUI) mount($('#overlay'));
}
async function sendCancel(reason) {
  openCancel('', true);
  try {
    await api.cancelTicket(state.mine.id, reason, state.mine.secret || '');
    closeCancel();
    toast('Cancel request sent. Staff will review it.');
    await refreshTicket();
  } catch (e) {
    openCancel(e.status === 403 ? 'This ticket can only be cancelled from the phone that created it. Please ask a staff member.' : e.message);
  }
}

/* ------------------------------------------------------------------ actions */

const homeHandlers = {
  name: v => { state.name = v; resetIdle(); },
  type: v => { state.type = v; resetIdle(); },
  toggle(key) {
    const i = state.selected.indexOf(key);
    if (i >= 0) state.selected.splice(i, 1); else state.selected.push(key);
    state.error = '';
    home.paint.services(); home.paint.route(); home.paint.cta();
    resetIdle();
  },
  move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= state.selected.length) return;
    [state.selected[i], state.selected[j]] = [state.selected[j], state.selected[i]];
    home.paint.route(); home.paint.cta();
  },
  async submit() {
    if (!state.selected.length || state.busy) return;
    state.busy = true; state.error = '';
    home.paint.cta();
    alerts.unlockAudio(); // this tap is our chance to be allowed to play the alert later
    try {
      const t = await api.createTicket({ name: state.name, quer_type: state.type, services: state.selected });
      state.busy = false;
      if (LOBBY) { state.slip = t; resetForm(); go('slip'); startSlipTimer(); return; }
      state.mine = { id: t.id, secret: t.secret };
      store.saveTicket(state.mine);
      state.ticket = t;
      go('ticket');
      alerts.keepAwake(true);
      setupPush(true);
    } catch (e) {
      state.busy = false;
      state.error = e.status === 429 ? 'Too many numbers have been requested from this device. Please ask a staff member for help.'
        : e.status === 400 ? 'One of those services just closed. Please check your choices and try again.' : e.message;
      if (e.status === 400) loadServices();
      if (home) home.paint.cta(); else paintChrome();
    }
  },
};

const actions = {
  openCancel: () => openCancel(),
  enablePush: async () => {
    try { state.push = await push.enable(state.mine); } catch { state.push = 'ready'; toast('Could not turn on alerts. Keep this page open instead.'); }
    if (state.push === 'on') toast('Alerts are on. We will notify you when it is your turn.');
    render();
  },
  again() {
    clearTimeout(slipTimer);
    state.selected = []; state.slip = null; state.error = '';
    if (!LOBBY) state.name = '';
    go('home');
    loadServices();
  },
};

async function setupPush(fresh) {
  state.push = await push.availability();
  // Already allowed on this phone: attach this ticket silently. Otherwise offer a button (a tap is required to ask).
  if (state.push === 'on' && state.mine && fresh) { try { await push.enable(state.mine); } catch { /* fall back to in-page alerts */ } }
  if (state.screen === 'ticket') render();
}

/* ----------------------------------------------------------- lobby helpers */

function resetForm() { state.selected = []; state.name = ''; state.error = ''; state.type = state.config.customerTypes[0] || ''; }
function startSlipTimer() { clearTimeout(slipTimer); slipTimer = setTimeout(() => actions.again(), 25000); }
function resetIdle() {
  if (!LOBBY) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (state.screen === 'home') { resetForm(); go('home'); } }, 90000);
}

/* ------------------------------------------------------------------ boot */

const ticketRefresh = coalesce(() => refreshTicket());
const servicesRefresh = coalesce(() => loadServices());

function onLive(name, payload) {
  if (name === 'services_updated') { loadConfig(); servicesRefresh.soon(); return; }
  if (state.mine && payload.id === state.mine.id) { ticketRefresh.now(); return; } // my own ticket: right away
  if (!LINE_EVENTS.has(name)) return;
  if (state.mine) ticketRefresh.soon(); // somebody else moved: my place may have changed; spread the load
  else if (state.screen === 'home') servicesRefresh.soon();
}

async function boot() {
  push.registerWorker();
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', () => { if (state.mine) ticketRefresh.now(); });
  await Promise.all([loadConfig(), loadServices()]);

  state.mine = LOBBY ? null : store.loadTicket();
  if (state.mine) { go('ticket'); await refreshTicket(); setupPush(false); } else { go('home'); resetIdle(); }

  connectLive(onLive, c => { const was = state.conn; state.conn = c; paintChrome(); if (c === 'live' && was !== 'live') { state.mine ? ticketRefresh.soon() : loadServices(); } });

  // Safety net: if live updates quietly stop, a slow poll keeps the page right.
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastFetch < (state.conn === 'live' ? 20000 : 6000)) return;
    if (state.mine) refreshTicket(); else if (state.screen === 'home') loadServices();
  }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { state.mine ? ticketRefresh.now() : loadServices(); } });
  window.addEventListener('online', () => { state.mine ? ticketRefresh.now() : loadServices(); });
}

boot();
