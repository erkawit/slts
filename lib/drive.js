/**
 * lib/drive.js — สะพานเชื่อม Google Drive ผ่าน Google Apps Script (เก็บไฟล์รูปภาพเท่านั้น)
 *
 * ข้อมูลตาราง (ข้อความ/พิกัด/ผู้ใช้/เส้นทาง) ย้ายไปอยู่ใน Neon ทั้งหมดแล้ว
 * Apps Script เหลือหน้าที่เดียว: รับไฟล์ภาพ → เก็บใน Drive → คืน fileId/fileUrl
 * ต้องตั้งค่า env: GAS_DRIVE_URL และ GAS_BRIDGE_SECRET (ตรงกับ Script Property BRIDGE_SECRET)
 */

function bridgeConfigured() {
  return Boolean(process.env.GAS_DRIVE_URL);
}

async function callBridge(body, timeoutMs = 55_000) {
  const url = process.env.GAS_DRIVE_URL;
  if (!url) {
    const err = new Error('ยังไม่ได้ตั้งค่า GAS_DRIVE_URL (สะพานอัปโหลดรูปภาพไป Google Drive)');
    err.code = 'NO_DRIVE_BRIDGE';
    throw err;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, secret: process.env.GAS_BRIDGE_SECRET || '' }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (_) {
      throw new Error('Google Apps Script ตอบกลับไม่ใช่ JSON (ตรวจสอบการ Deploy Web App): ' + text.slice(0, 120));
    }
    if (json.status !== 'success') throw new Error(json.message || 'Drive bridge error');
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function uploadImage({ fileName, imageBase64, publicLink = false }) {
  const r = await callBridge({ action: 'drive_upload', fileName, imageBase64, publicLink });
  return { fileId: r.fileId, fileUrl: r.fileUrl };
}

async function trashFile(fileId) {
  if (!fileId) return false;
  try {
    await callBridge({ action: 'drive_trash', fileId }, 20_000);
    return true;
  } catch (e) {
    console.warn('[drive] trash failed', e.message);
    return false;
  }
}

async function geocode(q) {
  const r = await callBridge({ action: 'search_place', q }, 20_000);
  return r.results || [];
}

module.exports = { bridgeConfigured, uploadImage, trashFile, geocode };
