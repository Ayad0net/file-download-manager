import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { markChanged } from './change-notifier.js';
import { getDb, save, DATA_DIR } from '../database/db.js';
import {
  startDownload, pauseDownload, stopDownload, probeUrl,
  getFileSize, DownloadProgress, getDownloadPath,
} from './download-engine.js';
import {
  startSegmentedDownload, pauseSegmented, stopSegmented, probeRangeSupport,
  planSegments, isValidPlan, MIN_SEGMENTED_SIZE, type Segment,
} from './segmented-download.js';
import {
  startTorrent, pauseTorrent, setTorrentDownloadLimit, isTorrentSource, nameFromMagnet,
  type TorrentFileInfo,
} from './torrent-manager.js';
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
  segments: Segment[] | null;
  kind: 'http' | 'torrent';
  /** Saved .torrent file for torrents added by upload. */
  torrentFile: string | null;
  infoHash: string | null;
  peers: number | null;
  uploadSpeed: number | null;
  torrentFiles: (TorrentFileInfo & { absPath?: string })[] | null;
}

type ProgressHandler = (downloadId: string, progress: DownloadProgress) => void;

export const TORRENTS_DIR = path.join(DATA_DIR, 'torrents');
export const DOWNLOADS_DIR = path.resolve(process.env.DOWNLOAD_PATH || path.join(process.cwd(), 'downloads'));

class QueueManager {
  private maxConcurrent: number = 3;
  private connectionsPerDownload: number = 8;
  private activeCount: number = 0;
  private progressHandlers: ProgressHandler[] = [];
  private downloadInProgress: Set<string> = new Set();
  private removedIds: Set<string> = new Set();

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
    const connRow = db.exec("SELECT value FROM settings WHERE key = 'connections_per_download'");
    if (connRow.length > 0 && connRow[0].values.length > 0) {
      this.connectionsPerDownload = parseInt(connRow[0].values[0][0] as string, 10) || 8;
    }
    const speedRow = db.exec("SELECT value FROM settings WHERE key = 'global_speed_limit'");
    if (speedRow.length > 0 && speedRow[0].values.length > 0) {
      const limit = parseInt(speedRow[0].values[0][0] as string, 10);
      speedLimiter.setGlobalLimit(limit > 0 ? limit : 0);
      setTorrentDownloadLimit(limit > 0 ? limit : 0);
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

  /** Applies to downloads started after the change. */
  setConnectionsPerDownload(count: number): void {
    this.connectionsPerDownload = Math.min(32, Math.max(1, count));
    const db = getDb();
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('connections_per_download', ?)", [String(this.connectionsPerDownload)]);
    save();
  }

  getConnectionsPerDownload(): number {
    return this.connectionsPerDownload;
  }

  setGlobalSpeedLimit(bytesPerSecond: number): void {
    speedLimiter.setGlobalLimit(bytesPerSecond);
    setTorrentDownloadLimit(bytesPerSecond);
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
      `UPDATE downloads SET progress = ?, downloaded_bytes = ?, speed = ?, remaining_time = ?, total_bytes = ?, segments = COALESCE(?, segments) WHERE id = ?`,
      [
        Math.round(progress.percentage * 100) / 100,
        progress.downloadedBytes,
        Math.round(progress.speed),
        progress.remainingTime != null ? Math.round(progress.remainingTime) : null,
        progress.totalBytes,
        progress.segments ? JSON.stringify(progress.segments) : null,
        id,
      ]
    );
    // Not persisted here: progress is in-memory only; status transitions call save().
    markChanged();
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
      if (isTorrentSource(url)) {
        const name = customNames?.[i]?.trim() || nameFromMagnet(url) || 'Fetching torrent info…';
        downloads.push(this.insertTorrent({ id, url, name, size: null, infoHash: null, torrentFile: null, order: nextOrder++ }));
        continue;
      }
      const probed = await probeUrl(url);
      const filename = customNames?.[i]?.trim() || probed.filename;

      const now = new Date().toISOString();
      db.run(
        `INSERT INTO downloads (id, url, filename, status, progress, downloaded_bytes, total_bytes, created_at, queue_order) 
         VALUES (?, ?, ?, 'queued', 0, 0, ?, ?, ?)`,
        [id, url, filename, probed.size, now, nextOrder++]
      );

      downloads.push(this.getById(id)!);
    }

    save();
    this.processQueue();
    return downloads;
  }

  /** Adds a torrent from an uploaded .torrent file (already parsed and saved by the route). */
  addTorrentFile(opts: { id: string; magnet: string; name: string; size: number; infoHash: string; torrentFile: string }): DownloadRecord {
    const db = getDb();
    const maxOrder = db.exec('SELECT COALESCE(MAX(queue_order), -1) as m FROM downloads');
    const order = maxOrder.length > 0 ? (maxOrder[0].values[0][0] as number) + 1 : 0;
    const record = this.insertTorrent({ ...opts, url: opts.magnet, order });
    save();
    this.processQueue();
    return record;
  }

  private insertTorrent(o: { id: string; url: string; name: string; size: number | null; infoHash: string | null; torrentFile: string | null; order: number }): DownloadRecord {
    const db = getDb();
    db.run(
      `INSERT INTO downloads (id, url, filename, status, progress, downloaded_bytes, total_bytes, created_at, queue_order, kind, info_hash, torrent_file)
       VALUES (?, ?, ?, 'queued', 0, 0, ?, ?, ?, 'torrent', ?, ?)`,
      [o.id, o.url, o.name, o.size, new Date().toISOString(), o.order, o.infoHash, o.torrentFile]
    );
    return this.getById(o.id)!;
  }

  private async beginTorrent(record: DownloadRecord): Promise<void> {
    const db = getDb();
    const id = record.id;
    db.run(`UPDATE downloads SET status = 'downloading' WHERE id = ?`, [id]);
    save();

    try {
      const source = record.torrentFile && fs.existsSync(record.torrentFile)
        ? fs.readFileSync(record.torrentFile)
        : record.url;
      await startTorrent({
        id,
        source,
        dir: path.join(DOWNLOADS_DIR, id),
        onMetadata: (meta) => {
          if (!this.getById(id)) return;
          db.run(
            `UPDATE downloads SET filename = ?, total_bytes = ?, info_hash = ?, url = ?, torrent_files = ? WHERE id = ?`,
            [meta.name, meta.length, meta.infoHash, meta.magnetURI, JSON.stringify(meta.files), id]
          );
          save();
        },
        onProgress: (p) => {
          if (!this.getById(id)) return;
          db.run(`UPDATE downloads SET peers = ?, upload_speed = ?, torrent_files = COALESCE(?, torrent_files) WHERE id = ?`,
            [p.peers, Math.round(p.uploadSpeed), p.files.length ? JSON.stringify(p.files) : null, id]);
          this.emitProgress(id, p);
        },
      });

      if (this.removedIds.has(id) || !this.getById(id)) {
        this.cleanupFiles(id, record.filename);
        return;
      }
      const status = this.getById(id)!.status;
      if (status === 'paused' || status === 'stopped') return;
      db.run(
        `UPDATE downloads SET status = 'completed', progress = 100, downloaded_bytes = total_bytes, speed = 0, peers = 0, upload_speed = 0 WHERE id = ?`,
        [id]
      );
      const files = this.getById(id)?.torrentFiles;
      if (files) db.run(`UPDATE downloads SET torrent_files = ? WHERE id = ?`, [JSON.stringify(files.map(({ absPath, ...f }) => ({ ...f, downloaded: f.length }))), id]);
      save();
    } catch (err: any) {
      if (this.removedIds.has(id) || !this.getById(id)) return;
      const status = this.getById(id)!.status;
      if (status === 'paused' || status === 'stopped') return;
      db.run(`UPDATE downloads SET status = 'failed', error_message = ? WHERE id = ?`, [err.message || 'Torrent failed', id]);
      save();
    } finally {
      this.downloadInProgress.delete(id);
      this.processQueue();
    }
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
    if (this.removedIds.has(record.id) || !this.getById(record.id)) return;

    this.downloadInProgress.add(record.id);

    if (record.kind === 'torrent') return this.beginTorrent(record);

    db.run(`UPDATE downloads SET status = 'connecting' WHERE id = ?`, [record.id]);
    save();

    const size = await getFileSize(record.url);
    const downloadedBytes = record.downloadedBytes || 0;

    if (this.removedIds.has(record.id) || !this.getById(record.id)) {
      this.cleanupFiles(record.id, record.filename);
      this.downloadInProgress.delete(record.id);
      this.processQueue();
      return;
    }

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

    // Multi-connection when the file is big enough and the server supports byte ranges.
    const connections = this.connectionsPerDownload;
    const rangeTotal = connections > 1 && (size ?? 0) >= MIN_SEGMENTED_SIZE ? await probeRangeSupport(record.url) : null;

    db.run(`UPDATE downloads SET status = 'downloading', total_bytes = ? WHERE id = ?`, [rangeTotal ?? size, record.id]);
    save();

    try {
      const onProgress = (progress: DownloadProgress) => this.emitProgress(record.id, progress);
      if (rangeTotal) {
        const { partPath, finalPath } = getDownloadPath(record.id, record.filename);
        let segments: Segment[];
        if (isValidPlan(record.segments, rangeTotal) && fs.existsSync(partPath)) {
          segments = record.segments;
        } else if (downloadedBytes > 0 && downloadedBytes < rangeTotal && fs.existsSync(partPath)) {
          // Resuming a single-connection download: keep its prefix, split the rest.
          segments = [{ start: 0, end: rangeTotal - 1, downloaded: downloadedBytes }];
        } else {
          segments = planSegments(rangeTotal, connections);
        }
        await startSegmentedDownload({
          id: record.id, url: record.url, partPath, finalPath,
          total: rangeTotal, connections, segments, progressCallback: onProgress,
        });
      } else {
        await startDownload(record.id, record.url, downloadedBytes, onProgress, record.filename);
      }

      const finalBytes = size && size > 0 ? size : (downloadedBytes || 0);
      if (this.removedIds.has(record.id) || !this.getById(record.id)) {
        this.cleanupFiles(record.id, record.filename);
        return;
      }
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
      if (this.removedIds.has(record.id) || !this.getById(record.id)) {
        this.cleanupFiles(record.id, record.filename);
        return;
      }
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
    if (wasActive) {
      pauseSegmented(id);
      pauseTorrent(id);
    }

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
    if (wasActive) {
      stopSegmented(id);
      pauseTorrent(id);
    }

    db.run(`UPDATE downloads SET status = 'stopped' WHERE id = ? AND status NOT IN ('completed', 'failed')`, [id]);
    save();

    if (wasActive) {
      stopDownload(id);
    }
  }

  remove(id: string): void {
    const db = getDb();
    this.removedIds.add(id);
    stopDownload(id);
    stopSegmented(id);
    pauseTorrent(id);

    const result = db.exec(`SELECT filename FROM downloads WHERE id = ?`, [id]);
    if (result.length > 0 && result[0].values.length > 0) {
      const filename = result[0].values[0][0] as string;
      this.cleanupFiles(id, filename);
    }

    db.run(`DELETE FROM downloads WHERE id = ?`, [id]);
    save();
  }

  private cleanupFiles(id: string, filename: string): void {
    // Torrents download into their own folder, plus an optional saved .torrent file.
    const torrentDir = path.join(DOWNLOADS_DIR, id);
    try { if (fs.existsSync(torrentDir)) fs.rmSync(torrentDir, { recursive: true, force: true }); } catch {}
    try {
      const tf = path.join(TORRENTS_DIR, `${id}.torrent`);
      if (fs.existsSync(tf)) fs.unlinkSync(tf);
    } catch {}
    const partPath = path.join(DOWNLOADS_DIR, `${id}_${filename}.part`);
    const finalPath = path.join(DOWNLOADS_DIR, `${id}_${filename}`);
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
  }

  removeUncompleted(): void {
    for (const record of this.getAll()) {
      if (record.status !== 'completed') {
        this.remove(record.id);
      }
    }
  }

  retry(id: string): void {
    const db = getDb();
    db.run(
      `UPDATE downloads SET status = 'queued', progress = 0, downloaded_bytes = 0, segments = NULL, error_message = NULL WHERE id = ?`,
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

  pauseAll(): void {
    const db = getDb();
    const activeResult = db.exec(`SELECT id FROM downloads WHERE status = 'downloading' OR status = 'connecting'`);
    const activeIds: string[] = [];
    for (const row of activeResult[0]?.values || []) {
      activeIds.push(row[0] as string);
    }
    for (const id of activeIds) { pauseSegmented(id); pauseTorrent(id); }
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
    for (const id of activeIds) { stopSegmented(id); pauseTorrent(id); }
    db.run(`UPDATE downloads SET status = 'stopped' WHERE status IN ('queued', 'connecting', 'downloading', 'paused')`);
    save();
    for (const id of activeIds) {
      stopDownload(id);
    }
  }

  getStats(): { total: number; active: number; completed: number; failed: number; paused: number; queued: number; totalDownloadedBytes: number; freeDiskBytes: number | null } {
    const db = getDb();
    const count = (status: string) => {
      const r = db.exec(`SELECT COUNT(*) as c FROM downloads WHERE status = ?`, [status]);
      return r.length > 0 && r[0].values.length > 0 ? (r[0].values[0][0] as number) : 0;
    };
    const totalResult = db.exec(`SELECT COUNT(*) as c FROM downloads`);
    const downloadedResult = db.exec(`SELECT COALESCE(SUM(downloaded_bytes), 0) FROM downloads WHERE status = 'completed'`);
    return {
      total: totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0,
      active: count('downloading'),
      completed: count('completed'),
      failed: count('failed'),
      paused: count('paused'),
      queued: count('queued'),
      totalDownloadedBytes: downloadedResult.length > 0 ? (downloadedResult[0].values[0][0] as number) : 0,
      freeDiskBytes: this.getFreeDiskBytes(),
    };
  }

  private freeDiskCache: { value: number | null; at: number } | null = null;

  // Cached: spawning `df` synchronously on every poll blocks the server.
  private getFreeDiskBytes(): number | null {
    const now = Date.now();
    if (this.freeDiskCache && now - this.freeDiskCache.at < 10_000) return this.freeDiskCache.value;
    const value = this.readFreeDiskBytes();
    this.freeDiskCache = { value, at: now };
    return value;
  }

  private readFreeDiskBytes(): number | null {
    try {
      const out = execSync(`df -Pk "${DOWNLOADS_DIR}"`).toString().trim().split('\n');
      const cols = out[out.length - 1].split(/\s+/);
      const availKb = parseInt(cols[3], 10);
      return Number.isFinite(availKb) && availKb >= 0 ? availKb * 1024 : null;
    } catch {
      return null;
    }
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
      segments: parseJson(row[idx('segments')]),
      kind: row[idx('kind')] === 'torrent' ? 'torrent' : 'http',
      torrentFile: row[idx('torrent_file')] as string | null,
      infoHash: row[idx('info_hash')] as string | null,
      peers: row[idx('peers')] as number | null,
      uploadSpeed: row[idx('upload_speed')] as number | null,
      torrentFiles: parseJson<TorrentFileInfo[]>(row[idx('torrent_files')])?.map(f => ({
        ...f,
        absPath: path.join(DOWNLOADS_DIR, row[idx('id')] as string, f.path),
      })) ?? null,
      filePath: (row[idx('file_path')] as string | null) || (row[idx('kind')] === 'torrent'
        ? path.join(DOWNLOADS_DIR, row[idx('id')] as string, row[idx('filename')] as string)
        : path.join(DOWNLOADS_DIR, `${row[idx('id')]}_${row[idx('filename')]}`)),
    };
  }

  private resultToRecords(result: any[]): DownloadRecord[] {
    if (result.length === 0 || result[0].values.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => this.rowToRecord(columns, row));
  }
}

export const queueManager = new QueueManager();

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}
