/**
 * api/slts.js — API หลักของ SLTS บน Vercel (แทน Google Apps Script doGet/doPost)
 *
 * รักษารูปแบบคำขอ/คำตอบเดิมของ Apps Script ไว้ (action + {status:"success"|"error"})
 * เพื่อให้หน้าเว็บเดิมทำงานต่อได้ แต่ข้อมูลทั้งหมดอยู่ใน Neon Postgres
 *
 *  GET  /api/slts?action=get_data
 *  POST /api/slts   body: {"action":"upload_image", ...}   (Content-Type: application/json หรือ text/plain)
 *  Header: Authorization: Bearer <token>  (ได้จาก action=login)
 */
const db = require('../lib/db');
const auth = require('../lib/auth');
const drive = require('../lib/drive');
const ai = require('../lib/ai');
const { getVersionInfo } = require('../lib/version');

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const lower = (v) => String(v || '').trim().toLowerCase();
const str = (v) => (v === undefined || v === null ? '' : String(v));
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function bangkokStamp(d = new Date(), withSeconds = true) {
  // "yyyy-MM-dd HH:mm:ss" เวลาไทย (รูปแบบเดียวกับ Apps Script เดิม)
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}${withSeconds ? ':' + p(t.getUTCSeconds()) : ''}`;
}

function thaiDateTimeNow() {
  // "dd/MM/yyyy HH:mm:ss" (ค.ศ.) แบบเดียวกับ Utilities.formatDate เดิม
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

const THAI_MONTHS = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
};

/** แปลงวันเวลาแบบไทย ("25 ส.ค. 2569 16:15:32" / "25/08/2569 16:15") เป็น Date (UTC) */
function parseThaiDateTime(s) {
  const v = str(s).trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  let d, mo, y, h, mi, se;
  if (m && THAI_MONTHS[m[2]]) {
    [d, mo, y, h, mi, se] = [m[1], THAI_MONTHS[m[2]], m[3], m[4], m[5], m[6]];
  } else {
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!m) {
      const t = Date.parse(v.replace(' ', 'T'));
      return Number.isNaN(t) ? null : new Date(t);
    }
    [d, mo, y, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]];
  }
  let year = Number(y);
  if (year > 2400) year -= 543;
  const date = new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h || 0) - 7, Number(mi || 0), Number(se || 0)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function courtNameFor(cat, prov, name) {
  if (name) return name;
  if (cat === 'ศาลไม่สังกัดภาค') return 'ศาลแพ่ง';
  if (cat === 'ศาลแขวง') return 'ศาลแขวง' + prov;
  if (cat === 'ศาลเยาวชนและครอบครัว') return 'ศาลเยาวชนและครอบครัวจังหวัด' + prov;
  return 'ศาลจังหวัด' + prov;
}

function publicUser(u) {
  const prov = u.assigned_province || 'อุดรธานี';
  const cat = u.court_category || 'ศาลจังหวัด';
  const court = courtNameFor(cat, prov, u.assigned_court);
  return {
    username: u.username,
    role: u.role,
    name: u.name || u.username,
    createdAt: u.created_at_text || '',
    courtCategory: cat,
    assignedCourt: court,
    assignedProvince: prov,
    mustChangePassword: Boolean(u.must_change_password),
    disabled: Boolean(u.disabled),
    'ประเภทศาล': cat,
    'ศาลที่สังกัด': court,
    'จังหวัดที่ส่งหมาย': prov,
  };
}

function summonsRowToSheet(r) {
  // คืนค่าตามหัวคอลัมน์ชีตเดิม เพื่อให้ตาราง/แผนที่ฝั่งหน้าเว็บทำงานได้เหมือนเดิม
  return {
    _id: String(r.id),
    'วัน-เวลาบันทึก': str(r.recorded_at_text),
    'เลขคดี': str(r.case_number),
    'ประเภทศาล': str(r.court_type),
    'อำเภอ': str(r.district),
    'ตำบล': str(r.subdistrict),
    'ประเภทสถานที่': str(r.location_type),
    'ที่ตั้งส่งหมาย (เต็ม)': str(r.location_text),
    'ละติจูด (Lat)': r.lat === null ? '' : String(r.lat),
    'ลองจิจูด (Lng)': r.lng === null ? '' : String(r.lng),
    'ทิศองศา': str(r.heading),
    'ชื่อไฟล์รูปภาพ': str(r.file_name),
    'ลิงก์รูปภาพใน Google Drive': str(r.drive_url),
    'ลิงก์ Text File ใน Google Drive': str(r.text_url),
    'Drive File ID': str(r.drive_file_id),
    'ผู้บันทึก': str(r.uploader),
    'จังหวัด': str(r.province),
  };
}

function handoffRowToItem(row) {
  const p = row.payload || {};
  return {
    user_id: row.target_user,
    target_user_id: row.target_user,
    queryString: row.query_string || '',
    fullAddress: row.full_address || '',
    caseNumber: row.case_number || '',
    stops: Array.isArray(p.stops) ? p.stops : [],
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    timestamp: bangkokStamp(new Date(row.created_at)),
    updated_at: bangkokStamp(new Date(row.updated_at)),
    from_user_id: row.from_user || p.from_user_id || '',
    from_user_name: row.from_user_name || p.from_user_name || '',
    type: row.type || p.type || 'handoff',
    startLocation: p.startLocation || null,
    endLocation: p.endLocation || null,
    isRoundTrip: Boolean(p.isRoundTrip),
    routeRoadPolyline: p.routeRoadPolyline || null,
    totalDistanceKm: p.totalDistanceKm || null,
    note: p.note || '',
  };
}

/** ตัดรูป Base64 / ข้อมูลใหญ่ออกจาก payload เส้นทาง (เหมือน safeHandoffJsonStringify เดิม) */
function sanitizeRoutePayload(data) {
  const imgKeys = ['imageUrl', 'planImageUrl', 'customRoutePlanImg', 'capturedPhotoUrl', 'photo', 'dataUrl', 'previewUrl'];
  const clean = (item) => {
    if (!item || typeof item !== 'object') return item;
    const c = { ...item };
    for (const k of imgKeys) {
      if (typeof c[k] === 'string' && (c[k].startsWith('data:') || c[k].length > 600)) delete c[k];
    }
    delete c.matchedRow;
    delete c.leafletMarker;
    return c;
  };
  const out = {
    stops: Array.isArray(data.stops) ? data.stops.slice(0, 500).map(clean) : [],
    startLocation: data.startLocation || null,
    endLocation: data.endLocation || null,
    isRoundTrip: Boolean(data.isRoundTrip),
    totalDistanceKm: num(data.totalDistanceKm),
    note: str(data.note).slice(0, 1000),
    from_user_id: data.from_user_id,
    from_user_name: data.from_user_name,
    type: data.type,
  };
  if (Array.isArray(data.routeRoadPolyline)) {
    const pl = data.routeRoadPolyline;
    const step = Math.max(1, Math.ceil(pl.length / 300));
    out.routeRoadPolyline = pl.filter((_, i) => i % step === 0);
  }
  const size = Buffer.byteLength(JSON.stringify(out));
  if (size > 900_000) {
    delete out.routeRoadPolyline;
    if (Buffer.byteLength(JSON.stringify(out)) > 900_000) throw new HttpError(413, 'ข้อมูลเส้นทางใหญ่เกินไป');
  }
  return out;
}

// ------------------------------------------------------------------
// request plumbing
// ------------------------------------------------------------------
function setCors(req, res) {
  // ใช้ Bearer token (ไม่ใช้ cookie) จึงเปิด CORS ได้ เพื่อรองรับแอป Android/iOS (Capacitor)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}

async function readBody(req) {
  if (req.method !== 'POST') return {};
  let b = req.body;
  if (b === undefined) {
    b = await new Promise((resolve, reject) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (!b.trim()) return {};
    try { return JSON.parse(b); } catch (_) {
      // form-urlencoded fallback
      return Object.fromEntries(new URLSearchParams(b));
    }
  }
  return b && typeof b === 'object' ? b : {};
}

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

async function currentUser(req, data) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = (h.startsWith('Bearer ') ? h.slice(7) : '') || data._token || '';
  const claims = auth.readToken(token);
  if (!claims) return null;
  const { rows } = await db.query(
    'SELECT * FROM app_users WHERE username = $1 AND disabled = FALSE', [claims.u]);
  const u = rows[0];
  if (!u || u.token_version !== claims.v) return null;
  return u;
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่ (เซสชันหมดอายุหรือไม่ถูกต้อง)', 'AUTH_REQUIRED');
  return ctx.user;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', 'FORBIDDEN');
  return u;
}
/** ผู้ใช้ทั่วไปทำรายการได้เฉพาะของตัวเอง แอดมินระบุผู้ใช้อื่นได้ */
function resolveSelfOrAdmin(ctx, requested) {
  const u = requireUser(ctx);
  const target = lower(requested) || u.username;
  if (target !== u.username && u.role !== 'admin') {
    throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ใช้อื่น', 'FORBIDDEN');
  }
  return target;
}

async function logActivity(username, role, actionType, details, extra) {
  try {
    await db.query(
      'INSERT INTO activity_logs (username, role, action_type, details, extra) VALUES ($1,$2,$3,$4,$5)',
      [username || 'anonymous', role || '', str(actionType).slice(0, 80), str(details).slice(0, 2000), extra ? JSON.stringify(extra).slice(0, 20000) : null]);
  } catch (e) { console.warn('[activity] log failed', e.message); }
}

async function logServerError(err, ctx) {
  try {
    const msg = str(err && err.message).slice(0, 1000);
    const fp = 'server:' + (ctx.action || '') + ':' + msg.slice(0, 120);
    await upsertError({
      source: 'server', message: msg, stack: str(err && err.stack).slice(0, 4000),
      username: ctx.user && ctx.user.username, url: '/api/slts?action=' + (ctx.action || ''),
      app_version: getVersionInfo().version, fingerprint: fp, context: { action: ctx.action },
    });
  } catch (_) { /* never throw from logger */ }
}

async function upsertError(e) {
  const params = [e.source || 'client', e.app_version || '', e.username || '', str(e.device).slice(0, 300),
    str(e.url).slice(0, 500), str(e.message).slice(0, 1000), str(e.stack).slice(0, 4000),
    e.context ? JSON.stringify(e.context).slice(0, 8000) : null, str(e.fingerprint).slice(0, 300)];
  await db.query(`
    INSERT INTO error_logs (source, app_version, username, device, url, message, stack, context, fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (fingerprint) WHERE status IN ('new','investigating')
    DO UPDATE SET occurrences = error_logs.occurrences + 1, last_seen_at = NOW(),
                  username = EXCLUDED.username, app_version = EXCLUDED.app_version, device = EXCLUDED.device`, params);
}

// ------------------------------------------------------------------
// actions
// ------------------------------------------------------------------
const actions = {};

actions.health = async () => {
  let dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch (_) {}
  return {
    status: 'success', ok: true, db: dbOk, version: getVersionInfo().version,
    photoStorage: drive.storageMode(), driveBridge: drive.storageMode() === 'neon' || drive.bridgeConfigured(), aiGateway: ai.aiConfigured(), time: new Date().toISOString(),
  };
};

actions.get_version = async () => ({ status: 'success', ...getVersionInfo() });

// ---------- auth ----------
/** ฐานข้อมูลใหม่ยังไม่มีผู้ใช้ → สร้าง admin จาก env ADMIN_INITIAL_PASSWORD (บังคับเปลี่ยนรหัสเมื่อเข้าครั้งแรก) */
async function bootstrapAdminIfEmpty() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM app_users');
  if (rows[0].n > 0) return;
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  if (!pw || pw.length < 8) {
    throw new HttpError(503, 'ยังไม่มีผู้ใช้ในฐานข้อมูล: ตั้งค่า ADMIN_INITIAL_PASSWORD (≥ 8 ตัวอักษร) หรือรัน npm run migrate:sheet ก่อน', 'NO_USERS');
  }
  await db.query(`INSERT INTO app_users (username, password_hash, role, name, assigned_court, assigned_province, must_change_password, created_at_text)
    VALUES ('admin', $1, 'admin', 'ผู้ดูแลระบบ (Admin)', 'ศาลจังหวัดอุดรธานี', 'อุดรธานี', TRUE, $2) ON CONFLICT (username) DO NOTHING`,
  [auth.hashPassword(pw), thaiDateTimeNow().slice(0, 10)]);
}

actions.login = async (data) => {
  const username = lower(data.username);
  const password = str(data.password);
  if (!username || !password) throw new HttpError(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const { rows: fails } = await db.query(
    `SELECT COUNT(*)::int AS n FROM activity_logs
      WHERE action_type = 'LOGIN_FAILED' AND username = $1 AND at > NOW() - INTERVAL '15 minutes'`, [username]);
  if (fails[0].n >= 10) throw new HttpError(429, 'ล็อกอินผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่', 'RATE_LIMITED');

  await bootstrapAdminIfEmpty();
  const { rows } = await db.query('SELECT * FROM app_users WHERE username = $1', [username]);
  const u = rows[0];
  if (!u || u.disabled || !auth.verifyPassword(password, u.password_hash)) {
    await logActivity(username, '', 'LOGIN_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'BAD_CREDENTIALS');
  }
  await logActivity(u.username, u.role, 'LOGIN', `เข้าสู่ระบบ (${str(data.deviceMode) || '-'})`);
  return { status: 'success', token: auth.signToken(u), user: publicUser(u), expiresInSec: auth.TOKEN_TTL_SEC };
};

actions.me = async (data, ctx) => ({ status: 'success', user: publicUser(requireUser(ctx)) });

actions.logout = async (data, ctx) => {
  if (ctx.user) await logActivity(ctx.user.username, ctx.user.role, 'LOGOUT', 'ออกจากระบบ');
  return { status: 'success' };
};

// ---------- users ----------
actions.get_users = async (data, ctx) => {
  requireUser(ctx);
  const { rows } = await db.query('SELECT * FROM app_users ORDER BY (role = \'admin\') DESC, username');
  return { status: 'success', users: rows.map(publicUser) };
};

async function saveUser(data, ctx) {
  const me = requireUser(ctx);
  const target = lower(data.username);
  if (!target) throw new HttpError(400, 'ไม่พบชื่อผู้ใช้งาน (Username is required)');
  const isSelf = target === me.username;
  const isAdmin = me.role === 'admin';
  const isAdvisor = me.role === 'local_advisor';
  const myCourt = courtNameFor(me.court_category || 'ศาลจังหวัด', me.assigned_province || 'อุดรธานี', me.assigned_court);

  const { rows } = await db.query('SELECT * FROM app_users WHERE username = $1', [target]);
  const existing = rows[0];
  // Local Advisor จัดการได้เฉพาะผู้ใช้ทั่วไป (user) ในศาลเดียวกับตน
  const advisorCanManage = (u) => isAdvisor && u && u.role === 'user'
    && courtNameFor(u.court_category || 'ศาลจังหวัด', u.assigned_province || 'อุดรธานี', u.assigned_court) === myCourt;
  if (existing && !isSelf && !isAdmin && !advisorCanManage(existing)) {
    throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขผู้ใช้นี้', 'FORBIDDEN');
  }

  const cat = str(data.courtCategory || data['ประเภทศาล']).trim() || null;
  const prov = str(data.assignedProvince || data['จังหวัดที่ส่งหมาย'] || data['จังหวัดรับผิดชอบ'] || data['จังหวัด']).trim() || null;
  const court = str(data.assignedCourt || data['ศาลที่สังกัด'] || data['ชื่อศาล']).trim() || null;
  const name = str(data.name).trim() || null;
  const newPassword = str(data.password || data.newPassword);
  const ROLES = ['admin', 'local_advisor', 'user'];

  if (!existing) {
    if (!isAdmin && !isAdvisor) throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้นที่เพิ่มผู้ใช้ได้', 'FORBIDDEN');
    if (!/^[a-z0-9._-]{2,40}$/.test(target)) {
      throw new HttpError(400, 'ชื่อผู้ใช้ใหม่ต้องเป็นตัวอักษรภาษาอังกฤษ a-z, ตัวเลข 0-9 หรือ . _ - ความยาว 2-40 ตัว');
    }
    if (newPassword.length < 4) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
    const role = isAdmin && ROLES.includes(data.role) ? data.role : 'user';
    const p = isAdmin ? (prov || 'อุดรธานี') : (me.assigned_province || 'อุดรธานี');
    const c = isAdmin ? (cat || 'ศาลจังหวัด') : (me.court_category || 'ศาลจังหวัด');
    const ct = isAdmin ? courtNameFor(c, p, court) : myCourt;
    await db.query(`INSERT INTO app_users (username, password_hash, role, name, court_category, assigned_court, assigned_province, must_change_password, created_at_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)`,
      [target, auth.hashPassword(newPassword), role, name || target, c, ct, p, str(data.createdAt) || thaiDateTimeNow().slice(0, 10)]);
    await logActivity(me.username, me.role, 'USER_CREATED', `เพิ่มผู้ใช้ @${target} (${role}, ${ct})`);
    return { status: 'success', message: `เพิ่มผู้ใช้ @${target} สำเร็จ`, created: true };
  }

  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (name) add('name', name);
  if (isAdmin || isSelf) {
    if (cat) add('court_category', cat);
    if (court) add('assigned_court', court);
    if (prov) add('assigned_province', prov);
  }
  if (data.role && isAdmin && target !== 'admin' && !isSelf && ROLES.includes(data.role)) add('role', data.role);
  if (data.disabled !== undefined && isAdmin && !isSelf) add('disabled', Boolean(data.disabled));
  let newToken = null;
  if (newPassword) {
    if (newPassword.length < 4) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
    if (isSelf) {
      // เปลี่ยนรหัสผ่านตัวเองต้องยืนยันรหัสเดิม (ยกเว้นบังคับเปลี่ยนครั้งแรก)
      const cur = str(data.currentPassword || data.oldPassword);
      if (!existing.must_change_password && !auth.verifyPassword(cur, existing.password_hash)) {
        throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      }
      add('must_change_password', false);
    } else {
      add('must_change_password', true); // แอดมินรีเซ็ตให้ → ผู้ใช้ต้องเปลี่ยนเองเมื่อเข้าระบบ
    }
    add('password_hash', auth.hashPassword(newPassword));
    sets.push('token_version = token_version + 1'); // ตัดเซสชันเก่าทุกเครื่อง
  }
  if (!sets.length) return { status: 'success', message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' };
  sets.push('updated_at = NOW()');
  params.push(target);
  const { rows: upd } = await db.query(`UPDATE app_users SET ${sets.join(', ')} WHERE username = $${params.length} RETURNING *`, params);
  if (newPassword && isSelf) newToken = auth.signToken(upd[0]);
  await logActivity(me.username, me.role, newPassword ? 'USER_PASSWORD_CHANGED' : 'USER_UPDATED', `แก้ไขผู้ใช้ @${target}`);
  return { status: 'success', message: `บันทึกข้อมูลผู้ใช้ @${target} สำเร็จ`, user: publicUser(upd[0]), token: newToken };
}
actions.save_user = saveUser;
actions.update_user_profile = saveUser;
actions.update_user_password = saveUser;

actions.delete_user = async (data, ctx) => {
  const me = requireUser(ctx);
  const target = lower(data.username);
  if (target === 'admin') throw new HttpError(400, 'ไม่สามารถลบผู้ดูแลระบบหลัก (admin) ได้');
  if (target === me.username) throw new HttpError(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
  if (me.role !== 'admin') {
    const { rows } = await db.query('SELECT * FROM app_users WHERE username = $1', [target]);
    const t = rows[0];
    const sameCourt = t && courtNameFor(t.court_category || 'ศาลจังหวัด', t.assigned_province || 'อุดรธานี', t.assigned_court)
      === courtNameFor(me.court_category || 'ศาลจังหวัด', me.assigned_province || 'อุดรธานี', me.assigned_court);
    if (!(me.role === 'local_advisor' && t && t.role === 'user' && sameCourt)) {
      throw new HttpError(403, 'ไม่มีสิทธิ์ลบผู้ใช้นี้', 'FORBIDDEN');
    }
  }
  const { rowCount } = await db.query('DELETE FROM app_users WHERE username = $1', [target]);
  await logActivity(me.username, me.role, 'USER_DELETED', `ลบผู้ใช้ @${target}`);
  return rowCount
    ? { status: 'success', message: `ลบผู้ใช้ @${target} เรียบร้อยแล้ว` }
    : { status: 'error', message: `ไม่พบผู้ใช้ @${target}` };
};

// หน้าเว็บเดิมเคยส่งรายชื่อทั้งหมด (รวมรหัสผ่าน) มาเขียนทับชีต — ไม่อนุญาตแล้ว
actions.sync_all_users = async (data, ctx) => {
  requireUser(ctx);
  return { status: 'success', message: 'ผู้ใช้งานถูกจัดการที่เซิร์ฟเวอร์แล้ว (ไม่ต้องซิงค์จากเครื่อง)', ignored: true };
};
actions.sync_users_structure = actions.sync_all_users;

// ---------- summons records ----------
actions.get_data = async (data, ctx) => {
  requireUser(ctx);
  const { rows } = await db.query('SELECT * FROM summons WHERE deleted_at IS NULL ORDER BY id ASC');
  return { status: 'success', data: rows.map(summonsRowToSheet), count: rows.length };
};
actions.get_summons = actions.get_data;

/** หาแถวเป้าหมายแบบปลอดภัย: _id > fileId > (เลขคดี+เวลา) > rowIndex ที่ยืนยันแล้ว */
async function findTargetRow(data, { allowCaseOnly = false } = {}) {
  const recordId = num(data.recordId || data._id);
  if (recordId) {
    const { rows } = await db.query('SELECT * FROM summons WHERE id = $1 AND deleted_at IS NULL', [recordId]);
    if (rows[0]) return rows[0];
  }
  const fileId = str(data.oldFileId || data.fileId).trim();
  if (fileId) {
    const { rows } = await db.query('SELECT * FROM summons WHERE drive_file_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', [fileId]);
    if (rows[0]) return rows[0];
  }
  const caseNo = str(data.caseNumber).trim();
  const ts = str(data.timestamp).trim();
  if (caseNo && ts) {
    const { rows } = await db.query('SELECT * FROM summons WHERE case_number = $1 AND recorded_at_text = $2 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', [caseNo, ts]);
    if (rows[0]) return rows[0];
  }
  const rowIndex = num(data.rowIndex);
  if (rowIndex && rowIndex > 1) {
    const { rows } = await db.query('SELECT * FROM summons WHERE deleted_at IS NULL ORDER BY id ASC OFFSET $1 LIMIT 1', [rowIndex - 2]);
    const r = rows[0];
    if (r && ((fileId && r.drive_file_id === fileId) || (caseNo && r.case_number === caseNo) || (ts && r.recorded_at_text === ts))) return r;
  }
  if (allowCaseOnly && caseNo) {
    const { rows } = await db.query(
      `SELECT * FROM summons WHERE deleted_at IS NULL AND lower(regexp_replace(case_number, '\\s+', '', 'g')) = lower(regexp_replace($1, '\\s+', '', 'g'))
       ORDER BY id DESC LIMIT 1`, [caseNo]);
    if (rows[0]) return rows[0];
  }
  return null;
}

function canEdit(user, row) {
  return user.role === 'admin' || !row.uploader || lower(row.uploader) === user.username;
}

actions.upload_image = async (data, ctx) => {
  const me = requireUser(ctx);
  const clientId = str(data.clientUploadId || data.client_upload_id).trim().slice(0, 120) || null;

  // 1) idempotency: ถ้าเคยรับรายการนี้แล้ว (มือถือส่งซ้ำเพราะเน็ตหลุดตอนรอคำตอบ) คืนผลเดิม
  if (clientId) {
    const { rows } = await db.query('SELECT * FROM summons WHERE client_upload_id = $1', [clientId]);
    if (rows[0]) {
      return { status: 'success', message: 'รายการนี้ถูกบันทึกแล้ว', fileUrl: rows[0].drive_url, fileId: rows[0].drive_file_id,
        recordId: String(rows[0].id), caseNumber: rows[0].case_number, duplicateIgnored: true };
    }
  }

  const caseNumber = str(data.caseNumber).trim();
  const dateText = str(data.dateTime).trim() || thaiDateTimeNow();
  const isUpdate = Boolean(data.overwrite || data.isManualUpload || data.forceUpdate);

  // 2) กันกดซ้ำในวินาทีเดียวกัน (เลขคดี + ชื่อไฟล์ + เวลา ตรงกัน)
  if (!isUpdate && caseNumber && data.fileName) {
    const { rows } = await db.query(
      `SELECT * FROM summons WHERE case_number = $1 AND file_name = $2 AND recorded_at_text = $3 AND deleted_at IS NULL LIMIT 1`,
      [caseNumber, str(data.fileName), dateText]);
    if (rows[0]) {
      return { status: 'success', message: 'ตรวจพบรายการส่งซ้ำ ข้อมูลถูกบันทึกแล้ว', fileUrl: rows[0].drive_url,
        fileId: rows[0].drive_file_id, recordId: String(rows[0].id), duplicateIgnored: true };
    }
  }

  let target = null;
  if (isUpdate) {
    target = await findTargetRow(data, { allowCaseOnly: true });
    if (target && !canEdit(me, target)) {
      throw new HttpError(403, `ไม่มีสิทธิ์แก้ไขข้อมูลนี้ (เฉพาะผู้บันทึก @${target.uploader} หรือผู้ดูแลระบบ)`, 'FORBIDDEN');
    }
  }

  // 3) อัปโหลดภาพไป Google Drive ก่อน (ถ้าล้มเหลว → error → เครื่องจะเก็บไว้ในคิวแล้วลองใหม่)
  let fileId = '';
  let fileUrl = '';
  if (data.imageBase64 && data.fileName) {
    const up = await drive.uploadImage({ fileName: str(data.fileName), imageBase64: str(data.imageBase64), origin: ctx.origin });
    fileId = up.fileId; fileUrl = up.fileUrl;
  }

  const uploader = me.username; // ใช้ผู้ใช้จาก token เสมอ (ไม่เชื่อค่าที่ส่งมา)
  const values = {
    recorded_at_text: dateText,
    recorded_at: parseThaiDateTime(dateText) || new Date(),
    case_number: caseNumber,
    court_type: str(data.courtType),
    province: str(data.province),
    district: str(data.district),
    subdistrict: str(data.subdistrict),
    location_type: str(data.locationType),
    location_text: str(data.locationText),
    lat: num(data.lat),
    lng: num(data.lng),
    heading: data.heading === undefined ? null : str(data.heading),
    file_name: str(data.fileName),
  };

  let row;
  if (target) {
    const oldFileId = target.drive_file_id;
    const { rows } = await db.query(`UPDATE summons SET
        recorded_at_text = $1, recorded_at = $2, court_type = COALESCE(NULLIF($3,''), court_type),
        district = COALESCE(NULLIF($4,''), district), subdistrict = COALESCE(NULLIF($5,''), subdistrict),
        location_type = COALESCE(NULLIF($6,''), location_type), location_text = COALESCE(NULLIF($7,''), location_text),
        lat = COALESCE($8, lat), lng = COALESCE($9, lng), heading = COALESCE($10, heading),
        file_name = $11, drive_url = COALESCE(NULLIF($12,''), drive_url), drive_file_id = COALESCE(NULLIF($13,''), drive_file_id),
        province = COALESCE(NULLIF($14,''), province), uploader = COALESCE(uploader, $15),
        client_upload_id = COALESCE(client_upload_id, $16), updated_at = NOW()
      WHERE id = $17 RETURNING *`,
      [values.recorded_at_text, values.recorded_at, values.court_type, values.district, values.subdistrict, values.location_type,
        values.location_text, values.lat, values.lng, values.heading, values.file_name, fileUrl, fileId, values.province,
        uploader, clientId, target.id]);
    row = rows[0];
    if (fileId && oldFileId && oldFileId !== fileId && data.overwrite) await drive.trashFile(oldFileId);
  } else {
    try {
      const { rows } = await db.query(`INSERT INTO summons
        (client_upload_id, recorded_at_text, recorded_at, case_number, court_type, province, district, subdistrict, location_type,
         location_text, lat, lng, heading, file_name, drive_url, drive_file_id, uploader)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [clientId, values.recorded_at_text, values.recorded_at, values.case_number, values.court_type, values.province, values.district,
          values.subdistrict, values.location_type, values.location_text, values.lat, values.lng, values.heading, values.file_name,
          fileUrl, fileId, uploader]);
      row = rows[0];
    } catch (e) {
      if (e.code === '23505' && clientId) { // อีกคำขอที่ส่งพร้อมกันบันทึกไปก่อนแล้ว
        if (fileId) await drive.trashFile(fileId);
        const { rows } = await db.query('SELECT * FROM summons WHERE client_upload_id = $1', [clientId]);
        row = rows[0];
      } else {
        throw e;
      }
    }
  }
  return {
    status: 'success',
    message: target ? 'แทนที่ข้อมูลเดิมเรียบร้อยแล้ว' : 'บันทึกรูปภาพและข้อมูลสำเร็จ',
    fileUrl: row.drive_url, fileId: row.drive_file_id, recordId: String(row.id),
    caseNumber: row.case_number, isOverwrite: Boolean(data.overwrite),
  };
};

actions.edit_record = async (data, ctx) => {
  const me = requireUser(ctx);
  const target = await findTargetRow(data);
  let fileId = str(data.fileId);
  let fileUrl = str(data.fileUrl);

  if (target && !canEdit(me, target)) {
    return { status: 'error', message: `ท่านไม่มีสิทธิ์แก้ไขข้อมูลนี้ (สามารถแก้ไขได้เฉพาะผู้บันทึก @${target.uploader} หรือผู้ดูแลระบบเท่านั้น)` };
  }
  if (data.imageBase64 && data.fileName) {
    const up = await drive.uploadImage({ fileName: str(data.fileName), imageBase64: str(data.imageBase64), origin: ctx.origin });
    if (data.oldFileId) await drive.trashFile(str(data.oldFileId));
    fileId = up.fileId; fileUrl = up.fileUrl;
  }

  if (target) {
    const { rows } = await db.query(`UPDATE summons SET
        case_number = COALESCE(NULLIF($1,''), case_number), court_type = COALESCE(NULLIF($2,''), court_type),
        district = COALESCE(NULLIF($3,''), district), subdistrict = COALESCE(NULLIF($4,''), subdistrict),
        location_type = COALESCE(NULLIF($5,''), location_type), location_text = COALESCE(NULLIF($6,''), location_text),
        lat = COALESCE($7, lat), lng = COALESCE($8, lng), heading = COALESCE($9, heading),
        province = COALESCE(NULLIF($10,''), province),
        file_name = CASE WHEN $11 <> '' AND $12 <> '' THEN $13 ELSE file_name END,
        drive_url = CASE WHEN $11 <> '' AND $12 <> '' THEN $11 ELSE drive_url END,
        drive_file_id = CASE WHEN $11 <> '' AND $12 <> '' THEN $12 ELSE drive_file_id END,
        updated_at = NOW()
      WHERE id = $14 RETURNING *`,
      [str(data.caseNumber), str(data.courtType), str(data.district), str(data.subdistrict), str(data.locationType), str(data.locationText),
        num(data.lat), num(data.lng), data.heading === undefined ? null : str(data.heading), str(data.province),
        fileUrl, fileId, str(data.fileName), target.id]);
    await logActivity(me.username, me.role, 'RECORD_EDITED', `แก้ไขคดี ${rows[0].case_number} (#${target.id})`);
    return { status: 'success', message: `แก้ไขข้อมูลเลขคดี ${rows[0].case_number} เรียบร้อยแล้ว`, targetRowIndex: data.rowIndex || null,
      recordId: String(target.id), fileUrl: rows[0].drive_url, fileId: rows[0].drive_file_id };
  }

  const { rows } = await db.query(`INSERT INTO summons
    (recorded_at_text, recorded_at, case_number, court_type, province, district, subdistrict, location_type, location_text, lat, lng, heading, file_name, drive_url, drive_file_id, uploader)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [str(data.dateTime) || thaiDateTimeNow(), parseThaiDateTime(data.dateTime) || new Date(), str(data.caseNumber), str(data.courtType), str(data.province),
      str(data.district), str(data.subdistrict), str(data.locationType), str(data.locationText), num(data.lat), num(data.lng),
      data.heading === undefined ? null : str(data.heading), str(data.fileName), fileUrl, fileId, me.username]);
  return { status: 'success', message: 'บันทึกข้อมูลแก้ไขสำเร็จ', recordId: String(rows[0].id), fileUrl, fileId };
};
actions.update_record = actions.edit_record;

actions.delete = async (data, ctx) => {
  const me = requireAdmin(ctx);
  const target = await findTargetRow(data);
  let deletedFiles = 0;
  if (target) {
    await db.query('UPDATE summons SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [target.id]);
    if (target.drive_file_id && (await drive.trashFile(target.drive_file_id))) deletedFiles++;
    await logActivity(me.username, me.role, 'RECORD_DELETED', `ลบคดี ${target.case_number} (#${target.id})`,
      { id: target.id, fileId: target.drive_file_id });
  } else if (data.fileId && (await drive.trashFile(str(data.fileId)))) {
    deletedFiles++;
  }
  return {
    status: 'success',
    message: target ? `ลบรายการ ${target.case_number} เรียบร้อยแล้ว` : `ไม่พบแถวที่ตรงกับเงื่อนไข (ลบไฟล์ใน Drive: ${deletedFiles} ไฟล์)`,
    deletedRows: target ? 1 : 0, deletedFiles, targetRowIndex: data.rowIndex || -1,
  };
};

actions.upload_route_reference_image = async (data, ctx) => {
  requireUser(ctx);
  if (!data.imageBase64) return { status: 'success', fileId: '', fileUrl: '', imageUrl: '' };
  const fileName = str(data.fileName || `route_ref_${data.caseNumber || 'stop'}_${Date.now()}.jpg`).replace(/[^\w.\-]/g, '_');
  const up = await drive.uploadImage({ fileName, imageBase64: str(data.imageBase64), publicLink: true, origin: ctx.origin });
  return { status: 'success', message: 'อัปโหลดรูปภาพประกอบการวางแผนเส้นทางสำเร็จ', fileId: up.fileId, fileUrl: up.fileUrl,
    imageUrl: up.fileId && !String(up.fileId).startsWith('db-') ? `https://lh3.googleusercontent.com/d/${up.fileId}` : up.fileUrl };
};

// ---------- route handoff / share ----------
async function upsertHandoff(target, fields) {
  const { rows } = await db.query(`INSERT INTO route_handoffs
      (target_user, from_user, from_user_name, type, status, case_number, full_address, query_string, lat, lng, payload, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW(), NOW())
    ON CONFLICT (target_user) DO UPDATE SET
      from_user = EXCLUDED.from_user, from_user_name = EXCLUDED.from_user_name, type = EXCLUDED.type,
      status = CASE WHEN $12::boolean AND route_handoffs.status = 'pending' THEN 'pending' ELSE EXCLUDED.status END,
      case_number = EXCLUDED.case_number, full_address = EXCLUDED.full_address, query_string = EXCLUDED.query_string,
      lat = EXCLUDED.lat, lng = EXCLUDED.lng, payload = EXCLUDED.payload,
      created_at = NOW(), updated_at = NOW()
    RETURNING *`,
  [target, fields.from_user, fields.from_user_name, fields.type, fields.status, fields.case_number, fields.full_address,
    fields.query_string, fields.lat, fields.lng, JSON.stringify(fields.payload), Boolean(fields.keepPending)]);
  return rows[0];
}

actions.send_handoff = async (data, ctx) => {
  const me = requireUser(ctx);
  let targets = [];
  if (Array.isArray(data.target_user_ids) && data.target_user_ids.length) targets = data.target_user_ids.map(lower).filter(Boolean);
  else if (data.target_user_id || data.user_id || data.username) targets = [lower(data.target_user_id || data.user_id || data.username)];
  else targets = [me.username];
  targets = [...new Set(targets)].slice(0, 100);

  const type = str(data.type || (data.action === 'share_route' ? 'share_route' : 'handoff')).trim();
  if (type !== 'share_route' && targets.some((t) => t !== me.username) && me.role !== 'admin') {
    throw new HttpError(403, 'ส่งต่อเส้นทางข้ามอุปกรณ์ได้เฉพาะบัญชีของตนเอง (ใช้เมนูแชร์เส้นทางเพื่อส่งให้ผู้อื่น)', 'FORBIDDEN');
  }
  const { rows: exist } = await db.query('SELECT username FROM app_users WHERE username = ANY($1)', [targets]);
  const valid = new Set(exist.map((r) => r.username));
  const unknown = targets.filter((t) => !valid.has(t));
  const payload = sanitizeRoutePayload({ ...data, from_user_id: me.username, from_user_name: me.name || me.username, type });

  for (const t of targets.filter((x) => valid.has(x))) {
    await upsertHandoff(t, {
      from_user: me.username, from_user_name: me.name || me.username, type, status: 'pending',
      case_number: str(data.caseNumber), full_address: str(data.fullAddress), query_string: str(data.queryString),
      lat: num(data.lat), lng: num(data.lng), payload,
    });
  }
  const sent = targets.filter((x) => valid.has(x));
  if (type === 'share_route') {
    await logActivity(me.username, me.role, 'ROUTE_SHARED', `แชร์เส้นทาง ${payload.stops.length} จุด ให้ ${sent.map((u) => '@' + u).join(', ')}`);
  }
  return {
    status: sent.length ? 'success' : 'error',
    message: sent.length ? (type === 'share_route' ? `แชร์เส้นทางให้ ${sent.length} ท่านแล้ว` : 'ส่งเส้นทางไปยังอุปกรณ์แล้ว') : 'ไม่พบผู้รับในระบบ',
    recipients_count: sent.length, recipients: sent, unknown_recipients: unknown,
    from_user_id: me.username, from_user_name: me.name || me.username, type, timestamp: bangkokStamp(),
  };
};
actions.share_route = actions.send_handoff;

actions.save_user_route = async (data, ctx) => {
  const me = requireUser(ctx);
  const target = resolveSelfOrAdmin(ctx, data.user_id || data.target_user_id || data.username);
  const payload = sanitizeRoutePayload({ ...data, from_user_id: target, from_user_name: data.userName || me.name, type: 'user_saved_route' });
  await upsertHandoff(target, {
    from_user: target, from_user_name: str(data.userName || data.name || me.name || target), type: 'user_saved_route',
    status: 'active_route', keepPending: true, case_number: str(data.caseNumber), full_address: str(data.fullAddress),
    query_string: str(data.queryString), lat: num(data.lat), lng: num(data.lng), payload,
  });
  return { status: 'success', message: 'Route saved to server successfully', user_id: target, timestamp: bangkokStamp() };
};

actions.get_user_route = async (data, ctx) => {
  const target = resolveSelfOrAdmin(ctx, data.target_user_id || data.user_id || data.username);
  const { rows } = await db.query('SELECT * FROM route_handoffs WHERE target_user = $1', [target]);
  let item = rows[0] && rows[0].status !== 'cleared' ? handoffRowToItem(rows[0]) : null;
  if (item && data.action === 'get_pending_handoff' && item.status !== 'pending') item = null;
  return {
    status: 'success',
    hasPending: Boolean(item && item.status === 'pending'),
    hasRoute: Boolean(item && item.status !== 'cleared'),
    handoff: item, route: item,
  };
};
actions.get_pending_handoff = actions.get_user_route;
actions.get_latest_handoff = actions.get_user_route;

actions.ack_handoff = async (data, ctx) => {
  const target = resolveSelfOrAdmin(ctx, data.target_user_id || data.user_id || data.username);
  const { rowCount } = await db.query(`UPDATE route_handoffs
      SET status = CASE WHEN type = 'share_route' THEN 'shared_active' ELSE 'received' END, updated_at = NOW()
      WHERE target_user = $1 AND status <> 'cleared'`, [target]);
  return { status: 'success', message: rowCount ? 'Handoff status updated' : 'User record not found', updated: rowCount > 0, timestamp: bangkokStamp() };
};

actions.clear_user_route = async (data, ctx) => {
  const target = resolveSelfOrAdmin(ctx, data.target_user_id || data.user_id || data.username);
  const { rowCount } = await db.query(`UPDATE route_handoffs SET status = 'cleared', updated_at = NOW() WHERE target_user = $1`, [target]);
  return { status: 'success', message: rowCount ? 'User route marked as cleared' : 'User record not found', cleared: rowCount > 0, timestamp: bangkokStamp() };
};
actions.dismiss_handoff = actions.clear_user_route;

// ---------- QR share codes ----------
actions.create_share_code = async (data, ctx) => {
  const me = requireUser(ctx);
  const payload = sanitizeRoutePayload({ ...data, from_user_id: me.username, from_user_name: me.name || me.username, type: 'share_route' });
  if (!payload.stops.length) throw new HttpError(400, 'ไม่มีจุดส่งหมายในเส้นทางที่จะแชร์');
  const days = Math.min(30, Math.max(1, Number(data.expiresInDays) || 7));
  for (let i = 0; i < 5; i++) {
    const code = auth.randomCode(8);
    try {
      const { rows } = await db.query(`INSERT INTO route_shares (code, created_by, created_by_name, stops_count, payload, expires_at)
        VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' days')::interval) RETURNING code, expires_at`,
      [code, me.username, me.name || me.username, payload.stops.length, JSON.stringify(payload), String(days)]);
      await logActivity(me.username, me.role, 'ROUTE_QR_CREATED', `สร้าง QR แชร์เส้นทาง ${payload.stops.length} จุด (รหัส ${code})`);
      return { status: 'success', code: rows[0].code, expiresAt: rows[0].expires_at, stopsCount: payload.stops.length };
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }
  throw new HttpError(500, 'สร้างรหัสแชร์ไม่สำเร็จ กรุณาลองใหม่');
};

actions.get_share_code = async (data, ctx) => {
  const me = requireUser(ctx);
  const code = str(data.code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new HttpError(400, 'ไม่พบรหัสแชร์');
  const { rows } = await db.query(`UPDATE route_shares SET open_count = open_count + 1, last_opened_by = $2
      WHERE code = $1 RETURNING *`, [code, me.username]);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'ไม่พบเส้นทางจากรหัสนี้ (รหัสผิดหรือถูกลบแล้ว)', 'NOT_FOUND');
  if (r.revoked) throw new HttpError(410, 'เส้นทางนี้ถูกยกเลิกการแชร์แล้ว', 'REVOKED');
  if (new Date(r.expires_at) < new Date()) throw new HttpError(410, 'รหัสแชร์นี้หมดอายุแล้ว กรุณาขอ QR ใหม่จากผู้แชร์', 'EXPIRED');
  await logActivity(me.username, me.role, 'ROUTE_QR_OPENED', `รับเส้นทางจาก QR ${code} ของ @${r.created_by}`);
  return {
    status: 'success', code: r.code, createdBy: r.created_by, createdByName: r.created_by_name,
    createdAt: r.created_at, expiresAt: r.expires_at, route: { ...r.payload, type: 'share_route' },
  };
};

actions.list_share_codes = async (data, ctx) => {
  const me = requireUser(ctx);
  const all = me.role === 'admin' && data.all;
  const { rows } = await db.query(`SELECT code, created_by, created_by_name, stops_count, open_count, revoked, created_at, expires_at
      FROM route_shares WHERE ($1::boolean OR created_by = $2) ORDER BY created_at DESC LIMIT 50`, [Boolean(all), me.username]);
  return { status: 'success', shares: rows };
};

actions.revoke_share_code = async (data, ctx) => {
  const me = requireUser(ctx);
  const { rowCount } = await db.query(`UPDATE route_shares SET revoked = TRUE WHERE code = $1 AND (created_by = $2 OR $3::boolean)`,
    [str(data.code).toUpperCase(), me.username, me.role === 'admin']);
  return { status: rowCount ? 'success' : 'error', message: rowCount ? 'ยกเลิกการแชร์แล้ว' : 'ไม่พบรหัสแชร์ของท่าน' };
};

// ---------- misc ----------
actions.search_place = async (data, ctx) => {
  requireUser(ctx);
  const q = str(data.q || data.query).trim();
  if (!q || !drive.bridgeConfigured()) return { status: 'success', results: [] };
  try { return { status: 'success', results: await drive.geocode(q) }; } catch (_) { return { status: 'success', results: [] }; }
};
actions.geocode = actions.search_place;

actions.log_activity = async (data, ctx) => {
  const u = ctx.user;
  await logActivity(u ? u.username : lower((data.user && data.user.username) || data.username) || 'anonymous', u ? u.role : '',
    data.actionType || data.activity || 'MAP_ACTION', data.details || data.message || '-', data.extra || null);
  return { status: 'success', message: 'Logged successfully', timestamp: bangkokStamp() };
};
actions.log_map_action = actions.log_activity;

actions.get_activity_logs = async (data, ctx) => {
  requireAdmin(ctx);
  const limit = Math.min(500, Math.max(10, Number(data.limit) || 200));
  const { rows } = await db.query('SELECT * FROM activity_logs ORDER BY at DESC LIMIT $1', [limit]);
  return { status: 'success', logs: rows };
};

// ---------- error / bug log ----------
actions.log_error = async (data, ctx) => {
  const items = Array.isArray(data.errors) ? data.errors.slice(0, 20) : [data];
  for (const e of items) {
    const message = str(e.message).slice(0, 1000);
    if (!message) continue;
    const fp = str(e.fingerprint) || ('client:' + message.slice(0, 160) + ':' + str(e.source_file || '').slice(-60));
    await upsertError({
      source: 'client', app_version: str(e.appVersion || data.appVersion), username: ctx.user ? ctx.user.username : str(e.username),
      device: e.device || data.device, url: e.url, message, stack: e.stack, context: e.context || null, fingerprint: fp,
    });
  }
  return { status: 'success' };
};

actions.list_errors = async (data, ctx) => {
  requireAdmin(ctx);
  const status = str(data.status);
  const { rows } = await db.query(`SELECT * FROM error_logs WHERE ($1 = '' OR status = $1) ORDER BY last_seen_at DESC LIMIT 300`, [status]);
  const { rows: counts } = await db.query('SELECT status, COUNT(*)::int AS n FROM error_logs GROUP BY status');
  return { status: 'success', errors: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
};

actions.update_error = async (data, ctx) => {
  const me = requireAdmin(ctx);
  const st = ['new', 'investigating', 'fixed', 'ignored'].includes(data.status) ? data.status : null;
  if (!st) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
  const { rows } = await db.query(`UPDATE error_logs SET status = $1, admin_note = COALESCE($2, admin_note),
      fixed_in_version = COALESCE(NULLIF($3,''), fixed_in_version),
      resolved_by = CASE WHEN $1 IN ('fixed','ignored') THEN $4 ELSE resolved_by END,
      resolved_at = CASE WHEN $1 IN ('fixed','ignored') THEN NOW() ELSE resolved_at END
    WHERE id = $5 RETURNING *`, [st, data.adminNote === undefined ? null : str(data.adminNote), str(data.fixedInVersion), me.username, num(data.id)]);
  return { status: rows[0] ? 'success' : 'error', error: rows[0] || null };
};

// ---------- AI (Neon AI Gateway) ----------
actions.ai_extract_dispatch = async (data, ctx) => {
  const me = requireUser(ctx);
  if (!ai.aiConfigured()) return { status: 'error', code: 'NO_AI_GATEWAY', message: 'ยังไม่ได้เปิดใช้ AI Gateway' };
  const records = await ai.extractDispatchRecords(str(data.text), str(data.province) || me.assigned_province || 'อุดรธานี');
  await logActivity(me.username, me.role, 'AI_EXTRACT_DISPATCH', `AI อ่านบัญชีจ่ายหมายได้ ${records.length} รายการ`);
  return { status: 'success', records };
};

// ------------------------------------------------------------------
// handler
// ------------------------------------------------------------------
const PUBLIC_ACTIONS = new Set(['health', 'get_version', 'login', 'log_error', 'logout']);

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405; return res.end();
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const ctx = { action: '', user: null, origin: host ? `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : proto}://${host}` : '' };
  let status = 200;
  let out;
  try {
    const query = getQuery(req);
    const body = await readBody(req);
    const data = { ...query, ...body };
    // GAS เดิม: ไม่มี action แต่มีรูป → upload_image
    const action = str(data.action || (data.imageBase64 ? 'upload_image' : '') || (data.sheet === 'users' ? 'get_users' : '')).trim();
    ctx.action = action;
    const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
    if (!fn) throw new HttpError(400, `ไม่รู้จักคำสั่ง (action): ${action || '-'}`, 'UNKNOWN_ACTION');
    if (req.method === 'GET' && !['health', 'get_version', 'get_data', 'get_summons', 'get_users', 'get_user_route', 'get_pending_handoff',
      'get_latest_handoff', 'search_place', 'geocode', 'get_share_code', 'list_share_codes', 'list_errors', 'get_activity_logs', 'me', 'sync_all_users', 'sync_users_structure'].includes(action)) {
      throw new HttpError(405, 'คำสั่งนี้ต้องใช้ POST');
    }
    if (!PUBLIC_ACTIONS.has(action) || action === 'log_error' || action === 'logout') {
      ctx.user = await currentUser(req, data);
    }
    out = await fn(data, ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      status = err.status;
      out = { status: 'error', code: err.code || undefined, message: err.message };
    } else {
      status = err.code === 'NO_DATABASE_URL' ? 503 : (err.code === 'NO_DRIVE_BRIDGE' ? 503 : 500);
      console.error('[api/slts]', ctx.action, err);
      out = { status: 'error', code: err.code || 'SERVER_ERROR', message: err.message || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' };
      if (err.code !== 'NO_DATABASE_URL') await logServerError(err, ctx);
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
};

// สำหรับทดสอบ
module.exports._internal = { actions, parseThaiDateTime, sanitizeRoutePayload, summonsRowToSheet };
