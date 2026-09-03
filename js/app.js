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
    updateBackgroundQueueUI();
    updateCameraTopBarUI();
    processBackgroundQueue();

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
    updateBackgroundQueueUI();
    updateCameraTopBarUI();
    // ตัดการแจ้งเตือน "เข้าสู่โหมดออฟไลน์" ออกไปตามข้อ 4 (ใช้จุดกระพริบสีแดงแทน)
  });

  updateOfflineBadgeUI();
  updateBackgroundQueueUI();
  updateCameraTopBarUI();
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
      loadGoogleSheetData(true, true);
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

// =========================================================================
// BACKGROUND UPLOAD QUEUE SYSTEM (ระบบจัดเรียงคิวอัปโหลดภาพเบื้องหลัง Non-Blocking)
// =========================================================================
const BG_UPLOAD_QUEUE_KEY = 'slts_bg_upload_queue';
let isBgQueueWorkerRunning = false;
let bgQueueProgressInterval = null;
let bgQueueModalTimer = null;
window.currentActiveItemProgress = 0;
window.sessionCompletedTasks = [];

function getBackgroundQueue() {
  try {
    return JSON.parse(localStorage.getItem(BG_UPLOAD_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveBackgroundQueue(queue) {
  try {
    localStorage.setItem(BG_UPLOAD_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[BgQueue] Save error:', e);
  }
  updateBackgroundQueueUI();
}

function enqueueBackgroundUpload(taskData) {
  const queue = getBackgroundQueue();
  const item = {
    id: 'bg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    createdAt: new Date().toISOString(),
    status: 'pending', // 'pending' | 'uploading' | 'failed'
    retryCount: 0,
    ...taskData
  };
  queue.push(item);
  saveBackgroundQueue(queue);
  return item;
}

function removeBackgroundQueueItem(id) {
  let queue = getBackgroundQueue();
  const removed = queue.find(q => q.id === id);
  if (removed) {
    window.sessionCompletedTasks.unshift({
      ...removed,
      completedAt: new Date().toLocaleTimeString('th-TH')
    });
    if (window.sessionCompletedTasks.length > 8) {
      window.sessionCompletedTasks.pop();
    }
  }
  queue = queue.filter(q => q.id !== id);
  saveBackgroundQueue(queue);

  // หากหน้าต่าง Modal คิวเปิดอยู่ ให้รีเรนเดอร์เนื้อหาทันที
  if (Swal.isVisible() && document.getElementById('bgQueueModalListContainer')) {
    renderBackgroundQueueModalContent();
  }
}

function clearBackgroundQueue() {
  saveBackgroundQueue([]);
  if (Swal.isVisible() && document.getElementById('bgQueueModalListContainer')) {
    renderBackgroundQueueModalContent();
  }
}

window.cancelCurrentBackgroundQueue = async function() {
  const queue = getBackgroundQueue();
  if (queue.length === 0) return;
  const res = await Swal.fire({
    icon: 'warning',
    title: 'ต้องการล้างคิวอัปโหลดเบื้องหลัง?',
    text: `มีรายการค้างในคิว ${queue.length} รายการ คุณต้องการยกเลิกการส่งข้อมูลทั้งหมดในคิวใช่หรือไม่?`,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> ใช่, ล้างคิวทั้งหมด',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#6b7280'
  });
  if (res.isConfirmed) {
    clearBackgroundQueue();
    updateBackgroundQueueUI();
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'info',
      title: 'ล้างคิวเรียบร้อยแล้ว',
      timer: 2000,
      showConfirmButton: false
    });
  }
};

function updateBackgroundQueueUI() {
  const queue = getBackgroundQueue();
  const widget = document.getElementById('floatingBgQueueWidget');
  const headerBtn = document.getElementById('btnBgUploadQueueHeader');
  const headerBadge = document.getElementById('bgUploadQueueHeaderBadge');
  const floatCount = document.getElementById('floatingBgQueueCount');

  const total = queue.length;

  // 1. Header Badge
  if (headerBtn && headerBadge) {
    if (total > 0) {
      headerBtn.classList.remove('hidden');
      headerBtn.classList.add('inline-flex');
      headerBadge.textContent = `คิวส่ง (${total})`;
    } else {
      headerBtn.classList.add('hidden');
      headerBtn.classList.remove('inline-flex');
    }
  }

  // 2. Floating Widget
  if (!widget) return;

  if (total === 0) {
    widget.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => {
      if (getBackgroundQueue().length === 0) {
        widget.classList.add('hidden');
        widget.classList.remove('opacity-0', 'pointer-events-none');
      }
    }, 400);
    return;
  }

  widget.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
  if (floatCount) {
    floatCount.textContent = total;
  }
  updateCameraTopBarUI();
}

/**
 * อัปเดตแถบควบคุมด้านบนของหน้ากล้องมือถือ (< 768px):
 * 4.1 สถานะออนไลน์/ออฟไลน์ (จุดกระพริบเขียว/แดง)
 * 5. ปุ่มนับจำนวนทำงานเบื้องหลัง (สีเขียวเมื่อออนไลน์ / สีส้มเมื่อออฟไลน์)
 * 4.5 ไอคอนสถานะการล็อกอิน
 */
window.updateCameraTopBarUI = function() {
  const isOnline = navigator.onLine;
  const bgQueue = getBackgroundQueue();
  const offlineQueue = getOfflineQueue();

  // 1. จุดกระพริบสถานะออนไลน์/ออฟไลน์ (4.1)
  const dotPing = document.getElementById('cameraStatusDotPing');
  const dot = document.getElementById('cameraStatusDot');
  const ind = document.getElementById('cameraNetworkStatusIndicator');

  if (dotPing && dot) {
    if (isOnline) {
      dotPing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80';
      dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-sm shadow-emerald-400';
      if (ind) ind.title = 'สถานะการเชื่อมต่อ: ออนไลน์ (พร้อมนำส่งข้อมูลขึ้นคลาวด์)';
    } else {
      dotPing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-80';
      dot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-sm shadow-rose-400';
      if (ind) ind.title = 'สถานะการเชื่อมต่อ: ออฟไลน์ (บันทึกลงเครื่องและรอซิงค์เมื่อออนไลน์)';
    }
  }

  // 2. ปุ่มนับจำนวนทำงานเบื้องหลัง (ข้อ 5)
  const bgBtn = document.getElementById('btnCameraBgQueue');
  const bgIcon = document.getElementById('iconCameraBgQueue');
  const bgTxt = document.getElementById('txtCameraBgQueueCount');

  if (bgBtn && bgTxt) {
    if (!isOnline) {
      // โหมดออฟไลน์: ปุ่มสีส้ม แสดงจำนวนที่รอซิงค์
      bgBtn.className = 'px-2.5 py-1.5 bg-amber-600/95 hover:bg-amber-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-amber-400/50 shadow-md whitespace-nowrap cursor-pointer';
      bgBtn.title = `โหมดออฟไลน์: มี ${offlineQueue.length} รายการรออัปโหลดเมื่อกลับมาออนไลน์`;
      if (bgIcon) {
        bgIcon.className = offlineQueue.length > 0 ? 'fa-solid fa-cloud text-xs animate-pulse' : 'fa-solid fa-cloud text-xs';
      }
      bgTxt.textContent = offlineQueue.length;
    } else {
      // โหมดออนไลน์: ปุ่มสีเขียว แสดงจำนวนงานที่กำลังทำในเบื้องหลัง
      bgBtn.className = 'px-2.5 py-1.5 bg-emerald-600/95 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-emerald-400/50 shadow-md whitespace-nowrap cursor-pointer';
      bgBtn.title = `โหมดออนไลน์: กำลังทำงานเบื้องหลัง ${bgQueue.length} รายการ`;
      if (bgIcon) {
        bgIcon.className = bgQueue.length > 0 ? 'fa-solid fa-cloud-arrow-up text-xs animate-pulse' : 'fa-solid fa-cloud-arrow-up text-xs';
      }
      bgTxt.textContent = bgQueue.length;
    }
  }

  // 3. ไอคอนปุ่ม Auth (4.5)
  const authIcon = document.getElementById('iconCameraAuth');
  const isLoggedIn = !!state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (authIcon) {
    authIcon.className = isLoggedIn ? 'fa-solid fa-right-from-bracket text-xs sm:text-sm' : 'fa-solid fa-right-to-bracket text-xs sm:text-sm text-amber-300';
  }
};

/**
 * เปิด Pop Up แสดงรายการคิวอัปโหลดภาพเบื้องหลังทั้งหมด พร้อม Progress Bar แต่ละรายการ
 */
window.openBackgroundQueueModal = function() {
  Swal.fire({
    title: `
      <div class="flex items-center justify-between text-base font-bold text-gray-900 pb-2.5 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold shadow-2xs">
            <i class="fa-solid fa-list-check"></i>
          </div>
          <div class="text-left">
            <span class="block leading-tight">คิวอัปโหลดภาพส่งหมายเบื้องหลัง</span>
            <span class="text-[10px] text-gray-400 font-normal">ทำงานอัตโนมัติ กรอกหมายอื่นต่อได้ทันที</span>
          </div>
        </div>
        <span id="modalQueueSummaryBadge" class="text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">
          -
        </span>
      </div>
    `,
    html: `
      <div id="bgQueueModalListContainer" class="space-y-2.5 max-h-[58vh] overflow-y-auto slts-swal-body-scroll pr-1 my-1">
        <!-- Injected dynamically -->
      </div>
      <div id="bgQueueModalFooterControls" class="flex items-center justify-between pt-3 border-t border-gray-100 text-xs">
        <span class="text-[11px] text-gray-500">
          <i class="fa-solid fa-shield-halved text-blue-500 mr-1"></i>บันทึกคิวในเครื่อง ปิดหน้าต่างนี้ได้ตลอดเวลา
        </span>
        <button type="button" onclick="cancelCurrentBackgroundQueue()" class="text-xs text-red-600 hover:text-red-700 font-semibold px-2 py-1 rounded-lg hover:bg-red-50 transition cursor-pointer">
          <i class="fa-solid fa-trash-can mr-1"></i>ล้างคิวที่รอ
        </button>
      </div>
    `,
    width: window.innerWidth < 640 ? '94%' : '580px',
    showConfirmButton: true,
    confirmButtonText: '<i class="fa-solid fa-xmark mr-1"></i> ปิดหน้าต่าง',
    confirmButtonColor: '#2563eb',
    showCloseButton: true,
    allowOutsideClick: true,
    customClass: {
      popup: 'rounded-3xl p-4 sm:p-5 max-w-full'
    },
    didOpen: () => {
      renderBackgroundQueueModalContent();

      // Start real-time updater while modal is open
      clearInterval(bgQueueModalTimer);
      bgQueueModalTimer = setInterval(() => {
        if (!Swal.isVisible()) {
          clearInterval(bgQueueModalTimer);
          return;
        }
        const bar = document.getElementById('modalActiveProgressBar');
        const txt = document.getElementById('modalActivePercent');
        if (bar && txt && typeof window.currentActiveItemProgress === 'number') {
          bar.style.width = window.currentActiveItemProgress + '%';
          txt.textContent = window.currentActiveItemProgress + '%';
        }
      }, 250);
    },
    willClose: () => {
      clearInterval(bgQueueModalTimer);
    }
  });
};

function renderBackgroundQueueModalContent() {
  const container = document.getElementById('bgQueueModalListContainer');
  const summaryBadge = document.getElementById('modalQueueSummaryBadge');
  const footerControls = document.getElementById('bgQueueModalFooterControls');
  if (!container) return;

  const queue = getBackgroundQueue();
  const completed = window.sessionCompletedTasks || [];
  const total = queue.length;

  if (summaryBadge) {
    if (total > 0) {
      summaryBadge.className = 'text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-blue-100 text-blue-800';
      summaryBadge.textContent = `เหลือ ${total} รายการ`;
    } else {
      summaryBadge.className = 'text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800';
      summaryBadge.textContent = 'เสร็จสิ้นทั้งหมด';
    }
  }

  if (footerControls) {
    footerControls.style.display = total > 0 ? 'flex' : 'none';
  }

  if (total === 0 && completed.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center text-gray-400 select-none">
        <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center text-2xl shadow-inner">
          <i class="fa-solid fa-circle-check"></i>
        </div>
        <p class="text-sm font-bold text-gray-700">ไม่มีรายการค้างในคิวเบื้องหลัง</p>
        <p class="text-xs text-gray-400 mt-1">ทุกรายการได้รับการบันทึกขึ้น Google Drive & Sheet เรียบร้อยแล้ว</p>
      </div>
    `;
    return;
  }

  let html = '';

  // 1. รายการที่กำลังทำงานอยู่ (Active Item)
  if (total > 0) {
    const activeItem = queue[0];
    const activePercent = window.currentActiveItemProgress || 20;
    html += `
      <div class="p-3.5 rounded-2xl border-2 border-blue-400 bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-blue-50/90 shadow-sm space-y-2 text-left transition-all">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">1</span>
            <span class="font-bold text-sm text-blue-900 font-mono"><i class="fa-solid fa-gavel mr-1 text-blue-600"></i>${activeItem.caseNumber}</span>
            <span class="text-[10px] text-gray-500">${activeItem.courtType || ''}</span>
          </div>
          <span class="text-[11px] font-bold text-blue-700 bg-white px-2.5 py-0.5 rounded-full border border-blue-200 shadow-2xs flex items-center gap-1.5 animate-pulse">
            <i class="fa-solid fa-spinner fa-spin text-blue-600 text-[10px]"></i>
            <span>กำลังส่ง (<b id="modalActivePercent">${activePercent}%</b>)</span>
          </span>
        </div>

        <p class="text-xs text-gray-700 pl-8 truncate"><i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${activeItem.locationText || '-'}</p>

        <!-- แถบ Progress Bar ของรายการที่กำลังทำงาน -->
        <div class="pl-8 pt-1 space-y-1">
          <div class="w-full bg-white/90 rounded-full h-2.5 overflow-hidden border border-blue-200 p-0.5 shadow-inner">
            <div id="modalActiveProgressBar" class="bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-700 h-full rounded-full transition-all duration-300" style="width: ${activePercent}%"></div>
          </div>
          <div class="flex items-center justify-between text-[10px] text-gray-500">
            <span><i class="fa-solid fa-cloud-arrow-up text-blue-500 mr-1"></i>กำลังบันทึก Google Drive & Sheet...</span>
            <span class="text-[10px] font-mono text-gray-400">${activeItem.createdAt ? new Date(activeItem.createdAt).toLocaleTimeString('th-TH') : ''}</span>
          </div>
        </div>
      </div>
    `;

    // 2. รายการที่รอในคิวถัดไป (Pending Items)
    for (let i = 1; i < total; i++) {
      const item = queue[i];
      html += `
        <div class="p-3 rounded-2xl border border-gray-200 bg-gray-50/80 hover:bg-gray-50 transition space-y-1.5 text-left">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center">${i + 1}</span>
              <span class="font-bold text-sm text-gray-800 font-mono">${item.caseNumber}</span>
              <span class="text-[10px] text-gray-500">${item.courtType || ''}</span>
            </div>
            <span class="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
              <i class="fa-solid fa-clock text-amber-600"></i>
              <span>รอในคิวลำดับที่ ${i + 1}</span>
            </span>
          </div>
          <p class="text-xs text-gray-600 pl-8 truncate"><i class="fa-solid fa-location-dot text-gray-400 mr-1"></i>${item.locationText || '-'}</p>
          <div class="pl-8 pt-0.5">
            <div class="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div class="bg-gray-300 h-full rounded-full" style="width: 0%"></div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // 3. รายการที่ส่งสำเร็จแล้วในรอบนี้
  if (completed.length > 0) {
    html += `
      <div class="pt-2 pb-0.5 border-t border-gray-200 text-left">
        <span class="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
          <i class="fa-solid fa-clock-rotate-left text-gray-400"></i> รายการที่ส่งสำเร็จในรอบนี้ (${completed.length})
        </span>
      </div>
    `;
    completed.slice(0, 5).forEach((item, idx) => {
      html += `
        <div class="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 text-left flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
              <i class="fa-solid fa-check"></i>
            </span>
            <span class="font-bold text-xs text-emerald-900 font-mono truncate">${item.caseNumber}</span>
            <span class="text-[10px] text-gray-500 truncate hidden sm:inline">${item.locationText || ''}</span>
          </div>
          <span class="text-[10px] font-bold text-emerald-700 bg-white px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
            สำเร็จ 100%
          </span>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

async function processBackgroundQueue() {
  if (isBgQueueWorkerRunning) return;

  const queue = getBackgroundQueue();
  if (queue.length === 0) {
    isBgQueueWorkerRunning = false;
    window.currentActiveItemProgress = 0;
    updateBackgroundQueueUI();
    return;
  }

  if (!navigator.onLine) {
    console.log('[BgQueue] Device offline. Pausing queue worker.');
    return;
  }

  isBgQueueWorkerRunning = true;
  updateBackgroundQueueUI();

  const currentItem = queue[0];
  currentItem.status = 'uploading';

  // Progress ticker
  let percent = 20;
  window.currentActiveItemProgress = percent;

  clearInterval(bgQueueProgressInterval);
  bgQueueProgressInterval = setInterval(() => {
    if (percent < 88) {
      percent += Math.floor(Math.random() * 8) + 4;
      if (percent > 88) percent = 88;
      window.currentActiveItemProgress = percent;
    }
  }, 300);

  const targetUrl = getSanitizedAppsScriptUrl();

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(currentItem.payload),
      redirect: 'follow'
    });

    clearInterval(bgQueueProgressInterval);
    window.currentActiveItemProgress = 100;

    const rawText = await response.text();
    let resJson;
    try {
      resJson = JSON.parse(rawText);
    } catch (parseErr) {
      console.warn('[BgQueue] Non-JSON response:', rawText);
      throw new Error('การตอบกลับจาก Google Apps Script ไม่ถูกต้อง');
    }

    if (resJson && resJson.status === 'error') {
      throw new Error(resJson.message || 'เกิดข้อผิดพลาดจาก Google Apps Script');
    }

    // สำเร็จ! นำออกจากคิว
    removeBackgroundQueueItem(currentItem.id);

    // บนหน้าจอความกว้างมากกว่า 768 pixel (Desktop) ไม่ต้องแสดงหน้าต่างแจ้งเตือนเมื่ออัปโหลดเสร็จ ให้ตัดออกไปเลย
    const isDesktop = window.innerWidth > 768;
    if (!isDesktop) {
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `อัปโหลดหมาย ${currentItem.caseNumber} สำเร็จ!`,
        timer: 2000,
        showConfirmButton: false
      });
    }

    // Invalidate sheet cache
    localStorage.removeItem(CACHE_KEY_SHEET_DATA);
    localStorage.removeItem(CACHE_KEY_SHEET_TIME);

  } catch (err) {
    clearInterval(bgQueueProgressInterval);
    console.error('[BgQueue] Upload error for item:', currentItem.caseNumber, err);

    currentItem.retryCount = (currentItem.retryCount || 0) + 1;
    if (currentItem.retryCount >= 3) {
      // ย้ายเข้า Offline queue เพื่อไม่ให้ค้างขวางคิวอื่น
      addToOfflineQueue({
        payload: currentItem.payload,
        fileName: currentItem.fileName,
        caseNumber: currentItem.caseNumber
      });
      removeBackgroundQueueItem(currentItem.id);

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'warning',
        title: `การส่งภาพล่าช้า (${currentItem.caseNumber})`,
        text: 'ระบบได้ย้ายข้อมูลเข้าสู่คิวออฟไลน์ไว้ให้แล้ว ท่านสามารถกดซิงค์ใหม่ได้ที่ปุ่มบนหัวเว็บ',
        timer: 5000,
        showConfirmButton: false
      });
    } else {
      const q = getBackgroundQueue();
      if (q.length > 0) {
        q[0].retryCount = currentItem.retryCount;
        saveBackgroundQueue(q);
      }
      await new Promise(res => setTimeout(res, 3000));
    }
  } finally {
    isBgQueueWorkerRunning = false;
    window.currentActiveItemProgress = 0;
    const remainingQueue = getBackgroundQueue();
    if (remainingQueue.length > 0) {
      processBackgroundQueue();
    } else {
      updateBackgroundQueueUI();
      loadGoogleSheetData(true, true);
    }
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
  initMobileHandoffReceiver();
  renderDesktopFormHistoryCard();
  updateBackgroundQueueUI();
  processBackgroundQueue();

  // ตรวจสอบการเปิดผ่าน LINE: หากเป็น LINE In-App Browser ให้สลับไปเปิดในเบราว์เซอร์ภายนอก (Chrome/Safari) ทันที
  if (/Line/i.test(navigator.userAgent) && !window.location.search.includes('openExternalBrowser=1')) {
    const currentUrl = window.location.href.split('#')[0];
    const lineUrl = currentUrl.includes('?') ? currentUrl + '&openExternalBrowser=1' : currentUrl + '?openExternalBrowser=1';
    window.location.href = lineUrl;
    return;
  }

  // ตรวจสอบและแสดงคำอธิบายคู่มือการใช้งานระบบสำหรับผู้ใช้ใหม่ (เฉพาะ Desktop >= 768px)
  if (window.innerWidth >= 768 && localStorage.getItem('slts_onboarding_completed') !== 'true') {
    setTimeout(() => {
      showSystemOnboardingModal(false);
    }, 600);
  }

  // กำหนดขั้นตอนเริ่มต้นตามขนาดหน้าจอ (Mobile vs Desktop)
  const isLoggedIn = !!state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest' && !!state.currentUser.username;

  if (window.innerWidth < 768) {
    // จอมือถือ (< 768px): เมื่อเปิดเข้าใช้งานให้เข้าสู่โหมดกล้องทันทีเสมอ (ตามข้อ 1)
    openCameraModal().catch(e => console.warn('Camera open error:', e));

    // หากไม่ได้อยู่ในสถานะล็อกอินอยู่ ให้มี Pop Up บังคับให้ล็อกอินไว้ด้านบนเสมอ (ตามข้อ 1)
    if (!isLoggedIn) {
      setTimeout(() => {
        openLoginModal(true);
      }, 350);
    }
  } else {
    // จอคอมพิวเตอร์ (>= 768px): แสดงหน้าแบบฟอร์ม 2 คอลัมน์ตามเดิม
    switchTab('form');

    // ตรวจสอบการเข้าสู่ระบบ: หากยังไม่ได้ล็อกอิน ให้แสดง Pop Up ล็อกอินขึ้นมาบังทันที เพื่อป้องกันบุคคลภายนอกเข้าใช้งานระบบ
    if (!isLoggedIn) {
      setTimeout(() => {
        openLoginModal(true);
      }, 250);
    }

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

  const cachedUsers = JSON.parse(localStorage.getItem('slts_users') || '[]');
  if (cachedUsers.length > 0 && !forceRefresh) {
    renderUserList();
    fetchUsersFromGasApi(false);
    return;
  }

  if (forceRefresh) {
    showCustomLoading('กำลังดึงข้อมูลผู้ใช้งาน...', 'กำลังเชื่อมต่อ Google Apps Script API (Tab: users)');
  }

  const success = await fetchUsersFromGasApi(forceRefresh);
  if (!success && (!cachedUsers || cachedUsers.length === 0)) {
    renderUserList();
  }
};

async function fetchUsersFromGasApi(showNotification = false) {
  if (!state.appsScriptUrl) return false;
  try {
    const url = `${state.appsScriptUrl}?action=get_users&_t=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();

    if (showNotification) hideCustomLoading();

    if (data && data.status === 'success' && Array.isArray(data.users)) {
      let sheetUsers = data.users.filter(r => (r.username || '').trim() !== '');

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

      if (showNotification) {
        Swal.fire({
          icon: 'success',
          title: 'รีเฟรชสำเร็จ',
          text: `ดึงข้อมูลผู้ใช้งาน ${sheetUsers.length} รายการเรียบร้อยแล้ว`,
          timer: 1500,
          showConfirmButton: false
        });
      }
      return true;
    }
  } catch (err) {
    console.warn('fetchUsersFromGasApi error:', err);
    if (showNotification) hideCustomLoading();
  }
  return false;
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

  // ปรับการแสดงผลปุ่ม Auth ที่มุมขวาบนของหน้ากล้องมือถือ (< 768px)
  const cameraAuthBtn = document.getElementById('btnCameraAuth');
  if (cameraAuthBtn) {
    if (isLoggedIn) {
      cameraAuthBtn.className = 'w-8 h-8 sm:w-9 sm:h-9 bg-rose-600/95 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center justify-center transition border border-rose-400/50 shadow-md cursor-pointer';
      cameraAuthBtn.title = `ออกจากระบบ (${state.currentUser.displayName || state.currentUser.name || state.currentUser.username})`;
      cameraAuthBtn.innerHTML = `<i class="fa-solid fa-right-from-bracket text-xs sm:text-sm"></i>`;
    } else {
      cameraAuthBtn.className = 'w-8 h-8 sm:w-9 sm:h-9 bg-slate-700/95 hover:bg-slate-800 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center justify-center transition border border-slate-500/50 shadow-md cursor-pointer';
      cameraAuthBtn.title = 'เข้าสู่ระบบ';
      cameraAuthBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket text-xs sm:text-sm text-amber-300"></i>`;
    }
  }

  updateCameraTopBarUI();
  renderUserList();
}

/**
 * จัดการการคลิกปุ่ม Auth ที่มุมขวาบนของหน้ากล้องมือถือ (< 768px)
 */
window.handleMobileCameraAuthAction = function() {
  const isLoggedIn = !!state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (!isLoggedIn) {
    openLoginModal();
  } else {
    const displayName = state.currentUser.displayName || state.currentUser.name || state.currentUser.username || 'ผู้ใช้งาน';
    Swal.fire({
      title: 'ต้องการออกจากระบบ?',
      html: `
        <div class="text-center space-y-2 py-2">
          <div class="w-14 h-14 mx-auto rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold shadow-md">
            <i class="fa-solid fa-user"></i>
          </div>
          <p class="font-bold text-gray-900 text-sm">${displayName}</p>
          <p class="text-xs text-gray-500 font-mono">@${state.currentUser.username} (${state.currentUser.role.toUpperCase()})</p>
          <p class="text-[11px] text-gray-500 pt-1">เมื่อออกจากระบบแล้วจะกลับสู่โหมดกล้องปกติ</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-right-from-bracket mr-1"></i> ยืนยันออกจากระบบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#6b7280'
    }).then((res) => {
      if (res.isConfirmed) {
        performDirectLogout('mobile');
      }
    });
  }
};

/**
 * ดำเนินการออกจากระบบในขั้นตอนเดียว พร้อมสลับหน้าจอตามขนาดอุปกรณ์ (Mobile vs Desktop)
 * @param {'mobile'|'desktop'} sourceMode 
 */
window.performDirectLogout = function(sourceMode = (window.innerWidth < 768 ? 'mobile' : 'desktop')) {
  // บันทึกประวัติการออกจากระบบและขนาดหน้าจอเพื่อแยกการแสดงผล
  state.currentUser = null;
  localStorage.removeItem('slts_current_user');
  localStorage.setItem('slts_last_auth_action', 'logout');
  localStorage.setItem('slts_last_auth_device_mode', sourceMode);

  if (elements.userDropdownMenu) elements.userDropdownMenu.classList.add('hidden');
  updateAuthUI();

  // ปิด SweetAlert ทันที
  Swal.close();

  if (sourceMode === 'mobile' || window.innerWidth < 768) {
    // บนหน้าจอมือถือ (< 768px): หากมีการกดออกจากระบบแล้ว ให้แสดงหน้าต่างล็อกอินทันทีเพื่อป้องกันการใช้งานหน้าจอโดยไม่ล็อกอิน
    openLoginModal(true);
  } else {
    // บนหน้าจอ Desktop (>= 768px): สลับไปที่หน้าแบบฟอร์ม และเปิดหน้าต่างล็อกอินทันที
    switchTab('form');
    openLoginModal(true);
  }
};

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

window.openLoginModal = function(isForced = false) {
  if (!elements.loginModal) return;
  elements.loginModal.classList.remove('hidden');
  elements.loginModal.classList.add('flex');
  const closeBtn = elements.loginModal.querySelector('button[onclick="closeLoginModal()"]');
  if (closeBtn) {
    if (isForced) {
      closeBtn.classList.add('hidden');
    } else {
      closeBtn.classList.remove('hidden');
    }
  }
  const uInput = document.getElementById('loginUsername');
  if (uInput) uInput.focus();
};

window.closeLoginModal = function() {
  if (!elements.loginModal) return;
  elements.loginModal.classList.add('hidden');
  elements.loginModal.classList.remove('flex');

  if (window.innerWidth < 768) {
    const isLoggedIn = !!state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
    if (isLoggedIn && elements.cameraModal && elements.cameraModal.classList.contains('hidden')) {
      openCameraModal().catch(e => console.warn(e));
    }
  }
};

function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value.trim();

  const users = JSON.parse(localStorage.getItem('slts_users') || '[]');
  const matched = users.find(user => (user.username || '').toLowerCase() === u.toLowerCase() && user.password === p);

  if (matched) {
    const deviceMode = window.innerWidth < 768 ? 'mobile' : 'desktop';
    state.currentUser = {
      username: matched.username.toLowerCase(),
      name: matched.name || matched.username,
      role: matched.role
    };
    localStorage.setItem('slts_current_user', JSON.stringify(state.currentUser));
    localStorage.setItem('slts_last_auth_action', 'login');
    localStorage.setItem('slts_last_auth_device_mode', deviceMode);

    closeLoginModal();
    updateAuthUI();
    initMobileHandoffReceiver();

    if (deviceMode === 'mobile' || window.innerWidth < 768) {
      if (elements.cameraModal && elements.cameraModal.classList.contains('hidden')) {
        openCameraModal().catch(e => console.warn(e));
      }
    }

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
  const isMobile = window.innerWidth < 768;

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
      performDirectLogout(isMobile ? 'mobile' : 'desktop');
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

    // โหลดประวัติลำดับเส้นทางล่าสุดที่บันทึกไว้เสมอ (ป้องกันหน้าจอว่างเปล่า)
    if (!state.currentRouteStops || state.currentRouteStops.length === 0) {
      loadSavedRouteStopsHistory();
    }

    if (state.currentRouteStops && state.currentRouteStops.length > 0) {
      setTimeout(() => {
        initLeafletMapInstance();
        const badgeEl = document.getElementById('mapAreaCurrentBadge');
        if (badgeEl) badgeEl.textContent = `📋 ตารางส่งหมาย (${state.currentRouteStops.length} รายการ)`;
        recalculateRouteFromStops(true);
        if (state.interactiveLeafletMap) {
          state.interactiveLeafletMap.invalidateSize();
        }
      }, 150);
    } else if (!state.currentMapFilter) {
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
window.loadGoogleSheetData = async function(forceRefresh = false, silent = false) {
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

  // ทั้งหน้าจอ Desktop (> 768px) และ Mobile (<= 768px) ไม่ต้องแสดงหน้าต่าง Pop Up โหลดข้อมูล ให้ทำงานในเบื้องหลังเท่านั้น
  const isMobile = window.innerWidth <= 768;
  const shouldShowLoading = false;

  // บนหน้าจอมือถือ หากมีการสั่งโหลดข้อมูลสด (forceRefresh) ให้แสดงเป็น Toast เล็กๆ แจ้งสถานะแบบไม่บล็อกหน้าจอ
  if (isMobile && forceRefresh && !silent) {
    Swal.fire({
      toast: true,
      position: 'top',
      icon: 'info',
      title: 'กำลังซิงค์ประวัติหมายในเบื้องหลัง...',
      timer: 2000,
      showConfirmButton: false
    });
  } else if (elements.cacheStatusBadge) {
    elements.cacheStatusBadge.className = 'text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200 animate-pulse';
    elements.cacheStatusBadge.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1 text-blue-600"></i>กำลังซิงค์ข้อมูล...`;
  }

  let rows = null;

  // 2.1 ลองดึงผ่าน GET API: ?action=get_data
  try {
    const apiUrl = `${state.appsScriptUrl}?action=get_data&_t=${now}`;
    const response = await fetch(apiUrl, { cache: 'no-store' });
    const jsonResult = await response.json();

    if (jsonResult && jsonResult.status === 'success' && Array.isArray(jsonResult.data)) {
      rows = jsonResult.data;
    }
  } catch (e) {
    console.warn('GAS GET get_data failed:', e);
  }

  // 2.2 หากยังไม่ได้ข้อมูล ลองผ่าน POST API: { action: 'get_data' }
  if (!rows) {
    try {
      const response = await fetch(state.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'get_data' })
      });
      const jsonResult = await response.json();
      if (jsonResult && jsonResult.status === 'success' && Array.isArray(jsonResult.data)) {
        rows = jsonResult.data;
      }
    } catch (e) {
      console.warn('GAS POST get_data failed:', e);
    }
  }

  // 2.3 หากยังไม่ได้ข้อมูล ลองดึงผ่าน CSV (กรณีเปิดชีตสาธารณะ)
  if (!rows && state.googleSheetCsvUrl) {
    try {
      rows = await new Promise((resolve) => {
        Papa.parse(`${state.googleSheetCsvUrl}&_t=${now}`, {
          download: true,
          header: true,
          skipEmptyLines: true,
          complete: (res) => resolve(res.data || []),
          error: () => resolve(null)
        });
      });
    } catch (e) {
      rows = null;
    }
  }

  if (shouldShowLoading) {
    hideCustomLoading();
  }

  // ประมวลผลผลลัพธ์
  if (rows && Array.isArray(rows)) {
    try {
      localStorage.setItem(CACHE_KEY_SHEET_DATA, JSON.stringify(rows));
      localStorage.setItem(CACHE_KEY_SHEET_TIME, String(Date.now()));
    } catch (saveErr) {
      console.warn('Could not save to localStorage:', saveErr);
    }

    const timeStr = new Date().toLocaleTimeString('th-TH');
    updateCacheBadgeUI(false, timeStr);
    renderDataTable(rows);

    if (isMobile && forceRefresh && !silent) {
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: 'อัปเดตประวัติหมายเรียบร้อยแล้ว',
        timer: 2000,
        showConfirmButton: false
      });
    }
    return;
  }

  // 3. หากดึงข้อมูลสดล้มเหลวทุกวิธี แต่มีข้อมูลแคชเดิมในเครื่อง
  if (cachedDataStr) {
    try {
      const cachedRows = JSON.parse(cachedDataStr);
      renderDataTable(cachedRows);
      const timeStr = new Date(lastFetchTime).toLocaleTimeString('th-TH');
      updateCacheBadgeUI(true, timeStr);

      const Toast = Swal.mixin({
        toast: true,
        position: isMobile ? 'top' : 'top-end',
        showConfirmButton: false,
        timer: 3500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: 'info',
        title: 'กำลังแสดงข้อมูลแคชล่าสุดในเครื่อง'
      });
      return;
    } catch (e) {}
  }

  // 4. หากไม่มีแคชเลย และดึงข้อมูลไม่สำเร็จ
  Swal.fire({
    toast: true,
    position: isMobile ? 'top' : 'top-end',
    icon: 'warning',
    title: 'ยังไม่สามารถเชื่อมต่อข้อมูลสดได้',
    text: 'ระบบจะลองดึงข้อมูลใหม่อีกครั้งในรอบถัดไป',
    timer: 3000,
    showConfirmButton: false
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
 * บีบอัดและปรับขนาดรูปภาพก่อนอัปโหลดให้เหลือไม่เกินครึ่งหนึ่งของ 1MB (< 500KB)
 * ปรับความละเอียดให้เหมาะสมที่ 1280px และคุณภาพ 0.78 (ปรับลดอัตโนมัติหากเกิน 500KB)
 * ผลลัพธ์: ขนาดไฟล์เหลือเพียง 100KB - 250KB (ประหยัดเน็ตกว่า 80%) ในขณะที่ตัวอักษร เลขคดี และลายน้ำคมชัด 100%
 */
async function compressImageToMax1MB(dataUrl, maxBytes = 500 * 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // ความละเอียดสูงสุด 1280px (คมชัดระดับ HD สำหรับเอกสารหมายศาล และส่งผ่านเครือข่ายได้ไวที่สุด)
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

      // คุณภาพ 0.78 ให้ความคมชัดสูงและขนาดไฟล์เล็กกะทัดรัด (~120KB - 200KB)
      let quality = 0.78;
      let resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      let currentBytes = Math.round((resultDataUrl.length - resultDataUrl.indexOf(',') - 1) * 0.75);

      // หากขนาดเกินเป้าหมาย (ครึ่งหนึ่งของ 1MB หรือ 500KB) ให้ปรับลดคุณภาพเป็นขั้นบันได
      if (currentBytes > maxBytes) {
        quality = 0.70;
        resultDataUrl = canvas.toDataURL('image/jpeg', quality);
        currentBytes = Math.round((resultDataUrl.length - resultDataUrl.indexOf(',') - 1) * 0.75);
      }

      if (currentBytes > maxBytes) {
        quality = 0.60;
        resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(resultDataUrl);
    };
    img.src = dataUrl;
  });
}
window.compressImageToMax500KB = compressImageToMax1MB;

/**
 * อัปโหลดข้อมูลพร้อมแสดง Progress Bar และตัวเลข % ความคืบหน้า (ปิดไม่ได้จนกว่าจะเสร็จสิ้น)
 * ใช้ fetch กับ text/plain เพื่อป้องกันปัญหา CORS Preflight กับ Google Apps Script
 */
/**
 * อัปโหลดข้อมูลพร้อมแสดง Progress Bar และตัวเลข % ความคืบหน้า (ปิดไม่ได้จนกว่าจะเสร็จสิ้น)
 * ใช้ fetch กับ text/plain เพื่อป้องกันปัญหา CORS Preflight กับ Google Apps Script
 */
window.getSanitizedAppsScriptUrl = function() {
  let url = (state.appsScriptUrl || localStorage.getItem('slts_apps_script_url') || '').trim();
  const defaultUrl = 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec';
  if (!url) {
    url = defaultUrl;
  }
  if (url.endsWith('/dev')) {
    url = url.slice(0, -4) + '/exec';
  }
  return url;
};

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

  const targetUrl = getSanitizedAppsScriptUrl();

  try {
    const response = await fetch(targetUrl, {
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
          throw new Error('Google Apps Script แจ้งเตือนสิทธิ์การเข้าถึง (Access Denied): สิทธิ์ของ Web App ใน Google Apps Script ยังไม่ได้ตั้งเป็น "ทุกคน (Anyone)" กรุณาตั้งค่า Deploy ให้ Everyone/Anyone เข้าถึงได้');
        }
        if (rawText.includes('Service invoked too many times') || rawText.includes('Quota')) {
          throw new Error('Google Apps Script ใช้งานเกินโควตาประจำวันของบัญชี Google');
        }
        throw new Error('Google Apps Script ส่งข้อมูลกลับมาเป็นหน้าเว็บ HTML (สาเหตุเกิดจากการ Deploy Web App ที่ยังไม่ได้เลือกสิทธิ์ Who has access เป็น Anyone หรือ Web App URL ไม่ถูกต้อง)');
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
 * แสดงหน้าต่างแนะนำการแก้ไขเมื่อเกิดข้อผิดพลาด Google Apps Script พร้อมบันทึกลง Offline Queue อัตโนมัติ
 */
window.showGasUploadErrorModal = function(err, payload, imageFilename, caseNumber) {
  // บันทึกสำรองข้อมูลลงคิวออฟไลน์ทันทีเพื่อไม่ให้ข้อมูลและภาพสูญหาย
  try {
    if (payload) {
      addToOfflineQueue({
        payload: payload,
        fileName: imageFilename || (caseNumber ? `${caseNumber.replace(/\//g, '-')}.jpg` : 'image.jpg'),
        caseNumber: caseNumber || payload.caseNumber || '-'
      });
    }
  } catch (qe) {
    console.warn('Auto queue save error:', qe);
  }

  Swal.fire({
    icon: 'warning',
    title: 'การเชื่อมต่อ Apps Script ขัดข้อง',
    html: `
      <div class="text-left text-xs space-y-3 text-gray-700 leading-relaxed">
        <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800">
          <p class="font-bold flex items-center gap-1.5 mb-1">
            <i class="fa-solid fa-triangle-exclamation text-rose-600"></i>
            <span>ข้อความระบบ:</span>
          </p>
          <p class="text-[11px] leading-snug">${err.message || err}</p>
        </div>

        <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
          <p class="font-bold flex items-center gap-1.5 mb-1">
            <i class="fa-solid fa-shield-halved text-emerald-600"></i>
            <span>ข้อมูลและภาพถ่ายของท่านปลอดภัย:</span>
          </p>
          <p class="text-[11px]">ระบบได้จัดเก็บข้อมูลเข้าสู่ <b>คิวออฟไลน์ในเครื่อง</b> เรียบร้อยแล้ว ท่านสามารถกดซิงค์ข้อมูลได้ทันทีเมื่อแก้ไขสิทธิ์เรียบร้อย</p>
        </div>

        <div class="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1.5">
          <p class="font-bold text-gray-900 text-xs">🛠️ วิธีแก้ไขการ Deploy ใน Google Apps Script:</p>
          <ol class="list-decimal list-inside space-y-1 text-[11px] text-gray-600 pl-1">
            <li>เปิดโปรเจกต์ใน <b>Google Apps Script</b></li>
            <li>กดปุ่มสีน้ำเงิน <b>"Deploy" (การทำให้ใช้งานได้)</b> มุมขวาบน &rarr; เลือก <b>"Manage deployments" (จัดการการทำให้ใช้งานได้)</b></li>
            <li>คลิกไอคอนรูปดินสอ <b>Edit (แก้ไข)</b> &rarr; ตรง Version เลือก <b>"New version" (เวอร์ชันใหม่)</b></li>
            <li><b>จุดสำคัญ:</b> ในช่อง <b>"Who has access" (ผู้มีสิทธิ์เข้าถึง)</b> ให้เลือกเป็น <b>"Anyone" (ทุกคน)</b> เสมอ</li>
            <li>กด <b>Deploy</b> แล้วคัดลอก Web App URL (ที่ลงท้ายด้วย <code>/exec</code>)</li>
          </ol>
        </div>

        <div class="flex flex-col gap-2 pt-1">
          <button type="button" onclick="resetDefaultGasUrlAndRetry()" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer">
            <i class="fa-solid fa-arrows-rotate"></i> รีเซ็ตเป็น URL เริ่มต้นของระบบ
          </button>
        </div>
      </div>
    `,
    confirmButtonText: 'รับทราบ (บันทึกลงเครื่องแล้ว)',
    confirmButtonColor: '#059669',
    showCloseButton: true,
    allowOutsideClick: false
  });
};

window.resetDefaultGasUrlAndRetry = function() {
  const defaultUrl = 'https://script.google.com/macros/s/AKfycbw-alwkXt6cRw3hKEpMhxWLIp6zs6FvcDCs2CwiCYdvOp1tAAuh84Y4_YEz6OTwq1SC/exec';
  localStorage.setItem('slts_apps_script_url', defaultUrl);
  state.appsScriptUrl = defaultUrl;

  Swal.fire({
    icon: 'success',
    title: 'รีเซ็ต URL สำเร็จ',
    text: 'ระบบได้รีเซ็ต Web App URL กลับมาเป็น URL มาตรฐานเรียบร้อยแล้ว',
    timer: 1500,
    showConfirmButton: false
  });
};

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

    // คอลัมน์จัดการ (ตรวจสอบสิทธิ์: แก้ไขได้เฉพาะผู้ที่อัปโหลด/บันทึกไฟล์ หรือผู้ดูแลระบบ role => admin)
    const currentUsername = (state.currentUser?.username || '').trim().toLowerCase();
    const rowUploader = String(latest['ผู้บันทึก'] || latest['uploader'] || latest['uploadedBy'] || latest['user_id'] || '').trim().toLowerCase();
    const canEdit = isAdmin || (currentUsername && (!rowUploader || rowUploader === currentUsername));

    let editBtn = '';
    if (canEdit) {
      editBtn = `
        <button type="button" onclick="openEditSummonsModal('${caseNumber.replace(/'/g, "\\'")}')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center gap-1 cursor-pointer" title="แก้ไขข้อมูลส่งหมาย">
          <i class="fa-solid fa-pen-to-square"></i>
          <span>แก้ไข</span>
        </button>
      `;
    } else {
      editBtn = `
        <span class="text-[11px] text-gray-400 bg-gray-100 border border-gray-200 px-2 py-1 rounded-lg italic cursor-not-allowed inline-flex items-center gap-1" title="แก้ไขได้เฉพาะผู้บันทึก (@${rowUploader || 'ผู้สร้าง'}) หรือ Admin">
          <i class="fa-solid fa-lock text-[10px]"></i>
          <span>แก้ไข</span>
        </span>
      `;
    }

    let actionBtn = `
      <div class="flex items-center gap-1.5 whitespace-nowrap">
        ${editBtn}
        ${(isAdmin && isDesktop) ? `
          <button type="button" onclick="deleteRecord('${fileId}', '${fileName}', '${rawTimestamp}', '${caseNumber}', ${latest.originalIndex + 2})" class="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1 cursor-pointer" title="ลบข้อมูลในชีตและไฟล์ใน Drive">
            <i class="fa-solid fa-trash-can"></i>
            <span>ลบ</span>
          </button>
        ` : ''}
      </div>
    `;

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
 * แสดง SweetAlert แบบฟอร์ม "บันทึกการส่งหมาย" สำหรับแก้ไขข้อมูล
 * พร้อมดึงข้อมูลเดิมขึ้นมาให้แก้ไข และแสดงผลรูปส่งหมาย พร้อมตัวเลือกอัปโหลดรูปภาพใหม่ทับไฟล์เดิม
 */
window.openEditSummonsModal = async function(caseNumber, specificRecord = null) {
  const records = (state.allSheetRows || []).filter(r => (r['เลขคดี'] || '').trim() === caseNumber.trim());
  const rec = specificRecord || records[0] || {};

  // ตรวจสอบสิทธิ์การแก้ไข (อนุญาตเฉพาะ Admin หรือผู้ที่บันทึกข้อมูล)
  const currentUsername = (state.currentUser?.username || '').trim().toLowerCase();
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const rowUploader = String(rec['ผู้บันทึก'] || rec['uploader'] || rec['uploadedBy'] || rec['user_id'] || '').trim().toLowerCase();
  
  if (!isAdmin && rowUploader && currentUsername && rowUploader !== currentUsername) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่มีสิทธิ์แก้ไขข้อมูล',
      text: `ข้อมูลรายการนี้ถูกบันทึกโดยผู้ใช้ @${rowUploader} (สิทธิ์การแก้ไขจำกัดเฉพาะผู้บันทึกหรือผู้ดูแลระบบ Admin เท่านั้น)`,
      confirmButtonColor: '#2563eb'
    });
    return;
  }

  const currentProv = rec._resolvedProvince || getRowProvince(rec) || state.selectedProvince || 'อุดรธานี';
  const courtType = rec['ประเภทศาล'] || 'ศาลจังหวัด' + currentProv;
  const district = rec['อำเภอ'] || '';
  const subdistrict = rec['ตำบล'] || '';
  const locationType = rec['ประเภทสถานที่'] || 'หมายบ้าน';
  const locationFull = rec['ที่ตั้งส่งหมาย (เต็ม)'] || rec['ที่ตั้งส่งหมาย'] || '';
  const lat = rec['ละติจูด (Lat)'] || rec['ละติจูด'] || '';
  const lng = rec['ลองจิจูด (Lng)'] || rec['ลองจิจูด'] || '';
  const imgUrl = rec['ลิงก์รูปภาพใน Google Drive'] || rec['ลิงก์รูปภาพ'] || '';
  const fileId = rec['Drive File ID'] || '';
  const fileName = rec['ชื่อไฟล์รูปภาพ'] || '';
  const rawTimestamp = rec['วัน-เวลาบันทึก'] || rec['Timestamp'] || '';
  const rowIndex = rec.originalIndex !== undefined ? rec.originalIndex + 2 : null;

  // แปลงลิงก์ Google Drive ให้เป็น Direct Image URL / Thumbnail เพื่อให้แสดงผลใน <img> ได้ 100%
  let resolvedFileId = fileId;
  if (!resolvedFileId && imgUrl) {
    const m = imgUrl.match(/id=([a-zA-Z0-9_-]+)/) || imgUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) resolvedFileId = m[1];
  }
  let directDisplayUrl = '';
  if (resolvedFileId) {
    directDisplayUrl = `https://lh3.googleusercontent.com/d/${resolvedFileId}=w800`;
  } else if (imgUrl && String(imgUrl).startsWith('http')) {
    directDisplayUrl = imgUrl;
  }

  // ดึงรายการจังหวัด
  let provincesOptions = '';
  if (typeof THAILAND_PROVINCES !== 'undefined') {
    provincesOptions = THAILAND_PROVINCES.map(p => 
      `<option value="${p.name}" ${p.name === currentProv ? 'selected' : ''}>${p.name}</option>`
    ).join('');
  } else {
    provincesOptions = `<option value="${currentProv}" selected>${currentProv}</option>`;
  }

  // ดึงรายการอำเภอ
  const districts = getDistrictsByProvince(currentProv);
  const districtOptions = districts.map(d => 
    `<option value="${d}" ${d === district ? 'selected' : ''}>${d}</option>`
  ).join('');

  // ดึงรายการตำบล
  const subdistricts = getSubdistrictsByDistrict(currentProv, district || districts[0]);
  const subdistrictOptions = subdistricts.map(s => 
    `<option value="${s}" ${s === subdistrict ? 'selected' : ''}>${s}</option>`
  ).join('');

  const coordVal = (lat && lng) ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : '';

  let newImageBase64 = null;
  let newImageFileName = '';

  const modalHtml = `
    <div class="text-left space-y-3.5 p-1 select-none">
      
      <!-- ข้อมูลเลขคดี และ ประเภทศาล -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-gavel text-blue-600 mr-1"></i> เลขคดี <span class="text-red-500">*</span>
          </label>
          <input type="text" id="swalEditCaseNumber" value="${caseNumber}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm font-bold text-gray-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-200">
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-building-columns text-blue-600 mr-1"></i> ประเภทศาล <span class="text-red-500">*</span>
          </label>
          <input type="text" id="swalEditCourtType" value="${courtType}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm font-medium text-gray-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-200">
        </div>
      </div>

      <!-- จังหวัด อำเภอ ตำบล -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-map-location-dot text-blue-600 mr-1"></i> จังหวัด
          </label>
          <select id="swalEditProvince" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${provincesOptions}
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-landmark text-blue-600 mr-1"></i> อำเภอ
          </label>
          <select id="swalEditDistrict" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${districtOptions}
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-location-dot text-blue-600 mr-1"></i> ตำบล
          </label>
          <select id="swalEditSubdistrict" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-semibold text-gray-800 focus:border-blue-500">
            ${subdistrictOptions}
          </select>
        </div>
      </div>

      <!-- ประเภทสถานที่ และ ที่ตั้งส่งหมาย -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-house-user text-blue-600 mr-1"></i> ประเภทสถานที่
          </label>
          <select id="swalEditLocationType" class="w-full bg-white border border-gray-300 rounded-xl px-2.5 py-2 text-xs font-medium text-gray-800 focus:border-blue-500">
            <option value="หมายบ้าน" ${locationType === 'หมายบ้าน' ? 'selected' : ''}>หมายบ้าน</option>
            <option value="ที่ทำการปกครองส่วนท้องถิ่น" ${locationType === 'ที่ทำการปกครองส่วนท้องถิ่น' ? 'selected' : ''}>ที่ทำการปกครองส่วนท้องถิ่น</option>
            <option value="อื่นๆ" ${locationType === 'อื่นๆ' ? 'selected' : ''}>อื่นๆ</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-bold text-gray-700 mb-1">
            <i class="fa-solid fa-location-pin text-blue-600 mr-1"></i> ที่ตั้งส่งหมาย (เต็ม) <span class="text-red-500">*</span>
          </label>
          <input type="text" id="swalEditLocationText" value="${locationFull}" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-800 focus:border-blue-500">
        </div>
      </div>

      <!-- พิกัด GPS -->
      <div>
        <label class="block text-xs font-bold text-gray-700 mb-1 flex items-center justify-between">
          <span><i class="fa-solid fa-crosshairs text-blue-600 mr-1"></i> พิกัด GPS (Lat, Lng)</span>
          <button type="button" id="btnSwalEditCurrentGps" class="text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer">
            <i class="fa-solid fa-location-crosshairs mr-0.5"></i> ใช้พิกัดปัจจุบัน
          </button>
        </label>
        <input type="text" id="swalEditCoordinates" value="${coordVal}" placeholder="เช่น 17.414400, 102.788200" class="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-gray-800 focus:border-blue-500">
      </div>

      <!-- ส่วนจัดการรูปภาพส่งหมาย (แสดงผลภาพเดิม + อัปโหลดทับไฟล์เดิม) -->
      <div class="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl space-y-2.5">
        <div class="flex items-center justify-between">
          <label class="block text-xs font-bold text-gray-800 flex items-center gap-1.5">
            <i class="fa-solid fa-image text-blue-600"></i>
            <span>รูปภาพการส่งหมาย</span>
          </label>
          <div class="flex items-center gap-1.5 text-[10px] text-gray-500">
            ${rowUploader ? `<span class="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200">👤 @${rowUploader}</span>` : ''}
            <span>${(directDisplayUrl || imgUrl) ? 'มีรูปภาพในระบบ' : 'ไม่มีรูปภาพ'}</span>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <!-- รูปภาพปัจจุบัน -->
          <div class="space-y-1">
            <p class="text-[10px] font-bold text-gray-500">รูปภาพปัจจุบัน:</p>
            ${directDisplayUrl ? `
              <div class="relative group rounded-xl overflow-hidden border border-gray-300 max-h-36 min-h-[100px] bg-gray-900 flex items-center justify-center cursor-pointer shadow-sm" onclick="viewPhotoModal('${imgUrl || directDisplayUrl}', '${caseNumber}', '${locationFull}', '${rawTimestamp}', '${lat}', '${lng}')" title="คลิกเพื่อดูภาพขนาดเต็ม">
                <img src="${directDisplayUrl}" alt="รูปภาพปัจจุบัน" class="max-h-36 w-full object-contain rounded-lg" onerror="this.onerror=null; if('${resolvedFileId}') { this.src='https://drive.google.com/thumbnail?id=${resolvedFileId}&sz=w800'; }">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-[11px] font-bold gap-1">
                  <i class="fa-solid fa-up-right-and-down-left-from-center"></i> ดูภาพเต็ม
                </div>
              </div>
            ` : `
              <div class="p-4 bg-white rounded-xl border border-dashed border-gray-300 text-center text-gray-400 text-xs">
                <i class="fa-solid fa-image-slash text-xl mb-1 text-gray-300"></i>
                <p>ไม่มีรูปภาพเดิมในระบบ</p>
              </div>
            `}
          </div>

          <!-- เลือกรูปใหม่เพื่อทับไฟล์เดิม -->
          <div class="space-y-1.5">
            <p class="text-[10px] font-bold text-gray-500">เลือกรูปใหม่เพื่ออัปโหลดทับ:</p>
            <input type="file" id="swalEditNewPhotoInput" accept="image/*" class="block w-full text-[11px] text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-gray-300 rounded-xl p-1 bg-white">
            
            <div id="swalEditNewPhotoPreviewContainer" class="hidden relative rounded-xl overflow-hidden border border-emerald-400 max-h-36 bg-gray-900 flex items-center justify-center">
              <img id="swalEditNewPhotoPreview" src="" class="max-h-36 w-full object-contain rounded-lg">
              <span class="absolute top-1 right-1 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">รูปใหม่</span>
            </div>

            <p class="text-[10px] text-gray-400 leading-tight">
              💡 หากเลือกรูปใหม่ ระบบจะทำการประทับลายน้ำและอัปโหลดทับไฟล์เดิมใน Google Drive ให้โดยอัตโนมัติ
            </p>
          </div>
        </div>
      </div>

    </div>
  `;

  Swal.fire({
    title: `<div class="flex items-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-pen-to-square text-amber-500"></i> แก้ไขข้อมูลการส่งหมาย</div>`,
    html: modalHtml,
    width: '720px',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-floppy-disk mr-1"></i> บันทึกการแก้ไข',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
    customClass: {
      popup: 'rounded-3xl p-5'
    },
    didOpen: () => {
      const provEl = document.getElementById('swalEditProvince');
      const distEl = document.getElementById('swalEditDistrict');
      const subEl = document.getElementById('swalEditSubdistrict');
      const fileInput = document.getElementById('swalEditNewPhotoInput');
      const previewContainer = document.getElementById('swalEditNewPhotoPreviewContainer');
      const previewImg = document.getElementById('swalEditNewPhotoPreview');
      const btnGps = document.getElementById('btnSwalEditCurrentGps');
      const coordEl = document.getElementById('swalEditCoordinates');

      if (provEl && distEl && subEl) {
        provEl.onchange = () => {
          const newDists = getDistrictsByProvince(provEl.value);
          distEl.innerHTML = newDists.map(d => `<option value="${d}">${d}</option>`).join('');
          const newSubs = getSubdistrictsByDistrict(provEl.value, newDists[0]);
          subEl.innerHTML = newSubs.map(s => `<option value="${s}">${s}</option>`).join('');
        };
        distEl.onchange = () => {
          const newSubs = getSubdistrictsByDistrict(provEl.value, distEl.value);
          subEl.innerHTML = newSubs.map(s => `<option value="${s}">${s}</option>`).join('');
        };
      }

      if (btnGps && coordEl) {
        btnGps.onclick = () => {
          if (state.lat && state.lng) {
            coordEl.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
          } else {
            navigator.geolocation?.getCurrentPosition(pos => {
              state.lat = pos.coords.latitude;
              state.lng = pos.coords.longitude;
              coordEl.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
            });
          }
        };
      }

      if (fileInput) {
        fileInput.onchange = (e) => {
          const f = e.target.files[0];
          if (f) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              newImageBase64 = ev.target.result;
              newImageFileName = f.name;
              if (previewImg && previewContainer) {
                previewImg.src = newImageBase64;
                previewContainer.classList.remove('hidden');
              }
            };
            reader.readAsDataURL(f);
          }
        };
      }
    },
    preConfirm: async () => {
      const newCaseNumber = (document.getElementById('swalEditCaseNumber')?.value || '').trim();
      const newCourtType = (document.getElementById('swalEditCourtType')?.value || '').trim();
      const newProvince = document.getElementById('swalEditProvince')?.value || currentProv;
      const newDistrict = document.getElementById('swalEditDistrict')?.value || '';
      const newSubdistrict = document.getElementById('swalEditSubdistrict')?.value || '';
      const newLocationType = document.getElementById('swalEditLocationType')?.value || 'หมายบ้าน';
      const newLocationText = (document.getElementById('swalEditLocationText')?.value || '').trim();
      const coordStr = (document.getElementById('swalEditCoordinates')?.value || '').trim();

      if (!newCaseNumber) {
        Swal.showValidationMessage('กรุณาระบุเลขคดี');
        return false;
      }
      if (!newLocationText) {
        Swal.showValidationMessage('กรุณาระบุที่ตั้งส่งหมาย');
        return false;
      }

      let parsedLat = lat;
      let parsedLng = lng;
      if (coordStr) {
        const parts = coordStr.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          parsedLat = parts[0];
          parsedLng = parts[1];
        }
      }

      return {
        newCaseNumber,
        newCourtType,
        newProvince,
        newDistrict,
        newSubdistrict,
        newLocationType,
        newLocationText,
        parsedLat,
        parsedLng
      };
    }
  }).then(async (res) => {
    if (res.isConfirmed && res.value) {
      const val = res.value;
      let compressedImgBase64 = null;
      let finalFileName = fileName;

      if (newImageBase64) {
        showCustomLoading('กำลังประมวลผลรูปภาพใหม่...', 'กำลังสร้างลายน้ำและเตรียมอัปโหลด');
        try {
          const img = new Image();
          img.src = newImageBase64;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          const watermarkData = {
            caseNumber: val.newCaseNumber,
            courtType: val.newCourtType,
            province: val.newProvince,
            district: val.newDistrict,
            subdistrict: val.newSubdistrict,
            locationType: val.newLocationType,
            locationText: val.newLocationText,
            lat: val.parsedLat,
            lng: val.parsedLng,
            dateTime: rawTimestamp || WatermarkEngine.formatThaiDateTime(new Date())
          };

          const wmResult = await WatermarkEngine.renderWatermark(img, watermarkData);
          compressedImgBase64 = await compressImageToMax1MB(wmResult.dataUrl);
          const baseName = val.newCaseNumber.replace(/\//g, '-');
          finalFileName = baseName + '.jpg';
        } catch (imgErr) {
          console.warn('Image watermark error on edit:', imgErr);
        } finally {
          hideCustomLoading();
        }
      }

      const updatePayload = {
        action: 'edit_record',
        rowIndex: rowIndex,
        oldFileId: fileId,
        timestamp: rawTimestamp,
        caseNumber: val.newCaseNumber,
        courtType: val.newCourtType,
        province: val.newProvince,
        district: val.newDistrict,
        subdistrict: val.newSubdistrict,
        locationType: val.newLocationType,
        locationText: val.newLocationText,
        lat: val.parsedLat,
        lng: val.parsedLng,
        dateTime: rawTimestamp || WatermarkEngine.formatThaiDateTime(new Date()),
        imageBase64: compressedImgBase64,
        fileName: finalFileName,
        fileUrl: imgUrl,
        fileId: fileId,
        uploader: state.currentUser?.username || '',
        role: state.currentUser?.role || 'user'
      };

      try {
        const resJson = await uploadWithProgressBar(updatePayload, `กำลังบันทึกการแก้ไขเลขคดี ${val.newCaseNumber}...`);

        if (state.allSheetRows) {
          const target = state.allSheetRows.find(r => {
            return (r['เลขคดี'] || '').trim() === caseNumber.trim() &&
                   (!rawTimestamp || (r['วัน-เวลาบันทึก'] || r['Timestamp'] || '') === rawTimestamp);
          });
          if (target) {
            target['เลขคดี'] = val.newCaseNumber;
            target['ประเภทศาล'] = val.newCourtType;
            target['อำเภอ'] = val.newDistrict;
            target['ตำบล'] = val.newSubdistrict;
            target['ประเภทสถานที่'] = val.newLocationType;
            target['ที่ตั้งส่งหมาย (เต็ม)'] = val.newLocationText;
            target['ที่ตั้งส่งหมาย'] = val.newLocationText;
            target['ละติจูด (Lat)'] = val.parsedLat;
            target['ลองจิจูด (Lng)'] = val.parsedLng;
            if (resJson && resJson.fileUrl) {
              target['ลิงก์รูปภาพใน Google Drive'] = resJson.fileUrl;
              target['ลิงก์รูปภาพ'] = resJson.fileUrl;
              target['ชื่อไฟล์รูปภาพ'] = finalFileName;
              target['Drive File ID'] = resJson.fileId || fileId;
            }
          }
        }

        localStorage.removeItem(CACHE_KEY_SHEET_DATA);
        localStorage.removeItem(CACHE_KEY_SHEET_TIME);

        renderDataTable(state.allSheetRows);

        Swal.fire({
          icon: 'success',
          title: 'บันทึกการแก้ไขสำเร็จ!',
          text: `อัปเดตข้อมูลเลขคดี ${val.newCaseNumber} ใน Google Sheet & Drive เรียบร้อยแล้ว`,
          confirmButtonColor: '#2563eb'
        });

      } catch (err) {
        console.error('Edit summons error:', err);
        showGasUploadErrorModal(err, updatePayload, finalFileName, val.newCaseNumber);
      }
    }
  });
};

/**
 * แสดง Popup รายการประวัติการส่งหมายทั้งหมดของเลขคดีนั้นๆ
 */
window.openCaseHistoryModal = function(caseNumber) {
  const records = (state.allSheetRows || []).filter(r => (r['เลขคดี'] || '').trim() === caseNumber.trim());
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  const isDesktop = window.innerWidth > 768;
  const showDeleteCol = isAdmin && isDesktop;
  const currentUsername = (state.currentUser?.username || '').trim().toLowerCase();

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
    const itemUploader = String(rec['ผู้บันทึก'] || rec['uploader'] || rec['uploadedBy'] || rec['user_id'] || '').trim().toLowerCase();
    const canEditItem = isAdmin || (currentUsername && (!itemUploader || itemUploader === currentUsername));

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
        <button type="button" onclick="viewPhotoModal('${imgUrl}', '${caseNumber}', '${locationFull}', '${formattedTimestamp}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1 cursor-pointer">
          <i class="fa-solid fa-image"></i>
          <span>ดูภาพ</span>
        </button>
      `;
    }

    let editBtn = '';
    if (canEditItem) {
      editBtn = `
        <button type="button" onclick="Swal.close(); openEditSummonsModal('${caseNumber.replace(/'/g, "\\'")}', state.allSheetRows ? state.allSheetRows[${rec.originalIndex}] : null)" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg text-xs font-bold shadow-sm transition inline-flex items-center gap-1 cursor-pointer" title="แก้ไขรายการนี้">
          <i class="fa-solid fa-pen-to-square"></i>
          <span>แก้ไข</span>
        </button>
      `;
    } else {
      editBtn = `
        <span class="text-[11px] text-gray-400 bg-gray-100 border border-gray-200 px-2 py-1 rounded-lg italic cursor-not-allowed inline-flex items-center gap-1" title="แก้ไขได้เฉพาะผู้บันทึก (@${itemUploader || 'ผู้สร้าง'}) หรือ Admin">
          <i class="fa-solid fa-lock text-[10px]"></i>
          <span>แก้ไข</span>
        </span>
      `;
    }

    let deleteBtn = '';
    if (showDeleteCol) {
      deleteBtn = `
        <td>
          <button type="button" onclick="deleteRecord('${fileId}', '${fileName}', '${rawTimestamp}', '${caseNumber}', ${rec.originalIndex + 2})" class="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1 cursor-pointer" title="ลบรายการนี้">
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
        <td class="whitespace-nowrap">${editBtn}</td>
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
              <th>แก้ไข</th>
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
          dateTime: WatermarkEngine.formatThaiDateTime(new Date()),
          uploader: state.currentUser?.username || '',
          uploadedBy: state.currentUser?.username || '',
          user_id: state.currentUser?.username || '',
          uploaderRole: state.currentUser?.role || 'user'
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
        showGasUploadErrorModal(err, uploadPayload, imageFilename, formData.caseNumber);
      }
    }
  });
};

/**
 * ระบบ Stack จัดการประวัติการเปิด Pop Up บนหน้าจอมือถือ (< 768px) ตามข้อ 1
 * เมื่อมีการใช้งานหน้าถัดไป หากกดปุ่มปิดหรือย้อนกลับ ให้ย้อนกลับไปหน้าก่อนหน้า
 * หากไม่มีหน้าก่อนหน้า หรือเป็นหน้าเริ่มต้น ให้ปิดหน้าต่างตามปกติ
 */
window.mobileModalStack = [];

window.pushMobileModalState = function(restoreFn) {
  if (typeof restoreFn === 'function') {
    window.mobileModalStack.push(restoreFn);
  }
};

window.handleMobileModalBackOrClose = function() {
  if (window.innerWidth < 768 && window.mobileModalStack && window.mobileModalStack.length > 0) {
    const prevFn = window.mobileModalStack.pop();
    if (typeof prevFn === 'function') {
      prevFn();
      return true;
    }
  }
  window.mobileModalStack = [];
  Swal.close();
  return false;
};

/**
 * Modal ค้นหาข้อมูลหมายบนหน้าจอมือถือ (< 768px)
 * 1. บีบพื้นที่ด้านบนขึ้น (position: 'top' และ compact padding) เพื่อให้ได้พื้นที่แสดงผลรายการมากที่สุด
 * 2. เรียกใช้งานแป้นพิมพ์ทันทีเมื่อเปิด (Auto-focus)
 * 3. ปุ่มรีเฟรช / การเข้าสู่โหมดค้นหา:
 *    - เมื่อเข้าสู่โหมดค้นหา หากออนไลน์ จะทำการอัปเดตอัตโนมัติเบื้องหลังเงียบๆ (ไม่มีการแจ้งเตือนรบกวน)
 *    - เมื่ออัปเดตเสร็จ จะบันทึกลงเครื่องเพื่อให้นำไปใช้ในโหมดออฟไลน์ได้
 *    - หากออฟไลน์ ปุ่มรีเฟรชจะถูก Disable กดไม่ได้ แต่สามารถค้นหาข้อมูลล่าสุดที่มีในเครื่องได้ตามปกติ
 * 4. รองรับการย้อนกลับไป-มาใน Pop Up อย่างราบรื่น
 */
window.openMobileCaseSearchModal = async function(initialQuery = '') {
  // 1. โหลดข้อมูลเดิมจาก memory หรือ cache ในเครื่องทันทีก่อน เพื่อให้เปิดหน้าต่างได้เร็วที่สุดโดยไม่ต้องรอโหลด
  if (!state.allSheetRows || state.allSheetRows.length === 0) {
    try {
      const cachedStr = localStorage.getItem('slts_cached_sheet_data');
      if (cachedStr) {
        state.allSheetRows = JSON.parse(cachedStr);
      }
    } catch (e) {}
  }

  const isOnline = navigator.onLine;

  Swal.fire({
    position: 'top',
    customClass: {
      container: 'slts-mobile-search-container',
      popup: 'slts-mobile-search-popup rounded-2xl shadow-xl'
    },
    title: `
      <div class="flex items-center justify-between w-full pr-0.5 text-gray-900 font-bold text-sm">
        <div class="flex items-center gap-1.5">
          <i class="fa-solid fa-magnifying-glass text-blue-600 text-xs"></i>
          <span>ค้นหาข้อมูลหมาย</span>
        </div>
        <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-600 flex items-center justify-center text-xs transition cursor-pointer" title="ปิดหน้าต่าง">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>
    `,
    html: `
      <div class="text-left space-y-2 pt-0">
        <!-- ช่องค้นหาเลขคดี + ปุ่มรีเฟรชข้อมูล (บีบระยะห่างชิดด้านบนตามข้อ 1) -->
        <div class="flex gap-1.5 items-center">
          <input type="text" id="mobileSearchInput" value="${initialQuery || ''}" placeholder="พิมพ์เลขคดี หรือ ที่ตั้งส่งหมาย..." class="flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition">
          ${isOnline ? `
            <button type="button" id="btnRefreshMobileSearch" class="px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow flex items-center gap-1.5 transition cursor-pointer" title="รีเฟรชตรวจสอบข้อมูลใหม่">
              <i class="fa-solid fa-rotate-right" id="iconRefreshMobileSearch"></i>
              <span>รีเฟรช</span>
            </button>
          ` : `
            <button type="button" id="btnRefreshMobileSearch" disabled class="px-3 py-2 bg-gray-200 text-gray-400 font-bold rounded-xl text-xs flex items-center gap-1.5 opacity-60 cursor-not-allowed border border-gray-300" title="อุปกรณ์ออฟไลน์ (ใช้งานข้อมูลล่าสุดในเครื่อง)">
              <i class="fa-solid fa-cloud-slash text-[11px]" id="iconRefreshMobileSearch"></i>
              <span>ออฟไลน์</span>
            </button>
          `}
        </div>

        <div class="flex items-center justify-between text-[11px] text-gray-500 px-0.5">
          <span id="mobileSearchResultCountText">แสดงรายการล่าสุด</span>
        </div>

        <!-- รายการคดีแบบ ListView สำหรับจอมือถือ (ขยายพื้นที่ความสูงให้แสดงผลได้เต็มตา) -->
        <div id="mobileSearchResultsContainer" class="max-h-[68vh] max-h-[68dvh] overflow-y-auto space-y-2.5 pr-0.5">
          <!-- Injected by JS -->
        </div>
      </div>
    `,
    width: '96%',
    showCloseButton: false,
    showConfirmButton: false,
    allowOutsideClick: false,
    didOpen: () => {
      const searchInput = document.getElementById('mobileSearchInput');
      const refreshBtn = document.getElementById('btnRefreshMobileSearch');
      const refreshIcon = document.getElementById('iconRefreshMobileSearch');
      const container = document.getElementById('mobileSearchResultsContainer');
      const countTxt = document.getElementById('mobileSearchResultCountText');

      // เรียกใช้งานแป้นพิมพ์ทันทีเมื่อเปิด เพื่อความสะดวกในการพิมพ์
      if (searchInput) {
        setTimeout(() => {
          searchInput.focus();
          try { searchInput.select(); } catch(e) {}
        }, 200);
      }

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
          card.className = 'bg-white rounded-2xl border border-gray-200 p-3.5 shadow-sm space-y-2 text-left transition hover:border-blue-300';
          
          card.innerHTML = `
            <div class="flex items-start justify-between gap-2 border-b border-gray-100 pb-1.5">
              <div>
                <span class="font-bold text-gray-900 text-sm text-blue-700">${caseNo}</span>
                <p class="text-[11px] text-gray-500 font-mono mt-0.5"><i class="fa-regular fa-calendar-check mr-1 text-blue-500"></i>${formattedDate}</p>
              </div>
              <div class="flex items-center gap-1">
                ${hasMultiple ? `
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                    <i class="fa-solid fa-layer-group mr-0.5"></i> ${records.length} รายการ
                  </span>
                ` : `
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${hasImage ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}">
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
              <div class="pt-0.5">
                <button type="button" onclick="window.pushMobileModalState(() => openMobileCaseSearchModal(document.getElementById('mobileSearchInput') ? document.getElementById('mobileSearchInput').value : '')); openMobileSubRecordsModal('${caseNo.replace(/'/g, "\\'")}')" class="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-98 text-white font-bold rounded-xl text-xs shadow-sm flex items-center justify-center gap-2 transition cursor-pointer">
                  <i class="fa-solid fa-layer-group"></i>
                  <span>ดูรายการย่อย (${records.length} รายการ)</span>
                  <i class="fa-solid fa-chevron-right text-[10px]"></i>
                </button>
              </div>
            ` : `
              <!-- สำหรับคดีที่มี 1 รายการ แสดงปุ่ม: 2.1 เลขคดี, 2.2 พิกัด, 2.3 ดูภาพ (ถ้ามี) -->
              <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
                <!-- 2.1 ปุ่มเลขคดี -->
                <button type="button" class="px-2 py-1 bg-blue-50 text-blue-800 rounded-lg text-xs font-bold border border-blue-200 shadow-sm inline-flex items-center gap-1">
                  <i class="fa-solid fa-scale-balanced text-blue-600"></i>
                  <span>${caseNo}</span>
                </button>

                <!-- 2.2 ปุ่มพิกัด -->
                ${lat && lng ? `
                  <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200 shadow-sm inline-flex items-center gap-1 transition cursor-pointer" title="คัดลอกพิกัด">
                    <i class="fa-solid fa-location-crosshairs text-emerald-600"></i>
                    <span>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</span>
                  </button>

                  <!-- ปุ่มเปิดใน Google Maps -->
                  <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold border border-rose-200 shadow-sm inline-flex items-center gap-1 active:scale-95 transition" title="เปิดดูตำแหน่งใน Google Maps">
                    <i class="fa-solid fa-map-location-dot text-rose-600"></i>
                    <span>Google Maps</span>
                  </a>
                ` : ''}

                <!-- 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะเมื่อมีภาพในระบบ) -->
                ${hasImage ? `
                  <button type="button" onclick="window.pushMobileModalState(() => openMobileCaseSearchModal(document.getElementById('mobileSearchInput') ? document.getElementById('mobileSearchInput').value : '')); viewPhotoModal('${imgUrl}', '${caseNo}', '${loc.replace(/'/g, "\\'")}', '${formattedDate}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm inline-flex items-center gap-1 active:scale-95 transition cursor-pointer">
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

      // แสดงรายการเดิมที่มีอยู่ทันทีก่อน
      renderList(initialQuery || '');
      searchInput.addEventListener('input', (e) => renderList(e.target.value));

      /**
       * ฟังก์ชันอัปเดตข้อมูลเบื้องหลังอัตโนมัติ (Silent Background Update ตามข้อ 2)
       * - ไม่แสดงแจ้งเตือนรบกวนผู้ใช้ แค่อัปเดตในเบื้องหลัง
       * - บันทึกลงเครื่อง (localStorage) เพื่อให้พร้อมใช้งานในโหมดออฟไลน์
       */
      const performSilentBackgroundUpdate = async () => {
        if (!navigator.onLine) return;
        if (refreshIcon) refreshIcon.classList.add('fa-spin');
        if (refreshBtn) refreshBtn.disabled = true;

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

          if (freshRows && freshRows.length > 0) {
            state.allSheetRows = freshRows;
            // บันทึกลงหน่วยความจำเครื่องไว้ให้ใช้งานในโหมดออฟไลน์ได้
            try {
              localStorage.setItem('slts_cached_sheet_data', JSON.stringify(freshRows));
            } catch (errCache) {}
            // อัปเดตรายการที่แสดงผลอยู่ให้เป็นปัจจุบันทันที
            renderList(searchInput ? searchInput.value : '');
          }
        } catch (err) {
          console.warn('Silent background search update error:', err);
        } finally {
          if (refreshIcon) refreshIcon.classList.remove('fa-spin');
          if (refreshBtn && navigator.onLine) refreshBtn.disabled = false;
        }
      };

      // ข้อ 2: หากระบบออนไลน์ ให้ทำการอัปเดตอัตโนมัติเบื้องหลังทันทีเมื่อมีการเข้าใช้งานค้นหาข้อมูลหมาย
      if (navigator.onLine) {
        performSilentBackgroundUpdate();
      }

      // เมื่อผู้ใช้กดปุ่มรีเฟรชด้วยตนเอง (หากออนไลน์)
      if (refreshBtn && navigator.onLine) {
        refreshBtn.addEventListener('click', () => {
          performSilentBackgroundUpdate();
        });
      }
    }
  });
};

/**
 * Modal แสดงรายการย่อยทั้งหมดของเลขคดีนั้นๆ บนหน้าจอมือถือ (< 768px)
 * รองรับการย้อนกลับไปหน้าค้นหาตามข้อ 1
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
      <div class="bg-gray-50/90 rounded-2xl border border-gray-200 p-3 space-y-2 text-left shadow-sm">
        <div class="flex items-center justify-between border-b border-gray-200 pb-1">
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
        <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
          <!-- 2.1 ปุ่มเลขคดี -->
          <button type="button" class="px-2 py-1 bg-blue-50 text-blue-800 rounded-lg text-xs font-bold border border-blue-200 shadow-sm inline-flex items-center gap-1">
            <i class="fa-solid fa-scale-balanced text-blue-600"></i>
            <span>${caseNumber}</span>
          </button>

          <!-- 2.2 ปุ่มพิกัด -->
          ${lat && lng ? `
            <button type="button" onclick="copyCoordinates('${lat}', '${lng}')" class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200 shadow-sm inline-flex items-center gap-1 transition cursor-pointer" title="คัดลอกพิกัด">
              <i class="fa-solid fa-location-crosshairs text-emerald-600"></i>
              <span>${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</span>
            </button>

            <!-- ปุ่มเปิดใน Google Maps -->
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold border border-rose-200 shadow-sm inline-flex items-center gap-1 active:scale-95 transition" title="เปิดดูตำแหน่งใน Google Maps">
              <i class="fa-solid fa-map-location-dot text-rose-600"></i>
              <span>Google Maps</span>
            </a>
          ` : ''}

          <!-- 2.3 ปุ่มดูภาพที่อัปโหลด (แสดงเฉพาะเมื่อมีภาพในระบบ) -->
          ${hasImage ? `
            <button type="button" onclick="window.pushMobileModalState(() => openMobileSubRecordsModal('${caseNumber.replace(/'/g, "\\'")}')); viewPhotoModal('${imgUrl}', '${caseNumber}', '${loc.replace(/'/g, "\\'")}', '${formattedDate}', '${lat}', '${lng}')" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm inline-flex items-center gap-1 active:scale-95 transition cursor-pointer">
              <i class="fa-solid fa-image"></i>
              <span>ดูภาพ</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  Swal.fire({
    position: 'top',
    customClass: {
      container: 'slts-mobile-search-container',
      popup: 'slts-mobile-search-popup rounded-2xl shadow-xl'
    },
    title: `
      <div class="flex items-center justify-between w-full pr-0.5 text-gray-900 font-bold text-sm">
        <!-- ปุ่มย้อนกลับตามข้อ 1 -->
        <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 flex items-center justify-center text-xs transition cursor-pointer" title="ย้อนกลับ">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <div class="flex items-center gap-1.5 truncate px-2">
          <i class="fa-solid fa-layer-group text-blue-600 text-xs"></i>
          <span class="truncate">รายการย่อย: ${caseNumber}</span>
        </div>
        <!-- ปุ่มกากบาท (ถ้ามีหน้าก่อนหน้าให้ย้อนกลับ ถ้าไม่มีให้ปิด) ตามข้อ 1 -->
        <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 flex items-center justify-center text-xs transition cursor-pointer" title="ย้อนกลับ/ปิด">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>
    `,
    html: `
      <div class="text-left text-xs text-gray-500 mb-2">
        <span>พบรายการประวัติทั้งหมด <b>${records.length}</b> ครั้ง</span>
      </div>
      <div class="max-h-[68vh] max-h-[68dvh] overflow-y-auto space-y-2.5 pr-0.5">
        ${cardsHtml}
      </div>
    `,
    width: '96%',
    showCloseButton: false,
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

  const hasBackStack = window.innerWidth < 768 && window.mobileModalStack && window.mobileModalStack.length > 0;

  Swal.fire({
    title: `
      <div class="flex items-center justify-between w-full pr-1 text-gray-900 font-bold text-base">
        ${hasBackStack ? `
          <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 flex items-center justify-center text-xs transition cursor-pointer" title="ย้อนกลับ">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
        ` : '<div></div>'}
        <span class="truncate px-2">เลขคดี: ${caseNumber}</span>
        <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 flex items-center justify-center text-xs transition cursor-pointer" title="ย้อนกลับ/ปิด">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>
    `,
    html: `
      <div class="text-left text-xs text-gray-600 mb-2.5 space-y-1">
        <p><b>📅 วันที่เวลา:</b> ${timestamp}</p>
        <p><b>🏠 ที่ตั้งส่งหมาย:</b> ${locationFull}</p>
        <p><b>📍 พิกัด GPS:</b> ${lat}, ${lng}</p>
      </div>
      <div class="relative bg-gray-900 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center min-h-[180px] max-h-[55vh] max-h-[55dvh] cursor-pointer group" onclick="openFullScreenImage('${directImgUrl}', '${imgUrl}', '${caseNumber.replace(/'/g, "\\'")}', '${locationFull.replace(/'/g, "\\'")}', '${timestamp}', '${lat}', '${lng}')" title="คลิกที่ภาพเพื่อเปิดดูแบบเต็มหน้าจอ">
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
    showCloseButton: false,
    showCancelButton: true,
    allowOutsideClick: false,
    confirmButtonText: '<i class="fa-solid fa-arrow-up-right-from-square mr-1"></i> เปิดภาพใน Google Drive',
    cancelButtonText: hasBackStack ? '<i class="fa-solid fa-arrow-left mr-1"></i> ย้อนกลับ' : 'ปิด',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      window.open(imgUrl, '_blank');
    } else if (res.isDismissed) {
      if (hasBackStack) {
        window.handleMobileModalBackOrClose();
      }
    }
  });
};

window.openFullScreenImage = function(imgSrc, originalUrl = '', caseNo = '', loc = '', time = '', lat = '', lng = '') {
  if (originalUrl && caseNo) {
    window.pushMobileModalState(() => window.viewPhotoModal(originalUrl, caseNo, loc, time, lat, lng));
  }

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
  }).then(() => {
    if (window.innerWidth < 768 && window.mobileModalStack && window.mobileModalStack.length > 0) {
      window.handleMobileModalBackOrClose();
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

// =========================================================================
// 📍 Reverse Geocoding Module (แปลงพิกัด Lat, Lng เป็น จังหวัด, อำเภอ, ตำบล)
// =========================================================================

/**
 * แปลงพิกัด (Latitude, Longitude) กลับเป็น จังหวัด, อำเภอ, ตำบล (Reverse Geocoding)
 * @param {number|string} lat - ละติจูด
 * @param {number|string} lng - ลองจิจูด
 * @returns {Promise<{province: string, district: string, subdistrict: string, fullAddress: string}|null>}
 */
window.reverseGeocodeLatLng = async function(lat, lng) {
  if (!lat || !lng) return null;

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || latNum <= 0 || lngNum <= 0) return null;

  // 1. ดึงข้อมูลออนไลน์จาก OpenStreetMap (Nominatim API ระดับบ้าน/ตำบล/อำเภอ/จังหวัด)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latNum}&lon=${lngNum}&accept-language=th&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.address) {
        const addr = data.address;
        let prov = addr.province || addr.state || '';
        let dist = addr.county || addr.district || addr.city_district || addr.city || '';
        let sub = addr.subdistrict || addr.municipality || addr.suburb || addr.village || addr.quarter || addr.town || '';

        // ทำความสะอาดคำนำหน้า
        prov = prov.replace(/^(?:จังหวัด|จ\.)\s*/, '').trim();
        dist = dist.replace(/^(?:อำเภอ|เขต|อ\.)\s*/, '').trim();
        sub = sub.replace(/^(?:ตำบล|แขวง|ต\.)\s*/, '').trim();

        const matched = matchWithThailandDatabase(prov, dist, sub, data.display_name || '');
        if (matched && (matched.district || matched.subdistrict)) {
          return matched;
        }
      }
    }
  } catch (e) {
    console.warn('Nominatim reverse geocode error:', e);
  }

  // 2. Fallback ออนไลน์: BigDataCloud Reverse Geocode API
  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latNum}&longitude=${lngNum}&localityLanguage=th`;
    const bdcRes = await fetch(bdcUrl);
    if (bdcRes.ok) {
      const bdcData = await bdcRes.json();
      let prov = bdcData.principalSubdivision || '';
      let dist = bdcData.locality || bdcData.city || '';
      let sub = '';

      prov = prov.replace(/^(?:จังหวัด|จ\.)\s*/, '').trim();
      dist = dist.replace(/^(?:อำเภอ|เขต|อ\.)\s*/, '').trim();

      if (bdcData.localityInfo && Array.isArray(bdcData.localityInfo.administrative)) {
        bdcData.localityInfo.administrative.forEach(item => {
          const name = item.name || '';
          if (name.startsWith('อำเภอ') || name.startsWith('เขต')) {
            dist = name.replace(/^(?:อำเภอ|เขต|อ\.)\s*/, '').trim();
          }
          if (name.startsWith('ตำบล') || name.startsWith('แขวง') || item.adminLevel === 8 || item.description === 'subdistrict' || item.description === 'municipality') {
            sub = name.replace(/^(?:ตำบล|แขวง|ต\.)\s*/, '').trim();
          }
        });
      }

      const matched = matchWithThailandDatabase(prov, dist, sub, bdcData.localityInfo?.description || bdcData.locality || '');
      if (matched && (matched.district || matched.subdistrict)) {
        return matched;
      }
    }
  } catch (e) {
    console.warn('BigDataCloud reverse geocode error:', e);
  }

  // 3. Fallback: Spatial Nearest Neighbor จากประวัติการส่งหมายที่มีในระบบ (allSheetRows)
  if (state.allSheetRows && state.allSheetRows.length > 0) {
    let nearestRow = null;
    let minDistance = Infinity;

    state.allSheetRows.forEach(row => {
      const rLat = parseFloat(row['ละติจูด (Lat)'] || row.lat);
      const rLng = parseFloat(row['ลองจิจูด (Lng)'] || row.lng);
      if (!isNaN(rLat) && !isNaN(rLng) && rLat > 0 && rLng > 0) {
        const d = calculateHaversineDistance(latNum, lngNum, rLat, rLng);
        if (d < minDistance) {
          minDistance = d;
          nearestRow = row;
        }
      }
    });

    if (nearestRow && minDistance <= 10) { // ระยะห่างไม่เกิน 10 กม.
      const prov = (nearestRow['จังหวัด'] || state.selectedProvince || 'อุดรธานี').trim();
      const dist = (nearestRow['อำเภอ'] || nearestRow.district || '').trim();
      const sub = (nearestRow['ตำบล'] || nearestRow.subdistrict || '').trim();
      return matchWithThailandDatabase(prov, dist, sub, `พิกัดใกล้เคียงจากประวัติ (~${minDistance.toFixed(1)} กม.)`);
    }
  }

  return null;
};

/**
 * เทียบชื่อจังหวัด อำเภอ ตำบล ให้ตรงกับฐานข้อมูล THAILAND_PROVINCES, THAILAND_DISTRICTS, THAILAND_SUBDISTRICTS อย่างแม่นยำ
 */
function matchWithThailandDatabase(rawProv, rawDist, rawSub, fullDisplayName = '') {
  let matchedProv = state.selectedProvince || 'อุดรธานี';
  let matchedDist = '';
  let matchedSub = '';

  // 1. แมตช์จังหวัด
  const provClean = (rawProv || '').replace(/^(?:จังหวัด|จ\.)\s*/, '').trim();
  if (typeof THAILAND_PROVINCES !== 'undefined') {
    const foundProv = THAILAND_PROVINCES.find(p => p.name === provClean || p.name.includes(provClean) || provClean.includes(p.name) || fullDisplayName.includes(p.name));
    if (foundProv) matchedProv = foundProv.name;
  }

  // 2. แมตช์อำเภอ
  const availableDistricts = getDistrictsByProvince(matchedProv);
  const distClean = (rawDist || '').replace(/^(?:อำเภอ|เขต|อ\.)\s*/, '').trim();

  let foundDist = availableDistricts.find(d => d === distClean || distClean.includes(d) || (d.includes(distClean) && distClean.length >= 3));
  if (!foundDist && availableDistricts.length > 0) {
    foundDist = availableDistricts.find(d => fullDisplayName.includes('อำเภอ' + d) || fullDisplayName.includes(d));
  }
  // กรณีพิเศษ เช่น เทศบาลนคร... ให้จัดเข้าอำเภอเมือง
  if (!foundDist && (fullDisplayName.includes('เทศบาลนคร' + matchedProv) || (rawDist && rawDist.includes('เทศบาลนคร')))) {
    foundDist = availableDistricts.find(d => d === 'เมือง' + matchedProv || d.startsWith('เมือง'));
  }
  if (foundDist) matchedDist = foundDist;

  // 3. แมตช์ตำบล
  if (matchedDist) {
    const availableSubdistricts = getSubdistrictsByDistrict(matchedProv, matchedDist);
    const subClean = (rawSub || '').replace(/^(?:ตำบล|แขวง|ต\.)\s*/, '').trim();

    if (subClean && availableSubdistricts.length > 0) {
      const foundSub = availableSubdistricts.find(s => s === subClean || subClean.includes(s) || s.includes(subClean));
      if (foundSub) matchedSub = foundSub;
    }

    // หากยังไม่พบ ให้ตรวจจากข้อความที่อยู่เต็ม (fullDisplayName)
    if (!matchedSub && availableSubdistricts.length > 0) {
      const matches = availableSubdistricts.filter(s => fullDisplayName.includes('ตำบล' + s) || fullDisplayName.includes(s));
      if (matches.length > 0) {
        matches.sort((a, b) => b.length - a.length);
        matchedSub = matches[0];
      }
    }

    // กรณีในตัวเมืองอุดรธานี (เทศบาลนคร / ศาลากลาง / หมากแข้ง)
    if (!matchedSub && matchedDist === 'เมืองอุดรธานี' && (fullDisplayName.includes('เทศบาลนคร') || fullDisplayName.includes('หมากแข้ง') || fullDisplayName.includes('ศาลากลาง'))) {
      matchedSub = 'หมากแข้ง';
    }
  }

  return {
    province: matchedProv,
    district: matchedDist,
    subdistrict: matchedSub,
    fullAddress: fullDisplayName
  };
}

/**
 * นำพิกัดไปอ้างอิงและเติม อำเภอ/ตำบล ในฟอร์มให้อัตโนมัติ (Auto-fill Address from Coordinates)
 */
window.autoFillAddressFromCoordinates = async function(lat, lng, sourceLabel = 'พิกัด') {
  if (!lat || !lng) return null;

  const locStatus = document.getElementById('locationStatus');
  if (locStatus) {
    locStatus.innerHTML = `<span class="text-blue-600 font-semibold"><i class="fa-solid fa-spinner fa-spin mr-1"></i>กำลังวิเคราะห์ที่ตั้งออนไลน์ (ตำบล/อำเภอ/จังหวัด)...</span>`;
  }

  const result = await reverseGeocodeLatLng(lat, lng);
  if (!result || (!result.district && !result.subdistrict)) {
    if (locStatus) {
      locStatus.innerHTML = `<span class="text-gray-500 font-normal"><i class="fa-solid fa-location-dot mr-1"></i>พิกัด: ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)} (${sourceLabel})</span>`;
    }
    return null;
  }

  let changesApplied = [];

  // 1. อัปเดตจังหวัด
  if (result.province) {
    if (elements.provinceSelect) {
      elements.provinceSelect.value = result.province;
    }
    setProvince(result.province);
    changesApplied.push(`จ.${result.province}`);
  }

  // 2. อัปเดตอำเภอ
  if (result.district && elements.districtSelect) {
    updateDistricts(result.province || state.selectedProvince, result.district);
    elements.districtSelect.value = result.district;
    changesApplied.push(`อ.${result.district}`);
  }

  // 3. อัปเดตตำบล
  if (result.subdistrict && elements.subdistrictSelect) {
    updateSubdistricts(result.province || state.selectedProvince, result.district || elements.districtSelect?.value, result.subdistrict);
    elements.subdistrictSelect.value = result.subdistrict;
    changesApplied.push(`ต.${result.subdistrict}`);
  }

  // 4. อัปเดตฟอร์มบน Mobile Modal (ถ้าเปิดอยู่)
  const mDistSelect = document.getElementById('m_district');
  const mSubSelect = document.getElementById('m_subdistrict');
  if (mDistSelect && result.district) {
    mDistSelect.value = result.district;
    if (mSubSelect && result.subdistrict) {
      mSubSelect.value = result.subdistrict;
    }
  }

  // 5. แสดงผลบน Desktop Notice ที่แนบภาพถ่าย (> 768px)
  const desktopAddrRow = document.getElementById('desktopDetectedAddressRow');
  const desktopAddrTxt = document.getElementById('desktopDetectedAddressText');
  if (desktopAddrRow && desktopAddrTxt) {
    desktopAddrRow.classList.remove('hidden');
    desktopAddrTxt.textContent = `${result.subdistrict ? `ต.${result.subdistrict} ` : ''}${result.district ? `อ.${result.district} ` : ''}${result.province ? `จ.${result.province}` : ''}`;
  }

  if (changesApplied.length > 0) {
    const summaryText = `${result.subdistrict ? `ต.${result.subdistrict} ` : ''}${result.district ? `อ.${result.district} ` : ''}${result.province ? `จ.${result.province}` : ''}`;
    
    if (locStatus) {
      locStatus.innerHTML = `<span class="text-emerald-700 font-semibold"><i class="fa-solid fa-wand-magic-sparkles mr-1 text-emerald-600"></i>วิเคราะห์ที่ตั้งออนไลน์สำเร็จ: <strong>${summaryText}</strong> (${sourceLabel})</span>`;
    }
  }

  return result;
};

/**
 * กดปุ่มอ้างอิงตำบล/อำเภอจากพิกัดในช่อง Input ด้วยตนเอง
 */
window.triggerManualReverseGeocode = function() {
  const coordVal = elements.coordinatesInput?.value || document.getElementById('coordinates')?.value || '';
  const parsed = parseCoordinatesFromText(coordVal);
  if (parsed && parsed.lat && parsed.lng) {
    autoFillAddressFromCoordinates(parsed.lat, parsed.lng, 'พิกัดที่ระบุ');
  } else {
    Swal.fire({
      icon: 'info',
      title: 'ระบุพิกัดในช่องก่อน',
      text: 'กรุณากรอกพิกัดในรูปแบบ ละติจูด, ลองจิจูด เช่น 17.194716, 103.338308 หรือกด "เช็คพิกัดใหม่"',
      confirmButtonColor: '#2563eb'
    });
  }
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
        }
      }
    });
  } else {
    applyCourtTypeSettings(category, '', provinceName);
    Swal.close();
    
    if (!isDesktop) {
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
          <!-- ปุ่มค้นหาข้อมูลประวัติส่งหมาย ที่มุมซ้ายบน (Disabled เมื่อออฟไลน์) -->
          <div class="flex items-center gap-1">
            ${searchBtnHtml}
          </div>
          <div class="flex-1 ${isOnline ? 'cursor-pointer' : ''}" ${headerTitleAction}>
            <h2 class="slts-modal-title flex items-center gap-1.5">
              <span>${isEditing ? 'แก้ไขข้อมูลหมาย' : 'บันทึกข้อมูลส่งหมาย'}</span>
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
      fetchCurrentLocation(true);
      startLocationInterval();
    }
  }
}

let isFetchingLocation = false;

function startLocationInterval() {
  if (state.locationIntervalId) {
    clearInterval(state.locationIntervalId);
  }
  // รันเฉพาะบนอุปกรณ์หน้าจอขนาดเล็ก (Mobile <= 768px) เท่านั้น - ตรวจสอบพิกัดเบื้องหลังทุก 5 วินาทีเพื่อประหยัดแบตเตอรี่
  if (window.innerWidth <= 768) {
    state.locationIntervalId = setInterval(() => {
      fetchCurrentLocation(false);
    }, 5000);
  }
}

function fetchCurrentLocation(isManual = false) {
  if (!navigator.geolocation) {
    return;
  }

  // โหลดค่าพิกัดล่าสุดที่เคยบันทึกไว้ขึ้นมาแสดงผลทันทีก่อน เพื่อให้หน้ากล้องมีพิกัดทันทีตั้งแต่วินาทีแรก
  if (!state.lat || !state.lng) {
    try {
      const cachedLat = localStorage.getItem('slts_last_known_lat');
      const cachedLng = localStorage.getItem('slts_last_known_lng');
      if (cachedLat && cachedLng) {
        state.lat = Number(parseFloat(cachedLat).toFixed(6));
        state.lng = Number(parseFloat(cachedLng).toFixed(6));
        if (elements.coordinatesInput && !elements.coordinatesInput.value) {
          elements.coordinatesInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
        }
      }
    } catch (e) {}
  }

  // ป้องกันการยิง Geolocation ซ้อนทับกันกรณีฮาร์ดแวร์ GPS ยังคืนค่าไม่เสร็จ
  if (isFetchingLocation && !isManual) {
    return;
  }
  isFetchingLocation = true;

  if (isManual && elements.locationStatus) {
    elements.locationStatus.textContent = 'กำลังดึงพิกัดล่าสุด...';
    elements.locationStatus.className = 'text-xs text-blue-600 font-semibold';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      isFetchingLocation = false;
      state.lat = Number(position.coords.latitude.toFixed(6));
      state.lng = Number(position.coords.longitude.toFixed(6));
      state.accuracy = Math.round(position.coords.accuracy);
      state.lastLocationTime = new Date();

      try {
        localStorage.setItem('slts_last_known_lat', String(state.lat));
        localStorage.setItem('slts_last_known_lng', String(state.lng));
      } catch (e) {}

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
        if (isManual) {
          autoFillAddressFromCoordinates(state.lat, state.lng, 'GPS ปัจจุบัน');
        }
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
      isFetchingLocation = false;
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
      maximumAge: 2000
    }
  );
}

/**
 * จัดการการกดปุ่มดึงพิกัดใหม่บนหน้ากล้องมือถือ (< 768px)
 */
window.handleCameraRefreshGps = function(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const icon = document.querySelector('#btnFlipOrientationQuick i');
  if (icon) icon.classList.add('fa-spin');

  fetchCurrentLocation(true);

  setTimeout(() => {
    if (icon) icon.classList.remove('fa-spin');
    updateLiveMapHUD();
  }, 1000);
};

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
    elements.btnFlipOrientationQuick.title = 'ดึงพิกัดใหม่ (Refresh GPS)';
    elements.btnFlipOrientationQuick.addEventListener('click', handleCameraRefreshGps);
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

      // สร้าง Canvas รวมโซนบน 40% (สำหรับลายน้ำบน/หัวภาพ) และ โซนล่าง 45% (สำหรับลายน้ำล่าง/ท้ายภาพ)
      const canvas = document.createElement('canvas');
      const topHeight = Math.round(img.height * 0.40);
      const bottomHeight = Math.round(img.height * 0.45);
      const bottomY = img.height - bottomHeight;
      
      canvas.width = Math.min(img.width, 1920);
      canvas.height = Math.round((topHeight + bottomHeight) * (canvas.width / img.width));

      const ctx = canvas.getContext('2d');
      const scale = canvas.width / img.width;
      const scaledTopH = Math.round(topHeight * scale);
      const scaledBottomH = Math.round(bottomHeight * scale);

      // วาดส่วนบน
      ctx.drawImage(img, 0, 0, img.width, topHeight, 0, 0, canvas.width, scaledTopH);
      // วาดส่วนล่างต่อท้าย
      ctx.drawImage(img, 0, bottomY, img.width, bottomHeight, 0, scaledTopH, canvas.width, scaledBottomH);

      const ocrResult = await Tesseract.recognize(canvas, 'eng+tha', {
        logger: () => {}
      });

      const fullText = (ocrResult && ocrResult.data && ocrResult.data.text) ? ocrResult.data.text : '';
      console.log('[GPS Detection] Multi-Zone OCR Text:', fullText);

      let parsedGps = parseCoordinatesFromText(fullText);

      // หากยังไม่พบพิกัดในโซนหัว-ท้าย ให้ลองตรวจจากภาพเต็มขนาดย่อ (Full Image Fallback)
      if (!parsedGps && (img.width > 0 && img.height > 0)) {
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = 1280;
        fullCanvas.height = Math.round((img.height / img.width) * 1280);
        const fctx = fullCanvas.getContext('2d');
        fctx.drawImage(img, 0, 0, fullCanvas.width, fullCanvas.height);

        const fullOcrResult = await Tesseract.recognize(fullCanvas, 'eng+tha', {
          logger: () => {}
        });
        const fullImgText = (fullOcrResult && fullOcrResult.data && fullOcrResult.data.text) ? fullOcrResult.data.text : '';
        console.log('[GPS Detection] Full Image OCR Text:', fullImgText);
        parsedGps = parseCoordinatesFromText(fullImgText);
      }

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
        locStatus.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>ดึงพิกัดจากภาพถ่ายสำเร็จ (${latFormatted}, ${lngFormatted})</span>`;
      }

      if (detectNotice && detectedGpsTxt) {
        detectedGpsTxt.textContent = `${latFormatted}, ${lngFormatted}`;
        detectNotice.classList.remove('hidden');
      }

      // อ้างอิงและเติม จังหวัด, อำเภอ, ตำบล จากพิกัดภาพถ่ายให้อัตโนมัติทันที
      await autoFillAddressFromCoordinates(latNum, lngNum, 'พิกัดภาพถ่าย');
    }

    return result;
  }

  return null;
}

/**
 * แยกสกัดพิกัด ละติจูด / ลองจิจูด จากข้อความ OCR
 * รองรับรูปแบบทศนิยมความละเอียดสูง, ทิศทาง N/E, DMS, DDM, ป้ายข้อความภาษาไทย
 */
function parseCoordinatesFromText(text) {
  if (!text) return null;

  // ทำความสะอาดข้อความและแก้ข้อผิดพลาด OCR ทั่วไป
  const clean = text
    .replace(/[—–]/g, '-')
    .replace(/[\n\r]+/g, ' ');

  function isValid(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);
  }

  // 1. รูปแบบตัวอย่าง: 16.436440683333334N 102.82303225E หรือ 17.389100°N 102.813800°E (ตัวเลขทศนิยมไม่จำกัดหลัก)
  const matchDir = clean.match(/([0-8]?\d\.\d+)\s*°?\s*([NS])\s*[,|\/|\s]?\s*([0-1]?\d{1,2}\.\d+)\s*°?\s*([EW])/i);
  if (matchDir) {
    let lat = parseFloat(matchDir[1]);
    let lng = parseFloat(matchDir[3]);
    if (matchDir[2].toUpperCase() === 'S') lat = -lat;
    if (matchDir[4].toUpperCase() === 'W') lng = -lng;
    if (isValid(lat, lng)) return { lat, lng };
  }

  // 2. รูปแบบนำหน้าด้วยทิศทาง: N 16.436440683 E 102.82303225 หรือ Lat: 16.436440683 Long: 102.82303225 หรือ ละติจูด/ลองจิจูด
  const matchPrefix = clean.match(/(?:[NS]|Lat(?:itude)?|ละติจูด)\s*[:\s]?\s*([0-8]?\d\.\d+)\s*[,|\/|\s]?\s*(?:[EW]|Long(?:itude)?|ลองจิจูด|Lng)\s*[:\s]?\s*([0-1]?\d{1,2}\.\d+)/i);
  if (matchPrefix) {
    const lat = parseFloat(matchPrefix[1]);
    const lng = parseFloat(matchPrefix[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  // 3. รูปแบบพิกัดประเทศไทยโดยเฉพาะ: Lat (5 - 21) และ Lng (97 - 106)
  const matchDecThai = clean.match(/([0-2]?\d\.\d{3,16})\s*[,|\s]\s*(9[7-9]\.\d{3,16}|10[0-6]\.\d{3,16})/);
  if (matchDecThai) {
    const lat = parseFloat(matchDecThai[1]);
    const lng = parseFloat(matchDecThai[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  // 4. รูปแบบทศนิยมมาตรฐาน: 17.389100, 102.813800 หรือ 17.389100 102.813800
  const matchDec = clean.match(/(-?[0-8]?\d\.\d{3,16})\s*[,|\s]\s*(-?[0-1]?\d{1,2}\.\d{3,16})/);
  if (matchDec) {
    const lat = parseFloat(matchDec[1]);
    const lng = parseFloat(matchDec[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  // 5. รูปแบบ DDM (Degrees Decimal Minutes): 16°26.186'N 102°49.382'E
  const matchDdm = clean.match(/(\d{1,2})[°\s]+(\d{1,2}(?:\.\d+)?)['\s]*([NS])\s*(\d{2,3})[°\s]+(\d{1,2}(?:\.\d+)?)['\s]*([EW])/i);
  if (matchDdm) {
    let lat = parseInt(matchDdm[1]) + (parseFloat(matchDdm[2]) / 60);
    let lng = parseInt(matchDdm[4]) + (parseFloat(matchDdm[5]) / 60);
    if (matchDdm[3].toUpperCase() === 'S') lat = -lat;
    if (matchDdm[6].toUpperCase() === 'W') lng = -lng;
    if (isValid(lat, lng)) return { lat, lng };
  }

  // 6. รูปแบบ DMS (องศา ลิปดา พิลิปดา): 16°26'11.2"N 102°49'22.9"E
  const matchDms = clean.match(/(\d{1,2})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([NS])\s*(\d{2,3})[°\s]+(\d{1,2})['\s]+(\d{1,2}(?:\.\d+)?)["\s]*([EW])/i);
  if (matchDms) {
    let lat = parseInt(matchDms[1]) + (parseInt(matchDms[2]) / 60) + (parseFloat(matchDms[3]) / 3600);
    let lng = parseInt(matchDms[5]) + (parseInt(matchDms[6]) / 60) + (parseFloat(matchDms[7]) / 3600);
    if (matchDms[4].toUpperCase() === 'S') lat = -lat;
    if (matchDms[8].toUpperCase() === 'W') lng = -lng;
    if (isValid(lat, lng)) return { lat, lng };
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
          elements.desktopImageSizeBadge.textContent = `${file.name} (${sizeKb} KB → บีบอัดก่อนส่ง < 500 KB)`;
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
      dateTime: WatermarkEngine.formatThaiDateTime(new Date()),
      uploader: state.currentUser?.username || '',
      uploadedBy: state.currentUser?.username || '',
      user_id: state.currentUser?.username || '',
      uploaderRole: state.currentUser?.role || 'user'
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

    // บีบอัดรูปภาพให้เหลือไม่เกินครึ่งหนึ่งของ 1MB (< 500KB)
    const compressedImageBase64 = await compressImageToMax1MB(finalImageDataUrl, 500 * 1024);
    const compressedBytes = Math.round((compressedImageBase64.length - compressedImageBase64.indexOf(',') - 1) * 0.75);
    const compressedKb = Math.round(compressedBytes / 1024);
    console.log(`[Desktop Upload] Image compressed: ${compressedKb} KB (Target <= 500 KB)`);

    // 3. แสดงหน้าต่างแจ้งเตือนเพื่อตรวจสอบข้อมูลและยืนยันก่อนอัปโหลดจริง
    const confirmUploadRes = await Swal.fire({
      title: `<div class="flex items-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-clipboard-check text-blue-600"></i> ตรวจสอบความถูกต้องก่อนอัปโหลด</div>`,
      html: `
        <div class="text-left space-y-3 p-1 select-none">
          <!-- แสดงภาพถ่ายที่แนบให้เห็นชัดๆ -->
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-gray-600">รูปภาพส่งหมายที่จะอัปโหลด:</span>
              <span class="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <i class="fa-solid fa-bolt mr-1"></i>ขนาดส่ง: ~${compressedKb} KB (&lt; 500 KB)
              </span>
            </div>
            <div class="relative bg-gray-900 rounded-2xl overflow-hidden border border-gray-300 max-h-56 min-h-[140px] flex items-center justify-center shadow-inner">
              <img src="${compressedImageBase64}" alt="ภาพส่งหมาย" class="max-h-56 w-full object-contain rounded-xl">
            </div>
          </div>

          <!-- ข้อมูลเลขคดีและที่ตั้งส่งหมาย -->
          <div class="p-3 bg-gray-50 border border-gray-200 rounded-2xl space-y-1 text-xs text-gray-800">
            <div class="flex items-center justify-between font-bold">
              <span class="text-blue-700 font-mono text-sm"><i class="fa-solid fa-gavel mr-1 text-blue-600"></i> ${caseNumber}</span>
              <span class="text-gray-600">${courtType}</span>
            </div>
            <div>
              <i class="fa-solid fa-location-pin text-rose-500 mr-1"></i> <b>ที่ตั้ง:</b> ${locationText}
            </div>
          </div>

          <!-- เน้นการแสดงผลในส่วนของพิกัดให้ชัดเจนเป็นพิเศษ (Highlight Box) -->
          <div class="p-3.5 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border-2 border-blue-400 rounded-2xl text-center shadow-xs">
            <div class="text-xs font-bold text-blue-700 mb-1 flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-crosshairs text-rose-500 text-sm"></i>
              <span>พิกัด GPS ที่จะบันทึกลงระบบ</span>
            </div>
            <div class="text-xl font-mono font-black text-gray-900 tracking-wider">
              ${state.lat ? Number(state.lat).toFixed(6) : '-'}, ${state.lng ? Number(state.lng).toFixed(6) : '-'}
            </div>
            <p class="text-[10px] text-gray-500 mt-1">โปรดตรวจสอบพิกัดและรูปภาพก่อนกดยืนยันอัปโหลด</p>
          </div>
        </div>
      `,
      width: '580px',
      customClass: {
        popup: 'rounded-3xl p-5'
      },
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-cloud-arrow-up mr-1.5"></i> ยืนยันเพื่อทำการอัปโหลด',
      cancelButtonText: '<i class="fa-solid fa-pen-to-square mr-1.5"></i> ย้อนกลับเพื่อแก้ไข',
      confirmButtonColor: '#2563eb',
      cancelButtonColor: '#6b7280',
      allowOutsideClick: false
    });

    if (!confirmUploadRes.isConfirmed) {
      return; // ย้อนกลับเพื่อปิดและแก้ไข
    }

    const uploadPayload = {
      action: 'upload_image',
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    // 1. บันทึกประวัติการกรอกข้อมูลลงในเครื่อง (Desktop Form History) ทันที
    saveDesktopFormHistory({
      caseNumber: caseNumber,
      courtType: payloadData.courtType,
      courtCategory: state.desktopCourtCategory || state.selectedCourtCategory || 'ศาลจังหวัด',
      customName: localStorage.getItem('slts_custom_court_name') || '',
      province: payloadData.province,
      district: payloadData.district,
      subdistrict: payloadData.subdistrict,
      locationType: payloadData.locationType,
      houseNo: elements.houseNoInput ? elements.houseNoInput.value.trim() : '',
      moo: elements.mooInput ? elements.mooInput.value.trim() : '',
      localAdminName: elements.localAdminNameInput ? elements.localAdminNameInput.value.trim() : '',
      customOtherLocationName: elements.customOtherLocationNameInput ? elements.customOtherLocationNameInput.value.trim() : '',
      locationText: payloadData.locationText,
      coordinates: elements.coordinatesInput ? elements.coordinatesInput.value.trim() : `${state.lat}, ${state.lng}`,
      caseExtra: elements.caseExtraInput ? elements.caseExtraInput.value.trim() : '',
      udonPrefix: elements.udonPrefixInput ? elements.udonPrefixInput.value.trim() : '',
      udonCaseNo: elements.udonCaseNoInput ? elements.udonCaseNoInput.value.trim() : '',
      udonCaseYear: elements.udonCaseYearSelect ? elements.udonCaseYearSelect.value : '',
      otherCaseNo: elements.otherCaseNoInput ? elements.otherCaseNoInput.value.trim() : '',
      otherCaseYear: elements.otherCaseYearSelect ? elements.otherCaseYearSelect.value : ''
    });

    // 2. บรรจุงานเข้าสู่คิวอัปโหลดรูปภาพเบื้องหลัง (Background Upload Queue)
    enqueueBackgroundUpload({
      caseNumber: caseNumber,
      courtType: courtType,
      locationText: locationText,
      fileName: imageFilename,
      payload: uploadPayload
    });

    // 3. ปลดล็อกและล้างฟอร์มทันที (Instant Form Release - ผู้ใช้ไม่ต้องรอการอัปโหลดรูป)
    resetDesktopForm(true);

    // 4. เลื่อนเคอร์เซอร์ไปรอที่ช่องเลขคดีเพื่อให้พิมพ์หมายใบถัดไปได้ทันที
    if (elements.udonCaseNoInput && !document.getElementById('udonCaseField')?.classList.contains('hidden')) {
      elements.udonCaseNoInput.value = '';
      elements.udonCaseNoInput.focus();
    } else if (elements.otherCaseNoInput) {
      elements.otherCaseNoInput.value = '';
      elements.otherCaseNoInput.focus();
    }

    // 5. แสดง Pop Up แจ้งว่า "อยู่ในคิวนำขึ้นข้อมูลแล้ว" พร้อม Cooldown 2 วินาที
    let cooldownTimer;
    Swal.fire({
      icon: 'success',
      title: '<div class="text-base font-bold text-gray-900"><i class="fa-solid fa-list-check text-blue-600 mr-1.5"></i> อยู่ในคิวนำขึ้นข้อมูลแล้ว</div>',
      html: `
        <div class="text-left text-xs space-y-3 p-1 select-none text-gray-700">
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-2xl space-y-1">
            <div class="flex items-center justify-between font-bold">
              <span class="text-blue-700 font-mono text-sm"><i class="fa-solid fa-gavel mr-1 text-blue-600"></i> ${caseNumber}</span>
              <span class="text-gray-600 text-xs">${courtType}</span>
            </div>
            <div class="text-gray-600 text-xs truncate">
              <i class="fa-solid fa-location-dot text-rose-500 mr-1"></i> ${locationText}
            </div>
          </div>

          <div class="p-3 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-center space-y-1">
            <div class="text-emerald-800 font-extrabold text-sm flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-circle-check text-emerald-600 text-base"></i>
              <span>ท่านสามารถทำรายการต่อไปได้ทันที</span>
            </div>
            <p class="text-[11px] text-emerald-700 font-medium">ระบบกำลังส่งข้อมูลและอัปโหลดภาพถ่ายในเบื้องหลัง</p>
          </div>

          <div class="pt-1 text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-hourglass-half text-blue-600 animate-spin"></i>
            <span>หน้าต่างนี้จะปิดอัตโนมัติใน <b id="swalQueueCooldown" class="text-blue-600 font-bold text-sm">2</b> วินาที</span>
          </div>
        </div>
      `,
      timer: 2000,
      timerProgressBar: true,
      showConfirmButton: true,
      confirmButtonText: '<i class="fa-solid fa-pen-to-square mr-1"></i> ทำรายการต่อไปทันที',
      confirmButtonColor: '#2563eb',
      allowOutsideClick: true,
      customClass: {
        popup: 'rounded-3xl p-5'
      },
      didOpen: () => {
        const cdEl = document.getElementById('swalQueueCooldown');
        cooldownTimer = setInterval(() => {
          if (cdEl && Swal.getTimerLeft()) {
            const secLeft = Math.ceil(Swal.getTimerLeft() / 1000);
            cdEl.textContent = secLeft;
          }
        }, 200);
      },
      willClose: () => {
        clearInterval(cooldownTimer);
      }
    }).then(() => {
      // เลื่อนเคอร์เซอร์ไปรอที่ช่องเลขคดีอัตโนมัติ เพื่อพิมพ์หมายต่อไปได้ทันที
      if (elements.udonCaseNoInput && !document.getElementById('udonCaseField')?.classList.contains('hidden')) {
        elements.udonCaseNoInput.focus();
        elements.udonCaseNoInput.select();
      } else if (elements.otherCaseNoInput) {
        elements.otherCaseNoInput.focus();
        elements.otherCaseNoInput.select();
      }
    });

    // 6. เริ่มการทำงานของ Background Worker ในเบื้องหลัง
    processBackgroundQueue();

  } catch (err) {
    console.error('Desktop upload error:', err);
    hideCustomLoading();
    showGasUploadErrorModal(err, uploadPayload, imageFilename, caseNumber);
  }
}

function resetDesktopForm(keepValues = true) {
  state.selectedDesktopImageDataUrl = null;
  if (elements.desktopImageFileInput) elements.desktopImageFileInput.value = '';
  if (elements.desktopImagePreviewContainer) elements.desktopImagePreviewContainer.classList.add('hidden');
  if (elements.desktopPreviewImg) elements.desktopPreviewImg.src = '';
  if (!keepValues) {
    resetFormForNextCase();
  }
}

// =========================================================================
// DESKTOP FORM INPUT HISTORY & QUICK-FILL SYSTEM (ระบบบันทึกประวัติการกรอกข้อมูล)
// =========================================================================
const DESKTOP_FORM_HISTORY_KEY = 'slts_desktop_form_history';

window.getDesktopFormHistory = function() {
  try {
    return JSON.parse(localStorage.getItem(DESKTOP_FORM_HISTORY_KEY) || '[]');
  } catch (e) {
    return [];
  }
};

window.saveDesktopFormHistory = function(entry) {
  if (!entry || !entry.caseNumber) return;
  try {
    let list = getDesktopFormHistory();
    // ลบรายการเดิมที่มีเลขคดีซ้ำออกก่อน เพื่อดันรายการล่าสุดขึ้นบน
    list = list.filter(item => item.caseNumber !== entry.caseNumber);
    list.unshift({
      id: 'dfh_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      savedAt: WatermarkEngine.formatThaiDateTime(new Date()),
      ...entry
    });
    // จำกัดสูงสุด 30 รายการล่าสุด
    if (list.length > 30) list = list.slice(0, 30);
    localStorage.setItem(DESKTOP_FORM_HISTORY_KEY, JSON.stringify(list));
    renderDesktopFormHistoryCard();
    updateDesktopHistoryBadges();
  } catch (e) {
    console.warn('saveDesktopFormHistory error:', e);
  }
};

window.updateDesktopHistoryBadges = function() {
  const count = getDesktopFormHistory().length;
  const hBadge = document.getElementById('desktopHistoryHeaderBadge');
  const cBadge = document.getElementById('desktopHistoryCardCountBadge');
  if (hBadge) hBadge.textContent = count;
  if (cBadge) cBadge.textContent = count;
};

window.renderDesktopFormHistoryCard = function(filterQuery = '') {
  const container = document.getElementById('desktopFormHistoryListContainer');
  if (!container) return;

  const history = getDesktopFormHistory();
  updateDesktopHistoryBadges();

  const query = filterQuery.trim().toLowerCase();
  const filtered = query
    ? history.filter(item => {
        const text = `${item.caseNumber || ''} ${item.locationText || ''} ${item.subdistrict || ''} ${item.district || ''} ${item.province || ''}`.toLowerCase();
        return text.includes(query);
      })
    : history;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-gray-400">
        <i class="fa-solid fa-clock-rotate-left text-2xl mb-1.5 text-gray-300"></i>
        <p class="text-xs font-semibold text-gray-500">${query ? 'ไม่พบข้อมูลที่ตรงกับคำค้นหา' : 'ยังไม่มีประวัติการกรอกข้อมูล'}</p>
        <p class="text-[10px] text-gray-400 mt-0.5">เมื่อท่านกรอกและยืนยันข้อมูล ระบบจะจัดเก็บประวัติให้อัตโนมัติ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((item, idx) => {
    return `
      <div class="p-2.5 rounded-xl border border-gray-200 hover:border-blue-300 bg-gray-50/60 hover:bg-blue-50/30 transition text-xs flex flex-col gap-1.5 group">
        <div class="flex items-center justify-between gap-1">
          <span class="font-bold text-gray-900 truncate">${item.caseNumber}</span>
          <span class="text-[10px] text-gray-400 font-mono flex-shrink-0">${item.savedAt || ''}</span>
        </div>
        <p class="text-[11px] text-gray-600 truncate">${item.locationText || '-'}</p>
        <div class="flex items-center justify-between pt-1 border-t border-gray-100 mt-0.5">
          <span class="text-[10px] text-blue-700 font-mono font-medium">${item.coordinates ? `📍 ${item.coordinates}` : ''}</span>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="applyDesktopFormHistoryItem('${item.id}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-[11px] font-bold rounded-lg transition shadow-2xs flex items-center gap-1 cursor-pointer" title="นำข้อมูลชุดนี้ไปกรอกลงฟอร์มทันที">
              <i class="fa-solid fa-arrow-turn-down-left"></i> <span>กรอกลงฟอร์ม</span>
            </button>
            <button type="button" onclick="deleteDesktopFormHistoryItem('${item.id}', event)" class="p-1 text-gray-400 hover:text-red-600 rounded cursor-pointer transition" title="ลบรายการนี้">
              <i class="fa-solid fa-xmark text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
};

window.filterDesktopFormHistory = function(query) {
  renderDesktopFormHistoryCard(query);
};

window.deleteDesktopFormHistoryItem = function(id, e) {
  if (e) e.stopPropagation();
  let list = getDesktopFormHistory();
  list = list.filter(item => item.id !== id);
  localStorage.setItem(DESKTOP_FORM_HISTORY_KEY, JSON.stringify(list));
  renderDesktopFormHistoryCard();
};

window.clearAllDesktopFormHistory = function() {
  const history = getDesktopFormHistory();
  if (history.length === 0) return;

  Swal.fire({
    title: 'ต้องการล้างประวัติการกรอก?',
    text: 'ประวัติการกรอกข้อมูลที่บันทึกไว้ในเครื่องทั้งหมดจะถูกลบออก',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'ล้างประวัติ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      localStorage.removeItem(DESKTOP_FORM_HISTORY_KEY);
      renderDesktopFormHistoryCard();
      updateDesktopHistoryBadges();
    }
  });
};

window.applyDesktopFormHistoryItem = function(id) {
  const history = getDesktopFormHistory();
  const item = history.find(h => h.id === id);
  if (!item) return;

  // 1. จังหวัด อำเภอ ตำบล
  const prov = item.province || state.selectedProvince || 'อุดรธานี';
  if (elements.provinceSelect) elements.provinceSelect.value = prov;
  state.selectedProvince = prov;
  updateDistricts(prov, item.district);
  if (item.district) {
    updateSubdistricts(prov, item.district, item.subdistrict);
  }

  // 2. ประเภทศาล
  const courtCategory = item.courtCategory || 'ศาลจังหวัด';
  const customCourtName = item.customName || '';
  if (window.setDesktopCourtType) {
    window.setDesktopCourtType(courtCategory, customCourtName, prov);
  }

  // 3. ข้อมูลเลขคดี
  const isOther = courtCategory === 'ศาลอื่น' || courtCategory === 'หมายศาลอื่น';
  if (isOther) {
    if (elements.otherCaseNoInput) elements.otherCaseNoInput.value = item.otherCaseNo || '';
    if (elements.otherCaseYearSelect) elements.otherCaseYearSelect.value = item.otherCaseYear || new Date().getFullYear() + 543;
  } else {
    if (elements.udonPrefixInput) elements.udonPrefixInput.value = item.udonPrefix || '';
    if (elements.udonCaseNoInput) elements.udonCaseNoInput.value = item.udonCaseNo || '';
    if (elements.udonCaseYearSelect) elements.udonCaseYearSelect.value = item.udonCaseYear || new Date().getFullYear() + 543;
  }
  if (elements.caseExtraInput) elements.caseExtraInput.value = item.caseExtra || '';

  // 4. ข้อมูลสถานที่
  if (elements.locationTypeSelect) {
    elements.locationTypeSelect.value = item.locationType || 'หมายบ้าน';
    updateLocationFields();
  }
  if (elements.houseNoInput) elements.houseNoInput.value = item.houseNo || '';
  if (elements.mooInput) elements.mooInput.value = item.moo || '';
  if (elements.localAdminNameInput) elements.localAdminNameInput.value = item.localAdminName || '';
  if (elements.customOtherLocationNameInput) elements.customOtherLocationNameInput.value = item.customOtherLocationName || '';

  // 5. พิกัดทางภูมิศาสตร์
  if (item.coordinates && elements.coordinatesInput) {
    elements.coordinatesInput.value = item.coordinates;
    const parts = item.coordinates.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      state.lat = parts[0];
      state.lng = parts[1];
    }
  }

  updateCaptureButtonState();

  // ไฮไลต์ฟอร์มให้ผู้ใช้เห็นว่าโหลดข้อมูลแล้ว
  if (elements.form) {
    elements.form.classList.add('ring-2', 'ring-blue-400', 'bg-blue-50/20');
    setTimeout(() => {
      elements.form.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-50/20');
    }, 800);
  }

  const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 1500
  });
  Toast.fire({
    icon: 'success',
    title: `นำข้อมูลเลขคดี ${item.caseNumber} ลงฟอร์มเรียบร้อย`
  });
};

window.showDesktopHistoryModal = function() {
  const history = getDesktopFormHistory();
  let listHtml = '';
  if (history.length === 0) {
    listHtml = `
      <div class="py-10 text-center text-gray-400">
        <i class="fa-solid fa-clock-rotate-left text-3xl mb-2 text-gray-300"></i>
        <p class="text-sm font-bold text-gray-600">ยังไม่มีประวัติการกรอกข้อมูลในเครื่อง</p>
        <p class="text-xs text-gray-400 mt-1">ประวัติจะถูกบันทึกอัตโนมัติเมื่อท่านทำการกรอกและยืนยันข้อมูล</p>
      </div>
    `;
  } else {
    listHtml = history.map((item, idx) => `
      <div class="p-3 rounded-2xl border border-gray-200 hover:border-blue-400 bg-white hover:bg-blue-50/40 transition flex items-center justify-between gap-3 text-left">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center flex-shrink-0">${idx + 1}</span>
            <span class="font-bold text-sm text-gray-900 truncate">${item.caseNumber}</span>
            <span class="text-[10px] text-gray-400 font-mono">${item.savedAt || ''}</span>
          </div>
          <p class="text-xs text-gray-600 truncate pl-8">${item.locationText || '-'}</p>
          ${item.coordinates ? `<p class="text-[10px] text-blue-700 font-mono pl-8 mt-0.5">📍 พิกัด: ${item.coordinates}</p>` : ''}
        </div>
        <button type="button" onclick="Swal.close(); applyDesktopFormHistoryItem('${item.id}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm flex-shrink-0 cursor-pointer">
          <i class="fa-solid fa-arrow-turn-down-left"></i> <span>ใช้ข้อมูลนี้</span>
        </button>
      </div>
    `).join('');
  }

  Swal.fire({
    title: `<div class="flex items-center justify-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-clock-rotate-left text-blue-600"></i> ประวัติการกรอกข้อมูล (${history.length} รายการ)</div>`,
    html: `
      <div class="space-y-2 max-h-[60vh] overflow-y-auto slts-swal-body-scroll p-1">
        ${listHtml}
      </div>
    `,
    width: '600px',
    showConfirmButton: false,
    showCloseButton: true,
    customClass: {
      popup: 'rounded-3xl p-5'
    }
  });
};

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
  // 1. ดึงพิกัด Latitude, Longitude ทันทีเป็นอันดับต้นที่สุดเสมอเมื่อเข้าสู่โหมดกล้อง
  if (typeof fetchCurrentLocation === 'function') {
    fetchCurrentLocation(true);
  }

  // 2. เปิดโหมดพื้นฐานเป็นแนวนอน 4:3
  setCaptureOrientation('landscape');

  if (elements.cameraModal) {
    elements.cameraModal.classList.remove('hidden');
    elements.cameraModal.classList.add('flex');
  }
  updateCaptureButtonState();

  // 3. เริ่มต้นกล้องหรือใช้สตรีมที่ทำงานอยู่แล้ว โดยไม่ตัดสตรีมซ้ำซ้อน
  const isStreamLive = state.cameraStream && state.cameraStream.active && state.cameraStream.getVideoTracks().some(t => t.readyState === 'live');
  if (isStreamLive) {
    if (elements.videoPreview) {
      if (!elements.videoPreview.srcObject) {
        elements.videoPreview.srcObject = state.cameraStream;
      }
      if (elements.videoPreview.paused) {
        try {
          await elements.videoPreview.play();
        } catch (e) {
          console.warn('Reusing stream error, restarting camera:', e);
          await startCameraStream();
        }
      }
    }
  } else {
    await startCameraStream();
  }

  startLiveCameraHUD();
  updateCameraTopBarUI();
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
 * ปรับปรุงการวาด Live Camera HUD และเข็มทิศเพื่อลดการกินทรัพยากรเครื่อง (CPU / GPU / Battery):
 * 1. ข้ามการคำนวณและวาด Canvas ขณะมี Modal หรือ SweetAlert เปิดบังหน้าจอ
 * 2. วาดเข็มทิศเฉพาะเมื่อองศาทิศเปลี่ยนตั้งแต่ 1 องศาขึ้นไป
 * 3. อัปเดตข้อความวันที่-เวลาต่อวินาที (1 วินาที) ไม่รันถี่ยิบเกินจำเป็น
 */
function startLiveCameraHUD() {
  stopLiveCameraHUD();
  updateLiveMapHUD();

  let lastDrawnHeading = -999;
  let lastSecondKey = '';

  const updateHUD = () => {
    if (!elements.cameraModal || elements.cameraModal.classList.contains('hidden')) return;

    // การลดการกินทรัพยากร: หากมี SweetAlert หรือ Login Modal เปิดบังหน้าจอ ให้ข้ามการวาด Canvas และอัปเดต DOM
    if (document.body.classList.contains('swal2-shown') || (elements.loginModal && !elements.loginModal.classList.contains('hidden'))) {
      return;
    }

    const curHeading = window.compassManager ? window.compassManager.getHeading() : 0;

    // วาดเข็มทิศเฉพาะเมื่อองศาทิศเปลี่ยนจริง (>= 1 องศา) เพื่อลดภาระ GPU Canvas Clear/Stroke ซ้ำซ้อน
    if (elements.liveCompassCanvas && window.compassManager && Math.abs(curHeading - lastDrawnHeading) >= 1) {
      lastDrawnHeading = curHeading;
      const ctx = elements.liveCompassCanvas.getContext('2d');
      ctx.clearRect(0, 0, 84, 84);
      window.compassManager.drawCompass(ctx, 42, 42, 34);
    }

    // อัปเดตข้อมูลข้อความ วัน-เวลา และพิกัด
    const now = new Date();
    const secondKey = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
    const headingChanged = Math.abs(curHeading - lastDrawnHeading) >= 1;

    if (secondKey !== lastSecondKey || headingChanged) {
      lastSecondKey = secondKey;
      const dateStr = WatermarkEngine.formatThaiDateTime(now);
      const latFormatted = state.lat ? `${Math.abs(state.lat).toFixed(4)}°${state.lat >= 0 ? 'N' : 'S'}` : '17.4144°N';
      const lngFormatted = state.lng ? `${Math.abs(state.lng).toFixed(4)}°${state.lng >= 0 ? 'E' : 'W'}` : '102.7882°E';
      const dirText = window.compassManager ? window.compassManager.getDirectionText(curHeading) : 'N';

      const caseNum = getFormattedCaseNumber();
      const locText = getFullLocationText();
      const isReady = isFormValidForCapture();

      if (elements.liveBadgeDate) elements.liveBadgeDate.textContent = `📅  ${dateStr}`;
      if (elements.liveBadgeCoords) elements.liveBadgeCoords.textContent = `📍  ${latFormatted} ${lngFormatted} ${curHeading}° ${dirText}`;
      if (elements.liveBadgeLocation) {
        elements.liveBadgeLocation.textContent = isReady && locText ? `🏠  ${locText}` : (locText || `🏠  (กด "ฟอร์มข้อมูล" เพื่อระบุสถานที่)`);
      }
      if (elements.liveBadgeCase) {
        elements.liveBadgeCase.textContent = isReady && caseNum ? `⚖️  เลขคดี: ${caseNum}` : `⚖️  เลขคดี: (กด "ฟอร์มข้อมูล")`;
      }

      updateCaptureButtonState();
    }
  };

  updateHUD();
  state.hudIntervalId = setInterval(updateHUD, 250);
}

let lastMapSnapshotLat = null;
let lastMapSnapshotLng = null;

async function updateLiveMapHUD() {
  if (!elements.liveMapCanvas || !window.mapSnapshotManager || !state.lat || !state.lng) return;

  // ลดการกินทรัพยากร: โหลดแผนที่ย่อเฉพาะเมื่อพิกัดเปลี่ยนไปมากกว่า ~30 เมตร
  if (lastMapSnapshotLat !== null && lastMapSnapshotLng !== null) {
    const dLat = Math.abs(state.lat - lastMapSnapshotLat);
    const dLng = Math.abs(state.lng - lastMapSnapshotLng);
    if (dLat < 0.0003 && dLng < 0.0003) return;
  }

  lastMapSnapshotLat = state.lat;
  lastMapSnapshotLng = state.lng;

  try {
    const ctx = elements.liveMapCanvas.getContext('2d');
    const mapImg = await window.mapSnapshotManager.getMapImage(state.lat, state.lng, 100, 75);
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, 100, 75);
    }
  } catch (e) {
    console.warn('Map HUD render error:', e);
  }
}

function stopLiveCameraHUD() {
  if (state.hudIntervalId) {
    clearInterval(state.hudIntervalId);
    state.hudIntervalId = null;
  }
}

/**
 * ยกเลิกการ freeze โหมดกล้องทุกกรณีตามคำสั่ง เพื่อให้กล้องทำงานสดและราบรื่น 100% ตลอดเวลา
 * ฟังก์ชันต่อไปนี้คงไว้เป็น Safe No-Op เพื่อความเข้ากันได้ของระบบ
 */
window.freezeCameraStream = function() {
  // ยกเลิกการ freeze โหมดกล้องทุกกรณี
};

window.resumeCameraStream = function() {
  // ยกเลิกการ freeze โหมดกล้องทุกกรณี
  if (typeof fetchCurrentLocation === 'function') {
    fetchCurrentLocation(true);
  }
};

/**
 * ตรวจสอบว่าเปิดผ่าน In-App Browser (WebView เช่น LINE, Facebook, IG, ฯลฯ) หรือไม่
 */
window.isMobileWebView = function() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isLine = /Line/i.test(ua);
  const isFb = /FBAN|FBAV/i.test(ua);
  const isIg = /Instagram/i.test(ua);
  const isTwitter = /Twitter/i.test(ua);
  const isAndroidWebView = /Android.*Version\/[0-9.]+/i.test(ua) || (/Android/i.test(ua) && /wv/i.test(ua));
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isIOSWebView = isIOS && !window.MSStream && !/Safari/i.test(ua);

  return isLine || isFb || isIg || isTwitter || isAndroidWebView || isIOSWebView;
};

/**
 * บังคับเปิดหน้าเว็บในแอป Google Chrome หรือเบราว์เซอร์ภายนอกของเครื่อง
 */
window.openInChromeOrBrowser = function() {
  const currentUrl = window.location.href.split('#')[0];
  const urlWithoutProtocol = window.location.host + window.location.pathname + window.location.search;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // 1. กรณีเปิดใน LINE: ใช้ openExternalBrowser=1
  if (/Line/i.test(ua)) {
    const lineUrl = currentUrl.includes('?') 
      ? currentUrl + '&openExternalBrowser=1' 
      : currentUrl + '?openExternalBrowser=1';
    window.location.href = lineUrl;
    return;
  }

  // 2. กรณี Android: ใช้ Chrome Intent Scheme เพื่อบังคับเปิดด้วย Google Chrome App
  if (isAndroid) {
    const chromeIntentUrl = `intent://${urlWithoutProtocol}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = chromeIntentUrl;

    setTimeout(() => {
      const genericIntentUrl = `intent://${urlWithoutProtocol}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
      window.location.href = genericIntentUrl;
    }, 1200);
    return;
  }

  // 3. กรณี iOS: พยายามเปิด googlechromes:// หรือ Safari
  if (isIOS) {
    const chromeIosUrl = `googlechromes://${urlWithoutProtocol}`;
    window.location.href = chromeIosUrl;
    setTimeout(() => {
      window.location.href = currentUrl;
    }, 1200);
    return;
  }

  window.open(currentUrl, '_system');
};

/**
 * คัดลอกลิงก์เว็บไซต์เพื่อนำไปวางใน Google Chrome
 */
window.copyAppUrlToClipboard = async function() {
  const url = window.location.href.split('#')[0].replace(/[\?&]openExternalBrowser=1/, '');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    const Toast = Swal.mixin({
      toast: true,
      position: 'top',
      showConfirmButton: false,
      timer: 1800
    });
    Toast.fire({
      icon: 'success',
      title: 'คัดลอกลิงก์สำเร็จ นำไปวางใน Google Chrome ได้ทันที'
    });
  } catch (e) {
    console.warn('Copy error:', e);
  }
};

/**
 * จัดการข้อผิดพลาดเมื่อไม่สามารถเปิดกล้องสดได้ พร้อมตัวเลือกเปิดใน Google Chrome
 */
window.handleCameraAccessError = function(err) {
  elements.cameraStatus.textContent = 'ไม่สามารถเปิดกล้องสดได้';
  const isWebView = isMobileWebView();

  Swal.fire({
    html: `
      <div class="p-2 text-center select-none">
        <div class="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-3xl shadow-lg shadow-blue-500/20 mb-3">
          <i class="fa-solid fa-camera"></i>
        </div>

        <h3 class="text-base font-bold text-gray-900 mb-1">ไม่สามารถเปิดกล้องสดได้โดยตรง</h3>
        
        ${isWebView ? `
          <div class="bg-amber-50 border border-amber-200/90 rounded-2xl p-3 mb-3 text-left">
            <p class="text-xs font-bold text-amber-900 mb-1 flex items-center gap-1.5">
              <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
              <span>ตรวจพบการเปิดผ่าน WebView / ในแอปอื่น</span>
            </p>
            <p class="text-[11px] text-amber-800 leading-relaxed">
              แอปพลิเคชันนี้จำกัดสิทธิ์การเข้าถึงกล้องสดและ GPS แนะนำให้เปิดด้วย <b>Google Chrome</b> เพื่อใช้งานระบบได้อย่างเต็มประสิทธิภาพ
            </p>
          </div>
        ` : `
          <div class="bg-blue-50 border border-blue-200/90 rounded-2xl p-3 mb-3 text-left">
            <p class="text-xs font-bold text-blue-900 mb-1 flex items-center gap-1.5">
              <i class="fa-solid fa-circle-info text-blue-600"></i>
              <span>การขอสิทธิ์เข้าถึงกล้อง</span>
            </p>
            <p class="text-[11px] text-blue-800 leading-relaxed">
              โปรดอนุญาตสิทธิ์การเข้าถึงกล้อง หรือเปิดผ่าน <b>Google Chrome</b> หรือเลือกถ่ายภาพจากอุปกรณ์
            </p>
          </div>
        `}

        <div class="space-y-2 pt-1">
          <!-- ปุ่มเปิดใน Google Chrome -->
          <button type="button" onclick="openInChromeOrBrowser()" class="w-full py-2.5 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25 transition flex items-center justify-center gap-2 cursor-pointer">
            <i class="fa-brands fa-chrome text-sm"></i>
            <span>เปิดด้วย Google Chrome (แนะนำ)</span>
          </button>

          <!-- ปุ่มถ่ายรูปจากอุปกรณ์ Fallback -->
          <button type="button" id="btnSwalFallbackPhoto" class="w-full py-2.5 px-3 bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-800 text-xs font-bold rounded-xl border border-gray-300 transition flex items-center justify-center gap-2 cursor-pointer">
            <i class="fa-solid fa-camera-retro text-sm text-gray-600"></i>
            <span>ถ่ายรูปจากอุปกรณ์ (แอปกล้องในเครื่อง)</span>
          </button>

          <!-- ปุ่มคัดลอกลิงก์ -->
          <button type="button" onclick="copyAppUrlToClipboard()" class="w-full py-2 px-3 text-gray-500 hover:text-gray-700 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
            <i class="fa-solid fa-link text-[10px]"></i> คัดลอกลิงก์เว็บไซต์
          </button>
        </div>

        <p class="text-[10px] text-gray-400 mt-2">
          💡 หรือแตะจุด 3 จุด (⋮) ที่มุมจอ &rarr; เลือก <b>"เปิดในเบราว์เซอร์ภายนอก / Chrome"</b>
        </p>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true,
    allowOutsideClick: false,
    customClass: {
      popup: 'rounded-3xl p-4 shadow-2xl'
    },
    didOpen: () => {
      const fallbackBtn = document.getElementById('btnSwalFallbackPhoto');
      if (fallbackBtn) {
        fallbackBtn.onclick = () => {
          Swal.close();
          closeCameraModal();
          elements.fileFallbackInput.click();
        };
      }
    }
  });
};

async function startCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }

  if (elements.cameraStatus) {
    elements.cameraStatus.textContent = 'กำลังเปิดกล้อง...';
  }

  try {
    const isMobile = window.innerWidth < 768;
    const constraints = {
      video: {
        facingMode: { ideal: state.facingMode || 'environment' },
        // บนมือถือ (< 768px) ปรับขนาดพรีวิว 1280x720 เพื่อลดการกินทรัพยากรเครื่องและความร้อนลงอย่างมาก
        width: { ideal: isMobile ? 1280 : 1920, max: 1920 },
        height: { ideal: isMobile ? 720 : 1080, max: 1080 }
      },
      audio: false
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia is not supported');
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    if (elements.videoPreview) {
      elements.videoPreview.srcObject = stream;
      try {
        await elements.videoPreview.play();
      } catch (pErr) {
        console.warn('Video preview play error:', pErr);
      }
    }
    if (elements.cameraStatus) {
      elements.cameraStatus.textContent = 'พร้อมถ่ายภาพ';
    }
  } catch (err) {
    console.error('Camera access error:', err);
    handleCameraAccessError(err);
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
    
    hideCustomLoading();

    // 1. นำคำสั่ง triggerDownload ออก เพื่อป้องกันไม่ให้ Google Chrome แสดงแจ้งเตือนดาวน์โหลดไฟล์รบกวนหน้ากล้อง
    // ข้อมูลและภาพถูกจัดเก็บอย่างปลอดภัยใน Background Queue / Offline Queue / Google Drive & Sheet แล้ว
    // (เตรียมกล้องให้พร้อมถ่ายภาพต่อเนื่องได้ตลอดเวลา 100%)

    // 2. ปรับลดขนาดรูปภาพให้ <= 1MB
    const compressedImageBase64 = await compressImageToMax1MB(result.dataUrl);

    const uploadPayload = {
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    // 3. จัดการคิวตามสถานะ ออนไลน์ vs ออฟไลน์ (ข้อ 5: ทำงานเบื้องหลังทั้งหมด 100% โดยไม่ต้องมี Pop Up แจ้งเตือน)
    if (!navigator.onLine) {
      // โหมดออฟไลน์: บันทึกเข้า Offline Queue รอซิงค์เมื่อกลับมาออนไลน์
      addToOfflineQueue(uploadPayload);
    } else {
      // โหมดออนไลน์: เพิ่มงานเข้าสู่คิวอัปโหลดภาพเบื้องหลัง (Background Upload Queue)
      enqueueBackgroundUpload({
        caseNumber: caseNumber,
        courtType: payloadData.courtType,
        locationText: locationText,
        fileName: imageFilename,
        payload: uploadPayload
      });
      processBackgroundQueue();
    }

    // 4. รีเซ็ตฟอร์มให้พร้อมสำหรับกรอกหมายถัดไปทันที (Instant Form Release)
    resetFormForNextCase();

    // 5. อัปเดตตัวเลขนับจำนวนทำงานเบื้องหลังบนหน้ากล้องทันที (ข้อ 5)
    updateCameraTopBarUI();

    // สั่นตอบสนองเบาๆ (Haptic Feedback) ให้ทราบว่าถ่ายภาพสำเร็จ
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(40);
    }

  } catch (error) {
    console.error('Capture/Upload error:', error);
    hideCustomLoading();

    const caseNumber = getFormattedCaseNumber();
    const baseFilename = caseNumber.replace(/\//g, '-');
    const imageFilename = baseFilename + '.jpg';
    showGasUploadErrorModal(error, uploadPayload, imageFilename, caseNumber);
    resetFormForNextCase();
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

    // 1. นำคำสั่ง triggerDownload ออก เพื่อป้องกันไม่ให้ Google Chrome แสดงแจ้งเตือนดาวน์โหลดไฟล์รบกวนหน้ากล้อง
    // ข้อมูลและภาพถูกจัดเก็บอย่างปลอดภัยใน Background Queue / Offline Queue / Google Drive & Sheet แล้ว
    // (เตรียมกล้องให้พร้อมถ่ายภาพต่อเนื่องได้ตลอดเวลา 100%)

    // 2. ปรับลดขนาดรูปภาพให้ <= 1MB
    const compressedImageBase64 = await compressImageToMax1MB(result.dataUrl);

    const uploadPayload = {
      ...payloadData,
      fileName: imageFilename,
      imageBase64: compressedImageBase64
    };

    // 3. จัดการคิวตามสถานะ ออนไลน์ vs ออฟไลน์ (ข้อ 5: ทำงานเบื้องหลังทั้งหมด 100% โดยไม่ต้องมี Pop Up แจ้งเตือน)
    if (!navigator.onLine) {
      // โหมดออฟไลน์: บันทึกเข้า Offline Queue รอซิงค์เมื่อกลับมาออนไลน์
      addToOfflineQueue(uploadPayload);
    } else {
      // โหมดออนไลน์: เพิ่มงานเข้าสู่คิวอัปโหลดภาพเบื้องหลัง (Background Upload Queue)
      enqueueBackgroundUpload({
        caseNumber: caseNumber,
        courtType: payloadData.courtType,
        locationText: locationText,
        fileName: imageFilename,
        payload: uploadPayload
      });
      processBackgroundQueue();
    }

    // 4. รีเซ็ตฟอร์มสำหรับหมายถัดไปทันที (Instant Form Release)
    resetFormForNextCase();

    // 5. อัปเดตตัวเลขนับจำนวนทำงานเบื้องหลังบนหน้ากล้องทันที (ข้อ 5)
    updateCameraTopBarUI();

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(40);
    }
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

state.routeEndLocation = {
  name: '',
  lat: null,
  lng: null,
  enabled: false
};

/**
 * กรองและลบ Circular Structure (เช่น leafletMarker) ออกจาก Array ของ Stops ก่อนบันทึกหรือแปลงเป็น JSON
 */
function cleanStopsForStorage(stops) {
  if (!Array.isArray(stops)) return [];
  return stops.map(s => {
    if (!s || typeof s !== 'object') return s;
    const clean = {};
    for (const key of Object.keys(s)) {
      if (key !== 'leafletMarker' && typeof s[key] !== 'function') {
        clean[key] = s[key];
      }
    }
    return clean;
  });
}

/**
 * บันทึกประวัติลำดับเส้นทางการส่งหมายล่าสุดลง LocalStorage เสมอ (ป้องกันหน้าจอว่างเปล่า)
 */
window.saveCurrentRouteStopsHistory = function(stops) {
  if (!stops) stops = state.currentRouteStops || [];
  try {
    const cleanStops = cleanStopsForStorage(stops);
    const dataToSave = {
      stops: cleanStops,
      savedAt: new Date().toISOString(),
      province: state.selectedProvince || 'อุดรธานี',
      startLocation: state.routeStartLocation,
      endLocation: state.routeEndLocation,
      isRoundTrip: state.isRoundTrip
    };
    localStorage.setItem('slts_saved_route_stops', JSON.stringify(dataToSave));
    localStorage.setItem('slts_shared_route_stops', JSON.stringify(cleanStops));
  } catch (e) {
    console.warn('Error saving route stops history:', e);
  }
};

/**
 * โหลดประวัติลำดับเส้นทางการส่งหมายล่าสุดจาก LocalStorage
 */
window.loadSavedRouteStopsHistory = function() {
  try {
    const saved = localStorage.getItem('slts_saved_route_stops');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.stops) && parsed.stops.length > 0) {
        state.currentRouteStops = parsed.stops;
        if (parsed.province) state.selectedProvince = parsed.province;
        if (parsed.startLocation) state.routeStartLocation = parsed.startLocation;
        if (parsed.endLocation) state.routeEndLocation = parsed.endLocation;
        if (parsed.isRoundTrip !== undefined) state.isRoundTrip = parsed.isRoundTrip;
        return parsed.stops;
      }
    }
    const shared = localStorage.getItem('slts_shared_route_stops');
    if (shared) {
      const parsedStops = JSON.parse(shared);
      if (Array.isArray(parsedStops) && parsedStops.length > 0) {
        state.currentRouteStops = parsedStops;
        return parsedStops;
      }
    }
  } catch (e) {
    console.warn('Error loading route stops history:', e);
  }
  return [];
};

// โหลดประวัติเส้นทางล่าสุดที่บันทึกไว้ทันที
state.currentRouteStops = loadSavedRouteStopsHistory();

/**
 * ส่งประวัติการทำรายการในหน้าแผนที่และหมุดไปบันทึกเป็นไฟล์ Log ใน Server (Google Apps Script / Drive)
 * @param {string} actionType - ประเภทกิจกรรม
 * @param {string} details - รายละเอียดกิจกรรม
 * @param {Object} [extraData] - ข้อมูลเพิ่มเติม
 */
async function logServerActivity(actionType, details, extraData = null) {
  setTimeout(() => {
    try {
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

      if (state.appsScriptUrl && navigator.onLine) {
        fetch(state.appsScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          cache: 'no-cache',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
    } catch (e) {
      // Non-blocking silent catch
    }
  }, 20);
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
 * จัดลำดับเส้นทางแบบวงรอบ 2-Opt TSP (ป้องกันเส้นทางตัดกัน/ทับกัน และวนกลับมาจบที่จุดเริ่มต้น)
 */
function optimizeStopsSequence(stops, startLat = null, startLng = null) {
  if (!stops || stops.length <= 1) return stops;

  const stopsWithCoords = stops.filter(s => s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng) && s.lat > 0 && s.lng > 0);
  const stopsWithoutCoords = stops.filter(s => !s.lat || !s.lng || isNaN(s.lat) || isNaN(s.lng) || s.lat <= 0 || s.lng <= 0);

  if (stopsWithCoords.length <= 1) return stops;

  const hubLat = (startLat !== null && !isNaN(startLat)) ? startLat : (stopsWithCoords[0]?.lat || 17.4138);
  const hubLng = (startLng !== null && !isNaN(startLng)) ? startLng : (stopsWithCoords[0]?.lng || 102.7872);

  // ขั้นที่ 1: จัดเรียงจุดตามมุมเรเดียนรอบจุดเริ่มต้น (Polar Angle Sweep) เพื่อสร้างเส้นรอบวงเริ่มต้นที่ลื่นไหล
  const withAngles = stopsWithCoords.map(s => {
    const dLat = s.lat - hubLat;
    const dLng = s.lng - hubLng;
    const angle = Math.atan2(dLng, dLat);
    return { stop: s, angle };
  });

  withAngles.sort((a, b) => a.angle - b.angle);
  let tour = withAngles.map(item => item.stop);

  // ขั้นที่ 2: รัน 2-Opt Algorithm เพื่อแก้เส้นทางที่ตัดกันหรือทับซ้อนกัน (Uncrossing intersecting segments)
  let improved = true;
  let maxIterations = 60;
  let iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const prevA = (i === 0) ? { lat: hubLat, lng: hubLng } : tour[i - 1];
        const a = tour[i];
        const b = tour[k];
        const nextB = (k === tour.length - 1) ? { lat: hubLat, lng: hubLng } : tour[k + 1];

        const currentDist = calculateHaversineDistance(prevA.lat, prevA.lng, a.lat, a.lng) +
                            calculateHaversineDistance(b.lat, b.lng, nextB.lat, nextB.lng);

        const newDist = calculateHaversineDistance(prevA.lat, prevA.lng, b.lat, b.lng) +
                        calculateHaversineDistance(a.lat, a.lng, nextB.lat, nextB.lng);

        if (newDist < currentDist - 0.0001) {
          const newTour = tour.slice(0, i)
            .concat(tour.slice(i, k + 1).reverse())
            .concat(tour.slice(k + 1));
          tour = newTour;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  // คำนวณระยะทางแต่ละช่วง
  let prevLat = hubLat;
  let prevLng = hubLng;
  tour.forEach((s) => {
    s.legDistanceKm = calculateHaversineDistance(prevLat, prevLng, s.lat, s.lng);
    prevLat = s.lat;
    prevLng = s.lng;
  });

  stopsWithoutCoords.forEach(s => {
    s.legDistanceKm = 0;
  });

  return [...tour, ...stopsWithoutCoords];
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
 * ฟังก์ชันกลางสำหรับสกัดรายการหมายจากชุดข้อความ (แต่ละบรรทัด)
 */
function extractDispatchRecordsFromLines(lines) {
  const records = [];
  const caseRegex = /([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line) continue;

    // ข้ามบรรทัดหัวเอกสาร
    if (
      line.includes('บัญชีจ่ายหมาย') ||
      line.includes('ศาลจังหวัด') ||
      line.includes('พนักงานศาลนี้ส่ง') ||
      line.includes('เลขดำที่') ||
      line.includes('ชื่อผู้รับ') ||
      line.includes('หน้าที่') ||
      line.includes('รวมจ่ายหมาย')
    ) {
      continue;
    }

    const matches = line.match(caseRegex);
    if (!matches || matches.length === 0) continue;

    // คัดกรองกฎ "ต": หากมีหลายเลขคดีและมีเลขที่ขึ้นต้นด้วย ต ให้ใช้เฉพาะเลข ต
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
      const hmMatch = line.match(/(\d+(?:\/\d+)?)\s*(?:ม\.?|หมู่)\s*(\d+|-)/);
      if (hmMatch) {
        houseNo = hmMatch[1];
        moo = (hmMatch[2] !== '-') ? hmMatch[2] : '';
      } else {
        // หาบ้านเลขที่โดดๆ โดยไม่เอาเลขจากเลขคดี
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

    if (!records.some(r => r.caseNumber === primaryCase)) {
      records.push({
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

  return records;
}

/**
 * สกัดข้อมูลตารางบัญชีจ่ายหมายจากไฟล์ PDF (รองรับทั้ง Digital Text PDF และ Scanned Image PDF ทุกหน้า)
 * @param {File} file - ไฟล์ PDF
 * @param {Function} [onProgress] - Callback % ความคืบหน้า
 * @returns {Promise<Array>} รายการหมายที่สกัดได้ทั้งหมด
 */
async function parsePdfDispatchFile(file, onProgress) {
  if (!window.pdfjsLib) throw new Error('ไม่พบไลบรารี pdf.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allRecords = [];
  const numPages = pdf.numPages;

  const caseRegex = /([ตพดขฝผบมฟวยอเสEะ\.\s]{1,12}\d{1,6}\s*\/\s*\d{2,4})/gi;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (onProgress) onProgress(Math.round(((pageNum - 1) / numPages) * 100), `กำลังวิเคราะห์ PDF หน้า ${pageNum}/${numPages}...`);

    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rawItems = (textContent.items || []).filter(it => (it.str || '').trim().length > 0);

    let pageRecords = [];

    // กรณีที่ 1: ตรวจสอบ Text Layer ของ PDF
    if (rawItems.length > 0) {
      // รวมข้อความที่อยู่บนบรรทัดเดียวกัน (Line Grouping)
      const lineMap = new Map();
      rawItems.forEach(item => {
        const text = (item.str || '').trim();
        if (!text) return;
        const y = Math.round(item.transform[5]);
        const x = Math.round(item.transform[4]);
        
        let foundKey = null;
        for (const key of lineMap.keys()) {
          if (Math.abs(key - y) <= 4) {
            foundKey = key;
            break;
          }
        }
        const lineKey = foundKey !== null ? foundKey : y;
        if (!lineMap.has(lineKey)) lineMap.set(lineKey, []);
        lineMap.get(lineKey).push({ x, text, width: item.width || 0 });
      });

      // เรียงบรรทัดจากบนลงล่าง
      const sortedLines = Array.from(lineMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(entry => {
          // เรียงคำในบรรทัดจากซ้ายไปขวา
          const sortedWords = entry[1].sort((a, b) => a.x - b.x);
          return sortedWords.map(w => w.text).join(' ');
        });

      // ลองสกัดข้อมูลจาก Text Lines
      pageRecords = extractDispatchRecordsFromLines(sortedLines);
    }

    // กรณีที่ 2: หากหน้า PDF นี้ไม่มี Text Layer หรือเป็นภาพสแกน ให้ใช้ Canvas + Tesseract OCR
    if (pageRecords.length === 0 && window.Tesseract) {
      if (onProgress) onProgress(Math.round(((pageNum - 0.5) / numPages) * 100), `กำลัง OCR ตรวจสอบภาพสแกน หน้า ${pageNum}/${numPages}...`);

      try {
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        // Contrast enhancement
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const cv = (v > 130) ? Math.min(255, v * 1.15) : Math.max(0, v * 0.85);
          d[i] = cv;
          d[i + 1] = cv;
          d[i + 2] = cv;
        }
        ctx.putImageData(imgData, 0, 0);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const worker = await Tesseract.createWorker('tha+eng', 1);
        const ret = await worker.recognize(blob);
        await worker.terminate();

        const ocrText = (ret.data.text || '')
          .replace(/([ผพ])\s*[บB]\s*[Eе]/gi, '$1บE')
          .replace(/([ผพ])\s*[บB]\s*[\.\s]*ส/gi, '$1บ ส')
          .replace(/([ตพดขฝผบมฟวยอเสEะ])\s+(\d+)/gi, '$1$2')
          .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2');

        const ocrLines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
        pageRecords = extractDispatchRecordsFromLines(ocrLines);
      } catch (ocrErr) {
        console.warn(`OCR fallback error on page ${pageNum}:`, ocrErr);
      }
    }

    // รวมรายการจากหน้านี้เข้า allRecords (ป้องกันซ้ำ)
    pageRecords.forEach(rec => {
      if (!allRecords.some(r => r.caseNumber === rec.caseNumber)) {
        allRecords.push(rec);
      }
    });
  }

  if (onProgress) onProgress(100, `วิเคราะห์ครบทุกหน้าเรียบร้อย (พบทั้งหมด ${allRecords.length} รายการ)`);
  return allRecords;
}

/**
 * สกัดข้อมูลตารางบัญชีจ่ายหมายจากไฟล์ภาพ (รองรับการอัพโหลดหลายไฟล์ พร้อม Canvas Contrast Preprocessing & OCR)
 * @param {FileList|File[]} files - รายการไฟล์ภาพ
 * @param {Function} [onProgress] - Callback % ความคืบหน้า
 * @returns {Promise<Array>} รายการหมายที่สกัดได้
 */
async function parseImageDispatchFiles(files, onProgress) {
  if (!window.Tesseract) throw new Error('ไม่พบไลบรารี Tesseract.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');

  const allRecords = [];
  const total = files.length;

  for (let idx = 0; idx < total; idx++) {
    const file = files[idx];
    if (onProgress) onProgress(Math.round((idx / total) * 100), `กำลังวิเคราะห์ภาพ ${idx + 1}/${total}: ${file.name}`);

    let processedBlob = file;
    try {
      const imgBitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const scale = Math.max(1, Math.min(2.5, 2200 / imgBitmap.width));
      canvas.width = Math.round(imgBitmap.width * scale);
      canvas.height = Math.round(imgBitmap.height * scale);

      ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

      // Contrast enhancement
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
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
          onProgress(filePct, `กำลัง OCR ภาพ ${idx + 1}/${total}: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const ret = await worker.recognize(processedBlob);
    await worker.terminate();

    const rawText = ret.data.text || '';
    const cleanedText = rawText
      .replace(/[|]/g, ' ')
      .replace(/([ผพ])\s*[บB]\s*[Eе]/gi, '$1บE')
      .replace(/([ผพ])\s*[บB]\s*[\.\s]*ส/gi, '$1บ ส')
      .replace(/([ตพดขฝผบมฟวยอเสEะ])\s+(\d+)/gi, '$1$2')
      .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2');

    const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);
    const fileRecords = extractDispatchRecordsFromLines(lines);

    fileRecords.forEach(rec => {
      if (!allRecords.some(r => r.caseNumber === rec.caseNumber)) {
        allRecords.push(rec);
      }
    });
  }

  if (onProgress) onProgress(100, `OCR เสร็จสิ้นทุกภาพ (พบทั้งหมด ${allRecords.length} รายการ)`);
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

  // คัดลอกรายการ Stops ปัจจุบันมาเป็น Staged Stops ใน Modal (แบบตัด Circular Structure ทิ้ง 100%)
  state.stagedScheduleStops = cleanStopsForStorage(state.currentRouteStops || []);
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
            <span>2. สืบค้น & จัดรายการส่งหมาย</span>
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

        <!-- Tab 2: สืบค้นและเลือกรายการตารางส่งหมาย (DataTables Multi-Column Search & Multi-Select) -->
        <div id="modalTabContentSchedule" class="hidden space-y-3">
          <p class="text-gray-600 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-xs">
            <i class="fa-solid fa-magnifying-glass text-emerald-600 mr-1"></i>
            สืบค้นข้อมูลจากทุกคอลัมน์ในระบบ (เลขคดี, ที่อยู่, ตำบล, อำเภอ ฯลฯ) ติ๊กถูกหน้ารายการที่ต้องการส่งหมายเพื่อนำเข้าสู่ <strong>"ลำดับเส้นทางส่งหมาย"</strong>
          </p>

          <!-- Search & Multi-Select Stats Bar -->
          <div class="space-y-2 bg-gray-50 border border-gray-200 rounded-2xl p-2.5">
            <div class="flex gap-2 items-center">
              <div class="relative flex-1">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                <input type="text" id="schedSearchInput" placeholder="พิมพ์ค้นหาทุกคอลัมน์ เช่น เลขดำ, บ้านเลขที่, ตำบล, อำเภอ..." class="w-full bg-white border border-gray-300 rounded-xl pl-8 pr-3 py-2 text-xs font-semibold text-gray-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" autocomplete="off" oninput="filterScheduleSearchTable(this.value)">
              </div>
              <button type="button" onclick="document.getElementById('schedSearchInput').value=''; filterScheduleSearchTable('');" class="px-2.5 py-2 text-xs text-gray-500 hover:text-red-600 bg-white border border-gray-200 rounded-xl cursor-pointer" title="ล้างการค้นหา">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div class="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-gray-200 text-xs">
              <div class="flex items-center gap-2">
                <span class="font-bold text-gray-800">เลือกแล้ว: <strong id="schedSelectedCountBadge" class="text-emerald-700 font-extrabold text-sm">0</strong> รายการ</span>
                <span class="text-[11px] text-gray-400">|</span>
                <span class="text-[11px] text-gray-500" id="schedFoundCountText">พบ 0 รายการ</span>
              </div>
              <div class="flex items-center gap-1.5">
                <button type="button" onclick="toggleSelectAllSchedItems(true)" class="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer transition">
                  <i class="fa-solid fa-check-double mr-0.5"></i> เลือกที่แสดงทั้งหมด
                </button>
                <button type="button" onclick="toggleSelectAllSchedItems(false)" class="px-2.5 py-1 text-[11px] font-semibold text-gray-600 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg cursor-pointer transition">
                  <i class="fa-solid fa-square-minus mr-0.5"></i> ยกเลิกทั้งหมด
                </button>
              </div>
            </div>
          </div>

          <!-- DataTables Table Container -->
          <div class="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-xs">
            <div class="max-h-60 overflow-y-auto overflow-x-auto slts-swal-body-scroll">
              <table class="w-full text-left text-xs border-collapse" id="schedDataTable">
                <thead class="bg-gray-100 sticky top-0 z-10 text-gray-700 font-bold border-b border-gray-200 shadow-xs">
                  <tr>
                    <th class="p-2 w-10 text-center">
                      <input type="checkbox" id="schedHeaderCheckbox" onchange="toggleHeaderSelectAll(this.checked)" class="w-4 h-4 rounded text-blue-600 cursor-pointer">
                    </th>
                    <th class="p-2 whitespace-nowrap">เลขคดี</th>
                    <th class="p-2 min-w-[150px]">ที่อยู่ส่งหมาย</th>
                    <th class="p-2 whitespace-nowrap">ตำบล</th>
                    <th class="p-2 whitespace-nowrap">อำเภอ</th>
                    <th class="p-2 whitespace-nowrap">จังหวัด</th>
                    <th class="p-2 whitespace-nowrap text-center">สถานะหมุด</th>
                  </tr>
                </thead>
                <tbody id="schedDataTableBody" class="divide-y divide-gray-100 font-normal text-gray-700">
                  <!-- Injected by JS -->
                </tbody>
              </table>
            </div>
          </div>

          <!-- Quick Accordion for Custom/Manual Add (Optional fallback) -->
          <div class="border border-dashed border-gray-300 rounded-xl p-2.5 bg-gray-50/50">
            <div class="flex items-center justify-between cursor-pointer" onclick="toggleCustomScheduleForm()">
              <span class="font-bold text-xs text-blue-700 flex items-center gap-1.5">
                <i class="fa-solid fa-plus-circle"></i> หรือพิมพ์เพิ่มรายการส่งหมายใหม่ด้วยตนเอง
              </span>
              <i id="icoToggleCustomForm" class="fa-solid fa-chevron-down text-gray-400 text-xs transition"></i>
            </div>
            <div id="customScheduleFormWrapper" class="hidden mt-2.5 pt-2 border-t border-gray-200 space-y-2">
              <div id="scheduleFormContainer">
                ${getSummonsFormHtml('sched_')}
              </div>
              <button type="button" onclick="handleAddOrUpdateScheduleItem()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition cursor-pointer">
                <i class="fa-solid fa-plus mr-1"></i> เพิ่มรายการนี้เข้าสู่ตาราง
              </button>
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
    width: '750px',
    customClass: { popup: 'rounded-2xl p-4 sm:p-5' },
    showCloseButton: true,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-check mr-1.5"></i> ยืนยัน (แสดงหมุดและเส้นทาง)',
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
          filterScheduleSearchTable(document.getElementById('schedSearchInput')?.value || '');
        } else if (tab === 'upload') {
          renderUploadedDispatchList();
        }
      };

      bindScheduleFormEvents('sched_');

      // ==========================================
      // DataTables Global Multi-Column Search & Multi-Select Engine
      // ==========================================
      window.schedTableRawRows = (state.allSheetRows || []).map((r, idx) => {
        const rCopy = { ...r };
        rCopy._rowIndex = idx;
        rCopy._stopItem = convertSheetRowToStopItem(r, idx);
        return rCopy;
      });

      window.currentFilteredSchedRows = [...window.schedTableRawRows];

      function convertSheetRowToStopItem(r, idx) {
        const rawLat = r['ละติจูด (Lat)'] || r['ละติจูด'] || '';
        const rawLng = r['ลองจิจูด (Lng)'] || r['ลองจิจูด'] || '';
        const lat = parseFloat(rawLat);
        const lng = parseFloat(rawLng);
        const hasCoords = !isNaN(lat) && !isNaN(lng) && lat > 0 && lng > 0;
        const caseNumber = (r['เลขคดี'] || '-').trim();
        const subdistrict = (r['ตำบล'] || '').trim();
        const district = (r['อำเภอ'] || '').trim();
        const province = getRowProvince(r) || currentProvince;
        const locationText = r['ที่ตั้งส่งหมาย (เต็ม)'] || r['ที่ตั้งส่งหมาย'] || (district ? `อ.${district} ต.${subdistrict}` : '-');

        return {
          id: 'stop_row_' + idx + '_' + (caseNumber !== '-' ? caseNumber.replace(/[^a-zA-Z0-9ก-๙]/g, '_') : Date.now()),
          caseNumber,
          courtType: (r['ประเภทศาล'] || '').trim(),
          prefix: '',
          caseNo: '',
          caseYear: '',
          caseExtra: '',
          locationType: 'หมายบ้าน',
          houseNo: (r['บ้านเลขที่'] || '').trim(),
          moo: (r['หมู่ที่'] || '').trim(),
          localAdminName: '',
          customOtherLocationName: '',
          locationText,
          subdistrict,
          district,
          province,
          lat: hasCoords ? lat : null,
          lng: hasCoords ? lng : null,
          imageUrl: extractRowImageUrl(r),
          dateTime: formatThaiDateDisplay(r['วัน-เวลาบันทึก'] || r['Timestamp'] || ''),
          matchType: hasCoords ? 'exact' : 'none',
          matchNote: hasCoords ? 'ตรงกับประวัติ (พบพิกัดจริง)' : 'ไม่มีหมุดในระบบ',
          isMatched: hasCoords,
          hasCoords
        };
      }

      function isStopInStaged(stop) {
        return (state.stagedScheduleStops || []).some(s => 
          s.id === stop.id || 
          (s.caseNumber && s.caseNumber !== '-' && s.caseNumber === stop.caseNumber && s.locationText === stop.locationText)
        );
      }

      window.filterScheduleSearchTable = function(query = '') {
        const tbody = document.getElementById('schedDataTableBody');
        const foundBadge = document.getElementById('schedFoundCountText');
        const selectedBadge = document.getElementById('schedSelectedCountBadge');
        if (selectedBadge) selectedBadge.textContent = (state.stagedScheduleStops || []).length;
        if (!tbody) return;

        const q = (query || '').trim().toLowerCase();
        const allRows = window.schedTableRawRows || [];

        window.currentFilteredSchedRows = allRows.filter(r => {
          if (!q) return true;
          // ตรวจสอบทุก column ใน object
          for (const key of Object.keys(r)) {
            if (key.startsWith('_')) continue;
            const val = String(r[key] || '').toLowerCase();
            if (val.includes(q)) return true;
          }
          return false;
        });

        if (foundBadge) foundBadge.textContent = `พบ ${window.currentFilteredSchedRows.length} รายการ`;

        if (window.currentFilteredSchedRows.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="7" class="py-8 text-center text-gray-400 text-xs">
                <i class="fa-solid fa-magnifying-glass text-2xl mb-1 text-gray-300"></i>
                <p>ไม่พบรายการที่ตรงกับคำค้นหา "${escapeHtml(query)}"</p>
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = window.currentFilteredSchedRows.map((r) => {
          const stop = r._stopItem;
          const isSelected = isStopInStaged(stop);
          const hasCoords = stop.hasCoords;
          const statusBadge = hasCoords 
            ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ มีพิกัด</span>`
            : `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">○ ไม่มีพิกัด</span>`;

          const rowClass = isSelected 
            ? 'bg-blue-50/90 font-semibold border-l-4 border-l-blue-600 shadow-xs' 
            : 'hover:bg-gray-50/80 transition';

          return `
            <tr class="cursor-pointer transition select-none ${rowClass}" id="schedRow_${r._rowIndex}" onclick="toggleSchedRowSelect(${r._rowIndex}, event)">
              <td class="p-2 text-center" onclick="event.stopPropagation()">
                <input type="checkbox" id="schedChk_${r._rowIndex}" ${isSelected ? 'checked' : ''} onchange="toggleSchedRowSelect(${r._rowIndex})" class="w-4 h-4 rounded text-blue-600 cursor-pointer">
              </td>
              <td class="p-2 whitespace-nowrap font-bold text-gray-900">${stop.caseNumber}</td>
              <td class="p-2 text-gray-700 truncate max-w-[200px]" title="${stop.locationText}">${stop.locationText}</td>
              <td class="p-2 whitespace-nowrap text-gray-600">${stop.subdistrict || '-'}</td>
              <td class="p-2 whitespace-nowrap text-gray-600">${stop.district || '-'}</td>
              <td class="p-2 whitespace-nowrap text-gray-600">${stop.province || '-'}</td>
              <td class="p-2 whitespace-nowrap text-center">${statusBadge}</td>
            </tr>
          `;
        }).join('');

        updateHeaderCheckboxState();
      };

      window.toggleSchedRowSelect = function(rowIdx, ev) {
        const rowData = (window.schedTableRawRows || []).find(r => r._rowIndex === rowIdx);
        if (!rowData) return;

        const stop = rowData._stopItem;
        const existsIdx = (state.stagedScheduleStops || []).findIndex(s => 
          s.id === stop.id || 
          (s.caseNumber && s.caseNumber !== '-' && s.caseNumber === stop.caseNumber && s.locationText === stop.locationText)
        );

        const chk = document.getElementById(`schedChk_${rowIdx}`);
        const tr = document.getElementById(`schedRow_${rowIdx}`);

        if (existsIdx >= 0) {
          state.stagedScheduleStops.splice(existsIdx, 1);
          if (chk) chk.checked = false;
          if (tr) tr.className = 'hover:bg-gray-50/80 transition cursor-pointer select-none';
        } else {
          state.stagedScheduleStops.push(stop);
          if (chk) chk.checked = true;
          if (tr) tr.className = 'bg-blue-50/90 font-semibold border-l-4 border-l-blue-600 shadow-xs cursor-pointer transition select-none';
        }

        const selectedBadge = document.getElementById('schedSelectedCountBadge');
        if (selectedBadge) selectedBadge.textContent = state.stagedScheduleStops.length;
        updateHeaderCheckboxState();
      };

      window.toggleSelectAllSchedItems = function(select) {
        if (select) {
          (window.currentFilteredSchedRows || []).forEach(r => {
            const stop = r._stopItem;
            if (!isStopInStaged(stop)) {
              state.stagedScheduleStops.push(stop);
            }
          });
        } else {
          state.stagedScheduleStops = [];
        }
        filterScheduleSearchTable(document.getElementById('schedSearchInput')?.value || '');
      };

      window.toggleHeaderSelectAll = function(checked) {
        toggleSelectAllSchedItems(checked);
      };

      function updateHeaderCheckboxState() {
        const headerChk = document.getElementById('schedHeaderCheckbox');
        if (!headerChk) return;
        const currentFiltered = window.currentFilteredSchedRows || [];
        if (currentFiltered.length === 0) {
          headerChk.checked = false;
          return;
        }
        const allSelected = currentFiltered.every(r => isStopInStaged(r._stopItem));
        headerChk.checked = allSelected;
      }

      window.toggleCustomScheduleForm = function() {
        const wrapper = document.getElementById('customScheduleFormWrapper');
        const ico = document.getElementById('icoToggleCustomForm');
        if (!wrapper) return;
        const isHidden = wrapper.classList.contains('hidden');
        wrapper.classList.toggle('hidden', !isHidden);
        if (ico) ico.className = isHidden ? 'fa-solid fa-chevron-up text-blue-600 text-xs transition' : 'fa-solid fa-chevron-down text-gray-400 text-xs transition';
      };

      window.handleAddOrUpdateScheduleItem = function() {
        const data = extractSummonsFormData('sched_');
        if (!data.caseNumber && !data.houseNo && !data.localAdminName && !data.customOtherLocationName) {
          Swal.showValidationMessage('กรุณากรอกเลขคดี หรือระบุสถานที่ส่งหมาย');
          return;
        }

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

        state.stagedScheduleStops.push(stopItem);
        const selectedBadge = document.getElementById('schedSelectedCountBadge');
        if (selectedBadge) selectedBadge.textContent = state.stagedScheduleStops.length;

        // Reset form
        const formContainer = document.getElementById('scheduleFormContainer');
        if (formContainer) {
          formContainer.innerHTML = getSummonsFormHtml('sched_');
          bindScheduleFormEvents('sched_');
        }

        Swal.showValidationMessage('');
        filterScheduleSearchTable(document.getElementById('schedSearchInput')?.value || '');
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
            parsedRecords = await parsePdfDispatchFile(pdfFile, (pct, msg) => {
              if (progressBar) progressBar.style.width = `${pct}%`;
              if (percentText) percentText.textContent = `${pct}%`;
              if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`;
            });

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
        state.stagedScheduleStops = cleanStopsForStorage(records);
        
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
/**
 * เปิด Modal ค้นหาจุดใน Google Map / แผนที่ และตั้งค่าจุดเริ่มต้น & จุดสิ้นสุดการเดินทาง
 * รองรับทั้งการพิมพ์ค้นหาสถานที่, วางพิกัด, วางลิงก์ Google Maps และเลือกเป็นจุดเริ่มหรือจุดสิ้นสุดได้อิสระ
 */
window.openStartPointConfigModal = function() {
  const currentStart = state.routeStartLocation || { name: 'ศาลจังหวัดอุดรธานี (ค่าเริ่มต้น)', lat: 17.4138, lng: 102.7872 };
  const currentEnd = state.routeEndLocation || { name: '', lat: null, lng: null, enabled: false };

  let activeConfigTab = 'start'; // 'start' | 'end'
  let searchResultsCache = [];

  const modalHtml = `
    <div class="text-left text-xs space-y-3.5 select-none max-h-[68vh] overflow-y-auto pr-1 slts-swal-body-scroll">
      
      <!-- ส่วนค้นหาจุดใน Google Map / แผนที่ (Search Bar) -->
      <div class="p-3.5 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border border-blue-200 rounded-2xl space-y-2.5">
        <label class="block font-bold text-gray-900 text-xs flex items-center justify-between">
          <span class="flex items-center gap-1.5 text-blue-800">
            <i class="fa-solid fa-magnifying-glass-location text-blue-600"></i>
            <span>ค้นหาสถานที่ใน Google Map / แผนที่</span>
          </span>
          <span class="text-[10px] text-gray-500 font-normal">รองรับชื่อสถานที่, พิกัด หรือ ลิงก์ Google Maps</span>
        </label>
        
        <div class="flex items-center gap-2">
          <div class="relative flex-1">
            <input type="text" id="mapLocationSearchInput" placeholder="พิมพ์ชื่อสถานที่ เช่น ศาลแขวงอุดรธานี, พิกัด หรือวางลิงก์ Maps..." class="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-xl pl-8 pr-3 py-2 text-xs text-gray-800 shadow-2xs font-medium">
            <i class="fa-solid fa-location-dot absolute left-2.5 top-2.5 text-gray-400 text-xs"></i>
          </div>
          <button type="button" id="btnExecuteMapSearch" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-xl text-xs shadow-sm transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer">
            <i class="fa-solid fa-magnifying-glass"></i>
            <span>ค้นหา</span>
          </button>
        </div>

        <!-- Quick Presets -->
        <div class="flex items-center gap-2 flex-wrap pt-0.5 text-[11px]">
          <span class="text-[10px] font-bold text-gray-500">ทางลัด:</span>
          <button type="button" onclick="applyPresetLocation('court', 'start')" class="px-2 py-1 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg font-semibold text-blue-700 transition flex items-center gap-1 cursor-pointer">
            <i class="fa-solid fa-landmark text-blue-600"></i> ศาลจังหวัดอุดรธานี
          </button>
          <button type="button" onclick="applyPresetLocation('gps', 'start')" class="px-2 py-1 bg-white hover:bg-emerald-50 border border-emerald-200 rounded-lg font-semibold text-emerald-700 transition flex items-center gap-1 cursor-pointer">
            <i class="fa-solid fa-location-crosshairs text-emerald-600"></i> ดึง GPS ปัจจุบัน
          </button>
        </div>

        <!-- Search Results Box -->
        <div id="mapSearchResultsContainer" class="hidden space-y-1.5 pt-1.5 border-t border-blue-200/70">
          <div class="flex items-center justify-between text-[11px] font-bold text-gray-700">
            <span>ผลการค้นหาสถานที่:</span>
            <span id="mapSearchResultsCount" class="text-blue-600">0 รายการ</span>
          </div>
          <div id="mapSearchResultsList" class="space-y-1.5 max-h-40 overflow-y-auto slts-swal-body-scroll">
            <!-- Results Injected Here -->
          </div>
        </div>
      </div>

      <!-- Tab Switcher: กำหนดจุดเริ่มต้น VS จุดสิ้นสุด -->
      <div class="flex border-b border-gray-200 text-xs">
        <button type="button" id="tabBtnConfigStart" onclick="switchConfigModalTab('start')" class="flex-1 py-2.5 font-bold text-blue-700 border-b-2 border-blue-600 transition flex items-center justify-center gap-1.5 cursor-pointer">
          <i class="fa-solid fa-flag-checkered text-blue-600"></i>
          <span>1. จุดเริ่มต้นการเดินทาง</span>
        </button>
        <button type="button" id="tabBtnConfigEnd" onclick="switchConfigModalTab('end')" class="flex-1 py-2.5 font-bold text-gray-500 hover:text-violet-700 border-b-2 border-transparent transition flex items-center justify-center gap-1.5 cursor-pointer">
          <i class="fa-solid fa-flag text-violet-600"></i>
          <span>2. จุดสิ้นสุดการเดินทาง (กำหนดเอง)</span>
        </button>
      </div>

      <!-- Tab Content 1: จุดเริ่มต้น (Start Point) -->
      <div id="configTabContentStart" class="space-y-3 p-1">
        <div>
          <label class="block font-bold text-gray-800 mb-1">
            <i class="fa-solid fa-map-pin text-blue-600 mr-1"></i> ชื่อจุดเริ่มต้น: <span class="text-red-500">*</span>
          </label>
          <input type="text" id="cfgStartName" value="${currentStart.name || 'ศาลจังหวัดอุดรธานี'}" class="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block font-bold text-gray-800 mb-1">ละติจูด (Lat): <span class="text-red-500">*</span></label>
            <input type="text" id="cfgStartLat" value="${currentStart.lat || 17.4138}" class="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-semibold">
          </div>
          <div>
            <label class="block font-bold text-gray-800 mb-1">ลองจิจูด (Lng): <span class="text-red-500">*</span></label>
            <input type="text" id="cfgStartLng" value="${currentStart.lng || 102.7872}" class="w-full bg-white border border-gray-300 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-semibold">
          </div>
        </div>
      </div>

      <!-- Tab Content 2: จุดสิ้นสุด (End Point) -->
      <div id="configTabContentEnd" class="hidden space-y-3 p-1">
        <div class="p-3 bg-violet-50/80 border border-violet-200 rounded-xl flex items-center justify-between">
          <div>
            <span class="font-bold text-violet-900 block text-xs">เปิดใช้งานจุดสิ้นสุดเฉพาะ</span>
            <span class="text-[10px] text-violet-700">คำนวณและลากเส้นทางไปยังจุดหมายปลายทางที่กำหนดนี้เมื่อส่งหมายครบทุกจุด</span>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="cfgEndEnabled" ${currentEnd.enabled ? 'checked' : ''} class="sr-only peer" onchange="toggleEndInputs(this.checked)">
            <div class="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
          </label>
        </div>

        <div id="endInputsWrapper" class="${currentEnd.enabled ? '' : 'opacity-50 pointer-events-none'} space-y-3 transition">
          <div>
            <label class="block font-bold text-gray-800 mb-1">
              <i class="fa-solid fa-flag text-violet-600 mr-1"></i> ชื่อจุดสิ้นสุด (ปลายทาง):
            </label>
            <input type="text" id="cfgEndName" value="${currentEnd.name || ''}" placeholder="เช่น ศาลจังหวัดอุดรธานี หรือ ที่ว่าการอำเภอ..." class="w-full bg-white border border-gray-300 focus:border-violet-500 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800">
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block font-bold text-gray-800 mb-1">ละติจูด (Lat):</label>
              <input type="text" id="cfgEndLat" value="${currentEnd.lat || ''}" placeholder="เช่น 17.4138" class="w-full bg-white border border-gray-300 focus:border-violet-500 rounded-xl px-3 py-2 text-xs font-mono font-semibold">
            </div>
            <div>
              <label class="block font-bold text-gray-800 mb-1">ลองจิจูด (Lng):</label>
              <input type="text" id="cfgEndLng" value="${currentEnd.lng || ''}" placeholder="เช่น 102.7872" class="w-full bg-white border border-gray-300 focus:border-violet-500 rounded-xl px-3 py-2 text-xs font-mono font-semibold">
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  Swal.fire({
    title: '<div class="flex items-center justify-center gap-2 text-base font-bold text-gray-900"><i class="fa-solid fa-map-location-dot text-blue-600"></i> ค้นหาพิกัด & กำหนดจุดเริ่มต้น / จุดสิ้นสุด</div>',
    html: modalHtml,
    width: '740px',
    customClass: {
      popup: 'rounded-3xl p-5 max-w-[95vw] max-h-[90vh]'
    },
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-floppy-disk mr-1"></i> บันทึกการตั้งค่า',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#6b7280',
    didOpen: () => {
      const searchInput = document.getElementById('mapLocationSearchInput');
      const btnSearch = document.getElementById('btnExecuteMapSearch');
      const resultsContainer = document.getElementById('mapSearchResultsContainer');
      const resultsList = document.getElementById('mapSearchResultsList');
      const countEl = document.getElementById('mapSearchResultsCount');

      window.switchConfigModalTab = function(tab) {
        activeConfigTab = tab;
        const btnStart = document.getElementById('tabBtnConfigStart');
        const btnEnd = document.getElementById('tabBtnConfigEnd');
        const cntStart = document.getElementById('configTabContentStart');
        const cntEnd = document.getElementById('configTabContentEnd');

        const activeStartCls = 'flex-1 py-2.5 font-bold text-blue-700 border-b-2 border-blue-600 transition flex items-center justify-center gap-1.5 cursor-pointer';
        const activeEndCls = 'flex-1 py-2.5 font-bold text-violet-700 border-b-2 border-violet-600 transition flex items-center justify-center gap-1.5 cursor-pointer';
        const inactiveCls = 'flex-1 py-2.5 font-bold text-gray-500 hover:text-gray-700 border-b-2 border-transparent transition flex items-center justify-center gap-1.5 cursor-pointer';

        if (tab === 'start') {
          if (btnStart) btnStart.className = activeStartCls;
          if (btnEnd) btnEnd.className = inactiveCls;
          if (cntStart) cntStart.classList.remove('hidden');
          if (cntEnd) cntEnd.classList.add('hidden');
        } else {
          if (btnStart) btnStart.className = inactiveCls;
          if (btnEnd) btnEnd.className = activeEndCls;
          if (cntStart) cntStart.classList.add('hidden');
          if (cntEnd) cntEnd.classList.remove('hidden');
        }
      };

      window.toggleEndInputs = function(enabled) {
        const wrapper = document.getElementById('endInputsWrapper');
        if (wrapper) {
          if (enabled) {
            wrapper.classList.remove('opacity-50', 'pointer-events-none');
          } else {
            wrapper.classList.add('opacity-50', 'pointer-events-none');
          }
        }
      };

      window.applyPresetLocation = function(type, target) {
        const nameInput = target === 'start' ? document.getElementById('cfgStartName') : document.getElementById('cfgEndName');
        const latInput = target === 'start' ? document.getElementById('cfgStartLat') : document.getElementById('cfgEndLat');
        const lngInput = target === 'start' ? document.getElementById('cfgStartLng') : document.getElementById('cfgEndLng');

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

      window.selectSearchResult = function(idx, assignTarget) {
        const item = searchResultsCache[idx];
        if (!item) return;

        if (assignTarget === 'start') {
          const nameInput = document.getElementById('cfgStartName');
          const latInput = document.getElementById('cfgStartLat');
          const lngInput = document.getElementById('cfgStartLng');
          if (nameInput) nameInput.value = item.name;
          if (latInput) latInput.value = item.lat;
          if (lngInput) lngInput.value = item.lng;
          switchConfigModalTab('start');
        } else {
          const chkEnd = document.getElementById('cfgEndEnabled');
          if (chkEnd) {
            chkEnd.checked = true;
            toggleEndInputs(true);
          }
          const nameInput = document.getElementById('cfgEndName');
          const latInput = document.getElementById('cfgEndLat');
          const lngInput = document.getElementById('cfgEndLng');
          if (nameInput) nameInput.value = item.name;
          if (latInput) latInput.value = item.lat;
          if (lngInput) lngInput.value = item.lng;
          switchConfigModalTab('end');
        }
      };

      const executeSearch = async () => {
        const q = (searchInput?.value || '').trim();
        if (!q) return;

        // ตรวจสอบพิกัดโดยตรงก่อน (e.g. 17.4138, 102.7872 or Google Maps Link)
        const coordMatch = q.match(/(-?\d+\.\d+)[\s,]+(-?\d+\.\d+)/);
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lng = parseFloat(coordMatch[2]);
          searchResultsCache = [{
            name: `พิกัดระบุ: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            subText: 'พิกัดที่กรอก / ถอดรหัสจากลิงก์',
            lat: lat.toFixed(6),
            lng: lng.toFixed(6)
          }];
          renderSearchResults();
          return;
        }

        if (btnSearch) {
          btnSearch.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
          btnSearch.disabled = true;
        }

        try {
          const queryParam = encodeURIComponent(q);
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${queryParam}&countrycodes=th&limit=5`, {
            headers: { 'User-Agent': 'SLTS-Location-Search/1.0' },
            signal: AbortSignal.timeout(6000)
          });
          if (!res.ok) throw new Error('Search request failed');
          const data = await res.json();
          searchResultsCache = (data || []).map(item => {
            const parts = (item.display_name || '').split(',').map(s => s.trim());
            const shortName = parts[0] || q;
            const sub = parts.slice(1, 4).join(', ');
            return {
              name: shortName,
              subText: sub || item.display_name,
              lat: parseFloat(item.lat).toFixed(6),
              lng: parseFloat(item.lon).toFixed(6)
            };
          });

          renderSearchResults();
        } catch (err) {
          console.warn('Location search error:', err);
          if (resultsContainer) resultsContainer.classList.remove('hidden');
          if (resultsList) {
            resultsList.innerHTML = `<div class="p-2 text-center text-gray-400 text-xs">ไม่พบสถานที่ที่ค้นหา หรือการเชื่อมต่อขัดข้อง</div>`;
          }
        } finally {
          if (btnSearch) {
            btnSearch.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> <span>ค้นหา</span>';
            btnSearch.disabled = false;
          }
        }
      };

      const renderSearchResults = () => {
        if (!resultsContainer || !resultsList) return;
        resultsContainer.classList.remove('hidden');
        if (countEl) countEl.textContent = `${searchResultsCache.length} รายการ`;

        if (searchResultsCache.length === 0) {
          resultsList.innerHTML = `<div class="p-3 text-center text-gray-400 text-xs">ไม่พบสถานที่ที่ตรงกับคำค้นหา</div>`;
          return;
        }

        resultsList.innerHTML = searchResultsCache.map((item, idx) => `
          <div class="p-2 bg-white rounded-xl border border-gray-200 hover:border-blue-300 transition flex items-center justify-between gap-2 shadow-2xs">
            <div class="min-w-0 flex-1 text-left">
              <div class="font-bold text-gray-900 truncate text-[11px]">${item.name}</div>
              <div class="text-[10px] text-gray-500 truncate">${item.subText}</div>
              <div class="text-[9px] font-mono text-blue-600 font-semibold">${item.lat}, ${item.lng}</div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button type="button" onclick="selectSearchResult(${idx}, 'start')" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-[10px] transition cursor-pointer" title="ตั้งเป็นจุดเริ่มต้น">
                <i class="fa-solid fa-flag-checkered mr-0.5"></i> จุดเริ่ม
              </button>
              <button type="button" onclick="selectSearchResult(${idx}, 'end')" class="px-2 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 font-bold rounded-lg text-[10px] transition cursor-pointer" title="ตั้งเป็นจุดสิ้นสุด">
                <i class="fa-solid fa-flag mr-0.5"></i> จุดสิ้นสุด
              </button>
            </div>
          </div>
        `).join('');
      };

      if (btnSearch) btnSearch.onclick = executeSearch;
      if (searchInput) {
        searchInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            executeSearch();
          }
        };
      }
    },
    preConfirm: () => {
      const startName = (document.getElementById('cfgStartName')?.value || 'จุดเริ่มต้น').trim();
      const startLat = parseFloat(document.getElementById('cfgStartLat')?.value);
      const startLng = parseFloat(document.getElementById('cfgStartLng')?.value);

      if (isNaN(startLat) || isNaN(startLng) || startLat <= 0 || startLng <= 0) {
        Swal.showValidationMessage('กรุณาระบุพิกัดจุดเริ่มต้นให้ถูกต้อง');
        return false;
      }

      const endEnabled = document.getElementById('cfgEndEnabled')?.checked || false;
      let endLocation = { name: '', lat: null, lng: null, enabled: false };

      if (endEnabled) {
        const endName = (document.getElementById('cfgEndName')?.value || 'จุดสิ้นสุด').trim();
        const endLat = parseFloat(document.getElementById('cfgEndLat')?.value);
        const endLng = parseFloat(document.getElementById('cfgEndLng')?.value);

        if (isNaN(endLat) || isNaN(endLng) || endLat <= 0 || endLng <= 0) {
          Swal.showValidationMessage('กรุณาระบุพิกัดจุดสิ้นสุดให้ถูกต้อง หรือปิดการใช้งานจุดสิ้นสุด');
          return false;
        }
        endLocation = { name: endName, lat: endLat, lng: endLng, enabled: true };
      }

      return {
        startLocation: { name: startName, lat: startLat, lng: startLng, isCustom: true },
        endLocation: endLocation
      };
    }
  }).then((res) => {
    if (res.isConfirmed && res.value) {
      state.routeStartLocation = res.value.startLocation;
      state.routeEndLocation = res.value.endLocation;
      updateStartLocationUI();
      recalculateRouteFromStops();
    }
  });
};

/**
 * อัปเดต UI แถบจุดเริ่มต้นและจุดสิ้นสุดใน Sidebar
 */
function updateStartLocationUI() {
  const nameBadge = document.getElementById('routeStartPointNameBadge');
  const coordsBadge = document.getElementById('routeStartPointCoordsBadge');
  if (nameBadge && state.routeStartLocation) nameBadge.textContent = state.routeStartLocation.name;
  if (coordsBadge && state.routeStartLocation) coordsBadge.textContent = `${state.routeStartLocation.lat.toFixed(4)}, ${state.routeStartLocation.lng.toFixed(4)}`;

  const endContainer = document.getElementById('routeCustomEndBadgeContainer');
  const endNameBadge = document.getElementById('routeEndPointNameBadge');
  const endCoordsBadge = document.getElementById('routeEndPointCoordsBadge');
  const roundTripLabel = document.getElementById('chkRouteRoundTripLabel');

  if (state.routeEndLocation && state.routeEndLocation.enabled && state.routeEndLocation.lat && state.routeEndLocation.lng) {
    if (endContainer) endContainer.classList.remove('hidden');
    if (endNameBadge) endNameBadge.textContent = state.routeEndLocation.name;
    if (endCoordsBadge) endCoordsBadge.textContent = `${Number(state.routeEndLocation.lat).toFixed(4)}, ${Number(state.routeEndLocation.lng).toFixed(4)}`;
    if (roundTripLabel) roundTripLabel.classList.add('opacity-50', 'pointer-events-none');
  } else {
    if (endContainer) endContainer.classList.add('hidden');
    if (roundTripLabel) roundTripLabel.classList.remove('opacity-50', 'pointer-events-none');
  }
}

/**
 * ยกเลิกการใช้งานจุดสิ้นสุดเฉพาะ
 */
window.clearCustomEndLocation = function() {
  state.routeEndLocation = { name: '', lat: null, lng: null, enabled: false };
  updateStartLocationUI();
  recalculateRouteFromStops();
};

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
let routeFetchSeq = 0;

/**
 * ดึงข้อมูลเส้นทางและพิกัดถนนจริง (OSRM Real Road Driving Network)
 * ลากเส้นตามโครงข่ายถนนสัญจรหลักจริง ไม่ตัดผ่านพื้นที่ที่ไม่มีถนน
 */
async function fetchRealRoadRoute(coords) {
  if (!coords || coords.length < 2) return null;

  // แปลงพิกัดเป็น lng,lat ตามข้อกำหนดของ OSRM
  const coordQuery = coords.map(c => `${c[1]},${c[0]}`).join(';');
  const osrmUrl1 = `https://router.project-osrm.org/route/v1/driving/${coordQuery}?overview=full&geometries=geojson&steps=false&continue_straight=true`;
  const osrmUrl2 = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordQuery}?overview=full&geometries=geojson&steps=false&continue_straight=true`;

  try {
    let res = await fetch(osrmUrl1, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('OSRM mirror 1 error');
    let data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const route = data.routes[0];
      const roadLatLngs = route.geometry.coordinates.map(pt => [pt[1], pt[0]]);
      return {
        latLngs: roadLatLngs,
        distanceKm: route.distance / 1000,
        durationMin: route.duration / 60
      };
    }
  } catch (err1) {
    try {
      let res2 = await fetch(osrmUrl2, { signal: AbortSignal.timeout(6000) });
      if (res2.ok) {
        let data2 = await res2.json();
        if (data2.code === 'Ok' && data2.routes && data2.routes[0]) {
          const route = data2.routes[0];
          const roadLatLngs = route.geometry.coordinates.map(pt => [pt[1], pt[0]]);
          return {
            latLngs: roadLatLngs,
            distanceKm: route.distance / 1000,
            durationMin: route.duration / 60
          };
        }
      }
    } catch (err2) {
      console.warn('OSRM routing failed:', err2);
    }
  }
  return null;
}

/**
 * คำนวณและเรนเดอร์เส้นทางใหม่จากลำดับใน state.currentRouteStops (ลากเส้นเฉพาะจุดที่มีหมุดพิกัด)
 * พร้อมระบบลากเส้นบนโครงข่ายถนนสัญจรหลักจริง (Real Road Routing) และ Pop Up แสดงภาพ
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

  // 3. จุดสิ้นสุดการเดินทาง (กำหนดเอง / Custom Destination หรือ วนกลับ Round Trip)
  if (state.routeEndLocation && state.routeEndLocation.enabled && state.routeEndLocation.lat && state.routeEndLocation.lng) {
    const end = state.routeEndLocation;
    bounds.push([end.lat, end.lng]);
    polylineCoords.push([end.lat, end.lng]);
    const legDist = calculateHaversineDistance(prevLat, prevLng, end.lat, end.lng);
    totalDistanceKm += legDist;
    prevLat = end.lat;
    prevLng = end.lng;

    const endIcon = L.divIcon({
      html: `
        <div class="slts-map-pin-marker" title="จุดสิ้นสุด: ${end.name}">
          <div class="slts-pin-badge end-dest-pin" style="background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; border: 2px solid #ffffff; box-shadow: 0 4px 10px rgba(99, 102, 241, 0.4);">
            <span>🏁</span>
          </div>
        </div>
      `,
      className: 'slts-custom-div-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28]
    });

    const endMarker = L.marker([end.lat, end.lng], { icon: endIcon })
      .bindPopup(`<div class="p-3 font-bold text-xs text-indigo-900">🏁 จุดสิ้นสุด (กำหนดเอง): ${end.name}<p class="text-[10px] font-normal text-gray-500 font-mono mt-0.5">${Number(end.lat).toFixed(4)}, ${Number(end.lng).toFixed(4)}</p></div>`, { className: 'slts-map-popup' });

    endMarker.on('mouseover', function () { this.openPopup(); });

    if (state.mapMarkerLayerGroup) {
      state.mapMarkerLayerGroup.addLayer(endMarker);
    }
  } else if (state.isRoundTrip && polylineCoords.length > 1) {
    polylineCoords.push([start.lat, start.lng]);
    const returnDist = calculateHaversineDistance(prevLat, prevLng, start.lat, start.lng);
    totalDistanceKm += returnDist;
  }

  // วาด Polyline บนถนนจริงในแผนที่ (Real Road Navigation Network)
  if (polylineCoords.length > 1 && state.showRouteLayer) {
    const currentSeq = ++routeFetchSeq;

    // สร้างเส้นพื้นฐานไว้ก่อนระหว่างรอ API โครงข่ายถนนจริง
    state.mapRoutePolyline = L.polyline(polylineCoords, {
      color: '#2563eb',
      weight: 4,
      opacity: 0.6,
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(state.interactiveLeafletMap);

    // ดึงเส้นทางโครงข่ายถนนสัญจรหลักจริง (OSRM Driving Engine)
    fetchRealRoadRoute(polylineCoords).then(roadResult => {
      if (currentSeq !== routeFetchSeq || !state.showRouteLayer) return;
      if (roadResult && roadResult.latLngs && roadResult.latLngs.length > 0) {
        if (state.mapRoutePolyline) {
          state.interactiveLeafletMap.removeLayer(state.mapRoutePolyline);
        }
        state.mapRoutePolyline = L.polyline(roadResult.latLngs, {
          color: '#2563eb',
          weight: 5,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(state.interactiveLeafletMap);

        // อัปเดตระยะทางรวมบนถนนจริง
        if (roadResult.distanceKm > 0) {
          const totalDistEl = document.getElementById('mapTotalDistanceText');
          if (totalDistEl) {
            totalDistEl.textContent = `${roadResult.distanceKm.toFixed(1)} กม. (ถนนจริง)`;
          }
        }
      }
    }).catch(e => console.warn('Real road route render error:', e));
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

  // บันทึกลำดับเส้นทางล่าสุดเสมอเพื่อใช้แสดงผลเมื่อกลับมาใช้งาน
  saveCurrentRouteStopsHistory(stops);

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

        <!-- Quick Action Buttons (Edit, Delete, Up, Down, Send to Mobile) -->
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onclick="sendSingleStopToMobileHandoff(${index})" class="hidden md:inline-flex p-1 text-violet-600 hover:bg-violet-50 rounded cursor-pointer" title="ส่งพิกัดศูนย์กลางหมู่บ้านของหมายนี้ไปมือถือ (Handoff)">
            <i class="fa-solid fa-mobile-screen text-xs"></i>
          </button>
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

  if (state.routeEndLocation && state.routeEndLocation.enabled && state.routeEndLocation.lat && state.routeEndLocation.lng) {
    html += `
      <div class="p-2.5 bg-violet-50 rounded-xl border border-violet-200 text-[11px] font-bold text-violet-900 flex items-center justify-between shadow-2xs">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] flex-shrink-0">🏁</span>
          <span class="truncate">จุดสิ้นสุด: ${state.routeEndLocation.name}</span>
        </div>
        <button type="button" onclick="clearCustomEndLocation()" class="text-rose-500 hover:text-rose-700 p-1 flex-shrink-0 cursor-pointer" title="ยกเลิกจุดสิ้นสุดนี้">
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>
    `;
  } else if (state.isRoundTrip && stops.length > 0) {
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
 * ล้างข้อมูลรายการส่งหมายและหมุดทั้งหมดในหน้าแผนที่
 */
window.clearAllRouteStops = function() {
  const currentCount = (state.currentRouteStops || []).length;
  if (currentCount === 0) {
    Swal.fire({
      icon: 'info',
      title: 'ไม่มีรายการในตาราง',
      text: 'ไม่มีรายการส่งหมายให้ล้างในขณะนี้',
      timer: 1500,
      showConfirmButton: false
    });
    return;
  }

  Swal.fire({
    title: 'ยืนยันการล้างข้อมูล?',
    html: `คุณต้องการล้างรายการส่งหมายทั้งหมดจำนวน <strong>${currentCount}</strong> รายการ ออกจากแผนที่ใช่หรือไม่?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> ล้างข้อมูลทั้งหมด',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#6b7280'
  }).then((res) => {
    if (res.isConfirmed) {
      state.currentRouteStops = [];
      state.stagedScheduleStops = [];
      state.parsedDispatchRecords = [];
      saveCurrentRouteStopsHistory([]);

      if (state.mapMarkerLayerGroup) {
        state.mapMarkerLayerGroup.clearLayers();
      }
      if (state.mapRoutePolyline) {
        state.interactiveLeafletMap.removeLayer(state.mapRoutePolyline);
        state.mapRoutePolyline = null;
      }

      const badgeEl = document.getElementById('mapAreaCurrentBadge');
      if (badgeEl) badgeEl.textContent = 'ยังไม่ได้ระบุพื้นที่';

      recalculateRouteFromStops(true);

      logServerActivity('MAP_CLEAR_ALL_STOPS', `ล้างข้อมูลรายการส่งหมาย ${currentCount} รายการ ออกจากหน้าแผนที่`);
    }
  });
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

  if (state.routeEndLocation && state.routeEndLocation.enabled && state.routeEndLocation.lat && state.routeEndLocation.lng) {
    destination = `${state.routeEndLocation.lat},${state.routeEndLocation.lng}`;
    waypoints = validStops.map(s => `${s.lat},${s.lng}`);
  } else if (state.isRoundTrip) {
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

// =========================================================================
// 🚀 Cross-Device Handoff & Nearby Village Location Query
// =========================================================================

/**
 * สร้าง Query String ค้นหาศูนย์กลางหมู่บ้าน/ชุมชน (ข้ามบ้านเลขที่เพื่อหาจุดศูนย์กลางหมู่บ้าน)
 * รูปแบบ: "หมู่ที่ [x] ตำบล[y] อำเภอ[z] จังหวัด[a]"
 */
window.buildVillageCenterSearchQuery = function(moo, subdistrict, district, province) {
  const parts = [];
  const cleanMoo = (moo || '').toString().trim().replace(/^ม\.?|^หมู่(?:ที่)?\s*/i, '');
  if (cleanMoo && cleanMoo !== '-') {
    parts.push(`หมู่ที่ ${cleanMoo}`);
  }
  const cleanSub = (subdistrict || '').trim().replace(/^(?:ต\.|ตำบล)\s*/, '');
  if (cleanSub && cleanSub !== '-') {
    parts.push(`ตำบล${cleanSub}`);
  }
  const cleanDist = (district || '').trim().replace(/^(?:อ\.|อำเภอ)\s*/, '');
  if (cleanDist && cleanDist !== '-') {
    parts.push(`อำเภอ${cleanDist}`);
  }
  const cleanProv = (province || 'อุดรธานี').trim().replace(/^(?:จ\.|จังหวัด)\s*/, '');
  if (cleanProv && cleanProv !== '-') {
    parts.push(`จังหวัด${cleanProv}`);
  }
  return parts.join(' ');
};

/**
 * ส่งข้อมูลเส้นทางหรือตำแหน่งพิกัดไปยังหน้าจอมือถือ (Cross-Device Handoff)
 * สำหรับหน้าจอ > 768px (Sender)
 */
window.sendActiveRouteToMobileHandoff = function(targetStop = null) {
  const isUserLoggedIn = state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (!isUserLoggedIn) {
    Swal.fire({
      icon: 'warning',
      title: 'จำเป็นต้องเข้าสู่ระบบ',
      text: 'กรุณาเข้าสู่ระบบก่อนใช้งานฟังก์ชันส่งข้อมูลข้ามอุปกรณ์ (Cross-Device Handoff)',
      confirmButtonText: 'เข้าสู่ระบบ',
      showCancelButton: true,
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#2563eb'
    }).then((res) => {
      if (res.isConfirmed) openLoginModal();
    });
    return;
  }

  const stops = state.currentRouteStops || [];
  if (!targetStop && stops.length === 0) {
    Swal.fire('ไม่มีรายการส่งหมาย', 'กรุณาเลือกพื้นที่หรือจัดตารางส่งหมายก่อนส่งไปแสดงผลบนมือถือ', 'info');
    return;
  }

  const cleanStops = cleanStopsForStorage(targetStop ? [targetStop] : stops);
  const primaryStop = cleanStops[0] || {};
  const prov = primaryStop.province || state.selectedProvince || 'อุดรธานี';
  const queryString = buildVillageCenterSearchQuery(primaryStop.moo, primaryStop.subdistrict, primaryStop.district, prov);
  const userId = (state.currentUser.username || 'user').trim();
  const userName = state.currentUser.name || userId;

  const payload = {
    action: 'send_handoff',
    user_id: userId,
    userName: userName,
    queryString: queryString,
    fullAddress: primaryStop.locationText || '',
    caseNumber: primaryStop.caseNumber || '',
    lat: primaryStop.lat || null,
    lng: primaryStop.lng || null,
    stops: cleanStops,
    status: 'pending',
    timestamp: new Date().toISOString()
  };

  // บันทึก Local Storage & Shared State
  try {
    localStorage.setItem('slts_device_handoff_' + userId, JSON.stringify(payload));
    localStorage.setItem('slts_shared_route_stops', JSON.stringify(cleanStops));
    localStorage.setItem('slts_handoff_event', Date.now().toString());
    window.dispatchEvent(new Event('storage'));
  } catch (e) {
    console.warn('Handoff local storage error:', e);
  }

  // ส่งบันทึกไปยัง Database (Google Sheet 'device_handoff')
  if (state.appsScriptUrl && navigator.onLine) {
    fetch(state.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  logServerActivity('MAP_CROSS_DEVICE_HANDOFF_SENT', `ส่งพิกัดไปยังมือถือ: ${queryString} (คดี: ${primaryStop.caseNumber || '-'}, ผู้รับ: @${userId})`, {
    user_id: userId,
    queryString: queryString,
    stopsCount: stops.length
  });

  Swal.fire({
    icon: 'success',
    title: 'ส่งไปแสดงผลบนมือถือเรียบร้อย!',
    html: `
      <div class="text-left text-xs space-y-2 bg-violet-50 p-3.5 rounded-2xl border border-violet-200 mt-2">
        <p><strong>ผู้รับ:</strong> <span class="text-violet-700 font-bold">@${userId} (${userName})</span></p>
        <p><strong>พิกัดค้นหาศูนย์กลาง:</strong> <span class="text-gray-900 font-semibold">${queryString}</span></p>
        <p><strong>รายการส่งหมาย:</strong> <span class="text-emerald-700 font-bold">${stops.length} รายการ</span></p>
        <p class="text-[11px] text-gray-500 pt-1.5 border-t border-violet-200">
          <i class="fa-solid fa-mobile-screen-button mr-1 text-violet-600"></i> เมื่อเปิดหน้าจอบนมือถือ (< 768px) ระบบจะดึงพิกัดและเส้นทางนี้ขึ้นแสดงผลให้อัตโนมัติ
        </p>
      </div>
    `,
    confirmButtonText: 'ตกลง',
    confirmButtonColor: '#7c3aed',
    timer: 4500
  });
};

/**
 * ส่งเฉพาะ 1 รายการ Stop ไปยังมือถือ
 */
window.sendSingleStopToMobileHandoff = function(index) {
  const stop = state.currentRouteStops ? state.currentRouteStops[index] : null;
  if (stop) {
    sendActiveRouteToMobileHandoff(stop);
  }
};

/**
 * Realtime Listener สำหรับรับข้อมูลข้ามอุปกรณ์ (Receiver - สำหรับหน้าจอ < 768px)
 */
/**
 * Realtime Listener สำหรับรับข้อมูลข้ามอุปกรณ์ (Receiver - สำหรับหน้าจอ < 768px)
 * ตรวจสอบพิกัดและเส้นทางที่ส่งมาจากคอมพิวเตอร์ตาม User ที่ล็อกอินทันที
 */
let handoffPollInterval = null;
let lastReceivedHandoffTime = null;
window.dismissedHandoffTime = null;

window.initMobileHandoffReceiver = function() {
  if (handoffPollInterval) clearInterval(handoffPollInterval);

  // ตรวจสอบข้อมูลเมื่อมี Storage Event ข้ามแท็บ/เบราว์เซอร์
  window.addEventListener('storage', (e) => {
    if (window.innerWidth < 768 && e.key && (e.key.startsWith('slts_device_handoff_') || e.key === 'slts_handoff_event' || e.key === 'slts_latest_handoff')) {
      checkLocalHandoffData();
    }
  });

  // ตรวจสอบทันทีเมื่อเริ่มต้นระบบ
  if (window.innerWidth < 768) {
    checkHandoffForCurrentUser();
    // ตรวจสอบและอัปเดต Badge รายการเดิมถ้ามี
    const cachedStops = localStorage.getItem('slts_shared_route_stops');
    if (cachedStops) {
      try {
        const parsed = JSON.parse(cachedStops);
        if (Array.isArray(parsed) && parsed.length > 0) {
          state.currentRouteStops = parsed;
          updateMobileRouteMapButtonBadge(parsed.length);
        }
      } catch (e) {}
    }
  }

  // Polling ตรวจสอบจาก Database หรือ LocalStorage ทุก 3 วินาที
  handoffPollInterval = setInterval(() => {
    if (window.innerWidth < 768) {
      checkHandoffForCurrentUser();
    }
  }, 3000);
};

function checkLocalHandoffData() {
  const userId = (state.currentUser?.username || '').trim().toLowerCase();
  
  try {
    let raw = userId ? localStorage.getItem('slts_device_handoff_' + userId) : null;
    if (!raw) {
      raw = localStorage.getItem('slts_latest_handoff');
    }
    if (!raw) return;

    const handoff = JSON.parse(raw);
    if (handoff && handoff.status === 'pending' && handoff.timestamp !== lastReceivedHandoffTime && handoff.timestamp !== window.dismissedHandoffTime) {
      applyReceivedHandoff(handoff);
    }
  } catch (e) {
    console.warn('checkLocalHandoffData error:', e);
  }
}

async function checkHandoffForCurrentUser() {
  const isUserLoggedIn = state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (!isUserLoggedIn) return;

  const userId = (state.currentUser.username || '').trim().toLowerCase();
  if (!userId) return;

  // 1. ตรวจสอบ Local ก่อนเพื่อความรวดเร็ว
  checkLocalHandoffData();

  // 2. ตรวจสอบจาก Database (Google Apps Script API)
  if (!state.appsScriptUrl || !navigator.onLine) return;

  try {
    const checkUrl = `${state.appsScriptUrl}?action=get_pending_handoff&user_id=${encodeURIComponent(userId)}&_t=${Date.now()}`;
    const res = await fetch(checkUrl, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.status === 'success' && (data.hasPending || data.hasData) && data.handoff) {
      if (data.handoff.timestamp !== lastReceivedHandoffTime && data.handoff.timestamp !== window.dismissedHandoffTime) {
        applyReceivedHandoff(data.handoff);
      }
    }
  } catch (err) {
    // Silent background poll check
  }
}

function applyReceivedHandoff(handoff) {
  lastReceivedHandoffTime = handoff.timestamp;
  const userId = (state.currentUser?.username || 'user').trim().toLowerCase();

  // 1. อัปเดตสถานะใน Database เป็น "received"
  if (state.appsScriptUrl && navigator.onLine) {
    fetch(state.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'ack_handoff',
        user_id: userId,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }

  // 2. อัปเดต Local Storage และ State
  handoff.status = 'received';
  try {
    localStorage.setItem('slts_device_handoff_' + userId, JSON.stringify(handoff));
    localStorage.setItem('slts_latest_handoff', JSON.stringify(handoff));
    if (handoff.stops && handoff.stops.length > 0) {
      state.currentRouteStops = handoff.stops;
      localStorage.setItem('slts_shared_route_stops', JSON.stringify(handoff.stops));
    }
  } catch (e) {}

  // 3. ปรับปรุงข้อมูลในฟอร์มและ GPS ของมือถือให้ตรงกับหมายแรกที่ได้รับ
  if (handoff.stops && handoff.stops.length > 0) {
    const firstStop = handoff.stops[0];
    if (firstStop.district && elements.districtSelect) elements.districtSelect.value = firstStop.district;
    if (firstStop.subdistrict && elements.subdistrictSelect) elements.subdistrictSelect.value = firstStop.subdistrict;
    if (firstStop.houseNo && elements.houseNoInput) elements.houseNoInput.value = firstStop.houseNo;
    if (firstStop.moo && elements.mooInput) elements.mooInput.value = firstStop.moo;
    if (firstStop.caseNo && elements.udonCaseNoInput) elements.udonCaseNoInput.value = firstStop.caseNo;
    if (firstStop.caseYear && elements.udonCaseYearSelect) elements.udonCaseYearSelect.value = firstStop.caseYear;
    if (firstStop.prefix && elements.udonPrefixInput) elements.udonPrefixInput.value = firstStop.prefix;
    if (firstStop.lat && firstStop.lng) {
      state.lat = parseFloat(firstStop.lat);
      state.lng = parseFloat(firstStop.lng);
      if (elements.coordinatesInput) elements.coordinatesInput.value = `${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}`;
    }
  }

  // 4. อัปเดต UI Badge และ Floating Pill Banner บนหน้าจอกล้อง
  updateMobileRouteMapButtonBadge(handoff.stops ? handoff.stops.length : 0);

  logServerActivity('MAP_CROSS_DEVICE_HANDOFF_RECEIVED', `มือถือได้รับข้อมูลตำแหน่งจากคอมพิวเตอร์: ${handoff.queryString} (คดี: ${handoff.caseNumber || '-'}, ผู้รับ: @${userId})`, {
    user_id: userId,
    queryString: handoff.queryString,
    stopsCount: handoff.stops ? handoff.stops.length : 0
  });

  // 5. แสดงผลแจ้งเตือนบนหน้าจอมือถือ
  const isMapModalOpen = Boolean(document.querySelector('.slts-province-modal'));
  
  if (isMapModalOpen) {
    // ถ้าหน้าต่างแผนที่เปิดอยู่ ให้รีเฟรชแผนที่ทันที
    recalculateRouteFromStops(true);
    renderMobileRouteList();
    
    const Toast = Swal.mixin({
      toast: true,
      position: 'top',
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true
    });
    Toast.fire({
      icon: 'success',
      title: `📲 อัปเดตพิกัด: ${handoff.queryString || 'ตำแหน่งใหม่'}`
    });
  } else {
    // ถ้ายังไม่ได้เปิดหน้าต่างแผนที่ ให้แจ้งเตือนพร้อมปุ่มเปิดดูทันที
    Swal.fire({
      icon: 'info',
      title: '📲 ได้รับพิกัดส่งหมายจากคอมพิวเตอร์!',
      html: `
        <div class="text-left text-xs space-y-2 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-2xl border border-blue-200 mt-2 select-none shadow-inner">
          <div class="flex items-center justify-between pb-1.5 border-b border-blue-200">
            <span class="font-bold text-gray-700">ผู้รับ: <strong class="text-blue-700">@${userId}</strong></span>
            <span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">${handoff.stops ? handoff.stops.length : 1} จุดหมาย</span>
          </div>
          <p><strong>เลขคดีหลัก:</strong> <span class="font-bold text-blue-900">${handoff.caseNumber || '-'}</span></p>
          <p><strong>ศูนย์กลางค้นหา:</strong> <span class="text-gray-900 font-semibold">${handoff.queryString || '-'}</span></p>
          ${handoff.fullAddress ? `<p class="text-gray-600 truncate"><strong>ที่อยู่:</strong> ${handoff.fullAddress}</p>` : ''}
          <p class="text-[10px] text-gray-500 pt-1 border-t border-blue-100 flex items-center gap-1">
            <i class="fa-solid fa-circle-info text-blue-600"></i> ระบบดึงพิกัดและเส้นทางเข้าสู่เครื่องมือถือนี้เรียบร้อยแล้ว
          </p>
        </div>
      `,
      confirmButtonText: '<i class="fa-solid fa-map-location-dot mr-1.5"></i> เปิดดูแผนที่และนำทางทันที',
      showCancelButton: true,
      cancelButtonText: 'รับทราบ (ไว้ดูภายหลัง)',
      confirmButtonColor: '#2563eb',
      cancelButtonColor: '#6b7280'
    }).then((res) => {
      if (res.isConfirmed) {
        showMobileRouteMapModal();
      }
    });
  }
}

/**
 * อัปเดตสถานะและจำนวนจุดส่งหมายบนปุ่มแผนที่หน้าจอมือถือ
 */
window.updateMobileRouteMapButtonBadge = function(count) {
  const stopsCount = count !== undefined ? count : (state.currentRouteStops ? state.currentRouteStops.length : 0);
  const btn = document.getElementById('btnCameraRouteMap');
  const txt = document.getElementById('txtCameraRouteMapCount');
  const pill = document.getElementById('mobileHandoffPillBanner');
  const pillTitle = document.getElementById('mobileHandoffPillTitle');
  const pillSub = document.getElementById('mobileHandoffPillSub');

  if (txt) {
    txt.textContent = stopsCount > 0 ? `แผนที่ (${stopsCount})` : 'แผนที่';
  }

  if (stopsCount > 0) {
    if (btn) {
      btn.classList.add('animate-pulse');
    }
    if (pill) {
      pill.classList.remove('hidden');
      if (pillTitle) pillTitle.textContent = `📲 มีเส้นทางส่งหมาย ${stopsCount} จุดหมาย`;
      if (pillSub && state.currentRouteStops && state.currentRouteStops[0]) {
        pillSub.textContent = `คดี: ${state.currentRouteStops[0].caseNumber || '-'} • แตะเพื่อเปิดดูแผนที่`;
      }
    }
  } else {
    if (btn) {
      btn.classList.remove('animate-pulse');
    }
    if (pill) {
      pill.classList.add('hidden');
    }
  }
};

/**
 * ล้างข้อมูลเส้นทางส่งหมายที่ส่งมาจากหน้าจอ Desktop และปิดการแจ้งเตือนบนหน้าจอกล้อง
 */
window.clearMobileRouteHandoff = function(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // 1. เคลียร์ State และ LocalStorage ของเส้นทางส่งหมาย
  state.currentRouteStops = [];
  localStorage.removeItem('slts_shared_route_stops');

  const userId = (state.currentUser?.username || '').trim().toLowerCase();
  if (userId) {
    localStorage.removeItem('slts_device_handoff_' + userId);
  }
  localStorage.removeItem('slts_latest_handoff');

  // บันทึก timestamp ที่ถูกล้าง เพื่อไม่ให้ Polling ดึงซ้ำมาอีก
  window.dismissedHandoffTime = lastReceivedHandoffTime;

  // 2. แจ้ง Server ผ่าน API เพื่อปลด pending handoff (ถ้ามี)
  if (state.appsScriptUrl && navigator.onLine && userId) {
    fetch(state.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'dismiss_handoff',
        user_id: userId,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }

  // 3. ปิดการแจ้งเตือนบนหน้าจอกล้อง และรีเซ็ตปุ่มแผนที่
  updateMobileRouteMapButtonBadge(0);

  // 4. แสดง Toast แจ้งเตือนสั้นๆ แบบไม่ขัดจังหวะ
  Swal.fire({
    toast: true,
    position: 'top',
    icon: 'success',
    title: 'ล้างเส้นทางส่งหมายเรียบร้อยแล้ว',
    text: 'ปิดการแจ้งเตือนและกลับสู่หน้าจอกล้องปกติ',
    timer: 2000,
    showConfirmButton: false
  });
};

/**
 * เปิดหน้าต่างแผนที่และเส้นทางส่งหมายสำหรับหน้าจอมือถือ (< 768px)
 * (ปรับสัดส่วน Layout ให้สมดุล พร้อมแผนที่ Leaflet และ Timeline นำทาง)
 */
window.mobileModalMap = null;
window.mobileModalMarkersLayer = null;
window.mobileModalPolyline = null;

/**
 * ตรวจสอบว่ามีรายการส่งหมายส่งมาจากหน้าจอ Desktop (> 768px) ตาม User ที่ล็อกอินตรงกันหรือไม่ (ตามข้อ 2)
 */
function hasDesktopHandoffForCurrentUser() {
  const isUserLoggedIn = state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (!isUserLoggedIn) return false;

  const currentUserId = (state.currentUser?.username || '').trim().toLowerCase();
  if (!currentUserId) return false;

  try {
    const raw = localStorage.getItem('slts_device_handoff_' + currentUserId);
    if (raw) {
      const parsed = JSON.parse(raw);
      const isTargetUser = (parsed.userId || parsed.targetUserId || '').toLowerCase() === currentUserId;
      const isFromDesktop = parsed.sender === 'desktop' || parsed.action === 'send_handoff';
      const hasStops = Array.isArray(parsed.stops) && parsed.stops.length > 0;
      if (isTargetUser && isFromDesktop && hasStops) {
        return true;
      }
    }
  } catch (e) {}

  return false;
}

window.showMobileRouteMapModal = function() {
  const isUserLoggedIn = state.currentUser && state.currentUser.role && state.currentUser.role !== 'guest';
  if (!isUserLoggedIn) {
    Swal.fire({
      icon: 'warning',
      title: 'จำเป็นต้องเข้าสู่ระบบ',
      text: 'กรุณาเข้าสู่ระบบก่อนเปิดดูแผนที่และเส้นทางส่งหมาย',
      confirmButtonText: '<i class="fa-solid fa-right-to-bracket mr-1"></i> เข้าสู่ระบบทันที',
      showCancelButton: true,
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#2563eb'
    }).then((res) => {
      if (res.isConfirmed) {
        openLoginModal();
      }
    });
    return;
  }

  if (!state.currentRouteStops || state.currentRouteStops.length === 0) {
    try {
      const savedStops = localStorage.getItem('slts_shared_route_stops');
      if (savedStops) {
        state.currentRouteStops = JSON.parse(savedStops);
      }
    } catch (e) {}
  }

  const stops = state.currentRouteStops || [];
  const start = state.routeStartLocation;
  const prov = state.selectedProvince || 'อุดรธานี';

  let totalDistKm = 0;
  stops.forEach(s => { if (s.legDistanceKm) totalDistKm += s.legDistanceKm; });

  const hasHandoffFromDesktop = hasDesktopHandoffForCurrentUser();

  Swal.fire({
    html: `
      <div class="slts-province-modal flex flex-col h-[88dvh] overflow-hidden bg-gray-50">
        <!-- Header -->
        <div class="slts-modal-header flex-shrink-0 px-3.5 py-2.5 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white flex items-center justify-between shadow-sm">
          <!-- ปุ่มรีเฟรชข้อมูลเส้นทาง (ย้ายมาไว้ทางซ้ายตามข้อ 3) -->
          <button type="button" onclick="showMobileRouteMapModal()" class="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs font-bold transition cursor-pointer" title="รีเฟรชข้อมูลเส้นทาง">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <div class="flex-1 text-center px-2">
            <h2 class="text-xs font-bold text-white truncate">🗺️ แผนที่เส้นทางส่งหมาย</h2>
            <p class="text-[10px] text-blue-100 truncate">📍 จ.${prov} (${stops.length} จุดหมาย)</p>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <!-- ปุ่ม 'ล้าง' จะแสดงผลก็ต่อเมื่อมีรายการส่งมาจากหน้าจอ Desktop (> 768px) ตาม User ตรงกันเท่านั้น (ตามข้อ 2) -->
            ${hasHandoffFromDesktop ? `
              <button type="button" onclick="clearMobileRouteHandoff(); window.handleMobileModalBackOrClose();" class="px-2 py-1.5 bg-rose-500/80 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer" title="ล้างเส้นทางส่งหมาย">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
                <span class="text-[10px]">ล้าง</span>
              </button>
            ` : ''}
            <!-- ปุ่มกากบาทเพื่อปิดการแสดงผล Pop Up แผนที่ (รองรับการย้อนกลับตามข้อ 1) -->
            <button type="button" onclick="window.handleMobileModalBackOrClose()" class="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs font-bold transition cursor-pointer" title="ปิดหน้าต่างแผนที่">
              <i class="fa-solid fa-xmark text-sm"></i>
            </button>
          </div>
        </div>

        <!-- Balanced Mobile Leaflet Map (Height 40dvh) -->
        <div class="relative w-full h-[40dvh] min-h-[190px] max-h-[340px] bg-slate-100 border-b border-gray-200 flex-shrink-0 overflow-hidden">
          <div id="mobileModalLeafletMap" class="w-full h-full z-0"></div>
          
          <!-- Floating Center Button -->
          <div class="absolute bottom-2.5 right-2.5 z-[1000]">
            <button type="button" onclick="centerMobileModalMap()" class="w-8 h-8 rounded-full bg-white/95 text-blue-700 shadow-md flex items-center justify-center text-xs font-bold cursor-pointer border border-gray-200 active:scale-95 transition" title="จัดกึ่งกลางแผนที่">
              <i class="fa-solid fa-location-crosshairs"></i>
            </button>
          </div>
        </div>

        <!-- Bottom Timeline & Stats (Height 48dvh) -->
        <div class="flex-1 flex flex-col min-h-0 bg-white">
          <!-- Summary Bar -->
          <div class="p-2.5 bg-blue-50/80 border-b border-blue-100 flex items-center justify-between text-xs flex-shrink-0 gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-bold text-gray-800 text-[11px] truncate">🏁 ${start.name}</span>
              ${totalDistKm > 0 ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold flex-shrink-0">${totalDistKm.toFixed(1)} กม.</span>` : ''}
            </div>
            ${stops.length > 0 ? `
              <button type="button" onclick="openFullRouteInGoogleMaps()" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold rounded-xl text-[11px] flex items-center gap-1 shadow-sm flex-shrink-0 cursor-pointer">
                <i class="fa-solid fa-diamond-turn-right"></i> นำทางทั้งหมด
              </button>
            ` : ''}
          </div>

          <!-- Stops List Scrollable Container -->
          <div id="mobileMapRouteStopsList" class="flex-1 overflow-y-auto p-2.5 space-y-2 slts-swal-body-scroll bg-gray-50/40">
            <!-- Rendered by renderMobileRouteList -->
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
      popup: 'slts-swal-fullscreen-80 slts-swal-no-padding rounded-2xl overflow-hidden'
    },
    didOpen: () => {
      renderMobileRouteList();
      setTimeout(() => {
        initMobileModalMapInstance();
      }, 200);
    }
  });
};

window.initMobileModalMapInstance = function() {
  const container = document.getElementById('mobileModalLeafletMap');
  if (!container || typeof L === 'undefined') return;

  if (window.mobileModalMap) {
    try {
      window.mobileModalMap.remove();
    } catch (e) {}
    window.mobileModalMap = null;
  }

  const start = state.routeStartLocation;
  const stops = state.currentRouteStops || [];

  window.mobileModalMap = L.map('mobileModalLeafletMap', {
    zoomControl: true,
    attributionControl: false
  }).setView([start.lat, start.lng], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(window.mobileModalMap);

  window.mobileModalMarkersLayer = L.layerGroup().addTo(window.mobileModalMap);

  // 1. วาดหมุดจุดเริ่มต้น (Start Location Hub)
  const startIcon = L.divIcon({
    html: `<div class="w-7 h-7 rounded-full bg-blue-700 text-white flex items-center justify-center font-extrabold text-[11px] shadow-lg border-2 border-white ring-2 ring-blue-400/50"><i class="fa-solid fa-flag"></i></div>`,
    className: 'slts-div-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });
  L.marker([start.lat, start.lng], { icon: startIcon })
    .addTo(window.mobileModalMarkersLayer)
    .bindPopup(`<b>🏁 ${start.name}</b>`);

  // 2. วาดหมุดจุดส่งหมาย (Stops)
  const latlngs = [[start.lat, start.lng]];
  let pinNum = 1;

  stops.forEach((stop) => {
    if (stop.lat && stop.lng && !isNaN(stop.lat) && !isNaN(stop.lng) && stop.lat > 0 && stop.lng > 0) {
      const pinIcon = L.divIcon({
        html: `<div class="w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold text-[10px] shadow-md border-2 border-white ring-2 ring-rose-300">${pinNum}</div>`,
        className: 'slts-div-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
      });
      L.marker([stop.lat, stop.lng], { icon: pinIcon })
        .addTo(window.mobileModalMarkersLayer)
        .bindPopup(`<b>#${pinNum} ${stop.caseNumber}</b><br><span class="text-xs text-gray-600">${stop.locationText}</span>`);
      latlngs.push([stop.lat, stop.lng]);
      pinNum++;
    }
  });

  if (state.isRoundTrip && latlngs.length > 1) {
    latlngs.push([start.lat, start.lng]);
  }

  if (latlngs.length > 1) {
    window.mobileModalPolyline = L.polyline(latlngs, {
      color: '#2563eb',
      weight: 4,
      opacity: 0.85,
      dashArray: '6, 6'
    }).addTo(window.mobileModalMap);

    const bounds = L.latLngBounds(latlngs);
    window.mobileModalMap.fitBounds(bounds, { padding: [25, 25] });
  }

  window.mobileModalMap.invalidateSize();
};

window.centerMobileModalMap = function() {
  if (!window.mobileModalMap) return;
  const start = state.routeStartLocation;
  const stops = (state.currentRouteStops || []).filter(s => s.lat && s.lng);
  const latlngs = [[start.lat, start.lng], ...stops.map(s => [s.lat, s.lng])];
  if (latlngs.length > 1) {
    window.mobileModalMap.fitBounds(L.latLngBounds(latlngs), { padding: [25, 25] });
  } else {
    window.mobileModalMap.setView([start.lat, start.lng], 13);
  }
};

window.renderMobileRouteList = function() {
  const container = document.getElementById('mobileMapRouteStopsList');
  if (!container) return;
  const stops = state.currentRouteStops || [];
  
  if (stops.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400 flex flex-col items-center justify-center">
        <i class="fa-solid fa-map-location-dot text-3xl mb-2 text-gray-300"></i>
        <p class="text-xs font-bold text-gray-600">ยังไม่มีรายการส่งหมายในแผนที่</p>
        <p class="text-[10px] text-gray-400 mt-0.5">จัดรายการตารางส่งหมายบนคอมพิวเตอร์และกดยืนยัน</p>
      </div>
    `;
    return;
  }

  let pinCounter = 1;
  container.innerHTML = stops.map((stop, index) => {
    const isExact = stop.matchType === 'exact' || stop.isMatched;
    const isNear = stop.matchType === 'near';
    const hasPin = stop.lat && stop.lng && !isNaN(stop.lat) && !isNaN(stop.lng) && stop.lat > 0 && stop.lng > 0;
    const currentPin = hasPin ? pinCounter++ : null;
    const distText = hasPin ? `+ ${(stop.legDistanceKm || 0).toFixed(1)} กม.` : 'ไม่มีหมุด';
    const itemClass = isExact ? 'border-emerald-200 bg-emerald-50/50' : (isNear ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-white');
    const badgeBg = isExact ? 'bg-emerald-600 text-white' : (isNear ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700');

    return `
      <div class="p-2.5 rounded-2xl border flex items-start gap-2 text-xs transition shadow-2xs ${itemClass}">
        <span class="w-6 h-6 rounded-full ${badgeBg} text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 shadow-xs">
          ${currentPin !== null ? currentPin : '-'}
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <span class="font-bold text-xs ${isExact ? 'text-emerald-900' : (isNear ? 'text-amber-950' : 'text-gray-900')} truncate">${stop.caseNumber}</span>
            <span class="text-[10px] font-semibold ${isExact ? 'text-emerald-700 bg-emerald-100/80 border-emerald-200' : (isNear ? 'text-amber-800 bg-amber-100/80 border-amber-200' : 'text-gray-500 bg-gray-100 border-gray-200')} px-1.5 py-0.2 rounded-md border flex-shrink-0">
              ${distText}
            </span>
          </div>
          <p class="text-[11px] text-gray-700 leading-snug truncate">${stop.locationText}</p>
          <div class="flex items-center justify-between mt-1 text-[10px]">
            ${isExact ? `<span class="text-emerald-700 font-bold flex items-center gap-1"><i class="fa-solid fa-circle-check text-[9px]"></i> มีพิกัดตรง</span>` : (isNear ? `<span class="text-amber-800 font-bold flex items-center gap-1"><i class="fa-solid fa-location-dot text-[9px]"></i> ${stop.matchNote || 'ใกล้เคียง'}</span>` : `<span class="text-gray-400">○ ไม่มีหมุดในระบบ</span>`)}
            ${hasPin ? `
              <a href="https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}" target="_blank" class="text-blue-600 hover:text-blue-800 font-bold underline flex items-center gap-1">
                <i class="fa-solid fa-location-arrow"></i> นำทางจุดนี้
              </a>
            ` : ''}
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0 self-center">
          <button type="button" onclick="openAddRouteStopModal(${index})" class="p-1.5 text-blue-600 hover:bg-blue-100/60 rounded-lg cursor-pointer" title="แก้ไข">
            <i class="fa-solid fa-pen-to-square text-xs"></i>
          </button>
          <button type="button" onclick="deleteRouteStop(${index}, event); renderMobileRouteList(); initMobileModalMapInstance();" class="p-1.5 text-red-600 hover:bg-red-100/60 rounded-lg cursor-pointer" title="ลบ">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
};

/**
 * แสดงคำอธิบายและขั้นตอนการใช้งานระบบ (Onboarding Walkthrough Tour)
 * @param {boolean} forceOpen - บังคับเปิดแม้เคยอ่านแล้ว
 */
window.showSystemOnboardingModal = function(forceOpen = false) {
  if (!forceOpen && localStorage.getItem('slts_onboarding_completed') === 'true') {
    return;
  }

  const steps = [
    {
      title: 'ยินดีต้อนรับสู่ระบบ SLTS',
      subtitle: 'ระบบจัดเก็บข้อมูลพิกัดส่งหมาย ศาลจังหวัดอุดรธานี',
      icon: 'fa-landmark-flag',
      iconColor: 'from-blue-600 to-indigo-600',
      badge: 'ภาพรวมระบบ',
      content: `
        <div class="space-y-2.5 text-left text-xs leading-relaxed text-gray-700">
          <p class="font-bold text-gray-900 text-sm">
            ระบบสนับสนุนการปฏิบัติงานของเจ้าหน้าที่ส่งหมายอย่างครบวงจร
          </p>
          <ul class="space-y-2 text-gray-600">
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-circle-check text-blue-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>ความแม่นยำสูง:</strong> บันทึกภาพพร้อมพิกัด GPS จริง ณ สถานที่ส่งหมาย และประทับลายน้ำรับรองทันที</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-circle-check text-blue-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>เชื่อมโยงข้ามอุปกรณ์:</strong> ส่งพิกัดและเส้นทางจากคอมพิวเตอร์เข้าสู่มือถือ (Handoff) ให้อัตโนมัติ</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-circle-check text-blue-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>ทำงานออฟไลน์ได้:</strong> บันทึกข้อมูลและจัดเก็บลงเครื่องชั่วคราวเมื่อไม่มีสัญญาณอินเทอร์เน็ต</span>
            </li>
          </ul>
        </div>
      `
    },
    {
      title: 'บันทึกส่งหมาย & พิกัดอัจฉริยะ',
      subtitle: 'ถ่ายภาพพร้อมพิกัด GPS และแปลงที่อยู่อัตโนมัติ',
      icon: 'fa-camera-retro',
      iconColor: 'from-emerald-600 to-teal-600',
      badge: 'การบันทึกหมาย',
      content: `
        <div class="space-y-2.5 text-left text-xs leading-relaxed text-gray-700">
          <p class="font-bold text-gray-900 text-sm">
            สะดวกรวดเร็วด้วยระบบ Reverse Geocoding อัจฉริยะ
          </p>
          <ul class="space-y-2 text-gray-600">
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-camera text-emerald-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>บนมือถือ:</strong> เปิดกล้องถ่ายภาพ ระบบจะดึงพิกัด GPS, ทิศเข็มทิศ และแผนที่ย่อประทับลงบนภาพทันที</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-wand-magic-sparkles text-emerald-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>แปลงพิกัดอัตโนมัติ:</strong> เมื่อมีพิกัด ระบบจะค้นหาและเลือกตำบล อำเภอ ให้โดยไม่ต้องเลือกเอง</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-upload text-emerald-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>บนคอมพิวเตอร์:</strong> อัปโหลดภาพถ่าย ระบบจะดึงพิกัดจากไฟล์ (EXIF GPS) ให้อัตโนมัติ</span>
            </li>
          </ul>
        </div>
      `
    },
    {
      title: 'ตารางประวัติ & ค้นหาข้อมูลหมาย',
      subtitle: 'สืบค้นข้อมูลย้อนหลัง และตรวจสอบภาพถ่าย',
      icon: 'fa-table-list',
      iconColor: 'from-amber-500 to-orange-600',
      badge: 'การสืบค้นประวัติ',
      content: `
        <div class="space-y-2.5 text-left text-xs leading-relaxed text-gray-700">
          <p class="font-bold text-gray-900 text-sm">
            จัดการและตรวจสอบข้อมูลหมายที่เคยส่งในระบบ
          </p>
          <ul class="space-y-2 text-gray-600">
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-magnifying-glass text-amber-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>สืบค้นได้ทุกคอลัมน์:</strong> ค้นหาตามเลขดำ, ชื่อผู้รับ, บ้านเลขที่, ตำบล หรืออำเภอ</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-image text-amber-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>ดูภาพถ่ายและพิกัด:</strong> คลิกดูภาพถ่ายที่เคยบันทึกไว้ และเปิดตำแหน่งบนแผนที่ได้ทันที</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-filter text-amber-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>กรองตามช่วงเวลา & พื้นที่:</strong> เลือกดูข้อมูลเฉพาะตำบล หรือช่วงวันที่ต้องการได้อย่างง่ายดาย</span>
            </li>
          </ul>
        </div>
      `
    },
    {
      title: 'แผนที่ & วางแผนเส้นทางส่งหมาย',
      subtitle: 'คำนวณเส้นทางวงรอบ 2-Opt TSP และนำทาง Google Maps',
      icon: 'fa-map-location-dot',
      iconColor: 'from-violet-600 to-purple-600',
      badge: 'การวางแผนเส้นทาง',
      content: `
        <div class="space-y-2.5 text-left text-xs leading-relaxed text-gray-700">
          <p class="font-bold text-gray-900 text-sm">
            วางแผนเส้นทางส่งหมายอย่างชาญฉลาดและประหยัดเวลา
          </p>
          <ul class="space-y-2 text-gray-600">
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-route text-violet-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>เส้นทางไม่ตัดกัน (2-Opt TSP):</strong> จัดลำดับจุดส่งหมายแบบวงรอบ วกกลับมาจบที่ศาลฯ อย่างราบรื่น</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-file-pdf text-violet-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>อัปโหลดบัญชีจ่ายหมาย:</strong> รองรับ PDF และภาพหลายภาพ สกัดเลขคดีและจับคู่พิกัดประวัติให้อัตโนมัติ</span>
            </li>
            <li class="flex items-start gap-2">
              <i class="fa-solid fa-diamond-turn-right text-violet-600 mt-0.5 flex-shrink-0"></i>
              <span><strong>ส่งพิกัดนำทาง:</strong> คลิกปุ่มเปิดใน Google Maps เพื่อเริ่มระบบนำทางเลี้ยวต่อเลี้ยวได้ทันที</span>
            </li>
          </ul>
        </div>
      `
    }
  ];

  let currentStep = 0;

  function renderOnboardingStep() {
    const step = steps[currentStep];
    const total = steps.length;
    const isLast = currentStep === total - 1;
    const isFirst = currentStep === 0;

    const indicatorsHtml = steps.map((_, i) => `
      <div class="h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'bg-blue-600 w-8' : (i < currentStep ? 'bg-blue-300 w-4' : 'bg-gray-200 w-4')}"></div>
    `).join('');

    const html = `
      <div class="p-1 text-center select-none">
        <!-- Step Icon Header -->
        <div class="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr ${step.iconColor} text-white flex items-center justify-center text-2xl shadow-lg shadow-blue-500/20 mb-3 animate-fade-in">
          <i class="fa-solid ${step.icon}"></i>
        </div>

        <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 mb-1.5">
          ${step.badge} • ขั้นตอนที่ ${currentStep + 1}/${total}
        </span>

        <h3 class="text-base font-bold text-gray-900 mb-0.5">${step.title}</h3>
        <p class="text-[11px] text-gray-500 mb-3">${step.subtitle}</p>

        <!-- Step Content Card -->
        <div class="bg-gray-50/80 border border-gray-200/90 rounded-2xl p-3.5 mb-4 text-left shadow-2xs">
          ${step.content}
        </div>

        <!-- Indicator Bar -->
        <div class="flex items-center justify-center gap-1.5 mb-4">
          ${indicatorsHtml}
        </div>

        <!-- Navigation Buttons -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
          <button type="button" id="btnOnboardPrev" class="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer ${isFirst ? 'opacity-0 pointer-events-none' : ''}">
            <i class="fa-solid fa-chevron-left mr-1"></i> ย้อนกลับ
          </button>

          ${isLast ? `
            <button type="button" id="btnOnboardFinish" class="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-500/25 transition cursor-pointer flex items-center gap-1.5">
              <i class="fa-solid fa-circle-check"></i> ยืนยัน & เริ่มใช้งาน
            </button>
          ` : `
            <button type="button" id="btnOnboardNext" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25 transition cursor-pointer flex items-center gap-1.5">
              <span>ถัดไป</span> <i class="fa-solid fa-chevron-right text-[10px]"></i>
            </button>
          `}
        </div>
      </div>
    `;

    const modalContainer = Swal.getHtmlContainer();
    if (modalContainer) {
      modalContainer.innerHTML = html;
      bindStepEvents();
    }
  }

  function bindStepEvents() {
    const prevBtn = document.getElementById('btnOnboardPrev');
    const nextBtn = document.getElementById('btnOnboardNext');
    const finishBtn = document.getElementById('btnOnboardFinish');

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (currentStep > 0) {
          currentStep--;
          renderOnboardingStep();
        }
      };
    }

    if (nextBtn) {
      nextBtn.onclick = () => {
        if (currentStep < steps.length - 1) {
          currentStep++;
          renderOnboardingStep();
        }
      };
    }

    if (finishBtn) {
      finishBtn.onclick = () => {
        localStorage.setItem('slts_onboarding_completed', 'true');
        Swal.close();
      };
    }
  }

  Swal.fire({
    html: `<div id="onboardingWrapper"></div>`,
    width: '460px',
    showConfirmButton: false,
    showCloseButton: true,
    allowOutsideClick: false,
    customClass: {
      popup: 'rounded-3xl p-4 sm:p-5 shadow-2xl'
    },
    didOpen: () => {
      renderOnboardingStep();
    }
  });
};
