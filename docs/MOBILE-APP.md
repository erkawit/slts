# ทำแอป Android (APK) และ iOS ด้วย Capacitor

โปรเจกต์มี Capacitor 8 และโฟลเดอร์ `android/` อยู่แล้ว (appId `com.udoncourt.summonstracker`)
แอปจะห่อหน้าเว็บในโฟลเดอร์ `public/` แล้วเรียก API บน Vercel

## 0) ตั้งค่าให้แอปรู้ที่อยู่เซิร์ฟเวอร์ (ต้องทำก่อน build)

แก้ `js/config.js`:

```js
window.SLTS_CONFIG = Object.assign({
  API_BASE: 'https://<โดเมน-vercel-ของคุณ>',       // เช่น https://slts.vercel.app
  PUBLIC_WEB_URL: 'https://<โดเมน-vercel-ของคุณ>', // ลิงก์ที่ฝังใน QR แชร์เส้นทาง
  ...
```

> บนเว็บ (Vercel) ปล่อยว่างได้ แต่ในแอปต้องใส่ เพราะไฟล์หน้าเว็บอยู่ในเครื่อง
> แอดมินแก้ภายหลังได้ที่ เมนู → ศูนย์ผู้ดูแลระบบ → สถานะระบบ → ที่อยู่เซิร์ฟเวอร์

ติดตั้งปลั๊กอินบันทึกไฟล์ (ให้ภาพถ่ายถูกบันทึกลงโฟลเดอร์ Documents/SLTS ในเครื่องด้วย):

```bash
npm i @capacitor/filesystem
```

## 1) Android → APK

ต้องมี: Android Studio (มี JDK 17+ และ Android SDK มาให้)

```bash
npm run cap:android          # build หน้าเว็บ → sync → เปิด Android Studio
```

ใน Android Studio:
- **ทดสอบเร็ว (Debug APK):** Build → Build App Bundle(s)/APK(s) → Build APK(s)
  ไฟล์อยู่ที่ `android/app/build/outputs/apk/debug/app-debug.apk` → ส่งไฟล์ให้เครื่องอื่นติดตั้งได้ (ต้องเปิด "ติดตั้งจากแหล่งที่ไม่รู้จัก")
- หรือใช้คำสั่ง: `npm run build:apk` (macOS/Linux) / `npm run build:apk:win` (Windows)

**APK สำหรับใช้งานจริง (Release, เซ็นชื่อ):**
1. Build → Generate Signed Bundle / APK → APK → Create new keystore (เก็บไฟล์ `.jks` และรหัสไว้ให้ดี — หายแล้วอัปเดตแอปเดิมไม่ได้)
2. เลือก `release` → ได้ `app-release.apk`
3. ถ้าจะลง Google Play ให้เลือก **Android App Bundle (.aab)** แทน และสมัคร Google Play Console (ค่าสมัคร 25 USD ครั้งเดียว)

**เลขเวอร์ชันแอป:** `npm run version:bump -- patch "รายละเอียด"` จะอัปเดต `versionName`/`versionCode` ใน `android/app/build.gradle` ให้อัตโนมัติ (versionCode = MAJOR×10000 + MINOR×100 + PATCH)

สิทธิ์ที่ประกาศไว้แล้วใน `AndroidManifest.xml`: INTERNET, CAMERA, ACCESS_FINE/COARSE_LOCATION

## 2) iOS

ต้องมี: Mac + Xcode (จาก App Store) + CocoaPods (`sudo gem install cocoapods` หรือ `brew install cocoapods`)

```bash
npm i @capacitor/ios
npx cap add ios              # สร้างโฟลเดอร์ ios/ (ครั้งแรกครั้งเดียว)
npm run cap:ios              # build → sync → เปิด Xcode
```

ใน Xcode → `App` target:
1. **Signing & Capabilities:** เลือก Team (Apple ID ฟรีติดตั้งลงเครื่องตัวเองได้ 7 วัน; ใช้งานจริง/แจกจ่ายต้องสมัคร Apple Developer Program 99 USD/ปี)
2. **Info.plist** เพิ่มคำอธิบายสิทธิ์ (ถ้าไม่มี แอปจะถูกปิดทันทีเมื่อขอสิทธิ์):
   - `NSCameraUsageDescription` = ใช้กล้องถ่ายภาพหลักฐานการส่งหมายและสแกน QR เส้นทาง
   - `NSLocationWhenInUseUsageDescription` = ใช้พิกัด GPS ระบุตำแหน่งที่ส่งหมาย
   - `NSPhotoLibraryAddUsageDescription` = บันทึกภาพส่งหมายลงคลังภาพในเครื่อง
3. เสียบ iPhone → Run ▶︎ (หรือ Product → Archive → Distribute: TestFlight / Ad Hoc / Enterprise)

## 3) ลิงก์ QR เปิดแอปโดยตรง (ไม่บังคับ)

ตอนนี้ QR เป็นลิงก์ `https://<โดเมน>/?share=รหัส` — สแกนด้วยกล้องมือถือปกติจะเปิดเว็บและนำเข้าเส้นทางให้
ถ้าต้องการให้เปิด "แอป" แทนเว็บ ให้ตั้ง Android App Links (`assetlinks.json`) และ iOS Universal Links (`apple-app-site-association`) บนโดเมน Vercel
แล้วเพิ่ม `@capacitor/app` เพื่อรับ event `appUrlOpen` และเรียก `SLTSUI.importShareCode(url)`
(ปุ่ม "สแกน QR" ในแอปใช้งานได้เลยโดยไม่ต้องตั้งค่านี้)

## 4) อัปเดตแอปหลังแก้โค้ด

```bash
npm run version:bump -- patch "แก้ไข ..."
npm run cap:sync               # คัดลอกไฟล์เว็บล่าสุดเข้าแอป
# แล้ว build APK / Archive ใหม่
```

เว็บบน Vercel อัปเดตทันทีเมื่อ deploy (มือถือที่เปิดเว็บจะเห็นแจ้งเตือน "มีอัปเดตระบบ")
ส่วนแอปที่ติดตั้งแล้วจะแจ้ง "โปรดอัปเดตแอป" เมื่อเวอร์ชันบนเซิร์ฟเวอร์ใหม่กว่า
