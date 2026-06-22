import type { Env, ConfigRecord } from '../types';

const configCache = new Map<string, { value: string; expiresAt: number }>();

export function getConfigCacheTTL(env: Env): number {
  return parseInt(env.CONFIG_CACHE_TTL || '60', 10) * 1000;
}

/** Load all config from D1 into a Map */
export async function loadConfig(db: D1Database): Promise<Map<string, string>> {
  const result = await db.prepare('SELECT key, value FROM config_store').all<ConfigRecord>();
  const map = new Map<string, string>();
  for (const row of result.results) {
    map.set(row.key, row.value);
  }
  return map;
}

/** Get a single config value, with in-memory caching */
export async function getConfig(db: D1Database, key: string, env: Env): Promise<string> {
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await db
    .prepare('SELECT value FROM config_store WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();

  const value = result?.value || '';
  configCache.set(key, { value, expiresAt: Date.now() + getConfigCacheTTL(env) });
  return value;
}

/** Get multiple config values at once */
export async function getConfigs(
  db: D1Database,
  keys: string[],
  env: Env
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const key of keys) {
    result.set(key, await getConfig(db, key, env));
  }
  return result;
}

/** Get parsed JSON config value */
export async function getConfigJSON<T>(db: D1Database, key: string, env: Env): Promise<T | null> {
  const value = await getConfig(db, key, env);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Get numeric config value */
export async function getConfigNumber(db: D1Database, key: string, env: Env, defaultVal = 0): Promise<number> {
  const value = await getConfig(db, key, env);
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultVal : num;
}

/** Set a single config value */
export async function setConfig(
  db: D1Database,
  key: string,
  value: string,
  env: Env
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO config_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
    )
    .bind(key, value, value)
    .run();

  // Invalidate cache
  configCache.delete(key);
}

/** Set multiple config values at once */
export async function setConfigs(
  db: D1Database,
  entries: Record<string, string>,
  env: Env
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO config_store (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
  );

  const batch: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(entries)) {
    batch.push(stmt.bind(key, value, value));
    configCache.delete(key);
  }
  await db.batch(batch);
}

/** Get all config values for admin panel (excluding secrets) */
export async function getAllConfig(db: D1Database, env: Env): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT key, value FROM config_store').all<ConfigRecord>();
  const config: Record<string, string> = {};
  const secretKeys = ['admin_token', 'jwt_secret'];

  for (const row of result.results) {
    if (!secretKeys.includes(row.key)) {
      config[row.key] = row.value;
    }
  }
  return config;
}

/** Check if system has been initialized */
export async function isInitialized(db: D1Database, env: Env): Promise<boolean> {
  const adminToken = await getConfig(db, 'admin_token', env);
  if (!adminToken || adminToken === '""' || adminToken === '') return false;

  // Check legacy password
  const { verifyPassword } = await import('./crypto');
  return !verifyPassword('FileCodeBox2023', adminToken);
}

/** Clear the config cache (useful after config updates) */
export function clearConfigCache(): void {
  configCache.clear();
}
