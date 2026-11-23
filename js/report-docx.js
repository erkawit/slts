/**
 * report-docx.js — เติมข้อมูลลงแม่แบบ Word (.docx) รายงานผลการส่งหมาย
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.JSZip) และ Node.js (require('jszip')) สำหรับทดสอบ
 *
 * แม่แบบอยู่ที่ templates/report/*.docx — สร้างจากไฟล์ Word ต้นฉบับของศาล
 * (เลย์เอาต์/ฟอนต์/เส้น/ครุฑ คงเดิม) โดยแทนข้อมูลด้วย {{ชื่อช่อง}}
 */
(function (root) {
  'use strict';

  const EMU_MAX_W = 5607050; // ความกว้างภาพในแม่แบบเดิม (~15.6 ซม.)
  const EMU_MAX_H = 4204970; // ความสูงภาพในแม่แบบเดิม (~11.7 ซม.)
  const PHOTO_MARK = 'w14:paraId="5LT5F0T0"';

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /** ขนาดภาพในเอกสาร (EMU) ให้พอดีกรอบเดิม คงสัดส่วน */
  function fitEmu(w, h) {
    w = Number(w) || 4; h = Number(h) || 3;
    const scale = Math.min(EMU_MAX_W / w, EMU_MAX_H / h);
    return { cx: Math.round(w * scale), cy: Math.round(h * scale) };
  }

  /**
   * @param {ArrayBuffer|Uint8Array|Buffer} template
   * @param {Object<string,string>} data   ค่าที่จะแทน {{key}}
   * @param {Array<{bytes:Uint8Array|ArrayBuffer, width:number, height:number, ext?:string}>} photos
   * @param {{JSZip?:any, type?:string}} [opt]
   */
  async function fillReportDocx(template, data, photos, opt) {
    opt = opt || {};
    const JSZip = opt.JSZip || root.JSZip || (typeof require === 'function' ? require('jszip') : null);
    if (!JSZip) throw new Error('ไม่พบไลบรารี JSZip');
    const zip = await JSZip.loadAsync(template);
    let xml = await zip.file('word/document.xml').async('string');
    let rels = await zip.file('word/_rels/document.xml.rels').async('string');
    let types = await zip.file('[Content_Types].xml').async('string');

    // ---- ภาพส่งหมาย: ทำซ้ำย่อหน้าภาพตามจำนวนภาพ ----
    const markIdx = xml.indexOf(PHOTO_MARK);
    if (markIdx >= 0) {
      const pStart = xml.lastIndexOf('<w:p ', markIdx);
      const pEnd = xml.indexOf('</w:p>', markIdx) + '</w:p>'.length;
      const block = xml.slice(pStart, pEnd).replace(' ' + PHOTO_MARK, '');
      let out = '';
      (photos || []).forEach((ph, i) => {
        const n = i + 1;
        const ext = (ph.ext || 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg';
        const rid = 'rIdSltsPhoto' + n;
        const size = fitEmu(ph.width, ph.height);
        zip.file(`word/media/slts_photo${n}.${ext}`, ph.bytes);
        rels = rels.replace('</Relationships>',
          `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/slts_photo${n}.${ext}"/></Relationships>`);
        out += block.split('{{PHOTO_RID}}').join(rid)
          .split('{{PHOTO_CX}}').join(String(size.cx))
          .split('{{PHOTO_CY}}').join(String(size.cy))
          .split('{{PHOTO_ID}}').join(String(900 + n));
      });
      xml = xml.slice(0, pStart) + out + xml.slice(pEnd);
      if (!/Extension="png"/i.test(types)) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
      if (!/Extension="jpeg"/i.test(types)) types = types.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
    }

    // ---- แทนค่าข้อความ ----
    xml = xml.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (m, key) => escapeXml(data && data[key] != null ? data[key] : ''));

    zip.file('word/document.xml', xml);
    zip.file('word/_rels/document.xml.rels', rels);
    zip.file('[Content_Types].xml', types);
    return zip.generateAsync({
      type: opt.type || (typeof Blob !== 'undefined' && !opt.node ? 'blob' : 'nodebuffer'),
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  const api = { fillReportDocx, fitEmu, escapeXml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SltsReportDocx = api;
})(typeof window !== 'undefined' ? window : globalThis);
