// Drives the running STAMPED server with Playwright: uploads a sample photo
// through Intake, checks a PAN through Registry, and screenshots both.
//
// Usage: node .claude/skills/run-stamped/driver.mjs
// Assumes the server is already running (see SKILL.md for how to start it).

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..'); // project root
const BASE_URL = process.env.STAMPED_URL || 'http://localhost:4173';
const SHOT_DIR = path.join(__dirname, 'screenshots');
const SAMPLE_PHOTO = path.resolve(ROOT, '..', 'photo-hash', 'samples', 'photo1_camera.jpg');

async function main() {
  await fs.mkdir(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=STAMPED');
  await page.screenshot({ path: path.join(SHOT_DIR, '01-intake-empty.png') });

  // Upload a sample photo and wait for it to come back stamped.
  await page.setInputFiles('#fileInput', SAMPLE_PHOTO);
  await page.waitForSelector('.frame-card .stamp', { timeout: 15000 });
  await page.waitForTimeout(500); // let the stamp's entrance animation settle
  await page.screenshot({ path: path.join(SHOT_DIR, '02-intake-uploaded.png') });

  // Switch to Registry and run a PAN check.
  await page.click('button[data-tab="registry"]');
  await page.fill('#panForm input[name="pan"]', 'ABCPD1234E');
  await page.click('#panForm button[type="submit"]');
  await page.waitForSelector('#panResult .stamp');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-registry-pan.png') });

  await browser.close();

  console.log(`Screenshots written to ${SHOT_DIR}`);
  if (consoleErrors.length) {
    console.log('Console errors observed:');
    consoleErrors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  } else {
    console.log('No console errors observed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
