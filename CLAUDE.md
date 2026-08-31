# Coin — memecoin screener + journal + eval

Solana memecoin research system. Owner plays $10/position, short-term (hours to a
few days, exit at 2-5x). Zero-dependency Node CLI (`coin.js`), runs unattended on
GitHub Actions hourly (track → update → scan → commit → watch).

## Goal (owner-stated 2026-08-27 — this is the point of the project)

**คัดเหรียญที่มีโอกาสพุ่งมาให้ซื้อ โดยเรียนรู้ pattern ของเหรียญที่เคยพุ่ง.**
Select coins with a real chance to pump, by learning the patterns of coins
that pumped — not coins that merely survive without growing. The safety
filter, the age/liquidity floors, and exit discipline exist to protect
capital *in service of that goal*; they are the floor, not the mission.

Honesty constraint that goes with it: as of 2026-08-31 no measured feature
reliably predicts pumps. Best candidates: chg24h > 1000 (peak-2x 27.5% n=40 vs
7.0% n=171) and vol/liq >= 5 (15.5% vs 7.6%) — neither is multiplicity-clean
(FWER-adjusted p = 0.116 over the threshold grid actually searched) and both
select 40-60% rug. The learning loop (tracking.json → `patterns` → RULES
changes logged in STUDY.md) is the mechanism for closing that gap. Never fake
progress toward the goal by loosening rules without data; never redefine the
goal back to "downside only" — the owner has explicitly rejected that framing.

**Before citing any `patterns` cell as evidence** (added 2026-08-31, after an
audit refuted that session's headline finding — full autopsy in STUDY.md):
`p.peakRet` is a sampled lower bound that rises with poll count, and `f.pass`
means different things in different eras because the thresholds moved. Every
row now carries `v: {ef, pollMin}`; `patterns` prints the era partition as its
header. A finding must report (a) how many pumpers carry it — the n that counts
is events, not rows, (b) an FWER-adjusted p if any threshold was searched,
(c) whether it survives stratifying by `v.ef` and by sample count. Cross-era
comparisons in the pre-2026-08-31 data are dead, not merely reweightable.

## Architecture decisions (settled — don't relitigate)

- **No LLM in the decision pipeline.** Rules are deterministic if-else over
  on-chain numbers so every threshold change can be re-run against frozen
  snapshots. LLM's place: reading contract code (future), and the weekly
  analysis ritual below.
- **Two tracks, one dataset.** The `momentum` track (added 2026-08-27,
  `momMinVolLiq`) is the track that serves the project goal: same safety
  verdict and age/liquidity floors, but selects on vol/liq (attention)
  instead of cleanliness. The `safety` track caps downside; it does not
  predict winners and every measurement so far says it cannot. Momentum is
  **unproven and paper-only** — `patterns` prints a `momentum gate` table;
  delete the gate if MOMENTUM has not beaten `PASS, quiet` on peak-2x by
  ~20-30 tokens, and replace it with a better pump-pattern candidate rather
  than abandoning the goal.
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
