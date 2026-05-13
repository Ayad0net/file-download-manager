export class SpeedLimiter {
  private bytesThisWindow: number = 0;
  private windowStart: number = Date.now();
  private limit: number = 0;
  private perDownloadLimits: Map<string, number> = new Map();

  setGlobalLimit(bytesPerSecond: number): void {
    this.limit = bytesPerSecond;
  }

  getGlobalLimit(): number {
    return this.limit;
  }

  setDownloadLimit(downloadId: string, bytesPerSecond: number): void {
    if (bytesPerSecond <= 0) {
      this.perDownloadLimits.delete(downloadId);
    } else {
      this.perDownloadLimits.set(downloadId, bytesPerSecond);
    }
  }

  getEffectiveLimit(downloadId: string): number {
    if (this.limit <= 0) {
      return this.perDownloadLimits.get(downloadId) || 0;
    }
    const perDownload = this.perDownloadLimits.get(downloadId) || 0;
    if (perDownload > 0) return Math.min(this.limit, perDownload);
    return this.limit;
  }

  getDelayMs(downloadId: string, bytesRead: number): number {
    const effectiveLimit = this.getEffectiveLimit(downloadId);
    if (effectiveLimit <= 0) return 0;

    this.bytesThisWindow += bytesRead;
    const now = Date.now();
    const elapsed = now - this.windowStart;

    if (elapsed >= 1000) {
      this.bytesThisWindow = bytesRead;
      this.windowStart = now;
      return 0;
    }

    const expectedBytes = (effectiveLimit * elapsed) / 1000;
    if (this.bytesThisWindow > expectedBytes) {
      const waitMs = Math.min(
        (this.bytesThisWindow / effectiveLimit) * 1000 - elapsed,
        1000
      );
      return waitMs > 5 ? waitMs : 0;
    }
    return 0;
  }

  resetWindow(): void {
    this.bytesThisWindow = 0;
    this.windowStart = Date.now();
  }
}

export const speedLimiter = new SpeedLimiter();
