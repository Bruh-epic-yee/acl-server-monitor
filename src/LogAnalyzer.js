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
    // Session tracking
    if (line.includes('New session:')) {
      const match = line.match(/New session:\s+(\w+)/);
      if (match) {
        this.currentSession = match[1];
        if (!this.isInitialRun) {
          this.emit('session_change', this.currentSession);
        }
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

    // Driver connection tracking via unique Car IDs
    const carConnMatch = line.match(/(?:Creating new car connection|Recognized reconnect): carId (\d+)/);
    if (carConnMatch) {
      this.connectedCarIds.add(carConnMatch[1]);
      this.connectedDrivers = this.connectedCarIds.size;
    }

    // Driver disconnection tracking via unique Car IDs
    const discoMatch = line.match(/Sent car (\d+) disco/);
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
  }

  reset() {
    this.lastProcessedLine = 0;
    this.connectedCarIds.clear();
    this.connectedDrivers = 0;
    this.lastFileSize = 0;
    this.isInitialRun = true;
  }
}
