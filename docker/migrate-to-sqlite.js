#!/usr/bin/env node
'use strict';
/**
 * migrate-to-sqlite.js — One-shot migration from flat JSON sidecars to SQLite.
 *
 * Reads each meta/{hash}.json sidecar and the _uuid-index.json, then INSERTs
 * into /data/vitrine.db. Safe to re-run (uses INSERT OR IGNORE).
 *
 * Usage (inside container):
 *   node /opt/migrate-to-sqlite.js
 *
 * Or with custom paths:
 *   META_DIR=/path/to/meta DB_PATH=/path/to/vitrine.db node /opt/migrate-to-sqlite.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('/opt/node_modules/better-sqlite3');

const META_DIR = process.env.META_DIR || '/usr/share/nginx/html/meta';
const THUMBS_ROOT = process.env.THUMBS_ROOT || '/usr/share/nginx/html/thumbs';
const DB_PATH = process.env.DB_PATH || '/data/vitrine.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure tables exist (same schema as initDb in meta-server.js)
db.exec(`
    CREATE TABLE IF NOT EXISTS archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        hash TEXT UNIQUE NOT NULL,
        filename TEXT UNIQUE NOT NULL,
        title TEXT, description TEXT, thumbnail TEXT,
        asset_types TEXT, metadata_raw TEXT, size INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_archives_uuid ON archives(uuid);
    CREATE INDEX IF NOT EXISTS idx_archives_hash ON archives(hash);
`);

const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO archives
        (uuid, hash, filename, title, description, thumbnail, asset_types, metadata_raw, size)
    VALUES
        (@uuid, @hash, @filename, @title, @description, @thumbnail, @asset_types, @metadata_raw, @size)
`);

// Load UUID index if it exists
const uuidIndexPath = path.join(META_DIR, '_uuid-index.json');
let urlToUuid = {};
try {
    urlToUuid = JSON.parse(fs.readFileSync(uuidIndexPath, 'utf8'));
    console.log(`Loaded UUID index: ${Object.keys(urlToUuid).length} entries`);
} catch (_) {
    console.log('No UUID index found — UUIDs will be generated fresh.');
}

let migrated = 0;
let skipped = 0;
let errors = 0;

let metaFiles;
try {
    metaFiles = fs.readdirSync(META_DIR).filter(f => f.endsWith('.json') && f !== '_uuid-index.json');
} catch (e) {
    console.error(`Cannot read META_DIR (${META_DIR}):`, e.message);
    process.exit(1);
}

for (const file of metaFiles) {
    const hash = path.basename(file, '.json');
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf8'));
    } catch (e) {
        console.warn(`  Skipping unreadable: ${file} —`, e.message);
        errors++;
        continue;
    }

    const filename = meta.filename || hash;
    const archiveUrl = '/archives/' + filename;
    const uuid = urlToUuid[archiveUrl] || crypto.randomUUID();
    const thumbFile = path.join(THUMBS_ROOT, hash + '.jpg');
    const thumbnail = fs.existsSync(thumbFile) ? '/thumbs/' + hash + '.jpg' : null;

    try {
        insertStmt.run({
            uuid,
            hash,
            filename,
            title: meta.title || null,
            description: meta.description || null,
            thumbnail,
            asset_types: meta.asset_types ? JSON.stringify(meta.asset_types) : null,
            metadata_raw: JSON.stringify(meta),
            size: meta.size || null,
        });
        migrated++;
    } catch (e) {
        console.warn(`  Skipping ${hash} (already exists or constraint error):`, e.message);
        skipped++;
    }
}

db.close();
console.log(`\nMigration complete: ${migrated} inserted, ${skipped} skipped, ${errors} errors.`);
if (errors > 0) process.exit(1);
