import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function ServiceTable({ service, tickets, onServe, onHold, onRecall, onDelete }) {
  const filtered = tickets.filter(t => t.service === service);
  return (
    <div style={{ 
      flex: 1, 
      margin: 10, 
      padding: 10, 
      border: '1px solid #ddd', 
      borderRadius: 6,
      minWidth: 250
    }}>
      <h3 style={{ marginBottom: 8, textAlign: 'center' }}>{service.toUpperCase()}</h3>
      <button 
        style={{ marginBottom: 10, width: '100%' }} 
        onClick={() => onDelete('callNext', service)}
      >
        Call Next ({service})
      </button>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ textAlign: 'left', padding: '6px' }}>Token</th>
            <th style={{ textAlign: 'left', padding: '6px' }}>Name</th>
            <th style={{ textAlign: 'left', padding: '6px' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '6px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(q => (
            <tr key={q.id}>
              <td style={{ padding: '6px' }}>{q.token}</td>
              <td style={{ padding: '6px' }}>{q.name}</td>
              <td style={{ padding: '6px' }}>{q.status}</td>
              <td style={{ padding: '6px' }}>
                {q.status !== 'served' && <button onClick={() => onServe(q.id)}>Serve</button>}{' '}
                {q.status !== 'hold' && <button onClick={() => onHold(q.id)}>Hold</button>}{' '}
                {q.status === 'hold' && <button onClick={() => onRecall(q.id)}>Recall</button>}{' '}
                <button onClick={() => onDelete(q.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [queue, setQueue] = useState([]);
  const [name, setName] = useState('');
  const [service, setService] = useState('registrar');
  const [stats, setStats] = useState({ waiting: 0, served: 0 });

  useEffect(() => {
    fetchQueue();
    fetchStats();
    const es = new EventSource(`${API}/events`);
    ['created', 'called', 'served', 'hold', 'recalled', 'deleted'].forEach(evt =>
      es.addEventListener(evt, () => { refreshAll(); })
    );
    return () => es.close();
  }, []);

  function refreshAll() { fetchQueue(); fetchStats(); }
  function fetchQueue() { fetch(`${API}/queue`).then(r => r.json()).then(setQueue); }
  function fetchStats() { fetch(`${API}/stats`).then(r => r.json()).then(setStats); }

  async function takeTicket() {
    const res = await fetch(`${API}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, service })
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Failed: ' + (data.error || 'unknown error'));
      return;
    }
    alert(`Your token: ${data.token} (Service: ${data.service})`);
    setName('');
    refreshAll();
  }

  async function callNext(service) {
    const res = await fetch(`${API}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service })
    });
    const data = await res.json();
    if (data.message) alert(data.message);
  }

  async function hold(id) { await fetch(`${API}/hold/${id}`, { method: 'POST' }); }
  async function recall(id) { await fetch(`${API}/recall/${id}`, { method: 'POST' }); }
  async function serve(id) { await fetch(`${API}/serve/${id}`, { method: 'POST' }); }
  async function deleteTicket(id) {
    if (!confirm('Delete this ticket?')) return;
    await fetch(`${API}/ticket/${id}`, { method: 'DELETE' });
    refreshAll();
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 20 }}>
      <h1>Registrar Queueing System</h1>
      
      {/* Main horizontal layout */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        
        {/* Take a Ticket */}
        <div style={{ 
          width: 300, 
          padding: 10, 
          border: '1px solid #ddd', 
          borderRadius: 6, 
          marginRight: 20 
        }}>
          <h2>Take a Ticket</h2>
          <input
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
          />
          <div>
            <label>Service: </label>
            <select value={service} onChange={e => setService(e.target.value)}>
              <option value="registrar">Registrar</option>
              <option value="cashier">Cashier</option>
              <option value="admissions">Admissions</option>
              <option value="records">Records</option>
            </select>
          </div>
          <button style={{ marginTop: 8, width: '100%' }} onClick={takeTicket}>Get Token</button>
          <h3 style={{ marginTop: 12 }}>Stats</h3>
          <div>Waiting: {stats.waiting}</div>
          <div>Served: {stats.served}</div>
        </div>

        {/* Staff dashboard */}
        <div style={{ flex: 1, display: 'flex', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <ServiceTable service="registrar" tickets={queue} onServe={serve} onHold={hold} onRecall={recall} onDelete={(idOrCmd, svc) => idOrCmd==='callNext' ? callNext(svc) : deleteTicket(idOrCmd)} />
          <ServiceTable service="cashier" tickets={queue} onServe={serve} onHold={hold} onRecall={recall} onDelete={(idOrCmd, svc) => idOrCmd==='callNext' ? callNext(svc) : deleteTicket(idOrCmd)} />
          <ServiceTable service="admissions" tickets={queue} onServe={serve} onHold={hold} onRecall={recall} onDelete={(idOrCmd, svc) => idOrCmd==='callNext' ? callNext(svc) : deleteTicket(idOrCmd)} />
          <ServiceTable service="records" tickets={queue} onServe={serve} onHold={hold} onRecall={recall} onDelete={(idOrCmd, svc) => idOrCmd==='callNext' ? callNext(svc) : deleteTicket(idOrCmd)} />
        </div>
      </div>
    </div>
  );
}
