import { z } from 'zod';

// ---- Share schemas ----
export const shareTextSchema = z.object({
  text: z.string().max(222 * 1024, 'Text too large (max 222KB)'),
  expire_value: z.coerce.number().int().min(1).default(1),
  expire_style: z.enum(['day', 'hour', 'minute', 'forever', 'count', 'datetime', 'burn']).default('day'),
  // Encryption
  encrypted: z.coerce.boolean().optional(),
  encryption_iv: z.string().optional(),
  encryption_salt: z.string().optional(),
  encryption_key_encrypted: z.string().optional(),
  // Burn after reading
  is_burn_after_read: z.coerce.boolean().optional(),
  // Precise datetime
  expire_at_datetime: z.string().optional(),
});

export const shareFileSchema = z.object({
  expire_value: z.coerce.number().int().min(1).default(1),
  expire_style: z.enum(['day', 'hour', 'minute', 'forever', 'count', 'datetime', 'burn']).default('day'),
  encrypted: z.coerce.boolean().optional(),
  encryption_iv: z.string().optional(),
  encryption_salt: z.string().optional(),
  encryption_key_encrypted: z.string().optional(),
  is_burn_after_read: z.coerce.boolean().optional(),
  expire_at_datetime: z.string().optional(),
});

export const selectCodeSchema = z.object({
  code: z.string().min(1),
});

// ---- Chunk schemas ----
export const initChunkSchema = z.object({
  file_name: z.string().min(1),
  chunk_size: z.coerce.number().int().min(1).default(5 * 1024 * 1024),
  file_size: z.coerce.number().int().min(1),
  file_hash: z.string().optional().default(''),
  file_type: z.string().optional().default(''),
});

export const completeUploadSchema = z.object({
  expire_value: z.coerce.number().int().min(1).default(1),
  expire_style: z.enum(['day', 'hour', 'minute', 'forever', 'count', 'datetime', 'burn']).default('day'),
});

// ---- Presign schemas ----
export const presignInitSchema = z.object({
  file_name: z.string().min(1),
  file_size: z.coerce.number().int().min(1),
  expire_value: z.coerce.number().int().min(1).default(1),
  expire_style: z.enum(['day', 'hour', 'minute', 'forever', 'count', 'datetime', 'burn']).default('day'),
  file_type: z.string().optional().default(''),
});

// ---- Admin schemas ----
export const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export const updateConfigSchema = z.record(z.string(), z.string());
