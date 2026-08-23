# Memecoin Checklist — สิ่งที่ script ทำให้ + สิ่งที่ต้องดูเอง

## script ทำให้อัตโนมัติ (`node coin.js check <mint>`)

| เช็ค | FAIL เมื่อ | ทำไม |
|---|---|---|
| Mint authority | ยัง active | dev พิมพ์เหรียญเพิ่มได้ไม่จำกัด |
| Freeze authority | ยัง active | dev freeze wallet เราได้ ขายไม่ออก |
| LP locked | < 80% | dev ถอนสภาพคล่องหนี = rug |
| Liquidity | < $30k | slippage กิน position $10 |
| Top-10 holders | > 30% | dump ทีเดียวราคาพัง |
| Honeypot pattern | buy เยอะแต่ sell = 0 | ซื้อได้ขายไม่ได้ |
| Rugcheck danger risks | มี | ตาม rugcheck.xyz |

WARN (ไม่ตัดทิ้งแต่ต้องรู้): อายุ < 24h, vol/liq > 10x (wash), ข้อมูล LP/holder หาไม่ได้

**ข้อจำกัดที่ต้องรู้:** เหรียญใหญ่ (WIF, BONK) จะ FAIL top-10 เพราะ holder ใหญ่คือ CEX wallet — rule นี้ออกแบบมาสำหรับเหรียญใหม่ที่เราเล่นจริง

## ต้องดูเองด้วยมือ (script ยังไม่ทำ)

- [ ] **Bundled snipers** — เปิด [gmgn.ai](https://gmgn.ai) หรือ [bubblemaps.io](https://bubblemaps.io) ดูว่า top holders ถูก fund จาก wallet แหล่งเดียวกันไหม (dev แตก wallet)
- [ ] **Dev ขายยัง** — ใน GMGN ดู "DEV" tag ว่า sold แล้วกี่ %
- [ ] **Socials มีจริงไหม** — TG/X มีคนคุยจริงหรือ bot ล้วน (ดูแค่ discovery ไม่ใช่ signal ซื้อ)
- [ ] **เช็คซ้ำบน [rugcheck.xyz](https://rugcheck.xyz)** — UI ละเอียดกว่า API

## Exit rules (สำคัญกว่า entry — ท่องให้ขึ้นใจ)

1. **2x → ขายครึ่ง** ทุนคืนแล้ว ที่เหลือ free ride ปล่อยลุ้น
2. **Time stop** — ไม่ขยับใน 48h → ออก
3. **LP ลดเร็ว → ออกทันที** ไม่ต้องรอดูราคา
4. **ห้ามถัวขาลง** เด็ดขาด
5. ขาดทุนคือ -$10 จบ ไม่เติม ไม่แก้แค้น

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
