# ติดตั้ง SLTS v2 บน Neon + Vercel (ทำตามลำดับ)

> ใช้เวลาประมาณ 30–45 นาที • ทำบนเครื่องคอมพิวเตอร์ที่มี Node.js 20 ขึ้นไป
> โปรเจกต์ Neon: org `org-lucky-bonus-48400982` • project `damp-feather-72127574` • branch `production`

## ภาพรวมสถาปัตยกรรมใหม่

```
มือถือ / PC / แอป APK ──► Vercel (หน้าเว็บ + /api/slts) ──► Neon Postgres (ข้อมูลทั้งหมด)
                                         │                └─► Neon AI Gateway (ช่วยอ่านบัญชีจ่ายหมาย)
                                         └──► Google Apps Script ──► Google Drive (เก็บไฟล์รูปเท่านั้น)
```

- ข้อมูลตาราง ผู้ใช้ เส้นทาง QR แชร์ ประวัติใช้งาน และบันทึกจุดบกพร่อง → **Neon**
- ไฟล์ภาพ → ยังเก็บใน **Google Drive** โฟลเดอร์เดิม (ผ่าน Apps Script ที่ล็อกด้วย secret)

---

## ขั้นที่ 1 — ติดตั้งแพ็กเกจและ Neon CLI

```bash
cd slts
npm install                       # อัปเดต package-lock.json (เพิ่ม pg, @vercel/functions)
npm i -g neon@latest              # ถ้าไม่ได้ ใช้ npx neon@latest แทนคำว่า neon ทุกคำสั่ง
neon --version
neon login                        # เปิดเบราว์เซอร์ให้ล็อกอิน Neon (ทำครั้งเดียว)
```

## ขั้นที่ 2 — เชื่อมโปรเจกต์ Neon

```bash
neon init -y --org-id org-lucky-bonus-48400982 --project-id damp-feather-72127574 --branch production --services postgres,ai-gateway
```

ไฟล์ `neon.ts` ในโปรเจกต์ประกาศ `aiGateway: true` ไว้แล้ว (Postgres มีให้อัตโนมัติ)

## ขั้นที่ 3 — สร้างบริการและดึงค่า env

```bash
neon deploy
```

จะได้ไฟล์ `.env.local` ที่มี `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN`
(ห้าม commit ไฟล์นี้ — `.gitignore` กันไว้แล้ว)

> ⚠️ AI Gateway ต้องอยู่ใน region `aws-us-east-1/2`, `aws-eu-central-1` หรือ `aws-ap-southeast-1` และต้องเติมเครดิตที่หน้า Billing ก่อนจึงจะเรียกโมเดลได้
> ถ้ายังไม่เปิด ระบบยังทำงานปกติ (เพียงไม่มีตัวช่วย AI อ่านบัญชีจ่ายหมาย)

เพิ่มค่าที่ต้องตั้งเองลงท้าย `.env.local`:

```bash
# สุ่ม secret 64 ตัว
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" >> .env.local
node -e "console.log('GAS_BRIDGE_SECRET=' + require('crypto').randomBytes(24).toString('hex'))" >> .env.local
echo "GAS_DRIVE_URL=https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec" >> .env.local
```

## ขั้นที่ 4 — อัปเดต Google Apps Script (สะพานเก็บรูป + ปิดช่องรั่ว)

1. เปิด Apps Script โปรเจกต์เดิม → วางโค้ดจาก `google-apps-script/Code.gs` ทับทั้งหมด
2. **Project Settings → Script Properties → Add**: `BRIDGE_SECRET` = ค่าเดียวกับ `GAS_BRIDGE_SECRET` ใน `.env.local`
3. **Deploy → Manage deployments → Edit → Version: New version → Deploy** (URL เดิมไม่เปลี่ยน)

หลังขั้นนี้ Apps Script จะตอบเฉพาะคำขอที่มี secret เท่านั้น (ปิดช่องที่ใครก็อ่านรายชื่อ+รหัสผ่านได้)

## ขั้นที่ 5 — ย้ายข้อมูลเดิมจาก Google Sheet เข้า Neon

```bash
npm run migrate:sheet -- --dry    # ทดลองอ่าน ดูจำนวนผู้ใช้/แถว (ต้องไม่มีคำเตือนเรื่องรหัสผ่าน)
npm run migrate:sheet             # ย้ายจริง (รันซ้ำได้ ไม่เกิดข้อมูลซ้ำ)
```

- รหัสผ่านถูกแปลงเป็น scrypt hash
- ผู้ใช้ที่รหัสผ่านเป็นค่าที่เคยเปิดเผย (`admin`/`123456` ฯลฯ) จะถูก **บังคับตั้งรหัสใหม่** เมื่อเข้าระบบครั้งแรก

## ขั้นที่ 6 — ทดสอบในเครื่อง

```bash
npm run build                     # ต้องผ่าน
npm start                         # http://localhost:3000
curl http://localhost:3000/api/health
# {"status":"success","ok":true,"db":true,"version":"2.0.0","driveBridge":true,"aiGateway":true,...}
```

ทดสอบ API ทั้งชุด (ใช้ **branch ทดสอบ** เท่านั้น เพราะชุดทดสอบลบตาราง):

```bash
neon checkout test-api --create   # สร้าง branch ทดสอบ (env จะชี้ branch นี้)
TEST_DATABASE_URL="$(grep ^DATABASE_URL_UNPOOLED .env.local | cut -d= -f2-)" npm run test:api
neon checkout production          # กลับมา branch จริง
```

## ขั้นที่ 7 — ขึ้น Vercel

ใส่ env ใน Vercel → Project → Settings → Environment Variables (Production):

| ชื่อ | ค่า |
|---|---|
| `DATABASE_URL` | จาก `.env.local` (pooled) |
| `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` | จาก `.env.local` |
| `SESSION_SECRET` | จาก `.env.local` |
| `GAS_DRIVE_URL`, `GAS_BRIDGE_SECRET` | จาก `.env.local` |
| `ADMIN_INITIAL_PASSWORD` | (ไม่บังคับ) ใช้เฉพาะเมื่อฐานข้อมูลยังว่าง |

```bash
npx vercel --prod
```

ตรวจ `https://<โดเมน>/api/health` ต้องได้ `"db":true` และ `"driveBridge":true`

## ขั้นที่ 8 — ปิดช่องรั่วที่เหลือ (สำคัญ)

1. Google Sheet เดิม → Share → General access = **Restricted** (เดิมเปิดสาธารณะ ใครก็ดาวน์โหลด CSV ได้)
2. ทำ GitHub repo เป็น **Private** (ประวัติ git เดิมมีรหัสผ่าน admin, ID ชีต/โฟลเดอร์)
3. เข้าระบบด้วย admin แล้วตั้งรหัสผ่านใหม่ทันที (ระบบบังคับอยู่แล้ว)
