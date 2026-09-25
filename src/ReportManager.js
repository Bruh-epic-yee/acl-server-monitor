import fs from 'fs';
import readline from 'readline';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/reports.sqlite');

export class ReportManager {
  constructor() {
    this.db = null;
    this.lastProcessedLines = new Map(); // serverId -> last line number
  }

  async init() {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT,
        reporter_id TEXT,
        reported_id TEXT,
        reported_nickname TEXT,
        reported_reason TEXT,
        timestamp DATETIME
      );
    `);
  }

  async processLogFile(serverId, filePath) {
    if (!fs.existsSync(filePath)) return;

    let lastProcessed = this.lastProcessedLines.get(serverId) || 0;

    // Optional: detect file wipe if file size drops to 0, resetting lastProcessed to 0
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      lastProcessed = 0;
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let currentLine = 0;
    let newReportsAdded = 0;
    
    // If it's the first time parsing this file, we want to ingest historical data
    // but tag it with a ghost timestamp so it doesn't pollute weekly/monthly views.
    const isFirstRun = (lastProcessed === 0);

    for await (const line of rl) {
      currentLine++;
      
      if (currentLine <= lastProcessed) continue;

      // Extract regex
      // Format: ===== PLAYER P... HAS REPORTED P... (NICKNAME: ...) FOR BAD BEHAVIOR =====
      const match = line.match(/===== PLAYER (P\d+|M\d+) HAS REPORTED (P\d+|M\d+) \(NICKNAME: (.+?)\) FOR (.*?) =====/);
      if (match) {
        const reporterId = match[1];
        const reportedId = match[2];
        const reportedNickname = match[3];
        const reportedReason = match[4].toUpperCase(); // "BAD BEHAVIOR" or "CHEATING"
        
        // Use a ghost timestamp for historical data, otherwise use current time
        const recordTimestamp = isFirstRun ? new Date(0).toISOString() : new Date().toISOString();

        // Deduplication: Check if this reporter reported this player for the exact SAME reason on this server within the last 2 hours
        const twoHoursAgo = new Date(new Date(recordTimestamp).getTime() - 2 * 60 * 60 * 1000).toISOString();
        const existing = await this.db.get(`
          SELECT id FROM reports 
          WHERE server_id = ? AND reporter_id = ? AND reported_id = ? AND reported_reason = ? AND timestamp >= ?
        `, [serverId, reporterId, reportedId, reportedReason, twoHoursAgo]);

        if (!existing) {
          await this.db.run(`
            INSERT INTO reports (server_id, reporter_id, reported_id, reported_nickname, reported_reason, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [serverId, reporterId, reportedId, reportedNickname, reportedReason, recordTimestamp]);
          newReportsAdded++;
        }
      }
    }
    
    this.lastProcessedLines.set(serverId, currentLine);
    if (newReportsAdded > 0) {
      console.log(`[ReportManager] Added ${newReportsAdded} new reports for ${serverId}`);
    } else if (isFirstRun && currentLine > 0) {
      console.log(`[ReportManager] Skipped ${currentLine} historical reports for ${serverId} (First Run)`);
    }
  }

  async getLeaderboard(sinceDate, endDate = null, reason = null) {
    const results = await this.db.all(`
      SELECT reported_id, reported_nickname, COUNT(id) as report_count
      FROM reports
      WHERE timestamp >= ? 
        AND (? IS NULL OR timestamp < ?)
        AND (? IS NULL OR reported_reason = ?)
      GROUP BY reported_id, reported_nickname
      ORDER BY report_count DESC
    `, [sinceDate, endDate, endDate, reason, reason]);
    
    return results;
  }

  async getReporters(sinceDate, endDate = null, reason = null) {
    if (!this.db) return [];
    
    const results = await this.db.all(`
      SELECT 
        reporter_id, 
        COUNT(id) as report_count,
        (SELECT reported_nickname FROM reports WHERE reported_id = r.reporter_id LIMIT 1) as reporter_nickname
      FROM reports r
      WHERE timestamp >= ? 
        AND (? IS NULL OR timestamp < ?)
        AND (? IS NULL OR reported_reason = ?)
      GROUP BY reporter_id
      ORDER BY report_count DESC
    `, [sinceDate, endDate, endDate, reason, reason]);
    
    return results;
  }

  async getRetaliations(sinceDate, endDate = null, reason = null) {
    if (!this.db) return [];
    
    const results = await this.db.all(`
      SELECT 
        r1.reporter_id as driver_a, 
        r1.reported_id as driver_b, 
        r1.reported_nickname as driver_b_nick,
        r2.reported_nickname as driver_a_nick,
        r1.timestamp as time_a, 
        r2.timestamp as time_b
      FROM reports r1
      JOIN reports r2 
        ON r1.reporter_id = r2.reported_id 
        AND r1.reported_id = r2.reporter_id
      WHERE r1.timestamp >= ? 
        AND (? IS NULL OR r1.timestamp < ?)
        AND (? IS NULL OR r1.reported_reason = ?)
        AND (? IS NULL OR r2.reported_reason = ?)
        AND r1.id < r2.id
        AND abs(strftime('%s', r1.timestamp) - strftime('%s', r2.timestamp)) <= 120
      ORDER BY r1.timestamp DESC
    `, [sinceDate, endDate, endDate, reason, reason, reason, reason]);
    
    return results;
  }

  async getHeatmap(sinceDate, endDate = null, reason = null) {
    if (!this.db) return [];
    
    const results = await this.db.all(`
      SELECT server_id, COUNT(id) as report_count
      FROM reports
      WHERE timestamp >= ? 
        AND (? IS NULL OR timestamp < ?)
        AND (? IS NULL OR reported_reason = ?)
      GROUP BY server_id
      ORDER BY report_count DESC
    `, [sinceDate, endDate, endDate, reason, reason]);
    
    return results;
  }
}
