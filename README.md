# ระบบจัดเก็บข้อมูลพิกัดส่งหมาย (Summons Location Tracking System - SLTS)
**สำหรับเจ้าพนักงานศาลจังหวัดอุดรธานี** • เวอร์ชันปัจจุบันดูที่ `version.json` / [CHANGELOG.md](CHANGELOG.md)

## 🆕 เวอร์ชัน 2 (Neon + Vercel)

| เรื่อง | เอกสาร |
|---|---|
| ติดตั้ง/ย้ายข้อมูลไป Neon และขึ้น Vercel | [docs/SETUP-NEON.md](docs/SETUP-NEON.md) |
| รายงานจุดบกพร่องที่พบและแก้ไข + ขั้นตอนต่อไป | [docs/AUDIT-v2.md](docs/AUDIT-v2.md) |
| ทำแอป Android (APK) / iOS | [docs/MOBILE-APP.md](docs/MOBILE-APP.md) |
| ประวัติการอัปเดต | [CHANGELOG.md](CHANGELOG.md) |

**โครงสร้างใหม่ที่สำคัญ**

```
api/slts.js            API หลัก (แทน Apps Script) — action เดิมทั้งหมด + login, QR share, error log, AI
api/health.js          ตรวจสัญญาณ/สถานะระบบ
lib/                   db (Neon/pg), schema, auth (scrypt + token), drive (สะพาน Google Drive), ai (Neon AI Gateway)
js/config.js           ตั้งค่า API_BASE (จำเป็นสำหรับแอปมือถือ)
js/slts-core.js        token, ตัวดัก fetch, ตรวจเน็ตจริง, คลังภาพในเครื่อง, บันทึกจุดบกพร่อง
js/slts-features.js    ล็อกอินผ่านเซิร์ฟเวอร์, แชร์/สแกน QR, เมนูแบบง่าย, ศูนย์ผู้ดูแลระบบ
css/simple-view.css    มุมมองแบบง่าย + ส่วนประกอบใหม่
scripts/               dev-server, migrate-from-sheet, bump-version, schema.sql
tests/api.test.js      ทดสอบ API กับ Postgres จริง (npm run test:api)
```

**คำสั่งที่ใช้บ่อย**

```bash
npm run build                                   # สร้างโฟลเดอร์ public/
npm start                                       # เซิร์ฟเวอร์ทดสอบ http://localhost:3000 (อ่าน .env.local)
npm run test:api                                # ต้องตั้ง TEST_DATABASE_URL (branch ทดสอบ)
npm run migrate:sheet                           # ย้ายข้อมูลจาก Google Sheet เดิม
npm run version:bump -- patch "รายละเอียด"       # ออกเวอร์ชันใหม่ (patch/minor/major)
```

---

## เอกสารเดิม (v1)

## 🌟 คุณสมบัติเด่นของระบบ

1. **การออกแบบ UI/UX (Minimalist):**
   - พัฒนาด้วย TailwindCSS ในโทนสีสะอาดตา เรียบง่าย (Clean White & Gray)
   - ปุ่มหลัก (ถ่ายภาพ, ยืนยัน, เช็คพิกัด) เป็นสีน้ำเงิน (`bg-blue-600`) และปุ่มยกเลิก/ถ่ายใหม่เป็นสีแดง (`bg-red-600`)
   - แจ้งเตือนสวยงามผ่าน **SweetAlert2** โดยไม่ต้องรีเฟรชหน้าเว็บ (SPA)
   - **ไม่ต้องล็อกอิน** เปิดใช้งานกรอกข้อมูลได้ทันที รองรับมือถือและแท็บเล็ต 100%

2. **ข้อมูลอำเภอและตำบล (อุดรธานี 20 อำเภอ):**
   - มี Dropdown ให้เลือก 20 อำเภอในจังหวัดอุดรธานี เรียงลำดับตามความสำคัญ
   - Dropdown ตำบลจะเปลี่ยนตามอำเภอที่เลือกโดยอัตโนมัติ

3. **ข้อมูลเลขคดี:**
   - สลับระหว่าง `ศาลจังหวัดอุดรธานี` หรือ `หมายศาลอื่น`
   - หากเลือก "หมายศาลอื่น" ระบบจะแสดงรูปแบบเฉพาะ:
     - ติดตัวอักษร **"ต"** นำหน้าอัตโนมัติ
     - ช่องกรอกเลขคดีรับเฉพาะตัวเลข เช่น `2097`
     - Dropdown เลือกปี พ.ศ. ย้อนหลังจากปัจจุบันไป 5 ปี (เช่น `2569`, `2568`, `2567`, `2566`, `2565`, `2564`) โดยเลือกปีปัจจุบันให้อัตโนมัติ
     - รวมฟอร์แมตอัตโนมัติ เช่น `ต2097/2569`

4. **ข้อมูลที่ตั้งสถานที่ส่งหมาย:**
   - **หมายบ้าน:** กรอกบ้านเลขที่ (บังคับ) + หมู่ (ถ้ามี) + ตำบล + อำเภอ รูปแบบที่บันทึก เช่น `"154 ม.3 ต.บ้านตาด อ.เมืองอุดรธานี"`
   - **ที่ทำการปกครองส่วนท้องถิ่น:** มีช่องข้อความที่ตั้งต้นด้วยคำว่า `"ที่ทำการปกครองส่วนท้องถิ่น"` และสามารถพิมพ์แก้ไข/เพิ่มเติมชื่อหน่วยงานได้ (เช่น `"ที่ทำการปกครองส่วนท้องถิ่น อบต.โนนสูง"`)

5. **ระบบพิกัดทางภูมิศาสตร์ (GPS Location Service):**
   - ขอสิทธิ์เข้าถึงพิกัด GPS ผ่าน SweetAlert ในครั้งแรก และ**บันทึกสิทธิ์ไว้ในเครื่องไม่ต้องถามซ้ำทุกครั้ง**
   - อัปเดตพิกัดอัตโนมัติ **ทุก 10 วินาที**
   - แสดงพิกัดทศนิยม 6 ตำแหน่ง (เช่น `17.524635, 102.412326`) พร้อมปุ่มกด "เช็คพิกัดใหม่"

6. **ระบบถ่ายภาพและประทับลายน้ำ (Canvas Watermark):**
   - เปิดกล้องสดผ่าน WebRTC (สลับกล้องหน้า-หลังได้) พร้อม Fallback อัปโหลดภาพจากอุปกรณ์
   - **มุมซ้ายบน:** กราฟิกเข็มทิศ (Compass Overlay) แสดงทิศและองศา
   - **มุมซ้ายล่าง:** ภาพแผนที่ (Static Map Snapshot) พร้อมหมุดแดงตรงตำแหน่งพิกัดปัจจุบัน
   - **มุมขวาล่าง:** กล่องข้อมูลสีดำโปร่งแสง แสดง:
     - วัน/เดือน/ปี (พ.ศ.) และเวลาปัจจุบัน
     - พิกัด Lat/Lng + องศาทิศ (เช่น `17.4645°N 102.7993°E 0° N`)
     - ข้อมูลที่ตั้งส่งหมาย
     - ข้อมูลเลขคดี
   - **ตั้งชื่อไฟล์อัตโนมัติ:** แปลง `/` เป็น `-` เช่น `ผบE1245-2569.jpg` หรือ `ต2097-2569.jpg`
   - **ดาวน์โหลดลงเครื่องทันที:** บันทึกรูปลงเครื่องโทรศัพท์ทันทีที่ประทับลายน้ำเสร็จ

7. **การจัดเก็บข้อมูลบน Google Drive & Google Sheets:**
   - อัปโหลดไฟล์ภาพ (`.jpg`) และไฟล์ข้อความ (`.txt`) ไปยัง Google Drive โฟลเดอร์ที่กำหนด (`1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp`)
   - บันทึกประวัติข้อมูลลงใน Google Sheet: [https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo](https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo/edit?usp=sharing) ให้อัตโนมัติ

---

## 📁 โครงสร้างโปรเจกต์

```
slts/
├── index.html                   # หน้าเว็บหลัก Single Page Application
├── css/
│   └── style.css                # การจัดแต่งสไตล์เฉพาะ เรติเคิลกล้อง และฟอนต์
├── js/
│   ├── data.js                  # ฐานข้อมูล 20 อำเภอ และตำบลทั้งหมดในอุดรธานี
│   ├── compass.js               # จัดการเซนเซอร์วัดทิศและวาดกราฟิกเข็มทิศ
│   ├── map.js                   # จัดการภาพแผนที่สแนปช็อตพร้อมหมุดแดง
│   ├── watermark.js             # Canvas Engine รวมภาพและวาดข้อมูลลายน้ำ
│   └── app.js                   # ควบคุมการทำงานของ Form, GPS, Camera และ Upload
├── google-apps-script/
│   └── Code.gs                  # สคริปต์ Google Apps Script (Web App Backend)
└── README.md                    # เอกสารคู่มือการติดตั้งและการใช้งาน
```

---

## 🚀 วิธีการติดตั้งและเชื่อมต่อ Google Drive

### ขั้นตอนที่ 1: ติดตั้ง Google Apps Script
1. ไปที่ [Google Apps Script](https://script.google.com/) แล้วกดสร้าง **"New Project"** (โครงการใหม่)
2. ตั้งชื่อโครงการ เช่น `SLTS-UdonThani-Backend`
3. คัดลอกโค้ดทั้งหมดจากไฟล์ [`google-apps-script/Code.gs`](file:///c:/Users/UDTC_COM/Documents/antigravity/slts/google-apps-script/Code.gs) ไปวางทับในหน้าต่างแก้ไขโค้ด
   > **หมายเหตุ:** โค้ดนี้ได้ระบุ Folder ID `1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp` ไว้เรียบร้อยแล้ว
4. กดบันทึก (Ctrl + S หรือ ไอคอน 💾)

### ขั้นตอนที่ 2: Deploy เป็น Web App
1. คลิกปุ่ม **"Deploy" (การทำให้ใช้งานได้)** ที่มุมขวาบน -> เลือก **"New deployment" (การทำให้ใช้งานได้รายการใหม่)**
2. คลิกไอคอนรูปเฟือง ⚙️ ข้าง "Select type" -> เลือก **"Web app" (เว็บแอป)**
3. ตั้งค่าดังนี้:
   - **Description:** `Summons Tracking API v1`
   - **Execute as:** `Me (อีเมลของคุณ)`
   - **Who has access:** `Anyone (ทุกคน)`
4. คลิก **"Deploy"**
5. กด **"Authorize access" (ให้สิทธิ์การเข้าถึง)** -> เลือกบัญชี Google -> กด "Advanced" (ขั้นสูง) -> กด "Go to ... (unsafe)" -> กด "Allow" (อนุญาต)
6. คัดลอก **Web App URL** ที่ได้ (รูปแบบ: `https://script.google.com/macros/s/.../exec`)

### ขั้นตอนที่ 3: เชื่อมต่อในหน้าเว็บ
1. เปิดหน้าเว็บ `index.html` บนเบราว์เซอร์
2. คลิกไอคอนรูปเฟือง ⚙️ ที่มุมขวาบนของหน้าเว็บ
3. วาง Web App URL ที่คัดลอกมาลงในช่อง แล้วกด **"บันทึกการตั้งค่า"**
4. ระบบจะจดจำ URL นี้ไว้ในเครื่อง และพร้อมส่งข้อมูลขึ้น Google Drive ทันทีที่ถ่ายภาพส่งหมาย!

---

## 💻 การเปิดใช้งานแบบ Local / บนเครื่อง
ท่านสามารถเปิดไฟล์ `index.html` ผ่านเว็บเบราว์เซอร์ได้โดยตรง หรือรัน Local Server เช่น:

```powershell
# ใช้ Python Simple HTTP Server (ถ้ามี)
python -m http.server 8080
```
จากนั้นเปิดดูที่ `http://localhost:8080` บนเบราว์เซอร์ หรือเปิดผ่าน HTTPS เพื่อการเข้าถึงกล้องและ GPS อย่างเต็มรูปแบบ
>>>>>>> 4ead901 (feat: Initial commit for Summons Location Tracking System (SLTS))
