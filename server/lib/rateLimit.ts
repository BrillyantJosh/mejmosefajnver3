import type { Request, Response, NextFunction } from 'express';

/**
 * A small fixed-window limiter, for the handful of routes where one caller can
 * spend real money or real CPU on everyone else's behalf.
 *
 * Written rather than installed on purpose: this is a live app, and a limiter
 * is a thing that decides whether a request is served at all. Twelve lines we
 * can read and test beat a dependency whose defaults we would have to audit.
 *
 * ⚠ WHERE IT MUST NOT GO. Twice in this fleet a limiter has taken an app down
 * by sitting too far forward: once in front of the static files, so a person
 * clicking around got a blank page instead of the app, and once broad enough
 * that the JavaScript bundle itself started coming back 429 — the app could
 * not load, so it could not stop asking. Mount this on specific API routers.
 * Never app-wide, never before express.static.
 */

interface Window { count: number; resetAt: number; }

export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  max: number;
  windowMs: number;
  /** Defaults to the caller's IP. */
  keyOf?: (req: Request) => string;
  /** Shown to the caller. Say what to do, not just "no". */
  message?: string;
}

export function createRateLimit(opts: RateLimitOptions) {
  const { max, windowMs, keyOf, message } = opts;
  const windows = new Map<string, Window>();

  // Without this the map is a slow leak keyed by every IP ever seen.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }, Math.max(windowMs, 60_000));
  sweeper.unref?.();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = keyOf ? keyOf(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const w = windows.get(key);

    if (!w || w.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    w.count++;
    if (w.count > max) {
      const retryAfter = Math.ceil((w.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || 'Too many requests',
        retry_after_s: retryAfter,
      });
    }
    return next();
  };
}

/** For tests. */
export function __resetRateLimitState() { /* windows are per-instance */ }
