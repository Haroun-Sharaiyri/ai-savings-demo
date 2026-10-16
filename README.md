# Proof of AI Savings

**An interactive prototype showing how to verify AI productivity claims.**

Everything runs in the browser on fake data. No backend, no tracking, no external APIs.

![HTML](https://img.shields.io/badge/HTML-plain-orange)
![CSS](https://img.shields.io/badge/CSS-plain-blue)
![JavaScript](https://img.shields.io/badge/JS-plain-yellow)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What is this?

When someone says "AI saved us 200 hours a day," how do you verify that? This prototype walks through a six-step pipeline that generates fake contact-center data, anonymises it, measures savings with a quality gate, and locks everything into a Merkle tree so any tampering is instantly detectable.

It's a learning tool — not production software.

## Live demo

Open `index.html` in any modern browser, or deploy the four core files to any static host (Vercel, Netlify, GitHub Pages).

## Pipeline

| Step | What it does |
|------|-------------|
| **1. Generate** | 1,200 seeded conversations (600 before AI, 600 after) using mulberry32 (seed 42) |
| **2. Scramble** | Replaces agent IDs and phone numbers with HMAC-SHA256 codes; explains why plain SHA-256 is unsafe for small ID sets |
| **3. Measure & Gate** | Per-channel before/after metrics; PASS only if CSAT drops ≤ 2 points and FCR doesn't drop; otherwise HELD FOR REVIEW |
| **4. Lock** | Builds a Merkle tree (SHA-256, `0x00` leaf / `0x01` node prefixes); displays level counts shrinking from 1,200 → 1 |
| **5. Prove & Tamper** | Pick any record, see its inclusion proof, then change handle time by 1 second and watch the proof break |
| **6. Anchor** | Download `merkle_root.txt` with the root hash, record count, verified hours, and instructions for timestamping at opentimestamps.org |

## Channel parameters

| Channel | Handle (min) | ACW (min) | FCR % | CSAT % | Daily volume |
|---------|:---:|:---:|:---:|:---:|:---:|
| Voice | 7.1 | 1.3 | 72 | 82 | 5,800 |
| Email | 8.7 | 1.9 | 70 | 80 | 2,400 |
| Chat | 4.6 | 0.7 | 74 | 83 | 3,600 |
| WhatsApp | 3.9 | 0.5 | 69 | 81 | 3,200 |

## Tech

- **Plain HTML, CSS, JavaScript** — no frameworks, no build step
- **Web Crypto API** (`crypto.subtle`) for SHA-256 and HMAC-SHA256
- **Seeded RNG** (mulberry32, seed 42) for reproducible data
- **Responsive** down to phone width
- **Light & dark mode** with system preference detection

## Files

```
index.html    ← single-page structure
styles.css    ← light/dark theme, responsive layout
logic.js      ← all verification logic (251 lines, every function commented)
ui.js         ← DOM interactions and rendering
tests.html    ← browser-based test suite
test.js       ← Node.js test runner (same tests)
```

## Running tests

**In the browser:** open `tests.html`.

**In Node.js:**

```bash
node test.js
```

Both run the same checks:

- ✓ Every inclusion proof verifies
- ✓ Merkle trees at sizes 1, 2, 3, 5, 7, and 1,001 work correctly
- ✓ Changing any single record changes the root hash
- ✓ Data generation is deterministic (same seed → same data)
- ✓ Quality gate correctly holds WhatsApp (CSAT drops > 2 points)

## Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy (zero config — it detects static files automatically)
vercel
```

Or connect this repo to Vercel via the dashboard — it will deploy on every push.

## What this proves (and what it can't)

**It proves:** nothing changed in the dataset after the Merkle root was computed. Anyone with a record and its inclusion proof can verify it belongs to the exact locked dataset.

**It cannot prove:** whether the raw data was truthful in the first place. The root locks the data — it does not validate it.

---

Built by **Haroun Sharaiyri** · fake data · learning prototype
