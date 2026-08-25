/**
 * compass.js - ระบบวัดทิศและวาดกราฟิกเข็มทิศ (Compass Overlay)
 */

class CompassManager {
  constructor() {
    this.heading = 0; // ทิศเป็นองศา 0-360
    this.hasOrientation = false;
    this.initSensor();
  }

  initSensor() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        let heading = null;
        if (e.webkitCompassHeading !== undefined) {
          // iOS Safari
          heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          // Android Chrome
          heading = 360 - e.alpha;
        }

        if (heading !== null && !isNaN(heading)) {
          this.heading = Math.round(heading) % 360;
          this.hasOrientation = true;
        }
      }, true);
    }
  }

  // ขออนุญาต Sensor บน iOS 13+
  async requestPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        return response === 'granted';
      } catch (err) {
        console.warn('DeviceOrientation permission error:', err);
        return false;
      }
    }
    return true;
  }

  getHeading() {
    return this.heading;
  }

  getDirectionText(deg = this.heading) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  }

  /**
   * วาดวงกลมเข็มทิศลงบน Canvas ตามสเปกมุมซ้ายบน
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} x ตำแหน่งกึ่งกลาง X
   * @param {number} y ตำแหน่งกึ่งกลาง Y
   * @param {number} radius รัศมีของเข็มทิศ
   */
  drawCompass(ctx, x, y, radius = 55) {
    ctx.save();
    ctx.translate(x, y);

    // 1. วงกลมพื้นหลังโปร่งแสง
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();

    // 2. ขีดบอกทิศย่อยรอบวงกลม
    const headingRad = (this.heading * Math.PI) / 180;
    
    // หมุนตาม heading เพื่อให้ N ชี้ไปทิศเหนือจริง
    ctx.save();
    ctx.rotate(-headingRad);

    for (let i = 0; i < 360; i += 30) {
      const rad = (i * Math.PI) / 180;
      const isMajor = i % 90 === 0;
      const tickLen = isMajor ? radius * 0.22 : radius * 0.12;
      
      const x1 = (radius - 5) * Math.sin(rad);
      const y1 = -(radius - 5) * Math.cos(rad);
      const x2 = (radius - 5 - tickLen) * Math.sin(rad);
      const y2 = -(radius - 5 - tickLen) * Math.cos(rad);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      // ตัวอักษรทิศ N E S W
      if (isMajor) {
        let label = '';
        let color = '#ffffff';
        if (i === 0) { label = 'N'; color = '#ff4d4f'; } // ทิศเหนือสีแดง
        else if (i === 90) { label = 'E'; }
        else if (i === 180) { label = 'S'; }
        else if (i === 270) { label = 'W'; }

        ctx.save();
        ctx.translate((radius - 22) * Math.sin(rad), -(radius - 22) * Math.cos(rad));
        ctx.rotate(rad);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    // 3. เข็มทิศสีแดง (ชี้เหนือ) และสีขาว (ชี้ใต้)
    // หัวเข็มสีแดง (ชี้ N)
    ctx.beginPath();
    ctx.moveTo(0, -(radius - 12));
    ctx.lineTo(5, -6);
    ctx.lineTo(-5, -6);
    ctx.closePath();
    ctx.fillStyle = '#ff3333';
    ctx.fill();

    // ท้ายเข็มสีขาว (ชี้ S)
    ctx.beginPath();
    ctx.moveTo(0, (radius - 12));
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore(); // restore rotation

    // 4. จุดกึ่งกลาง
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 5. แสดงข้อความองศาใต้เข็มทิศ
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.heading}° ${this.getDirectionText()}`, 0, radius + 14);

    ctx.restore();
  }
}

window.compassManager = new CompassManager();
