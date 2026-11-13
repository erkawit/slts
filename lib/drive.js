/**
 * lib/drive.js — ที่เก็บไฟล์รูปภาพ: Neon Postgres (ค่าเริ่มต้น) หรือ Google Drive ผ่าน Apps Script (ทางเลือก)
 *
 * ข้อมูลตาราง (ข้อความ/พิกัด/ผู้ใช้/เส้นทาง) ย้ายไปอยู่ใน Neon ทั้งหมดแล้ว
 * Apps Script เหลือหน้าที่เดียว: รับไฟล์ภาพ → เก็บใน Drive → คืน fileId/fileUrl
 * ต้องตั้งค่า env: GAS_DRIVE_URL และ GAS_BRIDGE_SECRET (ตรงกับ Script Property BRIDGE_SECRET)
 */

const photos = require('./photos');

function bridgeConfigured() {
  return Boolean(process.env.GAS_DRIVE_URL);
}

/**
 * ที่เก็บไฟล์ภาพ:
 *  - 'google-drive' (ค่าหลัก) เมื่อตั้ง GAS_DRIVE_URL + GAS_BRIDGE_SECRET ไว้ → เก็บในโฟลเดอร์ Google Drive เดิมผ่าน Apps Script
 *  - 'neon' (สำรอง) เมื่อยังไม่ได้ตั้งค่า Drive หรือกำหนด PHOTO_STORAGE=neon → เก็บในตาราง photo_files
 */
function storageMode() {
  if (process.env.PHOTO_STORAGE === 'neon') return 'neon';
  return bridgeConfigured() ? 'google-drive' : 'neon';
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

async function uploadImage({ fileName, imageBase64, publicLink = false, origin = '' }) {
  if (storageMode() === 'neon') return photos.savePhoto({ fileName, imageBase64, origin });
  const r = await callBridge({ action: 'drive_upload', fileName, imageBase64, publicLink });
  return { fileId: r.fileId, fileUrl: r.fileUrl };
}

async function trashFile(fileId) {
  if (!fileId) return false;
  if (photos.isDbFileId(fileId)) {
    try { return await photos.deletePhoto(fileId); } catch (e) { console.warn('[photos] delete failed', e.message); return false; }
  }
  if (!bridgeConfigured()) return false;
  try {
    await callBridge({ action: 'drive_trash', fileId }, 20_000);
    return true;
  } catch (e) {
    console.warn('[drive] trash failed', e.message);
    return false;
  }
}

async function geocode(q) {
  if (!bridgeConfigured()) return [];
  const r = await callBridge({ action: 'search_place', q }, 20_000);
  return r.results || [];
}

module.exports = { bridgeConfigured, storageMode, uploadImage, trashFile, geocode };
