/**
 * api/health.js — ใช้ตรวจว่ามีอินเทอร์เน็ตจริงและเซิร์ฟเวอร์พร้อม (มือถือเรียกก่อนเริ่มอัปโหลดคิว)
 * GET /api/health → { ok, db, version, driveBridge, aiGateway }
 */
const handler = require('./slts');

module.exports = async function health(req, res) {
  req.query = { ...(req.query || {}), action: 'health' };
  return handler(req, res);
};
