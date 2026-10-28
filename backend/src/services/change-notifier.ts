// Monotonic version bumped on every state change; SSE clients push a snapshot when it moves.
let version = 0;

export function markChanged(): void {
  version++;
}

export function getVersion(): number {
  return version;
}
