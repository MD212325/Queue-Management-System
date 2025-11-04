// App.jsx - admin + kiosk draggable integrated (use as replacement)
import React, { useEffect, useRef, useState } from 'react';
import './display.css';

const API = import.meta.env.VITE_API_URL || 'http://192.168.18.34:4000';
const DEFAULT_STAFF_KEY = import.meta.env.VITE_STAFF_KEY || 'STI-QUEUE-KEY';

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

/* ---------- Login overlay ---------- */
function LoginOverlay({ onLogin }) {
  const [key, setKey] = useState(localStorage.getItem('staff_key') || '');
  return (
    <div style={{
      position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
      background:'rgba(0,0,0,0.35)', zIndex:9999
    }}>
      <div style={{width:420, padding:24, background:'#fff', borderRadius:8, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
        <h2>Admin Login</h2>
        <p>Enter staff key (stored in this browser session).</p>
        <input id='keyInput' value={key} onChange={e=>setKey(e.target.value)} style={{width:'100%', padding:8, marginBottom:12}}/>
        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button onClick={() => { 
            if (!key) return alert('Enter key');
            if (key !== DEFAULT_STAFF_KEY) return alert('Wrong staff key');
            localStorage.setItem('staff_key', key);
            onLogin(key);
          }}>Login</button>
        </div>
      </div>
    </div>
  );

  
}

/* ---------- DraggableServiceList: robust, works on touch ---------- */

// DraggableServiceList breaks upon dragging but still works. CSS Problem [Importance: Medium]

function DraggableServiceList({ valueOrder, valueSelected, onChangeOrder, onChangeSelected }) {
  const listRef = useRef(null);
  const draggingRef = useRef(null);
  const ghostRef = useRef(null);
  const placeholderRef = useRef(null);
  const offsetRef = useRef(0);

  const [order, setOrder] = useState(valueOrder || AVAILABLE_SERVICES.map(s=>s.key));
  const [selected, setSelected] = useState(valueSelected || [...order]);

  useEffect(() => setOrder(valueOrder || AVAILABLE_SERVICES.map(s=>s.key)), [valueOrder]);
  useEffect(() => setSelected(valueSelected || [...(valueOrder || AVAILABLE_SERVICES.map(s=>s.key))]), [valueSelected, valueOrder]);
  useEffect(() => { if (onChangeOrder) onChangeOrder(order); }, [order, onChangeOrder]);
  useEffect(() => { if (onChangeSelected) onChangeSelected(selected); }, [selected, onChangeSelected]);

  function getChildren() {
    if (!listRef.current) return [];
    return Array.from(listRef.current.children).filter(c => c.classList && c.classList.contains('svc-row'));
  }

  function createGhost(row, x, y) {
    if (!row) return;
    const g = row.cloneNode(true);
    g.classList.add('ghost');
    g.style.position = 'absolute';
    g.style.pointerEvents = 'none';
    const width = listRef.current ? Math.min(520, listRef.current.getBoundingClientRect().width) : row.getBoundingClientRect().width;
    g.style.width = width + 'px';
    g.style.zIndex = 9999;
    g.style.opacity = '0.95';
    document.body.appendChild(g);
    ghostRef.current = g;
    moveGhost(x, y);
  }
  function moveGhost(x, y) {
    const g = ghostRef.current;
    if (!g) return;
    g.style.left = (x + 8) + 'px';
    g.style.top = (y - offsetRef.current) + 'px';
  }
  function removeGhost() {
    if (ghostRef.current && ghostRef.current.parentNode) ghostRef.current.parentNode.removeChild(ghostRef.current);
    ghostRef.current = null;
  }
  function createPlaceholder(height) {
    const p = document.createElement('div');
    p.className = 'placeholder';
    p.style.height = (height) + 'px';
    p.style.border = '2px dashed #ccc';
    p.style.margin = '6px 0';
    placeholderRef.current = p;
    return p;
  }

  function onStartDrag(ev, row) {
    // ignore if clicking checkbox
    if (ev.target && (ev.target.matches('input') || ev.target.tagName === 'BUTTON')) return;

    draggingRef.current = row;
    const rect = row.getBoundingClientRect();
    const pageY = (ev.touches && ev.touches[0]) ? ev.touches[0].pageY : (ev.pageY || ev.clientY);
    offsetRef.current = pageY - rect.top;
    const ph = createPlaceholder(rect.height);
    row.parentNode.insertBefore(ph, row);
    row.style.display = 'none';
    const pageX = (ev.touches && ev.touches[0]) ? ev.touches[0].pageX : (ev.pageX || ev.clientX);
    createGhost(row, pageX, pageY);

    document.addEventListener('pointermove', onMove, {passive:false});
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    ev.preventDefault && ev.preventDefault();
  }

  function onMove(e) {
    if (!draggingRef.current) return;
    if (e.cancelable) e.preventDefault();
    const touch = (e.touches && e.touches[0]) || e;
    const pageY = touch.pageY;
    const pageX = touch.pageX;
    moveGhost(pageX, pageY);

    const children = getChildren().filter(c => c !== draggingRef.current && c !== placeholderRef.current);
    let index = children.length;
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      const mid = rect.top + rect.height/2;
      if (pageY < mid) { index = i; break; }
    }
    // insert placeholder at computed index (safe - we operate on listRef.current children array)
    const parent = listRef.current;
    if (!parent) return;
    const reference = children[index] || null;
    if (reference !== placeholderRef.current) {
      parent.insertBefore(placeholderRef.current, reference);
    }
  }

  function onEnd() {
    if (!draggingRef.current) return;
    removeGhost();
    const parent = listRef.current;
    if (placeholderRef.current && parent) {
      parent.insertBefore(draggingRef.current, placeholderRef.current);
      placeholderRef.current.parentNode && placeholderRef.current.parentNode.removeChild(placeholderRef.current);
    } else if (parent) {
      parent.appendChild(draggingRef.current);
    }
    draggingRef.current.style.display = '';
    draggingRef.current = null;
    placeholderRef.current = null;
    offsetRef.current = 0;

    const newOrder = getChildren().map(r => r.dataset.svc);
    setOrder(newOrder);

    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
  }

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    // prevent the page from panning while dragging on touch
    node.style.touchAction = 'none';
    // use event delegation - single pointerdown listener
    const onPointerDownDelegated = (e) => {
      const handle = e.target.closest('.svc-row, .svc-handle');
      if (!handle) return;
      // if target is inner handle use its parent svc-row
      const row = handle.classList && handle.classList.contains('svc-row') ? handle : handle.closest('.svc-row');
      if (!row) return;
      onStartDrag(e, row);
    };
    node.addEventListener('pointerdown', onPointerDownDelegated);
    return () => {
      node.removeEventListener('pointerdown', onPointerDownDelegated);
    };
  }, [listRef.current]);

  function toggleChecked(key) {
    setSelected(prev => {
      if (prev.includes(key)) return prev.filter(s => s !== key);
      return [...prev, key];
    });
  }
  function moveUp(key) {
    setOrder(prev => {
      const i = prev.indexOf(key); if (i <= 0) return prev;
      const arr = prev.slice();
      [arr[i-1], arr[i]] = [arr[i], arr[i-1]];
      return arr;
    });
  }
  function moveDown(key) {
    setOrder(prev => {
      const i = prev.indexOf(key); if (i === -1 || i === prev.length-1) return prev;
      const arr = prev.slice();
      [arr[i], arr[i+1]] = [arr[i+1], arr[i]];
      return arr;
    });
  }

  // expose utility used by parent (not strictly necessary)
  DraggableServiceList.getSelectedOrderedServices = () => order.filter(k => selected.includes(k));

  return (
    <div>
      <div ref={listRef} id="svc-list" style={{display:'flex', flexDirection:'column', gap:8}}>
        {order.map(key => {
          const svc = AVAILABLE_SERVICES.find(s => s.key === key) || { key, label: key };
          const checked = selected.includes(key);
          return (
            <div key={key} className="svc-row" data-svc={key}
                 style={{display:'flex', alignItems:'center', gap:10, padding:10, borderRadius:8, background:'#f9f9f9', border:'1px solid #e6e6e6'}}
            >
              <div className="svc-handle" style={{width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',cursor:'grab',background:'#fff',border:'1px solid #ddd',borderRadius:6}}>≡</div>
              <input className="svc-check" type="checkbox" checked={checked} onChange={() => toggleChecked(key)} />
              <div className="svc-title" style={{flex:1,fontWeight:600}}>{svc.label}</div>
              <div className="svc-controls" style={{display:'flex', gap:6}}>
                <button onClick={() => moveUp(key)} style={{padding:6}}>↑</button>
                <button onClick={() => moveDown(key)} style={{padding:6}}>↓</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- ServiceTable --------------------------- */
function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext }) {
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
            <div style={{fontSize:12, color:'#ddd'}}>{called.quer_type || ''} • called</div>
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

/* --------------------------- App --------------------------- */
export default function App(){
  const [queue, setQueue] = useState([]);
  const [name, setName] = useState('');
  const [serviceOrder, setServiceOrder] = useState(AVAILABLE_SERVICES.map(s => s.key));
  const [selectedServices, setSelectedServices] = useState([AVAILABLE_SERVICES[0].key]);
  const [querType, setQuerType] = useState(QUER_TYPES[0]);
  const [stats, setStats] = useState({waiting:0, served:0});
  const [staffKey, setStaffKey] = useState(localStorage.getItem('staff_key') || null);
  const [showLogin, setShowLogin] = useState(!localStorage.getItem('staff_key'));

  useEffect(() => {
    fetchQueue(); fetchStats();
    const es = new EventSource(`${API}/events`);
    ['created','called','served','moved','reassigned','hold','recalled','deleted'].forEach(evt =>
      es.addEventListener(evt, () => { fetchQueue(); fetchStats(); })
    );
    es.onerror = (e) => console.warn('SSE error', e);
    return () => es.close();
  }, []);

  useEffect(() => {
    if (staffKey) {
      localStorage.setItem('staff_key', staffKey);
      setShowLogin(false);
    }
  }, [staffKey]);

  function getClientStaffKey() {
    return localStorage.getItem('staff_key') || DEFAULT_STAFF_KEY;
  }

  async function fetchQueue(){
    try {
      const r = await fetch(`${API}/queue`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchQueue error', data); return; }
      const parsed = Array.isArray(data) ? data.map(t => {
        let services = [];
        try { services = Array.isArray(t.services) ? t.services : JSON.parse(t.services || '[]'); } catch(e){ services = []; }
        const idx = Number(t.service_index || 0);
        return { ...t, services, current_service: (Array.isArray(services) && services[idx]) ? services[idx] : null, displayToken: ((t.called_service && t.called_service[0]) || (services[idx] && services[idx][0]) || '') + String(t.id).padStart(3,'0') };
      }) : [];
      setQueue(parsed);
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
    const orderedSelected = serviceOrder.filter(s => selectedServices.includes(s));
    if (!orderedSelected.length) { return alert('Select at least one service.'); }
    try {
      const res = await fetch(`${API}/ticket`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          name, services: orderedSelected, quer_type: querType
        })
      });
      const data = await safeJson(res);
      if (!res.ok) return alert('Failed to take ticket: ' + (data.error || data.text || res.statusText));
      alert(`Your token: ${String(data.id).padStart(3,'0')} (Services: ${orderedSelected.join(', ')})`);
      setName(''); setSelectedServices([AVAILABLE_SERVICES[0].key]); setQuerType(QUER_TYPES[0]);
      fetchQueue(); fetchStats();
    } catch (e) { console.error(e); alert('Network error'); }
  }

  async function callNext(service) {
    try {
      const r = await fetch(`${API}/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-staff-key': getClientStaffKey() },
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
        headers: { 'Content-Type': 'application/json', 'x-staff-key': getClientStaffKey() },
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
        headers: { 'x-staff-key': getClientStaffKey() }
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
        headers: { 'x-staff-key': getClientStaffKey() }
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
        headers: { 'x-staff-key': getClientStaffKey() }
      });
      if (res.ok) { alert('Deleted'); fetchQueue(); fetchStats(); return; }
      const fallbackUrl = `${API}/ticket/${id}/delete`;
      const r2 = await fetch(fallbackUrl, { method:'POST', headers:{ 'x-staff-key': getClientStaffKey() } });
      if (r2.ok) { alert('Deleted (fallback)'); fetchQueue(); fetchStats(); return; }
      const text = await res.text().catch(()=>'');

      alert('Delete failed: ' + (text || res.statusText || res.status));
    } catch (err) { console.error('delete error', err); alert('Network error deleting ticket'); }
  }

  if (showLogin) {
    return <LoginOverlay onLogin={(k) => { setStaffKey(k); setShowLogin(false); }} />;
  }

  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <h1>Registrar Queueing System</h1>

      <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
        <div style={{ width:320, padding:12, border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
          <h2>Take a Ticket</h2>
          <input placeholder="Your name (optional)" value={name} onChange={e=>setName(e.target.value)} style={{width:'100%', marginBottom:8}}/>

          <div style={{marginBottom:8}}>
            <div style={{marginBottom:6}}>Select service(s): <small style={{color:'#666'}}>(drag to reorder selected)</small></div>

            <DraggableServiceList
              valueOrder={serviceOrder}
              valueSelected={selectedServices}
              onChangeOrder={(o) => setServiceOrder(o)}
              onChangeSelected={(s) => setSelectedServices(s)}
            />
          </div>

          <div style={{marginTop:8}}>
            <label>Type of quer: </label>
            <select value={querType} onChange={e=>setQuerType(e.target.value)} style={{width:'100%', marginTop:6}}>
              {QUER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button style={{marginTop:10, width:'100%'}} onClick={takeTicket}>Get Token</button>

          <h3 style={{marginTop:12}}>Stats</h3>
          <div>Waiting: {stats.waiting}</div>
          <div>Served: {stats.served}</div>
        </div>

        <div style={{flex:1, display:'flex', gap:12, overflowX:'auto'}}>
          {AVAILABLE_SERVICES.map(svc => (
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
