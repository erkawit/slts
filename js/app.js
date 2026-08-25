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
  appsScriptUrl: localStorage.getItem('slts_apps_script_url') || '',
  isUploading: false
};

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

  // ปีปัจจุบัน ย้อนหลังไป 5 ปี (รวม 6 ปี เช่น 2569, 2568, 2567, 2566, 2565, 2564)
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
    // ถ้าเคยอนุญาตแล้ว ดึงพิกัดและเริ่มรอบรีเฟรชทันทีโดยไม่ต้องถามซ้ำ
    if (window.compassManager) {
      window.compassManager.requestPermission();
    }
    fetchCurrentLocation(false);
    startLocationInterval();
    return;
  }

  // แจ้งเตือนขออนุญาต Location ผ่าน SweetAlert2 เฉพาะครั้งแรก
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
  // Auto-refresh ทุก 10 วินาที ตามข้อ 2.4
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
 * ระบบจัดการกล้อง WebRTC Camera API
 */
function initCameraEvents() {
  elements.btnOpenCamera.addEventListener('click', () => {
    // ตรวจสอบความถูกต้องของฟอร์มก่อนเปิดกล้อง
    if (!validateForm()) return;
    openCameraModal();
  });

  elements.btnCloseCamera.addEventListener('click', closeCameraModal);

  elements.btnFlipCamera.addEventListener('click', () => {
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
  });

  elements.btnCapture.addEventListener('click', captureAndProcessPhoto);

  // Fallback สำหรับกรณีกล้อง WebRTC ไม่ทำงาน
  elements.fileFallbackInput.addEventListener('change', handleFallbackFile);
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
        text: 'สำหรับหมายบ้าน บังคับต้องระบุบ้านเลขที่',
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
  elements.cameraModal.classList.remove('hidden');
  elements.cameraModal.classList.add('flex');
  await startCameraStream();
}

function closeCameraModal() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  elements.cameraModal.classList.add('hidden');
  elements.cameraModal.classList.remove('flex');
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
    
    // แจ้งให้ใช้วิธีถ่ายรูปผ่าน Native File Picker
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

  Swal.fire({
    title: 'กำลังประมวลผลลายน้ำ...',
    html: 'กำลังรวมแผนที่ เข็มทิศ และข้อมูลส่งหมาย',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

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

    // 1. สร้างภาพ Watermark
    const result = await WatermarkEngine.renderWatermark(elements.videoPreview, payloadData);
    
    // 2. ตั้งชื่อไฟล์ตามเลขคดี โดยแปลง / เป็น -
    const safeFilename = caseNumber.replace(/\//g, '-') + '.jpg';
    
    // ปิดกล้อง
    closeCameraModal();
    Swal.close();

    // 3. แสดง Modal Preview พร้อมดาวน์โหลดลงเครื่องทันที (ตามข้อ 3.3)
    showPreviewAndProcess(result, safeFilename, payloadData);

  } catch (error) {
    console.error('Capture error:', error);
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

  Swal.fire({
    title: 'กำลังประมวลผลลายน้ำ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

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
    const safeFilename = caseNumber.replace(/\//g, '-') + '.jpg';
    
    Swal.close();
    showPreviewAndProcess(result, safeFilename, payloadData);
  } catch (err) {
    console.error(err);
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถประมวลผลภาพได้', 'error');
  } finally {
    e.target.value = '';
  }
}

/**
 * แสดงพรีวิว สั่งดาวน์โหลดอัตโนมัติ และซิงค์ขึ้น Google Drive
 */
let currentPreviewResult = null;
let currentPreviewData = null;
let currentPreviewFilename = '';

function showPreviewAndProcess(result, filename, data) {
  currentPreviewResult = result;
  currentPreviewFilename = filename;
  currentPreviewData = data;

  // 1. Trigger Download ลงมือถือ/คอมพิวเตอร์ทันที ตามข้อ 3.3
  WatermarkEngine.triggerDownload(result.dataUrl, filename);

  // 2. แสดงใน Preview Modal
  elements.previewImage.src = result.dataUrl;
  elements.previewFilename.textContent = filename;
  elements.previewModal.classList.remove('hidden');
  elements.previewModal.classList.add('flex');

  // แจ้งเตือน Toast เล็กๆ
  Swal.fire({
    icon: 'success',
    title: 'บันทึกรูปลงเครื่องเรียบร้อย',
    text: `บันทึกไฟล์ "${filename}" แล้ว`,
    timer: 2000,
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
 * ส่งข้อมูลและรูปภาพไปยัง Google Apps Script
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

  Swal.fire({
    title: 'กำลังส่งข้อมูลไปยัง Google Drive...',
    html: 'กำลังอัปโหลดไฟล์ภาพและบันทึกข้อมูลลง Google Sheet',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const payload = {
      ...currentPreviewData,
      fileName: currentPreviewFilename,
      imageBase64: currentPreviewResult.dataUrl
    };

    // ส่ง POST ไปยัง Google Apps Script Web App
    const response = await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // ป้องกัน CORS preflight block ใน GAS
      },
      body: JSON.stringify(payload)
    });

    const resJson = await response.json();

    if (resJson.status === 'success') {
      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ!',
        html: `<p class="text-gray-700">บันทึกรูปและข้อมูลเลขคดี <b>${currentPreviewData.caseNumber}</b> ลงใน Google Drive เรียบร้อยแล้ว</p>
               ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded text-sm">ดูรูปใน Google Drive</a>` : ''}`,
        confirmButtonColor: '#2563eb'
      }).then(() => {
        elements.previewModal.classList.add('hidden');
        elements.previewModal.classList.remove('flex');
        resetFormForNextCase();
      });
    } else {
      throw new Error(resJson.message || 'เกิดข้อผิดพลาดในการบันทึก');
    }

  } catch (error) {
    console.error('Upload error:', error);
    Swal.fire({
      icon: 'warning',
      title: 'บันทึกลง Google Drive ไม่สำเร็จ',
      text: 'ภาพถูกดาวน์โหลดลงเครื่องคุณแล้ว แต่ไม่สามารถส่งไป Apps Script ได้: ' + error.message,
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
