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

/* ---------- ServiceTable component (renders a single service column) ---------- */
function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext }) {
  // Tickets that are currently at this service (derived by server or by client mapping)
  const visible = tickets.filter(t => t.current_service === service);

  // Called ticket for this service (prominent)
  const called = tickets.find(t => t.status === 'called' && t.called_service === service);

  return (
    <div className="service-card" style={{
      flex:1, minWidth:260, margin:10, padding:10, borderRadius:6, background:'#0f2940', color:'#fff', boxShadow:'0 6px 16px rgba(0,0,0,0.2)'
    }}>
      <h3 style={{textAlign:'center', margin:0, padding:8, fontSize:16, letterSpacing:1}}>{service.toUpperCase()}</h3>
      <button className="call-btn" style={{ width:'100%', margin:'10px 0' }} onClick={() => onCallNext(service)}>
        Call Next ({service})
      </button>

      {/* Called token (prominent) */}
      {called ? (
        <div className="called-card">
          <div className="token">{called.displayToken || String(called.id).padStart(3,'0')}</div>
          <div className="details">
            <div className="name">{called.name || 'No name'}</div>
            <div className="type">{called.quer_type || ''}</div>
            <div className="mini-actions" style={{marginTop:8}}>
              <button onClick={() => onServe(called.id, service)} style={{marginRight:6}}>Serve</button>
              <button onClick={() => onHold(called.id)} style={{marginRight:6}}>Hold</button>
              <button onClick={() => onDelete(called.id)} className="delete">Delete</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Waiting list table */}
      <table className="service-table" style={{ width:'100%', borderCollapse:'collapse' }}>
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
            // hide the called token from the table if it's already rendered above
            if (called && called.id === q.id) return null;
            return (
              <tr key={q.id}>
                <td style={{padding:6}}>{q.displayToken || String(q.id).padStart(3,'0')}</td>
                <td style={{padding:6}}>{q.name || '—'}</td>
                <td style={{padding:6}}>{q.quer_type || '—'}</td>
                <td style={{padding:6}}>
                  {q.status === 'called' ? `Called (${q.called_service})` : q.status}
                  <div className="progress">Progress: {Number(q.service_index || 0) + 1}/{(q.services || []).length} — {(q.services || []).join(' → ')}</div>
                </td>
                <td style={{padding:6}}>
                <div className="actions">
                    {/* Serve shown only if the ticket is called at THIS service */}
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
    // listen to all relevant events
    ['created','called','served','moved','reassigned','hold','recalled','deleted'].forEach(evt =>
      es.addEventListener(evt, () => { fetchQueue(); fetchStats(); })
    );
    es.onerror = (e) => {
      // SSE fallback: just log
      console.warn('SSE error', e);
    };
    return () => es.close();
  }, []);

  function toggleService(serviceKey) {
    setSelectedServices(prev => {
        if (!Array.isArray(prev)) return [serviceKey];
        if (prev.includes(serviceKey)) return prev.filter(s => s !== serviceKey);
        return [...prev, serviceKey];
    });
  }

  /* normalize queue rows (client-side derived fields) */
  async function fetchQueue(){
    try {
      const r = await fetch(`${API}/queue`);
      const data = await safeJson(r);
      if (!r.ok) { console.error('fetchQueue error', data); return; }
      const normalized = (Array.isArray(data) ? data : []).map(row => {
        // ensure services is an array
        let services = [];
        try { services = Array.isArray(row.services) ? row.services : JSON.parse(row.services || '[]'); } catch(e){ services = []; }
        const idx = Number(row.service_index || 0);
        const current_service = (services && services[idx]) ? services[idx] : null;
        // display token prefix mapping
        const prefixMap = { registrar:'R', cashier:'C', admissions:'A', records:'D' };
        const tokenNumeric = String(row.id).padStart(3,'0');
        // prefer called_service for display token if called on a service
        const displayService = row.called_service || current_service || (services && services[0]) || null;
        const displayToken = (displayService ? (prefixMap[displayService]||'') : '') + tokenNumeric;
        return {
          ...row,
          services,
          displayToken,
          current_service,
          service_index: idx
        };
      });
      setQueue(normalized);
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

  /* -------- kiosk: create ticket -------- */
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
      // fallback / show server response
      console.warn('DELETE failed', res.status, text);
      const fallbackUrl = `${API}/ticket/${id}/delete`;
      const r2 = await fetch(fallbackUrl, { method: 'POST', headers: { 'x-staff-key': STAFF_KEY } });
      const t2 = await r2.text().catch(()=>'');
      if (r2.ok) { alert('Deleted (fallback)'); fetchQueue(); fetchStats(); return; }
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
          <div>
            <div style={{marginBottom:6}}>Select service(s):</div>
            {AVAILABLE_SERVICES.map(s => (
              <label key={s.key} style={{display:'block', marginBottom:4}}>
                <input type="checkbox" checked={selectedServices.includes(s.key)} onChange={()=>toggleService(s.key)} />{' '}
                {s.label}
              </label>
            ))}
          </div>
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
