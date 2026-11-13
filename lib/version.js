/**
 * lib/version.js — เลขเวอร์ชันฝั่งเซิร์ฟเวอร์ (ไฟล์ version.json ไฟล์เดียวกับหน้าเว็บ)
 */
let cached = null;
function getVersionInfo() {
  if (cached) return cached;
  try {
    cached = require('../version.json');
  } catch (_) {
    cached = { version: '0.0.0', releases: [] };
  }
  return cached;
}

module.exports = { getVersionInfo };
