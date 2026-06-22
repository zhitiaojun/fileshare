export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;

  // Environment variables
  MAX_UPLOAD_SIZE: string;
  CHUNK_SIZE: string;
  JWT_EXPIRATION_HOURS: string;
  CONFIG_CACHE_TTL: string;
  CHUNK_EXPIRE_HOURS: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface AppVariables {
  adminSession: Record<string, unknown>;
}

export interface FileCodeRecord {
  id: number;
  code: string;
  prefix: string;
  suffix: string;
  uuid_file_name: string | null;
  file_path: string | null;
  size: number;
  text: string | null;
  expired_at: string | null;
  expired_count: number;
  used_count: number;
  file_hash: string | null;
  is_chunked: number;
  upload_id: string | null;
  encrypted: number;
  encryption_iv: string | null;
  encryption_salt: string | null;
  encryption_key_encrypted: string | null;
  is_burn_after_read: number;
  expire_style: string;
  is_folder: number;
  folder_manifest: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadChunkRecord {
  id: number;
  upload_id: string;
  chunk_index: number;
  chunk_hash: string;
  total_chunks: number;
  file_size: number;
  chunk_size: number;
  file_name: string;
  save_path: string | null;
  created_at: string;
  completed: number;
}

export interface PresignSessionRecord {
  id: number;
  upload_id: string;
  file_name: string;
  file_size: number;
  save_path: string;
  mode: string;
  expire_value: number;
  expire_style: string;
  created_at: string;
  expires_at: string;
}

export interface ConfigRecord {
  key: string;
  value: string;
}

export interface APIResponse<T = unknown> {
  code: number;
  message: string;
  msg?: string;
  detail?: T;
}

// Supported expiry styles (extended from original)
export type ExpireStyle = 'day' | 'hour' | 'minute' | 'forever' | 'count' | 'datetime' | 'burn';

export interface ShareInput {
  expire_value: number;
  expire_style: ExpireStyle;
  text?: string;
  encrypted?: boolean;
  encryption_iv?: string;
  encryption_salt?: string;
  encryption_key_encrypted?: string;
  is_burn_after_read?: boolean;
  expire_at_datetime?: string;
  folder_manifest?: string;
  is_folder?: boolean;
}

export interface AdminSession {
  is_admin: boolean;
  exp: number;
}
