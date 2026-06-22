/**
 * Robots.txt handler for Cloudflare Pages Functions
 */
import { handle } from 'hono/cloudflare-pages';
import app from '../src/app';

export const onRequest = handle(app);
