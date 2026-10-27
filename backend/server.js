require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const abi = require("./contractABI.json");

const requiredEnv = ["RPC_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length) {
  throw new Error(
    `Missing ${missingEnv.join(", ")} in backend/.env`
  );
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  abi,
  wallet
);

// Blockchain IDs remain compatible with the deployed contract and AI gateway.
// The UI displays the friendly device name, while APIs continue to use `id`
// as the blockchain ID (sensor_01, sensor_02, etc.).
const deviceInfo = {
  // Blockchain ID -> canonical AI-layer device ID.
  sensor_01: { name: "Smart TV", type: "smart_tv", location: "Living Room", aiDeviceId: "smart_tv_01" },
  sensor_02: { name: "Thermostat", type: "thermostat", location: "Thermal Lab", aiDeviceId: "thermostat_01" },
  sensor_12: { name: "Security Camera", type: "camera", location: "Main Entrance", aiDeviceId: "camera_01" },
  sensor_23: { name: "Smart Bulb", type: "smart_bulb", location: "Living Room", aiDeviceId: "smart_bulb_01" },
  sensor_21: { name: "Smart Lock", type: "smart_lock", location: "Main Door", aiDeviceId: "smart_lock_01" },
  sensor_03: { name: "IoT Sensor 03", type: "sensor", location: "West Gateway", aiDeviceId: null },
  sensor_04: { name: "IoT Sensor 04", type: "sensor", location: "Storage Bay", aiDeviceId: null },
  sensor_05: { name: "IoT Sensor 05", type: "sensor", location: "Assembly Line", aiDeviceId: null },
  sensor_06: { name: "IoT Sensor 06", type: "sensor", location: "Loading Dock", aiDeviceId: null }
};

const deviceIds = new Set();
// Limit simultaneous RPC calls to avoid Alchemy rate limits.
async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;

      results[index] = await callback(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}

function getDeviceInfo(deviceId) {
  return deviceInfo[deviceId] || {
    name: deviceId,
    type: "unknown",
    location: "Unassigned",
    aiDeviceId: null
  };
}

async function loadDeviceIds() {
  // This requires backend/contractABI.json to include getDeviceIds().
  if (!contract.interface.getFunction("getDeviceIds")) {
    throw new Error(
      "The backend ABI is missing getDeviceIds(). Copy the current IoTTrust ABI from blockchain/artifacts/contracts/IoTTrust.sol/IoTTrust.json into backend/contractABI.json, then restart the backend."
    );
  }

  const onChainIds = await contract.getDeviceIds();
  deviceIds.clear();

  for (const id of onChainIds) {
    deviceIds.add(id);
  }

  return [...deviceIds];
}

async function getHistory(deviceId) {
  const count = Number(await contract.getIncidentCount(deviceId));
  const history = [];

  for (let index = 0; index < count; index += 1) {
    const incident = await contract.incidents(deviceId, index);

    history.push({
      index,
      bugType: incident[0],
      description: incident[1],
      recovery: incident[2],
      timestamp: Number(incident[3])
    });
  }

  return history;
}

async function getDeviceSummary(deviceId) {
  const registered = await contract.deviceExists(deviceId);
  if (!registered) {
    throw new Error(`Device "${deviceId}" is not registered on the contract`);
  }

  const device = await contract.devices(deviceId);
  const trustScore = Number(device[1]);
  const compromised = Boolean(device[2]);
  const history = await getHistory(deviceId);
  const latestIncident = history.length ? history[history.length - 1] : null;
  const info = getDeviceInfo(deviceId);

  return {
    id: deviceId, // Keep this as the blockchain ID for API compatibility.
    name: info.name,
    type: info.type,
    aiDeviceId: info.aiDeviceId || null,
    location: info.location,
    trustScore,
    compromised,
    lastIncident: latestIncident?.bugType || null,
    history: [{ score: trustScore }],
    incidentHistory: history
  };
}

function sendError(res, error, route) {
  console.error(`${route} error:`, error);
  res.status(500).json({
    success: false,
    error: error.message || "Internal server error"
  });
}

// HEALTH CHECK
app.get("/", async (req, res) => {
  try {
    const network = await provider.getNetwork();
    res.json({
      success: true,
      message: "Blockchain IoT API running",
      network: network.chainId === 11155111n ? "Sepolia" : network.name
    });
  } catch (error) {
    sendError(res, error, "GET /");
  }
});

// GET ALL REGISTERED DEVICES FROM SEPOLIA
app.get("/devices", async (req, res) => {
  try {
    const ids = await loadDeviceIds();

    const devices = await mapWithConcurrency(
      ids,
      2,
      async (id) => getDeviceSummary(id)
    );

    res.json({ success: true, devices });
  } catch (error) {
    sendError(res, error, "GET /devices");
  }
});
// GET ONE DEVICE
app.get("/device/:id", async (req, res) => {
  try {
    const deviceId = req.params.id;
    const device = await getDeviceSummary(deviceId);
    res.json({ success: true, ...device });
  } catch (error) {
    sendError(res, error, "GET /device/:id");
  }
});

// REGISTER DEVICE ON SEPOLIA
app.post("/register-device", async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required"
      });
    }

    if (await contract.deviceExists(deviceId)) {
      return res.status(409).json({
        success: false,
        error: `Device "${deviceId}" is already registered`
      });
    }

    const tx = await contract.registerDevice(deviceId);
    await tx.wait();
    deviceIds.add(deviceId);

    const device = await getDeviceSummary(deviceId);

    res.status(201).json({
      success: true,
      message: "Device registered on Sepolia",
      transactionHash: tx.hash,
      device
    });
  } catch (error) {
    sendError(res, error, "POST /register-device");
  }
});

// UPDATE TRUST SCORE ON SEPOLIA
app.post("/update-trust", async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const score = Number(req.body?.trustScore);

    if (!deviceId || !Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({
        success: false,
        error: "deviceId and an integer trustScore from 0 to 100 are required"
      });
    }

    const tx = await contract.updateTrustScore(deviceId, score);
    await tx.wait();

    res.json({
      success: true,
      message: "Trust score updated on Sepolia",
      transactionHash: tx.hash
    });
  } catch (error) {
    sendError(res, error, "POST /update-trust");
  }
});

// MARK DEVICE COMPROMISED ON SEPOLIA
app.post("/mark-compromised", async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required"
      });
    }

    const tx = await contract.markCompromised(deviceId);
    await tx.wait();

    res.json({
      success: true,
      message: "Device marked compromised on Sepolia",
      transactionHash: tx.hash
    });
  } catch (error) {
    sendError(res, error, "POST /mark-compromised");
  }
});

// ADD INCIDENT ON SEPOLIA
app.post("/add-incident", async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const bugType = String(req.body?.bugType || "").trim();
    const description = String(req.body?.description || "").trim();
    const recovery = String(req.body?.recovery || "").trim();

    if (!deviceId || !bugType || !description || !recovery) {
      return res.status(400).json({
        success: false,
        error: "deviceId, bugType, description and recovery are required"
      });
    }

    const tx = await contract.addIncident(deviceId, bugType, description, recovery);
    await tx.wait();

    res.status(201).json({
      success: true,
      message: "Incident stored on Sepolia",
      transactionHash: tx.hash
    });
  } catch (error) {
    sendError(res, error, "POST /add-incident");
  }
});

// GET ONE DEVICE'S INCIDENT HISTORY
app.get("/history/:id", async (req, res) => {
  try {
    const deviceId = req.params.id;
    const history = await getHistory(deviceId);

    res.json({
      success: true,
      deviceId,
      incidentCount: history.length,
      history
    });
  } catch (error) {
    sendError(res, error, "GET /history/:id");
  }
});

// GET ALL INCIDENTS FOR ALL ON-CHAIN DEVICES
app.get("/incidents", async (req, res) => {
  try {
    const ids = await loadDeviceIds();

    const groups = await mapWithConcurrency(
      ids,
      2,
      async (deviceId) => {
        const history = await getHistory(deviceId);
        const info = getDeviceInfo(deviceId);

        return history.map((incident) => ({
          id: `${deviceId}-${incident.index}`,
          deviceId,
          deviceName: info.name,
          issue: incident.bugType,
          status: "Recorded",
          timestamp: new Date(
            incident.timestamp * 1000
          ).toLocaleString(),
          timestampUnix: incident.timestamp,
          description: incident.description,
          recovery: incident.recovery,
          historicalMatch: false,
          confidence: null,
          transactionHash: null
        }));
      }
    );

    res.json({
      success: true,
      incidents: groups.flat()
    });
  } catch (error) {
    sendError(res, error, "GET /incidents");
  }
});

// BLOCKCHAIN STATUS
app.get("/blockchain-status", async (req, res) => {
  try {
    const network = await provider.getNetwork();
    const ids = await loadDeviceIds();
    const incidentCounts = await Promise.all(ids.map((id) => contract.getIncidentCount(id)));
    const storedIncidents = incidentCounts.reduce((sum, count) => sum + Number(count), 0);

    res.json({
      connected: true,
      network: network.chainId === 11155111n ? "Sepolia" : network.name,
      contract: "IoTTrust",
      contractAddress: process.env.CONTRACT_ADDRESS,
      storedDevices: ids.length,
      storedIncidents,
      transactions: []
    });
  } catch (error) {
    res.status(500).json({
      connected: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});