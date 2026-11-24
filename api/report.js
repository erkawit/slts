/**
 * api/report.js — API ระบบรายงานผลหมาย (ผนวกรวมฟังก์ชันของ summon-report เข้ากับ SLTS)
 *
 *  POST /api/report   body: {"action":"sr_bootstrap", ...}
 *  Header: Authorization: Bearer <token>   (token เดียวกับ /api/slts — ใช้ผู้ใช้ของ SLTS)
 *
 *  ข้อมูลอยู่ใน Neon (ตาราง sr_*) — การสร้างไฟล์ Word/Excel/PDF ทำที่หน้าเว็บ (JSZip + แม่แบบ)
 *  จึงไม่ต้องพึ่ง package หนักบน Vercel
 */
const db = require('../lib/db');
const auth = require('../lib/auth');
const photos = require('../lib/photos');
const { REPORT_SCHEMA_SQL, DEFAULT_SETTINGS, DEFAULT_SIGNERS, DEFAULT_ORDER } = require('../lib/report-schema');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const str = (v) => (v === undefined || v === null ? '' : String(v));
const s = (v, max = 2000) => str(v).trim().slice(0, max);
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// ------------------------------------------------------------------
// schema + seed (ครั้งแรกที่ instance ทำงาน)
// ------------------------------------------------------------------
let ready = null;
async function ensureReportSchema() {
  if (!ready) {
    ready = (async () => {
      await db.query(REPORT_SCHEMA_SQL);
      const { rows: [c] } = await db.query(`SELECT
        (SELECT COUNT(*)::int FROM sr_rates) AS rates,
        (SELECT COUNT(*)::int FROM sr_signers) AS signers,
        (SELECT COUNT(*)::int FROM sr_court_orders) AS orders`);
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        await db.query('INSERT INTO sr_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
      }
      if (!c.signers) {
        for (const sg of DEFAULT_SIGNERS) {
          await db.query('INSERT INTO sr_signers (kind, full_name, position, acting, acting_title, is_default, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [sg.kind, sg.full_name, sg.position, sg.acting, sg.acting_title, sg.is_default, 'system']);
        }
      }
      if (!c.orders) {
        await db.query('INSERT INTO sr_court_orders (order_text, order_no, order_date, note, created_by) VALUES ($1,$2,$3,$4,$5)',
          [DEFAULT_ORDER.order_text, DEFAULT_ORDER.order_no, DEFAULT_ORDER.order_date, DEFAULT_ORDER.note, 'system']);
      }
      // v2.4.3: คีย์ตรวจซ้ำแบบใหม่ (หมาย ต. ใช้เลข ต. อย่างเดียว / เลขคดีถึงปี พ.ศ.) → ปรับรายการเดิม
      const { rows: old } = await db.query("SELECT id, owner, dedupe_key, t_no, black_no, recipient, house_no, moo FROM sr_issued WHERE dedupe_key LIKE '%|%|%|%|%'");
      for (const r of old) {
        const k = dedupeKey(r);
        if (k !== r.dedupe_key) {
          await db.query('UPDATE sr_issued SET dedupe_key = $1 WHERE id = $2 AND NOT EXISTS (SELECT 1 FROM sr_issued WHERE owner = $3 AND dedupe_key = $1)', [k, r.id, r.owner]).catch(() => {});
        }
      }
      if (!c.rates) {
        const seed = require('../lib/report-rates-seed.json');
        await insertRates('paid', seed.paid.map((r, i) => ({ district: r[0], subdistrict: r[1], exception_note: r[2], rate_amount: r[3], sort_order: i + 1 })));
        await insertRates('free', seed.free.map((r, i) => ({ district: r[0], subdistrict: r[1], exception_note: r[2], rate_amount: r[3], sort_order: i + 1 })));
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function insertRates(type, list, client) {
  if (!list.length) return;
  const q = client || db;
  await q.query(`INSERT INTO sr_rates (rate_type, district, subdistrict, exception_note, rate_amount, sort_order)
    SELECT $1, * FROM UNNEST($2::text[], $3::text[], $4::text[], $5::numeric[], $6::int[])`, [
    type,
    list.map((r) => s(r.district, 200)), list.map((r) => s(r.subdistrict, 200)), list.map((r) => s(r.exception_note, 300)),
    list.map((r) => num(r.rate_amount)), list.map((r, i) => Number(r.sort_order) || i + 1),
  ]);
}

// ------------------------------------------------------------------
// auth (token เดียวกับ /api/slts)
// ------------------------------------------------------------------
async function currentUser(req, data) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = (h.startsWith('Bearer ') ? h.slice(7) : '') || data._token || '';
  const claims = auth.readToken(token);
  if (!claims) return null;
  const { rows } = await db.query('SELECT username, role, name, token_version FROM app_users WHERE username = $1 AND disabled = FALSE', [claims.u]);
  const u = rows[0];
  if (!u || u.token_version !== claims.v) return null;
  return u;
}
const isAdmin = (u) => u && u.role === 'admin';
function requireAdmin(u) {
  if (!isAdmin(u)) throw new HttpError(403, 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', 'FORBIDDEN');
}
/** ผู้ใช้ทั่วไปเห็นเฉพาะรายการของตัวเอง แอดมินเลือกดูของผู้ใช้อื่นได้ */
function ownerFor(u, requested) {
  const r = s(requested).toLowerCase();
  if (r && r !== u.username) {
    if (!isAdmin(u)) throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงรายการของผู้ใช้อื่น', 'FORBIDDEN');
    return r;
  }
  return u.username;
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
const ISSUED_FIELDS = ['seq', 'kind', 't_no', 'black_no', 'red_no', 'plaintiff', 'defendant', 'summon_type', 'recipient', 'address_raw',
  'house_no', 'moo', 'soi', 'road', 'subdistrict', 'district', 'price', 'money_type', 'server_name', 'payer_court', 'result_text',
  'receipt_ref', 'entry_date'];

function cleanIssued(it) {
  const o = {};
  for (const f of ISSUED_FIELDS) o[f] = f === 'price' ? num(it[f]) : f === 'seq' ? (parseInt(it[f], 10) || 0) : s(it[f], 600);
  o.kind = o.kind === 'T' ? 'T' : 'LOCAL';
  o.money_type = o.money_type === 'paid' ? 'paid' : (o.price > 0 ? 'paid' : 'free');
  return o;
}
const norm = (v) => str(v).replace(/([\u0E48-\u0E4B])([\u0E31\u0E34-\u0E3A\u0E47])/g, '$2$1').replace(/[๐-๙]/g, (d) => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d)).replace(/\s+/g, '').toUpperCase();
/** หมายเดียวกัน = เลข ต./เลขคดี + ผู้รับ + บ้านเลขที่ (นำเข้าไฟล์ซ้ำจะอัปเดต ไม่สร้างซ้ำ และไม่ลบรายงานที่กรอกแล้ว) */
/** เลขคดีถึงปี พ.ศ. หลัง "/" เท่านั้น — ข้อความหลังปีไม่นำมาพิจารณา (เช่น "ต3086/2569 (ฟ.)" = "ต3086/2569") */
const caseKey = (v) => {
  const t = norm(v);
  const m = t.match(/([ก-ฮA-Z][ก-ฮA-Z.]{0,7}?)\.?(\d{1,7})\/(\d{4}|\d{2})(?!\d)/);
  if (!m) return t;
  return `${m[1].replace(/\./g, '')}${parseInt(m[2], 10)}/${m[3].length === 2 ? '25' + m[3] : m[3]}`;
};
/** หมาย ต. ใช้เลข ต. เป็นเลขหลักเท่านั้น (ไม่ใช้เลขคดีศาลต้นทาง) */
const mainCase = (o) => (o.t_no ? caseKey(o.t_no) : '') || caseKey(o.black_no);
const dedupeKey = (o) => [mainCase(o), norm(o.recipient).replace(/(จำเลย|โจทก์|ผู้ร้อง|ผู้คัดค้าน|ผู้เสียหาย).*$/, ''), norm(o.house_no), norm(o.moo)].join('|');

function issuedRow(r) {
  return {
    id: Number(r.id), owner: r.owner, batch_id: r.batch_id ? Number(r.batch_id) : null, seq: r.seq, kind: r.kind,
    t_no: r.t_no, black_no: r.black_no, red_no: r.red_no, plaintiff: r.plaintiff, defendant: r.defendant,
    summon_type: r.summon_type, recipient: r.recipient, address_raw: r.address_raw, house_no: r.house_no, moo: r.moo,
    soi: r.soi, road: r.road, subdistrict: r.subdistrict, district: r.district, price: Number(r.price), money_type: r.money_type,
    server_name: r.server_name, payer_court: r.payer_court, result_text: r.result_text, receipt_ref: r.receipt_ref,
    entry_date: r.entry_date, period_start: r.period_start, period_end: r.period_end, report: r.report || null,
    report_status: r.report_status, reported_at: r.reported_at, updated_at: r.updated_at,
  };
}

async function settingsMap() {
  const { rows } = await db.query('SELECT key, value FROM sr_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ------------------------------------------------------------------
// actions
// ------------------------------------------------------------------
const actions = {};

/** ข้อมูลตั้งต้นทั้งหมดที่หน้าเว็บต้องใช้ */
actions.sr_bootstrap = async (d, u) => {
  const [settings, rates, signers, orders] = await Promise.all([
    settingsMap(),
    db.query('SELECT id, rate_type, district, subdistrict, exception_note, rate_amount::float AS rate_amount, sort_order FROM sr_rates ORDER BY rate_type, sort_order, id'),
    db.query('SELECT id, kind, full_name, position, acting, acting_title, is_default, created_by FROM sr_signers ORDER BY kind, is_default DESC, id'),
    db.query('SELECT id, order_text, order_no, order_date, note, is_active, created_by, created_at FROM sr_court_orders ORDER BY id DESC'),
  ]);
  const [{ rows: [zone] }, { rows: presets }, { rows: staff }] = await Promise.all([
    db.query('SELECT preset_id, zone_key, anchor, updated_by, updated_at FROM sr_zone_state WHERE username = $1', [u.username]),
    db.query('SELECT id, owner, name, province, muang, zones, roster, source_file, updated_by, updated_at FROM sr_zone_presets ORDER BY id'),
    db.query("SELECT username, name FROM app_users WHERE disabled IS NOT TRUE AND COALESCE(name, '') <> '' ORDER BY name"),
  ]);
  return {
    status: 'success', me: { username: u.username, name: u.name || u.username, role: u.role }, settings, rates: rates.rows, signers: signers.rows, orders: orders.rows,
    zone: zone || null, zonePresets: presets.map(presetRow), activePresetId: Number(settings.zone_active_preset) || null, staff,
  };
};

// ---------------- โซนจ่ายหมาย (Pre-set ของศาล ใช้ร่วมกัน) + ผู้ส่งประจำโซน (roster) ----------------
const parseJson = (v, def) => (v && typeof v === 'object' ? v : (() => { try { return JSON.parse(v || ''); } catch (_) { return def; } })());
const presetRow = (r) => ({
  id: Number(r.id), owner: r.owner, name: r.name, province: r.province, muang: r.muang,
  zones: Array.isArray(r.zones) ? r.zones : parseJson(r.zones, []), roster: parseJson(r.roster, {}) || {},
  source_file: r.source_file || '', updated_by: r.updated_by || '', updated_at: r.updated_at,
});
const strList = (v, max) => (Array.isArray(v) ? v : []).map((x) => s(x, 120)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, max);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
function cleanZones(zones) {
  if (!Array.isArray(zones)) throw new HttpError(400, 'รูปแบบโซนไม่ถูกต้อง');
  if (zones.length > 120) throw new HttpError(400, 'โซนมากเกินไป');
  const seen = new Map();
  return zones.map((z, i) => {
    z = z || {};
    const subdistricts = strList(z.subdistricts, 300);
    const moo = {};
    subdistricts.forEach((t) => { const c = z.moo && z.moo[t]; if (c === 'with' || c === 'without') moo[t] = c; });
    const others = (Array.isArray(z.others) ? z.others : []).map((o) => ({ district: s(o && o.district, 120), subdistrict: s(o && o.subdistrict, 120) })).filter((o) => o.district && o.subdistrict).slice(0, 200);
    const out = { id: s(z.id, 40) || `z${Date.now().toString(36)}${i}`, name: s(z.name, 200), subdistricts, moo, others, districts: strList(z.districts, 300), keywords: strList(z.keywords, 30) };
    const nm = out.name || `โซนที่ ${i + 1}`;
    if (!out.subdistricts.length && !out.districts.length && !out.others.length && !out.keywords.length) throw new HttpError(400, `${nm}: ยังไม่ได้เลือกพื้นที่`);
    out.subdistricts.map((t) => ['ต.' + t, moo[t] || '']).concat(out.others.map((o) => [`ต.${o.subdistrict} อ.${o.district}`, ''])).concat(out.districts.map((d) => ['อ.' + d, ''])).forEach(([k, cond]) => {
      const prev = seen.get(k);
      if (prev && !(prev.cond && cond && prev.cond !== cond)) throw new HttpError(400, `${k} อยู่ทั้งใน ${prev.nm} และ ${nm}`);
      seen.set(k, { nm, cond });
    });
    return out;
  });
}
/** roster = { period_start, period_end, assign: { zoneId: { sender, sender_username, backup, backup_username } } } */
function cleanRoster(r, zones) {
  if (!r || typeof r !== 'object') return {};
  const ids = new Set(zones.map((z) => z.id));
  const assign = {};
  Object.keys(r.assign || {}).forEach((k) => {
    if (!ids.has(k)) return;
    const a = r.assign[k] || {};
    assign[k] = { sender: s(a.sender, 120), sender_username: s(a.sender_username, 80), backup: s(a.backup, 120), backup_username: s(a.backup_username, 80) };
  });
  return { period_start: isoDate(r.period_start), period_end: isoDate(r.period_end), assign };
}
const mondayIso = () => { const d = new Date(Date.now() + 7 * 3600e3); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); };
const canEditPreset = (p, u) => isAdmin(u) || p.owner === u.username;
async function zoneLog(presetId, action, before, after, u) {
  await db.query('INSERT INTO sr_zone_log (preset_id, action, roster_before, roster_after, created_by) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)',
    [presetId, action, JSON.stringify(before || {}), JSON.stringify(after || {}), u.username]).catch(() => {});
}
async function setActivePreset(id) {
  await db.query('INSERT INTO sr_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['zone_active_preset', id ? String(id) : '']);
}

/** บันทึก Pre-set (สร้างใหม่ถ้าไม่มี id) — ผู้ใช้ทุกคนสร้าง/นำเข้าได้; แก้ไขได้เฉพาะผู้สร้างหรือผู้ดูแลระบบ */
actions.sr_zone_preset_save = async (d, u) => {
  const name = s(d.name, 200);
  if (!name) throw new HttpError(400, 'กรุณาตั้งชื่อ Pre-set');
  const zones = cleanZones(d.zones);
  if (!zones.length) throw new HttpError(400, 'ยังไม่มีโซนใน Pre-set');
  const province = s(d.province, 80);
  const muang = s(d.muang, 80);
  let row;
  if (d.id) {
    const { rows: [old] } = await db.query('SELECT * FROM sr_zone_presets WHERE id = $1', [Number(d.id)]);
    if (!old) throw new HttpError(404, 'ไม่พบ Pre-set');
    if (!canEditPreset(old, u)) throw new HttpError(403, 'แก้ไขได้เฉพาะผู้สร้าง Pre-set หรือผู้ดูแลระบบ');
    const roster = d.roster ? cleanRoster(d.roster, zones) : cleanRoster(presetRow(old).roster, zones);
    const { rows } = await db.query('UPDATE sr_zone_presets SET name=$1, province=$2, muang=$3, zones=$4::jsonb, roster=$5::jsonb, updated_by=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
      [name, province, muang, JSON.stringify(zones), JSON.stringify(roster), u.username, Number(d.id)]);
    row = rows[0];
  } else {
    const roster = cleanRoster(d.roster, zones);
    const { rows } = await db.query('INSERT INTO sr_zone_presets (owner, name, province, muang, zones, roster, source_file, updated_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$1) RETURNING *',
      [u.username, name, province, muang, JSON.stringify(zones), JSON.stringify(roster), s(d.source_file, 200)]);
    row = rows[0];
    await zoneLog(row.id, d.source_file ? 'import' : 'create', {}, roster, u);
  }
  const map = await settingsMap();
  if (d.activate || !Number(map.zone_active_preset)) await setActivePreset(row.id);
  return { status: 'success', preset: presetRow(row) };
};
actions.sr_zone_preset_delete = async (d, u) => {
  const { rows: [p] } = await db.query('SELECT * FROM sr_zone_presets WHERE id = $1', [Number(d.id)]);
  if (!p) throw new HttpError(404, 'ไม่พบ Pre-set');
  if (!canEditPreset(p, u)) throw new HttpError(403, 'ลบได้เฉพาะผู้สร้าง Pre-set หรือผู้ดูแลระบบ');
  await db.query('DELETE FROM sr_zone_presets WHERE id = $1', [p.id]);
  await db.query('UPDATE sr_zone_state SET preset_id = NULL WHERE preset_id = $1', [p.id]);
  const map = await settingsMap();
  if (Number(map.zone_active_preset) === Number(p.id)) await setActivePreset(null);
  return { status: 'success' };
};
/** เลือก Pre-set ที่ใช้งาน (ทั้งศาล) */
actions.sr_zone_activate = async (d, u) => {
  const { rows: [p] } = await db.query('SELECT id FROM sr_zone_presets WHERE id = $1', [Number(d.id)]);
  if (!p) throw new HttpError(404, 'ไม่พบ Pre-set');
  await setActivePreset(p.id);
  await zoneLog(p.id, 'activate', {}, {}, u);
  return { status: 'success', activePresetId: Number(p.id) };
};
/**
 * บันทึกผู้ส่งประจำโซน (แก้ไข / เลื่อนรอบ)
 * expect_period_start: กันเลื่อนซ้ำเมื่อมีผู้ใช้หลายคนกดพร้อมกัน
 */
actions.sr_zone_roster_save = async (d, u) => {
  const { rows: [p] } = await db.query('SELECT * FROM sr_zone_presets WHERE id = $1', [Number(d.preset_id)]);
  if (!p) throw new HttpError(404, 'ไม่พบ Pre-set');
  const cur = presetRow(p);
  const action = ['edit', 'shift'].includes(d.mode) ? d.mode : 'edit';
  if (action === 'edit' && !canEditPreset(p, u)) throw new HttpError(403, 'แก้ไขผู้ส่งได้เฉพาะผู้สร้าง Pre-set หรือผู้ดูแลระบบ');
  if (d.expect_period_start !== undefined && String(cur.roster.period_start || '') !== String(d.expect_period_start || '')) {
    throw new HttpError(409, 'ตารางผู้ส่งถูกเปลี่ยนไปแล้ว (อาจมีผู้อื่นเลื่อนรอบไปก่อน) — โหลดข้อมูลใหม่แล้วตรวจสอบอีกครั้ง');
  }
  const roster = cleanRoster(d.roster, cur.zones);
  if (!roster.period_start || !roster.period_end) throw new HttpError(400, 'กรุณาระบุช่วงวันที่ของรอบ');
  const { rows } = await db.query('UPDATE sr_zone_presets SET roster=$1::jsonb, updated_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *', [JSON.stringify(roster), u.username, p.id]);
  await zoneLog(p.id, action, cur.roster, roster, u);
  return { status: 'success', preset: presetRow(rows[0]) };
};
/** ย้อนการเปลี่ยนผู้ส่งครั้งล่าสุด */
actions.sr_zone_roster_undo = async (d, u) => {
  const { rows: [p] } = await db.query('SELECT * FROM sr_zone_presets WHERE id = $1', [Number(d.preset_id)]);
  if (!p) throw new HttpError(404, 'ไม่พบ Pre-set');
  const { rows: [lg] } = await db.query("SELECT * FROM sr_zone_log WHERE preset_id = $1 AND action IN ('shift','edit') AND undone IS NOT TRUE ORDER BY id DESC LIMIT 1", [p.id]);
  if (!lg) throw new HttpError(400, 'ไม่มีการเปลี่ยนแปลงให้ย้อนกลับ');
  const before = parseJson(lg.roster_before, {});
  const { rows } = await db.query('UPDATE sr_zone_presets SET roster=$1::jsonb, updated_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *', [JSON.stringify(before), u.username, p.id]);
  await db.query('UPDATE sr_zone_log SET undone = TRUE WHERE id = $1', [lg.id]);
  await zoneLog(p.id, 'undo', presetRow(p).roster, before, u);
  return { status: 'success', preset: presetRow(rows[0]) };
};
actions.sr_zone_log = async (d) => {
  const { rows } = await db.query('SELECT id, action, roster_before, roster_after, created_by, created_at, undone FROM sr_zone_log WHERE preset_id = $1 ORDER BY id DESC LIMIT 30', [Number(d.preset_id)]);
  return { status: 'success', items: rows.map((r) => ({ ...r, roster_before: parseJson(r.roster_before, {}), roster_after: parseJson(r.roster_after, {}) })) };
};
/** โซนส่วนตัว (กรณีไม่ได้อยู่ในตารางผู้ส่ง) — anchor = วันจันทร์ที่เริ่มโซนนี้ */
actions.sr_zone_set = async (d, u) => {
  const presetId = Number(d.preset_id);
  const { rows: [p] } = await db.query('SELECT id, zones FROM sr_zone_presets WHERE id = $1', [presetId]);
  if (!p) throw new HttpError(404, 'ไม่พบ Pre-set');
  const zones = presetRow(p).zones;
  const key = s(d.zone_key, 40) || (zones[0] && zones[0].id) || '';
  if (!zones.some((z) => z.id === key)) throw new HttpError(400, 'ไม่พบโซนใน Pre-set');
  const anchor = s(d.anchor, 10) || mondayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new HttpError(400, 'วันที่เริ่มโซนไม่ถูกต้อง');
  await db.query(`INSERT INTO sr_zone_state (username, preset_id, zone_key, anchor, updated_by, updated_at) VALUES ($1,$2,$3,$4,$1,NOW())
    ON CONFLICT (username) DO UPDATE SET preset_id = EXCLUDED.preset_id, zone_key = EXCLUDED.zone_key, anchor = EXCLUDED.anchor, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [u.username, presetId, key, anchor]);
  return { status: 'success', zone: { preset_id: presetId, zone_key: key, anchor, updated_by: u.username } };
};

actions.sr_settings_save = async (d, u) => {
  requireAdmin(u);
  const values = d.values && typeof d.values === 'object' ? d.values : {};
  const keys = Object.keys(values).filter((k) => /^[a-z0-9_]{1,60}$/.test(k));
  for (const k of keys) {
    await db.query('INSERT INTO sr_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, s(values[k], k === 'zone_list' ? 20000 : 5000)]);
  }
  return { status: 'success', message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว', settings: await settingsMap() };
};

// ---------- อัตราค่านำหมาย ----------
actions.sr_rate_save = async (d, u) => {
  requireAdmin(u);
  const type = d.rate_type === 'paid' ? 'paid' : 'free';
  const dist = s(d.district, 200).replace(/^(อำเภอ|อ\.)\s*/, ''); const sub = s(d.subdistrict, 200).replace(/^(ตำบล|ต\.)\s*/, '');
  if (!dist || !sub) throw new HttpError(422, 'กรุณาระบุอำเภอและตำบล');
  const id = Number(d.id) || 0;
  if (id) {
    await db.query('UPDATE sr_rates SET rate_type=$1, district=$2, subdistrict=$3, exception_note=$4, rate_amount=$5, updated_at=NOW() WHERE id=$6',
      [type, dist, sub, s(d.exception_note, 300), num(d.rate_amount), id]);
  } else {
    const { rows: [m] } = await db.query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM sr_rates WHERE rate_type=$1', [type]);
    await db.query('INSERT INTO sr_rates (rate_type, district, subdistrict, exception_note, rate_amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
      [type, dist, sub, s(d.exception_note, 300), num(d.rate_amount), m.n]);
  }
  return { status: 'success', message: id ? 'แก้ไขอัตราเรียบร้อยแล้ว' : 'เพิ่มอัตราเรียบร้อยแล้ว' };
};
actions.sr_rate_delete = async (d, u) => {
  requireAdmin(u);
  await db.query('DELETE FROM sr_rates WHERE id = $1', [Number(d.id) || 0]);
  return { status: 'success', message: 'ลบรายการเรียบร้อยแล้ว' };
};
/** นำเข้าอัตราจาก Excel/PDF (หน้าเว็บอ่านไฟล์แล้วส่งรายการมา) mode: replace = แทนที่ทั้งชุดของประเภทที่มีข้อมูล */
actions.sr_rates_import = async (d, u) => {
  requireAdmin(u);
  const paid = Array.isArray(d.paid) ? d.paid.slice(0, 2000) : [];
  const free = Array.isArray(d.free) ? d.free.slice(0, 2000) : [];
  if (!paid.length && !free.length) throw new HttpError(422, 'ไม่พบรายการอัตราในไฟล์');
  await db.tx(async (c) => {
    for (const [type, list] of [['paid', paid], ['free', free]]) {
      if (!list.length) continue;
      if (d.mode !== 'append') await c.query('DELETE FROM sr_rates WHERE rate_type = $1', [type]);
      await insertRates(type, list, c);
    }
    const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
    for (const k of ['paid_header', 'paid_notes', 'free_header_1', 'free_header_2', 'free_header_3', 'free_notes']) {
      if (meta[k]) await c.query('INSERT INTO sr_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, s(meta[k], 5000)]);
    }
  });
  return { status: 'success', message: `นำเข้าอัตราเรียบร้อย (หมายเงิน ${paid.length} / หมายฟรี ${free.length} รายการ)` };
};

// ---------- คำสั่งศาล ----------
actions.sr_order_save = async (d, u) => {
  requireAdmin(u);
  const text = s(d.order_text, 1000);
  if (!text) throw new HttpError(422, 'กรุณากรอกข้อความคำสั่งศาล');
  await db.query('INSERT INTO sr_court_orders (order_text, order_no, order_date, note, created_by) VALUES ($1,$2,$3,$4,$5)',
    [text, s(d.order_no, 100), s(d.order_date, 100), s(d.note, 1000), u.username]);
  return { status: 'success', message: 'เพิ่มคำสั่งศาลฉบับใหม่แล้ว (รายงานใหม่จะใช้คำสั่งนี้ รายงานเดิมคงคำสั่งเดิม)' };
};
actions.sr_order_delete = async (d, u) => {
  requireAdmin(u);
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM sr_court_orders');
  if (c.n <= 1) throw new HttpError(422, 'ต้องมีคำสั่งศาลในระบบอย่างน้อย 1 รายการ');
  await db.query('DELETE FROM sr_court_orders WHERE id = $1', [Number(d.id) || 0]);
  return { status: 'success', message: 'ลบคำสั่งศาลเรียบร้อยแล้ว' };
};

// ---------- ผู้ลงนาม (ผู้ตรวจ / ผู้จ่ายเงิน / ผู้อำนวยการ / เจ้าหน้าที่เสนอ) ----------
const SIGNER_KINDS = ['inspector', 'payer', 'director', 'officer'];
actions.sr_signer_save = async (d, u) => {
  const kind = SIGNER_KINDS.includes(d.kind) ? d.kind : '';
  if (!kind) throw new HttpError(422, 'ประเภทผู้ลงนามไม่ถูกต้อง');
  // ผู้ตรวจ/ผู้จ่ายเงิน: เจ้าหน้าที่ทุกคนเพิ่มได้ (ตามที่ใช้งานจริงในการรายงานหมาย) — ผู้อำนวยการ/เจ้าหน้าที่เสนอ: เฉพาะแอดมิน
  if (!['inspector', 'payer'].includes(kind)) requireAdmin(u);
  const name = s(d.full_name, 200);
  if (!name) throw new HttpError(422, 'กรุณากรอกชื่อ-สกุล');
  const id = Number(d.id) || 0;
  const isDefault = bool(d.is_default);
  return db.tx(async (c) => {
    if (id) {
      const { rows: [old] } = await c.query('SELECT created_by, kind FROM sr_signers WHERE id = $1', [id]);
      if (!old) throw new HttpError(404, 'ไม่พบรายชื่อ');
      if (!isAdmin(u) && old.created_by !== u.username) throw new HttpError(403, 'แก้ไขได้เฉพาะรายชื่อที่ตนเองเพิ่ม (หรือผู้ดูแลระบบ)');
    }
    if (isDefault) {
      if (!isAdmin(u)) throw new HttpError(403, 'การตั้งเป็นค่าเริ่มต้นของทุกคนทำได้เฉพาะผู้ดูแลระบบ');
      await c.query('UPDATE sr_signers SET is_default = FALSE WHERE kind = $1', [kind]);
    }
    const vals = [kind, name, s(d.position, 300), bool(d.acting), s(d.acting_title, 300), isDefault];
    let newId = id;
    if (id) await c.query('UPDATE sr_signers SET kind=$1, full_name=$2, position=$3, acting=$4, acting_title=$5, is_default=$6 WHERE id=$7', [...vals, id]);
    else {
      const { rows: [r] } = await c.query('INSERT INTO sr_signers (kind, full_name, position, acting, acting_title, is_default, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [...vals, u.username]);
      newId = Number(r.id);
    }
    return { status: 'success', id: newId, message: id ? 'แก้ไขรายชื่อเรียบร้อยแล้ว' : 'เพิ่มรายชื่อเรียบร้อยแล้ว' };
  });
};
actions.sr_signer_delete = async (d, u) => {
  const id = Number(d.id) || 0;
  const { rows: [old] } = await db.query('SELECT created_by, kind FROM sr_signers WHERE id = $1', [id]);
  if (!old) throw new HttpError(404, 'ไม่พบรายชื่อ');
  if (!isAdmin(u) && old.created_by !== u.username) throw new HttpError(403, 'ลบได้เฉพาะรายชื่อที่ตนเองเพิ่ม (หรือผู้ดูแลระบบ)');
  await db.query('DELETE FROM sr_signers WHERE id = $1', [id]);
  return { status: 'success', message: 'ลบรายชื่อเรียบร้อยแล้ว' };
};

// ---------- บัญชีจ่ายหมาย (นำเข้า Excel) ----------
/**
 * d.items = รายการจากไฟล์ "บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง" (หน้าเว็บอ่านด้วย SheetJS + report-logic.js)
 * d.receipts = [{index, receipt_ref, entry_date}] จากไฟล์บัญชีใบเสร็จ (ถ้ามี)
 */
actions.sr_issued_import = async (d, u) => {
  const owner = ownerFor(u, d.owner);
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 3000).map(cleanIssued);
  if (!items.length) throw new HttpError(422, 'ไม่พบรายการหมายในไฟล์');
  const period = d.period || {};
  const ps = s(period.start, 20); const pe = s(period.end, 20);
  const out = await db.tx(async (c) => {
    const { rows: [b] } = await c.query('INSERT INTO sr_batches (owner, kind, source_file, period_start, period_end, item_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [owner, 'issued', s(d.source_file, 300), ps, pe, items.length]);
    let inserted = 0; let updated = 0;
    for (const it of items) {
      const key = dedupeKey(it);
      const cols = ISSUED_FIELDS;
      const vals = cols.map((f) => it[f]);
      const { rows: [r] } = await c.query(`
        INSERT INTO sr_issued (owner, batch_id, dedupe_key, period_start, period_end, ${cols.join(', ')})
        VALUES ($1,$2,$3,$4,$5, ${cols.map((_, i) => '$' + (i + 6)).join(', ')})
        ON CONFLICT (owner, dedupe_key) DO UPDATE SET
          batch_id = EXCLUDED.batch_id, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
          ${cols.filter((f) => f !== 'receipt_ref' && f !== 'entry_date').map((f) => `${f} = EXCLUDED.${f}`).join(', ')},
          receipt_ref = CASE WHEN EXCLUDED.receipt_ref <> '' THEN EXCLUDED.receipt_ref ELSE sr_issued.receipt_ref END,
          entry_date = CASE WHEN EXCLUDED.entry_date <> '' THEN EXCLUDED.entry_date ELSE sr_issued.entry_date END,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`, [owner, b.id, key, ps, pe, ...vals]);
      if (r.inserted) inserted++; else updated++;
    }
    return { batch_id: Number(b.id), inserted, updated };
  });
  return { status: 'success', ...out, message: `นำเข้าบัญชีจ่ายหมาย ${items.length} รายการ (ใหม่ ${out.inserted} / อัปเดต ${out.updated})` };
};

/** นำเข้าบัญชีใบเสร็จ (accexpense): จับคู่กับหมายที่มีอยู่แล้วด้วยเลข ต./เลขคดี + ผู้รับ */
actions.sr_receipts_import = async (d, u) => {
  const owner = ownerFor(u, d.owner);
  const list = (Array.isArray(d.receipts) ? d.receipts : []).slice(0, 3000);
  const { rows } = await db.query('SELECT id, t_no, black_no, recipient, subdistrict FROM sr_issued WHERE owner = $1', [owner]);
  const nameKey = (v) => norm(v).replace(/(จำเลย|โจทก์|ผู้ร้อง|ผู้คัดค้าน|ผู้เสียหาย).*$/, '');
  let matched = 0; const unmatched = [];
  const used = new Set();
  for (const rc of list) {
    let best = null; let bestScore = 0;
    for (const r of rows) {
      if (used.has(r.id)) continue;
      let sc = 0;
      if (r.t_no) { if (rc.t_no && caseKey(rc.t_no) === caseKey(r.t_no)) sc += 5; } // หมาย ต. จับคู่ด้วยเลข ต. เท่านั้น
      else if (!rc.t_no && rc.black_no && caseKey(rc.black_no) === caseKey(r.black_no)) sc += 4;
      if (!sc) continue;
      if (nameKey(rc.recipient) && nameKey(rc.recipient) === nameKey(r.recipient)) sc += 3;
      if (norm(rc.subdistrict) === norm(r.subdistrict)) sc += 1;
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    if (best) {
      used.add(best.id); matched++;
      await db.query('UPDATE sr_issued SET receipt_ref = $1, entry_date = CASE WHEN $2 <> \'\' THEN $2 ELSE entry_date END, updated_at = NOW() WHERE id = $3',
        [s(rc.receipt_ref, 200), s(rc.entry_date, 20), best.id]);
    } else unmatched.push(s(rc.t_no || rc.black_no, 60) + ' ' + s(rc.recipient, 100));
  }
  return { status: 'success', matched, unmatched, message: `จับคู่ใบเสร็จได้ ${matched} จาก ${list.length} รายการ` };
};

actions.sr_issued_list = async (d, u) => {
  const owner = d.all && isAdmin(u) ? null : ownerFor(u, d.owner);
  const params = []; const where = [];
  if (owner) { params.push(owner); where.push(`owner = $${params.length}`); }
  if (d.from) { params.push(s(d.from, 10)); where.push(`(period_end = '' OR period_end >= $${params.length})`); }
  if (d.to) { params.push(s(d.to, 10)); where.push(`(period_start = '' OR period_start <= $${params.length})`); }
  if (d.status && ['none', 'saved', 'printed'].includes(d.status)) { params.push(d.status); where.push(`report_status = $${params.length}`); }
  const { rows } = await db.query(`SELECT * FROM sr_issued ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY period_end DESC, batch_id DESC NULLS LAST, seq ASC, id ASC LIMIT 3000`, params);
  const { rows: batches } = await db.query(`SELECT id, owner, source_file, period_start, period_end, item_count, created_at FROM sr_batches
    ${owner ? 'WHERE owner = $1' : ''} ORDER BY id DESC LIMIT 50`, owner ? [owner] : []);
  return { status: 'success', items: rows.map(issuedRow), batches };
};

actions.sr_issued_get = async (d, u) => {
  const { rows: [r] } = await db.query('SELECT * FROM sr_issued WHERE id = $1', [Number(d.id) || 0]);
  if (!r) throw new HttpError(404, 'ไม่พบรายการหมาย');
  if (r.owner !== u.username && !isAdmin(u)) throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงรายการนี้');
  return { status: 'success', item: issuedRow(r) };
};

/** เพิ่มหมายเอง (กรณีไม่มีในไฟล์ Excel) หรือแก้ข้อมูลพื้นฐาน */
actions.sr_issued_upsert = async (d, u) => {
  const id = Number(d.id) || 0;
  const it = cleanIssued(d.item || {});
  if (!it.t_no && !it.black_no) throw new HttpError(422, 'กรุณาระบุเลขหมาย ต. หรือหมายเลขคดีดำ');
  if (id) {
    const { rows: [old] } = await db.query('SELECT owner FROM sr_issued WHERE id = $1', [id]);
    if (!old) throw new HttpError(404, 'ไม่พบรายการหมาย');
    if (old.owner !== u.username && !isAdmin(u)) throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขรายการนี้');
    const sets = ISSUED_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await db.query(`UPDATE sr_issued SET ${sets}, updated_at = NOW() WHERE id = $${ISSUED_FIELDS.length + 1}`, [...ISSUED_FIELDS.map((f) => it[f]), id]);
    return { status: 'success', id, message: 'แก้ไขข้อมูลหมายเรียบร้อยแล้ว' };
  }
  const owner = ownerFor(u, d.owner);
  const { rows: [r] } = await db.query(`INSERT INTO sr_issued (owner, dedupe_key, ${ISSUED_FIELDS.join(', ')})
    VALUES ($1,$2, ${ISSUED_FIELDS.map((_, i) => '$' + (i + 3)).join(', ')})
    ON CONFLICT (owner, dedupe_key) DO UPDATE SET updated_at = NOW() RETURNING id`, [owner, dedupeKey(it), ...ISSUED_FIELDS.map((f) => it[f])]);
  return { status: 'success', id: Number(r.id), message: 'เพิ่มรายการหมายเรียบร้อยแล้ว' };
};

actions.sr_issued_delete = async (d, u) => {
  const ids = (Array.isArray(d.ids) ? d.ids : [d.id]).map(Number).filter(Boolean).slice(0, 3000);
  if (!ids.length) throw new HttpError(422, 'ไม่ได้เลือกรายการ');
  const r = isAdmin(u)
    ? await db.query('DELETE FROM sr_issued WHERE id = ANY($1::bigint[])', [ids])
    : await db.query('DELETE FROM sr_issued WHERE id = ANY($1::bigint[]) AND owner = $2', [ids, u.username]);
  return { status: 'success', deleted: r.rowCount, message: `ลบ ${r.rowCount} รายการแล้ว` };
};

/** บันทึกข้อมูลแบบฟอร์มรายงานผลหมาย (ภาพที่ 1-2) */
actions.sr_report_save = async (d, u) => {
  const id = Number(d.id) || 0;
  const { rows: [old] } = await db.query('SELECT owner, report_status FROM sr_issued WHERE id = $1', [id]);
  if (!old) throw new HttpError(404, 'ไม่พบรายการหมาย');
  if (old.owner !== u.username && !isAdmin(u)) throw new HttpError(403, 'ไม่มีสิทธิ์บันทึกรายงานของผู้อื่น');
  const report = d.report && typeof d.report === 'object' ? d.report : {};
  const json = JSON.stringify(report);
  if (json.length > 60000) throw new HttpError(413, 'ข้อมูลรายงานใหญ่เกินไป');
  const status = d.status === 'printed' || old.report_status === 'printed' ? 'printed' : 'saved';
  await db.query('UPDATE sr_issued SET report = $1::jsonb, report_status = $2, reported_at = NOW(), updated_at = NOW() WHERE id = $3', [json, status, id]);
  return { status: 'success', report_status: status, message: 'บันทึกรายงานผลหมายเรียบร้อยแล้ว' };
};

// ---------- บันทึกข้อความ / ใบสำคัญรับเงิน (summon-report) ----------
const MEMO_FIELDS = ['round_label', 'doc_no', 'doc_date', 'period_start', 'period_end', 'reporter_name', 'reporter_position', 'reporter_address',
  'officer_name', 'officer_position', 'director_name', 'director_acting', 'payer_name', 'payer_position', 'receipt_date', 'note'];
const ITEM_FIELDS = ['issued_id', 'case_prefix', 'case_no', 'issue_date', 'serve_date', 'summon_type', 'recipient_role', 'house_no', 'moo',
  'subdistrict', 'district', 'province', 'base_rate', 'claim_rate', 'calc_rule'];

actions.sr_memo_list = async (d, u) => {
  const params = []; let where = '';
  if (!isAdmin(u)) { params.push(u.username); where = 'WHERE created_by = $1'; }
  const { rows } = await db.query(`SELECT *, total_amount::float AS total_amount FROM sr_memos ${where} ORDER BY id DESC LIMIT 500`, params);
  return { status: 'success', memos: rows };
};
actions.sr_memo_get = async (d, u) => {
  const { rows: [m] } = await db.query('SELECT *, total_amount::float AS total_amount FROM sr_memos WHERE id = $1', [Number(d.id) || 0]);
  if (!m) throw new HttpError(404, 'ไม่พบรายงาน');
  if (!isAdmin(u) && m.created_by !== u.username) throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงรายงานนี้');
  const { rows: items } = await db.query('SELECT *, base_rate::float AS base_rate, claim_rate::float AS claim_rate FROM sr_memo_items WHERE memo_id = $1 ORDER BY seq, id', [m.id]);
  return { status: 'success', memo: m, items };
};
actions.sr_memo_save = async (d, u) => {
  const id = Number(d.id) || 0;
  const type = d.report_type === 'paid' ? 'paid' : 'free';
  const f = {}; for (const k of MEMO_FIELDS) f[k] = s(d[k], 1000);
  if (!f.reporter_name) throw new HttpError(422, 'กรุณาระบุชื่อผู้รายงาน / ผู้รับเงิน');
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 1000);
  let count; let total;
  if (type === 'free') {
    if (!items.length) throw new HttpError(422, 'กรุณาเพิ่มรายการส่งหมายอย่างน้อย 1 รายการ');
    // กันการเบิกซ้ำบ้านเดียวกัน (กฎเดียวกับ summon-report)
    const seen = new Map(); const dup = [];
    items.forEach((it, i) => {
      const k = [it.district, it.subdistrict, it.moo, it.house_no].map((x) => norm(x)).join('|');
      if (!norm(it.house_no)) return;
      if (seen.has(k)) dup.push(seen.get(k), i); else seen.set(k, i);
    });
    if (dup.length) throw Object.assign(new HttpError(422, 'พบรายการที่อยู่ซ้ำ (บ้านเลขที่ หมู่ ตำบล อำเภอ เดียวกัน) เบิกได้เพียงหมายเดียว กรุณาตรวจสอบแถวที่ขึ้นสีแดง'), { extra: { duplicate_indices: Array.from(new Set(dup)) } });
    count = items.length; total = Math.round(items.reduce((a, it) => a + num(it.claim_rate), 0) * 100) / 100;
  } else {
    count = Math.max(0, parseInt(d.item_count, 10) || 0); total = num(d.total_amount);
    if (!f.period_start || !f.period_end) throw new HttpError(422, 'กรุณาระบุช่วงรอบระหว่างวันที่เริ่มต้นและวันที่สิ้นสุด');
    if (count <= 0 || total <= 0) throw new HttpError(422, 'กรุณาระบุจำนวนเรื่องและจำนวนเงินให้มากกว่า 0');
  }
  const amountText = s(d.amount_text, 300);
  return db.tx(async (c) => {
    let memoId = id;
    if (id) {
      const { rows: [old] } = await c.query('SELECT created_by FROM sr_memos WHERE id = $1', [id]);
      if (!old) throw new HttpError(404, 'ไม่พบรายงานที่ต้องการแก้ไข');
      if (!isAdmin(u) && old.created_by !== u.username) throw new HttpError(403, 'คุณไม่มีสิทธิ์แก้ไขรายงานของผู้อื่น');
      // รายงานเดิม: คงคำสั่งศาลเดิมไว้ (snapshot)
      await c.query(`UPDATE sr_memos SET ${MEMO_FIELDS.map((k, i) => `${k} = $${i + 1}`).join(', ')},
        item_count = $${MEMO_FIELDS.length + 1}, total_amount = $${MEMO_FIELDS.length + 2}, amount_text = $${MEMO_FIELDS.length + 3}, updated_at = NOW()
        WHERE id = $${MEMO_FIELDS.length + 4}`, [...MEMO_FIELDS.map((k) => f[k]), count, total, amountText, id]);
    } else {
      const { rows: [o] } = await c.query('SELECT id, order_text FROM sr_court_orders WHERE is_active ORDER BY id DESC LIMIT 1');
      const { rows: [r] } = await c.query(`INSERT INTO sr_memos (report_type, order_id, order_text, item_count, total_amount, amount_text, created_by, ${MEMO_FIELDS.join(', ')})
        VALUES ($1,$2,$3,$4,$5,$6,$7, ${MEMO_FIELDS.map((_, i) => '$' + (i + 8)).join(', ')}) RETURNING id`,
      [type, o ? o.id : null, o ? o.order_text : DEFAULT_ORDER.order_text, count, total, amountText, u.username, ...MEMO_FIELDS.map((k) => f[k])]);
      memoId = Number(r.id);
    }
    if (type === 'free') {
      await c.query('DELETE FROM sr_memo_items WHERE memo_id = $1', [memoId]);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const vals = ITEM_FIELDS.map((k) => (['base_rate', 'claim_rate'].includes(k) ? num(it[k]) : k === 'issued_id' ? (Number(it[k]) || null) : s(it[k], 300)));
        await c.query(`INSERT INTO sr_memo_items (memo_id, seq, ${ITEM_FIELDS.join(', ')}) VALUES ($1,$2, ${ITEM_FIELDS.map((_, j) => '$' + (j + 3)).join(', ')})`,
          [memoId, i + 1, ...vals]);
      }
    }
    return { status: 'success', id: memoId, message: 'บันทึกรายงานเรียบร้อยแล้ว' };
  });
};
actions.sr_memo_delete = async (d, u) => {
  const id = Number(d.id) || 0;
  const { rows: [m] } = await db.query('SELECT created_by FROM sr_memos WHERE id = $1', [id]);
  if (!m) throw new HttpError(404, 'ไม่พบรายงาน');
  if (!isAdmin(u) && m.created_by !== u.username) throw new HttpError(403, 'คุณไม่มีสิทธิ์ลบรายงานนี้');
  await db.query('DELETE FROM sr_memos WHERE id = $1', [id]);
  return { status: 'success', message: 'ลบรายงานเรียบร้อยแล้ว' };
};

// ---------- ภาพส่งหมาย (สำหรับแนบท้ายไฟล์ Word) ----------
/**
 * คืนไฟล์ภาพเป็น base64 — หน้าเว็บดึงภาพจาก Google Drive ตรงๆ ไม่ได้ในบางเครือข่าย (CORS)
 * อนุญาตเฉพาะภาพที่อยู่ในตาราง summons (ของตนเอง หรือแอดมิน)
 */
actions.sr_photo = async (d, u) => {
  const fileId = s(d.file_id, 200);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new HttpError(422, 'รหัสไฟล์ภาพไม่ถูกต้อง');
  const { rows: [row] } = await db.query('SELECT uploader FROM summons WHERE drive_file_id = $1 AND deleted_at IS NULL LIMIT 1', [fileId]);
  if (!row) throw new HttpError(404, 'ไม่พบภาพในระบบ');
  if (!isAdmin(u) && String(row.uploader || '').toLowerCase() !== u.username && u.role !== 'local_advisor') {
    throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงภาพนี้');
  }
  if (photos.isDbFileId(fileId)) {
    const p = await photos.getPhoto(fileId);
    if (!p) throw new HttpError(404, 'ไม่พบไฟล์ภาพ');
    return { status: 'success', mime: p.mime_type, base64: Buffer.from(p.data).toString('base64') };
  }
  const size = Math.min(2400, Math.max(400, Number(d.size) || 1600));
  const res = await fetch(`https://lh3.googleusercontent.com/d/${fileId}=w${size}`, { redirect: 'follow' });
  if (!res.ok) throw new HttpError(502, `ดึงภาพจาก Google Drive ไม่สำเร็จ (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'ไฟล์ภาพใหญ่เกินไป');
  return { status: 'success', mime: res.headers.get('content-type') || 'image/jpeg', base64: buf.toString('base64') };
};

/** สรุปภาพรวม (แดชบอร์ด) */
actions.sr_dashboard = async (d, u) => {
  const own = isAdmin(u) && d.all ? null : u.username;
  const p = own ? [own] : [];
  const w = own ? 'WHERE owner = $1' : '';
  const { rows: [a] } = await db.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE report_status <> 'none')::int AS reported,
      COUNT(*) FILTER (WHERE money_type = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE money_type = 'free')::int AS free,
      COALESCE(SUM(price) FILTER (WHERE money_type = 'paid'),0)::float AS paid_amount,
      COUNT(*) FILTER (WHERE kind = 'T')::int AS t_count
    FROM sr_issued ${w}`, p);
  const { rows: [m] } = await db.query(`SELECT COUNT(*)::int AS memos, COALESCE(SUM(total_amount),0)::float AS memo_amount
    FROM sr_memos ${own ? 'WHERE created_by = $1' : ''}`, p);
  return { status: 'success', summary: { ...a, ...m } };
};

// ------------------------------------------------------------------
// handler
// ------------------------------------------------------------------
async function readBody(req) {
  if (req.method !== 'POST') return {};
  let b = req.body;
  if (b === undefined) {
    b = await new Promise((resolve, reject) => {
      let data = ''; req.setEncoding('utf8');
      req.on('data', (c) => { data += c; }); req.on('end', () => resolve(data)); req.on('error', reject);
    });
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { if (!b.trim()) return {}; return JSON.parse(b); }
  return b && typeof b === 'object' ? b : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Version');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  let status = 200; let out; let action = '';
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'ใช้ POST เท่านั้น');
    const data = await readBody(req);
    action = s(data.action, 60);
    const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
    if (!fn) throw new HttpError(400, `ไม่รู้จักคำสั่ง (action): ${action || '-'}`, 'UNKNOWN_ACTION');
    await db.ensureSchema();
    await ensureReportSchema();
    const user = await currentUser(req, data);
    if (!user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่ (เซสชันหมดอายุหรือไม่ถูกต้อง)', 'AUTH_REQUIRED');
    out = await fn(data, user);
  } catch (err) {
    if (err instanceof HttpError) {
      status = err.status; out = { status: 'error', code: err.code, message: err.message, ...(err.extra || {}) };
    } else if (err instanceof SyntaxError) {
      status = 400; out = { status: 'error', message: 'รูปแบบข้อมูลไม่ถูกต้อง' };
    } else {
      status = err.code === 'NO_DATABASE_URL' ? 503 : 500;
      console.error('[api/report]', action, err);
      out = { status: 'error', code: err.code || 'SERVER_ERROR', message: err.message || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' };
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
};

module.exports._internal = { actions, dedupeKey, caseKey, cleanIssued, ensureReportSchema };
