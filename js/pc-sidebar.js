/**
 * js/pc-sidebar.js — เมนูด้านข้าง (Sidebar) สำหรับโหมด PC / แท็บเล็ตโหมด PC
 *
 * ย้ายปุ่มแท็บเดิม (id/onclick/สิทธิ์ซ่อน-แสดงของ app.js ทำงานเหมือนเดิม) ไปไว้ในแถบด้านซ้าย
 * จัดเป็นกลุ่ม + เมนูย่อยของ "รายงานผลหมาย" + ย่อเหลือไอคอนได้ (จำค่าไว้ในเครื่อง)
 * มือถือ และจอ PC ที่แคบกว่า 850px ใช้เมนูแบบเดิม
 */
(function () {
  'use strict';
  const MIN_WIDTH = 850;
  const KEY = 'slts_sidebar_collapsed';
  const GROUPS = [
    { label: 'งานส่งหมาย', ids: ['tabBtnForm', 'tabBtnTable', 'tabBtnMap'] },
    { label: 'งานรายงานผลหมาย', ids: ['tabBtnRouteBatch', 'tabBtnReport'], sub: true },
    { label: 'ผู้ดูแลระบบ', ids: ['tabBtnUsers'] },
  ];
  const REPORT_SUBS = [
    ['issued', 'fa-list-check', 'บัญชีจ่ายหมาย'],
    ['memos', 'fa-file-invoice', 'บันทึกข้อความ / ใบสำคัญ'],
    ['rates', 'fa-table', 'อัตราค่านำหมาย'],
    ['settings', 'fa-user-pen', 'ผู้ลงนาม / โซนจ่ายหมาย'],
  ];

  const html = document.documentElement;
  const isPcMode = () => (typeof window.isMobileView === 'function' ? !window.isMobileView() : html.getAttribute('data-device-mode') !== 'mobile');
  let aside = null;

  function build() {
    if (aside) return aside;
    aside = document.createElement('aside');
    aside.id = 'pcSidebar';
    aside.setAttribute('aria-label', 'เมนูหลัก');
    aside.innerHTML = `
      <div class="sb-brand" role="button" tabindex="0" title="หน้าบันทึกส่งหมาย">
        <img src="img/logo.png" alt="">
        <div class="sb-brand-text"><b>ระบบพิกัดส่งหมาย</b><span>ศาลจังหวัดอุดรธานี</span></div>
      </div>
      <div class="sb-scroll" id="pcSidebarScroll"></div>
      <div class="sb-foot">
        <button type="button" class="sb-collapse" id="pcSidebarCollapse" title="ย่อ/ขยายเมนู"><i class="fa-solid fa-angles-left"></i><span>ย่อเมนู</span></button>
      </div>`;
    const scroll = aside.querySelector('#pcSidebarScroll');
    GROUPS.forEach((g) => {
      const sec = document.createElement('div');
      sec.className = 'sb-group';
      sec.innerHTML = `<div class="sb-label">${g.label}</div>`;
      g.ids.forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        sec.appendChild(btn); // ย้ายปุ่มเดิม — onclick และการซ่อนตามสิทธิ์ยังทำงานเหมือนเดิม
        if (g.sub && id === 'tabBtnReport') {
          const ul = document.createElement('div');
          ul.className = 'sb-sub'; ul.id = 'pcSidebarReportSub';
          ul.innerHTML = REPORT_SUBS.map(([k, ic, t]) => `<button type="button" data-sb-sub="${k}" title="${t}"><i class="fa-solid ${ic}"></i><span>${t}</span></button>`).join('');
          sec.appendChild(ul);
        }
      });
      scroll.appendChild(sec);
    });
    document.body.appendChild(aside);

    aside.querySelector('.sb-brand').addEventListener('click', () => window.switchTab && window.switchTab('form'));
    aside.querySelector('#pcSidebarCollapse').addEventListener('click', () => {
      const v = !html.classList.contains('pc-sidebar-collapsed');
      try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (_) {}
      apply();
    });
    aside.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sb-sub]');
      if (!b) return;
      if (window.SltsReportUI && typeof window.SltsReportUI.openSub === 'function') window.SltsReportUI.openSub(b.dataset.sbSub);
      else if (window.switchTab) window.switchTab('report');
      setTimeout(sync, 50);
    });
    // ปุ่ม/สิทธิ์เปลี่ยน → ซ่อนหัวกลุ่มที่ไม่มีปุ่ม, อัปเดตเมนูย่อย
    if (window.MutationObserver) {
      new MutationObserver(sync).observe(aside, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    return aside;
  }

  function updateTitle() {
    const act = aside.querySelector('.tab-nav-btn.active');
    const tEl = document.getElementById('pcPageTitle');
    if (tEl && act) {
      const lbl = (act.querySelector('.tab-label-text') || act).textContent.trim();
      const subB = act.id === 'tabBtnReport' ? aside.querySelector('[data-sb-sub].active span') : null;
      const sec = act.closest('.sb-group') && act.closest('.sb-group').querySelector('.sb-label');
      const html2 = `<span class="pt-sec">${sec ? sec.textContent : ''}</span><b>${lbl}${subB ? ' <i class="fa-solid fa-angle-right"></i> ' + subB.textContent : ''}</b>`;
      if (tEl.innerHTML !== html2) tEl.innerHTML = html2;
    }
  }

  let syncing = false;
  function sync() {
    if (!aside || syncing) return;
    syncing = true;
    try {
      aside.querySelectorAll('.sb-group').forEach((sec) => {
        const any = Array.from(sec.querySelectorAll('.tab-nav-btn')).some((b) => !b.classList.contains('hidden'));
        sec.classList.toggle('sb-empty', !any);
      });
      const rep = document.getElementById('tabBtnReport');
      const sub = document.getElementById('pcSidebarReportSub');
      if (rep && sub) {
        const open = rep.classList.contains('active');
        sub.classList.toggle('open', open);
        const cur = (window.SltsReportUI && window.SltsReportUI.R && window.SltsReportUI.R.sub) || 'issued';
        sub.querySelectorAll('[data-sb-sub]').forEach((b) => b.classList.toggle('active', open && b.dataset.sbSub === cur));
      }
      updateTitle();
    } finally { syncing = false; }
  }

  function apply() {
    const on = isPcMode() && window.innerWidth >= MIN_WIDTH;
    if (on) build();
    html.classList.toggle('pc-sidebar', on);
    let collapsed = false;
    try { collapsed = localStorage.getItem(KEY) === '1'; } catch (_) {}
    // จอแคบ (เช่นแท็บเล็ตแนวตั้งโหมด PC) ย่อเหลือไอคอนอัตโนมัติ เว้นแต่ผู้ใช้เลือกขยายไว้
    let saved = null; try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (window.innerWidth < 1180 && saved === null) collapsed = true;
    html.classList.toggle('pc-sidebar-collapsed', on && collapsed);
    const cb = document.getElementById('pcSidebarCollapse');
    if (cb) cb.querySelector('span').textContent = collapsed ? 'ขยายเมนู' : 'ย่อเมนู';
    if (on) {
      // ซ่อนแถบแท็บด้านบนและเมนูแบบย่อของเดิม
      const top = document.getElementById('desktopNavCompact');
      if (top) { top.classList.add('hidden'); top.classList.remove('flex'); }
    } else if (aside) {
      // กลับไปใช้แถบด้านบน: คืนปุ่มกลับที่เดิม
      const nav = document.getElementById('desktopNavTabs');
      if (nav) aside.querySelectorAll('.tab-nav-btn').forEach((b) => nav.appendChild(b));
      aside.remove(); aside = null;
      if (typeof window.updateDesktopNavCompactState === 'function') window.updateDesktopNavCompactState();
    }
    sync();
  }

  // หลังสลับแท็บ อัปเดตสถานะเมนูย่อย
  function hookSwitch() {
    const orig = window.switchTab;
    if (typeof orig !== 'function' || orig.__sbHooked) return;
    const w = function () { const r = orig.apply(this, arguments); setTimeout(sync, 30); return r; };
    w.__sbHooked = true; w.__srHooked = orig.__srHooked;
    window.switchTab = w;
  }
  // app.js จะเรียก updateDesktopNavCompactState เมื่อขนาดจอเปลี่ยน — ถ้าใช้ sidebar ให้ข้าม
  function hookCompact() {
    const orig = window.updateDesktopNavCompactState;
    if (typeof orig !== 'function' || orig.__sbHooked) return;
    const w = function () { if (html.classList.contains('pc-sidebar')) { apply(); return; } return orig.apply(this, arguments); };
    w.__sbHooked = true;
    window.updateDesktopNavCompactState = w;
  }

  function init() {
    hookSwitch(); hookCompact(); apply();
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 120); });
    // สลับโหมด PC/มือถือ (แท็บเล็ต) เปลี่ยน attribute data-device-mode
    if (window.MutationObserver) new MutationObserver(apply).observe(html, { attributes: true, attributeFilter: ['data-device-mode'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SltsSidebar = { apply, sync };
})();
