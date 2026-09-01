# Coin — memecoin screener + journal + eval

Solana memecoin research system. Owner plays $10/position, short-term (hours to a
few days, exit at 2-5x). Zero-dependency Node CLI (`coin.js`), runs unattended on
GitHub Actions hourly (track → update → scan → commit → watch).

## หลักการสูงสุด: ยุติธรรม ซื่อสัตย์ (owner-stated 2026-09-01)

**Fair and honest — this outranks every other instruction in this file,
including the goal below.** The owner's words: "อย่ามโน อย่า bias ต้องยุติธรรม
ซื่อสัตย์ เพราะไม่อยากให้ AI มั่ว."

Real money is at stake and the owner cannot re-derive every number, so a
confident wrong answer costs more here than "I don't know". Concretely:

- **Never state a number you did not compute.** No recalled, interpolated, or
  plausible-sounding figures. If a claim needs data that is not in the repo,
  say the claim cannot be checked — do not reason your way to a number.
- **Report the result you got, not the one that helps.** A finding that
  embarrasses the previous session's work, or that kills a feature just built,
  gets stated exactly as plainly as a flattering one. Softening it is มโน too.
- **Say which convention a statistic uses** (one- vs two-tailed, which `rug`
  definition, which stratum, n in rows vs distinct mints vs events). A number
  quoted without its convention has already misled someone.
- **Distinguish verified from suspected**, always, in both directions. "I could
  not verify this" is a complete and acceptable answer.
- **Being corrected is a normal outcome, not a failure.** When a reviewer or
  the owner refutes something, check it and say plainly whether they are right.
  If they are wrong, show the computation — do not concede to be agreeable, and
  do not defend to save face. Both are dishonest.
- **Do not present work as finished when it is not**, and do not describe a
  change as serving the goal without measuring whether it does. The 2026-09-01
  intake fix was reported as good news and was measurably pointed at the wrong
  stratum — see STUDY.md.

## Goal (owner-stated 2026-08-27 — this is the point of the project)

**คัดเหรียญที่มีโอกาสพุ่งมาให้ซื้อ โดยเรียนรู้ pattern ของเหรียญที่เคยพุ่ง.**
Select coins with a real chance to pump, by learning the patterns of coins
that pumped — not coins that merely survive without growing. The safety
filter, the age/liquidity floors, and exit discipline exist to protect
capital *in service of that goal*; they are the floor, not the mission.

Honesty constraint that goes with it: as of 2026-09-02 no measured feature
reliably predicts pumps. One candidate is left standing: chg24h > 1000. Do not
quote a figure for it from this file — run `node coin.js patterns` and read the
tables, because every number written here has gone stale within days. What is
durable about it:

- it is the only feature that has held its direction under every split tried,
  including sampling density (the artifact that killed vol/liq >= 5, whose gate
  was deleted 2026-09-01);
- it is NOT multiplicity-clean — FWER-adjusted p = 0.116 over the grid actually
  searched — and roughly a dozen pumper rows carry the whole result;
- it selects a very high rug rate, and the exact figure depends on which rug
  definition you use (trough-based and d3-return-based differ by ~10pp — say
  which one you mean);
- **it has never been re-tested on new data.** The 2026-09-01 "re-confirmation"
  was a re-partition of the SAME rows by sampling density, not a replication:
  that day added 8 hot rows and 1 new pumper event. The project's own criterion
  (survives stratifying by `v.ef`) still cannot be applied, because the current
  entry-filter era has no d3 outcomes at all.
- **it lives where the alert gate cannot reach it** — see the architecture note
  below. Promoting it is not a threshold change.
The learning loop (tracking.json → `patterns` → RULES
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

Two more traps found 2026-09-01, both now printed by `patterns` itself:
the `pre-versioning` era is NOT one stratum (it spans hourly and 10-minute
polling — median samples/row 12 vs 258, so it is split sparse/dense in the
header), and a mint may now appear more than once (re-entry, below), so the
header prints distinct mints beside n. Rows sharing a mint are not independent.

## Architecture decisions (settled — don't relitigate)

- **No LLM in the decision pipeline.** Rules are deterministic if-else over
  on-chain numbers so every threshold change can be re-run against frozen
  snapshots. LLM's place: reading contract code (future), and the weekly
  analysis ritual below.
- **One notification gate, since 2026-09-01.** The parallel `momentum` track
  (`momMinVolLiq`, added 2026-08-27) was deleted by the kill condition it
  shipped with: at n=20 it had not beaten `PASS, quiet` on peak-2x (5.0% vs
  4.1%, p=0.65; 0/7 vs 1/20 on dense rows). It was NOT replaced with another
  live gate. The surviving pump candidate (`momMinChg24h`) has not cleared its
  own pre-registered bar, and buzzing the phone with it would be spending real
  money on that — the exact "loosening rules without data" this file forbids.
  The goal arm is now the `chg24h gate x age` table accumulating forward rows.
  The `safety` track caps downside; it does not predict winners and every
  measurement so far says it cannot. That is still not the mission.
- **Intake must keep collecting, and can silently stop.** Discovery dedupes
  against the archive, which on 2026-08-31 had absorbed all of `trending_pools`
  and left only the `new_pools` firehose — 30 consecutive rows with 0 PASS,
  while the screener still printed ~27 PASS candidates an hour that were all
  already archived. `RULES.reentryCooldownHours` (168h > the 72h d3 window) lets
  a mint be entered again as a separate observation, stamped `entryNo`;
  `patterns` keys on `mint#entryNo`. If PASS rows stop appearing in the current
  era, suspect the pipe before suspecting the market.
- **The alert gate is structurally late, and cannot reach the one live signal.**
  Measured 2026-09-02, and this is the most decision-relevant fact in the repo:
  `alertMaxChg24h: 100` only lets a token through once its pump has already
  decayed below +100%/24h, which is by construction after the move. Of the
  alerted tokens whose tracked path ever touched 2x, most were alerted AFTER
  their tracked peak; only about a third of the dataset's 2x events were ever
  alerted at all; and simulating the full `alertQualifies` predicate over every
  tracked row selects a handful of rows containing ZERO of the 2x events.
  Meanwhile the `chg24h > 1000` candidate is categorically disjoint from that
  gate (1000 > 100), and essentially none of the hot rows clear the age and
  liquidity floors under today's rules either. So promoting chg24h is NOT a
  threshold tweak: it would require dismantling both floors AND overriding a
  return-backed rule that was measured to stop us buying tops. Any proposal to
  promote it must say so in STUDY.md, in those terms, and price both sides.
  The gate is doing what it was built to do; the cost is that it is late.
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
- vol/liq > 10x is currently a wash-trade penalty; early evidence said it may
  be an attention signal on young tokens. Downgraded 2026-09-01: vol/liq showed
  no effect on densely-sampled rows, and median vol/liq at discovery drifted
  4.2 → 15.8, so any fixed threshold on it is measuring the feed, not the token.
- The entry floors cost ~2/3 of the pump population and buy ~all of the rug
  protection (dense rows: below floors 21.2% peak-2x / 49.5% rug, above 6.8% /
  1.7%, p=0.012). The age floor does both — not a candidate for loosening. The
  one cheap-looking cell is liq 30-50k at age >= 48h (15.4% peak-2x, 0/13 rug),
  n=13 and multiplicity-tainted. Watch it accumulate; do not act on it yet.

## Commands

`scan [cap]` · `check <mint>` · `log <mint> buy|skip "reason" [--src ch]` ·
`watch` (exit 1 = action needed) · `exit <mint> "reason"` · `track` ·
`patterns [h4|d1|d3]` · `update` · `stats` · `list` ·
`alert [--commit-sent]` (phone notification body; exit 3 = nothing to say)

## Style

- Owner is Thai; converse in Thai, keep technical terms in English.
- Code/comments/commits in English.
