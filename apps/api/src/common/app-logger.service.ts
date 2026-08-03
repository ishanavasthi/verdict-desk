import { Injectable, Logger, LogLevel } from '@nestjs/common';

/**
 * Minimal structured logger. Wraps Nest's Logger and emits a single-line
 * JSON-ish structured record so logs are greppable in aggregation. Intentionally
 * thin for M0 — swap the sink here later without touching call sites.
 */
@Injectable()
export class AppLogger {
  private readonly logger = new Logger('App');

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const payload = meta ? `${message} ${JSON.stringify(meta)}` : message;
    switch (level) {
      case 'error':
        this.logger.error(payload);
        break;
      case 'warn':
        this.logger.warn(payload);
        break;
      case 'debug':
        this.logger.debug(payload);
        break;
      case 'verbose':
        this.logger.verbose(payload);
        break;
      default:
        this.logger.log(payload);
    }
  }

  log(message: string, meta?: Record<string, unknown>): void {
    this.emit('log', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta);
  }
}
