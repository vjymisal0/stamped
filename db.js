import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, 'stamped.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    blur_score REAL,
    exposure_score REAL,
    exposure_verdict TEXT,
    hash TEXT,
    has_gps INTEGER,
    gps_lat REAL,
    gps_lon REAL,
    cam_make TEXT,
    cam_model TEXT,
    exif_stripped INTEGER DEFAULT 0,
    duplicate_of TEXT,
    similarity REAL,
    issues TEXT,
    stamp TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS validations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    input TEXT NOT NULL,
    valid INTEGER NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );
`);
