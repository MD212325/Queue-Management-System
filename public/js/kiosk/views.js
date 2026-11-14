// Screens for the kiosk page. Pure builders: they read state and return DOM; main.js decides when to show them.
import { h, icon, mount } from '../shared/dom.js';
import { fmtMinutes, fmtWait } from '../shared/format.js';

export const labelOf = (state, key) => (state.services.find(s => s.key === key) || {}).label || key || '';

/* ------------------------------------------------------------------ home */

function serviceCard(svc, order, onToggle) {
  const quiet = svc.waiting === 0 && !svc.serving;
  const meta = quiet
    ? h('span', { class: 'meta' }, h('strong', { text: 'No wait' }), 'walk right in')
    : h('span', { class: 'meta' }, h('strong', { text: fmtWait(svc.eta_seconds) }), `${svc.waiting} waiting`);
  return h('button', {
    type: 'button', class: `svc${quiet ? ' quiet' : ''}`, 'aria-pressed': order > 0 ? 'true' : 'false', onClick: () => onToggle(svc.key),
  },
  h('span', { class: 'prefix', text: svc.prefix }),
  h('span', {}, h('b', { text: svc.label }), h('small', { text: `About ${fmtMinutes(svc.allotted_seconds)} per visit` })),
  meta,
  order > 0 ? h('span', { class: 'order', text: String(order), 'aria-label': `Step ${order}` }) : null);
}

/** Returns { root, paint } where paint.* update one region without disturbing what the person is typing. */
export function buildHome(state, on) {
  const list = h('div', { class: 'svc-list', role: 'group', 'aria-label': 'Services' });
  const route = h('div');
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const goBtn = h('button', { id: 'go', type: 'submit', form: 'ticket-form', class: 'btn btn-yellow btn-lg btn-block' });
  const goSub = h('p', { class: 'cta-sub' });

  const name = h('input', { type: 'text', maxlength: '80', autocomplete: state.lobby ? 'off' : 'name', placeholder: 'So staff can greet you', onInput: e => on.name(e.target.value) });
  name.value = state.name;
  const type = h('select', { onChange: e => on.type(e.target.value) }, state.config.customerTypes.map(t => h('option', { value: t, text: t })));
  type.value = state.type;

  const form = h('form', { id: 'ticket-form', class: 'details', noValidate: true, onSubmit: e => { e.preventDefault(); on.submit(); } },
    h('label', { class: 'field' }, h('span', {}, 'Your name ', h('em', { text: '(optional)' })), name),
    h('label', { class: 'field' }, h('span', { text: 'I am a…' }), type),
    error);

  const root = h('div', { class: 'home' },
    h('section', { class: 'intro' },
      h('h1', { text: 'Get your queue number' }),
      h('p', { text: 'Choose where you need to go. Have more than one errand? Pick them all and we will send you from one counter to the next.' })),
    list, route,
    h('h2', { class: 'section-label', text: 'About you' }), form,
    h('div', { class: 'cta' }, h('div', {}, goBtn, goSub)));

  const paint = {
    services() {
      if (!state.services.length) { mount(list, h('p', { class: 'loading', text: 'No services are open right now. Please ask a staff member.' })); return; }
      mount(list, state.services.map(s => serviceCard(s, state.selected.indexOf(s.key) + 1, on.toggle)));
    },
    route() {
      if (state.selected.length < 2) { mount(route); return; }
      mount(route, h('div', { class: 'route' },
        h('h2', { text: 'Your route, in order' }),
        h('ol', {}, state.selected.map((key, i) => h('li', {},
          h('span', { class: 'n', text: String(i + 1) }),
          h('span', { class: 'name', text: labelOf(state, key) }),
          h('button', { type: 'button', class: 'mini', disabled: i === 0, 'aria-label': `Move ${labelOf(state, key)} earlier`, onClick: () => on.move(i, -1) }, icon('up', 18)),
          h('button', { type: 'button', class: 'mini', disabled: i === state.selected.length - 1, 'aria-label': `Move ${labelOf(state, key)} later`, onClick: () => on.move(i, 1) }, icon('down', 18)),
          h('button', { type: 'button', class: 'mini', 'aria-label': `Remove ${labelOf(state, key)}`, onClick: () => on.toggle(key) }, icon('x', 18)))))));
    },
    cta() {
      const first = state.services.find(s => s.key === state.selected[0]);
      goBtn.disabled = !state.selected.length || state.busy;
      mount(goBtn, state.busy ? 'Getting your number…' : [icon('ticket', 22), 'Get my number']);
      goSub.textContent = first ? `First stop: ${first.label} · wait ${first.waiting || first.serving ? fmtWait(first.eta_seconds) : 'none right now'}` : 'Pick at least one service';
      error.hidden = !state.error;
      error.textContent = state.error || '';
    },
    all() { this.services(); this.route(); this.cta(); },
  };
  return { root, paint };
}

/* ---------------------------------------------------------------- ticket */

function steps(state, t) {
  if (t.services.length < 2) return null;
  return h('section', { class: 'card' },
    h('h2', { text: 'Your route' }),
    h('ol', { class: 'steps' }, t.services.map((key, i) => h('li', { class: i < t.service_index ? 'done' : i === t.service_index ? 'current' : '' },
      i < t.service_index ? icon('check', 14) : h('span', { class: 'n', text: String(i + 1) }), labelOf(state, key)))));
}

export function ticketView(state, a) {
  const t = state.ticket;
  const where = labelOf(state, t.current_service);
  let headline; let sub = where;
  if (t.status === 'called') { headline = "It's your turn!"; sub = `Please go to ${where}`; }
  else if (t.status === 'hold') { headline = 'Your ticket is on hold'; sub = `Please see the staff at ${where}`; }
  else if (t.position === 1) { headline = "You're next in line"; sub = `at ${where}`; }
  else if (t.position > 1) { headline = `${t.position - 1} ${t.position === 2 ? 'person' : 'people'} ahead of you`; sub = `at ${where}`; }
  else { headline = 'You are in the queue'; }

  const waiting = t.status === 'waiting';
  const notifyCard = state.push === 'ready'
    ? h('div', { class: 'notice' }, icon('bell', 22), h('div', {},
      h('p', { text: 'Want an alert even if you close this page or lock your phone?' }),
      h('button', { type: 'button', class: 'btn btn-blue', onClick: a.enablePush }, 'Turn on alerts')))
    : state.push === 'blocked'
      ? h('div', { class: 'notice warn' }, icon('alert', 22), h('p', { text: 'Alerts are blocked in your browser settings. Keep this page open and we will beep and vibrate when it is your turn.' }))
      : null;

  return h('div', { class: 'ticket' },
    h('section', { class: `hero ${t.status === 'called' ? 'called' : t.status === 'hold' ? 'hold' : ''}`, 'aria-live': 'polite' },
      h('small', { text: 'Your number' }),
      h('div', { class: 'token', text: t.displayToken }),
      h('div', { class: 'headline', text: headline }),
      h('div', { class: 'sub', text: sub })),
    waiting ? h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Estimated wait' }), h('strong', { text: fmtWait(t.eta_seconds) || '–' })),
      h('div', { class: 'fact' }, h('span', { text: 'Your place' }), h('strong', { text: t.position ? `#${t.position}` : '–' })),
      h('div', { class: 'fact wide' }, h('small', { text: 'The estimate is a guess based on how long recent visits took. It updates as the line moves.' }))) : null,
    steps(state, t),
    t.cancel_requested ? h('div', { class: 'notice warn' }, icon('clock', 22), h('p', { text: 'Your cancel request was sent. Staff will review it shortly.' })) : null,
    notifyCard,
    h('div', { class: 'stack' },
      t.cancel_requested ? null : h('button', { type: 'button', class: 'btn btn-danger btn-block', onClick: a.openCancel }, 'Cancel my ticket')),
    h('p', { class: 'foot', text: 'Keep this page open. This number is saved on this phone, so you can come back to it.' }));
}

export function endView(kind, a) {
  const served = kind === 'served';
  return h('div', { class: 'center' },
    h('span', { class: 'badge-ok' }, icon(served ? 'check' : 'alert', 44)),
    h('h1', { text: served ? 'Thank you!' : 'Your ticket is closed' }),
    h('p', { text: served ? 'Your visit is complete. Have a great day.' : 'It is no longer in the queue. Staff may have removed it, or it was already completed.' }),
    h('button', { type: 'button', class: 'btn btn-yellow btn-lg', onClick: a.again }, 'Take a new number'));
}

/** Lobby (shared tablet) confirmation: shown for a few seconds, then the next person can start. */
export function slipView(state, a) {
  const t = state.slip;
  return h('div', { class: 'slip' },
    h('section', { class: 'hero' },
      h('small', { text: 'Your number' }),
      h('div', { class: 'token', text: t.displayToken }),
      h('div', { class: 'headline', text: `Please wait for ${t.displayToken} on the screen` }),
      h('div', { class: 'sub', text: t.services.map(k => labelOf(state, k)).join('  →  ') })),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Estimated wait' }), h('strong', { text: fmtWait(t.eta_seconds) || '–' })),
      h('div', { class: 'fact' }, h('span', { text: 'People ahead' }), h('strong', { text: String(Math.max(0, (t.position || 1) - 1)) }))),
    h('p', { text: 'Please remember your number. It will be shown on the display when you are called.' }),
    h('div', { class: 'stack' }, h('button', { type: 'button', class: 'btn btn-yellow btn-lg btn-block', onClick: a.again }, 'Done, next person')));
}

/* -------------------------------------------------------------- overlays */

export function calledScreen(state, t, onOk) {
  const where = labelOf(state, t.called_service || t.current_service);
  const ok = h('button', { type: 'button', class: 'btn btn-lg', onClick: onOk }, "I'm on my way");
  const root = h('div', { class: 'called-screen', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': `Ticket ${t.displayToken} is called` },
    h('small', { text: 'Now calling' }),
    h('div', { class: 'token', text: t.displayToken }),
    h('h1', { text: `Please go to ${where}` }),
    h('p', { text: 'Show this screen to the staff member.' }),
    ok);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') onOk(); });
  return { root, focus: () => ok.focus() };
}

export function cancelSheet({ onSend, onClose, busy, error }) {
  const reason = h('textarea', { maxlength: '300', placeholder: 'For example: I have to leave for class', 'aria-label': 'Reason for cancelling' });
  const send = h('button', { type: 'button', class: 'btn btn-danger', onClick: () => onSend(reason.value.trim()) }, busy ? 'Sending…' : 'Send request');
  send.disabled = !!busy;
  const root = h('div', { class: 'backdrop', onClick: e => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cancel my ticket' },
      h('h2', { text: 'Cancel my ticket?' }),
      h('p', { text: 'Staff will review your request and take you out of the line. Tell them why, if you like.' }),
      reason,
      error ? h('p', { class: 'form-error', role: 'alert', text: error }) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onClick: onClose }, 'Keep my place'), send)));
  root.addEventListener('keydown', e => { if (e.key === 'Escape') onClose(); });
  return { root, focus: () => reason.focus() };
}
