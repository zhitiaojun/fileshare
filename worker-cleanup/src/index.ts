/**
 * FileCodeBox Cleanup Worker
 * Runs on Cron schedule to clean up expired files and incomplete uploads
 */
interface Env {
  DB: D1Database;
  R2: R2Bucket;
  CHUNK_EXPIRE_HOURS: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await cleanupExpiredFiles(env);
    await cleanupIncompleteUploads(env);
    await cleanupExpiredPresignSessions(env);
  },

  // Manual trigger via HTTP
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/cleanup') {
      const expiredCount = await cleanupExpiredFiles(env);
      const incompleteCount = await cleanupIncompleteUploads(env);
      const presignCount = await cleanupExpiredPresignSessions(env);

      return Response.json({
        expiredFilesDeleted: expiredCount,
        incompleteUploadsCleaned: incompleteCount,
        presignSessionsCleaned: presignCount,
        timestamp: new Date().toISOString(),
      });
    }

    // Health check
    return Response.json({
      status: 'ok',
      service: 'filecodebox-cleanup',
      nextRun: 'every 10 minutes',
    });
  },
};

async function cleanupExpiredFiles(env: Env): Promise<number> {
  const now = new Date().toISOString();
  let deletedCount = 0;

  // Find expired files: time-based, count-based, and burn-after-read
  const expiredFiles = await env.DB.prepare(
    `SELECT id, code, file_path, uuid_file_name, is_chunked, upload_id
     FROM file_codes
     WHERE (expired_at IS NOT NULL AND expired_at < ?1)
        OR (expired_count >= 0 AND expired_count <= used_count AND expired_count != -1)
        OR (is_burn_after_read = 1 AND used_count > 0)`
  )
    .bind(now)
    .all<{
      id: number;
      code: string;
      file_path: string | null;
      uuid_file_name: string | null;
      is_chunked: number;
      upload_id: string | null;
    }>();

  for (const file of expiredFiles.results) {
    try {
      // Delete file from R2
      if (file.file_path && file.uuid_file_name) {
        const key = `${file.file_path}/${file.uuid_file_name}`;
        try {
          await env.R2.delete(key);
        } catch {
          // File might already be deleted
        }
      }

      // Clean up chunk data if chunked upload
      if (file.is_chunked === 1 && file.upload_id) {
        await env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?1')
          .bind(file.upload_id)
          .run();
      }

      // Delete DB record
      await env.DB.prepare('DELETE FROM file_codes WHERE id = ?1')
        .bind(file.id)
        .run();

      deletedCount++;
      console.log(`Cleanup: deleted expired file ${file.code} (id=${file.id})`);
    } catch (err) {
      console.error(`Failed to cleanup file id=${file.id}:`, err);
    }
  }

  return deletedCount;
}

async function cleanupIncompleteUploads(env: Env): Promise<number> {
  const chunkExpireHours = parseInt(env.CHUNK_EXPIRE_HOURS || '24', 10);
  const cutoff = new Date(Date.now() - chunkExpireHours * 3600 * 1000).toISOString();
  let deletedCount = 0;

  // Find stale chunk sessions (chunk_index = -1 marks session metadata)
  const staleSessions = await env.DB.prepare(
    `SELECT DISTINCT upload_id, save_path
     FROM upload_chunks
     WHERE created_at < ?1 AND chunk_index = -1`
  )
    .bind(cutoff)
    .all<{ upload_id: string; save_path: string | null }>();

  for (const session of staleSessions.results) {
    try {
      // Clean up R2 chunk files
      if (session.save_path) {
        const chunkPrefix = `${session.save_path}/chunks/${session.upload_id}/`;

        // List and delete all chunk files
        const objects = await env.R2.list({ prefix: chunkPrefix, limit: 100 });
        const keys = objects.objects.map((o) => o.key);
        if (keys.length > 0) {
          await env.R2.delete(keys);
        }
      }

      // Remove all DB records for this session
      await env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?1')
        .bind(session.upload_id)
        .run();

      deletedCount++;
    } catch (err) {
      console.error(`Failed to cleanup upload session ${session.upload_id}:`, err);
    }
  }

  return deletedCount;
}

async function cleanupExpiredPresignSessions(env: Env): Promise<number> {
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    'DELETE FROM presign_upload_sessions WHERE expires_at < ?1'
  )
    .bind(now)
    .run();

  return result.meta?.changes || 0;
}
