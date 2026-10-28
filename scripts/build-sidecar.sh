#!/usr/bin/env bash
# Compiles the Bun backend into a standalone binary named the way Tauri's externalBin expects.
set -euo pipefail
cd "$(dirname "$0")/.."
TRIPLE="${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$TRIPLE" in
  aarch64-apple-darwin)       BUN_TARGET=bun-darwin-arm64 ;;
  x86_64-apple-darwin)        BUN_TARGET=bun-darwin-x64 ;;
  x86_64-unknown-linux-gnu)   BUN_TARGET=bun-linux-x64 ;;
  aarch64-unknown-linux-gnu)  BUN_TARGET=bun-linux-arm64 ;;
  x86_64-pc-windows-msvc)     BUN_TARGET=bun-windows-x64 ;;
  *) echo "Unsupported target: $TRIPLE" >&2; exit 1 ;;
esac
EXT=""; [[ "$TRIPLE" == *windows* ]] && EXT=".exe"
mkdir -p src-tauri/binaries
bun build backend/src/index.ts --compile --target="$BUN_TARGET" --outfile "src-tauri/binaries/dm-backend-$TRIPLE$EXT"
