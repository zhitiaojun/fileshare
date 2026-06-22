import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../types';
import { getConfig, isInitialized } from '../lib/db';
import { jwtVerify } from '../lib/crypto';
import { jsonError } from '../lib/response';

/**
 * Middleware: checks if system is initialized.
 * If not, returns 428 (Precondition Required) or redirects to /setup.
 */
export const systemInitGuard = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip check for setup-related paths
  if (path === '/setup' || path === '/setup/' || path.startsWith('/api/health')) {
    return next();
  }

  const initialized = await isInitialized(c.env.DB, c.env);
  if (!initialized) {
    // If client wants HTML, serve setup page
    const accept = c.req.header('Accept') || '';
    if (accept.includes('text/html') || accept.includes('*/*')) {
      // Delegate to setup route
      return c.redirect('/setup');
    }
    return jsonError(428, 'System not initialized - please visit /setup');
  }

  return next();
});

/**
 * Middleware: validates admin JWT token.
 * Used for all /api/admin/* routes (except login).
 */
export const adminRequired = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip login endpoint
  if (path === '/api/admin/login') {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError(401, 'Authentication required');
  }

  const token = authHeader.slice(7);
  const jwtSecret = await getConfig(c.env.DB, 'jwt_secret', c.env);

  if (!jwtSecret || jwtSecret === '""') {
    return jsonError(500, 'JWT secret not configured');
  }

  const payload = await jwtVerify(token, jwtSecret.replace(/^"|"$/g, ''));
  if (!payload || !payload.is_admin) {
    return jsonError(401, 'Invalid or expired admin token');
  }

  // Store admin session in context for downstream handlers
  c.set('adminSession', payload);
  return next();
});

/**
 * Middleware: checks if upload is allowed (public or admin).
 */
export const shareAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const openUpload = await getConfig(c.env.DB, 'openUpload', c.env);
  const openUploadNum = parseInt(openUpload, 10);

  // If public upload is enabled, allow
  if (openUploadNum === 1 || !openUpload || openUpload === '""') {
    return next();
  }

  // Otherwise require admin token
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError(403, 'Upload requires authentication');
  }

  const token = authHeader.slice(7);
  const jwtSecret = await getConfig(c.env.DB, 'jwt_secret', c.env);

  if (!jwtSecret || jwtSecret === '""') {
    return jsonError(500, 'JWT secret not configured');
  }

  const payload = await jwtVerify(token, jwtSecret.replace(/^"|"$/g, ''));
  if (!payload || !payload.is_admin) {
    return jsonError(403, 'Invalid or expired admin token');
  }

  return next();
});
