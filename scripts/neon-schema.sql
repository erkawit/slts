-- ================================================================
-- SLTS Neon PostgreSQL Backup Database Schema
-- ฐานข้อมูลสำรอง สำหรับ Sync ข้อมูลจาก Google Sheet มาเก็บไว้ใน Neon
-- รูปภาพอ้างอิงจาก Google Drive File ID เท่านั้น (ไม่เก็บ Binary ใน DB)
-- ================================================================

-- ตาราง summons_records: สำรองข้อมูลจากชีต "บันทึกการส่งหมาย"
CREATE TABLE IF NOT EXISTS summons_records (
  id SERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ,                -- วัน-เวลาบันทึก
  case_number TEXT NOT NULL,              -- เลขคดี
  court_type TEXT,                        -- ประเภทศาล
  district TEXT,                          -- อำเภอ
  subdistrict TEXT,                       -- ตำบล
  place_type TEXT,                        -- ประเภทสถานที่
  full_address TEXT,                      -- ที่ตั้งส่งหมาย (เต็ม)
  lat DOUBLE PRECISION,                   -- ละติจูด
  lng DOUBLE PRECISION,                   -- ลองจิจูด
  heading_degree DOUBLE PRECISION,        -- ทิศองศา
  image_filename TEXT,                    -- ชื่อไฟล์รูปภาพ
  drive_image_url TEXT,                   -- ลิงก์รูปภาพใน Google Drive
  drive_text_url TEXT,                    -- ลิงก์ Text File ใน Google Drive
  drive_file_id TEXT,                     -- Google Drive File ID (อ้างอิงรูป)
  recorded_by TEXT,                       -- ผู้บันทึก
  province TEXT,                          -- จังหวัด
  synced_at TIMESTAMPTZ DEFAULT NOW(),    -- เวลาที่ Sync เข้า Neon ครั้งล่าสุด
  UNIQUE(case_number, image_filename)     -- ป้องกัน Duplicate
);

-- ตาราง users: สำรองข้อมูลจากชีต "users"
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT DEFAULT 'user',
  name TEXT,
  created_at TIMESTAMPTZ,
  court_type TEXT,                        -- ประเภทศาล
  assigned_court TEXT,                    -- ศาลที่สังกัด
  assigned_province TEXT,                 -- จังหวัดที่ส่งหมาย
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตาราง sync_log: บันทึกประวัติการ Sync ทุกครั้ง
CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL,                -- 'summons' | 'users' | 'full'
  records_synced INTEGER DEFAULT 0,       -- จำนวนแถวที่ Sync
  records_inserted INTEGER DEFAULT 0,     -- จำนวนแถวที่เพิ่มใหม่
  records_updated INTEGER DEFAULT 0,      -- จำนวนแถวที่อัพเดต
  status TEXT DEFAULT 'success',          -- 'success' | 'error'
  error_message TEXT,                     -- ข้อความ Error (ถ้ามี)
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes สำหรับค้นหาเร็ว
CREATE INDEX IF NOT EXISTS idx_summons_case ON summons_records(case_number);
CREATE INDEX IF NOT EXISTS idx_summons_province ON summons_records(province);
CREATE INDEX IF NOT EXISTS idx_summons_recorded_at ON summons_records(recorded_at);
CREATE INDEX IF NOT EXISTS idx_summons_drive_file_id ON summons_records(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(sync_type);
