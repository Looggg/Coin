#!/usr/bin/env node
/**
 * coin.js — Solana memecoin safety-check + decision journal + eval tool
 *
 * Zero dependencies. Data sources: DexScreener API + Rugcheck API (both free, no key).
 *
 * Commands:
 *   node coin.js check <mint>                  Fetch metrics, run safety checklist, print verdict
 *   node coin.js log <mint> buy|skip "reason"  Snapshot + record decision into journal.json
 *   node coin.js update                        Fill in 1d/7d/30d outcomes for due entries
 *   node coin.js stats                         Summary: returns, rug rate, vs SOL baseline
 *   node coin.js list                          List journal entries
 */

const fs = require("fs");
const path = require("path");

const JOURNAL_PATH = path.join(__dirname, "journal.json");
const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Raydium V4 LP authority — its holdings are the pool itself, not an insider
const RAYDIUM_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

// ---------- thresholds (tune these as you learn from the journal) ----------
const RULES = {
  minLiquidityUsd: 30000, // below this, $10 in/out slippage eats you
  maxTop10Pct: 30, // top-10 holders (excl. LP) combined %
  minLpLockedPct: 80, // LP locked/burned percentage
  washVolLiqRatio: 10, // vol24h > N x liquidity => wash suspicion
  minAgeHours: 24, // younger than this => extra risk warning
};

// ---------- helpers ----------
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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

async function fetchSolPrice() {
  try {
    const pair = await fetchDexScreener(WSOL_MINT);
    return pair ? Number(pair.priceUsd) : null;
  } catch {
    return null;
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
    fdv: pair.fdv ?? null,
    ageHours: pair.pairCreatedAt ? hoursSince(pair.pairCreatedAt) : null,
    top10Pct,
    lpLockedPct,
    mintAuthority,
    freezeAuthority,
    rugScore,
    rugRisks,
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

  const dangers = (s.rugRisks || []).filter((r) => r.level === "danger");
  for (const d of dangers) fails.push(`rugcheck danger: ${d.name}`);

  if (s.lpLockedPct == null) warns.push("LP lock % unknown — verify manually on rugcheck.xyz");
  if (s.top10Pct == null) warns.push("holder concentration unknown — verify manually");
  if (s.ageHours != null && s.ageHours < RULES.minAgeHours)
    warns.push(`token only ${s.ageHours.toFixed(1)}h old — highest-risk window`);
  if (s.vol24h != null && s.liqUsd != null && s.liqUsd > 0 && s.vol24h / s.liqUsd > RULES.washVolLiqRatio)
    warns.push(`vol/liq ratio ${(s.vol24h / s.liqUsd).toFixed(1)}x — possible wash trading`);
  const warnRisks = (s.rugRisks || []).filter((r) => r.level === "warn");
  for (const w of warnRisks) warns.push(`rugcheck warn: ${w.name}`);

  return { pass: fails.length === 0, fails, warns };
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
  console.log(`top10 hold   ${s.top10Pct != null ? s.top10Pct.toFixed(1) + "%" : "n/a"}`);
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

async function cmdScan(fullCheckCap) {
  console.log("fetching trending + new pools from GeckoTerminal...");
  const pools = [
    ...(await fetchGeckoPools("trending_pools", 2)),
    ...(await fetchGeckoPools("new_pools", 3)),
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
    if (!Number.isFinite(liq) || liq < RULES.minLiquidityUsd) continue;
    candidates.set(mint, { name: a.name });
  }
  console.log(
    `${pools.length} pools seen → ${candidates.size} pass pre-filter (liq ≥ ${fmtUsd(RULES.minLiquidityUsd)}, not majors, not already journaled)`
  );

  const list = [...candidates.entries()].slice(0, fullCheckCap);
  if (candidates.size > list.length)
    console.log(`(full-checking first ${list.length} — raise with: node coin.js scan ${candidates.size})`);
  const passed = [];
  let i = 0;
  for (const [mint, meta] of list) {
    i++;
    process.stdout.write(`[${i}/${list.length}] ${(meta.name || mint.slice(0, 8)).padEnd(28)} `);
    try {
      const s = await buildSnapshot(mint);
      const verdict = runChecklist(s);
      console.log(verdict.pass ? "PASS ✓" : `skip (${verdict.fails[0] || "dead"})`);
      if (verdict.pass)
        passed.push({
          mint,
          symbol: s.symbol,
          name: s.name,
          liqUsd: s.liqUsd,
          vol24h: s.vol24h,
          ageHours: s.ageHours != null ? +s.ageHours.toFixed(1) : null,
          warns: verdict.warns,
          checkedAt: new Date().toISOString(),
        });
    } catch (e) {
      console.log(`error (${e.message})`);
    }
    await sleep(600); // be gentle to DexScreener + Rugcheck
  }

  // candidates.json = latest shortlist; scans.log = permanent history
  fs.writeFileSync(path.join(__dirname, "candidates.json"), JSON.stringify(passed, null, 2));
  fs.appendFileSync(
    path.join(__dirname, "scans.log"),
    `${new Date().toISOString()} scanned=${list.length} passed=${passed.length}` +
      (passed.length ? ` [${passed.map((p) => `${p.symbol}:${p.mint}`).join(" ")}]` : "") +
      "\n"
  );

  console.log(`\n${passed.length} candidate(s) → candidates.json`);
  for (const c of passed) {
    console.log(
      `  ${(c.symbol || "?").padEnd(10)} liq ${fmtUsd(c.liqUsd)}  vol24h ${fmtUsd(c.vol24h)}  age ${c.ageHours != null ? c.ageHours + "h" : "n/a"}  ${c.warns.length} warn(s)`
    );
    console.log(`    node coin.js check ${c.mint}`);
  }
  if (!passed.length)
    console.log("(normal — most new tokens are garbage; the filter is doing its job)");
  else
    console.log(`\nnext: manual checks (bundles/dev on gmgn.ai) → log every one you review, buy or skip`);
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

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "check":
      if (!args[0]) return console.error("usage: node coin.js check <mint>");
      return cmdCheck(args[0]);
    case "scan":
      return cmdScan(Math.max(1, Number(args[0]) || 20));
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
                                              survivors (default cap 20), shortlist → candidates.json
  node coin.js check <mint>                   run safety checklist on a token
  node coin.js log <mint> buy|skip "reason" [--src <channel>]
                                              record a decision (snapshot saved);
                                              --src tags where you found it (smartmoney, twitter, ...)
  node coin.js update                         record due 1d/7d/30d outcomes
  node coin.js stats                          returns, rug rate, vs SOL baseline
  node coin.js list                           list journal entries`);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
