import { useServerNow } from '../hooks.js'
import { fmtClock, fmtDuration, fmtEta, serviceLabel, timerState, waitSeconds } from '../utils.js'
import { Button, Icon, IconButton, Menu } from './ui.jsx'

const R = 84
const C = 2 * Math.PI * R

/** Ring that drains as the allotted time is used. Turns amber near the end and red once over time. */
function Dial({ token, ticket }) {
  const now = useServerNow()
  const t = timerState(ticket, now)
  const over = t.state === 'over'
  const time = over ? `+${fmtClock(-t.remaining)}` : fmtClock(t.remaining)
  const caption = over ? 'over time' : t.state === 'warn' ? 'almost up' : 'remaining'
  return (
    <div className={`dial ${t.state}`} role="img" aria-label={`Ticket ${token}, ${time} ${caption}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="dial-track" cx="100" cy="100" r={R} />
        <circle className="dial-arc" cx="100" cy="100" r={R}
          strokeDasharray={`${over ? C : C * t.pct} ${C}`} transform="rotate(-90 100 100)" />
      </svg>
      <div className="dial-center">
        <span className="dial-token">{token}</span>
        <span className="dial-time">{time}</span>
        <span className="dial-caption">{caption}</span>
      </div>
    </div>
  )
}

/** Live "waited 12 min" label. Only this tiny component re-renders every second. */
export function Elapsed({ ticket }) {
  const now = useServerNow()
  const s = waitSeconds(ticket, now)
  return <span className="wait">{s < 60 ? '< 1 min' : fmtDuration(Math.floor(s / 60) * 60)}</span>
}

export function PriorityMark({ ticket }) {
  return ticket.priority ? <Icon name="star" size={13} filled className="pri" title="Priority ticket" /> : null
}

function Journey({ ticket, services }) {
  if (ticket.services.length < 2) return null
  return (
    <ol className="journey" aria-label="Services for this ticket">
      {ticket.services.map((key, i) => (
        <li key={key} className={i < ticket.service_index ? 'done' : i === ticket.service_index ? 'current' : ''}>
          {i < ticket.service_index ? <Icon name="check" size={12} /> : <span className="step-n">{i + 1}</span>}
          {serviceLabel(services, key)}
        </li>
      ))}
    </ol>
  )
}

function WaitingRow({ ticket, position, callBlock, act, onReview }) {
  const stage = ticket.services.length > 1 ? `Step ${ticket.service_index + 1} of ${ticket.services.length}` : ''
  return (
    <li className={`wrow ${position === 1 ? 'is-next' : ''}`}>
      <span className="tok">{ticket.displayToken}</span>
      <div className="who">
        <b><PriorityMark ticket={ticket} />{ticket.name || 'Walk-in'}</b>
        <small>{[ticket.priority ? 'Priority' : '', ticket.quer_type, stage].filter(Boolean).join(' · ') || ' '}</small>
        {ticket.cancel_requested ? (
          <button type="button" className="pill pill-over linkish" onClick={() => onReview(ticket)}>Cancel requested · review</button>
        ) : null}
      </div>
      <div className="wmeta">
        <Elapsed ticket={ticket} />
        {ticket.eta_seconds ? <small title="Estimated time until this ticket is called">{fmtEta(ticket.eta_seconds)}</small> : <small>next up</small>}
      </div>
      <div className="wactions">
        <IconButton icon="megaphone" label={callBlock ? `Cannot call ${ticket.displayToken}: ${callBlock}` : `Call ${ticket.displayToken} now`}
          disabled={!!callBlock} onClick={() => act.call(ticket)} />
        <Menu label={`More actions for ${ticket.displayToken}`} items={[
          { label: ticket.priority ? 'Remove priority' : 'Give priority', icon: 'star', onClick: () => act.priority(ticket) },
          { label: 'Put on hold', icon: 'pause', onClick: () => act.hold(ticket) },
          { label: 'Remove ticket', icon: 'trash', tone: 'danger', onClick: () => act.remove(ticket) },
        ]} />
      </div>
    </li>
  )
}

function HeldRow({ ticket, callBlock, act }) {
  return (
    <li className="wrow held">
      <span className="tok">{ticket.displayToken}</span>
      <div className="who">
        <b><PriorityMark ticket={ticket} />{ticket.name || 'Walk-in'}</b>
        <small>{callBlock ? 'Counter busy' : `On hold · ${ticket.quer_type || 'no type'}`}</small>
      </div>
      <div className="wactions wide">
        <Button size="sm" icon="play" onClick={() => act.recall(ticket)} disabled={!!callBlock} title={callBlock || 'Call this ticket back to the counter'}>Recall</Button>
        <IconButton icon="trash" tone="danger" label={`Remove ${ticket.displayToken}`} onClick={() => act.remove(ticket)} />
      </div>
    </li>
  )
}

export default function CounterCard({ service, services, tickets, act, onReview }) {
  const now = useServerNow()
  const serving = tickets.find(t => t.status === 'called' && t.called_service === service.key)
  const waiting = tickets.filter(t => t.status === 'waiting' && t.current_service === service.key)
    .sort((a, b) => (a.position || 0) - (b.position || 0))
  const held = tickets.filter(t => t.status === 'hold' && t.current_service === service.key)
  const ts = serving ? timerState(serving, now) : null
  const paused = !!service.paused
  const state = serving ? ts.state : paused ? 'break' : 'idle'
  const stateLabel = { idle: 'Free', break: 'On break', ok: 'Serving', warn: 'Almost up', over: 'Over time' }[state]
  const nextStop = serving && serving.service_index + 1 < serving.services.length
    ? serviceLabel(services, serving.services[serving.service_index + 1]) : null
  // Why a waiting ticket cannot be called right now (shown as the button's tooltip).
  const callBlock = serving ? 'finish or hold the current ticket first' : paused ? 'the counter is on break' : ''

  return (
    <section className={`counter state-${state} ${service.enabled ? '' : 'is-disabled'}`} aria-label={`${service.label} counter`}>
      <header className="counter-head">
        <span className="prefix" aria-hidden="true">{service.prefix}</span>
        <div className="counter-title">
          <h3>{service.label}</h3>
          <p><Icon name="timer" size={13} /> {fmtDuration(service.allotted_seconds)} per customer{service.enabled ? '' : ' · hidden from kiosk'}</p>
        </div>
        <span className={`pill pill-${state}`}>{stateLabel}</span>
        {paused ? null : <IconButton icon="coffee" label={`Pause ${service.label} (break)`} onClick={() => act.pause(service)} />}
      </header>

      {serving ? (
        <div className="serving">
          {paused ? (
            <div className="break-note">
              <Icon name="coffee" size={16} />
              <span>On break after this visit{service.pause_note ? ` · ${service.pause_note}` : ''}</span>
              <Button size="sm" onClick={() => act.resume(service)}>Resume</Button>
            </div>
          ) : null}
          <Dial token={serving.displayToken} ticket={serving} />
          <div className="serving-who">
            <b><PriorityMark ticket={serving} />{serving.name || 'Walk-in customer'}</b>
            <span>{[serving.priority ? 'Priority' : '', serving.quer_type || 'Type not given'].filter(Boolean).join(' · ')}</span>
          </div>
          <Journey ticket={serving} services={services} />
          {serving.extended_seconds ? <p className="extra"><Icon name="plus" size={12} /> {fmtDuration(serving.extended_seconds)} extra time given</p> : null}
          {serving.cancel_requested ? (
            <div className="cancel-note" role="alert">
              <Icon name="alert" size={16} />
              <div><b>Customer asked to cancel</b><span>{serving.cancel_reason || 'No reason given'}</span></div>
              <Button size="sm" onClick={() => onReview(serving)}>Review</Button>
            </div>
          ) : null}
          <p className="next-hint">{nextStop ? <>When complete, this ticket goes to <b>{nextStop}</b>.</> : 'This is the last stop for this ticket.'}</p>
          <Button variant="primary" size="lg" icon="check" className="wide" onClick={() => act.complete(serving)}>Complete</Button>
          <div className="serving-tools">
            <Button size="sm" icon="plus" onClick={() => act.extend(serving, 120)}>2 min</Button>
            <Button size="sm" icon="plus" onClick={() => act.extend(serving, 300)}>5 min</Button>
            <Button size="sm" icon="pause" onClick={() => act.hold(serving)}>Hold</Button>
          </div>
          <Button size="sm" icon="volume" className="wide" onClick={() => act.announceTicket(serving)}
            title="Call this number out again on the public display and on the customer's phone">Announce again</Button>
        </div>
      ) : paused ? (
        <div className="idle">
          <div className="idle-ring" aria-hidden="true"><Icon name="coffee" size={34} /></div>
          <p className="idle-title">On break</p>
          <p className="idle-sub">{service.pause_note || 'Customers cannot take new numbers for this counter.'}</p>
          <Button variant="primary" size="lg" icon="play" className="wide" onClick={() => act.resume(service)}>Resume counter</Button>
        </div>
      ) : (
        <div className="idle">
          <div className="idle-ring" aria-hidden="true"><Icon name="megaphone" size={34} /></div>
          <p className="idle-title">{waiting.length ? 'Counter is free' : 'Nobody is waiting'}</p>
          <p className="idle-sub">{waiting.length ? <>Next in line: <b>{waiting[0].displayToken}</b>{waiting[0].name ? ` · ${waiting[0].name}` : ''}</> : 'New tickets will appear below.'}</p>
          <Button variant="call" size="lg" icon="megaphone" className="wide" disabled={!waiting.length} onClick={() => act.callNext(service)}>Call next</Button>
        </div>
      )}

      <div className="queue-list">
        <h4>
          <span>Waiting</span>
          <span className="count">{waiting.length}</span>
          {waiting.length ? <small>last in line waits {fmtEta(waiting[waiting.length - 1].eta_seconds)}</small> : null}
        </h4>
        {waiting.length || held.length ? (
          <ul>
            {waiting.map((t, i) => <WaitingRow key={t.id} ticket={t} position={i + 1} callBlock={callBlock} act={act} onReview={onReview} />)}
            {held.map(t => <HeldRow key={t.id} ticket={t} callBlock={callBlock} act={act} />)}
          </ul>
        ) : <p className="empty-note">The line is clear.</p>}
      </div>
    </section>
  )
}
