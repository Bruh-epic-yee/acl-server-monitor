import dotenv from 'dotenv';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { ServerManager } from './src/ServerManager.js';

dotenv.config();

// Load the server configurations
let rawServers = [];
try {
  rawServers = JSON.parse(fs.readFileSync('./servers.json', 'utf-8'));
} catch (e) {
  console.error("❌ Failed to load servers.json. Please ensure it exists and is valid JSON.");
  process.exit(1);
}

// Load persistent stats for disconnect tallies
const STATS_FILE = './data/stats.json';
let serverStats = {};
try {
  if (fs.existsSync(STATS_FILE)) {
    serverStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    // Migrate old format if needed
    for (const [key, value] of Object.entries(serverStats)) {
      if (typeof value === 'number') {
        serverStats[key] = {
          crashes: { total: value, qualifying: 0, race: 0, practice: 0, unknown: value },
          completed: { total: 0, qualifying: 0, race: 0, practice: 0 },
          history: []
        };
      } else if (value.sessions) { // Migrate from v1 object format
        serverStats[key] = {
          crashes: { total: value.total || 0, qualifying: value.sessions.qualifying || 0, race: value.sessions.race || 0, practice: value.sessions.practice || 0, unknown: value.sessions.unknown || 0 },
          completed: { total: 0, qualifying: 0, race: 0, practice: 0 },
          history: []
        };
      } else if (!value.history) {
        value.history = [];
      }
    }
  }
} catch (e) {
  console.error("⚠️ Failed to load stats file, starting fresh.");
}

function saveStats() {
  try {
    if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(serverStats, null, 2));
  } catch (e) {
    console.error("⚠️ Failed to save stats file:", e.message);
  }
}

// Map the old format to the new monitor format
const serverConfigs = rawServers.map(s => ({
  id: `acl${s.id}`,
  name: `ACL ${s.id} (${s.track || 'Unknown'})`,
  region: s.region || 'Unknown (Check IP)',
  machineIp: s.host,
  ftp: {
    host: s.host,
    port: s.port,
    user: s.user,
    password: s.password
  },
  hasCrashedThisSession: false
}));

const manager = new ServerManager(serverConfigs);

// Save stats when a crash happens (silently, without Discord alerts)
manager.on('mass_disconnect_server', async (data) => {
  console.log(`[ALERT] Mass disconnect on ${data.server.name}`);
  const id = data.server.id;
  const sessionString = (data.session || 'unknown').toLowerCase();
  let sessionKey = 'unknown';
  if (sessionString.startsWith('q')) sessionKey = 'qualifying';
  else if (sessionString.startsWith('r')) sessionKey = 'race';
  else if (sessionString.startsWith('p')) sessionKey = 'practice';

  if (!serverStats[id]) {
    serverStats[id] = { 
      crashes: { total: 0, qualifying: 0, race: 0, practice: 0, unknown: 0 },
      completed: { total: 0, qualifying: 0, race: 0, practice: 0 },
      history: []
    };
  }
  
  serverStats[id].crashes.total++;
  serverStats[id].crashes[sessionKey] = (serverStats[id].crashes[sessionKey] || 0) + 1;
  serverStats[id].history.push({
    type: 'crash',
    session: sessionKey,
    timestamp: new Date().toISOString()
  });
  data.server.hasCrashedThisSession = true;
  saveStats();
});

manager.on('session_started', (data) => {
  data.server.hasCrashedThisSession = false;
});

manager.on('session_completed', (data) => {
  const id = data.server.id;
  const sessionString = (data.sessionType || 'unknown').toLowerCase();
  let sessionKey = 'unknown';
  if (sessionString === 'qualifying') sessionKey = 'qualifying';
  else if (sessionString === 'race') sessionKey = 'race';
  else if (sessionString === 'practice') sessionKey = 'practice';

  if (!data.server.hasCrashedThisSession && sessionKey !== 'unknown') {
    if (!serverStats[id]) {
      serverStats[id] = { 
        crashes: { total: 0, qualifying: 0, race: 0, practice: 0, unknown: 0 },
        completed: { total: 0, qualifying: 0, race: 0, practice: 0 },
        history: []
      };
    }
    serverStats[id].completed.total++;
    serverStats[id].completed[sessionKey]++;
    saveStats();
  }
  data.server.hasCrashedThisSession = false;
});

// Start the background monitoring process
manager.start();

// Start Express Web Dashboard
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.resolve(process.cwd(), 'public')));

function getDateBounds(req) {
  let sinceDate, endDate = null;
  
  if (req.query.startDate) {
    sinceDate = req.query.startDate;
    if (req.query.endDate) {
      endDate = req.query.endDate;
    }
  } else {
    // Fallback logic for All Time or defaults
    const tf = (req.query.timeframe || 'weekly').toLowerCase();
    if (tf === 'all-time') {
      sinceDate = new Date(0).toISOString();
    } else {
      // Default to last 7 days
      sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
  }
  return { sinceDate, endDate };
}

app.get('/api/reports', async (req, res) => {
  try {
    const { sinceDate, endDate } = getDateBounds(req);
    const reason = req.query.reason || null;
    const results = await manager.reportManager.getLeaderboard(sinceDate, endDate, reason);
    res.json(results);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/api/reporters', async (req, res) => {
  try {
    const { sinceDate, endDate } = getDateBounds(req);
    const reason = req.query.reason || null;
    const results = await manager.reportManager.getReporters(sinceDate, endDate, reason);
    res.json(results);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/api/retaliations', async (req, res) => {
  try {
    const { sinceDate, endDate } = getDateBounds(req);
    const reason = req.query.reason || null;
    const results = await manager.reportManager.getRetaliations(sinceDate, endDate, reason);
    res.json(results);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/api/heatmaps', async (req, res) => {
  try {
    const { sinceDate, endDate } = getDateBounds(req);
    const reason = req.query.reason || null;
    
    const results = await manager.reportManager.getHeatmap(sinceDate, endDate, reason);
    
    // Attach the track name to each server result
    const enrichedResults = results.map(r => {
      // Clean up server ID (e.g. acl82 -> ACL 82)
      let cleanServerId = r.server_id.toUpperCase();
      if (cleanServerId.startsWith('ACL') && cleanServerId.length > 3) {
        cleanServerId = `ACL ${cleanServerId.substring(3).trim()}`;
      }

      const config = serverConfigs.find(s => s.id === r.server_id || s.id.toLowerCase() === r.server_id.toLowerCase());
      
      // Try to get the LIVE track name directly from the active FTP monitor (event.json)
      let liveTrack = null;
      for (const [id, monitor] of manager.monitors.entries()) {
        if (id.toLowerCase() === r.server_id.toLowerCase() && monitor.ftp.config.liveTrack) {
          liveTrack = monitor.ftp.config.liveTrack;
          break;
        }
      }

      // If no live track, try to extract from config name (e.g. "ACL 42 (spa)")
      if (!liveTrack && config && config.name) {
        const match = config.name.match(/\((.*?)\)/);
        if (match) liveTrack = match[1];
      }

      return {
        ...r,
        server_name: cleanServerId,
        track: liveTrack || 'Unknown'
      };
    });
    
    res.json(enrichedResults);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Dashboard web server listening on port ${PORT}`);
  console.log(`✅ App started! View the dashboard at http://localhost:${PORT}`);
});
