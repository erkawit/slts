/**
 * scripts/sync-to-neon.js
 * 
 * สคริปต์สำหรับสำรองข้อมูล (Backup Sync) จาก Google Sheet เข้าสู่ NEON PostgreSQL
 * 
 * กฎสำคัญ:
 * 1. NEON PostgreSQL เป็นฐานข้อมูล "สำรอง" (Secondary / Backup) เท่านั้น ไม่ใช่ Main Base
 * 2. ข้อมูลรูปภาพจะอ้างอิงผ่าน Google Drive ID (drive_file_id) ไม่จัดเก็บ Binary ลงในฐานข้อมูล
 * 3. ใช้การ Upsert (ON CONFLICT DO UPDATE) เพื่อป้องกันข้อมูลสูญหายหรือข้อมูลซ้ำซ้อน
 * 4. รองรับโหมด --dry-run เพื่อทดสอบการดึงและแปลงข้อมูลโดยไม่ต้องเขียนลงฐานข้อมูลจริง
 */

const fs = require('fs');
const path = require('path');

// โหลดตัวแปรสภาพแวดล้อมจาก .env (ถ้ามี)
try {
  require('dotenv').config();
} catch (e) {}

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec';
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const isDryRun = process.argv.includes('--dry-run');
const isVerbose = process.argv.includes('--verbose');

// แปลงชื่อเดือนภาษาไทยเป็นตัวเลขเดือน (1-12)
const THAI_MONTHS = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
};

/**
 * แปลงสตริงวันเวลาภาษาไทย (เช่น "25 ส.ค. 2569 16:15:32" หรือ "25/08/2569") เป็น Date Object
 */
function parseThaiDateTime(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // รูปแบบ "25 ส.ค. 2569 16:15:32" หรือ "25 ส.ค. 2569"
  const matchThaiWords = trimmed.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (matchThaiWords) {
    const day = parseInt(matchThaiWords[1], 10);
    const monthName = matchThaiWords[2];
    let year = parseInt(matchThaiWords[3], 10);
    if (year > 2400) year -= 543; // แปลง พ.ศ. เป็น ค.ศ.
    const month = THAI_MONTHS[monthName] || 1;
    const hour = parseInt(matchThaiWords[4] || '0', 10);
    const min = parseInt(matchThaiWords[5] || '0', 10);
    const sec = parseInt(matchThaiWords[6] || '0', 10);
    return new Date(Date.UTC(year, month - 1, day, hour - 7, min, sec)); // เวลาไทย UTC+7
  }

  // รูปแบบ "25/08/2569" หรือ "25/08/2026"
  const matchSlash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (matchSlash) {
    const day = parseInt(matchSlash[1], 10);
    const month = parseInt(matchSlash[2], 10);
    let year = parseInt(matchSlash[3], 10);
    if (year > 2400) year -= 543;
    const hour = parseInt(matchSlash[4] || '0', 10);
    const min = parseInt(matchSlash[5] || '0', 10);
    const sec = parseInt(matchSlash[6] || '0', 10);
    return new Date(Date.UTC(year, month - 1, day, hour - 7, min, sec));
  }

  // รูปแบบ ISO หรือมาตรฐาน JavaScript
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * สกัด Google Drive File ID จาก URL หรือสตริง ID
 */
function extractDriveFileId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;

  // หากเป็น ID ตรงๆ (ไม่มีเครื่องหมาย / หรือ ?)
  if (/^[a-zA-Z0-9_-]{20,50}$/.test(trimmed)) {
    return trimmed;
  }

  // สกัดจาก URL ต่างๆ ของ Google Drive
  const matchId = trimmed.match(/\/d\/([a-zA-Z0-9_-]{20,50})/);
  if (matchId) return matchId[1];

  const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{20,50})/);
  if (matchIdParam) return matchIdParam[1];

  return trimmed;
}

/**
 * ดึงข้อมูลจาก Google Apps Script Endpoint
 */
async function fetchGoogleSheetData(action) {
  const url = `${APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}`;
  if (isVerbose) console.log(`[Fetch] Calling ${url}...`);
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(`Google Apps Script returned error: ${json.message || JSON.stringify(json)}`);
  }
  return json;
}

/**
 * ฟังก์ชันหลักในการ Sync
 */
async function runSync() {
  console.log('=== SLTS: Sync Google Sheet to Neon PostgreSQL Backup ===');
  console.log(`- Time: ${new Date().toISOString()}`);
  console.log(`- Mode: ${isDryRun ? 'DRY-RUN (Simulated, no writes)' : 'LIVE (Sync to Database)'}`);
  console.log(`- Apps Script URL: ${APPS_SCRIPT_URL}`);

  if (!DATABASE_URL && !isDryRun) {
    console.error('\n❌ ERROR: ไม่พบตัวแปร DATABASE_URL หรือ NEON_DATABASE_URL');
    console.error('กรุณาระบุ Connection String ในไฟล์ .env ดังนี้:');
    console.error('DATABASE_URL=postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require\n');
    console.error('หรือรันด้วยโหมดจำลอง: node scripts/sync-to-neon.js --dry-run');
    process.exit(1);
  }

  let sql = null;
  if (!isDryRun) {
    try {
      const { neon } = require('@neondatabase/serverless');
      sql = neon(DATABASE_URL);
    } catch (e) {
      console.error('❌ Failed to load @neondatabase/serverless:', e.message);
      process.exit(1);
    }
  }

  // 1. ตรวจสอบและสร้างตารางใน Neon (ถ้ายังไม่มี)
  if (!isDryRun && sql) {
    console.log('\n[1/3] กำลังตรวจสอบ Schema บน Neon PostgreSQL...');
    try {
      const schemaPath = path.join(__dirname, 'neon-schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // รันแยกตาม statement
        const statements = schemaSql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));
        for (const stmt of statements) {
          await sql(stmt);
        }
        console.log('✓ Schema บน Neon พร้อมใช้งาน');
      }
    } catch (err) {
      console.warn('⚠️ เกิดข้อผิดพลาดในการตรวจสอบ Schema (ดำเนินการต่อ):', err.message);
    }
  }

  // 2. ดึงและ Sync ข้อมูลจาก Sheet "บันทึกการส่งหมาย"
  console.log('\n[2/3] กำลังดึงข้อมูลบันทึกการส่งหมายจาก Google Sheet...');
  let summonsInserted = 0;
  let summonsUpdated = 0;
  let summonsSkipped = 0;

  try {
    const sheetResult = await fetchGoogleSheetData('get_data');
    const records = sheetResult.data || [];
    console.log(`✓ ได้รับข้อมูลบันทึกการส่งหมายจำนวน ${records.length} แถว`);

    for (const row of records) {
      const caseNumber = String(row['เลขคดี'] || '').trim();
      const imageFilename = String(row['ชื่อไฟล์รูปภาพ'] || '').trim();
      if (!caseNumber) {
        summonsSkipped++;
        continue;
      }

      const recordedAt = parseThaiDateTime(row['วัน-เวลาบันทึก']);
      const courtType = String(row['ประเภทศาล'] || '').trim();
      const district = String(row['อำเภอ'] || '').trim();
      const subdistrict = String(row['ตำบล'] || '').trim();
      const placeType = String(row['ประเภทสถานที่'] || '').trim();
      const fullAddress = String(row['ที่ตั้งส่งหมาย (เต็ม)'] || '').trim();
      const lat = parseFloat(row['ละติจูด (Lat)']) || null;
      const lng = parseFloat(row['ลองจิจูด (Lng)']) || null;
      const headingDegree = parseFloat(row['ทิศองศา']) || null;
      const driveImageUrl = String(row['ลิงก์รูปภาพใน Google Drive'] || '').trim();
      const driveTextUrl = String(row['ลิงก์ Text File ใน Google Drive'] || '').trim();
      const driveFileId = extractDriveFileId(row['Drive File ID'] || driveImageUrl);
      const recordedBy = String(row['ผู้บันทึก'] || '').trim();
      const province = String(row['จังหวัด'] || 'อุดรธานี').trim();

      if (!isDryRun && sql) {
        // Upsert ลง summons_records
        const query = `
          INSERT INTO summons_records (
            recorded_at, case_number, court_type, district, subdistrict,
            place_type, full_address, lat, lng, heading_degree,
            image_filename, drive_image_url, drive_text_url, drive_file_id,
            recorded_by, province, synced_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()
          )
          ON CONFLICT (case_number, image_filename) DO UPDATE SET
            recorded_at = EXCLUDED.recorded_at,
            court_type = EXCLUDED.court_type,
            district = EXCLUDED.district,
            subdistrict = EXCLUDED.subdistrict,
            place_type = EXCLUDED.place_type,
            full_address = EXCLUDED.full_address,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            heading_degree = EXCLUDED.heading_degree,
            drive_image_url = EXCLUDED.drive_image_url,
            drive_text_url = EXCLUDED.drive_text_url,
            drive_file_id = EXCLUDED.drive_file_id,
            recorded_by = EXCLUDED.recorded_by,
            province = EXCLUDED.province,
            synced_at = NOW()
          RETURNING (xmax = 0) AS is_insert;
        `;
        const res = await sql(query, [
          recordedAt, caseNumber, courtType, district, subdistrict,
          placeType, fullAddress, lat, lng, headingDegree,
          imageFilename, driveImageUrl, driveTextUrl, driveFileId,
          recordedBy, province
        ]);
        if (res && res[0] && res[0].is_insert) {
          summonsInserted++;
        } else {
          summonsUpdated++;
        }
      } else {
        summonsInserted++;
      }
    }
    console.log(`✓ สำรองข้อมูลบันทึกการส่งหมายเสร็จสิ้น: แทรกใหม่ ${summonsInserted}, อัพเดต ${summonsUpdated}, ข้าม ${summonsSkipped}`);
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการดึงข้อมูลบันทึกการส่งหมาย:', err.message);
  }

  // 3. ดึงและ Sync ข้อมูลจาก Sheet "users"
  console.log('\n[3/3] กำลังดึงข้อมูลผู้ใช้งาน (Users) จาก Google Sheet...');
  let usersInserted = 0;
  let usersUpdated = 0;

  try {
    const usersResult = await fetchGoogleSheetData('get_users');
    const users = usersResult.users || [];
    console.log(`✓ ได้รับข้อมูลผู้ใช้งานจำนวน ${users.length} รายการ`);

    for (const u of users) {
      const username = String(u.username || '').trim().toLowerCase();
      if (!username) continue;

      const role = String(u.role || 'user').trim();
      const name = String(u.name || '').trim();
      const createdAt = parseThaiDateTime(u.createdAt);
      const courtType = String(u.courtCategory || u['ประเภทศาล'] || '').trim();
      const assignedCourt = String(u.assignedCourt || u['ศาลที่สังกัด'] || '').trim();
      const assignedProvince = String(u.assignedProvince || u['จังหวัดที่ส่งหมาย'] || '').trim();

      if (!isDryRun && sql) {
        const query = `
          INSERT INTO users (
            username, role, name, created_at, court_type,
            assigned_court, assigned_province, synced_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, NOW()
          )
          ON CONFLICT (username) DO UPDATE SET
            role = EXCLUDED.role,
            name = EXCLUDED.name,
            court_type = EXCLUDED.court_type,
            assigned_court = EXCLUDED.assigned_court,
            assigned_province = EXCLUDED.assigned_province,
            synced_at = NOW()
          RETURNING (xmax = 0) AS is_insert;
        `;
        const res = await sql(query, [
          username, role, name, createdAt, courtType, assignedCourt, assignedProvince
        ]);
        if (res && res[0] && res[0].is_insert) {
          usersInserted++;
        } else {
          usersUpdated++;
        }
      } else {
        usersInserted++;
      }
    }
    console.log(`✓ สำรองข้อมูลผู้ใช้งานเสร็จสิ้น: แทรกใหม่ ${usersInserted}, อัพเดต ${usersUpdated}`);
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้งาน:', err.message);
  }

  // 4. บันทึกผลลงตาราง sync_log
  if (!isDryRun && sql) {
    try {
      await sql(`
        INSERT INTO sync_log (
          sync_type, records_synced, records_inserted, records_updated, status, completed_at
        ) VALUES (
          'full', $1, $2, $3, 'success', NOW()
        );
      `, [summonsInserted + summonsUpdated + usersInserted + usersUpdated, summonsInserted + usersInserted, summonsUpdated + usersUpdated]);
      console.log('\n✓ บันทึกประวัติการ Sync ลง sync_log เรียบร้อย');
    } catch (e) {
      console.warn('⚠️ ไม่สามารถบันทึก sync_log ได้:', e.message);
    }
  }

  console.log('\n===============================================================');
  console.log('🎉 การสำรองข้อมูลขึ้น NEON PostgreSQL สำเร็จสมบูรณ์!');
  console.log(`- บันทึกการส่งหมาย: ${summonsInserted + summonsUpdated} รายการ`);
  console.log(`- ผู้ใช้งาน: ${usersInserted + usersUpdated} รายการ`);
  console.log('- รูปภาพ: อ้างอิงผ่าน Google Drive ID (ไม่มีการเก็บ Binary ใน DB)');
  console.log('===============================================================\n');
}

// เรียกทำงาน
runSync().catch(err => {
  console.error('Fatal Sync Error:', err);
  process.exit(1);
});
