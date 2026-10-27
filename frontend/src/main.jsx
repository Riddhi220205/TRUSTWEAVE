import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import * as api from './services/api';

const ICONS = {
  dashboard: '◈',
  devices: '◌',
  incidents: '△',
  recovery: '✦',
  blockchain: '⬡',
  add: '+',
  arrow: '→',
  close: '×'
};

const nav = [
  ['dashboard', 'Command center'],
  ['devices', 'Devices'],
  ['incidents', 'Incident history'],
  ['recovery', 'AI recovery'],
  ['blockchain', 'Blockchain']
];

const statusFor = (score, compromised) => {
  if (compromised) return 'Compromised';
  if (score >= 90) return 'Healthy';
  if (score >= 60) return 'Warning';
  return 'At risk';
};

const toneFor = (status) => {
  if (status === 'Healthy' || status === 'Recorded') return 'good';
  if (status === 'Warning') return 'warn';
  return 'danger';
};

const shortHash = (hash) => hash ? `${hash.slice(0, 8)}…${hash.slice(-5)}` : 'Not supplied';

const deviceLabel = (device) => device?.name || device?.id || device?.deviceId || 'Unknown device';
const deviceSubLabel = (device) => {
  const parts = [];
  if (device?.type && device.type !== 'unknown') parts.push(device.type.replaceAll('_', ' '));
  if (device?.aiDeviceId) parts.push(device.aiDeviceId);
  else if (device?.id) parts.push(device.id);
  if (device?.location) parts.push(device.location);
  return parts.join(' · ');
};

function Status({ status }) {
  return <span className={`status ${toneFor(status)}`}><i />{status}</span>;
}

function Score({ score = 0, large = false }) {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <div className={large ? 'score score-large' : 'score'}>
      <svg viewBox="0 0 42 42" aria-hidden="true">
        <circle className="track" cx="21" cy="21" r="16" />
        <circle
          className={`meter ${toneFor(statusFor(safeScore, false))}`}
          cx="21"
          cy="21"
          r="16"
          pathLength="100"
          strokeDasharray={`${safeScore} 100`}
        />
      </svg>
      <b>{safeScore}</b>
      {!large && <small>/100</small>}
    </div>
  );
}

function Stat({ label, value, helper, icon, tone = 'cyan' }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <span className="eyebrow">{label}</span>
        <strong>{value}</strong>
        <p>{helper}</p>
      </div>
    </div>
  );
}

function LineChart({ history = [] }) {
  const safeHistory = history.length
    ? history.map((entry) => ({ score: Math.max(0, Math.min(100, Number(entry.score) || 0)) }))
    : [{ score: 0 }];

  const points = safeHistory.length === 1
    ? `0,${92 - safeHistory[0].score * 0.78} 100,${92 - safeHistory[0].score * 0.78}`
    : safeHistory.map((entry, index) =>
        `${(index / (safeHistory.length - 1)) * 100},${92 - entry.score * 0.78}`
      ).join(' ');

  return (
    <div className="chart">
              <div className="chart-labels"><span>100</span><span>75</span><span>50</span><span>25</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Trust score history">
        <defs>
          <linearGradient id="trust-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#27e1c1" stopOpacity=".35" />
            <stop offset="1" stopColor="#27e1c1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="area" d={`M0,100 L${points.replaceAll(' ', ' L')} L100,100 Z`} />
        <polyline points={points} className="chart-line" />
        {safeHistory.map((entry, index) => (
          <circle
            key={`${index}-${entry.score}`}
            cx={safeHistory.length === 1 ? 100 : (index / (safeHistory.length - 1)) * 100}
            cy={92 - entry.score * 0.78}
            r="1.6"
            className={index === safeHistory.length - 1 ? 'latest' : ''}
          />
        ))}
      </svg>
            <div className="chart-dates"><span>Earlier</span><span>Recent</span><span>Latest</span></div>
    </div>
  );
}

function DeviceTable({ devices, onSelect }) {
  if (!devices.length) {
    return <div className="empty-state">No registered devices were returned by the backend.</div>;
  }

    return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Device</th><th>Trust score</th><th>State</th><th>Last incident</th><th /></tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td>
                <div className="device-name">
                  <span className="device-dot" />
                  {deviceLabel(device)}
                  <small>{deviceSubLabel(device)}</small>
                </div>
              </td>
              <td>
                <div className="score-cell">
                  <span style={{ width: `${Math.max(0, Math.min(100, device.trustScore || 0))}%` }} />
                  {Number(device.trustScore) || 0}
                                  </div>
              </td>
              <td><Status status={statusFor(device.trustScore, device.compromised)} /></td>
              <td>{device.lastIncident || 'No events'}</td>
              <td>
                <button className="icon-btn" onClick={() => onSelect(device)} aria-label={`View ${deviceLabel(device)}`}>
                  {ICONS.arrow}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [devices, setDevices] = useState([]);
    const [incidents, setIncidents] = useState([]);
  const [chain, setChain] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshData() {
    setLoading(true);
    setLoadError('');
    try {
      const [deviceData, incidentData, chainData] = await Promise.all([
        api.getDevices(),
        api.getIncidents(),
        api.getBlockchainStatus()
      ]);
      setDevices(Array.isArray(deviceData) ? deviceData : []);
      setIncidents(Array.isArray(incidentData) ? incidentData : []);
            setChain(chainData || null);
    } catch (error) {
      setLoadError(error?.message || 'Could not load data from the backend.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, []);

  const counts = useMemo(() => ({
    total: devices.length,
        healthy: devices.filter((device) => statusFor(device.trustScore, device.compromised) === 'Healthy').length,
    risk: devices.filter((device) => ['At risk', 'Warning'].includes(statusFor(device.trustScore, device.compromised))).length,
    compromised: devices.filter((device) => device.compromised).length
  }), [devices]);

  const networkTrust = devices.length
    ? Math.round(devices.reduce((sum, device) => sum + (Number(device.trustScore) || 0), 0) / devices.length)
    : 0;

  const selectDevice = async (device) => {
    setSelected(device);
    setPage('device');
    try {
      const fresh = await api.getDevice(device.id);
      setSelected(fresh);
    } catch (error) {
      setNotice(`Could not refresh ${deviceLabel(device)}: ${error?.message || 'request failed'}`);
    }
  };

    const register = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const deviceId = String(new FormData(form).get('deviceId') || '').trim();
    if (!deviceId || busy) return;

    setBusy(true);
    try {
      const result = await api.registerDevice(deviceId);
      setNotice(`${deviceId} registered · ${shortHash(result.transactionHash)}`);
      setModal(false);
      setPage('devices');
      await refreshData();
    } catch (error) {
      setNotice(`Registration failed: ${error?.message || 'request failed'}`);
    } finally {
      setBusy(false);
    }
  };

    const content = loading
    ? <div className="loading">Synchronizing device and blockchain data<span>...</span></div>
    : loadError
      ? <section className="panel error-panel"><h3>Unable to load project data</h3><p>{loadError}</p><button className="primary" onClick={refreshData}>Retry</button></section>
      : page === 'dashboard'
        ? <Dashboard devices={devices} incidents={incidents} counts={counts} networkTrust={networkTrust} onSelect={selectDevice} setPage={setPage} />
        : page === 'devices'
          ? <Devices devices={devices} onSelect={selectDevice} onRegister={() => setModal(true)} />
          : page === 'device' && selected
            ? <DeviceDetails device={selected} incidents={incidents.filter((incident) => incident.deviceId === selected.id)} onBack={() => setPage('devices')} />
            : page === 'incidents'
              ? <Incidents incidents={incidents} onSelect={selectDevice} />
              : page === 'recovery'
                ? <Recovery incidents={incidents} onSelect={selectDevice} devices={devices} />
                : <Blockchain chain={chain} />;

  const pageTitle = page === 'dashboard'
    ? 'Network command center'
    : page === 'device'
      ? deviceLabel(selected)
      : nav.find(([id]) => id === page)?.[1] || 'Network';

        return (
    <main>
      <aside>
        <div className="brand">
          <span>◉</span>
          <div>TRUSTWEAVE<small>SELF-HEALING IOT</small></div>
        </div>
        <nav>
          {nav.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              <span>{ICONS[id]}</span>{label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="pulse"><i />{chain?.connected ? 'Blockchain connected' : 'Checking blockchain'}</div>
          <small>{chain?.network || 'Sepolia'} · {counts.total} registered devices</small>
        </div>
      </aside>

      <section className="shell">
        <header>
          <div>
            <span className="crumb">NETWORK / {page === 'device' ? selected?.id : page}</span>
            <h1>{pageTitle}</h1>
          </div>
          <div className="header-actions">
                        <span className="live"><i /> Blockchain-backed data</span>
            <button className="primary" onClick={() => setModal(true)}>{ICONS.add} Register device</button>
          </div>
        </header>

        {notice && <div className="notice">✓ {notice}<button onClick={() => setNotice('')}>×</button></div>}
        {content}
      </section>

      {modal && <RegisterModal close={() => setModal(false)} submit={register} busy={busy} />}
    </main>
  );
}

function Dashboard({ devices, incidents, counts, networkTrust, onSelect, setPage }) {
  const activeIncident = incidents[0] || null;
  const activeDevice = activeIncident ? devices.find((device) => device.id === activeIncident.deviceId) : null;

  return (
    <div className="page">
      <div className="hero">
        <div>
          <p className="eyebrow">GLOBAL NETWORK HEALTH</p>
          <h2>Autonomous protection,<br /><em>continuously verified.</em></h2>
          <p className="muted">AI monitors device signals, recommends recovery actions, and records security incidents on-chain.</p>
        </div>
        <div className="hero-score">
                      <Score score={networkTrust} large />
          <div><span>Network trust</span><strong>{networkTrust}<small>/100</small></strong><p>Average of current on-chain trust scores</p></div>
        </div>
      </div>

      <div className="stats">
        <Stat label="Total devices" value={counts.total} helper="Registered on Sepolia" icon="◌" />
        <Stat label="Healthy" value={counts.healthy} helper="Trust score ≥ 90" icon="✓" tone="green" />
        <Stat label="Needs attention" value={counts.risk} helper="Trust score below 90" icon="!" tone="amber" />
        <Stat label="Compromised" value={counts.compromised} helper="Flagged by the system" icon="×" tone="red" />
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">TRUST TELEMETRY</p><h3>Current network trust</h3></div></div>
          <LineChart history={devices.length ? devices.map((device) => ({ score: device.trustScore })) : [{ score: 0 }]} />
          <p className="muted">The contract stores the current trust score; historical chart points are current device scores, not timestamped score history.</p>
        </section>

        <section className="panel alert-panel">
          <div className="panel-head"><div><p className="eyebrow">LATEST ON-CHAIN INCIDENT</p><h3>{activeIncident?.issue || 'No incidents recorded'}</h3></div></div>
          {activeIncident ? (
            <div className="active-incident">
              <span className="warning-mark">!</span>
              <div>
                <b>{activeIncident.deviceName || activeDevice?.name || activeIncident.deviceId}</b>
                <p>{activeIncident.description || 'Incident details are stored on the blockchain.'}</p>
                <small>Recorded: {activeIncident.timestamp}</small>
              </div>
            </div>
          ) : <p className="muted">No incidents have been returned by the blockchain backend.</p>}
          <button className="link" onClick={() => setPage('incidents')}>View incident history {ICONS.arrow}</button>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">DEVICE TELEMETRY</p><h3>Registered devices</h3></div>
          <button className="link" onClick={() => setPage('devices')}>View all {ICONS.arrow}</button>
        </div>
        <DeviceTable devices={devices.slice(0, 5)} onSelect={onSelect} />
      </section>
    </div>
  );
}

function Devices({ devices, onSelect, onRegister }) {
  const [query, setQuery] = useState('');
  const filtered = devices.filter((device) =>
    [device.name, device.id, device.type, device.aiDeviceId, device.location]
      .filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-intro">
        <div><p className="eyebrow">MONITORING LAYER</p><h2>Connected devices</h2><p className="muted">Friendly device names are mapped to their existing blockchain IDs.</p></div>
        <button className="primary" onClick={onRegister}>+ Register device</button>
      </div>
      <section className="panel">
        <div className="toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, type, or location" /><span>{filtered.length} of {devices.length} devices</span></div>
        <DeviceTable devices={filtered} onSelect={onSelect} />
      </section>
    </div>
  );
}

function DeviceDetails({ device, incidents, onBack }) {
  const status = statusFor(device.trustScore, device.compromised);
  return (
    <div className="page">
      <button className="back" onClick={onBack}>← All devices</button>
      <div className="device-hero">
        <div>
          <p className="eyebrow">DEVICE DETAIL · {device.location}</p>
          <h2>{deviceLabel(device)}</h2>
          <p className="muted">{device.type ? device.type.replaceAll('_', ' ') : 'IoT device'} · Blockchain ID: {device.id}</p>
          <Status status={status} />
        </div>
        <div className="detail-score">
          <Score score={device.trustScore} large />
          <div><span>Current trust score</span><strong>{device.trustScore}<small>/100</small></strong><p className={toneFor(status)}>{status.toUpperCase()}</p></div>
        </div>
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">CONTINUOUS MONITORING</p><h3>Trust score overview</h3></div><span className="range">Current contract value</span></div>
          <LineChart history={device.history || [{ score: device.trustScore }]} />
          <p className="muted">Timestamped trust-score history is not stored by the current smart contract.</p>
        </section>
                <section className="panel">
          <p className="eyebrow">DEVICE INFORMATION</p><h3>Operational profile</h3>
          <dl>
            <div><dt>Display name</dt><dd>{deviceLabel(device)}</dd></div>
            <div><dt>AI device ID</dt><dd>{device.aiDeviceId || 'Not mapped'}</dd></div>
            <div><dt>Blockchain ID</dt><dd>{device.id}</dd></div>
            <div><dt>Device type</dt><dd>{device.type || 'Unknown'}</dd></div>
            <div><dt>Compromised</dt><dd>{device.compromised ? 'Yes — flagged on-chain' : 'No'}</dd></div>
            <div><dt>Last incident</dt><dd>{device.lastIncident || 'None recorded'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel recovery-detail">
        <div>
          <div><p className="eyebrow">ON-CHAIN INCIDENT HISTORY</p><h3>{incidents[0]?.issue || 'No incident recorded'}</h3><p className="muted">{incidents[0]?.description || 'There are no returned incident records for this device.'}</p></div>
          <div className="analysis">
            <span>Recovery action recorded</span><p>{incidents[0]?.recovery || 'No recovery action recorded.'}</p>
            <span>Record status</span><b className="chain-ok">{incidents[0] ? '✓ Stored in incident history' : 'No record'}</b>
          </div>
        </div>
      </section>
    </div>
  );
}

function Incidents({ incidents, onSelect }) {
  return (
    <div className="page">
      <div className="page-intro"><div><p className="eyebrow">IMMUTABLE EVENT LEDGER</p><h2>Incident history</h2><p className="muted">Fault descriptions and recovery actions recorded by the smart contract.</p></div></div>
      <section className="panel">
        <div className="toolbar"><span>{incidents.length} recorded events</span></div>
        {incidents.length ? (
          <div className="incidents">
            {incidents.map((incident) => (
              <button className="incident" key={incident.id} onClick={() => onSelect({ id: incident.deviceId, name: incident.deviceName || incident.deviceId })}>
                <span className={`incident-icon ${incident.status === 'Recorded' ? 'done' : ''}`}>{incident.status === 'Recorded' ? '✓' : '!'}</span>
                <div><b>{incident.issue}</b><p>{incident.deviceName || incident.deviceId} · {incident.timestamp}</p></div>
                <Status status={incident.status || 'Recorded'} />
                <span className="hash">{shortHash(incident.transactionHash)}</span>{ICONS.arrow}
              </button>
            ))}
          </div>
        ) : <div className="empty-state">No incidents are recorded on the contract yet.</div>}
      </section>
    </div>
  );
}

function Recovery({ incidents, onSelect, devices }) {
  const active = incidents[0] || null;
  const device = active ? devices.find((entry) => entry.id === active.deviceId) : null;

  return (
    <div className="page">
      <div className="page-intro"><div><p className="eyebrow">AUTONOMOUS RESPONSE LAYER</p><h2>AI recovery console</h2><p className="muted">Displays incident and recovery information returned by the backend; it does not generate AI decisions itself.</p></div></div>
      <section className="panel recovery-console">
        {active ? (
          <>
            <div className="recovery-title">
              <span className="ai-orb">✦</span>
              <div><span className="eyebrow">LATEST RECORDED INCIDENT</span><h3>{active.issue}</h3><p>{active.deviceName || deviceLabel(device) || active.deviceId} · Blockchain ID: {active.deviceId}</p></div>
              <Status status={active.status || 'Recorded'} />
            </div>
            <div className="steps">
              <div><i>1</i><span>Incident</span><b>{active.description || active.issue}</b></div>
              <div><i>2</i><span>Recorded recovery action</span><b>{active.recovery || 'No action stored'}</b></div>
              <div><i>3</i><span>Blockchain record</span><b>{active.status || 'Recorded'}</b></div>
            </div>
            <div className="confidence"><span>AI confidence</span><strong>{active.confidence == null ? 'Not stored on-chain' : `${active.confidence}%`}</strong><p className="muted">The current contract does not store AI confidence or verify device-side recovery completion.</p>{device && <button className="primary" onClick={() => onSelect(device)}>Open device details {ICONS.arrow}</button>}</div>
          </>
        ) : <div className="empty-state">No recorded incidents are available for recovery review.</div>}
      </section>
    </div>
  );
}

function Blockchain({ chain }) {
  return (
    <div className="page">
      <div className="page-intro">
        <div><p className="eyebrow">PERSISTENCE LAYER</p><h2>Blockchain verification</h2><p className="muted">Device trust state and incident records read from the smart contract.</p></div>
        <span className="live"><i />{chain?.connected ? 'Connected' : 'Offline'}</span>
      </div>
      <div className="chain-stats">
        <Stat label="Network" value={chain?.network || 'Unknown'} helper="Configured blockchain network" icon="⬡" />
        <Stat label="Stored devices" value={chain?.storedDevices ?? '—'} helper="Registered on contract" icon="◌" tone="green" />
        <Stat label="Stored incidents" value={chain?.storedIncidents ?? '—'} helper="Incident entries on contract" icon="✓" tone="amber" />
      </div>
      <section className="panel">
        <p className="eyebrow">SMART CONTRACT</p>
        <h3>{chain?.contract || 'IoTTrust'}</h3>
        <p className="contract">{chain?.contractAddress || 'Contract address unavailable'}</p>
        {chain?.error && <p className="muted">{chain.error}</p>}
        <div className="transactions">
          <p className="eyebrow">RECENT TRANSACTIONS</p>
          {(chain?.transactions || []).length
            ? chain.transactions.map((transaction) => (
                <div key={transaction.hash}>
                  <code>{shortHash(transaction.hash)}</code><span>{transaction.type}</span><Status status="Healthy" /><small>{transaction.time}</small>
                </div>
              ))
            : <p className="muted">Transaction hashes are returned by write endpoints; this endpoint does not currently provide a transaction feed.</p>}
        </div>
      </section>
    </div>
  );
}
function RegisterModal({ close, submit, busy }) {
  return (
    <div className="modal-back">
      <form className="modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={close}>×</button>
        <span className="modal-icon">+</span>
        <p className="eyebrow">BLOCKCHAIN REGISTRATION</p>
        <h2>Add a device</h2>
        <p className="muted">Register a unique blockchain device ID. Existing AI devices use the mapped sensor IDs shown in the device table.</p>
        <label>Blockchain device ID<input name="deviceId" autoFocus placeholder="e.g. sensor_12" pattern="[A-Za-z0-9_-]+" required /></label>
        <button className="primary full" disabled={busy}>{busy ? 'Registering…' : 'Register device →'}</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);