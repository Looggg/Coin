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

// the row literal in cmdScan must actually carry it.
// Brace-matched, NOT a fixed character window: a +600 slice broke on 2026-09-01
// when an entryNo field and its comment pushed `v: provenance()` to offset 628,
// and the test went red against correct code. A literal that grows is normal;
// a test that measures it in characters is not.
function objectLiteralAt(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return "";
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}
const rowLit = objectLiteralAt(src, "tracking[mint] = {");
ok(/\bv:\s*provenance\(\)/.test(rowLit), "cmdScan stamps `v: provenance()` on new rows");
ok(rowLit.indexOf("v: provenance()") < rowLit.indexOf("f: trackFeatures"), "stamp is written alongside f, at discovery");

// patterns must not crash on rows that predate the stamp
ok(/r\.v\?\.ef \|\| "pre-versioning"/.test(src), "patterns buckets unstamped rows as pre-versioning");
ok(/observedCadenceMin/.test(src), "patterns reports observed cadence, not just configured");

// The pre-registered threshold must stay off every decision path.
// This used to slice from `function alertQualifies` to `function cmdWatch` —
// but cmdWatch is defined BEFORE alertQualifies, so the slice was always "" and
// the check passed on an empty string from the day it was written. It never
// tested anything. Extract each gate function by name and brace-match instead.
function functionBody(text, name) {
  const start = text.indexOf("function " + name + "(");
  if (start < 0) return null; // caller decides whether absence is a failure
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}
const GATE_FNS = ["alertQualifies", "alertBody", "cmdAlert", "runChecklist", "scoreCandidate"];
const missing = GATE_FNS.filter((n) => functionBody(src, n) === null);
ok(missing.length === 0, `every gate function named by this test exists in coin.js${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
const gateFns = GATE_FNS.map((n) => functionBody(src, n) || "").join("\n");
ok(gateFns.length > 500, `gate-function slice is non-empty (${gateFns.length} chars) — guards against the empty-slice bug that made this check vacuous`);
// comment lines are stripped before matching: the tombstones that explain WHY
// these thresholds are off the decision path necessarily name them, and a test
// that cannot tell a comment from a reference punishes documenting the reason
const codeOnly = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
ok(!/momMinChg24h/.test(codeOnly(gateFns)), "momMinChg24h is NOT referenced in any alert/gate function");
ok(!/momMinVolLiq/.test(codeOnly(src)), "momMinVolLiq is gone from code (gate deleted 2026-09-01 by its kill condition)");
// count real references, not the comments that explain why it is measurement-only
const codeRefs = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && l.includes("momMinChg24h")).length;
ok(codeRefs === 2, `momMinChg24h has exactly 2 code references — its RULES def + the patterns table (found ${codeRefs})`);
ok(RULES.momMinChg24h === 1000, "momMinChg24h is pre-registered at 1000, not retuned to the grid optimum 1637");

console.log(fail ? `\n${fail} check(s) failed` : "\nall provenance checks passed");
process.exit(fail ? 1 : 0);
