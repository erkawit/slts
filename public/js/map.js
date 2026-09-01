/**
 * map.js - ระบบสร้างภาพแผนที่จำลอง (Map Snapshot Overlay)
 * มุมซ้ายล่างของภาพถ่าย
 */

class MapSnapshotManager {
  constructor() {
    this.cachedMapImage = null;
    this.lastLat = null;
    this.lastLng = null;
  }

  // คำนวณ Tile Coordinates จาก Latitude/Longitude สำหรับ OpenStreetMap
  latLngToTile(lat, lon, zoom) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    return { x, y };
  }

  /**
   * ดึงภาพแผนที่สแนปช็อตแบบไม่ต้องใช้ API Key โดยต่อ Tile จาก OpenStreetMap
   * หรือใช้ Static Map Service
   */
  async getMapImage(lat, lng, width = 200, height = 150, zoom = 16) {
    // ถ้าพิกัดเดิมไม่เปลี่ยนเกิน 10 เมตร ใช้แคชเดิม
    if (this.cachedMapImage && this.lastLat && this.lastLng) {
      const dist = Math.hypot(this.lastLat - lat, this.lastLng - lng);
      if (dist < 0.0001) {
        return this.cachedMapImage;
      }
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // ใช้ OpenStreetMap Static Tiles หรือ Staticmap API
      // สร้างภาพจาก static-maps yandex/osm หรือโหลด tile โดยตรง
      const img = new Image();
      img.crossOrigin = 'Anonymous';

      // ใช้ OpenStreetMap static rendering endpoint ที่เสถียร หรือ tile stitching
      const staticMapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik&markers=${lat},${lng},ol-marker`;
      
      const loaded = await new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = staticMapUrl;
        // timeout 3s
        setTimeout(() => resolve(false), 3000);
      });

      if (loaded) {
        ctx.drawImage(img, 0, 0, width, height);
      } else {
        // Fallback: วาด Vector Map Layout จำลองสวยงามพร้อมพิกัด
        this.drawVectorMapFallback(ctx, width, height, lat, lng);
      }

      // วาดกรอบและ Pin หมุดสีแดง
      this.drawPin(ctx, width / 2, height / 2);

      this.cachedMapImage = canvas;
      this.lastLat = lat;
      this.lastLng = lng;
      return canvas;
    } catch (err) {
      console.warn('Map snapshot error:', err);
      // Fallback
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      this.drawVectorMapFallback(ctx, width, height, lat, lng);
      this.drawPin(ctx, width / 2, height / 2);
      return canvas;
    }
  }

  drawVectorMapFallback(ctx, width, height, lat, lng) {
    // พื้นหลังแผนที่สีนุ่มนวล
    ctx.fillStyle = '#e8ecef';
    ctx.fillRect(0, 0, width, height);

    // เส้นถนนจำลอง
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.4);
    ctx.lineTo(width, height * 0.45);
    ctx.moveTo(width * 0.3, 0);
    ctx.lineTo(width * 0.35, height);
    ctx.moveTo(width * 0.7, 0);
    ctx.lineTo(width * 0.65, height);
    ctx.stroke();

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.65);
    ctx.lineTo(width, height * 0.6);
    ctx.stroke();

    // ข้อความระบุแผนที่
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MAP VIEW', 8, 14);
    ctx.font = '9px sans-serif';
    ctx.fillText(`${lat.toFixed(4)}, ${lng.toFixed(4)}`, 8, height - 8);
  }

  drawPin(ctx, x, y) {
    // เงาหมุด
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 6, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // ตัวหมุดสีแดง
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-6, -10, -10, -14, -10, -20);
    ctx.arc(0, -20, 10, Math.PI, 0, false);
    ctx.bezierCurveTo(10, -14, 6, -10, 0, 0);
    ctx.fillStyle = '#e53e3e';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // วงกลมสีขาวตรงกลางหมุด
    ctx.beginPath();
    ctx.arc(0, -20, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  /**
   * วาด Map Overlay ลงบน Canvas ของภาพถ่าย
   */
  async drawMapOverlay(ctx, x, y, width = 160, height = 120, lat, lng) {
    if (!lat || !lng) return;

    ctx.save();
    // กรอบขอบมน
    const radius = 8;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.clip();

    const mapCanvas = await this.getMapImage(lat, lng, width, height);
    ctx.drawImage(mapCanvas, x, y, width, height);

    ctx.restore();
  }
}

window.mapSnapshotManager = new MapSnapshotManager();
