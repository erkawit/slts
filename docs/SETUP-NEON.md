# ติดตั้ง SLTS v2 บน Neon + Vercel (ข้อมูลใน Neon • ภาพใน Google Drive • ไม่ใช้ Google Sheet)

> โปรเจกต์ Neon: org `org-lucky-bonus-48400982` • project `damp-feather-72127574` • branch `production`

```
มือถือ / PC / แอป ──► Vercel (หน้าเว็บ + /api/slts) ──► Neon Postgres (ข้อมูล + ผู้ใช้ + เส้นทาง)
                                               ├──► Apps Script ──► Google Drive (ไฟล์ภาพ, โฟลเดอร์เดิม)
                                               └──► Neon AI Gateway (ไม่บังคับ)
```

ไม่ใช้ Google Sheet แล้ว • ถ้า Drive ยังไม่ได้ตั้งค่า/ใช้ไม่ได้ ระบบจะเก็บภาพใน Neon แทนอัตโนมัติ

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

| `GAS_DRIVE_URL` | URL Web App ของ Apps Script (ตัวเดิม `https://script.google.com/macros/s/AKfycbw-…/exec`) |
| `GAS_BRIDGE_SECRET` | สุ่มยาว ≥ 32 ตัว (ใช้ค่าเดียวกันในข้อ 2.1) |

### 2.1) ตั้งค่า Apps Script ให้รับไฟล์ภาพ (ทำครั้งเดียว)

1. เปิด Apps Script โปรเจกต์เดิม → วางโค้ด `google-apps-script/Code.gs` ฉบับใหม่ทับทั้งหมด
2. Project Settings → **Script Properties** → เพิ่ม `BRIDGE_SECRET` = ค่าเดียวกับ `GAS_BRIDGE_SECRET`
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (URL ไม่เปลี่ยน)
4. โฟลเดอร์ Drive ที่เก็บภาพ (`1ArsWIsoIIYeQY3o_dPrsTpBXy4pEXQuQ`) ต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้" เหมือนเดิม เพื่อให้หน้าเว็บแสดงภาพได้

จากนั้น Vercel → Deployments → รายการล่าสุด → **⋯ → Redeploy**

> ทางลัด: Vercel → Storage / Integrations → **Neon** → Connect กับโปรเจกต์ slts จะใส่ `DATABASE_URL` ให้อัตโนมัติ (ยังต้องเพิ่ม `SESSION_SECRET`, `ADMIN_INITIAL_PASSWORD` เอง)

## 3) ตรวจว่าใช้งานได้

เปิด `https://<โดเมน>/api/health` ต้องได้:

```json
{"status":"success","ok":true,"db":true,"photoStorage":"google-drive","driveBridge":true, ...}
```

- `db:false` → `DATABASE_URL` ผิด/ยังไม่ Redeploy
- `photoStorage:"neon"` → ยังไม่ได้ใส่ `GAS_DRIVE_URL` (ภาพจะเก็บใน Neon ชั่วคราว ใช้งานได้ ไม่หาย)
- อัปโหลดภาพแล้วขึ้น "unauthorized" → `BRIDGE_SECRET` ใน Apps Script ไม่ตรงกับ `GAS_BRIDGE_SECRET` หรือยังไม่ได้ Deploy เวอร์ชันใหม่
- เปิดหน้าเว็บ → ล็อกอิน `admin` + รหัส `ADMIN_INITIAL_PASSWORD` → ตั้งรหัสใหม่ → เพิ่มผู้ใช้ที่หน้า "จัดการผู้ใช้งาน"
- ตารางทั้งหมดถูกสร้างอัตโนมัติในคำขอแรก (ไม่ต้องรัน SQL เอง; ดูโครงสร้างที่ `scripts/schema.sql`)

## 4) (ไม่บังคับ) ย้ายข้อมูลเก่าจาก Google Sheet ครั้งเดียว

ข้ามได้ถ้าต้องการเริ่มฐานข้อมูลใหม่ ถ้าต้องการข้อมูลเดิม: ใส่ `DATABASE_URL`, `GAS_DRIVE_URL`, `GAS_BRIDGE_SECRET` ใน `.env.local`
แล้วรัน `npm run migrate:sheet` (ภาพเก่าใน Drive แสดงได้ตามลิงก์เดิม) — หลังจากนั้นไม่ต้องใช้ชีตอีก

## 5) ทดสอบในเครื่อง (ไม่บังคับ)

```bash
npm run build && npm start          # http://localhost:3000 (อ่าน .env.local)
npx neon@latest checkout test-api --create
TEST_DATABASE_URL="$(grep ^DATABASE_URL_UNPOOLED .env.local | cut -d= -f2-)" npm run test:api
npx neon@latest checkout production
```

## พื้นที่เก็บภาพ

ภาพเก็บใน Google Drive (ใช้พื้นที่ของบัญชี Google เจ้าของ Apps Script) — Neon เก็บเฉพาะข้อมูลและลิงก์ภาพ
ถ้าต้องการเก็บภาพใน Neon แทน ให้ตั้ง `PHOTO_STORAGE=neon` (Free plan 0.5 GB ≈ 1,500–5,000 ภาพ)
