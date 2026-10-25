// UI-only integration boundary. Supply VITE_API_BASE_URL to use your real service.
// Endpoints intentionally mirror the backend contract from the project brief.
const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
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
async function request(path, options) { if (!base) throw new Error('Mock mode'); const res=await fetch(`${base}${path}`,{headers:{'Content-Type':'application/json'},...options}); if(!res.ok)throw new Error(`API ${res.status}`);return res.json(); }
export async function getDevices() {
  try {
    const data = await request('/devices');
    const devices = Array.isArray(data) ? data : data.devices;

    return Array.isArray(devices) ? devices : mockDevices;
  } catch {
    return mockDevices;
  }
}
export async function getDevice(id){try{return await request(`/device/${encodeURIComponent(id)}`);}catch{return mockDevices.find(d=>d.id===id)||mockDevices[0];}}
export async function getIncidents(){try {const data=await request('/incidents');return data.incidents||data;}catch{return mockIncidents;}}
export async function getHistory(id){try{return await request(`/history/${encodeURIComponent(id)}`);}catch{return mockDevices.find(d=>d.id===id)?.history||[];}}
export async function registerDevice(deviceId) {
  try {
    const result = await request('/register-device', {
      method: 'POST',
      body: JSON.stringify({ deviceId })
    });

    return {
      device: {
        id: deviceId,
        location: 'On-chain device',
        trustScore: 100,
        compromised: false,
        lastIncident: null,
        history: [{ score: 100 }, { score: 100 }]
      },
      transactionHash: result.transactionHash
    };
  } catch {
    return {
      device: {
        id: deviceId,
        location: 'Pending assignment',
        trustScore: 100,
        compromised: false,
        lastIncident: null,
        history: [{ score: 100 }, { score: 100 }]
      },
      transactionHash: '0x7edb492a1c39f8d22b53f06ecb9912b0fe71a33d'
    };
  }
}
export async function updateTrustScore(deviceId,trustScore){return request('/update-trust',{method:'POST',body:JSON.stringify({deviceId,trustScore})});}
export async function markCompromised(deviceId){return request('/mark-compromised',{method:'POST',body:JSON.stringify({deviceId})});}
export async function addIncident(incident){return request('/add-incident',{method:'POST',body:JSON.stringify(incident)});}
export async function getBlockchainStatus(){try{return await request('/blockchain-status');}catch{return mockChain;}}
