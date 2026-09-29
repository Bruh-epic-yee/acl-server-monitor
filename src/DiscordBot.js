import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

export function startDiscordBot(manager, serverConfigs, serverStats, saveStats) {
  const TOKEN = process.env.DISCORD_TOKEN;
  const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID || '';

  if (!TOKEN) {
    console.log("⚠️ DISCORD_TOKEN is missing. Discord bot will not start.");
    return null;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    client.user.setActivity(`${serverConfigs.length} ACL Servers`, { type: 'WATCHING' });
  });

  // Send an alert when a Single Server mass disconnects
  manager.on('mass_disconnect_server', async (data) => {
    if (!ALERT_CHANNEL_ID) return;

    const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🚨 Server Disconnect Alert')
      .setColor(0xFF0000)
      .addFields(
        { name: 'Server', value: data.server.name ? data.server.name.split('|')[0].trim() : 'Unknown', inline: true },
        { name: 'Region', value: data.server.region, inline: true },
        { name: 'Machine IP', value: data.server.machineIp, inline: false },
        { name: 'Drivers Dropped', value: `${data.dropCount} within 30s`, inline: true },
        { name: 'Session', value: data.session || 'Unknown', inline: true }
      )
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('❌ Failed to send Discord alert. Check bot permissions:', err.message);
    }
  });

  // Send an alert when a Region-level mass disconnect occurs
  manager.on('mass_disconnect_region', async (data) => {
    if (!ALERT_CHANNEL_ID) return;

    const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('🚨 CRITICAL: Data Center Routing Outage')
      .setColor(0x8B0000)
      .setDescription(`Multiple physical machines in the **${data.region}** region just experienced simultaneous driver drops. This strongly indicates a regional data center outage!`)
      .addFields(
        { name: 'Region', value: data.region, inline: true },
        { name: 'Machines Affected', value: `${data.machinesAffected}`, inline: true },
        { name: 'Servers Affected', value: `${data.serversAffected}`, inline: true },
        { name: 'Total Drivers Dropped', value: `${data.dropCount} within 30s`, inline: true }
      )
      .setTimestamp();

    try {
      await channel.send({ content: '@here', embeds: [embed] });
    } catch (err) {
      console.error('❌ Failed to send Discord alert:', err.message);
    }
  });

  // Helper function for chunking embeds
  async function sendChunkedEmbeds(message, title, color, lines, emptyMsg) {
    if (lines.length === 0) {
      message.reply(emptyMsg);
      return;
    }
    
    const chunkSize = 25;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const embed = new EmbedBuilder()
        .setTitle(i === 0 ? title : `${title} (Cont.)`)
        .setColor(color)
        .setDescription(chunk.join('\n'));
        
      await message.reply({ embeds: [embed] });
    }
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!status') {
      message.reply(`📡 Currently monitoring ${serverConfigs.length} servers.`);
    }

    if (message.content.toLowerCase() === '!disconnects' || message.content.toLowerCase() === '!crashes') {
      const leaderboard = Object.entries(serverStats)
        .sort((a, b) => b[1].crashes.total - a[1].crashes.total)
        .filter(([, stats]) => stats.crashes.total > 0)
        .map(([id, stats]) => {
          const config = serverConfigs.find(s => s.id === id || s.id.toLowerCase() === id.toLowerCase());
          const name = config ? config.name : id;
          const region = config ? config.region : '';
          const emoji = region === 'EU' ? '🔴 ' : (region === 'US' ? '🔵 ' : '');
          
          let crashBreakdown = [];
          if (stats.crashes.race > 0) crashBreakdown.push(`${stats.crashes.race} Race`);
          if (stats.crashes.qualifying > 0) crashBreakdown.push(`${stats.crashes.qualifying} Quali`);
          if (stats.crashes.practice > 0) crashBreakdown.push(`${stats.crashes.practice} Prac`);
          if (stats.crashes.unknown > 0) crashBreakdown.push(`${stats.crashes.unknown} Unk`);
          
          const now = Date.now();
          const dailyCrashes = (stats.history || []).filter(e => e.type === 'crash' && (now - new Date(e.timestamp).getTime()) <= 24 * 60 * 60 * 1000).length;
          const dailyStr = dailyCrashes > 0 ? ` **(${dailyCrashes} Today)**` : ' **(0 Today)**';
          
          const crashStr = crashBreakdown.length > 0 ? ` (${crashBreakdown.join(', ')})` : '';
          return `- ${emoji}**${name}**: ${stats.crashes.total} Crashes${dailyStr}${crashStr}`;
        });
        
      await sendChunkedEmbeds(message, '📈 Server Disconnect Tally', 0xFF0000, leaderboard, 'No mass disconnects recorded yet! 🎉');
    }

    if (message.content.toLowerCase() === '!completed' || message.content.toLowerCase() === '!reliability') {
      const leaderboard = Object.entries(serverStats)
        .sort((a, b) => b[1].completed.race - a[1].completed.race)
        .map(([id, stats]) => {
          const config = serverConfigs.find(s => s.id === id || s.id.toLowerCase() === id.toLowerCase());
          const name = config ? config.name : id;
          const region = config ? config.region : '';
          const emoji = region === 'EU' ? '🔴 ' : (region === 'US' ? '🔵 ' : '');
          
          return `- ${emoji}**${name}**: ${stats.crashes.total} Crashes / ${stats.completed.race} Completed Races`;
        });
        
      await sendChunkedEmbeds(message, '✅ Server Reliability Tally', 0x00FF00, leaderboard, 'No successful races recorded yet! 🏁');
    }

    if (message.content.toLowerCase().startsWith('!history')) {
      const args = message.content.toLowerCase().split(' ');
      if (args.length >= 2) {
        const serverId = args[1];
        const stats = serverStats[serverId];
        
        if (!stats || !stats.history || stats.history.length === 0) {
          message.reply(`No crash history recorded for ${serverId} yet.`);
          return;
        }
        
        const config = serverConfigs.find(s => s.id === serverId || s.id.toLowerCase() === serverId.toLowerCase());
        const name = config ? config.name : serverId;
        
        const recentHistory = stats.history.slice(-100).reverse();
        const historyLines = recentHistory.map(entry => {
          const time = new Date(entry.timestamp).toLocaleString('en-GB', { timeZone: 'Europe/London' });
          return `- **${time}**: ${entry.type} during ${entry.session}`;
        });
        
        await sendChunkedEmbeds(message, `🕒 Crash History: ${name}`, 0x3498DB, historyLines, '');
      }
    }
    
    if (message.content.toLowerCase().startsWith('!addcrash')) {
      const args = message.content.toLowerCase().split(' ');
      if (args.length >= 3) {
        const serverId = args[1];
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
               completed: { total: 0, qualifying: 0, race: 0, practice: 0 },
               history: []
             };
          }
          serverStats[serverId].crashes.total += count;
          serverStats[serverId].crashes[sessionKey] = (serverStats[serverId].crashes[sessionKey] || 0) + count;
          
          for (let i = 0; i < count; i++) {
            serverStats[serverId].history.push({
              type: 'crash (manual addition)',
              session: sessionKey,
              timestamp: new Date().toISOString()
            });
          }
          
          saveStats();
          message.reply(`✅ Added ${count} crashes to ${serverId} under ${sessionKey}. It now has ${serverStats[serverId].crashes.total} total crashes.`);
        }
      }
    }
  });

  client.login(TOKEN).catch(err => {
    console.error("❌ Failed to login to Discord:", err.message);
  });

  return client;
}
