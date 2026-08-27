# Coin — memecoin screener + journal + eval

Solana memecoin research system. Owner plays $10/position, short-term (hours to a
few days, exit at 2-5x). Zero-dependency Node CLI (`coin.js`), runs unattended on
GitHub Actions hourly (track → update → scan → commit → watch).

## Architecture decisions (settled — don't relitigate)

- **No LLM in the decision pipeline.** Rules are deterministic if-else over
  on-chain numbers so every threshold change can be re-run against frozen
  snapshots. LLM's place: reading contract code (future), and the weekly
  analysis ritual below.
- **Two tracks, one dataset.** The `safety` track caps downside; it does not
  predict winners and every measurement so far says it cannot. The `momentum`
  track (added 2026-08-27, `momMinVolLiq`) keeps the same safety verdict and
  age/liquidity floors but selects on vol/liq instead of cleanliness, because
  the owner wants candidates that can grow, not merely survive. It is
  **unproven and paper-only** — `patterns` prints a `momentum gate` table;
  delete the gate if MOMENTUM has not beaten `PASS, quiet` on peak-2x by
  ~20-30 tokens. Edge is still cutting garbage fast + exit discipline.
- **journal.json is ground truth** for human decisions; tracking.json is the
  auto-collected research dataset (every scanned token, PASS and FAIL, with
  outcomes at 4h/1d/3d). Never hand-edit either casually; both are committed.
- Cloud and local both write the repo: always `git pull --rebase` before
  logging locally, push right after.

## Weekly analysis ritual (owner will ask: "วิเคราะห์ journal/patterns ให้หน่อย")

1. `git pull`, then read `journal.json`, `tracking.json`, `STUDY.md`.
2. `node coin.js patterns d1` (and h4/d3) — which discovery profile pumps.
3. `node coin.js stats` — realized + paper returns vs SOL baseline,
   false-positive skips, per-source breakdown.
4. Cluster losses by failure mode; count; propose fixing the most frequent.
5. Any RULES change must cite data (patterns/stats output), one variable at a
   time, and get appended to STUDY.md with the date and evidence.

## Open questions the data must answer (see STUDY.md)

- Stop loss -50% may cut winners (observed -89%/-97% drawdowns *before* 30-90x
  peaks). Do not remove it without tracking data.
- vol/liq > 10x is currently a wash-trade penalty; early evidence says it may
  be an attention signal on young tokens. Let `patterns` decide.

## Commands

`scan [cap]` · `check <mint>` · `log <mint> buy|skip "reason" [--src ch]` ·
`watch` (exit 1 = action needed) · `exit <mint> "reason"` · `track` ·
`patterns [h4|d1|d3]` · `update` · `stats` · `list` ·
`alert [--commit-sent]` (phone notification body; exit 3 = nothing to say)

## Style

- Owner is Thai; converse in Thai, keep technical terms in English.
- Code/comments/commits in English.
