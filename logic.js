"use strict";

/* ── Seeded Random Number Generator (Mulberry32) ──────────────────────
   Returns a function that produces deterministic pseudo-random numbers
   between 0 and 1.  Same seed → same sequence every time.             */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Channel definitions ──────────────────────────────────────────────
   Each channel's averages: handle time (min), after-call work (min),
   first-contact resolution (%), satisfaction (%), daily call volume.   */
const CHANNELS = {
  voice:    { handle: 7.1, acw: 1.3, fcr: 72, csat: 82, volume: 5800 },
  email:    { handle: 8.7, acw: 1.9, fcr: 70, csat: 80, volume: 2400 },
  chat:     { handle: 4.6, acw: 0.7, fcr: 74, csat: 83, volume: 3600 },
  whatsapp: { handle: 3.9, acw: 0.5, fcr: 69, csat: 81, volume: 3200 },
};

/* Quality shifts in the "after" period (percentage-point deltas). */
const QUALITY_SHIFT = {
  voice: { fcr: +2, csat: +1 }, email: { fcr: +3, csat: +1 },
  chat:  { fcr: +2, csat: +1 }, whatsapp: { fcr: -2, csat: -4 },
};

/* ── Pick a channel weighted by daily volume ─────────────────────────
   Higher-volume channels appear proportionally more often.             */
function pickChannel(rand) {
  const names = Object.keys(CHANNELS);
  const total = names.reduce((s, n) => s + CHANNELS[n].volume, 0);
  let r = rand() * total;
  for (const n of names) { r -= CHANNELS[n].volume; if (r <= 0) return n; }
  return names[names.length - 1];
}

/* ── Generate one conversation record ────────────────────────────────
   Builds a single data row with realistic noise (0.6×–1.4× average).
   In the "after" period 80 % of calls get AI help; the agent then
   accepts, edits, or rejects the suggestion.                          */
function generateRecord(rand, period, index) {
  const channel = pickChannel(rand);
  const ch = CHANNELS[channel];
  let handleMin = ch.handle * (0.6 + rand() * 0.8);
  let acwMin    = ch.acw    * (0.6 + rand() * 0.8);
  let aiUsed = false, aiMode = "none", humanAction = "none";

  if (period === "after" && rand() < 0.80) {
    aiUsed = true;
    aiMode = ["assist", "draft", "summarize"][Math.floor(rand() * 3)];
    const roll = rand();
    humanAction = roll < 0.55 ? "accepted" : roll < 0.90 ? "edited" : "rejected";
    handleMin *= { accepted: 0.65, edited: 0.85, rejected: 1.10 }[humanAction];
    if (aiMode === "summarize") acwMin *= 0.5;
  }

  const fcrRate  = ch.fcr  + (period === "after" ? QUALITY_SHIFT[channel].fcr  : 0);
  const csatRate = ch.csat + (period === "after" ? QUALITY_SHIFT[channel].csat : 0);
  const agentId  = `emp_${4401 + Math.floor(rand() * 40)}`;
  const phone    = `+971 50 000 ${String(Math.floor(rand() * 10000)).padStart(4, "0")}`;
  const dayOff   = Math.floor(rand() * 90);
  const base     = period === "before" ? new Date(2025, 0, 1) : new Date(2025, 3, 1);
  base.setDate(base.getDate() + dayOff);

  return {
    interaction_id: `INT-${String(index).padStart(5, "0")}`,
    period, date: base.toISOString().slice(0, 10), channel,
    agent_id: agentId, customer_phone: phone,
    handle_time_secs: Math.round(handleMin * 60),
    acw_secs: Math.round(acwMin * 60),
    ai_used: aiUsed, ai_mode: aiMode, human_action: humanAction,
    resolved_first_contact: rand() * 100 < fcrRate,
    csat_satisfied: rand() * 100 < csatRate,
  };
}

/* ── Generate all 1 200 conversations ────────────────────────────────
   600 baseline ("before") + 600 with AI available ("after").          */
function generateAllRecords() {
  const rand = mulberry32(42);
  const records = [];
  for (let i = 0; i < 600; i++)  records.push(generateRecord(rand, "before", i));
  for (let i = 0; i < 600; i++)  records.push(generateRecord(rand, "after", 600 + i));
  return records;
}

/* ── SHA-256 of a string → hex ───────────────────────────────────────
   Uses the browser's built-in Web Crypto API — no libraries needed.   */
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── HMAC-SHA256 with a text key → hex ───────────────────────────────
   Keyed hash: without the secret you can't reproduce the output,
   so an attacker can't just hash all 40 employee IDs and reverse it.  */
async function hmacSha256(key, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── Canonical JSON ──────────────────────────────────────────────────
   Sorted keys, no extra whitespace.  Identical objects always produce
   the exact same byte string, which is required for consistent hashing. */
function canonicalJSON(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/* ── Scramble records: replace PII with keyed hashes ─────────────────
   agent_id and customer_phone are replaced by HMAC-SHA256 codes.
   A raw_hash (plain SHA-256 of the original row) is added so the
   original data integrity can be checked later.                       */
async function scrambleRecords(records, key) {
  const results = await Promise.all(records.map(async (r) => {
    const [ah, ph, rh] = await Promise.all([
      hmacSha256(key, r.agent_id),
      hmacSha256(key, r.customer_phone),
      sha256(canonicalJSON(r)),
    ]);
    return { ...r, agent_id: ah, customer_phone: ph, raw_hash: rh };
  }));
  return results;
}

/* ── Compute per-channel metrics and apply the quality gate ──────────
   Minutes saved = (handle + acw) before − after.
   Hours/day = minutes saved × daily volume ÷ 60.
   PASS only if CSAT drops ≤ 2 points AND FCR does not drop.          */
function computeMetrics(records) {
  const buckets = {};
  for (const ch of Object.keys(CHANNELS)) buckets[ch] = { before: [], after: [] };
  for (const r of records) buckets[r.channel][r.period].push(r);

  const results = {};
  let totalVerifiedHours = 0, totalHeldHours = 0;

  for (const [ch, p] of Object.entries(buckets)) {
    const avg = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0;
    const pct = (a, f) => a.length ? (a.filter(f).length / a.length) * 100 : 0;
    const bH = avg(p.before, r => r.handle_time_secs) / 60;
    const aH = avg(p.after,  r => r.handle_time_secs) / 60;
    const bA = avg(p.before, r => r.acw_secs) / 60;
    const aA = avg(p.after,  r => r.acw_secs) / 60;
    const bF = pct(p.before, r => r.resolved_first_contact);
    const aF = pct(p.after,  r => r.resolved_first_contact);
    const bC = pct(p.before, r => r.csat_satisfied);
    const aC = pct(p.after,  r => r.csat_satisfied);
    const minSaved = (bH + bA) - (aH + aA);
    const hpd = (minSaved * CHANNELS[ch].volume) / 60;
    const pass = (bC - aC) <= 2 && (aF - bF) >= 0;
    if (pass) totalVerifiedHours += hpd; else totalHeldHours += hpd;
    results[ch] = {
      before: { handle: bH, acw: bA, fcr: bF, csat: bC },
      after:  { handle: aH, acw: aA, fcr: aF, csat: aC },
      minSaved, hoursPerDay: hpd, pass,
      csatDelta: aC - bC, fcrDelta: aF - bF,
    };
  }

  const ai = records.filter(r => r.period === "after" && r.ai_used);
  const actions = { accepted: 0, edited: 0, rejected: 0 };
  for (const r of ai) actions[r.human_action]++;
  return { channels: results, totalVerifiedHours, totalHeldHours, actionCounts: actions };
}

/* ── Merkle leaf hash ────────────────────────────────────────────────
   SHA-256( 0x00 ∥ data_bytes ).  The 0x00 prefix prevents a leaf
   from being mistaken for an internal node (second-preimage safety).  */
async function merkleLeafHash(data) {
  const payload = new TextEncoder().encode(data);
  const buf = new Uint8Array(1 + payload.length);
  buf[0] = 0x00;
  buf.set(payload, 1);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── Merkle internal-node hash ───────────────────────────────────────
   SHA-256( 0x01 ∥ left_32_bytes ∥ right_32_bytes ).                   */
async function merkleNodeHash(leftHex, rightHex) {
  const toB = hex => new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const buf = new Uint8Array(65);
  buf[0] = 0x01;
  buf.set(toB(leftHex), 1);
  buf.set(toB(rightHex), 33);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── Build the full Merkle tree ──────────────────────────────────────
   levels[0] = leaf hashes, … , levels[last] = [root].
   Odd-count levels: last node promotes up unchanged.
   Leaf hashing is parallelised; upper levels pair-by-pair.            */
async function buildMerkleTree(records) {
  let current = await Promise.all(
    records.map(r => merkleLeafHash(canonicalJSON(r)))
  );
  const levels = [current.slice()];

  while (current.length > 1) {
    const next = [];
    const promises = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) promises.push(merkleNodeHash(current[i], current[i + 1]));
      else promises.push(Promise.resolve(current[i]));
    }
    const resolved = await Promise.all(promises);
    next.push(...resolved);
    levels.push(next);
    current = next;
  }
  return { levels, root: current[0] };
}

/* ── Inclusion proof for one leaf ────────────────────────────────────
   Walk up the tree, collecting each sibling hash and which side it's on. */
function getInclusionProof(tree, index) {
  const proof = [];
  let idx = index;
  for (let lv = 0; lv < tree.levels.length - 1; lv++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sib >= 0 && sib < tree.levels[lv].length) {
      proof.push({ hash: tree.levels[lv][sib], position: idx % 2 === 0 ? "right" : "left" });
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/* ── Verify an inclusion proof against a known root ──────────────────
   Rehash the leaf up the path with each sibling; final hash must
   equal the expected root.  If not, the data has been tampered with.   */
async function verifyInclusionProof(leafHash, proof, expectedRoot) {
  let h = leafHash;
  for (const s of proof) {
    h = s.position === "right"
      ? await merkleNodeHash(h, s.hash)
      : await merkleNodeHash(s.hash, h);
  }
  return h === expectedRoot;
}
