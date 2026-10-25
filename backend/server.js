/*require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

const abi = require("./contractABI.json");

const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL
);

const wallet = new ethers.Wallet(
    process.env.PRIVATE_KEY,
    provider
);

const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    wallet
);


// ROOT
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Blockchain IoT API running"
    });
});


// GET DEVICE DETAILS
app.get("/device/:id", async (req, res) => {
    try {
        const deviceId = req.params.id;

        const device = await contract.devices(deviceId);

        res.json({
            success: true,
            deviceId: device[0],
            trustScore: Number(device[1]),
            compromised: device[2]
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// REGISTER DEVICE
app.post("/register-device", async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: "deviceId is required"
            });
        }

        const tx = await contract.registerDevice(deviceId);

        await tx.wait();

        res.json({
            success: true,
            message: "Device registered",
            transactionHash: tx.hash
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// UPDATE TRUST SCORE
app.post("/update-trust", async (req, res) => {
    try {
        const { deviceId, trustScore } = req.body;

        if (!deviceId || trustScore === undefined) {
            return res.status(400).json({
                success: false,
                error: "deviceId and trustScore are required"
            });
        }

        const score = Number(trustScore);

        if (
            !Number.isInteger(score) ||
            score < 0 ||
            score > 100
        ) {
            return res.status(400).json({
                success: false,
                error: "trustScore must be an integer between 0 and 100"
            });
        }

        const tx = await contract.updateTrustScore(
            deviceId,
            score
        );

        await tx.wait();

        res.json({
            success: true,
            message: "Trust score updated",
            transactionHash: tx.hash
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// MARK DEVICE COMPROMISED
app.post("/mark-compromised", async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: "deviceId is required"
            });
        }

        const tx = await contract.markCompromised(
            deviceId
        );

        await tx.wait();

        res.json({
            success: true,
            message: "Device marked compromised",
            transactionHash: tx.hash
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ADD INCIDENT
app.post("/add-incident", async (req, res) => {
    try {
        const {
            deviceId,
            bugType,
            description,
            recovery
        } = req.body;

        if (
            !deviceId ||
            !bugType ||
            !description ||
            !recovery
        ) {
            return res.status(400).json({
                success: false,
                error: "deviceId, bugType, description and recovery are required"
            });
        }

        const tx = await contract.addIncident(
            deviceId,
            bugType,
            description,
            recovery
        );

        await tx.wait();

        res.json({
            success: true,
            message: "Incident stored",
            transactionHash: tx.hash
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// INCIDENT HISTORY
app.get("/history/:id", async (req, res) => {
    try {
        const deviceId = req.params.id;

        const count = await contract.getIncidentCount(
            deviceId
        );

        const incidentCount = Number(count);

        const history = [];

        for (let i = 0; i < incidentCount; i++) {
            const data = await contract.incidents(
                deviceId,
                i
            );

            history.push({
                index: i,
                bugType: data[0],
                description: data[1],
                recovery: data[2],
                timestamp: Number(data[3])
            });
        }

        res.json({
            success: true,
            deviceId: deviceId,
            incidentCount: incidentCount,
            history: history
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get("/devices", (req, res) => {
  res.json({
    devices: [
      {
        id: "sensor_01",
        location: "North Atrium",
        trustScore: 96,
        compromised: false,
        lastIncident: null,
        history: [{ score: 90 }, { score: 94 }, { score: 96 }]
      },
      {
        id: "sensor_02",
        location: "Thermal Lab",
        trustScore: 48,
        compromised: false,
        lastIncident: "High temperature",
        history: [{ score: 90 }, { score: 78 }, { score: 61 }, { score: 48 }]
      }
    ]
  });
});


// START SERVER
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});*/

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const abi = require("./contractABI.json");

if (
  !process.env.RPC_URL ||
  !process.env.PRIVATE_KEY ||
  !process.env.CONTRACT_ADDRESS
) {
  throw new Error(
    "Missing RPC_URL, PRIVATE_KEY, or CONTRACT_ADDRESS in backend/.env"
  );
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  abi,
  wallet
);

// The contract's mapping cannot list every device by itself.
// Keep known IDs here through DEVICE_IDS in .env; newly registered
// devices are also kept while this backend process is running.
// Device IDs are stored permanently on the Sepolia contract.
// The Set is only used as a temporary cache for newly registered devices.
const deviceIds = new Set();

async function loadDeviceIds() {
  const onChainIds = await contract.getDeviceIds();

  deviceIds.clear();

  for (const deviceId of onChainIds) {
    deviceIds.add(deviceId);
  }

  console.log("Loaded devices from Sepolia:", [...deviceIds]);
}

const locations = {
  sensor_01: "North Atrium",
  sensor_02: "Thermal Lab",
  sensor_03: "West Gateway",
  sensor_04: "Storage Bay",
  sensor_05: "Assembly Line",
  sensor_06: "Loading Dock"
};

function locationFor(deviceId) {
  return locations[deviceId] || "On-chain device";
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
  const device = await contract.devices(deviceId);
  const trustScore = Number(device[1]);
  const compromised = Boolean(device[2]);
  const incidents = await getHistory(deviceId);
  const latestIncident = incidents.at(-1);

  return {
    id: deviceId,
    location: locationFor(deviceId),
    trustScore,
    compromised,
    lastIncident: latestIncident?.bugType || null,

    // Your current contract does not store trust-score history.
    // This keeps the frontend chart usable until that is added on-chain.
    history: [{ score: trustScore }]
  };
}

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Blockchain IoT API running",
    network: "Sepolia"
  });
});

// GET ALL KNOWN DEVICES
app.get("/devices", async (req, res) => {
  try {
    await loadDeviceIds();

    const devices = await Promise.all(
      [...deviceIds].map((deviceId) => getDeviceSummary(deviceId))
    );

    res.json({
      success: true,
      devices
    });
  } catch (error) {
    console.error("GET /devices error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET ONE DEVICE
app.get("/device/:id", async (req, res) => {
  try {
    const deviceId = req.params.id;
    const device = await getDeviceSummary(deviceId);

    res.json({ success: true, ...device });
  } catch (error) {
    console.error("GET /device/:id error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// REGISTER DEVICE ON SEPOLIA
app.post("/register-device", async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required"
      });
    }

    const tx = await contract.registerDevice(deviceId);
    await tx.wait();

    deviceIds.add(deviceId);

    res.status(201).json({
      success: true,
      message: "Device registered on Sepolia",
      transactionHash: tx.hash,
      device: {
        id: deviceId,
        location: locationFor(deviceId),
        trustScore: 100,
        compromised: false,
        lastIncident: null,
        history: [{ score: 100 }]
      }
    });
  } catch (error) {
    console.error("POST /register-device error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// UPDATE TRUST SCORE ON SEPOLIA
app.post("/update-trust", async (req, res) => {
  try {
    const { deviceId, trustScore } = req.body;
    const score = Number(trustScore);

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
    console.error("POST /update-trust error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// MARK DEVICE COMPROMISED ON SEPOLIA
app.post("/mark-compromised", async (req, res) => {
  try {
    const { deviceId } = req.body;

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
    console.error("POST /mark-compromised error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ADD INCIDENT ON SEPOLIA
app.post("/add-incident", async (req, res) => {
  try {
    const { deviceId, bugType, description, recovery } = req.body;

    if (!deviceId || !bugType || !description || !recovery) {
      return res.status(400).json({
        success: false,
        error: "deviceId, bugType, description and recovery are required"
      });
    }

    const tx = await contract.addIncident(
      deviceId,
      bugType,
      description,
      recovery
    );

    await tx.wait();

    res.status(201).json({
      success: true,
      message: "Incident stored on Sepolia",
      transactionHash: tx.hash
    });
  } catch (error) {
    console.error("POST /add-incident error:", error);
    res.status(500).json({ success: false, error: error.message });
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
    console.error("GET /history/:id error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET ALL INCIDENTS FROM KNOWN DEVICES
app.get("/incidents", async (req, res) => {
  try {
    const incidentGroups = await Promise.all(
      [...deviceIds].map(async (deviceId) => {
        const history = await getHistory(deviceId);

        return history.map((incident) => ({
          id: `${deviceId}-${incident.index}`,
          deviceId,
          issue: incident.bugType,
          status: "Recovered",
          timestamp: new Date(incident.timestamp * 1000).toLocaleString(),
          description: incident.description,
          recovery: incident.recovery,
          historicalMatch: true,
          confidence: 100,
          transactionHash: null
        }));
      })
    );

    res.json({
      success: true,
      incidents: incidentGroups.flat()
    });
  } catch (error) {
    console.error("GET /incidents error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// BLOCKCHAIN STATUS
app.get("/blockchain-status", async (req, res) => {
  try {
    const network = await provider.getNetwork();

    res.json({
      connected: true,
      network: network.chainId === 11155111n ? "Sepolia" : network.name,
      contract: "IoTTrust",
      contractAddress: process.env.CONTRACT_ADDRESS,
      storedDevices: deviceIds.size,
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