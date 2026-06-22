/**
 * Share code generation - generates unique alphanumeric codes
 * Compatible with original Python version's code generation
 */

const CHARS_NUMBER = '0123456789';
const CHARS_STRING = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Generate a random 5-digit numeric code */
function randomNum(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CHARS_NUMBER[bytes[i] % 10];
  }
  return code;
}

/** Generate a random 5-character alphanumeric code */
function randomString(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CHARS_STRING[bytes[i] % CHARS_STRING.length];
  }
  return code;
}

/** Generate a unique share code, retrying if it already exists in DB */
export async function generateCode(
  db: D1Database,
  codeType: 'number' | 'string' = 'number'
): Promise<string> {
  const maxRetries = 20;
  for (let i = 0; i < maxRetries; i++) {
    const code = codeType === 'number' ? randomNum() : randomString();

    const existing = await db
      .prepare('SELECT id FROM file_codes WHERE code = ?')
      .bind(code)
      .first();

    if (!existing) {
      return code;
    }
  }
  throw new Error('Failed to generate unique code after max retries');
}

/** Strip whitespace from a share code */
export function normalizeCode(code: string): string {
  return code.trim();
}
