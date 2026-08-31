// Verify the discovery-time provenance stamp lands on a new tracking row, by
// evaluating coin.js's own provenance block and the row literal that uses it.
const fs = require("fs");
const src = fs.readFileSync("coin.js", "utf8");

// pull the real RULES object + provenance block out of the source so this
// tests the shipped code, not a copy of it
const rulesSrc = src.slice(src.indexOf("const RULES = {"), src.indexOf("// ---------- helpers ----------"));
const mod = { crypto: require("crypto") };
const fn = new Function("crypto", rulesSrc + "\nreturn { RULES, ENTRY_FILTER_VERSION, POLL_CADENCE_MIN, provenance };");
const { RULES, ENTRY_FILTER_VERSION, POLL_CADENCE_MIN, provenance } = fn(mod.crypto);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fail++; };

const v = provenance();
ok(typeof v.ef === "string" && /^[0-9a-f]{8}$/.test(v.ef), `ef is an 8-hex hash (${v.ef})`);
ok(v.pollMin === POLL_CADENCE_MIN, `pollMin mirrors POLL_CADENCE_MIN (${v.pollMin})`);
ok(provenance().ef === v.ef, "ef is stable across calls within a version");

// the row literal in cmdScan must actually carry it
const rowLit = src.slice(src.indexOf("tracking[mint] = {"), src.indexOf("tracking[mint] = {") + 600);
ok(/\bv:\s*provenance\(\)/.test(rowLit), "cmdScan stamps `v: provenance()` on new rows");
ok(rowLit.indexOf("v: provenance()") < rowLit.indexOf("f: trackFeatures"), "stamp is written alongside f, at discovery");

// patterns must not crash on rows that predate the stamp
ok(/r\.v\?\.ef \|\| "pre-versioning"/.test(src), "patterns buckets unstamped rows as pre-versioning");
ok(/observedCadenceMin/.test(src), "patterns reports observed cadence, not just configured");

// the pre-registered threshold must stay off every decision path
const gateFns = src.slice(src.indexOf("function alertQualifies"), src.indexOf("function cmdWatch"));
ok(!/momMinChg24h/.test(gateFns), "momMinChg24h is NOT referenced in any alert/gate function");
// count real references, not the comments that explain why it is measurement-only
const codeRefs = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && l.includes("momMinChg24h")).length;
ok(codeRefs === 2, `momMinChg24h has exactly 2 code references — its RULES def + the patterns table (found ${codeRefs})`);
ok(RULES.momMinChg24h === 1000, "momMinChg24h is pre-registered at 1000, not retuned to the grid optimum 1637");

console.log(fail ? `\n${fail} check(s) failed` : "\nall provenance checks passed");
process.exit(fail ? 1 : 0);
