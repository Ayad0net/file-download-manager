#!/usr/bin/env bun
/**
 * Compiles the Bun backend into a standalone binary named the way Tauri's externalBin expects
 * (src-tauri/binaries/dm-backend-<target-triple>[.exe]).
 *
 * The target comes from TAURI_ENV_TARGET_TRIPLE (set by `tauri build --target …`), falling back
 * to the host triple, so cross-builds (e.g. Intel macOS on an Apple Silicon runner) work.
 */
import { mkdirSync } from 'fs';
import path from 'path';

const BUN_TARGETS: Record<string, string> = {
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
};

function hostTriple(): string {
  const out = Bun.spawnSync(['rustc', '-vV']).stdout.toString();
  const match = /^host: (.+)$/m.exec(out);
  if (!match) throw new Error('Could not determine the Rust host triple (is rustc installed?)');
  return match[1].trim();
}

const root = path.resolve(import.meta.dir, '..');
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const bunTarget = BUN_TARGETS[triple];
if (!bunTarget) {
  console.error(`Unsupported target: ${triple}`);
  process.exit(1);
}

const outDir = path.join(root, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, `dm-backend-${triple}${triple.includes('windows') ? '.exe' : ''}`);

const result = Bun.spawnSync(
  ['bun', 'build', 'backend/src/index.ts', '--compile', `--target=${bunTarget}`, '--outfile', outfile],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
);
process.exit(result.exitCode ?? 1);
