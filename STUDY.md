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
5. stop loss -50% ควรมีหรือไม่ควรมี? — **ตอบแล้ว 2026-08-27: เก็บไว้**

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

---

## 2026-08-27 — RULES change #2: minAgeHours 24 → 48 (soft warning → hard FAIL)

**Dataset:** tracking.json 158 แถว, 143 แถวมี path sampling (`p.samples>=3`)
ในนั้น 142 แถวมี final ret (ทุกตารางด้านล่างใช้ 142 แถวนี้)
journal.json **ยังว่าง** → ทุกอย่างเป็น paper ไม่ใช่ realized

**Method (ต่างจากรอบ #1 — บันทึกไว้กันอ่านผิด):** รอบ #1 clamp ret ที่ horizon
เข้าช่วง [-50%, +200%] รอบนี้ทำ **path-aware EV sim**: แตะ 2x (`peakRet>=1`)
→ ขายครึ่ง ที่เหลือ ride (`0.5 + 0.5*ret`) / `troughRet<=-0.5` → -50% /
ไม่งั้นใช้ ret ที่ horizon

`troughRet` **ไม่มี timestamp** (`r.p` เก็บแค่ `peakH`) → เรียงลำดับ TP/stop ไม่ได้
จึงรันสอง ordering: `EVtp` (TP ก่อน) และ `EVsl` (stop ก่อน) ทั้งชุด 142 แถวต่างกัน
แค่ -11.5% vs -12.0% และต่างกันเฉพาะ bucket `vl >30` กับ `a 6-24h`
→ ข้อสรุปไม่ขึ้นกับสมมติฐานนี้ **ตัวเลข EV ทุกตัวด้านล่างเป็น `EVtp`** เว้นที่ระบุเอง

### ขนาดของผล — ต้องคุม change #1 ก่อน

ฉบับร่างแรกของบันทึกนี้เทียบกับ baseline "PASS ทุกแถว" ซึ่ง **ผิด**: ใน 76 แถวนั้น
มี 20 แถวที่ `liqUsd < 50k` ซึ่ง `minLiquidityUsd` (change #1, ship ไปแล้ว) FAIL
ทิ้งอยู่แล้ว — และ 15 ใน 20 แถวนั้นก็ `<48h` ด้วย กลุ่มนั้น EV -33.6%
→ age floor ได้เครดิตของ liquidity floor ไปเต็มๆ

วัดใหม่แบบ **marginal** บน baseline ที่ใช้กฎที่ ship แล้ว:

```
PASS & liq>=50k    n      EV    rug%
  >= 0h           55   -10.7%    11%
  >= 24h          44    -9.8%     2%
  >= 48h          42    -7.9%     0%
  >= 72h          42    -7.9%     0%   (ไม่มี row ตกในช่วง 48-72h เลย)
```

ผลจริง **-10.7% → -7.9% (+2.8pp) ตัดออก 13 แถว** ไม่ใช่ +10.6pp อย่างที่ร่างแรกเขียน

**และครึ่ง EV นี้แยกทางสถิติไม่ออก:**
```
CUT  n=13  EV -19.8%  sd 67.6%  stderr 18.7%
KEEP n=42  EV  -7.9%  sd 21.3%  stderr  3.3%
```
~0.6σ และ 2 ใน 13 แถวที่ตัดคือ winner ที่ครองค่าเฉลี่ยของกลุ่มนั้นอยู่

**สิ่งที่ค้ำการเปลี่ยนนี้จริงๆ คือครึ่ง downside ไม่ใช่ EV** — rug 11% → 0%
และ rug gradient ที่ `patterns d1` โชว์เองโดยไม่ต้องใช้ script นอก:
```
<6h    n=12  rug 33%
6-24h  n=14  rug 36%
24-48h n= 7  rug 14%
>3d    n=89  rug  0%
```
ตรงกับ thesis ใน CLAUDE.md ("filter caps downside; nothing here predicts winners")
**ห้ามอ้างการเปลี่ยนนี้ว่าเป็นการเพิ่ม EV**

### ตัวเลขดิบ age bucket (ทั้ง 142 แถว ไม่คุม liquidity)

```
age at discovery      n    EVtp     EVsl   median   rug%
  <6h                17  -34.0%   -34.0%   -83.3%    41%
  6-24h              19  -26.1%   -29.8%   -60.2%    26%
  1-3d                7  -40.4%   -40.4%   -71.5%    14%
  3-14d              23   -8.7%    -8.7%   -15.6%     0%
  >14d               76   -1.0%    -1.0%    -3.5%     0%
```
ตารางนี้ **ปน confound liquidity** ใช้ดูทิศทางเท่านั้น
ตัวเลขที่ใช้ตัดสินใจคือตาราง marginal ด้านบน

เลือก **48h** ไม่ใช่ 72h เพราะไม่มี row ไหนตกในช่วง 48-72h ในชุดนี้ (ยืนยันซ้ำหลัง
เพิ่ม bucket `24-48h` ใน `patterns`: bucket `2-3d` ว่างเปล่า) → EV เท่ากันเป๊ะ
เอาค่าที่ตัดน้อยกว่าไว้ก่อน

**ต้นทุนที่นับเข้าไปแล้ว** — floor นี้ตัด winner จริงสองตัว:
`Polycat` (age 20.2h, peak +132%) และ `Pistacio` (age 2h, peak +543%)
ตัวเลข EV ข้างบนหักสองตัวนี้ออกแล้ว

**เงื่อนไขทบทวน:** ถ้าโซน <48h ให้ winner อีก 2-3 ตัว ให้กลับมาวัดใหม่ —
เช็คได้จาก bucket `<6h` / `6-24h` / `24-48h` ใน `node coin.js patterns d1` ตรงๆ

### สิ่งที่แก้ในโค้ด

**เปลี่ยน 1 ตัวแปรตามกฎ:** `minAgeHours` 24 → 48 และเลื่อนชั้นจาก warn + score
penalty เป็น **hard FAIL** ใน `runChecklist`

ผลพลอยได้ที่ต้องเก็บในการแก้เดียวกัน (ตัวแปรเดิมย้ายจาก soft → hard):
- ลบ warn `token only Xh old` — เงื่อนไขเดียวกับ fail ใหม่ ไม่มีทางถึง
- ลบ age penalty ใน `scoreCandidate` — call site ทั้งสองจุดอยู่หลัง `verdict.pass`
  (ยืนยันแล้ว: score ของ token age 50h กับ 1000h เท่ากัน)
- **วาง fail ใหม่ไว้ท้ายสุดของ `fails`** ไม่ใช่แทรกกลาง: `trackFeatures` เก็บแค่
  `fails[0]` ถ้าแทรกไว้ต้นๆ เหรียญที่ทั้งใหม่ทั้ง top10 หนาจะถูก relabel เป็น
  age failure → ทำให้ "cluster losses by failure mode" (CLAUDE.md ข้อ 4)
  เห็นขั้นบันไดปลอมตั้งแต่วันนี้เป็นต้นไป
- `alertQualifies` ใช้ `Math.max(alertMinAgeHours, minAgeHours)` แทนค่าคงที่เดิม
  **ไม่ใช่การจูน threshold แต่เป็นการปิดช่องจริง**: `candidates.json` ถูกเขียนใหม่
  เฉพาะตอน `scan` วิ่งจนจบ และ step นั้นเป็น `continue-on-error` → scan ที่พัง
  กลางทางทิ้งไฟล์รอบก่อนไว้ ซึ่งเป็นแถว PASS ที่เขียนด้วย floor เก่า guard 2h
  ไม่ช่วยเพราะ cron รายชั่วโมง (ตอนตรวจพบ `candidates.json` มี `Sky` 28.7h,
  `ASTRO` 31.6h, `SpaceCat` 29.2h, `fone` 2.8h ค้างอยู่จริง)
- `patterns` แยก bucket `1-3d` เป็น `24-48h` / `2-3d` เพื่อให้เงื่อนไขทบทวนข้างบน
  ตรวจได้จากคำสั่งที่ commit ไว้ ไม่ต้องพึ่ง script นอก repo

**ไม่ต้องมี `minTrackAgeHours` คู่กัน** (ต่างจาก change #1): scan pre-filter กรอง
ด้วย liquidity อย่างเดียว และ `tracking[mint]` ถูกเขียน**ก่อนและแยกจาก**
`if (verdict.pass)` → เหรียญอายุน้อยยังถูก full-check และ track ต่อในฐานะ FAIL
พร้อม features ครบ dataset ไม่หยุดเก็บหลักฐานที่จะใช้หักล้างการเปลี่ยนครั้งนี้

### ตอบคำถามข้อ 5 (stop loss -50%) — เก็บไว้

```
EV ทุกแถว (มี stop)            EVtp -11.5%   EVsl -12.0%
EV แถวเดียวกัน ตัด stop ออก              -15.7%
token ที่ลง -50% แล้วกลับมาแตะ 2x:  1 จาก 43
```

ความกังวลเดิมในบันทึกนี้ (เห็น -89%/-97% ก่อน 30-90x) **ไม่ถูก support** โดย
tracking dataset — เคสแบบนั้นมีจริง 1 เคส (`Martians`, trough -100% หลัง peak)
stop เป็นบวกสุทธิ ~+3.7pp ยังไม่ปิดถาวรเพราะ d3 ยังว่าง แต่ภาระพิสูจน์ย้ายไปฝั่ง
"จะเอา stop ออก" แล้ว

### ตอบคำถามข้อ 2 (vol/liq) — ยังตอบไม่ได้ + แก้ความเข้าใจผิดระหว่างทาง

```
vol/liq        n     EVtp    median   2x%   rug%
  <1          42    -1.8%     -3.5%    2%     2%
  1-3         26    -2.5%      3.2%    0%     0%
  3-5         10   -21.7%    -21.2%    0%     0%
  5-10        10   +10.3%     -7.2%   10%     0%
  10-30       30   -19.6%    -35.1%    6%    13%
  >30         24   -32.8%    -73.9%   13%    33%
```

ตัดหยาบเป็น `3-10x` จะเห็นเป็น "sweet spot" (win 20%) แต่พอตัดละเอียดมันแตกเป็น
สองฝั่งตรงข้ามที่ n=10 เท่ากัน — **artifact ของการเลือก bucket ไม่ใช่สัญญาณ**
และ n=10 ของ `5-10x` แทบเป็นแถวเดียวกับรอบ 2026-08-26 (n=10/4) คือ **ไม่โตขึ้นเลย**

ผลตามมา: ข้อเสนอ `alertMinVolLiq: 1 → 3` ที่คิดไว้ระหว่างวิเคราะห์ **ถอนออก** —
มันจะดันเข้า bucket `3-5x` ซึ่งเป็นหนึ่งใน bucket ที่แย่ที่สุด

### สิ่งที่ยังไม่ได้แก้ และต้องพูดตรงๆ

```
PASS  age>=72h   n=47   EV -6.2%
FAIL  age>=72h   n=52   EV +0.3%
```

คุมอายุแล้ว **FAIL ยังชนะ PASS** — safety filter ยังทำได้แค่ตัดของพัง ยังไม่ได้
เลือกของดี และ EV หลังแก้ยัง **ติดลบ** (-7.9%)
อย่าอ่าน change #2 ว่าระบบทำเงินได้แล้ว

### ข้อจำกัดของ eval รอบนี้

- dataset ทับกับรอบ 2026-08-26 → **ไม่ใช่การยืนยันอิสระ**
- **"final ret" ปน horizon**: 142 แถวฐานใช้ d1 122 / h4 20 และในชุดชี้ขาด
  (PASS & liq>=50k & >=48h, n=42) ใช้ d1 37 / h4 5 → ~1 ใน 8 เป็น return 4 ชม.
  ที่ถูกใช้แทน 24 ชม. ส่วน d3 ยังว่างทั้งหมด
- journal ยังว่าง → ไม่มี realized return, ไม่มี slippage/fee ในโมเดล
- `peakRet` เป็น lower bound (sample รายชั่วโมง) → EV ประเมินขา TP ต่ำกว่าจริง
- age เป็น observational ไม่ใช่ RCT — ยังไม่ได้คุม confound อื่นครบ
- 12 rows ที่มี h4 label drift (ดูบันทึก bug fix 2026-08-26) ยังปนอยู่ในชุดนี้
- `failReason` ของแถวที่เกิดหลังวันนี้เปลี่ยนความหมายเล็กน้อย แม้จะวาง fail ไว้
  ท้ายสุดแล้ว: เหรียญ <48h ที่ไม่ผิดกฎอื่นเลยจะขึ้น failReason เป็น age
  ซึ่งก่อนหน้านี้มันจะเป็น PASS
- **หนี้ reproducibility:** ตาราง EV ทั้งหมดในบันทึกนี้มาจาก script เฉพาะกิจที่ไม่ได้
  commit ไว้ `patterns` โชว์ median/rug/2x ได้แต่ไม่มี EV sim — ทิศทางตรวจซ้ำได้จาก
  `patterns d1` แต่ตัวเลข EV เป๊ะๆ ยังสร้างใหม่จากคำสั่งใน repo ไม่ได้
