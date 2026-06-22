import type { R2Bucket, D1Database } from '@cloudflare/workers-types';

// ---- File operations on R2 ----

/** Save an uploaded file to R2 */
export async function saveFile(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | Uint8Array | ReadableStream,
  contentType?: string
): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

/** Get a file from R2 */
export async function getFile(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/** Delete a file from R2 */
export async function deleteFile(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/** Delete multiple files from R2 (by prefix) */
export async function deleteFilesByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const objects = await bucket.list({ prefix });
  const keys = objects.objects.map((o) => o.key);

  if (keys.length > 0) {
    await bucket.delete(keys);
  }

  // Handle pagination if there are more objects
  if (objects.truncated) {
    let cursor: string | undefined = objects.cursor;
    while (cursor) {
      const next = await bucket.list({ prefix, cursor });
      const nextKeys = next.objects.map((o) => o.key);
      if (nextKeys.length > 0) {
        await bucket.delete(nextKeys);
      }
      cursor = next.truncated ? next.cursor : undefined;
    }
  }
}

/** Check if a file exists in R2 */
export async function fileExists(bucket: R2Bucket, key: string): Promise<boolean> {
  const obj = await bucket.head(key);
  return obj !== null;
}

/** Generate a storage path for a new file */
export function generateStoragePath(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const uuid = crypto.randomUUID();
  return `share/data/${year}/${month}/${day}/${uuid}`;
}

/** Build the full R2 object key for a file */
export function buildObjectKey(savePath: string, uuidFileName: string): string {
  return `${savePath}/${uuidFileName}`;
}

/** Get file content as streaming Response */
export function streamFileResponse(obj: R2ObjectBody, filename?: string): Response {
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');

  if (filename) {
    const encoded = encodeURIComponent(filename);
    headers.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encoded}; filename="${filename}"`
    );
  }

  return new Response(obj.body, { headers });
}

/** Get file content as text */
export async function getFileText(bucket: R2Bucket, key: string): Promise<string | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.text();
}

// ---- R2 Storage Cap (5GB auto-cleanup) ----

const STORAGE_CAP_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

interface OldestFile {
  id: number;
  code: string;
  file_path: string | null;
  uuid_file_name: string | null;
  size: number;
  created_at: string;
}

/**
 * Enforce R2 storage cap: if total exceeds 5GB, delete oldest files.
 * Called on every upload. Returns number of files deleted.
 */
export async function enforceStorageCap(
  bucket: R2Bucket,
  db: D1Database,
  newFileSize: number
): Promise<number> {
  // Get total current storage
  const totalResult = await db
    .prepare('SELECT COALESCE(SUM(size), 0) as total FROM file_codes')
    .first<{ total: number }>();

  const currentTotal = (totalResult?.total || 0) + newFileSize;

  if (currentTotal <= STORAGE_CAP_BYTES) {
    return 0; // Under cap, no cleanup needed
  }

  // Calculate how much we need to free
  const excess = currentTotal - STORAGE_CAP_BYTES;
  console.log(`Storage cap exceeded: ${(currentTotal/1024/1024/1024).toFixed(2)}GB used, need to free ${(excess/1024/1024).toFixed(1)}MB`);

  // Find oldest files (by created_at) — NOT text shares, NOT burn-after-read (they auto-clean)
  const oldestFiles = await db
    .prepare(
      `SELECT id, code, file_path, uuid_file_name, size, created_at
       FROM file_codes
       WHERE file_path IS NOT NULL
         AND is_burn_after_read = 0
       ORDER BY created_at ASC
       LIMIT 100`
    )
    .all<OldestFile>();

  if (oldestFiles.results.length === 0) {
    console.log('No files to delete for storage cap enforcement');
    return 0;
  }

  let freed = 0;
  let deleted = 0;

  for (const file of oldestFiles.results) {
    if (freed >= excess) break;

    try {
      // Delete from R2
      if (file.file_path && file.uuid_file_name) {
        const key = `${file.file_path}/${file.uuid_file_name}`;
        try {
          await bucket.delete(key);
        } catch { /* file may already be gone */ }
      }

      // Delete from D1
      await db.prepare('DELETE FROM file_codes WHERE id = ?1')
        .bind(file.id)
        .run();

      freed += file.size;
      deleted++;
      console.log(`Storage cap: deleted old file ${file.code} (${(file.size/1024/1024).toFixed(1)}MB, created ${file.created_at})`);
    } catch (err) {
      console.error(`Failed to delete file id=${file.id} for storage cap:`, err);
    }
  }

  console.log(`Storage cap cleanup: deleted ${deleted} files, freed ${(freed/1024/1024).toFixed(1)}MB`);
  return deleted;
}

