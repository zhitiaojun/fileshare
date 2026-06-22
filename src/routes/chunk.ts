/**
 * Chunked upload routes
 * Handles large file uploads in chunks with resume support
 */
import { Hono } from 'hono';
import type { Env, AppVariables, UploadChunkRecord } from '../types';
import { getConfigNumber } from '../lib/db';
import { saveFile, deleteFilesByPrefix, getFile, generateStoragePath, buildObjectKey, streamFileResponse } from '../lib/storage';
import { generateCode } from '../lib/code';
import { sha256Hex } from '../lib/crypto';
import { initChunkSchema, completeUploadSchema } from '../lib/validators';
import { jsonSuccess, jsonError } from '../lib/response';
import { shareAuth } from '../middleware/auth';

const chunkApi = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// =============================================
// POST /api/chunk/init - Initialize chunked upload
// =============================================
chunkApi.post('/init', shareAuth, async (c) => {
  const body = await c.req.parseBody();
  const parsed = initChunkSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError(400, parsed.error.errors[0]?.message || 'Invalid input');
  }

  const { file_name, chunk_size, file_size, file_hash } = parsed.data;
  const uploadId = crypto.randomUUID();

  // Check file size limit
  const maxSize = await getConfigNumber(c.env.DB, 'uploadSize', c.env, 10 * 1024 * 1024);
  if (file_size > maxSize) {
    return jsonError(403, `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)`);
  }

  // Generate save path
  const savePath = generateStoragePath();
  const totalChunks = Math.ceil(file_size / chunk_size);

  // Check for existing incomplete session (resume support)
  const existingSession = await c.env.DB.prepare(
    `SELECT * FROM upload_chunks WHERE chunk_index = -1 AND file_size = ? AND file_name = ?`
  )
    .bind(file_size, file_name)
    .first<UploadChunkRecord>();

  if (existingSession && existingSession.save_path) {
    // Resume: get already uploaded chunk indices
    const completedChunks = await c.env.DB.prepare(
      'SELECT chunk_index FROM upload_chunks WHERE upload_id = ? AND completed = 1 AND chunk_index >= 0'
    )
      .bind(existingSession.upload_id)
      .all<{ chunk_index: number }>();

    return jsonSuccess({
      upload_id: existingSession.upload_id,
      chunk_size: existingSession.chunk_size,
      total_chunks: existingSession.total_chunks,
      uploaded_chunks: completedChunks.results.map((r) => r.chunk_index),
    });
  }

  // Create new session (chunk_index = -1 is the metadata marker)
  await c.env.DB.prepare(
    `INSERT INTO upload_chunks (upload_id, chunk_index, chunk_hash, total_chunks, file_size, chunk_size, file_name, save_path, completed)
     VALUES (?, -1, ?, ?, ?, ?, ?, ?, 0)`
  )
    .bind(uploadId, file_hash || '', totalChunks, file_size, chunk_size, file_name, savePath)
    .run();

  return jsonSuccess({
    upload_id: uploadId,
    chunk_size,
    total_chunks: totalChunks,
    uploaded_chunks: [],
  });
});

// =============================================
// POST /api/chunk/upload/:uploadId/:chunkIndex - Upload a single chunk
// =============================================
chunkApi.post('/upload/:uploadId/:chunkIndex', shareAuth, async (c) => {
  const uploadId = c.req.param('uploadId');
  const chunkIndex = parseInt(c.req.param('chunkIndex'), 10);

  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return jsonError(400, 'Invalid chunk index');
  }

  // Get session info
  const session = await c.env.DB.prepare(
    'SELECT * FROM upload_chunks WHERE upload_id = ? AND chunk_index = -1'
  )
    .bind(uploadId)
    .first<UploadChunkRecord>();

  if (!session) {
    return jsonError(404, 'Upload session not found');
  }

  if (chunkIndex >= session.total_chunks) {
    return jsonError(400, 'Chunk index out of range');
  }

  // Check if chunk already uploaded (idempotent)
  const existingChunk = await c.env.DB.prepare(
    'SELECT * FROM upload_chunks WHERE upload_id = ? AND chunk_index = ? AND completed = 1'
  )
    .bind(uploadId, chunkIndex)
    .first();

  if (existingChunk) {
    return jsonSuccess({ chunk_index: chunkIndex, status: 'already_uploaded' });
  }

  // Read chunk data
  const body = await c.req.parseBody();
  const chunkField = body['chunk'];
  if (!chunkField || !(chunkField instanceof File)) {
    return jsonError(400, 'No chunk data');
  }

  const chunkData = await (chunkField as File).arrayBuffer();

  // Validate chunk size (should be <= chunk_size, except maybe last chunk)
  if (chunkData.byteLength > session.chunk_size * 1.1) {
    return jsonError(400, `Chunk too large: ${chunkData.byteLength} > ${session.chunk_size}`);
  }

  // Check cumulative upload size
  const maxSize = await getConfigNumber(c.env.DB, 'uploadSize', c.env, 10 * 1024 * 1024);
  const uploadedResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM upload_chunks WHERE upload_id = ? AND completed = 1 AND chunk_index >= 0'
  )
    .bind(uploadId)
    .first<{ count: number }>();

  const uploadedCount = uploadedResult?.count || 0;
  const cumulativeSize = uploadedCount * session.chunk_size + chunkData.byteLength;
  if (cumulativeSize > maxSize) {
    return jsonError(403, 'Upload would exceed maximum file size');
  }

  // Compute chunk hash
  const chunkHash = await sha256Hex(chunkData);

  // Save chunk to R2
  const chunkKey = `${session.save_path}/chunks/${uploadId}/${chunkIndex}.part`;

  // Save chunk to R2
  await c.env.R2.put(chunkKey, chunkData);

  // Record chunk in DB
  await c.env.DB.prepare(
    `INSERT INTO upload_chunks (upload_id, chunk_index, chunk_hash, chunk_size, completed, created_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(upload_id, chunk_index) DO UPDATE SET chunk_hash = ?, completed = 1`
  )
    .bind(uploadId, chunkIndex, chunkHash, chunkData.byteLength, chunkHash)
    .run();

  return jsonSuccess({ chunk_index: chunkIndex, hash: chunkHash });
});

// =============================================
// GET /api/chunk/status/:uploadId - Get upload status
// =============================================
chunkApi.get('/status/:uploadId', shareAuth, async (c) => {
  const uploadId = c.req.param('uploadId');

  const session = await c.env.DB.prepare(
    'SELECT * FROM upload_chunks WHERE upload_id = ? AND chunk_index = -1'
  )
    .bind(uploadId)
    .first<UploadChunkRecord>();

  if (!session) {
    return jsonError(404, 'Upload session not found');
  }

  const completedChunks = await c.env.DB.prepare(
    'SELECT chunk_index FROM upload_chunks WHERE upload_id = ? AND completed = 1 AND chunk_index >= 0'
  )
    .bind(uploadId)
    .all<{ chunk_index: number }>();

  const uploadedIndices = completedChunks.results.map((r) => r.chunk_index);
  const progress = session.total_chunks > 0
    ? Math.round((uploadedIndices.length / session.total_chunks) * 100)
    : 0;

  return jsonSuccess({
    upload_id: uploadId,
    file_name: session.file_name,
    file_size: session.file_size,
    chunk_size: session.chunk_size,
    total_chunks: session.total_chunks,
    uploaded_chunks: uploadedIndices,
    progress,
  });
});

// =============================================
// POST /api/chunk/complete/:uploadId - Complete upload (merge chunks)
// =============================================
chunkApi.post('/complete/:uploadId', shareAuth, async (c) => {
  const uploadId = c.req.param('uploadId');

  // Parse body for expiry settings
  let expireValue = 1;
  let expireStyle = 'day';
  try {
    const body = await c.req.parseBody();
    const parsed = completeUploadSchema.safeParse(body);
    if (parsed.success) {
      expireValue = parsed.data.expire_value;
      expireStyle = parsed.data.expire_style;
    }
  } catch {
    // Use defaults
  }

  // Get session
  const session = await c.env.DB.prepare(
    'SELECT * FROM upload_chunks WHERE upload_id = ? AND chunk_index = -1'
  )
    .bind(uploadId)
    .first<UploadChunkRecord>();

  if (!session) {
    return jsonError(404, 'Upload session not found');
  }

  // Check all chunks are uploaded
  const completedCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM upload_chunks WHERE upload_id = ? AND completed = 1 AND chunk_index >= 0'
  )
    .bind(uploadId)
    .first<{ count: number }>();

  if ((completedCount?.count || 0) < session.total_chunks) {
    return jsonError(400, `Not all chunks uploaded: ${completedCount?.count || 0}/${session.total_chunks}`);
  }

  try {
    // Get all chunks from R2 and merge
    const chunks: ArrayBuffer[] = [];
    let totalSize = 0;

    for (let i = 0; i < session.total_chunks; i++) {
      const chunkKey = `${session.save_path}/chunks/${uploadId}/${i}.part`;
      const obj = await c.env.R2.get(chunkKey);
      if (!obj) {
        throw new Error(`Chunk ${i} not found in storage`);
      }
      const chunkData = await obj.arrayBuffer();
      chunks.push(chunkData);
      totalSize += chunkData.byteLength;
    }

    // Merge chunks
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // Save merged file to R2
    const fileName = session.file_name;
    const uuidFileName = crypto.randomUUID().replace(/-/g, '').slice(0, 8) + '_' + encodeURIComponent(fileName);
    const objectKey = buildObjectKey(session.save_path!, uuidFileName);

    await c.env.R2.put(objectKey, merged);

    // Compute final hash
    const fileHash = await sha256Hex(merged.buffer);

    // Generate share code
    const codeType = 'number';
    const code = await generateCode(c.env.DB, codeType);

    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
    const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;

    // Compute expiry
    const now = new Date();
    let expiredAt: string | null = null;
    let expiredCount = 0;
    let usedCount = 0;

    switch (expireStyle) {
      case 'day': expiredAt = new Date(now.getTime() + expireValue * 86400 * 1000).toISOString(); break;
      case 'hour': expiredAt = new Date(now.getTime() + expireValue * 3600 * 1000).toISOString(); break;
      case 'minute': expiredAt = new Date(now.getTime() + expireValue * 60 * 1000).toISOString(); break;
      case 'count': expiredCount = expireValue; break;
      case 'forever': expiredCount = -1; break;
      default: expiredAt = new Date(now.getTime() + 86400 * 1000).toISOString();
    }

    // Create file record
    await c.env.DB.prepare(
      `INSERT INTO file_codes (code, prefix, suffix, uuid_file_name, file_path, size, file_hash, is_chunked, upload_id,
        expired_at, expired_count, used_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    )
      .bind(code, baseName, ext, uuidFileName, session.save_path, totalSize, fileHash, uploadId, expiredAt, expiredCount, usedCount)
      .run();

    // Clean up chunk files and DB records
    await deleteFilesByPrefix(c.env.R2, `${session.save_path}/chunks/${uploadId}/`);
    await c.env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').bind(uploadId).run();

    return jsonSuccess({ code, name: fileName, size: totalSize });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Clean up on failure
    try {
      await deleteFilesByPrefix(c.env.R2, `${session.save_path}/chunks/${uploadId}/`);
      await c.env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').bind(uploadId).run();
    } catch {
      // Ignore cleanup errors
    }
    return jsonError(500, `Failed to complete upload: ${message}`);
  }
});

// =============================================
// DELETE /api/chunk/cancel/:uploadId - Cancel upload
// =============================================
chunkApi.delete('/cancel/:uploadId', shareAuth, async (c) => {
  const uploadId = c.req.param('uploadId');

  const session = await c.env.DB.prepare(
    'SELECT * FROM upload_chunks WHERE upload_id = ? AND chunk_index = -1'
  )
    .bind(uploadId)
    .first<UploadChunkRecord>();

  if (session && session.save_path) {
    await deleteFilesByPrefix(c.env.R2, `${session.save_path}/chunks/${uploadId}/`);
  }

  await c.env.DB.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').bind(uploadId).run();

  return jsonSuccess({ status: 'cancelled' });
});

export default chunkApi;
