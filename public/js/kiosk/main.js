// Kiosk / customer page controller.
//
// Design rule: the server is the single source of truth. This page remembers only the ticket id and its
// private code; every screen is drawn from a fresh `GET /ticket/:id`. Live events and timers are just
// reasons to ask again, so there is no local state that can drift out of step with the queue.
import { api } from '../shared/api.js';
import { $, h, icon, mount } from '../shared/dom.js';
import { coalesce, connectLive } from '../shared/live.js';
import { currentTheme, toggleTheme } from '../shared/theme.js';
import * as alerts from './alerts.js';
import * as push from './push.js';
import * as store from './store.js';
import { buildHome, calledScreen, cancelSheet, endView, labelOf, routeKeys, slipView, ticketView } from './views.js';

const params = new URLSearchParams(location.search);
const LOBBY = params.has('lobby');         // ?lobby : a shared tablet. No tracking, no cancel, resets between people.
const AUTOPRINT = params.has('autoprint'); // with ?lobby : print the slip as soon as the number is issued
const LINE_EVENTS = new Set(['created', 'called', 'served', 'moved', 'reassigned', 'deleted', 'hold', 'recalled', 'priority_changed']);

const state = {
  lobby: LOBBY,
  config: { schoolName: '', customerTypes: ['Student', 'Faculty', 'Staff', 'Visitor', 'Other'], autoAnnounce: true, prioritySelfService: true },
  services: [], order: [], picked: new Set(), priority: false, name: '', type: '', dragging: false,
  screen: 'boot', conn: 'connecting', busy: false, error: '',
  mine: null, ticket: null, slip: null, push: 'unknown', rating: null,
};

let home = null;
let calledUI = null;
let cancelUI = null;
let lastFetch = 0;
let toastTimer = null;
let slipTimer = null;
let idleTimer = null;
let noticeTimer = null;

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

function paintTheme() {
  const dark = currentTheme() === 'dark';
  const btn = $('#theme');
  mount(btn, icon(dark ? 'sun' : 'moon', 20));
  btn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  btn.title = dark ? 'Light theme' : 'Dark theme';
}

/** A short message from staff ("Registrar closes at noon"), shown for as long as the server says. */
function showNotice(a) {
  clearTimeout(noticeTimer);
  const bar = $('#notice');
  const ms = a && !a.cleared && a.text ? (a.seconds_left ?? 20) * 1000 : 0;
  if (!ms) { bar.hidden = true; return; }
  mount(bar, icon('megaphone', 20), h('span', { text: a.text }));
  bar.hidden = false;
  noticeTimer = setTimeout(() => { bar.hidden = true; }, ms);
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
  if (state.screen === 'home') {
    if (!home) { home = buildHome(state, homeHandlers); mount(screenEl(), home.root); }
    home.paint.all();
  } else if (state.screen === 'ticket' && state.ticket) mount(screenEl(), ticketView(state, actions));
  else if (state.screen === 'slip' && state.slip) mount(screenEl(), slipView(state, actions));
  else if (state.screen === 'served') mount(screenEl(), endView('served', state, actions));
  else if (state.screen === 'gone') mount(screenEl(), endView('gone', state, actions));
  paintChrome();
  setTitle();
}

/* --------------------------------------------------------------- loading */

function applyConfig(c) {
  const before = state.config.prioritySelfService;
  state.config = { ...state.config, ...c };
  $('#org-name').textContent = state.config.schoolName || 'Queue';
  if (!state.type) state.type = state.config.customerTypes[0] || '';
  if (!state.config.prioritySelfService) state.priority = false;
  // The administrator switched the priority lane on or off: redraw the form (what was typed is kept in state).
  if (before !== state.config.prioritySelfService && state.screen === 'home') { home = null; render(); }
}

async function loadConfig() {
  try { applyConfig(await api.config()); } catch { if (!state.type) state.type = state.config.customerTypes[0]; }
}

/** Keep the customer's own arrangement of the list; new services join at the end, vanished ones drop out. */
function mergeServices(list) {
  state.services = list;
  const keys = list.map(s => s.key);
  state.order = [...state.order.filter(k => keys.includes(k)), ...keys.filter(k => !state.order.includes(k))];
  const dropped = [];
  for (const k of [...state.picked]) {
    const s = list.find(x => x.key === k);
    if (!s || s.paused) { state.picked.delete(k); if (s) dropped.push(s.label); }
  }
  if (dropped.length) toast(`${dropped.join(', ')} just went on a break and was taken off your list.`);
}

async function loadServices() {
  try {
    mergeServices(await api.services());
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
  if (prev && !prev.priority && t.priority) toast('Staff gave your ticket priority.');

  alerts.keepAwake(true);
  if (t.status === 'called') {
    if (store.ackedCall() !== t.called_at) showCalled(t);
  } else hideCalled();

  if (state.screen !== 'ticket') go('ticket'); else render();
}

function finish(kind) {
  if (kind === 'served' && state.mine && !LOBBY) {
    // Keep what is needed to rate the visit, even if the page is reloaded.
    state.rating = { id: state.mine.id, secret: state.mine.secret || '', stars: 0, comment: '', busy: false, sent: false, error: '' };
    store.savePendingFeedback({ id: state.mine.id, secret: state.mine.secret || '' });
  }
  store.clearTicket();
  state.mine = null; state.ticket = null;
  hideCalled(); closeCancel();
  alerts.keepAwake(false);
  if (kind === 'served') alerts.nudge();
  go(kind);
}

/* --------------------------------------------------------------- overlays */

function showCalled(t) {
  if (calledUI) return;
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

const repaintHome = () => { if (home) { home.paint.services(); home.paint.route(); home.paint.cta(); } };

const homeHandlers = {
  name: v => { state.name = v; resetIdle(); },
  type: v => { state.type = v; resetIdle(); },
  priority(v) { state.priority = v; if (home) home.paint.cta(); resetIdle(); },
  toggle(key) {
    const svc = state.services.find(s => s.key === key);
    if (svc && svc.paused) return;
    if (state.picked.has(key)) state.picked.delete(key); else state.picked.add(key);
    state.error = '';
    repaintHome();
    resetIdle();
  },
  /** The whole list was dragged into a new order. */
  reorder(keys) { state.order = keys; repaintHome(); resetIdle(); },
  /** The route summary was dragged: put the ticked services into the slots the ticked ones already occupied. */
  reorderRoute(keys) {
    const slots = state.order.map((k, i) => (state.picked.has(k) ? i : -1)).filter(i => i >= 0);
    const next = [...state.order];
    keys.forEach((k, j) => { next[slots[j]] = k; });
    state.order = next;
    repaintHome(); resetIdle();
  },
  /** Keyboard: arrow keys on a grip move one service up or down the list. */
  shift(key, dir) {
    const i = state.order.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= state.order.length) return;
    [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
    repaintHome();
    if (home) home.paint.focusGrip(key);
  },
  moveRoute(i, dir) {
    const keys = routeKeys(state);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    const [a, b] = [keys[i], keys[j]];
    const ai = state.order.indexOf(a), bi = state.order.indexOf(b);
    state.order[ai] = b; state.order[bi] = a;
    repaintHome();
    if (home) home.paint.focusGrip(a, 'route');
  },
  async submit() {
    const route = routeKeys(state);
    if (!route.length || state.busy) return;
    state.busy = true; state.error = '';
    home.paint.cta();
    alerts.unlockAudio(); // this tap is our chance to be allowed to play the alert later
    try {
      const t = await api.createTicket({ name: state.name, quer_type: state.type, services: route, priority: state.priority });
      state.busy = false;
      if (LOBBY) { state.slip = t; resetForm(); go('slip'); startSlipTimer(); if (AUTOPRINT) setTimeout(() => window.print(), 300); return; }
      state.mine = { id: t.id, secret: t.secret };
      store.saveTicket(state.mine);
      state.ticket = t;
      state.priority = false;
      go('ticket');
      alerts.keepAwake(true);
      setupPush(true);
    } catch (e) {
      state.busy = false;
      state.error = e.status === 429 ? 'Too many numbers have been requested from this device. Please ask a staff member for help.'
        : e.status === 400 && /not available/i.test(e.message) ? 'One of those services just closed. Please check your choices and try again.' : e.message;
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
    state.picked.clear(); state.priority = false; state.slip = null; state.error = ''; state.rating = null;
    store.clearPendingFeedback();
    if (!LOBBY) state.name = '';
    go('home');
    loadServices();
  },
  printSlip() { clearTimeout(slipTimer); window.print(); },
  rate(n) { if (state.rating) { state.rating.stars = n; render(); } },
  async sendRating() {
    const r = state.rating;
    if (!r || !r.stars) return;
    r.busy = true; r.error = ''; render();
    try {
      await api.feedback(r.id, { rating: r.stars, comment: r.comment, secret: r.secret });
      r.sent = true; store.clearPendingFeedback();
    } catch (e) {
      if (e.status === 409) { r.sent = true; store.clearPendingFeedback(); }
      else r.error = e.status === 403 ? 'This visit can only be rated from the phone that took the number.' : e.message;
    }
    r.busy = false; render();
  },
  skipRating() { if (state.rating) { state.rating.dismissed = true; store.clearPendingFeedback(); render(); } },
};

async function setupPush(fresh) {
  state.push = await push.availability();
  // Already allowed on this phone: attach this ticket silently. Otherwise offer a button (a tap is required to ask).
  if (state.push === 'on' && state.mine && fresh) { try { await push.enable(state.mine); } catch { /* fall back to in-page alerts */ } }
  if (state.screen === 'ticket') render();
}

/* ----------------------------------------------------------- lobby helpers */

function resetForm() { state.picked.clear(); state.priority = false; state.name = ''; state.error = ''; state.type = state.config.customerTypes[0] || ''; }
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
  if (name === 'services_updated') { servicesRefresh.soon(); return; }
  if (name === 'settings_updated') { applyConfig(payload); return; }
  if (name === 'announcement') { showNotice(payload); return; }
  if (name === 'announce') { // staff called out my number again: ring again even if I dismissed the first alert
    if (state.mine && payload.id === state.mine.id) { store.ackCall(''); ticketRefresh.now(); }
    return;
  }
  if (state.mine && payload.id === state.mine.id) { ticketRefresh.now(); return; } // my own ticket: right away
  if (!LINE_EVENTS.has(name)) return;
  if (state.mine) ticketRefresh.soon(); // somebody else moved: my place may have changed; spread the load
  else if (state.screen === 'home') servicesRefresh.soon();
}

async function boot() {
  paintTheme();
  $('#theme').addEventListener('click', () => { toggleTheme(); paintTheme(); });
  window.addEventListener('afterprint', () => { if (state.screen === 'slip') startSlipTimer(); });

  push.registerWorker();
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', () => { if (state.mine) ticketRefresh.now(); });
  await Promise.all([loadConfig(), loadServices()]);
  api.announcement().then(r => showNotice(r.announcement)).catch(() => {});

  state.mine = LOBBY ? null : store.loadTicket();
  const pending = !LOBBY && !state.mine ? store.loadPendingFeedback() : null;
  if (state.mine) { go('ticket'); await refreshTicket(); setupPush(false); }
  else if (pending) { state.rating = { ...pending, stars: 0, comment: '', busy: false, sent: false, error: '' }; go('served'); }
  else { go('home'); resetIdle(); }

  connectLive(onLive, c => { const was = state.conn; state.conn = c; paintChrome(); if (c === 'live' && was !== 'live') { if (state.mine) ticketRefresh.soon(); else loadServices(); } });

  // Safety net: if live updates quietly stop, a slow poll keeps the page right.
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - lastFetch < (state.conn === 'live' ? 20000 : 6000)) return;
    if (state.mine) refreshTicket(); else if (state.screen === 'home') loadServices();
  }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (state.mine) ticketRefresh.now(); else loadServices(); } });
  window.addEventListener('online', () => { if (state.mine) ticketRefresh.now(); else loadServices(); });
}

boot();
