import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Initialize the Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Bot token from environment variables
const TOKEN = process.env.DISCORD_TOKEN;

// Hardcoded or environment variable for the server to monitor
const SERVER_IP = process.env.SERVER_IP || '127.0.0.1';
const SERVER_PORT = process.env.SERVER_PORT || '9000';

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  console.log(`🔍 Monitoring ACL Server on ${SERVER_IP}:${SERVER_PORT}`);
  
  // Set the bot's activity status
  client.user.setActivity('ACL Server Status', { type: 'WATCHING' });
});

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Simple command to check server status
  if (message.content.toLowerCase() === '!status') {
    try {
      // Placeholder for your actual server querying logic
      // e.g., fetching a JSON status from an API or querying with a game server protocol
      // const response = await axios.get(`http://${SERVER_IP}:${SERVER_PORT}/api/status`);
      
      message.reply(`📡 Checking status for ${SERVER_IP}... (Placeholder: Server is ONLINE)`);
    } catch (error) {
      console.error('Error fetching server status:', error);
      message.reply('❌ Could not connect to the ACL server. It might be offline.');
    }
  }
});

// Start the bot
if (!TOKEN) {
  console.error("❌ ERROR: DISCORD_TOKEN is missing in the .env file.");
  process.exit(1);
}

client.login(TOKEN);
