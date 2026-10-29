import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { markChanged } from '../services/change-notifier.js';
// Embedded into the binary by `bun build --compile`; resolves to node_modules in dev.
import wasmPath from 'sql.js/dist/sql-wasm.wasm' with { type: 'file' };

export const DATA_DIR = process.env.DATA_DIR || path.resolve(import.meta.dir, '..', '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'downloads.db');

let db: SqlJsDatabase;

export async function initDatabase(): Promise<SqlJsDatabase> {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress REAL DEFAULT 0,
      downloaded_bytes INTEGER DEFAULT 0,
      total_bytes INTEGER,
      speed REAL DEFAULT 0,
      remaining_time REAL,
      created_at TEXT NOT NULL,
      queue_order INTEGER NOT NULL DEFAULT 0,
      speed_limit INTEGER,
      error_message TEXT,
      file_path TEXT
    )
  `);

  // Migration: JSON segment map for multi-connection downloads.
  const cols = db.exec('PRAGMA table_info(downloads)')[0]?.values.map(r => r[1]) || [];
  if (!cols.includes('segments')) db.run('ALTER TABLE downloads ADD COLUMN segments TEXT');
  // Migration: torrent support.
  const added: [string, string][] = [
    ['kind', "TEXT NOT NULL DEFAULT 'http'"],
    ['torrent_file', 'TEXT'],
    ['info_hash', 'TEXT'],
    ['peers', 'INTEGER'],
    ['upload_speed', 'REAL'],
    ['torrent_files', 'TEXT'],
    // yt-dlp media downloads: chosen quality ('best', 'audio' or a max height).
    ['media_quality', 'TEXT'],
  ];
  for (const [name, type] of added) {
    if (!cols.includes(name)) db.run(`ALTER TABLE downloads ADD COLUMN ${name} ${type}`);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Pairing keys were removed in 1.10.
  db.run("DELETE FROM settings WHERE key = 'pairing_key'");

  save();
  return db;
}

export function getDb(): SqlJsDatabase {
  return db;
}

export function save(): void {
  if (!db) return;
  markChanged();
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}
