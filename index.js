import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { ServerManager } from './src/ServerManager.js';

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const TOKEN = process.env.DISCORD_TOKEN;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID || '';

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
          completed: { total: 0, qualifying: 0, race: 0, practice: 0 }
        };
      } else if (value.sessions) { // Migrate from v1 object format
        serverStats[key] = {
          crashes: { total: value.total || 0, qualifying: value.sessions.qualifying || 0, race: value.sessions.race || 0, practice: value.sessions.practice || 0, unknown: value.sessions.unknown || 0 },
          completed: { total: 0, qualifying: 0, race: 0, practice: 0 }
        };
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

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  client.user.setActivity(`${serverConfigs.length} ACL Servers`, { type: 'WATCHING' });

  // Start the background monitoring process
  manager.start();
});

// Send an alert when a Single Server mass disconnects
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
      completed: { total: 0, qualifying: 0, race: 0, practice: 0 }
    };
  }
  
  serverStats[id].crashes.total++;
  serverStats[id].crashes[sessionKey] = (serverStats[id].crashes[sessionKey] || 0) + 1;
  data.server.hasCrashedThisSession = true;
  saveStats();

  if (!ALERT_CHANNEL_ID) return;

  const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🚨 Server Disconnect Alert')
    .setColor(0xFF0000)
    .addFields(
      { name: 'Server', value: data.server.name, inline: true },
      { name: 'Region', value: data.server.region, inline: true },
      { name: 'Machine IP', value: data.server.machineIp, inline: false },
      { name: 'Drivers Dropped', value: `${data.dropCount} within 30s`, inline: true },
      { name: 'Session', value: data.session || 'Unknown', inline: true }
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Failed to send Discord alert. Check bot permissions in that channel:', err.message);
  }
});

// Session started or Server Reset: Reset the crash flag
manager.on('session_started', (data) => {
  data.server.hasCrashedThisSession = false;
});

// Session completed naturally
manager.on('session_completed', (data) => {
  const id = data.server.id;
  const sessionString = (data.sessionType || 'unknown').toLowerCase();
  
  let sessionKey = 'unknown';
  if (sessionString === 'qualifying') sessionKey = 'qualifying';
  else if (sessionString === 'race') sessionKey = 'race';
  else if (sessionString === 'practice') sessionKey = 'practice';

  // Only tally if it didn't crash this session
  if (!data.server.hasCrashedThisSession && sessionKey !== 'unknown') {
    if (!serverStats[id]) {
      serverStats[id] = { 
        crashes: { total: 0, qualifying: 0, race: 0, practice: 0, unknown: 0 },
        completed: { total: 0, qualifying: 0, race: 0, practice: 0 }
      };
    }
    
    serverStats[id].completed.total++;
    serverStats[id].completed[sessionKey]++;
    saveStats();
  }
  
  // Reset flag for the next session
  data.server.hasCrashedThisSession = false;
});

// Send an alert when a Machine-level mass disconnect occurs (Multiple servers on same IP)
manager.on('mass_disconnect_machine', async (data) => {
  console.log(`[ALERT] MACHINE LEVEL DISCONNECT on ${data.machineIp}`);
  if (!ALERT_CHANNEL_ID) return;

  const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🛑 CRITICAL: Machine Level Disconnect')
    .setColor(0x8B0000)
    .setDescription(`Multiple servers hosted on the same physical machine just dropped simultaneously.`)
    .addFields(
      { name: 'Machine IP', value: data.machineIp, inline: true },
      { name: 'Region', value: data.region, inline: true },
      { name: 'Servers Affected', value: `${data.serversAffected}`, inline: true },
      { name: 'Total Drivers Dropped', value: `${data.dropCount} within 30s`, inline: true }
    )
    .setTimestamp();

  // You can ping a specific role by adding `<@&ROLE_ID>` to the message content
  try {
    await channel.send({ content: '@here', embeds: [embed] });
  } catch (err) {
    console.error('❌ Failed to send Discord alert. Check bot permissions in that channel:', err.message);
  }
});

// Send an alert when an FTP server goes offline entirely
manager.on('ftp_offline', async (data) => {
  console.log(`[ALERT] FTP OFFLINE on ${data.server.name}`);
  if (!ALERT_CHANNEL_ID) return;

  const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('⚠️ FTP Server Offline Alert')
    .setColor(0xFFA500) // Orange
    .setDescription(`Failed to connect to the FTP server after 3 attempts.`)
    .addFields(
      { name: 'Server', value: data.server.name, inline: true },
      { name: 'Region', value: data.server.region, inline: true },
      { name: 'Machine IP', value: data.server.machineIp, inline: false },
      { name: 'Error', value: data.error, inline: false }
    )
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Failed to send Discord alert. Check bot permissions in that channel:', err.message);
  }
});

// Simple command to check status
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!status') {
    message.reply(`📡 Currently monitoring ${serverConfigs.length} servers across Germany, US East, and Australia.`);
  }

  if (message.content.toLowerCase() === '!players') {
    const active = [];
    let emptyCount = 0;

    for (const [id, monitor] of manager.monitors.entries()) {
      const drivers = monitor.analyzer.connectedDrivers || 0;
      if (drivers > 0) {
        active.push(`- **${monitor.ftp.config.name}**: ${drivers} players`);
      } else {
        emptyCount++;
      }
    }

      const embed = new EmbedBuilder()
      .setTitle('📊 Current Server Population')
      .setColor(0x00FF00)
      .setDescription(active.length > 0 ? active.join('\n') : 'All servers are currently empty.')
      .setFooter({ text: `${emptyCount} servers are currently empty.` });

    message.reply({ embeds: [embed] });
  }

  if (message.content.toLowerCase() === '!disconnects' || message.content.toLowerCase() === '!crashes') {
    const leaderboard = Object.entries(serverStats)
      .sort((a, b) => b[1].crashes.total - a[1].crashes.total) // Sort descending by total crashes
      .map(([id, stats]) => {
        const config = serverConfigs.find(s => s.id === id);
        const name = config ? config.name : id;
        
        let crashBreakdown = [];
        if (stats.crashes.race > 0) crashBreakdown.push(`${stats.crashes.race} Race`);
        if (stats.crashes.qualifying > 0) crashBreakdown.push(`${stats.crashes.qualifying} Quali`);
        if (stats.crashes.practice > 0) crashBreakdown.push(`${stats.crashes.practice} Prac`);
        if (stats.crashes.unknown > 0) crashBreakdown.push(`${stats.crashes.unknown} Unk`);
        
        const crashStr = crashBreakdown.length > 0 ? ` (${crashBreakdown.join(', ')})` : '';
        return `- **${name}**: ${stats.crashes.total} Crashes${crashStr}`;
      });
      
    const embed = new EmbedBuilder()
      .setTitle('📈 Server Disconnect Tally')
      .setColor(0xFF0000)
      .setDescription(leaderboard.length > 0 ? leaderboard.join('\n') : 'No mass disconnects recorded yet! 🎉')
      
    message.reply({ embeds: [embed] });
  }

  if (message.content.toLowerCase() === '!completed' || message.content.toLowerCase() === '!reliability') {
    const leaderboard = Object.entries(serverStats)
      .sort((a, b) => b[1].completed.total - a[1].completed.total) // Sort descending by total completed
      .map(([id, stats]) => {
        const config = serverConfigs.find(s => s.id === id);
        const name = config ? config.name : id;
        
        let breakdowns = [];
        if (stats.completed.race > 0 || stats.crashes.race > 0) {
            breakdowns.push(`Race: ${stats.crashes.race} Crashed / ${stats.completed.race} Completed`);
        }
        if (stats.completed.qualifying > 0 || stats.crashes.qualifying > 0) {
            breakdowns.push(`Quali: ${stats.crashes.qualifying} Crashed / ${stats.completed.qualifying} Completed`);
        }
        if (stats.completed.practice > 0 || stats.crashes.practice > 0) {
            breakdowns.push(`Prac: ${stats.crashes.practice} Crashed / ${stats.completed.practice} Completed`);
        }
        if (stats.crashes.unknown > 0) {
            breakdowns.push(`Unknown: ${stats.crashes.unknown} Crashed`);
        }
        
        return `- **${name}**: ${breakdowns.join(' | ')}`;
      });
      
    const embed = new EmbedBuilder()
      .setTitle('✅ Server Reliability Tally')
      .setColor(0x00FF00)
      .setDescription(leaderboard.length > 0 ? leaderboard.join('\n') : 'No successful sessions recorded yet! 🏁')
      
    message.reply({ embeds: [embed] });
  }

  if (message.content.toLowerCase().startsWith('!addcrash')) {
    const args = message.content.toLowerCase().split(' ');
    // Format: !addcrash acl82 2 [session]
    if (args.length >= 3) {
      const serverId = args[1]; // e.g. "acl82"
      const count = parseInt(args[2], 10);
      const sessionArg = args[3] || 'unknown';
      let sessionKey = 'unknown';
      if (sessionArg.startsWith('q')) sessionKey = 'qualifying';
      else if (sessionArg.startsWith('r')) sessionKey = 'race';
      else if (sessionArg.startsWith('p')) sessionKey = 'practice';

      if (!isNaN(count)) {
        if (!serverStats[serverId]) {
           serverStats[serverId] = { 
             crashes: { total: 0, qualifying: 0, race: 0, practice: 0, unknown: 0 },
             completed: { total: 0, qualifying: 0, race: 0, practice: 0 }
           };
        }
        serverStats[serverId].crashes.total += count;
        serverStats[serverId].crashes[sessionKey] = (serverStats[serverId].crashes[sessionKey] || 0) + count;
        saveStats();
        message.reply(`✅ Added ${count} crashes to ${serverId} under ${sessionKey}. It now has ${serverStats[serverId].crashes.total} total crashes.`);
      }
    }
  }
});

import http from 'http';

if (!TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is missing in the .env file.");
  process.exit(1);
}

client.login(TOKEN);

// Add a dummy HTTP server to satisfy Railway's port binding health check
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ACL Server Monitor Bot is running!\n');
}).listen(PORT, () => {
  console.log(`🌐 Dummy web server listening on port ${PORT} for Railway health checks.`);
});
