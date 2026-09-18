// Drive coin.js's own paperStep with hand-made prices. Extracted from the
// source, like t-provenance.js, so this tests the shipped code, not a copy.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync("coin.js", "utf8");
const rulesSrc = src.slice(src.indexOf("const RULES = {"), src.indexOf("// ---------- dataset provenance ----------"));
const paperSrc = src.slice(src.indexOf("// ---------- paper ----------"), src.indexOf("// ---------- end paper ----------"));
const { RULES, PAPER, paperStep, paperEquity, paperSummary, paperNewAlerts, paperEntryPlan, newPaperWallet } = new Function(
  "path",
  "__dirname",
  rulesSrc +
    paperSrc +
    "\nreturn { RULES, PAPER, paperStep, paperEquity, paperSummary, paperNewAlerts, paperEntryPlan, newPaperWallet };"
)(path, __dirname);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const T0 = Date.parse("2026-09-20T00:00:00Z");
const H = 3.6e6;
const iso = (ms) => new Date(ms).toISOString();
const fresh = () => ({ alertLines: 0, wallets: [newPaperWallet(1, iso(T0), 150)], positions: [], pending: [], skipped: [] });
// a "market" alert unless overridden: flat 6h and 24h
const alert = (mint, atMs, extra = {}) => ({ mint, symbol: mint.toUpperCase(), alertedAt: iso(atMs), priceUsd: 1, chg6h: 0, chg24h: 0, ...extra });
const q = (priceUsd, liqUsd = 100000, chg6h = 1) => ({ priceUsd, liqUsd, chg6h });

ok(PAPER.bankrollUsd === 30 && PAPER.stakeUsd === 10, "wallet $30, stake $10");

// entry plan mirrors alertBody's order
ok(paperEntryPlan({ chg6h: -20, chg24h: 80, priceUsd: 1 }).type === "knife", "6h below the downtrend line => knife, even when 24h is hot");
ok(paperEntryPlan({ chg6h: 5, chg24h: 80, priceUsd: 1 }).type === "dip", "24h above the pullback line => dip");
ok(paperEntryPlan({ chg6h: 5, chg24h: 10, priceUsd: 1 }).type === "market", "otherwise market");
ok(RULES.alertDowntrendChg6h === -10 && RULES.alertPullbackChg24h === 30, "plan thresholds come from RULES");

// line cursor: forward only, order-proof, refuses a rewritten log
let st = { alertLines: 2 };
const L = ['{"mint":"a","alertedAt":"2026-09-20T02:00:00Z"}', '{"mint":"b","alertedAt":"2026-09-20T03:00:00Z"}', '{"mint":"c","alertedAt":"2026-09-20T01:00:00Z"}'];
let na = paperNewAlerts(st, L);
ok(na.alerts.length === 1 && na.alerts[0].mint === "c", "only lines past the cursor are new, even with an older timestamp");
ok(paperNewAlerts({ alertLines: 5 }, L).error, "a log that shrank is refused");

// buy, half at 2x, rest at 3x
let s = fresh();
paperStep(s, [alert("a", T0 + 60e3)], { a: q(1) }, T0 + 120e3);
ok(s.positions.length === 1 && near(s.wallets[0].cashUsd, 20) && s.alertLines === 1, "market entry buys $10 at the first price after the alert");
paperStep(s, [], { a: q(2.1) }, T0 + H);
ok(near(s.wallets[0].cashUsd, 30.5), "sells half at 2.1x: +$10.50 cash");
paperStep(s, [], { a: q(3.2) }, T0 + 2 * H);
ok(s.positions[0].status === "closed" && near(s.positions[0].pnlUsd, 16.5), `rest at 3.2x, pnl +$16.50`);

// one poll jumping past both targets
s = fresh();
paperStep(s, [alert("j", T0 + 60e3)], { j: q(1) }, T0 + 120e3);
paperStep(s, [], { j: q(3.5) }, T0 + H);
ok(s.positions[0].status === "closed" && near(s.positions[0].pnlUsd, 25), "2x and 3x in one poll: both halves at 3.5x");

// knife: waits for 6h to turn positive, times out otherwise
s = fresh();
paperStep(s, [alert("k", T0 + 60e3, { chg6h: -25 })], { k: q(1, 100000, -5) }, T0 + 120e3);
ok(s.positions.length === 0 && s.pending.length === 1, "knife alert does not buy while 6h is negative");
paperStep(s, [], { k: q(0.9, 100000, 3) }, T0 + 5 * H);
ok(s.positions.length === 1 && s.positions[0].entryPriceUsd === 0.9 && s.positions[0].plan === "knife", "buys once 6h turns positive, at that poll's price");
s = fresh();
paperStep(s, [alert("k2", T0 + 60e3, { chg6h: -25 })], { k2: q(1, 100000, -5) }, T0 + 120e3);
paperStep(s, [], { k2: q(1, 100000, -5) }, T0 + (PAPER.maxWaitHours + 1) * H);
ok(s.positions.length === 0 && /6h never turned positive/.test(s.skipped[0].reason), "knife skipped after maxWaitHours");

// dip: waits for <= 0.80P
s = fresh();
paperStep(s, [alert("d", T0 + 60e3, { chg24h: 60 })], { d: q(0.95) }, T0 + 120e3);
ok(s.positions.length === 0, "dip alert does not buy at 0.95P");
paperStep(s, [], { d: q(0.78) }, T0 + 3 * H);
ok(s.positions.length === 1 && s.positions[0].entryPriceUsd === 0.78, "buys at 0.78P once the dip comes");
s = fresh();
paperStep(s, [alert("d2", T0 + 60e3, { chg24h: 60 })], { d2: q(1.3) }, T0 + 120e3);
paperStep(s, [], { d2: q(1.5) }, T0 + (PAPER.maxWaitHours + 1) * H);
ok(/no dip/.test(s.skipped[0].reason), "dip skipped after maxWaitHours if price ran away");

// stop fills at the sampled price, not at -50%
s = fresh();
paperStep(s, [alert("b", T0 + 60e3)], { b: q(1) }, T0 + 120e3);
paperStep(s, [], { b: q(0.37) }, T0 + H);
ok(near(s.positions[0].pnlUsd, -6.3), "stop seen at -63% fills at -63%");

// drained pool counts as zero; MISSING liquidity is unknown, not zero
s = fresh();
paperStep(s, [alert("c", T0 + 60e3)], { c: q(1) }, T0 + 120e3);
paperStep(s, [], { c: q(5, 800) }, T0 + H);
ok(near(s.positions[0].pnlUsd, -10), "5x printed on $800 liquidity closes at zero");
s = fresh();
paperStep(s, [alert("n1", T0 + 60e3)], { n1: q(1) }, T0 + 120e3);
paperStep(s, [], { n1: q(1.8, null) }, T0 + H);
ok(s.positions[0].status === "open", "liquidity absent from the response triggers neither zero nor LP drain");

// fetch failure never reads as a rug; a vanished pair does after maxMisses
s = fresh();
paperStep(s, [alert("v", T0 + 60e3)], { v: q(1) }, T0 + 120e3);
for (let i = 0; i < 5; i++) paperStep(s, [], {}, T0 + (i + 1) * 600e3);
ok(s.positions[0].status === "open", "undefined quotes (fetch failed) leave the position alone");
for (let i = 0; i < PAPER.maxMisses - 1; i++) paperStep(s, [], { v: null }, T0 + H + i * 600e3);
ok(s.positions[0].status === "open", "open while missing fewer than maxMisses polls");
paperStep(s, [], { v: null }, T0 + 2 * H);
ok(s.positions[0].status === "closed" && near(s.positions[0].pnlUsd, -10), "closed at zero after maxMisses");

// a position that can never be priced again is not marked at its last price forever
s = fresh();
paperStep(s, [alert("x", T0 + 60e3)], { x: q(1) }, T0 + 120e3);
paperStep(s, [], { x: q(1.9) }, T0 + H);
paperStep(s, [], {}, T0 + (PAPER.maxHoldHours + PAPER.staleCloseHours - 1) * H);
ok(s.positions[0].status === "open", "unpriced but inside the stale window: still open");
paperStep(s, [], {}, T0 + (PAPER.maxHoldHours + PAPER.staleCloseHours + 1) * H);
ok(s.positions[0].status === "closed" && near(s.positions[0].pnlUsd, -10), "unpriced past max hold + staleCloseHours: closed at zero");

// no cash for a 4th position
s = fresh();
paperStep(s, ["e", "f", "g", "h"].map((m, i) => alert(m, T0 + (i + 1) * 1000)), { e: q(1), f: q(1), g: q(1), h: q(1) }, T0 + 60e3);
ok(s.positions.length === 3 && s.skipped.length === 1 && /stake/.test(s.skipped[0].reason), "4th alert skipped: no cash");

// bust -> note + new wallet
paperStep(s, [], { e: q(1, 10), f: q(1, 10), g: q(1, 10) }, T0 + H, 150);
ok(s.wallets[0].status === "busted" && /wallet 1 busted/.test(s.wallets[0].note), "wallet 1 marked busted with a note");
ok(s.wallets[1] && s.wallets[1].status === "active" && s.wallets[1].cashUsd === 30, "wallet 2 opens with $30");
paperStep(s, [alert("i", T0 + 2 * H)], { i: q(1) }, T0 + 2 * H + 60e3);
ok(s.positions.at(-1).wallet === 2, "next buy lands in wallet 2");
const S = paperSummary(s, 150);
ok(S.invested === 60 && S.busted === 1 && S.closed === 3 && near(S.closedPnlUsd, -30), "summary totals across wallets");
ok(near(S.solEquity, 60), "SOL baseline covers every wallet's capital");

// unpriced market alert waits, then is skipped — never back-dated
s = fresh();
paperStep(s, [alert("u", T0 + 60e3)], {}, T0 + 120e3);
ok(s.pending.length === 1 && s.positions.length === 0, "unpriced alert waits in pending");
paperStep(s, [], {}, T0 + 60e3 + (PAPER.maxOpenDelayMin + 1) * 60e3);
ok(s.pending.length === 0 && /no price/.test(s.skipped[0].reason), "skipped after maxOpenDelayMin");

// time stop and max hold
s = fresh();
paperStep(s, [alert("t", T0 + 60e3)], { t: q(1) }, T0 + 120e3);
paperStep(s, [], { t: q(1.2) }, T0 + (RULES.timeStopHours + 1) * H);
ok(s.positions[0].fills[0].reason === "time stop" && near(s.positions[0].pnlUsd, 2), "time stop at 1.2x after timeStopHours");
s = fresh();
paperStep(s, [alert("m", T0 + 60e3)], { m: q(1) }, T0 + 120e3);
paperStep(s, [], { m: q(2.5) }, T0 + H);
paperStep(s, [], { m: q(2.5) }, T0 + (PAPER.maxHoldHours + 1) * H);
ok(s.positions[0].fills.at(-1).reason === "max hold" && near(s.positions[0].pnlUsd, 15), "rest closed at max hold");

// mark-to-market, and a repeat alert on a held mint does not double up
s = fresh();
paperStep(s, [alert("r", T0 + 60e3)], { r: q(1) }, T0 + 120e3);
paperStep(s, [], { r: q(1.5) }, T0 + H);
ok(near(paperEquity(s, s.wallets[0]), 35), "equity = cash 20 + open 10 x 1.5");
paperStep(s, [alert("r", T0 + 2 * H)], { r: q(1.5) }, T0 + 2 * H + 1000);
ok(s.positions.length === 1 && /already holding/.test(s.skipped.at(-1).reason), "re-alert of a held mint is skipped");

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall paper checks passed");
