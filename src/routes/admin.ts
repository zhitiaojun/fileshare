/**
 * Admin API routes
 * Dashboard, file management, config management, activity log
 */
import { Hono } from 'hono';
import type { Env, AppVariables, FileCodeRecord } from '../types';
import { getConfig, getConfigs, getAllConfig, setConfigs, isInitialized } from '../lib/db';
import { verifyPasswordAsync, hashPasswordAsync, jwtSign } from '../lib/crypto';
import { deleteFile, buildObjectKey } from '../lib/storage';
import { loginSchema } from '../lib/validators';
import { jsonSuccess, jsonError } from '../lib/response';
import { adminRequired } from '../middleware/auth';

const adminApi = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// =============================================
// POST /api/admin/login - Admin login
// =============================================
adminApi.post('/login', async (c) => {
  const body = await c.req.json<{ password: string }>();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(400, parsed.error.errors[0]?.message || 'Invalid input');
  }

  const adminToken = await getConfig(c.env.DB, 'admin_token', c.env);

  if (!adminToken || adminToken === '""') {
    return jsonError(401, 'System not initialized');
  }

  const valid = await verifyPasswordAsync(parsed.data.password, adminToken.replace(/^"|"$/g, ''));
  if (!valid) {
    return jsonError(401, 'Invalid password');
  }

  const jwtSecret = await getConfig(c.env.DB, 'jwt_secret', c.env);
  const secret = jwtSecret.replace(/^"|"$/g, '');

  if (!secret) {
    return jsonError(500, 'JWT secret not configured');
  }

  const token = await jwtSign({ is_admin: true }, secret, 720);

  return jsonSuccess({
    token,
    token_type: 'Bearer',
  });
});

// =============================================
// GET /api/admin/verify - Verify admin session
// =============================================
adminApi.get('/verify', adminRequired, async (c) => {
  const session = c.get('adminSession');
  return jsonSuccess({ is_admin: true, ...(session || {}) });
});

// =============================================
// POST /api/admin/logout
// =============================================
adminApi.post('/logout', adminRequired, async (c) => {
  return jsonSuccess({ ok: true });
});

// =============================================
// GET /api/admin/dashboard - Dashboard statistics
// =============================================
adminApi.get('/dashboard', adminRequired, async (c) => {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString();

  // Total files
  const totalResult = await c.env.DB.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM file_codes').first<{ count: number; totalSize: number }>();

  // Active (non-expired, non-burned) files
  const activeResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM file_codes
     WHERE (expired_at IS NULL OR expired_at > ?)
       AND (is_burn_after_read = 0 OR used_count = 0)
       AND (expired_count < 0 OR expired_count > used_count)`
  ).bind(now).first<{ count: number }>();

  // Expired files
  const expiredResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM file_codes
     WHERE (expired_at IS NOT NULL AND expired_at <= ?)
        OR (expired_count >= 0 AND expired_count <= used_count)
        OR (is_burn_after_read = 1 AND used_count > 0)`
  ).bind(now).first<{ count: number }>();

  // Text vs File count
  const textCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM file_codes WHERE prefix = 'Text' AND suffix = 'txt'"
  ).first<{ count: number }>();

  // Chunked count
  const chunkedCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM file_codes WHERE is_chunked = 1'
  ).first<{ count: number }>();

  // Today's uploads
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM file_codes WHERE created_at >= ?'
  ).bind(todayStart.toISOString()).first<{ count: number; totalSize: number }>();

  // Yesterday's uploads
  const yesterdayStart = new Date(Date.now() - 86400 * 1000);
  yesterdayStart.setHours(0, 0, 0, 0);
  const yesterdayResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM file_codes WHERE created_at >= ? AND created_at < ?'
  ).bind(yesterdayStart.toISOString(), todayStart.toISOString()).first<{ count: number; totalSize: number }>();

  // Top extensions
  const topExts = await c.env.DB.prepare(
    `SELECT suffix, COUNT(*) as count FROM file_codes
     WHERE suffix != '' AND suffix != 'txt' AND prefix != 'Text'
     GROUP BY suffix ORDER BY count DESC LIMIT 8`
  ).all<{ suffix: string; count: number }>();

  // Recent files
  const recentFiles = await c.env.DB.prepare(
    'SELECT * FROM file_codes ORDER BY created_at DESC LIMIT 8'
  ).all<FileCodeRecord>();

  // Config values
  const uploadSize = await getConfig(c.env.DB, 'uploadSize', c.env);
  const openUpload = await getConfig(c.env.DB, 'openUpload', c.env);

  return jsonSuccess({
    totalFiles: totalResult?.count || 0,
    totalStorage: totalResult?.totalSize || 0,
    activeCount: activeResult?.count || 0,
    expiredCount: expiredResult?.count || 0,
    textCount: textCount?.count || 0,
    fileCount: (totalResult?.count || 0) - (textCount?.count || 0),
    chunkedCount: chunkedCount?.count || 0,
    todayCount: todayResult?.count || 0,
    todaySize: todayResult?.totalSize || 0,
    yesterdayCount: yesterdayResult?.count || 0,
    yesterdaySize: yesterdayResult?.totalSize || 0,
    topExtensions: topExts.results,
    recentFiles: recentFiles.results.slice(0, 8).map(buildAdminFileItem),
    uploadSize: parseInt(uploadSize, 10) || 10 * 1024 * 1024,
    openUpload: parseInt(openUpload, 10) === 1,
  });
});

// Helper to build admin file item
function buildAdminFileItem(file: FileCodeRecord) {
  return {
    id: file.id,
    code: file.code,
    name: `${file.prefix}${file.suffix ? '.' + file.suffix : ''}`,
    size: file.size,
    is_text: file.prefix === 'Text' && file.suffix === 'txt',
    is_chunked: file.is_chunked === 1,
    is_encrypted: file.encrypted === 1,
    is_burn_after_read: file.is_burn_after_read === 1,
    expire_style: file.expire_style,
    expired_at: file.expired_at,
    expired_count: file.expired_count,
    used_count: file.used_count,
    created_at: file.created_at,
    is_expired: file.expired_at ? new Date(file.expired_at) < new Date() : false,
    remaining_downloads: file.expired_count < 0 ? -1 : Math.max(0, file.expired_count - file.used_count),
  };
}

// =============================================
// GET /api/admin/files - List files with filters
// =============================================
adminApi.get('/files', adminRequired, async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const size = Math.min(100, Math.max(1, parseInt(c.req.query('size') || '20', 10)));
  const keyword = c.req.query('keyword') || '';
  const status = c.req.query('status') || ''; // active | expired
  const type = c.req.query('type') || ''; // text | file | chunked
  const sortBy = c.req.query('sortBy') || 'created_at';
  const sortOrder = c.req.query('sortOrder') || 'DESC';

  // Build query
  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  if (keyword) {
    whereClause += ' AND (code LIKE ? OR prefix LIKE ? OR suffix LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }

  const now = new Date().toISOString();
  if (status === 'active') {
    whereClause += ' AND (expired_at IS NULL OR expired_at > ?) AND (is_burn_after_read = 0 OR used_count = 0)';
    params.push(now);
  } else if (status === 'expired') {
    whereClause += ' AND ((expired_at IS NOT NULL AND expired_at <= ?) OR (is_burn_after_read = 1 AND used_count > 0))';
    params.push(now);
  }

  if (type === 'text') {
    whereClause += " AND prefix = 'Text' AND suffix = 'txt'";
  } else if (type === 'file') {
    whereClause += " AND NOT (prefix = 'Text' AND suffix = 'txt') AND is_chunked = 0";
  } else if (type === 'chunked') {
    whereClause += ' AND is_chunked = 1';
  }

  // Safe sort column
  const allowedSorts = ['created_at', 'size', 'used_count', 'expired_at', 'code'];
  const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
  const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Count total
  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM file_codes ${whereClause}`
  )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count || 0;

  // Get page
  const offset = (page - 1) * size;
  const files = await c.env.DB.prepare(
    `SELECT * FROM file_codes ${whereClause} ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`
  )
    .bind(...params, size, offset)
    .all<FileCodeRecord>();

  return jsonSuccess({
    page,
    size,
    total,
    data: files.results.map(buildAdminFileItem),
  });
});

// =============================================
// GET /api/admin/files/:id - Get file detail
// =============================================
adminApi.get('/files/:id', adminRequired, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return jsonError(400, 'Invalid file ID');

  const file = await c.env.DB.prepare('SELECT * FROM file_codes WHERE id = ?').bind(id).first<FileCodeRecord>();
  if (!file) return jsonError(404, 'File not found');

  const item = buildAdminFileItem(file);

  return jsonSuccess({
    ...item,
    file_path: file.file_path,
    uuid_file_name: file.uuid_file_name,
    file_hash: file.file_hash,
    text: file.text ? file.text.substring(0, 4000) : null,
    encrypted: file.encrypted === 1,
    encryption_iv: file.encryption_iv,
    encryption_salt: file.encryption_salt,
    is_folder: file.is_folder === 1,
    folder_manifest: file.folder_manifest ? JSON.parse(file.folder_manifest) : null,
  });
});

// =============================================
// DELETE /api/admin/files/:id - Delete file
// =============================================
adminApi.delete('/files/:id', adminRequired, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return jsonError(400, 'Invalid file ID');

  const file = await c.env.DB.prepare('SELECT * FROM file_codes WHERE id = ?').bind(id).first<FileCodeRecord>();
  if (!file) return jsonError(404, 'File not found');

  // Delete from R2
  if (file.file_path && file.uuid_file_name) {
    const objectKey = buildObjectKey(file.file_path, file.uuid_file_name);
    try {
      await deleteFile(c.env.R2, objectKey);
    } catch {
      // R2 deletion failure shouldn't block DB cleanup
    }
  }

  // Delete DB record
  await c.env.DB.prepare('DELETE FROM file_codes WHERE id = ?').bind(id).run();

  // Log activity
  await c.env.DB.prepare(
    "INSERT INTO admin_activities (action, target_type, target_id, target_name, created_at) VALUES ('delete', 'file', ?, ?, datetime('now'))"
  )
    .bind(id, `${file.prefix}.${file.suffix}`)
    .run();

  return jsonSuccess({ deleted: id });
});

// =============================================
// POST /api/admin/files/batch-delete - Batch delete
// =============================================
adminApi.post('/files/batch-delete', adminRequired, async (c) => {
  const body = await c.req.json<{ ids: number[] }>();
  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return jsonError(400, 'No file IDs provided');
  }

  let deleted = 0;
  for (const id of body.ids) {
    const file = await c.env.DB.prepare('SELECT * FROM file_codes WHERE id = ?').bind(id).first<FileCodeRecord>();
    if (!file) continue;

    if (file.file_path && file.uuid_file_name) {
      const objectKey = buildObjectKey(file.file_path, file.uuid_file_name);
      try { await deleteFile(c.env.R2, objectKey); } catch { /* ignore */ }
    }

    await c.env.DB.prepare('DELETE FROM file_codes WHERE id = ?').bind(id).run();
    deleted++;
  }

  return jsonSuccess({ deleted });
});

// =============================================
// PATCH /api/admin/files/batch-update - Batch update
// =============================================
adminApi.patch('/files/batch-update', adminRequired, async (c) => {
  const body = await c.req.json<{ ids: number[]; expired_at?: string; expired_count?: number }>();
  if (!body.ids || !Array.isArray(body.ids)) {
    return jsonError(400, 'No file IDs provided');
  }

  let updated = 0;
  for (const id of body.ids) {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.expired_at !== undefined) {
      updates.push('expired_at = ?');
      params.push(body.expired_at);
    }
    if (body.expired_count !== undefined) {
      updates.push('expired_count = ?');
      params.push(body.expired_count);
    }

    if (updates.length > 0) {
      params.push(id);
      await c.env.DB.prepare(
        `UPDATE file_codes SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
      )
        .bind(...params)
        .run();
      updated++;
    }
  }

  return jsonSuccess({ updated });
});

// =============================================
// PATCH /api/admin/file/policy-action - Quick policy action
// =============================================
adminApi.patch('/file/policy-action', adminRequired, async (c) => {
  const body = await c.req.json<{ id: number; action: string; downloadLimit?: number }>();
  const file = await c.env.DB.prepare('SELECT * FROM file_codes WHERE id = ?').bind(body.id).first<FileCodeRecord>();
  if (!file) return jsonError(404, 'File not found');

  const now = new Date();

  switch (body.action) {
    case 'extend_24h': {
      const newExpiry = file.expired_at
        ? new Date(Math.max(new Date(file.expired_at).getTime(), now.getTime()) + 86400 * 1000).toISOString()
        : new Date(now.getTime() + 86400 * 1000).toISOString();
      await c.env.DB.prepare("UPDATE file_codes SET expired_at = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(newExpiry, body.id).run();
      break;
    }
    case 'extend_7d': {
      const newExpiry = file.expired_at
        ? new Date(Math.max(new Date(file.expired_at).getTime(), now.getTime()) + 7 * 86400 * 1000).toISOString()
        : new Date(now.getTime() + 7 * 86400 * 1000).toISOString();
      await c.env.DB.prepare("UPDATE file_codes SET expired_at = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(newExpiry, body.id).run();
      break;
    }
    case 'make_permanent':
      await c.env.DB.prepare("UPDATE file_codes SET expired_at = NULL, expired_count = -1, updated_at = datetime('now') WHERE id = ?")
        .bind(body.id).run();
      break;
    case 'reset_download_limit': {
      const limit = body.downloadLimit || 5;
      await c.env.DB.prepare("UPDATE file_codes SET expired_count = ?, used_count = 0, updated_at = datetime('now') WHERE id = ?")
        .bind(limit, body.id).run();
      break;
    }
    default:
      return jsonError(400, `Unknown action: ${body.action}`);
  }

  return jsonSuccess({ ok: true, action: body.action });
});

// =============================================
// GET /api/admin/config - Get all config
// =============================================
adminApi.get('/config', adminRequired, async (c) => {
  const config = await getAllConfig(c.env.DB, c.env);
  return jsonSuccess(config);
});

// =============================================
// PATCH /api/admin/config - Update config
// =============================================
adminApi.patch('/config', adminRequired, async (c) => {
  const body = await c.req.json<Record<string, string>>();
  if (!body || Object.keys(body).length === 0) {
    return jsonError(400, 'No config values provided');
  }

  const entries: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    // Handle password hashing
    if (key === 'admin_token' && value && !value.startsWith('sha256$') && value !== '""') {
      const hashed = await hashPasswordAsync(value);
      entries[key] = `"${hashed}"`;

      // Rotate JWT secret on password change
      const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      entries['jwt_secret'] = `"${newSecret}"`;
    } else {
      entries[key] = value;
    }
  }

  await setConfigs(c.env.DB, entries, c.env);

  return jsonSuccess({ updated: Object.keys(body) });
});

// =============================================
// GET /api/admin/activities - Recent activity log
// =============================================
adminApi.get('/activities', adminRequired, async (c) => {
  const limit = Math.min(100, parseInt(c.req.query('limit') || '20', 10));

  const activities = await c.env.DB.prepare(
    'SELECT * FROM admin_activities ORDER BY created_at DESC LIMIT ?'
  )
    .bind(limit)
    .all();

  return jsonSuccess(activities.results);
});

export default adminApi;
