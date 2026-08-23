# Coin — Memecoin Safety Filter + Decision Journal + Eval

เครื่องมือคัดกรอง memecoin (Solana) แบบ safety-first พร้อม journal สำหรับ eval ว่าระบบเราชนะ baseline จริงไหม

**หลักการ:** token ใหม่ส่วนใหญ่ไปศูนย์ — edge อยู่ที่คัดขยะออกเร็ว ไม่ใช่ทำนายผู้ชนะ

## ใช้งาน

ต้องมี Node.js (มีแล้ว) ไม่ต้องลง dependency อะไรเพิ่ม

```bash
# เช็คความปลอดภัย token
node coin.js check <mint_address>

# บันทึกการตัดสินใจ (log ทั้ง buy และ skip เสมอ)
node coin.js log <mint_address> buy "narrative แรง, ผ่านทุกเช็ค"
node coin.js log <mint_address> skip "LP lock แค่ 40%"

# รันทุกวัน — เก็บผลตอบแทน 1d/7d/30d ของทุก entry ที่ถึงกำหนด
node coin.js update

# ดูผล: median return, rug rate, เทียบ SOL baseline, false positives
node coin.js stats

# ดูรายการทั้งหมด
node coin.js list
```

## Data sources (ฟรี ไม่ต้องมี key)

- [DexScreener API](https://docs.dexscreener.com) — ราคา, liquidity, volume, txns
- [Rugcheck API](https://rugcheck.xyz) — mint/freeze authority, LP lock, holders, risks

## โครงสร้าง

- `coin.js` — เครื่องมือหลัก (เกณฑ์ปรับได้ที่ `RULES` บนหัวไฟล์)
- `checklist.md` — เช็คอัตโนมัติ + เช็คมือ + exit rules
- `journal.json` — ทุก decision + snapshot ณ เวลานั้น + ผลลัพธ์ (สร้างอัตโนมัติตอน log ครั้งแรก)

## Eval คิดยังไง

1. log ทุก decision **รวมตัวที่ skip** — เพื่อวัดทั้ง "จับ rug ได้กี่ %" และ "ฆ่าตัวดีทิ้งกี่ %"
2. snapshot เก็บ ณ เวลาตัดสินใจ = ไม่มี look-ahead bias
3. token ตาย (ไม่มี pair แล้ว) นับเป็น -100% = ไม่มี survivorship bias
4. ทุกผลเทียบ SOL baseline — แพ้ SOL = ระบบไม่มีค่า
5. paper trade ก่อนอย่างน้อย 20-30 ตัว ค่อยใช้เงินจริง ($10/ตัว)
