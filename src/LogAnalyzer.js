import fs from 'fs';
import readline from 'readline';
import events from 'events';

export class LogAnalyzer extends events.EventEmitter {
  constructor(serverId) {
    super();
    this.serverId = serverId;
    this.lastProcessedLine = 0;
    this.currentSession = 'Unknown';
    this.connectedDrivers = 0;
    this.connectedCarIds = new Set();
    this.lastFileSize = 0;
    this.lastLogTimestamp = 0;
    this.isInitialRun = true;
  }

  async analyze(filePath) {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    
    // Detect log rotation / server reset (ignore on initial startup)
    if (!this.isInitialRun && stats.size < this.lastFileSize) {
      this.lastProcessedLine = 0;
      this.connectedCarIds.clear();
      this.connectedDrivers = 0;
      this.emit('server_reset', {
        serverId: this.serverId,
        timestamp: new Date().toISOString()
      });
    }
    this.lastFileSize = stats.size;

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let currentLine = 0;
    for await (const line of rl) {
      currentLine++;
      
      // Skip lines we've already processed in previous passes
      if (currentLine <= this.lastProcessedLine) continue;

      this.processLine(line);
      this.lastProcessedLine = currentLine;
    }
    
    // Once the entire historical file is parsed, subsequent passes will be live
    this.isInitialRun = false;
  }

  processLine(line) {
    const tsMatch = line.match(/^(\d+):/);
    if (tsMatch) {
      const ts = parseInt(tsMatch[1], 10);
      
      // If timestamp drops, the log was overwritten/rotated but we missed the file size drop
      if (ts < this.lastLogTimestamp && !this.isInitialRun) {
        this.connectedCarIds.clear();
        this.connectedDrivers = 0;
        this.emit('server_reset', {
          serverId: this.serverId,
          timestamp: new Date().toISOString()
        });
      }
      this.lastLogTimestamp = ts;
    }

    // Session tracking via leaderboard updates
    const leaderboardMatch = line.match(/Updated leaderboard for \d+ clients \((.+?)-.*? (\d+ min)\)/);
    if (leaderboardMatch) {
      const sessionType = leaderboardMatch[1]; // "Qualifying", "Race", "Practice"
      const timeRemaining = leaderboardMatch[2].replace(' min', 'm'); // "10 min" -> "10m"
      
      const initial = sessionType.charAt(0).toLowerCase();
      const newSessionStr = `${initial} ${timeRemaining}`;
      
      if (this.currentSession !== newSessionStr) {
        this.currentSession = newSessionStr;
        this.emit('session_change', this.currentSession);
      }
    }
    
    // Explicit server restart line in ACC
    if (line.includes('Server starting') || line.includes('Server reset')) {
      this.connectedCarIds.clear();
      this.connectedDrivers = 0;
      if (!this.isInitialRun) {
        this.emit('server_reset', {
          serverId: this.serverId,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Session completion
    const completionMatch = line.match(/Session completed: (\w+)\//);
    if (completionMatch) {
      if (!this.isInitialRun) {
        this.emit('session_completed', completionMatch[1]); // e.g., "Race", "Qualifying"
      }
    }

    // Session changed (new session started)
    if (line.includes('Session changed:')) {
      if (!this.isInitialRun) {
        this.emit('session_started');
      }
    }

    // Dynamic track detection
    const trackMatch = line.match(/Track (\w+) was set and updated/);
    if (trackMatch) {
      this.currentTrack = trackMatch[1];
      this.emit('track_change', this.currentTrack);
    }

    // Driver connection tracking via unique Car IDs
    const carConnMatch = line.match(/(?:Creating new car connection|Recognized reconnect): carId (\d+)/);
    if (carConnMatch) {
      this.connectedCarIds.add(carConnMatch[1]);
      this.connectedDrivers = this.connectedCarIds.size;
    }

    // Driver disconnection tracking via unique Car IDs
    const discoMatch = line.match(/Sent car (\d+) disco/) || 
                       line.match(/Purging car_id (\d+)/) ||
                       line.match(/car (\d+) has no driving connection anymore/);
    if (discoMatch) {
      const carId = discoMatch[1];
      if (this.connectedCarIds.has(carId)) {
        this.connectedCarIds.delete(carId);
        this.connectedDrivers = this.connectedCarIds.size;
        
        if (!this.isInitialRun) {
          const timeMatch = line.match(/^\[(.*?)\]/) || [null, new Date().toISOString()];
          const timestamp = timeMatch[1];
          
          this.emit('driver_disconnect', {
            serverId: this.serverId,
            timestamp: timestamp || new Date().toISOString(),
            session: this.currentSession,
            activeDrivers: this.connectedDrivers,
            rawLine: line
          });
        }
      }
    }

    // Self-healing mechanism: If the server explicitly says 0 clients, clear all ghost drivers
    const udpMatch = line.match(/Udp message count \((\d+) clients\)/);
    if (udpMatch) {
      const actualClients = parseInt(udpMatch[1], 10);
      if (actualClients === 0 && this.connectedCarIds.size > 0) {
        this.connectedCarIds.clear();
        this.connectedDrivers = 0;
      }
    }
  }

  reset() {
    this.lastProcessedLine = 0;
    this.connectedCarIds.clear();
    this.connectedDrivers = 0;
    this.lastFileSize = 0;
    this.isInitialRun = true;
  }
}
