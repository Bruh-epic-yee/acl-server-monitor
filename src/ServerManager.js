import events from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import { FTPSync } from './FTPSync.js';
import { LogAnalyzer } from './LogAnalyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

export class ServerManager extends events.EventEmitter {
  constructor(serverConfigs) {
    super();
    this.configs = serverConfigs;
    this.monitors = new Map(); // id -> { ftp, analyzer }
    this.disconnectEvents = []; 
    
    this.TIME_WINDOW_MS = 15 * 1000; // 15 seconds window
  }

  start() {
    console.log(`[ServerManager] Starting monitoring for ${this.configs.length} servers...`);
    
    this.configs.forEach((config, index) => {
      const serverDataDir = path.join(DATA_DIR, config.id);
      const ftp = new FTPSync(config, serverDataDir);
      const analyzer = new LogAnalyzer(config.id);

      analyzer.on('driver_disconnect', (event) => {
        this.handleDisconnect(config, event, analyzer.connectedDrivers);
      });

      analyzer.on('track_change', (trackName) => {
        config.name = `ACL ${config.id.replace('acl', '')} (${trackName})`;
      });

      analyzer.on('server_reset', (event) => {
        const now = Date.now();
        // Prevent duplicate reset alerts within a 60-second window
        if (!config.lastResetAlert || (now - config.lastResetAlert > 60000)) {
          config.lastResetAlert = now;
          
          const drivers = event.activeDrivers || 0;
          
          // Trigger a mass disconnect alert for a server reset
          this.emit('mass_disconnect_server', {
            server: config,
            dropCount: `ALL ${drivers > 0 ? `(${drivers}) ` : ''}(Server Reset)`,
            session: analyzer.currentSession,
            isReset: true
          });
        }
      });

      analyzer.on('session_completed', (sessionType) => {
        this.emit('session_completed', {
          server: config,
          sessionType: sessionType
        });
      });

      analyzer.on('session_started', () => {
        this.emit('session_started', {
          server: config
        });
      });

      this.monitors.set(config.id, { ftp, analyzer });

      // Stagger start
      setTimeout(() => {
        this.startPolling(config.id);
      }, index * 1000);
    });

    setInterval(() => this.cleanupOldEvents(), 10000);
  }

  async startPolling(serverId) {
    const monitor = this.monitors.get(serverId);
    if (!monitor) return;

    const result = await monitor.ftp.syncLogFile();
    if (result && result.success) {
      await monitor.analyzer.analyze(result.logPath);
      
      // If it came back online after being offline, we can reset the counter
      monitor.offlineCount = 0;
      monitor.offlineAlertSent = false;
    } else if (result && !result.success) {
      monitor.offlineCount = (monitor.offlineCount || 0) + 1;
      
      // If it fails 3 times in a row (approx 45 seconds), emit an alert
      if (monitor.offlineCount >= 3 && !monitor.offlineAlertSent) {
        monitor.offlineAlertSent = true;
        this.emit('ftp_offline', {
          server: monitor.ftp.config,
          error: result.error
        });
      }
    }

    setTimeout(() => this.startPolling(serverId), 15000);
  }

  handleDisconnect(serverConfig, event, activeDriversRemaining) {
    const now = Date.now();
    this.disconnectEvents.push({
      ...event,
      serverConfig,
      localTime: now
    });

    this.evaluateMassDisconnect(serverConfig, activeDriversRemaining);
  }

  evaluateMassDisconnect(triggeringServer, activeDriversRemaining) {
    const now = Date.now();
    
    // 1. Look for server-level mass disconnect (All drivers dropped)
    const serverDrops = this.disconnectEvents.filter(e => 
      e.serverConfig.id === triggeringServer.id &&
      now - e.localTime <= this.TIME_WINDOW_MS
    );

    // [DISABLED PER USER REQUEST] - Only alert on Server Resets for now
    /*
    if (serverDrops.length >= 10) {
      if (!triggeringServer.lastAlerted || (now - triggeringServer.lastAlerted > 60000)) {
        triggeringServer.lastAlerted = now;
        this.emit('mass_disconnect_server', {
          server: triggeringServer,
          dropCount: serverDrops.length,
          session: serverDrops[0].session,
          isReset: false
        });
      }
    }
    */

    // 2. Region-level mass disconnect 
    const regionDrops = this.disconnectEvents.filter(e => 
      e.serverConfig.region === triggeringServer.region &&
      now - e.localTime <= this.TIME_WINDOW_MS
    );

    const uniqueMachineIpsAffected = new Set(regionDrops.map(e => e.serverConfig.machineIp));
    let regionalAlertTriggered = false;

    // If multiple machines in the same region saw drops
    if (uniqueMachineIpsAffected.size > 1 && regionDrops.length >= 15) {
      // Avoid spamming region level
      if (!triggeringServer.lastRegionAlert || (now - triggeringServer.lastRegionAlert > 120000)) {
        triggeringServer.lastRegionAlert = now;
        regionalAlertTriggered = true;
        this.emit('mass_disconnect_region', {
          region: triggeringServer.region,
          machinesAffected: uniqueMachineIpsAffected.size,
          serversAffected: new Set(regionDrops.map(e => e.serverConfig.id)).size,
          dropCount: regionDrops.length,
          session: regionDrops[0].session
        });
      }
    }

    if (regionalAlertTriggered) return; // Prevent spamming machine alerts if region is down

    // 3. Machine-level mass disconnect 
    const machineDrops = this.disconnectEvents.filter(e => 
      e.serverConfig.machineIp === triggeringServer.machineIp &&
      now - e.localTime <= this.TIME_WINDOW_MS
    );

    const uniqueServersAffected = new Set(machineDrops.map(e => e.serverConfig.id));
    
    // If multiple servers on the same IP saw drops
    if (uniqueServersAffected.size > 1 && machineDrops.length >= 10) {
      // Avoid spamming machine level
      if (!triggeringServer.lastMachineAlert || (now - triggeringServer.lastMachineAlert > 60000)) {
        triggeringServer.lastMachineAlert = now;
        this.emit('mass_disconnect_machine', {
          machineIp: triggeringServer.machineIp,
          region: triggeringServer.region,
          serversAffected: uniqueServersAffected.size,
          dropCount: machineDrops.length,
          session: machineDrops[0].session
        });
      }
    }
  }

  cleanupOldEvents() {
    const now = Date.now();
    this.disconnectEvents = this.disconnectEvents.filter(e => now - e.localTime <= 60000);
  }
}
