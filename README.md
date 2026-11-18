# STAMPED

A small QC console for test-driving six local packages together:

- [`blur-score`](../blur-score) — sharpness scoring
- [`exposure-score`](../exposure-score) — exposure scoring
- [`@vijayishere/photo-hash`](../photo-hash) — perceptual hashing / near-duplicate detection
- [`@vijayishere/strip-exif`](../strip-exif) — EXIF/GPS reading & stripping
- [`@vijayishere/pan-validator`](../pan-validator) — Indian PAN validation
- [`@vijayishere/gstin-validate`](../gstin-validate) — Indian GSTIN validation

## What it does

**Intake** — drop a photo in. It's scored for sharpness and exposure, hashed and
compared against every previous upload for near-duplicates, and scanned for
embedded GPS data. Results are stamped `PASSED`, `FLAGGED`, or `DUPLICATE` and
persisted to SQLite. Flagged photos with GPS data can be cleaned in place via
`strip-exif`.

**Registry** — run a PAN or GSTIN through its structural/checksum rules. Every
check (valid or not) is filed in a ledger backed by the same SQLite database.

## Run it

Requires Node.js 24 or newer. SQLite uses Node's built-in `node:sqlite` driver;
the database file and SQL schema are unchanged. Back up existing local data
before upgrading the runtime.

```
npm install
npm start
```

Then open http://localhost:4173.

Data lives in `stamped.db` (SQLite, via `node:sqlite`) and uploaded images
in `uploads/` — both gitignored, both local to this machine.

The console binds to `127.0.0.1` and rejects foreign Host/Origin requests. It has
no remote authentication: keep it local rather than exposing it through a proxy.
New uploads accept JPEG, PNG and WebP only, up to 25 MiB and 16 million total
pixels. The server checks image bytes and chooses the stored extension; SVG is
rejected. GPS metadata remains available until you choose Strip EXIF.

Existing uploads are not rewritten. Serving also checks the extension and image
signature, so old SVG/HTML uploads and disguised image files are blocked. Ledger
and photo labels are escaped when rendered.

Run `npx playwright install chromium` once, then `npm test` for HTTP, SQLite,
upload and browser regression checks. `STAMPED_CHROMIUM` can select an existing
Chromium executable. Tests use isolated temporary data, not `stamped.db`.
