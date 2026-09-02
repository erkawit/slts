/**
 * app.js - ตัวควบคุมหลักของระบบจัดเก็บข้อมูลพิกัดส่งหมาย
 * ศาลจังหวัดอุดรธานี
 * 
 * รองรับ:
 * 1. บันทึกข้อมูลพิกัดและถ่ายภาพส่งหมาย (Mobile & Desktop)
 * 2. ล็อกอิน / สิทธิ์ผู้ใช้งาน (Admin / User) + แก้ไขโปรไฟล์ & เปลี่ยนรหัสผ่าน
 * 3. จัดการผู้ใช้ (Admin): แก้ไขข้อมูล, รีเซ็ตรหัสผ่าน, ตั้งค่ารหัสผ่านตั้งต้น
 * 4. แคชตารางข้อมูล Google Sheet ลง localStorage พร้อมเงื่อนไข 1 นาที (1-Min Smart Cache)
 * 5. ลบข้อมูลใน Google Sheet และ Google Drive (Admin เท่านั้น)
 */

// Global Application State
const state = {
  lat: null,
  lng: null,
  accuracy: null,
  lastLocationTime: null,
  locationIntervalId: null,
  cameraStream: null,
  facingMode: 'environment',
  captureOrientation: 'landscape', // แนวนอน (4:3) เป็นโหมดพื้นฐาน
  hudIntervalId: null,
  appsScriptUrl: localStorage.getItem('slts_apps_script_url') || 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec',
  googleSheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo/gviz/tq?tqx=out:csv',
  usersGoogleSheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo/gviz/tq?tqx=out:csv&sheet=users',
  isUploading: false,
  currentUser: null,
  dataTableInstance: null,
  selectedProvince: localStorage.getItem('slts_selected_province') || null,
  stagedScheduleStops: [],
  lastScheduleFormData: (function() {
    try {
      return JSON.parse(localStorage.getItem('slts_last_schedule_form') || 'null');
    } catch (e) {
      return null;
    }
  })()
};

// Cache Constants
const CACHE_KEY_SHEET_DATA = 'slts_sheet_data_cache';
const CACHE_KEY_SHEET_TIME = 'slts_sheet_data_last_fetch';
const CACHE_TTL_MS = 60 * 1000; // 1 นาที (60,000 มิลลิวินาที)

// Offline Queue Storage Key
const OFFLINE_QUEUE_KEY = 'slts_offline_queue';

function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function addToOfflineQueue(item) {
  const queue = getOfflineQueue();
  const queueItem = {
    id: 'off_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    createdAt: new Date().toISOString(),
    ...item
  };
  queue.push(queueItem);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Save offline queue error:', e);
  }
  updateOfflineBadgeUI();
  return queueItem;
}

function removeFromOfflineQueue(id) {
  let queue = getOfflineQueue();
  queue = queue.filter(q => q.id !== id);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Remove offline queue error:', e);
  }
  updateOfflineBadgeUI();
}

function updateOfflineBadgeUI() {
  const queue = getOfflineQueue();
  const badgeBtn = document.getElementById('btnSyncOfflineQueue');
  const countBadge = document.getElementById('offlineQueueCountBadge');
  const netBadge = document.getElementById('networkStatusBadge');
  const netDot = document.getElementById('networkStatusDot');
  const netText = document.getElementById('networkStatusText');

  const isOnline = navigator.onLine;

  if (netBadge && netDot && netText) {
    if (isOnline) {
      netBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm select-none';
      netDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
      netText.textContent = 'ออนไลน์';
    } else {
      netBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 shadow-sm select-none';
      netDot.className = 'w-2 h-2 rounded-full bg-rose-500';
      netText.textContent = 'ออฟไลน์';
    }
  }

  if (badgeBtn && countBadge) {
    if (queue.length > 0) {
      badgeBtn.classList.remove('hidden');
      badgeBtn.classList.add('inline-flex');
      countBadge.textContent = `รอซิงค์ (${queue.length})`;
    } else {
      badgeBtn.classList.add('hidden');
      badgeBtn.classList.remove('inline-flex');
    }
  }
}

function initOfflineSyncSystem() {
  window.addEventListener('online', () => {
    updateOfflineBadgeUI();
    const queue = getOfflineQueue();
    if (queue.length > 0) {
      Swal.fire({
        icon: 'info',
        title: 'เชื่อมต่ออินเทอร์เน็ตแล้ว',
        html: `ตรวจพบข้อมูลที่บันทึกไว้ในโหมดออฟไลน์จำนวน <b>${queue.length}</b> รายการ<br>ระบบจะเริ่มทำการซิงค์ขึ้น Google Drive & Sheet ทันที`,
        timer: 3000,
        toast: true,
        position: 'top-end',
        showConfirmButton: false
      });
      syncOfflineQueue(false);
    }
  });

  window.addEventListener('offline', () => {
    updateOfflineBadgeUI();
    Swal.fire({
      icon: 'warning',
      title: 'เข้าสู่โหมดออฟไลน์',
      text: 'ระบบจะจัดเก็บภาพถ่ายและข้อมูลลงในเครื่องให้อัตโนมัติ',
      timer: 3000,
      toast: true,
      position: 'top-end',
      showConfirmButton: false
    });
  });

  updateOfflineBadgeUI();
}

async function syncOfflineQueue(isManual = false) {
  const queue = getOfflineQueue();

  if (!navigator.onLine) {
    if (isManual) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
        text: 'กรุณาเชื่อมต่อ Wi-Fi หรือ Cellular ก่อนทำการซิงค์ข้อมูล',
        showCloseButton: true,
        allowOutsideClick: false,
        confirmButtonColor: '#2563eb'
      });
    }
    return;
  }

  if (queue.length === 0) {
    if (isManual) {
      Swal.fire({
        icon: 'success',
        title: 'ไม่มีข้อมูลค้างในคิว',
        text: 'ข้อมูลทั้งหมดได้รับการซิงค์ขึ้น Google Drive & Sheet เรียบร้อยแล้ว',
        showCloseButton: true,
        allowOutsideClick: false,
        confirmButtonColor: '#2563eb'
      });
    }
    return;
  }

  // ซิงค์ข้อมูลทีละรายการ
  let successCount = 0;
  let failCount = 0;

  showCustomLoading(`กำลังซิงค์ข้อมูล (${queue.length} รายการ)...`, 'กำลังนำส่งข้อมูลขึ้น Google Drive & Sheet');

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      const response = await fetch(state.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(item.payload)
      });
      const resJson = await response.json();
      if (resJson && resJson.status === 'success') {
        removeFromOfflineQueue(item.id);
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error('Sync item error:', err);
      failCount++;
    }
  }

  hideCustomLoading();
  updateOfflineBadgeUI();
  localStorage.removeItem(CACHE_KEY_SHEET_DATA);
  localStorage.removeItem(CACHE_KEY_SHEET_TIME);

  if (successCount > 0) {
    Swal.fire({
      icon: 'success',
      title: 'ซิงค์ข้อมูลสำเร็จ!',
      html: `นำส่งข้อมูลจากโหมดออฟไลน์ขึ้น Google Drive & Sheet สำเร็จ <b>${successCount}</b> รายการ${failCount > 0 ? `<br><span class="text-xs text-red-500">คงเหลือไม่สำเร็จ ${failCount} รายการ</span>` : ''}`,
      showCloseButton: true,
      allowOutsideClick: false,
      confirmButtonColor: '#2563eb'
    }).then(() => {
      loadGoogleSheetData(true);
    });
  } else if (failCount > 0) {
    Swal.fire({
      icon: 'error',
      title: 'การซิงค์ล้มเหลว',
      text: 'ไม่สามารถส่งข้อมูลได้ กรุณาลองใหม่อีกครั้งเมื่อมีสัญญาณอินเทอร์เน็ตที่เสถียร',
      showCloseButton: true,
      allowOutsideClick: false,
      confirmButtonColor: '#2563eb'
    });
  }
}

/**
 * แสดงหน้าต่างโหลดข้อมูลแบบ SweetAlert2 โปร่งใส 100%
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
  initAuthSystem();
  initOfflineSyncSystem();
  initProvinceSystem();
  initCasePrefixes();
  initCaseYearDropdowns();
  initFormEventListeners();
  initLocationService();
  initCameraEvents();
  initDesktopUploadEvents();
  initSettings();
  initResponsiveUI();

  // กำหนดขั้นตอนเริ่มต้นตามขนาดหน้าจอ (Mobile vs Desktop)
  if (window.innerWidth < 768) {
    // จอมือถือ (< 768px): เปิดหน้ากล้องถ่ายภาพสดทันที (ไม่โหลดฟอร์ม SweetAlert ขึ้นมาก่อน)
    openCameraModal().catch(e => console.warn('Camera open error:', e));
  } else {
    // จอคอมพิวเตอร์ (>= 768px): แสดงหน้าแบบฟอร์ม 2 คอลัมน์ตามเดิม
    switchTab('form');
    // ตรวจสอบและขออนุญาตเข้าถึงกล้องในระบบสำหรับหน้าจอคอมพิวเตอร์ (> 768px)
    setTimeout(() => {
      checkAndRequestCameraPermission(false);
    }, 400);
  }
});


function initDOMElements() {
  elements.tabBtnCamera = document.getElementById('tabBtnCamera');
  elements.tabBtnForm = document.getElementById('tabBtnForm') || elements.tabBtnCamera;
  elements.tabBtnTable = document.getElementById('tabBtnTable');
  elements.tabBtnMap = document.getElementById('tabBtnMap');
  elements.tabBtnUsers = document.getElementById('tabBtnUsers');
  elements.tabContentForm = document.getElementById('tabContentForm');
  elements.tabContentTable = document.getElementById('tabContentTable');
  elements.tabContentMap = document.getElementById('tabContentMap');
  elements.tabContentUsers = document.getElementById('tabContentUsers');

  elements.form = document.getElementById('summonsForm');
  elements.provinceSelect = document.getElementById('province');
  elements.districtSelect = document.getElementById('district');
  elements.subdistrictSelect = document.getElementById('subdistrict');
  elements.courtTypeSelect = document.getElementById('courtType');
  elements.courtNameInput = document.getElementById('courtNameInput');
  elements.floatingProvinceContainer = document.getElementById('floatingProvinceContainer');
  elements.floatingProvinceName = document.getElementById('floatingProvinceName');
  elements.btnFloatingResetProvince = document.getElementById('btnFloatingResetProvince');
  elements.btnEditMobileForm = document.getElementById('btnEditMobileForm');
  
  // เลขคดี
  elements.udonCaseField = document.getElementById('udonCaseField');
  elements.udonPrefixInput = document.getElementById('udonPrefix');
  elements.udonPrefixList = document.getElementById('udonPrefixList');
  elements.udonCaseNoInput = document.getElementById('udonCaseNo');
  elements.udonCaseYearSelect = document.getElementById('udonCaseYear');
  elements.otherCourtCaseField = document.getElementById('otherCourtCaseField');
  elements.otherCaseNoInput = document.getElementById('otherCaseNo');
  elements.otherCaseYearSelect = document.getElementById('otherCaseYear');
  elements.caseExtraInput = document.getElementById('caseExtraInput');

  // ข้อมูลที่ตั้ง
  elements.locationTypeSelect = document.getElementById('locationType');
  elements.houseAddressFields = document.getElementById('houseAddressFields');
  elements.houseNoInput = document.getElementById('houseNo');
  elements.mooInput = document.getElementById('moo');
  elements.localAdminAddressFields = document.getElementById('localAdminAddressFields');
  elements.localAdminNameInput = document.getElementById('localAdminName');
  elements.customOtherAddressFields = document.getElementById('customOtherAddressFields');
  elements.customOtherLocationName = document.getElementById('customOtherLocationName');

  // พิกัด
  elements.coordinatesInput = document.getElementById('coordinates');
  elements.locationStatus = document.getElementById('locationStatus');
  elements.btnRefreshLocation = document.getElementById('btnRefreshLocation');
  elements.btnOpenCamera = document.getElementById('btnOpenCamera');
  elements.fileFallbackInput = document.getElementById('fileFallbackInput');

  // Desktop File Upload Elements
  elements.desktopImageFileInput = document.getElementById('desktopImageFileInput');
  elements.desktopImagePreviewContainer = document.getElementById('desktopImagePreviewContainer');
  elements.desktopPreviewImg = document.getElementById('desktopPreviewImg');
  elements.desktopImageSizeBadge = document.getElementById('desktopImageSizeBadge');
  elements.btnConfirmDesktopUpload = document.getElementById('btnConfirmDesktopUpload');
  elements.chkDesktopHasWatermark = document.getElementById('chkDesktopHasWatermark');
  elements.desktopWatermarkBadge = document.getElementById('desktopWatermarkBadge');
  
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

  // Settings & Navigation
  elements.btnSettings = document.getElementById('btnSettings');
  elements.tabBtnForm = document.getElementById('tabBtnForm');
  elements.tabBtnTable = document.getElementById('tabBtnTable');
  elements.tabBtnUsers = document.getElementById('tabBtnUsers');
  elements.tabContentForm = document.getElementById('tabContentForm');
  elements.tabContentTable = document.getElementById('tabContentTable');
  elements.tabContentUsers = document.getElementById('tabContentUsers');
  elements.cacheStatusBadge = document.getElementById('cacheStatusBadge');

  // Auth & Dropdown Elements
  elements.loginModal = document.getElementById('loginModal');
  elements.btnLoginModal = document.getElementById('btnLoginModal');
  elements.userProfileContainer = document.getElementById('userProfileContainer');
  elements.userDropdownMenu = document.getElementById('userDropdownMenu');
  elements.authUserName = document.getElementById('authUserName');
  elements.authUserRole = document.getElementById('authUserRole');
  elements.dropdownUserFullName = document.getElementById('dropdownUserFullName');
  elements.dropdownUsername = document.getElementById('dropdownUsername');
  elements.dropdownRoleBadge = document.getElementById('dropdownRoleBadge');
  elements.userListBody = document.getElementById('userListBody');
  elements.currentDefaultResetPassText = document.getElementById('currentDefaultResetPassText');

  // Modals
  elements.editProfileModal = document.getElementById('editProfileModal');
  elements.changePasswordModal = document.getElementById('changePasswordModal');
}

// =========================================================================
// 1. ระบบยืนยันตัวตนและการจัดการสิทธิ์ผู้ใช้งาน (Authentication & Profile)
// =========================================================================

function initAuthSystem() {
  // สร้างผู้ใช้เริ่มต้น (Admin) หากยังไม่มีในระบบ
  let users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  if (users.length === 0) {
    users = [
      {
        username: 'admin',
        password: 'caogikojt02',
        role: 'admin',
        name: 'ผู้ดูแลระบบ (Admin)',
        createdAt: '25/08/2569'
      }
    ];
    localStorage.setItem('slts_users', JSON.stringify(users));
  }

  // รหัสผ่านตั้งต้นสำหรับการรีเซ็ต (Default Reset Password: 123456)
  if (!localStorage.getItem('slts_default_reset_pass') || localStorage.getItem('slts_default_reset_pass') === 'caogikojt02') {
    localStorage.setItem('slts_default_reset_pass', '123456');
  }

  // ดึงเซสชันผู้ใช้ปัจจุบัน
  const savedUser = localStorage.getItem('slts_current_user');
  if (savedUser) {
    try {
      state.currentUser = JSON.parse(savedUser);
    } catch (e) {
      state.currentUser = null;
    }
  }

  updateAuthUI();

  // ดึงข้อมูลรายชื่อผู้ใช้งานสดจาก Google Sheet (Tab: users)
  loadUsersData(false);
}

/**
 * ดึงข้อมูลรายชื่อผู้ใช้งานจาก Google Sheet Tab: users
 */
window.loadUsersData = async function(forceRefresh = false) {
  if (!navigator.onLine) {
    if (forceRefresh) {
      Swal.fire({
        icon: 'info',
        title: 'โหมดออฟไลน์',
        text: 'ไม่สามารถดึงข้อมูลผู้ใช้จาก Google Sheet ขณะออฟไลน์ได้ กำลังใช้ข้อมูลในเครื่อง',
        timer: 1500,
        showConfirmButton: false
      });
    }
    renderUserList();
    return;
  }

  if (forceRefresh) {
    showCustomLoading('กำลังดึงข้อมูลผู้ใช้งาน...', 'กำลังเชื่อมต่อ Google Sheet (Tab: users)');
  }

  const now = Date.now();
  const csvFetchUrl = `${state.usersGoogleSheetCsvUrl}&_t=${now}`;

  try {
    Papa.parse(csvFetchUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        if (forceRefresh) hideCustomLoading();
        let fetchedRows = results.data || [];
        
        let sheetUsers = fetchedRows
          .filter(r => (r.username || r['ชื่อผู้ใช้'] || '').trim() !== '')
          .map(r => ({
            username: (r.username || r['ชื่อผู้ใช้'] || '').trim(),
            password: (r.password || r['รหัสผ่าน'] || '123456').trim(),
            role: (r.role || r['สิทธิ์'] || 'user').trim(),
            name: (r.name || r['ชื่อ-นามสกุล'] || r.username || '').trim(),
            createdAt: (r.createdAt || r['วันที่สร้าง'] || '').trim()
          }));

        // ตรวจสอบความปลอดภัย: ให้มี admin หลักเสมอ
        if (!sheetUsers.some(u => u.username.toLowerCase() === 'admin')) {
          sheetUsers.unshift({
            username: 'admin',
            password: 'caogikojt02',
            role: 'admin',
            name: 'ผู้ดูแลระบบ (Admin)',
            createdAt: '25/08/2569'
          });
        }

        if (sheetUsers.length > 0) {
          localStorage.setItem('slts_users', JSON.stringify(sheetUsers));
          renderUserList();
        }

        if (forceRefresh) {
          Swal.fire({
            icon: 'success',
            title: 'รีเฟรชสำเร็จ',
            text: `ดึงข้อมูลผู้ใช้งาน ${sheetUsers.length} รายการจาก Google Sheet เรียบร้อยแล้ว`,
            timer: 1500,
            showConfirmButton: false
          });
        }
      },
      error: function(err) {
        console.warn('Users CSV fetch error, trying GAS API fallback:', err);
        fetchUsersFromGasApi(forceRefresh);
      }
    });
  } catch (e) {
    if (forceRefresh) hideCustomLoading();
    console.warn('loadUsersData error:', e);
    renderUserList();
  }
};

async function fetchUsersFromGasApi(showNotification = false) {
  if (!state.appsScriptUrl) return;
  try {
    const response = await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'get_users' })
    });
    const res = await response.json();
    if (showNotification) hideCustomLoading();
    if (res && res.status === 'success' && Array.isArray(res.users) && res.users.length > 0) {
      localStorage.setItem('slts_users', JSON.stringify(res.users));
      renderUserList();
      if (showNotification) {
        Swal.fire({ icon: 'success', title: 'รีเฟรชสำเร็จ', text: 'ดึงรายชื่อผู้ใช้จาก Google Sheet เรียบร้อยแล้ว', timer: 1500, showConfirmButton: false });
      }
    }
  } catch (err) {
    if (showNotification) hideCustomLoading();
    console.warn('fetchUsersFromGasApi error:', err);
  }
}

async function syncUserToGoogleSheet(action, payload) {
  if (!state.appsScriptUrl || !navigator.onLine) return;
  try {
    await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: action,
        ...payload
      })
    });
  } catch (err) {
    console.warn('syncUserToGoogleSheet error:', err);
  }
}

function updateAuthUI() {
  const isDesktop = window.innerWidth > 768;
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const isLoggedIn = !!state.currentUser;

  // ปรับการแสดงผลโปรไฟล์และปุ่มล็อกอิน
  if (isLoggedIn) {
    elements.btnLoginModal.classList.add('hidden');
    elements.userProfileContainer.classList.remove('hidden');
    elements.userProfileContainer.classList.add('flex');
    
    const displayName = state.currentUser.name || state.currentUser.username;
    elements.authUserName.textContent = displayName;
    elements.authUserRole.textContent = state.currentUser.role.toUpperCase();
    elements.dropdownUserFullName.textContent = displayName;
    elements.dropdownUsername.textContent = `@${state.currentUser.username}`;
    
    if (isAdmin) {
      elements.dropdownRoleBadge.className = 'inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200';
      elements.dropdownRoleBadge.textContent = 'Admin (ผู้ดูแลระบบ)';
    } else {
      elements.dropdownRoleBadge.className = 'inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200';
      elements.dropdownRoleBadge.textContent = 'User (เจ้าหน้าที่)';
    }
  } else {
    elements.btnLoginModal.classList.remove('hidden');
    elements.userProfileContainer.classList.add('hidden');
    elements.userProfileContainer.classList.remove('flex');
    if (elements.userDropdownMenu) elements.userDropdownMenu.classList.add('hidden');
  }

  // Tab แผนที่และหมุด (แสดงเฉพาะผู้ใช้งานที่ล็อกอินแล้วเท่านั้น บน Desktop)
  if (isLoggedIn && isDesktop) {
    if (elements.tabBtnMap) elements.tabBtnMap.classList.remove('hidden');
  } else {
    if (elements.tabBtnMap) elements.tabBtnMap.classList.add('hidden');
  }

  // Tab จัดการผู้ใช้งาน (แสดงเฉพาะ Admin บน Desktop)
  if (isAdmin && isDesktop) {
    elements.tabBtnUsers.classList.remove('hidden');
  } else {
    elements.tabBtnUsers.classList.add('hidden');
  }

  // ปุ่มตั้งค่า GAS (แสดงเฉพาะหน้าจอ > 768px และเป็น Admin เท่านั้น)
  if (isDesktop && isAdmin) {
    elements.btnSettings.classList.remove('hidden');
  } else {
    elements.btnSettings.classList.add('hidden');
  }

  if (elements.currentDefaultResetPassText) {
    elements.currentDefaultResetPassText.textContent = localStorage.getItem('slts_default_reset_pass') || '123456';
  }

  renderUserList();
}

// User Profile Dropdown Toggle
window.toggleUserDropdown = function(e) {
  if (e) e.stopPropagation();
  if (elements.userDropdownMenu) {
    elements.userDropdownMenu.classList.toggle('hidden');
  }
};

window.handleGlobalClick = function(e) {
  if (elements.userDropdownMenu && !elements.userDropdownMenu.classList.contains('hidden')) {
    if (!elements.userProfileContainer.contains(e.target)) {
      elements.userDropdownMenu.classList.add('hidden');
    }
  }
};

function openLoginModal() {
  elements.loginModal.classList.remove('hidden');
  elements.loginModal.classList.add('flex');
  document.getElementById('loginUsername').focus();
}

function closeLoginModal() {
  elements.loginModal.classList.add('hidden');
  elements.loginModal.classList.remove('flex');
}

function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value.trim();

  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const matched = users.find(user => user.username === u && user.password === p);

  if (matched) {
    state.currentUser = {
      username: matched.username,
      name: matched.name || matched.username,
      role: matched.role
    };
    localStorage.setItem('slts_current_user', JSON.stringify(state.currentUser));

    closeLoginModal();
    updateAuthUI();

    Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: `ยินดีต้อนรับคุณ ${state.currentUser.name} (${state.currentUser.role.toUpperCase()})`,
      timer: 1500,
      showConfirmButton: false
    });

    if (state.dataTableInstance) {
      loadGoogleSheetData(false);
    }
  } else {
    Swal.fire({
      icon: 'error',
      title: 'เข้าสู่ระบบไม่สำเร็จ',
      text: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      confirmButtonColor: '#2563eb'
    });
  }
}

function handleLogout() {
  if (elements.userDropdownMenu) elements.userDropdownMenu.classList.add('hidden');
  
  Swal.fire({
    title: 'ต้องการออกจากระบบ?',
    text: 'คุณจะกลับสู่โหมดผู้ใช้งานทั่วไป',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ออกจากระบบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      state.currentUser = null;
      localStorage.removeItem('slts_current_user');
      updateAuthUI();
      switchTab('form');
      Swal.fire({
        icon: 'info',
        title: 'ออกจากระบบแล้ว',
        timer: 1200,
        showConfirmButton: false
      });
    }
  });
}

// Edit Profile Modal
window.openEditProfileModal = function() {
  if (!state.currentUser) return;
  if (elements.userDropdownMenu) elements.userDropdownMenu.classList.add('hidden');
  
  document.getElementById('profileUsername').value = state.currentUser.username;
  document.getElementById('profileDisplayName').value = state.currentUser.name || '';
  
  elements.editProfileModal.classList.remove('hidden');
  elements.editProfileModal.classList.add('flex');
  document.getElementById('profileDisplayName').focus();
};

window.closeEditProfileModal = function() {
  elements.editProfileModal.classList.add('hidden');
  elements.editProfileModal.classList.remove('flex');
};

window.handleSaveProfile = function(e) {
  e.preventDefault();
  if (!state.currentUser) return;

  const newName = document.getElementById('profileDisplayName').value.trim();
  if (!newName) return;

  // อัปเดตใน users list
  let users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const idx = users.findIndex(u => u.username === state.currentUser.username);
  if (idx !== -1) {
    users[idx].name = newName;
    localStorage.setItem('slts_users', JSON.stringify(users));
    syncUserToGoogleSheet('save_user', users[idx]);
  }

  // อัปเดต current session
  state.currentUser.name = newName;
  localStorage.setItem('slts_current_user', JSON.stringify(state.currentUser));

  closeEditProfileModal();
  updateAuthUI();

  Swal.fire({
    icon: 'success',
    title: 'บันทึกข้อมูลสำเร็จ',
    text: `อัปเดตชื่อแสดงผลเป็น "${newName}" เรียบร้อยแล้ว`,
    timer: 1500,
    showConfirmButton: false
  });
};

// Change Password Modal
window.openChangePasswordModal = function() {
  if (!state.currentUser) return;
  if (elements.userDropdownMenu) elements.userDropdownMenu.classList.add('hidden');
  
  document.getElementById('changePasswordForm').reset();
  elements.changePasswordModal.classList.remove('hidden');
  elements.changePasswordModal.classList.add('flex');
  document.getElementById('currentPass').focus();
};

window.closeChangePasswordModal = function() {
  elements.changePasswordModal.classList.add('hidden');
  elements.changePasswordModal.classList.remove('flex');
};

window.handleSaveNewPassword = function(e) {
  e.preventDefault();
  if (!state.currentUser) return;

  const curPass = document.getElementById('currentPass').value.trim();
  const newPass = document.getElementById('newPass').value.trim();
  const confirmPass = document.getElementById('confirmNewPass').value.trim();

  let users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const user = users.find(u => u.username === state.currentUser.username);

  if (!user || user.password !== curPass) {
    Swal.fire('รหัสผ่านเดิมไม่ถูกต้อง', 'กรุณาตรวจสอบรหัสผ่านปัจจุบันของคุณอีกครั้ง', 'error');
    return;
  }

  if (newPass.length < 4) {
    Swal.fire('รหัสผ่านสั้นเกินไป', 'โปรดกำหนดรหัสผ่านใหม่อย่างน้อย 4 ตัวอักษร', 'warning');
    return;
  }

  if (newPass !== confirmPass) {
    Swal.fire('รหัสผ่านไม่ตรงกัน', 'รหัสผ่านใหม่และยืนยันรหัสผ่านใหม่ไม่ตรงกัน', 'warning');
    return;
  }

  user.password = newPass;
  localStorage.setItem('slts_users', JSON.stringify(users));

  // ซิงค์รหัสผ่านใหม่ไปยัง Google Sheet (Tab: users)
  syncUserToGoogleSheet('update_user_password', { username: user.username, password: newPass });

  closeChangePasswordModal();

  Swal.fire({
    icon: 'success',
    title: 'เปลี่ยนรหัสผ่านสำเร็จ',
    text: 'รหัสผ่านของคุณได้รับการเปลี่ยนและซิงค์ไปยัง Google Sheet เรียบร้อยแล้ว',
    timer: 1800,
    showConfirmButton: false
  });
};

// =========================================================================
// 2. จัดการผู้ใช้งาน (User Management - Admin Only)
// =========================================================================

function handleCreateUser(e) {
  e.preventDefault();
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    Swal.fire('ไม่มีสิทธิ์', 'เฉพาะ Admin เท่านั้นที่สามารถเพิ่มผู้ใช้ได้', 'error');
    return;
  }

  const username = document.getElementById('newUsername').value.trim();
  const fullName = document.getElementById('newFullName').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const role = document.getElementById('newRole').value;

  if (!username || !password) return;

  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    Swal.fire('ข้อผิดพลาด', 'ชื่อผู้ใช้นี้มีในระบบแล้ว กรุณาใช้ชื่ออื่น', 'warning');
    return;
  }

  const dateNow = WatermarkEngine.formatThaiDateTime(new Date()).split(' ')[0] + ' ' + WatermarkEngine.formatThaiDateTime(new Date()).split(' ')[1] + ' ' + WatermarkEngine.formatThaiDateTime(new Date()).split(' ')[2];
  
  const newUser = {
    username: username,
    password: password,
    role: role,
    name: fullName || (role === 'admin' ? `Admin (${username})` : `เจ้าหน้าที่ (${username})`),
    createdAt: dateNow
  };

  users.push(newUser);
  localStorage.setItem('slts_users', JSON.stringify(users));
  document.getElementById('addUserForm').reset();
  renderUserList();

  // ซิงค์ผู้ใช้ใหม่ไปยัง Google Sheet (Tab: users)
  syncUserToGoogleSheet('save_user', newUser);

  Swal.fire({
    icon: 'success',
    title: 'เพิ่มผู้ใช้งานสำเร็จ',
    text: `สร้างผู้ใช้ "${username}" และบันทึกลง Google Sheet เรียบร้อยแล้ว`,
    timer: 1800,
    showConfirmButton: false
  });
}

function renderUserList() {
  if (!elements.userListBody) return;
  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  elements.userListBody.innerHTML = '';

  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50/80 transition';

    const isAdmin = u.role === 'admin';
    const roleBadge = isAdmin
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">Admin</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">User</span>`;

    const isPrimaryAdmin = u.username === 'admin';
    
    let actionButtons = '';
    if (state.currentUser && state.currentUser.role === 'admin') {
      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <button type="button" onclick="editUserModal('${u.username}')" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold border border-blue-200 transition" title="แก้ไขข้อมูลผู้ใช้">
            <i class="fa-solid fa-pen-to-square mr-1"></i>แก้ไข
          </button>
          <button type="button" onclick="resetUserPasswordModal('${u.username}')" class="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold border border-amber-200 transition" title="รีเซ็ตรหัสผ่าน">
            <i class="fa-solid fa-key mr-1"></i>รีเซ็ตรหัส
          </button>
          ${!isPrimaryAdmin ? `
            <button type="button" onclick="deleteUser('${u.username}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold border border-red-200 transition" title="ลบผู้ใช้">
              <i class="fa-solid fa-trash"></i>
            </button>
          ` : '<span class="text-[11px] text-gray-400 italic ml-1">หลัก</span>'}
        </div>
      `;
    }

    tr.innerHTML = `
      <td class="py-3 px-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full ${isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'} flex items-center justify-center font-bold text-xs">
            <i class="fa-solid ${isAdmin ? 'fa-shield-halved' : 'fa-user'}"></i>
          </div>
          <div>
            <p class="font-bold text-gray-900 leading-tight">${u.name || u.username}</p>
            <p class="text-xs text-gray-500 font-mono">@${u.username}</p>
          </div>
        </div>
      </td>
      <td class="py-3 px-4">${roleBadge}</td>
      <td class="py-3 px-4 text-xs text-gray-500 font-mono">${formatThaiDateDisplay(u.createdAt) || '-'}</td>
      <td class="py-3 px-4 text-right">${actionButtons}</td>
    `;
    elements.userListBody.appendChild(tr);
  });
}

// Edit User Modal (Admin)
window.editUserModal = function(username) {
  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const user = users.find(u => u.username === username);
  if (!user) return;

  const isPrimary = username === 'admin';

  Swal.fire({
    title: `แก้ไขข้อมูลผู้ใช้ (@${username})`,
    html: `
      <div class="text-left space-y-3 pt-2">
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">ชื่อ-นามสกุล / ชื่อแสดง *</label>
          <input type="text" id="swalEditName" value="${user.name || user.username}" class="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">สิทธิ์การใช้งาน (Role) *</label>
          <select id="swalEditRole" class="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-sm" ${isPrimary ? 'disabled' : ''}>
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User (เจ้าหน้าที่ทั่วไป)</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin (ผู้ดูแลระบบ)</option>
          </select>
          ${isPrimary ? '<p class="text-[11px] text-gray-400 mt-1">ผู้ดูแลระบบหลักไม่สามารถเปลี่ยน Role ได้</p>' : ''}
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'บันทึกการแก้ไข',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    preConfirm: () => {
      const name = document.getElementById('swalEditName').value.trim();
      const role = document.getElementById('swalEditRole').value;
      if (!name) {
        Swal.showValidationMessage('กรุณาระบุชื่อ-นามสกุล');
        return false;
      }
      return { name, role };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      user.name = res.value.name;
      if (!isPrimary) user.role = res.value.role;
      localStorage.setItem('slts_users', JSON.stringify(users));

      // ถ้าแก้ไขบัญชีที่ล็อกอินอยู่ ให้ sync session ด้วย
      if (state.currentUser && state.currentUser.username === username) {
        state.currentUser.name = user.name;
        state.currentUser.role = user.role;
        localStorage.setItem('slts_current_user', JSON.stringify(state.currentUser));
      }

      updateAuthUI();

      // ซิงค์ไปยัง Google Sheet (Tab: users)
      syncUserToGoogleSheet('save_user', user);

      Swal.fire('สำเร็จ', `อัปเดตข้อมูลผู้ใช้ @${username} ใน Google Sheet เรียบร้อยแล้ว`, 'success');
    }
  });
};

// Reset User Password Modal (Admin)
window.resetUserPasswordModal = function(username) {
  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const user = users.find(u => u.username === username);
  if (!user) return;

  const defaultPass = localStorage.getItem('slts_default_reset_pass') || '123456';

  Swal.fire({
    title: `รีเซ็ตรหัสผ่าน (@${username})`,
    showCloseButton: true,
    allowOutsideClick: false,
    html: `
      <div class="text-left space-y-3.5 pt-2">
        <p class="text-xs text-gray-600">เลือกรีเซ็ตรหัสผ่านเป็นค่าตั้งต้น หรือกำหนดรหัสผ่านใหม่เอง:</p>
        
        <div class="p-3 bg-blue-50/80 border border-blue-200 rounded-xl">
          <p class="text-xs font-bold text-blue-900 mb-1">รหัสผ่านตั้งต้นของระบบ:</p>
          <div class="flex items-center justify-between">
            <span class="font-mono text-sm font-bold text-blue-700">${defaultPass}</span>
            <button type="button" id="btnApplyDefaultPass" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition shadow-sm">
              ใช้รหัสตั้งต้นนี้
            </button>
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">หรือ กำหนดรหัสผ่านใหม่เอง:</label>
          <input type="text" id="swalCustomPass" placeholder="พิมพ์รหัสผ่านใหม่" class="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-sm font-mono">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'บันทึกรหัสผ่านใหม่',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    didOpen: () => {
      const applyBtn = document.getElementById('btnApplyDefaultPass');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          document.getElementById('swalCustomPass').value = defaultPass;
        });
      }
    },
    preConfirm: () => {
      const pass = document.getElementById('swalCustomPass').value.trim();
      if (!pass) {
        Swal.showValidationMessage('กรุณาระบุรหัสผ่าน หรือกดปุ่ม "ใช้รหัสตั้งต้นนี้"');
        return false;
      }
      return pass;
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      user.password = res.value;
      localStorage.setItem('slts_users', JSON.stringify(users));

      // ซิงค์รหัสผ่านใหม่ไปยัง Google Sheet (Tab: users)
      syncUserToGoogleSheet('update_user_password', { username: username, password: res.value });

      Swal.fire({
        icon: 'success',
        title: 'รีเซ็ตรหัสผ่านสำเร็จ',
        showCloseButton: true,
        allowOutsideClick: false,
        html: `รีเซ็ตรหัสผ่านของ <b>@${username}</b> ใน Google Sheet เป็น: <br><span class="font-mono text-base font-bold text-blue-600 mt-1 inline-block bg-blue-50 px-3 py-1 rounded-lg border border-blue-200">${res.value}</span>`,
        confirmButtonColor: '#2563eb'
      });
    }
  });
};

// Set Default Reset Password Config Modal (Admin)
window.openDefaultPasswordConfigModal = function() {
  const currentDefault = localStorage.getItem('slts_default_reset_pass') || '123456';

  Swal.fire({
    title: 'ตั้งค่ารหัสผ่านตั้งต้นของระบบ',
    text: 'รหัสผ่านนี้จะถูกใช้เป็นค่าเริ่มต้นเมื่อ Admin กดยืนยันรีเซ็ตรหัสผ่านให้แก่ผู้ใช้งาน',
    input: 'text',
    inputValue: currentDefault,
    inputPlaceholder: 'เช่น 123456',
    showCloseButton: true,
    allowOutsideClick: false,
    showCancelButton: true,
    confirmButtonText: 'บันทึกค่า',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    inputValidator: (val) => {
      if (!val || !val.trim()) {
        return 'กรุณาระบุรหัสผ่านตั้งต้น';
      }
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const newVal = res.value.trim();
      localStorage.setItem('slts_default_reset_pass', newVal);
      if (elements.currentDefaultResetPassText) {
        elements.currentDefaultResetPassText.textContent = newVal;
      }
      Swal.fire('บันทึกสำเร็จ', `รหัสผ่านตั้งต้นถูกเปลี่ยนเป็น "${newVal}" เรียบร้อยแล้ว`, 'success');
    }
  });
};

window.deleteUser = function(username) {
  if (!state.currentUser || state.currentUser.role !== 'admin') return;

  if (username.toLowerCase() === 'admin') {
    Swal.fire('ไม่สามารถลบได้', 'ไม่สามารถลบผู้ดูแลระบบหลัก (admin) ได้', 'warning');
    return;
  }

  Swal.fire({
    title: `ยืนยันการลบผู้ใช้ "${username}"?`,
    text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนบัญชีนี้ได้ และจะถูกลบออกจาก Google Sheet',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ลบผู้ใช้',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626'
  }).then((res) => {
    if (res.isConfirmed) {
      let users = JSON.parse(localStorage.getItem('slts_users') || '[]');
      users = users.filter(u => u.username !== username);
      localStorage.setItem('slts_users', JSON.stringify(users));
      renderUserList();

      // ซิงค์การลบไปยัง Google Sheet (Tab: users)
      syncUserToGoogleSheet('delete_user', { username: username });

      Swal.fire('ลบสำเร็จ', `ลบผู้ใช้ "${username}" ออกจากระบบและ Google Sheet เรียบร้อยแล้ว`, 'success');
    }
  });
};

// =========================================================================
// 3. การสลับหน้า Tab (Navigation System)
// =========================================================================

window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('hidden');
    pane.classList.remove('active');
  });

  if (tabName === 'form') {
    closeCameraModal();
    if (elements.tabBtnForm) elements.tabBtnForm.classList.add('active');
    if (elements.tabContentForm) {
      elements.tabContentForm.classList.remove('hidden');
      elements.tabContentForm.classList.add('active');
    }
  } else if (tabName === 'camera') {
    if (elements.tabBtnCamera) elements.tabBtnCamera.classList.add('active');
    openCameraModal();
  } else if (tabName === 'table') {
    closeCameraModal();
    if (elements.tabBtnTable) elements.tabBtnTable.classList.add('active');
    if (elements.tabContentTable) {
      elements.tabContentTable.classList.remove('hidden');
      elements.tabContentTable.classList.add('active');
    }
    // โหลดข้อมูลแบบ Smart Cache 1 นาที (ดึงข้อมูลรอในเบื้องหลังทันที)
    loadGoogleSheetData(false);

    // บนหน้าจอ Desktop (> 768px): แสดง Pop Up ค้นหาข้อมูลเจาะจงทันทีเมื่อเข้าหน้าตารางทุกครั้ง
    if (window.innerWidth > 768) {
      setTimeout(() => {
        openTargetSearchModal();
      }, 250);
    }
  } else if (tabName === 'map') {
    if (window.innerWidth <= 768) return;

    // ตรวจสอบการเข้าสู่ระบบก่อนเข้าใช้งานแผนที่และหมุด
    if (!state.currentUser) {
      Swal.fire({
        icon: 'warning',
        title: 'จำเป็นต้องเข้าสู่ระบบ',
        text: 'ระบบ "แผนที่และหมุด" สงวนสิทธิ์สำหรับเจ้าหน้าที่ผู้ใช้งานที่เข้าสู่ระบบแล้วเท่านั้น',
        confirmButtonText: '<i class="fa-solid fa-right-to-bracket mr-1"></i> เข้าสู่ระบบทันที',
        showCancelButton: true,
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#6b7280',
        customClass: { popup: 'rounded-2xl' }
      }).then((result) => {
        if (result.isConfirmed) {
          openLoginModal();
        }
      });
      return;
    }

    closeCameraModal();
    if (elements.tabBtnMap) elements.tabBtnMap.classList.add('active');
    if (elements.tabContentMap) {
      elements.tabContentMap.classList.remove('hidden');
      elements.tabContentMap.classList.add('active');
    }
    // ดึงข้อมูลประวัติรอในเบื้องหลัง
    loadGoogleSheetData(false);

    // หากยังไม่ได้ระบุพื้นที่ หรือเข้าครั้งแรก ให้แสดง Pop Up เลือกพื้นที่ทันที
    if (!state.currentMapFilter) {
      setTimeout(() => {
        openMapAreaSelectorModal();
      }, 200);
    } else {
      setTimeout(() => {
        if (state.interactiveLeafletMap) {
          state.interactiveLeafletMap.invalidateSize();
        }
      }, 150);
    }
  } else if (tabName === 'users') {
    closeCameraModal();
    if (elements.tabBtnUsers) elements.tabBtnUsers.classList.add('active');
    if (elements.tabContentUsers) {
      elements.tabContentUsers.classList.remove('hidden');
      elements.tabContentUsers.classList.add('active');
    }
    renderUserList();
  }
};

function initResponsiveUI() {
  const handleResize = () => {
    updateAuthUI();
  };
  window.addEventListener('resize', handleResize);
  handleResize();
}



// =========================================================================
// 4. ตารางประวัติการส่งหมาย DataTables (Smart Cache 1 นาที ใน LocalStorage)
// =========================================================================

/**
 * ดึงข้อมูล Google Sheet ด้วยระบบ Smart Cache 1 นาที
 * @param {boolean} forceRefresh - บังคับดึงข้อมูลสดจาก Google Sheet หรือไม่
 */
window.loadGoogleSheetData = function(forceRefresh = false) {
  const cachedDataStr = localStorage.getItem(CACHE_KEY_SHEET_DATA);
  const lastFetchTime = Number(localStorage.getItem(CACHE_KEY_SHEET_TIME) || 0);
  const now = Date.now();
  const timeElapsed = now - lastFetchTime;
  const isCacheValid = cachedDataStr && timeElapsed < CACHE_TTL_MS;

  // 1. ถ้ามี Cache และยังไม่หมดอายุ (ยังไม่ถึง 1 นาที) และไม่ได้กดบังคับรีเฟรช -> โหลดจาก localStorage ทันที!
  if (!forceRefresh && isCacheValid) {
    try {
      const cachedRows = JSON.parse(cachedDataStr);
      const timeStr = new Date(lastFetchTime).toLocaleTimeString('th-TH');
      updateCacheBadgeUI(true, timeStr);
      renderDataTable(cachedRows);
      return;
    } catch (e) {
      console.warn('Cache parse error, falling back to network fetch:', e);
    }
  }

  // 2. ถ้าไม่มี Cache, Cache หมดอายุ (เกิน 1 นาที), หรือผู้ใช้กดปุ่มรีเฟรช -> โหลดสดจาก Google Sheet
  showCustomLoading('กำลังดึงข้อมูลประวัติการส่งหมาย...', 'กำลังเชื่อมต่อ Google Sheet');

  const csvFetchUrl = `${state.googleSheetCsvUrl}&_t=${now}`;

  Papa.parse(csvFetchUrl, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      hideCustomLoading();
      const rows = results.data || [];
      
      // บันทึกลง localStorage
      try {
        localStorage.setItem(CACHE_KEY_SHEET_DATA, JSON.stringify(rows));
        localStorage.setItem(CACHE_KEY_SHEET_TIME, String(Date.now()));
      } catch (saveErr) {
        console.warn('Could not save to localStorage:', saveErr);
      }

      const timeStr = new Date().toLocaleTimeString('th-TH');
      updateCacheBadgeUI(false, timeStr);
      renderDataTable(rows);
    },
    error: function(err) {
      console.error('CSV fetch error:', err);
      hideCustomLoading();

      // หากดึงสดล้มเหลว แต่มีแคชเดิม ให้ใช้แคชเดิมแทน
      if (cachedDataStr) {
        try {
          const cachedRows = JSON.parse(cachedDataStr);
          renderDataTable(cachedRows);
          Swal.fire({
            icon: 'info',
            title: 'แสดงข้อมูลจากแคชในเครื่อง',
            text: 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ ระบบจึงแสดงข้อมูลล่าสุดที่บันทึกไว้',
            timer: 2000,
            showConfirmButton: false
          });
          return;
        } catch (e) {}
      }

      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถดึงข้อมูลจาก Google Sheet ได้โดยตรง',
        html: `
          <p class="text-sm text-gray-600 mb-2">โปรดตรวจสอบว่า Google Sheet ได้ตั้งค่าสิทธิ์ให้ "ทุกคนที่มีลิงก์ดูได้" แล้วหรือยัง</p>
          <a href="https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo/edit?usp=sharing" target="_blank" class="text-blue-600 underline font-semibold text-sm">คลิกเปิดดูใน Google Sheet</a>
        `,
        confirmButtonColor: '#2563eb'
      });
    }
  });
};

function updateCacheBadgeUI(isFromCache, timeStr) {
  if (!elements.cacheStatusBadge) return;
  if (isFromCache) {
    elements.cacheStatusBadge.className = 'text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200';
    elements.cacheStatusBadge.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-1"></i>แคช (${timeStr})`;
  } else {
    elements.cacheStatusBadge.className = 'text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200';
    elements.cacheStatusBadge.innerHTML = `<i class="fa-solid fa-bolt mr-1"></i>ข้อมูลสด (${timeStr})`;
  }
}

/**
 * บีบอัดไฟล์ภาพให้มีความคมชัดสูงสุด และปรับขนาดไฟล์ให้อยู่ระหว่าง 300KB - 800KB (ไม่เกิน 1MB)
 * เพื่อให้อัปโหลดขึ้น Google Drive ได้เร็วที่สุด โดยยังคงความคมชัดของภาพ ลายน้ำ และข้อความเอกสาร
 */
/**
 * บีบอัดและปรับขนาดรูปภาพให้ส่งข้อมูลขึ้น Google Drive ได้เร็วที่สุด (Fast Optimal Compression)
 * ปรับความละเอียดให้เหมาะสมที่ 1280px และคุณภาพ 0.78
 * ผลลัพธ์: ขนาดไฟล์เหลือเพียง 120KB - 220KB (ลดเวลาอัปโหลดลง 70%) ในขณะที่ตัวอักษรและลายน้ำคมชัด 100%
 */
async function compressImageToMax1MB(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // ความละเอียดสูงสุด 1280px (คมชัดระดับ HD สำหรับเอกสารหมายศาล และส่งผ่าน 4G/5G ได้ไวที่สุด)
      const MAX_DIMENSION = 1280;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(img, 0, 0, width, height);

      // คุณภาพ 0.78 ให้ความคมชัดสูงและขนาดไฟล์เล็กกะทัดรัด (~150KB)
      let quality = 0.78;
      let resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      let currentBytes = Math.round((resultDataUrl.length - resultDataUrl.indexOf(',') - 1) * 0.75);

      if (currentBytes > 1024 * 1024) {
        quality = 0.65;
        resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(resultDataUrl);
    };
    img.src = dataUrl;
  });
}

/**
 * อัปโหลดข้อมูลพร้อมแสดง Progress Bar และตัวเลข % ความคืบหน้า (ปิดไม่ได้จนกว่าจะเสร็จสิ้น)
 * ใช้ fetch กับ text/plain เพื่อป้องกันปัญหา CORS Preflight กับ Google Apps Script
 */
async function uploadWithProgressBar(payload, title = 'กำลังอัปโหลดรูปภาพขึ้น Google Drive...') {
  Swal.fire({
    title: title,
    html: `
      <div class="space-y-3.5 my-3 text-left">
        <div class="flex justify-between items-center text-xs font-bold text-gray-700">
          <span>ความคืบหน้าการนำเข้าข้อมูล</span>
          <span id="uploadPercentTxt" class="font-mono text-sm font-extrabold text-blue-600">15%</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-4 overflow-hidden shadow-inner p-0.5 border border-gray-300">
          <div id="uploadProgressBar" class="bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-700 h-full rounded-full transition-all duration-300 ease-out" style="width: 15%"></div>
        </div>
        <p class="text-[11px] text-gray-500 text-center"><i class="fa-solid fa-lock mr-1"></i>กำลังประมวลผลและนำส่งข้อมูล กรุณารอสักครู่ (หน้าต่างนี้จะปิดไม่ได้จนกว่าจะเสร็จสิ้น)</p>
      </div>
    `,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    showCancelButton: false,
    showCloseButton: false
  });

  // อัปเดต Progress Bar อย่างต่อเนื่องขณะรอการตอบกลับ
  let currentPercent = 15;
  const progressInterval = setInterval(() => {
    if (currentPercent < 90) {
      currentPercent += Math.floor(Math.random() * 8) + 4;
      if (currentPercent > 90) currentPercent = 90;
      const bar = document.getElementById('uploadProgressBar');
      const txt = document.getElementById('uploadPercentTxt');
      if (bar) bar.style.width = currentPercent + '%';
      if (txt) txt.textContent = currentPercent + '%';
    }
  }, 250);

  try {
    const response = await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    clearInterval(progressInterval);

    const bar = document.getElementById('uploadProgressBar');
    const txt = document.getElementById('uploadPercentTxt');
    if (bar) bar.style.width = '100%';
    if (txt) txt.textContent = '100%';

    const rawText = await response.text();
    let resJson;
    try {
      resJson = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('GAS response raw text:', rawText);
      if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
        if (rawText.includes('accounts.google.com') || rawText.includes('Sign in') || rawText.includes('เข้าสู่ระบบ')) {
          throw new Error('Google Apps Script แจ้งเตือนสิทธิ์การเข้าถึง: โปรดตรวจสอบการ Deploy Web App ใน Google Apps Script ว่าได้ตั้งค่า "ผู้มีสิทธิ์เข้าถึง (Who has access)" เป็น "ทุกคน (Anyone)" หรือยัง');
        }
        if (rawText.includes('Service invoked too many times') || rawText.includes('Quota')) {
          throw new Error('Google Apps Script ใช้งานเกินโควตาประจำวันของ Google');
        }
        throw new Error('Google Apps Script ส่งข้อมูลกลับมาเป็นหน้าเว็บ HTML (สาเหตุส่วนใหญ่เกิดจากการตั้งค่า Deploy Web App ใน Apps Script ที่ยังไม่ได้เลือก Anyone หรือ Web App URL ไม่ถูกต้อง)');
      }
      throw new Error('ไม่สามารถแปลงข้อมูลตอบกลับจาก Google Apps Script ได้ (Invalid JSON): ' + parseErr.message);
    }

    if (resJson && resJson.status === 'error') {
      throw new Error(resJson.message || 'เกิดข้อผิดพลาดจาก Google Apps Script');
    }

    return resJson;

  } catch (err) {
    clearInterval(progressInterval);
    console.error('uploadWithProgressBar fetch error:', err);
    throw err;
  }
}

/**
 * แปลงรูปแบบวันเดือนปีให้อยู่ในรูปแบบไทยเสมอ เช่น "25 ส.ค. 2569 13:52:23" หรือ "25 ส.ค. 2569"
 * วัน เดือน(ตัวอักษรย่อของไทย) ปี(พ.ศ.)
 */
function formatThaiDateDisplay(dateInput) {
  if (!dateInput) return '-';
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  const str = String(dateInput).trim();
  // หากมีตัวย่อเดือนไทยอยู่แล้ว
  if (thaiMonths.some(m => str.includes(m))) {
    return str;
  }

  // รูปแบบ DD/MM/YYYY หรือ DD/MM/YYYY HH:mm:ss
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const monthIdx = parseInt(slashMatch[2], 10) - 1;
    let year = parseInt(slashMatch[3], 10);
    if (year < 2400) year += 543;
    const timePart = slashMatch[4] ? ' ' + slashMatch[4] : '';
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${day} ${thaiMonths[monthIdx]} ${year}${timePart}`;
    }
  }

  // รูปแบบ YYYY-MM-DD หรือ YYYY-MM-DD HH:mm:ss
  const dashMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/);
  if (dashMatch) {
    let year = parseInt(dashMatch[1], 10);
    if (year < 2400) year += 543;
    const monthIdx = parseInt(dashMatch[2], 10) - 1;
    const day = parseInt(dashMatch[3], 10);
    const timePart = dashMatch[4] ? ' ' + dashMatch[4] : '';
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${day} ${thaiMonths[monthIdx]} ${year}${timePart}`;
    }
  }

  // แปลงจาก Date Object
  const d = new Date(dateInput);
  if (!isNaN(d.getTime())) {
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + (d.getFullYear() < 2400 ? 543 : 0);
    const pad = (n) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return `${day} ${month} ${year} ${time}`;
  }

  return str;
}

// -------------------------------------------------------------------------
// Helper ตรวจสอบและค้นหาจังหวัดของข้อมูลรายการ
// -------------------------------------------------------------------------
function findProvinceByDistrict(districtName) {
  if (!districtName || typeof THAILAND_ADDRESS_DATA === 'undefined') return '';
  const dClean = districtName.trim().replace(/^อ\./, '').replace(/^อำเภอ/, '').replace(/^เขต/, '');
  for (const [prov, distObj] of Object.entries(THAILAND_ADDRESS_DATA)) {
    for (const d of Object.keys(distObj)) {
      if (d === districtName || d.replace(/^เขต/, '') === dClean || d.replace(/^อำเภอ/, '') === dClean) {
        return prov;
      }
    }
  }
  return '';
}

function getRowProvince(row) {
  let p = row['จังหวัด'] || row['province'] || '';
  if (p && typeof p === 'string' && p.trim()) {
    return p.trim().replace(/^จ\./, '');
  }
  const dist = (row['อำเภอ'] || row['district'] || '').trim();
  if (dist) {
    const matched = findProvinceByDistrict(dist);
    if (matched) return matched;
  }
  const loc = (row['ที่ตั้งส่งหมาย (เต็ม)'] || row['ที่ตั้งส่งหมาย'] || '').trim();
  if (loc && typeof THAILAND_PROVINCES !== 'undefined') {
    for (const prov of THAILAND_PROVINCES) {
      if (loc.includes(prov.name)) return prov.name;
    }
  }
  return state.selectedProvince || 'อุดรธานี';
}

/**
 * นำเงื่อนไขการค้นหาแบบเจาะจงไปกรองข้อมูลและแสดงผลใน DataTables
 */
window.applyTargetedFilter = function(criteria) {
  state.currentFilterCriteria = criteria;
  const rows = state.allSheetRows || [];

  if (criteria.type === 'province' || criteria.type === 'all') {
    if (criteria.province) {
      state.selectedProvince = criteria.province;
      localStorage.setItem('slts_selected_province', criteria.province);
      if (elements.floatingProvinceName) {
        elements.floatingProvinceName.textContent = `จ.${criteria.province}`;
      }
    }
  }

  renderDataTable(rows, criteria);
};

/**
 * เปิด Pop Up ค้นหาข้อมูลเจาะจงในหน้าตารางประวัติส่งหมาย (เฉพาะ Desktop > 768px)
 */
window.openTargetSearchModal = function() {
  if (window.innerWidth <= 768) return;

  const currentProvince = state.selectedProvince || 'อุดรธานี';
  const provinces = (typeof THAILAND_PROVINCES !== 'undefined') ? THAILAND_PROVINCES : [{ name: currentProvince }];
  const districts = getDistrictsByProvince(currentProvince);
  const subdistricts = districts.length > 0 ? getSubdistrictsByDistrict(currentProvince, districts[0]) : [];

  const provOptionsHtml = provinces.map(p => `<option value="${p.name}" ${p.name === currentProvince ? 'selected' : ''}>${p.name}</option>`).join('');
  const distOptionsHtml = districts.map(d => `<option value="${d}">${d}</option>`).join('');
  const subOptionsHtml = subdistricts.map(s => `<option value="${s}">${s}</option>`).join('');

  const instructions = {
    all: "ตัวเลือก <b>'ทั้งหมด'</b> จะดึงข้อมูลประวัติการส่งหมายทุกรายการของจังหวัดที่เลือกมาแสดงผลทั้งหมดในตาราง เพื่อให้สามารถตรวจดูภาพรวมของจังหวัดได้อย่างครบถ้วน",
    case: "ตัวเลือก <b>'เลขคดี'</b> ให้กรอกเลขคดีที่ต้องการค้นหา เช่น <b>'ต1641/2569'</b>, <b>'ผบ ส197/2569'</b> หรือ <b>'197'</b> ระบบจะค้นหาและแสดงเฉพาะรายการส่งหมายของเลขคดีดังกล่าว",
    province: "ตัวเลือก <b>'จังหวัด'</b> ให้เลือกจังหวัดที่ต้องการค้นหาประวัติการส่งหมาย ระบบจะบันทึกการตั้งค่าจังหวัดและกรองเฉพาะข้อมูลของจังหวัดที่เลือกมาแสดงผล",
    district: "ตัวเลือก <b>'อำเภอ'</b> ให้เลือกจังหวัดและอำเภอเป้าหมาย ระบบจะกรองประวัติการส่งหมายเฉพาะภายในเขตอำเภอที่ท่านระบุ",
    subdistrict: "ตัวเลือก <b>'ตำบล'</b> ให้เลือกจังหวัด อำเภอ และตำบลเป้าหมาย เพื่อกรองประวัติการส่งหมายเฉพาะพื้นที่ตำบลนั้นอย่างเจาะจง",
    location: "ตัวเลือก <b>'ที่ตั้งหมาย'</b> ให้เลือกประเภทสถานที่และระบุข้อมูลสถานที่ เช่น บ้านเลขที่, ชื่อ อบต./เทศบาล หรือชื่อสถานที่ เพื่อค้นหารายการส่งหมายเฉพาะสถานที่นั้น (ต้องระบุข้อความจึงจะกดตกลงได้)",
    coords: "ตัวเลือก <b>'พิกัดหมาย'</b> ให้กรอกตัวเลขพิกัด ละติจูด (Latitude) และ ลองจิจูด (Longitude) โดยใส่เฉพาะตัวเลขและจุดทศนิยมเท่านั้น เช่น <b>17.3816</b> และ <b>102.7578</b> เพื่อค้นหาตำแหน่งส่งหมายที่ตรงกับพิกัด"
  };

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-base sm:text-lg font-bold text-gray-900"><i class="fa-solid fa-magnifying-glass-location text-blue-600 text-xl"></i> ค้นหาข้อมูลประวัติส่งหมายแบบเจาะจง</div>',
    html: `
      <div class="text-left space-y-4 text-xs">
        
        <!-- 1. เลือกหมวดหมู่การค้นหา (Search Category) -->
        <div>
          <label class="block font-bold text-gray-800 mb-1.5 flex items-center justify-between">
            <span class="flex items-center gap-1.5"><i class="fa-solid fa-filter text-blue-600"></i> เลือกหมวดหมู่ที่ต้องการค้นหาเจาะจง *</span>
            <span class="text-[11px] text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">7 หมวดหมู่</span>
          </label>
          <select id="ts_categorySelect" class="w-full bg-white border-2 border-blue-500 rounded-xl px-3.5 py-2.5 text-sm font-bold text-gray-800 shadow-sm focus:ring-2 focus:ring-blue-200 cursor-pointer">
            <option value="all" selected>🌟 ทั้งหมด (แสดงภาพรวมทั้งหมดในจังหวัด)</option>
            <option value="case">⚖️ เลขคดี (กรองเฉพาะเลขคดี)</option>
            <option value="province">🏛️ จังหวัด (กรองเฉพาะจังหวัด)</option>
            <option value="district">📍 อำเภอ (กรองตามจังหวัดและอำเภอ)</option>
            <option value="subdistrict">🏠 ตำบล (กรองตามจังหวัด อำเภอ และตำบล)</option>
            <option value="location">🏢 ที่ตั้งหมาย (ประเภทสถานที่ / บ้านเลขที่ / อบต.)</option>
            <option value="coords">🛰️ พิกัดหมาย (ละติจูด และ ลองจิจูด)</option>
          </select>
        </div>

        <!-- กล่องคำอธิบายขั้นตอนการปฏิบัติอย่างละเอียด -->
        <div id="ts_instructionBox" class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 leading-relaxed shadow-sm transition">
          <div class="font-bold flex items-center gap-1.5 mb-1 text-blue-800">
            <i class="fa-solid fa-circle-info text-blue-600"></i>
            <span>คำอธิบายขั้นตอนการปฏิบัติ:</span>
          </div>
          <p id="ts_instructionText" class="text-gray-700 leading-relaxed">
            ${instructions.all}
          </p>
        </div>

        <!-- 2. กล่องฟิลด์ค้นหาแบบ Dynamic ตามหมวดหมู่ที่เลือก -->
        <div class="bg-gray-50/90 border border-gray-200 rounded-xl p-3.5 space-y-3">
          
          <!-- Case 1: ทั้งหมด (All) -->
          <div id="ts_field_all" class="space-y-1.5">
            <label class="block font-semibold text-gray-700">จังหวัดเป้าหมายปัจจุบัน:</label>
            <div class="flex items-center gap-2">
              <span class="flex-1 bg-white border border-gray-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-bold text-gray-800" id="ts_all_provText">จังหวัด${currentProvince}</span>
              <button type="button" id="ts_btnChangeAllProv" class="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition">เปลี่ยนจังหวัด</button>
            </div>
            <div id="ts_all_provSelectWrapper" class="hidden mt-2">
              <label class="block text-[11px] font-semibold text-gray-600 mb-1">เลือกจังหวัดใหม่:</label>
              <select id="ts_all_provSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
                ${provOptionsHtml}
              </select>
            </div>
          </div>

          <!-- Case 2: เลขคดี (Case Number) -->
          <div id="ts_field_case" class="hidden space-y-1.5">
            <label class="block font-semibold text-gray-700">พิมพ์เลขคดีที่ต้องการค้นหา (เช่น ต1641/2569, ผบ ส197/2569 หรือ 197) *</label>
            <div class="relative">
              <input type="text" id="ts_caseInput" placeholder="พิมพ์เลขคดี เช่น ต1641/2569, ผบ ส197/2569, 197" class="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
            </div>
          </div>

          <!-- Case 3: จังหวัด (Province) -->
          <div id="ts_field_province" class="hidden space-y-2">
            <label class="block font-semibold text-gray-700">พิมพ์ค้นหาหรือเลือกจังหวัด (77 จังหวัด) *</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <i class="fa-solid fa-magnifying-glass text-xs"></i>
              </div>
              <input type="text" id="ts_provSearchInput" placeholder="พิมพ์ชื่อจังหวัดเพื่อค้นหา เช่น เชียงใหม่, อุดรธานี, กรุงเทพ..." class="w-full bg-white border border-gray-300 rounded-xl pl-8 pr-3 py-2 text-xs sm:text-sm font-semibold text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" autocomplete="off" value="${currentProvince}">
            </div>
            <select id="ts_provinceSelect" size="5" class="w-full bg-white border border-gray-300 rounded-xl p-2 text-xs sm:text-sm font-medium text-gray-800 focus:border-blue-500 overflow-y-auto cursor-pointer">
              ${provOptionsHtml}
            </select>
          </div>

          <!-- Case 4: อำเภอ (District) -->
          <div id="ts_field_district" class="hidden space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-semibold text-gray-700 mb-1">พิมพ์/เลือกจังหวัด *</label>
                <input type="text" id="ts_dist_provSearch" placeholder="พิมพ์ค้นหาจังหวัด..." class="w-full mb-1 bg-white border border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-800" autocomplete="off" value="${currentProvince}">
                <select id="ts_dist_provSelect" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800">
                  ${provOptionsHtml}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-gray-700 mb-1">อำเภอเป้าหมาย *</label>
                <div class="h-[27px] hidden sm:block"></div>
                <select id="ts_districtSelect" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800">
                  ${distOptionsHtml}
                </select>
              </div>
            </div>
          </div>

          <!-- Case 5: ตำบล (Subdistrict) -->
          <div id="ts_field_subdistrict" class="hidden space-y-2">
            <div>
              <label class="block font-semibold text-gray-700 mb-1">พิมพ์/เลือกจังหวัด *</label>
              <input type="text" id="ts_sub_provSearch" placeholder="พิมพ์ค้นหาจังหวัด..." class="w-full mb-1 bg-white border border-gray-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-gray-800" autocomplete="off" value="${currentProvince}">
              <select id="ts_sub_provSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
                ${provOptionsHtml}
              </select>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-semibold text-gray-700 mb-1">อำเภอ *</label>
                <select id="ts_sub_distSelect" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800">
                  ${distOptionsHtml}
                </select>
              </div>
              <div>
                <label class="block font-semibold text-gray-700 mb-1">ตำบลเป้าหมาย *</label>
                <select id="ts_subdistrictSelect" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800">
                  ${subOptionsHtml}
                </select>
              </div>
            </div>
          </div>

          <!-- Case 6: ที่ตั้งหมาย (Location Type) -->
          <div id="ts_field_location" class="hidden space-y-2.5">
            <div>
              <label class="block font-semibold text-gray-700 mb-1">ประเภทสถานที่ *</label>
              <select id="ts_locTypeSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
                <option value="หมายบ้าน" selected>หมายบ้าน (บ้านเลขที่ / หมู่)</option>
                <option value="ที่ทำการปกครองส่วนท้องถิ่น">ที่ทำการปกครองส่วนท้องถิ่น (อบต. / เทศบาล)</option>
                <option value="อื่นๆ">อื่นๆ (ชื่อสถานที่เฉพาะ)</option>
              </select>
            </div>

            <!-- บ้านเลขที่ / หมู่ -->
            <div id="ts_loc_houseGroup" class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[11px] font-semibold text-gray-600 mb-0.5">บ้านเลขที่ *</label>
                <input type="text" id="ts_loc_houseNo" placeholder="เช่น 2/18 หรือ 154/2" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800">
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-gray-600 mb-0.5">หมู่ที่ (ตัวเลข)</label>
                <input type="text" id="ts_loc_moo" placeholder="เช่น 3 (ไม่บังคับ)" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800">
              </div>
            </div>

            <!-- อบต. / เทศบาล -->
            <div id="ts_loc_adminGroup" class="hidden">
              <label class="block text-[11px] font-semibold text-gray-600 mb-0.5">ชื่อ อบต. / เทศบาล *</label>
              <input type="text" id="ts_loc_adminName" placeholder="เช่น อบต.กุดสระ หรือ เทศบาลนครอุดรธานี" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800">
            </div>

            <!-- อื่นๆ -->
            <div id="ts_loc_otherGroup" class="hidden">
              <label class="block text-[11px] font-semibold text-gray-600 mb-0.5">ชื่อสถานที่ส่งหมาย *</label>
              <input type="text" id="ts_loc_otherName" placeholder="เช่น โรงเรียนบ้านนาดี หรือ วัดโพธิสมภรณ์" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800">
            </div>
          </div>

          <!-- Case 7: พิกัดหมาย (Coordinates) -->
          <div id="ts_field_coords" class="hidden space-y-2">
            <p class="text-[11px] text-gray-500 font-medium">กรอกตัวเลขละติจูด และ ลองจิจูด (ตัวเลขและจุดทศนิยมเท่านั้น เช่น 17.3816 และ 102.7578)</p>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block font-semibold text-gray-700 mb-1">ละติจูด (Latitude) *</label>
                <input type="text" id="ts_latInput" placeholder="เช่น 17.3816" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-800 text-center">
              </div>
              <div>
                <label class="block font-semibold text-gray-700 mb-1">ลองจิจูด (Longitude) *</label>
                <input type="text" id="ts_lngInput" placeholder="เช่น 102.7578" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-800 text-center">
              </div>
            </div>
          </div>

        </div>

      </div>
    `,
    width: '620px',
    customClass: {
      popup: 'rounded-2xl p-4 sm:p-5'
    },
    showCloseButton: true,
    showCancelButton: true,
    allowOutsideClick: false,
    confirmButtonText: '<i class="fa-solid fa-magnifying-glass mr-1.5"></i> ตกลง (ค้นหาข้อมูล)',
    cancelButtonText: 'ปิด',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
    didOpen: () => {
      const categorySelect = document.getElementById('ts_categorySelect');
      const instructionText = document.getElementById('ts_instructionText');

      const fieldAll = document.getElementById('ts_field_all');
      const fieldCase = document.getElementById('ts_field_case');
      const fieldProvince = document.getElementById('ts_field_province');
      const fieldDistrict = document.getElementById('ts_field_district');
      const fieldSubdistrict = document.getElementById('ts_field_subdistrict');
      const fieldLocation = document.getElementById('ts_field_location');
      const fieldCoords = document.getElementById('ts_field_coords');

      const allFields = [fieldAll, fieldCase, fieldProvince, fieldDistrict, fieldSubdistrict, fieldLocation, fieldCoords];

      categorySelect.addEventListener('change', (e) => {
        const cat = e.target.value;
        allFields.forEach(f => f && f.classList.add('hidden'));

        if (cat === 'all' && fieldAll) fieldAll.classList.remove('hidden');
        else if (cat === 'case' && fieldCase) {
          fieldCase.classList.remove('hidden');
          const inp = document.getElementById('ts_caseInput');
          if (inp) inp.focus();
        }
        else if (cat === 'province' && fieldProvince) {
          fieldProvince.classList.remove('hidden');
          const pInp = document.getElementById('ts_provSearchInput');
          if (pInp) { pInp.focus(); pInp.select(); }
        }
        else if (cat === 'district' && fieldDistrict) fieldDistrict.classList.remove('hidden');
        else if (cat === 'subdistrict' && fieldSubdistrict) fieldSubdistrict.classList.remove('hidden');
        else if (cat === 'location' && fieldLocation) fieldLocation.classList.remove('hidden');
        else if (cat === 'coords' && fieldCoords) {
          fieldCoords.classList.remove('hidden');
          const latInp = document.getElementById('ts_latInput');
          if (latInp) latInp.focus();
        }

        if (instructionText && instructions[cat]) {
          instructionText.innerHTML = instructions[cat];
        }
      });

      // 1. หมวด All: ปุ่มเปลี่ยนจังหวัด
      const btnChangeAllProv = document.getElementById('ts_btnChangeAllProv');
      const allProvSelectWrapper = document.getElementById('ts_all_provSelectWrapper');
      const allProvSelect = document.getElementById('ts_all_provSelect');
      const allProvText = document.getElementById('ts_all_provText');
      if (btnChangeAllProv && allProvSelectWrapper) {
        btnChangeAllProv.addEventListener('click', () => {
          allProvSelectWrapper.classList.toggle('hidden');
        });
      }
      if (allProvSelect && allProvText) {
        allProvSelect.addEventListener('change', (e) => {
          allProvText.textContent = `จังหวัด${e.target.value}`;
        });
      }

      // 3. หมวด Province: ค้นหาจังหวัดแบบ Live Filter As-You-Type
      const provSearchInput = document.getElementById('ts_provSearchInput');
      const provinceSelect = document.getElementById('ts_provinceSelect');
      if (provSearchInput && provinceSelect) {
        provSearchInput.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          const matched = provinces.filter(p => p.name.toLowerCase().includes(q));
          if (matched.length > 0) {
            provinceSelect.innerHTML = matched.map((p, idx) => `<option value="${p.name}" ${idx === 0 ? 'selected' : ''}>${p.name}</option>`).join('');
          } else {
            provinceSelect.innerHTML = `<option value="" disabled>-- ไม่พบจังหวัดที่ค้นหา --</option>`;
          }
        });
        provinceSelect.addEventListener('change', (e) => {
          provSearchInput.value = e.target.value;
        });
      }

      // 4. หมวด District: ค้นหาและเปลี่ยนจังหวัด
      const distProvSearch = document.getElementById('ts_dist_provSearch');
      const distProvSelect = document.getElementById('ts_dist_provSelect');
      const districtSelect = document.getElementById('ts_districtSelect');

      if (distProvSearch && distProvSelect) {
        distProvSearch.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          const matched = provinces.filter(p => p.name.toLowerCase().includes(q));
          if (matched.length > 0) {
            distProvSelect.innerHTML = matched.map((p, idx) => `<option value="${p.name}" ${idx === 0 ? 'selected' : ''}>${p.name}</option>`).join('');
            distProvSelect.dispatchEvent(new Event('change'));
          }
        });
      }

      if (distProvSelect && districtSelect) {
        distProvSelect.addEventListener('change', (e) => {
          const prov = e.target.value;
          if (distProvSearch) distProvSearch.value = prov;
          const dists = getDistrictsByProvince(prov);
          districtSelect.innerHTML = dists.map(d => `<option value="${d}">${d}</option>`).join('');
        });
      }

      // 5. หมวด Subdistrict: ค้นหาและเปลี่ยนจังหวัด และเมื่อเปลี่ยนอำเภอ
      const subProvSearch = document.getElementById('ts_sub_provSearch');
      const subProvSelect = document.getElementById('ts_sub_provSelect');
      const subDistSelect = document.getElementById('ts_sub_distSelect');
      const subdistrictSelect = document.getElementById('ts_subdistrictSelect');

      if (subProvSearch && subProvSelect) {
        subProvSearch.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          const matched = provinces.filter(p => p.name.toLowerCase().includes(q));
          if (matched.length > 0) {
            subProvSelect.innerHTML = matched.map((p, idx) => `<option value="${p.name}" ${idx === 0 ? 'selected' : ''}>${p.name}</option>`).join('');
            subProvSelect.dispatchEvent(new Event('change'));
          }
        });
      }

      if (subProvSelect && subDistSelect && subdistrictSelect) {
        subProvSelect.addEventListener('change', (e) => {
          const prov = e.target.value;
          if (subProvSearch) subProvSearch.value = prov;
          const dists = getDistrictsByProvince(prov);
          subDistSelect.innerHTML = dists.map(d => `<option value="${d}">${d}</option>`).join('');
          const firstDist = dists[0] || '';
          const subs = firstDist ? getSubdistrictsByDistrict(prov, firstDist) : [];
          subdistrictSelect.innerHTML = subs.map(s => `<option value="${s}">${s}</option>`).join('');
        });

        subDistSelect.addEventListener('change', (e) => {
          const prov = subProvSelect.value;
          const dist = e.target.value;
          const subs = getSubdistrictsByDistrict(prov, dist);
          subdistrictSelect.innerHTML = subs.map(s => `<option value="${s}">${s}</option>`).join('');
        });
      }

      // 6. หมวด Location Type: สลับฟิลด์ตามประเภทสถานที่
      const locTypeSelect = document.getElementById('ts_locTypeSelect');
      const locHouseGroup = document.getElementById('ts_loc_houseGroup');
      const locAdminGroup = document.getElementById('ts_loc_adminGroup');
      const locOtherGroup = document.getElementById('ts_loc_otherGroup');

      if (locTypeSelect) {
        locTypeSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val === 'หมายบ้าน') {
            if (locHouseGroup) locHouseGroup.classList.remove('hidden');
            if (locAdminGroup) locAdminGroup.classList.add('hidden');
            if (locOtherGroup) locOtherGroup.classList.add('hidden');
            const inp = document.getElementById('ts_loc_houseNo');
            if (inp) inp.focus();
          } else if (val === 'ที่ทำการปกครองส่วนท้องถิ่น') {
            if (locHouseGroup) locHouseGroup.classList.add('hidden');
            if (locAdminGroup) locAdminGroup.classList.remove('hidden');
            if (locOtherGroup) locOtherGroup.classList.add('hidden');
            const inp = document.getElementById('ts_loc_adminName');
            if (inp) inp.focus();
          } else if (val === 'อื่นๆ') {
            if (locHouseGroup) locHouseGroup.classList.add('hidden');
            if (locAdminGroup) locAdminGroup.classList.add('hidden');
            if (locOtherGroup) locOtherGroup.classList.remove('hidden');
            const inp = document.getElementById('ts_loc_otherName');
            if (inp) inp.focus();
          }
        });
      }

      // 7. หมวด Coordinates: Sanitize ให้กรอกเฉพาะตัวเลขและจุดทศนิยมเท่านั้น
      const latInp = document.getElementById('ts_latInput');
      const lngInp = document.getElementById('ts_lngInput');

      const sanitizeCoordInput = (el) => {
        if (!el) return;
        el.addEventListener('input', (e) => {
          let val = e.target.value.replace(/[^0-9.]/g, '');
          const parts = val.split('.');
          if (parts.length > 2) {
            val = parts[0] + '.' + parts.slice(1).join('');
          }
          e.target.value = val;
        });
      };

      sanitizeCoordInput(latInp);
      sanitizeCoordInput(lngInp);
    },
    preConfirm: () => {
      const cat = document.getElementById('ts_categorySelect').value;

      if (cat === 'all') {
        const allProvSelectWrapper = document.getElementById('ts_all_provSelectWrapper');
        let prov = currentProvince;
        if (allProvSelectWrapper && !allProvSelectWrapper.classList.contains('hidden')) {
          prov = document.getElementById('ts_all_provSelect').value;
        }
        return { type: 'all', province: prov };
      } else if (cat === 'case') {
        const caseNo = (document.getElementById('ts_caseInput')?.value || '').trim();
        if (!caseNo) {
          Swal.showValidationMessage('กรุณากรอกเลขคดีที่ต้องการค้นหา');
          return false;
        }
        return { type: 'case', caseNo };
      } else if (cat === 'province') {
        let prov = document.getElementById('ts_provinceSelect')?.value;
        const typedProv = (document.getElementById('ts_provSearchInput')?.value || '').trim();
        if (typedProv) {
          const exact = provinces.find(p => p.name === typedProv || p.name.toLowerCase() === typedProv.toLowerCase());
          if (exact) prov = exact.name;
          else {
            const partial = provinces.find(p => p.name.includes(typedProv));
            if (partial) prov = partial.name;
          }
        }
        if (!prov) {
          Swal.showValidationMessage('กรุณาเลือกหรือพิมพ์ชื่อจังหวัดที่ต้องการค้นหา');
          return false;
        }
        return { type: 'province', province: prov };
      } else if (cat === 'district') {
        const prov = document.getElementById('ts_dist_provSelect').value;
        const dist = document.getElementById('ts_districtSelect').value;
        if (!dist) {
          Swal.showValidationMessage('กรุณาเลือกอำเภอเป้าหมาย');
          return false;
        }
        return { type: 'district', province: prov, district: dist };
      } else if (cat === 'subdistrict') {
        const prov = document.getElementById('ts_sub_provSelect').value;
        const dist = document.getElementById('ts_sub_distSelect').value;
        const sub = document.getElementById('ts_subdistrictSelect').value;
        if (!sub) {
          Swal.showValidationMessage('กรุณาเลือกตำบลเป้าหมาย');
          return false;
        }
        return { type: 'subdistrict', province: prov, district: dist, subdistrict: sub };
      } else if (cat === 'location') {
        const locType = document.getElementById('ts_locTypeSelect').value;
        let query = '';
        if (locType === 'หมายบ้าน') {
          const houseNo = (document.getElementById('ts_loc_houseNo')?.value || '').trim();
          const moo = (document.getElementById('ts_loc_moo')?.value || '').trim();
          if (!houseNo) {
            Swal.showValidationMessage('กรุณากรอกบ้านเลขที่');
            return false;
          }
          query = houseNo + (moo ? ` ม.${moo}` : '');
        } else if (locType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
          const adminName = (document.getElementById('ts_loc_adminName')?.value || '').trim();
          if (!adminName) {
            Swal.showValidationMessage('กรุณากรอกชื่อ อบต. หรือ เทศบาล');
            return false;
          }
          query = adminName;
        } else if (locType === 'อื่นๆ') {
          const otherName = (document.getElementById('ts_loc_otherName')?.value || '').trim();
          if (!otherName) {
            Swal.showValidationMessage('กรุณากรอกชื่อสถานที่');
            return false;
          }
          query = otherName;
        }
        return { type: 'location', locationType: locType, query };
      } else if (cat === 'coords') {
        const latStr = (document.getElementById('ts_latInput')?.value || '').trim();
        const lngStr = (document.getElementById('ts_lngInput')?.value || '').trim();
        if (!latStr || !lngStr) {
          Swal.showValidationMessage('กรุณากรอกทั้งละติจูด (Latitude) และลองจิจูด (Longitude) ให้ครบถ้วน');
          return false;
        }
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isNaN(lat) || isNaN(lng) || lat <= 0 || lng <= 0) {
          Swal.showValidationMessage('กรุณากรอกพิกัดตัวเลขละติจูดและลองจิจูดให้ถูกต้อง');
          return false;
        }
        return { type: 'coords', lat, lng };
      }
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      applyTargetedFilter(res.value);
    }
  });
};

function renderDataTable(rows, filterCriteria = null) {
  state.allSheetRows = rows;
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const isDesktop = window.innerWidth > 768;

  // ดึงประวัติอักษรนำหน้าเลขคดีจากชีตมาอัปเดต autocomplete
  extractPrefixesFromRows(rows);

  // 1. ทำลายและล้าง DataTable เดิมอย่างหมดจดเพื่อป้องกันรายการซ้ำ
  if ($.fn.DataTable.isDataTable('#summonsDataTable')) {
    $('#summonsDataTable').DataTable().clear().destroy();
  }

  const tableBody = document.getElementById('dataTableBody');
  tableBody.innerHTML = '';

  // 2. กรองข้อมูลตามเงื่อนไขเจาะจง (Filter Criteria) หรือตามจังหวัดปัจจุบัน (Default)
  let filteredRows = rows;
  let filterBadgeHtml = '';

  const activeCriteria = filterCriteria || state.currentFilterCriteria;

  if (!activeCriteria || activeCriteria.type === 'all') {
    const currentProv = activeCriteria?.province || state.selectedProvince || 'อุดรธานี';
    filteredRows = rows.filter(row => {
      const prov = getRowProvince(row);
      row._resolvedProvince = prov;
      return prov === currentProv;
    });
    filterBadgeHtml = `📍 แสดง: จ.${currentProv} (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'case') {
    const searchCase = (activeCriteria.caseNo || '').trim().toLowerCase();
    filteredRows = rows.filter(row => {
      const caseNo = (row['เลขคดี'] || '').trim().toLowerCase();
      row._resolvedProvince = getRowProvince(row);
      return caseNo.includes(searchCase);
    });
    filterBadgeHtml = `⚖️ กรองเลขคดี: <b class="text-blue-800 font-bold">"${activeCriteria.caseNo}"</b> (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'province') {
    const provTarget = activeCriteria.province;
    filteredRows = rows.filter(row => {
      const prov = getRowProvince(row);
      row._resolvedProvince = prov;
      return prov === provTarget;
    });
    filterBadgeHtml = `🏛️ กรองจังหวัด: <b class="text-emerald-800 font-bold">จ.${provTarget}</b> (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'district') {
    const provTarget = activeCriteria.province;
    const distTarget = activeCriteria.district;
    filteredRows = rows.filter(row => {
      const prov = getRowProvince(row);
      row._resolvedProvince = prov;
      const dist = (row['อำเภอ'] || '').trim();
      return prov === provTarget && (dist === distTarget || dist.includes(distTarget) || distTarget.includes(dist));
    });
    filterBadgeHtml = `📍 กรองอำเภอ: <b class="text-blue-800 font-bold">อ.${distTarget}</b> จ.${provTarget} (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'subdistrict') {
    const provTarget = activeCriteria.province;
    const distTarget = activeCriteria.district;
    const subdistTarget = activeCriteria.subdistrict;
    filteredRows = rows.filter(row => {
      const prov = getRowProvince(row);
      row._resolvedProvince = prov;
      const dist = (row['อำเภอ'] || '').trim();
      const sub = (row['ตำบล'] || '').trim();
      const provMatch = prov === provTarget;
      const distMatch = !distTarget || dist === distTarget || dist.includes(distTarget) || distTarget.includes(dist);
      const subMatch = sub === subdistTarget || sub.includes(subdistTarget) || subdistTarget.includes(sub);
      return provMatch && distMatch && subMatch;
    });
    filterBadgeHtml = `🏠 กรองตำบล: <b class="text-indigo-800 font-bold">ต.${subdistTarget}</b> อ.${distTarget} จ.${provTarget} (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'location') {
    const locType = activeCriteria.locationType;
    const query = (activeCriteria.query || '').trim().toLowerCase();
    filteredRows = rows.filter(row => {
      row._resolvedProvince = getRowProvince(row);
      const locFull = (row['ที่ตั้งส่งหมาย (เต็ม)'] || row['ที่ตั้งส่งหมาย'] || '').toLowerCase();
      return locFull.includes(query);
    });
    filterBadgeHtml = `🏢 กรองที่ตั้ง (${locType}): <b class="text-purple-800 font-bold">"${activeCriteria.query}"</b> (${filteredRows.length} รายการ)`;
  } else if (activeCriteria.type === 'coords') {
    const targetLat = parseFloat(activeCriteria.lat);
    const targetLng = parseFloat(activeCriteria.lng);
    filteredRows = rows.filter(row => {
      row._resolvedProvince = getRowProvince(row);
      const rLat = parseFloat(row['ละติจูด (Lat)'] || row['ละติจูด'] || 0);
      const rLng = parseFloat(row['ลองจิจูด (Lng)'] || row['ลองจิจูด'] || 0);
      if (!rLat || !rLng) return false;
      const latDiff = Math.abs(rLat - targetLat);
      const lngDiff = Math.abs(rLng - targetLng);
      return (latDiff < 0.005 && lngDiff < 0.005) || (rLat.toFixed(3) === targetLat.toFixed(3) && rLng.toFixed(3) === targetLng.toFixed(3));
    });
    filterBadgeHtml = `🛰️ กรองพิกัด: <b class="text-teal-800 font-bold">${targetLat.toFixed(4)}, ${targetLng.toFixed(4)}</b> (${filteredRows.length} รายการ)`;
  }

  const tableProvFilterBadge = document.getElementById('tableProvFilterBadge');
  if (tableProvFilterBadge) {
    tableProvFilterBadge.innerHTML = filterBadgeHtml;
  }

  // 3. จัดกลุ่มข้อมูลเลขคดีที่ซ้ำกัน และแสดงเฉพาะรายการล่าสุดในตารางหลัก
  const caseGroups = new Map();
  filteredRows.forEach((row, index) => {
    const caseNumber = (row['เลขคดี'] || '').trim();
    if (!caseNumber) return;
    if (!caseGroups.has(caseNumber)) {
      caseGroups.set(caseNumber, []);
    }
    caseGroups.get(caseNumber).push({ ...row, originalIndex: index });
  });

  caseGroups.forEach((recordList, caseNumber) => {
    // รายการล่าสุด (รายการแรกสุดในกลุ่ม)
    const latest = recordList[0];
    const rawTimestamp = latest['วัน-เวลาบันทึก'] || latest['Timestamp'] || '';
    const formattedTimestamp = formatThaiDateDisplay(rawTimestamp);
    const currentProv = latest._resolvedProvince || getRowProvince(latest);
    const courtType = latest['ประเภทศาล'] || 'ศาลจังหวัด' + currentProv;
    const rowProvince = currentProv;
    const district = latest['อำเภอ'] || '';
    const subdistrict = latest['ตำบล'] || '';
    const locationFull = latest['ที่ตั้งส่งหมาย (เต็ม)'] || latest['ที่ตั้งส่งหมาย'] || '';
    const lat = latest['ละติจูด (Lat)'] || latest['ละติจูด'] || '';
    const lng = latest['ลองจิจูด (Lng)'] || latest['ลองจิจูด'] || '';
    const fileName = latest['ชื่อไฟล์รูปภาพ'] || '';
    const fileId = latest['Drive File ID'] || '';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50/40 transition';

    // คอลัมน์พิกัดพร้อมปุ่มคัดลอก และปุ่มเปิดใน Google Maps
    let coordDisplay = '-';
    if (lat && lng) {
      const latFixed = Number(lat).toFixed(4);
      const lngFixed = Number(lng).toFixed(4);
      const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      coordDisplay = `
        <div class="flex items-center gap-1.5 whitespace-nowrap">
          <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-mono text-xs font-semibold rounded-lg border border-blue-200 transition inline-flex items-center gap-1 shadow-sm" title="คลิกเพื่อคัดลอกพิกัด">
            <i class="fa-regular fa-copy text-[11px] text-blue-500"></i>
            <span>${latFixed}, ${lngFixed}</span>
          </button>
          <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 shadow-sm transition inline-flex items-center gap-1.5" title="เปิดดูตำแหน่งบน Google Maps">
            <i class="fa-solid fa-map-location-dot text-rose-600 text-xs"></i>
            <span>Google Maps</span>
          </a>
        </div>
      `;
    }

    // ปุ่ม "ประวัติส่งหมาย" (แสดงจำนวนรายการถ้ามีมากกว่า 1)
    const historyBtn = `
      <button type="button" onclick="openCaseHistoryModal('${caseNumber.replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition inline-flex items-center gap-1.5">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span>ประวัติส่งหมาย ${recordList.length > 1 ? `<span class="bg-blue-900 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">${recordList.length}</span>` : ''}</span>
      </button>
    `;

    // คอลัมน์จัดการ (Admin และหน้าจอ > 768px เท่านั้น)
    let actionBtn = `<span class="text-xs text-gray-400 italic">User Only</span>`;
    if (isAdmin && isDesktop) {
      actionBtn = `
        <button type="button" onclick="deleteRecord('${fileId}', '${fileName}', '${rawTimestamp}', '${caseNumber}', ${latest.originalIndex + 2})" class="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1" title="ลบข้อมูลในชีตและไฟล์ใน Drive">
          <i class="fa-solid fa-trash-can"></i>
          <span>ลบ</span>
        </button>
      `;
    }

    tr.innerHTML = `
      <td class="font-mono text-xs text-gray-600 whitespace-nowrap">${formattedTimestamp}</td>
      <td class="font-bold text-gray-900 whitespace-nowrap">${caseNumber}</td>
      <td class="text-xs text-gray-700">${courtType}</td>
      <td class="text-xs text-blue-700 font-semibold whitespace-nowrap">จ.${rowProvince}</td>
      <td class="text-xs text-gray-700">${district}</td>
      <td class="text-xs text-gray-700">${subdistrict}</td>
      <td class="text-xs text-gray-700 max-w-[200px] truncate" title="${locationFull}">${locationFull}</td>
      <td>${coordDisplay}</td>
      <td class="whitespace-nowrap">${historyBtn}</td>
      <td class="whitespace-nowrap">${actionBtn}</td>
    `;
    tableBody.appendChild(tr);
  });

  // เรียกใช้งาน DataTables
  state.dataTableInstance = $('#summonsDataTable').DataTable({
    pageLength: 10,
    responsive: true,
    order: [[0, 'desc']],
    language: {
      search: "ค้นหาข้อมูล:",
      lengthMenu: "แสดง _MENU_ แถวต่อหน้า",
      info: "แสดง _START_ ถึง _END_ จากทั้งหมด _TOTAL_ รายการ",
      infoEmpty: "ไม่มีข้อมูลในเงื่อนไขนี้",
      infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
      paginate: {
        first: "แรกสุด",
        last: "ท้ายสุด",
        next: "ถัดไป",
        previous: "ก่อนหน้า"
      },
      zeroRecords: `ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา`
    }
  });
}

/**
 * แสดง Popup รายการประวัติการส่งหมายทั้งหมดของเลขคดีนั้นๆ
 */
window.openCaseHistoryModal = function(caseNumber) {
  const records = (state.allSheetRows || []).filter(r => (r['เลขคดี'] || '').trim() === caseNumber.trim());
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const isDesktop = window.innerWidth > 768;
  const showDeleteCol = isAdmin && isDesktop;

  let rowsHtml = '';
  records.forEach((rec) => {
    const rawTimestamp = rec['วัน-เวลาบันทึก'] || rec['Timestamp'] || '';
    const formattedTimestamp = formatThaiDateDisplay(rawTimestamp);
    const lat = rec['ละติจูด (Lat)'] || rec['ละติจูด'] || '';
    const lng = rec['ลองจิจูด (Lng)'] || rec['ลองจิจูด'] || '';
    const imgUrl = rec['ลิงก์รูปภาพใน Google Drive'] || rec['ลิงก์รูปภาพ'] || '';
    const fileId = rec['Drive File ID'] || '';
    const fileName = rec['ชื่อไฟล์รูปภาพ'] || '';
    const locationFull = rec['ที่ตั้งส่งหมาย (เต็ม)'] || rec['ที่ตั้งส่งหมาย'] || '';

    let coordDisplay = '-';
    if (lat && lng) {
      const latFixed = Number(lat).toFixed(4);
      const lngFixed = Number(lng).toFixed(4);
      const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      coordDisplay = `
        <div class="flex items-center gap-1.5 whitespace-nowrap">
          <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-mono text-xs font-semibold rounded-lg border border-blue-200 transition inline-flex items-center gap-1 shadow-sm" title="คลิกเพื่อคัดลอกพิกัด">
            <i class="fa-regular fa-copy text-[11px] text-blue-500"></i>
            <span>${latFixed}, ${lngFixed}</span>
          </button>
          <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 shadow-sm transition inline-flex items-center gap-1.5" title="เปิดดูตำแหน่งบน Google Maps">
            <i class="fa-solid fa-map-location-dot text-rose-600 text-xs"></i>
            <span>Google Maps</span>
          </a>
        </div>
      `;
    }

    let imgBtn = `
      <button type="button" disabled class="px-2.5 py-1 bg-gray-100 text-gray-400 rounded-lg text-xs font-medium border border-gray-200 cursor-not-allowed inline-flex items-center gap-1.5">
        <i class="fa-solid fa-image-slash text-gray-400 text-xs"></i>
        <span>ไม่มีข้อมูลภาพในระบบ</span>
      </button>
    `;
    if (imgUrl && String(imgUrl).trim() !== '' && String(imgUrl).startsWith('http')) {
      imgBtn = `
        <button type="button" onclick="viewPhotoModal('${imgUrl}', '${caseNumber}', '${locationFull}', '${formattedTimestamp}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1">
          <i class="fa-solid fa-image"></i>
          <span>ดูภาพ</span>
        </button>
      `;
    }

    let deleteBtn = '';
    if (showDeleteCol) {
      deleteBtn = `
        <td>
          <button type="button" onclick="deleteRecord('${fileId}', '${fileName}', '${rawTimestamp}', '${caseNumber}', ${rec.originalIndex + 2})" class="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1" title="ลบรายการนี้">
            <i class="fa-solid fa-trash-can"></i>
            <span>ลบ</span>
          </button>
        </td>
      `;
    }

    rowsHtml += `
      <tr>
        <td class="font-mono text-xs text-gray-700 whitespace-nowrap">${formattedTimestamp}</td>
        <td>${coordDisplay}</td>
        <td class="whitespace-nowrap">${imgBtn}</td>
        ${showDeleteCol ? deleteBtn : ''}
      </tr>
    `;
  });

  Swal.fire({
    title: `ประวัติการส่งหมาย: ${caseNumber}`,
    html: `
      <div class="text-left text-xs sm:text-sm text-gray-600 mb-3 flex items-center justify-between">
        <span>พบประวัติทั้งหมด <b class="text-blue-600 font-bold">${records.length}</b> รายการ</span>
      </div>
      <div class="overflow-x-auto w-full">
        <table id="caseSubDataTable" class="w-full text-left text-xs sm:text-sm stripe hover" style="width:100%">
          <thead>
            <tr class="bg-gray-100 text-gray-700 font-bold">
              <th>วันเดือนปีและเวลา</th>
              <th>พิกัด</th>
              <th>รูปภาพ</th>
              ${showDeleteCol ? '<th class="admin-only-col">ลบ</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `,
    width: isDesktop ? '80%' : (showDeleteCol ? '750px' : '95%'),
    customClass: {
      container: 'case-history-swal-container',
      popup: 'case-history-swal-popup p-4 sm:p-6 rounded-2xl'
    },
    showCloseButton: true,
    showConfirmButton: false,
    allowOutsideClick: false,
    didOpen: () => {
      $('#caseSubDataTable').DataTable({
        pageLength: 5,
        order: [[0, 'desc']],
        responsive: true,
        language: {
          search: "ค้นหาในประวัติ:",
          lengthMenu: "แสดง _MENU_ แถว",
          info: "แสดง _START_ ถึง _END_ จาก _TOTAL_ รายการ",
          paginate: { next: "ถัดไป", previous: "ก่อนหน้า" },
          zeroRecords: "ไม่พบข้อมูล"
        }
      });
    }
  });
};

/**
 * Modal อัปโหลดภาพหมาย (นำเข้าข้อมูลส่งหมายพร้อมรูปภาพ)
 * กรอกข้อมูลเหมือนหน้าบันทึกส่งหมายทุกประการ:
 * - ประเภทศาล (ศาลจังหวัดอุดรธานี / ศาลอื่น)
 * - เลขคดี (อักษรนำหน้า + เลขคดี + ปี พ.ศ.)
 * - ที่ตั้ง (อำเภอ, ตำบล, ประเภทสถานที่, บ้านเลขที่/หมู่ที่/อบต./สถานที่อื่นๆ)
 * - พิกัด GPS (ดึงจากเครื่องปัจจุบัน หรือกดเช็คพิกัดใหม่)
 * - เลือกไฟล์รูปภาพ (เฉพาะไฟล์รูปภาพ accept="image/*")
 * - แสดงตัวอย่างภาพ และสามารถกดดูภาพขนาดเต็มได้
 * - ทำการประมวลผลลายน้ำ และลดขนาดภาพไม่ให้เกิน 1MB ก่อนอัปโหลด
 */
window.openManualUploadModal = function() {
  const currentBuddhistYear = new Date().getFullYear() + (new Date().getFullYear() < 2400 ? 543 : 0);
  
  // สร้างตัวเลือกปี พ.ศ. (ย้อนหลัง 40 ปี)
  let yearOptionsHtml = '';
  for (let y = currentBuddhistYear; y >= currentBuddhistYear - 40; y--) {
    yearOptionsHtml += `<option value="${y}">${y}</option>`;
  }

  // สร้างตัวเลือกอำเภอ
  let districtOptionsHtml = '';
  const currentProv = state.selectedProvince || 'กรุงเทพมหานคร';
  const districts = getDistrictsByProvince(currentProv);
  districts.forEach(d => {
    districtOptionsHtml += `<option value="${d}">${d}</option>`;
  });

  // สร้าง datalist สำหรับ autocomplete อักษรนำหน้าเลขคดี
  let prefixOptionsHtml = '';
  const prefixes = state.casePrefixHistory || ['ผบE', 'ผบ', 'พ', 'ผชE', 'ผช', 'ม', 'กE', 'ก'];
  prefixes.forEach(p => {
    prefixOptionsHtml += `<option value="${p}">`;
  });

  // พิกัดปัจจุบัน
  const defaultLat = state.lat ? Number(state.lat).toFixed(6) : '';
  const defaultLng = state.lng ? Number(state.lng).toFixed(6) : '';

  let selectedImageDataUrl = null;

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-gray-900 font-bold text-base sm:text-lg"><i class="fa-solid fa-cloud-arrow-up text-blue-600"></i><span>อัปโหลดภาพส่งหมาย</span></div>',
    html: `
      <div class="text-left space-y-4 pt-1 max-h-[72vh] overflow-y-auto pr-1 text-xs">
        
        <!-- 1. ข้อมูลศาลและเลขคดี -->
        <div class="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200 space-y-2.5">
          <p class="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
            <i class="fa-solid fa-scale-balanced text-blue-600"></i> ข้อมูลศาลและเลขคดี
          </p>
          
          <div>
            <label class="block font-semibold text-gray-700 mb-1">ประเภทศาล</label>
            <select id="mUp_courtType" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-200">
              <option value="ศาลจังหวัดอุดรธานี" selected>ศาลจังหวัดอุดรธานี</option>
              <option value="ศาลอื่น">ศาลอื่น</option>
            </select>
          </div>

          <!-- เลขคดี: ศาลจังหวัดอุดรธานี -->
          <div id="mUp_udonCaseBox" class="space-y-1">
            <label class="block font-semibold text-gray-700">เลขคดี (อักษรนำหน้า / เลข / ปี) *</label>
            <div class="flex items-center gap-1.5">
              <input type="text" id="mUp_udonPrefix" list="mUp_prefixDatalist" value="ผบE" placeholder="อักษร เช่น ผบE" class="w-24 bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-bold text-blue-700 text-center uppercase">
              <datalist id="mUp_prefixDatalist">${prefixOptionsHtml}</datalist>
              <input type="text" id="mUp_udonCaseNo" placeholder="เลขคดี เช่น 2100" class="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 text-center">
              <span class="text-gray-400 font-bold text-sm">/</span>
              <select id="mUp_udonYear" class="w-24 bg-white border border-gray-300 rounded-xl px-2 py-2 text-xs font-bold text-gray-800 text-center">
                ${yearOptionsHtml}
              </select>
            </div>
          </div>

          <!-- เลขคดี: ศาลอื่น -->
          <div id="mUp_otherCaseBox" class="hidden space-y-1">
            <label class="block font-semibold text-gray-700">เลขคดีเต็ม (ศาลอื่น) *</label>
            <div class="flex items-center gap-1.5">
              <input type="text" id="mUp_otherCaseNo" placeholder="พิมพ์เลขคดี เช่น ผบE100/2569" class="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800">
              <select id="mUp_otherYear" class="w-24 bg-white border border-gray-300 rounded-xl px-2 py-2 text-xs font-bold text-gray-800 text-center">
                ${yearOptionsHtml}
              </select>
            </div>
          </div>

          <!-- ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี) -->
          <div>
            <label class="block font-semibold text-gray-700 mb-1 flex items-center justify-between">
              <span>ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี)</span>
              <span class="text-[10px] text-gray-400 font-normal">ไม่บังคับ</span>
            </label>
            <input type="text" id="mUp_caseExtra" placeholder="เช่น ล.1-2 (เว้นวรรค 1 เคาะต่อท้ายเลขคดี)" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium text-gray-800">
          </div>
        </div>

        <!-- 2. ข้อมูลที่ตั้งส่งหมาย -->
        <div class="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200 space-y-2.5">
          <p class="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
            <i class="fa-solid fa-location-dot text-red-500"></i> ข้อมูลที่ตั้งส่งหมาย
          </p>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-semibold text-gray-700 mb-1">อำเภอ *</label>
              <select id="mUp_district" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-medium focus:border-blue-500">
                ${districtOptionsHtml}
              </select>
            </div>
            <div>
              <label class="block font-semibold text-gray-700 mb-1">ตำบล *</label>
              <select id="mUp_subdistrict" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-medium focus:border-blue-500">
                <!-- Injected dynamic -->
              </select>
            </div>
          </div>

          <div>
            <label class="block font-semibold text-gray-700 mb-1">ประเภทสถานที่</label>
            <select id="mUp_locationType" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium focus:border-blue-500">
              <option value="หมายบ้าน" selected>หมายบ้าน (บ้านเลขที่/หมู่ที่)</option>
              <option value="หมาย อบต./เทศบาล">หมาย อบต./เทศบาล</option>
              <option value="อื่นๆ">อื่นๆ (ระบุชื่อสถานที่)</option>
            </select>
          </div>

          <!-- ฟิลด์หมายบ้าน -->
          <div id="mUp_houseFields" class="grid grid-cols-2 gap-2">
            <div>
              <label class="block font-semibold text-gray-700 mb-1">บ้านเลขที่ *</label>
              <input type="text" id="mUp_houseNo" placeholder="เช่น 141, 99/1" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium">
            </div>
            <div>
              <label class="block font-semibold text-gray-700 mb-1">หมู่ที่</label>
              <input type="text" id="mUp_moo" placeholder="เช่น 5" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium">
            </div>
          </div>

          <!-- ฟิลด์ อบต./เทศบาล -->
          <div id="mUp_localAdminFields" class="hidden">
            <label class="block font-semibold text-gray-700 mb-1">ชื่อ อบต. / เทศบาล *</label>
            <input type="text" id="mUp_localAdminName" placeholder="เช่น อบต.กุดสระ, เทศบาลนครอุดรธานี" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium">
          </div>

          <!-- ฟิลด์ อื่นๆ -->
          <div id="mUp_customOtherFields" class="hidden">
            <label class="block font-semibold text-gray-700 mb-1">ชื่อสถานที่ส่งหมาย *</label>
            <input type="text" id="mUp_customOtherLocation" placeholder="เช่น โรงเรียนบ้านนาดี, วัดโพธิสมภรณ์" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-medium">
          </div>
        </div>

        <!-- 3. ข้อมูลพิกัด GPS -->
        <div class="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200 space-y-2">
          <div class="flex items-center justify-between">
            <p class="font-bold text-gray-800 flex items-center gap-1.5 text-xs">
              <i class="fa-solid fa-location-crosshairs text-emerald-600"></i> พิกัดสถานที่ (GPS Coordinates)
            </p>
            <button type="button" id="mUp_btnRefreshGps" class="text-[11px] text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
              <i class="fa-solid fa-arrows-rotate"></i> เช็คพิกัดใหม่
            </button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] text-gray-500 mb-0.5">ละติจูด (Lat)</label>
              <input type="text" id="mUp_lat" value="${defaultLat}" placeholder="เช่น 17.4144" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-gray-700 text-center">
            </div>
            <div>
              <label class="block text-[10px] text-gray-500 mb-0.5">ลองจิจูด (Lng)</label>
              <input type="text" id="mUp_lng" value="${defaultLng}" placeholder="เช่น 102.7882" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-gray-700 text-center">
            </div>
          </div>
        </div>

        <!-- 4. เลือกไฟล์รูปภาพ (เฉพาะรูปภาพเท่านั้น) -->
        <div class="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200 space-y-3">
          <div>
            <label class="block font-bold text-blue-900 mb-1 text-xs">
              <i class="fa-solid fa-image text-blue-600 mr-1"></i> เลือกไฟล์รูปภาพ (เฉพาะไฟล์รูปภาพเท่านั้น) *
            </label>
            <input type="file" id="mUp_fileInput" accept="image/*" class="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer">
          </div>

          <!-- ตัวอย่างรูปภาพ (Thumbnail Preview) & คลิกดูภาพเต็ม -->
          <div id="mUp_previewContainer" class="hidden space-y-2">
            <p class="text-[11px] font-bold text-gray-700">ตัวอย่างภาพที่เลือก (คลิกที่ภาพเพื่อดูขนาดเต็ม):</p>
            <div class="relative bg-gray-900 rounded-xl p-2 flex items-center justify-center max-h-48 overflow-hidden cursor-pointer group" onclick="viewManualFullPreview()" title="คลิกเพื่อดูภาพขนาดเต็ม">
              <img id="mUp_previewImg" src="" class="max-h-44 object-contain rounded-lg shadow">
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1.5">
                <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
                <span>คลิกเพื่อดูภาพเต็ม</span>
              </div>
            </div>
            <p id="mUp_fileInfoText" class="text-[11px] text-gray-500 text-center font-mono"></p>
          </div>
        </div>

      </div>
    `,
    width: '700px',
    showCloseButton: true,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-cloud-arrow-up mr-1.5"></i> บันทึกและอัปโหลดภาพขึ้น Google Drive',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
    didOpen: () => {
      const courtTypeSelect = document.getElementById('mUp_courtType');
      const udonCaseBox = document.getElementById('mUp_udonCaseBox');
      const otherCaseBox = document.getElementById('mUp_otherCaseBox');
      const districtSelect = document.getElementById('mUp_district');
      const subdistrictSelect = document.getElementById('mUp_subdistrict');
      const locationTypeSelect = document.getElementById('mUp_locationType');
      const houseFields = document.getElementById('mUp_houseFields');
      const localAdminFields = document.getElementById('mUp_localAdminFields');
      const customOtherFields = document.getElementById('mUp_customOtherFields');
      const fileInput = document.getElementById('mUp_fileInput');
      const previewContainer = document.getElementById('mUp_previewContainer');
      const previewImg = document.getElementById('mUp_previewImg');
      const fileInfoText = document.getElementById('mUp_fileInfoText');
      const btnRefreshGps = document.getElementById('mUp_btnRefreshGps');
      const latInput = document.getElementById('mUp_lat');
      const lngInput = document.getElementById('mUp_lng');

      // อัปเดตตำบลตามอำเภอ
      const updateSubdistricts = () => {
        const d = districtSelect.value;
        const prov = state.selectedProvince || 'กรุงเทพมหานคร';
        const subs = getSubdistrictsByDistrict(prov, d);
        subdistrictSelect.innerHTML = '';
        subs.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          subdistrictSelect.appendChild(opt);
        });
      };
      updateSubdistricts();
      districtSelect.addEventListener('change', updateSubdistricts);

      // สลับประเภทศาล
      courtTypeSelect.addEventListener('change', () => {
        if (courtTypeSelect.value === 'ศาลอื่น') {
          udonCaseBox.classList.add('hidden');
          otherCaseBox.classList.remove('hidden');
        } else {
          udonCaseBox.classList.remove('hidden');
          otherCaseBox.classList.add('hidden');
        }
      });

      const mUpPrefixInput = document.getElementById('mUp_udonPrefix');
      if (mUpPrefixInput) {
        mUpPrefixInput.addEventListener('input', (e) => {
          e.target.value = e.target.value
            .replace(/[^a-zA-Zก-๙\.\s]/g, '')
            .replace(/^\s+/, '')
            .replace(/\s{2,}/g, ' ');
        });
      }

      // สลับประเภทสถานที่
      locationTypeSelect.addEventListener('change', () => {
        const val = locationTypeSelect.value;
        houseFields.classList.toggle('hidden', val !== 'หมายบ้าน');
        localAdminFields.classList.toggle('hidden', val !== 'หมาย อบต./เทศบาล');
        customOtherFields.classList.toggle('hidden', val !== 'อื่นๆ');
      });

      // ดึงพิกัด GPS ใหม่
      btnRefreshGps.addEventListener('click', () => {
        btnRefreshGps.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังค้นหา...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            latInput.value = pos.coords.latitude.toFixed(6);
            lngInput.value = pos.coords.longitude.toFixed(6);
            btnRefreshGps.innerHTML = '<i class="fa-solid fa-check text-emerald-600"></i> ได้พิกัดแล้ว';
            setTimeout(() => {
              btnRefreshGps.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> เช็คพิกัดใหม่';
            }, 2000);
          },
          (err) => {
            btnRefreshGps.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> เช็คพิกัดใหม่';
            Swal.showValidationMessage('ไม่สามารถรับพิกัด GPS ได้: ' + err.message);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });

      // เมื่อเลือกไฟล์รูปภาพ
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          Swal.showValidationMessage('กรุณาเลือกเฉพาะไฟล์รูปภาพ (jpg, png, webp, heic ฯลฯ)');
          fileInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          selectedImageDataUrl = ev.target.result;
          window._manualTempDataUrl = selectedImageDataUrl;
          previewImg.src = selectedImageDataUrl;
          previewContainer.classList.remove('hidden');
          const sizeKb = Math.round(file.size / 1024);
          fileInfoText.textContent = `ไฟล์: ${file.name} (${sizeKb} KB)`;
        };
        reader.readAsDataURL(file);
      });
    },
    preConfirm: () => {
      const courtType = document.getElementById('mUp_courtType').value;
      let caseNumber = '';

      const extra = (document.getElementById('mUp_caseExtra')?.value || '').trim();
      const extraSuffix = extra ? ` ${extra}` : '';

      if (courtType === 'ศาลอื่น') {
        const otherNo = document.getElementById('mUp_otherCaseNo').value.trim();
        const otherYr = document.getElementById('mUp_otherYear').value;
        if (!otherNo) {
          Swal.showValidationMessage('กรุณากรอกเลขคดี');
          return false;
        }
        caseNumber = (otherNo.includes('/') ? otherNo : `${otherNo}/${otherYr}`) + extraSuffix;
      } else {
        const prefix = document.getElementById('mUp_udonPrefix').value.trim();
        const no = document.getElementById('mUp_udonCaseNo').value.trim();
        const yr = document.getElementById('mUp_udonYear').value;
        if (!prefix || !no) {
          Swal.showValidationMessage('กรุณากรอกอักษรนำหน้าและเลขคดี');
          return false;
        }
        caseNumber = `${prefix}${no}/${yr}${extraSuffix}`;
      }

      const district = document.getElementById('mUp_district').value;
      const subdistrict = document.getElementById('mUp_subdistrict').value;
      const locationType = document.getElementById('mUp_locationType').value;

      let locationText = '';
      if (locationType === 'หมายบ้าน') {
        const houseNo = document.getElementById('mUp_houseNo').value.trim();
        const moo = document.getElementById('mUp_moo').value.trim();
        if (!houseNo) {
          Swal.showValidationMessage('กรุณากรอกบ้านเลขที่');
          return false;
        }
        locationText = `${houseNo}${moo ? ' ม.' + moo : ''} ต.${subdistrict} อ.${district}`;
      } else if (locationType === 'หมาย อบต./เทศบาล') {
        const adminName = document.getElementById('mUp_localAdminName').value.trim();
        if (!adminName) {
          Swal.showValidationMessage('กรุณาระบุชื่อ อบต. หรือเทศบาล');
          return false;
        }
        locationText = `${adminName} ต.${subdistrict} อ.${district}`;
      } else {
        const otherLoc = document.getElementById('mUp_customOtherLocation').value.trim();
        if (!otherLoc) {
          Swal.showValidationMessage('กรุณาระบุชื่อสถานที่');
          return false;
        }
        locationText = `${otherLoc} ต.${subdistrict} อ.${district}`;
      }

      const lat = document.getElementById('mUp_lat').value.trim() || state.lat || '17.4144';
      const lng = document.getElementById('mUp_lng').value.trim() || state.lng || '102.7882';

      if (!selectedImageDataUrl) {
        Swal.showValidationMessage('กรุณาเลือกไฟล์รูปภาพ');
        return false;
      }

      return {
        caseNumber,
        courtType,
        district,
        subdistrict,
        locationType,
        locationText,
        lat: Number(lat),
        lng: Number(lng),
        dataUrl: selectedImageDataUrl
      };
    }
  }).then(async (res) => {
    if (res.isConfirmed && res.value) {
      const formData = res.value;
      showCustomLoading('กำลังประมวลผลลายน้ำและรูปภาพ...', 'กำลังสร้างภาพถ่ายพร้อมข้อมูลส่งหมาย');

      try {
        const img = new Image();
        img.src = formData.dataUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const heading = window.compassManager ? window.compassManager.getHeading() : 0;
        const payloadData = {
          caseNumber: formData.caseNumber,
          courtType: formData.courtType,
          district: formData.district,
          subdistrict: formData.subdistrict,
          locationType: formData.locationType,
          locationText: formData.locationText,
          lat: formData.lat,
          lng: formData.lng,
          heading: heading,
          dateTime: WatermarkEngine.formatThaiDateTime(new Date())
        };

        // วาดลายน้ำลงบนรูปภาพ
        const watermarkedResult = await WatermarkEngine.renderWatermark(img, payloadData);
        const baseFilename = formData.caseNumber.replace(/\//g, '-');
        const imageFilename = baseFilename + '.jpg';

        hideCustomLoading();

        // บีบอัดรูปภาพให้ขนาด <= 1MB (ไม่ต้องดาวน์โหลดลงเครื่องเพราะเป็นการอัปโหลดไฟล์ที่มีอยู่แล้ว)
        const compressedImageBase64 = await compressImageToMax1MB(watermarkedResult.dataUrl);

        const uploadPayload = {
          action: 'upload_image',
          ...payloadData,
          fileName: imageFilename,
          imageBase64: compressedImageBase64
        };

        // 3. ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต
        if (!navigator.onLine) {
          addToOfflineQueue({
            payload: uploadPayload,
            fileName: imageFilename,
            caseNumber: formData.caseNumber
          });

          Swal.fire({
            icon: 'info',
            title: 'บันทึกสำเร็จ (โหมดออฟไลน์)',
            html: `
              <div class="text-left text-xs space-y-2 text-gray-700">
                <p>บันทึกภาพถ่ายเลขคดี <b>${formData.caseNumber}</b> ลงในเครื่องเรียบร้อยแล้ว</p>
                <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                  <i class="fa-solid fa-cloud-arrow-up mr-1 text-amber-600"></i>
                  <b>แจ้งเตือน:</b> เนื่องจากขณะนี้ไม่มีสัญญาณอินเทอร์เน็ต ระบบได้จัดเก็บข้อมูลเข้าสู่ <b>คิวออฟไลน์</b> ในเครื่องไว้แล้ว และจะทำการอัปโหลดขึ้น Google Drive & Sheet ให้โดยอัตโนมัติเมื่อท่านเชื่อมต่ออินเทอร์เน็ต
                </div>
              </div>
            `,
            confirmButtonText: 'ตกลง',
            confirmButtonColor: '#2563eb',
            showCloseButton: true,
            allowOutsideClick: false
          });
          return;
        }

        // อัปโหลดขึ้น Google Drive พร้อมนำเข้าข้อมูลลง Google Sheet ในขั้นตอนเดียว
        const resJson = await uploadWithProgressBar(uploadPayload, `กำลังอัปโหลดภาพเลขคดี ${formData.caseNumber}...`);

        // เคลียร์แคชและโหลดข้อมูลใหม่
        localStorage.removeItem(CACHE_KEY_SHEET_DATA);
        localStorage.removeItem(CACHE_KEY_SHEET_TIME);

        Swal.fire({
          icon: 'success',
          title: 'อัปโหลดภาพสำเร็จ!',
          showCloseButton: true,
          allowOutsideClick: false,
          html: `<p class="text-gray-700">อัปโหลดภาพถ่ายเลขคดี <b>${formData.caseNumber}</b> ลงใน Google Drive & Sheet เรียบร้อยแล้ว</p>
                 ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
          confirmButtonColor: '#2563eb'
        }).then(() => {
          loadGoogleSheetData(true);
        });

      } catch (err) {
        console.error('Manual full upload error:', err);
        hideCustomLoading();
        Swal.fire({
          icon: 'error',
          title: 'การอัปโหลดไม่สำเร็จ',
          text: err.message,
          showCloseButton: true,
          allowOutsideClick: false,
          confirmButtonColor: '#2563eb'
        });
      }
    }
  });
};

/**
 * Modal ค้นหาข้อมูลหมายบนหน้าจอมือถือ (< 768px)
 * แสดงรายการเลขคดีที่ไม่ซ้ำ (Grouped by Case Number)
 * หากมีหลายรายการ จะมีปุ่มให้กดดูรายการย่อย
 * แต่ละรายการย่อยมี:
 * 2.1 ปุ่มเลขคดี
 * 2.2 ปุ่มพิกัด (คัดลอกพิกัด + Google Maps)
 * 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะรายการที่มีรูปภาพในระบบ และสามารถคลิกภาพเพื่อเปิดดูเต็มจอได้)
 */
window.openMobileCaseSearchModal = async function() {
  // ตรวจสอบและดึงข้อมูลสดจาก Google Sheet หากยังไม่มีข้อมูล
  if (!state.allSheetRows || state.allSheetRows.length === 0) {
    showCustomLoading('กำลังดึงข้อมูลหมาย...', 'กำลังเชื่อมต่อ Google Sheet');
    try {
      const now = Date.now();
      const csvFetchUrl = `${state.googleSheetCsvUrl}&_t=${now}`;
      const freshRows = await new Promise((resolve, reject) => {
        Papa.parse(csvFetchUrl, {
          download: true,
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data || []),
          error: (err) => reject(err)
        });
      });
      hideCustomLoading();
      state.allSheetRows = freshRows;
      renderDataTable(freshRows);
    } catch (e) {
      hideCustomLoading();
      console.warn('Mobile search load error:', e);
    }
  }

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-gray-900 font-bold text-base"><i class="fa-solid fa-magnifying-glass text-blue-600"></i><span>ค้นหาข้อมูลหมาย</span></div>',
    html: `
      <div class="text-left space-y-3 pt-1">
        <!-- ช่องค้นหาเลขคดี + ปุ่มค้นหา -->
        <div class="flex gap-2">
          <input type="text" id="mobileSearchInput" placeholder="พิมพ์เลขคดี หรือ ที่ตั้งส่งหมาย..." class="flex-1 bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition">
          <button type="button" id="btnTriggerMobileSearch" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow flex items-center gap-1.5 transition">
            <i class="fa-solid fa-magnifying-glass"></i>
            <span>ค้นหา</span>
          </button>
        </div>

        <div class="flex items-center justify-between text-xs text-gray-500 px-1">
          <span id="mobileSearchResultCountText">แสดงรายการล่าสุด</span>
        </div>

        <!-- รายการคดีแบบ ListView สำหรับจอมือถือ -->
        <div id="mobileSearchResultsContainer" class="max-h-[60vh] overflow-y-auto space-y-3 pr-0.5">
          <!-- Injected by JS -->
        </div>
      </div>
    `,
    width: '95%',
    showCloseButton: true,
    showConfirmButton: false,
    allowOutsideClick: false,
    didOpen: () => {
      const searchInput = document.getElementById('mobileSearchInput');
      const searchBtn = document.getElementById('btnTriggerMobileSearch');
      const container = document.getElementById('mobileSearchResultsContainer');
      const countTxt = document.getElementById('mobileSearchResultCountText');

      const renderList = (query = '') => {
        const q = query.trim().toLowerCase();
        const rows = state.allSheetRows || [];
        const filtered = rows.filter(r => {
          const c = (r['เลขคดี'] || '').toLowerCase();
          const d = (r['ที่ตั้งส่งหมาย (เต็ม)'] || r['ที่ตั้งส่งหมาย'] || '').toLowerCase();
          return !q || c.includes(q) || d.includes(q);
        });

        // จัดกลุ่มตามเลขคดี (Group by Case Number) เพื่อแสดงรายการที่ไม่ซ้ำ
        const groupMap = new Map();
        filtered.forEach(r => {
          const caseNo = (r['เลขคดี'] || '-').trim();
          if (!groupMap.has(caseNo)) {
            groupMap.set(caseNo, []);
          }
          groupMap.get(caseNo).push(r);
        });

        const uniqueCases = Array.from(groupMap.keys());
        countTxt.textContent = q ? `พบเลขคดีทั้งหมด ${uniqueCases.length} คดี (${filtered.length} รายการส่งหมาย)` : `แสดง ${Math.min(uniqueCases.length, 20)} เลขคดีล่าสุด`;
        container.innerHTML = '';

        if (uniqueCases.length === 0) {
          container.innerHTML = `
            <div class="p-6 text-center text-gray-400 bg-gray-50 rounded-2xl border border-gray-200">
              <i class="fa-solid fa-folder-open text-3xl mb-2 text-gray-300"></i>
              <p class="text-xs">ไม่พบข้อมูลเลขคดีที่ค้นหา</p>
            </div>
          `;
          return;
        }

        const displayKeys = q ? uniqueCases : uniqueCases.slice(0, 20);

        displayKeys.forEach(caseNo => {
          const records = groupMap.get(caseNo);
          const latest = records[0];
          const rawTime = latest['วัน-เวลาบันทึก'] || latest['Timestamp'] || '';
          const formattedDate = formatThaiDateDisplay(rawTime);
          const loc = latest['ที่ตั้งส่งหมาย (เต็ม)'] || latest['ที่ตั้งส่งหมาย'] || '-';
          const lat = latest['ละติจูด (Lat)'] || latest['ละติจูด'] || '';
          const lng = latest['ลองจิจูด (Lng)'] || latest['ลองจิจูด'] || '';
          const imgUrl = latest['ลิงก์รูปภาพใน Google Drive'] || latest['ลิงก์รูปภาพ'] || '';
          const hasImage = imgUrl && String(imgUrl).trim() !== '' && String(imgUrl).startsWith('http');
          const hasMultiple = records.length > 1;

          const card = document.createElement('div');
          card.className = 'bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-2.5 text-left transition hover:border-blue-300';
          
          card.innerHTML = `
            <div class="flex items-start justify-between gap-2 border-b border-gray-100 pb-2">
              <div>
                <span class="font-bold text-gray-900 text-sm text-blue-700">${caseNo}</span>
                <p class="text-[11px] text-gray-500 font-mono mt-0.5"><i class="fa-regular fa-calendar-check mr-1 text-blue-500"></i>${formattedDate}</p>
              </div>
              <div class="flex items-center gap-1">
                ${hasMultiple ? `
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                    <i class="fa-solid fa-layer-group mr-0.5"></i> ${records.length} รายการ
                  </span>
                ` : `
                  <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${hasImage ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}">
                    ${hasImage ? 'มีภาพถ่าย' : 'ไม่มีภาพ'}
                  </span>
                `}
              </div>
            </div>

            <p class="text-xs text-gray-700 leading-relaxed">
              <i class="fa-solid fa-location-dot text-red-500 mr-1"></i>${loc}
            </p>

            ${hasMultiple ? `
              <!-- ปุ่มดูรายการย่อยทั้งหมดสำหรับคดีที่มีประวัติมากกว่า 1 รายการ -->
              <div class="pt-1">
                <button type="button" onclick="openMobileSubRecordsModal('${caseNo.replace(/'/g, "\\'")}')" class="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-98 text-white font-bold rounded-xl text-xs shadow-sm flex items-center justify-center gap-2 transition">
                  <i class="fa-solid fa-layer-group"></i>
                  <span>ดูรายการย่อย (${records.length} รายการ)</span>
                  <i class="fa-solid fa-chevron-right text-[10px]"></i>
                </button>
              </div>
            ` : `
              <!-- สำหรับคดีที่มี 1 รายการ แสดงปุ่ม: 2.1 เลขคดี, 2.2 พิกัด, 2.3 ดูภาพ (ถ้ามี) -->
              <div class="flex items-center gap-1.5 flex-wrap pt-1">
                <!-- 2.1 ปุ่มเลขคดี -->
                <button type="button" class="px-2.5 py-1.5 bg-blue-50 text-blue-800 rounded-lg text-xs font-bold border border-blue-200 shadow-sm inline-flex items-center gap-1">
                  <i class="fa-solid fa-scale-balanced text-blue-600"></i>
                  <span>${caseNo}</span>
                </button>

                <!-- 2.2 ปุ่มพิกัด -->
                ${lat && lng ? `
                  <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200 shadow-sm inline-flex items-center gap-1 transition" title="คัดลอกพิกัด">
                    <i class="fa-solid fa-location-crosshairs text-emerald-600"></i>
                    <span>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</span>
                  </button>

                  <!-- ปุ่มเปิดใน Google Maps -->
                  <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold border border-rose-200 shadow-sm inline-flex items-center gap-1 active:scale-95 transition" title="เปิดดูตำแหน่งใน Google Maps">
                    <i class="fa-solid fa-map-location-dot text-rose-600"></i>
                    <span>Google Maps</span>
                  </a>
                ` : ''}

                <!-- 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะเมื่อมีภาพในระบบ) -->
                ${hasImage ? `
                  <button type="button" onclick="viewPhotoModal('${imgUrl}', '${caseNo}', '${loc.replace(/'/g, "\\'")}', '${formattedDate}', '${lat}', '${lng}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm inline-flex items-center gap-1 active:scale-95 transition">
                    <i class="fa-solid fa-image"></i>
                    <span>ดูภาพ</span>
                  </button>
                ` : ''}
              </div>
            `}
          `;

          container.appendChild(card);
        });
      };

      renderList('');
      searchInput.addEventListener('input', (e) => renderList(e.target.value));
      searchBtn.addEventListener('click', () => renderList(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderList(searchInput.value);
      });
    }
  });
};

/**
 * Modal แสดงรายการย่อยทั้งหมดของเลขคดีนั้นๆ บนหน้าจอมือถือ (< 768px)
 * แต่ละรายการแสดง:
 * 2.1 ปุ่มเลขคดี
 * 2.2 ปุ่มพิกัด (คัดลอกพิกัด + Google Maps)
 * 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะรายการที่มีภาพในระบบ)
 */
window.openMobileSubRecordsModal = function(caseNumber) {
  const records = (state.allSheetRows || []).filter(r => (r['เลขคดี'] || '').trim() === caseNumber.trim());

  let cardsHtml = '';
  records.forEach((rec, idx) => {
    const rawTime = rec['วัน-เวลาบันทึก'] || rec['Timestamp'] || '';
    const formattedDate = formatThaiDateDisplay(rawTime);
    const loc = rec['ที่ตั้งส่งหมาย (เต็ม)'] || rec['ที่ตั้งส่งหมาย'] || '-';
    const lat = rec['ละติจูด (Lat)'] || rec['ละติจูด'] || '';
    const lng = rec['ลองจิจูด (Lng)'] || rec['ลองจิจูด'] || '';
    const imgUrl = rec['ลิงก์รูปภาพใน Google Drive'] || rec['ลิงก์รูปภาพ'] || '';
    const hasImage = imgUrl && String(imgUrl).trim() !== '' && String(imgUrl).startsWith('http');

    cardsHtml += `
      <div class="bg-gray-50/90 rounded-2xl border border-gray-200 p-3.5 space-y-2.5 text-left shadow-sm">
        <div class="flex items-center justify-between border-b border-gray-200 pb-1.5">
          <span class="text-xs font-bold text-gray-800 flex items-center gap-1.5">
            <span class="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">${records.length - idx}</span>
            <span>รายการส่งหมายครั้งที่ ${records.length - idx}</span>
          </span>
          <span class="text-[11px] text-gray-500 font-mono">${formattedDate}</span>
        </div>

        <p class="text-xs text-gray-700 leading-relaxed">
          <i class="fa-solid fa-location-dot text-red-500 mr-1"></i>${loc}
        </p>

        <!-- Action Buttons: 2.1 เลขคดี, 2.2 พิกัด, 2.3 ดูภาพ (ถ้ามี) -->
        <div class="flex items-center gap-1.5 flex-wrap pt-1">
          <!-- 2.1 ปุ่มเลขคดี -->
          <button type="button" class="px-2.5 py-1.5 bg-blue-50 text-blue-800 rounded-lg text-xs font-bold border border-blue-200 shadow-sm inline-flex items-center gap-1">
            <i class="fa-solid fa-scale-balanced text-blue-600"></i>
            <span>${caseNumber}</span>
          </button>

          <!-- 2.2 ปุ่มพิกัด -->
          ${lat && lng ? `
            <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200 shadow-sm inline-flex items-center gap-1 transition" title="คัดลอกพิกัด">
              <i class="fa-solid fa-location-crosshairs text-emerald-600"></i>
              <span>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</span>
            </button>

            <!-- ปุ่มเปิดใน Google Maps -->
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold border border-rose-200 shadow-sm inline-flex items-center gap-1 active:scale-95 transition" title="เปิดดูตำแหน่งใน Google Maps">
              <i class="fa-solid fa-map-location-dot text-rose-600"></i>
              <span>Google Maps</span>
            </a>
          ` : ''}

          <!-- 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะเมื่อมีภาพในระบบ) -->
          ${hasImage ? `
            <button type="button" onclick="viewPhotoModal('${imgUrl}', '${caseNumber}', '${loc.replace(/'/g, "\\'")}', '${formattedDate}', '${lat}', '${lng}')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm inline-flex items-center gap-1 active:scale-95 transition">
              <i class="fa-solid fa-image"></i>
              <span>ดูภาพ</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  Swal.fire({
    title: `<div class="flex items-center justify-center gap-2 text-gray-900 font-bold text-base"><i class="fa-solid fa-layer-group text-blue-600"></i><span>รายการย่อย: ${caseNumber}</span></div>`,
    html: `
      <div class="text-left text-xs text-gray-500 mb-2.5">
        <span>พบรายการประวัติทั้งหมด <b>${records.length}</b> ครั้ง</span>
      </div>
      <div class="max-h-[60vh] overflow-y-auto space-y-3 pr-0.5">
        ${cardsHtml}
      </div>
    `,
    width: '95%',
    showCloseButton: true,
    showConfirmButton: false,
    allowOutsideClick: false
  });
};

/**
 * ดูภาพตัวอย่างขนาดเต็มจาก Manual Upload (สเกลไม่เกิน 80% ความสูงหน้าจอ)
 */
window.viewManualFullPreview = function() {
  if (!window._manualTempDataUrl) return;
  Swal.fire({
    title: 'ตัวอย่างภาพขนาดเต็ม',
    imageUrl: window._manualTempDataUrl,
    imageAlt: 'ตัวอย่างภาพ',
    showCloseButton: true,
    showConfirmButton: false,
    width: 'auto',
    customClass: {
      popup: 'p-4 rounded-2xl slts-image-preview-popup',
      image: 'slts-preview-image-constrained'
    }
  });
};

/**
 * คัดลอกพิกัด Latitude, Longitude ไปยัง Clipboard พร้อมแสดงข้อความแจ้งเตือน
 */
window.copyCoordinates = function(lat, lng) {
  if (!lat || !lng) return;
  const coordText = `${lat}, ${lng}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(coordText).then(() => {
      Swal.fire({
        icon: 'success',
        title: 'คัดลอกพิกัดแล้ว',
        html: `<span class="font-mono text-sm font-bold text-blue-600">${coordText}</span>`,
        showCloseButton: true,
        allowOutsideClick: false,
        confirmButtonColor: '#2563eb'
      });
    }).catch(() => {
      prompt('คัดลอกพิกัด:', coordText);
    });
  } else {
    prompt('คัดลอกพิกัด:', coordText);
  }
};


/**
 * แสดงภาพถ่ายเต็มด้วย SweetAlert พร้อมปุ่มดาวน์โหลด และคลิกดูเต็มหน้าจอได้ (สเกลไม่เกิน 80vh)
 */
window.viewPhotoModal = function(imgUrl, caseNumber, locationFull, timestamp, lat, lng) {
  let directImgUrl = imgUrl;
  const match = imgUrl.match(/id=([a-zA-Z0-9_-]+)/) || imgUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    directImgUrl = `https://lh3.googleusercontent.com/d/${match[1]}=w1200`;
  }

  Swal.fire({
    title: `เลขคดี: ${caseNumber}`,
    html: `
      <div class="text-left text-xs text-gray-600 mb-2.5 space-y-1">
        <p><b>📅 วันที่เวลา:</b> ${timestamp}</p>
        <p><b>🏠 ที่ตั้งส่งหมาย:</b> ${locationFull}</p>
        <p><b>📍 พิกัด GPS:</b> ${lat}, ${lng}</p>
      </div>
      <div class="relative bg-gray-900 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center min-h-[180px] max-h-[55vh] max-h-[55dvh] cursor-pointer group" onclick="openFullScreenImage('${directImgUrl}')" title="คลิกที่ภาพเพื่อเปิดดูแบบเต็มหน้าจอ">
        <img src="${directImgUrl}" alt="${caseNumber}" class="max-w-full max-h-[52vh] max-h-[52dvh] object-contain rounded-lg shadow-md transition group-hover:scale-[1.01]" onerror="this.onerror=null; this.src='${imgUrl}';">
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1.5">
          <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
          <span>คลิกที่ภาพเพื่อเปิดดูแบบเต็มหน้าจอ</span>
        </div>
      </div>
    `,
    width: '600px',
    customClass: {
      popup: 'slts-photo-detail-popup rounded-2xl'
    },
    showCloseButton: true,
    showCancelButton: true,
    allowOutsideClick: false,
    confirmButtonText: '<i class="fa-solid fa-arrow-up-right-from-square mr-1"></i> เปิดภาพใน Google Drive',
    cancelButtonText: 'ปิด',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      window.open(imgUrl, '_blank');
    }
  });
};

window.openFullScreenImage = function(imgSrc) {
  Swal.fire({
    imageUrl: imgSrc,
    imageAlt: 'ภาพขนาดเต็ม',
    showCloseButton: true,
    showConfirmButton: false,
    width: 'auto',
    padding: '0.5rem',
    background: 'rgba(0, 0, 0, 0.95)',
    customClass: {
      popup: 'border-0 rounded-2xl slts-image-preview-popup',
      image: 'slts-preview-image-constrained'
    }
  });
};

/**
 * ลบข้อมูลใน Google Sheet และลบไฟล์ใน Google Drive (เฉพาะ Admin)
 */
window.deleteRecord = function(fileId, fileName, timestamp, caseNumber, rowIndex) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    Swal.fire({
      icon: 'error',
      title: 'ไม่มีสิทธิ์',
      text: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลได้',
      showCloseButton: true,
      allowOutsideClick: false
    });
    return;
  }

  Swal.fire({
    title: `ยืนยันการลบข้อมูลเลขคดี ${caseNumber}?`,
    html: `
      <div class="text-left text-sm text-gray-700 bg-red-50 border border-red-200 p-3 rounded-xl space-y-1">
        <p class="font-bold text-red-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i> การดำเนินการนี้จะทำการ:</p>
        <p>1. ลบแถวข้อมูลใน Google Sheet ถาวร</p>
        <p>2. ย้ายไฟล์ภาพใน Google Drive ไปยังถังขยะ</p>
      </div>
    `,
    icon: 'warning',
    showCloseButton: true,
    allowOutsideClick: false,
    showCancelButton: true,
    confirmButtonText: 'ยืนยันการลบข้อมูล',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280'
  }).then(async (res) => {
    if (res.isConfirmed) {
      showCustomLoading('กำลังลบข้อมูล...', 'กำลังลบแถวใน Sheet และลบไฟล์ใน Google Drive');

      try {
        const payload = {
          action: 'delete',
          fileId: fileId,
          fileName: fileName,
          timestamp: timestamp,
          caseNumber: caseNumber,
          rowIndex: rowIndex
        };

        const response = await fetch(state.appsScriptUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(payload)
        });

        const resJson = await response.json();
        hideCustomLoading();

        if (resJson.status === 'success') {
          // ลบแคชในเครื่องด้วย
          localStorage.removeItem(CACHE_KEY_SHEET_DATA);
          localStorage.removeItem(CACHE_KEY_SHEET_TIME);

          Swal.fire({
            icon: 'success',
            title: 'ลบข้อมูลสำเร็จ',
            text: resJson.message,
            showCloseButton: true,
            allowOutsideClick: false,
            confirmButtonColor: '#2563eb'
          });
          // โหลดตารางสดใหม่ทันที
          loadGoogleSheetData(true);
        } else {
          throw new Error(resJson.message || 'ไม่สามารถลบข้อมูลได้');
        }

      } catch (err) {
        console.error('Delete error:', err);
        hideCustomLoading();
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาดในการลบ',
          text: err.message,
          showCloseButton: true,
          allowOutsideClick: false,
          confirmButtonColor: '#2563eb'
        });
      }
    }
  });
};

// =========================================================================
// 5. ฟอร์มและระบบบันทึกส่งหมาย (Summons Form & Camera)
// =========================================================================

// ค่าตั้งต้นอักษรนำหน้าเลขคดี
const DEFAULT_CASE_PREFIXES = ['อ', 'ย', 'พ', 'พE', 'ผบ', 'ผบE', 'ม', 'มE', 'มย', 'มยE', 'ร', 'รส'];

function getAllCasePrefixes() {
  const stored = JSON.parse(localStorage.getItem('slts_case_prefixes') || '[]');
  return Array.from(new Set([...DEFAULT_CASE_PREFIXES, ...stored]));
}

function initCasePrefixes() {
  const combined = getAllCasePrefixes();
  renderPrefixDatalist(combined);
}

function renderPrefixDatalist(prefixes) {
  if (!elements.udonPrefixList) return;
  elements.udonPrefixList.innerHTML = '';
  prefixes.forEach(p => {
    if (p && p.trim()) {
      const opt = document.createElement('option');
      opt.value = p.trim();
      elements.udonPrefixList.appendChild(opt);
    }
  });
}

function saveCasePrefix(prefix) {
  if (!prefix || !prefix.trim()) return;
  const clean = prefix.trim();
  let stored = JSON.parse(localStorage.getItem('slts_case_prefixes') || '[]');
  if (!DEFAULT_CASE_PREFIXES.includes(clean) && !stored.includes(clean)) {
    stored.push(clean);
    localStorage.setItem('slts_case_prefixes', JSON.stringify(stored));
    initCasePrefixes();
  }
}

function extractPrefixesFromRows(rows) {
  if (!rows || !rows.length) return;
  let stored = JSON.parse(localStorage.getItem('slts_case_prefixes') || '[]');
  let hasNew = false;

  rows.forEach(r => {
    const caseStr = r['เลขคดี'] || '';
    const m = caseStr.match(/^([a-zA-Zก-๙]+)\d+\/\d+/);
    if (m && m[1] && m[1] !== 'ต') {
      if (!DEFAULT_CASE_PREFIXES.includes(m[1]) && !stored.includes(m[1])) {
        stored.push(m[1]);
        hasNew = true;
      }
    }
  });

  if (hasNew) {
    localStorage.setItem('slts_case_prefixes', JSON.stringify(stored));
    initCasePrefixes();
  }
}

// =========================================================================
// ตัวเลือกหน่วยงานปกครองส่วนท้องถิ่น (Local Admin Agency Options)
// =========================================================================
function getLocalAdminOptions(subdistrictName = '', isBkk = false) {
  let cleanSub = (subdistrictName || '').trim();
  cleanSub = cleanSub.replace(/^(ตำบล|แขวง)/, '');
  
  const kamnanOption = cleanSub 
    ? `ที่ทำการกำนัน${isBkk ? 'แขวง' : 'ตำบล'}${cleanSub}` 
    : 'ที่ทำการกำนัน';

  const baseOptions = [
    'ที่ทำการปกครองส่วนท้องถิ่น',
    kamnanOption,
    'ที่ทำการผู้ใหญ่บ้านหมู่ที่ '
  ];

  const stored = JSON.parse(localStorage.getItem('slts_local_admin_names') || '[]');
  const customs = stored.filter(s => {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();
    return t && !baseOptions.includes(t) && !t.startsWith('ที่ทำการกำนัน') && !t.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่');
  });

  return [...baseOptions, ...customs];
}

function saveLocalAdminName(name) {
  if (!name || typeof name !== 'string') return;
  const clean = name.trim();
  if (!clean) return;
  if (clean === 'ที่ทำการปกครองส่วนท้องถิ่น' || clean.startsWith('ที่ทำการกำนัน') || clean.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่')) {
    return;
  }
  let stored = JSON.parse(localStorage.getItem('slts_local_admin_names') || '[]');
  if (!stored.includes(clean)) {
    stored.push(clean);
    localStorage.setItem('slts_local_admin_names', JSON.stringify(stored));
  }
}

// =========================================================================
// Province & Address Management System (77 จังหวัด ทั่วประเทศ)
// =========================================================================

function initProvinceSystem() {
  const savedProv = localStorage.getItem('slts_selected_province');
  state.selectedProvince = savedProv || (typeof THAILAND_PROVINCES !== 'undefined' && THAILAND_PROVINCES.length > 0 ? THAILAND_PROVINCES[0].name : 'กรุงเทพมหานคร');

  if (elements.provinceSelect) {
    elements.provinceSelect.innerHTML = '';
    if (typeof THAILAND_PROVINCES !== 'undefined') {
      THAILAND_PROVINCES.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        if (p.name === state.selectedProvince) {
          opt.selected = true;
        }
        elements.provinceSelect.appendChild(opt);
      });
    }

    elements.provinceSelect.addEventListener('change', (e) => {
      setProvince(e.target.value);
    });
  }

  updateDistricts(state.selectedProvince);
  updateFloatingProvinceBadge();

  // กำหนดประเภทศาลบน Desktop เริ่มต้น
  const savedCat = localStorage.getItem('slts_desktop_court_category') || 'ศาลจังหวัด';
  const savedCustom = localStorage.getItem('slts_desktop_court_custom_name') || '';
  setDesktopCourtType(savedCat, savedCustom, state.selectedProvince);
}

function setProvince(provinceName) {
  state.selectedProvince = provinceName;
  localStorage.setItem('slts_selected_province', provinceName);
  if (elements.provinceSelect && elements.provinceSelect.value !== provinceName) {
    elements.provinceSelect.value = provinceName;
  }
  updateDistricts(provinceName);
  updateFloatingProvinceBadge();

  // ปรับชื่อประเภทศาลบน Desktop ให้ตรงกับจังหวัดที่เลือก
  const isDesktop = window.innerWidth > 768;
  if (isDesktop) {
    const currentCat = state.desktopCourtCategory || localStorage.getItem('slts_desktop_court_category') || 'ศาลจังหวัด';
    if (currentCat !== 'ศาลที่ไม่สังกัดภาค' && currentCat !== 'ศาลอื่น' && currentCat !== 'หมายศาลอื่น') {
      setDesktopCourtType(currentCat, '', provinceName);
    }
  }

  // ปรับการกรองตารางประวัติส่งหมายตามจังหวัดใหม่ทันที
  if (state.allSheetRows && state.allSheetRows.length > 0) {
    renderDataTable(state.allSheetRows);
  }
}

function updateFloatingProvinceBadge() {
  if (elements.floatingProvinceName) {
    elements.floatingProvinceName.textContent = state.selectedProvince ? `จ.${state.selectedProvince}` : 'เลือกจังหวัด';
  }
}

function updateDistricts(provinceName, selectDistrict = null) {
  if (!elements.districtSelect) return;
  const districts = getDistrictsByProvince(provinceName);
  elements.districtSelect.innerHTML = '';
  districts.forEach(district => {
    const opt = document.createElement('option');
    opt.value = district;
    opt.textContent = district;
    elements.districtSelect.appendChild(opt);
  });

  const chosenDistrict = selectDistrict && districts.includes(selectDistrict) ? selectDistrict : (districts[0] || '');
  if (chosenDistrict) {
    elements.districtSelect.value = chosenDistrict;
  }
  updateSubdistricts(provinceName, chosenDistrict);

  elements.districtSelect.onchange = (e) => {
    updateSubdistricts(state.selectedProvince || provinceName, e.target.value);
  };
}

function updateSubdistricts(provinceName, districtName, selectSubdistrict = null) {
  if (!elements.subdistrictSelect) return;
  const subdistricts = getSubdistrictsByDistrict(provinceName, districtName);
  elements.subdistrictSelect.innerHTML = '';
  subdistricts.forEach(sub => {
    const opt = document.createElement('option');
    opt.value = sub;
    opt.textContent = sub;
    elements.subdistrictSelect.appendChild(opt);
  });
  if (selectSubdistrict && subdistricts.includes(selectSubdistrict)) {
    elements.subdistrictSelect.value = selectSubdistrict;
  }
}

// -------------------------------------------------------------------------
// Modal เลือกจังหวัด (77 จังหวัด)
// -------------------------------------------------------------------------
window.showProvinceSelectorModal = function(force = false) {
  let provincesHtml = '';
  if (typeof THAILAND_PROVINCES !== 'undefined') {
    THAILAND_PROVINCES.forEach(p => {
      const isSelected = p.name === state.selectedProvince;
      provincesHtml += `
        <button type="button" class="province-btn-item ${isSelected ? 'province-btn-selected' : ''}" onclick="selectProvinceAndProceed('${p.name}')">
          ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-xs shrink-0"></i>' : '<span class="province-btn-dot"></span>'}
          <span class="flex-1 text-left">${p.name}</span>
        </button>
      `;
    });
  }

  Swal.fire({
    html: `
      <div class="slts-province-modal">
        <!-- Header -->
        <div class="slts-modal-header">
          ${!force && state.selectedProvince ? `
            <button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
              <i class="fa-solid fa-arrow-left"></i>
              <span>กลับ</span>
            </button>
          ` : `
            <div class="slts-modal-header-icon">
              <i class="fa-solid fa-map-location-dot"></i>
            </div>
          `}
          <div class="flex-1 ${!force && state.selectedProvince ? 'text-center pr-8' : ''}">
            <h2 class="slts-modal-title">เลือกจังหวัดปฏิบัติงาน</h2>
            <p class="slts-modal-subtitle">ระบบจะบันทึกจังหวัดไว้สำหรับการใช้งานครั้งต่อไป</p>
          </div>
        </div>
        <!-- Search -->
        <div class="slts-search-wrap">
          <i class="fa-solid fa-magnifying-glass slts-search-icon"></i>
          <input type="text" id="swalProvinceSearchInput" placeholder="ค้นหาจังหวัด เช่น อุดรธานี, กรุงเทพ..." class="slts-search-input" oninput="filterProvinceList(this.value)" autocomplete="off">
        </div>
        <!-- Province grid -->
        <div id="swalProvinceGrid" class="slts-province-grid slts-swal-body-scroll">
          ${provincesHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>สามารถเปลี่ยนจังหวัดได้ภายหลังจากปุ่มที่มุมขวาล่าง</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: !force && !!state.selectedProvince,
    allowOutsideClick: !force && !!state.selectedProvince,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding',
      closeButton: 'slts-close-btn'
    },
    didOpen: () => {
      const popup = document.querySelector('.swal2-popup');
      const grid = document.getElementById('swalProvinceGrid');
      const searchInput = document.getElementById('swalProvinceSearchInput');
      if (!popup) return;

      const adjustProvinceModal = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const maxH = Math.max(160, Math.floor(vh - 16));
        popup.style.maxHeight = `${maxH}px`;
        if (grid) {
          grid.style.maxHeight = `${Math.max(80, maxH - 115)}px`;
        }
      };

      adjustProvinceModal();

      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener('resize', adjustProvinceModal);
        vv.addEventListener('scroll', adjustProvinceModal);
        popup._vvResizeHandler = adjustProvinceModal;
      }

      if (searchInput) {
        searchInput.addEventListener('focus', () => {
          setTimeout(adjustProvinceModal, 150);
        });
      }
    },
    didClose: () => {
      const vv = window.visualViewport;
      const popup = document.querySelector('.swal2-popup');
      if (vv && popup?._vvResizeHandler) {
        vv.removeEventListener('resize', popup._vvResizeHandler);
        vv.removeEventListener('scroll', popup._vvResizeHandler);
      }
    }
  });
};

window.filterProvinceList = function(query) {
  const grid = document.getElementById('swalProvinceGrid');
  if (!grid) return;
  const q = (query || '').trim().toLowerCase();
  const buttons = grid.querySelectorAll('.province-btn-item');
  buttons.forEach(btn => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = text.includes(q) ? '' : 'none';
  });
};

window.selectProvinceAndProceed = function(provinceName) {
  setProvince(provinceName);
  Swal.close();
  
  const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 1200,
    timerProgressBar: true
  });
  Toast.fire({
    icon: 'success',
    title: `ตั้งค่า จ.${provinceName} เรียบร้อยแล้ว`
  });

  // ทั้ง Mobile (< 768px) และ Desktop (> 768px): เมื่อเลือกจังหวัดแล้ว ให้แสดงหน้าต่าง "เลือกประเภทศาล" ทันที
  setTimeout(() => {
    showCourtTypeSelectorModal(provinceName, false);
  }, 250);
};

/**
 * Modal เลือกประเภทศาล (ใช้ร่วมกันทั้งหน้าจอมือถือ < 768px และคอมพิวเตอร์ > 768px)
 * มี 5 ตัวเลือก: ศาลที่ไม่สังกัดภาค, ศาลจังหวัด, ศาลแขวง, ศาลเยาวชนและครอบครัว, หมายศาลอื่น
 */
window.showCourtTypeSelectorModal = function(provinceName, isReturnToForm = false) {
  const prov = provinceName || state.selectedProvince || 'อุดรธานี';
  const curCategory = state.selectedCourtCategory || state.desktopCourtCategory || localStorage.getItem('slts_selected_court_category') || 'ศาลจังหวัด';

  const courtOptions = [
    {
      id: 'unaffiliated',
      category: 'ศาลที่ไม่สังกัดภาค',
      title: 'ศาลที่ไม่สังกัดภาค',
      desc: 'เช่น ศาลแพ่ง, ศาลอาญา, ศาลล้มละลายกลาง ฯลฯ (ระบุชื่อศาลเอง)',
      icon: 'fa-building-columns',
      color: 'text-indigo-600',
      badge: 'ต้องระบุชื่อศาล'
    },
    {
      id: 'provincial',
      category: 'ศาลจังหวัด',
      title: `ศาลจังหวัด${prov}`,
      desc: `ศาลประจำจังหวัด${prov}`,
      icon: 'fa-scale-balanced',
      color: 'text-blue-600',
      badge: 'ศาลจังหวัด'
    },
    {
      id: 'district',
      category: 'ศาลแขวง',
      title: `ศาลแขวง${prov}`,
      desc: `ศาลแขวงประจำจังหวัด${prov}`,
      icon: 'fa-landmark',
      color: 'text-emerald-600',
      badge: 'ศาลแขวง'
    },
    {
      id: 'juvenile',
      category: 'ศาลเยาวชนและครอบครัว',
      title: `ศาลเยาวชนและครอบครัวจังหวัด${prov}`,
      desc: `ศาลเยาวชนและครอบครัวประจำจังหวัด${prov}`,
      icon: 'fa-people-roof',
      color: 'text-amber-600',
      badge: 'ศาลเยาวชนฯ'
    },
    {
      id: 'other',
      category: 'ศาลอื่น',
      title: 'หมายศาลอื่น',
      desc: 'หมายบังคับคดี / หมาย ต. ข้ามเขต',
      icon: 'fa-envelope-open-text',
      color: 'text-rose-600',
      badge: 'หมาย ต.'
    }
  ];

  let listHtml = '';
  courtOptions.forEach(opt => {
    const isSelected = curCategory === opt.category;
    listHtml += `
      <button type="button" class="province-btn-item flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50/60 transition text-left group w-full ${isSelected ? 'province-btn-selected bg-blue-50/80 border-blue-500 shadow-sm' : 'bg-white'}" onclick="selectCourtTypeChoice('${opt.category}', '${prov}', ${isReturnToForm})">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 group-hover:bg-blue-100 group-hover:text-blue-600'} shrink-0 transition">
          <i class="fa-solid ${opt.icon} text-base"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-gray-900 leading-snug">${opt.title}</span>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${isSelected ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-600'}">${opt.badge}</span>
          </div>
          <p class="text-xs text-gray-500 truncate mt-0.5">${opt.desc}</p>
        </div>
        <div class="shrink-0 text-gray-400 group-hover:text-blue-600">
          ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-base"></i>' : '<i class="fa-solid fa-chevron-right text-xs"></i>'}
        </div>
      </button>
    `;
  });

  const headerLeftIcon = isReturnToForm
    ? `<button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
         <i class="fa-solid fa-arrow-left"></i>
         <span>กลับ</span>
       </button>`
    : `<div class="slts-modal-header-icon"><i class="fa-solid fa-gavel"></i></div>`;

  Swal.fire({
    html: `
      <div class="slts-province-modal text-left">
        <!-- Header -->
        <div class="slts-modal-header">
          ${headerLeftIcon}
          <div class="flex-1 ${isReturnToForm ? 'text-center pr-8' : ''}">
            <h2 class="slts-modal-title">เลือกประเภทศาล</h2>
            <p class="slts-modal-subtitle">จังหวัด ${prov}</p>
          </div>
        </div>
        <!-- Court List -->
        <div class="space-y-2 py-2 max-h-[60vh] overflow-y-auto slts-swal-body-scroll pr-1">
          ${listHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>สามารถคลิกปุ่ม "เปลี่ยนประเภทศาล" บนแบบฟอร์มเพื่อแก้ไขได้ตลอดเวลา</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: true,
    allowOutsideClick: true,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding',
      closeButton: 'slts-close-btn'
    }
  });
};

// Aliases for compatibility
window.showDesktopCourtTypeSelectorModal = window.showCourtTypeSelectorModal;
window.selectDesktopCourtType = function(category, provinceName) {
  selectCourtTypeChoice(category, provinceName, false);
};

window.selectCourtTypeChoice = function(category, provinceName, isReturnToForm = false) {
  const isDesktop = window.innerWidth > 768;

  if (category === 'ศาลที่ไม่สังกัดภาค') {
    Swal.fire({
      title: 'ระบุชื่อศาลที่ไม่สังกัดภาค',
      html: `
        <div class="text-left space-y-2 pt-2">
          <p class="text-xs text-gray-600">กรุณาระบุชื่อศาลที่ต้องการบันทึก เช่น <b>ศาลแพ่ง, ศาลอาญา, ศาลล้มละลายกลาง, ศาลทรัพย์สินทางปัญญาและการค้าระหว่างประเทศกลาง</b></p>
          <input type="text" id="swalCustomCourtName" placeholder="พิมพ์ชื่อศาล เช่น ศาลแพ่ง" class="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm font-bold text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'ตกลง',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#2563eb',
      preConfirm: () => {
        const val = document.getElementById('swalCustomCourtName')?.value.trim();
        if (!val) {
          Swal.showValidationMessage('กรุณาระบุชื่อศาล');
          return false;
        }
        return val;
      }
    }).then((res) => {
      if (res.isConfirmed && res.value) {
        applyCourtTypeSettings('ศาลที่ไม่สังกัดภาค', res.value, provinceName);
        if (!isDesktop) {
          showMobileSummonsFormModal(isReturnToForm);
        } else {
          Swal.fire({
            icon: 'success',
            title: 'ตั้งค่าประเภทศาลเรียบร้อย',
            text: `เลือก: ${res.value}`,
            timer: 1200,
            showConfirmButton: false
          });
        }
      }
    });
  } else {
    applyCourtTypeSettings(category, '', provinceName);
    Swal.close();
    
    let displayName = '';
    if (category === 'ศาลจังหวัด') displayName = `ศาลจังหวัด${provinceName}`;
    else if (category === 'ศาลแขวง') displayName = `ศาลแขวง${provinceName}`;
    else if (category === 'ศาลเยาวชนและครอบครัว') displayName = `ศาลเยาวชนและครอบครัวจังหวัด${provinceName}`;
    else displayName = 'หมายศาลอื่น (หมาย ต.)';

    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 1000,
      timerProgressBar: true
    });
    Toast.fire({
      icon: 'success',
      title: `เลือก: ${displayName}`
    });

    if (!isDesktop) {
      setTimeout(() => {
        showMobileSummonsFormModal(isReturnToForm);
      }, 150);
    }
  }
};

/**
 * ใช้งานการตั้งค่าประเภทศาลทั้งระบบ (Mobile & Desktop)
 */
window.applyCourtTypeSettings = function(category, customName = '', provinceName = state.selectedProvince || 'อุดรธานี') {
  state.selectedCourtCategory = category;
  state.desktopCourtCategory = category;
  localStorage.setItem('slts_selected_court_category', category);
  localStorage.setItem('slts_desktop_court_category', category);

  let finalName = '';
  if (category === 'ศาลที่ไม่สังกัดภาค') {
    finalName = customName || 'ศาลแพ่ง';
    if (customName) localStorage.setItem('slts_custom_court_name', customName);
  } else if (category === 'ศาลจังหวัด') {
    finalName = `ศาลจังหวัด${provinceName}`;
  } else if (category === 'ศาลแขวง') {
    finalName = `ศาลแขวง${provinceName}`;
  } else if (category === 'ศาลเยาวชนและครอบครัว') {
    finalName = `ศาลเยาวชนและครอบครัวจังหวัด${provinceName}`;
  } else {
    finalName = 'หมายศาลอื่น (หมาย ต.)';
  }

  state.selectedCourtName = finalName;
  localStorage.setItem('slts_selected_court_name', finalName);

  if (!state.tempModalValues) state.tempModalValues = {};
  state.tempModalValues.courtCategory = category;
  state.tempModalValues.courtType = category === 'ศาลอื่น' ? 'ศาลอื่น' : category;
  state.tempModalValues.courtName = finalName;

  setDesktopCourtType(category, customName, provinceName);
};

/**
 * ตั้งค่าประเภทศาลบน Desktop Form
 * @param {string} category - 'ศาลที่ไม่สังกัดภาค' | 'ศาลจังหวัด' | 'ศาลแขวง' | 'ศาลเยาวชนและครอบครัว' | 'ศาลอื่น'
 * @param {string} customName - ชื่อศาลกรณีระบุเอง
 * @param {string} provinceName - ชื่อจังหวัด
 */
window.setDesktopCourtType = function(category, customName = '', provinceName = state.selectedProvince || 'อุดรธานี') {
  const courtNameInput = document.getElementById('courtNameInput');
  const courtTypeHidden = document.getElementById('courtType');
  const courtTypeHelp = document.getElementById('courtTypeHelpText');
  const udonCaseField = elements.udonCaseField || document.getElementById('udonCaseField');
  const otherCourtCaseField = elements.otherCourtCaseField || document.getElementById('otherCourtCaseField');

  state.desktopCourtCategory = category;
  localStorage.setItem('slts_desktop_court_category', category);

  if (category === 'ศาลที่ไม่สังกัดภาค') {
    const finalName = customName || 'ศาลแพ่ง';
    if (courtNameInput) {
      courtNameInput.value = customName || '';
      courtNameInput.readOnly = false;
      courtNameInput.classList.remove('bg-gray-100', 'cursor-default');
      courtNameInput.classList.add('bg-white', 'cursor-text');
      courtNameInput.placeholder = 'ระบุชื่อศาลที่ไม่สังกัดภาค เช่น ศาลแพ่ง, ศาลอาญา';
      courtNameInput.focus();
    }
    if (courtTypeHidden) courtTypeHidden.value = customName || 'ศาลที่ไม่สังกัดภาค';
    if (courtTypeHelp) {
      courtTypeHelp.textContent = '* ศาลที่ไม่สังกัดภาค: โปรดระบุชื่อศาลในกล่องข้อความ เช่น ศาลแพ่ง, ศาลอาญา, ศาลล้มละลายกลาง';
      courtTypeHelp.classList.remove('hidden');
    }
    if (udonCaseField) udonCaseField.classList.remove('hidden');
    if (otherCourtCaseField) {
      otherCourtCaseField.classList.add('hidden');
      otherCourtCaseField.classList.remove('flex');
    }
    if (customName) localStorage.setItem('slts_desktop_court_custom_name', customName);
  } else if (category === 'ศาลจังหวัด') {
    const name = `ศาลจังหวัด${provinceName}`;
    if (courtNameInput) {
      courtNameInput.value = name;
      courtNameInput.readOnly = true;
      courtNameInput.classList.add('bg-gray-100', 'cursor-default');
      courtNameInput.classList.remove('bg-white', 'cursor-text');
    }
    if (courtTypeHidden) courtTypeHidden.value = name;
    if (courtTypeHelp) courtTypeHelp.classList.add('hidden');
    if (udonCaseField) udonCaseField.classList.remove('hidden');
    if (otherCourtCaseField) {
      otherCourtCaseField.classList.add('hidden');
      otherCourtCaseField.classList.remove('flex');
    }
  } else if (category === 'ศาลแขวง') {
    const name = `ศาลแขวง${provinceName}`;
    if (courtNameInput) {
      courtNameInput.value = name;
      courtNameInput.readOnly = true;
      courtNameInput.classList.add('bg-gray-100', 'cursor-default');
      courtNameInput.classList.remove('bg-white', 'cursor-text');
    }
    if (courtTypeHidden) courtTypeHidden.value = name;
    if (courtTypeHelp) courtTypeHelp.classList.add('hidden');
    if (udonCaseField) udonCaseField.classList.remove('hidden');
    if (otherCourtCaseField) {
      otherCourtCaseField.classList.add('hidden');
      otherCourtCaseField.classList.remove('flex');
    }
  } else if (category === 'ศาลเยาวชนและครอบครัว') {
    const name = `ศาลเยาวชนและครอบครัวจังหวัด${provinceName}`;
    if (courtNameInput) {
      courtNameInput.value = name;
      courtNameInput.readOnly = true;
      courtNameInput.classList.add('bg-gray-100', 'cursor-default');
      courtNameInput.classList.remove('bg-white', 'cursor-text');
    }
    if (courtTypeHidden) courtTypeHidden.value = name;
    if (courtTypeHelp) courtTypeHelp.classList.add('hidden');
    if (udonCaseField) udonCaseField.classList.remove('hidden');
    if (otherCourtCaseField) {
      otherCourtCaseField.classList.add('hidden');
      otherCourtCaseField.classList.remove('flex');
    }
  } else if (category === 'ศาลอื่น' || category === 'หมายศาลอื่น') {
    const name = 'หมายศาลอื่น (หมาย ต.)';
    if (courtNameInput) {
      courtNameInput.value = name;
      courtNameInput.readOnly = true;
      courtNameInput.classList.add('bg-gray-100', 'cursor-default');
      courtNameInput.classList.remove('bg-white', 'cursor-text');
    }
    if (courtTypeHidden) courtTypeHidden.value = 'ศาลอื่น';
    if (courtTypeHelp) courtTypeHelp.classList.add('hidden');
    if (udonCaseField) udonCaseField.classList.add('hidden');
    if (otherCourtCaseField) {
      otherCourtCaseField.classList.remove('hidden');
      otherCourtCaseField.classList.add('flex');
      if (elements.otherCaseNoInput) elements.otherCaseNoInput.focus();
    }
  }
};

// -------------------------------------------------------------------------
// Helper เก็บสถานะ Form ที่ผู้ใช้กำลังกรอกไว้ชั่วคราว
// -------------------------------------------------------------------------
window.saveTempModalFormState = function() {
  const cType = document.getElementById('m_courtType')?.value;
  const cName = document.getElementById('m_courtNameInput')?.value;
  const pref = document.getElementById('m_prefix')?.value;
  const cNo = document.getElementById('m_caseNo')?.value;
  const cYear = document.getElementById('m_caseYear')?.value;
  const oNo = document.getElementById('m_otherCaseNo')?.value;
  const oYear = document.getElementById('m_otherCaseYear')?.value;
  const cExtra = document.getElementById('m_caseExtra')?.value;
  const lType = document.getElementById('m_locType')?.value;
  const hNo = document.getElementById('m_houseNo')?.value;
  const moo = document.getElementById('m_moo')?.value;
  const admName = document.getElementById('m_adminName')?.value;
  const oLoc = document.getElementById('m_otherLocName')?.value;
  const coords = document.getElementById('m_coords')?.value;

  state.tempModalValues = {
    courtCategory: cType !== undefined ? cType : (state.tempModalValues?.courtCategory || 'ศาลจังหวัด'),
    courtType: cType !== undefined ? cType : (state.tempModalValues?.courtType || 'ศาลจังหวัด'),
    courtName: cName !== undefined ? cName : (state.tempModalValues?.courtName || ''),
    prefix: pref !== undefined ? pref : (state.tempModalValues?.prefix || ''),
    caseNo: cNo !== undefined ? cNo : (state.tempModalValues?.caseNo || ''),
    caseYear: cYear !== undefined ? cYear : (state.tempModalValues?.caseYear || ''),
    otherCaseNo: oNo !== undefined ? oNo : (state.tempModalValues?.otherCaseNo || ''),
    otherCaseYear: oYear !== undefined ? oYear : (state.tempModalValues?.otherCaseYear || ''),
    caseExtra: cExtra !== undefined ? cExtra : (state.tempModalValues?.caseExtra || ''),
    locType: lType !== undefined ? lType : (state.tempModalValues?.locType || 'หมายบ้าน'),
    houseNo: hNo !== undefined ? hNo : (state.tempModalValues?.houseNo || ''),
    moo: moo !== undefined ? moo : (state.tempModalValues?.moo || ''),
    adminName: admName !== undefined ? admName : (state.tempModalValues?.adminName || ''),
    otherLocName: oLoc !== undefined ? oLoc : (state.tempModalValues?.otherLocName || ''),
    coords: coords !== undefined ? coords : (state.tempModalValues?.coords || '')
  };
};

// -------------------------------------------------------------------------
// Modal เลือกอำเภอ (เฉพาะในจังหวัดที่เลือก)
// -------------------------------------------------------------------------
window.showDistrictSelectorModal = function() {
  const prov = state.selectedProvince;
  if (!prov) {
    showProvinceSelectorModal(true);
    return;
  }
  const districts = getDistrictsByProvince(prov);
  const curDistrict = elements.districtSelect?.value || districts[0] || '';

  let districtsHtml = '';
  districts.forEach(d => {
    const isSelected = d === curDistrict;
    districtsHtml += `
      <button type="button" class="province-btn-item ${isSelected ? 'province-btn-selected' : ''}" onclick="selectDistrictAndReturn('${d}')">
        ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-xs shrink-0"></i>' : '<span class="province-btn-dot"></span>'}
        <span class="flex-1 text-left">${d}</span>
      </button>
    `;
  });

  Swal.fire({
    html: `
      <div class="slts-province-modal">
        <!-- Header with Back Button -->
        <div class="slts-modal-header">
          <button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
            <i class="fa-solid fa-arrow-left"></i>
            <span>กลับ</span>
          </button>
          <div class="flex-1 text-center pr-8">
            <h2 class="slts-modal-title">เลือกอำเภอ / เขต</h2>
            <p class="slts-modal-subtitle">📍 จังหวัด${prov}</p>
          </div>
        </div>
        <!-- Search -->
        <div class="slts-search-wrap">
          <i class="fa-solid fa-magnifying-glass slts-search-icon"></i>
          <input type="text" id="swalDistrictSearchInput" placeholder="ค้นหาอำเภอ / เขต ใน จ.${prov}..." class="slts-search-input" oninput="filterDistrictList(this.value)" autocomplete="off">
        </div>
        <!-- District grid -->
        <div id="swalDistrictGrid" class="slts-province-grid slts-swal-body-scroll">
          ${districtsHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>แสดงเฉพาะอำเภอ / เขต ในขอบเขตจังหวัด${prov}</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    },
    didOpen: () => {
      const popup = document.querySelector('.swal2-popup');
      const grid = document.getElementById('swalDistrictGrid');
      const searchInput = document.getElementById('swalDistrictSearchInput');
      if (!popup) return;

      const adjustDistrictModal = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const maxH = Math.max(160, Math.floor(vh - 16));
        popup.style.maxHeight = `${maxH}px`;
        if (grid) {
          grid.style.maxHeight = `${Math.max(80, maxH - 115)}px`;
        }
      };

      adjustDistrictModal();

      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener('resize', adjustDistrictModal);
        vv.addEventListener('scroll', adjustDistrictModal);
        popup._vvResizeHandler = adjustDistrictModal;
      }

      if (searchInput) {
        searchInput.addEventListener('focus', () => {
          setTimeout(adjustDistrictModal, 150);
        });
      }
    },
    didClose: () => {
      const vv = window.visualViewport;
      const popup = document.querySelector('.swal2-popup');
      if (vv && popup?._vvResizeHandler) {
        vv.removeEventListener('resize', popup._vvResizeHandler);
        vv.removeEventListener('scroll', popup._vvResizeHandler);
      }
    }
  });
};

window.filterDistrictList = function(query) {
  const grid = document.getElementById('swalDistrictGrid');
  if (!grid) return;
  const q = (query || '').trim().toLowerCase();
  const buttons = grid.querySelectorAll('.province-btn-item');
  buttons.forEach(btn => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = text.includes(q) ? '' : 'none';
  });
};

window.selectDistrictAndReturn = function(districtName) {
  const prov = state.selectedProvince;
  if (elements.districtSelect) {
    elements.districtSelect.value = districtName;
  }
  const subdistricts = getSubdistrictsByDistrict(prov, districtName);
  const firstSub = subdistricts[0] || '';
  if (elements.subdistrictSelect) {
    updateSubdistricts(prov, districtName, firstSub);
  }
  showMobileSummonsFormModal(true);
};

// -------------------------------------------------------------------------
// Modal เลือกตำบล (เฉพาะในอำเภอที่เลือก)
// -------------------------------------------------------------------------
window.showSubdistrictSelectorModal = function() {
  const prov = state.selectedProvince;
  if (!prov) {
    showProvinceSelectorModal(true);
    return;
  }
  const districts = getDistrictsByProvince(prov);
  const curDistrict = elements.districtSelect?.value || districts[0] || '';
  const subdistricts = getSubdistrictsByDistrict(prov, curDistrict);
  const curSubdistrict = elements.subdistrictSelect?.value || subdistricts[0] || '';

  let subdistrictsHtml = '';
  subdistricts.forEach(s => {
    const isSelected = s === curSubdistrict;
    subdistrictsHtml += `
      <button type="button" class="province-btn-item ${isSelected ? 'province-btn-selected' : ''}" onclick="selectSubdistrictAndReturn('${s}')">
        ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-xs shrink-0"></i>' : '<span class="province-btn-dot"></span>'}
        <span class="flex-1 text-left">${s}</span>
      </button>
    `;
  });

  Swal.fire({
    html: `
      <div class="slts-province-modal">
        <!-- Header with Back Button -->
        <div class="slts-modal-header">
          <button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
            <i class="fa-solid fa-arrow-left"></i>
            <span>กลับ</span>
          </button>
          <div class="flex-1 text-center pr-8">
            <h2 class="slts-modal-title">เลือกตำบล / แขวง</h2>
            <p class="slts-modal-subtitle">📍 อ.${curDistrict} จ.${prov}</p>
          </div>
        </div>
        <!-- Search -->
        <div class="slts-search-wrap">
          <i class="fa-solid fa-magnifying-glass slts-search-icon"></i>
          <input type="text" id="swalSubdistrictSearchInput" placeholder="ค้นหาตำบล / แขวง ใน อ.${curDistrict}..." class="slts-search-input" oninput="filterSubdistrictList(this.value)" autocomplete="off">
        </div>
        <!-- Subdistrict grid -->
        <div id="swalSubdistrictGrid" class="slts-province-grid slts-swal-body-scroll">
          ${subdistrictsHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>แสดงเฉพาะตำบล / แขวง ในขอบเขตอำเภอ${curDistrict}</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    },
    didOpen: () => {
      const popup = document.querySelector('.swal2-popup');
      const grid = document.getElementById('swalSubdistrictGrid');
      const searchInput = document.getElementById('swalSubdistrictSearchInput');
      if (!popup) return;

      const adjustSubdistrictModal = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const maxH = Math.max(160, Math.floor(vh - 16));
        popup.style.maxHeight = `${maxH}px`;
        if (grid) {
          grid.style.maxHeight = `${Math.max(80, maxH - 115)}px`;
        }
      };

      adjustSubdistrictModal();

      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener('resize', adjustSubdistrictModal);
        vv.addEventListener('scroll', adjustSubdistrictModal);
        popup._vvResizeHandler = adjustSubdistrictModal;
      }

      if (searchInput) {
        searchInput.addEventListener('focus', () => {
          setTimeout(adjustSubdistrictModal, 150);
        });
      }
    },
    didClose: () => {
      const vv = window.visualViewport;
      const popup = document.querySelector('.swal2-popup');
      if (vv && popup?._vvResizeHandler) {
        vv.removeEventListener('resize', popup._vvResizeHandler);
        vv.removeEventListener('scroll', popup._vvResizeHandler);
      }
    }
  });
};

window.filterSubdistrictList = function(query) {
  const grid = document.getElementById('swalSubdistrictGrid');
  if (!grid) return;
  const q = (query || '').trim().toLowerCase();
  const buttons = grid.querySelectorAll('.province-btn-item');
  buttons.forEach(btn => {
    const text = btn.textContent.toLowerCase();
    btn.style.display = text.includes(q) ? '' : 'none';
  });
};

window.selectSubdistrictAndReturn = function(subdistrictName) {
  if (elements.subdistrictSelect) {
    elements.subdistrictSelect.value = subdistrictName;
  }
  showMobileSummonsFormModal(true);
};

// -------------------------------------------------------------------------
// Helper คัดลอก/Autofill ข้อมูลจากประวัติที่ค้นหามาใส่ในฟอร์ม
// -------------------------------------------------------------------------
window.autofillModalFormFromRecord = function(caseNumber, district, subdistrict, locType, houseNo, moo, adminName, otherLoc) {
  const prov = state.selectedProvince;
  if (district && elements.districtSelect) {
    elements.districtSelect.value = district;
    updateSubdistricts(prov, district, subdistrict || null);
  }

  let courtType = 'ศาลประจำจังหวัด';
  let prefix = 'ผบE';
  let cNo = '';
  let cYear = new Date().getFullYear() + 543;
  let oNo = '';
  let oYear = new Date().getFullYear() + 543;

  if (caseNumber.startsWith('ต')) {
    courtType = 'ศาลอื่น';
    const match = caseNumber.match(/ต\s*(\d+)\/(\d+)/);
    if (match) {
      oNo = match[1];
      oYear = match[2];
    }
  } else {
    courtType = 'ศาลประจำจังหวัด';
    const match = caseNumber.match(/([^\d\s\/]+)\s*(\d+)\/(\d+)/);
    if (match) {
      prefix = match[1];
      cNo = match[2];
      cYear = match[3];
    }
  }

  state.tempModalValues = {
    courtType: courtType,
    prefix: prefix,
    caseNo: cNo,
    caseYear: cYear,
    otherCaseNo: oNo,
    otherCaseYear: oYear,
    locType: locType || 'หมายบ้าน',
    houseNo: houseNo || '',
    moo: moo || '',
    adminName: adminName || '',
    otherLocName: otherLoc || '',
    coords: document.getElementById('m_coords')?.value || ''
  };

  showMobileSummonsFormModal(true);
};

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// SweetAlert Popup ค้นหาประวัติส่งหมายบน Mobile (< 768px)
// -------------------------------------------------------------------------
window.showMobileHistorySearchModal = async function() {
  if (!navigator.onLine) {
    Swal.fire({
      icon: 'info',
      title: 'โหมดออฟไลน์',
      text: 'การค้นหาประวัติการส่งหมายสามารถใช้งานได้เฉพาะเมื่อเชื่อมต่ออินเทอร์เน็ตเท่านั้น',
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#2563eb'
    });
    return;
  }

  const prov = state.selectedProvince || 'อุดรธานี';

  // หากยังไม่มีข้อมูล ให้ตรวจสอบจาก LocalStorage หรือดึงจาก Google Sheet ทันที
  if (!state.allSheetRows || state.allSheetRows.length === 0) {
    const cachedStr = localStorage.getItem(CACHE_KEY_SHEET_DATA);
    if (cachedStr) {
      try {
        state.allSheetRows = JSON.parse(cachedStr);
      } catch (e) {}
    }
  }

  if (!state.allSheetRows || state.allSheetRows.length === 0) {
    showCustomLoading('กำลังดึงข้อมูลประวัติส่งหมาย...', 'กรุณารอสักครู่ ระบบกำลังเชื่อมต่อ Google Sheet');
    try {
      await loadGoogleSheetData(false);
    } catch (err) {
      console.warn('Failed to load sheet data for search modal:', err);
    }
    hideCustomLoading();
  }

  const allRows = state.allSheetRows || [];

  // กรองเฉพาะข้อมูลของจังหวัดปัจจุบันเท่านั้น
  const provRows = allRows.filter(r => getRowProvince(r) === prov);

  // จัดกลุ่มตามเลขคดี
  const caseGroups = new Map();
  provRows.forEach(r => {
    const cNo = (r['เลขคดี'] || '').trim();
    if (!cNo) return;
    if (!caseGroups.has(cNo)) {
      caseGroups.set(cNo, []);
    }
    caseGroups.get(cNo).push(r);
  });

  let cardsHtml = '';
  if (caseGroups.size === 0) {
    cardsHtml = `
      <div class="p-8 text-center text-gray-400">
        <i class="fa-solid fa-folder-open text-3xl mb-2 text-gray-300"></i>
        <p class="text-xs font-semibold">ยังไม่มีประวัติการส่งหมายใน จ.${prov}</p>
        <p class="text-[10px] text-gray-400 mt-1">ท่านสามารถบันทึกข้อมูลและถ่ายภาพส่งหมายใหม่ได้ทันที</p>
      </div>
    `;
  } else {
    caseGroups.forEach((records, caseNum) => {
      const latest = records[0];
      const timeStr = formatThaiDateDisplay(latest['วัน-เวลาบันทึก'] || latest['Timestamp'] || '');
      const district = latest['อำเภอ'] || '';
      const subdistrict = latest['ตำบล'] || '';
      const locText = latest['ที่ตั้งส่งหมาย (เต็ม)'] || latest['ที่ตั้งส่งหมาย'] || '';
      const locType = latest['ประเภทสถานที่'] || 'หมายบ้าน';
      const houseNo = latest['บ้านเลขที่'] || '';
      const moo = latest['หมู่ที่'] || '';
      const adminName = latest['ชื่อหน่วยงาน/ที่ทำการ'] || '';
      const otherLoc = latest['สถานที่อื่นๆ'] || '';
      const lat = latest['ละติจูด (Lat)'] || latest['ละติจูด'] || '';
      const lng = latest['ลองจิจูด (Lng)'] || latest['ลองจิจูด'] || '';
      const imgUrl = latest['ลิงก์รูปภาพใน Google Drive'] || latest['ลิงก์รูปภาพ'] || '';

      const safeCase = caseNum.replace(/'/g, "\\'");
      const safeDist = district.replace(/'/g, "\\'");
      const safeSub = subdistrict.replace(/'/g, "\\'");
      const safeLocType = locType.replace(/'/g, "\\'");
      const safeHouse = houseNo.replace(/'/g, "\\'");
      const safeMoo = moo.replace(/'/g, "\\'");
      const safeAdmin = adminName.replace(/'/g, "\\'");
      const safeOther = otherLoc.replace(/'/g, "\\'");

      const searchTerms = `${caseNum} ${district} ${subdistrict} ${locText} ${houseNo} ${moo} ${adminName} ${otherLoc}`.toLowerCase();

      // กรณีมีมากกว่า 1 รายการส่งหมาย
      if (records.length > 1) {
        cardsHtml += `
          <div class="slts-history-card border-indigo-200 hover:border-indigo-400" data-search="${searchTerms}">
            <div class="flex items-start justify-between gap-2 mb-1.5">
              <div>
                <span class="slts-history-caseno">${caseNum}</span>
                <span class="slts-history-date"><i class="fa-regular fa-clock text-[9px] mr-1"></i>ส่งล่าสุด: ${timeStr}</span>
              </div>
              <span class="slts-history-badge bg-indigo-50 text-indigo-700 border-indigo-200">
                <i class="fa-solid fa-clock-rotate-left mr-1"></i>ส่งแล้ว ${records.length} ครั้ง
              </span>
            </div>
            <p class="slts-history-loc text-xs text-gray-700 truncate" title="${locText}">
              <i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${locText || (district ? `อ.${district} ต.${subdistrict}` : '-')}
            </p>
            ${lat && lng ? `<p class="text-[10px] text-gray-500 font-mono mt-0.5"><i class="fa-solid fa-satellite-dish text-violet-500 mr-1"></i>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</p>` : ''}
            <div class="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100 flex-wrap">
              <button type="button" onclick="showCaseSubRecordsModal('${safeCase}')" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1.5 transition">
                <i class="fa-solid fa-list-check"></i> ดูรายละเอียดทั้งหมด (${records.length} รายการ)
              </button>
              <button type="button" onclick="autofillModalFormFromRecord('${safeCase}', '${safeDist}', '${safeSub}', '${safeLocType}', '${safeHouse}', '${safeMoo}', '${safeAdmin}', '${safeOther}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 active:scale-95 rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1 transition" title="ใช้ข้อมูลส่งหมายครั้งล่าสุด">
                <i class="fa-solid fa-arrow-turn-down"></i> ข้อมูลล่าสุด
              </button>
            </div>
          </div>
        `;
      } else {
        // กรณีมีรายการเดียว
        cardsHtml += `
          <div class="slts-history-card" data-search="${searchTerms}">
            <div class="flex items-start justify-between gap-2 mb-1.5">
              <div>
                <span class="slts-history-caseno">${caseNum}</span>
                <span class="slts-history-date"><i class="fa-regular fa-clock text-[9px] mr-1"></i>${timeStr}</span>
              </div>
            </div>
            <p class="slts-history-loc text-xs text-gray-700 truncate" title="${locText}">
              <i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${locText || (district ? `อ.${district} ต.${subdistrict}` : '-')}
            </p>
            ${lat && lng ? `<p class="text-[10px] text-gray-500 font-mono mt-0.5"><i class="fa-solid fa-satellite-dish text-violet-500 mr-1"></i>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</p>` : ''}
            <div class="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
              ${imgUrl ? `
                <button type="button" onclick="viewPhotoModal('${imgUrl}', '${safeCase}', '${locText.replace(/'/g, "\\'")}', '${timeStr}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition">
                  <i class="fa-solid fa-image text-blue-600"></i> ดูรูป
                </button>
              ` : ''}
              <button type="button" onclick="autofillModalFormFromRecord('${safeCase}', '${safeDist}', '${safeSub}', '${safeLocType}', '${safeHouse}', '${safeMoo}', '${safeAdmin}', '${safeOther}')" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1 transition">
                <i class="fa-solid fa-arrow-turn-down"></i> ใช้ข้อมูลนี้
              </button>
            </div>
          </div>
        `;
      }
    });
  }

  Swal.fire({
    html: `
      <div class="slts-province-modal">
        <!-- Header with Back Button -->
        <div class="slts-modal-header">
          <button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
            <i class="fa-solid fa-arrow-left"></i>
            <span>กลับ</span>
          </button>
          <div class="flex-1 text-center pr-8">
            <h2 class="slts-modal-title">ค้นหาประวัติการส่งหมาย</h2>
            <p id="swalHistorySubtitle" class="slts-modal-subtitle">📍 จังหวัด${prov} (${caseGroups.size} คดี)</p>
          </div>
        </div>
        <!-- Search -->
        <div class="slts-search-wrap relative flex items-center">
          <i class="fa-solid fa-magnifying-glass slts-search-icon"></i>
          <input type="text" id="swalHistorySearchInput" placeholder="พิมพ์เลขคดี, อำเภอ, ตำบล หรือสถานที่..." class="slts-search-input pr-8" autocomplete="off">
          <button type="button" id="swalHistoryClearSearchBtn" class="hidden absolute right-5 text-gray-400 hover:text-gray-600 p-1 text-xs" title="ล้างข้อความค้นหา">
            <i class="fa-solid fa-circle-xmark"></i>
          </button>
        </div>
        <!-- Cards List -->
        <div id="swalHistoryCardsWrap" class="p-3 space-y-2.5 overflow-y-auto max-h-[calc(86dvh-120px)] slts-swal-body-scroll">
          ${cardsHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>กด "ใช้ข้อมูลนี้" หรือ "ดูรายละเอียด" เพื่อเลือกข้อมูลหมายมากรอกในฟอร์มทันที</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    },
    didOpen: () => {
      const searchInput = document.getElementById('swalHistorySearchInput');
      const clearBtn = document.getElementById('swalHistoryClearSearchBtn');

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const val = e.target.value;
          if (clearBtn) {
            clearBtn.classList.toggle('hidden', !val);
          }
          window.filterMobileHistoryList(val);
        });

        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            searchInput.focus();
            window.filterMobileHistoryList('');
          });
        }

        setTimeout(() => {
          searchInput.focus();
        }, 200);
      }
    }
  });
};

window.filterMobileHistoryList = function(query) {
  const wrap = document.getElementById('swalHistoryCardsWrap');
  if (!wrap) return;

  const rawQ = (query || '').trim().toLowerCase();
  const cleanQ = rawQ.replace(/[\s\.\/\-\_]/g, '');
  const terms = rawQ.split(/\s+/).filter(t => t.length > 0);

  const cards = wrap.querySelectorAll('.slts-history-card');
  let matchCount = 0;

  cards.forEach(card => {
    const s = (card.getAttribute('data-search') || '').toLowerCase();
    const cleanS = s.replace(/[\s\.\/\-\_]/g, '');

    const isMatch = (rawQ === '') ||
      s.includes(rawQ) ||
      cleanS.includes(cleanQ) ||
      terms.every(t => s.includes(t) || cleanS.includes(t.replace(/[\s\.\/\-\_]/g, '')));

    card.style.display = isMatch ? '' : 'none';
    if (isMatch) matchCount++;
  });

  // อัปเดต Subtitle
  const subtitle = document.getElementById('swalHistorySubtitle');
  const prov = state.selectedProvince || 'อุดรธานี';
  if (subtitle) {
    if (rawQ) {
      subtitle.textContent = `📍 จังหวัด${prov} (พบ ${matchCount} จาก ${cards.length} คดี)`;
    } else {
      subtitle.textContent = `📍 จังหวัด${prov} (${cards.length} คดี)`;
    }
  }

  // จัดการกล่องแสดงเมื่อไม่พบรายการ
  let noResultEl = document.getElementById('swalHistoryNoResult');
  if (matchCount === 0 && cards.length > 0) {
    if (!noResultEl) {
      noResultEl = document.createElement('div');
      noResultEl.id = 'swalHistoryNoResult';
      noResultEl.className = 'p-8 text-center text-gray-400';
      noResultEl.innerHTML = `
        <i class="fa-solid fa-magnifying-glass text-3xl mb-2 text-gray-300"></i>
        <p class="text-xs font-semibold text-gray-600">ไม่พบประวัติส่งหมายที่ตรงกับคำค้นหา</p>
        <p class="text-[11px] text-gray-400 mt-1">ลองพิมพ์เฉพาะเลขคดี, ชื่ออำเภอ, ตำบล หรือชื่อสถานที่</p>
      `;
      wrap.appendChild(noResultEl);
    }
    noResultEl.style.display = '';
  } else if (noResultEl) {
    noResultEl.style.display = 'none';
  }
};

// -------------------------------------------------------------------------
// Popup แสดงรายละเอียดประวัติส่งหมายทั้งหมดของเลขคดี (เมื่อมี > 1 รายการ)
// -------------------------------------------------------------------------
window.showCaseSubRecordsModal = function(caseNumber) {
  const prov = state.selectedProvince || 'อุดรธานี';
  const allRows = state.allSheetRows || [];
  const records = allRows.filter(r => (r['เลขคดี'] || '').trim() === caseNumber.trim() && getRowProvince(r) === prov);

  if (!records || records.length === 0) {
    showMobileHistorySearchModal();
    return;
  }

  let itemsHtml = '';
  records.forEach((rec, idx) => {
    const rawTimestamp = rec['วัน-เวลาบันทึก'] || rec['Timestamp'] || '';
    const timeFormatted = formatThaiDateDisplay(rawTimestamp);
    const district = rec['อำเภอ'] || '';
    const subdistrict = rec['ตำบล'] || '';
    const locText = rec['ที่ตั้งส่งหมาย (เต็ม)'] || rec['ที่ตั้งส่งหมาย'] || '';
    const locType = rec['ประเภทสถานที่'] || 'หมายบ้าน';
    const houseNo = rec['บ้านเลขที่'] || '';
    const moo = rec['หมู่ที่'] || '';
    const adminName = rec['ชื่อหน่วยงาน/ที่ทำการ'] || '';
    const otherLoc = rec['สถานที่อื่นๆ'] || '';
    const lat = rec['ละติจูด (Lat)'] || rec['ละติจูด'] || '';
    const lng = rec['ลองจิจูด (Lng)'] || rec['ลองจิจูด'] || '';
    const imgUrl = rec['ลิงก์รูปภาพใน Google Drive'] || rec['ลิงก์รูปภาพ'] || '';

    const safeCase = caseNumber.replace(/'/g, "\\'");
    const safeDist = district.replace(/'/g, "\\'");
    const safeSub = subdistrict.replace(/'/g, "\\'");
    const safeLocType = locType.replace(/'/g, "\\'");
    const safeHouse = houseNo.replace(/'/g, "\\'");
    const safeMoo = moo.replace(/'/g, "\\'");
    const safeAdmin = adminName.replace(/'/g, "\\'");
    const safeOther = otherLoc.replace(/'/g, "\\'");

    itemsHtml += `
      <div class="slts-subrecord-card">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="slts-subrecord-num">ครั้งที่ ${records.length - idx}</span>
          <span class="slts-subrecord-time"><i class="fa-regular fa-clock text-[9.5px] mr-1"></i>${timeFormatted}</span>
        </div>
        <p class="text-xs text-gray-800 font-medium mb-1">
          <i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${locText || (district ? `อ.${district} ต.${subdistrict}` : '-')}
        </p>
        ${lat && lng ? `<p class="text-[10px] text-gray-500 font-mono"><i class="fa-solid fa-satellite-dish text-violet-500 mr-1"></i>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</p>` : ''}
        <div class="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
          ${imgUrl ? `
            <button type="button" onclick="viewPhotoModal('${imgUrl}', '${safeCase}', '${locText.replace(/'/g, "\\'")}', '${timeFormatted}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition">
              <i class="fa-solid fa-image text-blue-600"></i> ดูรูป
            </button>
          ` : ''}
          <button type="button" onclick="autofillModalFormFromRecord('${safeCase}', '${safeDist}', '${safeSub}', '${safeLocType}', '${safeHouse}', '${safeMoo}', '${safeAdmin}', '${safeOther}')" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm flex items-center gap-1 transition">
            <i class="fa-solid fa-arrow-turn-down"></i> ใช้ข้อมูลครั้งนี้
          </button>
        </div>
      </div>
    `;
  });

  Swal.fire({
    html: `
      <div class="slts-province-modal">
        <!-- Header with Back Button -->
        <div class="slts-modal-header">
          <button type="button" onclick="showMobileHistorySearchModal()" class="slts-back-header-btn" title="กลับไปหน้ารายการค้นหา">
            <i class="fa-solid fa-arrow-left"></i>
            <span>กลับ</span>
          </button>
          <div class="flex-1 text-center pr-8">
            <h2 class="slts-modal-title">ประวัติการส่งหมาย</h2>
            <p class="slts-modal-subtitle">${caseNumber} (ทั้งหมด ${records.length} ครั้ง)</p>
          </div>
        </div>
        <div class="p-3 space-y-2.5 overflow-y-auto max-h-[calc(86dvh-80px)] slts-swal-body-scroll">
          ${itemsHtml}
        </div>
        <p class="slts-province-note"><i class="fa-solid fa-circle-info mr-1"></i>เลือก "ใช้ข้อมูลครั้งนี้" จากรายการที่ท่านต้องการนำมากรอกในฟอร์ม</p>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    }
  });
};

// -------------------------------------------------------------------------
// SweetAlert Form บันทึกข้อมูลส่งหมาย 80% สำหรับ Mobile
// -------------------------------------------------------------------------
window.showMobileSummonsFormModal = function(isEditing = false) {
  if (!state.selectedProvince) {
    showProvinceSelectorModal(true);
    return;
  }

  const isOnline = navigator.onLine;
  const prov = state.selectedProvince;
  const districts = getDistrictsByProvince(prov);
  
  const curDistrict = (elements.districtSelect?.value && districts.includes(elements.districtSelect.value)) ? elements.districtSelect.value : (districts[0] || '');
  const subdistricts = getSubdistrictsByDistrict(prov, curDistrict);
  const curSubdistrict = (elements.subdistrictSelect?.value && subdistricts.includes(elements.subdistrictSelect.value)) ? elements.subdistrictSelect.value : (subdistricts[0] || '');

  const curCategory = state.tempModalValues?.courtCategory || state.selectedCourtCategory || state.desktopCourtCategory || localStorage.getItem('slts_selected_court_category') || 'ศาลจังหวัด';
  let curCourtName = state.tempModalValues?.courtName || state.selectedCourtName || '';
  if (!curCourtName) {
    if (curCategory === 'ศาลจังหวัด') curCourtName = `ศาลจังหวัด${prov}`;
    else if (curCategory === 'ศาลแขวง') curCourtName = `ศาลแขวง${prov}`;
    else if (curCategory === 'ศาลเยาวชนและครอบครัว') curCourtName = `ศาลเยาวชนและครอบครัวจังหวัด${prov}`;
    else if (curCategory === 'ศาลอื่น' || curCategory === 'หมายศาลอื่น') curCourtName = 'หมายศาลอื่น (หมาย ต.)';
    else curCourtName = 'ศาลแพ่ง';
  }
  const isUnaffiliated = curCategory === 'ศาลที่ไม่สังกัดภาค';
  const isOtherCourt = curCategory === 'ศาลอื่น' || curCategory === 'หมายศาลอื่น';

  const allPrefixes = getAllCasePrefixes();
  const curPrefix = state.tempModalValues?.prefix || elements.udonPrefixInput?.value || (allPrefixes.includes('ผบE') ? 'ผบE' : (allPrefixes[0] || 'อ'));
  const curCaseNo = (state.tempModalValues?.caseNo !== undefined) ? state.tempModalValues.caseNo : (elements.udonCaseNoInput?.value || '');
  const curCaseYear = state.tempModalValues?.caseYear || elements.udonCaseYearSelect?.value || (new Date().getFullYear() + 543);
  const curOtherCaseNo = (state.tempModalValues?.otherCaseNo !== undefined) ? state.tempModalValues.otherCaseNo : (elements.otherCaseNoInput?.value || '');
  const curOtherCaseYear = state.tempModalValues?.otherCaseYear || elements.otherCaseYearSelect?.value || (new Date().getFullYear() + 543);
  const curCaseExtra = (state.tempModalValues?.caseExtra !== undefined) ? state.tempModalValues.caseExtra : (elements.caseExtraInput?.value || '');
  const curLocType = state.tempModalValues?.locType || elements.locationTypeSelect?.value || 'หมายบ้าน';
  const curHouseNo = (state.tempModalValues?.houseNo !== undefined) ? state.tempModalValues.houseNo : (elements.houseNoInput?.value || '');
  const curMoo = (state.tempModalValues?.moo !== undefined) ? state.tempModalValues.moo : (elements.mooInput?.value || '');
  const curAdminName = state.tempModalValues?.adminName || elements.localAdminNameInput?.value || 'ที่ทำการปกครองส่วนท้องถิ่น';
  const curOtherLoc = (state.tempModalValues?.otherLocName !== undefined) ? state.tempModalValues.otherLocName : (elements.customOtherLocationName?.value || '');
  const curCoords = (state.tempModalValues?.coords !== undefined) ? state.tempModalValues.coords : (elements.coordinatesInput?.value || (state.lat ? `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}` : ''));

  const currentThaiYear = new Date().getFullYear() + 543;
  let yearOpts = '';
  for (let i = 0; i <= 40; i++) {
    const y = currentThaiYear - i;
    yearOpts += `<option value="${y}" ${y == curCaseYear ? 'selected' : ''}>${y}</option>`;
  }
  let otherYearOpts = '';
  for (let i = 0; i <= 40; i++) {
    const y = currentThaiYear - i;
    otherYearOpts += `<option value="${y}" ${y == curOtherCaseYear ? 'selected' : ''}>${y}</option>`;
  }

  let prefixDatalistHtml = '';
  let prefixChipsHtml = '';
  allPrefixes.forEach(p => {
    const isSelected = p === curPrefix;
    prefixDatalistHtml += `<option value="${p}">`;
    prefixChipsHtml += `
      <button type="button" class="slts-prefix-chip ${isSelected ? 'active' : ''}" onclick="selectModalPrefix('${p}')">
        ${p}
      </button>
    `;
  });

  const isBkk = prov === 'กรุงเทพมหานคร';
  const adminOptions = getLocalAdminOptions(curSubdistrict, isBkk);
  let adminDatalistHtml = '';
  let adminChipsHtml = '';
  adminOptions.forEach(o => {
    const isSelected = o === curAdminName;
    adminDatalistHtml += `<option value="${o}">`;
    adminChipsHtml += `
      <button type="button" class="slts-prefix-chip slts-admin-chip ${isSelected ? 'active' : ''}" data-val="${o}" onclick="selectModalAdminName('${o}')">
        ${o}
      </button>
    `;
  });

  // ปุ่มค้นหาที่มุมซ้ายบน (Active เมื่อออนไลน์ / Disabled เมื่อออฟไลน์)
  const searchBtnHtml = isOnline
    ? `<button type="button" onclick="saveTempModalFormState(); showMobileHistorySearchModal();" class="slts-header-search-icon-btn" title="คลิกเพื่อค้นหาประวัติการส่งหมาย">
         <i class="fa-solid fa-magnifying-glass"></i>
       </button>`
    : `<button type="button" disabled class="slts-header-search-icon-btn opacity-40 cursor-not-allowed pointer-events-none" title="ค้นหาประวัติได้เฉพาะเมื่อเชื่อมต่ออินเทอร์เน็ต">
         <i class="fa-solid fa-magnifying-glass text-gray-300"></i>
       </button>`;

  const searchBadge = isOnline
    ? `<span class="text-[10px] bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 px-1.5 py-0.2 rounded font-normal inline-flex items-center gap-1"><i class="fa-solid fa-magnifying-glass text-[8px]"></i>ค้นหา</span>`
    : `<span class="text-[10px] bg-amber-500/30 text-amber-200 border border-amber-400/40 px-1.5 py-0.2 rounded font-normal inline-flex items-center gap-1"><i class="fa-solid fa-cloud-arrow-up text-[8px]"></i>ออฟไลน์</span>`;

  const headerTitleAction = isOnline ? `onclick="saveTempModalFormState(); showMobileHistorySearchModal();" title="คลิกเพื่อค้นหาประวัติการส่งหมาย"` : '';

  Swal.fire({
    html: `
      <div class="slts-form-modal">
        <!-- Header -->
        <div class="slts-modal-header">
          <!-- ปุ่มค้นหาข้อมูลประวัติส่งหมาย ที่มุมซ้ายบนแทนสัญลักษณ์เดิม (Disabled เมื่อออฟไลน์) -->
          <div class="flex items-center gap-1">
            ${searchBtnHtml}
            <button type="button" onclick="saveTempModalFormState(); showMobileRouteMapModal();" class="slts-header-search-icon-btn bg-rose-500/20 text-rose-200 border-rose-400/30 hover:bg-rose-500/30" title="เปิดแผนที่และเส้นทางส่งหมาย">
              <i class="fa-solid fa-map-location-dot"></i>
            </button>
          </div>
          <div class="flex-1 ${isOnline ? 'cursor-pointer' : ''}" ${headerTitleAction}>
            <h2 class="slts-modal-title flex items-center gap-1.5">
              <span>${isEditing ? 'แก้ไขข้อมูลหมาย' : 'บันทึกข้อมูลส่งหมาย'}</span>
              ${searchBadge}
            </h2>
            <p class="slts-modal-subtitle">📍 จังหวัด${prov}</p>
          </div>
          <button type="button" onclick="saveTempModalFormState(); showProvinceSelectorModal(false)" class="slts-change-prov-btn" title="เปลี่ยนจังหวัด">
            <i class="fa-solid fa-arrow-right-arrow-left text-[9px]"></i> เปลี่ยนจังหวัด
          </button>
        </div>

        <form id="mobileSummonsModalForm" class="slts-form-body slts-swal-body-scroll" onsubmit="return false;">

          <!-- Section: อำเภอ & ตำบล (รูปแบบรายการแบบกดเลือก) -->
          <div class="slts-form-section">
            <div class="slts-section-label">
              <i class="fa-solid fa-location-dot text-blue-600"></i> พื้นที่ส่งหมาย
            </div>
            <div class="slts-field-row">
              <div class="slts-field-col">
                <label class="slts-label">อำเภอ / เขต <span class="slts-required">*</span></label>
                <button type="button" onclick="saveTempModalFormState(); showDistrictSelectorModal()" class="slts-select-trigger-btn">
                  <span class="truncate">${curDistrict || 'เลือกอำเภอ / เขต'}</span>
                  <i class="fa-solid fa-chevron-right text-[10px] text-gray-400"></i>
                </button>
                <input type="hidden" id="m_district" value="${curDistrict}">
              </div>
              <div class="slts-field-col">
                <label class="slts-label">ตำบล / แขวง <span class="slts-required">*</span></label>
                <button type="button" onclick="saveTempModalFormState(); showSubdistrictSelectorModal()" class="slts-select-trigger-btn">
                  <span class="truncate">${curSubdistrict || 'เลือกตำบล / แขวง'}</span>
                  <i class="fa-solid fa-chevron-right text-[10px] text-gray-400"></i>
                </button>
                <input type="hidden" id="m_subdistrict" value="${curSubdistrict}">
              </div>
            </div>
          </div>

          <!-- Section: เลขคดี -->
          <div class="slts-form-section">
            <div class="slts-section-label flex items-center justify-between">
              <span><i class="fa-solid fa-scale-balanced text-amber-600"></i> ข้อมูลเลขคดี</span>
              <button type="button" onclick="saveTempModalFormState(); showCourtTypeSelectorModal(state.selectedProvince, true);" class="text-[11px] text-blue-600 font-bold hover:underline flex items-center gap-1">
                <i class="fa-solid fa-pen-to-square text-[10px]"></i> เปลี่ยนประเภทศาล
              </button>
            </div>
            <div class="slts-field-stack">
              <label class="slts-label">ประเภทศาล <span class="slts-required">*</span></label>
              <div class="flex items-stretch gap-1.5">
                <input 
                  type="text" 
                  id="m_courtNameInput" 
                  ${isUnaffiliated ? 'placeholder="ระบุชื่อศาลที่ไม่สังกัดภาค เช่น ศาลแพ่ง"' : 'readonly'} 
                  value="${curCourtName}" 
                  class="slts-input flex-1 font-bold ${isUnaffiliated ? 'bg-white text-gray-900 border-blue-400 focus:ring-2 focus:ring-blue-100' : 'bg-gray-100 text-gray-800 cursor-not-allowed'}"
                >
                <input type="hidden" id="m_courtType" value="${curCategory}">
                <button type="button" onclick="saveTempModalFormState(); showCourtTypeSelectorModal(state.selectedProvince, true);" class="px-3 py-2 bg-blue-50 hover:bg-blue-100 active:scale-95 text-blue-700 font-bold text-xs rounded-xl border border-blue-200 shrink-0 transition flex items-center gap-1 shadow-sm" title="เลือกประเภทศาล">
                  <i class="fa-solid fa-building-columns"></i>
                  <span>เลือก</span>
                </button>
              </div>
              ${isUnaffiliated ? '<p class="text-[10px] text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200 mt-1">* กรุณาระบุชื่อศาลที่ไม่สังกัดภาค เช่น ศาลแพ่ง, ศาลอาญา</p>' : ''}
            </div>

            <!-- ศาลปกติ -->
            <div id="m_provCourtBox" class="${isOtherCourt ? 'hidden' : 'block'} space-y-1.5">
              <div class="slts-case-row">
                <input type="text" id="m_prefix" list="m_prefixList" value="${curPrefix}" placeholder="อักษร เช่น ผบE" class="slts-input slts-input-prefix" autocomplete="off" oninput="handleModalPrefixInput(this.value)">
                <datalist id="m_prefixList">
                  ${prefixDatalistHtml}
                </datalist>
                <input type="text" id="m_caseNo" value="${curCaseNo}" placeholder="เลขคดี *" inputmode="numeric" class="slts-input slts-input-caseno">
                <span class="slts-case-sep">/</span>
                <select id="m_caseYear" class="slts-select slts-select-year">
                  ${yearOpts}
                </select>
              </div>
              <!-- แถบเลือกอักษรนำหน้าด่วน -->
              <div class="slts-prefix-chips-container">
                <span class="slts-prefix-chips-label"><i class="fa-solid fa-list-check text-[9px] mr-1"></i>เลือกอักษร:</span>
                <div class="slts-prefix-chips-wrap" id="m_prefixChips">
                  ${prefixChipsHtml}
                </div>
              </div>
            </div>

            <!-- หมายศาลอื่น -->
            <div id="m_otherCourtBox" class="${isOtherCourt ? 'flex' : 'hidden'} slts-case-row">
              <span class="slts-case-prefix-tag">ต</span>
              <input type="text" id="m_otherCaseNo" value="${curOtherCaseNo}" placeholder="เลขคดี *" inputmode="numeric" class="slts-input slts-input-caseno">
              <span class="slts-case-sep">/</span>
              <select id="m_otherCaseYear" class="slts-select slts-select-year">
                ${otherYearOpts}
              </select>
            </div>

            <!-- ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี เช่น ล.1-2) -->
            <div class="slts-field-stack mt-2">
              <label class="slts-label flex items-center justify-between">
                <span><i class="fa-solid fa-circle-info text-blue-500 mr-1"></i>ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี)</span>
                <span class="text-[10px] text-gray-400 font-normal">ไม่บังคับ</span>
              </label>
              <input 
                type="text" 
                id="m_caseExtra" 
                value="${curCaseExtra}" 
                placeholder="เช่น ล.1-2, จำเลยที่ 1-2 (เว้นวรรค 1 เคาะต่อท้ายเลขคดี)" 
                class="slts-input" 
                autocomplete="off"
              >
            </div>
          </div>

          <!-- Section: ที่ตั้งส่งหมาย -->
          <div class="slts-form-section">
            <div class="slts-section-label">
              <i class="fa-solid fa-house text-emerald-600"></i> สถานที่ส่งหมาย
            </div>
            <div class="slts-field-stack">
              <label class="slts-label">ประเภทสถานที่ <span class="slts-required">*</span></label>
              <select id="m_locType" class="slts-select" onchange="handleModalLocTypeChange(this.value)">
                <option value="หมายบ้าน" ${curLocType === 'หมายบ้าน' ? 'selected' : ''}>หมายบ้าน</option>
                <option value="ที่ทำการปกครองส่วนท้องถิ่น" ${curLocType === 'ที่ทำการปกครองส่วนท้องถิ่น' ? 'selected' : ''}>ที่ทำการปกครองส่วนท้องถิ่น</option>
                <option value="อื่นๆ" ${curLocType === 'อื่นๆ' ? 'selected' : ''}>อื่นๆ</option>
              </select>
            </div>

            <div id="m_houseBox" class="${curLocType === 'หมายบ้าน' ? 'slts-field-row' : 'hidden slts-field-row'}">
              <div class="slts-field-col">
                <label class="slts-label">บ้านเลขที่ <span class="slts-required">*</span></label>
                <input type="text" id="m_houseNo" value="${curHouseNo}" placeholder="เช่น 154/2" class="slts-input">
              </div>
              <div class="slts-field-col">
                <label class="slts-label">หมู่ที่</label>
                <input type="text" id="m_moo" value="${curMoo}" placeholder="เลขหมู่" inputmode="numeric" class="slts-input">
              </div>
            </div>

            <div id="m_adminBox" class="${curLocType === 'ที่ทำการปกครองส่วนท้องถิ่น' ? 'block' : 'hidden'} space-y-1.5">
              <label class="slts-label">ชื่อหน่วยงาน / ที่ทำการ <span class="slts-required">*</span></label>
              <input type="text" id="m_adminName" list="m_adminNameList" value="${curAdminName}" placeholder="ระบุ อบต. / เทศบาล / ที่ทำการ..." class="slts-input" autocomplete="off" oninput="handleModalAdminNameInput(this.value)">
              <datalist id="m_adminNameList">
                ${adminDatalistHtml}
              </datalist>
              <!-- แถบเลือกหน่วยงานปกครองด่วน -->
              <div class="slts-prefix-chips-container">
                <span class="slts-prefix-chips-label"><i class="fa-solid fa-building-flag text-[9px] mr-1"></i>เลือก:</span>
                <div class="slts-prefix-chips-wrap" id="m_adminChips">
                  ${adminChipsHtml}
                </div>
              </div>
            </div>

            <div id="m_otherBox" class="${curLocType === 'อื่นๆ' ? '' : 'hidden'}">
              <label class="slts-label">ระบุสถานที่ <span class="slts-required">*</span></label>
              <input type="text" id="m_otherLocName" value="${curOtherLoc}" placeholder="เช่น โรงเรียน, วัด, โรงพยาบาล" class="slts-input">
            </div>
          </div>

          <!-- Section: GPS -->
          <div class="slts-form-section">
            <div class="slts-section-label">
              <i class="fa-solid fa-satellite-dish text-violet-600"></i> พิกัด GPS
              <button type="button" onclick="refreshModalCoordinates()" class="slts-gps-btn">
                <i class="fa-solid fa-arrows-rotate"></i> ดึงพิกัดสด
              </button>
            </div>
            <input type="text" id="m_coords" value="${curCoords}" placeholder="เช่น 17.4144, 102.7882" class="slts-input slts-input-mono">
          </div>

        </form>

        <!-- Confirm button -->
        <div class="slts-form-footer">
          <button type="button" class="slts-confirm-btn" onclick="(async () => { const v = validateAndExtractModalForm(); if (v) { state.tempModalValues = null; Swal.close(); applyModalFormValues(v); await openCameraModal(); } })()">
            <i class="fa-solid fa-camera mr-1.5"></i> ยืนยันข้อมูลและเปิดกล้องถ่ายภาพ
          </button>
          ${isEditing ? '<button type="button" class="slts-cancel-btn" onclick="state.tempModalValues = null; Swal.close()"><i class="fa-solid fa-xmark mr-1"></i> กลับไปยังกล้อง</button>' : ''}
        </div>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCancelButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    },
    didOpen: () => {
      // ── ป้องกัน keyboard บดบัง input ใน SweetAlert บน Mobile ──
      const popup = document.querySelector('.swal2-popup');
      const formBody = document.querySelector('.slts-form-body');
      if (!popup) return;

      const adjustFormModal = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const maxH = Math.max(180, Math.floor(vh - 16));
        popup.style.maxHeight = `${maxH}px`;
        if (formBody) {
          formBody.style.maxHeight = `${Math.max(90, maxH - 120)}px`;
        }
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA')) {
          setTimeout(() => focused.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
        }
      };

      adjustFormModal();

      // ใช้ visualViewport API (รองรับ iOS Safari 13+ / Android Chrome 62+)
      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener('resize', adjustFormModal);
        vv.addEventListener('scroll', adjustFormModal);
        popup._vvResizeHandler = adjustFormModal;
      }

      // Fallback: focus event scroll สำหรับ browser ที่ไม่รองรับ visualViewport
      const formEl = document.getElementById('mobileSummonsModalForm');
      if (formEl) {
        const onFocusIn = (e) => {
          if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
            setTimeout(() => {
              adjustFormModal();
              e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 100);
          }
        };
        formEl.addEventListener('focusin', onFocusIn);
        popup._focusInHandler = onFocusIn;
        popup._formEl = formEl;
      }
    },
    didClose: () => {
      // ── Cleanup viewport listeners เมื่อปิด modal ──
      const vv = window.visualViewport;
      const popup = document.querySelector('.swal2-popup');
      if (vv && popup?._vvResizeHandler) {
        vv.removeEventListener('resize', popup._vvResizeHandler);
        vv.removeEventListener('scroll', popup._vvResizeHandler);
      }
      if (popup?._formEl && popup?._focusInHandler) {
        popup._formEl.removeEventListener('focusin', popup._focusInHandler);
      }
    }
  });
};

window.handleModalPrefixInput = function(val) {
  const input = document.getElementById('m_prefix');
  if (input && val) {
    const formatted = val
      .replace(/[^a-zA-Zก-๙\.\s]/g, '')
      .replace(/^\s+/, '')
      .replace(/\s{2,}/g, ' ');
    if (formatted !== val) {
      input.value = formatted;
      val = formatted;
    }
  }
  const clean = (val || '').trim();
  const chips = document.querySelectorAll('.slts-prefix-chip');
  chips.forEach(c => {
    if (c.textContent.trim() === clean) {
      c.classList.add('active');
      try {
        c.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      } catch (e) {}
    } else {
      c.classList.remove('active');
    }
  });
};

window.selectModalPrefix = function(prefix) {
  const input = document.getElementById('m_prefix');
  if (input) {
    input.value = prefix;
    window.handleModalPrefixInput(prefix);
  }
};

window.handleModalAdminNameInput = function(val) {
  const clean = (val || '').trim();
  const chips = document.querySelectorAll('.slts-admin-chip');
  chips.forEach(c => {
    const chipVal = c.getAttribute('data-val') || c.textContent.trim();
    if (chipVal === clean || (chipVal.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่') && clean.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่'))) {
      c.classList.add('active');
      try {
        c.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      } catch (e) {}
    } else {
      c.classList.remove('active');
    }
  });
};

window.selectModalAdminName = function(name) {
  const input = document.getElementById('m_adminName');
  if (input) {
    input.value = name;
    window.handleModalAdminNameInput(name);
    if (name.includes('ผู้ใหญ่บ้าน')) {
      input.focus();
      input.setSelectionRange(name.length, name.length);
    }
  }
};

window.updateModalAdminChips = function() {
  const prov = state.selectedProvince;
  const isBkk = prov === 'กรุงเทพมหานคร';
  const subdistrictSelect = document.getElementById('m_subdistrict');
  const subName = subdistrictSelect?.value || '';
  const adminOptions = getLocalAdminOptions(subName, isBkk);
  const curVal = document.getElementById('m_adminName')?.value || '';

  const datalist = document.getElementById('m_adminNameList');
  if (datalist) {
    datalist.innerHTML = adminOptions.map(o => `<option value="${o}">`).join('');
  }

  const chipsWrap = document.getElementById('m_adminChips');
  if (chipsWrap) {
    chipsWrap.innerHTML = adminOptions.map(o => {
      const isSelected = o === curVal || (o.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่') && curVal.startsWith('ที่ทำการผู้ใหญ่บ้านหมู่ที่'));
      return `<button type="button" class="slts-prefix-chip slts-admin-chip ${isSelected ? 'active' : ''}" data-val="${o}" onclick="selectModalAdminName('${o}')">${o}</button>`;
    }).join('');
  }
};

window.handleModalDistrictChange = function(districtName) {
  const prov = state.selectedProvince;
  const subdistricts = getSubdistrictsByDistrict(prov, districtName);
  const subSelect = document.getElementById('m_subdistrict');
  if (!subSelect) return;
  subSelect.innerHTML = '';
  subdistricts.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    subSelect.appendChild(opt);
  });
  window.updateModalAdminChips();
};

window.handleModalCourtNameInput = function(val) {
  if (state.tempModalValues) {
    state.tempModalValues.courtName = val;
  }
};

window.handleModalCourtTypeChange = function(courtType) {
  const provBox = document.getElementById('m_provCourtBox');
  const otherBox = document.getElementById('m_otherCourtBox');
  if (courtType === 'ศาลอื่น') {
    provBox?.classList.add('hidden');
    provBox?.classList.remove('flex');
    otherBox?.classList.remove('hidden');
    otherBox?.classList.add('flex');
  } else {
    otherBox?.classList.add('hidden');
    otherBox?.classList.remove('flex');
    provBox?.classList.remove('hidden');
    provBox?.classList.add('flex');
  }
};

window.handleModalLocTypeChange = function(locType) {
  const houseBox = document.getElementById('m_houseBox');
  const adminBox = document.getElementById('m_adminBox');
  const otherBox = document.getElementById('m_otherBox');

  houseBox?.classList.add('hidden');
  adminBox?.classList.add('hidden');
  otherBox?.classList.add('hidden');

  if (locType === 'หมายบ้าน') {
    houseBox?.classList.remove('hidden');
  } else if (locType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    adminBox?.classList.remove('hidden');
  } else {
    otherBox?.classList.remove('hidden');
  }
};

window.refreshModalCoordinates = function() {
  fetchCurrentLocation(false);
  setTimeout(() => {
    const coordInput = document.getElementById('m_coords');
    if (coordInput && state.lat && state.lng) {
      coordInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
    }
  }, 800);
};

function validateAndExtractModalForm() {
  const district = document.getElementById('m_district')?.value;
  const subdistrict = document.getElementById('m_subdistrict')?.value;
  const courtCategory = document.getElementById('m_courtType')?.value;
  const courtName = (document.getElementById('m_courtNameInput')?.value || '').trim();
  const prefix = (document.getElementById('m_prefix')?.value || '').trim();
  const caseNo = (document.getElementById('m_caseNo')?.value || '').trim();
  const caseYear = document.getElementById('m_caseYear')?.value;
  const otherCaseNo = (document.getElementById('m_otherCaseNo')?.value || '').trim();
  const otherCaseYear = document.getElementById('m_otherCaseYear')?.value;
  const caseExtra = (document.getElementById('m_caseExtra')?.value || '').trim();
  const locType = document.getElementById('m_locType')?.value;
  const houseNo = (document.getElementById('m_houseNo')?.value || '').trim();
  const moo = (document.getElementById('m_moo')?.value || '').trim();
  const adminName = (document.getElementById('m_adminName')?.value || '').trim();
  const otherLocName = (document.getElementById('m_otherLocName')?.value || '').trim();
  const coords = (document.getElementById('m_coords')?.value || '').trim();

  if (!district || !subdistrict) {
    Swal.showValidationMessage('กรุณาเลือกอำเภอและตำบล');
    return false;
  }

  if (courtCategory === 'ศาลที่ไม่สังกัดภาค' && !courtName) {
    Swal.showValidationMessage('กรุณาระบุชื่อศาลที่ไม่สังกัดภาค เช่น ศาลแพ่ง, ศาลอาญา');
    return false;
  }

  const isOther = courtCategory === 'ศาลอื่น' || courtCategory === 'หมายศาลอื่น';
  if (isOther) {
    if (!otherCaseNo) {
      Swal.showValidationMessage('กรุณากรอกเลขคดีหมายศาลอื่น');
      return false;
    }
  } else {
    if (!prefix) {
      Swal.showValidationMessage('กรุณากรอกอักษรนำหน้าเลขคดี เช่น ผบE');
      return false;
    }
    if (!caseNo) {
      Swal.showValidationMessage('กรุณากรอกเลขคดี');
      return false;
    }
  }

  if (locType === 'หมายบ้าน') {
    if (!houseNo) {
      Swal.showValidationMessage('สำหรับหมายบ้าน บังคับต้องระบุบ้านเลขที่');
      return false;
    }
  } else if (locType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    if (!adminName) {
      Swal.showValidationMessage('กรุณาระบุชื่อที่ทำการปกครองส่วนท้องถิ่น');
      return false;
    }
  } else if (locType === 'อื่นๆ') {
    if (!otherLocName) {
      Swal.showValidationMessage('กรุณาระบุชื่อสถานที่อื่นๆ');
      return false;
    }
  }

  return {
    district,
    subdistrict,
    courtType: courtName || courtCategory,
    courtCategory,
    courtName,
    prefix,
    caseNo,
    caseYear,
    otherCaseNo,
    otherCaseYear,
    caseExtra,
    locType,
    houseNo,
    moo,
    adminName,
    otherLocName,
    coords
  };
}

function applyModalFormValues(val) {
  if (!val) return;

  if (elements.caseExtraInput) {
    elements.caseExtraInput.value = val.caseExtra || '';
  }

  if (elements.districtSelect) {
    elements.districtSelect.value = val.district;
    updateSubdistricts(state.selectedProvince, val.district, val.subdistrict);
  }

  const isOther = val.courtCategory === 'ศาลอื่น' || val.courtCategory === 'หมายศาลอื่น' || val.courtType === 'ศาลอื่น';
  if (isOther) {
    if (elements.courtTypeSelect) elements.courtTypeSelect.value = 'ศาลอื่น';
    if (elements.courtNameInput) {
      elements.courtNameInput.value = 'หมายศาลอื่น (หมาย ต.)';
      elements.courtNameInput.readOnly = true;
    }
    elements.udonCaseField?.classList.add('hidden');
    elements.otherCourtCaseField?.classList.remove('hidden');
    elements.otherCourtCaseField?.classList.add('flex');
    if (elements.otherCaseNoInput) elements.otherCaseNoInput.value = val.otherCaseNo;
    if (elements.otherCaseYearSelect) elements.otherCaseYearSelect.value = val.otherCaseYear;
  } else {
    const finalName = val.courtName || (val.courtCategory ? `${val.courtCategory}${state.selectedProvince}` : `ศาลจังหวัด${state.selectedProvince}`);
    if (elements.courtTypeSelect) elements.courtTypeSelect.value = finalName;
    if (elements.courtNameInput) {
      elements.courtNameInput.value = finalName;
      if (val.courtCategory === 'ศาลที่ไม่สังกัดภาค') {
        elements.courtNameInput.readOnly = false;
        elements.courtNameInput.classList.remove('bg-gray-100', 'cursor-default');
        elements.courtNameInput.classList.add('bg-white', 'cursor-text');
      } else {
        elements.courtNameInput.readOnly = true;
        elements.courtNameInput.classList.add('bg-gray-100', 'cursor-default');
        elements.courtNameInput.classList.remove('bg-white', 'cursor-text');
      }
    }
    elements.otherCourtCaseField?.classList.add('hidden');
    elements.otherCourtCaseField?.classList.remove('flex');
    elements.udonCaseField?.classList.remove('hidden');
    if (elements.udonPrefixInput) elements.udonPrefixInput.value = val.prefix;
    if (elements.udonCaseNoInput) elements.udonCaseNoInput.value = val.caseNo;
    if (elements.udonCaseYearSelect) elements.udonCaseYearSelect.value = val.caseYear;
    saveCasePrefix(val.prefix);
  }

  if (elements.locationTypeSelect) elements.locationTypeSelect.value = val.locType;
  if (val.locType === 'หมายบ้าน') {
    elements.houseAddressFields?.classList.remove('hidden');
    elements.localAdminAddressFields?.classList.add('hidden');
    elements.customOtherAddressFields?.classList.add('hidden');
    if (elements.houseNoInput) elements.houseNoInput.value = val.houseNo;
    if (elements.mooInput) elements.mooInput.value = val.moo;
  } else if (val.locType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    elements.houseAddressFields?.classList.add('hidden');
    elements.localAdminAddressFields?.classList.remove('hidden');
    elements.customOtherAddressFields?.classList.add('hidden');
    if (elements.localAdminNameInput) elements.localAdminNameInput.value = val.adminName;
    saveLocalAdminName(val.adminName);
  } else {
    elements.houseAddressFields?.classList.add('hidden');
    elements.localAdminAddressFields?.classList.add('hidden');
    elements.customOtherAddressFields?.classList.remove('hidden');
    if (elements.customOtherLocationName) elements.customOtherLocationName.value = val.otherLocName;
  }

  if (val.coords && elements.coordinatesInput) {
    elements.coordinatesInput.value = val.coords;
  }
  updateCaptureButtonState();
}

// -------------------------------------------------------------------------
// ฟังก์ชันรีเซ็ตจังหวัดตั้งต้น (Reset Province)
// -------------------------------------------------------------------------
window.handleResetProvince = function() {
  Swal.fire({
    title: 'รีเซ็ตการตั้งค่าจังหวัด?',
    html: `
      <div class="space-y-2 text-sm text-gray-600">
        <p>คุณต้องการรีเซ็ตจังหวัด <b>จ.${state.selectedProvince || 'ที่เลือกไว้'}</b> ใช่หรือไม่?</p>
        <p class="text-xs text-rose-600 font-semibold bg-rose-50 p-2.5 rounded-xl border border-rose-200">
          <i class="fa-solid fa-triangle-exclamation mr-1"></i> คำเตือน: หากรีเซ็ตแล้ว คุณจะต้องเลือกและตั้งค่าจังหวัดใหม่อีกครั้งในการใช้งาน
        </p>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันรีเซ็ตจังหวัด',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280',
    customClass: {
      popup: 'rounded-2xl shadow-xl'
    }
  }).then((res) => {
    if (res.isConfirmed) {
      localStorage.removeItem('slts_selected_province');
      state.selectedProvince = null;
      if (elements.cameraModal && !elements.cameraModal.classList.contains('hidden')) {
        closeCameraModal();
      }
      updateFloatingProvinceBadge();
      showProvinceSelectorModal(true);
    }
  });
};

/**
 * สร้างตัวเลือก ปี พ.ศ. ปัจจุบัน และถอยหลังไปอีก 40 ปี (รวม 41 ปี)
 */
function initCaseYearDropdowns() {
  const currentThaiYear = new Date().getFullYear() + 543;
  const yearSelects = [elements.udonCaseYearSelect, elements.otherCaseYearSelect];

  yearSelects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i <= 40; i++) {
      const year = currentThaiYear - i;
      const opt = document.createElement('option');
      opt.value = year;
      opt.textContent = year;
      if (i === 0) {
        opt.selected = true; // ปีปัจจุบันเป็นค่าเริ่มต้น
      }
      sel.appendChild(opt);
    }
  });
}

function getFormattedCaseNumber() {
  const courtType = (elements.courtTypeSelect ? elements.courtTypeSelect.value : '') || (document.getElementById('courtType') ? document.getElementById('courtType').value : '');
  const isOther = courtType === 'ศาลอื่น' || courtType === 'หมายศาลอื่น';
  
  // ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี เว้นวรรค 1 เคาะ เช่น "ล.1-2", "จำเลยที่ 1-2")
  const extra = (elements.caseExtraInput ? elements.caseExtraInput.value : (document.getElementById('caseExtraInput')?.value || '')).trim();
  const extraSuffix = extra ? ` ${extra}` : '';

  if (isOther) {
    const caseNo = (elements.otherCaseNoInput ? elements.otherCaseNoInput.value : '').trim();
    const year = elements.otherCaseYearSelect ? elements.otherCaseYearSelect.value : '';
    return caseNo ? `ต${caseNo}/${year}${extraSuffix}` : '';
  } else {
    const prefix = (elements.udonPrefixInput ? elements.udonPrefixInput.value : '').trim();
    const caseNo = (elements.udonCaseNoInput ? elements.udonCaseNoInput.value : '').trim();
    const year = elements.udonCaseYearSelect ? elements.udonCaseYearSelect.value : '';
    return (prefix && caseNo) ? `${prefix}${caseNo}/${year}${extraSuffix}` : '';
  }
}

function initFormEventListeners() {
  // สลับประเภทศาล
  if (elements.courtTypeSelect) {
    elements.courtTypeSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'ศาลอื่น' || val === 'หมายศาลอื่น') {
        elements.udonCaseField.classList.add('hidden');
        elements.otherCourtCaseField.classList.remove('hidden');
        elements.otherCourtCaseField.classList.add('flex');
        if (elements.otherCaseNoInput) elements.otherCaseNoInput.focus();
      } else {
        elements.otherCourtCaseField.classList.add('hidden');
        elements.otherCourtCaseField.classList.remove('flex');
        elements.udonCaseField.classList.remove('hidden');
        if (elements.udonCaseNoInput) elements.udonCaseNoInput.focus();
      }
    });
  }

  // พิมพ์ชื่อศาลกรณีศาลที่ไม่สังกัดภาค
  if (elements.courtNameInput) {
    elements.courtNameInput.addEventListener('input', (e) => {
      if (elements.courtTypeSelect) {
        elements.courtTypeSelect.value = e.target.value.trim();
      }
    });
  }

  // อักษรนำหน้า: ให้กรอกได้เฉพาะตัวอักษร (ไทย / อังกฤษ) จุด(.) และเคาะวรรคได้ 1 เคาะ
  if (elements.udonPrefixInput) {
    elements.udonPrefixInput.addEventListener('input', (e) => {
      e.target.value = e.target.value
        .replace(/[^a-zA-Zก-๙\.\s]/g, '')
        .replace(/^\s+/, '')
        .replace(/\s{2,}/g, ' ');
      updateCaptureButtonState();
    });
  }

  // เลขคดี ศาลจังหวัดอุดรธานี: กรอกได้เฉพาะตัวเลขเท่านั้น
  if (elements.udonCaseNoInput) {
    elements.udonCaseNoInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      updateCaptureButtonState();
    });
  }

  // เลขคดี หมายศาลอื่น: กรอกได้เฉพาะตัวเลขเท่านั้น
  if (elements.otherCaseNoInput) {
    elements.otherCaseNoInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      updateCaptureButtonState();
    });
  }

  // ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี)
  if (elements.caseExtraInput) {
    elements.caseExtraInput.addEventListener('input', updateCaptureButtonState);
  }

  // หมู่: กรอกได้เฉพาะตัวเลขเท่านั้น (ไม่บังคับกรอก)
  if (elements.mooInput) {
    elements.mooInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      updateCaptureButtonState();
    });
  }

  if (elements.houseNoInput) {
    elements.houseNoInput.addEventListener('input', updateCaptureButtonState);
  }
  if (elements.customOtherLocationName) {
    elements.customOtherLocationName.addEventListener('input', updateCaptureButtonState);
  }
  if (elements.localAdminNameInput) {
    elements.localAdminNameInput.addEventListener('input', updateCaptureButtonState);
  }
  if (elements.courtNameInput) {
    elements.courtNameInput.addEventListener('input', updateCaptureButtonState);
  }

  // สลับประเภทสถานที่ (หมายบ้าน / ที่ทำการปกครองส่วนท้องถิ่น / อื่นๆ)
  elements.locationTypeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'หมายบ้าน') {
      elements.houseAddressFields.classList.remove('hidden');
      elements.localAdminAddressFields.classList.add('hidden');
      elements.customOtherAddressFields.classList.add('hidden');
      elements.houseNoInput.setAttribute('required', 'required');
      elements.houseNoInput.focus();
    } else if (val === 'ที่ทำการปกครองส่วนท้องถิ่น') {
      elements.houseAddressFields.classList.add('hidden');
      elements.localAdminAddressFields.classList.remove('hidden');
      elements.customOtherAddressFields.classList.add('hidden');
      elements.houseNoInput.removeAttribute('required');
      
      if (!elements.localAdminNameInput.value.trim()) {
        elements.localAdminNameInput.value = 'ที่ทำการปกครองส่วนท้องถิ่น';
      }
      elements.localAdminNameInput.focus();
    } else if (val === 'อื่นๆ') {
      elements.houseAddressFields.classList.add('hidden');
      elements.localAdminAddressFields.classList.add('hidden');
      elements.customOtherAddressFields.classList.remove('hidden');
      elements.houseNoInput.removeAttribute('required');
      elements.customOtherLocationName.focus();
    }
  });

  // เมื่อผู้ใช้พิมพ์หรือแก้ไขพิกัดในช่อง coordinates ด้วยตนเอง
  if (elements.coordinatesInput) {
    elements.coordinatesInput.addEventListener('input', () => {
      state.isManuallyEditedCoords = true;
      const val = elements.coordinatesInput.value.trim();
      const parts = val.split(/[,;\s]+/).map(p => parseFloat(p)).filter(p => !isNaN(p));
      if (parts.length >= 2) {
        state.lat = parts[0];
        state.lng = parts[1];
        if (elements.locationStatus) {
          elements.locationStatus.textContent = '● ระบุพิกัดด้วยตนเอง (Manual Coordinates)';
          elements.locationStatus.className = 'text-xs text-blue-600 font-semibold';
        }
      }
    });
  }

  if (elements.btnRefreshLocation) {
    elements.btnRefreshLocation.addEventListener('click', () => {
      state.isManuallyEditedCoords = false;
      fetchCurrentLocation(true);
    });
  }
}

function getFullLocationText() {
  const province = elements.provinceSelect ? elements.provinceSelect.value : (state.selectedProvince || '');
  const district = elements.districtSelect ? elements.districtSelect.value : '';
  const subdistrict = elements.subdistrictSelect ? elements.subdistrictSelect.value : '';
  const locationType = elements.locationTypeSelect ? elements.locationTypeSelect.value : 'หมายบ้าน';

  const isBkk = province === 'กรุงเทพมหานคร';
  const subPrefix = isBkk ? '' : 'ต.';
  const distPrefix = isBkk ? '' : 'อ.';
  const provSuffix = province ? ` จ.${province}` : '';

  if (locationType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    const adminText = (elements.localAdminNameInput?.value || 'ที่ทำการปกครองส่วนท้องถิ่น').trim();
    return `${adminText} ${subPrefix}${subdistrict} ${distPrefix}${district}${provSuffix}`.trim();
  } else if (locationType === 'อื่นๆ') {
    const otherText = (elements.customOtherLocationName?.value || 'อื่นๆ').trim();
    return `${otherText} ${subPrefix}${subdistrict} ${distPrefix}${district}${provSuffix}`.trim();
  } else {
    const houseNo = elements.houseNoInput ? elements.houseNoInput.value.trim() : '';
    const moo = elements.mooInput ? elements.mooInput.value.trim() : '';
    const mooText = moo ? ` ม.${moo}` : '';
    return `${houseNo}${mooText} ${subPrefix}${subdistrict} ${distPrefix}${district}${provSuffix}`.trim();
  }
}

function initLocationService() {
  if (navigator.geolocation) {
    if (window.compassManager) {
      window.compassManager.requestPermission();
    }
    // บนมือถือ (<= 768px): ดึงพิกัดและเริ่ม interval ตรวจจับพิกัดสด
    // บน Desktop (> 768px): ไม่รัน interval อัปเดตพิกัดอัตโนมัติ เพื่อให้ผู้ใช้พิมพ์แก้ไขหรือรับพิกัดจากรูปภาพได้โดยไม่ถูกเขียนทับ
    if (window.innerWidth <= 768) {
      fetchCurrentLocation(false);
      startLocationInterval();
    }
  }
}

function startLocationInterval() {
  if (state.locationIntervalId) {
    clearInterval(state.locationIntervalId);
  }
  // รันเฉพาะบนอุปกรณ์หน้าจอขนาดเล็ก (Mobile <= 768px) เท่านั้น
  if (window.innerWidth <= 768) {
    state.locationIntervalId = setInterval(() => {
      fetchCurrentLocation(false);
    }, 10000);
  }
}

function fetchCurrentLocation(isManual = false) {
  if (!navigator.geolocation) {
    return;
  }

  if (isManual && elements.locationStatus) {
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

      // บนหน้าจอ Desktop (> 768px): จะอัปเดตช่องพิกัดเฉพาะเมื่อผู้ใช้กดปุ่ม 'เช็คพิกัดใหม่' ด้วยตนเอง (isManual = true) เท่านั้น
      // ไม่ทำการเขียนทับอัตโนมัติ เพื่อป้องกันการทับค่าที่ผู้ใช้พิมพ์แก้ไข หรือค่าที่ตรวจพบจากภาพถ่าย
      const shouldUpdateForm = (window.innerWidth <= 768) ? (!state.isManuallyEditedCoords || isManual) : isManual;

      if (shouldUpdateForm) {
        if (elements.coordinatesInput) {
          elements.coordinatesInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
        }
        const modalCoordInput = document.getElementById('m_coords');
        if (modalCoordInput) {
          modalCoordInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
        }
        state.isManuallyEditedCoords = false;
      }
      
      const timeStr = state.lastLocationTime.toLocaleTimeString('th-TH');
      if (elements.locationStatus) {
        elements.locationStatus.textContent = `● อัปเดตล่าสุด ${timeStr} (ความแม่นยำ ±${state.accuracy}ม.)`;
        elements.locationStatus.className = 'text-xs text-emerald-600 font-medium';
      }

      // Realtime map snapshot update
      updateLiveMapHUD();
    },
    (error) => {
      console.warn('Geolocation error:', error);
      let msg = 'ไม่สามารถดึงพิกัดได้';
      if (error.code === error.PERMISSION_DENIED) {
        msg = 'กรุณาเปิดสิทธิ์ Location ในเบราว์เซอร์ของคุณ';
      }
      if (elements.locationStatus) {
        elements.locationStatus.textContent = msg;
        elements.locationStatus.className = 'text-xs text-red-500';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

function initCameraEvents() {
  const handleOpenCam = () => {
    if (!validateForm()) return;
    openCameraModal();
  };

  if (elements.btnOpenCamera) {
    elements.btnOpenCamera.addEventListener('click', handleOpenCam);
  }

  const btnMobile = document.getElementById('btnOpenCameraMobile');
  if (btnMobile) {
    btnMobile.addEventListener('click', handleOpenCam);
  }

  if (elements.btnCloseCamera) {
    elements.btnCloseCamera.addEventListener('click', () => {
      if (window.innerWidth < 768) {
        showMobileSummonsFormModal(true);
      } else {
        switchTab('table');
      }
    });
  }

  if (elements.btnFlipCamera) {
    elements.btnFlipCamera.addEventListener('click', () => {
      state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
      startCameraStream();
    });
  }

  // ปุ่มสลับมุมมองกล้อง (แนวนอน 4:3 / แนวตั้ง 3:4) แบบกดเองตามต้องการ
  if (elements.btnToggleOrientation) {
    elements.btnToggleOrientation.addEventListener('click', toggleOrientation);
  }
  if (elements.btnFlipOrientationQuick) {
    elements.btnFlipOrientationQuick.addEventListener('click', toggleOrientation);
  }

  if (elements.btnEditMobileForm) {
    elements.btnEditMobileForm.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMobileSummonsFormModal(true);
    });
  }

  if (elements.btnCapture) {
    elements.btnCapture.addEventListener('click', captureAndProcessPhoto);
  }
  if (elements.fileFallbackInput) {
    elements.fileFallbackInput.addEventListener('change', handleFallbackFile);
  }
}

/**
 * สกัดหาพิกัด GPS (Latitude, Longitude) จากภาพถ่ายอัตโนมัติ (เฉพาะ Desktop > 768px)
 * 1. ตรวจสอบ EXIF GPS Metadata จากไฟล์ภาพต้นฉบับ (เร็ว 0.01 วินาที)
 * 2. หากไม่พบ EXIF ให้ใช้ OCR สแกนข้อความบนภาพ (เน้นโซนล่างและลายน้ำ)
 */
async function extractGpsFromImage(file, dataUrl, updateFormFields = true) {
  if (window.innerWidth <= 768) return null;

  const scanningNotice = document.getElementById('desktopGpsScanningNotice');
  const detectNotice = document.getElementById('desktopGpsDetectNotice');
  const detectedGpsTxt = document.getElementById('desktopDetectedGpsText');

  if (detectNotice) detectNotice.classList.add('hidden');
  if (scanningNotice) scanningNotice.classList.remove('hidden');

  let result = null;

  // 1. ระดับที่ 1: ตรวจจับจาก EXIF GPS Metadata (รวดเร็ว 0.01 วินาที)
  if (typeof exifr !== 'undefined' && file) {
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
        result = {
          lat: gps.latitude,
          lng: gps.longitude,
          source: 'exif'
        };
        console.log('[GPS Detection] Found GPS via EXIF:', result);
      }
    } catch (err) {
      console.warn('[GPS Detection] EXIF error:', err);
    }
  }

  // 2. ระดับที่ 2: ตรวจจับจากตัวอักษรบนภาพ (OCR) หากไม่มี EXIF
  if (!result && typeof Tesseract !== 'undefined' && dataUrl) {
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
      });

      // ครอบตัดโซนล่าง 45% (ตำแหน่งมาตรฐานของลายน้ำพิกัด) เพื่อให้ OCR ทำงานเร็วและแม่นยำ
      const canvas = document.createElement('canvas');
      const cropHeight = Math.round(img.height * 0.45);
      const cropY = img.height - cropHeight;
      canvas.width = img.width;
      canvas.height = cropHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, cropY, img.width, cropHeight, 0, 0, img.width, cropHeight);

      const ocrResult = await Tesseract.recognize(canvas, 'eng+tha', {
        logger: () => {}
      });

      const fullText = (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : '';
      console.log('[GPS Detection] OCR Text:', fullText);

      const parsedGps = parseCoordinatesFromText(fullText);
      if (parsedGps) {
        result = {
          lat: parsedGps.lat,
          lng: parsedGps.lng,
          source: 'ocr'
        };
        console.log('[GPS Detection] Found GPS via OCR:', result);
      }
    } catch (err) {
      console.warn('[GPS Detection] OCR error:', err);
    }
  }

  if (scanningNotice) scanningNotice.classList.add('hidden');

  if (result && typeof result.lat === 'number' && typeof result.lng === 'number') {
    const latNum = Number(result.lat);
    const lngNum = Number(result.lng);
    const latFormatted = latNum.toFixed(6);
    const lngFormatted = lngNum.toFixed(6);

    if (updateFormFields) {
      const coordInput = document.getElementById('coordinates');
      if (coordInput) {
        coordInput.value = `${latFormatted}, ${lngFormatted}`;
        coordInput.classList.add('bg-emerald-50', 'border-emerald-500');
        setTimeout(() => {
          coordInput.classList.remove('bg-emerald-50', 'border-emerald-500');
        }, 2500);
      }

      state.currentLocation = {
        lat: latNum,
        lng: lngNum,
        accuracy: 10
      };

      const locStatus = document.getElementById('locationStatus');
      if (locStatus) {
        locStatus.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>ดึงพิกัดจากภาพถ่ายสำเร็จ (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})</span>`;
      }

      if (detectNotice && detectedGpsTxt) {
        detectedGpsTxt.textContent = `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}`;
        detectNotice.classList.remove('hidden');
      }
    }

    return result;
  }

  return null;
}

/**
 * แยกสกัดพิกัด ละติจูด / ลองจิจูด จากข้อความ OCR
 */
function parseCoordinatesFromText(text) {
  if (!text) return null;

  // 1. รูปแบบตัวอย่าง: 17.3891N 102.8138E หรือ 17.3891°N 102.8138°E
  const matchDir = text.match(/(1[0-9]\.\d{3,8})\s*°?\s*([NS])\s*(10[0-6]\.\d{3,8})\s*°?\s*([EW])/i);
  if (matchDir) {
    let lat = parseFloat(matchDir[1]);
    let lng = parseFloat(matchDir[3]);
    if (matchDir[2].toUpperCase() === 'S') lat = -lat;
    if (matchDir[4].toUpperCase() === 'W') lng = -lng;
    return { lat, lng };
  }

  // 2. รูปแบบทศนิยม: 17.3891, 102.8138 หรือ 17.389100 102.813800
  const matchDec = text.match(/(1[0-9]\.\d{3,8})\s*[,|\s]\s*(10[0-6]\.\d{3,8})/i);
  if (matchDec) {
    return {
      lat: parseFloat(matchDec[1]),
      lng: parseFloat(matchDec[2])
    };
  }

  // 3. รูปแบบสากลทั่วไป: (\d{1,2}\.\d{3,8}) N/S (\d{2,3}\.\d{3,8}) E/W
  const matchGeneral = text.match(/([0-8]?\d\.\d{3,8})\s*°?\s*([NS])\s*([0-1]?\d{1,2}\.\d{3,8})\s*°?\s*([EW])/i);
  if (matchGeneral) {
    let lat = parseFloat(matchGeneral[1]);
    let lng = parseFloat(matchGeneral[3]);
    if (matchGeneral[2].toUpperCase() === 'S') lat = -lat;
    if (matchGeneral[4].toUpperCase() === 'W') lng = -lng;
    return { lat, lng };
  }

  // 4. DMS (องศา ลิปดา พิลิปดา): 17°23'20"N 102°48'50"E
  const matchDms = text.match(/(\d{1,2})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])\s*(\d{2,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([EW])/i);
  if (matchDms) {
    let lat = parseInt(matchDms[1]) + (parseInt(matchDms[2]) / 60) + (parseFloat(matchDms[3]) / 3600);
    let lng = parseInt(matchDms[5]) + (parseInt(matchDms[6]) / 60) + (parseFloat(matchDms[7]) / 3600);
    if (matchDms[4].toUpperCase() === 'S') lat = -lat;
    if (matchDms[8].toUpperCase() === 'W') lng = -lng;
    return { lat, lng };
  }

  return null;
}

/**
 * จัดการระบบอัปโหลดไฟล์รูปภาพบนหน้าจอคอมพิวเตอร์ (> 768px)
 */
function initDesktopUploadEvents() {
  if (elements.desktopImageFileInput) {
    elements.desktopImageFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, HEIC ฯลฯ)', 'warning');
        elements.desktopImageFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
        state.selectedDesktopImageDataUrl = ev.target.result;
        if (elements.desktopPreviewImg) {
          elements.desktopPreviewImg.src = state.selectedDesktopImageDataUrl;
        }
        if (elements.desktopImagePreviewContainer) {
          elements.desktopImagePreviewContainer.classList.remove('hidden');
        }
        if (elements.desktopImageSizeBadge) {
          const sizeKb = Math.round(file.size / 1024);
          elements.desktopImageSizeBadge.textContent = `${file.name} (${sizeKb} KB)`;
        }

        // ตรวจสอบและดึงพิกัด GPS จากภาพถ่ายอัตโนมัติ (เฉพาะ Desktop > 768px)
        if (window.innerWidth > 768) {
          const gpsResult = await extractGpsFromImage(file, state.selectedDesktopImageDataUrl, true);
          if (gpsResult && typeof gpsResult.lat === 'number' && typeof gpsResult.lng === 'number') {
            state.desktopPhotoHadGps = true;
            state.desktopBaselineLocation = null;
          } else {
            // ไม่พบพิกัดในภาพถ่าย
            state.desktopPhotoHadGps = false;

            // ดึงข้อมูลพิกัดจากจุดที่อัปโหลดเป็นค่าพื้นฐาน
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const baseLat = Number(pos.coords.latitude.toFixed(6));
                  const baseLng = Number(pos.coords.longitude.toFixed(6));
                  state.desktopBaselineLocation = { lat: baseLat, lng: baseLng };
                  state.lat = baseLat;
                  state.lng = baseLng;
                  if (elements.coordinatesInput) {
                    elements.coordinatesInput.value = `${baseLat.toFixed(6)}, ${baseLng.toFixed(6)}`;
                    elements.coordinatesInput.classList.add('ring-2', 'ring-amber-400', 'bg-amber-50');
                    setTimeout(() => {
                      elements.coordinatesInput.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-50');
                    }, 3500);
                  }
                  if (elements.locationStatus) {
                    elements.locationStatus.innerHTML = `<span class="text-amber-700 font-semibold"><i class="fa-solid fa-location-dot mr-1"></i>พิกัดตำแหน่งปัจจุบันของคุณ (${baseLat.toFixed(4)}, ${baseLng.toFixed(4)}) - กรุณาตรวจสอบหรือพิมพ์แก้ไข</span>`;
                  }
                },
                (err) => {
                  console.warn('Cannot fetch baseline coords:', err);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
              );
            }

            Swal.fire({
              icon: 'info',
              title: 'ไม่พบพิกัดในภาพถ่าย',
              html: `
                <div class="text-left text-xs space-y-2 text-gray-700 leading-relaxed">
                  <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 font-medium">
                    <i class="fa-solid fa-triangle-exclamation mr-1 text-amber-600"></i>
                    ภาพที่คุณแนบไม่มีลักษณะอ้างอิงพิกัดจากภาพได้
                  </div>
                  <p>ระบบจะทำการดึงข้อมูลพิกัดจากจุดที่คุณอัปโหลดเป็นค่าพื้นฐาน</p>
                  <p class="font-bold text-blue-700">กรุณากรอกพิกัดที่ตำแหน่ง <u>"พิกัด GPS (สามารถพิมพ์แก้ไขพิกัดได้)"</u> ด้วย</p>
                </div>
              `,
              confirmButtonText: '<i class="fa-solid fa-check mr-1.5"></i> รับทราบและตรวจสอบพิกัด',
              confirmButtonColor: '#2563eb'
            });
          }
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // โหลดค่าตัวเลือก "ภาพถ่ายมีพิกัดบนภาพ" ที่บันทึกไว้ใน localStorage
  const savedHasWatermark = localStorage.getItem('slts_desktop_has_watermark') === 'true';
  if (elements.chkDesktopHasWatermark) {
    elements.chkDesktopHasWatermark.checked = savedHasWatermark;
    updateDesktopWatermarkBadge(savedHasWatermark);

    elements.chkDesktopHasWatermark.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      localStorage.setItem('slts_desktop_has_watermark', isChecked ? 'true' : 'false');
      updateDesktopWatermarkBadge(isChecked);
    });
  }

  if (elements.btnConfirmDesktopUpload) {
    elements.btnConfirmDesktopUpload.addEventListener('click', handleDesktopUpload);
  }
}

function updateDesktopWatermarkBadge(hasWatermark) {
  if (!elements.desktopWatermarkBadge) return;
  if (hasWatermark) {
    elements.desktopWatermarkBadge.textContent = 'ภาพมีพิกัดแล้ว (ไม่ออกแบบลายน้ำทับ)';
    elements.desktopWatermarkBadge.className = 'text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200';
  } else {
    elements.desktopWatermarkBadge.textContent = 'ประทับลายน้ำอัตโนมัติ';
    elements.desktopWatermarkBadge.className = 'text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200';
  }
}

window.viewDesktopFullPreview = function() {
  if (!state.selectedDesktopImageDataUrl) return;
  Swal.fire({
    title: 'ตัวอย่างรูปภาพขนาดเต็ม',
    imageUrl: state.selectedDesktopImageDataUrl,
    imageAlt: 'ตัวอย่างรูปภาพ',
    showCloseButton: true,
    showConfirmButton: false,
    width: 'auto',
    customClass: {
      popup: 'p-4 rounded-2xl slts-image-preview-popup',
      image: 'slts-preview-image-constrained'
    }
  });
};

async function handleDesktopUpload() {
  // 1. ตรวจสอบการแนบไฟล์รูปภาพก่อนเป็นอันดับแรก (เฉพาะ Desktop > 768px)
  const hasFile = state.selectedDesktopImageDataUrl || (elements.desktopImageFileInput && elements.desktopImageFileInput.files && elements.desktopImageFileInput.files.length > 0);
  if (!hasFile) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาแนบไฟล์รูปภาพ',
      text: 'โปรดเลือกและแนบไฟล์รูปภาพส่งหมายจากเครื่องคอมพิวเตอร์ก่อนกด "ยืนยันอัพโหลดภาพส่งหมาย"',
      confirmButtonColor: '#2563eb'
    });
    if (elements.desktopImageFileInput) elements.desktopImageFileInput.focus();
    return;
  }

  // 2. ตรวจสอบความครบถ้วนและความถูกต้องของข้อมูลในแบบฟอร์มที่บังคับกรอก
  if (!validateForm()) return;

  // 3. ตรวจสอบกรณีภาพที่แนบไม่มีพิกัดในตัวภาพ (เฉพาะ Desktop > 768px)
  if (window.innerWidth > 768 && state.desktopPhotoHadGps === false) {
    const currentLat = state.lat;
    const currentLng = state.lng;
    const baseline = state.desktopBaselineLocation;

    const isSameAsBaseline = baseline && (Math.abs(currentLat - baseline.lat) < 0.00001 && Math.abs(currentLng - baseline.lng) < 0.00001);

    if (isSameAsBaseline) {
      // ถามย้ำอีกครั้งว่าตรวจสอบพิกัดแล้วใช่หรือไม่ และแสดงพิกัดให้เห็นว่าเป็นพิกัดที่ได้จากการดึงข้อมูลที่ตั้งปัจจุบัน
      const confirmCheck = await Swal.fire({
        icon: 'question',
        title: 'คุณตรวจสอบพิกัดแล้วใช่หรือไม่?',
        html: `
          <div class="text-left text-xs space-y-2 text-gray-700 leading-relaxed">
            <p>เนื่องจากภาพถ่ายที่แนบไม่มีข้อมูลพิกัดในตัวภาพ ระบบจึงใช้พิกัดที่ดึงได้จากที่ตั้งปัจจุบันของคุณ:</p>
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center">
              <span class="text-xs text-blue-600 block font-semibold mb-1">พิกัดที่ดึงจากที่ตั้งปัจจุบัน:</span>
              <span class="text-sm font-mono font-bold text-blue-900">📍 ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}</span>
            </div>
            <p class="text-gray-600 text-[11px]">* หากจุดส่งหมายจริงไม่ใช่ตำแหน่งนี้ กรุณากดยกเลิก แล้วพิมพ์แก้ไขพิกัดที่ถูกต้องในช่อง "พิกัด GPS"</p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-check mr-1.5"></i> ยืนยันพิกัดถูกต้องแล้ว อัปโหลดต่อ',
        cancelButtonText: '<i class="fa-solid fa-pen-to-square mr-1.5"></i> ยกเลิก เพื่อกลับไปแก้ไขพิกัด',
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#6b7280',
        allowOutsideClick: false
      });

      if (!confirmCheck.isConfirmed) {
        if (elements.coordinatesInput) {
          elements.coordinatesInput.focus();
          elements.coordinatesInput.select();
        }
        return;
      }
    } else if (baseline) {
      // ข้อมูลที่แก้ไขใหม่เป็นคนละข้อมูลกับที่ดึงได้จากพิกัดที่ตั้งอยู่
      const diffLat = Math.abs(currentLat - baseline.lat);
      const diffLng = Math.abs(currentLng - baseline.lng);
      if (diffLat > 1.0 || diffLng > 1.0) {
        const confirmDiff = await Swal.fire({
          icon: 'warning',
          title: 'พิกัดที่ระบุต่างจากตำแหน่งปัจจุบัน',
          html: `
            <div class="text-left text-xs space-y-2 text-gray-700 leading-relaxed">
              <p>พิกัดที่คุณกรอกแก้ไข (<b>${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}</b>) มีความแตกต่างจากตำแหน่งปัจจุบันที่ระบบตรวจจับได้ (<b>${baseline.lat.toFixed(4)}, ${baseline.lng.toFixed(4)}</b>) มากกว่า 1 หน่วย</p>
              <div class="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-center font-mono font-bold text-gray-800 text-xs">
                พิกัดที่จะใช้บันทึก: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}
              </div>
              <p class="font-semibold text-gray-800">คุณต้องการยืนยันใช้อัปโหลดด้วยพิกัดนี้ใช่หรือไม่?</p>
            </div>
          `,
          showCancelButton: true,
          confirmButtonText: 'ยืนยันใช้พิกัดนี้',
          cancelButtonText: 'กลับไปตรวจสอบพิกัด',
          confirmButtonColor: '#2563eb',
          cancelButtonColor: '#6b7280',
          allowOutsideClick: false
        });

        if (!confirmDiff.isConfirmed) {
          if (elements.coordinatesInput) elements.coordinatesInput.focus();
          return;
        }
      }
    }
  }

  try {
    const caseNumber = getFormattedCaseNumber();
    const courtType = (elements.courtTypeSelect ? elements.courtTypeSelect.value : '') || 'ศาลจังหวัดอุดรธานี';
    const province = state.selectedProvince || (elements.provinceSelect ? elements.provinceSelect.value : '') || 'อุดรธานี';
    const district = elements.districtSelect ? elements.districtSelect.value : '';
    const subdistrict = elements.subdistrictSelect ? elements.subdistrictSelect.value : '';
    const locationType = elements.locationTypeSelect ? elements.locationTypeSelect.value : 'หมายบ้าน';
    const locationText = getFullLocationText();
    const heading = window.compassManager ? window.compassManager.getHeading() : 0;

    const payloadData = {
      caseNumber: caseNumber,
      courtType: courtType,
      province: province,
      district: district,
      subdistrict: subdistrict,
      locationType: locationType,
      locationText: locationText,
      lat: state.lat,
      lng: state.lng,
      heading: heading,
      dateTime: WatermarkEngine.formatThaiDateTime(new Date())
    };

    const hasWatermarkAlready = elements.chkDesktopHasWatermark ? elements.chkDesktopHasWatermark.checked : false;
    let finalImageDataUrl;

    if (hasWatermarkAlready) {
      // ผู้ใช้ระบุว่าภาพมีพิกัด/ลายน้ำอยู่แล้ว ไม่ต้องประทับลายน้ำซ้ำ
      showCustomLoading('กำลังประมวลผลรูปภาพ...', 'กำลังเตรียมไฟล์รูปภาพเพื่ออัปโหลด');
      finalImageDataUrl = state.selectedDesktopImageDataUrl;
    } else {
      // วาดลายน้ำลงบนรูปภาพ
      showCustomLoading('กำลังประมวลผลลายน้ำและรูปภาพ...', 'กำลังสร้างภาพถ่ายพร้อมข้อมูลส่งหมาย');
      const img = new Image();
      img.src = state.selectedDesktopImageDataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const watermarkedResult = await WatermarkEngine.renderWatermark(img, payloadData);
      finalImageDataUrl = watermarkedResult.dataUrl;
    }

    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';

    hideCustomLoading();

    // บีบอัดรูปภาพให้ไม่เกิน 1MB (ไม่ต้องดาวน์โหลดไฟล์ลงเครื่องเพราะเป็นการอัปโหลดไฟล์จากเครื่อง)
    const compressedImageBase64 = await compressImageToMax1MB(finalImageDataUrl);

    const uploadPayload = {
      action: 'upload_image',
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    // 3. ตรวจสอบสถานะการเชื่อมต่ออินเทอร์เน็ต
    if (!navigator.onLine) {
      addToOfflineQueue({
        payload: uploadPayload,
        fileName: imageFilename,
        caseNumber: caseNumber
      });

      Swal.fire({
        icon: 'info',
        title: 'บันทึกสำเร็จ (โหมดออฟไลน์)',
        html: `
          <div class="text-left text-xs space-y-2 text-gray-700">
            <p>บันทึกภาพถ่ายเลขคดี <b>${caseNumber}</b> ลงในเครื่องเรียบร้อยแล้ว</p>
            <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
              <i class="fa-solid fa-cloud-arrow-up mr-1 text-amber-600"></i>
              <b>แจ้งเตือน:</b> เนื่องจากขณะนี้ไม่มีสัญญาณอินเทอร์เน็ต ระบบได้จัดเก็บข้อมูลเข้าสู่ <b>คิวออฟไลน์</b> ในเครื่องไว้แล้ว และจะทำการอัปโหลดขึ้น Google Drive & Sheet ให้โดยอัตโนมัติเมื่อท่านเชื่อมต่ออินเทอร์เน็ต
            </div>
          </div>
        `,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#2563eb',
        showCloseButton: true,
        allowOutsideClick: false
      });
      resetDesktopForm();
      return;
    }

    // อัปโหลดขึ้น Google Drive พร้อมนำเข้าข้อมูลลง Google Sheet ในขั้นตอนเดียว
    const resJson = await uploadWithProgressBar(uploadPayload, `กำลังอัปโหลดภาพเลขคดี ${caseNumber}...`);

    // เคลียร์แคชและโหลดข้อมูลใหม่
    localStorage.removeItem(CACHE_KEY_SHEET_DATA);
    localStorage.removeItem(CACHE_KEY_SHEET_TIME);

    Swal.fire({
      icon: 'success',
      title: 'อัปโหลดภาพสำเร็จ!',
      showCloseButton: true,
      allowOutsideClick: false,
      html: `<p class="text-gray-700">อัปโหลดภาพถ่ายเลขคดี <b>${caseNumber}</b> ลงใน Google Drive & Sheet เรียบร้อยแล้ว</p>
             ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
      confirmButtonColor: '#2563eb'
    }).then(() => {
      resetDesktopForm();
      loadGoogleSheetData(true);
    });

  } catch (err) {
    console.error('Desktop upload error:', err);
    hideCustomLoading();
    Swal.fire({
      icon: 'error',
      title: 'การอัปโหลดไม่สำเร็จ',
      text: err.message,
      showCloseButton: true,
      allowOutsideClick: false,
      confirmButtonColor: '#2563eb'
    });
  }
}

function resetDesktopForm() {
  resetFormForNextCase();
  state.selectedDesktopImageDataUrl = null;
  if (elements.desktopImageFileInput) elements.desktopImageFileInput.value = '';
  if (elements.desktopImagePreviewContainer) elements.desktopImagePreviewContainer.classList.add('hidden');
  if (elements.desktopPreviewImg) elements.desktopPreviewImg.src = '';
}

/**
 * สลับมุมมองกล้องระหว่าง แนวนอน (4:3) และ แนวตั้ง (3:4)
 */
function toggleOrientation() {
  const nextMode = state.captureOrientation === 'landscape' ? 'portrait' : 'landscape';
  setCaptureOrientation(nextMode);
}

function setCaptureOrientation(mode) {
  state.captureOrientation = mode;
  const isLandscape = mode === 'landscape';

  if (elements.liveOverlayFrame) {
    if (isLandscape) {
      elements.liveOverlayFrame.className = 'camera-live-frame ratio-4-3 pointer-events-none';
    } else {
      elements.liveOverlayFrame.className = 'camera-live-frame ratio-3-4 pointer-events-none';
    }
  }

  if (elements.txtOrientationMode) {
    elements.txtOrientationMode.textContent = isLandscape ? 'แนวนอน 4:3' : 'แนวตั้ง 3:4';
  }
}

function validateForm() {
  const courtType = (elements.courtTypeSelect ? elements.courtTypeSelect.value : '') || (document.getElementById('courtType') ? document.getElementById('courtType').value : '');

  // 1. ตรวจสอบชื่อศาลกรณีเลือกศาลที่ไม่สังกัดภาค
  if (state.desktopCourtCategory === 'ศาลที่ไม่สังกัดภาค') {
    const customCourtName = (elements.courtNameInput ? elements.courtNameInput.value : '').trim();
    if (!customCourtName) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุชื่อศาล',
        text: 'เนื่องจากเลือกประเภทศาลที่ไม่สังกัดภาค โปรดระบุชื่อศาลให้ครบถ้วน เช่น ศาลแพ่ง, ศาลอาญา',
        confirmButtonColor: '#2563eb'
      });
      if (elements.courtNameInput) elements.courtNameInput.focus();
      return false;
    }
  }

  // 2. ตรวจสอบข้อมูลเลขคดี
  const isOther = courtType === 'ศาลอื่น' || courtType === 'หมายศาลอื่น';
  if (!isOther) {
    const prefix = (elements.udonPrefixInput ? elements.udonPrefixInput.value : '').trim();
    const caseNo = (elements.udonCaseNoInput ? elements.udonCaseNoInput.value : '').trim();

    if (!prefix) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุอักษรนำหน้าเลขคดี',
        text: 'โปรดเลือกหรือพิมพ์อักษรนำหน้า เช่น ผบE, อ, ย, พ, ผบ.',
        confirmButtonColor: '#2563eb'
      });
      if (elements.udonPrefixInput) elements.udonPrefixInput.focus();
      return false;
    }

    if (!caseNo) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกเลขคดี',
        text: 'โปรดระบุหมายเลขคดี (ตัวเลขเท่านั้น) เช่น 1245',
        confirmButtonColor: '#2563eb'
      });
      if (elements.udonCaseNoInput) elements.udonCaseNoInput.focus();
      return false;
    }

    // บันทึกอักษรนำหน้าใหม่ลงในฐานข้อมูลประวัติ
    saveCasePrefix(prefix);

  } else {
    const otherNo = (elements.otherCaseNoInput ? elements.otherCaseNoInput.value : '').trim();
    if (!otherNo) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกเลขคดี',
        text: 'โปรดระบุหมายเลขคดี เช่น 2097',
        confirmButtonColor: '#2563eb'
      });
      if (elements.otherCaseNoInput) elements.otherCaseNoInput.focus();
      return false;
    }
  }

  // 3. ตรวจสอบอำเภอ
  const districtVal = elements.districtSelect ? elements.districtSelect.value.trim() : '';
  if (!districtVal || districtVal.startsWith('--') || districtVal === '') {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกอำเภอ',
      text: 'โปรดเลือกอำเภอที่ส่งหมายให้ครบถ้วน',
      confirmButtonColor: '#2563eb'
    });
    if (elements.districtSelect) elements.districtSelect.focus();
    return false;
  }

  // 4. ตรวจสอบตำบล
  const subdistrictVal = elements.subdistrictSelect ? elements.subdistrictSelect.value.trim() : '';
  if (!subdistrictVal || subdistrictVal.startsWith('--') || subdistrictVal === '') {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกตำบล',
      text: 'โปรดเลือกตำบลที่ส่งหมายให้ครบถ้วน',
      confirmButtonColor: '#2563eb'
    });
    if (elements.subdistrictSelect) elements.subdistrictSelect.focus();
    return false;
  }

  // 5. ตรวจสอบประเภทสถานที่และข้อมูลสถานที่
  if (elements.locationTypeSelect.value === 'หมายบ้าน') {
    const houseNo = elements.houseNoInput ? elements.houseNoInput.value.trim() : '';
    if (!houseNo) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกบ้านเลขที่',
        text: 'สำหรับหมายบ้าน บังคับต้องระบุบ้านเลขที่ เช่น 154/2 หรือ 2/18',
        confirmButtonColor: '#2563eb'
      });
      if (elements.houseNoInput) elements.houseNoInput.focus();
      return false;
    }
  } else if (elements.locationTypeSelect.value === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    const adminText = elements.localAdminNameInput ? elements.localAdminNameInput.value.trim() : '';
    if (!adminText) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุที่ทำการปกครองส่วนท้องถิ่น',
        text: 'โปรดระบุชื่อหน่วยงาน เช่น ที่ทำการปกครองส่วนท้องถิ่น หรือ อบต....',
        confirmButtonColor: '#2563eb'
      });
      if (elements.localAdminNameInput) elements.localAdminNameInput.focus();
      return false;
    }
  } else if (elements.locationTypeSelect.value === 'อื่นๆ') {
    const otherText = elements.customOtherLocationName ? elements.customOtherLocationName.value.trim() : '';
    if (!otherText) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุชื่อสถานที่อื่นๆ',
        text: 'โปรดระบุชื่อสถานที่ส่งหมาย เช่น โรงเรียน, วัด, โรงพยาบาล...',
        confirmButtonColor: '#2563eb'
      });
      if (elements.customOtherLocationName) elements.customOtherLocationName.focus();
      return false;
    }
  }

  // 6. ตรวจสอบและดึงพิกัดจากช่องกรอกพิกัด (ตรวจสอบรูปแบบและขอบเขตพิกัดอย่างละเอียด)
  const coordsRaw = (elements.coordinatesInput ? elements.coordinatesInput.value : '').trim();
  if (!coordsRaw) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาระบุพิกัด GPS',
      text: 'โปรดกรอกพิกัด ละติจูด, ลองจิจูด เช่น 17.381600, 102.757800 หรือกด "เช็คพิกัดใหม่"',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  const coordParts = coordsRaw.split(/[,;\s]+/).map(p => p.trim()).filter(p => p.length > 0);
  if (coordParts.length < 2) {
    Swal.fire({
      icon: 'warning',
      title: 'รูปแบบพิกัดไม่ถูกต้อง',
      text: 'กรุณากรอกทั้ง ละติจูด และ ลองจิจูด คั่นด้วยเครื่องหมายจุลภาค (,) เช่น 17.381600, 102.757800',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  const latStr = coordParts[0];
  const lngStr = coordParts[1];

  // ตรวจสอบรูปแบบ: ตัวเลขไม่เกิน 3 หลัก มีจุดทศนิยม และหลังทศนิยมไม่เกิน 6 หลัก
  const latRegex = /^\d{1,3}(\.\d{1,6})?$/;
  const lngRegex = /^\d{1,3}(\.\d{1,6})?$/;

  if (!latRegex.test(latStr)) {
    Swal.fire({
      icon: 'warning',
      title: 'รูปแบบละติจูด (Latitude) ไม่ถูกต้อง',
      text: 'ละติจูดต้องเป็นตัวเลขไม่เกิน 3 หลัก และจุดทศนิยมไม่เกิน 6 หลัก (เช่น 17.381600)',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  if (!lngRegex.test(lngStr)) {
    Swal.fire({
      icon: 'warning',
      title: 'รูปแบบลองจิจูด (Longitude) ไม่ถูกต้อง',
      text: 'ลองจิจูดต้องเป็นตัวเลขไม่เกิน 3 หลัก และจุดทศนิยมไม่เกิน 6 หลัก (เช่น 102.757800)',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  const latNum = parseFloat(latStr);
  const lngNum = parseFloat(lngStr);

  // ตรวจสอบค่าหน้าจุดทศนิยมของละติจูดในประเทศไทย (ต้องไม่เกิน 20 และไม่น้อยกว่า 5)
  if (latNum <= 0 || latNum > 20.999999) {
    Swal.fire({
      icon: 'warning',
      title: 'ค่าละติจูดไม่อยู่ในขอบเขตประเทศไทย',
      text: 'ค่าละติจูด (Latitude) ในประเทศไทย ต้องมีค่าหน้าจุดทศนิยมไม่เกิน 20 (เช่น 17.xxxxxx)',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  // ตรวจสอบขอบเขตลองจิจูดในประเทศไทย (โดยทั่วไปอยู่ระหว่าง 97 - 106)
  if (lngNum < 95 || lngNum > 107) {
    Swal.fire({
      icon: 'warning',
      title: 'ค่าลองจิจูดไม่อยู่ในขอบเขตประเทศไทย',
      text: 'ค่าลองจิจูด (Longitude) ในประเทศไทย ต้องอยู่ระหว่าง 97 - 106 (เช่น 102.xxxxxx)',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  state.lat = Number(latNum.toFixed(6));
  state.lng = Number(lngNum.toFixed(6));

  return true;
}

/**
 * ตรวจสอบและขออนุญาตเข้าถึงกล้องในระบบสำหรับหน้าจอคอมพิวเตอร์และอุปกรณ์
 * @param {boolean} isUserInitiated - หากเป็นการกดสั่งจากผู้ใช้โดยตรง ให้แสดงกล่องข้อความแจ้งเตือนเมื่อไม่อนุญาต
 */
async function checkAndRequestCameraPermission(isUserInitiated = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('[Camera] navigator.mediaDevices.getUserMedia is not supported in this browser.');
    return false;
  }

  try {
    // 1. ตรวจสอบสถานะการอนุญาตผ่าน Permissions API หากเบราว์เซอร์รองรับ
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'camera' });
        console.log('[Camera] Current permission status:', permissionStatus.state);
        
        if (permissionStatus.state === 'granted') {
          return true;
        }

        permissionStatus.onchange = () => {
          console.log('[Camera] Permission status changed to:', permissionStatus.state);
        };
      } catch (permErr) {
        console.log('[Camera] Permissions API query not supported on this browser, fallback to getUserMedia check.');
      }
    }

    // 2. ขอสิทธิ์เข้าถึงกล้องผ่าน getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });

    if (stream) {
      // เมื่อได้รับสิทธิ์ ให้หยุดแทร็กทันที เพื่อไม่ให้ไฟกล้องเปิดค้าง
      stream.getTracks().forEach(track => track.stop());
      console.log('[Camera] Camera access permission granted.');
      return true;
    }
  } catch (err) {
    console.warn('[Camera] Camera permission request error / denied:', err);
    if (isUserInitiated) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถเข้าถึงกล้องถ่ายภาพได้',
        text: 'โปรดอนุญาตให้เว็บไซต์เข้าถึงกล้องในการตั้งค่าของเบราว์เซอร์ เพื่อใช้งานกล้องถ่ายภาพ',
        confirmButtonColor: '#2563eb'
      });
    }
    return false;
  }
  return false;
}

window.checkAndRequestCameraPermission = checkAndRequestCameraPermission;

/**
 * ตรวจสอบความสมบูรณ์ของข้อมูลส่งหมายก่อนอนุญาตให้ถ่ายภาพ
 * - เลขคดี (ศาลปกติ: อักษร + เลขคดี | หมาย ต.: เลขคดี ต. | ศาลไม่สังกัดภาค: ชื่อศาล + อักษร + เลขคดี)
 * - สถานที่ส่งหมาย (หมายบ้าน: บ้านเลขที่ | อื่นๆ: ระบุสถานที่ | ท้องถิ่น: ชื่อหน่วยงาน)
 */
function isFormValidForCapture() {
  const courtCategory = state.selectedCourtCategory || state.desktopCourtCategory || (elements.courtTypeSelect ? elements.courtTypeSelect.value : '') || 'ศาลจังหวัด';
  const isOther = courtCategory === 'ศาลอื่น' || courtCategory === 'หมายศาลอื่น';

  if (isOther) {
    const otherNo = (elements.otherCaseNoInput ? elements.otherCaseNoInput.value : '').trim();
    if (!otherNo) return false;
  } else {
    const prefix = (elements.udonPrefixInput ? elements.udonPrefixInput.value : '').trim();
    const caseNo = (elements.udonCaseNoInput ? elements.udonCaseNoInput.value : '').trim();
    if (!prefix || !caseNo) return false;
    if (courtCategory === 'ศาลที่ไม่สังกัดภาค') {
      const customCourt = (elements.courtNameInput ? elements.courtNameInput.value : '').trim();
      if (!customCourt) return false;
    }
  }

  const locationType = elements.locationTypeSelect ? elements.locationTypeSelect.value : 'หมายบ้าน';
  if (locationType === 'หมายบ้าน') {
    const houseNo = elements.houseNoInput ? elements.houseNoInput.value.trim() : '';
    if (!houseNo) return false;
  } else if (locationType === 'อื่นๆ') {
    const otherLoc = elements.customOtherLocationName ? elements.customOtherLocationName.value.trim() : '';
    if (!otherLoc) return false;
  } else if (locationType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    const adminName = elements.localAdminNameInput ? elements.localAdminNameInput.value.trim() : '';
    if (!adminName) return false;
  }

  return true;
}

window.isFormValidForCapture = isFormValidForCapture;

/**
 * อัปเดตสถานะปุ่มชัตเตอร์ถ่ายภาพ (Disabled / Enabled)
 */
function updateCaptureButtonState() {
  const btnCapture = elements.btnCapture || document.getElementById('btnCapture');
  if (!btnCapture) return;

  const isValid = isFormValidForCapture();
  if (isValid) {
    btnCapture.disabled = false;
    btnCapture.classList.remove('opacity-40', 'cursor-not-allowed', 'filter', 'grayscale');
    btnCapture.removeAttribute('title');
    btnCapture.setAttribute('title', 'กดถ่ายภาพ');
  } else {
    btnCapture.disabled = true;
    btnCapture.classList.add('opacity-40', 'cursor-not-allowed', 'filter', 'grayscale');
    btnCapture.setAttribute('title', 'กรุณากรอกข้อมูลเลขคดีและสถานที่ส่งหมายก่อนถ่ายภาพ (กดปุ่ม "ฟอร์มข้อมูล")');
  }
}

window.updateCaptureButtonState = updateCaptureButtonState;

async function openCameraModal() {
  // เปิดโหมดพื้นฐานเป็นแนวนอน 4:3
  setCaptureOrientation('landscape');

  elements.cameraModal.classList.remove('hidden');
  elements.cameraModal.classList.add('flex');
  updateCaptureButtonState();
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

function startLiveCameraHUD() {
  stopLiveCameraHUD();
  updateLiveMapHUD();

  const updateHUD = () => {
    if (!elements.cameraModal || elements.cameraModal.classList.contains('hidden')) return;

    if (elements.liveCompassCanvas && window.compassManager) {
      const ctx = elements.liveCompassCanvas.getContext('2d');
      ctx.clearRect(0, 0, 84, 84);
      window.compassManager.drawCompass(ctx, 42, 42, 34);
    }

    const dateStr = WatermarkEngine.formatThaiDateTime(new Date());
    const latFormatted = state.lat ? `${Math.abs(state.lat).toFixed(4)}°${state.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
    const lngFormatted = state.lng ? `${Math.abs(state.lng).toFixed(4)}°${state.lng >= 0 ? 'E' : 'W'}` : '102.7882°E';
    const headingDeg = window.compassManager ? window.compassManager.getHeading() : 0;
    const dirText = window.compassManager ? window.compassManager.getDirectionText(headingDeg) : 'N';

    const caseNum = getFormattedCaseNumber();
    const locText = getFullLocationText();
    const isReady = isFormValidForCapture();

    if (elements.liveBadgeDate) elements.liveBadgeDate.textContent = `📅  ${dateStr}`;
    if (elements.liveBadgeCoords) elements.liveBadgeCoords.textContent = `📍  ${latFormatted} ${lngFormatted} ${headingDeg}° ${dirText}`;
    if (elements.liveBadgeLocation) {
      elements.liveBadgeLocation.textContent = isReady && locText ? `🏠  ${locText}` : (locText || `🏠  (กด "ฟอร์มข้อมูล" เพื่อระบุสถานที่)`);
    }
    if (elements.liveBadgeCase) {
      elements.liveBadgeCase.textContent = isReady && caseNum ? `⚖️  เลขคดี: ${caseNum}` : `⚖️  เลขคดี: (กด "ฟอร์มข้อมูล")`;
    }

    updateCaptureButtonState();
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

async function captureAndProcessPhoto() {
  if (!isFormValidForCapture()) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้กรอกข้อมูลส่งหมาย',
      text: 'กรุณากดปุ่ม "ฟอร์มข้อมูล" ด้านบน เพื่อระบุข้อมูลเลขคดีและสถานที่ส่งหมายให้ครบถ้วนก่อนถ่ายภาพ',
      confirmButtonText: 'เปิดฟอร์มข้อมูล',
      confirmButtonColor: '#2563eb',
      showCancelButton: true,
      cancelButtonText: 'ปิด'
    }).then((res) => {
      if (res.isConfirmed) {
        showMobileSummonsFormModal(true);
      }
    });
    return;
  }

  if (!elements.videoPreview.videoWidth) {
    Swal.fire({
      icon: 'error',
      title: 'ข้อผิดพลาด',
      text: 'กล้องยังไม่พร้อมใช้งาน',
      showCloseButton: true,
      allowOutsideClick: false
    });
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
      province: state.selectedProvince || 'อุดรธานี',
      district: elements.districtSelect.value,
      subdistrict: elements.subdistrictSelect.value,
      locationType: elements.locationTypeSelect.value,
      locationText: locationText,
      lat: state.lat,
      lng: state.lng,
      heading: currentHeading,
      dateTime: WatermarkEngine.formatThaiDateTime(new Date())
    };

    const result = await WatermarkEngine.renderWatermark(elements.videoPreview, payloadData, state.captureOrientation);
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';
    
    closeCameraModal();
    hideCustomLoading();

    // 1. บันทึกลงอุปกรณ์ทันที (เงียบๆ ไม่เด้งถามเปิดไฟล์)
    WatermarkEngine.triggerDownload(result.dataUrl, imageFilename);

    // 2. ปรับลดขนาดรูปภาพให้ <= 1MB
    const compressedImageBase64 = await compressImageToMax1MB(result.dataUrl);

    const uploadPayload = {
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    // 3. ตรวจสอบสถานะการเชื่อมต่ออินเทอร์เน็ต
    if (!navigator.onLine) {
      // โหมดออฟไลน์: จัดเก็บเข้า Offline Queue
      addToOfflineQueue({
        payload: uploadPayload,
        fileName: imageFilename,
        caseNumber: caseNumber
      });

      Swal.fire({
        icon: 'info',
        title: 'บันทึกสำเร็จ (โหมดออฟไลน์)',
        html: `
          <div class="text-left text-xs space-y-2 text-gray-700">
            <p>บันทึกภาพถ่ายเลขคดี <b>${caseNumber}</b> ลงในเครื่องเรียบร้อยแล้ว 📷</p>
            <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
              <i class="fa-solid fa-cloud-arrow-up mr-1 text-amber-600"></i>
              <b>แจ้งเตือน:</b> เนื่องจากขณะนี้ไม่มีสัญญาณอินเทอร์เน็ต ระบบได้จัดเก็บข้อมูลเข้าสู่ <b>คิวออฟไลน์</b> ในเครื่องไว้แล้ว และจะทำการอัปโหลดขึ้น Google Drive & Sheet ให้โดยอัตโนมัติเมื่อท่านเชื่อมต่ออินเทอร์เน็ต
            </div>
          </div>
        `,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#2563eb',
        showCloseButton: true,
        allowOutsideClick: false
      }).then(() => {
        resetFormForNextCase();
      });
      return;
    }

    // อัปโหลดขึ้น Google Drive ทันทีพร้อมบันทึกข้อมูลเข้า Google Sheet (Single Step) พร้อม Progress Bar
    const resJson = await uploadWithProgressBar(uploadPayload, `กำลังอัปโหลดภาพเลขคดี ${caseNumber}...`);

    // เคลียร์แคช
    localStorage.removeItem(CACHE_KEY_SHEET_DATA);
    localStorage.removeItem(CACHE_KEY_SHEET_TIME);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ!',
      html: `<p class="text-gray-700">บันทึกภาพถ่ายและอัปโหลดขึ้น Google Drive เลขคดี <b>${caseNumber}</b> เรียบร้อยแล้ว</p>
             ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#2563eb',
      showCloseButton: true,
      allowOutsideClick: false
    }).then(() => {
      resetFormForNextCase();
    });

  } catch (error) {
    console.error('Capture/Upload error:', error);
    hideCustomLoading();

    // บันทึกเข้า Offline Queue เผื่ออัปโหลดใหม่
    try {
      const caseNumber = getFormattedCaseNumber();
      const baseFilename = caseNumber.replace(/\//g, '-');
      const imageFilename = baseFilename + '.jpg';
      addToOfflineQueue({
        payload: {
          caseNumber: caseNumber,
          courtType: elements.courtTypeSelect.value,
          province: state.selectedProvince || 'อุดรธานี',
          district: elements.districtSelect.value,
          subdistrict: elements.subdistrictSelect.value,
          locationType: elements.locationTypeSelect.value,
          locationText: getFullLocationText(),
          lat: state.lat,
          lng: state.lng,
          heading: window.compassManager ? window.compassManager.getHeading() : 0,
          dateTime: WatermarkEngine.formatThaiDateTime(new Date()),
          fileName: imageFilename
        },
        fileName: imageFilename,
        caseNumber: caseNumber
      });
    } catch (e) {
      console.warn('Queue fallback notice:', e);
    }

    Swal.fire({
      icon: 'warning',
      title: 'การอัปโหลดออนไลน์ขัดข้อง',
      html: `<p class="text-sm text-gray-700 mb-2">บันทึกรูปภาพลงอุปกรณ์เรียบร้อยแล้ว แต่การอัปโหลดขึ้น Google Drive ขัดข้อง</p>
             <p class="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mb-3"><i class="fa-solid fa-cloud-arrow-up mr-1"></i>ระบบได้จัดเก็บข้อมูลเข้าสู่ <b>คิวออฟไลน์</b> ให้แล้ว โดยจะทำการซิงค์ให้อัตโนมัติเมื่อเชื่อมต่ออินเทอร์เน็ต</p>`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#2563eb',
      showCloseButton: true,
      allowOutsideClick: false
    }).then(() => {
      resetFormForNextCase();
    });
  }
}

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
      province: state.selectedProvince || 'อุดรธานี',
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
    
    hideCustomLoading();

    // 1. บันทึกลงอุปกรณ์ทันที
    WatermarkEngine.triggerDownload(result.dataUrl, imageFilename);

    // 2. ปรับลดขนาดรูปภาพให้ <= 1MB
    const compressedImageBase64 = await compressImageToMax1MB(result.dataUrl);

    const uploadPayload = {
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    if (!navigator.onLine) {
      addToOfflineQueue({
        payload: uploadPayload,
        fileName: imageFilename,
        caseNumber: caseNumber
      });

      Swal.fire({
        icon: 'info',
        title: 'บันทึกสำเร็จ (โหมดออฟไลน์)',
        html: `<p class="text-gray-700">บันทึกภาพถ่ายเลขคดี <b>${caseNumber}</b> ลงในเครื่องเรียบร้อยแล้ว</p>
               <p class="text-xs text-amber-600 font-semibold mt-2"><i class="fa-solid fa-cloud-arrow-up mr-1"></i>ระบบได้เก็บเข้าคิวออฟไลน์ไว้แล้ว และจะทำการอัปโหลดขึ้น Google Drive & Sheet ให้อัตโนมัติเมื่อเชื่อมต่ออินเทอร์เน็ต</p>`,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#2563eb',
        showCloseButton: true,
        allowOutsideClick: false
      }).then(() => {
        resetFormForNextCase();
      });
      return;
    }

    // อัปโหลดขึ้น Google Drive ทันทีพร้อมบันทึกข้อมูลเข้า Google Sheet (Single Step) พร้อม Progress Bar
    const resJson = await uploadWithProgressBar(uploadPayload, `กำลังอัปโหลดภาพเลขคดี ${caseNumber}...`);

    localStorage.removeItem(CACHE_KEY_SHEET_DATA);
    localStorage.removeItem(CACHE_KEY_SHEET_TIME);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ!',
      html: `<p class="text-gray-700">บันทึกภาพถ่ายและอัปโหลดขึ้น Google Drive เลขคดี <b>${caseNumber}</b> เรียบร้อยแล้ว</p>
             ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#2563eb',
      showCloseButton: true,
      allowOutsideClick: false
    }).then(() => {
      resetFormForNextCase();
    });

  } catch (err) {
    console.error(err);
    hideCustomLoading();
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถประมวลผลภาพได้',
      text: err.message,
      showCloseButton: true,
      allowOutsideClick: false
    });
  } finally {
    e.target.value = '';
  }
}

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

async function uploadToGoogleDrive() {
  if (!state.appsScriptUrl) {
    Swal.fire({
      title: 'ยังไม่ได้ตั้งค่า Google Apps Script URL',
      html: `กรุณากรอก Web App URL ของ Google Apps Script เพื่อบันทึกรูปลงใน Google Drive โฟลเดอร์ที่กำหนด`,
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

  showCustomLoading('กำลังบันทึกข้อมูล...', 'กำลังอัปโหลดรูปภาพลง Google Drive & Sheet');

  try {
    const payload = {
      ...currentPreviewData,
      fileName: currentPreviewImageFilename,
      imageBase64: currentPreviewResult.dataUrl
    };

    const response = await fetch(state.appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let resJson = null;

    try {
      resJson = JSON.parse(responseText);
    } catch (parseErr) {
      if (responseText.includes('ต้องมีสิทธิ์เข้าถึง') || responseText.includes('accounts.google.com') || responseText.includes('<!DOCTYPE')) {
        throw new Error('Google Apps Script ถูกตั้งค่าสิทธิ์เป็นส่วนตัว กรุณาตั้งค่า "Who has access" ในการ Deploy ให้เป็น "Anyone" (ทุกคน)');
      } else {
        throw new Error('การตอบกลับจาก Google Apps Script ไม่ถูกต้อง: ' + responseText.substring(0, 100));
      }
    }

    if (resJson && resJson.status === 'success') {
      // เคลียร์แคชเพื่อบังคับให้ดึงข้อมูลใหม่
      localStorage.removeItem(CACHE_KEY_SHEET_DATA);
      localStorage.removeItem(CACHE_KEY_SHEET_TIME);

      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ!',
        html: `<p class="text-gray-700">อัปโหลดรูปภาพเลขคดี <b>${currentPreviewData.caseNumber}</b> ลงใน Google Drive เรียบร้อยแล้ว</p>
               ${resJson.fileUrl ? `<a href="${resJson.fileUrl}" target="_blank" class="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">เปิดดูรูปใน Google Drive</a>` : ''}`,
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
            <li>กด <b>Deploy</b> > <b>Manage deployments</b></li>
            <li>กดไอคอน <b>✏️ (แก้ไข)</b> ที่เวอร์ชันล่าสุด</li>
            <li>ตรง <b>Who has access</b> ให้เปลี่ยนเป็น <b>"Anyone" (ทุกคน)</b></li>
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
  const courtType = elements.courtTypeSelect ? elements.courtTypeSelect.value : '';
  if (courtType === 'ศาลอื่น') {
    if (elements.otherCaseNoInput) {
      elements.otherCaseNoInput.value = '';
    }
  } else {
    if (elements.udonCaseNoInput) {
      elements.udonCaseNoInput.value = '';
    }
  }
  if (elements.caseExtraInput) elements.caseExtraInput.value = '';
  if (state.tempModalValues) state.tempModalValues.caseExtra = '';
  if (elements.houseNoInput) elements.houseNoInput.value = '';
  if (elements.mooInput) elements.mooInput.value = '';
  if (elements.customOtherLocationName) elements.customOtherLocationName.value = '';

  // บนจอมือถือ หากยังเปิดกล้องอยู่ ให้เด้งฟอร์มกรอกหมายถัดไปทันที
  if (window.innerWidth < 768 && elements.cameraModal && !elements.cameraModal.classList.contains('hidden')) {
    setTimeout(() => {
      showMobileSummonsFormModal(false);
    }, 400);
  }
}

function initSettings() {
  if (elements.btnSettings) {
    elements.btnSettings.addEventListener('click', () => {
      if (!state.currentUser || state.currentUser.role !== 'admin') {
        Swal.fire('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถตั้งค่าระบบได้', 'error');
        return;
      }

      Swal.fire({
        title: 'ตั้งค่า Google Apps Script Web App URL',
        html: `
          <div class="text-left text-sm text-gray-600 mb-3 space-y-2">
            <p>1. นำโค้ดใน <code>google-apps-script/Code.gs</code> ไป Deploy เป็น Web App</p>
            <p>2. วาง Web App URL ลงในช่องด้านล่าง:</p>
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
          Swal.fire('บันทึกแล้ว', 'ตั้งค่า Web App URL เรียบร้อยแล้ว', 'success');
        }
      });
    });
  }
}

// =========================================================================
// 8. ระบบแผนที่ หมุดพิกัด และอ่านบัญชีจ่ายหมาย (Interactive Map & Route Planning Module)
// รองรับทั้ง Desktop (> 768px) และ Mobile (< 768px)
// =========================================================================

state.interactiveLeafletMap = null;
state.mapMarkerLayerGroup = null;
state.mapRoutePolyline = null;
state.startLocationMarker = null;
state.currentMapFilter = null; // { province, district, subdistrict, isPdfDispatch }
state.currentRouteStops = [];  // Array of stop objects
state.initialOptimalDistanceKm = 0; // Baseline optimal distance
state.showRouteLayer = true;
state.isRoundTrip = false;
state.parsedDispatchRecords = []; // Records extracted from PDF/Image

state.routeStartLocation = {
  name: 'ศาลจังหวัดอุดรธานี (ค่าเริ่มต้น)',
  lat: 17.4138,
  lng: 102.7872,
  isCustom: false
};

/**
 * ส่งประวัติการทำรายการในหน้าแผนที่และหมุดไปบันทึกเป็นไฟล์ Log ใน Server (Google Apps Script / Drive)
 * @param {string} actionType - ประเภทกิจกรรม
 * @param {string} details - รายละเอียดกิจกรรม
 * @param {Object} [extraData] - ข้อมูลเพิ่มเติม
 */
async function logServerActivity(actionType, details, extraData = null) {
  const user = state.currentUser || { username: 'anonymous', name: 'ไม่ได้ระบุผู้ใช้', role: 'guest' };
  const payload = {
    action: 'log_activity',
    actionType: actionType,
    details: details,
    user: {
      username: user.username || 'anonymous',
      name: user.name || user.username || 'anonymous',
      role: user.role || 'user'
    },
    extra: extraData,
    clientTimestamp: new Date().toISOString()
  };

  try {
    if (state.appsScriptUrl && navigator.onLine) {
      fetch(state.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).catch(err => console.warn('Server logging silent warning:', err));
    }
  } catch (e) {
    console.warn('logServerActivity error:', e);
  }
}

/**
 * คำนวณระยะทางระหว่าง 2 พิกัดเป็นกิโลเมตร (Haversine Formula)
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // รัศมีโลกเป็นกิโลเมตร
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * จัดลำดับเส้นทางแบบ Nearest Neighbor TSP เฉพาะจุดที่มีพิกัดถูกต้อง
 */
function optimizeStopsSequence(stops, startLat = null, startLng = null) {
  if (!stops || stops.length <= 1) return stops;

  const stopsWithCoords = stops.filter(s => s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng) && s.lat > 0 && s.lng > 0);
  const stopsWithoutCoords = stops.filter(s => !s.lat || !s.lng || isNaN(s.lat) || isNaN(s.lng) || s.lat <= 0 || s.lng <= 0);

  const remaining = [...stopsWithCoords];
  const ordered = [];

  let currentLat = (startLat !== null && !isNaN(startLat)) ? startLat : (remaining[0] ? remaining[0].lat : 17.4138);
  let currentLng = (startLng !== null && !isNaN(startLng)) ? startLng : (remaining[0] ? remaining[0].lng : 102.7872);

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = calculateHaversineDistance(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    const [nextStop] = remaining.splice(nearestIdx, 1);
    nextStop.legDistanceKm = minDist;
    ordered.push(nextStop);
    currentLat = nextStop.lat;
    currentLng = nextStop.lng;
  }

  stopsWithoutCoords.forEach(s => {
    s.legDistanceKm = 0;
  });

  return [...ordered, ...stopsWithoutCoords];
}

/**
 * ดึงพิกัดประมาณการตามตำบล/อำเภอ
 */
function getApproximateCoords(district, subdistrict) {
  const baseLat = 17.4138;
  const baseLng = 102.7872;
  const hash = ((district || '') + (subdistrict || '')).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const jitterLat = ((hash % 100) - 50) * 0.0012;
  const jitterLng = (((hash * 7) % 100) - 50) * 0.0012;

  return {
    lat: Number((baseLat + jitterLat).toFixed(6)),
    lng: Number((baseLng + jitterLng).toFixed(6))
  };
}

/**
 * แปลงลิงก์รูปภาพใน Google Drive ให้เป็น Direct Thumbnail URL ที่เบราว์เซอร์แสดงผลได้ทันที
 */
function getDirectDriveImageUrl(rawUrl, size = 800) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image') || trimmed.startsWith('blob:')) return trimmed;

  const match = trimmed.match(/id=([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/id%3D([a-zA-Z0-9_-]+)/);

  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}=w${size}`;
  }

  // หากเป็น Drive file ID โดยตรง (25-45 ตัวอักษร)
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed)) {
    return `https://lh3.googleusercontent.com/d/${trimmed}=w${size}`;
  }

  return trimmed;
}

/**
 * ลิงก์สำรอง (Fallback) กรณี lh3 ไม่โหลด
 */
function getDriveFallbackThumbnailUrl(rawUrl, size = 800) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  const match = trimmed.match(/id=([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/id%3D([a-zA-Z0-9_-]+)/);
  const fileId = match ? match[1] : (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed) ? trimmed : '');
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
  }
  return trimmed;
}

/**
 * ดึงลิงก์รูปภาพจากแถวข้อมูล Google Sheets
 */
function extractRowImageUrl(r) {
  if (!r) return '';
  const raw = r['ลิงก์รูปภาพใน Google Drive'] || r['ลิงก์รูปภาพ'] || r['Drive File ID'] || r['รูปภาพ'] || r['Image'] || r['photo'] || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * ตรวจสอบเปรียบเทียบข้อมูลหมายกับประวัติส่งหมายในระบบ
 * 1. ตรงกับประวัติแบบสมบูรณ์ (Exact Match): เลขคดีตรงกัน หรือ บ้านเลขที่+หมู่+ตำบล+อำเภอ ตรงกัน -> มีพิกัด Lat, Lng จริง และภาพถ่าย
 * 2. หมุดใกล้เคียง (Near Match): หากไม่ตรง แต่พบข้อมูลในหมู่ที่เดียวกัน หรือตำบล/อำเภอเดียวกัน -> ดึงพิกัดหมุดที่ใกล้เคียงมาแสดง
 * 3. ไม่ตรงกับฐานข้อมูล (No Match): ไม่พบข้อมูลในพื้นที่ -> lat = null, lng = null ไม่ต้องแสดงหมุด
 */
function matchSingleCaseWithHistory(caseNumber, houseNo, subdistrict, district, locationText, moo = '', province = '') {
  const allRows = state.allSheetRows || [];
  let matched = null;
  let matchType = 'none';
  let matchNote = '';

  const cleanC = (caseNumber || '').replace(/[\s\.\/\-\_]/g, '').toLowerCase();

  // 1. ตรวจสอบเลขคดีตรงกัน (Exact Case Match)
  if (cleanC) {
    matched = allRows.find(r => {
      const rowC = (r['เลขคดี'] || '').replace(/[\s\.\/\-\_]/g, '').toLowerCase();
      return rowC && (rowC === cleanC || rowC.includes(cleanC) || cleanC.includes(rowC));
    });
    if (matched) {
      matchType = 'exact';
      matchNote = 'ตรงกับประวัติ (พบพิกัดจริง)';
    }
  }

  // 2. ถ้าไม่พบเลขคดี ให้ตรวจสอบจาก บ้านเลขที่ + หมู่ + ตำบล + อำเภอ (Exact Address Match)
  if (!matched && subdistrict && houseNo) {
    matched = allRows.find(r => {
      const rProv = getRowProvince(r);
      if (province && rProv && rProv !== province) return false;
      const rDist = (r['อำเภอ'] || '').trim();
      if (district && rDist && rDist !== district) return false;
      const rSub = (r['ตำบล'] || '').trim();
      const rHouse = (r['บ้านเลขที่'] || '').trim();
      const rMoo = (r['หมู่'] || '').trim();
      const rLoc = (r['ที่ตั้งส่งหมาย (เต็ม)'] || r['ที่ตั้งส่งหมาย'] || '').trim();

      const subMatch = rSub && (rSub.includes(subdistrict) || subdistrict.includes(rSub));
      const houseMatch = rHouse === houseNo || rLoc.includes(houseNo);
      const mooMatch = !moo || rMoo === moo || rLoc.includes(`ม.${moo}`) || rLoc.includes(`หมู่ ${moo}`) || rLoc.includes(`หมู่ที่ ${moo}`);

      return subMatch && houseMatch && mooMatch;
    });

    if (matched) {
      matchType = 'exact';
      matchNote = 'ตรงกับประวัติ (บ้านเลขที่ตรงกัน)';
    }
  }

  // 3. ถ้ายังไม่พบ: ตรวจสอบหาหมุดที่ใกล้เคียงจากข้อมูลหมู่ที่, ตำบลและอำเภอที่ตรงกัน (Near Match)
  if (!matched && subdistrict) {
    // 3.1 ค้นหาจาก หมู่ที่ + ตำบล + อำเภอ ที่ตรงกัน
    if (moo) {
      matched = allRows.find(r => {
        const rProv = getRowProvince(r);
        if (province && rProv && rProv !== province) return false;
        const rDist = (r['อำเภอ'] || '').trim();
        if (district && rDist && rDist !== district) return false;
        const rSub = (r['ตำบล'] || '').trim();
        const rMoo = (r['หมู่'] || '').trim();
        const rLoc = (r['ที่ตั้งส่งหมาย (เต็ม)'] || r['ที่ตั้งส่งหมาย'] || '').trim();

        const subMatch = rSub && (rSub.includes(subdistrict) || subdistrict.includes(rSub));
        const mooMatch = rMoo === moo || rLoc.includes(`ม.${moo}`) || rLoc.includes(`หมู่ ${moo}`) || rLoc.includes(`หมู่ที่ ${moo}`);
        const lat = parseFloat(r['ละติจูด (Lat)'] || r['ละติจูด'] || 0);
        return subMatch && mooMatch && !isNaN(lat) && lat > 0;
      });

      if (matched) {
        matchType = 'near';
        matchNote = `หมุดใกล้เคียง (ม.${moo} ต.${subdistrict})`;
      }
    }

    // 3.2 ถ้ายังไม่พบในหมู่เดียวกัน หรือไม่ได้ระบุหมู่ ให้หาจาก ตำบล + อำเภอ เดียวกัน
    if (!matched) {
      matched = allRows.find(r => {
        const rProv = getRowProvince(r);
        if (province && rProv && rProv !== province) return false;
        const rDist = (r['อำเภอ'] || '').trim();
        if (district && rDist && rDist !== district) return false;
        const rSub = (r['ตำบล'] || '').trim();
        const lat = parseFloat(r['ละติจูด (Lat)'] || r['ละติจูด'] || 0);
        return rSub && (rSub.includes(subdistrict) || subdistrict.includes(rSub)) && !isNaN(lat) && lat > 0;
      });

      if (matched) {
        matchType = 'near';
        matchNote = `หมุดใกล้เคียง (ต.${subdistrict}${district ? ` อ.${district}` : ''})`;
      }
    }
  }

  // ส่งคืนผลลัพธ์
  if (matched) {
    const lat = parseFloat(matched['ละติจูด (Lat)'] || matched['ละติจูด'] || 0);
    const lng = parseFloat(matched['ลองจิจูด (Lng)'] || matched['ลองจิจูด'] || 0);
    if (!isNaN(lat) && !isNaN(lng) && lat > 0 && lng > 0) {
      return {
        matchedRow: matched,
        lat: lat,
        lng: lng,
        matchType: matchType,
        matchNote: matchNote,
        locationText: locationText || matched['ที่ตั้งส่งหมาย (เต็ม)'] || matched['ที่ตั้งส่งหมาย'] || '-',
        imageUrl: extractRowImageUrl(matched),
        dateTime: formatThaiDateDisplay(matched['วัน-เวลาบันทึก'] || matched['Timestamp'] || ''),
        subdistrict: matched['ตำบล'] || subdistrict,
        district: matched['อำเภอ'] || district,
        province: getRowProvince(matched) || province,
        hasCoords: true
      };
    }
  }

  // 4. ไม่พบข้อมูลในฐานข้อมูล -> ไม่ต้องแสดงหมุด (lat = null, lng = null)
  return {
    matchedRow: null,
    lat: null,
    lng: null,
    matchType: 'none',
    matchNote: 'ไม่มีข้อมูลในฐานข้อมูล (ไม่แสดงหมุด)',
    locationText: locationText || '-',
    imageUrl: '',
    dateTime: '',
    subdistrict: subdistrict,
    district: district,
    province: province,
    hasCoords: false
  };
}

/**
 * สร้างข้อความที่ตั้งส่งหมายแบบเต็ม
 */
function buildFullLocationText(locationType, houseNo, moo, localAdminName, customOtherLocationName, subdistrict, district, province) {
  let main = '';
  if (locationType === 'หมายบ้าน') {
    const parts = [];
    if (houseNo) parts.push(`บ้านเลขที่ ${houseNo}`);
    if (moo) parts.push(`ม.${moo}`);
    main = parts.join(' ');
  } else if (locationType === 'ที่ทำการปกครองส่วนท้องถิ่น') {
    main = localAdminName || 'ที่ทำการปกครองส่วนท้องถิ่น';
  } else {
    main = customOtherLocationName || 'สถานที่อื่นๆ';
  }

  const addrParts = [
    main,
    subdistrict ? `ต.${subdistrict}` : '',
    district ? `อ.${district}` : '',
    province ? `จ.${province}` : ''
  ].filter(Boolean);

  return addrParts.join(' ');
}

/**
 * สร้าง HTML สำหรับแบบฟอร์มกรอกข้อมูลหมาย (อ้างอิงตามบันทึกส่งหมาย ภาพที่ 1 และ 2)
 */
function getSummonsFormHtml(prefix = 'modal_', initialData = {}) {
  let lastSaved = null;
  try {
    lastSaved = state.lastScheduleFormData || JSON.parse(localStorage.getItem('slts_last_schedule_form') || 'null');
  } catch (e) {}

  const currentProvince = initialData.province || (lastSaved && lastSaved.province) || state.currentMapFilter?.province || state.selectedProvince || 'อุดรธานี';
  const provinces = (typeof THAILAND_PROVINCES !== 'undefined') ? THAILAND_PROVINCES : [{ name: currentProvince }];
  const districts = getDistrictsByProvince(currentProvince);
  const currentDistrict = initialData.district || (lastSaved && lastSaved.district) || state.currentMapFilter?.district || districts[0] || '';
  const subdistricts = currentDistrict ? getSubdistrictsByDistrict(currentProvince, currentDistrict) : [];
  const currentSubdistrict = initialData.subdistrict || (lastSaved && lastSaved.subdistrict) || state.currentMapFilter?.subdistrict || subdistricts[0] || '';

  const provOptions = provinces.map(p => `<option value="${p.name}" ${p.name === currentProvince ? 'selected' : ''}>${p.name}</option>`).join('');
  const distOptions = districts.map(d => `<option value="${d}" ${d === currentDistrict ? 'selected' : ''}>${d}</option>`).join('');
  const subOptions = subdistricts.map(s => `<option value="${s}" ${s === currentSubdistrict ? 'selected' : ''}>${s}</option>`).join('');

  // ปี พ.ศ. (ย้อนหลัง 20 ปี)
  const currentYearBE = new Date().getFullYear() + 543;
  const targetYear = (initialData.caseYear !== undefined && initialData.caseYear !== '') 
    ? parseInt(initialData.caseYear, 10) 
    : ((lastSaved && lastSaved.caseYear) ? parseInt(lastSaved.caseYear, 10) : currentYearBE);

  let yearOptions = '';
  for (let i = 0; i <= 20; i++) {
    const yr = currentYearBE - i;
    const isSelected = (yr === targetYear);
    yearOptions += `<option value="${yr}" ${isSelected ? 'selected' : ''}>${yr}</option>`;
  }

  const courtType = initialData.courtType || (lastSaved && lastSaved.courtType) || `ศาลจังหวัด${currentProvince}`;
  const isOtherCourt = (courtType === 'หมายศาลอื่น' || courtType.includes('หมายศาลอื่น'));
  const locType = initialData.locationType || (lastSaved && lastSaved.locationType) || 'หมายบ้าน';
  const prefixVal = (initialData.prefix !== undefined) ? initialData.prefix : ((lastSaved && lastSaved.prefix) || '');
  const mooVal = (initialData.moo !== undefined) ? initialData.moo : ((lastSaved && lastSaved.moo) || '');
  const localAdminNameVal = initialData.localAdminName || (lastSaved && lastSaved.localAdminName) || 'ที่ทำการปกครองส่วนท้องถิ่น';
  const customOtherLocationNameVal = initialData.customOtherLocationName || (lastSaved && lastSaved.customOtherLocationName) || '';

  return `
    <div class="relative space-y-3.5 text-xs text-left" id="${prefix}formRoot">
      
      <!-- 1. จังหวัด อำเภอ ตำบล -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-gray-50/80 p-2.5 rounded-xl border border-gray-200">
        <div>
          <label class="block font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-map-location-dot text-blue-600 mr-1"></i>จังหวัด *
          </label>
          <select id="${prefix}province" class="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${provOptions}
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-landmark text-blue-600 mr-1"></i>อำเภอ / เขต *
          </label>
          <select id="${prefix}district" class="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${distOptions}
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-location-dot text-blue-600 mr-1"></i>ตำบล / แขวง *
          </label>
          <select id="${prefix}subdistrict" class="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${subOptions}
          </select>
        </div>
      </div>

      <!-- 2. ข้อมูลเลขคดี (อ้างอิงภาพที่ 1) -->
      <div class="bg-white p-3 rounded-xl border border-gray-200 space-y-2.5">
        <div class="flex items-center justify-between">
          <label class="block font-bold text-gray-800">
            <i class="fa-solid fa-gavel text-blue-600 mr-1"></i>ข้อมูลเลขคดี <span class="text-red-500">*</span>
          </label>
          <button type="button" onclick="openScheduleCourtTypeModal('${prefix}')" class="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer">
            <i class="fa-solid fa-pen-to-square"></i>
            <span>เปลี่ยนประเภทศาล</span>
          </button>
        </div>

        <!-- แถบประเภทศาล -->
        <div class="flex items-stretch">
          <input 
            type="text" 
            id="${prefix}courtNameInput" 
            readonly 
            class="flex-1 bg-gray-100 border border-gray-300 rounded-l-xl px-3 py-2 text-xs font-bold text-gray-800 cursor-default"
            value="${courtType}"
          >
          <input type="hidden" id="${prefix}courtType" value="${courtType}">
          <button 
            type="button" 
            onclick="openScheduleCourtTypeModal('${prefix}')" 
            class="px-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold rounded-r-xl border border-blue-600 transition flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <i class="fa-solid fa-building-columns"></i>
            <span>เลือกประเภทศาล</span>
          </button>
        </div>

        <!-- กรณี: ศาลประจำจังหวัด/ศาลแขวง/ศาลเยาวชน (อักษร + เลขคดี + / + ปี พ.ศ.) -->
        <div id="${prefix}udonCaseField" class="${!isOtherCourt ? 'flex' : 'hidden'} items-stretch">
          <div class="relative w-28 sm:w-36 flex-shrink-0">
            <input 
              type="text" 
              id="${prefix}udonPrefix" 
              list="${prefix}udonPrefixList" 
              placeholder="อักษร เช่น ผบE" 
              value="${prefixVal}"
              class="w-full h-full bg-white border border-r-0 border-gray-300 focus:border-blue-500 rounded-l-xl px-2.5 py-2 text-xs font-bold text-gray-800"
              autocomplete="off"
            >
            <datalist id="${prefix}udonPrefixList">
              <option value="ผบE"></option>
              <option value="พE"></option>
              <option value="มE"></option>
              <option value="มยE"></option>
              <option value="ผบ"></option>
              <option value="พ"></option>
              <option value="อ"></option>
              <option value="ย"></option>
              <option value="ร"></option>
              <option value="รส"></option>
              <option value="ม"></option>
              <option value="มย"></option>
            </datalist>
          </div>

          <input 
            type="text" 
            id="${prefix}udonCaseNo" 
            placeholder="เลขคดี เช่น 1245" 
            inputmode="numeric" 
            value="${initialData.caseNo || ''}"
            class="flex-1 min-w-0 bg-white border-y border-gray-300 focus:border-blue-500 px-3 py-2 text-xs font-bold text-gray-800"
          />

          <span class="inline-flex items-center px-2.5 bg-gray-100 border-y border-gray-300 text-gray-500 font-bold select-none">
            /
          </span>

          <div class="relative w-24 sm:w-28 flex-shrink-0">
            <select 
              id="${prefix}udonCaseYear" 
              class="w-full h-full bg-white border border-l-0 border-gray-300 focus:border-blue-500 rounded-r-xl pl-2.5 pr-5 py-2 text-xs font-semibold text-gray-800 cursor-pointer"
            >
              ${yearOptions}
            </select>
          </div>
        </div>

        <!-- กรณี: หมายศาลอื่น (ต + เลขคดี + / + ปี พ.ศ.) -->
        <div id="${prefix}otherCourtCaseField" class="${isOtherCourt ? 'flex' : 'hidden'} items-stretch">
          <span class="inline-flex items-center px-3.5 bg-blue-50 border border-r-0 border-gray-300 rounded-l-xl text-blue-700 font-bold text-xs select-none">
            ต
          </span>
          <input 
            type="text" 
            id="${prefix}otherCaseNo" 
            placeholder="เลขคดี เช่น 2097" 
            inputmode="numeric" 
            value="${initialData.caseNo || ''}"
            class="flex-1 min-w-0 bg-white border-y border-gray-300 focus:border-blue-500 px-3 py-2 text-xs font-bold text-gray-800" 
          />
          <span class="inline-flex items-center px-2.5 bg-gray-100 border-y border-gray-300 text-gray-500 font-bold select-none">
            /
          </span>
          <div class="relative w-24 sm:w-28 flex-shrink-0">
            <select id="${prefix}otherCaseYear" class="w-full h-full bg-white border border-l-0 border-gray-300 focus:border-blue-500 rounded-r-xl pl-2.5 pr-5 py-2 text-xs font-semibold text-gray-800 cursor-pointer">
              ${yearOptions}
            </select>
          </div>
        </div>

        <!-- ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี) -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] font-semibold text-gray-600">
              <i class="fa-solid fa-circle-info text-blue-500 mr-1"></i>ข้อมูลเพิ่มเติม (ต่อท้ายเลขคดี)
            </span>
            <span class="text-[10px] text-gray-400 font-normal">ไม่บังคับ</span>
          </div>
          <input 
            type="text" 
            id="${prefix}caseExtraInput" 
            placeholder="เช่น ล.1-2, จำเลยที่ 1-2 (เว้นวรรค 1 เคาะต่อท้ายเลขคดี)" 
            value="${initialData.caseExtra || ''}"
            class="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-xl px-3 py-1.5 text-xs text-gray-800"
            autocomplete="off"
          >
        </div>
      </div>

      <!-- 3. ประเภทสถานที่ (อ้างอิงภาพที่ 1 และ 2) -->
      <div class="bg-white p-3 rounded-xl border border-gray-200 space-y-2.5">
        <label class="block font-bold text-gray-800">
          <i class="fa-solid fa-house-user text-blue-600 mr-1"></i>ประเภทสถานที่ <span class="text-red-500">*</span>
        </label>
        
        <select 
          id="${prefix}locationType" 
          onchange="handleScheduleLocationTypeChange('${prefix}', this.value)"
          class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500"
        >
          <option value="หมายบ้าน" ${locType === 'หมายบ้าน' ? 'selected' : ''}>หมายบ้าน</option>
          <option value="ที่ทำการปกครองส่วนท้องถิ่น" ${locType === 'ที่ทำการปกครองส่วนท้องถิ่น' ? 'selected' : ''}>ที่ทำการปกครองส่วนท้องถิ่น</option>
          <option value="อื่นๆ" ${locType === 'อื่นๆ' ? 'selected' : ''}>อื่นๆ</option>
        </select>

        <!-- หมายบ้าน: บ้านเลขที่ และ หมู่ (ตัวเลขเท่านั้น) -->
        <div id="${prefix}houseAddressFields" class="${locType === 'หมายบ้าน' ? 'grid' : 'hidden'} grid-cols-2 gap-2.5">
          <div>
            <input 
              type="text" 
              id="${prefix}houseNo" 
              placeholder="บ้านเลขที่ เช่น 154/2 *" 
              value="${initialData.houseNo || ''}"
              class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-800 focus:border-blue-500"
            >
          </div>
          <div>
            <input 
              type="text" 
              id="${prefix}moo" 
              placeholder="หมู่ (ตัวเลขเท่านั้น)" 
              inputmode="numeric" 
              value="${mooVal}"
              class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-800 focus:border-blue-500"
            >
          </div>
        </div>

        <!-- ที่ทำการปกครองส่วนท้องถิ่น -->
        <div id="${prefix}localAdminAddressFields" class="${locType === 'ที่ทำการปกครองส่วนท้องถิ่น' ? 'block' : 'hidden'}">
          <input 
            type="text" 
            id="${prefix}localAdminName" 
            value="${localAdminNameVal}" 
            placeholder="ที่ทำการปกครองส่วนท้องถิ่น เช่น อบต.โนนสูง" 
            class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-800 focus:border-blue-500"
          >
        </div>

        <!-- อื่นๆ -->
        <div id="${prefix}customOtherAddressFields" class="${locType === 'อื่นๆ' ? 'block' : 'hidden'}">
          <input 
            type="text" 
            id="${prefix}customOtherLocationName" 
            value="${customOtherLocationNameVal}" 
            placeholder="ระบุสถานที่อื่นๆ เช่น โรงเรียน, วัด, โรงพยาบาล..." 
            class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-800 focus:border-blue-500"
          >
        </div>
      </div>

      <!-- 4. Inline Court Picker Overlay (ไม่ปิด Modal หลัก ไม่เด้งออก) -->
      <div id="${prefix}courtPickerOverlay" class="hidden absolute inset-0 bg-white/95 backdrop-blur-xs z-50 rounded-2xl p-4 flex flex-col shadow-2xl border-2 border-blue-500 transition-all">
        <div class="flex items-center justify-between pb-2.5 border-b border-gray-200 mb-2 flex-shrink-0">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
              <i class="fa-solid fa-gavel"></i>
            </div>
            <div>
              <h4 class="font-bold text-sm text-gray-900">เลือกประเภทศาล</h4>
              <p class="text-[10px] text-gray-500">เลือกเพื่อปรับรูปแบบช่องกรอกเลขคดีตามประเภทศาล</p>
            </div>
          </div>
          <button type="button" onclick="closeScheduleCourtOverlay('${prefix}')" class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-bold transition cursor-pointer" title="ปิด">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        
        <div id="${prefix}courtOptionsList" class="flex-1 overflow-y-auto space-y-2 py-1 pr-1 slts-swal-body-scroll">
          <!-- Populated dynamically by openScheduleCourtTypeModal -->
        </div>
      </div>

    </div>
  `;
}

/**
 * สลับช่องกรอกสถานที่ตามประเภทสถานที่ที่เลือก
 */
window.handleScheduleLocationTypeChange = function(prefix, value) {
  const houseFields = document.getElementById(`${prefix}houseAddressFields`);
  const adminFields = document.getElementById(`${prefix}localAdminAddressFields`);
  const otherFields = document.getElementById(`${prefix}customOtherAddressFields`);

  if (houseFields) {
    if (value === 'หมายบ้าน') {
      houseFields.classList.remove('hidden');
      houseFields.classList.add('grid');
    } else {
      houseFields.classList.add('hidden');
      houseFields.classList.remove('grid');
    }
  }

  if (adminFields) {
    if (value === 'ที่ทำการปกครองส่วนท้องถิ่น') adminFields.classList.remove('hidden');
    else adminFields.classList.add('hidden');
  }

  if (otherFields) {
    if (value === 'อื่นๆ') otherFields.classList.remove('hidden');
    else otherFields.classList.add('hidden');
  }
};

/**
 * ผูก Event อำเภอ/ตำบลของแบบฟอร์ม
 */
function bindScheduleFormEvents(prefix = 'modal_') {
  const provEl = document.getElementById(`${prefix}province`);
  const distEl = document.getElementById(`${prefix}district`);
  const subEl = document.getElementById(`${prefix}subdistrict`);

  if (provEl && distEl && subEl) {
    provEl.addEventListener('change', (e) => {
      const p = e.target.value;
      const dists = getDistrictsByProvince(p);
      distEl.innerHTML = dists.map(d => `<option value="${d}">${d}</option>`).join('');
      const firstD = dists[0] || '';
      const subs = firstD ? getSubdistrictsByDistrict(p, firstD) : [];
      subEl.innerHTML = subs.map(s => `<option value="${s}">${s}</option>`).join('');
    });

    distEl.addEventListener('change', (e) => {
      const p = provEl.value;
      const d = e.target.value;
      const subs = d ? getSubdistrictsByDistrict(p, d) : [];
      subEl.innerHTML = subs.map(s => `<option value="${s}">${s}</option>`).join('');
    });
  }
}

/**
 * เปิด Inline Overlay เลือกประเภทศาลสำหรับแบบฟอร์มจัดตาราง (ไม่เรียก Swal.fire เพื่อไม่ให้ Modal เด้งออก)
 */
window.openScheduleCourtTypeModal = function(prefix = 'modal_') {
  const prov = document.getElementById(`${prefix}province`)?.value || 'อุดรธานี';
  const overlay = document.getElementById(`${prefix}courtPickerOverlay`);
  const listContainer = document.getElementById(`${prefix}courtOptionsList`);
  const currentCourt = document.getElementById(`${prefix}courtType`)?.value || `ศาลจังหวัด${prov}`;

  const courtOptions = [
    { title: `ศาลจังหวัด${prov}`, category: 'ศาลจังหวัด', desc: `ศาลชั้นต้นประจำจังหวัด${prov} (คดี ผบE, พE, ผบ, พ, อ...)`, icon: 'fa-landmark', badge: 'ประจำจังหวัด', color: 'blue' },
    { title: `ศาลแขวง${prov}`, category: 'ศาลแขวง', desc: `คดีมโนสาเร่ / คดีแขวง ประจำ${prov} (คดี ผบ, พ, ม, มย...)`, icon: 'fa-scale-balanced', badge: 'ศาลแขวง', color: 'indigo' },
    { title: `ศาลเยาวชนและครอบครัวจังหวัด${prov}`, category: 'ศาลเยาวชนและครอบครัว', desc: `คดีเยาวชนและครอบครัวจังหวัด${prov} (คดี ย, ร, รส...)`, icon: 'fa-children', badge: 'คดีครอบครัว', color: 'purple' },
    { title: 'หมายศาลอื่น (ศาลที่ไม่สังกัดภาค / หมายข้ามเขต)', category: 'หมายศาลอื่น', desc: 'ศาลแพ่ง, ศาลอาญา, ศาลล้มละลาย หรือหมายส่งข้ามเขต (คดี ต)', icon: 'fa-building-columns', badge: 'หมายศาลอื่น (ต)', color: 'emerald' }
  ];

  if (listContainer) {
    listContainer.innerHTML = courtOptions.map(opt => {
      const isSelected = (opt.title === currentCourt || (opt.category === 'หมายศาลอื่น' && currentCourt.includes('หมายศาลอื่น')));
      return `
        <button 
          type="button" 
          onclick="selectScheduleCourtChoice('${prefix}', '${opt.category}', '${opt.title}')" 
          class="w-full text-left p-3 rounded-xl border transition flex items-center justify-between gap-3 cursor-pointer ${isSelected ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-400/30' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'}"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl ${isSelected ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700'} flex items-center justify-center text-sm flex-shrink-0 shadow-xs">
              <i class="fa-solid ${opt.icon}"></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-0.5">
                <span class="font-bold text-xs text-gray-900 truncate">${opt.title}</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded font-bold ${isSelected ? 'bg-blue-200 text-blue-900' : 'bg-gray-100 text-gray-600'} flex-shrink-0">
                  ${opt.badge}
                </span>
              </div>
              <p class="text-[10px] text-gray-500 truncate">${opt.desc}</p>
            </div>
          </div>
          ${isSelected ? '<i class="fa-solid fa-circle-check text-blue-600 text-base flex-shrink-0"></i>' : '<i class="fa-solid fa-chevron-right text-gray-400 text-xs flex-shrink-0"></i>'}
        </button>
      `;
    }).join('');
  }

  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  }
};

window.closeScheduleCourtOverlay = function(prefix) {
  const overlay = document.getElementById(`${prefix}courtPickerOverlay`);
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }
};

window.selectScheduleCourtChoice = function(prefix, category, title) {
  const courtNameInput = document.getElementById(`${prefix}courtNameInput`);
  const courtTypeInput = document.getElementById(`${prefix}courtType`);
  const udonField = document.getElementById(`${prefix}udonCaseField`);
  const otherField = document.getElementById(`${prefix}otherCourtCaseField`);

  if (courtNameInput) courtNameInput.value = title;
  if (courtTypeInput) courtTypeInput.value = title;

  const isOther = (category === 'หมายศาลอื่น' || title.includes('หมายศาลอื่น'));
  if (udonField && otherField) {
    if (isOther) {
      otherField.classList.remove('hidden');
      otherField.classList.add('flex');
      udonField.classList.add('hidden');
      udonField.classList.remove('flex');
      const otherCaseNo = document.getElementById(`${prefix}otherCaseNo`);
      if (otherCaseNo) otherCaseNo.focus();
    } else {
      udonField.classList.remove('hidden');
      udonField.classList.add('flex');
      otherField.classList.add('hidden');
      otherField.classList.remove('flex');
      const udonPrefix = document.getElementById(`${prefix}udonPrefix`);
      if (udonPrefix) udonPrefix.focus();
    }
  }

  closeScheduleCourtOverlay(prefix);
};

/**
 * ดึงข้อมูลที่กรอกจากแบบฟอร์มและตรวจสอบ
 */
function extractSummonsFormData(prefix = 'modal_') {
  const province = document.getElementById(`${prefix}province`)?.value || 'อุดรธานี';
  const district = document.getElementById(`${prefix}district`)?.value || '';
  const subdistrict = document.getElementById(`${prefix}subdistrict`)?.value || '';
  const courtType = document.getElementById(`${prefix}courtType`)?.value || `ศาลจังหวัด${province}`;
  const isOther = (courtType === 'หมายศาลอื่น' || courtType.includes('หมายศาลอื่น'));

  let prefixStr = '';
  let caseNo = '';
  let caseYear = '';

  if (isOther) {
    prefixStr = 'ต';
    caseNo = (document.getElementById(`${prefix}otherCaseNo`)?.value || '').trim();
    caseYear = (document.getElementById(`${prefix}otherCaseYear`)?.value || '').trim();
  } else {
    prefixStr = (document.getElementById(`${prefix}udonPrefix`)?.value || '').trim();
    caseNo = (document.getElementById(`${prefix}udonCaseNo`)?.value || '').trim();
    caseYear = (document.getElementById(`${prefix}udonCaseYear`)?.value || '').trim();
  }

  const caseExtra = (document.getElementById(`${prefix}caseExtraInput`)?.value || '').trim();

  let formattedCaseNo = '';
  if (caseNo) {
    formattedCaseNo = `${prefixStr}${caseNo}/${caseYear}`;
    if (caseExtra) formattedCaseNo += ` ${caseExtra}`;
  }

  const locationType = document.getElementById(`${prefix}locationType`)?.value || 'หมายบ้าน';
  const houseNo = (document.getElementById(`${prefix}houseNo`)?.value || '').trim();
  const moo = (document.getElementById(`${prefix}moo`)?.value || '').trim();
  const localAdminName = (document.getElementById(`${prefix}localAdminName`)?.value || '').trim();
  const customOtherLocationName = (document.getElementById(`${prefix}customOtherLocationName`)?.value || '').trim();

  const locationText = buildFullLocationText(locationType, houseNo, moo, localAdminName, customOtherLocationName, subdistrict, district, province);

  return {
    province,
    district,
    subdistrict,
    courtType,
    prefix: prefixStr,
    caseNo,
    caseYear,
    caseExtra,
    caseNumber: formattedCaseNo,
    locationType,
    houseNo,
    moo,
    localAdminName,
    customOtherLocationName,
    locationText
  };
}

/**
 * สกัดข้อมูลตารางบัญชีจ่ายหมายจากไฟล์ PDF (PDF.js Coordinate & Column-based Extraction)
 * @param {File} file - ไฟล์ PDF
 * @returns {Promise<Array>} รายการหมายที่สกัดได้
 */
/**
 * สกัดข้อมูลตารางบัญชีจ่ายหมายจากไฟล์ PDF (PDF.js Column & Row Bounding-Box Extraction)
 * @param {File} file - ไฟล์ PDF
 * @returns {Promise<Array>} รายการหมายที่สกัดได้
 */
async function parsePdfDispatchFile(file) {
  if (!window.pdfjsLib) throw new Error('ไม่พบไลบรารี pdf.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allRecords = [];

  // Case Regex: รองรับทั้ง ต, ผบ, พ, ด, ข, ฝ, ม, ฟ, ว, ย, อ, ผบE, พE, ผบ ส ฯลฯ
  const caseRegex = /([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (textContent.items || []).map(item => ({
      str: (item.str || '').trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      w: Math.round(item.width || 0),
      h: Math.round(item.height || 0)
    })).filter(item => item.str.length > 0);

    if (items.length === 0) continue;

    // 1. ค้นหาตำแหน่ง Y ของหัวตาราง (Header Row)
    let headerY = null;
    let colHeaderX = {
      seq: null,      // ที่ (Col 1)
      blackCase: null, // เลขดำที่ (Col 2)
      redCase: null,   // เลขแดงที่ (Col 3)
      plaintiff: null, // โจทก์ (Col 4)
      defendant: null, // จำเลย (Col 5)
      recipient: null, // ส่งให้แก่ (Col 6)
      status: null,    // ฐานะ (Col 7)
      address: null,   // ที่อยู่ (Col 8)
      subdistrict: null, // ตำบล (Col 9)
      district: null,  // อำเภอ (Col 10)
      note: null       // หมายเหตุ (Col 11)
    };

    for (const item of items) {
      if (item.str.includes('เลขดำที่') || item.str.includes('เลขดำ')) {
        headerY = item.y;
        colHeaderX.blackCase = item.x;
      } else if (item.str === 'ที่' || item.str === 'ลำดับ') {
        colHeaderX.seq = item.x;
      } else if (item.str.includes('เลขแดง')) {
        colHeaderX.redCase = item.x;
      } else if (item.str.includes('โจทก์')) {
        colHeaderX.plaintiff = item.x;
      } else if (item.str.includes('จำเลย')) {
        colHeaderX.defendant = item.x;
      } else if (item.str.includes('ส่งให้แก่') || item.str.includes('ชื่อผู้รับ')) {
        colHeaderX.recipient = item.x;
      } else if (item.str.includes('ฐานะ')) {
        colHeaderX.status = item.x;
      } else if (item.str.includes('ที่อยู่')) {
        colHeaderX.address = item.x;
      } else if (item.str === 'ตำบล' || item.str.includes('ตำบล')) {
        colHeaderX.subdistrict = item.x;
      } else if (item.str === 'อำเภอ' || item.str.includes('อำเภอ')) {
        colHeaderX.district = item.x;
      } else if (item.str.includes('หมายเหตุ')) {
        colHeaderX.note = item.x;
      }
    }

    // กำหนดช่วงพิกัด X ของแต่ละคอลัมน์ (Column X-Ranges)
    const xSeqMax = colHeaderX.blackCase ? (colHeaderX.blackCase - 10) : 65;
    const xCaseMin = colHeaderX.blackCase ? (colHeaderX.blackCase - 25) : 50;
    const xCaseMax = colHeaderX.redCase ? (colHeaderX.redCase + 15) : (colHeaderX.plaintiff ? colHeaderX.plaintiff - 10 : 220);
    
    const xAddrMin = colHeaderX.address ? (colHeaderX.address - 35) : 440;
    const xAddrMax = colHeaderX.subdistrict ? (colHeaderX.subdistrict - 10) : 635;
    const xSubMin = colHeaderX.subdistrict ? (colHeaderX.subdistrict - 15) : 630;
    const xSubMax = colHeaderX.district ? (colHeaderX.district - 10) : 715;
    const xDistMin = colHeaderX.district ? (colHeaderX.district - 15) : 710;
    const xDistMax = colHeaderX.note ? (colHeaderX.note - 5) : 820;

    // 2. ค้นหาแถวของตาราง (Row Boundaries)
    // ในตารางศาล คอลัมน์ 1 ("ที่") จะมีตัวเลขลำดับ 1, 2, 3, 4, 5, 6, 7, ... อยู่ทางซ้ายสุด
    const tableTopY = headerY !== null ? (headerY - 8) : 550;
    
    // ค้นหา items ที่เป็นตัวเลขลำดับแถว (1, 2, 3, ...) ในคอลัมน์ซ้ายสุด
    const seqItems = items.filter(it => {
      return it.x <= xSeqMax && it.y < tableTopY && /^\d{1,3}$/.test(it.str);
    });

    // เรียงลำดับแถวตามตัวเลขลำดับ (1, 2, 3, ...)
    seqItems.sort((a, b) => parseInt(a.str, 10) - parseInt(b.str, 10));

    // กรองเอาเฉพาะตัวเลขที่เป็นลำดับต่อเนื่องกัน (1, 2, 3...)
    const validSeqRows = [];
    let expectedSeq = 1;
    for (const sq of seqItems) {
      const num = parseInt(sq.str, 10);
      if (num === expectedSeq) {
        validSeqRows.push({ no: num, y: sq.y });
        expectedSeq++;
      }
    }

    // สร้างช่วง Bounding Box (Y-Range) สำหรับแต่ละแถว
    const rowRanges = [];
    if (validSeqRows.length > 0) {
      for (let i = 0; i < validSeqRows.length; i++) {
        const cur = validSeqRows[i];
        const prev = validSeqRows[i - 1];
        const next = validSeqRows[i + 1];

        const topY = (i === 0) ? (tableTopY + 5) : ((prev.y + cur.y) / 2);
        const bottomY = (i === validSeqRows.length - 1) ? (cur.y - 35) : ((cur.y + next.y) / 2);

        rowRanges.push({
          rowNo: cur.no,
          topY: topY,
          bottomY: bottomY
        });
      }
    } else {
      // Fallback: หากไม่พบลำดับตัวเลข ให้จัดกลุ่มตาม Y ของเลขคดี
      const caseItems = items.filter(it => it.x >= xCaseMin && it.x <= xCaseMax && it.y < tableTopY && caseRegex.test(it.str));
      caseRegex.lastIndex = 0;
      
      const distinctY = [];
      caseItems.forEach(ci => {
        if (!distinctY.some(y => Math.abs(y - ci.y) <= 22)) {
          distinctY.push(ci.y);
        }
      });
      distinctY.sort((a, b) => b - a); // Y มาก (บน) ไป Y น้อย (ล่าง)

      for (let i = 0; i < distinctY.length; i++) {
        const curY = distinctY[i];
        const topY = (i === 0) ? (tableTopY + 5) : ((distinctY[i - 1] + curY) / 2);
        const bottomY = (i === distinctY.length - 1) ? (curY - 35) : ((curY + distinctY[i + 1]) / 2);
        rowRanges.push({
          rowNo: i + 1,
          topY: topY,
          bottomY: bottomY
        });
      }
    }

    // 3. สกัดข้อมูลแต่ละแถวตาม Column Bounding Boxes
    for (const rRange of rowRanges) {
      // รวม items ทั้งหมดที่อยู่ในแถวนี้
      const rowItems = items.filter(it => it.y <= rRange.topY && it.y > rRange.bottomY);
      if (rowItems.length === 0) continue;

      // --- 3.1 สกัดคอลัมน์ "เลขดำที่" ---
      const caseColItems = rowItems.filter(it => it.x >= xCaseMin && it.x <= xCaseMax);
      const caseColText = caseColItems.map(it => it.str).join(' ');
      
      const rawMatches = caseColText.match(/([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi) || [];
      const cleanCases = rawMatches.map(c => c.trim().replace(/\s+/g, ' '));

      if (cleanCases.length === 0) {
        // ลองหาใน rowText ทั้งหมดของแถว
        const fullRowText = rowItems.map(it => it.str).join(' ');
        const fallbackMatches = fullRowText.match(/([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi) || [];
        if (fallbackMatches.length > 0) {
          cleanCases.push(...fallbackMatches.map(c => c.trim().replace(/\s+/g, ' ')));
        }
      }

      if (cleanCases.length === 0) continue;

      // กฎคัดกรองเลขคดี "ต":
      // หากในแถวมีเลขคดีมากกว่า 1 ชุด และพบเลขที่ขึ้นต้นด้วย "ต" ให้เลือกเฉพาะเลข "ต" เท่านั้น (ตัดเลขชุดอื่นในแถวทิ้ง)
      const tCases = cleanCases.filter(c => /^ต/i.test(c.replace(/\s+/g, '')));
      const finalCases = (tCases.length > 0) ? tCases : cleanCases;
      const primaryCase = finalCases[0];

      // --- 3.2 สกัดคอลัมน์ "ที่อยู่" ---
      const addrColItems = rowItems.filter(it => it.x >= xAddrMin && it.x <= xAddrMax);
      addrColItems.sort((a, b) => a.x - b.x);
      const addrColText = addrColItems.map(it => it.str).join(' ').trim();

      let houseNo = '';
      let moo = '';
      let isCentralReg = addrColText.includes('ทะเบียนบ้านกลาง');
      let centralRegText = '';

      if (isCentralReg) {
        const cMatch = addrColText.match(/ทะเบียนบ้านกลาง\s*(\d*)/);
        centralRegText = cMatch && cMatch[1] ? `ทะเบียนบ้านกลาง ${cMatch[1]}`.trim() : 'ทะเบียนบ้านกลาง';
      } else {
        // ค้นหาบ้านเลขที่ และ หมู่ เช่น "140 ม. 2" หรือ "10 ม. 8" หรือ "441 ม. 1"
        const hmMatch = addrColText.match(/(\d+(?:\/\d+)?)\s*(?:ม\.?|หมู่)\s*(\d+|-)/);
        if (hmMatch) {
          houseNo = hmMatch[1];
          moo = (hmMatch[2] !== '-') ? hmMatch[2] : '';
        } else {
          // หาบ้านเลขที่โดดๆ และหมู่โดดๆ
          const hMatch = addrColText.match(/^(\d+(?:\/\d+)?)/) || addrColText.match(/(\d+(?:\/\d+)?)/);
          if (hMatch) houseNo = hMatch[1];
          const mMatch = addrColText.match(/(?:ม\.?|หมู่)\s*(\d+)/);
          if (mMatch) moo = mMatch[1];
        }
      }

      // --- 3.3 สกัดคอลัมน์ "ตำบล" ---
      const subColItems = rowItems.filter(it => it.x >= xSubMin && it.x <= xSubMax);
      let subdistrict = subColItems.map(it => it.str).join('').replace(/^(ต\.|ตำบล)\s*/, '').trim();
      if (!subdistrict || subdistrict === '-') subdistrict = 'นาข่า';

      // --- 3.4 สกัดคอลัมน์ "อำเภอ" ---
      const distColItems = rowItems.filter(it => it.x >= xDistMin && it.x <= xDistMax);
      let district = distColItems.map(it => it.str).join('').replace(/^(อ\.|อำเภอ)\s*/, '').trim();
      if (!district || district === '-') district = 'เมืองอุดรธานี';

      allRecords.push({
        caseNumber: primaryCase,
        allCases: finalCases,
        houseNo: isCentralReg ? '' : houseNo,
        moo: isCentralReg ? '' : moo,
        isCentralReg,
        centralRegText,
        subdistrict: subdistrict,
        district: district,
        rawText: `${primaryCase} | ${addrColText} | ${subdistrict} | ${district}`
      });
    }
  }

  return allRecords;
}

/**
 * สกัดข้อมูลตารางบัญชีจ่ายหมายจากไฟล์ภาพ (Tesseract.js OCR พร้อม Canvas Preprocessing)
 * @param {FileList|File[]} files - รายการไฟล์ภาพ
 * @param {Function} onProgress - Callback รายงาน % ความคืบหน้า
 * @returns {Promise<Array>} รายการหมายที่สกัดได้
 */
async function parseImageDispatchFiles(files, onProgress) {
  if (!window.Tesseract) throw new Error('ไม่พบไลบรารี Tesseract.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');

  const allRecords = [];
  const total = files.length;
  const caseRegex = /([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi;

  for (let idx = 0; idx < total; idx++) {
    const file = files[idx];
    if (onProgress) onProgress(Math.round((idx / total) * 100), `กำลังประมวลผลภาพ ${idx + 1}/${total}: ${file.name}`);

    // Preprocessing ภาพผ่าน Offscreen Canvas เพื่อเพิ่ม Contrast และความคมชัดของภาษาไทย
    let processedBlob = file;
    try {
      const imgBitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // ปรับขนาด Scale ให้เหมาะสมสำหรับ OCR (กว้าง ~1800-2400px)
      const scale = Math.max(1, Math.min(2.5, 2000 / imgBitmap.width));
      canvas.width = Math.round(imgBitmap.width * scale);
      canvas.height = Math.round(imgBitmap.height * scale);

      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

      // ปรับ Grayscale & Contrast
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // Contrast enhancement
        const cv = (v > 130) ? Math.min(255, v * 1.15) : Math.max(0, v * 0.85);
        d[i] = cv;
        d[i + 1] = cv;
        d[i + 2] = cv;
      }
      ctx.putImageData(imgData, 0, 0);

      processedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch (e) {
      console.warn('Image preprocessing fallback:', e);
      processedBlob = file;
    }

    const worker = await Tesseract.createWorker('tha+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          const filePct = Math.round((idx / total) * 100 + (m.progress / total) * 100);
          onProgress(filePct, `กำลัง OCR ตัวอักษรภาพ ${idx + 1}/${total}: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const ret = await worker.recognize(processedBlob);
    await worker.terminate();

    const rawText = ret.data.text || '';
    
    // ทำความสะอาดและแก้คำผิด OCR ทั่วไป
    const cleanedText = rawText
      .replace(/[|]/g, ' ')
      .replace(/([ผพ])\s*[บB]\s*[Eе]/gi, '$1บE')
      .replace(/([ผพ])\s*[บB]\s*[\.\s]*ส/gi, '$1บ ส')
      .replace(/([ตพดขฝผบมฟวยอเสEะ])\s+(\d+)/gi, '$1$2')
      .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2');

    const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      // ข้ามหัวตาราง
      if (
        line.includes('บัญชีจ่ายหมาย') ||
        line.includes('ศาลจังหวัด') ||
        line.includes('พนักงานศาลนี้ส่ง') ||
        line.includes('เลขดำที่') ||
        line.includes('ชื่อผู้รับ') ||
        line.includes('หน้าที่')
      ) {
        continue;
      }

      const matches = line.match(caseRegex);
      if (!matches || matches.length === 0) continue;

      const rawCases = matches.map(c => c.trim().replace(/\s+/g, ' '));
      const tCases = rawCases.filter(c => /^ต/i.test(c.replace(/\s+/g, '')));
      const finalCases = (tCases.length > 0) ? tCases : rawCases;
      const primaryCase = finalCases[0];

      // สกัดที่อยู่
      let houseNo = '';
      let moo = '';
      let isCentralReg = line.includes('ทะเบียนบ้านกลาง');
      let centralRegText = '';

      if (isCentralReg) {
        const cMatch = line.match(/ทะเบียนบ้านกลาง\s*(\d*)/);
        centralRegText = cMatch && cMatch[1] ? `ทะเบียนบ้านกลาง ${cMatch[1]}`.trim() : 'ทะเบียนบ้านกลาง';
      } else {
        const hMatch = line.match(/(\d+(?:\/\d+)?)\s*(?:ม\.?|หมู่)\s*(\d+|-)/);
        if (hMatch) {
          houseNo = hMatch[1];
          moo = (hMatch[2] !== '-') ? hMatch[2] : '';
        } else {
          // หาเฉพาะบ้านเลขที่
          const hOnly = line.match(/(\d+(?:\/\d+)?)/);
          if (hOnly && hOnly[1] !== primaryCase.split('/')[0].replace(/\D/g, '')) {
            houseNo = hOnly[1];
          }
          const mOnly = line.match(/(?:ม\.?|หมู่)\s*(\d+)/);
          if (mOnly) moo = mOnly[1];
        }
      }

      let subdistrict = '';
      let district = '';

      const subMatch = line.match(/(?:ต\.?|ตำบล)\s*([ก-๙]+)/);
      if (subMatch) subdistrict = subMatch[1];

      const distMatch = line.match(/(?:อ\.?|อำเภอ)\s*([ก-๙]+)/);
      if (distMatch) district = distMatch[1];

      // ป้องกันแถวซ้ำ
      if (!allRecords.some(r => r.caseNumber === primaryCase)) {
        allRecords.push({
          caseNumber: primaryCase,
          allCases: finalCases,
          houseNo: isCentralReg ? '' : houseNo,
          moo: isCentralReg ? '' : moo,
          isCentralReg,
          centralRegText,
          subdistrict: subdistrict || 'นาข่า',
          district: district || 'เมืองอุดรธานี',
          rawText: line
        });
      }
    }
  }

  return allRecords;
}

/**
 * แปลงข้อมูลจาก PDF/Image Record ให้เป็น Stop Items พร้อมจับคู่พิกัดประวัติ
 */
function convertParsedRecordsToStops(records, province = 'อุดรธานี') {
  return records.map((rec, idx) => {
    const locationType = rec.isCentralReg ? 'สถานที่อื่นๆ' : 'หมายบ้าน';
    const houseNoDisplay = rec.isCentralReg ? '' : rec.houseNo;
    const customOther = rec.isCentralReg ? (rec.centralRegText || 'ทะเบียนบ้านกลาง') : '';

    const matchRes = matchSingleCaseWithHistory(
      rec.caseNumber,
      houseNoDisplay,
      rec.subdistrict,
      rec.district,
      customOther || '',
      rec.moo,
      province
    );

    const locationText = buildFullLocationText(
      locationType,
      houseNoDisplay,
      rec.moo,
      '',
      customOther,
      rec.subdistrict || matchRes.subdistrict,
      rec.district || matchRes.district,
      province || matchRes.province
    );

    return {
      id: 'stop_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 6),
      caseNumber: rec.caseNumber,
      courtType: '',
      prefix: '',
      caseNo: '',
      caseYear: '',
      caseExtra: '',
      locationType,
      houseNo: houseNoDisplay,
      moo: rec.moo || '',
      localAdminName: '',
      customOtherLocationName: customOther,
      locationText,
      subdistrict: rec.subdistrict || matchRes.subdistrict || '',
      district: rec.district || matchRes.district || '',
      province: province || matchRes.province || '',
      lat: matchRes.lat,
      lng: matchRes.lng,
      imageUrl: matchRes.imageUrl || '',
      dateTime: matchRes.dateTime || '',
      matchType: matchRes.matchType,
      matchNote: matchRes.matchNote,
      isMatched: matchRes.matchType === 'exact',
      hasCoords: Boolean(matchRes.lat && matchRes.lng)
    };
  });
}

/**
 * เปิด Pop Up ระบุพื้นที่ หรือ จัดรายการตารางส่งหมาย (แทนที่ PDF)
 */
window.openMapAreaSelectorModal = function() {
  if (!state.lastScheduleFormData) {
    try {
      const saved = localStorage.getItem('slts_last_schedule_form');
      if (saved) state.lastScheduleFormData = JSON.parse(saved);
    } catch (e) {}
  }
  const lastSaved = state.lastScheduleFormData || {};
  const currentProvince = state.currentMapFilter?.province || state.selectedProvince || lastSaved.province || 'อุดรธานี';
  const provinces = (typeof THAILAND_PROVINCES !== 'undefined') ? THAILAND_PROVINCES : [{ name: currentProvince }];
  const districts = getDistrictsByProvince(currentProvince);
  const currentDistrict = state.currentMapFilter?.district || lastSaved.district || '';
  const subdistricts = currentDistrict ? getSubdistrictsByDistrict(currentProvince, currentDistrict) : (districts.length > 0 ? getSubdistrictsByDistrict(currentProvince, districts[0]) : []);
  const currentSubdistrict = state.currentMapFilter?.subdistrict || lastSaved.subdistrict || '';

  const provOptionsHtml = provinces.map(p => `<option value="${p.name}" ${p.name === currentProvince ? 'selected' : ''}>${p.name}</option>`).join('');
  const distOptionsHtml = `<option value="">-- ทุกอำเภอในจังหวัด --</option>` + districts.map(d => `<option value="${d}" ${d === currentDistrict ? 'selected' : ''}>${d}</option>`).join('');
  const subOptionsHtml = `<option value="">-- ทุกตำบลในอำเภอ --</option>` + subdistricts.map(s => `<option value="${s}" ${s === currentSubdistrict ? 'selected' : ''}>${s}</option>`).join('');

  // คัดลอกรายการ Stops ปัจจุบันมาเป็น Staged Stops ใน Modal
  state.stagedScheduleStops = JSON.parse(JSON.stringify(state.currentRouteStops || []));
  let editingStagedIndex = null;

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-base sm:text-lg font-bold text-gray-900"><i class="fa-solid fa-map-location-dot text-rose-500 text-xl"></i> ระบุพื้นที่ & จัดเส้นทางส่งหมาย</div>',
    html: `
      <div class="text-left text-xs space-y-3">
        
        <!-- Tabs Header -->
        <div class="flex border-b border-gray-200 gap-1 sm:gap-2 mb-2 overflow-x-auto">
          <button type="button" id="tabBtnModalArea" onclick="switchModalTab('area')" class="px-3 py-2 font-bold text-blue-700 border-b-2 border-blue-600 transition flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap">
            <i class="fa-solid fa-layer-group"></i>
            <span>1. เลือกตามพื้นที่</span>
          </button>
          <button type="button" id="tabBtnModalSchedule" onclick="switchModalTab('schedule')" class="px-3 py-2 font-bold text-gray-500 hover:text-blue-600 border-b-2 border-transparent transition flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap">
            <i class="fa-solid fa-table-list text-emerald-600"></i>
            <span>2. จัดรายการตารางส่งหมาย</span>
          </button>
          <button type="button" id="tabBtnModalUpload" onclick="switchModalTab('upload')" class="px-3 py-2 font-bold text-gray-500 hover:text-blue-600 border-b-2 border-transparent transition flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap">
            <i class="fa-solid fa-file-arrow-up text-violet-600"></i>
            <span>3. อัพโหลดบัญชีจ่ายหมาย</span>
          </button>
        </div>

        <!-- Tab 1: Area Filter Content -->
        <div id="modalTabContentArea" class="space-y-3.5">
          <p class="text-gray-600 leading-relaxed bg-blue-50 border border-blue-200 rounded-xl p-3">
            <i class="fa-solid fa-circle-info text-blue-600 mr-1"></i>
            เลือกจังหวัด อำเภอ และตำบลที่ต้องการดูหมุด ระบบจะดึงพิกัดส่งหมายทั้งหมดที่มีในฐานข้อมูลมาปักหมุดและวางแผนเส้นทางให้อัตโนมัติ
          </p>

          <!-- 1. จังหวัด -->
          <div>
            <label class="block font-bold text-gray-800 mb-1">จังหวัด (พิมพ์ค้นหาหรือเลือก) *</label>
            <div class="relative mb-1">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-gray-400 text-xs"></i>
              <input type="text" id="map_provSearch" placeholder="พิมพ์ชื่อจังหวัดเพื่อค้นหา..." value="${currentProvince}" class="w-full bg-white border border-gray-300 rounded-xl pl-8 pr-3 py-1.5 text-xs font-semibold text-gray-800" autocomplete="off">
            </div>
            <select id="map_provSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 focus:border-blue-500">
              ${provOptionsHtml}
            </select>
          </div>

          <!-- 2. อำเภอ & 3. ตำบล -->
          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block font-bold text-gray-800 mb-1">อำเภอ</label>
              <select id="map_distSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500">
                ${distOptionsHtml}
              </select>
            </div>
            <div>
              <label class="block font-bold text-gray-800 mb-1">ตำบล</label>
              <select id="map_subSelect" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500">
                ${subOptionsHtml}
              </select>
            </div>
          </div>
        </div>

        <!-- Tab 2: จัดรายการตารางส่งหมาย (Manual / Staged Schedule Builder) -->
        <div id="modalTabContentSchedule" class="hidden space-y-3.5">
          <p class="text-gray-600 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <i class="fa-solid fa-pen-to-square text-emerald-600 mr-1"></i>
            กรอกข้อมูลหมายเพื่อเพิ่มรายการส่งหมายลงในตาราง สามารถเพิ่มได้ทีละรายการ แก้ไข จัดลำดับ และระบบจะจับคู่พิกัดจากประวัติให้อัตโนมัติ
          </p>

          <!-- Schedule Input Form Accordion -->
          <div class="bg-gray-50 border border-gray-200 rounded-2xl p-3.5 space-y-3" id="scheduleFormWrapper">
            <div class="flex items-center justify-between pb-2 border-b border-gray-200">
              <span id="scheduleFormTitle" class="font-bold text-xs text-blue-700 flex items-center gap-1.5">
                <i class="fa-solid fa-file-circle-plus"></i> เพิ่มรายการส่งหมายใหม่
              </span>
              <button type="button" id="btnResetScheduleForm" onclick="resetScheduleModalForm(true)" class="text-[11px] text-gray-500 hover:text-red-600 cursor-pointer">
                <i class="fa-solid fa-rotate-left mr-0.5"></i> ล้างฟอร์ม
              </button>
            </div>

            <!-- Form Content Injected -->
            <div id="scheduleFormContainer">
              ${getSummonsFormHtml('sched_')}
            </div>

            <!-- Form Submit Buttons -->
            <div class="pt-1 flex gap-2">
              <button type="button" id="btnAddScheduleItem" onclick="handleAddOrUpdateScheduleItem()" class="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold py-2 px-3 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm text-xs cursor-pointer">
                <i class="fa-solid fa-plus"></i> <span id="txtBtnAddScheduleItem">เพิ่มรายการลงตาราง</span>
              </button>
              <button type="button" id="btnCancelEditScheduleItem" onclick="cancelEditScheduleItem()" class="hidden bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 px-3 rounded-xl transition text-xs cursor-pointer">
                ยกเลิกแก้ไข
              </button>
            </div>
          </div>

          <!-- Staged Schedule Items List Preview -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs font-bold text-gray-800">
              <span>รายการตารางส่งหมาย (<strong id="stagedScheduleCount" class="text-blue-700">0</strong> รายการ)</span>
              <div class="flex items-center gap-2 text-[10px]">
                <span class="text-emerald-700 font-semibold">● ตรงประวัติ</span>
                <span class="text-amber-700 font-semibold">● พิกัดใกล้เคียง</span>
                <span class="text-gray-500 font-normal">○ ไม่มีหมุด</span>
              </div>
            </div>

            <div id="stagedScheduleListContainer" class="max-h-52 overflow-y-auto space-y-1.5 border border-gray-200 rounded-xl p-2 bg-white slts-swal-body-scroll">
              <!-- Injected by JS -->
            </div>
          </div>

        </div>

        <!-- Tab 3: อัพโหลดบัญชีจ่ายหมาย (PDF / Multi-Image Upload & Parse) -->
        <div id="modalTabContentUpload" class="hidden space-y-3.5">
          <p class="text-gray-600 leading-relaxed bg-violet-50 border border-violet-200 rounded-xl p-3">
            <i class="fa-solid fa-cloud-arrow-up text-violet-600 mr-1"></i>
            อัพโหลดไฟล์ <strong>PDF</strong> หรือ <strong>ไฟล์ภาพ</strong> (รองรับภาพหลายไฟล์) ของบัญชีจ่ายหมาย ระบบจะดึงเลขดำที่ (คัดกรองเฉพาะเลข ต), ที่อยู่, ตำบล, อำเภอ และจับคู่พิกัดประวัติให้อัตโนมัติ
          </p>

          <!-- Upload Drop Zone -->
          <div id="uploadDispatchDropZone" class="border-2 border-dashed border-violet-300 hover:border-violet-500 bg-violet-50/40 rounded-2xl p-5 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group" onclick="document.getElementById('uploadDispatchFileInput').click()">
            <input type="file" id="uploadDispatchFileInput" class="hidden" accept=".pdf,image/*" multiple>
            <div class="w-12 h-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-xl group-hover:scale-110 transition shadow-sm">
              <i class="fa-solid fa-file-arrow-up"></i>
            </div>
            <div>
              <div class="font-bold text-xs text-gray-800">คลิกเพื่อเลือกไฟล์ หรือ ลากไฟล์มาวางที่นี่</div>
              <div class="text-[11px] text-gray-500 mt-0.5">รองรับไฟล์ <strong>PDF</strong> (หลายหน้า) หรือ <strong>ภาพถ่าย/สแกน</strong> (เลือกได้มากกว่า 1 ภาพ)</div>
            </div>
          </div>

          <!-- Parsing Progress / Status Box -->
          <div id="uploadDispatchProgressBox" class="hidden bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <div class="flex items-center justify-between text-xs font-bold text-gray-800">
              <span id="uploadDispatchStatusText" class="flex items-center gap-1.5 text-violet-700">
                <i class="fa-solid fa-spinner fa-spin"></i> กำลังวิเคราะห์ข้อมูลตาราง...
              </span>
              <span id="uploadDispatchPercentText" class="text-violet-700">0%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div id="uploadDispatchProgressBar" class="bg-violet-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
          </div>

          <!-- Uploaded / Parsed List Container -->
          <div id="uploadDispatchResultWrapper" class="hidden space-y-2">
            <div class="flex items-center justify-between text-xs font-bold text-gray-800">
              <span>รายการที่ตรวจพบจากเอกสาร (<strong id="uploadDispatchCountBadge" class="text-violet-700">0</strong> รายการ)</span>
              <div class="flex items-center gap-2">
                <button type="button" onclick="clearUploadedDispatchRecords()" class="text-[11px] text-gray-400 hover:text-red-600 transition cursor-pointer">
                  <i class="fa-solid fa-trash-can mr-0.5"></i> ล้างรายการ
                </button>
              </div>
            </div>

            <div id="uploadDispatchListContainer" class="max-h-52 overflow-y-auto space-y-1.5 border border-gray-200 rounded-xl p-2 bg-white slts-swal-body-scroll">
              <!-- Injected by JS -->
            </div>

            <!-- Action to merge/transfer to Schedule Table -->
            <button type="button" id="btnApplyUploadToSchedule" onclick="applyUploadedRecordsToSchedule()" class="w-full bg-violet-600 hover:bg-violet-700 active:scale-95 text-white font-bold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm text-xs cursor-pointer">
              <i class="fa-solid fa-circle-check"></i> <span>นำเข้าสู่ตารางส่งหมาย & แสดงผล</span>
            </button>
          </div>

        </div>

      </div>
    `,
    width: '680px',
    customClass: { popup: 'rounded-2xl p-4 sm:p-5' },
    showCloseButton: true,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-check mr-1.5"></i> ตกลง (แสดงหมุดแผนที่)',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
    didOpen: () => {
      // Tab switching
      window.switchModalTab = function(tab) {
        const tabAreaBtn = document.getElementById('tabBtnModalArea');
        const tabSchedBtn = document.getElementById('tabBtnModalSchedule');
        const tabUploadBtn = document.getElementById('tabBtnModalUpload');
        const contentArea = document.getElementById('modalTabContentArea');
        const contentSched = document.getElementById('modalTabContentSchedule');
        const contentUpload = document.getElementById('modalTabContentUpload');

        const activeClass = 'px-3 py-2 font-bold text-blue-700 border-b-2 border-blue-600 transition flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap';
        const inactiveClass = 'px-3 py-2 font-bold text-gray-500 hover:text-blue-600 border-b-2 border-transparent transition flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap';

        if (tabAreaBtn) tabAreaBtn.className = (tab === 'area') ? activeClass : inactiveClass;
        if (tabSchedBtn) tabSchedBtn.className = (tab === 'schedule') ? activeClass : inactiveClass;
        if (tabUploadBtn) tabUploadBtn.className = (tab === 'upload') ? activeClass : inactiveClass;

        if (contentArea) contentArea.classList.toggle('hidden', tab !== 'area');
        if (contentSched) contentSched.classList.toggle('hidden', tab !== 'schedule');
        if (contentUpload) contentUpload.classList.toggle('hidden', tab !== 'upload');

        if (tab === 'schedule') {
          renderStagedScheduleList();
        } else if (tab === 'upload') {
          renderUploadedDispatchList();
        }
      };

      bindScheduleFormEvents('sched_');

      // Functions for Staged Schedule Items
      window.renderStagedScheduleList = function() {
        const container = document.getElementById('stagedScheduleListContainer');
        const countBadge = document.getElementById('stagedScheduleCount');
        const stops = state.stagedScheduleStops || [];

        if (countBadge) countBadge.textContent = stops.length;
        if (!container) return;

        if (stops.length === 0) {
          container.innerHTML = `
            <div class="py-6 text-center text-gray-400 text-xs">
              <i class="fa-solid fa-list-check text-2xl mb-1 text-gray-300"></i>
              <p>ยังไม่มีรายการในตาราง กรุณากรอกแบบฟอร์มด้านบน หรืออัพโหลดไฟล์ในแท็บที่ 3</p>
            </div>
          `;
          return;
        }

        container.innerHTML = stops.map((s, idx) => {
          const isExact = s.matchType === 'exact';
          const isNear = s.matchType === 'near';
          const badgeClass = isExact ? 'slts-match-exact' : (isNear ? 'slts-match-near' : 'slts-match-none');
          const statusText = isExact ? '✓ ตรงกับประวัติ (พบพิกัดจริง)' : (isNear ? `📍 ${s.matchNote || 'หมุดใกล้เคียง'}` : '○ ไม่มีหมุดในระบบ');

          return `
            <div class="p-2 rounded-xl border flex items-center justify-between gap-2 text-xs transition ${badgeClass}">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-5 h-5 rounded-full ${isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700')} text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  ${idx + 1}
                </span>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span class="font-bold text-gray-900">${s.caseNumber || '(ไม่มีเลขคดี)'}</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold ${isExact ? 'bg-emerald-100 text-emerald-800' : (isNear ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600')}">
                      ${statusText}
                    </span>
                  </div>
                  <p class="text-[11px] opacity-90 truncate">${s.locationText}</p>
                </div>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <button type="button" onclick="editStagedScheduleItem(${idx})" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg text-xs cursor-pointer" title="แก้ไขรายการนี้">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" onclick="deleteStagedScheduleItem(${idx})" class="p-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs cursor-pointer" title="ลบรายการนี้">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
                <button type="button" onclick="moveStagedScheduleItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 cursor-pointer" title="เลื่อนขึ้น">
                  <i class="fa-solid fa-chevron-up text-[10px]"></i>
                </button>
                <button type="button" onclick="moveStagedScheduleItem(${idx}, 1)" ${idx === stops.length - 1 ? 'disabled' : ''} class="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 cursor-pointer" title="เลื่อนลง">
                  <i class="fa-solid fa-chevron-down text-[10px]"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      };

      window.handleAddOrUpdateScheduleItem = function() {
        const data = extractSummonsFormData('sched_');
        if (!data.caseNumber && !data.houseNo && !data.localAdminName && !data.customOtherLocationName) {
          Swal.showValidationMessage('กรุณากรอกเลขคดี หรือระบุสถานที่ส่งหมาย');
          return;
        }

        // จับคู่ข้อมูลกับประวัติในฐานข้อมูล
        const matchRes = matchSingleCaseWithHistory(
          data.caseNumber,
          data.houseNo,
          data.subdistrict,
          data.district,
          data.locationText,
          data.moo,
          data.province
        );

        const stopItem = {
          id: 'stop_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          caseNumber: data.caseNumber || `${data.prefix}${data.caseNo}/${data.caseYear}`.trim() || 'หมายส่ง',
          courtType: data.courtType,
          prefix: data.prefix,
          caseNo: data.caseNo,
          caseYear: data.caseYear,
          caseExtra: data.caseExtra,
          locationType: data.locationType,
          houseNo: data.houseNo,
          moo: data.moo,
          localAdminName: data.localAdminName,
          customOtherLocationName: data.customOtherLocationName,
          locationText: data.locationText,
          subdistrict: data.subdistrict,
          district: data.district,
          province: data.province,
          lat: matchRes.lat,
          lng: matchRes.lng,
          imageUrl: matchRes.imageUrl || '',
          dateTime: matchRes.dateTime || '',
          matchType: matchRes.matchType,
          matchNote: matchRes.matchNote,
          isMatched: matchRes.matchType === 'exact',
          hasCoords: Boolean(matchRes.lat && matchRes.lng)
        };

        if (editingStagedIndex !== null) {
          state.stagedScheduleStops[editingStagedIndex] = stopItem;
          editingStagedIndex = null;
        } else {
          state.stagedScheduleStops.push(stopItem);
        }

        // จำค่าล่าสุดที่มีการบันทึก
        state.lastScheduleFormData = {
          province: data.province,
          district: data.district,
          subdistrict: data.subdistrict,
          courtType: data.courtType,
          prefix: data.prefix,
          caseYear: data.caseYear,
          locationType: data.locationType,
          moo: data.moo,
          localAdminName: data.localAdminName,
          customOtherLocationName: data.customOtherLocationName
        };
        try {
          localStorage.setItem('slts_last_schedule_form', JSON.stringify(state.lastScheduleFormData));
        } catch (e) {}

        resetScheduleModalForm(false);
        renderStagedScheduleList();

        // โฟกัสไปที่ช่องเลขคดีอัตโนมัติ เพื่อให้กรอกรายการถัดไปได้รวดเร็วต่อเนื่อง
        setTimeout(() => {
          const isOther = (data.courtType || '').includes('หมายศาลอื่น');
          const targetInput = isOther ? document.getElementById('sched_otherCaseNo') : document.getElementById('sched_udonCaseNo');
          if (targetInput) targetInput.focus();
        }, 50);
      };

      window.editStagedScheduleItem = function(idx) {
        const item = state.stagedScheduleStops[idx];
        if (!item) return;

        editingStagedIndex = idx;
        const formContainer = document.getElementById('scheduleFormContainer');
        if (formContainer) {
          formContainer.innerHTML = getSummonsFormHtml('sched_', item);
          bindScheduleFormEvents('sched_');
        }

        const titleEl = document.getElementById('scheduleFormTitle');
        const txtBtn = document.getElementById('txtBtnAddScheduleItem');
        const btnCancel = document.getElementById('btnCancelEditScheduleItem');

        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> แก้ไขรายการลำดับที่ ${idx + 1}`;
        if (txtBtn) txtBtn.textContent = 'บันทึกแก้ไขรายการ';
        if (btnCancel) btnCancel.classList.remove('hidden');
      };

      window.cancelEditScheduleItem = function() {
        editingStagedIndex = null;
        resetScheduleModalForm(false);
      };

      window.resetScheduleModalForm = function(clearAll = false) {
        editingStagedIndex = null;
        if (clearAll) {
          state.lastScheduleFormData = null;
          try {
            localStorage.removeItem('slts_last_schedule_form');
          } catch (e) {}
        }
        const formContainer = document.getElementById('scheduleFormContainer');
        if (formContainer) {
          formContainer.innerHTML = getSummonsFormHtml('sched_');
          bindScheduleFormEvents('sched_');
        }
        const titleEl = document.getElementById('scheduleFormTitle');
        const txtBtn = document.getElementById('txtBtnAddScheduleItem');
        const btnCancel = document.getElementById('btnCancelEditScheduleItem');

        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-file-circle-plus"></i> เพิ่มรายการส่งหมายใหม่`;
        if (txtBtn) txtBtn.textContent = 'เพิ่มรายการลงตาราง';
        if (btnCancel) btnCancel.classList.add('hidden');
      };

      window.deleteStagedScheduleItem = function(idx) {
        state.stagedScheduleStops.splice(idx, 1);
        if (editingStagedIndex === idx) cancelEditScheduleItem();
        renderStagedScheduleList();
      };

      window.moveStagedScheduleItem = function(idx, dir) {
        const target = idx + dir;
        if (target < 0 || target >= state.stagedScheduleStops.length) return;
        const [moved] = state.stagedScheduleStops.splice(idx, 1);
        state.stagedScheduleStops.splice(target, 0, moved);
        renderStagedScheduleList();
      };

      // ==========================================
      // Tab 3: Upload Dispatch File Handlers
      // ==========================================
      const fileInputEl = document.getElementById('uploadDispatchFileInput');
      const dropZoneEl = document.getElementById('uploadDispatchDropZone');

      if (dropZoneEl) {
        dropZoneEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropZoneEl.classList.add('border-violet-500', 'bg-violet-100/50');
        });
        dropZoneEl.addEventListener('dragleave', (e) => {
          e.preventDefault();
          dropZoneEl.classList.remove('border-violet-500', 'bg-violet-100/50');
        });
        dropZoneEl.addEventListener('drop', (e) => {
          e.preventDefault();
          dropZoneEl.classList.remove('border-violet-500', 'bg-violet-100/50');
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleDispatchFilesProcess(e.dataTransfer.files);
          }
        });
      }

      if (fileInputEl) {
        fileInputEl.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleDispatchFilesProcess(e.target.files);
          }
        });
      }

      window.handleDispatchFilesProcess = async function(files) {
        const progressBox = document.getElementById('uploadDispatchProgressBox');
        const progressBar = document.getElementById('uploadDispatchProgressBar');
        const statusText = document.getElementById('uploadDispatchStatusText');
        const percentText = document.getElementById('uploadDispatchPercentText');
        const resultWrapper = document.getElementById('uploadDispatchResultWrapper');

        if (progressBox) progressBox.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '10%';
        if (percentText) percentText.textContent = '10%';
        if (statusText) statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมวิเคราะห์ไฟล์...';

        try {
          const fileArr = Array.from(files);
          const isPdf = fileArr.some(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

          let parsedRecords = [];

          if (isPdf) {
            const pdfFile = fileArr.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
            if (statusText) statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังอ่านข้อมูล PDF จากตาราง...';
            if (progressBar) progressBar.style.width = '45%';
            if (percentText) percentText.textContent = '45%';
            
            parsedRecords = await parsePdfDispatchFile(pdfFile);

            logServerActivity('MAP_UPLOAD_PDF', `อัพโหลดไฟล์ PDF "${pdfFile.name}" สกัดได้ ${parsedRecords.length} รายการ (เลขคดี: ${parsedRecords.map(r => r.caseNumber).slice(0, 7).join(', ')}${parsedRecords.length > 7 ? '...' : ''})`, {
              fileName: pdfFile.name,
              fileSize: pdfFile.size,
              extractedCount: parsedRecords.length
            });
          } else {
            // ไฟล์รูปภาพ (รองรับหลายไฟล์)
            if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังประมวลผล OCR รูปภาพ (ทั้งหมด ${fileArr.length} ไฟล์)...`;
            parsedRecords = await parseImageDispatchFiles(fileArr, (pct, msg) => {
              if (progressBar) progressBar.style.width = `${pct}%`;
              if (percentText) percentText.textContent = `${pct}%`;
              if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`;
            });

            logServerActivity('MAP_UPLOAD_IMAGE', `อัพโหลดภาพถ่าย ${fileArr.length} ภาพ OCR สำเร็จพบ ${parsedRecords.length} รายการ (เลขคดี: ${parsedRecords.map(r => r.caseNumber).slice(0, 7).join(', ')}${parsedRecords.length > 7 ? '...' : ''})`, {
              imageCount: fileArr.length,
              extractedCount: parsedRecords.length
            });
          }

          if (progressBar) progressBar.style.width = '100%';
          if (percentText) percentText.textContent = '100%';
          if (statusText) statusText.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> วิเคราะห์เสร็จสิ้น (พบ ${parsedRecords.length} รายการ)`;

          // แปลงเป็น Stop Items และจับคู่ประวัติ
          const selectedProv = document.getElementById('map_provSelect')?.value || currentProvince || 'อุดรธานี';
          const convertedStops = convertParsedRecordsToStops(parsedRecords, selectedProv);

          state.parsedDispatchRecords = convertedStops;

          setTimeout(() => {
            if (progressBox) progressBox.classList.add('hidden');
            if (resultWrapper) resultWrapper.classList.remove('hidden');
            renderUploadedDispatchList();
          }, 400);

        } catch (err) {
          console.error('Dispatch parse error:', err);
          if (progressBox) progressBox.classList.add('hidden');
          Swal.showValidationMessage(`เกิดข้อผิดพลาดในการวิเคราะห์ไฟล์: ${err.message || err}`);
        }
      };

      window.renderUploadedDispatchList = function() {
        const container = document.getElementById('uploadDispatchListContainer');
        const countBadge = document.getElementById('uploadDispatchCountBadge');
        const resultWrapper = document.getElementById('uploadDispatchResultWrapper');
        const stops = state.parsedDispatchRecords || [];

        if (countBadge) countBadge.textContent = stops.length;
        if (resultWrapper && stops.length > 0) resultWrapper.classList.remove('hidden');
        if (!container) return;

        if (stops.length === 0) {
          container.innerHTML = `
            <div class="py-6 text-center text-gray-400 text-xs">
              <i class="fa-solid fa-file-excel text-2xl mb-1 text-gray-300"></i>
              <p>ยังไม่มีรายการที่วิเคราะห์ กรุณาเลือกไฟล์ PDF หรือภาพด้านบน</p>
            </div>
          `;
          return;
        }

        container.innerHTML = stops.map((s, idx) => {
          const isExact = s.matchType === 'exact';
          const isNear = s.matchType === 'near';
          const badgeClass = isExact ? 'slts-match-exact' : (isNear ? 'slts-match-near' : 'slts-match-none');
          const statusText = isExact ? '✓ ตรงกับประวัติ (พบพิกัดจริง)' : (isNear ? `📍 ${s.matchNote || 'หมุดใกล้เคียง'}` : '○ ไม่มีหมุดในระบบ');

          return `
            <div class="p-2 rounded-xl border flex items-center justify-between gap-2 text-xs transition ${badgeClass}">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-5 h-5 rounded-full ${isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700')} text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  ${idx + 1}
                </span>
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span class="font-bold text-gray-900">${s.caseNumber || '(ไม่มีเลขคดี)'}</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold ${isExact ? 'bg-emerald-100 text-emerald-800' : (isNear ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600')}">
                      ${statusText}
                    </span>
                  </div>
                  <p class="text-[11px] opacity-90 truncate">${s.locationText}</p>
                </div>
              </div>

              <!-- Action to delete from upload list -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <button type="button" onclick="deleteUploadedDispatchItem(${idx})" class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs cursor-pointer" title="ลบรายการนี้">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      };

      window.deleteUploadedDispatchItem = function(idx) {
        state.parsedDispatchRecords.splice(idx, 1);
        renderUploadedDispatchList();
      };

      window.clearUploadedDispatchRecords = function() {
        state.parsedDispatchRecords = [];
        const resultWrapper = document.getElementById('uploadDispatchResultWrapper');
        if (resultWrapper) resultWrapper.classList.add('hidden');
        renderUploadedDispatchList();
      };

      window.applyUploadedRecordsToSchedule = function() {
        const records = state.parsedDispatchRecords || [];
        if (records.length === 0) {
          Swal.showValidationMessage('ไม่พบรายการที่วิเคราะห์ กรุณาอัพโหลดไฟล์ก่อน');
          return;
        }

        // นำเข้ารายการสู่ stagedScheduleStops
        state.stagedScheduleStops = JSON.parse(JSON.stringify(records));
        
        logServerActivity('MAP_IMPORT_DISPATCH_TO_SCHEDULE', `นำเข้ารายการจากเอกสาร ${records.length} รายการ เข้าสู่ตารางจัดเส้นทางส่งหมาย`, {
          count: records.length,
          cases: records.map(r => r.caseNumber).slice(0, 10)
        });

        // สลับไปที่ Tab 2 เพื่อให้ผู้ใช้ตรวจทานและแก้ไขได้
        switchModalTab('schedule');
      };

      // Province search & select events in Tab 1
      const provSearch = document.getElementById('map_provSearch');
      const provSelect = document.getElementById('map_provSelect');
      const distSelect = document.getElementById('map_distSelect');
      const subSelect = document.getElementById('map_subSelect');

      if (provSearch && provSelect) {
        provSearch.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          const matched = provinces.filter(p => p.name.toLowerCase().includes(q));
          if (matched.length > 0) {
            provSelect.innerHTML = matched.map((p, i) => `<option value="${p.name}" ${i === 0 ? 'selected' : ''}>${p.name}</option>`).join('');
            provSelect.dispatchEvent(new Event('change'));
          }
        });
      }

      if (provSelect && distSelect && subSelect) {
        provSelect.addEventListener('change', (e) => {
          const prov = e.target.value;
          if (provSearch) provSearch.value = prov;
          const dists = getDistrictsByProvince(prov);
          distSelect.innerHTML = `<option value="">-- ทุกอำเภอในจังหวัด --</option>` + dists.map(d => `<option value="${d}">${d}</option>`).join('');
          const firstDist = dists[0] || '';
          const subs = firstDist ? getSubdistrictsByDistrict(prov, firstDist) : [];
          subSelect.innerHTML = `<option value="">-- ทุกตำบลในอำเภอ --</option>` + subs.map(s => `<option value="${s}">${s}</option>`).join('');
        });

        distSelect.addEventListener('change', (e) => {
          const prov = provSelect.value;
          const dist = e.target.value;
          if (dist) {
            const subs = getSubdistrictsByDistrict(prov, dist);
            subSelect.innerHTML = `<option value="">-- ทุกตำบลในอำเภอ --</option>` + subs.map(s => `<option value="${s}">${s}</option>`).join('');
          } else {
            subSelect.innerHTML = `<option value="">-- ทุกตำบลในอำเภอ --</option>`;
          }
        });
      }
    },
    preConfirm: () => {
      const contentSched = document.getElementById('modalTabContentSchedule');
      const contentUpload = document.getElementById('modalTabContentUpload');
      const isScheduleMode = contentSched && !contentSched.classList.contains('hidden');
      const isUploadMode = contentUpload && !contentUpload.classList.contains('hidden');

      if (isUploadMode) {
        const records = state.parsedDispatchRecords || [];
        if (records.length === 0) {
          Swal.showValidationMessage('กรุณาอัพโหลดไฟล์บัญชีจ่ายหมาย หรือกด "นำเข้าสู่ตารางส่งหมาย" ก่อน');
          return false;
        }
        return { isManualSchedule: true, stops: records };
      }

      if (isScheduleMode) {
        if (!state.stagedScheduleStops || state.stagedScheduleStops.length === 0) {
          Swal.showValidationMessage('กรุณาเพิ่มรายการส่งหมายลงในตารางอย่างน้อย 1 รายการ หรือสลับไปเลือกตามพื้นที่');
          return false;
        }
        return { isManualSchedule: true, stops: state.stagedScheduleStops };
      }

      const prov = document.getElementById('map_provSelect')?.value || currentProvince;
      const dist = document.getElementById('map_distSelect')?.value || '';
      const sub = document.getElementById('map_subSelect')?.value || '';
      return { isManualSchedule: false, province: prov, district: dist, subdistrict: sub };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      if (res.value.isManualSchedule) {
        state.currentRouteStops = res.value.stops;
        const badgeEl = document.getElementById('mapAreaCurrentBadge');
        if (badgeEl) badgeEl.textContent = `📋 ตารางส่งหมาย (${res.value.stops.length} รายการ)`;
        initLeafletMapInstance();
        recalculateRouteFromStops(true);

        logServerActivity('MAP_SCHEDULE_CONFIRMED', `กำหนดรายการตารางส่งหมาย ${res.value.stops.length} รายการ (เลขคดี: ${res.value.stops.map(s => s.caseNumber).slice(0, 7).join(', ')}${res.value.stops.length > 7 ? '...' : ''})`, {
          stopsCount: res.value.stops.length,
          cases: res.value.stops.map(s => s.caseNumber)
        });
      } else {
        state.currentMapFilter = res.value;
        renderMapAndPins(res.value.province, res.value.district, res.value.subdistrict);
      }
    }
  });
};

/**
 * เปิด Modal สำหรับเพิ่มหรือแก้ไขรายการส่งหมายเดี่ยว (จากแถบข้างลำดับเส้นทาง)
 */
window.openAddRouteStopModal = function(editIndex = null) {
  const isEditing = (editIndex !== null && editIndex !== undefined && state.currentRouteStops[editIndex]);
  const initialData = isEditing ? state.currentRouteStops[editIndex] : {};

  Swal.fire({
    title: `<div class="flex items-center justify-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-${isEditing ? 'pen-to-square' : 'plus'} text-blue-600"></i> ${isEditing ? `แก้ไขรายการส่งหมาย (ลำดับที่ ${editIndex + 1})` : 'เพิ่มรายการส่งหมายใหม่'}</div>`,
    html: `
      <div class="p-1">
        ${getSummonsFormHtml('quick_', initialData)}
      </div>
    `,
    width: '640px',
    customClass: { popup: 'rounded-2xl p-4 sm:p-5' },
    showCancelButton: true,
    confirmButtonText: isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    didOpen: () => {
      bindScheduleFormEvents('quick_');
    },
    preConfirm: () => {
      const data = extractSummonsFormData('quick_');
      if (!data.caseNumber && !data.houseNo && !data.localAdminName && !data.customOtherLocationName) {
        Swal.showValidationMessage('กรุณากรอกเลขคดี หรือระบุสถานที่ส่งหมาย');
        return false;
      }
      return data;
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      const data = res.value;
      const matchRes = matchSingleCaseWithHistory(
        data.caseNumber,
        data.houseNo,
        data.subdistrict,
        data.district,
        data.locationText,
        data.moo,
        data.province
      );

      const stopItem = {
        id: isEditing ? state.currentRouteStops[editIndex].id : ('stop_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
        caseNumber: data.caseNumber || `${data.prefix}${data.caseNo}/${data.caseYear}`.trim() || 'หมายส่ง',
        courtType: data.courtType,
        prefix: data.prefix,
        caseNo: data.caseNo,
        caseYear: data.caseYear,
        caseExtra: data.caseExtra,
        locationType: data.locationType,
        houseNo: data.houseNo,
        moo: data.moo,
        localAdminName: data.localAdminName,
        customOtherLocationName: data.customOtherLocationName,
        locationText: data.locationText,
        subdistrict: data.subdistrict,
        district: data.district,
        province: data.province,
        lat: matchRes.lat,
        lng: matchRes.lng,
        imageUrl: matchRes.imageUrl || '',
        dateTime: matchRes.dateTime || '',
        matchType: matchRes.matchType,
        matchNote: matchRes.matchNote,
        isMatched: matchRes.matchType === 'exact',
        hasCoords: Boolean(matchRes.lat && matchRes.lng)
      };

      if (isEditing) {
        state.currentRouteStops[editIndex] = stopItem;
      } else {
        state.currentRouteStops.push(stopItem);
      }

      state.lastScheduleFormData = {
        province: data.province,
        district: data.district,
        subdistrict: data.subdistrict,
        courtType: data.courtType,
        prefix: data.prefix,
        caseYear: data.caseYear,
        locationType: data.locationType,
        moo: data.moo,
        localAdminName: data.localAdminName,
        customOtherLocationName: data.customOtherLocationName
      };
      try {
        localStorage.setItem('slts_last_schedule_form', JSON.stringify(state.lastScheduleFormData));
      } catch (e) {}

      initLeafletMapInstance();
      recalculateRouteFromStops(false);
    }
  });
};

/**
 * ลบรายการ Stop
 */
window.deleteRouteStop = function(index, e) {
  if (e) e.stopPropagation();
  if (!state.currentRouteStops || !state.currentRouteStops[index]) return;

  const stop = state.currentRouteStops[index];
  Swal.fire({
    title: 'ยืนยันลบรายการนี้?',
    text: `ต้องการลบรายการ: ${stop.caseNumber} (${stop.locationText}) หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ลบรายการ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#ef4444'
  }).then((res) => {
    if (res.isConfirmed) {
      state.currentRouteStops.splice(index, 1);
      recalculateRouteFromStops(false);
    }
  });
};

/**
 * เปิด Modal ตั้งค่าจุดเริ่มต้นการเดินทาง
 */
window.openStartPointConfigModal = function() {
  const currentStart = state.routeStartLocation;

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-flag-checkered text-blue-600"></i> กำหนดจุดเริ่มต้นการเดินทาง</div>',
    html: `
      <div class="text-left text-xs space-y-3.5">
        <p class="text-gray-600">เลือกตำแหน่งที่ต้องการใช้เป็นจุดตั้งต้นในการคำนวณและนำทางส่งหมาย:</p>

        <div class="grid grid-cols-2 gap-2">
          <button type="button" onclick="setPresetStartLocation('court')" class="p-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl font-bold text-blue-700 flex items-center justify-center gap-1.5 transition cursor-pointer">
            <i class="fa-solid fa-landmark"></i> ศาลจังหวัดอุดรธานี
          </button>
          <button type="button" onclick="setPresetStartLocation('gps')" class="p-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl font-bold text-emerald-700 flex items-center justify-center gap-1.5 transition cursor-pointer">
            <i class="fa-solid fa-location-crosshairs"></i> ดึงพิกัด GPS ปัจจุบัน
          </button>
        </div>

        <div>
          <label class="block font-bold text-gray-800 mb-1">ชื่อจุดเริ่มต้น:</label>
          <input type="text" id="startLocNameInput" value="${currentStart.name}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block font-bold text-gray-800 mb-1">ละติจูด (Lat):</label>
            <input type="text" id="startLocLatInput" value="${currentStart.lat}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono">
          </div>
          <div>
            <label class="block font-bold text-gray-800 mb-1">ลองจิจูด (Lng):</label>
            <input type="text" id="startLocLngInput" value="${currentStart.lng}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono">
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'บันทึกจุดเริ่มต้น',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    didOpen: () => {
      window.setPresetStartLocation = function(type) {
        const nameInput = document.getElementById('startLocNameInput');
        const latInput = document.getElementById('startLocLatInput');
        const lngInput = document.getElementById('startLocLngInput');

        if (type === 'court') {
          if (nameInput) nameInput.value = 'ศาลจังหวัดอุดรธานี';
          if (latInput) latInput.value = '17.4138';
          if (lngInput) lngInput.value = '102.7872';
        } else if (type === 'gps') {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((pos) => {
              if (nameInput) nameInput.value = 'ตำแหน่งปัจจุบันของคุณ';
              if (latInput) latInput.value = pos.coords.latitude.toFixed(6);
              if (lngInput) lngInput.value = pos.coords.longitude.toFixed(6);
            }, () => {
              Swal.showValidationMessage('ไม่สามารถดึงพิกัด GPS ได้ กรุณาตรวจสอบการอนุญาต Location');
            });
          }
        }
      };
    },
    preConfirm: () => {
      const name = document.getElementById('startLocNameInput')?.value || 'จุดเริ่มต้น';
      const lat = parseFloat(document.getElementById('startLocLatInput')?.value);
      const lng = parseFloat(document.getElementById('startLocLngInput')?.value);

      if (isNaN(lat) || isNaN(lng) || lat <= 0 || lng <= 0) {
        Swal.showValidationMessage('กรุณากรอกพิกัด Latitude, Longitude ให้ถูกต้อง');
        return false;
      }
      return { name, lat, lng, isCustom: true };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      state.routeStartLocation = res.value;
      updateStartLocationUI();
      recalculateRouteFromStops();
    }
  });
};

/**
 * อัปเดต UI แถบจุดเริ่มต้น
 */
function updateStartLocationUI() {
  const nameBadge = document.getElementById('routeStartPointNameBadge');
  const coordsBadge = document.getElementById('routeStartPointCoordsBadge');
  if (nameBadge) nameBadge.textContent = state.routeStartLocation.name;
  if (coordsBadge) coordsBadge.textContent = `${state.routeStartLocation.lat.toFixed(4)}, ${state.routeStartLocation.lng.toFixed(4)}`;
}

/**
 * จัดการเมื่อติ๊กเลือกเดินทางวนกลับจุดเริ่มต้น (Round Trip)
 */
window.handleRoundTripChange = function(checked) {
  state.isRoundTrip = checked;
  recalculateRouteFromStops();
};

/**
 * เรนเดอร์หมุดจากตัวกรองพื้นที่
 */
window.renderMapAndPins = function(province, district, subdistrict) {
  const badgeEl = document.getElementById('mapAreaCurrentBadge');
  if (badgeEl) {
    let txt = `จ.${province}`;
    if (district) txt += ` > อ.${district}`;
    if (subdistrict) txt += ` > ต.${subdistrict}`;
    if (!district) txt += ` (ทุกอำเภอ)`;
    else if (!subdistrict) txt += ` (ทุกตำบล)`;
    badgeEl.textContent = txt;
  }

  const allRows = state.allSheetRows || [];
  const matchedRows = allRows.filter(r => {
    const rProv = getRowProvince(r);
    if (rProv !== province) return false;
    if (district) {
      const rDist = (r['อำเภอ'] || r['district'] || '').trim();
      if (rDist !== district) return false;
    }
    if (subdistrict) {
      const rSub = (r['ตำบล'] || r['subdistrict'] || '').trim();
      if (rSub !== subdistrict) return false;
    }
    return true;
  });

  const validStops = [];
  matchedRows.forEach((r, idx) => {
    const rawLat = r['ละติจูด (Lat)'] || r['ละติจูด'] || '';
    const rawLng = r['ลองจิจูด (Lng)'] || r['ลองจิจูด'] || '';
    const lat = parseFloat(rawLat);
    const lng = parseFloat(rawLng);

    if (!isNaN(lat) && !isNaN(lng) && lat > 0 && lng > 0) {
      validStops.push({
        id: 'stop_row_' + idx,
        no: idx + 1,
        raw: r,
        caseNumber: (r['เลขคดี'] || '-').trim(),
        dateTime: formatThaiDateDisplay(r['วัน-เวลาบันทึก'] || r['Timestamp'] || ''),
        locationText: r['ที่ตั้งส่งหมาย (เต็ม)'] || r['ที่ตั้งส่งหมาย'] || (r['อำเภอ'] ? `อ.${r['อำเภอ']} ต.${r['ตำบล'] || ''}` : '-'),
        district: (r['อำเภอ'] || '').trim(),
        subdistrict: (r['ตำบล'] || '').trim(),
        province: getRowProvince(r) || province,
        imageUrl: extractRowImageUrl(r),
        lat: lat,
        lng: lng,
        matchType: 'exact',
        matchNote: 'ตรงกับประวัติ (พบพิกัดจริง)',
        isMatched: true,
        hasCoords: true
      });
    }
  });

  initLeafletMapInstance();

  const orderedStops = optimizeStopsSequence(validStops, state.routeStartLocation.lat, state.routeStartLocation.lng);
  state.currentRouteStops = orderedStops;

  logServerActivity('MAP_FILTER_AREA', `กรองดูหมุดพื้นที่ จ.${province} > อ.${district || 'ทุกอำเภอ'} > ต.${subdistrict || 'ทุกตำบล'} (พบ ${validStops.length} หมุด)`, {
    province,
    district,
    subdistrict,
    pinsCount: validStops.length
  });

  recalculateRouteFromStops(true);
};

/**
 * สร้าง Leaflet Map Instance
 */
function initLeafletMapInstance() {
  const mapContainer = document.getElementById('sltsInteractiveMap');
  if (!mapContainer) return;

  if (!state.interactiveLeafletMap && typeof L !== 'undefined') {
    state.interactiveLeafletMap = L.map('sltsInteractiveMap', {
      zoomControl: true
    }).setView([state.routeStartLocation.lat, state.routeStartLocation.lng], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(state.interactiveLeafletMap);

    state.mapMarkerLayerGroup = L.layerGroup().addTo(state.interactiveLeafletMap);
  }

  if (state.interactiveLeafletMap) {
    state.interactiveLeafletMap.invalidateSize();
  }
}

/**
 * คำนวณและเรนเดอร์เส้นทางใหม่จากลำดับใน state.currentRouteStops (ลากเส้นเฉพาะจุดที่มีหมุดพิกัด)
 * พร้อมระบบ Mouseover Pop Up แสดงภาพและข้อมูลหมายที่เคยส่ง
 */
function recalculateRouteFromStops(isResetToOptimal = false) {
  if (!state.interactiveLeafletMap) return;

  const stops = state.currentRouteStops || [];
  const start = state.routeStartLocation;

  if (state.mapMarkerLayerGroup) {
    state.mapMarkerLayerGroup.clearLayers();
  }
  if (state.mapRoutePolyline) {
    state.interactiveLeafletMap.removeLayer(state.mapRoutePolyline);
    state.mapRoutePolyline = null;
  }

  // 1. หมุดจุดเริ่มต้น (Start Location Hub Marker)
  const startIcon = L.divIcon({
    html: `
      <div class="slts-map-pin-marker" title="จุดเริ่มต้น: ${start.name}">
        <div class="slts-pin-badge start-hub-pin">
          <span>🏛️</span>
        </div>
      </div>
    `,
    className: 'slts-custom-div-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  });

  const startMarker = L.marker([start.lat, start.lng], { icon: startIcon })
    .bindPopup(`<div class="p-3 font-bold text-xs text-emerald-800">🏛️ ${start.name}<p class="text-[10px] font-normal text-gray-500 font-mono mt-0.5">${start.lat.toFixed(4)}, ${start.lng.toFixed(4)}</p></div>`, { className: 'slts-map-popup' });

  startMarker.on('mouseover', function () { this.openPopup(); });

  if (state.mapMarkerLayerGroup) {
    state.mapMarkerLayerGroup.addLayer(startMarker);
  }

  const bounds = [[start.lat, start.lng]];
  const polylineCoords = [[start.lat, start.lng]];

  let totalDistanceKm = 0;
  let prevLat = start.lat;
  let prevLng = start.lng;
  let pinCounter = 0;

  stops.forEach((stop, index) => {
    const hasValidCoords = Boolean(stop.lat && stop.lng && !isNaN(stop.lat) && !isNaN(stop.lng) && stop.lat > 0 && stop.lng > 0);

    if (hasValidCoords) {
      pinCounter++;
      stop.pinNumber = pinCounter;
      bounds.push([stop.lat, stop.lng]);
      polylineCoords.push([stop.lat, stop.lng]);

      // คำนวณระยะทางจากจุดก่อนหน้า
      const legDist = calculateHaversineDistance(prevLat, prevLng, stop.lat, stop.lng);
      stop.legDistanceKm = legDist;
      totalDistanceKm += legDist;
      prevLat = stop.lat;
      prevLng = stop.lng;

      const isExact = stop.matchType === 'exact';
      const pinClass = isExact ? 'slts-pin-badge' : 'slts-pin-badge near-pin';
      const statusBadge = isExact
        ? `<span class="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✓ ตรงกับประวัติ</span>`
        : `<span class="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold">📍 ${stop.matchNote || 'พิกัดใกล้เคียง'}</span>`;

      // Custom Marker
      const pinHtml = `
        <div class="slts-map-pin-marker" title="หมุดที่ ${pinCounter}: ${stop.caseNumber}">
          <div class="${pinClass}">
            <span>${pinCounter}</span>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: pinHtml,
        className: 'slts-custom-div-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28]
      });

      const safeCase = (stop.caseNumber || '').replace(/'/g, "\\'");
      const safeLoc = (stop.locationText || '').replace(/'/g, "\\'");
      const safeDate = (stop.dateTime || '').replace(/'/g, "\\'");
      const rawImgUrl = (stop.imageUrl || '').replace(/'/g, "\\'");
      const directThumbUrl = getDirectDriveImageUrl(stop.imageUrl, 800);
      const fallbackThumbUrl = getDriveFallbackThumbnailUrl(stop.imageUrl, 800);

      const popupHtml = `
        <div class="p-3 space-y-2 text-xs font-sans">
          <div class="flex items-center justify-between border-b border-gray-100 pb-1.5 gap-2">
            <span class="font-bold text-sm text-blue-700 truncate">หมุดที่ ${pinCounter}: ${stop.caseNumber}</span>
            ${statusBadge}
          </div>
          
          <p class="text-gray-700 text-xs leading-relaxed"><i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${stop.locationText}</p>
          <p class="text-[10px] text-gray-500"><i class="fa-solid fa-route text-blue-500 mr-1"></i>+${legDist.toFixed(1)} กม. จากจุดก่อนหน้า</p>

          ${stop.dateTime ? `
            <p class="text-[10px] text-emerald-700 font-semibold"><i class="fa-solid fa-calendar-check mr-1"></i>ประวัติส่งเมื่อ: ${stop.dateTime}</p>
          ` : ''}

          ${directThumbUrl ? `
            <div class="pt-0.5">
              <div class="relative w-full h-32 bg-gray-100 rounded-xl overflow-hidden border border-gray-200 group cursor-pointer shadow-xs" onclick="viewPhotoModal('${rawImgUrl}', '${safeCase}', '${safeLoc}', '${safeDate}', '${stop.lat}', '${stop.lng}')" title="คลิกเพื่อดูภาพขนาดเต็ม">
                <img src="${directThumbUrl}" 
                     alt="ภาพถ่ายหมาย: ${safeCase}" 
                     class="w-full h-full object-cover transition duration-200 group-hover:scale-105" 
                     loading="lazy" 
                     onerror="if (this.src !== '${fallbackThumbUrl}') { this.src='${fallbackThumbUrl}'; } else { this.parentElement.style.display='none'; }"
                >
                <div class="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-[11px] font-bold gap-1">
                  <i class="fa-solid fa-magnifying-glass-plus"></i>
                  <span>คลิกดูภาพเต็ม</span>
                </div>
                <div class="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                  📷 ภาพส่งหมาย
                </div>
              </div>
            </div>
          ` : ''}

          <div class="pt-1">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}" target="_blank" class="block w-full text-center py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-lg text-[11px] font-bold shadow-xs transition">
              <i class="fa-solid fa-diamond-turn-right mr-1"></i> นำทางจุดนี้ด้วย Google Maps
            </a>
          </div>
        </div>
      `;

      const marker = L.marker([stop.lat, stop.lng], { icon: customIcon })
        .bindPopup(popupHtml, { className: 'slts-map-popup' });

      // เมื่อเอา mouse over ให้แสดง pop up ข้อมูลภาพและข้อมูลหมายที่เคยส่ง
      marker.on('mouseover', function () {
        this.openPopup();
      });

      marker.on('click', function () {
        this.openPopup();
      });

      stop.leafletMarker = marker;
      if (state.mapMarkerLayerGroup) {
        state.mapMarkerLayerGroup.addLayer(marker);
      }
    } else {
      // รายการไม่มีข้อมูลตรงกับฐานข้อมูล -> ไม่ต้องแสดงหมุดและไม่ลากเส้น
      stop.pinNumber = null;
      stop.legDistanceKm = 0;
      stop.leafletMarker = null;
    }
  });

  // ถ้าเลือก Round Trip -> วนกลับมาจุดเริ่มต้น (เฉพาะกรณีมีจุดหมุดอย่างน้อย 1 จุด)
  if (state.isRoundTrip && polylineCoords.length > 1) {
    polylineCoords.push([start.lat, start.lng]);
    const returnDist = calculateHaversineDistance(prevLat, prevLng, start.lat, start.lng);
    totalDistanceKm += returnDist;
  }

  // วาด Polyline เฉพาะกรณีมีจุดหมุดอย่างน้อย 1 จุด
  if (polylineCoords.length > 1 && state.showRouteLayer) {
    state.mapRoutePolyline = L.polyline(polylineCoords, {
      color: '#2563eb',
      weight: 3.5,
      opacity: 0.85,
      dashArray: '8, 8',
      lineCap: 'round'
    }).addTo(state.interactiveLeafletMap);
  }

  // บันทึก Optimal Baseline
  if (isResetToOptimal) {
    state.initialOptimalDistanceKm = totalDistanceKm;
  }

  // อัปเดต Distance Delta Banner
  const deltaBanner = document.getElementById('routeDistanceDeltaBanner');
  const deltaText = document.getElementById('routeDistanceDeltaText');
  const distDelta = totalDistanceKm - state.initialOptimalDistanceKm;

  if (deltaBanner && deltaText) {
    if (!isResetToOptimal && Math.abs(distDelta) > 0.1 && pinCounter > 1) {
      if (distDelta > 0) {
        deltaText.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1 text-amber-600"></i> ระยะทางเพิ่มขึ้น <strong>+${distDelta.toFixed(1)} กม.</strong> จากเส้นทางแนะนำ`;
        deltaBanner.className = 'px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 font-semibold flex items-center justify-between';
      } else {
        deltaText.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-emerald-600"></i> ระยะทางสั้นลง <strong>${distDelta.toFixed(1)} กม.</strong>`;
        deltaBanner.className = 'px-3 py-1.5 bg-emerald-50 border-b border-emerald-200 text-[11px] text-emerald-800 font-semibold flex items-center justify-between';
      }
      deltaBanner.classList.remove('hidden');
    } else {
      deltaBanner.classList.add('hidden');
    }
  }

  // อัปเดต Badges
  const pinCountEl = document.getElementById('mapPinCountBadge');
  if (pinCountEl) pinCountEl.textContent = pinCounter;

  const routeSummaryBadge = document.getElementById('mapRouteSummaryBadge');
  const totalDistEl = document.getElementById('mapTotalDistanceText');
  if (routeSummaryBadge && totalDistEl) {
    if (pinCounter > 0) {
      totalDistEl.textContent = `${totalDistanceKm.toFixed(1)} กม.`;
      routeSummaryBadge.classList.remove('hidden');
      routeSummaryBadge.classList.add('flex');
    } else {
      routeSummaryBadge.classList.add('hidden');
      routeSummaryBadge.classList.remove('flex');
    }
  }

  renderRouteSidebarList(stops, totalDistanceKm);

  if (bounds.length > 1) {
    state.interactiveLeafletMap.fitBounds(bounds, { padding: [40, 40] });
  }
}

/**
 * เรนเดอร์รายการ Stops บน Sidebar พร้อมปุ่มแก้ไขข้อมูล ลบข้อมูล และ Drag & Drop
 */
function renderRouteSidebarList(stops, totalDistKm) {
  const container = document.getElementById('mapRouteStopsList');
  if (!container) return;

  if (!stops || stops.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400">
        <i class="fa-solid fa-map-location text-3xl mb-2 text-gray-300"></i>
        <p class="text-xs font-semibold">ยังไม่มีรายการส่งหมาย</p>
        <p class="text-[10px] text-gray-400 mt-1">กด "ระบุพื้นที่ / ตัวกรอง" หรือ "+ เพิ่มรายการ" เพื่อจัดตารางส่งหมายบนแผนที่</p>
      </div>
    `;
    return;
  }

  let html = '';
  stops.forEach((stop, index) => {
    const isExact = stop.matchType === 'exact' || stop.isMatched;
    const isNear = stop.matchType === 'near';
    const hasPin = stop.pinNumber !== null && stop.pinNumber !== undefined;
    const distText = hasPin ? `+ ${stop.legDistanceKm.toFixed(1)} กม.` : 'ไม่มีหมุด';

    const itemClass = isExact ? 'slts-match-exact' : (isNear ? 'slts-match-near' : 'slts-match-none');
    const badgeBg = isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700');
    const statusNote = isExact
      ? `<span class="text-[9px] text-emerald-700 font-bold inline-block mt-0.5"><i class="fa-solid fa-circle-check text-[8px] mr-1"></i>ตรงกับประวัติ (มีหมุดเส้นทาง)</span>`
      : (isNear
        ? `<span class="text-[9px] text-amber-800 font-bold inline-block mt-0.5"><i class="fa-solid fa-location-dot text-[8px] mr-1"></i>${stop.matchNote || 'หมุดใกล้เคียง'}</span>`
        : `<span class="text-[9px] text-gray-400 font-normal inline-block mt-0.5">ไม่มีข้อมูลในฐานข้อมูล (ไม่มีหมุด)</span>`);

    html += `
      <div class="slts-route-stop-item p-2.5 rounded-xl border relative flex items-start gap-2 transition ${itemClass}" draggable="true" id="routeStopItem_${index}" data-index="${index}">
        <!-- Drag Handle -->
        <div class="slts-drag-handle text-gray-400 hover:text-gray-600 pt-1 cursor-grab" title="ลากเพื่อสลับตำแหน่ง">
          <i class="fa-solid fa-grip-vertical text-xs"></i>
        </div>

        <!-- Stop Number Badge -->
        <span class="w-5 h-5 rounded-full ${badgeBg} text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          ${hasPin ? stop.pinNumber : '-'}
        </span>

        <!-- Info Content (Hover / Click to focus on map) -->
        <div class="flex-1 min-w-0 ${hasPin ? 'cursor-pointer' : ''}" ${hasPin ? `onclick="focusMapOnStop(${index})"` : ''}>
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <span class="font-bold text-xs ${isExact ? 'text-emerald-900' : (isNear ? 'text-amber-950' : 'text-gray-900')} truncate">${stop.caseNumber}</span>
            <span class="text-[10px] font-semibold ${isExact ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (isNear ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-100 border-gray-200')} px-1.5 py-0.2 rounded border flex-shrink-0">
              ${distText}
            </span>
          </div>
          <p class="text-[11px] opacity-80 truncate" title="${stop.locationText}">
            ${stop.locationText}
          </p>
          ${statusNote}
        </div>

        <!-- Quick Action Buttons (Edit, Delete, Up, Down) -->
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onclick="openAddRouteStopModal(${index})" class="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer" title="แก้ไขข้อมูลหมายนี้">
            <i class="fa-solid fa-pen-to-square text-xs"></i>
          </button>
          <button type="button" onclick="deleteRouteStop(${index}, event)" class="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer" title="ลบรายการนี้">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
          <div class="flex flex-col gap-0.5 ml-0.5">
            <button type="button" onclick="moveStopUp(${index}, event)" class="p-0.5 text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer" title="เลื่อนขึ้น">
              <i class="fa-solid fa-chevron-up"></i>
            </button>
            <button type="button" onclick="moveStopDown(${index}, event)" class="p-0.5 text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer" title="เลื่อนลง">
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  if (state.isRoundTrip && stops.length > 0) {
    html += `
      <div class="p-2 bg-emerald-50/80 rounded-xl border border-emerald-200 text-[11px] font-bold text-emerald-800 flex items-center justify-between">
        <span>🏁 วนกลับ: ${state.routeStartLocation.name}</span>
        <span class="text-[10px] font-mono text-emerald-700">จบทริป</span>
      </div>
    `;
  }

  container.innerHTML = html;

  // ผูก Drag & Drop Event Listeners
  container.querySelectorAll('.slts-route-stop-item').forEach((el, idx) => {
    initStopItemDragEvents(el, idx);
    // Mouse hover highlight
    el.addEventListener('mouseenter', () => {
      const stop = state.currentRouteStops[idx];
      if (stop && stop.leafletMarker) {
        stop.leafletMarker.openPopup();
      }
    });
  });
}

/**
 * ผูก Event การลากวาง Drag & Drop บน Stop Item
 */
let draggedStopIndex = null;

function initStopItemDragEvents(element, index) {
  element.addEventListener('dragstart', (e) => {
    draggedStopIndex = index;
    element.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  });

  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = element.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY < rect.height / 2) {
      element.classList.add('drag-over-top');
      element.classList.remove('drag-over-bottom');
    } else {
      element.classList.add('drag-over-bottom');
      element.classList.remove('drag-over-top');
    }
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    element.classList.remove('drag-over-top', 'drag-over-bottom');
    const fromIdx = draggedStopIndex;
    const toIdx = index;
    if (fromIdx !== null && fromIdx !== toIdx) {
      reorderStops(fromIdx, toIdx);
    }
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom');
    draggedStopIndex = null;
  });
}

/**
 * สลับตำแหน่ง Stop และอัปเดตเส้นทางใหม่ทุกครั้ง
 */
window.reorderStops = function(fromIndex, toIndex) {
  if (!state.currentRouteStops || fromIndex === toIndex) return;
  const [movedItem] = state.currentRouteStops.splice(fromIndex, 1);
  state.currentRouteStops.splice(toIndex, 0, movedItem);

  recalculateRouteFromStops(false);
};

window.moveStopUp = function(index, e) {
  if (e) e.stopPropagation();
  if (index > 0) reorderStops(index, index - 1);
};

window.moveStopDown = function(index, e) {
  if (e) e.stopPropagation();
  if (index < state.currentRouteStops.length - 1) reorderStops(index, index + 1);
};

/**
 * โฟกัสแผนที่ไปยังหมุดที่เลือกจาก Sidebar
 */
window.focusMapOnStop = function(index) {
  const stop = state.currentRouteStops[index];
  if (!stop || !stop.lat || !stop.lng || !state.interactiveLeafletMap) return;

  document.querySelectorAll('.slts-route-stop-item').forEach(el => el.classList.remove('active'));
  const targetItem = document.getElementById(`routeStopItem_${index}`);
  if (targetItem) targetItem.classList.add('active');

  state.interactiveLeafletMap.flyTo([stop.lat, stop.lng], 16, { duration: 0.8 });
  if (stop.leafletMarker) {
    stop.leafletMarker.openPopup();
  }
};

/**
 * สลับการแสดง/ซ่อนเส้นทาง Polyline บนแผนที่
 */
window.toggleMapRouteLayer = function() {
  if (!state.interactiveLeafletMap) return;
  state.showRouteLayer = !state.showRouteLayer;

  const btnTxt = document.getElementById('txtToggleRouteLine');
  if (btnTxt) {
    btnTxt.textContent = state.showRouteLayer ? 'ซ่อนเส้นทาง' : 'แสดงเส้นทาง';
  }

  recalculateRouteFromStops(false);
};

/**
 * ปรับมุมมองแผนที่ให้เห็นครบทุกหมุด
 */
window.fitMapToAllPins = function() {
  if (!state.interactiveLeafletMap) return;
  const bounds = [[state.routeStartLocation.lat, state.routeStartLocation.lng]];
  if (state.currentRouteStops) {
    state.currentRouteStops.forEach(s => {
      if (s.lat && s.lng) bounds.push([s.lat, s.lng]);
    });
  }
  state.interactiveLeafletMap.fitBounds(bounds, { padding: [40, 40] });
};

/**
 * คำนวณจัดลำดับเส้นทางใหม่
 */
window.optimizeTripRoute = function() {
  if (!state.currentRouteStops || state.currentRouteStops.length === 0) return;
  const orderedStops = optimizeStopsSequence(state.currentRouteStops, state.routeStartLocation.lat, state.routeStartLocation.lng);
  state.currentRouteStops = orderedStops;
  
  logServerActivity('MAP_ROUTE_OPTIMIZE', `จัดลำดับเส้นทางส่งหมาย ${orderedStops.length} จุดหมาย (Nearest-Neighbor TSP)`, {
    stopsCount: orderedStops.length,
    cases: orderedStops.map(s => s.caseNumber).slice(0, 10)
  });

  recalculateRouteFromStops(true);
};

/**
 * เปิดเส้นทางทั้งหมดใน Google Maps Directions (Multi-stop route)
 */
window.openFullRouteInGoogleMaps = function() {
  const validStops = (state.currentRouteStops || []).filter(s => s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng) && s.lat > 0 && s.lng > 0);
  const start = state.routeStartLocation;

  if (!validStops || validStops.length === 0) {
    Swal.fire('ไม่มีรายการหมุด', 'ไม่พบหมุดพิกัดที่มีประวัติในรายการที่เลือก จึงไม่สามารถสร้างเส้นทางนำทางได้', 'info');
    return;
  }

  const origin = `${start.lat},${start.lng}`;
  let destination = '';
  let waypoints = [];

  if (state.isRoundTrip) {
    destination = `${start.lat},${start.lng}`;
    waypoints = validStops.map(s => `${s.lat},${s.lng}`);
  } else {
    destination = `${validStops[validStops.length - 1].lat},${validStops[validStops.length - 1].lng}`;
    waypoints = validStops.slice(0, -1).map(s => `${s.lat},${s.lng}`);
  }

  let gmapUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (waypoints.length > 0) {
    gmapUrl += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
  }

  logServerActivity('MAP_NAVIGATE_GOOGLE_MAPS', `เปิดนำทาง Google Maps สำหรับ ${validStops.length} จุดหมาย (ไป-กลับ: ${state.isRoundTrip ? 'ใช่' : 'ไม่ใช่'})`, {
    validStopsCount: validStops.length,
    isRoundTrip: state.isRoundTrip,
    cases: validStops.map(s => s.caseNumber).slice(0, 10)
  });

  window.open(gmapUrl, '_blank');
};

/**
 * เปิดหน้าต่างแผนที่และเส้นทางส่งหมายสำหรับหน้าจอมือถือ (< 768px)
 */
window.showMobileRouteMapModal = function() {
  const stops = state.currentRouteStops || [];
  const start = state.routeStartLocation;
  const prov = state.selectedProvince || 'อุดรธานี';

  let totalDistKm = 0;
  stops.forEach(s => { if (s.legDistanceKm) totalDistKm += s.legDistanceKm; });

  let stopsHtml = '';
  if (stops.length === 0) {
    stopsHtml = `
      <div class="p-6 text-center text-gray-400">
        <i class="fa-solid fa-map-location text-3xl mb-2 text-gray-300"></i>
        <p class="text-xs font-semibold">ยังไม่มีรายการหมุดที่เลือก</p>
        <p class="text-[10px] text-gray-400 mt-1">กดปุ่ม "ตัวกรอง" เพื่อเลือกพื้นที่หรือจัดตารางส่งหมาย</p>
      </div>
    `;
  } else {
    stops.forEach((stop, index) => {
      const isExact = stop.matchType === 'exact' || stop.isMatched;
      const isNear = stop.matchType === 'near';
      const hasPin = stop.pinNumber !== null && stop.pinNumber !== undefined;
      const distText = hasPin ? `+ ${stop.legDistanceKm.toFixed(1)} กม.` : 'ไม่มีหมุด';
      const itemClass = isExact ? 'slts-match-exact' : (isNear ? 'slts-match-near' : 'slts-match-none');
      const badgeBg = isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700');

      stopsHtml += `
        <div class="p-2.5 rounded-xl border flex items-start gap-2 text-xs transition ${itemClass}">
          <span class="w-5 h-5 rounded-full ${badgeBg} text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            ${hasPin ? stop.pinNumber : '-'}
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1 mb-0.5">
              <span class="font-bold text-xs ${isExact ? 'text-emerald-900' : (isNear ? 'text-amber-950' : 'text-gray-900')} truncate">${stop.caseNumber}</span>
              <span class="text-[10px] font-semibold ${isExact ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (isNear ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-100 border-gray-200')} px-1.5 py-0.2 rounded border flex-shrink-0">
                ${distText}
              </span>
            </div>
            <p class="text-[11px] opacity-80 truncate">${stop.locationText}</p>
            ${isExact ? `<span class="text-[9px] text-emerald-700 font-bold inline-block mt-0.5"><i class="fa-solid fa-circle-check text-[8px] mr-1"></i>ตรงกับประวัติ (มีหมุดเส้นทาง)</span>` : (isNear ? `<span class="text-[9px] text-amber-800 font-bold inline-block mt-0.5"><i class="fa-solid fa-location-dot text-[8px] mr-1"></i>${stop.matchNote || 'หมุดใกล้เคียง'}</span>` : `<span class="text-[9px] text-gray-400 font-normal inline-block mt-0.5">ไม่มีข้อมูลในฐานข้อมูล (ไม่มีหมุด)</span>`)}
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" onclick="openAddRouteStopModal(${index})" class="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer">
              <i class="fa-solid fa-pen-to-square text-xs"></i>
            </button>
            <button type="button" onclick="deleteRouteStop(${index}, event)" class="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
            <div class="flex flex-col gap-0.5">
              <button type="button" onclick="moveStopUp(${index}, event); renderMobileRouteList();" class="p-1 text-[9px] text-gray-400 hover:text-blue-600 cursor-pointer">
                <i class="fa-solid fa-chevron-up"></i>
              </button>
              <button type="button" onclick="moveStopDown(${index}, event); renderMobileRouteList();" class="p-1 text-[9px] text-gray-400 hover:text-blue-600 cursor-pointer">
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    });
  }

  Swal.fire({
    html: `
      <div class="slts-province-modal flex flex-col h-[88dvh]">
        <!-- Header -->
        <div class="slts-modal-header flex-shrink-0">
          <button type="button" onclick="showMobileSummonsFormModal(true)" class="slts-back-header-btn" title="กลับไปฟอร์ม">
            <i class="fa-solid fa-arrow-left"></i>
            <span>กลับ</span>
          </button>
          <div class="flex-1 text-center pr-2">
            <h2 class="slts-modal-title">🗺️ แผนที่เส้นทางส่งหมาย</h2>
            <p class="slts-modal-subtitle">📍 จ.${prov} (${stops.length} คดี)</p>
          </div>
          <div class="flex items-center gap-1">
            <button type="button" onclick="openAddRouteStopModal()" class="px-2 py-1 bg-white/20 hover:bg-white/30 text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer">
              <i class="fa-solid fa-plus"></i> เพิ่ม
            </button>
            <button type="button" onclick="openMapAreaSelectorModal()" class="px-2 py-1 bg-white/20 hover:bg-white/30 text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer">
              <i class="fa-solid fa-layer-group"></i> ตัวกรอง
            </button>
          </div>
        </div>

        <!-- Mobile Leaflet Map -->
        <div class="relative flex-1 min-h-[220px] max-h-[44dvh] w-full bg-slate-100 border-b border-gray-200">
          <div id="sltsInteractiveMap" class="w-full h-full"></div>
        </div>

        <!-- Mobile Controls & Stops List -->
        <div class="flex-1 flex flex-col min-h-0 bg-white">
          <!-- Control Bar -->
          <div class="p-2.5 bg-blue-50/70 border-b border-blue-100 flex items-center justify-between text-xs flex-shrink-0">
            <div class="flex items-center gap-1.5 truncate">
              <span class="font-bold text-gray-800 text-[11px]">🏁 ${start.name}</span>
              ${totalDistKm > 0 ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">${totalDistKm.toFixed(1)} กม.</span>` : ''}
            </div>
            <button type="button" onclick="openFullRouteInGoogleMaps()" class="px-2.5 py-1 bg-emerald-600 active:scale-95 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-sm flex-shrink-0 cursor-pointer">
              <i class="fa-solid fa-diamond-turn-right"></i> นำทาง Google Maps
            </button>
          </div>

          <!-- Stops List -->
          <div id="mobileMapRouteStopsList" class="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-gray-100 slts-swal-body-scroll">
            ${stopsHtml}
          </div>
        </div>
      </div>
    `,
    position: 'top',
    showConfirmButton: false,
    showCloseButton: false,
    allowOutsideClick: false,
    customClass: {
      container: 'slts-swal-top-container',
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding'
    },
    didOpen: () => {
      // Re-init map
      setTimeout(() => {
        if (state.currentRouteStops.length > 0) {
          recalculateRouteFromStops(false);
        } else if (state.currentMapFilter) {
          renderMapAndPins(state.currentMapFilter.province, state.currentMapFilter.district, state.currentMapFilter.subdistrict);
        } else {
          renderMapAndPins(prov, '', '');
        }
      }, 150);
    }
  });
};

window.renderMobileRouteList = function() {
  const container = document.getElementById('mobileMapRouteStopsList');
  if (!container) return;
  const stops = state.currentRouteStops || [];
  let stopsHtml = '';
  stops.forEach((stop, index) => {
    const isExact = stop.matchType === 'exact' || stop.isMatched;
    const isNear = stop.matchType === 'near';
    const hasPin = stop.pinNumber !== null && stop.pinNumber !== undefined;
    const distText = hasPin ? `+ ${stop.legDistanceKm.toFixed(1)} กม.` : 'ไม่มีหมุด';
    const itemClass = isExact ? 'slts-match-exact' : (isNear ? 'slts-match-near' : 'slts-match-none');
    const badgeBg = isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700');

    stopsHtml += `
      <div class="p-2.5 rounded-xl border flex items-start gap-2 text-xs transition ${itemClass}">
        <span class="w-5 h-5 rounded-full ${badgeBg} text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          ${hasPin ? stop.pinNumber : '-'}
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <span class="font-bold text-xs ${isExact ? 'text-emerald-900' : (isNear ? 'text-amber-950' : 'text-gray-900')} truncate">${stop.caseNumber}</span>
            <span class="text-[10px] font-semibold ${isExact ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : (isNear ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-100 border-gray-200')} px-1.5 py-0.2 rounded border flex-shrink-0">
              ${distText}
            </span>
          </div>
          <p class="text-[11px] opacity-80 truncate">${stop.locationText}</p>
          ${isExact ? `<span class="text-[9px] text-emerald-700 font-bold inline-block mt-0.5"><i class="fa-solid fa-circle-check text-[8px] mr-1"></i>ตรงกับประวัติ (มีหมุดเส้นทาง)</span>` : (isNear ? `<span class="text-[9px] text-amber-800 font-bold inline-block mt-0.5"><i class="fa-solid fa-location-dot text-[8px] mr-1"></i>${stop.matchNote || 'หมุดใกล้เคียง'}</span>` : `<span class="text-[9px] text-gray-400 font-normal inline-block mt-0.5">ไม่มีข้อมูลในฐานข้อมูล (ไม่มีหมุด)</span>`)}
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button type="button" onclick="openAddRouteStopModal(${index})" class="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer">
            <i class="fa-solid fa-pen-to-square text-xs"></i>
          </button>
          <button type="button" onclick="deleteRouteStop(${index}, event)" class="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
          <div class="flex flex-col gap-0.5">
            <button type="button" onclick="moveStopUp(${index}, event); renderMobileRouteList();" class="p-1 text-[9px] text-gray-400 hover:text-blue-600 cursor-pointer">
              <i class="fa-solid fa-chevron-up"></i>
            </button>
            <button type="button" onclick="moveStopDown(${index}, event); renderMobileRouteList();" class="p-1 text-[9px] text-gray-400 hover:text-blue-600 cursor-pointer">
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = stopsHtml;
};
