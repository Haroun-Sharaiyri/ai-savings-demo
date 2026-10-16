const { webcrypto } = require("crypto");
globalThis.crypto = webcrypto;
const fs = require("fs");
const vm = require("vm");

// Load logic.js into a shared context with crypto
const code = fs.readFileSync("logic.js", "utf8");
const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, Uint8Array, Math, Promise, Array, Object, JSON, Date, Number, String, parseInt, console, setTimeout });
vm.runInContext(code, ctx);

// Pull functions out of context
const {
  generateAllRecords, sha256, hmacSha256, canonicalJSON,
  computeMetrics, scrambleRecords,
  buildMerkleTree, getInclusionProof, verifyInclusionProof, merkleLeafHash,
} = ctx;

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

(async () => {
  console.log("Running tests...\n");

  const records = generateAllRecords();
  ok(records.length === 1200, "1200 records generated");
  ok(records.filter(r => r.period === "before").length === 600, "600 before");
  ok(records.filter(r => r.period === "after").length === 600, "600 after");

  const records2 = generateAllRecords();
  ok(records[0].interaction_id === records2[0].interaction_id, "Deterministic");

  const h = await sha256("hello");
  ok(h.length === 64, "SHA-256 produces 64-char hex");

  const hm1 = await hmacSha256("k", "m");
  const hm2 = await hmacSha256("k", "m");
  ok(hm1 === hm2, "HMAC deterministic");
  ok(hm1 !== await hmacSha256("k2", "m"), "HMAC differs with different key");

  const m = computeMetrics(records);
  ok(typeof m.totalVerifiedHours === "number", "Verified hours is number");
  ok(!m.channels.whatsapp.pass, "WhatsApp held for review");
  ok(m.channels.voice.pass, "Voice passes gate");

  console.log(`\n  Verified hours/day: ${m.totalVerifiedHours.toFixed(1)}`);
  console.log(`  Held hours/day:     ${m.totalHeldHours.toFixed(1)}`);
  console.log(`  Actions: ${JSON.stringify(m.actionCounts)}`);

  // Merkle tree tests
  const sizes = [1, 2, 3, 5, 7, 1001];
  for (const size of sizes) {
    const recs = Array.from({ length: size }, (_, i) => ({ id: i, v: `t${i}` }));
    const tree = await buildMerkleTree(recs);
    ok(tree.root.length === 64, `Tree size ${size}: valid root`);
    ok(tree.levels[tree.levels.length - 1].length === 1, `Tree size ${size}: single root`);

    let allOk = true;
    for (let i = 0; i < size; i++) {
      const leaf = await merkleLeafHash(canonicalJSON(recs[i]));
      const proof = getInclusionProof(tree, i);
      const v = await verifyInclusionProof(leaf, proof, tree.root);
      if (!v) { allOk = false; break; }
    }
    ok(allOk, `Tree size ${size}: all proofs verify`);
  }

  // Full tree
  console.log("\n  Building full 1200-record tree...");
  const fullTree = await buildMerkleTree(records);
  ok(fullTree.levels[0].length === 1200, "Full tree: 1200 leaves");

  const sample = [0, 1, 100, 599, 600, 1199];
  let allSampleOk = true;
  for (const i of sample) {
    const leaf = await merkleLeafHash(canonicalJSON(records[i]));
    const proof = getInclusionProof(fullTree, i);
    if (!(await verifyInclusionProof(leaf, proof, fullTree.root))) { allSampleOk = false; break; }
  }
  ok(allSampleOk, "Full tree: sampled proofs verify");

  // Tamper detection
  for (const i of [0, 599, 1199]) {
    const tampered = records.map((r, j) =>
      j === i ? { ...r, handle_time_secs: r.handle_time_secs + 1 } : r
    );
    const tTree = await buildMerkleTree(tampered);
    ok(tTree.root !== fullTree.root, `Tamper record #${i}: root changed`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
