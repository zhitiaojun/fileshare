/**
 * Background cleanup tasks triggered by Cron
 * Replaces the Python asyncio background tasks
 */
import type { Env } from '../types';
import { deleteFile } from './storage';

/** Clean up expired files - runs every 10 minutes via Cron trigger */
export async function cleanupExpiredFiles(env: Env): Promise<number> {
  const now = new Date().toISOString();
  let deletedCount = 0;

  // Find expired files (time-based expiry AND count-based expiry)
  const expiredFiles = await env.DB.prepare(
    `SELECT * FROM file_codes
     WHERE (expired_at IS NOT NULL AND expired_at < ?)
        OR (expired_count = 0 AND used_count > 0)
        OR (is_burn_after_read = 1 AND used_count > 0)`
  )
    .bind(now)
    .all<{
      id: number;
      code: string;
      file_path: string;
      uuid_file_name: string;
      is_chunked: number;
    }>();

  for (const file of expiredFiles.results) {
    try {
      // Delete file from R2
      if (file.file_path && file.uuid_file_name) {
        const key = `${file.file_path}/${file.uuid_file_name}`;
        await deleteFile(env.R2, key);
      }

      // If chunked upload, also clean up chunks
      if (file.is_chunked) {
        await env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = (SELECT upload_id FROM file_codes WHERE id = ?)')
          .bind(file.id)
          .run();
      }

      // Delete DB record
      await env.DB.prepare('DELETE FROM file_codes WHERE id = ?')
        .bind(file.id)
        .run();

      deletedCount++;
    } catch (err) {
      console.error(`Failed to cleanup file ${file.code}:`, err);
    }
  }

  return deletedCount;
}

/** Clean up stale incomplete uploads - runs every hour */
export async function cleanupIncompleteUploads(env: Env): Promise<number> {
  const chunkExpireHours = parseInt(env.CHUNK_EXPIRE_HOURS || '24', 10);
  const cutoff = new Date(Date.now() - chunkExpireHours * 3600 * 1000).toISOString();
  let deletedCount = 0;

  // Find stale chunk sessions
  const staleSessions = await env.DB.prepare(
    `SELECT DISTINCT upload_id, save_path
     FROM upload_chunks
     WHERE created_at < ? AND chunk_index = -1`
  )
    .bind(cutoff)
    .all<{ upload_id: string; save_path: string | null }>();

  for (const session of staleSessions.results) {
    try {
      // Clean up R2 chunk files
      if (session.save_path) {
        await env.R2.delete(session.save_path + '/chunks/');
      }

      // Remove DB records
      await env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?')
        .bind(session.upload_id)
        .run();

      deletedCount++;
    } catch (err) {
      console.error(`Failed to cleanup upload session ${session.upload_id}:`, err);
    }
  }

  // Also clean up expired presign sessions
  const now = new Date().toISOString();
  const expiredSessions = await env.DB.prepare(
    'DELETE FROM presign_upload_sessions WHERE expires_at < ?'
  )
    .bind(now)
    .run();

  return deletedCount + (expiredSessions.meta?.changes || 0);
}

/** Main cron handler - called by the Cron trigger */
export async function handleCron(env: Env): Promise<Response> {
  const expiredCount = await cleanupExpiredFiles(env);
  const incompleteCount = await cleanupIncompleteUploads(env);

  console.log(`Cron cleanup: ${expiredCount} expired files, ${incompleteCount} incomplete uploads cleaned`);

  return Response.json({
    expiredFilesCleaned: expiredCount,
    incompleteUploadsCleaned: incompleteCount,
  });
}
