import WebTorrent from 'webtorrent';
import type { DownloadProgress } from './download-engine.js';

export interface TorrentFileInfo {
  name: string;
  path: string;
  length: number;
  downloaded: number;
}

export interface TorrentMetadata {
  name: string;
  length: number;
  infoHash: string;
  magnetURI: string;
  files: TorrentFileInfo[];
}

export interface TorrentProgress extends DownloadProgress {
  peers: number;
  uploadSpeed: number;
  files: TorrentFileInfo[];
}

interface Job {
  torrent: any;
  timer: ReturnType<typeof setInterval> | null;
  settle: () => void;
}

// One client for the whole app; created on first use so plain HTTP-only sessions never open sockets.
let client: any = null;
let downloadLimit = 0;
const jobs = new Map<string, Job>();

function getClient(): any {
  if (!client) {
    // uTP needs a native module; plain TCP + DHT + trackers work everywhere.
    client = new WebTorrent({ utp: false, downloadLimit: downloadLimit > 0 ? downloadLimit : -1 });
    client.on('error', (err: Error) => console.error('[torrent] client error:', err.message));
  }
  return client;
}

/** Applies the app's global speed limit (bytes/s, 0 = unlimited) to all torrents. */
export function setTorrentDownloadLimit(bytesPerSecond: number): void {
  downloadLimit = bytesPerSecond;
  client?.throttleDownload(bytesPerSecond > 0 ? bytesPerSecond : -1);
}

export function isTorrentSource(source: string): boolean {
  if (source.startsWith('magnet:')) return /xt=urn:bt[im]h:/i.test(source);
  try {
    return /\.torrent$/i.test(new URL(source).pathname);
  } catch {
    return false;
  }
}

/** Display name from a magnet's dn= parameter, for before metadata arrives. */
export function nameFromMagnet(magnet: string): string | null {
  const m = /[?&]dn=([^&]+)/.exec(magnet);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return m[1]; }
}

function fileInfo(torrent: any): TorrentFileInfo[] {
  return torrent.files.map((f: any) => ({
    name: f.name,
    path: f.path,
    length: f.length,
    downloaded: Math.min(f.length, f.downloaded),
  }));
}

/**
 * Downloads (or resumes) a torrent into `dir`. Existing data is verified and reused,
 * which is how pause/resume works. Resolves on completion, or when paused/stopped.
 */
export function startTorrent(opts: {
  id: string;
  source: string | Buffer;
  dir: string;
  onMetadata: (meta: TorrentMetadata) => void;
  onProgress: (progress: TorrentProgress) => void;
}): Promise<void> {
  if (jobs.has(opts.id)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const c = getClient();
    let settled = false;
    const job: Job = {
      torrent: null,
      timer: null,
      settle: () => {
        if (settled) return;
        settled = true;
        if (job.timer) clearInterval(job.timer);
        jobs.delete(opts.id);
        resolve();
      },
    };
    jobs.set(opts.id, job);

    const emit = () => {
      const t = job.torrent;
      // A destroyed torrent reports no files; don't let a late tick wipe the stored file list.
      if (!t || t.destroyed || !t.length || !t.files?.length) return;
      const downloaded = Math.min(t.length, Math.round(t.progress * t.length));
      opts.onProgress({
        downloadedBytes: downloaded,
        totalBytes: t.length,
        speed: t.downloadSpeed,
        remainingTime: t.downloadSpeed > 0 && Number.isFinite(t.timeRemaining) ? t.timeRemaining / 1000 : null,
        percentage: t.progress * 100,
        status: 'downloading',
        peers: t.numPeers,
        uploadSpeed: t.uploadSpeed,
        files: fileInfo(t),
      });
    };

    try {
      job.torrent = c.add(opts.source, { path: opts.dir, destroyStoreOnDestroy: false });
    } catch (err: any) {
      jobs.delete(opts.id);
      reject(err);
      return;
    }
    const t = job.torrent;

    const onMeta = () => {
      opts.onMetadata({ name: t.name, length: t.length, infoHash: t.infoHash, magnetURI: t.magnetURI, files: fileInfo(t) });
      emit();
    };
    if (t.metadata) onMeta(); else t.once('metadata', onMeta);

    // Peer counts and speeds change without data events, so sample on a timer.
    job.timer = setInterval(emit, 500);

    t.once('done', () => {
      emit();
      // Stop after completion rather than seeding indefinitely; keeps files on disk.
      t.destroy({ destroyStore: false }, () => job.settle());
    });
    t.once('error', (err: Error) => {
      if (settled) return;
      settled = true;
      if (job.timer) clearInterval(job.timer);
      jobs.delete(opts.id);
      t.destroy({ destroyStore: false });
      reject(err);
    });
  });
}

/** Disconnects and keeps downloaded data; a later startTorrent() verifies and resumes. */
export function pauseTorrent(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const t = job.torrent;
  if (t && !t.destroyed) t.destroy({ destroyStore: false }, () => job.settle());
  else job.settle();
}

export function isTorrentActive(id: string): boolean {
  return jobs.has(id);
}
