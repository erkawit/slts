/**
 * watermark.js - ระบบสร้างภาพถ่ายและประทับลายน้ำ (Canvas Watermark Engine)
 * รองรับสัดส่วน 3:4 (แนวตั้ง) และ 4:3 (แนวนอน) ตามการหมุนกล้อง
 * กล่องข้อความสีดำสนิท ตัวหนังสือและสัญลักษณ์สีขาวทั้งหมด ขยายขนาด 100%
 */

class WatermarkEngine {
  /**
   * ตรวจสอบแนวการถ่ายภาพ (Portrait / Landscape)
   */
  static getOrientation(sourceImage) {
    // ถ้าเป็นรูปภาพนิ่ง (File / Image Upload)
    if (sourceImage instanceof HTMLImageElement || (sourceImage.naturalWidth && !sourceImage.videoWidth)) {
      const w = sourceImage.naturalWidth || sourceImage.width;
      const h = sourceImage.naturalHeight || sourceImage.height;
      return h >= w ? 'portrait' : 'landscape';
    }

    // ถ้าถ่ายจากกล้องสด (Video) ตรวจสอบจาก Screen Orientation และ Window
    if (screen.orientation && screen.orientation.type) {
      return screen.orientation.type.includes('portrait') ? 'portrait' : 'landscape';
    }
    if (typeof window.orientation !== 'undefined') {
      return (Math.abs(window.orientation) === 90 || Math.abs(window.orientation) === 270) ? 'landscape' : 'portrait';
    }
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  }

  /**
   * แปลงวันที่ปัจจุบันเป็นรูปแบบภาษาไทย พ.ศ. เช่น "25 ส.ค. 2569 11:01:09"
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
   * วาดภาพแบบ Object-fit: Cover ลงบน Canvas สัดส่วน 3:4 หรือ 4:3
   */
  static drawCoverImage(ctx, img, targetW, targetH) {
    const srcW = img.videoWidth || img.naturalWidth || img.width;
    const srcH = img.videoHeight || img.naturalHeight || img.height;

    const srcRatio = srcW / srcH;
    const targetRatio = targetW / targetH;

    let renderW, renderH, offsetX, offsetY;

    if (srcRatio > targetRatio) {
      // ภาพต้นฉบับกว้างกว่าเป้าหมาย -> ครอปด้านข้าง
      renderH = targetH;
      renderW = targetH * srcRatio;
      offsetX = (targetW - renderW) / 2;
      offsetY = 0;
    } else {
      // ภาพต้นฉบับสูงกว่าเป้าหมาย -> ครอปบนล่าง
      renderW = targetW;
      renderH = targetW / srcRatio;
      offsetX = 0;
      offsetY = (targetH - renderH) / 2;
    }

    ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
  }

  /**
   * ฟังก์ชันประทับลายน้ำลงบน Canvas ตามการหมุนกล้อง
   * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} sourceImage ภาพหรือวิดีโอจากกล้อง
   * @param {Object} data ข้อมูลพิกัด เลขคดี ที่ตั้ง
   * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string, blob: Blob}>}
   */
  static async renderWatermark(sourceImage, data) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 1. ตรวจสอบแนวการถ่ายภาพ
    const orientation = this.getOrientation(sourceImage);
    const isPortrait = orientation === 'portrait';

    // 2. กำหนดขนาด Canvas ตามสัดส่วนมาตรฐาน (แนวตั้ง 3:4 = 1080x1440, แนวนอน 4:3 = 1440x1080)
    let width, height;
    if (isPortrait) {
      width = 1080;
      height = 1440; // 3:4
    } else {
      width = 1440;
      height = 1080; // 4:3
    }

    canvas.width = width;
    canvas.height = height;

    // 3. วาดภาพต้นฉบับเต็มผืนผ้าใบแบบ Cover
    this.drawCoverImage(ctx, sourceImage, width, height);

    // 4. คำนวณ Scale Factor เพื่อให้ Element ขยายสมส่วน
    const scale = isPortrait ? (width / 1000) : (height / 1000);

    // 5. [มุมซ้ายบน (Top-Left)]: เข็มทิศ (Compass Overlay)
    const compassRadius = 55 * scale;
    const compassX = 30 * scale + compassRadius;
    const compassY = 30 * scale + compassRadius;
    if (window.compassManager) {
      window.compassManager.drawCompass(ctx, compassX, compassY, compassRadius);
    }

    // 6. [มุมซ้ายล่าง (Bottom-Left)]: ภาพแผนที่พิกัดปัจจุบัน
    const mapWidth = 220 * scale;
    const mapHeight = 160 * scale;
    const mapX = 28 * scale;
    const mapY = height - mapHeight - (28 * scale);
    if (window.mapSnapshotManager && data.lat && data.lng) {
      await window.mapSnapshotManager.drawMapOverlay(ctx, mapX, mapY, mapWidth, mapHeight, data.lat, data.lng);
    }

    // 7. [มุมขวาล่าง (Bottom-Right)]: กล่องข้อมูลสีดำสนิท ตัวหนังสือและสัญลักษณ์สีขาวล้วน ขยายขนาด 100%
    await this.drawInfoBadge(ctx, width, height, scale, data);

    // แปลงผลลัพธ์เป็น Data URL และ Blob
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));

    return { canvas, dataUrl, blob, orientation };
  }

  /**
   * วาดกล่องข้อความมุมขวาล่าง (สีดำสนิท + ตัวหนังสือและสัญลักษณ์สีขาวทั้งหมด + ขยายขนาด 100%)
   */
  static async drawInfoBadge(ctx, canvasWidth, canvasHeight, scale, data) {
    // ปรับขนาดฟอนต์ให้ใหญ่ขึ้น 100% (จากเดิม 14-15px เป็น 28-30px)
    const padding = 24 * scale;
    const fontSize = Math.round(28 * scale);
    const fontTitleSize = Math.round(30 * scale);
    const lineHeight = fontSize * 1.55;

    ctx.save();
    ctx.font = `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif`;

    // วันที่และเวลาปัจจุบัน (พ.ศ.)
    const dateStr = data.dateTime || this.formatThaiDateTime(new Date());

    // พิกัด Lat/Lng และทิศองศา
    const latFormatted = data.lat ? `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
    const lngFormatted = data.lng ? `${Math.abs(data.lng).toFixed(4)}°${data.lng >= 0 ? 'E' : 'W'}` : '102.7881°E';
    const headingDeg = (data.heading !== undefined && data.heading !== null) ? data.heading : (window.compassManager ? window.compassManager.getHeading() : 0);
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';
    const coordStr = `${latFormatted}  ${lngFormatted}   ${headingDeg}° ${dirText}`;

    // ที่ตั้ง
    const locationStr = data.locationText || 'อำเภอเมืองอุดรธานี';
    // เลขคดี
    const caseStr = `เลขคดี: ${data.caseNumber || '-'}`;

    // กำหนดบรรทัดข้อมูล: ตัวหนังสือและสัญลักษณ์เป็นสีขาวล้วน (#ffffff) ทั้งหมดตามข้อกำหนด
    const lines = [
      { text: `📅  ${dateStr}`, font: `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif` },
      { text: `📍  ${coordStr}`, font: `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif` },
      { text: `🏠  ${locationStr}`, font: `600 ${fontSize}px 'Sarabun', 'Prompt', sans-serif` },
      { text: `⚖️  ${caseStr}`, font: `bold ${fontTitleSize}px 'Sarabun', 'Prompt', sans-serif` }
    ];

    // คำนวณความกว้างที่ต้องการ
    let maxTextWidth = 0;
    lines.forEach(line => {
      ctx.font = line.font;
      const w = ctx.measureText(line.text).width;
      if (w > maxTextWidth) maxTextWidth = w;
    });

    const boxWidth = maxTextWidth + (padding * 2.2);
    const boxHeight = (lines.length * lineHeight) + (padding * 1.5);
    const boxX = canvasWidth - boxWidth - (28 * scale);
    const boxY = canvasHeight - boxHeight - (28 * scale);

    // วาดพื้นหลังกล่องดำสนิท 100% (Solid Black)
    const radius = 14 * scale;
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

    // พื้นหลังสีดำสนิท (Solid Pitch Black)
    ctx.fillStyle = '#000000';
    ctx.fill();

    // กรอบขอบสีขาวบางๆ เพื่อความคมชัด
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.stroke();

    // วาดข้อความและสัญลักษณ์สีขาวทั้งหมด (#ffffff)
    let currentY = boxY + padding + (fontSize * 0.85);
    lines.forEach(line => {
      ctx.font = line.font;
      ctx.fillStyle = '#ffffff'; // สีขาวล้วน 100%
      ctx.textAlign = 'left';
      ctx.fillText(line.text, boxX + padding, currentY);
      currentY += lineHeight;
    });

    ctx.restore();
  }

  /**
   * สั่งดาวน์โหลดไฟล์ลงเครื่องอัตโนมัติ
   */
  static triggerDownload(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

window.WatermarkEngine = WatermarkEngine;
