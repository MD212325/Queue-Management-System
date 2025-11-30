import React, { useEffect, useState, useRef } from 'react';
import './display.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const STAFF_KEY = import.meta.env.VITE_STAFF_KEY || 'STI-QUEUE-KEY';

async function safeJson(res) {
  try { return await res.json(); }
  catch (e) { return { _parseError: true, text: await (res.text().catch(()=>'')) }; }
}

const AVAILABLE_SERVICES = [
  { key: 'registrar', label: 'Registrar' },
  { key: 'cashier', label: 'Cashier' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'records', label: 'Records' }
];

const QUER_TYPES = ['Student','Faculty/Staff','Visitor','Other'];

function arrayMove(arr, fromIndex, toIndex) {
  const copy = arr.slice();
  const [el] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, el);
  return copy;
}

function DraggableServiceList({ services, selected = [], onChange }) {
  const [order, setOrder] = useState(services.map(s => s.key));
  const [draggingKey, setDraggingKey] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setOrder(services.map(s => s.key));
  }, [services]);

  function updateOrder(newOrder) {
    setOrder(newOrder);
    if (onChange) {
      const orderedSelected = newOrder.filter(k => selected.includes(k));
      onChange(orderedSelected);
    }
  }

  function onDragStart(e, key) {
    setDraggingKey(key);
    const img = document.createElement('canvas');
    img.width = img.height = 1;
    e.dataTransfer.setDragImage(img, 0, 0);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, overKey) {
    e.preventDefault();
    if (!draggingKey || draggingKey === overKey) return;
    const from = order.indexOf(draggingKey);
    const to = order.indexOf(overKey);
    if (from === -1 || to === -1) return;
    const next = arrayMove(order, from, to);
    if (next.join(',') !== order.join(',')) updateOrder(next);
  }

  let touchState = useRef({ key: null, started: false }).current;

  function onTouchStart(e, key) {
    touchState.key = key;
    touchState.started = true;
    setDraggingKey(key);
    e.target && e.target.addEventListener('touchmove', preventScroll, { passive: false });
  }
  function preventScroll(e) { e.preventDefault(); }
  function onTouchMove(e) {
    if (!touchState.started) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el) return;
    const row = el.closest && el.closest('.dr-svc-row');
    if (!row || !containerRef.current || !containerRef.current.contains(row)) return;
    const overKey = row.dataset.key;
    if (!overKey || overKey === touchState.key) return;
    const from = order.indexOf(touchState.key);
    const to = order.indexOf(overKey);
    if (from === -1 || to === -1) return;
    const next = arrayMove(order, from, to);
    if (next.join(',') !== order.join(',')) updateOrder(next);
  }
  function onTouchEnd() {
    touchState.started = false;
    touchState.key = null;
    setDraggingKey(null);
    document.querySelectorAll('.dr-svc-row').forEach(r => r.removeEventListener('touchmove', preventScroll));
  }

  return (
    <div ref={containerRef}>
      <div style={{fontSize:13, color:'#555', marginBottom:6}}>Select service(s): <small style={{color:'#888'}}>(drag to reorder selected)</small></div>
      <div>
        {order.map(key => {
          const svc = services.find(s => s.key === key);
          const isChecked = selected.includes(key);
          return (
            <div
              key={key}
              className={`dr-svc-row ${draggingKey === key ? 'dragging' : ''}`}
              data-key={key}
              draggable
              onDragStart={(e) => onDragStart(e, key)}
              onDragOver={(e) => onDragOver(e, key)}
              onDrop={() => setDraggingKey(null)}
              onTouchStart={(e) => onTouchStart(e, key)}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{
                display:'flex',
                alignItems:'center',
                gap:10,
                padding:'10px',
                borderRadius:6,
                background:'#fff',
                boxShadow:'0 1px 2px rgba(0,0,0,0.05)',
                marginBottom:8,
              }}
            >
              <div style={{width:28, textAlign:'center', cursor:'grab'}} title="Drag to reorder">☰</div>
              <div style={{flex:1}}>
                <label style={{display:'flex', alignItems:'center', gap:8}}>
                  <input type="checkbox" checked={isChecked} onChange={() => {
                    const nextSelected = isChecked ? selected.filter(s=>s!==key) : [...selected, key];
                    const orderedSelected = order.filter(k => nextSelected.includes(k));
                    onChange && onChange(orderedSelected);
                  }} />
                  <div style={{fontWeight:600}}>{svc ? svc.label : key}</div>
                </label>
              </div>

              <div style={{display:'flex', flexDirection:'column', gap:6}}>
                <button onClick={() => {
                  const idx = order.indexOf(key);
                  if (idx > 0) updateOrder(arrayMove(order, idx, idx-1));
                }} title="Move up">↑</button>
                <button onClick={() => {
                  const idx = order.indexOf(key);
                  if (idx < order.length-1) updateOrder(arrayMove(order, idx, idx+1));
                }} title="Move down">↓</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext, onClearCancel, onViewCancel }) {
  const prepared = tickets.map(t => {
    let services = [];
    try { services = Array.isArray(t.services) ? t.services : JSON.parse(t.services || '[]'); } catch(e) { services = []; }
    return {
      ...t,
      current_service: (services && services.length > (t.service_index || 0)) ? services[t.service_index || 0] : null,
      displayToken: (service[0] || '').toUpperCase() + String(t.id).padStart(3,'0'),
      services,
      cancel_requested: Boolean(Number(t.cancel_requested || 0)),
      cancel_reason: t.cancel_reason || ''
    };
  });
  const visible = prepared.filter(t => t.current_service === service);
  const called = prepared.find(t => t.status === 'called' && t.called_service === service);

  return (
    <div className="service-card" style={{
      flex:1, minWidth:260, margin:10, padding:10, borderRadius:6, background:'#0f2940', color:'#fff', boxShadow:'0 6px 16px rgba(0,0,0,0.2)'
    }}>
      <h3 style={{textAlign:'center', margin:0, padding:8, fontSize:16, letterSpacing:1}}>{service.toUpperCase()}</h3>
      <button style={{ width:'100%', margin:'10px 0' }} onClick={() => onCallNext && onCallNext(service)}>
        Call Next ({service})
      </button>

      {called ? (
        <div style={{
          background:'#111', padding:16, marginBottom:12, borderRadius:6, display:'flex', alignItems:'center', gap:12
        }}>
          <div style={{fontSize:56, fontWeight:700, lineHeight:1, cursor: called.cancel_requested ? 'pointer' : 'default'}}
               onClick={() => {
                 if (called.cancel_requested && onViewCancel) onViewCancel(called);
                 else if (called.cancel_requested) alert('Cancel request reason:\n\n' + (called.cancel_reason || '(no reason provided)'));
               }}>
            {called.displayToken}
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:18, fontWeight:600}}>{called.name || 'No name'}</div>
            <div style={{fontSize:12, color:'#ddd'}}>{called.quer_type || ''}</div>

            {called.cancel_requested ? (
              <div style={{marginTop:8, color:'#ffb3b3', fontWeight:700}}>
                Cancel requested — reason: {called.cancel_reason || '(no reason)'}
                <div style={{marginTop:8}}>
                  <button onClick={() => onClearCancel && onClearCancel(called.id)} style={{marginRight:6}}>Clear Cancel Request</button>
                </div>
              </div>
            ) : null}

            <div style={{marginTop:8}}>
              <button onClick={() => onServe && onServe(called.id, service)} style={{marginRight:6}}>Serve</button>
              <button onClick={() => onHold && onHold(called.id)} style={{marginRight:6}}>Hold</button>
              <button onClick={() => onDelete && onDelete(called.id)} className="delete" style={{marginRight:6}}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ background:'#2b3b4a' }}>
            <th style={{padding:6, textAlign:'left'}}>Token</th>
            <th style={{padding:6, textAlign:'left'}}>Name</th>
            <th style={{padding:6, textAlign:'left'}}>Type</th>
            <th style={{padding:6, textAlign:'left'}}>Status</th>
            <th style={{padding:6, textAlign:'left'}}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(q => {
            if (called && called.id === q.id) return null;
            return (
              <tr key={q.id} style={q.cancel_requested ? { background: 'rgba(255, 100, 100, 0.04)' } : {}}>
                <td style={{padding:6, cursor: q.cancel_requested ? 'pointer' : 'default'}} onClick={() => {
                  if(q.cancel_requested) {
                    if (onViewCancel) onViewCancel(q);
                    else alert('Cancel request reason:\n\n' + (q.cancel_reason || '(no reason provided)'));
                  }
                }}>{q.displayToken || String(q.id).padStart(3,'0')}</td>
                <td style={{padding:6}}>{q.name || '—'}</td>
                <td style={{padding:6}}>{q.quer_type || '—'}</td>
                <td style={{padding:6}}>
                  {q.status === 'called' ? `Called (${q.called_service})` : q.status}
                  <div style={{fontSize:9, color:'#cfe6ff'}}>Progress: {Number(q.service_index || 0) + 1}/{(q.services || []).length}</div>
                  {q.cancel_requested ? <button onClick={() => onViewCancel && onViewCancel(q)} style={{paddingTop:1,fontSize:10}}>Request</button> : null}
                </td>
                <td style={{padding:6}}>
                  <div className="actions">
                    <button
                      onClick={() => onServe && onServe(q.id, service)}
                      disabled={!(q.status === 'called' && q.called_service === service)}
                      title={q.status === 'called' && q.called_service === service ? 'Serve' : 'Ticket not called here'}
                    >
                      Serve
                    </button>
                    <button onClick={() => onHold && onHold(q.id)}>Hold</button>
                    {q.status === 'hold' ? <button onClick={() => onRecall && onRecall(q.id)}>Recall</button> : null}
                    <button className="delete" onClick={() => onDelete && onDelete(q.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoginOverlay({ onLogin }) {
  const [key, setKey] = useState(localStorage.getItem('staff_key') || '');
  const [role, setRole] = useState(localStorage.getItem('staff_role') || 'All');
  const DEFAULT_STAFF_KEY = STAFF_KEY;

  return (
    <div style={{
      position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
      background:'rgba(0,0,0,0.35)', zIndex:9999,
      backdropFilter: 'blur(50px)',
      WebkitBackdropFilter: 'blur(4px)'
    }}>
      <div style={{width:420, padding:24, background:'#fff', borderRadius:8, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
        <a href="https://sti.edu"><img src="sti-logo.png" alt="STI Logo" style={{width:64, display:'block', margin:'0 auto 12px'}}/></a>
        <h2>Admin Login</h2>
        <p>Enter staff key (stored in this browser session) and choose your role.</p>

        <div style={{marginBottom:8}}>
          <label style={{display:'block', fontWeight:600}}>Staff Key</label>
          <input id='keyInput' value={key} onChange={e=>setKey(e.target.value)} style={{width:'95%', padding:8, marginBottom:12}}/>
        </div>

        <div style={{marginBottom:12}}>
          <label style={{display:'block', fontWeight:600}}>Role</label>
          <select value={role} onChange={e=>setRole(e.target.value)} style={{width:'100%', padding:8}}>
            <option value="All">All (full view)</option>
            {AVAILABLE_SERVICES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button onClick={() => {
            if (!key) return alert('Enter key');
            if (key !== DEFAULT_STAFF_KEY) return alert('Wrong staff key');
            localStorage.setItem('staff_key', key);
            localStorage.setItem('staff_role', role);
            onLogin(key, role);
          }}>Login</button>
        </div>
      </div>
    </div>
  );
}

export default function App(){
  const [queue, setQueue] = useState([]);
  const [name, setName] = useState('');
  const [selectedServices, setSelectedServices] = useState(['registrar']);
  const [querType, setQuerType] = useState(QUER_TYPES[0]);
  const [stats, setStats] = useState({waiting:0, served:0});
  const [staffKey, setStaffKey] = useState(localStorage.getItem('staff_key') || '');
  const [staffRole, setStaffRole] = useState(localStorage.getItem('staff_role') || 'All');

  // Cancel modal state
  const [cancelModal, setCancelModal] = useState({ open: false, ticket: null });

  useEffect(() => {
    fetchQueue(); fetchStats();
    const es = new EventSource(`${API}/events`);
    ['created','called','served','moved','reassigned','hold','recalled','deleted','cancel_requested','cancel_cleared'].forEach(evt =>
      es.addEventListener(evt, () => { fetchQueue(); fetchStats(); })
    );
    es.onerror = (e) => console.warn('SSE error', e);
    es.addEventListener('open', () => {
      // when SSE reconnects, refresh immediately
      fetchQueue();
      fetchStats();
    });
    return () => es.close();
  }, []);

  function onLogin(key, role) {
    setStaffKey(key);
    setStaffRole(role || 'All');
    fetchQueue(); fetchStats();
  }
  function onLogout() {
    localStorage.removeItem('staff_key');
    localStorage.removeItem('staff_role');
    setStaffKey('');
    setStaffRole('All');
  }

  function onServicesChange(orderedSelected) {
    setSelectedServices(orderedSelected);
  }

  async function fetchQueue(){
    try {
      const r = await fetch(`${API}/queue`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchQueue error', data); return; }
      setQueue(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('fetchQueue network', e);
    }
  }
  async function fetchStats(){
    try {
      const r = await fetch(`${API}/stats`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchStats error', data); return; }
      setStats(data);
    } catch (e) {
      console.error('fetchStats network', e);
    }
  }

  async function takeTicket(){
    if (!Array.isArray(selectedServices) || selectedServices.length === 0) {
      return alert('Select at least one service.');
    }
    try {
      const res = await fetch(`${API}/ticket`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          name, services: selectedServices, quer_type: querType
        })
      });
      const data = await safeJson(res);
      if (!res.ok) return alert('Failed to take ticket: ' + (data.error || data.text || res.statusText));
      alert(`Your token: ${String(data.id).padStart(3,'0')} (Services: ${data.services.join(', ')})`);
      setName(''); setSelectedServices(['registrar']); setQuerType(QUER_TYPES[0]);
      fetchQueue(); fetchStats();
    } catch (e) { console.error(e); alert('Network error'); }
  }

  function staffHeaders() {
    const keyToUse = staffKey || STAFF_KEY;
    return { 'Content-Type': 'application/json', 'x-staff-key': keyToUse };
  }

  async function callNext(service) {
    try {
      const r = await fetch(`${API}/next`, {
        method: 'POST',
        headers: staffHeaders(),
        body: JSON.stringify({ service })
      });
      const data = await safeJson(r);
      if (!r.ok) { alert('Call Next failed: ' + (data.error || data.text || r.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (err) { console.error('callNext network', err); alert('Network error'); }
  }

  async function serve(id, service) {
    try {
      if (!service) { alert('service missing'); return; }
      const res = await fetch(`${API}/serve/${id}`, {
        method: 'POST',
        headers: staffHeaders(),
        body: JSON.stringify({ service })
      });
      const payload = await safeJson(res);
      if (!res.ok) { alert('Cannot serve: ' + (payload.error || payload.text || res.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (e) { console.error('serve network', e); alert('Network error'); }
  }

  async function hold(id) {
    try {
      const r = await fetch(`${API}/hold/${id}`, {
        method: 'POST',
        headers: { 'x-staff-key': staffKey || STAFF_KEY }
      });
      const data = await safeJson(r);
      if (!r.ok) { alert('Hold failed: ' + (data.error || data.text || r.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (err) { console.error('hold error', err); alert('Network error'); }
  }

  async function recall(id) {
    try {
      const r = await fetch(`${API}/recall/${id}`, {
        method: 'POST',
        headers: { 'x-staff-key': staffKey || STAFF_KEY }
      });
      const data = await safeJson(r);
      if (!r.ok) { alert('Recall failed: ' + (data.error || data.text || r.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (err) { console.error('recall error', err); alert('Network error recalling ticket'); }
  }

  async function deleteTicket(id) {
    if (!confirm('Delete this ticket?')) return;
    try {
      const url = `${API}/ticket/${id}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'x-staff-key': staffKey || STAFF_KEY }
      });
      if (res.ok) { alert('Deleted'); fetchQueue(); fetchStats(); return; }
      const fallbackUrl = `${API}/ticket/${id}/delete`;
      const r2 = await fetch(fallbackUrl, { method: 'POST', headers: { 'x-staff-key': staffKey || STAFF_KEY } });
      if (r2.ok) { alert('Deleted (fallback)'); fetchQueue(); fetchStats(); return; }
      const detail = await res.text().catch(()=>'' );
      alert('Delete failed: ' + (detail || res.statusText || res.status));
    } catch (err) {
      console.error('delete error', err);
      alert('Network error deleting ticket');
    }
  }

  // Clear cancel request (staff action)
  async function clearCancel(id) {
    if (!confirm('Clear cancel request (staff action)?')) return;
    try {
      const res = await fetch(`${API}/ticket/${id}/clear_cancel`, {
        method: 'POST',
        headers: { 'x-staff-key': staffKey || STAFF_KEY }
      });
      const data = await safeJson(res);
      if (!res.ok) { alert('Clear cancel request failed: ' + (data.error || data.text || res.statusText)); return; }
      fetchQueue(); fetchStats();
      // close modal if it refers to this ticket
      setCancelModal(prev => (prev.ticket && prev.ticket.id === id) ? { open:false, ticket:null } : prev);
    } catch (err) { console.error('clearCancel error', err); alert('Network error'); }
  }

  // open cancel modal
  function openCancelModal(ticket) {
    if (!ticket) return;
    // ensure we attach full ticket object as shown in queue
    setCancelModal({ open: true, ticket });
  }
  function closeCancelModal() {
    setCancelModal({ open: false, ticket: null });
  }

  // Determine which service cards to show based on staffRole
  const servicesToShow = (staffRole && staffRole !== 'All')
    ? AVAILABLE_SERVICES.filter(s => s.key === staffRole)
    : AVAILABLE_SERVICES;

  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Registrar Queueing System</h1>
        <div>
          <span style={{marginRight:12, fontSize:13, color:'#333'}}>Role: <strong>{(staffRole || 'All').toString()}</strong></span>
          {staffKey ? (
            <button onClick={onLogout} style={{marginLeft:12}}>Logout</button>
          ) : null}
        </div>
      </div>

      <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
        <div style={{ width:320, padding:12, border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
          <h2>Take a Ticket</h2>
          <input placeholder="Your name (optional)" value={name} onChange={e=>setName(e.target.value)} style={{width:'100%', marginBottom:8}}/>

          <DraggableServiceList
            services={AVAILABLE_SERVICES}
            selected={selectedServices}
            onChange={(orderedSelected) => setSelectedServices(orderedSelected)}
          />

          <div style={{marginTop:8}}>
            <label>Type of quer: </label>
            <select value={querType} onChange={e=>setQuerType(e.target.value)}>
              {QUER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button style={{marginTop:10, width:'100%'}} onClick={takeTicket}>Get Token</button>

          <h3 style={{marginTop:12}}>Stats</h3>
          <div>Waiting: {stats.waiting}</div>
          <div>Served: {stats.served}</div>
        </div>

        <div style={{flex:1, display:'flex', gap:12, overflowX:'auto'}}>
          {servicesToShow.map(svc => (
            <ServiceTable
              key={svc.key}
              service={svc.key}
              tickets={queue}
              onServe={serve}
              onHold={hold}
              onRecall={recall}
              onDelete={deleteTicket}
              onCallNext={callNext}
              onClearCancel={clearCancel}
              onViewCancel={openCancelModal}
            />
          ))}
        </div>
      </div>

      {/* Cancel Request Modal */}
      {cancelModal.open && cancelModal.ticket ? (
        <div style={{
          position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.45)', zIndex:9999
        }}>
          <div style={{width:480, maxWidth:'92%', background:'#fff', borderRadius:8, padding:18, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
            <h3 style={{marginTop:0}}>Cancel Request</h3>
            <div style={{marginBottom:12, fontSize:14}}>
              <strong>Token:</strong> {String(cancelModal.ticket.id).padStart(3,'0')} &nbsp; &nbsp;
              <strong>Service:</strong> {cancelModal.ticket.current_service || (cancelModal.ticket.services && cancelModal.ticket.services[0])}
            </div>
            <div style={{background:'#f7f7f7', padding:12, borderRadius:6, marginBottom:12, whiteSpace:'pre-wrap'}}>
              {cancelModal.ticket.cancel_reason || '(no reason provided)'}
            </div>

            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
              <button onClick={closeCancelModal}>Close</button>
              <button onClick={() => { if (!confirm('Clear cancel request?')) return; clearCancel(cancelModal.ticket.id); }} style={{background:'#c9302c', color:'#fff'}}>Clear Cancel Request</button>
            </div>
          </div>
        </div>
      ) : null}

      {!staffKey && <LoginOverlay onLogin={onLogin} />}
    </div>
  );
}
