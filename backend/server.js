require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3000);
const { RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  throw new Error("Missing RPC_URL, PRIVATE_KEY, or CONTRACT_ADDRESS in backend/.env");
}

// Prefer the current Hardhat artifact (it must contain getDeviceIds).
// Fall back to backend/contractABI.json if the artifact is not present.
const artifactPath = path.resolve(
  __dirname,
  "../blockchain/artifacts/contracts/IoTTrust.sol/IoTTrust.json"
);
const abiPath = path.join(__dirname, "contractABI.json");

let abi;
if (fs.existsSync(artifactPath)) {
  abi = require(artifactPath).abi;
} else if (fs.existsSync(abiPath)) {
  abi = require(abiPath);
} else {
  throw new Error("Could not find IoTTrust ABI. Compile the contract or provide backend/contractABI.json.");
}

const requiredFunctions = [
  "devices",
  "registerDevice",
  "updateTrustScore",
  "markCompromised",
  "addIncident",
  "getIncidentCount",
  "getDeviceIds",
  "incidents"
];
const abiFunctionNames = new Set(
  abi.filter((item) => item.type === "function").map((item) => item.name)
);
const missingFunctions = requiredFunctions.filter((name) => !abiFunctionNames.has(name));
if (missingFunctions.length) {
  throw new Error(
    `IoTTrust ABI is missing: ${missingFunctions.join(", ")}. Copy the latest compiled ABI into backend/contractABI.json or compile the contract.`
  );
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

// AI's canonical device IDs map to the IDs already registered on-chain.
// Keep blockchain IDs stable; show human-friendly names in the frontend.
const DEVICE_INFO = {
  sensor_01: { name: "Smart TV", type: "smart_tv", location: "Living Room", aiDeviceId: "smart_tv_01" },
  sensor_02: { name: "Thermostat", type: "thermostat", location: "Thermal Lab", aiDeviceId: "thermostat_01" },
  sensor_12: { name: "Security Camera", type: "camera", location: "Main Entrance", aiDeviceId: "camera_01" },
  sensor_23: { name: "Smart Bulb", type: "smart_bulb", location: "Living Room", aiDeviceId: "smart_bulb_01" },
  sensor_21: { name: "Smart Lock", type: "smart_lock", location: "Main Door", aiDeviceId: "smart_lock_01" },
  sensor_03: { name: "Environmental Sensor", type: "sensor", location: "West Gateway" },
  sensor_04: { name: "Storage Sensor", type: "sensor", location: "Storage Bay" },
  sensor_05: { name: "Industrial Sensor", type: "sensor", location: "Assembly Line" },
  sensor_06: { name: "Loading Sensor", type: "sensor", location: "Loading Dock" }
};

const AI_TO_CHAIN_ID = Object.fromEntries(
  Object.entries(DEVICE_INFO)
    .filter(([, info]) => info.aiDeviceId)
    .map(([chainId, info]) => [info.aiDeviceId, chainId])
);

function normalizeDeviceId(input) {
  const id = String(input ?? "").trim();
  return AI_TO_CHAIN_ID[id] || id;
}

function deviceMetadata(deviceId) {
  const info = DEVICE_INFO[deviceId];
  return {
    name: info?.name || deviceId,
    type: info?.type || "unknown",
    location: info?.location || "Unassigned"
  };
}

async function loadDeviceIds() {
  // This method is in the latest IoTTrust contract and its ABI.
  const ids = await contract.getDeviceIds();
  return [...new Set(ids.map((id) => String(id)))];
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

async function getDeviceSummary(inputId) {
  const deviceId = normalizeDeviceId(inputId);
  const device = await contract.devices(deviceId);

  // Solidity mapping getters return default values for unknown IDs.
  // Check registration explicitly so a typo isn't presented as a real device.
  const exists = await contract.deviceExists(deviceId);
  if (!exists) {
    const error = new Error(`Device '${deviceId}' is not registered on the contract`);
    error.statusCode = 404;
    throw error;
  }

  const trustScore = Number(device[1]);
  const compromised = Boolean(device[2]);
  const history = await getHistory(deviceId);
  const latestIncident = history.at(-1);
  const metadata = deviceMetadata(deviceId);

  return {
    id: deviceId,
    name: metadata.name,
    type: metadata.type,
    aiDeviceId: metadata.aiDeviceId || null,
    location: metadata.location,
    trustScore,
    compromised,
    lastIncident: latestIncident?.bugType || null,
    history: [{ score: trustScore }],
    incidents: history
  };
}

function sendError(res, error, route) {
  console.error(`${route} error:`, error);
  const status = error.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error.message || "Internal server error"
  });
}

app.get("/", (_req, res) => {
  res.json({ success: true, message: "TRUSTWEAVE blockchain API running", network: "Sepolia" });
});

app.get("/health", async (_req, res) => {
  try {
    const network = await provider.getNetwork();
    res.json({
      success: true,
      status: "healthy",
      network: network.chainId === 11155111n ? "Sepolia" : network.name,
      chainId: network.chainId.toString(),
      contractAddress: CONTRACT_ADDRESS
    });
  } catch (error) {
    sendError(res, error, "GET /health");
  }
});

app.get("/devices", async (_req, res) => {
  try {
    const ids = await loadDeviceIds();
    const devices = await Promise.all(ids.map((id) => getDeviceSummary(id)));
    res.json({ success: true, devices });
  } catch (error) {
    sendError(res, error, "GET /devices");
  }
});

app.get("/device/:id", async (req, res) => {
  try {
    const device = await getDeviceSummary(req.params.id);
    res.json({ success: true, ...device });
  } catch (error) {
    sendError(res, error, "GET /device/:id");
  }
});

app.post("/register-device", async (req, res) => {
  try {
    const inputId = String(req.body?.deviceId ?? "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(inputId)) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required and may contain only letters, numbers, underscores, and hyphens"
      });
    }

    const deviceId = normalizeDeviceId(inputId);
    const exists = await contract.deviceExists(deviceId);
    if (exists) {
      return res.status(409).json({ success: false, error: `Device '${deviceId}' is already registered` });
    }

    const tx = await contract.registerDevice(deviceId);
    const receipt = await tx.wait();

    res.status(201).json({
      success: true,
      message: "Device registered on Sepolia",
      transactionHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? null,
      device: {
        id: deviceId,
        ...deviceMetadata(deviceId),
        aiDeviceId: deviceMetadata(deviceId).aiDeviceId || null,
        trustScore: 100,
        compromised: false,
        lastIncident: null,
        history: [{ score: 100 }]
      }
    });
  } catch (error) {
    sendError(res, error, "POST /register-device");
  }
});

app.post("/update-trust", async (req, res) => {
  try {
    const inputId = req.body?.deviceId;
    const score = Number(req.body?.trustScore);
    if (!inputId || !Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({
        success: false,
        error: "deviceId and an integer trustScore from 0 to 100 are required"
      });
    }

    const deviceId = normalizeDeviceId(inputId);
    if (!(await contract.deviceExists(deviceId))) {
      return res.status(404).json({ success: false, error: `Device '${deviceId}' is not registered` });
    }

    const tx = await contract.updateTrustScore(deviceId, score);
    const receipt = await tx.wait();
    res.json({ success: true, message: "Trust score updated on Sepolia", transactionHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
  } catch (error) {
    sendError(res, error, "POST /update-trust");
  }
});

app.post("/mark-compromised", async (req, res) => {
  try {
    const inputId = req.body?.deviceId;
    if (!inputId) {
      return res.status(400).json({ success: false, error: "deviceId is required" });
    }

    const deviceId = normalizeDeviceId(inputId);
    if (!(await contract.deviceExists(deviceId))) {
      return res.status(404).json({ success: false, error: `Device '${deviceId}' is not registered` });
    }

    const tx = await contract.markCompromised(deviceId);
    const receipt = await tx.wait();
    res.json({ success: true, message: "Device marked compromised on Sepolia", transactionHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
  } catch (error) {
    sendError(res, error, "POST /mark-compromised");
  }
});

app.post("/add-incident", async (req, res) => {
  try {
    const { deviceId: inputId, bugType, description, recovery } = req.body || {};
    if (!inputId || !bugType || !description || !recovery) {
      return res.status(400).json({
        success: false,
        error: "deviceId, bugType, description and recovery are required"
      });
    }

    const deviceId = normalizeDeviceId(inputId);
    if (!(await contract.deviceExists(deviceId))) {
      return res.status(404).json({ success: false, error: `Device '${deviceId}' is not registered` });
    }

    const tx = await contract.addIncident(deviceId, String(bugType), String(description), String(recovery));
    const receipt = await tx.wait();
    res.status(201).json({ success: true, message: "Incident stored on Sepolia", transactionHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
  } catch (error) {
    sendError(res, error, "POST /add-incident");
  }
});

app.get("/history/:id", async (req, res) => {
  try {
    const deviceId = normalizeDeviceId(req.params.id);
    if (!(await contract.deviceExists(deviceId))) {
      return res.status(404).json({ success: false, error: `Device '${deviceId}' is not registered` });
    }
    const history = await getHistory(deviceId);
    res.json({ success: true, deviceId, incidentCount: history.length, history });
  } catch (error) {
    sendError(res, error, "GET /history/:id");
  }
});

app.get("/incidents", async (_req, res) => {
  try {
    const ids = await loadDeviceIds();
    const grouped = await Promise.all(ids.map(async (deviceId) => {
      const history = await getHistory(deviceId);
      return history.map((incident) => ({
        id: `${deviceId}-${incident.index}`,
        deviceId,
        deviceName: deviceMetadata(deviceId).name,
        issue: incident.bugType,
        status: "Recovered",
        timestamp: new Date(incident.timestamp * 1000).toISOString(),
        description: incident.description,
        recovery: incident.recovery,
        historicalMatch: true,
        confidence: null,
        transactionHash: null
      }));
    }));

    res.json({ success: true, incidents: grouped.flat().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) });
  } catch (error) {
    sendError(res, error, "GET /incidents");
  }
});

app.get("/blockchain-status", async (_req, res) => {
  try {
    const [network, ids] = await Promise.all([provider.getNetwork(), loadDeviceIds()]);
    const incidentCounts = await Promise.all(ids.map((id) => contract.getIncidentCount(id)));
    const storedIncidents = incidentCounts.reduce((sum, count) => sum + Number(count), 0);

    res.json({
      success: true,
      connected: true,
      network: network.chainId === 11155111n ? "Sepolia" : network.name,
      chainId: network.chainId.toString(),
      contract: "IoTTrust",
      contractAddress: CONTRACT_ADDRESS,
      storedDevices: ids.length,
      storedIncidents,
      transactions: []
    });
  } catch (error) {
    console.error("GET /blockchain-status error:", error);
    res.status(500).json({ success: false, connected: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`TRUSTWEAVE backend running at http://localhost:${PORT}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
});