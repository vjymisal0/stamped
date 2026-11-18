import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import { chromium } from 'playwright';

let server, base, db, browser, temp;
before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stamped-security-'));
  process.env.STAMPED_DB_PATH = path.join(temp, 'fixture.db');
  process.env.STAMPED_UPLOAD_DIR = path.join(temp, 'uploads');
  const { app } = await import('../server.js');
  ({ db } = await import('../db.js'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  db?.close();
  if (temp && path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('stamped-security-')) {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
async function upload(bytes, name, type) {
  const form = new FormData();
  form.set('photo', new Blob([bytes], { type }), name);
  return fetch(`${base}/api/photos`, { method: 'POST', body: form });
}
test('rejects active SVG uploads', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/><script>/* fixture */</script></svg>';
  assert.equal((await upload(svg, 'active.svg', 'image/svg+xml')).status, 415);
});
test('blocks legacy active files and mismatched image extensions', async () => {
  for (const filename of ['legacy.svg', 'legacy.html', 'disguised.png']) {
    await fs.writeFile(path.join(process.env.STAMPED_UPLOAD_DIR, filename), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal((await fetch(`${base}/uploads/${filename}`)).status, 404);
  }
});
test('derives image extension from bytes and preserves SQLite photo operations', async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#a54232' } }).png().toBuffer();
  const response = await upload(png, 'photo.html', 'image/png');
  assert.equal(response.status, 201);
  const photo = await response.json();
  assert.match(photo.filename, /^[\w-]+\.png$/);
  const image = await fetch(base + photo.url);
  assert.match(image.headers.get('content-type'), /^image\/png/);
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(`${base}/api/photos/${photo.id}/strip`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base}/api/photos/${photo.id}`, { method: 'DELETE' })).status, 204);
});
test('rejects foreign Origin and rebinding Host before exposing local records', async () => {
  assert.equal((await fetch(base + '/api/photos', { headers: { Origin: 'https://example.org' } })).status, 403);
  const status = await new Promise((resolve, reject) => {
    http.get(base + '/api/photos', { headers: { Host: 'rebind.example.org' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
});
test('renders persisted invalid ledger input as text in the real browser', async () => {
  const payload = '<SVG DATA-LEDGER-INJECTION="YES"></SVG>';
  const response = await fetch(base + '/api/validate/pan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pan: payload }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).valid, false);
  assert.ok((await (await fetch(base + '/api/validations')).json()).some(row => row.input === payload));
  browser = await chromium.launch(process.env.STAMPED_CHROMIUM ? { executablePath: process.env.STAMPED_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto(base);
  await page.locator('.log-input').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-ledger-injection]').count(), 0);
  assert.ok((await page.locator('#logList').textContent()).includes(payload));
});
