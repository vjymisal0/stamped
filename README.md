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

```
npm install
npm start
```

Then open http://localhost:4173.

Data lives in `stamped.db` (SQLite, via `better-sqlite3`) and uploaded images
in `uploads/` — both gitignored, both local to this machine.
