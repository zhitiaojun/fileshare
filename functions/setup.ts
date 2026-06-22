/**
 * Setup page handler for Cloudflare Pages Functions
 * Handles /setup paths
 */
import { handle } from 'hono/cloudflare-pages';
import app from '../src/app';

export const onRequest = handle(app);
