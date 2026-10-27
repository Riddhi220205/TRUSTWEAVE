// API layer. By default the UI talks to the real backend (which reads Sepolia).
//   - Local dev  : http://localhost:3000
//   - Production : https://trustweave-api.onrender.com (override with VITE_API_BASE_URL)
// Demo data is used ONLY when VITE_USE_DEMO=true. Errors are never silently
// swapped for demo data, so what you see is always what the blockchain returned.
const DEFAULT_PROD_API = 'https://trustweave-api.onrender.com';
const DEFAULT_DEV_API = 'http://localhost:3000';
export const USE_DEMO = String(import.meta.env.VITE_USE_DEMO || '').toLowerCase() === 'true';
const base = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_API : DEFAULT_DEV_API)
).replace(/\/+$/, '');
export const API_BASE = base;

const mockDevices = [
  {id:'sensor_01',location:'North Atrium',trustScore:96,compromised:false,lastIncident:null,history:[{score:90},{score:91},{score:90},{score:94},{score:93},{score:96}]},
  {id:'sensor_02',location:'Thermal Lab',trustScore:48,compromised:false,lastIncident:'High temperature',history:[{score:94},{score:89},{score:82},{score:72},{score:61},{score:48}]},
  {id:'sensor_03',location:'West Gateway',trustScore:100,compromised:false,lastIncident:null,history:[{score:96},{score:98},{score:96},{score:100},{score:99},{score:100}]},
  {id:'sensor_04',location:'Storage Bay',trustScore:22,compromised:true,lastIncident:'Network failure',history:[{score:74},{score:66},{score:51},{score:39},{score:30},{score:22}]},
  {id:'sensor_05',location:'Assembly Line',trustScore:91,compromised:false,lastIncident:'Battery alert',history:[{score:88},{score:86},{score:90},{score:92},{score:89},{score:91}]},
  {id:'sensor_06',location:'Loading Dock',trustScore:83,compromised:false,lastIncident:null,history:[{score:81},{score:84},{score:82},{score:80},{score:85},{score:83}]}
];
const mockIncidents = [
 {id:'evt_01',deviceId:'sensor_02',issue:'High temperature',trustScore:48,status:'Recovering',timestamp:'Today, 10:32',description:'Temperature exceeded the safe operating threshold for 4 consecutive readings.',historicalMatch:true,recovery:'Activate cooling system, then restart device.',confidence:94,transactionHash:'0x8a72cd97ba1a1ddf01c0d8a32f45bfe9830a1e2c'},
 {id:'evt_02',deviceId:'sensor_05',issue:'Battery degradation',trustScore:71,status:'Recovered',timestamp:'Yesterday, 18:05',description:'Voltage fall-off exceeded expected discharge curve.',historicalMatch:false,recovery:'Switched to low-power mode and initiated battery protocol.',confidence:88,transactionHash:'0x40ca35b7ec3f8c921de684379f453a83629fcb21'},
 {id:'evt_03',deviceId:'sensor_04',issue:'Network failure',trustScore:22,status:'Recovered',timestamp:'28 Aug, 08:14',description:'Authenticated uplink has failed.',historicalMatch:true,recovery:'Isolated device and applied a verified network reset.',confidence:97,transactionHash:'0xdf283f7b1cda32e6e32f544ce591b4292d8a3b10'}
];
const mockChain = {connected:true,network:'Sepolia',contract:'IoTTrust',contractAddress:'0x25A6eeE81CbC4a7F72bB0BFED2aD968B9A39dAc1',storedDevices:12,storedIncidents:27,transactions:[{hash:'0x8a72cd97ba1a1ddf01c0d8a32f45bfe9830a1e2c',type:'Incident recorded',time:'2m ago'},{hash:'0x40ca35b7ec3f8c921de684379f453a83629fcb21',type:'Trust score updated',time:'18m ago'},{hash:'0xdf283f7b1cda32e6e32f544ce591b4292d8a3b10',type:'Recovery confirmed',time:'1h ago'}]};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Render's free tier sleeps after inactivity; the first request can take ~30-60s.
// Use a generous timeout and retry network failures / 502-504 a couple of times.
async function request(path, options = {}, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        signal: controller.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

      if (!res.ok) {
        const detail = data?.error || data?.message || text.slice(0, 160) || res.statusText;
        const error = new Error(`API ${res.status}: ${detail}`);
        error.status = res.status;
        if ([502, 503, 504].includes(res.status) && attempt < retries) {
          lastError = error;
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error.status) throw error; // real HTTP error, already formatted
      lastError = error.name === 'AbortError'
        ? new Error(`Backend at ${base} timed out. It may be waking up - please retry.`)
        : new Error(`Cannot reach backend at ${base} (${error.message}). Is it running and is the URL correct?`);
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function getDevices() {
  if (USE_DEMO) return mockDevices;
  const data = await request('/devices');
  const devices = Array.isArray(data) ? data : data?.devices;
  if (!Array.isArray(devices)) throw new Error('Backend returned an unexpected /devices response');
  return devices;
}
export async function getDevice(id) {
  if (USE_DEMO) return mockDevices.find((d) => d.id === id) || mockDevices[0];
  return request(`/device/${encodeURIComponent(id)}`);
}
export async function getIncidents() {
  if (USE_DEMO) return mockIncidents;
  const data = await request('/incidents');
  return data?.incidents || (Array.isArray(data) ? data : []);
}
export async function getHistory(id) {
  if (USE_DEMO) return mockDevices.find((d) => d.id === id)?.history || [];
  return request(`/history/${encodeURIComponent(id)}`);
}
export async function registerDevice(deviceId) {
  if (USE_DEMO) {
    return {
      device: { id: deviceId, location: 'Pending assignment', trustScore: 100, compromised: false, lastIncident: null, history: [{ score: 100 }] },
      transactionHash: '0x7edb492a1c39f8d22b53f06ecb9912b0fe71a33d'
    };
  }
  // Writing to Sepolia waits for a mined block, which can take a while.
  const result = await request('/register-device', { method: 'POST', body: JSON.stringify({ deviceId }) }, { retries: 0, timeoutMs: 120000 });
  return { device: result.device, transactionHash: result.transactionHash };
}
export async function updateTrustScore(deviceId, trustScore) {
  return request('/update-trust', { method: 'POST', body: JSON.stringify({ deviceId, trustScore }) }, { retries: 0, timeoutMs: 120000 });
}
export async function markCompromised(deviceId) {
  return request('/mark-compromised', { method: 'POST', body: JSON.stringify({ deviceId }) }, { retries: 0, timeoutMs: 120000 });
}
export async function addIncident(incident) {
  return request('/add-incident', { method: 'POST', body: JSON.stringify(incident) }, { retries: 0, timeoutMs: 120000 });
}
export async function getBlockchainStatus() {
  if (USE_DEMO) return mockChain;
  return request('/blockchain-status');
}
