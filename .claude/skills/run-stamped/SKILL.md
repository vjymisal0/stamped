---
name: run-stamped
description: Build, launch, and drive the STAMPED QC console (Express + SQLite app testing blur-score/exposure-score/photo-hash/strip-exif/pan-validator/gstin-validate). Use to run, start, screenshot, or smoke-test the stamped app.
---

Paths below are relative to the project root (`stamped/`), not this skill directory.

STAMPED is a plain Express + SQLite web app served at a single port — no
build step. It's driven with a small Playwright script
(`.claude/skills/run-stamped/driver.mjs`) rather than a browser extension,
since headless Chromium via Playwright works in any environment.

## Prerequisites

```bash
npm install
npx playwright install chromium   # one-time, ~300MB
```

## Run (agent path)

Start the server with an **isolated DB and uploads dir** so smoke runs never
touch real data (`stamped.db` / `uploads/` at the project root):

```bash
STAMPED_DB_PATH=/tmp/stamped-smoke.db \
STAMPED_UPLOAD_DIR=/tmp/stamped-smoke-uploads \
PORT=4173 node server.js &

# poll until it's actually serving
timeout 15 bash -c 'until curl -sf http://localhost:4173/ >/dev/null; do sleep 0.5; done'
```

Then drive it:

```bash
node .claude/skills/run-stamped/driver.mjs
```

This uploads a sample photo from `../photo-hash/samples/photo1_camera.jpg`
(a sibling package under `D:/projects`), waits for it to come back scored
and stamped, switches to the Registry tab, runs a PAN check, and writes
three screenshots to `.claude/skills/run-stamped/screenshots/`:

- `01-intake-empty.png` — empty state
- `02-intake-uploaded.png` — uploaded photo with its FLAGGED/PASSED/DUPLICATE stamp, scores, and GPS tag
- `03-registry-pan.png` — PAN form result + ledger row

It exits non-zero and prints any browser console errors it saw — check
those before trusting a screenshot.

Stop the server when done:

```bash
# Windows
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
# Linux/macOS
lsof -ti:4173 -sTCP:LISTEN | xargs -r kill
```

## Run (human path)

```bash
npm start
```

Opens on `http://localhost:4173` using the real `stamped.db` and `uploads/`
at the project root (both gitignored).

## Gotchas

- **`.frame-thumb-wrap { position: relative }` used to hide the stamp badge
  entirely.** Two positioned siblings (`.stamp` absolute, `.frame-thumb-wrap`
  relative) paint in DOM order when both have `z-index: auto`, and
  `.frame-thumb-wrap` comes second — so it painted over the badge with
  nothing visibly wrong in computed styles (`opacity: 1`, correct color, all
  correct). It only showed up by cropping a screenshot to the badge's exact
  bounding box. Fixed by dropping the unneeded `position: relative` and
  giving `.stamp` `z-index: 2`. If you add more overlay elements to
  `.frame-card`, check them against a real screenshot, not just computed
  style — computed style lies about paint order.
- **The stamp badge has a 400ms entrance animation** (`stamp-in`
  keyframes). `waitForSelector('.stamp')` resolves the instant the element
  attaches to the DOM, mid-animation — screenshotting immediately catches a
  half-scaled, partially transparent badge. The driver waits an extra
  500ms after the selector resolves; do the same in any script that
  screenshots a freshly-appended `.frame-card`.
- **`STAMPED_DB_PATH` / `STAMPED_UPLOAD_DIR` env vars exist specifically for
  this driver** — without them the smoke run writes into the real
  `stamped.db` and `uploads/` at the project root.
- The sample photo path assumes the sibling packages
  (`blur-score`, `photo-hash`, etc.) still live under `D:/projects/` next to
  `stamped/` — that's also how `package.json`'s `file:../...` dependencies
  resolve.
