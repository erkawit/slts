-- SLTS v2 schema (สร้างจาก lib/schema.js — แก้ที่ lib/schema.js แล้วรัน npm run schema:export)
BEGIN;
SELECT pg_advisory_xact_lock(727274);

-- ผู้ใช้งาน (รหัสผ่านเก็บแบบ scrypt hash เท่านั้น ไม่มี plaintext)
CREATE TABLE IF NOT EXISTS app_users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
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
  target_user     TEXT NOT NULL UNIQUE,      -- 1 แถวต่อผู้รับ (เส้นทางล่าสุด) เหมือนชีตเดิม
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

-- ประวัติเวอร์ชันระบบ
CREATE TABLE IF NOT EXISTS app_releases (
  version     TEXT PRIMARY KEY,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title       TEXT,
  notes       JSONB
);

COMMIT;
