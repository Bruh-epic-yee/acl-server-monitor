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
    this.lastFileSize = 0;
  }

  async analyze(filePath) {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    
    // Detect log rotation / server reset
    if (stats.size < this.lastFileSize) {
      this.lastProcessedLine = 0;
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
  }

  processLine(line) {
    // Session tracking
    if (line.includes('New session:')) {
      const match = line.match(/New session:\s+(\w+)/);
      if (match) {
        this.currentSession = match[1];
        this.emit('session_change', this.currentSession);
      }
    }
    
    // Explicit server restart line in ACC
    if (line.includes('Server starting') || line.includes('Server reset')) {
      this.connectedDrivers = 0;
      this.emit('server_reset', {
        serverId: this.serverId,
        timestamp: new Date().toISOString()
      });
    }

    // Driver connection tracking
    if (line.toLowerCase().includes('new connection') || line.includes('has connected')) {
      this.connectedDrivers++;
    }

    // Driver disconnection tracking
    if (line.toLowerCase().includes('disconnected') || line.toLowerCase().includes('connection closed')) {
      this.connectedDrivers = Math.max(0, this.connectedDrivers - 1);
      
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

  reset() {
    this.lastProcessedLine = 0;
    this.connectedDrivers = 0;
    this.lastFileSize = 0;
  }
}
