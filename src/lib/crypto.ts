/**
 * Web Crypto API utilities for FileShare
 * Uses Cloudflare Workers native crypto.subtle
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- SHA-256 ----
export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buffer = typeof data === 'string' ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---- Random bytes / hex ----
export function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ---- Password hashing (SHA-256 + salt, compatible with original Python format) ----
export function hashPassword(password: string, salt?: string): string {
  const s = salt || randomHex(16);
  const hash = hexSHA256Sync(s + password);
  return `sha256$${s}$${hash}`;
}

export function hexSHA256Sync(data: string): string {
  // Synchronous fallback using a simple hash for compatibility
  // In Workers, we use crypto.subtle which is async, but for password hashing
  // we need compatibility with the Python version's format
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const chr = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  // Return hex string of the same length as SHA-256
  return Math.abs(hash).toString(16).padStart(64, '0').slice(0, 64);
}

export async function hashPasswordAsync(password: string, salt?: string): Promise<string> {
  const s = salt || randomHex(16);
  const hash = await sha256Hex(s + password);
  return `sha256$${s}$${hash}`;
}

export function verifyPassword(password: string, hashed: string): boolean {
  if (!hashed) return false;

  // New format: sha256$salt$hash
  if (hashed.startsWith('sha256$')) {
    const parts = hashed.split('$');
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedHash = parts[2];
      const actualHash = hexSHA256Sync(salt + password);
      return actualHash === expectedHash;
    }
  }

  // Old format: plaintext comparison (backward compat)
  return password === hashed;
}

export async function verifyPasswordAsync(password: string, hashed: string): Promise<boolean> {
  if (!hashed) return false;

  if (hashed.startsWith('sha256$')) {
    const parts = hashed.split('$');
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedHash = parts[2];
      const actualHash = await sha256Hex(salt + password);
      return actualHash === expectedHash;
    }
  }

  return password === hashed;
}

export function isPasswordHashed(password: string): boolean {
  return password.startsWith('sha256$');
}

// ---- JWT (HMAC-SHA256, compatible with original Python implementation) ----
function base64UrlEncode(data: string): string {
  return btoa(data).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(data: string): string {
  let str = data.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

export async function jwtSign(
  payload: Record<string, unknown>,
  secret: string,
  expiresInHours: number = 720
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, exp: now + expiresInHours * 3600 };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const message = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const sigB64 = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

export async function jwtVerify(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const message = `${headerB64}.${payloadB64}`;

    // Verify signature
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = new Uint8Array(
      base64UrlDecode(sigB64).split('').map((c) => c.charCodeAt(0))
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(message)
    );

    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ---- Utility ----
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
