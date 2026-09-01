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
2. vol/liq สูง = สัญญาณพุ่ง หรือสัญญาณ rug กันแน่? — **ยังไม่ปิด แต่ change #3 เดิมพันกับฝั่ง "สัญญาณพุ่ง" แบบ paper**
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

---

## 2026-08-27 — RULES change #3: momentum track (`momMinVolLiq: 5`)

**นี่ไม่ใช่การจูน threshold แต่เป็นการขยาย thesis ของโปรเจค** เจ้าของบอกตรงๆ ว่า
อยากได้เหรียญที่ *มีโอกาสพุ่ง* ไม่ใช่เหรียญที่ *ไม่ตายแต่ไม่โต* — และ data
ยืนยันว่าที่ผ่านมาระบบให้อย่างหลังจริง

### ทำไมของเดิมให้ตัวที่ไม่โต

ทุกอย่างที่วัดได้จนถึงวันนี้เป็น downside ล้วน ไม่มีตัวแปรไหนแยก winner ออกมาได้:

```
PASS  age>=72h   EV -6.2%
FAIL  age>=72h   EV +0.3%
```

15 ตัวที่ peak>=50% กระจายทั่วทุก bucket ทั้ง PASS ทั้ง FAIL score 59-95
อายุ 2h ถึง 19,606h — safety score ไม่ได้ทำนายอะไรเลย

และ alert gate เดิมกัน profile ที่พุ่งออกอย่างเป็นระบบ:
- `washVolLiqRatio: 10` หักคะแนน vol/liq สูง → Sue score 67, Polycat 62
- `alertMinScore: 80` เลยกรองพวกนี้ทิ้ง — **ตัวที่พุ่งไม่เคยถูกเตือนเลยสักตัว**
- `alertMaxChg24h: 100` ตัด already-pumped ซึ่งเป็น 5 ใน 7 ของตัวที่ hit 2x

### หลักฐาน

feature เดียวที่แยกได้ในระดับบนสุด (n=145, win = `peakRet >= 1`):

```
vol/liq >= 5   n=66  hit2x 9%        vol/liq < 5   n=79  hit2x 1%
```

**แต่บน cut ที่ gate นี้ตัดจริง** (บังคับ safety PASS ด้วย ซึ่งบรรทัดบนไม่ได้บังคับ)
n เล็กลงมากและ **ยังไม่รองรับ gate**:

```
MOMENTUM     n=13  peak-2x 1 (PANTS +271%)  d1 median -18.2%  rug 0%
PASS, quiet  n=29  peak-2x 0                d1 median  -9.0%  rug 0%
```

**1 ใน 13 เทียบ 0 ใน 29 ไม่ใช่ผลลัพธ์** และบน d1 return ฝั่งที่เลือกยัง**แย่กว่า**
เคสทั้งหมดยืนอยู่บน peak path (ซึ่งเป็นสิ่งที่ exit 2-5x ขายเข้าไปจริง) ของ token ตัวเดียว

**ทำไมยัง ship ทั้งที่หลักฐานอ่อน:** safety track ไม่มีทางเก็บ forward sample ของ
profile นี้ได้เอง — ไม่ปล่อยให้มันยิงก่อน ก็จะไม่มีข้อมูลมาเถียงกันตลอดไป
ต้นทุนของการผิดคือ attention ไม่ใช่เงิน (paper only)

### สิ่งที่แก้

**ตัวแปรใหม่ตัวเดียว:** `momMinVolLiq: 5` — floor liq/อายุ, cooldown, freshness
และ safety verdict ใช้ของเดิมทั้งหมด

`momentumQualifies` เก็บ hard floor ครบ แล้ว **ทิ้ง** `alertMinScore` /
`alertMaxInsiderPct` / `alertMaxFdv` / chg24h band — 4 ตัวที่กันตัวพุ่งออก
**ไม่ใช่การผ่อน `alertQualifies`** เป็น gate คนละตัวที่วิ่งขนาน

- dedup ใช้ `alerts-sent.json` ร่วมกัน (โทรศัพท์เครื่องเดียว mint เดียว = buzz เดียว)
- ตัวที่ผ่านทั้งสอง gate รายงานครั้งเดียวใต้ safety (คำแนะนำเข้าซื้อ conservative กว่า)
- `alert` exit 3 เมื่อ **ทั้งสอง** gate ว่างเท่านั้น
- `patterns` เพิ่มตาราง `momentum gate` ที่ตัดตรงกับ gate เป๊ะ → **สิ่งที่ตัดสินชะตา
  track นี้เป็นคำสั่งที่ commit ไว้แล้ว** ไม่ใช่ script นอก repo (เก็บหนี้
  reproducibility ที่ค้างจาก change #2 ไปด้วยบางส่วน)

### ไม่ชนกับ change #2

winner ของ profile นี้เป็น **second-wave pump บน pool ที่ตั้งตัวแล้ว** ไม่ใช่ launch snipe:
`PANTS` 131h (+271%), `Sue` 586h (+293%), `Zoe` 189h (+275%)
→ age floor 48h ไม่ได้ตัดอะไรของ momentum track เลย

เทียบสองฝั่งของ floor บน cut เดียวกัน (ยังไม่บังคับ PASS, n ใหญ่กว่า):
```
vl>=5 & liq>=50k & age>=48h   n=21  hit2x 10%  peak50 24%  rug  0%
vl>=5 & liq>=50k & age<48h    n=18  hit2x 11%  peak50 17%  rug 33%
```
hit rate เท่ากัน แต่ฝั่งแก่กว่า rug 0% → เลือกฝั่งที่ไม่ต้องแลกกับ rug

### เงื่อนไขฆ่าทิ้ง (เขียนไว้ใน CLAUDE.md ด้วย)

**paper only** จนกว่าตาราง `momentum gate` ใน `node coin.js patterns d3` จะสะสม
MOMENTUM ได้ 20-30 ตัว — ถ้าถึงตอนนั้น MOMENTUM ยังไม่ชนะ `PASS, quiet` บน `lifePk2x`
**ให้ลบ gate นี้ทิ้ง** ไม่ใช่จูน `momMinVolLiq` หนีไปเรื่อยๆ

> แก้ 2026-08-28: อ่านที่ **d3** เท่านั้น (ที่ d1 หน้าต่าง peak กับหน้าต่าง return
> ไม่ทับกัน) metric ชื่อ `lifePk2x` แล้ว และ `lifePk50` เป็นบริบท **ไม่ใช่เกณฑ์
> success** ถ้าเช็คพอยต์มาถึงแล้ว underpowered (p~0.49 ที่ 2-vs-0) ผลคือ
> "inconclusive เก็บต่อ" หรือ "ฆ่าเพราะไม่มีหลักฐาน" — เจ้าของตัดสิน

### ข้อจำกัด

- 10% hit rate ไม่ได้แปลว่า EV บวก — ถ้าอีก 90% เฉลี่ย -20% ก็ยังขาดทุน
  ยังไม่ได้รัน EV sim บน cut นี้เพราะ n=13 เล็กเกินกว่าจะมีความหมาย
- `vol/liq` ยังเป็นคำถามเปิดข้อ 2 ที่ **ยังตอบไม่ได้** (ดูบันทึก change #2:
  bucket 3-5x กับ 5-10x ให้ผลตรงข้ามกันที่ n=10 เท่ากัน) gate นี้ใช้เส้น 5x
  ซึ่งอยู่ตรงรอยต่อนั้นพอดี — เป็นเหตุผลเพิ่มอีกข้อว่าทำไมต้อง paper ก่อน
- momentum ยิง 6 ตัวในรอบแรก (จาก 29 candidates) — ถ้าดังเกินไปให้ขยับ
  `momMinVolLiq` ขึ้น **หลังจาก**มี data ไม่ใช่เพราะรำคาญ
- ทุกอย่างยัง paper: journal.json ยังว่าง d3 ยังว่าง

---

## 2026-08-28 — เครื่องมือ: ทำให้ loop "มองเห็น pump" ได้จริง (ไม่ใช่ RULES change)

**ไม่มี threshold ไหนเปลี่ยนในรอบนี้** ทั้งหมดเป็นการซ่อมเครื่องมือวัด + เก็บ data
เพิ่ม หลัง audit (read-only, 2026-08-27) สรุปว่า *"learning loop เดินถูกทาง แต่
instrument ปัจจุบันมองไม่เห็น pump"*

commits: `5bbc4f2` `823e7f1` `cf714a7` `ac61dbb` `4de2214`

### 1. เครื่องมือตัดสินใจวัดผิดตัว (severe — เกือบฆ่า gate ด้วยเลขผิด)

เงื่อนไขฆ่า momentum gate คือ **peak-2x** แต่ทุกตารางใน `patterns` รายงานแค่ ret
ที่ horizon ตายตัว → `PANTS` ซึ่งเป็น hit เดียวที่ track มี peak +271% ที่ **h54.3**
ซึ่งอยู่นอกหน้าต่าง d1 ตาราง MOMENTUM เลยอ่านว่า `2x+ 0%`

**ถ้ารันคำสั่งที่ commit ไว้ตอนถึงเช็คพอยต์ 20-30 ตัว มันจะบอกให้ฆ่า gate ทิ้ง
ด้วย metric ที่ไม่มีใครเลือก**

แก้: `table()` เก็บ row แทน ret แล้วเพิ่มคอลัมน์ peak ต่อ cell คอลัมน์เดิม
(n/median/2x+/rug) คำนวณจาก row ชุดเดียวกัน **ตัวเลขไม่ขยับสักตัว** (verify ด้วยการ
checkout ไฟล์เก่าไป temp แล้ว diff output ทั้ง h4/d1/d3)

เพิ่ม `troughH` คู่กับ `peakH` ด้วย — change #2 ต้อง bracket EV sim สองรอบเพราะ
trough ไม่มี timestamp ตอนนี้มีแล้ว

### 2. คอลัมน์ peak ที่เพิ่งเพิ่ม **ก็ผิดเอง** — reviewer จับได้

ตั้งชื่อ `pk2x`/`pk50` แล้วพิมพ์ใต้หัวตาราง `outcome @ d1` ซึ่งอ่านว่า
"peak ภายใน 24 ชม." แต่จริงๆ `peakRet` สะสมตลอดชีวิตที่ track:

```
19 แถวที่ติด pk50 → peak หลัง h4:  19/19 (ทั้งหมด)
                    peak หลัง h24: 11/19
```

และมี error ตัวที่สองที่ร้ายกว่า: **peak sampling เพิ่ง ship 2026-08-26** แถวเก่ารู้
peak เฉพาะช่วงชีวิตที่ถูกมองเห็น (`samples` 3-8) → **cell ที่บังเอิญมีแถวเก่ากว่า
ได้คะแนน peak สูงกว่าฟรีๆ** ซึ่งทำให้การเทียบ MOMENTUM กับ PASS, quiet ตอนเช็คพอยต์
เพี้ยนโดยตรง

แก้: เปลี่ยนชื่อเป็น `lifePk2x` / `lifePk50` ให้ชื่อบอกหน้าต่างเอง + เขียน error
ทั้งสองแบบไว้ในโค้ด + **เทียบ cell ได้เฉพาะที่ d3** เท่านั้น (ตรงกับที่ path section
เดิมทำอยู่แล้ว)

### 3. เลข Fisher ที่ผมใช้ pre-register metric รอง **ผิด ~5 เท่า**

คอมเมนต์เดิมเขียนว่า 2-vs-0 ที่ 20-30 tokens ได้ p ~ 0.1 จึงเพิ่ม pk50 เป็น
co-primary คำนวณจริง:

```
20 vs 20  two-tailed p = 0.487
25 vs 25               = 0.490
30 vs 30               = 0.492
13 vs 29 (cell วันนี้)   = 0.091   <- เลข 0.1 มาจากตรงนี้ ไม่ใช่เช็คพอยต์
```

และตรรกะกลับหัว: p ≈ 0.49 แปลว่า **เช็คพอยต์ underpowered** ไม่ใช่ว่า "เพิ่ม metric
ที่สองแล้วจะแก้ได้" — metric ที่สองที่ประกาศ success ได้เองมีแต่จะ**เพิ่ม
false-positive rate ของการทดสอบฆ่า gate**

แก้: `lifePk50` เป็น descriptive context **ไม่ใช่เกณฑ์ success** gate ที่ตกที่
`lifePk2x` จะไม่ถูกช่วยด้วย `lifePk50` ถ้าเช็คพอยต์มาถึงแล้วยัง underpowered
ผลลัพธ์ที่ถูกคือ "inconclusive เก็บต่อ" หรือ "ฆ่าเพราะไม่มีหลักฐาน" — เจ้าของตัดสิน
ไม่ใช่หยิบเลขที่หน้าตาดีกว่ามาใช้

> **บทเรียนที่ต้องจำ:** นี่เป็นครั้งที่ 3 ในโปรเจคนี้ที่ effect size ถูกอ้างเกินจริง
> (change #2 +10.6pp → จริง +2.8pp, change #3 n=21/10% → จริง n=13/1-of-13, และรอบนี้
> Fisher 0.1 → จริง 0.49) ทุกครั้งพลาดไปทาง**เข้าข้างสิ่งที่กำลังจะ ship**
> ทุกครั้งจับได้โดย reviewer อิสระ ไม่ใช่โดยคนเขียน → **ห้ามข้าม review step**

### 4. เก็บ attention path (ตัวแก้ปัญหารากที่สุด)

pump คือ **การเปลี่ยนแปลงของความสนใจตามเวลา** แต่ dataset เก็บ snapshot นิ่งจุดเดียว
ต่อ token + path ที่มีแต่ราคา ทั้งที่ response ของ poll รายชั่วโมงมี volume/txns
ติดมาทุกครั้งแล้วถูกทิ้ง

เพิ่ม `r.s` ต่อ sample: `{h, ret, liq, v1, b1, s1, c5, v5, b5, s5}` — **0 API call เพิ่ม**
(รอบแรกเก็บแค่ h1 ซึ่ง reviewer ชี้ว่าขัดกับเหตุผลของตัวเอง: sampling รายชั่วโมง +
aggregate รายชั่วโมง = burst ถูกเกลี่ยหายพอดี จึงเพิ่ม 5m เข้าไป)

discovery เพิ่ม `chg5m/vol5m/buys5m/sells5m` (แยก "ความสนใจกำลังมา" จาก vol24h ที่
เหลือจากขามาแล้ว — จุดอ่อนที่รู้ตัวของ vol/liq), `creator` (ไว้ทำ repeat-dev history),
`solPriceUsd` (market regime control ที่ถูกที่สุด — fetch มาแล้วแต่ทิ้ง)

**ข้อจำกัด:** `f` ของแถวที่ track แล้วเป็น immutable (ถูกต้อง) → field ใหม่ขึ้นเฉพาะ
mint ที่เพิ่งเจอ ตอนนี้ **2 จาก 152 แถว** ต้องรอ ~2 สัปดาห์ถึงจะครอบคลุมพอใช้วิเคราะห์
และ **ยังไม่มีโค้ดไหนอ่าน `r.s` เลย** — เก็บก่อนวิเคราะห์ทีหลัง เพราะ history
ย้อนเก็บไม่ได้

### 5. ราคาของ safety-PASS ต่อเป้าหมาย — เห็นเป็นตัวเลขครั้งแรก

audit นับว่า safety-PASS ตัด pumper ที่มี attention ทิ้ง 5 จาก 12 ตัว ตารางเดิมยัด
FAIL ทั้งหมดไว้ bucket เดียว → มองไม่เห็นราคาที่จ่าย

ตัดใหม่: floors (liq/อายุ) ใช้กับทุกแถว**ก่อน** แล้ว safety verdict ค่อยผ่าแต่ละ
attention cell → cell เทียบกันได้แบบ like-with-like

```
@d1                  n    median   2x+  rug  lifePk2x lifePk50
below floors        51   -68.6%    4%  29%      10%      14%
MOMENTUM, not-PASS   8   -28.6%   25%   0%      13%      38%
FAIL, quiet         42    -3.0%    2%   0%       2%       7%
MOMENTUM            13   -18.2%    0%   0%       8%      15%
PASS, quiet         29    -9.0%    0%   0%       0%      10%
```

**cell ที่ระบบโยนทิ้งอยู่ นำทุก pump metric ที่ rug 0%**

**อ่านด้วยความระวัง (reviewer เตือนไว้ ถูกต้อง):**
- `lifePk2x 13%` = **1 ตัวจาก 8**, `2x+ 25%` = 2 จาก 8, `rug 0%` ที่ n=8 มีขอบบน 95%
  อยู่แถว 37% — ประโยค "นำทุก pump metric" จะถูกยกไปอ้างต่อโดยไม่มี n ติดไป
- คำว่า "ตัด pumper 5 ตัว" นับ +73%/+82% เป็น pump ด้วย ทั้งที่เกณฑ์ของโปรเจคเอง
  คือ **peak-2x** → ใต้เกณฑ์ตัวเอง list สั้นกว่า 5 และ 2 ใน 5 (`sus`, `Martians`)
  ตกไป `below floors` เพราะอายุ <48h ไม่ได้อยู่ใน cell นี้ด้วยซ้ำ → เห็นจริงมากสุด 3
- "anomaly ยืนมา 3 รอบวิเคราะห์" = ข้อมูล ~143 แถวชุดเดิมถูกมองซ้ำ 3 ครั้ง
  **ไม่ใช่การยืนยัน 3 ครั้ง**

**ผลข้างเคียงที่ต้องรู้:** floors-first แปลว่าตารางนี้มองไม่เห็น "pumper อายุน้อย"
เป็นกลุ่ม — ต้นทุนของ age floor ยังพับอยู่ใน `below floors` (median -68.6% rug 29%
แต่ lifePk2x 10%)

### 6. cron หลุด cadence เงียบๆ

`scanGapHours()` + mark บรรทัด scans.log ที่ตามหลังความเงียบ >3h + warn ลง stderr
ให้เห็นใน Action log ไม่เปลี่ยน exit code (gap คือ note ไม่ใช่ failure)

**บั๊กที่เจอตอนตรวจ:** marker เวอร์ชันแรกวาง**หน้า** timestamp → `scanGapHours` อ่าน
token แรกเป็นวันที่ไม่ได้ → คืน null → **gap ครั้งเดียวทำให้ detector ตาบอดถาวร**
คือพังตรงจังหวะที่เพิ่งเริ่มจำเป็น แก้ให้ timestamp อยู่หน้าเสมอ + `t6.js` ล็อกไว้

**แก้ประวัติที่ commit message ของ `ac61dbb` เขียนผิด:** cadence จริงไม่ใช่
"near-hourly จนถึง 08-26" — 08-24/08-25 เป็น ~4-hourly และมีรู **22.6h** ก่อนหน้านั้น

```
08-23 16:45 -> 08-24 15:21   22.6h
08-24/08-25                  3.3-4.8h หลายครั้ง
08-26                        2.7h, 2.7h, 5.2h, 10.8h
08-27 13:39 -> 17:13          3.6h
```

→ marker >3h จะดังบ่อย ไม่ใช่นานๆ ครั้ง และ **peakRet หลวมกว่าที่บันทึกก่อนหน้านี้
สมมติไว้มาก** (ยิ่งย้ำข้อ 2) การรัน `scan` ด้วยมือบนเครื่องก็ append log เดียวกัน →
กลบ cron outage ได้

### 7. Data integrity — ตรวจแล้วสะอาด

reviewer reconstruct row ทั้งหมด (live + archive) ที่ `da6215a` เทียบ `HEAD`:

```
rows 166 -> 168 | หายไป 0 | firstSeenAt เปลี่ยน 0
f เปลี่ยน 0 | outcome ถูกทับ 0 | peakRet ถอยหลัง 0 | แถวใหม่ไม่มี f 0
```

`archiveFinished` append ก่อน delete และรับ row shape ที่ใหญ่ขึ้นได้
ไม่มี reader ไหน assume field ใหม่ `candidates.json` **ไม่ได้**รับ field ใหม่ →
พิสูจน์ว่า alert path ไม่ถูกกระทบ (ยิงชุดเดิมเป๊ะ: BREAKING, TOADS, Martians, App)

**ขนาดไฟล์ (วัดจริง ไม่ใช่ประมาณ):**
```
1 sample (indent 1)  93 B   | compact 57 B
1 row เต็ม 72 samples 7.5 KB
tracking.json ตอนนี้ 150 KB -> ~1 MB ตอน path เต็ม
archive โต ~170 KB/วัน = ~5 MB/เดือน, ~60 MB/ปี  (unbounded, commit ทุกชั่วโมง)
```
ไม่เป็นปัญหาในระดับสัปดาห์ ระดับเดือนต้องตัดสินใจ — คันโยกที่ถูกที่สุดคือถอด
`indent 1` ออกจาก `saveTracking` (93 B -> 57 B, ลด 39% ของเทอมหลัก) หรือ rotate
archive รายเดือน cap 100 samples ขนาดกำลังดี (row เห็น ~72 poll)

### สถานะเทียบกับเป้าหมายโปรเจค

audit ตัดสิน: **"บางส่วน — learning loop ไล่ตามเป้าจริง แต่ instrument ยังมองไม่เห็น
pump"** รอบนี้แก้ instrument กับการเก็บ data ยังไม่ได้แก้เรื่องที่ใหญ่กว่า:

- ยังไม่มีอะไรอ่าน `r.s` — ครึ่งวิเคราะห์ของเป้าหมายยังไม่ได้เขียน
- gate ปัจจุบัน recall pumper จริงได้ 1 ใน 7 (14%) — `vol/liq>=5` อย่างเดียวได้ 6/7
  ตัวที่ฆ่า recall คือ safety-PASS กับ floors
- `journal.json` ยังว่าง 0 entries ต่อ alert ที่ยิงไปแล้ว 11 ใบ → ครึ่งมนุษย์ของ loop
  ยังไม่เคยถูกใช้ ทุกตัวเลขในบันทึกทั้งหมดยังเป็น paper
- d3 เพิ่งเริ่มมีข้อมูลวันนี้ (n=16) ยังเล็กเกินสรุปอะไร

## 2026-08-31 — finding ที่ถูก refute: "safety verdict เป็น anti-signal"

**ไม่มี RULES change รอบนี้ นี่คือบันทึกว่าอะไรพัง และเปลี่ยน instrument อะไรบ้าง**

### ที่อ้างไว้ (ผิด)

วิเคราะห์ tracking dataset (live 90 + archive 190 = 280 unique rows, pumper
`peakRet >= 1` 33 ตัว = base rate 11.8%) แล้วสรุปว่า safety filter คัดผิดทาง:

```
pass=true   n=106  peak-2x  6.6%
pass=false  n=174  peak-2x 14.9%     Fisher p=0.037
```

ข้อสรุปตอนนั้น: `pass` กรอง pumper ทิ้ง ควรเลิกใช้เป็นเกณฑ์คัดเข้า เหลือไว้เป็น
rug filter อย่างเดียว **ข้อสรุปนี้ผิด** independent audit ตีตกด้วย 4 เหตุผลอิสระ
แต่ละข้อพอฆ่ามันได้เอง

### ทำไมถึงผิด

**1. `f.pass` ไม่ใช่ label เดียว — กฎเปลี่ยนกลางชุดข้อมูล**

`ac2b67a` ขึ้น minLiquidityUsd 30k→50k, `30eb0c0` ขึ้น minAgeHours 24→48
**37 จาก 106 แถว pass=true จะ FAIL กฎวันนี้** (min liq ใน pass=true วันที่ 08-25
คือ $30,286 min age 1h) ตาราง group ด้วย `pass` จึงเฉลี่ย filter สามตัวรวมกัน
แล้วเรียกว่า effect เดียว **5 จาก 7 pumper ที่ pass=true อยู่ในแถวที่กฎวันนี้ปฏิเสธ**

**2. `p.peakRet` เป็น sampled lower bound ที่แน่นขึ้นตามจำนวน poll**

poll เปลี่ยน hourly → 10-min วันที่ 08-27 median samples/row ตามวันที่เจอ:
8, 12, 14, **175, 277, 274**, 125 peak-2x rate ตามจำนวน sample:
7.8% (8-30 samples) → 12.5% (30-100) → **16.5% (100+)**

ทุก "predictor" co-linear กับสิ่งนี้ — median samples: pass=true **12.5** vs
pass=false **69**; chg24h>1000 59 vs 14; vol/liq>=5 47 vs 12; age<7d 69 vs 12
bucket ถูก sample **ไม่เท่ากัน** ความต่างจึงถูกผลิตขึ้นมาเอง

stratify ตาม era:

```
                   sparse (<08-27)         dense (>=08-27)
pass=true    7.6% vs  9.2%  p=0.78    3.7% vs 19.4%  p=0.072
age<168h    11.5% vs  6.4%  p=0.37   23.9% vs  5.6%  p=0.006
vol/liq>=5  12.3% vs  4.9%  p=0.15   18.7% vs 12.0%  p=0.46
chg24h>1000 21.1% vs  6.6%  p=0.057  33.3% vs 12.5%  p=0.044   <- รอดทั้งสอง era
```

จำกัดเฉพาะแถวที่วัด peak บน window เทียบกันได้:

- **archived/finished only:** pass 7.9% vs 12.9%, **p=0.34**
- **rowAge >= 80h:** pass 8.0% vs 9.7%, **p=0.80** — เอฟเฟกต์หายเกลี้ยง

**3. นิยาม "pump" นับ peak ที่ซื้อขายไม่ได้จริง**

ใน 33 pumper: UMIA `liqUsd=38.25`, Martians `liqUsd=0.02` — ซื้อไม่ได้ตอนเจอ
PONS (72.7x), UMIA-archive (23.1x), ROCKSTAR — sample ที่ใกล้ `peakH` ที่สุดมี
**liq = 0** คือ price print ที่ไม่มีตลาด 3 ตัวไม่มี sample ที่ >=2x เลย, 11 ตัวมี <=1

ใช้นิยามที่ realizable (มี sample ที่ `ret>=1` **และ** `liq>=5000`) → 33 เหลือ **26**:

```
                REALIZABLE peak          จำกัด liq0>=50k (floor จริง)
pass=true    5.7% vs 11.5% p=0.137   4.7% vs 10.5% p=0.197
chg24h>1000 20.0% vs  7.5% p=0.019  18.9% vs  5.8% p=0.015
vol/liq>=5  12.8% vs  5.3% p=0.038  12.8% vs  4.8% p=0.043
age<168h    13.6% vs  5.4% p=0.023  14.9% vs  4.4% p=0.015
```

claim ตายที่นิยาม pump อย่างเดียว ก่อนถึง control อื่น

**4. confound: ตัวที่คัด pumper ทิ้งคือ floors ไม่ใช่ safety verdict**

```
age<7d :  pass=true 10.0% (n=40)  vs pass=false 21.7% (n=92)   p=0.14
age>=7d:  pass=true  4.5% (n=66)  vs pass=false  7.3% (n=82)   p=0.73
```

ไม่มี stratum ไหน significant Mantel-Haenszel OR 0.465

แยกคมกว่านั้น — ผ่า pass=false ด้วยว่าผ่าน floors ของระบบเองไหม (liq>=50k, age>=48h):

```
pass=true                     7/106 =  6.6%
pass=false, ผ่าน floors       6/ 77 =  7.8%    <- Fisher p=0.78 เทียบ pass=true
pass=false, ไม่ผ่าน floors   20/ 97 = 20.6%
```

**signal ทั้งหมดอยู่ในแถวที่ floors ปฏิเสธอยู่แล้ว** — เหรียญที่เด็กหรือบางเกินกว่าจะ
ซื้อได้ภายใต้ rule set ใดก็ตามที่ยังมี floors ในกลุ่มที่ซื้อได้จริง `pass` เป็นการโยนหัวก้อย
(6.6% vs 7.8%) safety **verdict** ไม่ใช่ตัวที่จ่ายค่า pumper — **floors** ต่างหาก
ซึ่งเป็น trade-off คนละเรื่องและบันทึกไว้แล้วที่ 2026-08-27 ข้อ 5

### multiplicity

permutation min-p test บน grid 322 gate (18 feature x decile x สองทิศ — ประเมิน
แบบอนุรักษ์นิยมของสิ่งที่ค้นจริง ยังไม่นับ two-way combo):

- gate ดีสุดที่สังเกตได้: `chg24h>1637` raw p=1.5e-3
- **family-wise adjusted p = 0.116**
- raw p ที่ต้องได้เพื่อผ่าน FWER 0.05 คือ **5.6e-4** — ไม่มี gate ไหนถึง

logistic regression: ใส่ `pass + log(samples)` → pass coefficient p=0.098
ใส่ age/chg24h/vol-liq ต่อ → p=0.17 และ **ไม่มี coefficient ไหน significant เดี่ยวๆ**
(feature collinear กันหมด)

### EV simulation — ทิ้ง

sim walk `s` ตามเวลา exit ที่ -50% stop หรือ +100% TP ให้ EV ติดลบทุก gate
**ห้ามอ้างตัวเลขชุดนี้**:

```
first-sample lag: median 25.0h
แถวที่ <= -50% ตั้งแต่ observation แรก: 24.4%
median s.length: 7
stop-out 119 ครั้ง — 68 (57%) ยิงตั้งแต่ observation แรก
```

ยังตอบคำถาม stop-loss ในหัวข้อ "คำถามที่ tracking dataset จะตอบ" ไม่ได้ และ
**cross-era comparison ในชุดข้อมูลนี้ให้ถือว่าตายแล้ว** ไม่ใช่แค่ต้องถ่วงน้ำหนักใหม่ —
แถวเก่าซ่อมไม่ได้ `s` เพิ่งมีมาไม่นาน

### ที่รอด audit

| claim | verdict |
|---|---|
| 280 rows / 33 pumper / base 11.8% | CONFIRMED (0 overlap, 0 dup, `f.pass` เป็น boolean ครบทุกแถว) |
| chg24h>1000 → 27.5% vs 7.0% | CONFIRMED — รอดทุก stratification, archived-only p=0.0003 |
| vol/liq>=5 → 15.5% vs 7.6% | CONFIRMED (p=0.043) |
| age<168h → 18.2% vs 6.1% | CONFIRMED เชิงตัวเลข แต่ confounded (p=0.37 ใน sparse era) |
| pumper กับ rug คือประชากรเดียวกัน | CONFIRMED — baseline rug 19.6%, ทุก pump gate 33-50% |

แก้บันทึกเดิม: 2026-08-27 เขียนว่า vol/liq>=5 ได้ 9% vs 1% ตอนนี้ 15.5% vs 7.6%
"effect เล็กลง" จริงเฉพาะเป็น **ratio** (9x→2x) — **absolute gap 8pp เท่าเดิมทั้งสองครั้ง**

### สิ่งที่เปลี่ยนรอบนี้ (instrument ไม่ใช่ RULES)

**1. `provenance()` — stamp `v: {ef, pollMin}` ทุกแถวตอน discovery**

`ef` = sha1 8 ตัวแรกของ `ENTRY_FILTER_KEYS` + ค่าปัจจุบัน — derive เอง ไม่ต้อง
bump มือ แก้ threshold ไหนก็เปลี่ยนเอง `pollMin` = cadence ที่ตั้งไว้
แถวก่อนวันนี้ไม่มี `v` → เป็น era ของตัวเอง ชื่อ `pre-versioning`

**2. `patterns` พิมพ์ provenance header ก่อนทุกตาราง**

แสดง n ต่อ entry-filter version, cadence ที่ตั้ง vs ที่**สังเกตได้จริง**
(median gap ระหว่าง sample), median samples/row และเตือนเมื่อมี >1 version

วัดครั้งแรกได้ผลที่ควรรู้: **cadence จริง 186 นาที ไม่ใช่ 10 นาทีที่ตั้งไว้** —
GitHub throttle ทำให้ช่องว่างระหว่าง run กลืนความถี่ใน run ทิ้งหมด

**3. `POLL_CADENCE_MIN` — FROZEN**

เปลี่ยนได้เฉพาะเป็นการตัดสินใจที่บันทึกไว้ ไม่ใช่ปุ่มปรับจูน และเมื่อเปลี่ยนต้อง
ยอมทิ้ง cross-era comparison

**4. `RULES.momMinChg24h: 1000` — pre-registered, MEASUREMENT ONLY**

ไม่ต่อเข้า `momentumQualifies`, alert, หรือ buy path ใดๆ มีแค่ตาราง
`chg24h gate x age` ใน `patterns` — ผ่าใน age strata เพราะ chg24h collinear
กับ age<7d ~90% ถ้าไม่ผ่าจะได้ age effect ที่ใส่ป้าย chg24h แล้วอ่านเป็นการยืนยัน

**ตรึงที่ 1000 grid optimum คือ 1637 — การขยับไปหาคือ fit noise ที่ threshold นี้
มีไว้ทดสอบ** ห้ามขยับเลขให้ตารางดูดีขึ้น นั่นคือ failure mode ที่บันทึกนี้เขียนมากัน

ผลแรก (ยังเป็น pre-versioning era ทั้งหมด อ่านเป็น baseline ไม่ใช่หลักฐาน):

```
d1   young hot  n=33 lifePk2x 30%  rug 39%   |  young cold n= 82 lifePk2x 12%  rug 26%
     old   hot  n= 4 lifePk2x 25%  rug 25%   |  old   cold n=128 lifePk2x  5%  rug  0%
d3   young hot  n=22 lifePk2x 36%  rug 64%   |  young cold n= 55 lifePk2x  9%  rug 44%
     old   hot  n= 4 lifePk2x 25%  rug 25%   |  old   cold n=109 lifePk2x  6%  rug  1%
```

แยกใน young stratum ได้จริง แต่ราคาคือ rug 26%→39% (d1), 44%→64% (d3)

### ที่ยังไม่เปลี่ยน และเพราะอะไร

- **ไม่แตะ `pass` ในฐานะเกณฑ์คัดเข้า** — premise ถูก refute สิ่งที่ data รองรับคือ
  ข้อความที่อ่อนกว่ามาก: **`pass` ไม่มีข้อมูลเรื่อง pump ทั้งสองทาง** (6.6% vs 7.8%
  ในกลุ่มที่ซื้อได้จริง) ไม่ใช่เหตุผลพอที่จะแก้ RULES ฝั่ง rug ก็อ่อน:
  pass=true rug 20.8% vs 26.4% ไม่ significant
- `journal.json` ยังว่าง 0 entries — ไม่มี realized trade เลย ทุกตัวเลขที่นี่เป็น
  paper บน sampled lower bound ของ peak ไม่มี RULES change ไหนอ้าง return ได้
- **momentum gate (`momMinVolLiq`) ยังตัดสินไม่ได้**: MOMENTUM n=19 lifePk2x 5%
  vs PASS,quiet n=44 2% — เกณฑ์ตัดสินคือ 20-30 tokens ยังไม่ถึง และตอนนี้รู้แล้วว่า
  ทั้งสอง cell ถูก sample ไม่เท่ากัน ต้องรอ n ในยุคที่ stamp `ef` แล้วเท่านั้น

### บทเรียนเชิงวิธี (ข้อสำคัญที่สุดของรอบนี้)

`pass=false` **ไม่ใช่ "ตลาด"** — มันคือ shortlist ที่ scan คัดมาแล้วตกด่านความปลอดภัย
ข้อสรุปใดๆ เรื่องการเลิกใช้ `pass` generalize ได้แค่ภายใน shortlist นั้น

และ: n=280 ดูเยอะพอจะเลิกเรียกว่า thin n ได้ แต่ pumper มีแค่ 33 ตัว — **n ที่นับ
คือจำนวน event ไม่ใช่จำนวนแถว** ทุก finding ต่อจากนี้ต้องรายงาน (ก) จำนวน pumper
ที่แบกผลนั้น (ข) FWER-adjusted p ถ้ามีการค้น threshold (ค) ผลหลัง stratify ตาม
`v.ef` และ sample count ก่อนจะถูกอ้างเป็นหลักฐาน

---

## 2026-09-01 — ท่อ intake ตาย: PASS arm หยุดโตมา 1 วันโดยไม่มีใครเห็น

รอบนี้ตั้งใจจะวิเคราะห์ pattern แต่เจอว่า **dataset หยุดเก็บฝั่ง PASS ไปแล้ว**
ต้องซ่อมท่อก่อน ไม่งั้นทุกคำถามที่เหลือรอคำตอบจาก data ที่ไม่มีวันมา

### อาการ

```
ยุค          n    %pass  %age<48h  %liq<50k  median liq  median chg24h  median vol/liq
Aug24-26   155     51%     33%       21%       118k          18%            4.2
Aug27-30   112     22%     53%       28%        85k         180%           11.8
Aug31+      43      5%     63%       49%        67k         229%           15.8
```

แถวที่ stamp `ef=71c22712` แล้ว (31 ส.ค. 13:42 เป็นต้นมา): **PASS 0 จาก 30**

### สาเหตุ — selection bias จาก dedupe ไม่ใช่ตลาด ไม่ใช่ threshold

`cmdScan` ดึงจาก `trending_pools` + `new_pools` แล้ว dedupe ด้วย
`!tracking[mint] && !archived.has(mint)` คือ **เจอครั้งเดียวแล้วตัดออกถาวร**

`trending_pools` 10 หน้าคือเซ็ตเล็กและค่อนข้างนิ่ง — วัดเมื่อ 2026-09-01 ได้ 138 mint
ที่ liq ≥ 30k, 122 ตัวอายุเกิน 48h แต่ **เหลือที่ยังไม่เคย track แค่ 22 ตัว** (84%
ถูกดูดเข้า archive ไปแล้วใน 8 วันแรก) ที่เหลือเข้ามาจึงเป็น `new_pools` เป็นหลัก
= อ่อนและบางโดยโครงสร้าง ตกด่าน age/liquidity ตั้งแต่ต้น

ผลที่ตามมาและเป็นตัวที่ร้ายจริง: **screener ยังพิมพ์ PASS ~27 ตัวทุกชั่วโมง** —
แต่ 24 scan ล่าสุดมี 39 mint ไม่ซ้ำ และ **33 ตัวถูก archive ไปแล้ว** outcome ปิดไป
นานแล้ว ไม่มีทางให้ข้อมูลใหม่ได้อีก 21 ตัวโผล่ ≥20 จาก 24 scan, 19 ตัวลงวันที่
25 ส.ค. หน้าจอดูเหมือนระบบทำงาน แต่ learning loop หยุดหมุนไปแล้ว

### สิ่งที่แก้

1. **`RULES.reentryCooldownHours: 168`** — mint กลับเข้ามาใหม่ได้ ถ้าห่างจาก
   `firstSeenAt` ของรอบก่อน ≥ 168h เหตุผลที่ต้องมี cooldown ไม่ใช่เอา dedupe ออกเฉยๆ:
   bucket ยาวสุดคือ d3 = 72h สอง entry ที่ window ทับกันคือ observation เดียวนับสองครั้ง
   ซึ่งคือ double-count ที่ dedupe เดิมเขียนไว้กัน 168h ทำให้ window ไม่ทับกันโดยมี margin
   - แถวใหม่ stamp `entryNo` (1 = ครั้งแรก, 2+ = re-entry)
   - `patterns` เปลี่ยน key เป็น `mint#entryNo` — เดิม key ด้วย mint เฉยๆ ซึ่งจะ
     **ทิ้ง observation เก่าเงียบๆ** ถ้ามี re-entry
   - `printProvenance` พิมพ์จำนวน distinct mint คู่กับ n และเตือนเมื่อมี re-entry:
     สอง entry ของเหรียญเดียวกันไม่ใช่ sample อิสระ
   - ทดสอบแล้ว: scan 14 ตัวได้ re-entry 6 ตัว (PENGU 6691h/$4M liq, TROLL 11971h/$3M,
     ANSEM, USELESS, CATE, CYBERLEEK) — คือ stratum "แก่ + liquid" ที่หายไปพอดี
     ตอนนี้มี 31 mint ที่พ้น cooldown แล้ว และจะเพิ่มทุกวัน

2. **`candidates.json` stamp `firstSurfacedAt` + `surfacedCount`** และเรียง
   ตัวใหม่ขึ้นก่อน `alert` แสดง "**ใหม่**" หรือ "อยู่ในลิสต์มา Nd" ที่หัวเรื่อง
   **ไม่ได้ filter อะไรออก** — เหรียญที่ยังผ่าน filter อยู่ก็ยังซื้อได้ มันแค่ไม่ใช่ข่าว
   (fone: surfacedCount 81, first 27 ส.ค.)

3. **`patterns` provenance แตก sparse/dense** — `pre-versioning` bucket เดียว
   ซ่อน median samples/row 12 (Aug24-26) กับ 175-385 (Aug27-30) ไว้ด้วยกัน
   ตอนนี้พิมพ์ n=143 sparse (median 12) / n=137 dense (median 258) พร้อมคำเตือน
   `DENSE_SAMPLE_MIN = 50` วางตรงที่ cadence change ลงจริงในข้อมูล ไม่ใช่ค่าที่ tune

### RULES change: ลบ momentum track (`momMinVolLiq`) — ตามเงื่อนไขฆ่าที่ตั้งไว้เอง

เงื่อนไขที่เขียนไว้ตอน ship 2026-08-27: ฆ่าถ้าที่ ~20-30 tokens แล้ว MOMENTUM ยังไม่ชนะ
`PASS, quiet` บน peak-2x ถึงแล้วและไม่ชนะ:

```
lifetime peak-2x, ทุกแถว     MOMENTUM n=20  5.0%   PASS,quiet n=49  4.1%   p=0.65
เฉพาะแถว dense               MOMENTUM n= 7  0.0%   PASS,quiet n=20  5.0%   p=1.00
```

ไม่แยกใน stratum ไหนเลย และทิศกลับด้านระหว่างสอง stratum = หน้าตาของผลที่เหรียญเดียวแบกอยู่

และ threshold ถูก intake drift กินไปแล้ว: ตอนตั้ง median vol/liq ที่ discovery = 4.2
`>= 5` จึงคัดครึ่งบน พอถึง 31 ส.ค. median = 15.8 มันรับ **67% ของ intake**
gate ที่ปล่อยผ่านสองในสามของสิ่งที่เห็นไม่ได้คัดอะไร

ลบ: `momMinVolLiq`, `momentumQualifies()`, momentum section ใน `cmdAlert`,
ตาราง `momentum gate` ใน `patterns` เหลือ gate เดียวคือ safety

### ทำไมไม่เอา chg24h > 1000 ขึ้นมาแทนเป็น gate

CLAUDE.md บอกให้ "replace it with a better pump-pattern candidate" และมีตัวจริง —
`momMinChg24h` เป็นตัวเดียวที่รอดทุก stratification รอบนี้ทดสอบซ้ำโดยแบ่งตาม
sampling density (ซึ่งเป็นตัวที่ฆ่า vol/liq):

```
                      มีสัญญาณ            ไม่มีสัญญาณ
chg24h>1000  sparse   4/21  19.0%   vs   8/131   6.1%   p=0.064
             dense    8/27  29.6%   vs  17/131  13.0%   p=0.036
vol/liq>=5   sparse   9/71  12.7%   vs   3/81    3.7%   p=0.040
             dense   17/96  17.7%   vs   8/62   12.9%   p=0.28
```

chg24h ทิศเดียวกันและขนาดใกล้กันทั้งสองฝั่งของ cadence change — ไม่ใช่ artifact
ของการ poll ต่างกัน ส่วน vol/liq เอฟเฟกต์อยู่แค่ฝั่ง sparse = artifact

**แต่ยังไม่ promote** เหตุผลที่เขียนไว้ 31 ส.ค. ยังอยู่ครบ: FWER-adjusted p = 0.116,
pumper 12 ตัวแบกทั้งผล, และมันเลือก rug 50-62% การส่งเข้าโทรศัพท์คือการใช้เงินจริง
กับผลที่ยังไม่ผ่านบาร์ของตัวเอง — นี่คือ "loosening rules without data" ที่ CLAUDE.md ห้าม
goal arm ตอนนี้ = ตาราง `chg24h gate x age` + ท่อ intake ที่ซ่อมแล้วให้มันสะสม forward row ได้

**bug ในเงื่อนไข checkpoint เดิม**: `n >= 30 in the current era` นับแถว ไม่ได้นับ outcome
ยุค 71c22712 แตะ 30 แถววันนี้ทั้งที่ทุกแถวอายุไม่ถึงวันและยังไม่มี d3 เลย
แก้คำอ่านเป็น **30 แถวที่มี d3 outcome แล้ว** ในยุคปัจจุบัน

### ตาราง `entry floors` แทนที่ `momentum gate`

คำถามใต้ gate เดิมยังเป็นความตึงหลักของโปรเจค เลยเก็บ view ไว้ในรูปที่ตรงกว่า
วัดบนแถว dense เท่านั้น (sample-matched: median 231 vs 237 samples):

```
below floors  n=99  peak-2x 21.2%  rug 49.5%
above floors  n=59  peak-2x  6.8%  rug  1.7%    p=0.012
  แยก:  age<48h อย่างเดียว  n=48  peak-2x 25.0%  rug 60%
        liq<50k อย่างเดียว  n=13  peak-2x 15.4%  rug  0%
        ตกทั้งคู่            n=38  peak-2x 18.4%  rug 53%
```

floor ตัด pump population ไปราวสองในสาม และตัด rug population ไปเกือบหมด พร้อมกัน
นี่คือ trade ที่เจ้าของกำลังซื้อ พูดเป็นตัวเลขแทนที่จะสมมติเอา
ตัวที่ทำทั้งสองอย่างคือ **ด่าน age** (age<48h เดี่ยวๆ: peak-2x 25% บน rug 60%)
→ ไม่ใช่ candidate สำหรับผ่อน

ช่องเดียวที่ผ่อนแล้วดูถูก — **liq 30-50k ที่ age ≥ 48h: peak-2x 15.4% บน rug 0/13** —
n=13 และเป็น 1 ใน 3 cell ที่ผมแบ่งเอง (multiplicity) **ยังไม่ใช่หลักฐาน** ให้เฝ้าดูสะสม
อย่าขยับ `minLiquidityUsd` จนกว่ามัน pre-register forward sample ของตัวเอง

### ข้อจำกัดของรอบนี้

- ตัวเลขทั้งหมดยังเป็น paper — `journal.json` ยังว่าง 0 entries
- `peakRet` ยังเป็น sampled lower bound เหมือนเดิม การเทียบข้าม density stratum
  ยังห้ามอยู่ ทุกตัวเลขข้างบนอ่านภายใน stratum เดียว
- การเทียบ "ยุค" ในตารางแรกเป็นการเทียบ **องค์ประกอบของ feed** ไม่ใช่ผลของ threshold
  ห้ามอ่านว่า "filter เข้มขึ้น" หรือ "ตลาดแย่ลง"
- re-entry เพิ่งเปิดวันนี้ แถว entryNo≥2 ยังไม่มี outcome สักตัว ผลของการแก้จะวัดได้
  จริงตอน d3 ของแถวชุดแรกสุก (~4 ก.ย.)
