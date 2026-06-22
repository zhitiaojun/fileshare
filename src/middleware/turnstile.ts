/**
 * Cloudflare Turnstile verification middleware
 * Validates the Turnstile token before allowing uploads
 * Secret key is stored in D1 config_store for reliability
 */
import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { getConfig } from '../lib/db';
import { jsonError } from '../lib/response';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

async function verifyToken(token: string, secretKey: string): Promise<boolean> {
  const formData = new FormData();
  formData.append('secret', secretKey);
  formData.append('response', token);

  const result = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: formData,
  });

  const data = (await result.json()) as TurnstileResponse;
  return data.success === true;
}

/**
 * Middleware: requires valid Turnstile token for upload operations.
 * Reads secret from D1 config_store. Skips verification if not configured.
 */
export const turnstileVerify = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // Read Turnstile secret from D1 config
  const secretKey = await getConfig(c.env.DB, 'turnstile_secret', c.env);
  const cleanSecret = secretKey.replace(/^"|"$/g, '');

  // If Turnstile is not configured, skip verification
  if (!cleanSecret || cleanSecret === 'your-turnstile-secret-key') {
    return next();
  }

  // Get token from header (frontend sends it as X-Turnstile-Token)
  const token = c.req.header('X-Turnstile-Token');

  if (!token) {
    return jsonError(400, 'Turnstile verification required. Please complete the CAPTCHA.');
  }

  const valid = await verifyToken(token, cleanSecret);
  if (!valid) {
    return jsonError(403, 'Turnstile verification failed. Please try again.');
  }

  return next();
});
