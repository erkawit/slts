/**
 * watermark.js - ระบบสร้างภาพถ่ายและประทับลายน้ำ (Canvas Watermark Engine)
 * อ้างอิงตามรูปแบบตัวอย่าง ต2097-2569.jpg
 */

class WatermarkEngine {
  /**
   * แปลงวันที่ปัจจุบันเป็นรูปแบบภาษาไทย พ.ศ. เช่น "25 ส.ค. 2569 10:28:45"
   */
  static formatThaiDateTime(date = new Date()) {
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const day = date.getDate();
    const month = thaiMonths[date.getMonth()];
    // พ.ศ. (ปี ค.ศ. + 543)
    const year = date.getFullYear() + 543;

    const pad = (n) => String(n).padStart(2, '0');
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * ฟังก์ชันประทับลายน้ำลงบน Canvas จากภาพถ่ายต้นฉบับ
   * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} sourceImage ภาพหรือวิดีโอจากกล้อง
   * @param {Object} data ข้อมูลพิกัด เลขคดี ที่ตั้ง
   * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string, blob: Blob}>}
   */
  static async renderWatermark(sourceImage, data) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // กำหนดขนาดตามภาพต้นฉบับ (รองรับความละเอียดสูง เช่น 1280x720 หรือ 1920x1080)
    let width = sourceImage.videoWidth || sourceImage.naturalWidth || sourceImage.width || 1280;
    let height = sourceImage.videoHeight || sourceImage.naturalHeight || sourceImage.height || 720;

    // มาตรฐานความกว้างให้เหมาะสมกับ Mobile / Web (ความละเอียดคมชัด)
    const maxDimension = 1920;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;

    // 1. วาดภาพถ่ายต้นฉบับเต็มผืนผ้าใบ
    ctx.drawImage(sourceImage, 0, 0, width, height);

    // คำนวณ Scale Factor เพื่อให้ Element ต่างๆ ย่อขยายตามขนาดภาพ
    const baseScale = Math.max(width, height) / 1000;
    const scale = Math.max(0.7, Math.min(baseScale, 1.8));

    // 2. [มุมซ้ายบน (Top-Left)]: เข็มทิศ (Compass Overlay)
    const compassRadius = 45 * scale;
    const compassX = 25 * scale + compassRadius;
    const compassY = 25 * scale + compassRadius;
    if (window.compassManager) {
      window.compassManager.drawCompass(ctx, compassX, compassY, compassRadius);
    }

    // 3. [มุมซ้ายล่าง (Bottom-Left)]: แผนที่จำลอง Google Map / OSM
    const mapWidth = 160 * scale;
    const mapHeight = 120 * scale;
    const mapX = 20 * scale;
    const mapY = height - mapHeight - (20 * scale);
    if (window.mapSnapshotManager && data.lat && data.lng) {
      await window.mapSnapshotManager.drawMapOverlay(ctx, mapX, mapY, mapWidth, mapHeight, data.lat, data.lng);
    }

    // 4. [มุมขวาล่าง (Bottom-Right)]: กล่องข้อมูลสีดำโปร่งแสง
    await this.drawInfoBadge(ctx, width, height, scale, data);

    // แปลงผลลัพธ์เป็น Data URL และ Blob
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));

    return { canvas, dataUrl, blob };
  }

  /**
   * วาดกล่องข้อความมุมขวาล่าง
   */
  static async drawInfoBadge(ctx, canvasWidth, canvasHeight, scale, data) {
    const padding = 14 * scale;
    const fontSize = Math.max(12, Math.round(15 * scale));
    const fontTitleSize = Math.max(13, Math.round(16 * scale));
    const lineHeight = fontSize * 1.5;

    ctx.save();
    ctx.font = `bold ${fontSize}px 'Sarabun', 'Prompt', sans-serif`;

    // เตรียมข้อความแต่ละบรรทัด
    const dateStr = data.dateTime || this.formatThaiDateTime(new Date());
    
    // พิกัด
    const latFormatted = data.lat ? `${Math.abs(data.lat).toFixed(4)}°${data.lat >= 0 ? 'N' : 'S'}` : '17.4645°N';
    const lngFormatted = data.lng ? `${Math.abs(data.lng).toFixed(4)}°${data.lng >= 0 ? 'E' : 'W'}` : '102.7993°E';
    const headingDeg = (data.heading !== undefined && data.heading !== null) ? data.heading : (window.compassManager ? window.compassManager.getHeading() : 0);
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';
    const coordStr = `${latFormatted}  ${lngFormatted}   ${headingDeg}° ${dirText}`;

    // ที่ตั้ง
    const locationStr = data.locationText || 'อำเภอเมืองอุดรธานี';
    // เลขคดี
    const caseStr = `เลขคดี: ${data.caseNumber || '-'}`;

    const lines = [
      { text: `📅 ${dateStr}`, color: '#ffffff', font: `bold ${fontSize}px sans-serif` },
      { text: `📍 ${coordStr}`, color: '#ffea79', font: `bold ${fontSize}px sans-serif` },
      { text: `🏠 ${locationStr}`, color: '#ffffff', font: `500 ${fontSize}px sans-serif` },
      { text: `⚖️ ${caseStr}`, color: '#68d391', font: `bold ${fontTitleSize}px sans-serif` }
    ];

    // คำนวณความกว้างที่ต้องการ
    let maxTextWidth = 0;
    lines.forEach(line => {
      ctx.font = line.font;
      const w = ctx.measureText(line.text).width;
      if (w > maxTextWidth) maxTextWidth = w;
    });

    const boxWidth = maxTextWidth + (padding * 2.2);
    const boxHeight = (lines.length * lineHeight) + (padding * 1.6);
    const boxX = canvasWidth - boxWidth - (20 * scale);
    const boxY = canvasHeight - boxHeight - (20 * scale);

    // วาดพื้นหลังกล่องดำมนโปร่งแสง
    const radius = 10 * scale;
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

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'; // Slate dark
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.stroke();

    // วาดข้อความแต่ละบรรทัด
    let currentY = boxY + padding + (fontSize * 0.85);
    lines.forEach(line => {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
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
