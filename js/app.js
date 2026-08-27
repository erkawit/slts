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
  selectedProvince: localStorage.getItem('slts_selected_province') || null
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
    // จอมือถือ (< 768px): Camera-first & SweetAlert Form
    openCameraModal().catch(e => console.warn('Camera open error:', e));
    setTimeout(() => {
      if (!state.selectedProvince) {
        showProvinceSelectorModal(true);
      } else {
        showMobileSummonsFormModal(false);
      }
    }, 120);
  } else {
    // จอคอมพิวเตอร์ (>= 768px): แสดงหน้าแบบฟอร์ม 2 คอลัมน์ตามเดิม
    switchTab('form');
  }
});


function initDOMElements() {
  elements.tabBtnCamera = document.getElementById('tabBtnCamera');
  elements.tabBtnForm = document.getElementById('tabBtnForm') || elements.tabBtnCamera;
  elements.tabBtnTable = document.getElementById('tabBtnTable');
  elements.tabBtnUsers = document.getElementById('tabBtnUsers');
  elements.tabContentForm = document.getElementById('tabContentForm');
  elements.tabContentTable = document.getElementById('tabContentTable');
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

  // ปุ่มอัปโหลดภาพหมาย (แสดงบนหน้าจอกว้าง > 768px)
  const btnManualUpload = document.getElementById('btnManualUploadPhoto');
  if (btnManualUpload) {
    if (isDesktop) {
      btnManualUpload.classList.remove('hidden');
      btnManualUpload.classList.add('inline-flex');
    } else {
      btnManualUpload.classList.add('hidden');
      btnManualUpload.classList.remove('inline-flex');
    }
  }

  // Tab 3: จัดการผู้ใช้งาน (แสดงเฉพาะ Admin บน Desktop)
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
    // โหลดข้อมูลแบบ Smart Cache 1 นาที
    loadGoogleSheetData(false);
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
async function compressImageToMax1MB(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // ปรับขนาดความกว้าง/สูงสูงสุดไม่เกิน 1600px (ความคมชัดระดับ Full HD คมชัดทุกตัวอักษร)
      const MAX_DIMENSION = 1600;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.82;
      let resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      let currentBytes = Math.round((resultDataUrl.length - resultDataUrl.indexOf(',') - 1) * 0.75);

      while (currentBytes > 1024 * 1024 && quality > 0.3) {
        quality -= 0.1;
        resultDataUrl = canvas.toDataURL('image/jpeg', quality);
        currentBytes = Math.round((resultDataUrl.length - resultDataUrl.indexOf(',') - 1) * 0.75);
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
      body: JSON.stringify(payload)
    });

    clearInterval(progressInterval);

    const bar = document.getElementById('uploadProgressBar');
    const txt = document.getElementById('uploadPercentTxt');
    if (bar) bar.style.width = '100%';
    if (txt) txt.textContent = '100%';

    const resJson = await response.json();
    return resJson;

  } catch (err) {
    clearInterval(progressInterval);
    console.error('uploadWithProgressBar fetch error:', err);
    throw new Error('เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย หรือไม่สามารถติดต่อ Google Apps Script ได้: ' + err.message);
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

function renderDataTable(rows) {
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

  // 2. กรองข้อมูลเฉพาะจังหวัดที่เลือกใช้งาน (state.selectedProvince)
  const currentProv = state.selectedProvince || 'อุดรธานี';
  const filteredRows = rows.filter(row => {
    const prov = getRowProvince(row);
    row._resolvedProvince = prov;
    return prov === currentProv;
  });

  const tableProvFilterBadge = document.getElementById('tableProvFilterBadge');
  if (tableProvFilterBadge) {
    tableProvFilterBadge.textContent = `📍 แสดง: จ.${currentProv} (${filteredRows.length} รายการ)`;
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
    const courtType = latest['ประเภทศาล'] || 'ศาลจังหวัด' + currentProv;
    const rowProvince = latest._resolvedProvince || getRowProvince(latest);
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
      infoEmpty: "ไม่มีข้อมูลในจังหวัดนี้",
      infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
      paginate: {
        first: "แรกสุด",
        last: "ท้ายสุด",
        next: "ถัดไป",
        previous: "ก่อนหน้า"
      },
      zeroRecords: `ไม่พบข้อมูลที่ตรงกับการค้นหาใน จ.${currentProv}`
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
      <div class="text-left text-xs text-gray-600 mb-3">
        <span>พบประวัติทั้งหมด <b>${records.length}</b> รายการ</span>
      </div>
      <div class="overflow-x-auto">
        <table id="caseSubDataTable" class="w-full text-left text-xs stripe hover" style="width:100%">
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
    width: showDeleteCol ? '750px' : '650px',
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

      if (courtType === 'ศาลอื่น') {
        const otherNo = document.getElementById('mUp_otherCaseNo').value.trim();
        const otherYr = document.getElementById('mUp_otherYear').value;
        if (!otherNo) {
          Swal.showValidationMessage('กรุณากรอกเลขคดี');
          return false;
        }
        caseNumber = otherNo.includes('/') ? otherNo : `${otherNo}/${otherYr}`;
      } else {
        const prefix = document.getElementById('mUp_udonPrefix').value.trim();
        const no = document.getElementById('mUp_udonCaseNo').value.trim();
        const yr = document.getElementById('mUp_udonYear').value;
        if (!prefix || !no) {
          Swal.showValidationMessage('กรุณากรอกอักษรนำหน้าและเลขคดี');
          return false;
        }
        caseNumber = `${prefix}${no}/${yr}`;
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
 * ดูภาพตัวอย่างขนาดเต็มจาก Manual Upload
 */
window.viewManualFullPreview = function() {
  if (!window._manualTempDataUrl) return;
  Swal.fire({
    title: 'ตัวอย่างภาพขนาดเต็ม',
    imageUrl: window._manualTempDataUrl,
    imageAlt: 'ตัวอย่างภาพ',
    showCloseButton: true,
    allowOutsideClick: false,
    confirmButtonText: 'ปิด',
    confirmButtonColor: '#2563eb'
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
 * แสดงภาพถ่ายเต็มด้วย SweetAlert พร้อมปุ่มดาวน์โหลด และคลิกดูเต็มหน้าจอได้
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
      <div class="text-left text-xs text-gray-600 mb-3 space-y-1">
        <p><b>📅 วันที่เวลา:</b> ${timestamp}</p>
        <p><b>🏠 ที่ตั้งส่งหมาย:</b> ${locationFull}</p>
        <p><b>📍 พิกัด GPS:</b> ${lat}, ${lng}</p>
      </div>
      <div class="relative bg-gray-900 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center min-h-[250px] max-h-[60vh] cursor-pointer group" onclick="openFullScreenImage('${directImgUrl}')" title="คลิกที่ภาพเพื่อเปิดดูแบบเต็มหน้าจอ">
        <img src="${directImgUrl}" alt="${caseNumber}" class="max-w-full max-h-[58vh] object-contain rounded-lg shadow-md transition group-hover:scale-[1.01]" onerror="this.onerror=null; this.src='${imgUrl}';">
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1.5">
          <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
          <span>คลิกที่ภาพเพื่อเปิดดูแบบเต็มหน้าจอ</span>
        </div>
      </div>
    `,
    width: '650px',
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
    width: '95vw',
    padding: '0.5rem',
    background: 'rgba(0, 0, 0, 0.95)',
    customClass: {
      popup: 'border-0 rounded-2xl'
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
// SweetAlert Popup ค้นหาประวัติส่งหมายบน Mobile
// -------------------------------------------------------------------------
window.showMobileHistorySearchModal = function() {
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

  if (!state.allSheetRows || state.allSheetRows.length === 0) {
    const cachedStr = localStorage.getItem(CACHE_KEY_SHEET_DATA);
    if (cachedStr) {
      try {
        state.allSheetRows = JSON.parse(cachedStr);
      } catch (e) {}
    }
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

      // กรณีมีมากกว่า 1 รายการส่งหมาย
      if (records.length > 1) {
        cardsHtml += `
          <div class="slts-history-card border-indigo-200 hover:border-indigo-400" data-search="${caseNum.toLowerCase()} ${district.toLowerCase()} ${subdistrict.toLowerCase()} ${locText.toLowerCase()}">
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
          <div class="slts-history-card" data-search="${caseNum.toLowerCase()} ${district.toLowerCase()} ${subdistrict.toLowerCase()} ${locText.toLowerCase()}">
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
            <p class="slts-modal-subtitle">📍 จังหวัด${prov} (${caseGroups.size} คดี)</p>
          </div>
        </div>
        <!-- Search -->
        <div class="slts-search-wrap">
          <i class="fa-solid fa-magnifying-glass slts-search-icon"></i>
          <input type="text" id="swalHistorySearchInput" placeholder="พิมพ์เลขคดี, อำเภอ, ตำบล หรือสถานที่..." class="slts-search-input" oninput="filterMobileHistoryList(this.value)" autocomplete="off">
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
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 150);
      }
    }
  });
};

window.filterMobileHistoryList = function(query) {
  const wrap = document.getElementById('swalHistoryCardsWrap');
  if (!wrap) return;
  const q = (query || '').trim().toLowerCase();
  const cards = wrap.querySelectorAll('.slts-history-card');
  cards.forEach(card => {
    const s = card.getAttribute('data-search') || '';
    card.style.display = s.includes(q) ? '' : 'none';
  });
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
          ${searchBtnHtml}
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
  if (isOther) {
    const caseNo = (elements.otherCaseNoInput ? elements.otherCaseNoInput.value : '').trim();
    const year = elements.otherCaseYearSelect ? elements.otherCaseYearSelect.value : '';
    return caseNo ? `ต${caseNo}/${year}` : '';
  } else {
    const prefix = (elements.udonPrefixInput ? elements.udonPrefixInput.value : '').trim();
    const caseNo = (elements.udonCaseNoInput ? elements.udonCaseNoInput.value : '').trim();
    const year = elements.udonCaseYearSelect ? elements.udonCaseYearSelect.value : '';
    return (prefix && caseNo) ? `${prefix}${caseNo}/${year}` : '';
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

  // อักษรนำหน้า: ให้กรอกได้เฉพาะตัวอักษร (ไทย / อังกฤษ)
  if (elements.udonPrefixInput) {
    elements.udonPrefixInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^a-zA-Zก-๙]/g, '');
    });
  }

  // เลขคดี ศาลจังหวัดอุดรธานี: กรอกได้เฉพาะตัวเลขเท่านั้น
  if (elements.udonCaseNoInput) {
    elements.udonCaseNoInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  }

  // เลขคดี หมายศาลอื่น: กรอกได้เฉพาะตัวเลขเท่านั้น
  if (elements.otherCaseNoInput) {
    elements.otherCaseNoInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  }

  // หมู่: กรอกได้เฉพาะตัวเลขเท่านั้น (ไม่บังคับกรอก)
  if (elements.mooInput) {
    elements.mooInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
    });
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
    fetchCurrentLocation(false);
    startLocationInterval();
  }
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

      if (!state.isManuallyEditedCoords || isManual) {
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
      reader.onload = (ev) => {
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
      };
      reader.readAsDataURL(file);
    });
  }

  if (elements.btnConfirmDesktopUpload) {
    elements.btnConfirmDesktopUpload.addEventListener('click', handleDesktopUpload);
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
    width: '80%',
    customClass: {
      popup: 'p-4 rounded-2xl'
    }
  });
};

async function handleDesktopUpload() {
  if (!validateForm()) return;

  if (!state.selectedDesktopImageDataUrl) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกไฟล์รูปภาพ',
      text: 'โปรดเลือกไฟล์รูปภาพจากเครื่องคอมพิวเตอร์ก่อนกดอัปโหลด',
      confirmButtonColor: '#2563eb'
    });
    if (elements.desktopImageFileInput) elements.desktopImageFileInput.focus();
    return;
  }

  showCustomLoading('กำลังประมวลผลลายน้ำและรูปภาพ...', 'กำลังสร้างภาพถ่ายพร้อมข้อมูลส่งหมาย');

  try {
    const img = new Image();
    img.src = state.selectedDesktopImageDataUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const caseNumber = getFormattedCaseNumber();
    const courtType = elements.courtTypeSelect.value;
    const district = elements.districtSelect.value;
    const subdistrict = elements.subdistrictSelect.value;
    const locationType = elements.locationTypeSelect.value;
    const locationText = getFullLocationText();
    const heading = window.compassManager ? window.compassManager.getHeading() : 0;

    const payloadData = {
      caseNumber: caseNumber,
      courtType: courtType,
      district: district,
      subdistrict: subdistrict,
      locationType: locationType,
      locationText: locationText,
      lat: state.lat,
      lng: state.lng,
      heading: heading,
      dateTime: WatermarkEngine.formatThaiDateTime(new Date())
    };

    // วาดลายน้ำลงบนรูปภาพ
    const watermarkedResult = await WatermarkEngine.renderWatermark(img, payloadData);
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';

    hideCustomLoading();

    // บีบอัดรูปภาพให้ไม่เกิน 1MB (ไม่ต้องดาวน์โหลดไฟล์ลงเครื่องเพราะเป็นการอัปโหลดไฟล์จากเครื่อง)
    const compressedImageBase64 = await compressImageToMax1MB(watermarkedResult.dataUrl);

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
  const caseNumber = getFormattedCaseNumber();

  // ตรวจสอบชื่อศาลกรณีเลือกศาลที่ไม่สังกัดภาค
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

  const isOther = courtType === 'ศาลอื่น' || courtType === 'หมายศาลอื่น';
  if (!isOther) {
    const prefix = (elements.udonPrefixInput ? elements.udonPrefixInput.value : '').trim();
    const caseNo = (elements.udonCaseNoInput ? elements.udonCaseNoInput.value : '').trim();

    if (!prefix) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณาระบุอักษรนำหน้าเลขคดี',
        text: 'โปรดเลือกหรือพิมพ์อักษรนำหน้า เช่น ผบE, อ, ย, พ',
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

  if (elements.locationTypeSelect.value === 'หมายบ้าน') {
    const houseNo = elements.houseNoInput.value.trim();
    if (!houseNo) {
      Swal.fire({
        icon: 'warning',
        title: 'กรุณากรอกบ้านเลขที่',
        text: 'สำหรับหมายบ้าน บังคับต้องระบุบ้านเลขที่ เช่น 154/2',
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

  // ตรวจสอบและดึงพิกัดจากช่องกรอกพิกัด (หากผู้ใช้พิมพ์หรือแก้ไขเอง)
  const coordsRaw = (elements.coordinatesInput ? elements.coordinatesInput.value : '').trim();
  if (coordsRaw) {
    const parts = coordsRaw.split(/[,;\s]+/).map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
    if (parts.length >= 2) {
      state.lat = parts[0];
      state.lng = parts[1];
    }
  }

  if (!state.lat || !state.lng) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้รับพิกัด GPS',
      text: 'ระบบกำลังค้นหาพิกัด กรุณารอสักครู่ พิมพ์ระบุพิกัด หรือกด "เช็คพิกัดใหม่"',
      confirmButtonColor: '#2563eb'
    });
    if (elements.coordinatesInput) elements.coordinatesInput.focus();
    return false;
  }

  return true;
}

async function openCameraModal() {
  // เปิดโหมดพื้นฐานเป็นแนวนอน 4:3
  setCaptureOrientation('landscape');

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

async function captureAndProcessPhoto() {
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
