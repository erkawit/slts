/**
 * app.js - ตัวควบคุมหลักของระบบจัดเก็บข้อมูลพิกัดส่งหมาย
 * ศาลจังหวัดอุดรธานี
 */

// Application State
const state = {
  lat: null,
  lng: null,
  accuracy: null,
  lastLocationTime: null,
  locationIntervalId: null,
  cameraStream: null,
  facingMode: 'environment', // 'environment' (กล้องหลัง) หรือ 'user' (กล้องหน้า)
  captureOrientation: 'portrait', // 'portrait' (3:4) หรือ 'landscape' (4:3)
  hudIntervalId: null,
  appsScriptUrl: localStorage.getItem('slts_apps_script_url') || 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec',
  isUploading: false
};

/**
 * แสดงหน้าต่างโหลดข้อมูลแบบ SweetAlert2 โปร่งใส 100% แสดงเฉพาะโลโก้และสัญลักษณ์โหลดข้อมูล
 */
function showCustomLoading(title = 'กำลังโหลดข้อมูล', subtitle = '') {
  Swal.fire({
    html: `
      <div class="logo-loading-box">
        <div class="logo-loading-wrapper">
          <img src="img/logo.png" alt="ตราศาลจังหวัดอุดรธานี" class="logo-loading-img">
          <div class="logo-spinner-ring"></div>
        </div>
        <div class="logo-loading-text">
          <span>${title}</span>
        </div>
        ${subtitle ? `<div class="logo-loading-subtext">${subtitle}</div>` : ''}
      </div>
    `,
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    customClass: {
      popup: 'transparent-swal-popup'
    }
  });
}

function hideCustomLoading() {
  Swal.close();
}

// DOM Elements
const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  initDOMElements();
  initDistrictsDropdown();
  initOtherCaseYearDropdown();
  initFormEventListeners();
  initLocationService();
  initCameraEvents();
  initSettings();
});

function initDOMElements() {
  elements.form = document.getElementById('summonsForm');
  elements.districtSelect = document.getElementById('district');
  elements.subdistrictSelect = document.getElementById('subdistrict');
  elements.courtTypeSelect = document.getElementById('courtType');
  
  // เลขคดี
  elements.udonCaseField = document.getElementById('udonCaseField');
  elements.caseNumberInput = document.getElementById('caseNumber');
  elements.otherCourtCaseField = document.getElementById('otherCourtCaseField');
  elements.otherCaseNoInput = document.getElementById('otherCaseNo');
  elements.otherCaseYearSelect = document.getElementById('otherCaseYear');

  // ข้อมูลที่ตั้ง
  elements.locationTypeSelect = document.getElementById('locationType');
  elements.houseAddressFields = document.getElementById('houseAddressFields');
  elements.houseNoInput = document.getElementById('houseNo');
  elements.mooInput = document.getElementById('moo');
  elements.localAdminAddressFields = document.getElementById('localAdminAddressFields');
  elements.localAdminNameInput = document.getElementById('localAdminName');

  // พิกัด
  elements.coordinatesInput = document.getElementById('coordinates');
  elements.locationStatus = document.getElementById('locationStatus');
  elements.btnRefreshLocation = document.getElementById('btnRefreshLocation');
  elements.btnOpenCamera = document.getElementById('btnOpenCamera');
  elements.fileFallbackInput = document.getElementById('fileFallbackInput');
  
  // Camera Modal Elements
  elements.cameraModal = document.getElementById('cameraModal');
  elements.videoPreview = document.getElementById('videoPreview');
  elements.btnCapture = document.getElementById('btnCapture');
  elements.btnCloseCamera = document.getElementById('btnCloseCamera');
  elements.btnFlipCamera = document.getElementById('btnFlipCamera');
  elements.cameraStatus = document.getElementById('cameraStatus');
  elements.btnToggleOrientation = document.getElementById('btnToggleOrientation');
  elements.btnFlipOrientationQuick = document.getElementById('btnFlipOrientationQuick');
  elements.txtOrientationMode = document.getElementById('txtOrientationMode');

  // Live HUD Overlays
  elements.liveOverlayFrame = document.getElementById('liveOverlayFrame');
  elements.liveCompassCanvas = document.getElementById('liveCompassCanvas');
  elements.liveMapCanvas = document.getElementById('liveMapCanvas');
  elements.liveBadgeDate = document.getElementById('liveBadgeDate');
  elements.liveBadgeCoords = document.getElementById('liveBadgeCoords');
  elements.liveBadgeLocation = document.getElementById('liveBadgeLocation');
  elements.liveBadgeCase = document.getElementById('liveBadgeCase');

  // Preview Modal Elements
  elements.previewModal = document.getElementById('previewModal');
  elements.previewImage = document.getElementById('previewImage');
  elements.btnConfirmUpload = document.getElementById('btnConfirmUpload');
  elements.btnRetake = document.getElementById('btnRetake');
  elements.previewFilename = document.getElementById('previewFilename');

  // Settings
  elements.btnSettings = document.getElementById('btnSettings');
}

/**
 * โหลดรายชื่ออำเภอ 20 อำเภอ และตำบล
 */
function initDistrictsDropdown() {
  elements.districtSelect.innerHTML = '';
  DISTRICT_ORDER.forEach(district => {
    const opt = document.createElement('option');
    opt.value = district;
    opt.textContent = district;
    elements.districtSelect.appendChild(opt);
  });

  // โหลดตำบลสำหรับอำเภอแรก (เมืองอุดรธานี)
  updateSubdistricts(DISTRICT_ORDER[0]);

  elements.districtSelect.addEventListener('change', (e) => {
    updateSubdistricts(e.target.value);
  });
}

function updateSubdistricts(districtName) {
  const subdistricts = UDON_THANI_DATA[districtName] || [];
  elements.subdistrictSelect.innerHTML = '';
  subdistricts.forEach(sub => {
    const opt = document.createElement('option');
    opt.value = sub;
    opt.textContent = sub;
    elements.subdistrictSelect.appendChild(opt);
  });
}

/**
 * สร้างตัวเลือกปี พ.ศ. ย้อนหลังจากปัจจุบันไป 5 ปี สำหรับหมายศาลอื่น
 */
function initOtherCaseYearDropdown() {
  if (!elements.otherCaseYearSelect) return;

  const currentThaiYear = new Date().getFullYear() + 543;
  elements.otherCaseYearSelect.innerHTML = '';

  for (let i = 0; i <= 5; i++) {
    const year = currentThaiYear - i;
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    if (i === 0) {
      opt.selected = true; // เลือกปีปัจจุบันเสมอ
    }
    elements.otherCaseYearSelect.appendChild(opt);
  }
}

/**
 * ดึงเลขคดีที่จัดฟอร์แมตแล้ว
 */
function getFormattedCaseNumber() {
  const courtType = elements.courtTypeSelect.value;
  if (courtType === 'ศาลอื่น') {
    const caseNo = (elements.otherCaseNoInput.value || '').trim();
    const year = elements.otherCaseYearSelect.value;
    return caseNo ? `ต${caseNo}/${year}` : '';
  } else {
    return (elements.caseNumberInput.value || '').trim();
  }
}

/**
 * จัดการ Event ต่างๆ ในฟอร์ม
 */
function initFormEventListeners() {
  // สลับประเภทศาล
  elements.courtTypeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'ศาลอื่น') {
      elements.udonCaseField.classList.add('hidden');
      elements.otherCourtCaseField.classList.remove('hidden');
      elements.otherCourtCaseField.classList.add('flex');
      elements.otherCaseNoInput.focus();
    } else {
      elements.otherCourtCaseField.classList.add('hidden');
      elements.otherCourtCaseField.classList.remove('flex');
      elements.udonCaseField.classList.remove('hidden');
      elements.caseNumberInput.focus();
    }
  });

  // สลับประเภทสถานที่
  elements.locationTypeSelect.addEventListener('change', (e) => {
    const isHouse = e.target.value === 'หมายบ้าน';
    if (isHouse) {
      elements.houseAddressFields.classList.remove('hidden');
      elements.localAdminAddressFields.classList.add('hidden');
      elements.houseNoInput.setAttribute('required', 'required');
    } else {
      elements.houseAddressFields.classList.add('hidden');
      elements.localAdminAddressFields.classList.remove('hidden');
      elements.houseNoInput.removeAttribute('required');
      
      // ตั้งค่าเริ่มต้นถ้าช่องว่าง
      if (!elements.localAdminNameInput.value.trim()) {
        elements.localAdminNameInput.value = 'ที่ทำการปกครองส่วนท้องถิ่น';
      }
      elements.localAdminNameInput.focus();
    }
  });

  // บังคับให้ช่องบ้านเลขที่กรอกได้เฉพาะตัวเลขเท่านั้น
  elements.houseNoInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });

  // ปุ่มรีเฟรชพิกัดด้วยตนเอง
  elements.btnRefreshLocation.addEventListener('click', () => {
    fetchCurrentLocation(true);
  });
}

/**
 * สร้างข้อความที่ตั้งแบบเต็มตามสเปก 2.3
 */
function getFullLocationText() {
  const district = elements.districtSelect.value;
  const subdistrict = elements.subdistrictSelect.value;
  const locationType = elements.locationTypeSelect.value;

  if (locationType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    const adminText = (elements.localAdminNameInput.value || 'ที่ทำการปกครองส่วนท้องถิ่น').trim();
    return `${adminText} ต.${subdistrict} อ.${district}`;
  } else {
    const houseNo = elements.houseNoInput.value.trim();
    const moo = elements.mooInput.value.trim();
    const mooText = moo ? ` ม.${moo}` : '';
    return `${houseNo}${mooText} ต.${subdistrict} อ.${district}`;
  }
}

/**
 * ระบบพิกัดทางภูมิศาสตร์ Geolocation
 */
function initLocationService() {
  const hasPermission = localStorage.getItem('slts_location_permission_granted') === 'true';

  if (hasPermission) {
    if (window.compassManager) {
      window.compassManager.requestPermission();
    }
    fetchCurrentLocation(false);
    startLocationInterval();
    return;
  }

  Swal.fire({
    title: 'ขออนุญาตเข้าถึงตำแหน่ง (GPS)',
    text: 'ระบบจำเป็นต้องใช้พิกัดตำแหน่งปัจจุบันเพื่อระบุพิกัดส่งหมายและปักหมุดบนภาพถ่าย',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'อนุญาต / เข้าถึงพิกัด',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#dc2626',
    customClass: {
      popup: 'rounded-xl shadow-xl'
    }
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.setItem('slts_location_permission_granted', 'true');
      if (window.compassManager) {
        window.compassManager.requestPermission();
      }
      fetchCurrentLocation(true);
      startLocationInterval();
    } else {
      elements.coordinatesInput.value = 'ยังไม่ได้เปิดใช้งานพิกัด GPS';
    }
  });
}

function startLocationInterval() {
  if (state.locationIntervalId) {
    clearInterval(state.locationIntervalId);
  }
  state.locationIntervalId = setInterval(() => {
    fetchCurrentLocation(false);
  }, 10000);
}

function fetchCurrentLocation(isManual = false) {
  if (!navigator.geolocation) {
    Swal.fire('ข้อผิดพลาด', 'อุปกรณ์หรือเบราว์เซอร์ไม่รองรับ Geolocation', 'error');
    return;
  }

  if (isManual) {
    elements.locationStatus.textContent = 'กำลังดึงพิกัดล่าสุด...';
    elements.locationStatus.className = 'text-xs text-blue-600 font-semibold';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.lat = Number(position.coords.latitude.toFixed(6));
      state.lng = Number(position.coords.longitude.toFixed(6));
      state.accuracy = Math.round(position.coords.accuracy);
      state.lastLocationTime = new Date();

      if (position.coords.heading !== null && !isNaN(position.coords.heading)) {
        if (window.compassManager) {
          window.compassManager.heading = Math.round(position.coords.heading);
        }
      }

      elements.coordinatesInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
      
      const timeStr = state.lastLocationTime.toLocaleTimeString('th-TH');
      elements.locationStatus.textContent = `● อัปเดตล่าสุด ${timeStr} (ความแม่นยำ ±${state.accuracy}ม.)`;
      elements.locationStatus.className = 'text-xs text-emerald-600 font-medium';

      if (isManual) {
        Swal.fire({
          icon: 'success',
          title: 'อัปเดตพิกัดสำเร็จ',
          text: `พิกัดปัจจุบัน: ${state.lat}, ${state.lng}`,
          timer: 1500,
          showConfirmButton: false
        });
      }
    },
    (error) => {
      console.warn('Geolocation error:', error);
      let msg = 'ไม่สามารถดึงพิกัดได้';
      if (error.code === error.PERMISSION_DENIED) {
        msg = 'กรุณาเปิดสิทธิ์ Location ในเบราว์เซอร์ของคุณ';
      }
      elements.locationStatus.textContent = msg;
      elements.locationStatus.className = 'text-xs text-red-500';
      if (isManual) {
        Swal.fire('ไม่พบพิกัด', msg, 'warning');
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

/**
 * ระบบจัดการกล้อง WebRTC Camera API & Live HUD
 */
function initCameraEvents() {
  elements.btnOpenCamera.addEventListener('click', () => {
    if (!validateForm()) return;
    openCameraModal();
  });

  elements.btnCloseCamera.addEventListener('click', closeCameraModal);

  elements.btnFlipCamera.addEventListener('click', () => {
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
  });

  // ปุ่มสลับแนวตั้ง 3:4 / แนวนอน 4:3
  if (elements.btnToggleOrientation) {
    elements.btnToggleOrientation.addEventListener('click', toggleOrientation);
  }
  if (elements.btnFlipOrientationQuick) {
    elements.btnFlipOrientationQuick.addEventListener('click', toggleOrientation);
  }

  // ตรวจจับการหมุนของหน้าจอ/อุปกรณ์
  window.addEventListener('resize', handleScreenOrientationChange);
  window.addEventListener('orientationchange', handleScreenOrientationChange);

  elements.btnCapture.addEventListener('click', captureAndProcessPhoto);
  elements.fileFallbackInput.addEventListener('change', handleFallbackFile);
}

function handleScreenOrientationChange() {
  if (elements.cameraModal && !elements.cameraModal.classList.contains('hidden')) {
    const isPortrait = window.innerHeight >= window.innerWidth;
    setCaptureOrientation(isPortrait ? 'portrait' : 'landscape');
  }
}

function toggleOrientation() {
  const nextMode = state.captureOrientation === 'portrait' ? 'landscape' : 'portrait';
  setCaptureOrientation(nextMode);
}

function setCaptureOrientation(mode) {
  state.captureOrientation = mode;
  const isPortrait = mode === 'portrait';

  if (elements.liveOverlayFrame) {
    if (isPortrait) {
      elements.liveOverlayFrame.classList.remove('ratio-4-3');
      elements.liveOverlayFrame.classList.add('ratio-3-4');
    } else {
      elements.liveOverlayFrame.classList.remove('ratio-3-4');
      elements.liveOverlayFrame.classList.add('ratio-4-3');
    }
  }

  if (elements.txtOrientationMode) {
    elements.txtOrientationMode.textContent = isPortrait ? 'แนวตั้ง 3:4' : 'แนวนอน 4:3';
  }
}

function validateForm() {
  const courtType = elements.courtTypeSelect.value;
  const caseNumber = getFormattedCaseNumber();

  if (!caseNumber) {
    if (courtType === 'ศาลอื่น') {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกเลขคดี',
        text: 'โปรดระบุหมายเลขคดี เช่น 2097',
        confirmButtonColor: '#2563eb'
      });
      elements.otherCaseNoInput.focus();
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกเลขคดี',
        text: 'โปรดระบุเลขคดี เช่น ผบE1245/2569',
        confirmButtonColor: '#2563eb'
      });
      elements.caseNumberInput.focus();
    }
    return false;
  }

  if (elements.locationTypeSelect.value === 'หมายบ้าน') {
    const houseNo = elements.houseNoInput.value.trim();
    if (!houseNo) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกบ้านเลขที่',
        text: 'สำหรับหมายบ้าน บังคับต้องระบุบ้านเลขที่ (เฉพาะตัวเลข)',
        confirmButtonColor: '#2563eb'
      });
      elements.houseNoInput.focus();
      return false;
    }
  } else if (elements.locationTypeSelect.value === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    const adminText = elements.localAdminNameInput.value.trim();
    if (!adminText) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุที่ทำการปกครองส่วนท้องถิ่น',
        text: 'โปรดระบุชื่อหน่วยงาน เช่น ที่ทำการปกครองส่วนท้องถิ่น หรือ อบต....',
        confirmButtonColor: '#2563eb'
      });
      elements.localAdminNameInput.focus();
      return false;
    }
  }

  if (!state.lat || !state.lng) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้รับพิกัด GPS',
      text: 'ระบบกำลังค้นหาพิกัด กรุณารอสักครู่หรือกด "เช็คพิกัดใหม่"',
      confirmButtonColor: '#2563eb'
    });
    fetchCurrentLocation(true);
    return false;
  }

  return true;
}

async function openCameraModal() {
  // ตรวจจับแนวการถ่ายภาพเริ่มต้น
  const isPortrait = window.innerHeight >= window.innerWidth;
  setCaptureOrientation(isPortrait ? 'portrait' : 'landscape');

  elements.cameraModal.classList.remove('hidden');
  elements.cameraModal.classList.add('flex');
  await startCameraStream();
  startLiveCameraHUD();
}

function closeCameraModal() {
  stopLiveCameraHUD();
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  elements.cameraModal.classList.add('hidden');
  elements.cameraModal.classList.remove('flex');
}

/**
 * อัปเดตข้อมูลลายน้ำบนหน้าจอถ่ายภาพสด (Live Camera HUD)
 */
function startLiveCameraHUD() {
  stopLiveCameraHUD();

  // ดึงภาพแผนที่สแนปช็อตมาวาดที่มุมซ้ายล่าง
  updateLiveMapHUD();

  // อัปเดตข้อมูลกล่องข้อความและเข็มทิศแบบ Real-time
  const updateHUD = () => {
    if (!elements.cameraModal || elements.cameraModal.classList.contains('hidden')) return;

    // 1. วาดเข็มทิศสด
    if (elements.liveCompassCanvas && window.compassManager) {
      const ctx = elements.liveCompassCanvas.getContext('2d');
      ctx.clearRect(0, 0, 84, 84);
      window.compassManager.drawCompass(ctx, 42, 42, 34);
    }

    // 2. อัปเดตกล่องข้อมูลสด
    const dateStr = WatermarkEngine.formatThaiDateTime(new Date());
    const latFormatted = state.lat ? `${Math.abs(state.lat).toFixed(4)}°${state.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
    const lngFormatted = state.lng ? `${Math.abs(state.lng).toFixed(4)}°${state.lng >= 0 ? 'E' : 'W'}` : '102.7882°E';
    const headingDeg = window.compassManager ? window.compassManager.getHeading() : 0;
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';

    if (elements.liveBadgeDate) elements.liveBadgeDate.textContent = `📅  ${dateStr}`;
    if (elements.liveBadgeCoords) elements.liveBadgeCoords.textContent = `📍  ${latFormatted} ${lngFormatted} ${headingDeg}° ${dirText}`;
    if (elements.liveBadgeLocation) elements.liveBadgeLocation.textContent = `🏠  ${getFullLocationText()}`;
    if (elements.liveBadgeCase) elements.liveBadgeCase.textContent = `⚖️  เลขคดี: ${getFormattedCaseNumber()}`;
  };

  updateHUD();
  state.hudIntervalId = setInterval(updateHUD, 200);
}

async function updateLiveMapHUD() {
  if (elements.liveMapCanvas && window.mapSnapshotManager && state.lat && state.lng) {
    const ctx = elements.liveMapCanvas.getContext('2d');
    const mapImg = await window.mapSnapshotManager.getMapImage(state.lat, state.lng, 100, 75);
    ctx.drawImage(mapImg, 0, 0, 100, 75);
  }
}

function stopLiveCameraHUD() {
  if (state.hudIntervalId) {
    clearInterval(state.hudIntervalId);
    state.hudIntervalId = null;
  }
}

async function startCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
  }

  elements.cameraStatus.textContent = 'กำลังเปิดกล้อง...';

  try {
    const constraints = {
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    elements.videoPreview.srcObject = stream;
    await elements.videoPreview.play();
    elements.cameraStatus.textContent = 'พร้อมถ่ายภาพ';
  } catch (err) {
    console.error('Camera access error:', err);
    elements.cameraStatus.textContent = 'ไม่สามารถเปิดกล้องสดได้';
    
    Swal.fire({
      icon: 'info',
      title: 'ไม่สามารถเปิดกล้องสดได้โดยตรง',
      text: 'ระบบจะเปิดเมนูถ่ายภาพของอุปกรณ์ให้แทน',
      confirmButtonText: 'ถ่ายรูปจากอุปกรณ์',
      confirmButtonColor: '#2563eb'
    }).then(() => {
      closeCameraModal();
      elements.fileFallbackInput.click();
    });
  }
}

/**
 * ถ่ายภาพจากกล้องสด และสร้างภาพลายน้ำ
 */
async function captureAndProcessPhoto() {
  if (!elements.videoPreview.videoWidth) {
    Swal.fire('ข้อผิดพลาด', 'กล้องยังไม่พร้อมใช้งาน', 'error');
    return;
  }

  showCustomLoading('กำลังสร้างภาพถ่ายพร้อมลายน้ำ...', 'กำลังประมวลผลแผนที่ เข็มทิศ และข้อมูลส่งหมาย');

  try {
    const caseNumber = getFormattedCaseNumber();
    const locationText = getFullLocationText();
    const currentHeading = window.compassManager ? window.compassManager.getHeading() : 0;

    const payloadData = {
      caseNumber: caseNumber,
      courtType: elements.courtTypeSelect.value,
      district: elements.districtSelect.value,
      subdistrict: elements.subdistrictSelect.value,
      locationType: elements.locationTypeSelect.value,
      locationText: locationText,
      lat: state.lat,
      lng: state.lng,
      heading: currentHeading,
      dateTime: WatermarkEngine.formatThaiDateTime(new Date())
    };

    // 1. สร้างภาพ Watermark ตาม Orientation ที่เลือก/ตรวจจับได้ (3:4 หรือ 4:3)
    const result = await WatermarkEngine.renderWatermark(elements.videoPreview, payloadData, state.captureOrientation);
    
    // 2. ตั้งชื่อไฟล์ตามเลขคดี โดยแปลง / เป็น -
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';
    const textFilename = baseFilename + '.txt';
    
    // ปิดกล้อง
    closeCameraModal();
    hideCustomLoading();

    // 3. แสดง Modal Preview พร้อมดาวน์โหลดทั้ง .jpg และ .txt ลงเครื่องทันที
    showPreviewAndProcess(result, imageFilename, textFilename, payloadData);

  } catch (error) {
    console.error('Capture error:', error);
    hideCustomLoading();
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถสร้างภาพถ่ายลายน้ำได้: ' + error.message, 'error');
  }
}

/**
 * จัดการภาพที่อัปโหลดผ่าน File Input Fallback
 */
async function handleFallbackFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!validateForm()) {
    e.target.value = '';
    return;
  }

  showCustomLoading('กำลังประมวลผลภาพถ่าย...', 'กำลังสร้างภาพถ่ายพร้อมข้อมูลส่งหมาย');

  try {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(resolve => { img.onload = resolve; });

    const caseNumber = getFormattedCaseNumber();
    const locationText = getFullLocationText();
    const currentHeading = window.compassManager ? window.compassManager.getHeading() : 0;

    const payloadData = {
      caseNumber: caseNumber,
      courtType: elements.courtTypeSelect.value,
      district: elements.districtSelect.value,
      subdistrict: elements.subdistrictSelect.value,
      locationType: elements.locationTypeSelect.value,
      locationText: locationText,
      lat: state.lat,
      lng: state.lng,
      heading: currentHeading,
      dateTime: WatermarkEngine.formatThaiDateTime(new Date())
    };

    const result = await WatermarkEngine.renderWatermark(img, payloadData);
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';
    const textFilename = baseFilename + '.txt';
    
    hideCustomLoading();
    showPreviewAndProcess(result, imageFilename, textFilename, payloadData);
  } catch (err) {
    console.error(err);
    hideCustomLoading();
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถประมวลผลภาพได้', 'error');
  } finally {
    e.target.value = '';
  }
}

/**
 * แสดงพรีวิว สั่งดาวน์โหลดอัตโนมัติ (.jpg + .txt) และซิงค์ขึ้น Google Drive
 */
let currentPreviewResult = null;
let currentPreviewData = null;
let currentPreviewImageFilename = '';
let currentPreviewTextFilename = '';

function showPreviewAndProcess(result, imageFilename, textFilename, data) {
  currentPreviewResult = result;
  currentPreviewImageFilename = imageFilename;
  currentPreviewTextFilename = textFilename;
  currentPreviewData = data;

  // 1. Trigger Download ทั้งรูปภาพ (.jpg) และ Text File (.txt) ลงมือถือ/คอมพิวเตอร์ทันที
  WatermarkEngine.triggerDownload(result.dataUrl, imageFilename);
  if (result.textContent) {
    WatermarkEngine.triggerTextDownload(result.textContent, textFilename);
  }

  // 2. แสดงใน Preview Modal
  elements.previewImage.src = result.dataUrl;
  elements.previewFilename.textContent = `${imageFilename} + ${textFilename}`;
  elements.previewModal.classList.remove('hidden');
  elements.previewModal.classList.add('flex');

  // แจ้งเตือน Toast เล็กๆ
  Swal.fire({
    icon: 'success',
    title: 'บันทึกรูปภาพและ Text File เรียบร้อย',
    html: `บันทึกไฟล์ <b>"${imageFilename}"</b> และ <b>"${textFilename}"</b> แล้ว`,
    timer: 2500,
    showConfirmButton: false,
    toast: true,
    position: 'top-end'
  });
}

// ผูก Event ปุ่มใน Preview Modal
document.addEventListener('DOMContentLoaded', () => {
  elements.btnRetake.addEventListener('click', () => {
    elements.previewModal.classList.add('hidden');
    elements.previewModal.classList.remove('flex');
    openCameraModal();
  });

  elements.btnConfirmUpload.addEventListener('click', () => {
    uploadToGoogleDrive();
  });
});

/**
 * ส่งข้อมูล รูปภาพ และ Text File ไปยัง Google Apps Script
 */
async function uploadToGoogleDrive() {
  if (!state.appsScriptUrl) {
    Swal.fire({
      title: 'ยังไม่ได้ตั้งค่า Google Apps Script URL',
      html: `กรุณากรอก Web App URL ของ Google Apps Script เพื่อบันทึกรูปลงใน Google Drive โฟลเดอร์ที่กำหนด<br><br>
             <a href="https://drive.google.com/drive/folders/1whnbwZjGSevdo-KG8RVz9oFge8V-U5wp?usp=sharing" target="_blank" class="text-blue-600 underline text-sm">เปิด Google Drive Folder</a>`,
      input: 'text',
      inputPlaceholder: 'https://script.google.com/macros/s/.../exec',
      inputValue: state.appsScriptUrl,
      showCancelButton: true,
      confirmButtonText: 'บันทึกและอัปโหลด',
      cancelButtonText: 'ข้ามการบันทึกออนไลน์',
      confirmButtonColor: '#2563eb',
      cancelButtonColor: '#dc2626'
    }).then((res) => {
      if (res.isConfirmed && res.value) {
        state.appsScriptUrl = res.value.trim();
        localStorage.setItem('slts_apps_script_url', state.appsScriptUrl);
        executeUpload();
      }
    });
    return;
  }

  executeUpload();
}

async function executeUpload() {
  if (!currentPreviewResult || !currentPreviewData) return;

  showCustomLoading('กำลังบันทึกข้อมูล...', 'กำลังอัปโหลดรูปภาพและบันทึกลง Google Drive');

  try {
    const payload = {
      ...currentPreviewData,
      fileName: currentPreviewImageFilename,
      imageBase64: currentPreviewResult.dataUrl,
      textContent: currentPreviewResult.textContent || WatermarkEngine.generateTextFileContent(currentPreviewData)
    };

    // ส่ง POST ไปยัง Google Apps Script Web App
    const response = await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // ป้องกัน CORS preflight block ใน GAS
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let resJson = null;

    try {
      resJson = JSON.parse(responseText);
    } catch (parseErr) {
      if (responseText.includes('ต้องมีสิทธิ์เข้าถึง') || responseText.includes('accounts.google.com') || responseText.includes('<!DOCTYPE')) {
        throw new Error('Google Apps Script ถูกตั้งค่าสิทธิ์เป็นส่วนตัว กรุณาตั้งค่า "Who has access" (ผู้มีสิทธิ์เข้าถึง) ในการ Deploy ให้เป็น "Anyone" (ทุกคน)');
      } else {
        throw new Error('การตอบกลับจาก Google Apps Script ไม่ถูกต้อง: ' + responseText.substring(0, 100));
      }
    }

    if (resJson && resJson.status === 'success') {
      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ!',
        html: `<p class="text-gray-700">บันทึกรูปภาพและ Text File เลขคดี <b>${currentPreviewData.caseNumber}</b> ลงใน Google Drive เรียบร้อยแล้ว</p>
               ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
        confirmButtonColor: '#2563eb'
      }).then(() => {
        elements.previewModal.classList.add('hidden');
        elements.previewModal.classList.remove('flex');
        resetFormForNextCase();
      });
    } else {
      throw new Error((resJson && resJson.message) || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }

  } catch (error) {
    console.error('Upload error:', error);
    Swal.fire({
      icon: 'warning',
      title: 'บันทึกลง Google Drive ไม่สำเร็จ',
      html: `
        <div class="text-left text-sm text-gray-700 space-y-2">
          <p class="font-semibold text-red-600">${error.message}</p>
          <hr class="my-2">
          <p><b>วิธีแก้ไข:</b></p>
          <ol class="list-decimal pl-4 space-y-1 text-xs text-gray-600">
            <li>เปิด Google Apps Script โครงการของคุณ</li>
            <li>กด <b>Deploy</b> > <b>Manage deployments</b> (จัดการการทำให้ใช้งานได้)</li>
            <li>กดไอคอน <b>✏️ (แก้ไข)</b> ที่เวอร์ชันล่าสุด</li>
            <li>ตรง <b>Who has access (ผู้มีสิทธิ์เข้าถึง)</b> ให้เปลี่ยนเป็น <b>"Anyone" (ทุกคน)</b></li>
            <li>กด <b>Deploy</b> และลองใหม่อีกครั้ง</li>
          </ol>
        </div>
      `,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#2563eb'
    });
  }
}

function resetFormForNextCase() {
  const courtType = elements.courtTypeSelect.value;
  if (courtType === 'ศาลอื่น') {
    elements.otherCaseNoInput.value = '';
    elements.otherCaseNoInput.focus();
  } else {
    elements.caseNumberInput.value = '';
    elements.caseNumberInput.focus();
  }
  elements.houseNoInput.value = '';
  elements.mooInput.value = '';
}

/**
 * การตั้งค่า Google Apps Script Web App URL
 */
function initSettings() {
  if (elements.btnSettings) {
    elements.btnSettings.addEventListener('click', () => {
      Swal.fire({
        title: 'ตั้งค่าการเชื่อมต่อ Google Drive',
        html: `
          <div class="text-left text-sm text-gray-600 mb-3 space-y-2">
            <p>1. นำโค้ดในโฟลเดอร์ <code>google-apps-script/Code.gs</code> ไป Deploy เป็น Web App ใน Google Apps Script</p>
            <p>2. วาง Web App URL ที่ได้ลงในช่องด้านล่างนี้:</p>
          </div>
        `,
        input: 'text',
        inputValue: state.appsScriptUrl,
        inputPlaceholder: 'https://script.google.com/macros/s/.../exec',
        showCancelButton: true,
        confirmButtonText: 'บันทึกการตั้งค่า',
        cancelButtonText: 'ปิด',
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#dc2626'
      }).then((res) => {
        if (res.isConfirmed) {
          state.appsScriptUrl = (res.value || '').trim();
          localStorage.setItem('slts_apps_script_url', state.appsScriptUrl);
          Swal.fire('บันทึกแล้ว', 'ตั้งค่า URL เรียบร้อยแล้ว', 'success');
        }
      });
    });
  }
}
