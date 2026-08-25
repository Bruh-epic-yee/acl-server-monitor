import ftp from 'basic-ftp';
import fs from 'fs';
import path from 'path';

export class FTPSync {
  constructor(serverConfig, dataDir) {
    this.config = serverConfig;
    this.dataDir = dataDir;
    this.isSyncing = false;
    
    // Ensure local storage directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async syncLogFile() {
    if (this.isSyncing) return null;
    this.isSyncing = true;
    
    const client = new ftp.Client();
    client.ftp.verbose = false;
    // Set a short timeout so we don't hang on dead servers
    client.ftp.timeout = 5000;

    const localLogPath = path.join(this.dataDir, 'server.log');

    try {
      await client.access({
        host: this.config.ftp.host,
        port: this.config.ftp.port || 21,
        user: this.config.ftp.user,
        password: this.config.ftp.password,
        secure: false
      });

      // ACC log files are typically in a 'log' folder on FTP
      // We attempt to download the active server.log
      // Depending on FTP structure, adjust the remote path as necessary
      await client.downloadTo(localLogPath, 'log/server.log');
      
      this.isSyncing = false;
      client.close();
      return { success: true, logPath: localLogPath };

    } catch (error) {
      // It's normal for some servers to be offline, so we handle gracefully
      // console.error(`[FTPSync] Failed to sync ${this.config.id}:`, error.message);
      this.isSyncing = false;
      client.close();
      return { success: false, error: error.message };
    }
  }
}
