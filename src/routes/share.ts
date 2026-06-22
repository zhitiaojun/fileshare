/**
 * File/Text share routes
 * Handles upload, metadata, download with encryption, burn-after-read, folder, ZIP support
 */
import { Hono } from 'hono';
import type { Env, AppVariables, FileCodeRecord, ShareInput, ExpireStyle } from '../types';
import { getConfig, getConfigJSON, getConfigNumber } from '../lib/db';
import { saveFile, getFile, deleteFile, deleteFilesByPrefix, generateStoragePath, buildObjectKey, streamFileResponse, getFileText, fileExists, enforceStorageCap } from '../lib/storage';
import { generateCode, normalizeCode } from '../lib/code';
import { sha256Hex } from '../lib/crypto';
import { shareTextSchema, shareFileSchema, selectCodeSchema } from '../lib/validators';
import { jsonSuccess, jsonError } from '../lib/response';
import { shareAuth } from '../middleware/auth';
import { uploadRateLimit, errorRateLimit } from '../middleware/ratelimit';
import { createZipStreamResponse, isZipSizeExceeded } from '../lib/zip';

const shareApi = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---- Expiry computation ----
function computeExpiry(
  expireValue: number,
  expireStyle: ExpireStyle,
  expireAtDatetime?: string
): { expiredAt: string | null; expiredCount: number; usedCount: number } {
  const now = new Date();

  switch (expireStyle) {
    case 'minute':
      return {
        expiredAt: new Date(now.getTime() + expireValue * 60 * 1000).toISOString(),
        expiredCount: 0,
        usedCount: 0,
      };
    case 'hour':
      return {
        expiredAt: new Date(now.getTime() + expireValue * 3600 * 1000).toISOString(),
        expiredCount: 0,
        usedCount: 0,
      };
    case 'day':
      return {
        expiredAt: new Date(now.getTime() + expireValue * 86400 * 1000).toISOString(),
        expiredCount: 0,
        usedCount: 0,
      };
    case 'count':
      return {
        expiredAt: null,
        expiredCount: expireValue,
        usedCount: 0,
      };
    case 'forever':
      return {
        expiredAt: null,
        expiredCount: -1, // -1 means unlimited
        usedCount: 0,
      };
    case 'datetime':
      const dt = expireAtDatetime ? new Date(expireAtDatetime) : new Date(now.getTime() + 86400 * 1000);
      // Clamp to max_save_seconds if set
      return {
        expiredAt: dt.toISOString(),
        expiredCount: 0,
        usedCount: 0,
      };
    case 'burn':
      return {
        expiredAt: null,
        expiredCount: 1, // Only 1 download allowed
        usedCount: 0,
      };
    default:
      return {
        expiredAt: new Date(now.getTime() + 86400 * 1000).toISOString(),
        expiredCount: 0,
        usedCount: 0,
      };
  }
}

function clampMaxSaveSeconds(expiredAt: string | null, maxSaveSeconds: number): string | null {
  if (!expiredAt || maxSaveSeconds <= 0) return expiredAt;

  const maxExpiry = new Date(Date.now() + maxSaveSeconds * 1000).toISOString();
  return expiredAt > maxExpiry ? maxExpiry : expiredAt;
}

function validateFileType(fileName: string, allowedTypes: string[]): boolean {
  if (allowedTypes.length === 0 || allowedTypes.includes('*')) return true;

  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  for (const at of allowedTypes) {
    if (at === '*') return true;
    if (at.startsWith('.') && `.${ext}` === at.toLowerCase()) return true;
    if (at.includes('/*')) {
      // MIME type pattern like "image/*" - for file extension proxy
      const category = at.split('/')[0].toLowerCase();
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
      const videoExts = ['mp4', 'webm', 'avi', 'mov'];
      const audioExts = ['mp3', 'wav', 'ogg', 'flac'];
      if (category === 'image' && imageExts.includes(ext)) return true;
      if (category === 'video' && videoExts.includes(ext)) return true;
      if (category === 'audio' && audioExts.includes(ext)) return true;
    }
    if (`.${ext}` === at.toLowerCase() || ext === at.toLowerCase()) return true;
  }
  return false;
}

// =============================================
// Turnstile verification helper
// =============================================
async function verifyTurnstile(c: any): Promise<boolean> {
  const token = c.req.header('X-Turnstile-Token');
  if (!token) return false;

  const secretRaw = await getConfig(c.env.DB, 'turnstile_secret', c.env);
  const secret = secretRaw.replace(/^"|"$/g, '');
  if (!secret || secret === 'your-turnstile-secret-key') return true; // Not configured, skip

  const formData = new FormData();
  formData.append('secret', secret);
  formData.append('response', token);

  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });
  const data = (await result.json()) as { success: boolean };
  return data.success === true;
}

// =============================================
// POST /api/share/text - Share text
// =============================================
shareApi.post('/text', shareAuth, uploadRateLimit, async (c) => {
  // Turnstile verification
  const turnstileOk = await verifyTurnstile(c);
  if (!turnstileOk) {
    return jsonError(403, 'Turnstile verification failed. Please complete the CAPTCHA.');
  }

  const body = await c.req.parseBody();
  const parsed = shareTextSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(400, parsed.error.errors[0]?.message || 'Invalid input');
  }

  const { text, expire_value, expire_style, encrypted, encryption_iv, encryption_salt, encryption_key_encrypted, is_burn_after_read, expire_at_datetime } = parsed.data;

  // Validate text size
  if (text.length > 222 * 1024) {
    return jsonError(400, 'Text too large (max 222KB)');
  }

  // Check max save time
  const maxSaveSeconds = await getConfigNumber(c.env.DB, 'max_save_seconds', c.env, 0);

  // Compute expiry
  const { expiredAt, expiredCount, usedCount } = computeExpiry(expire_value, expire_style, expire_at_datetime);
  const finalExpiredAt = clampMaxSaveSeconds(expiredAt, maxSaveSeconds);

  // Generate unique code
  const codeType = (await getConfig(c.env.DB, 'code_generate_type', c.env)).replace(/"/g, '') || 'number';
  const code = await generateCode(c.env.DB, codeType as 'number' | 'string');

  // Insert DB record
  await c.env.DB.prepare(
    `INSERT INTO file_codes (code, prefix, suffix, size, text, expired_at, expired_count, used_count,
      encrypted, encryption_iv, encryption_salt, encryption_key_encrypted,
      is_burn_after_read, expire_style)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      code, 'Text', 'txt', text.length, text,
      finalExpiredAt, expiredCount, usedCount,
      encrypted ? 1 : 0, encryption_iv || null, encryption_salt || null, encryption_key_encrypted || null,
      is_burn_after_read ? 1 : 0, expire_style
    )
    .run();

  return jsonSuccess({
    code,
    name: 'Text.txt',
    is_text: true,
    encrypted: encrypted || false,
  });
});

// =============================================
// POST /api/share/file - Share file
// =============================================
shareApi.post('/file', shareAuth, uploadRateLimit, async (c) => {
  // Turnstile verification
  const turnstileOk = await verifyTurnstile(c);
  if (!turnstileOk) {
    return jsonError(403, 'Turnstile verification failed. Please complete the CAPTCHA.');
  }

  const body = await c.req.parseBody();
  const parsed = shareFileSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(400, parsed.error.errors[0]?.message || 'Invalid input');
  }

  const { expire_value, expire_style, encrypted, encryption_iv, encryption_salt, encryption_key_encrypted, is_burn_after_read, expire_at_datetime } = parsed.data;

  // Get uploaded file
  const fileField = body['file'];
  if (!fileField || !(fileField instanceof File)) {
    return jsonError(400, 'No file uploaded');
  }

  const file = fileField as File;
  const fileName = file.name || 'unnamed_file';
  const fileData = await file.arrayBuffer();

  // Validate file size
  const maxSize = await getConfigNumber(c.env.DB, 'uploadSize', c.env, 10 * 1024 * 1024);
  if (fileData.byteLength > maxSize) {
    return jsonError(403, `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)`);
  }

  // Validate file type
  const allowedTypes = await getConfigJSON<string[]>(c.env.DB, 'allowed_file_types', c.env) || ['*'];
  if (!validateFileType(fileName, allowedTypes)) {
    return jsonError(403, 'File type not allowed');
  }

  // Check max save time
  const maxSaveSeconds = await getConfigNumber(c.env.DB, 'max_save_seconds', c.env, 0);

  // Generate storage path and save to R2
  const savePath = generateStoragePath();
  const uuidFileName = crypto.randomUUID().replace(/-/g, '').slice(0, 8) + '_' + encodeURIComponent(fileName);
  const objectKey = buildObjectKey(savePath, uuidFileName);

  await saveFile(c.env.R2, objectKey, fileData, file.type || 'application/octet-stream');

  // Compute hash
  const fileHash = await sha256Hex(fileData);

  // Compute expiry
  const { expiredAt, expiredCount, usedCount } = computeExpiry(expire_value, expire_style, expire_at_datetime);
  const finalExpiredAt = clampMaxSaveSeconds(expiredAt, maxSaveSeconds);

  // Generate unique code
  const codeType = (await getConfig(c.env.DB, 'code_generate_type', c.env)).replace(/"/g, '') || 'number';
  const code = await generateCode(c.env.DB, codeType as 'number' | 'string');

  // Extract filename parts
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;

  // Insert DB record
  await c.env.DB.prepare(
    `INSERT INTO file_codes (code, prefix, suffix, uuid_file_name, file_path, size, file_hash,
      expired_at, expired_count, used_count,
      encrypted, encryption_iv, encryption_salt, encryption_key_encrypted,
      is_burn_after_read, expire_style)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      code, baseName, ext, uuidFileName, savePath, fileData.byteLength, fileHash,
      finalExpiredAt, expiredCount, usedCount,
      encrypted ? 1 : 0, encryption_iv || null, encryption_salt || null, encryption_key_encrypted || null,
      is_burn_after_read ? 1 : 0, expire_style
    )
    .run();

  // Enforce R2 storage cap (5GB)
  const deletedCount = await enforceStorageCap(c.env.R2, c.env.DB, fileData.byteLength);
  if (deletedCount > 0) {
    console.log(`Storage cap enforced: deleted ${deletedCount} old files`);
  }

  return jsonSuccess({
    code,
    name: fileName,
    size: fileData.byteLength,
    encrypted: encrypted || false,
    is_burn_after_read: is_burn_after_read || false,
  });
});

// =============================================
// GET/POST /api/share/metadata - Get file metadata by code
// =============================================
shareApi.get('/metadata', errorRateLimit, async (c) => {
  const code = c.req.query('code') || '';
  return getMetadata(c.env.DB, code);
});

shareApi.post('/metadata', errorRateLimit, async (c) => {
  const body = await c.req.json<{ code: string }>();
  return getMetadata(c.env.DB, body.code || '');
});

async function getMetadata(db: D1Database, rawCode: string): Promise<Response> {
  const code = normalizeCode(rawCode);
  if (!code) return jsonError(404, 'Code is required');

  const file = await db.prepare('SELECT * FROM file_codes WHERE code = ?').bind(code).first<FileCodeRecord>();
  if (!file) return jsonError(404, 'File not found');

  if (file.is_burn_after_read === 1 && file.used_count > 0) {
    return jsonError(404, 'File has been burned');
  }

  return jsonSuccess(buildFileMetadata(file));
}

function buildFileMetadata(file: FileCodeRecord) {
  const isText = !!(file.text && file.suffix === 'txt' && file.prefix === 'Text');
  const isExpired = file.expired_at ? new Date(file.expired_at) < new Date() : false;
  const remainingDownloads = file.expired_count < 0 ? -1 : Math.max(0, file.expired_count - file.used_count);

  return {
    code: file.code,
    name: `${file.prefix}${file.suffix ? '.' + file.suffix : ''}`,
    size: file.size,
    type: isText ? 'text' : 'file',
    is_text: isText,
    created_at: file.created_at,
    expired_at: file.expired_at,
    expires_at: file.expired_at,
    expired_count: file.expired_count,
    used_count: file.used_count,
    remaining_downloads: remainingDownloads,
    encrypted: file.encrypted === 1,
    encryption_iv: file.encryption_iv,
    encryption_salt: file.encryption_salt,
    encryption_key_encrypted: file.encryption_key_encrypted,
    is_burn_after_read: file.is_burn_after_read === 1,
    is_folder: file.is_folder === 1,
    folder_manifest: file.folder_manifest ? JSON.parse(file.folder_manifest) : null,
  };
}

// =============================================
// GET /api/share/select - Download file by code
// =============================================
shareApi.get('/select', errorRateLimit, async (c) => {
  const code = normalizeCode(c.req.query('code') || '');
  if (!code) return jsonError(404, 'Code is required');

  const file = await c.env.DB.prepare('SELECT * FROM file_codes WHERE code = ?').bind(code).first<FileCodeRecord>();
  if (!file) return jsonError(404, 'File not found');

  // Check burn-after-read
  if (file.is_burn_after_read === 1) {
    // Check if already accessed (DB-level check)
    if (file.used_count > 0) {
      return jsonError(404, 'This file has already been accessed (burn after read)');
    }
  }

  // Check expiry
  if (file.expired_at) {
    const now = new Date().toISOString();
    if (file.expired_at < now) {
      return jsonError(404, 'File has expired');
    }
  }

  // Update usage count
  const newUsedCount = file.used_count + 1;
  await c.env.DB.prepare('UPDATE file_codes SET used_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(newUsedCount, file.id)
    .run();

  // Handle text shares
  if (file.text && file.suffix === 'txt' && file.prefix === 'Text') {
    // For burn-after-read text, delete DB record after serving
    if (file.is_burn_after_read === 1) {
      await c.env.DB.prepare('DELETE FROM file_codes WHERE id = ?').bind(file.id).run();
    }
    return jsonSuccess({
      text: file.text,
      ...buildFileMetadata({ ...file, used_count: newUsedCount }),
    });
  }

  // Handle file shares
  if (file.file_path && file.uuid_file_name) {
    const objectKey = buildObjectKey(file.file_path, file.uuid_file_name);
    const obj = await getFile(c.env.R2, objectKey);

    if (!obj) {
      return jsonError(404, 'File data not found');
    }

    // For burn-after-read, delete file after serving
    if (file.is_burn_after_read === 1) {
      // We need to read the data first, then delete
      const data = await obj.arrayBuffer();

      // Delete from R2 and DB
      await deleteFile(c.env.R2, objectKey);
      await c.env.DB.prepare('DELETE FROM file_codes WHERE id = ?').bind(file.id).run();

      return new Response(data, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file.prefix}.${file.suffix}"`,
        },
      });
    }

    return streamFileResponse(obj, `${file.prefix}.${file.suffix}`);
  }

  return jsonError(404, 'File data not found');
});

// =============================================
// GET /api/share/download-all - Batch ZIP download
// =============================================
shareApi.get('/download-all', errorRateLimit, async (c) => {
  const code = normalizeCode(c.req.query('code') || '');
  if (!code) return jsonError(404, 'Code is required');

  const files = await c.env.DB.prepare('SELECT * FROM file_codes WHERE code = ?').bind(code).all<FileCodeRecord>();
  if (!files.results.length) return jsonError(404, 'File not found');

  const fileEntries = [];
  let totalSize = 0;

  for (const file of files.results) {
    if (file.is_burn_after_read === 1 && file.used_count > 0) continue;

    if (file.file_path && file.uuid_file_name) {
      const objectKey = buildObjectKey(file.file_path, file.uuid_file_name);
      const obj = await getFile(c.env.R2, objectKey);
      if (obj) {
        const data = await obj.arrayBuffer();
        fileEntries.push({
          name: `${file.prefix}.${file.suffix}`,
          data,
        });
        totalSize += data.byteLength;
      }
    }
  }

  if (fileEntries.length === 0) return jsonError(404, 'No downloadable files found');
  if (totalSize > 500 * 1024 * 1024) return jsonError(413, 'Total file size too large for ZIP (max 500MB)');

  return createZipStreamResponse(fileEntries, `share-${code}.zip`);
});

// =============================================
// Health check for share module
// =============================================
shareApi.get('/health', async (c) => {
  return jsonSuccess({ status: 'ok', module: 'share' });
});

export default shareApi;
