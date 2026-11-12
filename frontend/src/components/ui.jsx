import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'

/* ----------------------------------- icons ----------------------------------- */
// Hand-drawn 24x24 line icons so the panel needs no icon library (and works offline).
const P = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  list: <><path d="M8.5 6h12M8.5 12h12M8.5 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  chart: <><path d="M4 4v16h16" /><path d="M8.5 16v-5M12.5 16V8M16.5 16v-7" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  megaphone: <><path d="M3.5 10.5v3a1 1 0 0 0 1 1H7l5.5 4v-13L7 9.5H4.5a1 1 0 0 0-1 1Z" /><path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  play: <path d="M8 5.5v13l10-6.5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7" /><path d="m6.5 7 .8 12.5h9.4L17.5 7M10 11v5M14 11v5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  timer: <><circle cx="12" cy="13.5" r="7" /><path d="M12 10v3.5l2 1.5M9.5 3.5h5" /></>,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16.5 14.2a4.6 4.6 0 0 1 4.3 5" /></>,
  logout: <><path d="M10 4.5H5.5v15H10" /><path d="m15 8 4 4-4 4M19 12H9.5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  alert: <><path d="M12 4 21 19.5H3Z" /><path d="M12 10v4M12 16.8v.01" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.8M6.2 7.6A15.8 15.8 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1" /><path d="M10 10a2.8 2.8 0 0 0 4 4" /></>,
  ticket: <><path d="M4 8.5V6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2.5 2.5 0 0 0 0 5v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2.5 2.5 0 0 0 0-5Z" /><path d="M14 6v12" strokeDasharray="1.6 2.2" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4.5v3.5h3.5" /><path d="M12 8v4.5l2.8 1.6" /></>,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
}

export function Icon({ name, size = 18, className = '', title }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {P[name] || null}
    </svg>
  )
}

/* ---------------------------------- buttons ---------------------------------- */

export function Button({ variant = 'secondary', size = 'md', icon, children, busy, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  )
}

export function IconButton({ icon, label, tone = '', size = 16, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${tone}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------- modal ----------------------------------- */

export function Modal({ title, onClose, children, footer, width = 520 }) {
  const titleId = useId()
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const onKey = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled)
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    const auto = ref.current && ref.current.querySelector('[data-autofocus]')
    ;(auto || ref.current)?.focus()
    return () => { document.removeEventListener('keydown', onKey); previous && previous.focus && previous.focus() }
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }} ref={ref} tabIndex={-1}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  )
}

/* ------------------------------- toasts + confirm ------------------------------- */

const FeedbackContext = createContext(null)

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null)
  const nextId = useRef(1)

  const toast = useCallback((text, kind = 'info') => {
    const id = nextId.current++
    setToasts(t => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])

  const confirm = useCallback(opts => new Promise(resolve => setAsk({ ...opts, resolve })), [])
  const answer = v => { ask.resolve(v); setAsk(null) }
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      {ask ? (
        <Modal title={ask.title} onClose={() => answer(false)} width={440}
          footer={<>
            <Button onClick={() => answer(false)}>Cancel</Button>
            <Button variant={ask.tone === 'danger' ? 'danger' : 'primary'} onClick={() => answer(true)} data-autofocus>{ask.confirmLabel || 'Confirm'}</Button>
          </>}>
          <p className="muted">{ask.body}</p>
        </Modal>
      ) : null}
    </FeedbackContext.Provider>
  )
}

export const useFeedback = () => useContext(FeedbackContext)

/** Run an async action, show errors as a toast, and report success to the caller. */
export function useAction() {
  const { toast } = useFeedback()
  return useCallback(async (fn, success) => {
    try {
      const out = await fn()
      if (success) toast(typeof success === 'function' ? success(out) : success, 'success')
      return out
    } catch (e) {
      toast(e.message || 'Something went wrong', 'error')
      return undefined
    }
  }, [toast])
}
