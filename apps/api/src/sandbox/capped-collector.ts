import type { Readable } from 'stream';

export interface CappedCollectorOptions {
  /** Maximum number of bytes to actually retain in memory. */
  capBytes: number;
  /** Fired exactly once, the moment the cap is first crossed. */
  onExceeded?: () => void;
}

/**
 * Consumes a stream's `data` events (Buffer chunks) and enforces a byte cap
 * WHILE STREAMING — never buffers-then-truncates. This is the fix for the
 * uncapped `stdout += d.toString('utf8')` pattern in `SandboxRunnerService.runOnce`
 * (that pattern is a host-memory DoS hole when the child floods stdout).
 *
 * Design:
 *  - Stores `Buffer[]` slices only (NEVER string concatenation) so a multi-byte
 *    UTF-8 codepoint split across chunk boundaries is never corrupted — decoding
 *    happens exactly once, in `text()`, over the fully concatenated bytes.
 *  - `totalSeenBytes` counts every byte the producer ever wrote, INCLUDING bytes
 *    we chose not to store. `storedBytes` counts only what's retained.
 *  - Once the cap is reached we keep the `data` listener attached and keep
 *    draining (pushing nothing) so the producer's pipe never backs up and
 *    blocks — a stalled pipe on a killed-but-not-yet-reaped child can wedge
 *    the whole grading pipeline.
 */
export class CappedCollector {
  private readonly capBytes: number;
  private readonly onExceededCb?: () => void;

  private readonly chunks: Buffer[] = [];
  private storedBytesCount = 0;
  private totalSeenBytesCount = 0;
  private truncatedFlag = false;
  private exceededFired = false;
  private cachedText: string | undefined;

  constructor(options: CappedCollectorOptions) {
    this.capBytes = Math.max(0, options.capBytes);
    this.onExceededCb = options.onExceeded;
  }

  /** Attach to a Readable stream; drains `data` events for the lifetime of the stream. */
  attach(stream: Readable): void {
    stream.on('data', (chunk: Buffer) => this.push(chunk));
  }

  /**
   * Feed one chunk. Exposed directly (not just via `attach`) so unit tests can
   * drive the collector without a real stream.
   */
  push(chunk: Buffer): void {
    this.totalSeenBytesCount += chunk.length;

    const room = this.capBytes - this.storedBytesCount;
    if (room > 0) {
      const slice = chunk.length <= room ? chunk : chunk.subarray(0, room);
      this.chunks.push(slice);
      this.storedBytesCount += slice.length;
      // A materialized text() would now be stale.
      this.cachedText = undefined;
    }

    if (this.totalSeenBytesCount > this.capBytes) {
      this.truncatedFlag = true;
      if (!this.exceededFired) {
        this.exceededFired = true;
        this.onExceededCb?.();
      }
    }
  }

  /** True once total bytes seen exceeded the cap (i.e. some bytes were discarded). */
  get truncated(): boolean {
    return this.truncatedFlag;
  }

  /** Every byte seen so far, including discarded ones. */
  get totalSeenBytes(): number {
    return this.totalSeenBytesCount;
  }

  /** Bytes actually retained (<= capBytes). */
  get storedBytes(): number {
    return this.storedBytesCount;
  }

  /**
   * Materializes the collected bytes as a UTF-8 string via a single
   * `Buffer.concat(...).toString('utf8')` call — decoding once over the full
   * byte sequence keeps split multi-byte codepoints intact. Cached after the
   * first call (re-computed only if more data arrives after a previous read).
   */
  text(): string {
    if (this.cachedText === undefined) {
      this.cachedText = Buffer.concat(this.chunks).toString('utf8');
    }
    return this.cachedText;
  }
}
