/**
 * lib/ai.js — เรียกใช้ Neon AI Gateway (OpenAI Chat Completions compatible)
 * env: NEON_AI_GATEWAY_BASE_URL (bare host), NEON_AI_GATEWAY_TOKEN — ได้จาก `neon deploy` / `neon env pull`
 * ใช้สำหรับ: แปลงข้อความ OCR จากบัญชีจ่ายหมาย (ภาพ/PDF) ให้เป็นรายการคดีแบบมีโครงสร้าง
 */

function aiConfigured() {
  return Boolean(process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN);
}

async function chat(messages, { model, temperature = 0, maxTokens = 2000, timeoutMs = 45_000, json = false } = {}) {
  if (!aiConfigured()) {
    const err = new Error('AI Gateway ยังไม่ได้ตั้งค่า (NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN)');
    err.code = 'NO_AI_GATEWAY';
    throw err;
  }
  const base = process.env.NEON_AI_GATEWAY_BASE_URL.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      model: model || process.env.AI_MODEL || 'gpt-5-mini',
      messages,
      max_tokens: maxTokens,
    };
    if (temperature !== null) body.temperature = temperature;
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NEON_AI_GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data?.error?.message || data?.unavailable_reason || res.statusText;
      const err = new Error(`AI Gateway ${res.status}: ${reason}`);
      err.status = res.status;
      throw err;
    }
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(t);
  }
}

/**
 * รับข้อความ OCR ดิบ คืนรายการ { caseNumber, defendant, houseNo, moo, subdistrict, district, province, note }
 */
async function extractDispatchRecords(ocrText, province = 'อุดรธานี') {
  const text = String(ocrText || '').slice(0, 12000);
  const content = await chat([
    {
      role: 'system',
      content:
        'คุณคือผู้ช่วยแปลงข้อความ OCR จาก "บัญชีจ่ายหมาย" ของศาลไทย ให้เป็น JSON เท่านั้น ' +
        'ตอบเป็น {"records":[{"caseNumber":"ผบE1245/2569","defendant":"","houseNo":"","moo":"","subdistrict":"","district":"","province":"","note":""}]} ' +
        'ห้ามเดาข้อมูลที่ไม่มีในข้อความ ช่องที่ไม่ทราบให้เป็นสตริงว่าง ตัดคำนำหน้า ต./อ./จ. ออกจากชื่อตำบล อำเภอ จังหวัด',
    },
    { role: 'user', content: `จังหวัดเริ่มต้น: ${province}\n\nข้อความ OCR:\n${text}` },
  ], { json: true, maxTokens: 3000 });
  let parsed;
  try { parsed = JSON.parse(content); } catch (_) {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { records: [] };
  }
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  return records
    .filter((r) => r && (r.caseNumber || r.houseNo || r.subdistrict))
    .slice(0, 300)
    .map((r) => ({
      caseNumber: String(r.caseNumber || '').trim(),
      defendant: String(r.defendant || '').trim(),
      houseNo: String(r.houseNo || '').trim(),
      moo: String(r.moo || '').replace(/[^\d]/g, ''),
      subdistrict: String(r.subdistrict || '').trim(),
      district: String(r.district || '').trim(),
      province: String(r.province || province || '').trim(),
      note: String(r.note || '').trim(),
    }));
}

module.exports = { aiConfigured, chat, extractDispatchRecords };
