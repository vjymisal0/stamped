import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

import { getBlurScore } from 'blur-score';
import { getExposureInfo } from 'exposure-score';
import { getImageHash, similarity as hashSimilarity } from '@vijayishere/photo-hash';
import { readExif, stripExif } from '@vijayishere/strip-exif';
import { isValidPan, parsePan } from '@vijayishere/pan-validator';
import { isValidGstin, parseGstin } from '@vijayishere/gstin-validate';

import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.STAMPED_UPLOAD_DIR || path.join(__dirname, 'uploads');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const BLUR_THRESHOLD = 0.35;
const DUPLICATE_THRESHOLD = 0.9;

function imageFormat(buffer) {
  return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg'
    : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
}

export const app = express();
// This console contains local GPS and registry data and has no remote login.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const host = req.headers.host;
  let url;
  try { url = new URL(`http://${host}`); } catch { return res.sendStatus(403); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      (req.headers.origin && req.headers.origin !== url.origin) ||
      req.headers['sec-fetch-site'] === 'cross-site') return res.sendStatus(403);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', async (req, res, next) => {
  // Apply safe serving rules to legacy files as well as new uploads.
  const match = /^\/([\w-]+)\.(jpg|jpeg|png|webp)$/.exec(req.path);
  if (!match) return res.sendStatus(404);
  let file;
  try {
    file = await fs.open(path.join(UPLOAD_DIR, match[0].slice(1)), 'r');
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    const expected = match[2] === 'jpg' ? 'jpeg' : match[2];
    if (imageFormat(header) !== expected) return res.sendStatus(404);
  } catch { return res.sendStatus(404); }
  finally { await file?.close(); }
  next();
}, express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only JPEG, PNG and WebP uploads are accepted'), { status: 415 }));
    }
    cb(null, true);
  },
});

function toClientPhoto(row) {
  return {
    id: row.id,
    filename: row.filename,
    url: `/uploads/${row.filename}`,
    blurScore: row.blur_score,
    exposureScore: row.exposure_score,
    exposureVerdict: row.exposure_verdict,
    hash: row.hash,
    hasGps: !!row.has_gps,
    gpsLat: row.gps_lat,
    gpsLon: row.gps_lon,
    camMake: row.cam_make,
    camModel: row.cam_model,
    exifStripped: !!row.exif_stripped,
    duplicateOf: row.duplicate_of,
    similarity: row.similarity,
    issues: row.issues ? JSON.parse(row.issues) : [],
    stamp: row.stamp,
    createdAt: row.created_at,
  };
}

app.get('/api/photos', (req, res) => {
  const rows = db.prepare('SELECT * FROM photos ORDER BY created_at DESC').all();
  res.json(rows.map(toClientPhoto));
});

app.post('/api/photos', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo attached to the request' });

  try {
    const id = nanoid(10);
    const buffer = req.file.buffer;
    // Reject active/vector formats before invoking any image decoder.
    const format = imageFormat(buffer);
    if (!format) return res.status(415).json({ error: 'Only JPEG, PNG and WebP images are accepted' });
    let metadata;
    try { metadata = await sharp(buffer, { limitInputPixels: 16_000_000 }).metadata(); }
    catch { return res.status(400).json({ error: 'Invalid or oversized image' }); }
    if (metadata.format !== format || !metadata.width || !metadata.height ||
        metadata.width * metadata.height * (metadata.pages || 1) > 16_000_000) {
      return res.status(400).json({ error: 'Invalid or oversized image' });
    }
    const filename = `${id}.${format === 'jpeg' ? 'jpg' : format}`;

    const [blurScore, exposureInfo, hash, exif] = await Promise.all([
      getBlurScore(buffer),
      getExposureInfo(buffer),
      getImageHash(buffer),
      readExif(buffer).catch(() => null),
    ]);

    let duplicateOf = null;
    let bestSimilarity = 0;
    for (const row of db.prepare('SELECT id, hash FROM photos').all()) {
      if (!row.hash) continue;
      const sim = hashSimilarity(hash, row.hash);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        if (sim >= DUPLICATE_THRESHOLD) duplicateOf = row.id;
      }
    }

    const issues = [];
    if (blurScore < BLUR_THRESHOLD) issues.push('blurry');
    if (exposureInfo.verdict !== 'ok') issues.push(exposureInfo.verdict);
    if (exif?.hasGps) issues.push('gps-present');
    if (duplicateOf) issues.push('duplicate');

    const stamp = duplicateOf ? 'DUPLICATE' : issues.length ? 'FLAGGED' : 'PASSED';

    await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);

    db.prepare(`
      INSERT INTO photos (
        id, filename, blur_score, exposure_score, exposure_verdict, hash,
        has_gps, gps_lat, gps_lon, cam_make, cam_model, exif_stripped,
        duplicate_of, similarity, issues, stamp, created_at
      ) VALUES (@id, @filename, @blur_score, @exposure_score, @exposure_verdict, @hash,
        @has_gps, @gps_lat, @gps_lon, @cam_make, @cam_model, 0,
        @duplicate_of, @similarity, @issues, @stamp, @created_at)
    `).run({
      id,
      filename,
      blur_score: blurScore,
      exposure_score: exposureInfo.score,
      exposure_verdict: exposureInfo.verdict,
      hash,
      has_gps: exif?.hasGps ? 1 : 0,
      gps_lat: exif?.latitude ?? null,
      gps_lon: exif?.longitude ?? null,
      cam_make: exif?.make ?? null,
      cam_model: exif?.model ?? null,
      duplicate_of: duplicateOf,
      similarity: duplicateOf ? bestSimilarity : null,
      issues: JSON.stringify(issues),
      stamp,
      created_at: new Date().toISOString(),
    });

    const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    res.status(201).json(toClientPhoto(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process photo' });
  }
});

app.post('/api/photos/:id/strip', async (req, res) => {
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Photo not found' });

  try {
    const filePath = path.join(UPLOAD_DIR, row.filename);
    const buffer = await fs.readFile(filePath);
    const cleaned = await stripExif(buffer);
    await fs.writeFile(filePath, cleaned);

    db.prepare(`
      UPDATE photos SET exif_stripped = 1, has_gps = 0, gps_lat = NULL, gps_lon = NULL
      WHERE id = ?
    `).run(row.id);

    const updated = db.prepare('SELECT * FROM photos WHERE id = ?').get(row.id);
    res.json(toClientPhoto(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to strip metadata' });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Photo not found' });
  db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
  await fs.rm(path.join(UPLOAD_DIR, row.filename), { force: true });
  res.status(204).end();
});

app.get('/api/validations', (req, res) => {
  const rows = db.prepare('SELECT * FROM validations ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    input: r.input,
    valid: !!r.valid,
    details: r.details ? JSON.parse(r.details) : null,
    createdAt: r.created_at,
  })));
});

function recordValidation(kind, input, valid, details) {
  db.prepare(`
    INSERT INTO validations (id, kind, input, valid, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nanoid(10), kind, input, valid ? 1 : 0, JSON.stringify(details ?? null), new Date().toISOString());
}

app.post('/api/validate/pan', (req, res) => {
  const { pan, holderName } = req.body ?? {};
  if (typeof pan !== 'string' || !pan.trim()) return res.status(400).json({ error: 'PAN is required' });

  const valid = isValidPan(pan, holderName ? { holderName } : undefined);
  const parsed = parsePan(pan);
  recordValidation('pan', pan.trim().toUpperCase(), valid, parsed);
  res.json({ valid, parsed });
});

app.post('/api/validate/gstin', (req, res) => {
  const { gstin } = req.body ?? {};
  if (typeof gstin !== 'string' || !gstin.trim()) return res.status(400).json({ error: 'GSTIN is required' });

  const valid = isValidGstin(gstin);
  const parsed = parseGstin(gstin);
  recordValidation('gstin', gstin.trim().toUpperCase(), valid, parsed);
  res.json({ valid, parsed });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Invalid or oversized upload' });
  if (err.status === 415) return res.status(415).json({ error: err.message });
  if (err.status === 400) return res.status(400).json({ error: 'Invalid request' });
  console.error('Request failed:', err.message);
  res.status(500).json({ error: 'Request failed' });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 4173;
  app.listen(PORT, '127.0.0.1', () => console.log(`stamped running at http://localhost:${PORT}`));
}
