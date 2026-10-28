import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { DownloadProgress } from './download-engine.js';

// YouTube / TikTok (and anything else yt-dlp supports) via the external `yt-dlp` binary.
// ffmpeg is optional: without it only pre-merged formats (usually ≤720p on YouTube) are used.

const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|tiktok\.com)$/i;
const EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(process.env.HOME || '', '.local/bin')];

export function isMediaUrl(url: string): boolean {
  try { return MEDIA_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

// GUI apps on macOS get a minimal PATH, so also look in the usual install locations.
function findBinary(name: string, envVar: string): string | null {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(EXTRA_BIN_DIRS);
  for (const dir of dirs) {
    const p = path.join(dir, exe);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

let tools: { ytdlp: string | null; ffmpeg: string | null } | null = null;
function getTools() {
  tools ??= { ytdlp: findBinary('yt-dlp', 'YTDLP_PATH'), ffmpeg: findBinary('ffmpeg', 'FFMPEG_PATH') };
  return tools;
}

function requireYtdlp(): string {
  const bin = getTools().ytdlp;
  if (!bin) throw new Error('yt-dlp is not installed. Install it (e.g. `brew install yt-dlp` or `pip install yt-dlp`) or set YTDLP_PATH.');
  return bin;
}

export interface MediaQuality { id: string; label: string; height: number | null; size: number | null }
export interface MediaProbe {
  title: string;
  isPlaylist: boolean;
  thumbnail: string | null;
  entries: { url: string; title: string; duration: number | null }[];
  qualities: MediaQuality[];
  hasFfmpeg: boolean;
}

const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144];

function runJson(args: string[], timeoutMs = 90_000): Promise<any> {
  const bin = requireYtdlp();
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Timed out reading media info')); }, timeoutMs);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(lastError(err) || `yt-dlp exited with code ${code}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Could not parse media info')); }
    });
  });
}

function lastError(stderr: string): string {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find(l => l.startsWith('ERROR:')) || lines[lines.length - 1] || '';
  return err.replace(/^ERROR:\s*/, '');
}

export async function probeMedia(url: string): Promise<MediaProbe> {
  const info = await runJson(['-J', '--flat-playlist', '--no-warnings', url]);
  const hasFfmpeg = !!getTools().ffmpeg;
  const audio: MediaQuality = { id: 'audio', label: hasFfmpeg ? 'Audio only (MP3)' : 'Audio only', height: null, size: null };

  if (info._type === 'playlist') {
    const entries = (info.entries || []).filter(Boolean).map((e: any) => ({
      url: e.webpage_url || e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : ''),
      title: e.title || e.id || 'Untitled',
      duration: e.duration ?? null,
    })).filter((e: any) => e.url);
    const qualities = [{ id: 'best', label: 'Best available', height: null, size: null },
      ...STANDARD_HEIGHTS.map(h => ({ id: String(h), label: `Up to ${h}p`, height: h, size: null })), audio];
    return { title: info.title || 'Playlist', isPlaylist: true, thumbnail: info.thumbnails?.at(-1)?.url ?? null, entries, qualities, hasFfmpeg };
  }

  const formats: any[] = info.formats || [];
  const size = (f: any) => f?.filesize ?? f?.filesize_approx ?? null;
  const bestAudio = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  const byHeight = new Map<number, number | null>();
  for (const f of formats) {
    if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
    const muxed = f.acodec && f.acodec !== 'none';
    // Without ffmpeg separate video/audio streams cannot be merged.
    if (!hasFfmpeg && !muxed) continue;
    const s = size(f) != null ? size(f) + (muxed ? 0 : size(bestAudio) ?? 0) : null;
    const prev = byHeight.get(f.height);
    if (!byHeight.has(f.height) || (s != null && (prev == null || s > prev))) byHeight.set(f.height, s);
  }
  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  const qualities: MediaQuality[] = heights.map(h => ({ id: String(h), label: `${h}p`, height: h, size: byHeight.get(h) ?? null }));
  if (qualities.length === 0) qualities.push({ id: 'best', label: 'Best available', height: null, size: null });
  audio.size = size(bestAudio);
  qualities.push(audio);

  return {
    title: info.title || 'Video',
    isPlaylist: false,
    thumbnail: info.thumbnail ?? null,
    entries: [{ url: info.webpage_url || url, title: info.title || 'Video', duration: info.duration ?? null }],
    qualities,
    hasFfmpeg,
  };
}

function formatArgs(quality: string): string[] {
  const { ffmpeg } = getTools();
  const loc = ffmpeg ? ['--ffmpeg-location', ffmpeg] : [];
  if (quality === 'audio') {
    return ffmpeg ? [...loc, '-f', 'ba/b', '-x', '--audio-format', 'mp3'] : ['-f', 'ba[ext=m4a]/ba/b'];
  }
  const h = /^\d+$/.test(quality) ? `[height<=${quality}]` : '';
  if (!ffmpeg) return ['-f', `b${h}/b`];
  return [...loc, '-f', `bv*${h}[ext=mp4]+ba[ext=m4a]/bv*${h}+ba/b${h}/b`, '--merge-output-format', 'mp4'];
}

const active = new Map<string, ChildProcess>();

/** Downloads into `dir`; resolves with the final file name. Killing the process (pause/stop) rejects. */
export function startMedia(opts: {
  id: string; url: string; quality: string; dir: string;
  onProgress: (p: DownloadProgress) => void;
}): Promise<string> {
  const bin = requireYtdlp();
  fs.mkdirSync(opts.dir, { recursive: true });
  const args = [
    ...formatArgs(opts.quality),
    '--no-playlist', '--newline', '--progress', '--no-warnings', '--no-mtime', '--continue',
    '--restrict-filenames', '-o', '%(title).150B [%(id)s].%(ext)s',
    '--progress-template', 'download:DMP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--print', 'after_move:DMFILE %(filepath)s',
    opts.url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: opts.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    active.set(opts.id, proc);
    let stderr = '', buf = '', finalPath: string | null = null;
    // Video and audio streams download one after the other; carry finished parts forward.
    let carried = 0, lastDone = 0, lastTotal = 0;

    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('DMFILE ')) { finalPath = line.slice(7).trim(); continue; }
        const m = line.match(/^DMP (\S+) (\S+) (\S+) (\S+) (\S+)/);
        if (!m) continue;
        const num = (s: string) => (s === 'NA' || s === 'None' ? null : Number(s));
        const done = num(m[1]) ?? 0;
        const total = num(m[2]) ?? num(m[3]) ?? 0;
        if (done < lastDone * 0.5 && lastTotal > 0) carried += lastTotal;
        lastDone = done; lastTotal = total;
        const all = carried + total;
        opts.onProgress({
          downloadedBytes: carried + done,
          totalBytes: all || null,
          percentage: all ? Math.min(99.9, ((carried + done) / all) * 100) : 0,
          speed: num(m[4]) ?? 0,
          remainingTime: num(m[5]),
          status: 'downloading',
        });
      }
    });
    proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20_000) stderr = stderr.slice(-10_000); });
    proc.on('error', (e) => { active.delete(opts.id); reject(e); });
    proc.on('close', (code, signal) => {
      active.delete(opts.id);
      if (signal) return reject(new Error('Media download interrupted'));
      if (code !== 0) return reject(new Error(lastError(stderr) || `yt-dlp exited with code ${code}`));
      const name = finalPath ? path.basename(finalPath) : null;
      if (!name) return reject(new Error('yt-dlp finished but reported no file'));
      resolve(name);
    });
  });
}

export function stopMedia(id: string): void {
  const proc = active.get(id);
  if (!proc) return;
  active.delete(id);
  proc.kill('SIGTERM');
}

export function mediaToolsStatus() {
  const t = getTools();
  let version: string | null = null;
  if (t.ytdlp) {
    try { version = spawnSync(t.ytdlp, ['--version'], { timeout: 10_000 }).stdout?.toString().trim() || null; } catch {}
  }
  return { ytdlp: !!t.ytdlp, ytdlpVersion: version, ffmpeg: !!t.ffmpeg };
}
