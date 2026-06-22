-- ==============================================================
-- FileCodeBox D1 Schema Migration 001
-- Compatible with Cloudflare D1 (SQLite-based)
-- ==============================================================

-- Core sharing records
CREATE TABLE IF NOT EXISTS file_codes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    code                TEXT NOT NULL UNIQUE,
    prefix              TEXT DEFAULT '',
    suffix              TEXT DEFAULT '',
    uuid_file_name      TEXT,
    file_path           TEXT,
    size                INTEGER DEFAULT 0,
    text                TEXT,
    expired_at          TEXT,
    expired_count       INTEGER DEFAULT 0,
    used_count          INTEGER DEFAULT 0,
    file_hash           TEXT,
    is_chunked          INTEGER DEFAULT 0,
    upload_id           TEXT,
    -- Encryption fields
    encrypted           INTEGER DEFAULT 0,
    encryption_iv       TEXT,
    encryption_salt     TEXT,
    encryption_key_encrypted TEXT,
    -- Burn after reading
    is_burn_after_read  INTEGER DEFAULT 0,
    -- Expiry style tracking
    expire_style        TEXT DEFAULT 'day',
    -- Folder upload
    is_folder           INTEGER DEFAULT 0,
    folder_manifest     TEXT,
    -- Timestamps
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);

-- Chunked upload tracking
CREATE TABLE IF NOT EXISTS upload_chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id       TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL,
    chunk_hash      TEXT DEFAULT '',
    total_chunks    INTEGER DEFAULT 0,
    file_size       INTEGER DEFAULT 0,
    chunk_size      INTEGER DEFAULT 0,
    file_name       TEXT DEFAULT '',
    save_path       TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    completed       INTEGER DEFAULT 0
);

-- Presigned upload sessions
CREATE TABLE IF NOT EXISTS presign_upload_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id       TEXT NOT NULL UNIQUE,
    file_name       TEXT DEFAULT '',
    file_size       INTEGER DEFAULT 0,
    save_path       TEXT DEFAULT '',
    mode            TEXT DEFAULT 'proxy',
    expire_value    INTEGER DEFAULT 1,
    expire_style    TEXT DEFAULT 'day',
    created_at      TEXT DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL
);

-- Key-value config store
CREATE TABLE IF NOT EXISTS config_store (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS migrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TEXT DEFAULT (datetime('now'))
);

-- Admin activity log
CREATE TABLE IF NOT EXISTS admin_activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT DEFAULT '',
    target_type TEXT DEFAULT '',
    target_id   INTEGER,
    target_name TEXT DEFAULT '',
    detail      TEXT DEFAULT '',
    ip_address  TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
);

-- ==============================================================
-- Indexes
-- ==============================================================
CREATE INDEX IF NOT EXISTS idx_fc_code          ON file_codes(code);
CREATE INDEX IF NOT EXISTS idx_fc_expired_at    ON file_codes(expired_at);
CREATE INDEX IF NOT EXISTS idx_fc_created_at    ON file_codes(created_at);
CREATE INDEX IF NOT EXISTS idx_uc_upload_id     ON upload_chunks(upload_id);
CREATE INDEX IF NOT EXISTS idx_ps_upload_id     ON presign_upload_sessions(upload_id);
CREATE INDEX IF NOT EXISTS idx_aa_created_at    ON admin_activities(created_at);

-- ==============================================================
-- Seed default config
-- ==============================================================
INSERT OR IGNORE INTO config_store (key, value) VALUES
    ('name', '"FileShare - 文件分享"'),
    ('description', '"像拿快递一样取文件"'),
    ('keywords', '"文件分享,临时网盘,FileCodeBox"'),
    ('uploadSize', '104857600'),
    ('allowed_file_types', '["*"]'),
    ('expireStyle', '["day","hour","minute","forever","count","datetime","burn"]'),
    ('code_generate_type', '"number"'),
    ('admin_token', '""'),
    ('jwt_secret', '""'),
    ('openUpload', '1'),
    ('uploadMinute', '1'),
    ('uploadCount', '10'),
    ('errorMinute', '1'),
    ('errorCount', '10'),
    ('enableChunk', '0'),
    ('max_save_seconds', '0'),
    ('showAdminAddr', '0'),
    ('robotsText', '"User-agent: *\nDisallow: /"'),
    ('notify_title', '""'),
    ('notify_content', '""'),
    ('page_explain', '""');
