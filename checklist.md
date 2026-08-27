# Memecoin Checklist — สิ่งที่ script ทำให้ + สิ่งที่ต้องดูเอง

## script ทำให้อัตโนมัติ (`node coin.js check <mint>`)

| เช็ค | FAIL เมื่อ | ทำไม |
|---|---|---|
| Mint authority | ยัง active | dev พิมพ์เหรียญเพิ่มได้ไม่จำกัด |
| Freeze authority | ยัง active | dev freeze wallet เราได้ ขายไม่ออก |
| LP locked | < 80% | dev ถอนสภาพคล่องหนี = rug |
| Liquidity | < $50k | slippage กิน position $10 (ขยับจาก 30k 2026-08-26) |
| Top-10 holders | > 30% | dump ทีเดียวราคาพัง |
| Honeypot pattern | buy เยอะแต่ sell = 0 | ซื้อได้ขายไม่ได้ |
| **อายุ pool** | < 48h | โซนนี้ rug 6/13 เทียบ 0/42 ของตัวที่แก่กว่า (2026-08-27) |
| Rugcheck danger risks | มี | ตาม rugcheck.xyz |
| **Dev wallet** | ถือ > 5% | dev คนเดียวตัดสินใจ dump ได้ |
| **Bundle/insider** | wallet ที่ fund จากแหล่งเดียวกันถือ > 25% | dev กระจาย wallet หลบการตรวจ |
| **Holders** | < 100 คน | ไม่มี distribution จริง |
| **Rugged flag** | rugcheck ตีตราว่า rug แล้ว | จบ ไม่ต้องดูต่อ |

WARN (ไม่ตัดทิ้งแต่ต้องรู้): vol/liq > 10x (wash), ข้อมูล LP/holder หาไม่ได้

**ข้อจำกัดที่ต้องรู้:** เหรียญใหญ่ (WIF, BONK) จะ FAIL top-10 เพราะ holder ใหญ่คือ CEX wallet — rule นี้ออกแบบมาสำหรับเหรียญใหม่ที่เราเล่นจริง

## Score (จัดลำดับว่าดูตัวไหนก่อน)

`scan` ให้คะแนน 0-100 กับตัวที่ PASS แล้ว — **ไม่ใช่สัญญาณซื้อ** แค่บอกว่าควรเสียเวลาดูตัวไหนก่อน
หักคะแนนจาก: vol/liq ratio (wash), insider %, dev %, top10 %, liquidity ตื้น, rugScore
(ไม่มีเทอมอายุแล้ว — อายุกลายเป็น hard FAIL ตัวที่ score ได้จึงผ่าน floor มาแล้วเสมอ)
คะแนนสูง = red flag อ่อนน้อย ไม่ได้แปลว่าจะขึ้น

## ต้องดูเองด้วยมือ (script ยังไม่ทำ)

- [ ] **Bundle map ด้วยตา** — [bubblemaps.io](https://bubblemaps.io) ดูรูปแบบการเชื่อมโยง (script จับ % ได้แล้วแต่ดูภาพรวมเองชัดกว่า)
- [ ] **Dev ขายยัง** — ใน GMGN ดู "DEV" tag ว่า sold แล้วกี่ %
- [ ] **Socials มีจริงไหม** — TG/X มีคนคุยจริงหรือ bot ล้วน (ดูแค่ discovery ไม่ใช่ signal ซื้อ)
- [ ] **เช็คซ้ำบน [rugcheck.xyz](https://rugcheck.xyz)** — UI ละเอียดกว่า API

## Exit rules (สำคัญกว่า entry — `watch` เตือนให้แล้ว)

รัน `node coin.js watch` (cloud รันทุกชั่วโมง ด้วย) จะเตือนอัตโนมัติ:

1. **2x → ขายครึ่ง** ทุนคืนแล้ว ที่เหลือ free ride ปล่อยลุ้น
2. **Time stop** — ไม่ขยับใน 48h → ออก
3. **LP ลดเกิน 50% → ออกทันที** ไม่ต้องรอดูราคา
4. **Stop loss -50%** → ตัด
5. **ห้ามถัวขาลง** เด็ดขาด — ขาดทุนคือ -$10 จบ ไม่เติม ไม่แก้แค้น

ขายจริงแล้วบันทึกด้วย: `node coin.js exit <mint> "เหตุผล"`
→ `stats` จะแยกให้ว่า exit แบบไหนได้ผลดีกว่า (realized return ต่อเหตุผล)

## Workflow ประจำวัน

```
เจอเหรียญน่าสนใจ
  → node coin.js check <mint>
  → PASS + เช็คมือผ่าน → node coin.js log <mint> buy "เหตุผล" --src <ช่องทางที่เจอ>
  → ไม่ผ่าน            → node coin.js log <mint> skip "เหตุผล" --src <ช่องทางที่เจอ>
     ← ต้อง log ตัว skip ด้วย! ไม่งั้นวัด false positive ไม่ได้
  --src ใส่ทุกครั้ง: smartmoney / twitter / dexscreener / telegram / friend
     stats จะบอกเองว่าช่องทางไหนเจอเหรียญดีจริง
ทุกวัน
  → node coin.js update        (เก็บผล 1d/7d/30d)
ทุกสัปดาห์
  → node coin.js stats         (ชนะ SOL baseline ไหม / filter พลาดอะไร)
  → อ่านเคสขาดทุนทีละอัน จด failure mode จัดกลุ่ม แก้อันที่บ่อยสุด
```
