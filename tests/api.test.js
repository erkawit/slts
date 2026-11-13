/**
 * tests/api.test.js — ทดสอบ API ทั้งระบบกับ Postgres จริง (ใช้ฐานข้อมูลทดสอบ/branch ทดสอบเท่านั้น!)
 *   TEST_DATABASE_URL=postgres://... node --test tests/
 * จำลอง Google Apps Script (Drive bridge) ด้วยเซิร์ฟเวอร์ในเครื่อง
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  test('skipped: set TEST_DATABASE_URL to run API tests', () => {});
  return;
}
process.env.DATABASE_URL = DB;
process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin#2026x';
process.env.GAS_BRIDGE_SECRET = 'bridge-secret';
process.env.PHOTO_STORAGE = 'google-drive'; // ชุดทดสอบส่วนใหญ่ใช้ Drive จำลอง; มีทดสอบ Neon storage แยก

const db = require('../lib/db');
let apiBase, bridge, server;
const bridgeCalls = [];

function startServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      req.query = Object.fromEntries(u.searchParams);
      handler(req, res);
    }).listen(0, () => resolve(s));
  });
}

async function call(action, body = {}, token, method = 'POST') {
  const headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const url = method === 'GET'
    ? `${apiBase}/api/slts?${new URLSearchParams({ action, ...body })}`
    : `${apiBase}/api/slts`;
  const res = await fetch(url, { method, headers, body: method === 'POST' ? JSON.stringify({ action, ...body }) : undefined });
  return { http: res.status, ...(await res.json()) };
}

test.before(async () => {
  const pg = db.getPool();
  await pg.query('DROP TABLE IF EXISTS app_users, summons, route_handoffs, route_shares, activity_logs, error_logs, app_releases CASCADE');
  bridge = await startServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const d = JSON.parse(raw);
    bridgeCalls.push(d.action);
    res.setHeader('Content-Type', 'application/json');
    if (d.secret !== 'bridge-secret') return res.end(JSON.stringify({ status: 'error', message: 'unauthorized' }));
    if (d.action === 'drive_upload') {
      const id = 'FILE_' + bridgeCalls.length;
      return res.end(JSON.stringify({ status: 'success', fileId: id, fileUrl: `https://drive.google.com/file/d/${id}/view` }));
    }
    if (d.action === 'drive_trash') return res.end(JSON.stringify({ status: 'success' }));
    if (d.action === 'search_place') return res.end(JSON.stringify({ status: 'success', results: [{ name: 'x', lat: 1, lng: 2 }] }));
    res.end(JSON.stringify({ status: 'error', message: 'unknown' }));
  });
  process.env.GAS_DRIVE_URL = `http://127.0.0.1:${bridge.address().port}/exec`;
  const handler = require('../api/slts');
  const health = require('../api/health');
  const photo = require('../api/photo');
  server = await startServer((req, res) => (req.url.startsWith('/api/health') ? health(req, res)
    : req.url.startsWith('/api/photo') ? photo(req, res) : handler(req, res)));
  apiBase = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close(); bridge.close(); await db.close();
});

let adminToken, userToken, recId;

test('health reports db + version', async () => {
  const r = await (await fetch(`${apiBase}/api/health`)).json();
  assert.equal(r.status, 'success');
  assert.equal(r.db, true);
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
});

test('protected actions require a token', async () => {
  const r = await call('get_data', {}, null, 'GET');
  assert.equal(r.http, 401);
  assert.equal(r.code, 'AUTH_REQUIRED');
});

test('admin bootstrap + login, wrong password rejected', async () => {
  const bad = await call('login', { username: 'admin', password: 'nope' });
  assert.equal(bad.http, 401);
  const ok = await call('login', { username: 'ADMIN', password: 'Admin#2026x' });
  assert.equal(ok.status, 'success');
  assert.equal(ok.user.mustChangePassword, true);
  assert.equal(ok.user.password, undefined, 'password must never be returned');
  adminToken = ok.token;
});

test('admin creates user; get_users never leaks password hashes', async () => {
  const c = await call('save_user', { username: 'somchai', password: 'pass1234', name: 'สมชาย', assignedProvince: 'ขอนแก่น' }, adminToken);
  assert.equal(c.status, 'success');
  const l = await call('get_users', {}, adminToken, 'GET');
  assert.ok(l.users.length >= 2);
  for (const u of l.users) {
    assert.equal(u.password, undefined);
    assert.equal(u.password_hash, undefined);
  }
  const s = l.users.find((u) => u.username === 'somchai');
  assert.equal(s.assignedCourt, 'ศาลจังหวัดขอนแก่น');
  const login = await call('login', { username: 'somchai', password: 'pass1234' });
  userToken = login.token;
  assert.ok(userToken);
});

test('local advisor manages only users of own court', async () => {
  await call('save_user', { username: 'advisor_kk', password: 'adv12345', role: 'local_advisor', assignedProvince: 'ขอนแก่น' }, adminToken);
  await call('save_user', { username: 'udon_user', password: 'udon1234' }, adminToken);
  const advTok = (await call('login', { username: 'advisor_kk', password: 'adv12345' })).token;
  const created = await call('save_user', { username: 'kk_new', password: 'kknew123', role: 'admin', assignedProvince: 'ภูเก็ต' }, advTok);
  assert.equal(created.status, 'success');
  const users = (await call('get_users', {}, adminToken, 'GET')).users;
  const kk = users.find((u) => u.username === 'kk_new');
  assert.equal(kk.role, 'user', 'advisor cannot grant admin');
  assert.equal(kk.assignedCourt, 'ศาลจังหวัดขอนแก่น', 'forced to advisor court');
  const denied = await call('update_user_password', { username: 'udon_user', password: 'hijack123' }, advTok);
  assert.equal(denied.http, 403);
  const delDenied = await call('delete_user', { username: 'udon_user' }, advTok);
  assert.equal(delDenied.http, 403);
  const del = await call('delete_user', { username: 'kk_new' }, advTok);
  assert.equal(del.status, 'success');
});

test('non-admin cannot create users or delete records', async () => {
  const r = await call('save_user', { username: 'hacker', password: 'xxxx1234' }, userToken);
  assert.equal(r.http, 403);
  const d = await call('delete', { fileId: 'x' }, userToken);
  assert.equal(d.http, 403);
});

test('upload_image is idempotent by clientUploadId and stores Drive id', async () => {
  const payload = {
    clientUploadId: 'cap_123', caseNumber: 'ผบE1245/2569', courtType: 'ศาลจังหวัดอุดรธานี', province: 'อุดรธานี',
    district: 'เมืองอุดรธานี', subdistrict: 'หมากแข้ง', locationType: 'หมายบ้าน', locationText: '154 ม.3 ต.หมากแข้ง',
    lat: '17.413800', lng: '102.787200', heading: 45, dateTime: '13 พ.ย. 2569 12:30:00', fileName: 'ผบE1245-2569.jpg',
    imageBase64: 'data:image/jpeg;base64,/9j/AAAA', uploader: 'someone-else',
  };
  const a = await call('upload_image', payload, userToken);
  assert.equal(a.status, 'success');
  assert.ok(a.fileId.startsWith('FILE_'));
  recId = a.recordId;
  const b = await call('upload_image', payload, userToken);
  assert.equal(b.duplicateIgnored, true);
  assert.equal(b.recordId, recId);
  const rows = await call('get_data', {}, userToken, 'GET');
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0]['เลขคดี'], 'ผบE1245/2569');
  assert.equal(rows.data[0]['ผู้บันทึก'], 'somchai', 'uploader comes from token, not body');
  assert.equal(rows.data[0]['ละติจูด (Lat)'], '17.4138');
});

test('photo storage in Neon (no Google Drive): upload, view via signed URL, delete', async () => {
  process.env.PHOTO_STORAGE = 'neon';
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const r = await call('upload_image', { clientUploadId: 'cap_neon1', caseNumber: 'อ9/2569', fileName: 'อ9-2569.jpg',
    imageBase64: 'data:image/jpeg;base64,' + jpeg.toString('base64') }, userToken);
  process.env.PHOTO_STORAGE = 'google-drive';
  assert.equal(r.status, 'success');
  assert.match(r.fileId, /^db-\d+-[A-Za-z0-9]{16}$/);
  assert.ok(r.fileUrl.includes('/api/photo?f='));
  const img = await fetch(apiBase + new URL(r.fileUrl).pathname + new URL(r.fileUrl).search);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), jpeg);
  const forged = await fetch(`${apiBase}/api/photo?f=${r.fileId.replace(/-[A-Za-z0-9]{16}$/, '-AAAAAAAAAAAAAAAA')}`);
  assert.equal(forged.status, 404, 'tampered signature rejected');
  const h = await (await fetch(`${apiBase}/api/health`)).json();
  assert.equal(h.photoStorage, 'google-drive');
  const d = await call('delete', { recordId: r.recordId }, adminToken);
  assert.equal(d.deletedFiles, 1);
  const gone = await fetch(apiBase + new URL(r.fileUrl).pathname + new URL(r.fileUrl).search);
  assert.equal(gone.status, 404);
});

test('edit_record: owner can edit, other user cannot', async () => {
  await call('save_user', { username: 'nid', password: 'pass5678' }, adminToken);
  const nidToken = (await call('login', { username: 'nid', password: 'pass5678' })).token;
  const denied = await call('edit_record', { recordId: recId, locationText: 'hack' }, nidToken);
  assert.equal(denied.status, 'error');
  const ok = await call('edit_record', { recordId: recId, locationText: '155 ม.3 ต.หมากแข้ง' }, userToken);
  assert.equal(ok.status, 'success');
  const rows = await call('get_data', {}, userToken, 'GET');
  assert.equal(rows.data[0]['ที่ตั้งส่งหมาย (เต็ม)'], '155 ม.3 ต.หมากแข้ง');
});

test('QR share code: create → open by another user → revoke', async () => {
  const route = { stops: [{ caseNumber: 'อ1/2569', lat: 17.4, lng: 102.7, capturedPhotoUrl: 'data:image/jpeg;base64,' + 'A'.repeat(5000) }], startLocation: { name: 'ศาล', lat: 17.41, lng: 102.78 } };
  const c = await call('create_share_code', route, userToken);
  assert.equal(c.status, 'success');
  assert.match(c.code, /^[2-9A-HJ-NP-Z]{8}$/);
  const nidToken = (await call('login', { username: 'nid', password: 'pass5678' })).token;
  const g = await call('get_share_code', { code: c.code.toLowerCase() }, nidToken, 'GET');
  assert.equal(g.status, 'success');
  assert.equal(g.route.stops.length, 1);
  assert.equal(g.route.stops[0].capturedPhotoUrl, undefined, 'base64 photos stripped from shared payload');
  assert.equal(g.createdBy, 'somchai');
  const anon = await call('get_share_code', { code: c.code }, null, 'GET');
  assert.equal(anon.http, 401);
  await call('revoke_share_code', { code: c.code }, userToken);
  const after = await call('get_share_code', { code: c.code }, nidToken, 'GET');
  assert.equal(after.http, 410);
});

test('share_route to users + pending/ack/clear lifecycle', async () => {
  const s = await call('share_route', { type: 'share_route', target_user_ids: ['nid', 'ghost'], stops: [{ caseNumber: 'อ2/2569' }] }, userToken);
  assert.deepEqual(s.recipients, ['nid']);
  assert.deepEqual(s.unknown_recipients, ['ghost']);
  const nidToken = (await call('login', { username: 'nid', password: 'pass5678' })).token;
  const p = await call('get_pending_handoff', { user_id: 'nid' }, nidToken, 'GET');
  assert.equal(p.hasPending, true);
  assert.equal(p.handoff.from_user_id, 'somchai');
  const spy = await call('get_user_route', { user_id: 'nid' }, userToken, 'GET');
  assert.equal(spy.http, 403, 'cannot read another user route');
  await call('ack_handoff', { user_id: 'nid' }, nidToken);
  const r = await call('get_user_route', { user_id: 'nid' }, nidToken, 'GET');
  assert.equal(r.route.status, 'shared_active');
  await call('clear_user_route', { user_id: 'nid' }, nidToken);
  const c = await call('get_user_route', { user_id: 'nid' }, nidToken, 'GET');
  assert.equal(c.hasRoute, false);
});

test('password change requires current password and rotates token', async () => {
  // ครั้งแรก (แอดมินสร้าง/รีเซ็ตให้) ระบบบังคับเปลี่ยนรหัสโดยไม่ต้องกรอกรหัสเดิม
  const first = await call('update_user_password', { username: 'somchai', password: 'pass1234b' }, userToken);
  assert.equal(first.status, 'success');
  userToken = first.token;
  const bad = await call('update_user_password', { username: 'somchai', password: 'newpass99', currentPassword: 'wrong' }, userToken);
  assert.equal(bad.status, 'error');
  const ok = await call('update_user_password', { username: 'somchai', password: 'newpass99', currentPassword: 'pass1234b' }, userToken);
  assert.equal(ok.status, 'success');
  assert.ok(ok.token);
  const old = await call('me', {}, userToken, 'GET');
  assert.equal(old.http, 401, 'old token revoked');
  userToken = ok.token;
  const me = await call('me', {}, userToken, 'GET');
  assert.equal(me.user.username, 'somchai');
});

test('admin delete is soft + trashes drive file', async () => {
  const n = bridgeCalls.filter((a) => a === 'drive_trash').length;
  const d = await call('delete', { recordId: recId }, adminToken);
  assert.equal(d.deletedRows, 1);
  assert.equal(bridgeCalls.filter((a) => a === 'drive_trash').length, n + 1);
  const rows = await call('get_data', {}, userToken, 'GET');
  assert.equal(rows.data.length, 0);
});

test('error log dedupes by fingerprint; only admin can list', async () => {
  for (let i = 0; i < 3; i++) await call('log_error', { message: 'TypeError: x is undefined', url: '/', appVersion: '2.0.0' });
  const denied = await call('list_errors', {}, userToken, 'GET');
  assert.equal(denied.http, 403);
  const l = await call('list_errors', {}, adminToken, 'GET');
  const e = l.errors.find((x) => x.message === 'TypeError: x is undefined');
  assert.equal(e.occurrences, 3);
  const u = await call('update_error', { id: e.id, status: 'fixed', fixedInVersion: '2.0.1', adminNote: 'แก้แล้ว' }, adminToken);
  assert.equal(u.error.status, 'fixed');
});

test('login rate limit after repeated failures', async () => {
  for (let i = 0; i < 10; i++) await call('login', { username: 'nid', password: 'bad' });
  const r = await call('login', { username: 'nid', password: 'pass5678' });
  assert.equal(r.http, 429);
});

test('thai date parsing', () => {
  const { parseThaiDateTime } = require('../api/slts')._internal;
  assert.equal(parseThaiDateTime('25 ส.ค. 2569 16:15:32').toISOString(), '2026-08-25T09:15:32.000Z');
  assert.equal(parseThaiDateTime('25/08/2026 16:15:00').toISOString(), '2026-08-25T09:15:00.000Z');
});
