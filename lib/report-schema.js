/**
 * lib/report-schema.js — ตารางของ "ระบบรายงานผลหมาย" (ผนวกรวมจาก summon-report) บน Neon
 * ใช้คำนำหน้า sr_ เพื่อไม่ชนกับตารางเดิมของ SLTS — รันซ้ำได้ปลอดภัย (idempotent)
 */
const REPORT_SCHEMA_SQL = `
BEGIN;
SELECT pg_advisory_xact_lock(727275);

-- ค่าตั้งค่าระบบรายงาน (หัวประกาศอัตรา, หมายเหตุ, ค่าเริ่มต้นต่างๆ)
CREATE TABLE IF NOT EXISTS sr_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- อัตราค่านำหมาย (หมายเงิน = paid / หมายฟรี = free)
CREATE TABLE IF NOT EXISTS sr_rates (
  id             BIGSERIAL PRIMARY KEY,
  rate_type      TEXT NOT NULL CHECK (rate_type IN ('paid','free')),
  district       TEXT NOT NULL,
  subdistrict    TEXT NOT NULL,
  exception_note TEXT NOT NULL DEFAULT '',
  rate_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sr_rates_type ON sr_rates (rate_type, district, subdistrict);

-- คำสั่งศาลแต่งตั้งเจ้าพนักงาน (รายงานใหม่ใช้ฉบับล่าสุด รายงานเดิมล็อกฉบับเดิม)
CREATE TABLE IF NOT EXISTS sr_court_orders (
  id         BIGSERIAL PRIMARY KEY,
  order_text TEXT NOT NULL,
  order_no   TEXT NOT NULL DEFAULT '',
  order_date TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- รายชื่อผู้ลงนาม: ผู้ตรวจ / ผู้จ่ายเงิน / ผู้อำนวยการ / เจ้าหน้าที่เสนอ (บันทึกข้อความ)
CREATE TABLE IF NOT EXISTS sr_signers (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('inspector','payer','director','officer')),
  full_name    TEXT NOT NULL,
  position     TEXT NOT NULL DEFAULT '',
  acting       BOOLEAN NOT NULL DEFAULT FALSE,     -- ปฏิบัติราชการแทน / รักษาราชการแทน
  acting_title TEXT NOT NULL DEFAULT '',           -- เช่น "ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี"
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sr_signers_kind ON sr_signers (kind, is_default DESC, id);

-- ไฟล์ Excel ที่นำเข้า (บัญชีจ่ายหมาย / บัญชีใบเสร็จ)
CREATE TABLE IF NOT EXISTS sr_batches (
  id           BIGSERIAL PRIMARY KEY,
  owner        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'issued',
  source_file  TEXT NOT NULL DEFAULT '',
  period_start TEXT NOT NULL DEFAULT '',
  period_end   TEXT NOT NULL DEFAULT '',
  item_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- รายการจ่ายหมาย (1 แถว = 1 หมาย/ผู้รับ) + ข้อมูลรายงานผลหมายที่กรอก
CREATE TABLE IF NOT EXISTS sr_issued (
  id            BIGSERIAL PRIMARY KEY,
  owner         TEXT NOT NULL,
  batch_id      BIGINT REFERENCES sr_batches(id) ON DELETE SET NULL,
  dedupe_key    TEXT NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL DEFAULT 'LOCAL' CHECK (kind IN ('LOCAL','T')),
  t_no          TEXT NOT NULL DEFAULT '',
  black_no      TEXT NOT NULL DEFAULT '',
  red_no        TEXT NOT NULL DEFAULT '',
  plaintiff     TEXT NOT NULL DEFAULT '',
  defendant     TEXT NOT NULL DEFAULT '',
  summon_type   TEXT NOT NULL DEFAULT '',
  recipient     TEXT NOT NULL DEFAULT '',
  address_raw   TEXT NOT NULL DEFAULT '',
  house_no      TEXT NOT NULL DEFAULT '',
  moo           TEXT NOT NULL DEFAULT '',
  soi           TEXT NOT NULL DEFAULT '',
  road          TEXT NOT NULL DEFAULT '',
  subdistrict   TEXT NOT NULL DEFAULT '',
  district      TEXT NOT NULL DEFAULT '',
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,
  money_type    TEXT NOT NULL DEFAULT 'free' CHECK (money_type IN ('paid','free')),
  server_name   TEXT NOT NULL DEFAULT '',
  payer_court   TEXT NOT NULL DEFAULT '',
  result_text   TEXT NOT NULL DEFAULT '',
  receipt_ref   TEXT NOT NULL DEFAULT '',
  entry_date    TEXT NOT NULL DEFAULT '',
  period_start  TEXT NOT NULL DEFAULT '',
  period_end    TEXT NOT NULL DEFAULT '',
  report        JSONB,
  report_status TEXT NOT NULL DEFAULT 'none' CHECK (report_status IN ('none','saved','printed')),
  reported_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_issued_key ON sr_issued (owner, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_sr_issued_owner ON sr_issued (owner, period_end DESC, seq);

-- บันทึกข้อความขออนุมัติเบิก (หมายฟรี/หมายเงิน) + ใบสำคัญรับเงินหมายฟรี (จาก summon-report)
CREATE TABLE IF NOT EXISTS sr_memos (
  id                BIGSERIAL PRIMARY KEY,
  report_type       TEXT NOT NULL CHECK (report_type IN ('free','paid')),
  round_label       TEXT NOT NULL DEFAULT '',
  doc_no            TEXT NOT NULL DEFAULT '',
  doc_date          TEXT NOT NULL DEFAULT '',
  order_id          BIGINT,
  order_text        TEXT NOT NULL DEFAULT '',
  period_start      TEXT NOT NULL DEFAULT '',
  period_end        TEXT NOT NULL DEFAULT '',
  item_count        INTEGER NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_text       TEXT NOT NULL DEFAULT '',
  reporter_name     TEXT NOT NULL DEFAULT '',
  reporter_position TEXT NOT NULL DEFAULT '',
  reporter_address  TEXT NOT NULL DEFAULT '',
  officer_name      TEXT NOT NULL DEFAULT '',
  officer_position  TEXT NOT NULL DEFAULT '',
  director_name     TEXT NOT NULL DEFAULT '',
  director_acting   TEXT NOT NULL DEFAULT '',
  payer_name        TEXT NOT NULL DEFAULT '',
  payer_position    TEXT NOT NULL DEFAULT '',
  receipt_date      TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sr_memo_items (
  id             BIGSERIAL PRIMARY KEY,
  memo_id        BIGINT NOT NULL REFERENCES sr_memos(id) ON DELETE CASCADE,
  issued_id      BIGINT,
  seq            INTEGER NOT NULL DEFAULT 1,
  case_prefix    TEXT NOT NULL DEFAULT 'คดีดำ',
  case_no        TEXT NOT NULL DEFAULT '',
  issue_date     TEXT NOT NULL DEFAULT '',
  serve_date     TEXT NOT NULL DEFAULT '',
  summon_type    TEXT NOT NULL DEFAULT '',
  recipient_role TEXT NOT NULL DEFAULT '',
  house_no       TEXT NOT NULL DEFAULT '',
  moo            TEXT NOT NULL DEFAULT '',
  subdistrict    TEXT NOT NULL DEFAULT '',
  district       TEXT NOT NULL DEFAULT '',
  province       TEXT NOT NULL DEFAULT 'จ.อุดรธานี',
  base_rate      NUMERIC(10,2) NOT NULL DEFAULT 0,
  claim_rate     NUMERIC(10,2) NOT NULL DEFAULT 0,
  calc_rule      TEXT NOT NULL DEFAULT 'full'
);
CREATE INDEX IF NOT EXISTS idx_sr_memo_items ON sr_memo_items (memo_id, seq);

COMMIT;

-- โซนจ่ายหมายของผู้ใช้ (หมุนเวียนทุก 2 สัปดาห์ นับจาก anchor = วันจันทร์ที่เริ่มโซน)
CREATE TABLE IF NOT EXISTS sr_zone_state (
  username   TEXT PRIMARY KEY,
  zone_key   TEXT NOT NULL,
  anchor     TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sr_zone_state ADD COLUMN IF NOT EXISTS preset_id BIGINT;
-- Pre-set โซนจ่ายหมาย (ผู้ใช้ตั้งเอง; มีได้หลายชุด เลือกใช้ทีละชุด)
-- zones = [{ id, name, subdistricts:[ตำบลในอำเภอเมือง], districts:[อำเภออื่น] }] ตามลำดับหมุนเวียน
CREATE TABLE IF NOT EXISTS sr_zone_presets (
  id         BIGSERIAL PRIMARY KEY,
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  province   TEXT NOT NULL DEFAULT '',
  muang      TEXT NOT NULL DEFAULT '',
  zones      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sr_zone_presets_owner_idx ON sr_zone_presets (owner);
-- v2.6: Pre-set ใช้ร่วมกันทั้งศาล + ผู้ส่งประจำโซน (roster) ที่เลื่อนลงทีละ 1 โซนทุก 2 สัปดาห์
-- roster = { period_start, period_end, assign: { zoneId: { sender, sender_username, backup, backup_username } } }
ALTER TABLE sr_zone_presets ADD COLUMN IF NOT EXISTS roster JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sr_zone_presets ADD COLUMN IF NOT EXISTS source_file TEXT NOT NULL DEFAULT '';
ALTER TABLE sr_zone_presets ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS sr_zone_log (
  id            BIGSERIAL PRIMARY KEY,
  preset_id     BIGINT NOT NULL,
  action        TEXT NOT NULL,
  roster_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  roster_after  JSONB NOT NULL DEFAULT '{}'::jsonb,
  undone        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sr_zone_log_preset_idx ON sr_zone_log (preset_id, id);
-- v2.6.3: การเบิกหมายฟรีรายหมาย { mode: 'none'|'full'|'half' (ที่ผู้ใช้เลือก), eff: 'full'|'half' (ตามกฎ), amount, base, at, by }
ALTER TABLE sr_issued ADD COLUMN IF NOT EXISTS free_claim JSONB NOT NULL DEFAULT '{}'::jsonb;
`;

/** ค่าเริ่มต้น (ตามแบบฟอร์มเดิมของ summon-report / ศาลจังหวัดอุดรธานี) */
const DEFAULT_SETTINGS = {
  court_name: 'ศาลจังหวัดอุดรธานี',
  reporter_address: '2 ถ.อธิบดี ตำบลหมากแข้ง อำเภอเมือง จังหวัดอุดรธานี',
  director_title: 'ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี',
  doc_digits: 'thai',
  paid_header: 'อัตราค่านำส่งคำคู่ความและเอกสารทางคดีของศาลจังหวัดอุดรธานี เริ่มใช้ตั้งแต่วันที่ 1 ตุลาคม 2567 เป็นต้นไป',
  paid_notes: 'หมายเหตุ กรณีจำเลยหลายคนในคดีเดียวกัน\n1. มีผู้รับคำคู่ความหรือเอกสารหลายคนและระบุที่อยู่เดียวกัน ให้นำส่งหมายเดียวไม่ต้องวางเงินนำส่งเพิ่ม\n2. มีผู้รับคำคู่ความหรือเอกสารหลายคนระบุภูมิลำเนาอยู่หมู่เดียวกัน และไม่ใช่เลขที่บ้านเดียวกัน ให้วางเงินนำส่งเพิ่มรายละ 200 บาท (ยกเว้นตำบลหมากแข้งวางแยกหมาย)\n3. มีผู้รับคำคู่ความหรือเอกสารหลายคน มีภูมิลำเนาอยู่ตำบลเดียวกันแต่อยู่คนละหมู่ ให้วางเงินนำส่งแยกหมาย',
  free_header_1: 'บัญชีแนบท้ายประกาศศาลจังหวัดอุดรธานี',
  free_header_2: 'เรื่อง กำหนดอัตราค่าพาหนะและค่าป่วยการในการส่งคำคู่ความและเอกสารทางคดี ฉบับลงวันที่ 20 กันยายน 2567',
  free_header_3: 'อัตราค่านำส่งคำคู่ความและหรือเอกสารโดยเจ้าพนักงานศาล (หมายศาล) เริ่มใช้ตั้งแต่วันที่ 12 มกราคม 2569 เป็นต้นไป',
  free_notes: 'หมายเหตุ การเบิกจ่ายค่าตอบแทนในการส่งคำคู่ความหรือเอกสารโดยเจ้าพนักงานศาล ให้เป็นไปตามระเบียบคณะกรรมการบริหารศาลยุติธรรม ว่าด้วยค่าตอบแทนในการส่งคำคู่ความหรือเอกสารโดยเจ้าพนักงานศาล พ.ศ. 2562 ฉบับแก้ไข วันที่ 26 ธันวาคม 2568',
};

const DEFAULT_SIGNERS = [
  { kind: 'inspector', full_name: 'นายณัฐพงศ์  กุบแก้ว', position: 'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ', acting: true, acting_title: 'ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี', is_default: true },
  { kind: 'payer', full_name: 'นางราตรี  ศรีจันทร์', position: 'นักวิชาการเงินและบัญชีชำนาญการพิเศษ', acting: false, acting_title: '', is_default: true },
  { kind: 'director', full_name: 'นางสาวเนตรดาว  เฝ้าทรัพย์', position: 'ผู้อำนวยการสำนักอำนวยการประจำศาลจังหวัดอุดรธานี', acting: true, acting_title: 'รักษาราชการแทน', is_default: true },
  { kind: 'officer', full_name: 'นายณัฐพงศ์  กุบแก้ว', position: 'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ', acting: false, acting_title: '', is_default: true },
];

const DEFAULT_ORDER = {
  order_text: 'คำสั่งศาลจังหวัดอุดรธานี ที่ 28/2569 ลงวันที่  23 มีนาคม 2569',
  order_no: '28/2569',
  order_date: '23 มีนาคม 2569',
  note: 'คำสั่งแต่งตั้งเจ้าพนักงานศาลในการส่งคำคู่ความหรือเอกสาร (ค่าเริ่มต้นตามแบบฟอร์ม)',
};

module.exports = { REPORT_SCHEMA_SQL, DEFAULT_SETTINGS, DEFAULT_SIGNERS, DEFAULT_ORDER };
