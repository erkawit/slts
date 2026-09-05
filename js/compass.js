/**
 * compass.js - ระบบวัดทิศและวาดกราฟิกเข็มทิศ (Compass Overlay)
 */

class CompassManager {
  constructor() {
    this.heading = 0; // ทิศเป็นองศา 0-360
    this.hasOrientation = false;
    this.deviceAngle = 0; // 0, 90, -90, 180
    this.deviceOrientation = 'portrait'; // 'portrait' | 'landscape'
    this.orientationCallbacks = [];
    this.initSensor();
  }

  initSensor() {
    const handleOrientationEvent = (e) => {
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

      // วัดการเอียง/หมุนเครื่องจาก Gyroscope (Gamma: เอียงซ้าย/ขวา, Beta: เอียงหน้า/หลัง)
      if (e.gamma !== null && e.beta !== null && e.gamma !== undefined && e.beta !== undefined) {
        this.handleDeviceTilt(e.gamma, e.beta);
      }
    };

    const handleMotionEvent = (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;
      const x = acc.x || 0;
      const y = acc.y || 0;
      const z = acc.z || 0;

      // หากวางเครื่องนอนราบกับพื้น (|z| > 8.5 m/s²) ไม่เปลี่ยนสถานะ
      if (Math.abs(z) > 8.5 && Math.abs(x) < 4.0 && Math.abs(y) < 4.0) {
        return;
      }

      // หากแรงโน้มถ่วงตกที่แกน X ชัดเจน (เอียงซ้ายหรือขวา)
      if (Math.abs(x) > 5.5 && Math.abs(y) < 5.0) {
        if (x > 5.5) {
          // Landscape Left (หัวเครื่องไปซ้าย)
          this.setTargetTilt(90, 'landscape');
        } else if (x < -5.5) {
          // Landscape Right (หัวเครื่องไปขวา)
          this.setTargetTilt(-90, 'landscape');
        }
      } else if (y > 5.0 && Math.abs(x) < 4.5) {
        // Portrait ปกติ
        this.setTargetTilt(0, 'portrait');
      } else if (y < -5.0 && Math.abs(x) < 4.5) {
        // Portrait กลับหัว
        this.setTargetTilt(180, 'portrait');
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientation', handleOrientationEvent, true);
      window.addEventListener('deviceorientationabsolute', handleOrientationEvent, true);
      window.addEventListener('devicemotion', handleMotionEvent, true);
    }
  }

  /**
   * อัปเดตองศาการเอียงเครื่องแบบ Debounce พร้อมแจ้งเตือน Callback
   */
  setTargetTilt(newAngle, newOrientation) {
    if (newAngle !== this.deviceAngle || newOrientation !== this.deviceOrientation) {
      if (this._targetAngle !== newAngle || this._targetOrientation !== newOrientation) {
        this._targetAngle = newAngle;
        this._targetOrientation = newOrientation;
        clearTimeout(this._tiltDebounceTimer);
        this._tiltDebounceTimer = setTimeout(() => {
          if (this._targetAngle !== null && (this._targetAngle !== this.deviceAngle || this._targetOrientation !== this.deviceOrientation)) {
            this.deviceAngle = this._targetAngle;
            this.deviceOrientation = this._targetOrientation;
            this.notifyOrientationChange(this.deviceOrientation, this.deviceAngle);
          }
        }, 50);
      }
    } else {
      this._targetAngle = null;
      if (this._tiltDebounceTimer) {
        clearTimeout(this._tiltDebounceTimer);
        this._tiltDebounceTimer = null;
      }
    }
  }

  /**
   * ตรวจจับองศาการหมุนของตัวเครื่องตาม Gyroscope (แม้ผู้ใช้จะเปิด Portrait Lock ในโทรศัพท์ไว้ก็ตาม)
   */
  handleDeviceTilt(gamma, beta) {
    let newAngle = this.deviceAngle;
    let newOrientation = this.deviceOrientation;

    const absG = Math.abs(gamma);
    const absB = Math.abs(beta);

    // หากวางเครื่องนอนราบกับพื้น ให้คงสถานะเดิม
    if (absB < 25 && absG < 25) {
      return;
    }

    // หมุนจอแนวนอนไปทางซ้าย (ปุ่มชัตเตอร์อยู่ฝั่งขวาของมือผู้ใช้): gamma ติดลบมาก
    if (gamma < -35 && absB < 65) {
      newAngle = 90;
      newOrientation = 'landscape';
    } 
    // หมุนจอแนวนอนไปทางขวา: gamma เป็นบวกมาก
    else if (gamma > 35 && absB < 65) {
      newAngle = -90;
      newOrientation = 'landscape';
    } 
    // ถือเครื่องแนวตั้งปกติ
    else if (absB > 45 && absG < 35) {
      if (beta < -45) {
        newAngle = 180;
        newOrientation = 'portrait';
      } else {
        newAngle = 0;
        newOrientation = 'portrait';
      }
    }

    this.setTargetTilt(newAngle, newOrientation);
  }

  onOrientationChange(cb) {
    if (typeof cb === 'function') {
      this.orientationCallbacks.push(cb);
    }
  }

  notifyOrientationChange(orientation, angle) {
    this.orientationCallbacks.forEach(cb => {
      try { cb(orientation, angle); } catch (err) { console.error(err); }
    });
  }

  getDeviceAngle() {
    return this.deviceAngle || 0;
  }

  getDeviceOrientation() {
    return this.deviceOrientation || 'portrait';
  }

  // ขออนุญาต Sensor บน iOS 13+
  async requestPermission() {
    let granted = true;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        granted = (response === 'granted');
      } catch (err) {
        console.warn('DeviceOrientation permission error:', err);
        granted = false;
      }
    }
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const motionResponse = await DeviceMotionEvent.requestPermission();
        granted = granted || (motionResponse === 'granted');
      } catch (err) {
        console.warn('DeviceMotion permission error:', err);
      }
    }
    return granted;
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    // 2. ขีดบอกทิศย่อยและตัวอักษร N E S W
    const headingRad = (this.heading * Math.PI) / 180;
    
    // หมุนตาม heading เพื่อให้ N ชี้ไปทิศเหนือจริง
    ctx.save();
    ctx.rotate(-headingRad);

    for (let i = 0; i < 360; i += 30) {
      const rad = (i * Math.PI) / 180;
      const isMajor = i % 90 === 0;
      const tickLen = isMajor ? radius * 0.18 : radius * 0.1;
      
      const x1 = (radius - 4) * Math.sin(rad);
      const y1 = -(radius - 4) * Math.cos(rad);
      const x2 = (radius - 4 - tickLen) * Math.sin(rad);
      const y2 = -(radius - 4 - tickLen) * Math.cos(rad);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      // ตัวอักษรทิศ N E S W
      if (isMajor) {
        let label = '';
        if (i === 0) { label = 'N'; }
        else if (i === 90) { label = 'E'; }
        else if (i === 180) { label = 'S'; }
        else if (i === 270) { label = 'W'; }

        ctx.save();
        ctx.translate((radius - 18) * Math.sin(rad), -(radius - 18) * Math.cos(rad));
        ctx.rotate(rad);
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    // 3. เข็มทิศสามเหลี่ยมทรงแหลมสีฟ้าสดใส (Cyan Pointer) ชี้บอกทิศเหนือ (N)
    ctx.beginPath();
    ctx.moveTo(0, -(radius - 10)); // ยอดเข็ม
    ctx.lineTo(radius * 0.16, radius * 0.35); // ปีกขวา
    ctx.lineTo(0, radius * 0.22); // เว้ากลาง
    ctx.lineTo(-radius * 0.16, radius * 0.35); // ปีกซ้าย
    ctx.closePath();
    
    // ไล่เฉดสีฟ้า Cyan ถึง ฟ้าเข้ม
    const needleGrad = ctx.createLinearGradient(-radius * 0.16, 0, radius * 0.16, 0);
    needleGrad.addColorStop(0, '#00d4ff');
    needleGrad.addColorStop(0.5, '#00b4d8');
    needleGrad.addColorStop(1, '#0077b6');
    ctx.fillStyle = needleGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore(); // restore rotation

    // 4. จุดกึ่งกลางสีขาวขอบเงิน
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }
}

window.compassManager = new CompassManager();
