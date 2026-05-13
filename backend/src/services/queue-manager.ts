import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { getDb, save } from '../database/db.js';
import {
  startDownload, pauseDownload, stopDownload, probeUrl,
  getFileSize, DownloadProgress, getDownloadPath,
} from './download-engine.js';
import { speedLimiter } from './speed-limiter.js';

export interface DownloadRecord {
  id: string;
  url: string;
  filename: string;
  status: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speed: number;
  remainingTime: number | null;
  createdAt: string;
  queueOrder: number;
  speedLimit: number | null;
  errorMessage: string | null;
  filePath: string | null;
}

type ProgressHandler = (downloadId: string, progress: DownloadProgress) => void;

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');

class QueueManager {
  private maxConcurrent: number = 3;
  private activeCount: number = 0;
  private progressHandlers: ProgressHandler[] = [];
  private downloadInProgress: Set<string> = new Set();

  constructor() {}

  init(): void {
    this.loadSettings();
  }

  private loadSettings(): void {
    const db = getDb();
    if (!db) return;
    const row = db.exec("SELECT value FROM settings WHERE key = 'max_concurrent'");
    if (row.length > 0 && row[0].values.length > 0) {
      this.maxConcurrent = parseInt(row[0].values[0][0] as string, 10) || 3;
    }
    const speedRow = db.exec("SELECT value FROM settings WHERE key = 'global_speed_limit'");
    if (speedRow.length > 0 && speedRow[0].values.length > 0) {
      const limit = parseInt(speedRow[0].values[0][0] as string, 10);
      speedLimiter.setGlobalLimit(limit > 0 ? limit : 0);
    }
  }

  setMaxConcurrent(count: number): void {
    this.maxConcurrent = Math.max(1, count);
    const db = getDb();
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_concurrent', ?)", [String(this.maxConcurrent)]);
    save();
    this.processQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  setGlobalSpeedLimit(bytesPerSecond: number): void {
    speedLimiter.setGlobalLimit(bytesPerSecond);
    const db = getDb();
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('global_speed_limit', ?)", [String(bytesPerSecond)]);
    save();
  }

  getGlobalSpeedLimit(): number {
    return speedLimiter.getGlobalLimit();
  }

  onProgress(handler: ProgressHandler): void {
    this.progressHandlers.push(handler);
  }

  private emitProgress(downloadId: string, progress: DownloadProgress): void {
    this.updateDownloadRecord(downloadId, progress);
    for (const handler of this.progressHandlers) {
      handler(downloadId, progress);
    }
  }

  private updateDownloadRecord(id: string, progress: DownloadProgress): void {
    const db = getDb();
    db.run(
      `UPDATE downloads SET progress = ?, downloaded_bytes = ?, speed = ?, remaining_time = ?, total_bytes = ? WHERE id = ?`,
      [
        Math.round(progress.percentage * 100) / 100,
        progress.downloadedBytes,
        Math.round(progress.speed),
        progress.remainingTime != null ? Math.round(progress.remainingTime) : null,
        progress.totalBytes,
        id,
      ]
    );
    save();
  }

  async addDownloads(urls: string[], customNames?: string[]): Promise<DownloadRecord[]> {
    const db = getDb();
    const downloads: DownloadRecord[] = [];

    const maxOrder = db.exec('SELECT COALESCE(MAX(queue_order), -1) as m FROM downloads');
    let nextOrder = maxOrder.length > 0 ? (maxOrder[0].values[0][0] as number) + 1 : 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      if (!url) continue;

      const id = uuidv4();
      const probed = await probeUrl(url);
      const filename = customNames?.[i]?.trim() || probed.filename;

      const now = new Date().toISOString();
      db.run(
        `INSERT INTO downloads (id, url, filename, status, progress, downloaded_bytes, total_bytes, created_at, queue_order) 
         VALUES (?, ?, ?, 'queued', 0, 0, ?, ?, ?)`,
        [id, url, filename, probed.size, now, nextOrder++]
      );

      const record: DownloadRecord = {
        id, url, filename, status: 'queued', progress: 0, downloadedBytes: 0,
        totalBytes: probed.size, speed: 0, remainingTime: null, createdAt: now,
        queueOrder: nextOrder - 1, speedLimit: null, errorMessage: null, filePath: null,
      };
      downloads.push(record);
    }

    save();
    this.processQueue();
    return downloads;
  }

  async processQueue(): Promise<void> {
    const db = getDb();
    const activeResult = db.exec("SELECT COUNT(*) as c FROM downloads WHERE status = 'downloading'");
    this.activeCount = activeResult.length > 0 ? (activeResult[0].values[0][0] as number) : 0;

    const available = this.maxConcurrent - this.activeCount;
    if (available <= 0) return;

    const result = db.exec(
      `SELECT * FROM downloads WHERE status = 'queued' ORDER BY queue_order ASC LIMIT ?`,
      [available]
    );

    if (result.length === 0 || result[0].values.length === 0) return;

    const columns = result[0].columns;
    for (const row of result[0].values) {
      const record = this.rowToRecord(columns, row);
      if (record && !this.downloadInProgress.has(record.id)) {
        this.beginDownload(record);
      }
    }
  }

  private async beginDownload(record: DownloadRecord): Promise<void> {
    const db = getDb();
    this.downloadInProgress.add(record.id);

    db.run(`UPDATE downloads SET status = 'connecting' WHERE id = ?`, [record.id]);
    save();

    const size = await getFileSize(record.url);
    const downloadedBytes = record.downloadedBytes || 0;

    if (size !== null && size > 0 && downloadedBytes >= size) {
      db.run(
        `UPDATE downloads SET status = 'completed', progress = 100, downloaded_bytes = ?, total_bytes = ? WHERE id = ?`,
        [size, size, record.id]
      );
      save();
      this.downloadInProgress.delete(record.id);
      this.processQueue();
      return;
    }

    db.run(`UPDATE downloads SET status = 'downloading', total_bytes = ? WHERE id = ?`, [size, record.id]);
    save();

    try {
      await startDownload(
        record.id,
        record.url,
        downloadedBytes,
        (progress) => {
          this.emitProgress(record.id, progress);
        }
      );

      const finalBytes = size && size > 0 ? size : (downloadedBytes || 0);
      const statusCheck = db.exec(`SELECT status FROM downloads WHERE id = ?`, [record.id]);
      const currentStatus = statusCheck.length > 0 && statusCheck[0].values.length > 0
        ? statusCheck[0].values[0][0] as string : '';

      if (currentStatus === 'paused' || currentStatus === 'stopped') {
        this.downloadInProgress.delete(record.id);
        return;
      }

      db.run(
        `UPDATE downloads SET status = 'completed', progress = 100, downloaded_bytes = ?, total_bytes = ? WHERE id = ?`,
        [finalBytes, size || finalBytes, record.id]
      );
      save();
    } catch (err: any) {
      const current = db.exec(`SELECT status FROM downloads WHERE id = ?`, [record.id]);
      const currentStatus = current.length > 0 && current[0].values.length > 0
        ? current[0].values[0][0] as string : '';

      if (currentStatus === 'paused' || currentStatus === 'stopped') {
        this.downloadInProgress.delete(record.id);
        return;
      }

      db.run(
        `UPDATE downloads SET status = 'failed', error_message = ? WHERE id = ?`,
        [err.message || 'Download failed', record.id]
      );
      save();
    } finally {
      this.downloadInProgress.delete(record.id);
      this.processQueue();
    }
  }

  pause(id: string): void {
    const db = getDb();
    const result = db.exec(`SELECT status FROM downloads WHERE id = ?`, [id]);
    if (result.length === 0 || result[0].values.length === 0) return;
    const status = result[0].values[0][0] as string;

    const wasActive = status === 'downloading' || status === 'connecting';

    db.run(`UPDATE downloads SET status = 'paused' WHERE id = ? AND status NOT IN ('completed', 'failed', 'stopped')`, [id]);
    save();

    if (wasActive) {
      pauseDownload(id);
    }
  }

  resume(id: string): void {
    const db = getDb();
    db.run(`UPDATE downloads SET status = 'queued', error_message = NULL WHERE id = ? AND status = 'paused'`, [id]);
    save();
    this.processQueue();
  }

  stop(id: string): void {
    const db = getDb();
    const result = db.exec(`SELECT status FROM downloads WHERE id = ?`, [id]);
    if (result.length === 0 || result[0].values.length === 0) return;
    const status = result[0].values[0][0] as string;

    const wasActive = status === 'downloading' || status === 'connecting';

    db.run(`UPDATE downloads SET status = 'stopped' WHERE id = ? AND status NOT IN ('completed', 'failed')`, [id]);
    save();

    if (wasActive) {
      stopDownload(id);
    }
  }

  remove(id: string): void {
    const db = getDb();
    stopDownload(id);

    const result = db.exec(`SELECT filename FROM downloads WHERE id = ?`, [id]);
    if (result.length > 0 && result[0].values.length > 0) {
      const filename = result[0].values[0][0] as string;
      const partPath = path.join(DOWNLOADS_DIR, `${id}_${filename}.part`);
      const finalPath = path.join(DOWNLOADS_DIR, `${id}_${filename}`);
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
      try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    }

    db.run(`DELETE FROM downloads WHERE id = ?`, [id]);
    save();
  }

  retry(id: string): void {
    const db = getDb();
    db.run(
      `UPDATE downloads SET status = 'queued', progress = 0, downloaded_bytes = 0, error_message = NULL WHERE id = ?`,
      [id]
    );
    save();
    this.processQueue();
  }

  reorder(ids: string[]): void {
    const db = getDb();
    for (let i = 0; i < ids.length; i++) {
      db.run(`UPDATE downloads SET queue_order = ? WHERE id = ?`, [i, ids[i]]);
    }
    save();
  }

  getAll(): DownloadRecord[] {
    const db = getDb();
    const result = db.exec(`SELECT * FROM downloads ORDER BY queue_order ASC, created_at DESC`);
    return this.resultToRecords(result);
  }

  getByStatus(status: string): DownloadRecord[] {
    const db = getDb();
    const result = db.exec(`SELECT * FROM downloads WHERE status = ? ORDER BY queue_order ASC`, [status]);
    return this.resultToRecords(result);
  }

  getById(id: string): DownloadRecord | null {
    const db = getDb();
    const result = db.exec(`SELECT * FROM downloads WHERE id = ?`, [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToRecord(result[0].columns, result[0].values[0]);
  }

  clearCompleted(): void {
    const db = getDb();
    db.run(`DELETE FROM downloads WHERE status = 'completed'`);
    save();
  }

  pauseAll(): void {
    const db = getDb();
    const activeResult = db.exec(`SELECT id FROM downloads WHERE status = 'downloading' OR status = 'connecting'`);
    const activeIds: string[] = [];
    for (const row of activeResult[0]?.values || []) {
      activeIds.push(row[0] as string);
    }
    db.run(`UPDATE downloads SET status = 'paused' WHERE status IN ('queued', 'connecting', 'downloading')`);
    save();
    for (const id of activeIds) {
      pauseDownload(id);
    }
  }

  resumeAll(): void {
    const db = getDb();
    const result = db.exec(`SELECT id FROM downloads WHERE status = 'paused'`);
    for (const row of result[0]?.values || []) {
      const id = row[0] as string;
      db.run(`UPDATE downloads SET status = 'queued' WHERE id = ?`, [id]);
    }
    save();
    this.processQueue();
  }

  stopAll(): void {
    const db = getDb();
    const activeResult = db.exec(`SELECT id FROM downloads WHERE status = 'downloading' OR status = 'connecting'`);
    const activeIds: string[] = [];
    for (const row of activeResult[0]?.values || []) {
      activeIds.push(row[0] as string);
    }
    db.run(`UPDATE downloads SET status = 'stopped' WHERE status IN ('queued', 'connecting', 'downloading', 'paused')`);
    save();
    for (const id of activeIds) {
      stopDownload(id);
    }
  }

  getStats(): { total: number; active: number; completed: number; failed: number; paused: number; queued: number } {
    const db = getDb();
    const count = (status: string) => {
      const r = db.exec(`SELECT COUNT(*) as c FROM downloads WHERE status = ?`, [status]);
      return r.length > 0 && r[0].values.length > 0 ? (r[0].values[0][0] as number) : 0;
    };
    const totalResult = db.exec(`SELECT COUNT(*) as c FROM downloads`);
    return {
      total: totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0,
      active: count('downloading'),
      completed: count('completed'),
      failed: count('failed'),
      paused: count('paused'),
      queued: count('queued'),
    };
  }

  private rowToRecord(columns: string[], row: any[]): DownloadRecord {
    const idx = (name: string) => columns.indexOf(name);
    return {
      id: row[idx('id')] as string,
      url: row[idx('url')] as string,
      filename: row[idx('filename')] as string,
      status: row[idx('status')] as string,
      progress: row[idx('progress')] as number,
      downloadedBytes: row[idx('downloaded_bytes')] as number,
      totalBytes: row[idx('total_bytes')] as number | null,
      speed: row[idx('speed')] as number,
      remainingTime: row[idx('remaining_time')] as number | null,
      createdAt: row[idx('created_at')] as string,
      queueOrder: row[idx('queue_order')] as number,
      speedLimit: row[idx('speed_limit')] as number | null,
      errorMessage: row[idx('error_message')] as string | null,
      filePath: row[idx('file_path')] as string | null,
    };
  }

  private resultToRecords(result: any[]): DownloadRecord[] {
    if (result.length === 0 || result[0].values.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => this.rowToRecord(columns, row));
  }
}

export const queueManager = new QueueManager();
