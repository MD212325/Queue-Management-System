import React, { useEffect, useState } from 'react';
import './display.css';
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const STAFF_KEY = import.meta.env.VITE_STAFF_KEY || 'STI-QUEUE-KEY';

const AVAILABLE_SERVICES = [
  { key: 'registrar', label: 'Registrar' },
  { key: 'cashier', label: 'Cashier' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'records', label: 'Records' }
];

const QUER_TYPES = ['Student','Faculty/Staff','Visitor','Other'];

function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete, onCallNext }) {
  const filtered = tickets.filter(t => (t.services || []).includes(service));
  return (
    <div className="service-card" style={{
      flex:1, minWidth:260, margin:10, padding:10, border:'1px solid #ddd', borderRadius:6
    }}>
      <h3 style={{textAlign:'center'}}>{service.toUpperCase()}</h3>
      <button style={{ width:'100%', marginBottom:8 }} onClick={() => onCallNext(service)}>
        Call Next ({service})
      </button>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ background:'#f6f6f6' }}>
            <th style={{padding:6}}>Token</th>
            <th style={{padding:6}}>Name</th>
            <th style={{padding:6}}>Type</th>
            <th style={{padding:6}}>Status</th>
            <th style={{padding:6}}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(q => (
            <tr key={q.id}>
              <td style={{padding:6}}>{String(q.id).padStart(3,'0')}</td>
              <td style={{padding:6}}>{q.name}</td>
              <td style={{padding:6}}>{q.quer_type}</td>
              <td style={{padding:6}}>{q.status}{q.called_service ? ` (${q.called_service})` : ''}</td>
              <td style={{padding:6}}>
                <div className="actions">
                  {q.status !== 'served' && <button onClick={() => onServe(q.id)}>Serve</button>}
                  {q.status !== 'hold' && <button onClick={() => onHold(q.id)}>Hold</button>}
                  {q.status === 'hold' && <button onClick={() => onRecall(q.id)}>Recall</button>}
                  <button className="delete" onClick={() => onDelete(q.id)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App(){
  const [queue, setQueue] = useState([]);
  const [name, setName] = useState('');
  const [selectedServices, setSelectedServices] = useState(['registrar']);
  const [querType, setQuerType] = useState(QUER_TYPES[0]);
  const [stats, setStats] = useState({waiting:0, served:0});

  useEffect(() => {
    fetchQueue(); fetchStats();
    const es = new EventSource(`${API}/events`);
    ['created','called','served','hold','recalled','deleted'].forEach(evt =>
      es.addEventListener(evt, () => { fetchQueue(); fetchStats(); })
    );
    return () => es.close();
  }, []);

  function fetchQueue(){ fetch(`${API}/queue`).then(r=>r.json()).then(setQueue).catch(console.error) }
  function fetchStats(){ fetch(`${API}/stats`).then(r=>r.json()).then(setStats).catch(console.error) }

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
      const data = await res.json();
      if(!res.ok) return alert('Failed to take ticket: ' + (data.error || res.statusText));
      alert(`Your token: ${String(data.id).padStart(3,'0')} (Services: ${data.services.join(', ')})`);
      setName(''); setSelectedServices(['registrar']); setQuerType(QUER_TYPES[0]);
      fetchQueue(); fetchStats();
    } catch (e) { console.error(e); alert('Network error'); }
  }

  async function callNext(service) {
  try {
    const r = await fetch(`${API}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-key': STAFF_KEY },
      body: JSON.stringify({ service })
    });
    const data = await r.json();
    if (!r.ok) {
      alert('Call next failed: ' + (data.error || JSON.stringify(data)));
    } else {
      // Optionally notify staff UI
      console.log('callNext:', data);
    }
    // refresh local queue & stats
    fetchQueue(); fetchStats();
  } catch (e) {
    console.error('callNext error', e);
    alert('Network error calling next');
  }
}

async function serve(id) {
  try {
    const r = await fetch(`${API}/serve/${id}`, {
      method: 'POST',
      headers: { 'x-staff-key': STAFF_KEY }
    });
    const data = r.ok ? await r.json().catch(()=>({ok:true})) : await r.json().catch(()=>({error:'unknown'}));
    if (!r.ok) {
      alert('Serve failed: ' + (data.error || JSON.stringify(data)));
    } else {
      // update UI
      fetchQueue(); fetchStats();
    }
  } catch (e) {
    console.error('serve error', e);
    alert('Network error serving ticket');
  }
}

async function hold(id) {
  try {
    const r = await fetch(`${API}/hold/${id}`, {
      method: 'POST',
      headers: {'x-staff-key': STAFF_KEY}
    });
    if (!r.ok) alert('Hold failed');
    fetchQueue(); fetchStats();
  } catch (e) { console.error(e); alert('Network error'); }
}
async function recall(id){ await fetch(`${API}/recall/${id}`, { method:'POST' }); fetchQueue(); fetchStats(); }

async function deleteTicket(id){
  if(!confirm('Delete this ticket?')) return;
  try {
    const r = await fetch(`${API}/ticket/${id}`, {
      method: 'DELETE',
      headers: {'x-staff-key': STAFF_KEY}
    });
    if (!r.ok) {
      const txt = await r.text();
      alert('Failed: ' + txt);
    } else {
      fetchQueue(); fetchStats();
    }
  } catch (e) { console.error(e); alert('Network error'); }
}

  function toggleService(serviceKey){
    setSelectedServices(prev => {
      if(prev.includes(serviceKey)) return prev.filter(s=>s!==serviceKey);
      return [...prev, serviceKey];
    });
  }

  return (
    <div style={{fontFamily:'sans-serif', padding:20}}>
      <h1>Registrar Queueing System</h1>

      <div style={{display:'flex', gap:20, alignItems:'flex-start'}}>
        {/* Ticket box */}
        <div style={{ width:320, padding:12, border:'1px solid #ddd', borderRadius:8 }}>
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
