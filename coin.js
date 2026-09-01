#!/usr/bin/env node
/**
 * coin.js — Solana memecoin safety-check + decision journal + eval tool
 *
 * Zero dependencies. Data sources (all free, no API key):
 *   GeckoTerminal — pool discovery for `scan`
 *   DexScreener   — price, liquidity, volume, txn counts
 *   Rugcheck      — authorities, LP lock, holders, insider/bundle networks
 *
 * Commands:
 *   node coin.js scan [cap]                    Sweep new+trending pools, rank survivors
 *   node coin.js check <mint>                  Fetch metrics, run safety checklist, print verdict
 *   node coin.js log <mint> buy|skip "reason"  Snapshot + record decision into journal.json
 *   node coin.js watch                         Exit alerts on open positions (exits 1 if action needed)
 *   node coin.js exit <mint> "reason"          Close a position, record realized return
 *   node coin.js update                        Fill in 1d/7d/30d outcomes for due entries
 *   node coin.js stats                         Summary: returns, rug rate, vs SOL baseline
 *   node coin.js list                          List journal entries
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOURNAL_PATH = path.join(__dirname, "journal.json");
const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Raydium V4 LP authority — its holdings are the pool itself, not an insider
const RAYDIUM_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

// ---------- thresholds (tune these as you learn from the journal) ----------
const RULES = {
  // entry filter
  // verdict floor. raised 30k->50k 2026-08-26: the 30-50k band was 26/130
  // tracked tokens at win 16% / rug 29%@d1, EV -22%@h4 and -44%@d1 even
  // after clamping returns to the +200%/-50% exit rules. see STUDY.md.
  minLiquidityUsd: 50000, // below this, $10 in/out slippage eats you
  // scan pre-filter floor, deliberately BELOW the verdict floor: the band
  // between the two still gets scanned, scored and tracked (as FAIL), so the
  // dataset keeps the evidence that would let us walk this change back
  minTrackLiquidityUsd: 30000,

  // How long a mint must wait, after the START of its last tracked entry,
  // before a scan may enter it again. Added 2026-09-01 to unblock intake.
  //
  // WHY THIS EXISTS. Discovery dedupes against the archive, so a token was
  // tracked once and then excluded forever. `trending_pools` is a small stable
  // set (10 pages = 138 mints over minTrackLiquidityUsd, 122 of them older than
  // minAgeHours) and it was fully absorbed within the first days. After that the
  // only rows still entering the dataset were whatever had just arrived in
  // trending plus the `new_pools` firehose — that is, young and thin by
  // construction. Measured: median age at discovery 376h (Aug 24-26) -> 24h
  // (Aug 27-30) -> 10h (Aug 31+), median liquidity 118k -> 85k -> 67k, and
  // pass rate 51% -> 22% -> 5%, ending at 0 PASS in 30 consecutive rows. The
  // PASS arm of the dataset had stopped growing entirely: the screener still
  // printed ~27 PASS candidates an hour, but 33 of the 39 distinct mints in the
  // last 24 scans were already archived, so none of them could ever produce a
  // new outcome. That is a broken learning loop, not a market observation.
  //
  // WHY A COOLDOWN AND NOT JUST REMOVING THE DEDUPE. Re-entering the same mint
  // is a genuinely new entry decision — different price, different age, and the
  // 2-5x play is judged from the entry, not from the token. But two entries
  // whose outcome windows overlap are one observation counted twice, which is
  // the double-count this dedupe was written to prevent. The longest outcome
  // bucket is d3 = 72h, so the cooldown must exceed it; 168h leaves the windows
  // disjoint with margin.
  //
  // Repeat entries are NOT independent samples (same token, same holders, often
  // the same regime). `patterns` keys rows by mint+entryNo so no entry is lost,
  // and prints the distinct-mint count next to n so any table read off a
  // repeat-heavy dataset shows its own clustering.
  reentryCooldownHours: 168,
  maxTop10Pct: 30, // top-10 holders (excl. LP/CEX) combined %
  minLpLockedPct: 80, // LP locked/burned percentage
  washVolLiqRatio: 10, // vol24h > N x liquidity => wash suspicion
  // verdict floor, raised 24 -> 48 and promoted from soft warning to hard FAIL
  // on 2026-08-27. Measured MARGINALLY, against a baseline that already applies
  // minLiquidityUsd (an uncontrolled baseline credits this floor for rows change
  // #1 removes): over PASS rows with liq >= 50k the floor moves EV -10.7% ->
  // -7.9% (+2.8pp, n 55 -> 42) and rug 11% -> 0%, net of the two winners it cuts.
  //
  // the EV half of that is NOT statistically separated: the 13 cut rows are
  // EV -19.8% with a 18.7pp stderr, ~0.6 sigma from the kept rows. what carries
  // this change is the downside half — rug 11% -> 0%, and the rug gradient in
  // `patterns d1` (<6h 33%, 6-24h 36%, >3d 0%) — which is what the filter is
  // for. do not cite it as an EV improvement. see STUDY.md.
  //
  // deliberately NOT mirrored by a minTrackAgeHours: the scan pre-filter is
  // liquidity-only, so young tokens keep getting scanned and tracked as FAIL and
  // the dataset keeps the evidence that would let us walk this change back.
  minAgeHours: 48,
  maxDevPct: 5, // creator wallet holdings
  maxInsiderPct: 25, // supply held by detected insider/bundle networks
  minHolders: 100, // too few holders => one exit kills the price

  // `alert` notification gate — STRICTER than the PASS verdict on purpose.
  // PASS only means "no hard red flag"; this gate decides what is worth a
  // phone buzz. Loosening it costs attention, not money.
  //
  // HONESTY NOTE: only alertMaxChg24h and alertMinAgeHours are backed by the
  // 2026-08-26 tracking analysis. alertMinScore and alertMaxInsiderPct are
  // NOT — at d1 that dataset shows score 80-100 and insider <5% were the
  // WORST cells (median -32%/-27%, rug 33%/25%) while FAIL and insider >15%
  // did better. n is ~30 and almost certainly confounded, so these two stay
  // as conservative "don't buzz me about junk" filters, not as claims that
  // they predict returns. See the open question in STUDY.md before touching.
  alertMinScore: 80, // NOT return-backed — noise control only
  alertMaxInsiderPct: 5, // NOT return-backed — see note above
  alertMaxFdv: 1500000,
  alertMaxChg24h: 100, // already-pumped: chg24h > 100% ran -64.8% median @d1
  alertMinChg24h: -50, // chg24h < -50% ran median -21% and 0% winners @d1
  // liveness, not a return signal: the first live issue alerted a 9-month-old
  // token doing $21k of volume on $51k liq (vol/liq 0.4x) purely because its
  // score was 95. nobody trades it; there is nothing to exit into. kept well
  // below the 5-10x band patterns flags as interesting, so it only removes
  // the dead.
  alertMinVolLiq: 1,
  // non-binding while minAgeHours (48) is higher — alertQualifies takes the max
  // of the two. kept so the alert gate still reads as a complete spec on its own
  // and stays strict if the verdict floor is ever lowered again.
  alertMinAgeHours: 24,
  alertCooldownHours: 72, // do not re-alert the same mint inside this window

  // `momentum` notification track — REMOVED 2026-09-01, by the kill condition
  // it shipped with. Added 2026-08-27 to select on attention (vol/liq >=
  // momMinVolLiq) instead of cleanliness, it was to be deleted if the MOMENTUM
  // cell had not beaten `PASS, quiet` on peak-2x by ~20-30 tokens. It reached
  // that sample and did not:
  //
  //   lifetime peak-2x, all rows   MOMENTUM n=20  5.0%   PASS,quiet n=49  4.1%   p=0.65
  //   dense-sampled rows only      MOMENTUM n= 7  0.0%   PASS,quiet n=20  5.0%   p=1.00
  //
  // No separation in either density stratum, and the direction flips between
  // them — which is what one token carrying the whole number looks like. The
  // threshold had also been eaten by intake drift: when it was set, median
  // vol/liq at discovery was 4.2 and `>= 5` selected the top half; by 2026-08-31
  // the median was 15.8 and it admitted 67% of intake. A gate that passes two
  // thirds of what it sees is not selecting anything.
  //
  // NOT replaced by another live notification gate. CLAUDE.md asks for a better
  // pump-pattern candidate rather than abandoning the goal, and there is one —
  // momMinChg24h below, the only feature that survived every stratification
  // tried, re-confirmed 2026-09-01 inside both density strata (19.0% vs 6.1%
  // sparse, 29.6% vs 13.0% dense). It stays MEASUREMENT ONLY anyway: not
  // multiplicity-clean (FWER-adjusted p = 0.116), 12 pumpers carry it, and it
  // selects 50-62% rug. Buzzing the phone with it would be spending real money
  // on a result that has not cleared its own pre-registered bar. The goal arm is
  // now that table plus the intake fix that lets it accumulate forward rows —
  // see STUDY.md 2026-09-01.

  // MEASUREMENT ONLY — deliberately NOT wired into the alert gate or any buy
  // path. Added 2026-08-31 as a pre-registered candidate after an
  // audit that refuted the session's headline finding but left this one
  // standing. chg24h at discovery is the only gate that survived every
  // stratification tried: both polling eras (p=0.057 sparse / p=0.044 dense),
  // archived-finished-only rows (34.6% vs 6.7%, p=0.0003), and a realizable
  // definition of "pumped" that throws out peaks printed on dead liquidity
  // (20.0% vs 7.5%, p=0.019). Marginal: 27.5% peak-2x (n=40) vs 7.0% (n=171).
  //
  // Why it is only a table and not a gate:
  //   - NOT multiplicity-clean. A permutation min-p test over a 322-gate grid
  //     puts the family-wise adjusted p at 0.116; clearing FWER 0.05 needed
  //     raw p <= 5.6e-4 and nothing reached it. This is the best of many
  //     thresholds tried, which is not the same as a real one.
  //   - 11 pumpers carry the whole result.
  //   - It selects 50-62% rug (definition-dependent) against a ~20% baseline.
  //   - It is ~90% collinear with age < 7d, so it MUST be read inside age
  //     strata or it just re-derives that confound under a new name.
  //
  // PRE-REGISTERED AT 1000. The grid's own optimum was 1637; re-tuning to it
  // would be fitting the noise this threshold exists to test. Do not move this
  // number to make the table look better — that is the failure mode the
  // 2026-08-31 audit was written to prevent. Judge it on forward rows only,
  // stamped with an entry-filter version, at n >= 30 in the current era.
  //
  // 2026-09-01 re-check, now inside sampling-density strata (see
  // DENSE_SAMPLE_MIN): 19.0% vs 6.1% on sparse rows, 29.6% vs 13.0% on dense.
  // Same direction, same rough effect size on both sides of the cadence change,
  // so it is not the polling artifact that killed the vol/liq result. 12 pumpers
  // carry it. Still not promoted — none of the reasons above went away.
  //
  // The n >= 30 checkpoint is COUNT-BASED AND THAT IS A BUG in how it was
  // written: era 71c22712 hit 30 rows on 2026-09-01 with every row under a day
  // old and no d3 outcome, so the count triggered while the data it was meant
  // to trigger on did not exist. Read the checkpoint as 30 rows with a RECORDED
  // d3 outcome in the current era, not 30 rows.
  momMinChg24h: 1000,
  alertPullbackChg24h: 30, // above this, suggest waiting for a dip instead
  alertDowntrendChg6h: -10, // below this, say so instead of "enter at market"

  // exit discipline (checklist.md rules 1-3, enforced by `watch`)
  takeProfitX: 2, // sell half here, ride the rest free
  timeStopHours: 48, // no movement by now => get out, capital has a cost
  lpDrainPct: 50, // LP fell this % below entry => exit immediately
  stopLossPct: 50, // price down this % => position is dead money
};

// ---------- dataset provenance ----------
// Added 2026-08-31 after an audit refuted a headline finding that had looked
// solid at n=280. Two invisible regime changes produced it:
//
//   1. `f.pass` is not one label. minLiquidityUsd went 30k -> 50k (ac2b67a) and
//      minAgeHours 24 -> 48 (30eb0c0) mid-dataset. 37 of 106 pass=true rows
//      would FAIL today's rules, so any table grouping on `pass` was averaging
//      three different filters and calling the result one effect.
//   2. `p.peakRet` is a sampled running max — a LOWER BOUND that tightens with
//      poll count. Polling went hourly -> 10-minute on 2026-08-27, and median
//      samples/row went 12 -> 275. Every feature that correlates with being
//      discovered late also correlates with being sampled more, which
//      manufactures peak-2x differences out of nothing.
//
// Neither was recoverable from tracking.json — it took `git log` and a
// per-era stratification to find them. Stamping both on the row at discovery
// is what makes `f.pass` and `p.peakRet` comparable across time. Rows written
// before this date carry no `v` and must be treated as their own era.
const ENTRY_FILTER_KEYS = [
  "minLiquidityUsd",
  "minTrackLiquidityUsd",
  "maxTop10Pct",
  "minLpLockedPct",
  "minAgeHours",
  "maxDevPct",
  "maxInsiderPct",
  "minHolders",
];
// derived, not hand-maintained: editing any threshold above changes this hash
// on the next scan with no one having to remember to bump a version number
const ENTRY_FILTER_VERSION = crypto
  .createHash("sha1")
  .update(JSON.stringify(ENTRY_FILTER_KEYS.map((k) => [k, RULES[k]])))
  .digest("hex")
  .slice(0, 8);

// The workflow's POLL_MINUTES. FROZEN: changing it re-partitions the dataset
// into another incomparable era, which is exactly the mistake above. Change it
// only as a deliberate, logged decision, never as a tuning knob — and expect
// to discard cross-era comparisons when you do. Stamped per row so a future
// change is at least visible in the data instead of only in git.
const POLL_CADENCE_MIN = 10;

// what gets written onto every new tracking row
function provenance() {
  return { ef: ENTRY_FILTER_VERSION, pollMin: POLL_CADENCE_MIN };
}

// ---------- helpers ----------
// process-wide 429 tally — every API call funnels through getJson, so this
// sees rate limiting even from callers that swallow their own errors
// (fetchRugcheck, fetchSolPrice, fetchGeckoPools)
let http429s = 0;
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 429) http429s++;
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

function loadJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return [];
  const entries = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  for (const e of entries) if (!e.outcomes) e.outcomes = {}; // hand-edited files
  return entries;
}

function saveJournal(entries) {
  // journal is the eval's ground truth — back up, then write atomically so a
  // crash mid-write can never corrupt it
  if (fs.existsSync(JOURNAL_PATH)) fs.copyFileSync(JOURNAL_PATH, JOURNAL_PATH + ".bak");
  const tmp = JOURNAL_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, JOURNAL_PATH);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtUsd(n) {
  if (n == null) return "n/a";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Number(n).toFixed(n < 1 ? 6 : 2)}`;
}

function fmtPct(n) {
  return n == null ? "n/a" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function hoursSince(ts) {
  return (Date.now() - ts) / 3.6e6;
}

// ---------- data fetching ----------
async function fetchDexScreener(mint) {
  const data = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  // the endpoint also returns pairs where the token is the QUOTE side —
  // those carry the OTHER token's priceUsd/symbol, so require base === mint
  const pairs = (data.pairs || []).filter(
    (p) => p.chainId === "solana" && p.baseToken?.address === mint
  );
  if (pairs.length === 0) return null;
  // best pair = deepest liquidity
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

async function fetchRugcheck(mint) {
  try {
    return await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
  } catch (e) {
    console.error(`  (rugcheck unavailable: ${e.message})`);
    return null;
  }
}

// one SOL price per run is plenty — without the cache every full-checked
// token costs an extra DexScreener call, which is what actually rate-limits
// a large scan
let solPriceCache = { at: 0, v: null };
async function fetchSolPrice() {
  if (solPriceCache.v != null && Date.now() - solPriceCache.at < 5 * 60e3) return solPriceCache.v;
  try {
    const pair = await fetchDexScreener(WSOL_MINT);
    const v = pair ? Number(pair.priceUsd) : null;
    if (v != null) solPriceCache = { at: Date.now(), v };
    return v;
  } catch {
    return solPriceCache.v;
  }
}

// ---------- snapshot + checklist ----------
async function buildSnapshot(mint) {
  const [pair, rug, solPriceUsd] = await Promise.all([
    fetchDexScreener(mint),
    fetchRugcheck(mint),
    fetchSolPrice(),
  ]);

  if (!pair) return { dead: true, solPriceUsd };

  let top10Pct = null;
  let lpLockedPct = null;
  let mintAuthority = null;
  let freezeAuthority = null;
  let rugScore = null;
  let rugRisks = [];
  let devPct = null;
  let insiderPct = null;
  let insiderCount = null;
  let totalHolders = null;
  let rugged = null;
  let launchpad = null;

  if (rug) {
    mintAuthority = rug.token?.mintAuthority ?? null;
    freezeAuthority = rug.token?.freezeAuthority ?? null;
    rugScore = rug.score_normalised ?? rug.score ?? null;
    rugRisks = (rug.risks || []).map((r) => ({ name: r.name, level: r.level }));

    // exclude non-insider accounts from holder concentration: AMM/LP pools
    // (PumpSwap, Raydium, Meteora, Orca) and CEX wallets — a Binance hot
    // wallet holding 10% is not a dev who can dump on you
    const excluded = new Set([RAYDIUM_AUTHORITY]);
    for (const [addr, info] of Object.entries(rug.knownAccounts || {})) {
      if (/amm|lp|pool|cex|exchange/i.test(info?.type || "")) excluded.add(addr);
    }
    const nonLp = (rug.topHolders || []).filter(
      (h) => !excluded.has(h.address) && !excluded.has(h.owner)
    );
    top10Pct = nonLp.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);

    // LP lock % of the market we'd actually trade on (matched by pool address).
    // Fallback is the WORST-locked market — a safety tool must never take the
    // best across pools (a 100%-locked dust pool would mask an unlocked main pool)
    const markets = rug.markets || [];
    const matched = pair ? markets.find((m) => m.pubkey === pair.pairAddress) : null;
    if (matched?.lp?.lpLockedPct != null) {
      lpLockedPct = matched.lp.lpLockedPct;
    } else {
      const lps = markets.map((m) => m.lp?.lpLockedPct).filter((x) => x != null);
      if (lps.length) lpLockedPct = Math.min(...lps);
    }

    // bundle / insider detection — modern devs don't hold one big wallet, they
    // fund 20-50 fresh wallets at launch. rugcheck traces that funding graph.
    rugged = rug.rugged ?? null;
    totalHolders = rug.totalHolders ?? null;
    insiderCount = rug.graphInsidersDetected ?? null;
    launchpad = rug.launchpad?.name ?? rug.deployPlatform ?? null;
    const supply = Number(rug.token?.supply);
    if (Number.isFinite(supply) && supply > 0) {
      const creatorBal = Number(rug.creatorBalance);
      if (Number.isFinite(creatorBal)) devPct = (creatorBal / supply) * 100;
      const bundled = (rug.insiderNetworks || []).reduce(
        (sum, n) => sum + (Number(n.tokenAmount) || 0),
        0
      );
      insiderPct = (bundled / supply) * 100;
    }
  }

  return {
    dead: false,
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    priceUsd: Number.isFinite(Number(pair.priceUsd)) ? Number(pair.priceUsd) : null,
    liqUsd: pair.liquidity?.usd ?? null,
    vol24h: pair.volume?.h24 ?? null,
    buys24h: pair.txns?.h24?.buys ?? null,
    sells24h: pair.txns?.h24?.sells ?? null,
    // momentum — what the last hours look like, for pump-pattern study
    buys1h: pair.txns?.h1?.buys ?? null,
    sells1h: pair.txns?.h1?.sells ?? null,
    vol1h: pair.volume?.h1 ?? null,
    chg1h: pair.priceChange?.h1 ?? null,
    chg6h: pair.priceChange?.h6 ?? null,
    chg24h: pair.priceChange?.h24 ?? null,
    // 5m attention — separates "arriving right now" from vol24h/chg24h left
    // over from a move that already ended, the known weakness of those as a
    // pump signal
    chg5m: pair.priceChange?.m5 ?? null,
    vol5m: pair.volume?.m5 ?? null,
    buys5m: pair.txns?.m5?.buys ?? null,
    sells5m: pair.txns?.m5?.sells ?? null,
    // creator wallet — enables repeat-dev history offline as the dataset grows
    creator: rug?.creator ?? null,
    fdv: pair.fdv ?? null,
    ageHours: pair.pairCreatedAt ? hoursSince(pair.pairCreatedAt) : null,
    top10Pct,
    lpLockedPct,
    mintAuthority,
    freezeAuthority,
    rugScore,
    rugRisks,
    devPct,
    insiderPct,
    insiderCount,
    totalHolders,
    rugged,
    launchpad,
    solPriceUsd,
  };
}

function runChecklist(s) {
  const fails = [];
  const warns = [];

  if (s.dead) return { pass: false, fails: ["token has no active pair (dead/delisted)"], warns };

  if (s.mintAuthority) fails.push(`mint authority ACTIVE (${s.mintAuthority.slice(0, 8)}…) — dev can print supply`);
  if (s.freezeAuthority) fails.push(`freeze authority ACTIVE — dev can freeze your wallet`);
  if (s.lpLockedPct != null && s.lpLockedPct < RULES.minLpLockedPct)
    fails.push(`LP locked only ${s.lpLockedPct.toFixed(0)}% (< ${RULES.minLpLockedPct}%) — rug pull possible`);
  if (s.liqUsd != null && s.liqUsd < RULES.minLiquidityUsd)
    fails.push(`liquidity ${fmtUsd(s.liqUsd)} (< ${fmtUsd(RULES.minLiquidityUsd)}) — slippage will eat a $10 position`);
  if (s.top10Pct != null && s.top10Pct > RULES.maxTop10Pct)
    fails.push(`top-10 holders own ${s.top10Pct.toFixed(1)}% (> ${RULES.maxTop10Pct}%) — dump risk`);
  if (s.buys24h > 50 && s.sells24h === 0)
    fails.push(`${s.buys24h} buys but ZERO sells in 24h — honeypot pattern`);

  if (s.rugged === true) fails.push(`rugcheck marks this token as ALREADY RUGGED`);
  if (s.devPct != null && s.devPct > RULES.maxDevPct)
    fails.push(`dev wallet holds ${s.devPct.toFixed(1)}% (> ${RULES.maxDevPct}%) — can dump on you`);
  if (s.insiderPct != null && s.insiderPct > RULES.maxInsiderPct)
    fails.push(`bundled/insider wallets hold ${s.insiderPct.toFixed(1)}% (> ${RULES.maxInsiderPct}%) — coordinated dump risk`);
  if (s.totalHolders != null && s.totalHolders < RULES.minHolders)
    fails.push(`only ${s.totalHolders} holders (< ${RULES.minHolders}) — no real distribution`);

  const dangers = (s.rugRisks || []).filter((r) => r.level === "danger");
  for (const d of dangers) fails.push(`rugcheck danger: ${d.name}`);

  // last on purpose: trackFeatures records only fails[0], so putting this ahead
  // of the older rules would relabel young-AND-concentrated tokens as age
  // failures and put a fake step in any failure-mode clustering across 2026-08-27
  if (s.ageHours != null && s.ageHours < RULES.minAgeHours)
    fails.push(`token only ${s.ageHours.toFixed(1)}h old (< ${RULES.minAgeHours}h) — highest-risk window`);

  if (s.lpLockedPct == null) warns.push("LP lock % unknown — verify manually on rugcheck.xyz");
  if (s.top10Pct == null) warns.push("holder concentration unknown — verify manually");
  if (s.insiderPct == null) warns.push("bundle/insider data unavailable — check bubblemaps.io manually");
  else if (s.insiderPct > 10)
    warns.push(`insider networks hold ${s.insiderPct.toFixed(1)}% across ${s.insiderCount ?? "?"} wallets`);
  if (s.vol24h != null && s.liqUsd != null && s.liqUsd > 0 && s.vol24h / s.liqUsd > RULES.washVolLiqRatio)
    warns.push(`vol/liq ratio ${(s.vol24h / s.liqUsd).toFixed(1)}x — possible wash trading`);
  const warnRisks = (s.rugRisks || []).filter((r) => r.level === "warn");
  for (const w of warnRisks) warns.push(`rugcheck warn: ${w.name}`);

  return { pass: fails.length === 0, fails, warns };
}

/**
 * Deterministic quality score for tokens that already PASSED the hard rules.
 * Purely a triage aid: it ranks which survivor to inspect first, it never
 * decides buy/skip. Same inputs always give the same number, so a threshold
 * change can be re-run over the frozen snapshots in journal.json.
 * Starts at 100, subtracts penalties. Higher = fewer soft red flags.
 */
function scoreCandidate(s) {
  let score = 100;
  const reasons = [];
  const penalize = (amount, why) => {
    if (amount <= 0) return;
    score -= amount;
    reasons.push(`-${amount.toFixed(0)} ${why}`);
  };

  // wash trading: volume far above what the pool depth can justify
  if (s.vol24h != null && s.liqUsd > 0) {
    const ratio = s.vol24h / s.liqUsd;
    if (ratio > RULES.washVolLiqRatio)
      penalize(Math.min(30, (ratio - RULES.washVolLiqRatio) * 0.5), `vol/liq ${ratio.toFixed(0)}x`);
  }
  // bundled supply still under the FAIL line is still the top dump risk
  if (s.insiderPct != null) penalize(Math.min(25, s.insiderPct), `insider ${s.insiderPct.toFixed(0)}%`);
  else penalize(10, "insider data missing");
  // dev holdings weigh double — one wallet, one decision, no coordination needed
  if (s.devPct != null) penalize(Math.min(15, s.devPct * 2), `dev ${s.devPct.toFixed(1)}%`);
  // concentration beyond a comfortable spread
  if (s.top10Pct != null) penalize(Math.min(15, Math.max(0, s.top10Pct - 15)), `top10 ${s.top10Pct.toFixed(0)}%`);
  // no age term: scoreCandidate only runs on tokens that already PASSED, and
  // minAgeHours is a hard FAIL, so everything scored here is already past it
  // thin books cost real money on a $10 round trip
  if (s.liqUsd != null && s.liqUsd < 100000)
    penalize(((100000 - s.liqUsd) / 100000) * 10, `liq ${fmtUsd(s.liqUsd)}`);
  // rugcheck's own normalised risk score
  if (s.rugScore != null) penalize(Math.min(10, s.rugScore / 10), `rugScore ${s.rugScore}`);
  if (s.lpLockedPct == null) penalize(8, "LP lock unknown");
  if (s.totalHolders != null && s.totalHolders < 1000)
    penalize(((1000 - s.totalHolders) / 1000) * 8, `${s.totalHolders} holders`);

  return { score: Math.max(0, Math.round(score)), reasons };
}

function printReport(mint, s, verdict) {
  console.log("");
  if (s.dead) {
    console.log(`✖ ${mint}: no active Solana pair found (dead, delisted, or wrong address)`);
    return;
  }
  console.log(`${s.name} (${s.symbol})  —  ${s.dexId}`);
  console.log(`mint: ${mint}`);
  console.log("─".repeat(60));
  console.log(`price        ${fmtUsd(s.priceUsd)}`);
  console.log(`liquidity    ${fmtUsd(s.liqUsd)}`);
  console.log(`volume 24h   ${fmtUsd(s.vol24h)}  (buys ${s.buys24h} / sells ${s.sells24h})`);
  console.log(`FDV          ${fmtUsd(s.fdv)}`);
  console.log(`age          ${s.ageHours != null ? s.ageHours < 48 ? s.ageHours.toFixed(1) + "h" : (s.ageHours / 24).toFixed(1) + "d" : "n/a"}`);
  console.log(`holders      ${s.totalHolders != null ? s.totalHolders.toLocaleString() : "n/a"}${s.launchpad ? "  via " + s.launchpad : ""}`);
  console.log(`top10 hold   ${s.top10Pct != null ? s.top10Pct.toFixed(1) + "%" : "n/a"}`);
  console.log(`dev holds    ${s.devPct != null ? s.devPct.toFixed(2) + "%" : "n/a"}`);
  console.log(`insider/bundle ${s.insiderPct != null ? s.insiderPct.toFixed(1) + "% across " + (s.insiderCount ?? "?") + " wallets" : "n/a"}`);
  console.log(`LP locked    ${s.lpLockedPct != null ? s.lpLockedPct.toFixed(0) + "%" : "n/a"}`);
  console.log(`mint auth    ${s.mintAuthority ? "ACTIVE ⚠" : "revoked ✓"}`);
  console.log(`freeze auth  ${s.freezeAuthority ? "ACTIVE ⚠" : "revoked ✓"}`);
  console.log(`rug score    ${s.rugScore != null ? s.rugScore : "n/a"}`);
  console.log("─".repeat(60));
  for (const f of verdict.fails) console.log(`  ✖ FAIL  ${f}`);
  for (const w of verdict.warns) console.log(`  ⚠ WARN  ${w}`);
  console.log("");
  console.log(verdict.pass ? "VERDICT: PASS — no hard red flags (warns still apply)" : "VERDICT: SKIP — hard red flag(s) found");
}

// ---------- outcomes / eval ----------
const HORIZONS = { "1d": 1, "7d": 7, "30d": 30 };

async function updateOutcomes() {
  const journal = loadJournal();
  if (journal.length === 0) return console.log("journal is empty");
  const solNow = await fetchSolPrice();
  let updated = 0;

  for (const entry of journal) {
    const name = entry.symbol || entry.mint.slice(0, 8);
    const loggedAt = new Date(entry.loggedAt).getTime();
    const elapsedDays = (Date.now() - loggedAt) / 864e5;
    const due = Object.entries(HORIZONS).filter(
      ([label, days]) => !entry.outcomes[label] && elapsedDays >= days
    );
    if (due.length === 0) continue;

    // one fetch per entry; a fetch ERROR (network down, 429 rate limit) skips
    // the entry until the next run — only a successful response with no pairs
    // means the token is actually dead
    let pair;
    try {
      pair = await fetchDexScreener(entry.mint);
    } catch (e) {
      console.error(`${name}: fetch failed (${e.message}) — will retry next run`);
      continue;
    }
    await sleep(250); // stay under DexScreener's rate limit across a long journal
    const priceNow = pair ? Number(pair.priceUsd) : null;
    const p0 = entry.snapshot?.priceUsd;

    for (const [label, days] of due) {
      // checked far past the horizon window => today's return would be
      // mislabeled as a 1d/7d return; record as missed, excluded from stats
      const grace = Math.max(1, days * 0.5);
      if (elapsedDays > days + grace) {
        entry.outcomes[label] = {
          checkedAt: new Date().toISOString(),
          missed: true,
          elapsedDays: +elapsedDays.toFixed(2),
        };
        console.log(`${name} [${entry.decision}] ${label}: window missed (checked at ${elapsedDays.toFixed(1)}d) — excluded from stats`);
        continue;
      }

      let ret;
      let dead = false;
      if (pair == null) {
        ret = -1; // dead/delisted => total loss (keeps survivorship bias out)
        dead = true;
      } else if (Number.isFinite(priceNow) && Number.isFinite(p0) && p0 > 0) {
        ret = priceNow / p0 - 1;
      } else {
        console.error(`${name} ${label}: price unavailable — will retry next run`);
        continue;
      }
      const solRet =
        Number.isFinite(solNow) && Number.isFinite(entry.solPriceUsd) && entry.solPriceUsd > 0
          ? solNow / entry.solPriceUsd - 1
          : null;

      entry.outcomes[label] = {
        checkedAt: new Date().toISOString(),
        elapsedDays: +elapsedDays.toFixed(2),
        priceUsd: Number.isFinite(priceNow) ? priceNow : null,
        ret,
        solRet,
        dead,
      };
      updated++;
      console.log(`${name} [${entry.decision}] ${label}: ${fmtPct(ret)}${dead ? " (DEAD)" : ""}  | SOL ${fmtPct(solRet)}`);
    }
  }

  saveJournal(journal);
  console.log(updated ? `\nrecorded ${updated} outcome(s)` : "nothing recorded this run");
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats() {
  const journal = loadJournal();
  if (journal.length === 0) return console.log("journal is empty — log some decisions first");

  const buys = journal.filter((e) => e.decision === "buy");
  const skips = journal.filter((e) => e.decision === "skip");
  console.log(`\njournal: ${journal.length} entries (${buys.length} buy, ${skips.length} skip)\n`);

  for (const label of Object.keys(HORIZONS)) {
    const done = buys.filter(
      (e) => e.outcomes[label] && !e.outcomes[label].missed && Number.isFinite(e.outcomes[label].ret)
    );
    if (!done.length) continue;
    const rets = done.map((e) => e.outcomes[label].ret);
    const solRets = done.map((e) => e.outcomes[label].solRet).filter((x) => x != null);
    const rugs = done.filter((e) => e.outcomes[label].ret <= -0.9).length;
    const winners = done.filter((e) => e.outcomes[label].ret >= 1).length;
    const stake = 10;
    const portfolio = rets.reduce((s, r) => s + stake * (1 + r), 0);
    const invested = stake * rets.length;
    const solPortfolio = solRets.length
      ? solRets.reduce((s, r) => s + stake * (1 + r), 0) + stake * (rets.length - solRets.length)
      : null;

    console.log(`── BUY outcomes @ ${label} (${done.length} trades) ──`);
    console.log(`  median return   ${fmtPct(median(rets))}`);
    console.log(`  best / worst    ${fmtPct(Math.max(...rets))} / ${fmtPct(Math.min(...rets))}`);
    console.log(`  rugged (≤-90%)  ${rugs}/${done.length}`);
    console.log(`  2x+ winners     ${winners}/${done.length}`);
    console.log(`  $10 each        $${invested.toFixed(0)} → $${portfolio.toFixed(2)} (${fmtPct(portfolio / invested - 1)})`);
    if (solPortfolio != null)
      console.log(`  SOL baseline    $${invested.toFixed(0)} → $${solPortfolio.toFixed(2)} (${fmtPct(solPortfolio / invested - 1)})  ${portfolio > solPortfolio ? "← system WINS" : "← system LOSES"}`);
    console.log("");
  }

  // false-positive check: skipped tokens that pumped at ANY recorded horizon
  const validRets = (e) =>
    Object.values(e.outcomes)
      .filter((o) => o && !o.missed && Number.isFinite(o.ret))
      .map((o) => o.ret);
  const missedWinners = skips.filter((e) => {
    const rets = validRets(e);
    return rets.length > 0 && Math.max(...rets) >= 1;
  });
  if (skips.some((e) => validRets(e).length > 0)) {
    console.log(`── SKIP analysis ──`);
    console.log(`  skipped tokens that did 2x+ anyway: ${missedWinners.length}/${skips.length}`);
    for (const m of missedWinners) {
      console.log(`    ${m.symbol || m.mint.slice(0, 8)}: best ${fmtPct(Math.max(...validRets(m)))} — skipped because: ${m.reason}`);
    }
    console.log("");
  }

  // realized results — what exit discipline actually produced, vs the paper
  // horizons above (which assume you never sold)
  const closed = buys.filter((e) => e.status === "closed" && Number.isFinite(e.exit?.realizedRet));
  if (closed.length) {
    const rets = closed.map((e) => e.exit.realizedRet);
    const stake = 10;
    const out = rets.reduce((s, r) => s + stake * (1 + r), 0);
    console.log(`── REALIZED (${closed.length} closed position(s)) ──`);
    console.log(`  median          ${fmtPct(median(rets))}`);
    console.log(`  $10 each        $${(stake * rets.length).toFixed(0)} → $${out.toFixed(2)} (${fmtPct(out / (stake * rets.length) - 1)})`);
    const holds = closed.map((e) => e.exit.heldHours).filter(Number.isFinite);
    if (holds.length) console.log(`  median hold     ${median(holds).toFixed(0)}h`);
    const byReason = {};
    for (const e of closed) (byReason[e.exit.reason] = byReason[e.exit.reason] || []).push(e.exit.realizedRet);
    for (const [r, rr] of Object.entries(byReason))
      console.log(`    "${r}" n=${rr.length} median ${fmtPct(median(rr))}`);
    console.log("");
  }

  // discovery-source comparison — which channel actually finds winners?
  const srcBuys = buys.filter((e) => e.source && validRets(e).length > 0);
  if (srcBuys.length) {
    console.log(`── by discovery source (best ret per entry) ──`);
    const groups = {};
    for (const e of srcBuys) (groups[e.source] = groups[e.source] || []).push(Math.max(...validRets(e)));
    for (const [src, rets] of Object.entries(groups))
      console.log(`  ${src.padEnd(12)} n=${rets.length}  median ${fmtPct(median(rets))}  best ${fmtPct(Math.max(...rets))}`);
    console.log("");
  }

  const pendingCount = journal.filter((e) =>
    Object.keys(HORIZONS).some((h) => !e.outcomes[h])
  ).length;
  if (pendingCount) console.log(`(${pendingCount} entries still have pending outcomes — run "update" daily)`);
}

function list() {
  const journal = loadJournal();
  if (journal.length === 0) return console.log("journal is empty");
  for (const e of journal) {
    const o7 = e.outcomes?.["7d"];
    const status = o7
      ? Number.isFinite(o7.ret) ? "7d " + fmtPct(o7.ret) : "7d missed"
      : "pending";
    console.log(
      `${e.loggedAt.slice(0, 10)}  ${(e.symbol || e.mint.slice(0, 8)).padEnd(10)} ${e.decision.padEnd(5)} ${status}  ${e.reason || ""}`
    );
  }
}

// ---------- discovery scan ----------
const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/solana";
const MAJORS = new Set([
  WSOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

async function fetchGeckoPools(kind, pages) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const data = await getJson(`${GT_BASE}/${kind}?page=${p}`).catch(() => null);
    if (!data?.data?.length) break;
    out.push(...data.data);
    await sleep(2100); // GeckoTerminal free tier: 30 req/min
  }
  return out;
}

// Hours since the last logged scan, or null if that can't be determined
// (missing/empty/corrupt log — a first-ever run is one such case, and must
// stay silent rather than warn). Cron is hourly and GitHub Actions schedules
// are best-effort, so gaps happen; cmdScan uses this to flag runs that
// followed a long silent stretch, because tracking's peak/attention sampling
// (r.p/r.s, and therefore how tight peakRet's lower bound really is) depends
// on scans landing close to hourly.
function scanGapHours(logPath) {
  try {
    if (!fs.existsSync(logPath)) return null;
    const lines = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length);
    if (!lines.length) return null;
    const lastTs = lines[lines.length - 1].split(/\s+/)[0];
    const prev = new Date(lastTs).getTime();
    if (!Number.isFinite(prev)) return null;
    return (Date.now() - prev) / 3.6e6;
  } catch {
    // a corrupt/unreadable scans.log must not block scanning; just skip the note
    return null;
  }
}

async function cmdScan(fullCheckCap) {
  console.log("fetching trending + new pools from GeckoTerminal...");
  const pools = [
    ...(await fetchGeckoPools("trending_pools", 10)),
    ...(await fetchGeckoPools("new_pools", 10)),
  ];

  const journal = loadJournal();
  const seen = new Set(journal.map((e) => e.mint));
  const candidates = new Map();
  for (const pool of pools) {
    const a = pool.attributes || {};
    const id = pool.relationships?.base_token?.data?.id || "";
    const mint = id.replace(/^solana_/, "");
    if (!mint || MAJORS.has(mint) || seen.has(mint) || candidates.has(mint)) continue;
    // cheap pre-filter on pool data before spending API calls on a full check
    const liq = Number(a.reserve_in_usd);
    if (!Number.isFinite(liq) || liq < RULES.minTrackLiquidityUsd) continue;
    candidates.set(mint, { name: a.name });
  }
  console.log(
    `${pools.length} pools seen → ${candidates.size} pass pre-filter (liq ≥ ${fmtUsd(RULES.minTrackLiquidityUsd)}, not majors, not already journaled)`
  );

  const list = [...candidates.entries()].slice(0, fullCheckCap);
  if (candidates.size > list.length)
    console.log(`(full-checking first ${list.length} — raise with: node coin.js scan ${candidates.size})`);
  const tracking = loadTracking();
  // A token already archived was fully observed once. Re-entering it before its
  // outcome window has closed would double-count one observation; re-entering it
  // long after is a new entry decision at a new price. RULES.reentryCooldownHours
  // draws that line — see the note there for why intake dies without it.
  const history = archiveHistory();
  const passed = [];
  let i = 0;
  http429s = 0; // count only this scan's rate limiting
  for (const [mint, meta] of list) {
    i++;
    process.stdout.write(`[${i}/${list.length}] ${(meta.name || mint.slice(0, 8)).padEnd(28)} `);
    try {
      const s = await buildSnapshot(mint);
      const verdict = runChecklist(s);
      // track every full-checked token, pass or fail — the pump-pattern
      // dataset needs the failures as its control group
      const prior = history.get(mint);
      const cooledDown =
        !prior || Date.now() - prior.lastSeenAt >= RULES.reentryCooldownHours * 3.6e6;
      if (!tracking[mint] && cooledDown && !s.dead) {
        tracking[mint] = {
          symbol: s.symbol || null,
          firstSeenAt: new Date().toISOString(),
          // 1 for a first-ever entry, 2+ for a re-entry after the cooldown.
          // `patterns` keys on mint+entryNo, so this is what keeps a repeat
          // from overwriting the earlier observation of the same token.
          entryNo: (prior?.entries || 0) + 1,
          // entry-filter hash + poll cadence — see the dataset provenance block.
          // without these, `f.pass` and `p.peakRet` are not comparable across
          // time and `patterns` silently averages incompatible eras.
          v: provenance(),
          f: trackFeatures(s, verdict, verdict.pass ? scoreCandidate(s).score : null),
          o: {},
        };
      }
      if (verdict.pass) {
        const { score, reasons } = scoreCandidate(s);
        console.log(`PASS ✓  score ${score}`);
        passed.push({
          mint,
          symbol: s.symbol,
          name: s.name,
          score,
          scoreReasons: reasons,
          liqUsd: s.liqUsd,
          vol24h: s.vol24h,
          // price/fdv/momentum are carried here on purpose: `alert` quotes
          // entry/2x/stop levels off these numbers and must stay pure
          // arithmetic over one frozen snapshot — no second fetch, so the
          // levels always match the scan they are attributed to. (It was
          // added for a cloud sandbox that could not reach dexscreener; the
          // determinism is why it stayed after that path was dropped.)
          priceUsd: s.priceUsd,
          fdv: s.fdv,
          chg1h: s.chg1h,
          chg6h: s.chg6h,
          chg24h: s.chg24h,
          buys1h: s.buys1h,
          sells1h: s.sells1h,
          ageHours: s.ageHours != null ? +s.ageHours.toFixed(1) : null,
          insiderPct: s.insiderPct != null ? +s.insiderPct.toFixed(1) : null,
          devPct: s.devPct != null ? +s.devPct.toFixed(2) : null,
          totalHolders: s.totalHolders,
          warns: verdict.warns,
          checkedAt: new Date().toISOString(),
        });
      } else {
        console.log(`skip (${verdict.fails[0] || "dead"})`);
      }
    } catch (e) {
      console.log(`error (${e.message})`);
    }
    await sleep(1000); // Rugcheck free tier is the tight one — 60 req/min max
  }

  // rate limiting must be LOUD — inside continue-on-error cron steps a silent
  // 429 streak just looks like a quiet market. A rugcheck 429 is worse than
  // invisible: it nulls the LP/insider/dev checks, so bad tokens pass easier.
  if (http429s)
    console.log(
      `\n⚠ ${http429s} HTTP 429 responses across all APIs this scan — data is incomplete; lower the scan cap or raise the sleep`
    );

  saveTracking(tracking);

  // Stamp how long each survivor has been on the shortlist. The screener
  // re-checks every candidate every run, so the numbers in candidates.json are
  // always fresh — but the same tokens keep clearing the filter, and nothing
  // said so. On 2026-09-01, 21 of the 39 distinct mints surfaced across the
  // last 24 scans had been on the list for at least 20 of them and 19 of them
  // dated to 2026-08-25, which reads as a live shortlist and is really one
  // week-old shortlist reprinted. These two fields are the difference between
  // "still passing" and "new", and nothing filters on them: a token that keeps
  // passing is still a valid buy, it just is not news.
  const surfaced = candidateHistory();
  for (const c of passed) {
    const h = surfaced.get(c.mint);
    c.firstSurfacedAt = h ? h.firstAt : c.checkedAt;
    c.surfacedCount = (h?.count || 0) + 1;
  }
  // new arrivals first, then by score within each group — the shortlist is read
  // top-down and the thing worth reading is what was not there yesterday
  passed.sort((a, b) => a.surfacedCount - b.surfacedCount || b.score - a.score);

  // candidates.json = latest shortlist (overwritten every run);
  // candidates-history.jsonl = every candidate ever surfaced, so a find is
  // never lost just because nobody looked within the scan window;
  // scans.log = one human-readable line per run
  fs.writeFileSync(path.join(__dirname, "candidates.json"), JSON.stringify(passed, null, 2));
  if (passed.length)
    fs.appendFileSync(
      path.join(__dirname, "candidates-history.jsonl"),
      passed.map((p) => JSON.stringify(p)).join("\n") + "\n"
    );
  // Scheduled GitHub Actions runs are best-effort, not guaranteed hourly; a
  // long silent stretch means tracking's once-per-run price sample can miss
  // a pump peak entirely, so flag it here rather than let it pass unnoticed.
  const scansLogPath = path.join(__dirname, "scans.log");
  const gapH = scanGapHours(scansLogPath);
  // the marker goes AFTER the timestamp, never before it: scanGapHours reads
  // the first whitespace token of the last line as the date, so prefixing the
  // line would make the next run unable to parse it — one gap would blind the
  // detector to every gap after it
  let gapMark = "";
  if (Number.isFinite(gapH) && gapH > 3) {
    gapMark = ` GAP=${gapH.toFixed(1)}h path-sampling-degraded`;
    console.error(`⚠ last scan was ${gapH.toFixed(1)}h ago (expected ~hourly) — path sampling degraded`);
  }
  fs.appendFileSync(
    scansLogPath,
    `${new Date().toISOString()}${gapMark} scanned=${list.length} passed=${passed.length}` +
      (http429s ? ` rate429=${http429s}` : "") +
      (passed.length ? ` [${passed.map((p) => `${p.symbol}:${p.mint}`).join(" ")}]` : "") +
      "\n"
  );

  console.log(`\n${passed.length} candidate(s) → candidates.json  (ranked, best first)`);
  console.log(`score = triage order only, NOT a buy signal — every one still needs manual review\n`);
  for (const c of passed) {
    console.log(
      `  [${String(c.score).padStart(3)}] ${(c.symbol || "?").padEnd(10)} liq ${fmtUsd(c.liqUsd)}  vol ${fmtUsd(c.vol24h)}  age ${c.ageHours != null ? c.ageHours + "h" : "n/a"}  insider ${c.insiderPct != null ? c.insiderPct + "%" : "?"}`
    );
    if (c.scoreReasons.length) console.log(`        ${c.scoreReasons.join(", ")}`);
    console.log(`        node coin.js check ${c.mint}`);
  }
  if (!passed.length)
    console.log("(normal — most new tokens are garbage; the filter is doing its job)");
  else
    console.log(`\nnext: manual checks (bundles/dev on gmgn.ai) → log every one you review, buy or skip`);
}

// ---------- pump-pattern tracking ----------
// Every token the scan full-checks gets tracked — PASS and FAIL alike (the
// FAILs are the control group). Outcomes land automatically at ~4h/1d/3d.
// This is the research dataset that answers "what did pumpers look like when
// first seen" without anyone having to log anything by hand.
const TRACKING_PATH = path.join(__dirname, "tracking.json");
// finished rows (all outcomes recorded) move here, one JSON line each, so
// tracking.json stays small and the track loop never slows down as the
// dataset grows; patterns reads live + archive together
const ARCHIVE_PATH = path.join(__dirname, "tracking-archive.jsonl");
const TRACK_BUCKETS = { h4: 4, d1: 24, d3: 72 };

function loadTracking() {
  if (!fs.existsSync(TRACKING_PATH)) return {};
  return JSON.parse(fs.readFileSync(TRACKING_PATH, "utf8"));
}

function saveTracking(t) {
  const tmp = TRACKING_PATH + ".tmp";
  // compact, not indent 1: the file is rewritten and committed every 10 minutes
  // now, and raising the attention-sample cap to 450 multiplies the dominant
  // term. Measured at ~93 B/sample indented vs ~57 B compact — a 39% cut on the
  // part that grows. Nothing reads this by eye; `patterns` and `stats` do.
  fs.writeFileSync(tmp, JSON.stringify(t));
  fs.renameSync(tmp, TRACKING_PATH);
}

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_PATH)) return [];
  // per-line parse: one truncated line (killed process, bad merge) must not
  // take down scan dedup AND patterns until someone hand-edits the file
  const rows = [];
  let bad = 0;
  for (const l of fs.readFileSync(ARCHIVE_PATH, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      bad++;
    }
  }
  if (bad) console.error(`(archive: skipped ${bad} corrupt line(s) in tracking-archive.jsonl)`);
  return rows;
}

// How many times each mint has already been surfaced as a candidate, and when
// it first was. Derived from candidates-history.jsonl rather than kept as its
// own state file: that log is already append-only and already holds every
// candidate ever printed, so there is nothing to keep in sync.
//
// Best-effort by design — a missing or corrupt history must not stop a scan
// from writing its shortlist, it just makes this run look like everything is
// new.
function candidateHistory() {
  const h = new Map();
  const p = path.join(__dirname, "candidates-history.jsonl");
  if (!fs.existsSync(p)) return h;
  for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    let c;
    try {
      c = JSON.parse(l);
    } catch {
      continue;
    }
    if (!c.mint) continue;
    const prev = h.get(c.mint);
    const at = c.checkedAt || null;
    h.set(c.mint, {
      count: (prev?.count || 0) + 1,
      firstAt: prev?.firstAt && (!at || prev.firstAt < at) ? prev.firstAt : at,
    });
  }
  return h;
}

// per-mint entry history for the scan's re-entry cooldown: how many times this
// mint has been entered, and when the most recent entry STARTED. Start, not
// finish, is the right anchor — the cooldown exists to keep two outcome windows
// from overlapping, and a window is measured from firstSeenAt.
//
// Reads live tracking as well as the archive: a mint whose first entry is still
// mid-flight is excluded by the `!tracking[mint]` check anyway, but counting it
// here keeps entryNo correct if it ever finishes and re-enters later.
function archiveHistory() {
  const h = new Map();
  const note = (r) => {
    const t = new Date(r.firstSeenAt).getTime();
    if (!r.mint || !Number.isFinite(t)) return;
    const prev = h.get(r.mint);
    // fail CLOSED on a corrupt/missing timestamp elsewhere in the history: keep
    // the newest one seen, so a bad row can only delay a re-entry, never invite
    // a double-count
    h.set(r.mint, {
      entries: (prev?.entries || 0) + 1,
      lastSeenAt: Math.max(prev?.lastSeenAt || 0, t),
    });
  };
  for (const r of loadArchive()) note(r);
  for (const [mint, r] of Object.entries(loadTracking())) note({ mint, ...r });
  return h;
}

function trackFeatures(s, verdict, score) {
  return {
    priceUsd: s.priceUsd,
    liqUsd: s.liqUsd,
    vol24h: s.vol24h,
    vol1h: s.vol1h,
    buys1h: s.buys1h,
    sells1h: s.sells1h,
    chg1h: s.chg1h,
    chg6h: s.chg6h,
    chg24h: s.chg24h,
    // 5m attention path — see buildSnapshot comment; a pump learner needs
    // "arriving right now" separated from stale 24h volume
    chg5m: s.chg5m,
    vol5m: s.vol5m,
    buys5m: s.buys5m,
    sells5m: s.sells5m,
    creator: s.creator,
    // cheapest possible market-regime control (SOL up/down days affect all memecoins)
    solPriceUsd: s.solPriceUsd != null ? +s.solPriceUsd.toFixed(2) : null,
    ageHours: s.ageHours != null ? +s.ageHours.toFixed(1) : null,
    fdv: s.fdv,
    top10Pct: s.top10Pct != null ? +s.top10Pct.toFixed(1) : null,
    insiderPct: s.insiderPct != null ? +s.insiderPct.toFixed(1) : null,
    devPct: s.devPct != null ? +s.devPct.toFixed(2) : null,
    totalHolders: s.totalHolders,
    lpLockedPct: s.lpLockedPct,
    launchpad: s.launchpad,
    pass: verdict.pass,
    failReason: verdict.pass ? null : verdict.fails[0] || null,
    score: score ?? null,
  };
}

// retire rows with every outcome recorded to the append-only archive —
// append BEFORE deleting from the live file so a crash between the two can
// only duplicate a row (patterns dedupes), never lose one
function archiveFinished(tracking) {
  const finished = Object.entries(tracking).filter(([, r]) =>
    Object.keys(TRACK_BUCKETS).every((b) => r.o[b])
  );
  if (!finished.length) return false;
  fs.appendFileSync(
    ARCHIVE_PATH,
    finished.map(([mint, r]) => JSON.stringify({ mint, ...r })).join("\n") + "\n"
  );
  for (const [mint] of finished) delete tracking[mint];
  console.log(`archived ${finished.length} finished token(s) → tracking-archive.jsonl`);
  return true;
}

async function cmdTrack() {
  const tracking = loadTracking();
  // archive first, every run — never gated behind "something is due"
  if (archiveFinished(tracking)) saveTracking(tracking);
  // poll EVERY unfinished row, not just the ones with a bucket due: peak and
  // trough are path data. a fixed-horizon ret cannot say whether a -99%@d1
  // token touched 3x on the way down, so the take-profit and stop-loss
  // questions in STUDY.md are unanswerable without sampling between buckets.
  const due = Object.entries(tracking).filter(([, r]) => r.f?.priceUsd > 0);
  if (!due.length) return console.log(`tracking: ${Object.keys(tracking).length} tokens, none pollable`);

  const dueBuckets = due.filter(([, r]) => {
    const elapsedH = (Date.now() - new Date(r.firstSeenAt).getTime()) / 3.6e6;
    return Object.entries(TRACK_BUCKETS).some(([b, h]) => !r.o[b] && elapsedH >= h);
  }).length;
  console.log(`tracking: polling ${due.length} token(s), ${dueBuckets} with a bucket due`);
  // batch endpoint: /tokens/v1/solana/{mints} takes up to 30 comma-separated
  // mints and returns a flat pair array (the /latest/dex/tokens endpoint no
  // longer supports commas — it returns pairs:null, which must NOT be read
  // as "everything died")
  for (let i = 0; i < due.length; i += 25) {
    const chunk = due.slice(i, i + 25);
    let pairsByMint = {};
    try {
      const data = await getJson(
        `https://api.dexscreener.com/tokens/v1/solana/${chunk.map(([m]) => m).join(",")}`
      );
      if (!Array.isArray(data)) throw new Error("unexpected response shape");
      for (const p of data) {
        if (p.chainId !== "solana") continue;
        const m = p.baseToken?.address;
        if (!m) continue;
        if (!pairsByMint[m] || (p.liquidity?.usd || 0) > (pairsByMint[m].liquidity?.usd || 0))
          pairsByMint[m] = p;
      }
      // a batch where EVERY requested mint is missing is an API anomaly, not
      // twenty-five simultaneous rugs — skip and retry next run
      if (Object.keys(pairsByMint).length === 0 && chunk.length > 1) {
        console.error(`  batch returned no pairs for ${chunk.length} tokens — treating as API glitch, retrying next run`);
        continue;
      }
    } catch (e) {
      console.error(`  batch fetch failed (${e.message}) — will retry next run`);
      continue;
    }
    for (const [mint, r] of chunk) {
      const elapsedH = (Date.now() - new Date(r.firstSeenAt).getTime()) / 3.6e6;
      const pair = pairsByMint[mint];
      const price = pair ? Number(pair.priceUsd) : null;

      let ret = null;
      if (pair == null) ret = -1;
      else if (Number.isFinite(price)) ret = price / r.f.priceUsd - 1;

      // running peak/trough, sampled once per cron pass. hourly sampling
      // misses intra-hour spikes, so peakRet is a LOWER BOUND on the best
      // exit that was actually available — never read it as exact.
      //
      // pair == null is excluded on purpose: a single mint missing from a
      // batch is often an API omission, not a rug, and folding its -1 into
      // troughRet would permanently mark a live token as having crashed.
      // the bucket write below still records the dead case with dead: true.
      if (ret != null && pair != null) {
        r.p = r.p || { peakRet: 0, troughRet: 0, peakH: 0, samples: 0 };
        r.p.samples++;
        if (ret > r.p.peakRet) {
          r.p.peakRet = +ret.toFixed(4);
          r.p.peakH = +elapsedH.toFixed(1);
        }
        // troughH mirrors peakH: without a timestamp on the trough, an EV
        // simulation can't tell whether the stop-loss or the peak came first
        // and has to bracket the answer with both orderings.
        if (ret < r.p.troughRet) {
          r.p.troughRet = +ret.toFixed(4);
          r.p.troughH = +elapsedH.toFixed(1);
        }

        // attention path — volume and order flow over time, sampled once per
        // cron pass. a pump is a change in attention, not just price; a single
        // discovery snapshot can't express that, but the batch response already
        // carries these fields every poll, so keeping them costs nothing.
        // Capped purely as a safety net against a row that somehow never
        // finishes and archives. The old cap of 100 assumed ~72 hourly polls
        // to d3; the workflow now polls every 10 minutes, which fills 100 in
        // 16.7h and would leave the d1->d3 window — where the stop-loss and
        // take-profit questions actually live — with no attention samples.
        // 6/h * 72h = 432, so 450 covers a full row with a little slack.
        r.s = r.s || [];
        if (r.s.length < 450) {
          r.s.push({
            h: +elapsedH.toFixed(1),
            ret: +ret.toFixed(4),
            liq: pair.liquidity?.usd != null ? Math.round(pair.liquidity.usd) : null,
            v1: pair.volume?.h1 != null ? Math.round(pair.volume.h1) : null,
            b1: pair.txns?.h1?.buys ?? null,
            s1: pair.txns?.h1?.sells ?? null,
            // the 5m fields matter more than the 1h ones here: sampling is
            // hourly, so h1 aggregates blur an attention burst across the
            // whole hour, and a burst is the thing an early pump signature
            // would look like. same response, no extra call.
            c5: pair.priceChange?.m5 ?? null,
            v5: pair.volume?.m5 != null ? Math.round(pair.volume.m5) : null,
            b5: pair.txns?.m5?.buys ?? null,
            s5: pair.txns?.m5?.sells ?? null,
          });
        }
      }

      for (const [b, h] of Object.entries(TRACK_BUCKETS)) {
        if (r.o[b] || elapsedH < h) continue;
        // a skipped cron run must not file a 9h reading as an h4 outcome and
        // silently poison the bucket. mirrors the grace window that
        // updateOutcomes already applies to the journal.
        if (elapsedH > h * 1.5) {
          r.o[b] = { missed: true, elapsedH: +elapsedH.toFixed(1) };
          console.error(`  ${r.symbol || mint.slice(0, 8)} ${b}: window missed (${elapsedH.toFixed(1)}h) — excluded from patterns`);
          continue;
        }
        if (ret == null) continue; // price glitch — retry next run
        r.o[b] = {
          ret: +ret.toFixed(4),
          liqUsd: pair?.liquidity?.usd ?? null,
          elapsedH: +elapsedH.toFixed(1),
          dead: pair == null,
        };
      }
    }
    await sleep(400);
  }

  archiveFinished(tracking); // rows that just completed their last bucket
  saveTracking(tracking);
  console.log("tracking outcomes saved");
}

// median gap between consecutive path samples — the cadence the row was
// ACTUALLY observed at, which is not the configured one whenever the runner
// was throttled or the process died mid-window
function observedCadenceMin(r) {
  if (!r.s || r.s.length < 3) return null;
  const hs = r.s.map((x) => x.h).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < hs.length; i++) gaps.push((hs[i] - hs[i - 1]) * 60);
  return median(gaps);
}

// Header for every `patterns` run. The tables below compare cells against each
// other; that comparison is only meaningful if the cells were produced by the
// same entry filter and watched at the same rate. When they were not, the
// difference between two cells can be entirely an artifact of when their rows
// were collected — which is exactly how the refuted 2026-08-31 `pass` finding
// happened. Print the partition first so it is impossible to read the tables
// without seeing it.
// A row is "dense" if its peak was sampled often enough that p.peakRet is a
// tight lower bound, "sparse" if it was not. The boundary is where the cadence
// change of 2026-08-27 actually landed in the data (median samples/row 12 before
// it, 175-385 after), not a tuned number — rows sit far from it on both sides.
const DENSE_SAMPLE_MIN = 50;

function printProvenance(rows) {
  const eras = {};
  for (const r of rows) {
    const key = r.v?.ef || "pre-versioning";
    (eras[key] = eras[key] || []).push(r);
  }
  const keys = Object.keys(eras).sort((a, b) => eras[b].length - eras[a].length);
  const mints = new Set(rows.map((r) => r.mint).filter(Boolean));
  const repeats = rows.length - mints.size;
  console.log(`\n── dataset provenance (n=${rows.length}) ──`);
  let splitEras = 0;
  for (const k of keys) {
    const g = eras[k];
    const cadences = g.map(observedCadenceMin).filter((x) => x != null);
    const obs = cadences.length ? `${median(cadences).toFixed(0)}min observed` : "no path samples";
    const cfg = g[0].v?.pollMin != null ? `${g[0].v.pollMin}min configured` : "cadence unrecorded";
    const samples = g.map((r) => r.p?.samples || 0).sort((a, b) => a - b);
    console.log(
      `  entry filter ${k.padEnd(14)} n=${String(g.length).padStart(3)}  ${cfg}, ${obs}  median samples/row ${samples[Math.floor(samples.length / 2)]}`
    );
    // An entry-filter version is NOT by itself a comparable stratum: the
    // pre-versioning bucket alone spans an hourly and a 10-minute polling
    // regime, and lifePk2x rises with poll count on its own. Split each era by
    // sampling density so that confound cannot hide inside a single line —
    // it is what made the 2026-08-31 headline look solid.
    const dense = g.filter((r) => (r.p?.samples || 0) >= DENSE_SAMPLE_MIN);
    const sparse = g.length - dense.length;
    if (dense.length && sparse) {
      splitEras++;
      const med = (a) => {
        const s = a.map((r) => r.p?.samples || 0).sort((x, y) => x - y);
        return s[Math.floor(s.length / 2)];
      };
      console.log(
        `      ├─ sparse (<${DENSE_SAMPLE_MIN} samples) n=${String(sparse).padStart(3)}  median ${med(g.filter((r) => (r.p?.samples || 0) < DENSE_SAMPLE_MIN))}`
      );
      console.log(
        `      └─ dense  (≥${DENSE_SAMPLE_MIN} samples) n=${String(dense.length).padStart(3)}  median ${med(dense)}`
      );
    }
  }
  if (repeats) {
    console.log(
      `\n  ⚠ ${rows.length} rows over ${mints.size} distinct mints (${repeats} re-entries).`
    );
    console.log(
      `    Repeat entries of one token are NOT independent samples — same holders,`
    );
    console.log(
      `    often the same regime. Any cell here can be several looks at one token;`
    );
    console.log(`    check the distinct-mint count before treating n as n.`);
  }
  // Re-entry stratum watch, added 2026-09-02 after an audit found the first
  // wave of re-entries skewed hard to old, heavily-liquid tokens — the stratum
  // with the LOWEST pump rate in the dataset (liq > $1M was 1/48 peak-2x; the
  // 37 known pumpers have median liq $81k / FDV $562k / age 20h). If re-entry
  // keeps readmitting that stratum, every forward sample drifts toward tokens
  // that structurally cannot 2x inside the d3 window, and the PASS arm grows in
  // the direction of "survives without growing" — the failure mode CLAUDE.md
  // names as the thing this project is NOT for.
  //
  // Deliberately a MEASUREMENT, not a cap. At the time of writing the skew was
  // one day old and the not-yet-re-entered eligible pool had median liquidity
  // ~$92k, i.e. the skew was the first wave taking trending_pools' biggest
  // permanent residents first, not a structural property of the mechanism.
  // Capping on that evidence would be tuning a rule to one day of data. Watch
  // this line instead: if re-entry median liquidity stays an order of magnitude
  // above first-entry median once the first re-entry d3 outcomes land, THEN it
  // is a RULES change with data behind it.
  const reRows = rows.filter((r) => (r.entryNo || 1) > 1);
  if (reRows.length) {
    const firstRows = rows.filter((r) => (r.entryNo || 1) === 1);
    const med = (a, f) => {
      const v = a.map(f).filter((x) => x != null).sort((x, y) => x - y);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    const line = (label, g) =>
      console.log(
        `    ${label.padEnd(12)} n=${String(g.length).padStart(3)}  median liq ${fmtUsd(med(g, (r) => r.f?.liqUsd)).padStart(8)}` +
          `  FDV ${fmtUsd(med(g, (r) => r.f?.fdv)).padStart(8)}  age ${String(Math.round((med(g, (r) => r.f?.ageHours) || 0) / 24)).padStart(3)}d`
      );
    console.log(`\n  re-entry stratum watch (re-entries should not be a different asset class):`);
    line("re-entries", reRows);
    line("first entry", firstRows);
  }
  if (splitEras) {
    console.log(
      `\n  ⚠ ${splitEras} era(s) above contain BOTH sparse and dense rows. \`lifePk2x\` is a`
    );
    console.log(
      `    sampled lower bound that rises with poll count, so within such an era a`
    );
    console.log(
      `    cell that skews dense will out-score one that skews sparse for no reason`
    );
    console.log(`    but observation. Compare inside one density stratum, never across.`);
  }
  if (keys.length > 1) {
    console.log(
      `\n  ⚠ ${keys.length} entry-filter versions in one dataset. Rows under different`
    );
    console.log(
      `    versions had DIFFERENT thresholds decide their \`pass\`, so every table`
    );
    console.log(
      `    below that groups on verdict/score is averaging incompatible filters.`
    );
    console.log(
      `    Sample counts differing across versions do the same to lifePk2x, which`
    );
    console.log(
      `    is a sampled lower bound and rises with poll count on its own.`
    );
    console.log(
      `    Stratify by era before citing any cell as evidence — see STUDY.md 2026-08-31.`
    );
  }
  console.log("");
}

// What the entry floors cost the pump goal, computed rather than quoted.
//
// This block exists because on 2026-09-01 four numbers were written into a code
// comment and into CLAUDE.md that NO shipped command could reproduce — they
// mixed a trough-based rug definition with a table that prints a horizon-based
// one, silently applied a density filter the table does not apply, and named a
// cell ("above floors n=59") that collided with a printed cell meaning
// something else. An unreproducible number in a project instruction file is
// worse than no number: the next reader cannot tell it is stale or wrong.
//
// Conventions, stated because a figure without them has already misled once:
//   - "dense" = p.samples >= DENSE_SAMPLE_MIN. peakRet is a SAMPLED lower bound
//     that rises with poll count, so the two sides must be sample-matched; the
//     median sample count of each side is printed so you can check that they are.
//   - peak-2x = p.peakRet >= 1 at ANY point in the tracked life, not at a horizon.
//   - BOTH rug definitions are printed: trough = p.troughRet <= -0.9 (the price
//     ever fell 90%); d3ret = the d3 outcome return <= -90% (it was still down
//     90% at d3). They are different questions and differ by ~10pp here.
//   - n counts ENTRIES (mint+entryNo). Distinct mints is printed beside it,
//     because repeat entries of one token are not independent samples.
//   - No p-value is printed. The split shown is one of several that were looked
//     at, so a raw p here would overstate; see STUDY.md for the tested claim.
function printFloorsCost(allRows) {
  const dense = allRows.filter(
    (r) => (r.p?.samples || 0) >= DENSE_SAMPLE_MIN && r.f?.liqUsd > 0 && r.f?.ageHours != null
  );
  if (dense.length < 20) return; // too few to be worth printing at all
  const below = (r) => !(r.f.liqUsd >= RULES.minLiquidityUsd && r.f.ageHours >= RULES.minAgeHours);
  const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(1).padStart(5)}%` : "    -");
  const line = (label, g) => {
    if (!g.length) return console.log(`  ${label.padEnd(20)} n=  0`);
    const pk = g.filter((r) => (r.p.peakRet || 0) >= 1).length;
    const trough = g.filter((r) => r.p.troughRet != null && r.p.troughRet <= -0.9).length;
    const withD3 = g.filter((r) => r.o?.d3 && Number.isFinite(r.o.d3.ret));
    const d3rug = withD3.filter((r) => r.o.d3.ret <= -0.9).length;
    const s = g.map((r) => r.p.samples).sort((a, b) => a - b);
    const mints = new Set(g.map((r) => r.mint).filter(Boolean)).size;
    console.log(
      `  ${label.padEnd(20)} n=${String(g.length).padStart(3)} (${String(mints).padStart(3)} mints)` +
        `  peak-2x ${pct(pk, g.length)}  rug(trough) ${pct(trough, g.length)}` +
        `  rug(d3ret) ${pct(d3rug, withD3.length)} of ${String(withD3.length).padStart(3)}` +
        `  med samples ${String(s[Math.floor(s.length / 2)]).padStart(3)}`
    );
  };
  console.log(`── floors cost (dense rows only, samples >= ${DENSE_SAMPLE_MIN}, n=${dense.length}) ──`);
  line("below floors", dense.filter(below));
  line("above floors", dense.filter((r) => !below(r)));
  console.log("  which floor does it:");
  line("  below: age only", dense.filter((r) => r.f.ageHours < RULES.minAgeHours && r.f.liqUsd >= RULES.minLiquidityUsd));
  line("  below: liq only", dense.filter((r) => r.f.ageHours >= RULES.minAgeHours && r.f.liqUsd < RULES.minLiquidityUsd));
  line("  below: both", dense.filter((r) => r.f.ageHours < RULES.minAgeHours && r.f.liqUsd < RULES.minLiquidityUsd));
  console.log(
    `\n  the floors trade pump exposure for rug protection; both columns are the price.\n` +
      `  the age floor moves both at once, which is why it is not a loosening candidate.\n`
  );
}

// aggregate the tracking dataset: what did the ones that pumped look like at
// discovery, versus the ones that died? deterministic bucket tables.
function cmdPatterns(bucketArg) {
  const horizon = ["h4", "d1", "d3"].includes(bucketArg) ? bucketArg : "d1";
  // archive first, live second: dedupe by mint keeps the live row if a crash
  // ever left a token in both places
  // Keyed by mint+entryNo, not mint: a token may legitimately be entered more
  // than once (RULES.reentryCooldownHours), and those are separate observations.
  // Keying on mint alone would silently drop the earlier one. The key still
  // dedupes the case this was written for — a crash leaving one entry in both
  // the archive and the live file — because that duplicate shares both fields.
  const key = (mint, r) => `${mint}#${r.entryNo || 1}`;
  const byEntry = new Map(loadArchive().map((r) => [key(r.mint, r), r]));
  for (const [mint, r] of Object.entries(loadTracking())) byEntry.set(key(mint, r), { mint, ...r });
  const allRows = [...byEntry.values()];
  const rows = allRows.filter((r) => r.o?.[horizon] && Number.isFinite(r.o[horizon].ret));
  if (!rows.length)
    return console.log(`no tracked outcomes at ${horizon} yet — the cron fills these in automatically`);

  printProvenance(rows);

  const table = (label, groupFn) => {
    const groups = {};
    for (const r of rows) {
      const g = groupFn(r.f);
      if (g == null) continue;
      (groups[g] = groups[g] || []).push(r);
    }
    console.log(`── by ${label} (outcome @ ${horizon}, n=${rows.length}) ──`);
    for (const [g, rowsInGroup] of Object.entries(groups)) {
      const rets = rowsInGroup.map((r) => r.o[horizon].ret);
      const twoX = rets.filter((x) => x >= 1).length;
      const dead = rets.filter((x) => x <= -0.9).length;
      // lifePk2x/lifePk50: did the token ever TOUCH 2x / 1.5x at ANY point in
      // its tracked life. These are deliberately NOT horizon-scoped, and the
      // name says so — an earlier draft called them pk2x/pk50 and printed them
      // under an "outcome @ d1" heading, which read as "peaked within 24h"
      // when in fact every one of the 19 rows then counted peaked after h4 and
      // 11 of them after h24.
      //
      // Two distinct errors live in these columns; both understate nothing and
      // overstate variably, so never quote them as exact:
      //   1. sampling rate — one poll per cron pass, so an intra-poll spike is
      //      invisible and peakRet is a lower bound (see the sampler comment).
      //   2. observation window — peak sampling shipped 2026-08-26, so an
      //      older row's peak is only known over the slice of its life that
      //      was actually watched. A cell holding longer-observed rows gets a
      //      higher lifePk for free. Compare cells only at d3, where the
      //      windows are closest, exactly as the path section below does.
      const withPath = rowsInGroup.filter((r) => r.p && r.p.samples >= 3);
      const lifePk2x = withPath.length
        ? `${Math.round((withPath.filter((r) => r.p.peakRet >= 1).length / withPath.length) * 100)}`.padStart(3) + "%"
        : "  -";
      const lifePk50 = withPath.length
        ? `${Math.round((withPath.filter((r) => r.p.peakRet >= 0.5).length / withPath.length) * 100)}`.padStart(3) + "%"
        : "  -";
      console.log(
        `  ${g.padEnd(18)} n=${String(rets.length).padStart(3)}  median ${fmtPct(median(rets)).padStart(8)}  2x+ ${((twoX / rets.length) * 100).toFixed(0).padStart(3)}%  rug ${((dead / rets.length) * 100).toFixed(0).padStart(3)}%  lifePk2x ${lifePk2x}  lifePk50 ${lifePk50} (path n=${withPath.length})`
      );
    }
    console.log("");
  };

  console.log("");
  table("verdict", (f) => (f.pass ? "PASS" : "FAIL"));
  table("age at discovery", (f) =>
    // 24-48h is split out so the zone minAgeHours cuts stays visible here —
    // this table is the reversal check for RULES change #2
    f.ageHours == null
      ? null
      : f.ageHours < 6
        ? "<6h"
        : f.ageHours < 24
          ? "6-24h"
          : f.ageHours < 48
            ? "24-48h"
            : f.ageHours < 72
              ? "2-3d"
              : ">3d"
  );
  table("safety score", (f) =>
    !f.pass ? "FAIL" : f.score == null ? null : f.score >= 80 ? "80-100" : f.score >= 60 ? "60-79" : "<60"
  );
  table("insider %", (f) =>
    f.insiderPct == null ? "unknown" : f.insiderPct < 5 ? "<5%" : f.insiderPct < 15 ? "5-15%" : ">15%"
  );
  table("liquidity", (f) =>
    f.liqUsd == null ? null : f.liqUsd < 50000 ? "$30-50k" : f.liqUsd < 150000 ? "$50-150k" : ">$150k"
  );
  // What the entry floors cost the pump goal — the project's central tension,
  // kept as a standing view after the `momentum gate` table was retired.
  //
  // MEASUREMENT ONLY, and this table alone is NOT the evidence for that claim.
  // Its `rug` column is the horizon return <= -90%, it applies no
  // sampling-density filter, and it splits the above-floors group by the STORED
  // `f.pass`, which is era-dependent (32 rows carry pass=true with age < 48h,
  // written before minAgeHours was raised). All three make it the wrong
  // instrument for a headline number. The `floors cost` block printed after
  // the tables is the right one: dense rows only, both rug definitions
  // labelled, over every tracked row rather than only those with an outcome at
  // this horizon.
  //
  // An earlier version of this comment quoted four figures this table cannot
  // emit, and one of them ("above floors n=59") coincidentally equalled a
  // printed cell that meant something else — a reader would have thought they
  // had reproduced it. Numbers now live under the code that computes them.
  table("entry floors", (f) => {
    if (f.liqUsd == null || f.ageHours == null || !(f.liqUsd > 0)) return null;
    const liqOk = f.liqUsd >= RULES.minLiquidityUsd;
    const ageOk = f.ageHours >= RULES.minAgeHours;
    if (liqOk && ageOk) return f.pass ? "above floors, PASS" : "above floors, FAIL";
    if (ageOk) return "below: liq only";
    if (liqOk) return "below: age only";
    return "below: both";
  });
  // Pre-registered candidate (RULES.momMinChg24h), MEASUREMENT ONLY — nothing
  // gates or alerts on this. Split INSIDE age strata on purpose: chg24h is
  // ~90% collinear with age < 7d, so an unstratified table would show the age
  // effect wearing a chg24h label and read as confirmation. The comparison
  // that matters is hot-vs-cold WITHIN a row of this table, never across rows.
  //
  // What would retire it: no separation inside either stratum once the current
  // entry-filter era reaches n >= 30. What would NOT promote it: a good-looking
  // number at a threshold other than 1000 (see the RULES note).
  table("chg24h gate x age", (f) => {
    if (f.chg24h == null || f.ageHours == null) return null;
    const hot = f.chg24h > RULES.momMinChg24h;
    return (f.ageHours < 168 ? "young " : "old   ") + (hot ? "hot" : "cold");
  });
  table("1h momentum", (f) => {
    if (f.buys1h == null || f.sells1h == null) return null;
    const t = f.buys1h + f.sells1h;
    if (t < 10) return "quiet";
    const ratio = f.buys1h / Math.max(1, f.sells1h);
    return ratio >= 1.5 ? "buy pressure" : ratio <= 0.67 ? "sell pressure" : "balanced";
  });

  // path section: answers the questions a fixed-horizon ret cannot. only
  // rows tracked since peak sampling shipped (2026-08-26) carry r.p, so this
  // stays quiet until the dataset has some.
  // 6+ samples, and only at d3, where the peak window and the return window
  // finally line up (r.p keeps accumulating until the row archives at 72h,
  // so at h4 this would compare a 108h peak against a 4h return). with two
  // samples the table is just the d1 reading restated — and it would read as
  // evidence about the stop loss, the one question STUDY.md says not to
  // answer casually.
  const withPath =
    horizon === "d3" ? rows.filter((r) => r.p && r.p.samples >= 6) : [];
  if (withPath.length) {
    console.log(`── path (n=${withPath.length} with peak sampling) ──`);
    // peakRet is floored at 0 by its initializer, so a median over all rows
    // is pinned to 0 whenever most tokens never traded above entry. report
    // the median only over rows that actually got above entry, and say how
    // many those were.
    const aboveEntry = withPath.filter((r) => r.p.peakRet > 0);
    const hit2x = withPath.filter((r) => r.p.peakRet >= 1);
    const ended = hit2x.filter((r) => r.o[horizon].ret < 1).length;
    console.log(`  above entry     ${aboveEntry.length}/${withPath.length} ever traded above the discovery price`);
    if (aboveEntry.length)
      console.log(
        `  median peak     ${fmtPct(median(aboveEntry.map((r) => r.p.peakRet)))}   (of those; lower bound — sampled hourly)`
      );
    console.log(`  touched 2x      ${hit2x.length}/${withPath.length}, of which ${ended} gave it all back by ${horizon}`);
    // the stop-loss question from STUDY.md: how many tokens that ended up
    // profitable had already breached -50% first?
    const stopped = withPath.filter((r) => r.p.troughRet <= -0.5);
    const recovered = stopped.filter((r) => r.p.peakRet >= 1).length;
    console.log(`  breached -50%   ${stopped.length}/${withPath.length}, of which ${recovered} later touched 2x+ (cost of the stop)`);
    console.log("");
  }
  printFloorsCost(allRows);
  console.log(`read this as: which discovery profile actually pumped — feed conclusions back into RULES`);
}

// ---------- exit discipline ----------
/**
 * Turns the exit rules in checklist.md into alerts instead of willpower.
 * Reports only — it never trades. You still place the order yourself, then
 * record it with `exit` so the journal keeps a realized return.
 */
async function cmdWatch() {
  const journal = loadJournal();
  const open = journal.filter((e) => e.decision === "buy" && e.status !== "closed");
  if (!open.length) return console.log("no open positions (log a buy to start tracking one)");

  console.log(`${open.length} open position(s)\n`);
  let acted = 0;

  for (const e of open) {
    const name = e.symbol || e.mint.slice(0, 8);
    const heldHours = (Date.now() - new Date(e.loggedAt).getTime()) / 3.6e6;
    let pair;
    try {
      pair = await fetchDexScreener(e.mint);
    } catch (err) {
      console.log(`${name.padEnd(10)} fetch failed (${err.message}) — retry next run`);
      continue;
    }
    await sleep(400);

    const p0 = e.snapshot?.priceUsd;
    const liq0 = e.snapshot?.liqUsd;
    if (pair == null) {
      console.log(`${name.padEnd(10)} ✖ DEAD — no pair left. Position is a total loss.`);
      console.log(`           node coin.js exit ${e.mint} "rugged/dead"\n`);
      acted++;
      continue;
    }
    const price = Number(pair.priceUsd);
    const liq = pair.liquidity?.usd ?? null;
    const mult = Number.isFinite(price) && p0 > 0 ? price / p0 : null;
    const ret = mult != null ? mult - 1 : null;

    const alerts = [];
    if (mult != null && mult >= RULES.takeProfitX)
      alerts.push(`🎯 TAKE PROFIT — ${mult.toFixed(2)}x, sell half now, ride the rest free`);
    if (liq != null && liq0 > 0 && liq < liq0 * (1 - RULES.lpDrainPct / 100))
      alerts.push(`🚨 LP DRAIN — liquidity ${fmtUsd(liq)} vs ${fmtUsd(liq0)} at entry. EXIT NOW, don't wait for price`);
    if (ret != null && ret <= -RULES.stopLossPct / 100)
      alerts.push(`🛑 STOP LOSS — ${fmtPct(ret)}. Cut it, never average down`);
    if (heldHours > RULES.timeStopHours && mult != null && mult < RULES.takeProfitX)
      alerts.push(`⏰ TIME STOP — ${heldHours.toFixed(0)}h with no 2x. Capital has a cost, get out`);

    const flag = alerts.length ? "!" : " ";
    console.log(
      `${flag} ${name.padEnd(10)} ${fmtPct(ret)}  (${mult != null ? mult.toFixed(2) + "x" : "?"})  liq ${fmtUsd(liq)}  held ${heldHours.toFixed(0)}h`
    );
    for (const a of alerts) console.log(`           ${a}`);
    if (alerts.length) {
      console.log(`           node coin.js exit ${e.mint} "<reason>"\n`);
      acted++;
    }
  }
  if (acted) {
    console.log(`\n${acted} position(s) need action`);
    // non-zero exit so the CI job goes red and GitHub emails — an alert
    // buried in a green build log is an alert nobody reads
    process.exitCode = 1;
  } else {
    console.log(`\nno action needed`);
  }
}

async function cmdExit(mint, reason) {
  if (!reason) {
    console.error(`a reason is required — it becomes the exit failure-mode data`);
    process.exit(1);
  }
  const journal = loadJournal();
  const entry = [...journal].reverse().find((e) => e.mint === mint && e.decision === "buy" && e.status !== "closed");
  if (!entry) {
    console.error(`no open buy position found for ${mint}`);
    process.exit(1);
  }

  const pair = await fetchDexScreener(mint).catch(() => null);
  const price = pair ? Number(pair.priceUsd) : null;
  const p0 = entry.snapshot?.priceUsd;
  const ret = pair == null ? -1 : Number.isFinite(price) && p0 > 0 ? price / p0 - 1 : null;

  entry.status = "closed";
  entry.exit = {
    exitedAt: new Date().toISOString(),
    heldHours: +((Date.now() - new Date(entry.loggedAt).getTime()) / 3.6e6).toFixed(1),
    priceUsd: Number.isFinite(price) ? price : null,
    realizedRet: ret,
    reason,
  };
  saveJournal(journal);
  console.log(`closed ${entry.symbol || mint}: ${fmtPct(ret)} after ${entry.exit.heldHours}h — "${reason}"`);
}

// ---------- commands ----------
async function cmdCheck(mint) {
  const s = await buildSnapshot(mint);
  const verdict = runChecklist(s);
  printReport(mint, s, verdict);
}

async function cmdLog(mint, decision, reason, source) {
  if (!["buy", "skip"].includes(decision)) {
    console.error(`decision must be "buy" or "skip", got "${decision}"`);
    process.exit(1);
  }
  if (!reason) {
    console.error(`a reason is required — future-you needs it for error analysis`);
    process.exit(1);
  }
  const s = await buildSnapshot(mint);
  const verdict = runChecklist(s);
  printReport(mint, s, verdict);

  // never journal an entry without a reliable price snapshot — outcomes could
  // not be computed from it and the eval would silently rot
  if (s.dead || !Number.isFinite(s.priceUsd)) {
    console.error(`\ncannot log: no reliable price snapshot (dead token or API issue) — try again later`);
    process.exit(1);
  }

  const journal = loadJournal();
  journal.push({
    id: journal.length + 1,
    mint,
    symbol: s.symbol || null,
    name: s.name || null,
    loggedAt: new Date().toISOString(),
    decision,
    reason,
    source: source || null, // discovery channel: smartmoney, twitter, dexscreener, friend, ...
    verdict: { pass: verdict.pass, fails: verdict.fails, warns: verdict.warns },
    snapshot: s,
    solPriceUsd: s.solPriceUsd,
    outcomes: {},
  });
  saveJournal(journal);
  console.log(`\nlogged #${journal.length}: ${decision.toUpperCase()} ${s.symbol || mint} — "${reason}"`);
  if (decision === "buy" && !verdict.pass)
    console.log(`⚠ NOTE: you are buying against a SKIP verdict — journal will show if that's a pattern`);

  // opportunistic outcome collection — every log visit also picks up due
  // outcomes, so a forgotten daily update run costs less
  console.log("\n(checking for due outcomes...)");
  await updateOutcomes();
}

// ---------- alert ----------
// Deterministic: same inputs -> same issue body, no model in the path. Reads
// only candidates.json (written by the hourly Action, which has network) so
// this runs anywhere. Prints the notification body to stdout and exits 0 when
// there is something to say; exits 3 when there is not, which is the normal
// case and must not be read as a failure by the caller.
const ALERTS_SENT_PATH = path.join(__dirname, "alerts-sent.json");
// append-only history of every alert ever sent — see the write in cmdAlert for
// why this exists separately from the pruned cooldown file above
const ALERTS_LOG_PATH = path.join(__dirname, "alerts.jsonl");

// 4 significant figures, never scientific notation: these are prices like
// 0.0000007312 and a human has to paste them into a chart
function fmtPrice(x) {
  if (!Number.isFinite(x) || x <= 0) return "?";
  const decimals = Math.max(0, 4 - 1 - Math.floor(Math.log10(x)));
  return "$" + x.toFixed(Math.min(20, decimals));
}

function loadAlertsSent() {
  if (!fs.existsSync(ALERTS_SENT_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ALERTS_SENT_PATH, "utf8"));
  } catch {
    // a corrupt dedup file must not block alerts; worst case, one repeat
    console.error("(alerts-sent.json unreadable — treating as empty)");
    return {};
  }
}

function alertQualifies(c, sent, now) {
  const R = RULES;
  if (!(c.score >= R.alertMinScore)) return false;
  if (c.insiderPct == null || c.insiderPct >= R.alertMaxInsiderPct) return false;
  if (c.fdv == null || c.fdv >= R.alertMaxFdv) return false;
  if (!(c.liqUsd >= R.minLiquidityUsd)) return false;
  if (c.chg24h == null || c.chg24h >= R.alertMaxChg24h) return false;
  if (c.chg24h <= R.alertMinChg24h) return false;
  if (c.vol24h == null || !(c.liqUsd > 0) || c.vol24h / c.liqUsd < R.alertMinVolLiq)
    return false;
  if (!(c.ageHours >= Math.max(R.alertMinAgeHours, R.minAgeHours))) return false;
  if (!(c.priceUsd > 0)) return false;
  // never quote a price the scan did not just fetch: `discovery scan` is
  // continue-on-error, so a failed scan leaves the previous run's
  // candidates.json in place and every level below would be computed from
  // a stale priceUsd
  const seenAt = c.checkedAt ? new Date(c.checkedAt).getTime() : NaN;
  if (!Number.isFinite(seenAt) || now - seenAt > 2 * 3.6e6) return false;
  // a corrupt timestamp must fail CLOSED (treat as just-alerted); NaN
  // comparisons are false, which would silently bypass the cooldown
  if (c.mint in sent) {
    const last = new Date(sent[c.mint]).getTime();
    if (!Number.isFinite(last)) return false;
    if (now - last < R.alertCooldownHours * 3.6e6) return false;
  }
  return true;
}

function alertBody(c) {
  const P = c.priceUsd;
  const R = RULES;
  // the knife check comes FIRST. it used to sit behind the pullback branch,
  // so 24h +35% / 6h -22% (up on the day, dumping right now) won the pretty
  // pullback-zone line while the 6h collapse went unmentioned. what is
  // happening in the last 6h outranks what happened over the last 24.
  let entry;
  if (c.chg6h != null && c.chg6h < R.alertDowntrendChg6h) {
    entry =
      `⚠ กำลังเป็นขาลง (6h ${c.chg6h}%, 24h ${c.chg24h}%) — **อย่าเพิ่งรับมีด** รอให้ 6h กลับเป็นบวกก่อน`;
  } else if (c.chg24h > R.alertPullbackChg24h) {
    entry = `ขึ้นมา ${c.chg24h.toFixed(0)}% ใน 24h — รอย่อโซน **${fmtPrice(P * 0.72)} – ${fmtPrice(P * 0.8)}**`;
  } else {
    entry = `เข้าแถว **${fmtPrice(P)}** ได้`;
  }
  const volLiq = c.liqUsd > 0 && c.vol24h != null ? (c.vol24h / c.liqUsd).toFixed(1) + "x" : "?";
  // "ใหม่" vs "อยู่ในลิสต์มา Nh" — the shortlist reprints tokens that keep
  // passing, and without this every entry reads as a fresh find
  let seenFor = "";
  const firstAt = c.firstSurfacedAt ? new Date(c.firstSurfacedAt).getTime() : NaN;
  if (Number.isFinite(firstAt)) {
    const h = (Date.now() - firstAt) / 3.6e6;
    seenFor = h < 2 ? " · **ใหม่**" : ` · อยู่ในลิสต์มา ${h < 48 ? `${h.toFixed(0)}h` : `${(h / 24).toFixed(0)}d`}`;
  }
  return [
    `### ${c.symbol || c.mint.slice(0, 8)} — score ${c.score}${seenFor}`,
    "",
    "```",
    c.mint,
    "```",
    "",
    `liq ${fmtUsd(c.liqUsd)} · FDV ${fmtUsd(c.fdv)} · vol24h ${fmtUsd(c.vol24h)} (${volLiq} ของ liq) · insider ${c.insiderPct}% · อายุ ${c.ageHours}h`,
    `chg 1h ${c.chg1h ?? "?"}% · 6h ${c.chg6h ?? "?"}% · 24h ${c.chg24h}%`,
    "",
    `- **เข้า:** ${entry}`,
    `- **ขายครึ่งที่ 2x:** ${fmtPrice(P * 2)}`,
    `- **ที่เหลือ 3-4x:** ${fmtPrice(P * 3)} – ${fmtPrice(P * 4)} — อย่ารอยอด`,
    `- **Stop loss:** ${fmtPrice(P * (1 - R.stopLossPct / 100))} หรือออกทันทีถ้า LP หดแรง`,
    `- **Time stop:** ${R.timeStopHours}h ไม่ขยับ = ออก`,
    "",
    `[dexscreener](https://dexscreener.com/solana/${c.mint}) · [gmgn](https://gmgn.ai/sol/token/${c.mint})`,
    `ข้อมูล ณ ${c.checkedAt}`,
  ].join("\n");
}

function cmdAlert(commitSent) {
  const CAND_PATH = path.join(__dirname, "candidates.json");
  if (!fs.existsSync(CAND_PATH)) {
    console.error("no candidates.json — run `node coin.js scan` first");
    process.exit(3);
  }
  const candidates = JSON.parse(fs.readFileSync(CAND_PATH, "utf8"));
  const sent = loadAlertsSent();
  const now = Date.now();
  // One gate since 2026-09-01. The parallel `momentum` track was removed by
  // its own pre-registered kill condition — see the RULES tombstone. Nothing
  // replaced it: the surviving pump candidate (momMinChg24h) is measurement
  // only, so the phone gets safety-gate hits or nothing at all.
  const hits = candidates.filter((c) => alertQualifies(c, sent, now));
  if (!hits.length) {
    console.error(`alert: ${candidates.length} candidate(s), none clear the notification gate`);
    process.exit(3);
  }

  const out = [];
  out.push("## 🛡 safety — ผ่าน filter ครบ ไม่มี red flag", "");
  out.push(hits.map((c) => alertBody(c)).join("\n\n---\n\n"));
  out.push(
    "",
    "---",
    "",
    "ตัวเลขเข้า/ออกคำนวณจาก exit rules ใน RULES ตรงๆ ไม่ใช่คำทำนาย.",
    "gate นี้กัน downside เท่านั้น — ผ่าน filter แล้วยังไม่ได้แปลว่าจะขึ้น.",
    "$10 ต่อไม้คือ stop loss ตัวจริง.",
    "",
    "ดูแล้วบันทึก: `node coin.js log <mint> buy|skip \"reason\"` — skip ก็เป็น data"
  );
  console.log(out.join("\n"));

  // The dedup write is opt-in. A bare `node coin.js alert` on the laptop is a
  // preview: if it recorded the mints, the next cloud run would go quiet for
  // 72h and the phone notification would never happen — the exact failure the
  // workflow's revert branch exists to prevent, entered through the front door.
  // Only the workflow, which actually creates the issue, passes --commit-sent.
  if (commitSent) {
    // Permanent record FIRST, dedup state second. alerts-sent.json is a
    // COOLDOWN file — it is pruned at 4x alertCooldownHours so it cannot grow
    // forever — but it was also the only record anywhere of what the system had
    // ever told the owner to buy. On 2026-09-02 an audit found the first
    // entries (2026-08-26) were days from being pruned, which would have
    // silently destroyed the ground truth for every alert-gate backtest. The
    // append-only log is that ground truth; the pruned file stays a cache.
    //
    // Entry price is captured here, not looked up later: a backtest that
    // recovers it from a scan snapshot afterwards is guessing at which snapshot
    // the alert was built from, and that guess is what made two reconstructions
    // of the same 39 alerts disagree by 15 percentage points.
    const logLine = (c) =>
      JSON.stringify({
        mint: c.mint,
        symbol: c.symbol,
        alertedAt: new Date(now).toISOString(),
        track: "safety",
        priceUsd: c.priceUsd,
        liqUsd: c.liqUsd,
        fdv: c.fdv,
        ageHours: c.ageHours,
        chg24h: c.chg24h,
        chg6h: c.chg6h,
        score: c.score,
        // the snapshot the levels were quoted off, so a backtest can align
        // exactly instead of inferring
        checkedAt: c.checkedAt,
        firstSurfacedAt: c.firstSurfacedAt ?? null,
        surfacedCount: c.surfacedCount ?? null,
      });
    try {
      fs.appendFileSync(ALERTS_LOG_PATH, hits.map(logLine).join("\n") + "\n");
    } catch (e) {
      // never let the archive write block the dedup write: a failure here
      // costs a history row, a failure there re-alerts the same mint for 72h
      console.error(`(could not append to alerts.jsonl: ${e.message})`);
    }
    for (const c of hits) sent[c.mint] = new Date(now).toISOString();
    // prune anything long past the cooldown so this file cannot grow forever
    const cutoff = now - RULES.alertCooldownHours * 3.6e6 * 4;
    for (const [m, t] of Object.entries(sent)) {
      const ts = new Date(t).getTime();
      if (Number.isFinite(ts) && ts < cutoff) delete sent[m];
    }
    fs.writeFileSync(ALERTS_SENT_PATH, JSON.stringify(sent, null, 1));
  } else {
    console.error("(preview — alerts-sent.json not written; pass --commit-sent to record)");
  }
  console.error(
    `alert: safety ${hits.length} (${hits.map((c) => c.symbol).join(", ")})`
  );
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "check":
      if (!args[0]) return console.error("usage: node coin.js check <mint>");
      return cmdCheck(args[0]);
    case "scan":
      return cmdScan(Math.max(1, Number(args[0]) || 150));
    case "log": {
      let source = null;
      const si = args.indexOf("--src");
      if (si !== -1) {
        source = args[si + 1] || null;
        args.splice(si, 2);
      }
      if (args.length < 3)
        return console.error(`usage: node coin.js log <mint> buy|skip "reason" [--src smartmoney|twitter|...]`);
      return cmdLog(args[0], args[1], args.slice(2).join(" "), source);
    }
    case "track":
      return cmdTrack();
    case "patterns":
      return cmdPatterns(args[0]);
    case "watch":
      return cmdWatch();
    case "alert":
      return cmdAlert(args.includes("--commit-sent"));
    case "exit":
      if (args.length < 2) return console.error(`usage: node coin.js exit <mint> "reason"`);
      return cmdExit(args[0], args.slice(1).join(" "));
    case "update":
      return updateOutcomes();
    case "stats":
      return stats();
    case "list":
      return list();
    default:
      console.log(`coin.js — memecoin safety check + decision journal + eval

usage:
  node coin.js scan [cap]                     sweep trending+new Solana pools, full-check
                                              survivors (default cap 150), shortlist → candidates.json
  node coin.js check <mint>                   run safety checklist on a token
  node coin.js log <mint> buy|skip "reason" [--src <channel>]
                                              record a decision (snapshot saved);
                                              --src tags where you found it (smartmoney, twitter, ...)
  node coin.js track                          record 4h/1d/3d outcomes for every scanned token
  node coin.js patterns [h4|d1|d3]            pump-pattern tables: discovery profile vs outcome
  node coin.js watch                          alert on open positions: 2x, time stop, LP drain
  node coin.js alert [--commit-sent]          print a phone-notification body for candidates that
                                              clear the alert gate (exit 3 = nothing). previews by
                                              default; --commit-sent records the 72h dedup
  node coin.js exit <mint> "reason"           close a position, record realized return
  node coin.js update                         record due 1d/7d/30d outcomes
  node coin.js stats                          returns, rug rate, vs SOL baseline
  node coin.js list                           list journal entries`);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
