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
  captureOrientation: 'portrait', // 'portrait' (3:4) หรือ 'landscape' (4:3)
  hudIntervalId: null,
  appsScriptUrl: localStorage.getItem('slts_apps_script_url') || 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec',
  googleSheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1fGlWXNMBNfieDdm_jp7eAfK4RgEB2lYRsichFrloQRo/gviz/tq?tqx=out:csv',
  isUploading: false,
  currentUser: null,
  dataTableInstance: null
};

// Cache Constants
const CACHE_KEY_SHEET_DATA = 'slts_sheet_data_cache';
const CACHE_KEY_SHEET_TIME = 'slts_sheet_data_last_fetch';
const CACHE_TTL_MS = 60 * 1000; // 1 นาที (60,000 มิลลิวินาที)

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
  initDistrictsDropdown();
  initOtherCaseYearDropdown();
  initFormEventListeners();
  initLocationService();
  initCameraEvents();
  initSettings();
  initResponsiveUI();
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

  // รหัสผ่านตั้งต้นสำหรับการรีเซ็ต (Default Reset Password)
  if (!localStorage.getItem('slts_default_reset_pass')) {
    localStorage.setItem('slts_default_reset_pass', 'caogikojt02');
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
    elements.currentDefaultResetPassText.textContent = localStorage.getItem('slts_default_reset_pass') || 'caogikojt02';
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

  closeChangePasswordModal();

  Swal.fire({
    icon: 'success',
    title: 'เปลี่ยนรหัสผ่านสำเร็จ',
    text: 'รหัสผ่านของคุณได้รับการเปลี่ยนเรียบร้อยแล้ว',
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
  
  users.push({
    username: username,
    password: password,
    role: role,
    name: fullName || (role === 'admin' ? `Admin (${username})` : `เจ้าหน้าที่ (${username})`),
    createdAt: dateNow
  });

  localStorage.setItem('slts_users', JSON.stringify(users));
  document.getElementById('addUserForm').reset();
  renderUserList();

  Swal.fire({
    icon: 'success',
    title: 'เพิ่มผู้ใช้งานสำเร็จ',
    text: `สร้างผู้ใช้ "${username}" สิทธิ์ [${role.toUpperCase()}] เรียบร้อยแล้ว`,
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
      <td class="py-3 px-4 text-xs text-gray-500 font-mono">${u.createdAt || '-'}</td>
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
      Swal.fire('สำเร็จ', `อัปเดตข้อมูลผู้ใช้ @${username} เรียบร้อยแล้ว`, 'success');
    }
  });
};

// Reset User Password Modal (Admin)
window.resetUserPasswordModal = function(username) {
  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const user = users.find(u => u.username === username);
  if (!user) return;

  const defaultPass = localStorage.getItem('slts_default_reset_pass') || 'caogikojt02';

  Swal.fire({
    title: `รีเซ็ตรหัสผ่าน (@${username})`,
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

      Swal.fire({
        icon: 'success',
        title: 'รีเซ็ตรหัสผ่านสำเร็จ',
        html: `รีเซ็ตรหัสผ่านของ <b>@${username}</b> เป็น: <br><span class="font-mono text-base font-bold text-blue-600 mt-1 inline-block bg-blue-50 px-3 py-1 rounded-lg border border-blue-200">${res.value}</span>`,
        confirmButtonColor: '#2563eb'
      });
    }
  });
};

// Set Default Reset Password Config Modal (Admin)
window.openDefaultPasswordConfigModal = function() {
  const currentDefault = localStorage.getItem('slts_default_reset_pass') || 'caogikojt02';

  Swal.fire({
    title: 'ตั้งค่ารหัสผ่านตั้งต้นของระบบ',
    text: 'รหัสผ่านนี้จะถูกใช้เป็นค่าเริ่มต้นเมื่อ Admin กดยืนยันรีเซ็ตรหัสผ่านให้แก่ผู้ใช้งาน',
    input: 'text',
    inputValue: currentDefault,
    inputPlaceholder: 'เช่น caogikojt02 หรือ 123456',
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

  Swal.fire({
    title: `ยืนยันการลบผู้ใช้ "${username}"?`,
    text: 'เมื่อลบแล้วจะไม่สามารถกู้คืนบัญชีนี้ได้',
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
      Swal.fire('ลบสำเร็จ', `ลบผู้ใช้ "${username}" เรียบร้อยแล้ว`, 'success');
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
    elements.tabBtnForm.classList.add('active');
    elements.tabContentForm.classList.remove('hidden');
    elements.tabContentForm.classList.add('active');
  } else if (tabName === 'table') {
    elements.tabBtnTable.classList.add('active');
    elements.tabContentTable.classList.remove('hidden');
    elements.tabContentTable.classList.add('active');
    // โหลดข้อมูลแบบ Smart Cache 1 นาที
    loadGoogleSheetData(false);
  } else if (tabName === 'users') {
    elements.tabBtnUsers.classList.add('active');
    elements.tabContentUsers.classList.remove('hidden');
    elements.tabContentUsers.classList.add('active');
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

function renderDataTable(rows) {
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';

  // 1. ทำลายและล้าง DataTable เดิมอย่างหมดจดเพื่อป้องกันรายการซ้ำ
  if ($.fn.DataTable.isDataTable('#summonsDataTable')) {
    $('#summonsDataTable').DataTable().clear().destroy();
  }

  const tableBody = document.getElementById('dataTableBody');
  tableBody.innerHTML = '';

  rows.forEach((row, index) => {
    const timestamp = row['วัน-เวลาบันทึก'] || row['Timestamp'] || '';
    const caseNumber = row['เลขคดี'] || '';
    const courtType = row['ประเภทศาล'] || 'ศาลจังหวัดอุดรธานี';
    const district = row['อำเภอ'] || '';
    const subdistrict = row['ตำบล'] || '';
    const locationFull = row['ที่ตั้งส่งหมาย (เต็ม)'] || row['ที่ตั้งส่งหมาย'] || '';
    const lat = row['ละติจูด (Lat)'] || row['ละติจูด'] || '';
    const lng = row['ลองจิจูด (Lng)'] || row['ลองจิจูด'] || '';
    const fileName = row['ชื่อไฟล์รูปภาพ'] || '';
    const imgUrl = row['ลิงก์รูปภาพใน Google Drive'] || row['ลิงก์รูปภาพ'] || '';
    const txtUrl = row['ลิงก์ Text File ใน Google Drive'] || '';
    const fileId = row['Drive File ID'] || '';

    if (!caseNumber && !timestamp) return;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50/40 transition';

    // คอลัมน์ดูภาพ
    let imgBtn = '-';
    if (imgUrl) {
      imgBtn = `
        <button type="button" onclick="viewPhotoModal('${imgUrl}', '${caseNumber}', '${locationFull}', '${timestamp}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1">
          <i class="fa-solid fa-image"></i>
          <span>ดูภาพ</span>
        </button>
      `;
    }

    // คอลัมน์ Text File
    let txtBtn = '-';
    if (txtUrl) {
      txtBtn = `
        <a href="${txtUrl}" target="_blank" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold border border-gray-300 transition inline-flex items-center gap-1">
          <i class="fa-solid fa-file-lines text-blue-600"></i>
          <span>.TXT</span>
        </a>
      `;
    }

    // คอลัมน์จัดการ (Admin เท่านั้น)
    let actionBtn = `<span class="text-xs text-gray-400 italic">User Only</span>`;
    if (isAdmin) {
      actionBtn = `
        <button type="button" onclick="deleteRecord('${fileId}', '${fileName}', '${timestamp}', '${caseNumber}', ${index + 2})" class="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1" title="ลบข้อมูลในชีตและไฟล์ใน Drive">
          <i class="fa-solid fa-trash-can"></i>
          <span>ลบ</span>
        </button>
      `;
    }

    tr.innerHTML = `
      <td class="font-mono text-xs text-gray-600 whitespace-nowrap">${timestamp}</td>
      <td class="font-bold text-gray-900 whitespace-nowrap">${caseNumber}</td>
      <td class="text-xs text-gray-700">${courtType}</td>
      <td class="text-xs text-gray-700">${district}</td>
      <td class="text-xs text-gray-700">${subdistrict}</td>
      <td class="text-xs text-gray-700 max-w-[200px] truncate" title="${locationFull}">${locationFull}</td>
      <td class="font-mono text-xs text-blue-700 whitespace-nowrap">${lat && lng ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : '-'}</td>
      <td class="whitespace-nowrap">${imgBtn}</td>
      <td class="whitespace-nowrap">${txtBtn}</td>
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
      infoEmpty: "ไม่มีข้อมูล",
      infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
      paginate: {
        first: "แรกสุด",
        last: "ท้ายสุด",
        next: "ถัดไป",
        previous: "ก่อนหน้า"
      },
      zeroRecords: "ไม่พบข้อมูลที่ตรงกับการค้นหา"
    }
  });
}

/**
 * แสดงภาพถ่ายเต็มด้วย SweetAlert พร้อมปุ่มดาวน์โหลด
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
      <div class="relative bg-gray-900 rounded-xl overflow-hidden shadow-inner flex items-center justify-center min-h-[250px] max-h-[60vh]">
        <img src="${directImgUrl}" alt="${caseNumber}" class="max-w-full max-h-[58vh] object-contain rounded-lg shadow-md" onerror="this.onerror=null; this.src='${imgUrl}';">
      </div>
    `,
    width: '650px',
    showCloseButton: true,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-arrow-up-right-from-square mr-1"></i> เปิดภาพขนาดเต็ม (Google Drive)',
    cancelButtonText: 'ปิด',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      window.open(imgUrl, '_blank');
    }
  });
};

/**
 * ลบข้อมูลใน Google Sheet และลบไฟล์ใน Google Drive (เฉพาะ Admin)
 */
window.deleteRecord = function(fileId, fileName, timestamp, caseNumber, rowIndex) {
  if (!state.currentUser || state.currentUser.role !== 'admin') {
    Swal.fire('ไม่มีสิทธิ์', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลได้', 'error');
    return;
  }

  Swal.fire({
    title: `ยืนยันการลบข้อมูลเลขคดี ${caseNumber}?`,
    html: `
      <div class="text-left text-sm text-gray-700 bg-red-50 border border-red-200 p-3 rounded-xl space-y-1">
        <p class="font-bold text-red-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i> การดำเนินการนี้จะทำการ:</p>
        <p>1. ลบแถวข้อมูลใน Google Sheet ถาวร</p>
        <p>2. ย้ายไฟล์ภาพและ Text File ใน Google Drive ไปยังถังขยะ</p>
      </div>
    `,
    icon: 'warning',
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
            timer: 2000,
            showConfirmButton: false
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
          confirmButtonColor: '#2563eb'
        });
      }
    }
  });
};

// =========================================================================
// 5. ฟอร์มและระบบบันทึกส่งหมาย (Summons Form & Camera)
// =========================================================================

function initDistrictsDropdown() {
  elements.districtSelect.innerHTML = '';
  DISTRICT_ORDER.forEach(district => {
    const opt = document.createElement('option');
    opt.value = district;
    opt.textContent = district;
    elements.districtSelect.appendChild(opt);
  });

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
      opt.selected = true;
    }
    elements.otherCaseYearSelect.appendChild(opt);
  }
}

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

function initFormEventListeners() {
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
      
      if (!elements.localAdminNameInput.value.trim()) {
        elements.localAdminNameInput.value = 'ที่ทำการปกครองส่วนท้องถิ่น';
      }
      elements.localAdminNameInput.focus();
    }
  });

  elements.btnRefreshLocation.addEventListener('click', () => {
    fetchCurrentLocation(true);
  });
}

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

  if (elements.btnToggleOrientation) {
    elements.btnToggleOrientation.addEventListener('click', toggleOrientation);
  }
  if (elements.btnFlipOrientationQuick) {
    elements.btnFlipOrientationQuick.addEventListener('click', toggleOrientation);
  }

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

    const result = await WatermarkEngine.renderWatermark(elements.videoPreview, payloadData, state.captureOrientation);
    
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';
    const textFilename = baseFilename + '.txt';
    
    closeCameraModal();
    hideCustomLoading();

    showPreviewAndProcess(result, imageFilename, textFilename, payloadData);

  } catch (error) {
    console.error('Capture error:', error);
    hideCustomLoading();
    Swal.fire('ข้อผิดพลาด', 'ไม่สามารถสร้างภาพถ่ายลายน้ำได้: ' + error.message, 'error');
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

let currentPreviewResult = null;
let currentPreviewData = null;
let currentPreviewImageFilename = '';
let currentPreviewTextFilename = '';

function showPreviewAndProcess(result, imageFilename, textFilename, data) {
  currentPreviewResult = result;
  currentPreviewImageFilename = imageFilename;
  currentPreviewTextFilename = textFilename;
  currentPreviewData = data;

  WatermarkEngine.triggerDownload(result.dataUrl, imageFilename);
  if (result.textContent) {
    WatermarkEngine.triggerTextDownload(result.textContent, textFilename);
  }

  elements.previewImage.src = result.dataUrl;
  elements.previewFilename.textContent = `${imageFilename} + ${textFilename}`;
  elements.previewModal.classList.remove('hidden');
  elements.previewModal.classList.add('flex');

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

  showCustomLoading('กำลังบันทึกข้อมูล...', 'กำลังอัปโหลดรูปภาพและบันทึกลง Google Drive & Sheet');

  try {
    const payload = {
      ...currentPreviewData,
      fileName: currentPreviewImageFilename,
      imageBase64: currentPreviewResult.dataUrl,
      textContent: currentPreviewResult.textContent || WatermarkEngine.generateTextFileContent(currentPreviewData)
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
        html: `<p class="text-gray-700">บันทึกรูปภาพและ Text File เลขคดี <b>${currentPreviewData.caseNumber}</b> ลงใน Google Drive & Sheet เรียบร้อยแล้ว</p>
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
