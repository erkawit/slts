# ติดตั้ง SLTS v2 บน Neon + Vercel (ใช้ Neon อย่างเดียว ไม่ใช้ Google Sheet)

> โปรเจกต์ Neon: org `org-lucky-bonus-48400982` • project `damp-feather-72127574` • branch `production`

```
มือถือ / PC / แอป ──► Vercel (หน้าเว็บ + /api/slts + /api/photo) ──► Neon Postgres
                                                                    (ข้อมูล + ผู้ใช้ + เส้นทาง + ไฟล์ภาพ)
                                                                 └► Neon AI Gateway (ไม่บังคับ)
```

ไม่ต้องใช้ Google Sheet, Google Drive หรือ Apps Script อีกต่อไป

## 1) สร้างฐานข้อมูลและดึงค่าเชื่อมต่อ (บน Mac ในโฟลเดอร์โปรเจกต์)

```bash
npm install
npx neon@latest login        # ล็อกอิน Neon ในเบราว์เซอร์ (ครั้งเดียว)
npx neon@latest init -y --org-id org-lucky-bonus-48400982 --project-id damp-feather-72127574 --branch production --services postgres,ai-gateway
npx neon@latest deploy       # สร้างไฟล์ .env.local ที่มี DATABASE_URL ฯลฯ
```

> ไม่สะดวกใช้คำสั่ง: เข้า console.neon.tech → โปรเจกต์ damp-feather → **Connect** → เปิด "Connection pooling" → คัดลอก connection string มาเป็น `DATABASE_URL`

## 2) ตั้งค่าใน Vercel (สำคัญที่สุด — ไม่ตั้ง = ล็อกอินไม่ได้)

Vercel → โปรเจกต์ **slts** → Settings → **Environment Variables** → เพิ่ม (เลือก Production และ Preview):

| ชื่อ | ค่า |
|---|---|
| `DATABASE_URL` | connection string แบบ pooled (มีคำว่า `-pooler`) จาก `.env.local` หรือ Neon Console |
| `SESSION_SECRET` | สุ่มยาว ≥ 32 ตัว: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_INITIAL_PASSWORD` | รหัสผ่านเริ่มต้นของผู้ใช้ `admin` (≥ 8 ตัว) — ใช้ครั้งแรกเท่านั้น ระบบจะบังคับเปลี่ยน |
| `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` | (ไม่บังคับ) จาก `.env.local` |

จากนั้น Deployments → รายการล่าสุด → **⋯ → Redeploy**

> ทางลัด: Vercel → Storage / Integrations → **Neon** → Connect กับโปรเจกต์ slts จะใส่ `DATABASE_URL` ให้อัตโนมัติ (ยังต้องเพิ่ม `SESSION_SECRET`, `ADMIN_INITIAL_PASSWORD` เอง)

## 3) ตรวจว่าใช้งานได้

เปิด `https://<โดเมน>/api/health` ต้องได้:

```json
{"status":"success","ok":true,"db":true,"photoStorage":"neon","driveBridge":true, ...}
```

- `db:false` → `DATABASE_URL` ผิด/ยังไม่ Redeploy
- เปิดหน้าเว็บ → ล็อกอิน `admin` + รหัส `ADMIN_INITIAL_PASSWORD` → ตั้งรหัสใหม่ → เพิ่มผู้ใช้ที่หน้า "จัดการผู้ใช้งาน"
- ตารางทั้งหมดถูกสร้างอัตโนมัติในคำขอแรก (ไม่ต้องรัน SQL เอง; ดูโครงสร้างที่ `scripts/schema.sql`)

## 4) (ไม่บังคับ) ย้ายข้อมูลเก่าจาก Google Sheet ครั้งเดียว

ข้ามได้ถ้าต้องการเริ่มฐานข้อมูลใหม่ ถ้าต้องการข้อมูลเดิม: deploy `google-apps-script/Code.gs` ฉบับใหม่ + ตั้ง Script Property `BRIDGE_SECRET`
แล้วใส่ `GAS_DRIVE_URL`, `GAS_BRIDGE_SECRET` ใน `.env.local` และรัน `npm run migrate:sheet` (ภาพเก่ายังแสดงจาก Google Drive ได้ตามลิงก์เดิม)

## 5) ทดสอบในเครื่อง (ไม่บังคับ)

```bash
npm run build && npm start          # http://localhost:3000 (อ่าน .env.local)
npx neon@latest checkout test-api --create
TEST_DATABASE_URL="$(grep ^DATABASE_URL_UNPOOLED .env.local | cut -d= -f2-)" npm run test:api
npx neon@latest checkout production
```

## พื้นที่เก็บภาพ

ภาพถูกบีบอัดเหลือ ~80–500 KB/ภาพ และเก็บในตาราง `photo_files` — Neon Free plan มีพื้นที่ 0.5 GB (≈ 1,500–5,000 ภาพ)
ตรวจพื้นที่ได้ที่ Neon Console → Monitoring/Usage ถ้าใกล้เต็มให้อัปเกรดแผน
