import React, { useEffect, useRef, useState } from 'react';
import './display.css';
const API = import.meta.env.VITE_API_URL || 'http://192.168.18.34:4000';
const STAFF_KEY = import.meta.env.VITE_STAFF_KEY || 'STI-QUEUE-KEY';

async function safeJson(res) {
  try { return await res.json(); }
  catch (e) { return { _parseError: true, text: await (res.text().catch(()=>'')) }; }
}

const DEFAULT_SERVICES = [
  { key: 'registrar', label: 'Registrar' },
  { key: 'cashier', label: 'Cashier' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'records', label: 'Records' }
];

const QUER_TYPES = ['Student','Faculty/Staff','Visitor','Other'];

/* DraggableServices - provides drag-to-reorder + checkboxes + up/down buttons.
   Props:
     services: default service definitions (array of {key,label})
     selectedKeys: array of keys currently selected & ordered
     setSelectedKeys: setter for ordered keys
*/
function DraggableServices({ services=DEFAULT_SERVICES, selectedKeys, setSelectedKeys }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(null);
  const ghostRef = useRef(null);
  const placeholderRef = useRef(null);
  const offsetYRef = useRef(0);

  // internal helper: build DOM list from services order
  useEffect(() => {
    // ensure initial DOM order matches services array
    // nothing else required, renderer handles mapping
  }, [services]);

  // pointer-based dragging handlers (similar logic to kiosk.html)
  function startDrag(e, key) {
    // ignore if clicked on input or button
    if (e.target.closest('input') || e.target.closest('button')) return;
    const el = e.currentTarget;
    draggingRef.current = el;
    const rect = el.getBoundingClientRect();
    offsetYRef.current = e.clientY - rect.top;

    // create ghost
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      zIndex: 9999,
      pointerEvents: 'none'
    });
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    // placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'svc-placeholder';
    placeholder.style.height = rect.height + 'px';
    placeholderRef.current = placeholder;

    el.style.visibility = 'hidden';
    if (el.nextSibling) containerRef.current.insertBefore(placeholder, el.nextSibling);
    else containerRef.current.appendChild(placeholder);

    el.classList.add('dragging');

    if (e.pointerId != null) el.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e){
    const dragging = draggingRef.current;
    const ghost = ghostRef.current;
    const placeholder = placeholderRef.current;
    if (!dragging || !ghost || !placeholder) return;
    ghost.style.left = (e.clientX - 20) + 'px';
    ghost.style.top = (e.clientY - offsetYRef.current) + 'px';

    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const row = elUnder ? elUnder.closest('.svc-row') : null;

    if (row && containerRef.current.contains(row) && row !== dragging) {
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height/2;
      if (e.clientY < mid) {
        if (row.previousSibling !== placeholder) containerRef.current.insertBefore(placeholder, row);
      } else {
        if (row.nextSibling !== placeholder) containerRef.current.insertBefore(placeholder, row.nextSibling);
      }
    } else {
      if (placeholder.parentNode !== containerRef.current) containerRef.current.appendChild(placeholder);
    }
  }

  function onPointerUp(e){
    const dragging = draggingRef.current;
    const ghost = ghostRef.current;
    const placeholder = placeholderRef.current;
    if (!dragging) return;

    if (placeholder && placeholder.parentNode === containerRef.current) {
      containerRef.current.insertBefore(dragging, placeholder);
      placeholder.remove();
    } else {
      dragging.style.visibility = '';
    }

    dragging.classList.remove('dragging');
    dragging.style.visibility = '';
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);

    // update selectedKeys according to DOM order + checked state
    const newKeys = Array.from(containerRef.current.querySelectorAll('.svc-row'))
      .filter(r => r.querySelector('input[type="checkbox"]').checked)
      .map(r => r.dataset.key);
    setSelectedKeys(newKeys);

    // cleanup
    draggingRef.current = null;
    ghostRef.current = null;
    placeholderRef.current = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }

  // keyboard up/down - find row with dataset.key and move it
  function moveKey(key, dir){
    const rows = Array.from(containerRef.current.querySelectorAll('.svc-row'));
    const idx = rows.findIndex(r => r.dataset.key === key);
    if (idx === -1) return;
    if (dir === -1 && idx > 0) containerRef.current.insertBefore(rows[idx], rows[idx-1]);
    if (dir === 1 && idx < rows.length-1) containerRef.current.insertBefore(rows[idx+1], rows[idx]);
    // update selectedKeys after DOM reorder
    const newKeys = Array.from(containerRef.current.querySelectorAll('.svc-row'))
      .filter(r => r.querySelector('input[type="checkbox"]').checked)
      .map(r => r.dataset.key);
    setSelectedKeys(newKeys);
  }

  // toggle checkbox
  function onToggleCheckbox(key, checked){
    // update selectedKeys by either removing or adding this key at current DOM position
    if (!checked) {
      setSelectedKeys(prev => prev.filter(k => k !== key));
    } else {
      // insert at DOM order position
      const rows = Array.from(containerRef.current.querySelectorAll('.svc-row'));
      const orderedKeys = rows.filter(r=> r.querySelector('input[type="checkbox"]').checked || r.dataset.key===key).map(r=> r.dataset.key);
      // keep only checked keys
      const final = orderedKeys.filter(k => {
        const row = rows.find(r => r.dataset.key === k);
        return row && row.querySelector('input[type="checkbox"]').checked;
      });
      setSelectedKeys(final);
    }
  }

  // render rows - we allow DOM reorder, so we don't strictly rely on React for order changes.
  // We still render the rows in the initial order given by services.
  return (
    <div>
      <div style={{marginBottom:6}}>Select service(s): <small style={{color:'#666'}}> (drag to reorder selected)</small></div>
      <div ref={containerRef}>
        {services.map(s => {
          const isChecked = selectedKeys.includes(s.key);
          return (
            <div
              key={s.key}
              data-key={s.key}
              className="svc-row"
              style={{display:'flex',alignItems:'center',gap:8,padding:8,borderRadius:6,background:'#f9f9f9',marginBottom:6,cursor:'grab'}}
              onPointerDown={(e)=>startDrag(e, s.key)}
            >
              <input type="checkbox" className="svc-check" checked={isChecked} onChange={(ev)=>onToggleCheckbox(s.key, ev.target.checked)} />
              <div className="svc-title" style={{flex:1}}>{s.label}</div>
              <div className="svc-controls">
                <button className="small-btn" onClick={()=>moveKey(s.key, -1)}>↑</button>
                <button className="small-btn" onClick={()=>moveKey(s.key, 1)}>↓</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ServiceTable component (renders a single service column) */
function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext }) {
  // only show tickets whose current_service equals this column
  const visible = tickets.filter(t => t.current_service === service);
  const called = tickets.find(t => t.status === 'called' && t.called_service === service);

  return (
    <div className="service-card" style={{
      flex:1, minWidth:260, margin:10, padding:10, borderRadius:6, background:'#0f2940', color:'#fff', boxShadow:'0 6px 16px rgba(0,0,0,0.2)'
    }}>
      <h3 style={{textAlign:'center', margin:0, padding:8, fontSize:16, letterSpacing:1}}>{service.toUpperCase()}</h3>
      <button style={{ width:'100%', margin:'10px 0' }} onClick={() => onCallNext(service)}>
        Call Next ({service})
      </button>

      {called ? (
        <div style={{
          background:'#111', padding:16, marginBottom:12, borderRadius:6, display:'flex', alignItems:'center', gap:12
        }}>
          <div style={{fontSize:56, fontWeight:700, lineHeight:1}}>{called.displayToken || String(called.id).padStart(3,'0')}</div>
          <div>
            <div style={{fontSize:18, fontWeight:600}}>{called.name || 'No name'}</div>
            <div style={{fontSize:12, color:'#ddd'}}>{called.quer_type || ''}</div>
            <div style={{marginTop:8}}>
              <button onClick={() => onServe(called.id, service)} style={{marginRight:6}}>Serve</button>
              <button onClick={() => onHold(called.id)} style={{marginRight:6}}>Hold</button>
              <button onClick={() => onDelete(called.id)} className="delete">Delete</button>
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
              <tr key={q.id}>
                <td style={{padding:6}}>{q.displayToken || String(q.id).padStart(3,'0')}</td>
                <td style={{padding:6}}>{q.name || '—'}</td>
                <td style={{padding:6}}>{q.quer_type || '—'}</td>
                <td style={{padding:6}}>
                  {q.status === 'called' ? `Called (${q.called_service})` : q.status}
                  <div style={{fontSize:11, color:'#cfe6ff'}}>Progress: {Number(q.service_index || 0) + 1}/{(q.services || []).length} — {(q.services || []).join(' → ')}</div>
                </td>
                <td style={{padding:6}}>
                  <div className="actions">
                    <button
                      onClick={() => onServe(q.id, service)}
                      disabled={!(q.status === 'called' && q.called_service === service)}
                      title={q.status === 'called' && q.called_service === service ? 'Serve' : 'Ticket not called here'}
                    >
                      Serve
                    </button>
                    <button onClick={() => onHold(q.id)}>Hold</button>
                    {q.status === 'hold' ? (
                      <button onClick={() => onRecall(q.id)}>Recall</button>
                    ) : null}
                    <button className="delete" onClick={() => onDelete(q.id)}>Delete</button>
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

/* --------------------------- Main App component --------------------------- */
export default function App(){
  const [queue, setQueue] = useState([]);
  const [name, setName] = useState('');
  const [selectedServices, setSelectedServices] = useState(['registrar']);
  const [querType, setQuerType] = useState(QUER_TYPES[0]);
  const [stats, setStats] = useState({waiting:0, served:0});

  useEffect(() => {
    fetchQueue(); fetchStats();
    const es = new EventSource(`${API}/events`);
    ['created','called','served','moved','reassigned','hold','recalled','deleted'].forEach(evt =>
      es.addEventListener(evt, () => { fetchQueue(); fetchStats(); })
    );
    es.onerror = (e) => {
      console.warn('SSE error', e);
    };
    return () => es.close();
  }, []);

  async function fetchQueue(){
    try {
      const r = await fetch(`${API}/queue`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchQueue error', data); return; }
      // compute current_service (the service at current service_index)
      const enriched = Array.isArray(data) ? data.map(t => {
        let services = [];
        try { services = Array.isArray(t.services) ? t.services : JSON.parse(t.services || '[]'); } catch(e){ services = []; }
        const idx = Number(t.service_index || 0);
        const current_service = (Array.isArray(services) && services[idx]) ? services[idx] : null;
        // display token (prefix)
        let prefix = '';
        if (current_service === 'registrar') prefix='R';
        if (current_service === 'cashier') prefix='C';
        if (current_service === 'admissions') prefix='A';
        if (current_service === 'records') prefix='D';
        return { ...t, services, current_service, displayToken: (prefix + String(t.id).padStart(3,'0')) };
      }) : [];
      setQueue(enriched);
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

  /* kiosk: create ticket */
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

  /* staff actions */
  async function callNext(service) {
    try {
      const r = await fetch(`${API}/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-key': STAFF_KEY },
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
        headers: { 'Content-Type': 'application/json', 'x-staff-key': STAFF_KEY },
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
        headers: { 'x-staff-key': STAFF_KEY }
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
        headers: { 'x-staff-key': STAFF_KEY }
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
        headers: { 'x-staff-key': STAFF_KEY }
      });
      const text = await res.text().catch(()=>'');

      if (res.ok) {
        alert('Deleted');
        fetchQueue(); fetchStats();
        return;
      }
      // fallback POST
      const fallbackUrl = `${API}/ticket/${id}/delete`;
      const r2 = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'x-staff-key': STAFF_KEY }
      });
      if (r2.ok) { alert('Deleted (fallback)'); fetchQueue(); fetchStats(); return; }
      const t2 = await r2.text().catch(()=>'');
      alert('Delete failed: ' + (t2 || res.statusText || res.status));
    } catch (err) {
      console.error('delete error', err);
      alert('Network error deleting ticket');
    }
  }

  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <h1>Registrar Queueing System</h1>

      <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
        {/* Ticket box */}
        <div style={{ width:320, padding:12, border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
          <h2>Take a Ticket</h2>
          <input placeholder="Your name (optional)" value={name} onChange={e=>setName(e.target.value)} style={{width:'100%', marginBottom:8}}/>
          <DraggableServices services={DEFAULT_SERVICES} selectedKeys={selectedServices} setSelectedKeys={setSelectedServices} />
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

        {/* Service cards */}
        <div style={{flex:1, display:'flex', gap:12, overflowX:'auto'}}>
          {DEFAULT_SERVICES.map(svc => (
            <ServiceTable
              key={svc.key}
              service={svc.key}
              tickets={queue}
              onServe={serve}
              onHold={hold}
              onRecall={recall}
              onDelete={deleteTicket}
              onCallNext={callNext}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
