import http from 'http';
import fs from 'fs';
import { requestWithRedirects, type DownloadEventCallback } from './download-engine.js';
import { speedLimiter } from './speed-limiter.js';

/** Byte range [start, end] (inclusive) of the file, with how much of it is already on disk. */
export interface Segment {
  start: number;
  end: number;
  downloaded: number;
}

/** Files smaller than this are downloaded over a single connection. */
export const MIN_SEGMENTED_SIZE = 2 * 1024 * 1024;
/** A running segment is only split to feed an idle connection if it has at least this much left. */
const MIN_SPLIT_BYTES = 1024 * 1024;
const MAX_RETRIES = 3;
const USER_AGENT = 'DownloadManager/1.0';

interface Worker {
  seg: Segment;
  req: http.ClientRequest | null;
  retries: number;
}

interface Job {
  id: string;
  url: string;
  partPath: string;
  finalPath: string;
  total: number;
  connections: number;
  segments: Segment[];
  workers: Set<Worker>;
  fd: number;
  state: 'running' | 'paused' | 'stopped' | 'done' | 'failed';
  downloadedBytes: number;
  speed: number;
  lastSpeedTime: number;
  lastSpeedBytes: number;
  lastEmitTime: number;
  progressCallback: DownloadEventCallback | null;
  resolve: () => void;
  reject: (err: Error) => void;
}

const jobs = new Map<string, Job>();

const remaining = (s: Segment) => s.end - s.start + 1 - s.downloaded;

/**
 * Returns the total size if the server honours byte ranges, else null.
 * Uses a 1-byte ranged GET because many servers don't advertise Accept-Ranges on HEAD.
 */
export async function probeRangeSupport(url: string): Promise<number | null> {
  try {
    const { req, res } = await requestWithRedirects(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-0' },
      timeout: 10000,
    });
    // Destroy instead of draining: a server that ignores Range would send the whole file.
    req.destroy();
    res.destroy();
    if (res.statusCode !== 206) return null;
    const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

export function planSegments(total: number, count: number): Segment[] {
  const n = Math.max(1, Math.min(count, Math.floor(total / MIN_SPLIT_BYTES) || 1));
  const size = Math.ceil(total / n);
  const segments: Segment[] = [];
  for (let start = 0; start < total; start += size) {
    segments.push({ start, end: Math.min(start + size, total) - 1, downloaded: 0 });
  }
  return segments;
}

/** Segments must exactly tile [0, total) to be trusted for a resume. */
export function isValidPlan(segments: unknown, total: number): segments is Segment[] {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let next = 0;
  for (const s of sorted) {
    if (s.start !== next || s.end < s.start || s.downloaded < 0 || s.downloaded > s.end - s.start + 1) return false;
    next = s.end + 1;
  }
  return next === total;
}

export function startSegmentedDownload(opts: {
  id: string;
  url: string;
  partPath: string;
  finalPath: string;
  total: number;
  connections: number;
  segments: Segment[];
  progressCallback: DownloadEventCallback | null;
}): Promise<void> {
  if (jobs.has(opts.id)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let fd: number;
    try {
      // Positional writes need the file preallocated to its final size.
      const resuming = fs.existsSync(opts.partPath) && opts.segments.some(s => s.downloaded > 0);
      fd = fs.openSync(opts.partPath, resuming ? 'r+' : 'w');
      fs.ftruncateSync(fd, opts.total);
    } catch (err: any) {
      reject(err);
      return;
    }

    const segments = opts.segments.map(s => ({ ...s }));
    const downloaded = segments.reduce((sum, s) => sum + s.downloaded, 0);
    const job: Job = {
      ...opts,
      segments,
      workers: new Set(),
      fd,
      state: 'running',
      downloadedBytes: downloaded,
      speed: 0,
      lastSpeedTime: Date.now(),
      lastSpeedBytes: downloaded,
      lastEmitTime: 0,
      resolve,
      reject,
    };
    jobs.set(job.id, job);
    schedule(job);
  });
}

/** Assigns idle connections to unfinished segments, splitting the largest running one when none are free. */
function schedule(job: Job): void {
  if (job.state !== 'running') return;

  const busy = new Set([...job.workers].map(w => w.seg));
  for (const seg of job.segments) {
    if (job.workers.size >= job.connections) break;
    if (!busy.has(seg) && remaining(seg) > 0) spawn(job, seg);
  }

  while (job.workers.size < job.connections) {
    let largest: Segment | null = null;
    for (const w of job.workers) {
      if (!largest || remaining(w.seg) > remaining(largest)) largest = w.seg;
    }
    if (!largest || remaining(largest) < MIN_SPLIT_BYTES * 2) break;
    // Hand the back half to a new connection; the existing worker stops at the new end.
    const cursor = largest.start + largest.downloaded;
    const mid = cursor + Math.floor(remaining(largest) / 2);
    const tail: Segment = { start: mid, end: largest.end, downloaded: 0 };
    largest.end = mid - 1;
    job.segments.push(tail);
    job.segments.sort((a, b) => a.start - b.start);
    spawn(job, tail);
  }

  if (job.workers.size === 0 && job.segments.every(s => remaining(s) <= 0)) finish(job);
}

function spawn(job: Job, seg: Segment, retries = 0): void {
  const worker: Worker = { seg, req: null, retries };
  job.workers.add(worker);

  const from = seg.start + seg.downloaded;
  requestWithRedirects(job.url, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, Range: `bytes=${from}-${seg.end}` },
    timeout: 30000,
    onRequest: (r) => { worker.req = r; },
  })
    .then(({ req, res }) => {
      worker.req = req;
      if (job.state !== 'running') {
        req.destroy();
        return;
      }
      if (res.statusCode !== 206) {
        res.destroy();
        workerFailed(job, worker, new Error(`HTTP ${res.statusCode} for range request`));
        return;
      }

      let ended = false;
      const done = () => {
        if (ended) return;
        ended = true;
        req.destroy();
        job.workers.delete(worker);
        schedule(job);
      };

      res.on('data', (chunk: Buffer) => {
        if (job.state !== 'running' || ended) return;
        // The segment may have been shortened by a split; never write past its end.
        const left = remaining(seg);
        const buf = chunk.length > left ? chunk.subarray(0, left) : chunk;
        if (buf.length > 0) {
          try {
            fs.writeSync(job.fd, buf, 0, buf.length, seg.start + seg.downloaded);
          } catch (err: any) {
            fail(job, err);
            return;
          }
          seg.downloaded += buf.length;
          job.downloadedBytes += buf.length;
          tick(job);
        }
        if (remaining(seg) <= 0) {
          done();
          return;
        }
        const delay = speedLimiter.getDelayMs(job.id, buf.length);
        if (delay > 5) {
          res.pause();
          setTimeout(() => { if (job.state === 'running' && !ended) res.resume(); }, delay);
        }
      });

      res.on('end', () => {
        if (ended || job.state !== 'running') return;
        if (remaining(seg) > 0) {
          ended = true;
          workerFailed(job, worker, new Error('Connection closed early'));
        } else {
          done();
        }
      });

      res.on('error', (err) => {
        if (ended || job.state !== 'running') return;
        ended = true;
        workerFailed(job, worker, err);
      });
    })
    .catch((err) => {
      if (job.state === 'running') workerFailed(job, worker, err);
    });
}

function workerFailed(job: Job, worker: Worker, err: Error): void {
  job.workers.delete(worker);
  worker.req?.destroy();
  if (job.state !== 'running') return;
  if (worker.retries >= MAX_RETRIES) {
    fail(job, err);
    return;
  }
  // Reserve the slot during the back-off so schedule() doesn't hand this segment to someone else.
  const placeholder: Worker = { seg: worker.seg, req: null, retries: worker.retries };
  job.workers.add(placeholder);
  setTimeout(() => {
    job.workers.delete(placeholder);
    if (job.state === 'running') spawn(job, worker.seg, worker.retries + 1);
  }, 1000 * (worker.retries + 1));
}

function tick(job: Job): void {
  const now = Date.now();
  if (now - job.lastSpeedTime >= 500) {
    job.speed = ((job.downloadedBytes - job.lastSpeedBytes) / (now - job.lastSpeedTime)) * 1000;
    job.lastSpeedTime = now;
    job.lastSpeedBytes = job.downloadedBytes;
  }
  if (now - job.lastEmitTime >= 250) {
    job.lastEmitTime = now;
    emit(job);
  }
}

function emit(job: Job): void {
  if (!job.progressCallback) return;
  const left = job.total - job.downloadedBytes;
  job.progressCallback({
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.total,
    speed: job.speed,
    remainingTime: job.speed > 0 ? left / job.speed : null,
    percentage: (job.downloadedBytes / job.total) * 100,
    status: job.state === 'paused' ? 'paused' : 'downloading',
    segments: job.segments.map(s => ({ ...s })),
  });
}

function teardown(job: Job): void {
  for (const w of job.workers) w.req?.destroy();
  job.workers.clear();
  try { fs.closeSync(job.fd); } catch {}
  jobs.delete(job.id);
}

function finish(job: Job): void {
  job.state = 'done';
  emit(job);
  teardown(job);
  try {
    fs.renameSync(job.partPath, job.finalPath);
  } catch (err: any) {
    job.reject(err);
    return;
  }
  job.resolve();
}

function fail(job: Job, err: Error): void {
  if (job.state !== 'running') return;
  job.state = 'failed';
  emit(job);
  teardown(job);
  job.reject(err);
}

/** Stops all connections and keeps the .part file and segment map for resuming. */
export function pauseSegmented(id: string, state: 'paused' | 'stopped' = 'paused'): void {
  const job = jobs.get(id);
  if (!job || job.state !== 'running') return;
  job.state = state;
  emit(job);
  teardown(job);
  job.resolve();
}

export function stopSegmented(id: string): void {
  pauseSegmented(id, 'stopped');
}
