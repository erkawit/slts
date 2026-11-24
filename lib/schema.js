/**
 * lib/schema.js — โครงสร้างฐานข้อมูล SLTS บน Neon (สร้างอัตโนมัติ, รันซ้ำได้ปลอดภัย)
 * ไฟล์ SQL เดียวกันอยู่ที่ scripts/schema.sql (ใช้ดู/รันเองผ่าน psql ได้)
 */
const SCHEMA_SQL = `
BEGIN;
SELECT pg_advisory_xact_lock(727274);

-- ผู้ใช้งาน (รหัสผ่านเก็บแบบ scrypt hash เท่านั้น ไม่มี plaintext)
CREATE TABLE IF NOT EXISTS app_users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','local_advisor','user')),
  name               TEXT,
  court_category     TEXT DEFAULT 'ศาลจังหวัด',
  assigned_court     TEXT,
  assigned_province  TEXT DEFAULT 'อุดรธานี',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  disabled           BOOLEAN NOT NULL DEFAULT FALSE,
  token_version      INTEGER NOT NULL DEFAULT 1,
  created_at_text    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- บันทึกการส่งหมาย (แทนชีต "บันทึกการส่งหมาย") รูปภาพเก็บใน Google Drive อ้างอิงด้วย drive_file_id
CREATE TABLE IF NOT EXISTS summons (
  id                BIGSERIAL PRIMARY KEY,
  client_upload_id  TEXT UNIQUE,            -- กันอัปโหลดซ้ำเมื่อมือถือส่งซ้ำ (idempotency)
  recorded_at_text  TEXT,                   -- วัน-เวลาตามที่แสดงบนลายน้ำ (พ.ศ.)
  recorded_at       TIMESTAMPTZ,
  case_number       TEXT NOT NULL DEFAULT '',
  court_type        TEXT,
  province          TEXT,
  district          TEXT,
  subdistrict       TEXT,
  location_type     TEXT,
  location_text     TEXT,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,
  heading           TEXT,
  file_name         TEXT,
  drive_url         TEXT,
  text_url          TEXT,
  drive_file_id     TEXT,
  uploader          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_summons_case     ON summons (case_number);
CREATE INDEX IF NOT EXISTS idx_summons_file     ON summons (drive_file_id);
CREATE INDEX IF NOT EXISTS idx_summons_uploader ON summons (uploader);
CREATE INDEX IF NOT EXISTS idx_summons_alive    ON summons (id) WHERE deleted_at IS NULL;

-- ส่งต่อเส้นทางข้ามอุปกรณ์ / แชร์ให้ผู้ใช้อื่น (แทนชีต device_handoff)
CREATE TABLE IF NOT EXISTS route_handoffs (
  id              BIGSERIAL PRIMARY KEY,
  target_user     TEXT NOT NULL,             -- 1 แถวต่อผู้รับต่อช่อง (channel)
  from_user       TEXT,
  from_user_name  TEXT,
  type            TEXT NOT NULL DEFAULT 'handoff',
  status          TEXT NOT NULL DEFAULT 'pending',
  case_number     TEXT,
  full_address    TEXT,
  query_string    TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v2.2: แยก "เส้นทางที่ใช้งาน/ส่งไปมือถือ" (active) ออกจาก "แผนที่กำลังจัดบน PC" (draft)
-- เดิมใช้แถวเดียวกัน ทำให้ PC บันทึกแผนทับ แล้วเส้นทางที่มือถือล้างไปแล้วกลับมาอีก
-- v2.6.5: ชื่อ นามสกุล ตำแหน่ง สำหรับรายงานผลหมาย / จับคู่ผู้ส่งในตารางโซน
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS position TEXT NOT NULL DEFAULT '';
ALTER TABLE route_handoffs ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'active';
ALTER TABLE route_handoffs ADD COLUMN IF NOT EXISTS stops_sig TEXT;
ALTER TABLE route_handoffs ADD COLUMN IF NOT EXISTS cleared_keys JSONB;
ALTER TABLE route_handoffs ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
ALTER TABLE route_handoffs DROP CONSTRAINT IF EXISTS route_handoffs_target_user_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_handoffs_user_channel ON route_handoffs (target_user, channel);

-- รหัสแชร์เส้นทางแบบ QR Code
CREATE TABLE IF NOT EXISTS route_shares (
  code            TEXT PRIMARY KEY,
  created_by      TEXT NOT NULL,
  created_by_name TEXT,
  stops_count     INTEGER NOT NULL DEFAULT 0,
  payload         JSONB NOT NULL,
  open_count      INTEGER NOT NULL DEFAULT 0,
  last_opened_by  TEXT,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_shares_creator ON route_shares (created_by, created_at DESC);

-- ประวัติการใช้งาน (แทนไฟล์ map_activity_logs.log บน Drive)
CREATE TABLE IF NOT EXISTS activity_logs (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username    TEXT,
  role        TEXT,
  action_type TEXT,
  details     TEXT,
  extra       JSONB
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_logs (at DESC);

-- บันทึกจุดบกพร่อง (Bug / Error log) สำหรับแอดมิน
CREATE TABLE IF NOT EXISTS error_logs (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL DEFAULT 'client',   -- client | server
  app_version  TEXT,
  username     TEXT,
  device       TEXT,
  url          TEXT,
  message      TEXT,
  stack        TEXT,
  context      JSONB,
  fingerprint  TEXT,
  occurrences  INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','investigating','fixed','ignored')),
  admin_note   TEXT,
  resolved_by  TEXT,
  resolved_at  TIMESTAMPTZ,
  fixed_in_version TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_fp_open ON error_logs (fingerprint) WHERE status IN ('new','investigating');
CREATE INDEX IF NOT EXISTS idx_error_at ON error_logs (last_seen_at DESC);

-- ไฟล์ภาพถ่ายเก็บใน Neon (ใช้เมื่อไม่ได้ตั้งค่า Google Drive) — อ้างอิงจาก summons.drive_file_id = 'db-<id>-<sig>'
CREATE TABLE IF NOT EXISTS photo_files (
  id          BIGSERIAL PRIMARY KEY,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes  INTEGER NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ประวัติเวอร์ชันระบบ
CREATE TABLE IF NOT EXISTS app_releases (
  version     TEXT PRIMARY KEY,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title       TEXT,
  notes       JSONB
);

COMMIT;
`;

module.exports = { SCHEMA_SQL };
