import React, { useEffect, useState } from 'react';
import './display.css';
const API = import.meta.env.VITE_API_URL || 'http://192.168.18.34:4000';
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

/* ---------- SelectedServiceList (kiosk) ---------- */
function SelectedServiceList({ serviceOrder, selectedServices, setSelectedServices, labels }) {
  const [dragKey, setDragKey] = useState(null);

  function toggleService(key) {
    setSelectedServices(prev => {
      if (!Array.isArray(prev)) prev = [];
      if (prev.includes(key)) return prev.filter(x => x !== key);
      // append by default
      return [...prev, key];
    });
  }

  function onDragStart(e, key) {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', key); } catch(e) {}
  }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e, targetKey) {
    e.preventDefault();
    const source = dragKey || e.dataTransfer.getData('text/plain');
    if (!source || source === targetKey) return;
    setSelectedServices(prev => {
      const srcIdx = prev.indexOf(source);
      const tgtIdx = prev.indexOf(targetKey);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      const copy = prev.slice();
      copy.splice(srcIdx, 1);
      copy.splice(tgtIdx, 0, source);
      return copy;
    });
    setDragKey(null);
  }

  return (
    <div>
      <div style={{marginBottom:8}}>Select service(s): (drag to reorder selected)</div>

      {/* selected (draggable) */}
      <div>
        {selectedServices.length ? selectedServices.map(key => (
          <div key={key}
            draggable
            onDragStart={(e)=>onDragStart(e,key)}
            onDragOver={onDragOver}
            onDrop={(e)=>onDrop(e,key)}
            style={{display:'flex', alignItems:'center', gap:8, padding:6, background:'#fff', borderRadius:6, marginBottom:6, cursor:'grab'}}
          >
            <input type="checkbox" checked onChange={()=>toggleService(key)} />
            <div style={{flex:1}}>{labels[key] || key}</div>
            <div style={{fontSize:12, color:'#666'}}>drag</div>
          </div>
        )) : <div style={{color:'#666', marginBottom:6}}>No services selected</div>}
      </div>

      {/* quick-add buttons for not-selected services in the default serviceOrder */}
      <div style={{marginTop:8}}>
        <div style={{fontSize:12, color:'#333', marginBottom:6}}>Add more services:</div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          {serviceOrder.filter(k=>!selectedServices.includes(k)).map(k => (
            <button key={k} onClick={()=>toggleService(k)} style={{padding:'6px 10px', borderRadius:6}}>
              + {labels[k] || k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- ServiceTable component (renders single service column) ---------- */
function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext, label }) {
  // only show tickets whose current_service equals this column
  const visible = tickets.filter(t => t.current_service === service);
  // prominent called one
  const called = tickets.find(t => t.status === 'called' && t.called_service === service);

  return (
    <div className="service-card" style={{
      flex:1, minWidth:260, margin:10, padding:10, borderRadius:6, background:'#0f2940', color:'#fff', boxShadow:'0 6px 16px rgba(0,0,0,0.12)'
    }}>
      <h3 style={{textAlign:'center', margin:0, padding:8, fontSize:16, letterSpacing:1}}>{label || service.toUpperCase()}</h3>
      <button style={{ width:'100%', margin:'10px 0', background:'#081621', color:'#fff', border:'none', padding:'8px 10px', borderRadius:6 }} onClick={() => onCallNext(service)}>
        Call Next ({service})
      </button>

      {called ? (
        <div style={{ background:'#111', padding:16, marginBottom:12, borderRadius:6, display:'flex', alignItems:'center', gap:12 }}>
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
                  <div className="actions" style={{display:'flex', gap:6, alignItems:'center'}}>
                    <button onClick={() => onServe(q.id, service)} disabled={!(q.status === 'called' && q.called_service === service)}>Serve</button>
                    <button onClick={() => onHold(q.id)}>Hold</button>
                    {q.status === 'hold' ? <button onClick={() => onRecall(q.id)}>Recall</button> : null}
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
  const [selectedServices, setSelectedServices] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kiosk.services')) || ['registrar']; } catch(e){ return ['registrar']; }
  });
  const [querType, setQuerType] = useState(QUER_TYPES[0]);
  const [stats, setStats] = useState({waiting:0, served:0});

  const serviceOrder = AVAILABLE_SERVICES.map(s => s.key);
  const labelMap = AVAILABLE_SERVICES.reduce((acc, s) => { acc[s.key] = s.label; return acc; }, {});

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
    try { localStorage.setItem('kiosk.services', JSON.stringify(selectedServices)); } catch(e){}
  }, [selectedServices]);

  async function fetchQueue(){
    try {
      const r = await fetch(`${API}/queue`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchQueue error', data); return; }
      const parsed = (Array.isArray(data) ? data : []).map(t => {
        const services = Array.isArray(t.services) ? t.services : (function(){
          try { return JSON.parse(t.services || '[]'); } catch(e){ return []; }
        })();
        const idx = Number(t.service_index || 0);
        const current_service = Array.isArray(services) && services[idx] ? services[idx] : (t.called_service || '');
        const prefixMap = { registrar:'R', cashier:'C', admissions:'A', records:'D' };
        const displayToken = (t.called_service ? (prefixMap[t.called_service] || '') : '') + String(t.id).padStart(3,'0');
        return {...t, services, service_index: idx, current_service, displayToken};
      });
      setQueue(parsed);
    } catch (e) { console.error('fetchQueue network', e); }
  }
  async function fetchStats(){
    try {
      const r = await fetch(`${API}/stats`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchStats error', data); return; }
      setStats(data);
    } catch (e) { console.error('fetchStats network', e); }
  }

  /* -------- kiosk: create ticket -------- */
  async function takeTicket(){
    if (!Array.isArray(selectedServices) || selectedServices.length === 0) {
      return alert('Select at least one service.');
    }
    try {
      const res = await fetch(`${API}/ticket`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, services: selectedServices, quer_type: querType })
      });
      const data = await safeJson(res);
      if (!res.ok) return alert('Failed to take ticket: ' + (data.error || data.text || res.statusText));
      alert(`Your token: ${String(data.id).padStart(3,'0')} (Services: ${selectedServices.join(', ')})`);
      setName('');
      setSelectedServices(['registrar']);
      setQuerType(QUER_TYPES[0]);
      fetchQueue(); fetchStats();
    } catch (e) { console.error(e); alert('Network error'); }
  }

  /* -------- staff actions -------- */
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
      const r = await fetch(`${API}/hold/${id}`, { method:'POST', headers: { 'x-staff-key': STAFF_KEY } });
      const data = await safeJson(r);
      if (!r.ok) { alert('Hold failed: ' + (data.error || data.text || r.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (err) { console.error('hold error', err); alert('Network error'); }
  }

  async function recall(id) {
    try {
      const r = await fetch(`${API}/recall/${id}`, { method:'POST', headers: { 'x-staff-key': STAFF_KEY } });
      const data = await safeJson(r);
      if (!r.ok) { alert('Recall failed: ' + (data.error || data.text || r.statusText)); return; }
      fetchQueue(); fetchStats();
    } catch (err) { console.error('recall error', err); alert('Network error recalling ticket'); }
  }

  async function deleteTicket(id) {
    if (!confirm('Delete this ticket?')) return;
    try {
      const url = `${API}/ticket/${id}`;
      const res = await fetch(url, { method: 'DELETE', headers: { 'x-staff-key': STAFF_KEY } });
      const text = await res.text().catch(()=>'');
      if (res.ok) { alert('Deleted'); fetchQueue(); fetchStats(); return; }
      // fallback & show server message
      const fallbackUrl = `${API}/ticket/${id}/delete`;
      const r2 = await fetch(fallbackUrl, { method: 'POST', headers: { 'x-staff-key': STAFF_KEY } });
      const t2 = await r2.text().catch(()=>'');
      if (r2.ok) { alert('Deleted (fallback)'); fetchQueue(); fetchStats(); return; }
      alert('Delete failed: ' + (t2 || res.statusText || res.status));
    } catch (err) { console.error('delete error', err); alert('Network error deleting ticket'); }
  }

  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <h1>Registrar Queueing System</h1>

      <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
        {/* Ticket box */}
        <div style={{ width:360, padding:12, border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
          <h2>Take a Ticket</h2>
          <input placeholder="Your name (optional)" value={name} onChange={e=>setName(e.target.value)} style={{width:'100%', marginBottom:8}}/>

          <SelectedServiceList
            serviceOrder={serviceOrder}
            selectedServices={selectedServices}
            setSelectedServices={setSelectedServices}
            labels={labelMap}
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

        {/* Service cards (columns) */}
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
              label={svc.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
