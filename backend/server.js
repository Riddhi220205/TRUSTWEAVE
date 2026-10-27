require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const abi = require("./contractABI.json");

const SEPOLIA_CHAIN_ID = 11155111;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15000);

const requiredEnv = ["RPC_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

// Do NOT crash on missing config: a crashed service returns opaque proxy errors
// (and no CORS headers), which the browser reports as a generic failure.
// Instead the server stays up and every blockchain route explains what is missing.
let provider = null;
let wallet = null;
let readContract = null;   // reads: bound to the provider
let writeContract = null;  // writes: bound to the signer
let configError = null;

if (missingEnv.length) {
  configError = `Missing ${missingEnv.join(", ")}. Set them in backend/.env (local) or the Render Environment tab.`;
  console.error(configError);
} else {
  try {
    // staticNetwork skips the repeated eth_chainId detection calls (a common
    // source of "failed to detect network" 500s); batchMaxCount: 1 avoids
    // provider-side batch limits on free RPC plans.
    provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL.trim(),
      ethers.Network.from(SEPOLIA_CHAIN_ID),
      { staticNetwork: ethers.Network.from(SEPOLIA_CHAIN_ID), batchMaxCount: 1 }
    );
    const pk = process.env.PRIVATE_KEY.trim();
    wallet = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
    // Lower-casing first accepts addresses pasted with wrong checksum casing.
    const address = ethers.getAddress(process.env.CONTRACT_ADDRESS.trim().toLowerCase());
    readContract = new ethers.Contract(address, abi, provider);
    writeContract = new ethers.Contract(address, abi, wallet);
  } catch (error) {
    configError = `Invalid configuration: ${error.message}`;
    console.error(configError);
  }
}

function requireChain(res) {
  if (configError) {
    res.status(503).json({ success: false, error: configError });
    return false;
  }
  return true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry transient RPC failures (rate limits, timeouts, dropped connections).
async function withRetry(fn, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // ethers hides RPC rate limits (HTTP/JSON-RPC 429) behind CALL_EXCEPTION
      // "missing revert data" with data === null, so inspect the underlying RPC error too.
      const rpcError = error.info?.error || error.error || {};
      const text = [
        error.code,
        error.shortMessage,
        error.message,
        rpcError.code,
        rpcError.message,
        error.info?.responseStatus
      ].join(" ");
      const emptyRevert = error.code === "CALL_EXCEPTION" && error.data == null && !error.revert;
      const transient = emptyRevert || /429|rate|limit|capacity|exceeded|timeout|TIMEOUT|SERVER_ERROR|NETWORK_ERROR|ECONN|ETIMEDOUT|socket|fetch failed|BAD_DATA|missing response|503|502|504/i.test(text);
      if (!transient || attempt === attempts - 1) break;
      await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

// Small TTL cache with in-flight de-duplication, plus "stale on error":
// if the RPC is down we still serve the last good blockchain data.
const cache = new Map();
async function cached(key, loader) {
  const entry = cache.get(key);
  const now = Date.now();
  if (entry?.value !== undefined && now - entry.time < CACHE_TTL_MS) return entry.value;
  if (entry?.promise) return entry.promise;

  const promise = loader()
    .then((value) => {
      cache.set(key, { value, time: Date.now() });
      return value;
    })
    .catch((error) => {
      if (entry?.value !== undefined) {
        console.warn(`Serving stale cache for ${key}: ${error.message}`);
        cache.set(key, { value: entry.value, time: entry.time });
        return entry.value;
      }
      cache.delete(key);
      throw error;
    });
  cache.set(key, { ...(entry || {}), promise });
  return promise;
}
const invalidateCache = () => cache.clear();

// Writes share one signer, so they must be sent one at a time (nonce ordering).
let writeQueue = Promise.resolve();
function sendTx(method, ...args) {
  const run = writeQueue.then(async () => {
    const tx = await writeContract[method](...args);
    await tx.wait();
    invalidateCache();
    return tx;
  });
  writeQueue = run.catch(() => {});
  return run;
}

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
  if (!readContract.interface.getFunction("getDeviceIds")) {
    throw new Error(
      "The backend ABI is missing getDeviceIds(). Copy the current IoTTrust ABI from blockchain/artifacts/contracts/IoTTrust.sol/IoTTrust.json into backend/contractABI.json, then restart the backend."
    );
  }

  return cached("deviceIds", async () => {
    const onChainIds = await withRetry(() => readContract.getDeviceIds());
    deviceIds.clear();
    for (const id of onChainIds) deviceIds.add(id);
    return [...deviceIds];
  });
}

async function getHistory(deviceId) {
  return cached(`history:${deviceId}`, async () => {
    const count = Number(await withRetry(() => readContract.getIncidentCount(deviceId)));
    const indexes = Array.from({ length: count }, (_, index) => index);

    return mapWithConcurrency(indexes, 3, async (index) => {
      const incident = await withRetry(() => readContract.incidents(deviceId, index));
      return {
        index,
        bugType: incident[0],
        description: incident[1],
        recovery: incident[2],
        timestamp: Number(incident[3])
      };
    });
  });
}

async function getDeviceSummary(deviceId) {
  return cached(`device:${deviceId}`, async () => {
    const [registered, device, history] = await Promise.all([
      withRetry(() => readContract.deviceExists(deviceId)),
      withRetry(() => readContract.devices(deviceId)),
      getHistory(deviceId)
    ]);

    if (!registered) {
      const error = new Error(`Device "${deviceId}" is not registered on the contract`);
      error.statusCode = 404;
      throw error;
    }

    const trustScore = Number(device[1]);
    const compromised = Boolean(device[2]);
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
      // Trust-score trend: the contract stores only the current score, so the
      // chart shows the current value. (Extend with TrustUpdated events later.)
      history: [{ score: trustScore }],
      incidentHistory: history
    };
  });
}

function sendError(res, error, route) {
  console.error(`${route} error:`, error);
  const status = error.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error.shortMessage || error.message || "Internal server error"
  });
}

// HEALTH CHECK (does not touch the RPC, so Render health checks never fail on it)
app.get("/", (req, res) => {
  res.json({
    success: !configError,
    message: "Blockchain IoT API running",
    network: "Sepolia",
    configured: !configError,
    ...(configError ? { error: configError } : {})
  });
});

app.get("/health", async (req, res) => {
  if (!requireChain(res)) return;
  try {
    const block = await withRetry(() => provider.getBlockNumber());
    const code = await withRetry(() => provider.getCode(readContract.target));
    res.json({
      success: true,
      rpc: "ok",
      blockNumber: block,
      contractDeployed: code !== "0x",
      signer: wallet.address
    });
  } catch (error) {
    sendError(res, error, "GET /health");
  }
});

// GET ALL REGISTERED DEVICES FROM SEPOLIA
app.get("/devices", async (req, res) => {
  if (!requireChain(res)) return;
  try {
    const ids = await loadDeviceIds();

    const devices = await mapWithConcurrency(
      ids,
      3,
      async (id) => getDeviceSummary(id)
    );

    res.json({ success: true, devices });
  } catch (error) {
    sendError(res, error, "GET /devices");
  }
});
// GET ONE DEVICE
app.get("/device/:id", async (req, res) => {
  if (!requireChain(res)) return;
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
  if (!requireChain(res)) return;
  try {
    const deviceId = String(req.body?.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required"
      });
    }

    if (await withRetry(() => readContract.deviceExists(deviceId))) {
      return res.status(409).json({
        success: false,
        error: `Device "${deviceId}" is already registered`
      });
    }

    const tx = await sendTx("registerDevice", deviceId);
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
  if (!requireChain(res)) return;
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const score = Number(req.body?.trustScore);

    if (!deviceId || !Number.isInteger(score) || score < 0 || score > 100) {
      return res.status(400).json({
        success: false,
        error: "deviceId and an integer trustScore from 0 to 100 are required"
      });
    }

    const tx = await sendTx("updateTrustScore", deviceId, score);

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
  if (!requireChain(res)) return;
  try {
    const deviceId = String(req.body?.deviceId || "").trim();

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required"
      });
    }

    const tx = await sendTx("markCompromised", deviceId);

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
  if (!requireChain(res)) return;
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

    const tx = await sendTx("addIncident", deviceId, bugType, description, recovery);

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
  if (!requireChain(res)) return;
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
  if (!requireChain(res)) return;
  try {
    const ids = await loadDeviceIds();

    const groups = await mapWithConcurrency(
      ids,
      3,
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
  if (!requireChain(res)) return;
  try {
    const ids = await loadDeviceIds();
    const incidentCounts = await mapWithConcurrency(
      ids,
      3,
      async (id) => Number(await withRetry(() => readContract.getIncidentCount(id)))
    );
    const storedIncidents = incidentCounts.reduce((sum, count) => sum + count, 0);

    res.json({
      connected: true,
      network: "Sepolia",
      contract: "IoTTrust",
      contractAddress: readContract.target,
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

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
  if (configError) console.error(`CONFIG PROBLEM: ${configError}`);
});