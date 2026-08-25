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

// Map the old format to the new monitor format
const serverConfigs = rawServers.map(s => ({
  id: `acl${s.id}`,
  name: `ACL ${s.id} (${s.track || 'Unknown'})`,
  region: 'Unknown (Check IP)',
  machineIp: s.host,
  ftp: {
    host: s.host,
    port: s.port,
    user: s.user,
    password: s.password
  }
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

  channel.send({ embeds: [embed] });
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
  channel.send({ content: '@here', embeds: [embed] });
});

// Simple command to check status
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!status') {
    message.reply(`📡 Currently monitoring ${serverConfigs.length} servers across Germany, US East, and Australia.`);
  }
});

if (!TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is missing in the .env file.");
  process.exit(1);
}

client.login(TOKEN);
