/**
 * watermark.js - ระบบสร้างภาพถ่ายและประทับลายน้ำ (Canvas Watermark Engine)
 * รองรับสัดส่วน 3:4 (แนวตั้ง) และ 4:3 (แนวนอน) ตามการหมุนกล้องจริง
 * สร้าง Text File (.txt) บันทึกข้อมูลลายน้ำ และประทับลายน้ำลงบนภาพ
 */

class WatermarkEngine {
  /**
   * ตรวจสอบแนวการถ่ายภาพ (Portrait / Landscape)
   */
  static getOrientation(sourceImage) {
    if (sourceImage instanceof HTMLImageElement || (sourceImage.naturalWidth && !sourceImage.videoWidth)) {
      const w = sourceImage.naturalWidth || sourceImage.width;
      const h = sourceImage.naturalHeight || sourceImage.height;
      return h >= w ? 'portrait' : 'landscape';
    }

    if (screen.orientation && screen.orientation.type) {
      return screen.orientation.type.includes('portrait') ? 'portrait' : 'landscape';
    }
    if (typeof window.orientation !== 'undefined') {
      return (Math.abs(window.orientation) === 90 || Math.abs(window.orientation) === 270) ? 'landscape' : 'portrait';
    }
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  }

  /**
   * แปลงวันที่ปัจจุบันเป็นรูปแบบภาษาไทย พ.ศ. เช่น "25 ส.ค. 2569 11:36:36"
   */
  static formatThaiDateTime(date = new Date()) {
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const day = date.getDate();
    const month = thaiMonths[date.getMonth()];
    const year = date.getFullYear() + 543;

    const pad = (n) => String(n).padStart(2, '0');
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * ปรับแต่งและตัดทอนข้อความที่ตั้งสำหรับลายน้ำและ Live Badge
   * - หากข้อความยาวปกติ (เช่น "บ้านเลขที่ 158 ม.5 ต.สามพร้าว อ.เมืองอุดรธานี จ.อุดรธานี" - 57 ตัวอักษร): แสดงตามปกติ
   * - หากข้อความยาวเกินไป (เช่น "ที่ทำการปกครองส่วนท้องถิ่นหมู่ที่ 15 ต. สามพร้าว อ.เมืองอุดรธานี จ.อุดรธานี" - 73 ตัวอักษร):
   *   ตัดการแสดงผลชื่อจังหวัดออกไปเลย แล้วใส่ จุดสามจุดต่อท้ายแทน (...)
   */
  static formatLocationText(locText, isLandscape = false) {
    if (!locText) return '';
    locText = String(locText).trim();

    // เกณฑ์ความยาวที่ถือว่ายาวเกินไป (ความยาวมาตรฐานปกติอยู่ที่ประมาณ 55-58 ตัวอักษร)
    const threshold = 58;

    if (locText.length > threshold) {
      // ตัดชื่อจังหวัดออกไป เช่น " จ.อุดรธานี" หรือ " จังหวัดอุดรธานี"
      let withoutProvince = locText.replace(/\s*(?:จ\.|จังหวัด)\s*[\u0E00-\u0E7Fa-zA-Z0-9_.-]+/g, '').trim();
      if (!withoutProvince.endsWith('...')) {
        withoutProvince = withoutProvince.replace(/\.+$/, '') + '...';
      }
      return withoutProvince;
    }

    return locText;
  }

  /**
   * สร้างเนื้อหา Text File (.txt) ตามที่แสดงผลในมุมขวาล่างของภาพ
   */
  static generateTextFileContent(data) {
    const dateStr = data.dateTime || this.formatThaiDateTime(new Date());

    const latFormatted = data.lat ? `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
    const lngFormatted = data.lng ? `${Math.abs(data.lng).toFixed(4)}°${data.lng >= 0 ? 'E' : 'W'}` : '102.7882°E';
    const headingDeg = (data.heading !== undefined && data.heading !== null) ? data.heading : (window.compassManager ? window.compassManager.getHeading() : 0);
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';
    const coordStr = `${latFormatted} ${lngFormatted} ${headingDeg}° ${dirText}`;

    const locationStr = this.formatLocationText(data.locationText || 'อำเภอเมืองอุดรธานี');
    const caseStr = `เลขคดี: ${data.caseNumber || '-'}`;

    return `${dateStr}\r\n${coordStr}\r\n${locationStr}\r\n${caseStr}`;
  }

  /**
   * วาดภาพแบบ Object-fit: Cover ลงบน Canvas สัดส่วน 3:4 หรือ 4:3 พร้อมรองรับการหมุนตามองศาจริง
   */
  static drawCoverImage(ctx, img, targetW, targetH, rotationDeg = 0) {
    ctx.save();
    if (rotationDeg !== 0) {
      ctx.translate(targetW / 2, targetH / 2);
      ctx.rotate((rotationDeg * Math.PI) / 180);

      const isRotated90 = Math.abs(rotationDeg) === 90 || Math.abs(rotationDeg) === 270;
      const effectiveTargetW = isRotated90 ? targetH : targetW;
      const effectiveTargetH = isRotated90 ? targetW : targetH;

      const srcW = img.videoWidth || img.naturalWidth || img.width;
      const srcH = img.videoHeight || img.naturalHeight || img.height;
      const srcRatio = srcW / srcH;
      const targetRatio = effectiveTargetW / effectiveTargetH;

      let renderW, renderH;
      if (srcRatio > targetRatio) {
        renderH = effectiveTargetH;
        renderW = effectiveTargetH * srcRatio;
      } else {
        renderW = effectiveTargetW;
        renderH = effectiveTargetW / srcRatio;
      }
      ctx.drawImage(img, -renderW / 2, -renderH / 2, renderW, renderH);
    } else {
      const srcW = img.videoWidth || img.naturalWidth || img.width;
      const srcH = img.videoHeight || img.naturalHeight || img.height;
      const srcRatio = srcW / srcH;
      const targetRatio = targetW / targetH;

      let renderW, renderH, offsetX, offsetY;
      if (srcRatio > targetRatio) {
        renderH = targetH;
        renderW = targetH * srcRatio;
        offsetX = (targetW - renderW) / 2;
        offsetY = 0;
      } else {
        renderW = targetW;
        renderH = targetW / srcRatio;
        offsetX = 0;
        offsetY = (targetH - renderH) / 2;
      }
      ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
    }
    ctx.restore();
  }

  /**
   * ฟังก์ชันประทับลายน้ำลงบน Canvas ตามการหมุนกล้องจริง
   * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} sourceImage ภาพหรือวิดีโอจากกล้อง
   * @param {Object} data ข้อมูลพิกัด เลขคดี ที่ตั้ง
   * @param {string} [forcedOrientation] กำหนด 'portrait' หรือ 'landscape' โดยตรง
   * @param {number} [rotationDeg] องศาการหมุนภาพ (0, 90, -90)
   * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string, blob: Blob, textContent: string, orientation: string}>}
   */
  static async renderWatermark(sourceImage, data, forcedOrientation = null, rotationDeg = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 1. ตรวจสอบแนวการถ่ายภาพ (Portrait / Landscape)
    const orientation = forcedOrientation || this.getOrientation(sourceImage);
    const isPortrait = orientation === 'portrait';

    // 2. กำหนดขนาด Canvas ตามสัดส่วนมาตรฐาน
    let width, height;
    if (isPortrait) {
      width = 1080;
      height = 1440; // 3:4 แนวตั้ง
    } else {
      width = 1440;
      height = 1080; // 4:3 แนวนอน
    }

    canvas.width = width;
    canvas.height = height;

    // 3. วาดภาพต้นฉบับเต็มผืนผ้าใบแบบ Cover
    this.drawCoverImage(ctx, sourceImage, width, height, rotationDeg);

    // 4. คำนวณ Scale Factor เพื่อให้ Element ขยายสมส่วน
    const scale = isPortrait ? (width / 1000) : (height / 1000);

    // 5. [มุมซ้ายบน (Top-Left)]: เข็มทิศ (Compass Overlay) ตามตัวอย่างภาพที่ 1 และข้อ 4
    const compassRadius = 55 * scale;
    const compassX = (28 * scale) + compassRadius;
    const compassY = (28 * scale) + compassRadius;
    if (window.compassManager) {
      window.compassManager.drawCompass(ctx, compassX, compassY, compassRadius);
    }

    // 6. [มุมซ้ายล่าง (Bottom-Left)]: ภาพแผนที่พิกัดปัจจุบัน (Map View Card) ตามตัวอย่างภาพที่ 1 และข้อ 4
    const mapWidth = 220 * scale;
    const mapHeight = 160 * scale;
    const mapX = 28 * scale;
    const mapY = height - mapHeight - (28 * scale);
    if (window.mapSnapshotManager && data.lat && data.lng) {
      await window.mapSnapshotManager.drawMapOverlay(ctx, mapX, mapY, mapWidth, mapHeight, data.lat, data.lng);
    }

    // 7. [มุมขวาล่าง (Bottom-Right)]: กล่องข้อมูลสีดำสนิทพร้อมไอคอน ชิดขวาล่าง ตามตัวอย่างภาพที่ 1 และข้อ 4
    await this.drawInfoBadge(ctx, width, height, scale, data);

    // แปลงผลลัพธ์เป็น Data URL และ Blob (คุณภาพ 0.88 คมชัดสูงและประมวลผลเร็ว)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    const textContent = this.generateTextFileContent(data);

    return { canvas, dataUrl, blob, textContent, orientation };
  }

  /**
   * วาดกล่องข้อความมุมขวาล่าง (สีดำสนิท + ขอบขาวมน + ไอคอนและข้อความชิดซ้ายในกล่อง พร้อมระบบตัดคำอัตโนมัติป้องกันทับแผนที่)
   */
  static async drawInfoBadge(ctx, canvasWidth, canvasHeight, scale, data) {
    const padding = 18 * scale;
    let fontSize = Math.round(23 * scale);
    let fontTitleSize = Math.round(25 * scale);
    let lineHeight = fontSize * 1.5;

    ctx.save();

    // 1. วันที่และเวลาปัจจุบัน (พ.ศ.)
    const dateStr = data.dateTime || this.formatThaiDateTime(new Date());

    // 2. พิกัดในรูปแบบ: 17.4144°N 102.7881°E 30° NE
    const latFormatted = data.lat ? `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
    const lngFormatted = data.lng ? `${Math.abs(data.lng).toFixed(4)}°${data.lng >= 0 ? 'E' : 'W'}` : '102.7882°E';
    const headingDeg = (data.heading !== undefined && data.heading !== null) ? data.heading : (window.compassManager ? window.compassManager.getHeading() : 0);
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';
    const coordWithHeadingStr = `${latFormatted} ${lngFormatted} ${headingDeg}° ${dirText}`;

    // 3. ที่ตั้ง (อำเภอ / ตำบล หรือที่ตั้งละเอียด)
    const isLandscape = canvasWidth > canvasHeight;
    const locationStr = this.formatLocationText(data.locationText || 'อำเภอเมืองอุดรธานี', isLandscape);

    // 4. เลขคดี (เช่น ต2188/2569)
    let rawCase = data.caseNumber ? String(data.caseNumber).trim() : '-';
    let caseStr = rawCase;
    if (!caseStr.startsWith('เลขคดี:')) {
      caseStr = `เลขคดี: ${caseStr}`;
    }

    // คำนวณระยะขอบเพื่อป้องกันไม่ให้กล่องข้อมูลขวาล่างซ้อนทับแผนที่ซ้ายล่างเด็ดขาด
    // Map overlay อยู่ที่ mapX = 28 * scale กว้าง 220 * scale -> ขอบขวาแผนที่ = 248 * scale
    const mapRightEdge = (28 * scale) + (220 * scale) + (24 * scale);
    const maxAllowedBoxWidth = canvasWidth - mapRightEdge - (28 * scale);
    const maxContentWidth = maxAllowedBoxWidth - (padding * 2.2);

    // ฟังก์ชันตัดแบ่งข้อความที่ตั้งยาวเป็น 2 บรรทัดอัตโนมัติ
    const formatLocationLines = (locText, currentFont, maxW) => {
      ctx.font = currentFont;
      const fullText = `🏠  ${locText}`;
      if (ctx.measureText(fullText).width <= maxW) {
        return [fullText];
      }

      // พยายามตัดคำ ณ ตำแหน่งคำบ่งชี้ที่อยู่ภาษาไทย เช่น ตำบล, อำเภอ, จังหวัด, ซอย, ถนน
      const delimiters = [' ตำบล', ' ต.', ' แขวง', ' อำเภอ', ' อ.', ' เขต', ' จังหวัด', ' จ.', ' ถนน', ' ถ.', ' ซอย', ' ซ.', ' หมู่', ' ม.', ' '];
      let bestSplitIdx = -1;
      let bestDiff = Infinity;
      const mid = locText.length / 2;

      for (const delim of delimiters) {
        let pos = 0;
        while (true) {
          const idx = locText.indexOf(delim, pos);
          if (idx === -1) break;
          const splitPoint = delim.startsWith(' ') ? idx + 1 : idx;
          if (splitPoint > 6 && splitPoint < locText.length - 6) {
            const diff = Math.abs(splitPoint - mid);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestSplitIdx = splitPoint;
            }
          }
          pos = idx + 1;
        }
      }

      if (bestSplitIdx !== -1) {
        const p1 = locText.substring(0, bestSplitIdx).trim();
        const p2 = locText.substring(bestSplitIdx).trim();
        const line1 = `🏠  ${p1}`;
        const line2 = `     ${p2}`;
        if (ctx.measureText(line1).width <= maxW && ctx.measureText(line2).width <= maxW) {
          return [line1, line2];
        }
      }

      // หากยังยาวเกิน ให้ตัดตามความกว้างตัวอักษร
      let p1 = '';
      let p2 = '';
      for (let i = 0; i < locText.length; i++) {
        const testP1 = `🏠  ${locText.substring(0, i + 1)}`;
        if (ctx.measureText(testP1).width <= maxW) {
          p1 = locText.substring(0, i + 1);
        } else {
          p2 = locText.substring(i);
          break;
        }
      }
      return [ `🏠  ${p1.trim()}`, `     ${p2.trim()}` ];
    };

    let locFont = `600 ${fontSize}px 'Sarabun', 'Prompt', sans-serif`;
    let locLines = formatLocationLines(locationStr, locFont, maxContentWidth);

    // ตรวจสอบว่าหลังจากแบ่งบรรทัดแล้ว ขนาดตัวอักษรยังกว้างเกินหรือไม่ หากเกินให้ลดขนาดลงเล็กน้อย
    let maxTestW = 0;
    locLines.forEach(l => {
      const w = ctx.measureText(l).width;
      if (w > maxTestW) maxTestW = w;
    });

    if (maxTestW > maxContentWidth) {
      fontSize = Math.round(fontSize * 0.88);
      fontTitleSize = Math.round(fontTitleSize * 0.88);
      lineHeight = fontSize * 1.45;
      locFont = `600 ${fontSize}px 'Sarabun', 'Prompt', sans-serif`;
      locLines = formatLocationLines(locationStr, locFont, maxContentWidth);
    }

    const lines = [
      { text: `📅  ${dateStr}`, font: `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif`, color: '#ffffff' },
      { text: `📍  ${coordWithHeadingStr}`, font: `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif`, color: '#ffffff' },
      ...locLines.map(l => ({ text: l, font: locFont, color: '#ffffff' })),
      { text: `⚖️  ${caseStr}`, font: `bold ${fontTitleSize}px 'Sarabun', 'Prompt', sans-serif`, color: '#ffffff' }
    ];

    // คำนวณความกว้างสูงสุดของข้อความ
    let maxTextWidth = 0;
    lines.forEach(line => {
      ctx.font = line.font;
      const w = ctx.measureText(line.text).width;
      if (w > maxTextWidth) maxTextWidth = w;
    });

    // กำหนด boxWidth ไม่ให้เกิน maxAllowedBoxWidth โดยเด็ดขาด
    const boxWidth = Math.min(maxTextWidth + (padding * 2.2), maxAllowedBoxWidth);
    const boxHeight = (lines.length * lineHeight) + (padding * 1.4);
    // วางที่มุมขวาล่าง (Bottom-Right)
    const boxX = Math.max(canvasWidth - boxWidth - (28 * scale), mapRightEdge);
    const boxY = canvasHeight - boxHeight - (28 * scale);

    // วาดพื้นหลังกล่องดำสนิท (Solid Black) ขอบมนสวยงาม
    const radius = 16 * scale;
    ctx.beginPath();
    ctx.moveTo(boxX + radius, boxY);
    ctx.lineTo(boxX + boxWidth - radius, boxY);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    ctx.lineTo(boxX + radius, boxY + boxHeight);
    ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    ctx.lineTo(boxX, boxY + radius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    ctx.closePath();

    ctx.fillStyle = '#000000';
    ctx.fill();

    // กรอบขอบสีขาวคมชัด
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.stroke();

    // วาดข้อความสีขาว จัดชิดซ้าย (Left-Aligned) ตามตัวอย่าง Image 2
    const textLeftX = boxX + padding;
    let currentY = boxY + padding + (fontSize * 0.85);

    lines.forEach(line => {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.textAlign = 'left';
      ctx.fillText(line.text, textLeftX, currentY);
      currentY += lineHeight;
    });

    ctx.restore();
  }

  /**
   * สั่งดาวน์โหลดไฟล์รูปภาพลงเครื่อง
   */
  static triggerDownload(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * สั่งดาวน์โหลด Text File (.txt) ลงเครื่อง
   */
  static triggerTextDownload(textContent, filename) {
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

window.WatermarkEngine = WatermarkEngine;
window.formatWatermarkLocationText = WatermarkEngine.formatLocationText;
