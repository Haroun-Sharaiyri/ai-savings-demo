"use strict";

/* ══════════════════════════════════════════════════════════════════════
   ui.js — DOM interactions for the Proof of AI Savings prototype.
   Reads logic.js globals (generateAllRecords, sha256, hmacSha256, …).
   ══════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────
let rawRecords    = null;   // original 1 200 rows
let cleanRecords  = null;   // PII-scrambled rows
let hmacKey       = "";
let metrics       = null;
let merkleTree    = null;
let merkleRoot    = null;

// ── Helpers ───────────────────────────────────────────────────────────

/** Shorten a 64-char hex hash to "first12…last6". */
function short(hash) {
  if (!hash || hash.length < 20) return hash;
  return hash.slice(0, 12) + "…" + hash.slice(-6);
}

/** Return HTML for a shortened, click-to-copy hash span. */
function hashSpan(hash) {
  return `<span class="hash mono" data-full="${hash}" title="Click to copy full hash">${short(hash)}</span>`;
}

/** Copy text to clipboard and flash a "Copied" indicator. */
function copyHash(el) {
  const full = el.dataset.full;
  navigator.clipboard.writeText(full).then(() => {
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 1500);
  });
}

/** Utility: build an HTML table from column defs and row data. */
function makeTable(columns, rows) {
  let h = '<div class="table-wrap"><table><thead><tr>';
  for (const c of columns) h += `<th>${c.label}</th>`;
  h += "</tr></thead><tbody>";
  for (const row of rows) {
    h += "<tr>";
    for (const c of columns) h += `<td>${c.render(row)}</td>`;
    h += "</tr>";
  }
  h += "</tbody></table></div>";
  return h;
}

/** Format a number to fixed decimals. */
const fix = (n, d = 2) => Number(n).toFixed(d);

/** Generate a random hex string for use as an HMAC key. */
function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Theme toggle ──────────────────────────────────────────────────────
const themeBtn = document.getElementById("theme-toggle");
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
  localStorage.setItem("theme", t);
}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  setTheme(cur === "dark" ? "light" : "dark");
});
// honour saved preference
if (localStorage.getItem("theme")) setTheme(localStorage.getItem("theme"));
else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");

// ── Delegated click handler for hash copy ─────────────────────────────
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("hash")) copyHash(e.target);
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 1 — Generate Data
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-generate").addEventListener("click", () => {
  rawRecords = generateAllRecords();

  const before = rawRecords.filter(r => r.period === "before");
  const after  = rawRecords.filter(r => r.period === "after");

  const cols = [
    { label: "ID",      render: r => r.interaction_id },
    { label: "Period",  render: r => r.period },
    { label: "Date",    render: r => r.date },
    { label: "Channel", render: r => r.channel },
    { label: "Agent",   render: r => r.agent_id },
    { label: "Phone",   render: r => r.customer_phone },
    { label: "Handle(s)", render: r => r.handle_time_secs },
    { label: "ACW(s)",  render: r => r.acw_secs },
    { label: "AI",      render: r => r.ai_used ? "✓" : "—" },
    { label: "Mode",    render: r => r.ai_mode },
    { label: "Action",  render: r => r.human_action },
    { label: "FCR",     render: r => r.resolved_first_contact ? "✓" : "✗" },
    { label: "CSAT",    render: r => r.csat_satisfied ? "✓" : "✗" },
  ];

  const sample = rawRecords.slice(0, 5);
  const out = document.getElementById("output-data");
  out.innerHTML = `
    <div class="cards mt-2">
      <div class="card"><div class="card-title">Before</div><div class="card-value">${before.length}</div><div class="card-sub">baseline records</div></div>
      <div class="card"><div class="card-title">After</div><div class="card-value">${after.length}</div><div class="card-sub">AI-period records</div></div>
      <div class="card"><div class="card-title">Total</div><div class="card-value">${rawRecords.length}</div><div class="card-sub">conversations</div></div>
    </div>
    <h3 class="mt-2 mb-1">Sample rows (first 5)</h3>
    ${makeTable(cols, sample)}
  `;

  document.getElementById("btn-scramble").disabled = false;
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 2 — Scramble PII
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-random-key").addEventListener("click", () => {
  document.getElementById("hmac-key").value = randomHex();
});

document.getElementById("btn-scramble").addEventListener("click", async () => {
  const keyInput = document.getElementById("hmac-key");
  hmacKey = keyInput.value.trim();
  if (!hmacKey) { alert("Enter or generate an HMAC key first."); return; }

  const btn = document.getElementById("btn-scramble");
  btn.disabled = true; btn.classList.add("running"); btn.textContent = "Scrambling…";

  cleanRecords = await scrambleRecords(rawRecords, hmacKey);

  // Demo: hash emp_4471 three ways
  const demoId = "emp_4471";
  const hmac1 = await hmacSha256(hmacKey, demoId);
  const hmac2 = await hmacSha256("a-different-key", demoId);
  const plain = await sha256(demoId);

  const sampleCols = [
    { label: "ID",      render: r => r.interaction_id },
    { label: "Agent (hashed)", render: r => hashSpan(r.agent_id) },
    { label: "Phone (hashed)", render: r => hashSpan(r.customer_phone) },
    { label: "Channel", render: r => r.channel },
    { label: "Handle(s)", render: r => r.handle_time_secs },
    { label: "Raw hash", render: r => hashSpan(r.raw_hash) },
  ];

  const out = document.getElementById("output-scramble");
  out.innerHTML = `
    <h3 class="mt-2 mb-1">Scrambled sample (first 5)</h3>
    ${makeTable(sampleCols, cleanRecords.slice(0, 5))}

    <h3 class="mt-2 mb-1">Why HMAC, not plain SHA-256?</h3>
    <div class="table-wrap mt-1">
      <table>
        <thead><tr><th>Method</th><th>Input</th><th>Output</th></tr></thead>
        <tbody>
          <tr><td>HMAC with <strong>your key</strong></td><td class="mono">${demoId}</td><td>${hashSpan(hmac1)}</td></tr>
          <tr><td>HMAC with <strong>different key</strong></td><td class="mono">${demoId}</td><td>${hashSpan(hmac2)}</td></tr>
          <tr><td>Plain SHA-256 <span class="badge badge-fail"><span class="badge-icon">⚠</span> Unsafe</span></td><td class="mono">${demoId}</td><td>${hashSpan(plain)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="warning-box mt-2">
      <strong>⚠ Plain SHA-256 is unsafe for small ID sets.</strong>
      There are only 40 employee IDs (emp_4401–emp_4440).
      Anyone can hash all 40 and build a lookup table, reversing the
      "anonymisation" instantly. HMAC-SHA256 requires the secret key,
      so only the key holder can link a hash back to a real ID.
    </div>

    <div class="info-box mt-1">
      <strong>✓ No personal fields remain.</strong>
      Agent IDs and phone numbers are now irreversible HMAC codes.
      The dataset is safe for third-party audit.
    </div>
  `;

  btn.classList.remove("running"); btn.textContent = "Run";
  btn.disabled = false;
  document.getElementById("btn-measure").disabled = false;
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 3 — Measure & Quality Gate
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-measure").addEventListener("click", () => {
  metrics = computeMetrics(rawRecords);

  // Per-channel table
  let rows = [];
  for (const [ch, m] of Object.entries(metrics.channels)) {
    rows.push({
      channel: ch,
      bHandle: fix(m.before.handle), aHandle: fix(m.after.handle),
      bAcw: fix(m.before.acw), aAcw: fix(m.after.acw),
      bFcr: fix(m.before.fcr, 1), aFcr: fix(m.after.fcr, 1),
      bCsat: fix(m.before.csat, 1), aCsat: fix(m.after.csat, 1),
      minSaved: fix(m.minSaved), hpd: fix(m.hoursPerDay, 1),
      pass: m.pass,
      fcrDelta: m.fcrDelta, csatDelta: m.csatDelta,
    });
  }

  const metricCols = [
    { label: "Channel",       render: r => `<strong>${r.channel}</strong>` },
    { label: "Handle Before", render: r => r.bHandle + " min" },
    { label: "Handle After",  render: r => r.aHandle + " min" },
    { label: "ACW Before",    render: r => r.bAcw + " min" },
    { label: "ACW After",     render: r => r.aAcw + " min" },
    { label: "FCR Before",    render: r => r.bFcr + "%" },
    { label: "FCR After",     render: r => r.aFcr + "% (" + (r.fcrDelta >= 0 ? "+" : "") + fix(r.fcrDelta, 1) + ")" },
    { label: "CSAT Before",   render: r => r.bCsat + "%" },
    { label: "CSAT After",    render: r => r.aCsat + "% (" + (r.csatDelta >= 0 ? "+" : "") + fix(r.csatDelta, 1) + ")" },
    { label: "Min Saved",     render: r => r.minSaved + " min" },
    { label: "Hours/Day",     render: r => r.hpd + " h" },
    { label: "Gate",          render: r => r.pass
        ? '<span class="badge badge-pass"><span class="badge-icon">✓</span> PASS</span>'
        : '<span class="badge badge-held"><span class="badge-icon">⏸</span> HELD FOR REVIEW</span>' },
  ];

  // Action split
  const ac = metrics.actionCounts;
  const total = ac.accepted + ac.edited + ac.rejected;
  const pctA = ((ac.accepted / total) * 100).toFixed(1);
  const pctE = ((ac.edited   / total) * 100).toFixed(1);
  const pctR = ((ac.rejected / total) * 100).toFixed(1);

  const out = document.getElementById("output-measure");
  out.innerHTML = `
    <div class="hero-block">
      <div class="hero-number" style="color:var(--green)">${fix(metrics.totalVerifiedHours, 1)}</div>
      <div class="hero-label">Verified hours saved per day</div>
    </div>

    ${metrics.totalHeldHours !== 0 ? `
    <div class="hero-block" style="border-color:var(--amber-border)">
      <div class="hero-number" style="color:var(--amber);font-size:2rem">${fix(metrics.totalHeldHours, 1)}</div>
      <div class="hero-label">Hours held for review (quality gate not met)</div>
    </div>` : ""}

    <h3 class="mt-2 mb-1">Per-channel breakdown</h3>
    ${makeTable(metricCols, rows)}

    <h3 class="mt-2 mb-1">Agent action split</h3>
    <div class="split-bar">
      <div class="seg seg-accepted" style="width:${pctA}%">${pctA}%</div>
      <div class="seg seg-edited"   style="width:${pctE}%">${pctE}%</div>
      <div class="seg seg-rejected" style="width:${pctR}%">${pctR}%</div>
    </div>
    <div class="split-legend">
      <span><span class="dot" style="background:var(--green)"></span> Accepted (${ac.accepted})</span>
      <span><span class="dot" style="background:var(--accent)"></span> Edited (${ac.edited})</span>
      <span><span class="dot" style="background:var(--red)"></span> Rejected — <em>the verification tax</em> (${ac.rejected})</span>
    </div>
  `;

  document.getElementById("btn-lock").disabled = false;
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 4 — Lock (Merkle Tree)
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-lock").addEventListener("click", async () => {
  const btn = document.getElementById("btn-lock");
  btn.disabled = true; btn.classList.add("running"); btn.textContent = "Building tree…";

  merkleTree = await buildMerkleTree(cleanRecords);
  merkleRoot = merkleTree.root;

  // Level visualisation
  const maxCount = merkleTree.levels[0].length;
  let levelsHtml = "";
  for (let i = 0; i < merkleTree.levels.length; i++) {
    const count = merkleTree.levels[i].length;
    const pct = (count / maxCount) * 100;
    levelsHtml += `
      <div class="level-bar">
        <span class="level-label">Level ${i}</span>
        <span class="level-count">${count}</span>
        <div class="level-vis"><div class="level-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  const out = document.getElementById("output-lock");
  out.innerHTML = `
    <div class="info-box mt-2">
      <strong>Canonical JSON:</strong> Each record is serialised with sorted keys and
      no whitespace, then hashed with a <code>0x00</code> leaf prefix.  Pairs are combined
      with <code>0x01</code> node prefixes until one root remains.
    </div>
    <h3 class="mt-2 mb-1">Tree levels (${merkleTree.levels.length})</h3>
    ${levelsHtml}
    <div class="hero-block mt-2">
      <div class="hero-label">Merkle Root</div>
      <div class="mono mt-1" style="font-size:1rem;word-break:break-all">${hashSpan(merkleRoot)}</div>
    </div>
  `;

  btn.classList.remove("running"); btn.textContent = "Run";
  btn.disabled = false;
  document.getElementById("btn-prove").disabled = false;
  document.getElementById("btn-tamper").disabled = false;
  document.getElementById("btn-anchor").disabled = false;
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 5 — Prove & Tamper
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-prove").addEventListener("click", async () => {
  const idx = parseInt(document.getElementById("proof-index").value, 10);
  if (isNaN(idx) || idx < 0 || idx >= cleanRecords.length) {
    alert("Enter a record number between 0 and " + (cleanRecords.length - 1)); return;
  }

  const record = cleanRecords[idx];
  const leafHash = await merkleLeafHash(canonicalJSON(record));
  const proof = getInclusionProof(merkleTree, idx);
  const valid = await verifyInclusionProof(leafHash, proof, merkleRoot);

  let stepsHtml = `
    <div class="proof-step" style="border-left-color:var(--accent)">
      <span class="side-label">Leaf</span>
      ${hashSpan(leafHash)}
    </div>`;
  for (let i = 0; i < proof.length; i++) {
    stepsHtml += `
    <div class="proof-step">
      <span class="side-label">${proof[i].position}</span>
      ${hashSpan(proof[i].hash)}
    </div>`;
  }
  stepsHtml += `
    <div class="proof-step" style="border-left-color:var(--green)">
      <span class="side-label">Root</span>
      ${hashSpan(merkleRoot)}
    </div>`;

  const badge = valid
    ? '<span class="badge badge-pass"><span class="badge-icon">✓</span> Verified</span>'
    : '<span class="badge badge-fail"><span class="badge-icon">✗</span> FAILED</span>';

  const out = document.getElementById("output-prove");
  out.innerHTML = `
    <h3 class="mt-2 mb-1">Inclusion proof for record #${idx} ${badge}</h3>
    <div class="text-sm text-2 mb-1">
      ${proof.length} sibling hashes needed to reach the root from leaf #${idx}.
    </div>
    ${stepsHtml}
  `;
});

document.getElementById("btn-tamper").addEventListener("click", async () => {
  const idx = parseInt(document.getElementById("proof-index").value, 10);
  if (isNaN(idx) || idx < 0 || idx >= cleanRecords.length) {
    alert("Enter a record number between 0 and " + (cleanRecords.length - 1)); return;
  }

  const btn = document.getElementById("btn-tamper");
  btn.disabled = true; btn.textContent = "Rebuilding…";

  // Tamper: change handle_time_secs by 1 second
  const tampered = cleanRecords.map((r, i) => {
    if (i === idx) return { ...r, handle_time_secs: r.handle_time_secs + 1 };
    return r;
  });

  const newTree = await buildMerkleTree(tampered);
  const newRoot = newTree.root;

  // Try verifying the OLD proof against the NEW root
  const oldLeaf = await merkleLeafHash(canonicalJSON(cleanRecords[idx]));
  const oldProof = getInclusionProof(merkleTree, idx);
  const stillValid = await verifyInclusionProof(oldLeaf, oldProof, newRoot);

  const out = document.getElementById("output-prove");
  out.innerHTML += `
    <div class="compare-row mt-2">
      <div class="compare-box old">
        <div class="compare-label old">Original root</div>
        <div class="mono">${hashSpan(merkleRoot)}</div>
      </div>
      <div class="compare-box new">
        <div class="compare-label new">Tampered root (+1 sec on record #${idx})</div>
        <div class="mono">${hashSpan(newRoot)}</div>
      </div>
    </div>
    <div class="mt-1">
      Old proof against new root:
      ${stillValid
        ? '<span class="badge badge-pass"><span class="badge-icon">✓</span> Still valid</span>'
        : '<span class="badge badge-fail"><span class="badge-icon">✗</span> Tamper detected — proof invalid</span>'}
    </div>
    <div class="info-box mt-1">
      Changing handle time by just <strong>1 second</strong> in record #${idx}
      produced a completely different root hash.  Every byte matters.
    </div>
  `;

  btn.disabled = false; btn.textContent = "⚠ Change handle time by 1 s";
});

// ══════════════════════════════════════════════════════════════════════
//  STEP 6 — Anchor
// ══════════════════════════════════════════════════════════════════════
document.getElementById("btn-anchor").addEventListener("click", () => {
  const now = new Date().toISOString();
  const content = [
    "Proof of AI Savings — Merkle Root Receipt",
    "==========================================",
    "",
    `Merkle root:        ${merkleRoot}`,
    `Record count:       ${cleanRecords.length}`,
    `Verified hours/day: ${fix(metrics.totalVerifiedHours, 1)}`,
    `Held hours/day:     ${fix(metrics.totalHeldHours, 1)}`,
    `Generated (UTC):    ${now}`,
    "",
    "What this proves:",
    "  • Nothing changed in the dataset after this root was computed.",
    "  • Anyone with a record and its inclusion proof can verify it",
    "    belongs to this exact dataset.",
    "",
    "What this CANNOT prove:",
    "  • Whether the raw data was truthful in the first place.",
    "  • The root only locks the data — it does not validate it.",
    "",
    "To timestamp this root on the Bitcoin blockchain:",
    "  1. Go to https://opentimestamps.org",
    "  2. Upload this file",
    "  3. Save the .ots proof file",
    "  4. Anyone can later verify the timestamp independently",
    "",
    "──────────────────────────────────────────",
    "Proof of AI Savings · learning prototype",
  ].join("\n");

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "merkle_root.txt";
  a.click();
  URL.revokeObjectURL(url);

  const out = document.getElementById("output-anchor");
  out.innerHTML = `
    <div class="info-box mt-2">
      <strong>✓ Downloaded merkle_root.txt</strong><br>
      Timestamp it at <a href="https://opentimestamps.org" target="_blank" rel="noopener">opentimestamps.org</a>
      to create an immutable proof of <em>when</em> this data was locked.
    </div>
    <div class="warning-box mt-1">
      <strong>Remember:</strong> This proves nothing changed after locking.
      It <em>cannot</em> prove the data was accurate going in —
      that still requires trust in the data source and collection process.
    </div>
  `;
});

// ══════════════════════════════════════════════════════════════════════
//  Background Snow / Particle Animation
// ══════════════════════════════════════════════════════════════════════
function initSnow() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // Create lightweight particles
  const count = Math.min(85, Math.max(40, Math.floor(width / 20)));
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1.1 + Math.random() * 2.2,
      speedY: 0.35 + Math.random() * 0.7,
      speedX: (Math.random() - 0.5) * 0.3,
      sway: 0.3 + Math.random() * 0.6,
      swaySpeed: 0.01 + Math.random() * 0.018,
      angle: Math.random() * Math.PI * 2,
      opacity: 0.2 + Math.random() * 0.55,
    });
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    // Navy blue in light mode (rgb 22, 42, 86); White in dark mode (rgb 255, 255, 255)
    const baseColor = isDark ? "255, 255, 255" : "22, 42, 86";

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.angle += p.swaySpeed;
      p.y += p.speedY;
      p.x += p.speedX + Math.sin(p.angle) * (p.sway * 0.45);

      if (p.y > height + 6) {
        p.y = -6;
        p.x = Math.random() * width;
      }
      if (p.x > width + 6) p.x = -6;
      else if (p.x < -6) p.x = width + 6;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${baseColor}, ${p.opacity})`;
      ctx.fill();
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

// Start snow animation on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSnow);
} else {
  initSnow();
}
