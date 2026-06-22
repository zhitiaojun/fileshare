import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { getConfigNumber } from '../lib/db';
import { jsonError } from '../lib/response';

// In-memory rate limit store (global across requests in the same Worker)
// For production, use a Durable Object for strong consistency across edge nodes
interface RateEntry {
  count: number;
  windowStart: number;
}

const ipStore = new Map<string, RateEntry>();

/** Get client IP from request headers */
function getClientIP(request: Request): string {
  // Cloudflare passes the real IP in CF-Connecting-IP
  const cfIP = request.headers.get('CF-Connecting-IP');
  if (cfIP) return cfIP;

  // Fallbacks
  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIP = request.headers.get('X-Real-IP');
  if (realIP) return realIP;

  return '0.0.0.0';
}

// Cleanup runs lazily: when entries exceed threshold, sweep expired ones
let cleanupCounter = 0;
function maybeCleanup(): void {
  cleanupCounter++;
  if (cleanupCounter > 100) {
    cleanupExpiredEntries(5);
    cleanupCounter = 0;
  }
}

function checkRateLimit(
  ip: string,
  maxCount: number,
  windowMinutes: number
): { allowed: boolean; currentCount: number } {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const entry = ipStore.get(ip);

  // Lazy cleanup on every 100th check
  maybeCleanup();

  if (!entry || now - entry.windowStart > windowMs) {
    // New window
    ipStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, currentCount: 1 };
  }

  entry.count++;
  if (entry.count > maxCount) {
    return { allowed: false, currentCount: entry.count };
  }

  return { allowed: true, currentCount: entry.count };
}

/** Remove expired rate limit entries periodically */
function cleanupExpiredEntries(windowMinutes: number): void {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000 * 2; // 2x window for safety

  for (const [ip, entry] of ipStore) {
    if (now - entry.windowStart > windowMs) {
      ipStore.delete(ip);
    }
  }
}

/**
 * Rate limit middleware for uploads.
 * Uses configured uploadMinute/uploadCount settings.
 */
export const uploadRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const ip = getClientIP(c.req.raw);
  const maxCount = await getConfigNumber(c.env.DB, 'uploadCount', c.env, 10);
  const windowMinutes = await getConfigNumber(c.env.DB, 'uploadMinute', c.env, 1);

  const result = checkRateLimit(ip, maxCount, windowMinutes);
  if (!result.allowed) {
    return jsonError(423, `Rate limit exceeded: ${maxCount} uploads per ${windowMinutes} minute(s)`);
  }

  return next();
});

/**
 * Rate limit middleware for error-prone operations (e.g., code guessing).
 * Uses configured errorMinute/errorCount settings.
 */
export const errorRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const ip = getClientIP(c.req.raw);
  const maxCount = await getConfigNumber(c.env.DB, 'errorCount', c.env, 10);
  const windowMinutes = await getConfigNumber(c.env.DB, 'errorMinute', c.env, 1);

  const result = checkRateLimit(ip, maxCount, windowMinutes);
  if (!result.allowed) {
    return jsonError(423, 'Too many attempts, please try again later');
  }

  return next();
});

// Cleanup runs lazily via maybeCleanup() in checkRateLimit
