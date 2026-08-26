# Pump Study — บันทึกการศึกษาตัวที่พุ่ง

> อัปเดตทุกครั้งที่วิเคราะห์ ข้อสรุปที่พิสูจน์แล้วค่อยย้ายไปเป็น RULES ใน coin.js

## รอบ 2026-08-24 — ตัวพุ่งแรงอายุ < 7 วัน (ข้อมูลจริงจาก OHLCV รายชั่วโมง)

ตัวที่เจอ (ทั้งหมดอยู่ใน scan ของเราแล้ว):

| เหรียญ | +24h | อายุตอนเจอ | peak | ตอนนี้ |
|---|---|---|---|---|
| GrokBot | +8,298% | 12h | - | - |
| Polycat | +980% | 20h | **31x ที่ชั่วโมง 15** | -62% จาก peak |
| TILLY | +932% | 6h | - | - |
| trickshot | +588% | 12h | - | - |
| CVXV666 | +555% | 29h | **92x ที่ชั่วโมง 17** | -37% จาก peak |

## สิ่งที่เรียนรู้ (n ยังน้อย — ต้องยืนยันด้วย tracking data)

**1. Pump เกิดชั่วโมง 10-20 ของอายุ pool ไม่ใช่นาทีแรก**
Polycat peak ชม.15, CVXV666 peak ชม.17 และ volume 3 ชม.แรกมีแค่ 3-4% ของทั้งหมด
→ **ไม่ต้อง snipe นาทีแรก** cron เจอทัน — ทั้งสองตัวอยู่ใน candidates.json ของเราก่อน peak จริง (CVXV666 score 73-77, Polycat 62)

**2. ทางขึ้นโหดมาก — shakeout ก่อน peak**
Polycat: drawdown **-89%** ระหว่างทางขึ้นก่อนถึง 31x
CVXV666: drawdown **-97%** ก่อนถึง 92x
→ **stop loss -50% แบบราคา จะเด้งเราออกจากตัวที่ชนะ** ทั้งสองตัว
→ ในเกมนี้ position size ($10) คือ stop loss ตัวจริง ไม่ใช่เส้นราคา
→ คำถามเปิด: ควรถอด/ผ่อน stopLossPct ใน watch ไหม — **รอ tracking data ตอบ อย่าเพิ่งแก้จากตัวอย่าง 2 ตัว**

**3. หลัง peak ร่วงเร็ว**
-62%, -37% จาก peak ภายในชั่วโมงถึงวัน → ยืนยัน exit rule "2x ขายครึ่ง" — ของแบบนี้ไม่รอใคร

**4. ตัวพุ่งไม่ได้หน้าตา "สะอาด"**
Polycat score 62 (vol/liq 84x), CVXV666 score 73 (vol/liq 58x) — wash-trade warn ทั้งคู่แต่พุ่งจริง
→ vol/liq สูงอาจเป็น **สัญญาณความสนใจ** ไม่ใช่แค่ wash — ให้ patterns table ตัดสิน

## คำถามที่ tracking dataset จะตอบ (สะสมอัตโนมัติทุกชั่วโมง)

1. อายุตอนเจอช่วงไหน (`<6h` / `6-24h` / `1-3d`) ให้ median return ดีสุด?
2. vol/liq สูง = สัญญาณพุ่ง หรือสัญญาณ rug กันแน่?
3. token ที่ FAIL filter พุ่งบ่อยแค่ไหน (ค่าเสียโอกาสของ filter)?
4. buy pressure 1h แรกทำนายอะไรได้ไหม?
5. stop loss -50% ควรมีหรือไม่ควรมี?

ดูคำตอบ: `node coin.js patterns d1` (รอข้อมูลสะสม ~1 สัปดาห์)

---

## 2026-08-26 — RULES change #1: minLiquidityUsd 30k → 50k

**Dataset:** tracking.json, n=138 tracked, 130 with h4 outcome, 30 with d1, 0 with d3.
journal.json ยังว่าง → ตัวเลขทั้งหมดเป็น paper ไม่ใช่ realized

**หลักฐาน** (`node coin.js patterns h4|d1` + cut เพิ่มเอง):

```
liquidity @h4        n     median   win%          liquidity @d1    n    median   rug%
  $30-50k            26    -28.2%    16%            $30-50k         7   -68.6%   29%
  $50-150k           39     -6.9%    ~30%           $50-150k        6   -21.8%    0%
  >$150k             65     -1.9%    37%            >$150k         17    -8.4%    0%
```

ทดสอบซ้ำด้วย EV sim ที่ clamp return เข้ากับ exit rules จริง (+200% take-profit /
-50% stop) เพื่อไม่ให้ median ลงโทษ tail ที่กลยุทธ์นี้กินอยู่แล้ว:

```
liq 30-50k   EV -22.3% @h4,  -44.4% @d1
liq >150k    EV  +0.5% @h4,   -0.4% @d1
```

โซน 30-50k ติดลบแม้ให้เครดิต winner เต็มที่ (ในโซนนี้มี +139% หนึ่งตัว, นับเข้าไปแล้ว)

**ข้อควรระวังที่บันทึกไว้:**
- fdv `<300k` ดูแย่พอกัน (median -25.6%@h4) แต่ **ไม่ใช่หลักฐานอิสระ** — overlap
  25/26 rows กับ liq `<50k` เป็น cluster เดียวกัน ห้ามนับเป็นสองสัญญาณ
- การขยับนี้ตัด winner จริงทิ้งหนึ่งตัว (liq 40k → +139%@h4) EV ยังคุ้มจึงเดินหน้า
  แต่ถ้าอนาคตโซนนี้ให้ winner อีก 2-3 ตัว ให้ทบทวนใหม่

**เปลี่ยน 1 ตัวแปรตามกฎ:** `minLiquidityUsd` 30000 → 50000 (verdict floor เท่านั้น)

แยก `minTrackLiquidityUsd: 30000` ออกมาเป็น scan pre-filter ต่างหาก โดยเจตนา:
โซน 30-50k **ยังถูก scan/score/track ต่อ** (ในฐานะ FAIL) ไม่งั้น dataset จะหยุด
เก็บหลักฐานที่ใช้หักล้างการเปลี่ยนครั้งนี้ในอนาคต

**ผลถ้า re-label dataset เดิมด้วย floor ใหม่** (4/15 PASS ถูกลดชั้น):
```
PASS @d1  floor เดิม:  median -39.4%  rug 27%  (n=15)
PASS @d1  floor ใหม่:  median -23.5%  rug 18%  (n=11)
```
ดีขึ้นแต่ **ยังแย่กว่า FAIL** (-7.9%, rug 0%) — filter ยังไม่ได้เลือกของดี
อย่าอ่านการเปลี่ยนนี้ว่าแก้ปัญหาแล้ว

**ยังไม่แก้ (หลักฐานไม่พอ):**
- vol/liq: bucket 5-10x เป็นกลุ่มเดียวที่ EV บวก (+14.9%@h4, +15.5%@d1) แต่ n=10/4
  ยังแยก signal จาก noise ไม่ได้ — และ `washVolLiqRatio: 10` ลงโทษ *เหนือ* 10x
  อยู่แล้ว จึงไม่ได้ทำร้ายช่วงนี้ ตอบข้อ 2 ข้างบนยังไม่ได้
- insiderPct `>15%` ให้ 2x+ 20% / rug 0% @d1 ซึ่งขัดทิศทาง `maxInsiderPct` — n เล็ก จับตาต่อ
- buy/sell 1h ไม่มีสัญญาณ ทุก bucket -2% ถึง -5% เท่ากันหมด (ตอบข้อ 4: ไม่ได้)

## 2026-08-26 — เพิ่ม peak/trough sampling (ตอบข้อ 5 ได้เป็นครั้งแรก)

**ช่องโหว่:** tracking เก็บแค่ ret ณ snapshot h4/d1/d3 → **path-blind**
token ที่โชว์ -99%@d1 อาจแตะ 3x ระหว่างทาง แต่กลยุทธ์คือ exit 2-5x ไม่ใช่ hold ถึง d1
บันทึกด้านบนเองก็เจอ -89%/-97% ก่อน 31x/92x → **คำถามข้อ 5 (stop loss -50%)
และ takeProfitX ตอบไม่ได้เลยด้วยข้อมูลที่เก็บอยู่** และย้อนเก็บไม่ได้

**แก้:** `cmdTrack` เปลี่ยนจาก poll เฉพาะแถวที่มี bucket ครบกำหนด → poll **ทุกแถว
ที่ยังไม่ archive ทุกรอบ cron** (รายชั่วโมง) แล้วเก็บ `r.p = {peakRet, troughRet,
peakH, samples}`

ข้อจำกัดที่ต้องจำ: sample รายชั่วโมง → **`peakRet` เป็น lower bound** ของ exit ที่ดี
ที่สุดที่มีจริง ไม่ใช่ค่าแท้ อย่าเอาไปคำนวณผลตอบแทนตรงๆ

`patterns` เพิ่ม section "path": median peak, กี่ตัวแตะ 2x แล้วคืนหมด,
และกี่ตัวที่ทะลุ -50% ลงไปก่อนแล้วค่อยแตะ 2x (= ต้นทุนของ stop loss)
เงียบไว้จนกว่าจะมีข้อมูล — แถวเก่าไม่มี `r.p`

## 2026-08-26 — bug fix: h4 label drift

12/130 rows ติด label `h4` ทั้งที่วัดจริงที่ 6-8.7h (max 8.7h) เพราะ `cmdTrack`
ไม่มี missed-window guard แบบที่ `updateOutcomes` มีอยู่แล้วสำหรับ journal —
รอบ cron ที่ GitHub skip ทำให้อ่านค่าช้าแต่ยังบันทึกใต้ bucket เดิม

แก้: `elapsedH > h * 1.5` → บันทึก `{missed: true}` แทน (patterns กรองออกอยู่แล้ว
เพราะเช็ค `Number.isFinite(ret)`) ตอนนี้ cron เป็นรายชั่วโมง drift จะเหลือ ~1-2h

**หมายเหตุ:** ตัวเลข h4 ทั้งหมดที่อ้างในบันทึกวันนี้เก็บ*ก่อน* guard นี้ จึงยังมี
12 rows ที่ปนอยู่ — ทิศทางไม่น่าเปลี่ยน แต่ให้ re-run เทียบเมื่อ dataset สะอาดโตพอ

## 2026-08-26 — alert gate (notification path) — ยังไม่มีหลักฐานรองรับ

**บันทึกย้อนหลัง** — วันนี้เพิ่ม RULES 10 ตัวรวดเดียวโดยไม่ได้ลง STUDY.md ผิดกฎ
"cite data, one variable at a time" ใน CLAUDE.md ที่ตั้งไว้เอง ตัวนี้คือการชดใช้

**บริบท:** ต้องการแจ้งเตือนเข้ามือถือ ลองเมลก่อน → เข้า spam ไม่เด้ง เปลี่ยนเป็น
`node coin.js alert` → GitHub issue assign → GitHub app push (ใช้ได้จริง issue #1)

`alert` เป็นเลขคณิตล้วนบน candidates.json ไม่มี LLM — ตรงกับ "No LLM in the
decision pipeline" และ output จบด้วยคำสั่ง `log` เสมอ คนยังตัดสินใจเอง

**RULES ที่เพิ่ม แบ่งตามว่ามีหลักฐานไหม:**

| key | ค่า | หลักฐาน |
|---|---|---|
| `alertMaxChg24h` | 100 | ✅ chg24h >100% → median -64.8% @d1 (n=11) |
| `alertMinChg24h` | -50 | ✅ chg24h <-50% → median -21.2%, winner 0% @d1 (n=4) |
| `alertMinAgeHours` | 24 | ✅ bucket <6h/6-24h rug 38%, median -43% @d1 |
| `alertMinScore` | 80 | ❌ **ขัดหลักฐาน** — ดูด้านล่าง |
| `alertMaxInsiderPct` | 5 | ❌ **ขัดหลักฐาน** — ดูด้านล่าง |
| `alertMaxFdv` | 1.5M | ⚠️ เดา (ต้องการ headroom ให้ 2x ไม่ใช่ผลจาก data) |
| `alertMinVolLiq` | 1 | ⚠️ liveness ไม่ใช่ return signal — ตัด token ตาย (vol/liq 0.4x) |
| `alertCooldownHours` | 72 | ⚠️ กันสแปม ไม่เกี่ยวกับ return |
| `alertPullbackChg24h` | 30 | ⚠️ heuristic ของ entry line |
| `alertDowntrendChg6h` | -10 | ⚠️ heuristic ของ entry line |

**สองตัวที่ขัดหลักฐานตัวเอง** (`patterns d1`, n=31):
```
safety score  80-100  n= 9  median -32.2%  2x+  0%  rug 33%
              FAIL    n=16  median  -6.8%  2x+ 13%  rug  0%
insider %     <5%     n=16  median -26.7%  2x+  0%  rug 25%
              >15%    n=11  median  -5.6%  2x+ 18%  rug  0%
```
`alertMinScore: 80` และ `alertMaxInsiderPct: 5` เลือก cell ที่**แย่ที่สุด**ทั้งคู่

เก็บไว้ในฐานะ **noise control** (กันเตือนเรื่องขยะ) ไม่ใช่ตัวทำนาย return —
n=31 เล็กมากและน่าจะ confounded (PASS เอียงไปหา token อายุน้อย fdv เล็ก) แต่
**ห้ามอ่านว่า "score สูง = ดี"** จนกว่า d3 จะมีข้อมูลพอ

**คำถามเปิดข้อใหม่:** ถ้า d3 ยังยืนยันว่า insider >15% ทำได้ดีกว่า <5%
→ `maxInsiderPct` ทั้งระบบอาจผิดทิศ ไม่ใช่แค่ alert gate

**หนี้ที่รู้ตัว (แก้ทีหลังได้):**
- `patterns` verdict table ผสม PASS สองนิยาม — row ก่อน 2026-08-26 ใช้ floor 30k
  หลังจากนั้น 50k ยังไม่มี marker แยก (แก้ offline ได้เพราะเก็บ `f.liqUsd` ไว้)
- ถ้า push ล้มครบ 3 ครั้งหลังสร้าง issue สำเร็จ → `alerts-sent.json` ไม่ขึ้น origin
  → รอบหน้าเตือนซ้ำ 1 ใบ (ทางกลับกัน issue สร้างไม่สำเร็จ handle ถูกแล้ว)
- `alertMinVolLiq: 1` วัดผลจริงแล้วตัดออกแค่ 1 จาก 37 row — ตั้งชื่อว่า
  "tightening" แต่แทบไม่ได้ tighten อะไร
