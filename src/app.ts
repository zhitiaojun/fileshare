/**
 * FileShare - Shared Hono App
 * Contains all API routes, middleware, and setup page
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppVariables } from './types';
import { isInitialized } from './lib/db';
import { jsonSuccess, jsonError } from './lib/response';
import { handleCron } from './lib/cleanup';

// Import routes
import shareApi from './routes/share';
import chunkApi from './routes/chunk';
import adminApi from './routes/admin';
import setupApi from './routes/setup';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// =============================================
// CORS Middleware
// =============================================
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Disposition', 'Content-Type'],
  maxAge: 86400,
}));

// =============================================
// System Initialization Guard
// =============================================
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;

  if (path === '/setup' || path === '/setup/' || path === '/api/health' || path === '/favicon.ico') {
    return next();
  }

  if (path === '/api/v1/config' || path === '/') {
    return next();
  }

  const init = await isInitialized(c.env.DB, c.env);
  if (!init) {
    const accept = c.req.header('Accept') || '';
    if (path.startsWith('/api/')) {
      return jsonError(428, 'System not initialized - please visit /setup');
    }
    return c.redirect('/setup');
  }

  return next();
});

// =============================================
// Route registration
// =============================================

app.route('/api/share', shareApi);
app.route('/api/chunk', chunkApi);
app.route('/api/admin', adminApi);
app.route('/setup', setupApi);

// =============================================
// Public API endpoints
// =============================================

app.get('/api/health', (c) => {
  return jsonSuccess({
    status: 'ok',
    version: '3.0.0',
    storage: 'r2',
    runtime: 'cloudflare-pages',
  });
});

app.get('/api/v1/config', async (c) => {
  const { getConfigs } = await import('./lib/db');
  const keys = ['name', 'description', 'keywords', 'uploadSize', 'allowed_file_types', 'expireStyle', 'enableChunk', 'openUpload', 'notify_title', 'notify_content', 'showAdminAddr', 'max_save_seconds', 'page_explain'];
  const configs = await getConfigs(c.env.DB, keys, c.env);

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const val = configs.get(key) || '';
    try { result[key] = JSON.parse(val); } catch { result[key] = val; }
  }

  return jsonSuccess({ ...result, version: '3.0.0' });
});

// =============================================
// Public stats (no auth required)
// =============================================
app.get('/api/stats', async (c) => {
  const now = new Date().toISOString();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [total, active, todayCount, totalSize] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM file_codes').first<{c:number}>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM file_codes WHERE (expired_at IS NULL OR expired_at > ?1) AND (is_burn_after_read = 0 OR used_count = 0) AND (expired_count < 0 OR expired_count > used_count)`).bind(now).first<{c:number}>(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM file_codes WHERE created_at >= ?1').bind(today.toISOString()).first<{c:number}>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(size), 0) as s FROM file_codes').first<{s:number}>(),
  ]);

  return jsonSuccess({
    totalFiles: total?.c || 0,
    activeFiles: active?.c || 0,
    todayFiles: todayCount?.c || 0,
    totalStorage: totalSize?.s || 0,
  });
});

// =============================================
// Robots.txt
// =============================================
app.get('/robots.txt', async (c) => {
  const { getConfig } = await import('./lib/db');
  const robotsText = await getConfig(c.env.DB, 'robotsText', c.env);
  const text = robotsText.replace(/^"|"$/g, '') || 'User-agent: *\nDisallow: /';
  return new Response(text, { headers: { 'Content-Type': 'text/plain' } });
});

// =============================================
// Cron cleanup trigger
// =============================================
app.get('/api/__cron__/cleanup', async (c) => {
  const result = await handleCron(c.env);
  return result;
});

export default app;
