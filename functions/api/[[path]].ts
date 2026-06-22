/**
 * API routes handler for Cloudflare Pages Functions
 * Handles all /api/* paths
 */
import { handle } from 'hono/cloudflare-pages';
import app from '../../src/app';

export const onRequest = handle(app);
