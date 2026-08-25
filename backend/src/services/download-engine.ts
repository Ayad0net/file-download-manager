import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { speedLimiter } from './speed-limiter.js';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  speed: number;
  remainingTime: number | null;
  percentage: number;
  status: string;
}

export type DownloadEventCallback = (progress: DownloadProgress) => void;

interface ActiveDownload {
  id: string;
  url: string;
  req: http.ClientRequest | null;
  destStream: fs.WriteStream | null;
  aborted: boolean;
  finished: boolean;
  paused: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  startTime: number;
  lastSpeedTime: number;
  lastSpeedBytes: number;
  speed: number;
  progressCallback: DownloadEventCallback | null;
}

const activeDownloads = new Map<string, ActiveDownload>();
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

interface RequestConfig {
  method: string;
  headers: Record<string, string>;
  timeout?: number;
  onRequest?: (req: http.ClientRequest) => void;
}

interface FinalResponse {
  req: http.ClientRequest;
  res: http.IncomingMessage;
}

function requestWithRedirects(urlStr: string, options: RequestConfig): Promise<FinalResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const attempt = (currentUrl: URL, remaining: number): void => {
      const httpModule = currentUrl.protocol === 'https:' ? https : http;
      const req = httpModule.request(
        {
          hostname: currentUrl.hostname,
          port: currentUrl.port || (currentUrl.protocol === 'https:' ? 443 : 80),
          path: currentUrl.pathname + currentUrl.search,
          method: options.method,
          headers: options.headers,
          timeout: options.timeout,
        },
        (res) => {
          const status = res.statusCode || 0;
          const location = res.headers.location;

          if (REDIRECT_STATUSES.has(status) && location) {
            res.resume();
            if (remaining <= 0) {
              settle(() => reject(new Error(`HTTP ${status}: too many redirects`)));
              return;
            }
            try {
              attempt(new URL(location, currentUrl), remaining - 1);
            } catch (err: any) {
              settle(() => reject(new Error(`Invalid redirect location: ${location}`)));
            }
            return;
          }

          settle(() => resolve({ req, res }));
        }
      );

      req.on('error', (err) => settle(() => reject(err)));
      req.on('timeout', () => {
        req.destroy();
        settle(() => reject(new Error('Request timeout')));
      });

      options.onRequest?.(req);
      req.end();
    };

    try {
      attempt(new URL(urlStr), MAX_REDIRECTS);
    } catch (err: any) {
      settle(() => reject(err));
    }
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
}

function getFilenameFromUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname;
    const filename = path.basename(pathname) || 'download';
    return sanitizeFilename(decodeURIComponent(filename));
  } catch {
    return 'download';
  }
}

function getDestPath(downloadId: string, filename: string, partial: boolean = false): string {
  const ext = partial ? '.part' : '';
  return path.join(DOWNLOADS_DIR, `${downloadId}_${filename}${ext}`);
}

export async function getFileSize(urlStr: string): Promise<number | null> {
  try {
    const { res } = await requestWithRedirects(urlStr, {
      method: 'HEAD',
      headers: { 'User-Agent': 'DownloadManager/1.0' },
      timeout: 10000,
    });
    const size = parseInt(res.headers['content-length'] || '0', 10);
    res.resume();
    return size || null;
  } catch {
    return null;
  }
}

export async function probeUrl(urlStr: string): Promise<{ filename: string; size: number | null; supportsResume: boolean }> {
  try {
    const { res } = await requestWithRedirects(urlStr, {
      method: 'HEAD',
      headers: { 'User-Agent': 'DownloadManager/1.0' },
      timeout: 10000,
    });
    const size = parseInt(res.headers['content-length'] || '0', 10);
    let filename = getFilenameFromUrl(urlStr);
    const cd = res.headers['content-disposition'];
    if (cd) {
      const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match) filename = sanitizeFilename(match[1].replace(/['"]/g, ''));
    }
    res.resume();
    return { filename, size: size || null, supportsResume: false };
  } catch {
    return { filename: getFilenameFromUrl(urlStr), size: null, supportsResume: false };
  }
}

export async function startDownload(
  downloadId: string,
  urlStr: string,
  existingBytes: number = 0,
  progressCallback: DownloadEventCallback | null = null
): Promise<void> {
  if (activeDownloads.has(downloadId)) return;

  const filename = getFilenameFromUrl(urlStr);
  const partPath = getDestPath(downloadId, filename, true);
  const finalPath = getDestPath(downloadId, filename, false);

  const startByte = existingBytes;
  const headers: Record<string, string> = {
    'User-Agent': 'DownloadManager/1.0',
  };

  if (startByte > 0) {
    headers['Range'] = `bytes=${startByte}-`;
  }

  let speedTimer: ReturnType<typeof setInterval> | null = null;

  const active: ActiveDownload = {
    id: downloadId,
    url: urlStr,
    req: null,
    destStream: null,
    aborted: false,
    finished: false,
    paused: false,
    downloadedBytes: startByte,
    totalBytes: null,
    startTime: Date.now(),
    lastSpeedTime: Date.now(),
    lastSpeedBytes: startByte,
    speed: 0,
    progressCallback,
  };

  activeDownloads.set(downloadId, active);

  return new Promise((resolve, reject) => {
    requestWithRedirects(urlStr, {
      method: 'GET',
      headers,
      timeout: 30000,
      onRequest: (r) => { active.req = r; },
    })
      .then(({ req, res }) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        res.resume();
        activeDownloads.delete(downloadId);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      active.totalBytes = res.statusCode === 206 && startByte > 0
        ? startByte + total
        : total || null;

      const flags = startByte > 0 ? 'a' : 'w';
      active.destStream = fs.createWriteStream(partPath, { flags });

      res.on('data', (chunk: Buffer) => {
        if (active.aborted || active.finished || active.paused) {
          if (active.paused) res.pause();
          return;
        }

        if (active.destStream?.writable) {
          try { active.destStream.write(chunk); } catch {}
        }
        active.downloadedBytes += chunk.length;

        const now = Date.now();
        const timeDiff = now - active.lastSpeedTime;
        if (timeDiff >= 500) {
          const byteDiff = active.downloadedBytes - active.lastSpeedBytes;
          active.speed = (byteDiff / timeDiff) * 1000;
          active.lastSpeedTime = now;
          active.lastSpeedBytes = active.downloadedBytes;
        }

        emitProgress(active);

        const delay = speedLimiter.getDelayMs(downloadId, chunk.length);
        if (delay > 5) {
          res.pause();
          setTimeout(() => {
            if (!active.paused && !active.aborted && !active.finished) {
              res.resume();
            }
          }, delay);
        }
      });

      res.on('end', () => {
        active.finished = true;
        if (speedTimer) clearInterval(speedTimer);

        const finishAndResolve = () => {
          if (!active.aborted && !active.paused) {
            const totalBytes = active.totalBytes;
            if (!totalBytes || active.downloadedBytes >= totalBytes) {
              try {
                if (fs.existsSync(partPath)) {
                  const fileSize = fs.statSync(partPath).size;
                  if (fileSize > 0) {
                    fs.renameSync(partPath, finalPath);
                  }
                }
              } catch {}
            }
          }
          activeDownloads.delete(downloadId);
          resolve();
        };

        if (active.destStream?.writable) {
          active.destStream.end(finishAndResolve);
        } else {
          finishAndResolve();
        }
      });

      res.on('error', (err) => {
        active.aborted = true;
        if (speedTimer) clearInterval(speedTimer);
        if (active.destStream?.writable) active.destStream.end();
        activeDownloads.delete(downloadId);
        reject(err);
      });
      })
      .catch((err) => {
        if (speedTimer) clearInterval(speedTimer);
        if (!active.finished && !active.aborted) {
          activeDownloads.delete(downloadId);
          reject(err);
        }
      });
  });
}

export function pauseDownload(downloadId: string): void {
  const active = activeDownloads.get(downloadId);
  if (!active) return;
  active.paused = true;
  if (active.req) active.req.destroy();
  if (active.destStream) active.destStream.end();
  activeDownloads.delete(downloadId);
}

export function stopDownload(downloadId: string): void {
  const active = activeDownloads.get(downloadId);
  if (!active) return;
  active.aborted = true;
  if (active.req) active.req.destroy();
  if (active.destStream) active.destStream.end();
  activeDownloads.delete(downloadId);
}

export function getDownloadProgress(downloadId: string): DownloadProgress | null {
  const active = activeDownloads.get(downloadId);
  if (!active) return null;
  return buildProgress(active);
}

export function isDownloadActive(downloadId: string): boolean {
  return activeDownloads.has(downloadId);
}

export function getActiveDownloadIds(): string[] {
  return Array.from(activeDownloads.keys());
}

function emitProgress(active: ActiveDownload): void {
  if (active.progressCallback) {
    active.progressCallback(buildProgress(active));
  }
}

function buildProgress(active: ActiveDownload): DownloadProgress {
  const { downloadedBytes, totalBytes, speed } = active;
  const percentage = totalBytes && totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
  const remainingBytes = totalBytes && totalBytes > 0 ? totalBytes - downloadedBytes : 0;
  const remainingTime = speed > 0 ? remainingBytes / speed : null;

  return {
    downloadedBytes,
    totalBytes,
    speed,
    remainingTime,
    percentage,
    status: active.paused ? 'paused' : 'downloading',
  };
}

export function getDownloadPath(downloadId: string, filename: string): { partPath: string; finalPath: string } {
  return {
    partPath: getDestPath(downloadId, filename, true),
    finalPath: getDestPath(downloadId, filename, false),
  };
}
