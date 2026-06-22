/**
 * Client-side AES-256-GCM file encryption/decryption
 * Uses Web Crypto API - all operations happen in browser, server never sees plaintext
 */
export interface EncryptionParams {
  iv: string;
  salt: string;
  encryptedKey: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derive an AES-256-GCM key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Encrypt a file with AES-256-GCM.
 * Returns the encrypted data and encryption metadata.
 */
export async function encryptFile(
  fileData: ArrayBuffer,
  password: string
): Promise<{ encryptedData: ArrayBuffer; params: EncryptionParams }> {
  // Generate random file key
  const fileKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );

  // Generate salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt file data with file key
  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    fileKey,
    fileData
  );

  // Derive wrapping key from password
  const derivedKey = await deriveKey(password, salt);

  // Export and encrypt the file key with the derived key
  const exportedFileKey = await crypto.subtle.exportKey('raw', fileKey);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv },
    derivedKey,
    exportedFileKey
  );

  // Combine wrap IV with encrypted key
  const combined = new Uint8Array(wrapIv.length + encryptedKey.byteLength);
  combined.set(wrapIv, 0);
  combined.set(new Uint8Array(encryptedKey), wrapIv.length);

  return {
    encryptedData,
    params: {
      iv: arrayBufferToBase64(iv),
      salt: arrayBufferToBase64(salt),
      encryptedKey: arrayBufferToBase64(combined.buffer),
    },
  };
}

/**
 * Decrypt a file with AES-256-GCM.
 */
export async function decryptFile(
  encryptedData: ArrayBuffer,
  password: string,
  params: EncryptionParams
): Promise<ArrayBuffer> {
  const iv = new Uint8Array(base64ToArrayBuffer(params.iv));
  const salt = new Uint8Array(base64ToArrayBuffer(params.salt));

  // Extract wrap IV (first 12 bytes) and encrypted key
  const combined = new Uint8Array(base64ToArrayBuffer(params.encryptedKey));
  const wrapIv = combined.slice(0, 12);
  const encryptedKey = combined.slice(12);

  // Derive key from password
  const derivedKey = await deriveKey(password, salt);

  // Decrypt the file key
  const exportedFileKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wrapIv },
    derivedKey,
    encryptedKey
  );

  // Import file key
  const fileKey = await crypto.subtle.importKey(
    'raw',
    exportedFileKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decrypt file data
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    fileKey,
    encryptedData
  );
}

export function useEncryption() {
  return { encryptFile, decryptFile };
}
