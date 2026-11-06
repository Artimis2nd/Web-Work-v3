/**
 * ฟังก์ชันช่วยเหลือที่ใช้ร่วมกันทุกหน้า: จัดรูปแบบตัวเลข/วันที่, Toast, Layout, Loading, Error, และหน้าต่างตั้งค่า Supabase
 */
const Utils = (() => {
  const APP_VERSION = '3.0 (Supabase Edition)';
  const THB = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const THB_INT = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  function money(n) {
    return THB.format(Number(n) || 0);
  }

  function smartMoney(n) {
    const num = Number(n) || 0;
    if (num % 1 === 0) {
      return THB_INT.format(num);
    }
    return THB.format(num);
  }

  function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('th-TH', { year: '2-digit', month: '2-digit', day: 'numeric' });
  }

  function toInputDate(d) {
    const date = d ? new Date(d) : new Date();
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function toApiDate(d) {
    if (!d) return null;
    const date = new Date(d);
    return !isNaN(date.getTime()) ? toInputDate(date) : null;
  }

  const ACTION_PIN = '1225';
  function verifyPin(message) {
    const pin = prompt(message || 'การทำงานนี้ต้องใส่รหัสผ่านก่อน\nกรุณาใส่รหัส:');
    if (pin === null) return false;
    if (pin.trim() !== ACTION_PIN) {
      toast('รหัสผ่านไม่ถูกต้อง — ยกเลิกการทำงาน', 'error');
      return false;
    }
    return true;
  }

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.25s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  function skeletonRows(count, cols) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += `<td><div class="skeleton" style="height:14px;width:${60 + (c * 13) % 80}%"></div></td>`;
      }
      html += '</tr>';
    }
    return html;
  }

  function errorBanner(message, onRetry) {
    const div = document.createElement('div');
    div.className = 'error-banner';
    div.innerHTML = `
      <span>&#9888;</span>
      <div class="flex-1">
        <div class="font-semibold">เชื่อมต่อไม่สำเร็จ</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
    if (onRetry) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-sm';
      btn.textContent = 'ลองใหม่';
      btn.onclick = onRetry;
      div.appendChild(btn);
    }
    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'btn btn-amber btn-sm';
    cfgBtn.textContent = '⚙️ ตั้งค่าฐานข้อมูล';
    cfgBtn.onclick = openDbSettingsModal;
    div.appendChild(cfgBtn);
    return div;
  }

  function escapeHtml(str) {
    if (typeof document === 'undefined') {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML !== undefined ? d.innerHTML : String(str ?? '');
  }

  const NAV_ITEMS = [
    { href: 'index.html', label: 'หน้าแรก', icon: '&#128202;', title: 'หน้าแรก' },
    { href: 'tasks.html', label: 'สั่งงานและติดตามงาน', icon: '📋', title: '📋 สั่งงานและติดตามงาน' },
    { href: 'daily-log.html', label: 'บันทึกงานประจำวัน', icon: '&#128221;', title: 'บันทึกงานประจำวัน' },
    { href: 'overview.html', label: 'สรุปภาพรวมงาน', icon: '&#128200;', title: 'สรุปภาพรวมงาน' },
    { href: 'report.html', label: 'สรุปรายบุคคล', icon: '&#128100;', title: 'สรุปรายบุคคล' },
    { href: 'pivot-report.html', label: 'สรุปรายวัน/ไซต์งาน', icon: '&#128203;', title: 'สรุปรายวัน/ไซต์งาน' },
    { href: 'task-cost-report.html', label: 'สรุปต้นทุนตามงาน', icon: '📊', title: '📊 สรุปต้นทุนตามงาน' },
    { href: 'workers.html', label: 'จัดการคนงาน', icon: '&#128119;', title: 'จัดการคนงาน' }
  ];

  function normalizePageName(page) {
    if (!page) return '';
    const clean = String(page).split(/[?#]/)[0];
    const parts = clean.split(/[/\\]/);
    return parts[parts.length - 1];
  }

  function renderSidebar(activePage, container) {
    const current = normalizePageName(activePage);
    const html = NAV_ITEMS.map(item => {
      const isActive = item.href === activePage || item.href === current;
      return `
        <a href="${item.href}" class="nav-tab ${isActive ? 'active' : ''}" title="${item.title || item.label}">
          <span>${item.icon}</span><span>${item.label}</span>
        </a>
      `.trim();
    }).join('\n');

    if (container) {
      if (typeof container === 'string') {
        const el = document.querySelector(container);
        if (el) el.innerHTML = html;
      } else if (container && container.innerHTML !== undefined) {
        container.innerHTML = html;
      }
    }
    return html;
  }

  function renderTaskStatusBadge(status) {
    const s = typeof status === 'string' ? status.trim() : '';
    switch (s) {
      case 'Pending':
      case 'รอดำเนินการ':
        return '<span class="badge badge-warning">รอดำเนินการ</span>';
      case 'In Progress':
      case 'กำลังดำเนินการ':
      case 'กำลังทำ':
        return '<span class="badge badge-info">กำลังดำเนินการ</span>';
      case 'Blocked':
      case 'ติดปัญหา':
        return '<span class="badge badge-danger">ติดปัญหา</span>';
      case 'Completed':
      case 'เสร็จสมบูรณ์':
      case 'เสร็จ':
        return '<span class="badge badge-success">เสร็จสมบูรณ์</span>';
      default:
        return `<span class="badge">${escapeHtml(s || '-')}</span>`;
    }
  }

  function renderProgressBar(percent, options = {}) {
    let p = Math.round(Number(percent));
    if (isNaN(p)) p = 0;
    p = Math.max(0, Math.min(100, p));

    let fillColor = 'var(--blueprint, #3D6B99)';
    let colorClass = 'progress-bar-blue';

    if (options.status === 'Blocked') {
      fillColor = 'var(--red, #C1443C)';
      colorClass = 'progress-bar-danger';
    } else if (p >= 100 || options.status === 'Completed') {
      fillColor = 'var(--green, #3F8F5F)';
      colorClass = 'progress-bar-success';
    } else if (p < 30) {
      fillColor = 'var(--amber, #F2A93B)';
      colorClass = 'progress-bar-warning';
    }

    if (options.color) {
      fillColor = options.color;
    }

    const showText = options.showText !== false;
    const textHtml = showText ? `<span class="progress-text font-mono text-xs font-semibold" style="min-width:38px;text-align:right;">${p}%</span>` : '';

    return `<div class="progress-container flex items-center gap-2" title="${p}%" style="display:flex;align-items:center;gap:0.5rem;width:100%;"><div class="progress-track flex-1 bg-slate-200 rounded-full h-2 overflow-hidden" style="flex:1;background-color:#E2E8F0;min-width:50px;height:7px;border-radius:9999px;overflow:hidden;"><div class="progress-fill ${colorClass} h-full rounded-full transition-all duration-300" style="width:${p}%;background-color:${fillColor};height:100%;border-radius:9999px;"></div></div>${textHtml}</div>`.trim();
  }

  // Inject badge styles if running in browser
  if (typeof document !== 'undefined') {
    const styleId = 'wage-badge-styles';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.55rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
        }
        .badge-warning { background-color: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
        .badge-info { background-color: #E0F2FE; color: #0369A1; border: 1px solid #BAE6FD; }
        .badge-danger { background-color: #FEE2E2; color: #B91C1C; border: 1px solid #FECACA; }
        .badge-success { background-color: #DCFCE7; color: #15803D; border: 1px solid #BBF7D0; }
      `;
      if (document.head) {
        document.head.appendChild(styleEl);
      }
    }
  }

  // ============================================================
  // หน้าต่างตั้งค่าการเชื่อมต่อ Supabase (Cloud Settings Modal)
  // ============================================================
  function openDbSettingsModal() {
    const existing = document.getElementById('db-settings-backdrop');
    if (existing) existing.remove();

    const cfg = Api.getConfig();
    const backdrop = document.createElement('div');
    backdrop.id = 'db-settings-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box" style="max-width:560px">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">⚙️ ตั้งค่าฐานข้อมูลคลาวด์ (Supabase)</h3>
          <button id="db-modal-close" class="btn btn-outline btn-sm">✕ ปิด</button>
        </div>
        <div class="modal-body flex flex-col gap-4">
          <div class="p-3 rounded text-sm" style="background:#F0F6FC;border:1px solid #B8D4F0;color:var(--ink)">
            <strong>สถานะปัจจุบัน:</strong> ${cfg.isCloud ? '🟢 เชื่อมต่อคลาวด์ Supabase' : '💾 โหมดบันทึกในเครื่อง (Local Mode)'}
            <div class="text-xs mt-1" style="color:var(--ink-soft)">
              หากต้องการใช้งานออนไลน์ร่วมกับมือถือให้นำ Project URL และ Anon Key จากเว็บ Supabase มาใส่ด้านล่าง (ดูวิธีทำในไฟล์ <code>supabase/SETUP_GUIDE.md</code>)
            </div>
          </div>

          <div>
            <label class="field-label">Supabase Project URL</label>
            <input type="url" id="sb-url-input" class="field-input font-mono text-sm" placeholder="https://xxxxxxxxxxxx.supabase.co" value="${escapeHtml(cfg.url)}">
          </div>

          <div>
            <label class="field-label">Supabase Anon / Public Key</label>
            <input type="password" id="sb-key-input" class="field-input font-mono text-sm" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." value="${escapeHtml(cfg.key)}">
          </div>

          <div class="flex items-center justify-between gap-2 pt-2 border-t" style="border-color:var(--line)">
            <button id="sb-use-local-btn" class="btn btn-outline btn-sm">💾 สลับใช้โหมดในเครื่อง (ไม่ต้องใช้คีย์)</button>
            <div class="flex gap-2">
              <button id="sb-save-btn" class="btn btn-primary btn-sm">✅ บันทึกและเชื่อมต่อ</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.getElementById('db-modal-close').addEventListener('click', close);

    document.getElementById('sb-use-local-btn').addEventListener('click', () => {
      localStorage.removeItem('WAGE_SUPABASE_URL');
      localStorage.removeItem('WAGE_SUPABASE_KEY');
      toast('สลับเป็นโหมดบันทึกในเครื่อง (Local Mode) เรียบร้อย', 'info');
      close();
      window.location.reload();
    });

    document.getElementById('sb-save-btn').addEventListener('click', () => {
      const urlVal = document.getElementById('sb-url-input').value.trim();
      const keyVal = document.getElementById('sb-key-input').value.trim();
      if (!urlVal || !keyVal) {
        toast('กรุณากรอกทั้ง Project URL และ Anon Key', 'error');
        return;
      }
      localStorage.setItem('WAGE_SUPABASE_URL', urlVal);
      localStorage.setItem('WAGE_SUPABASE_KEY', keyVal);
      toast('บันทึกการตั้งค่า Supabase เรียบร้อย กำลังโหลดข้อมูล...', 'success');
      close();
      window.location.reload();
    });
  }

  function renderShell(activePage, pageTitle) {
    const navHtml = renderSidebar(activePage);

    document.getElementById('app-shell').innerHTML = `
      <div class="flex min-h-screen">
        <aside class="sidebar w-64 shrink-0 hidden md:flex flex-col p-4 gap-1">
          <div class="brand text-lg text-white px-2 pb-4 pt-2 flex items-center gap-2">
            <span style="color:var(--amber)">&#128736;</span>
            <span>บันทึกค่าแรงรายวัน</span>
          </div>
          ${navHtml}
          <div class="mt-auto pt-4 flex flex-col gap-2 border-t border-white/10">
            <button id="sidebar-db-settings-btn" class="nav-tab w-full text-left" style="border-left:none">
              <span>⚙️</span><span>ตั้งค่าคลาวด์ (Supabase)</span>
            </button>
            <div class="px-2 text-xs" style="color:#6B7684">ระบบคิดค่าแรงคนงาน<br>v${APP_VERSION}</div>
          </div>
        </aside>

        <div class="flex-1 min-w-0 flex flex-col">
          <header class="md:hidden sidebar flex items-center justify-between px-4 py-3">
            <div class="brand text-white text-base flex items-center gap-2">
              <span style="color:var(--amber)">&#128736;</span> บันทึกค่าแรงรายวัน
            </div>
            <button id="mobile-nav-toggle" class="text-white text-xl px-2">&#9776;</button>
          </header>
          <nav id="mobile-nav" class="md:hidden hidden sidebar flex flex-col p-3 gap-1 border-t border-white/10">
            ${navHtml}
            <button id="mobile-db-settings-btn" class="nav-tab w-full text-left">
              <span>⚙️</span><span>ตั้งค่าคลาวด์ (Supabase)</span>
            </button>
          </nav>

          <main class="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
            <div class="mb-6 flex items-center justify-between gap-4 flex-wrap">
              <h1 class="font-display text-2xl md:text-3xl font-semibold" style="color:var(--ink)">${pageTitle}</h1>
              <div id="status-badge" class="status-badge status-loading cursor-pointer" title="คลิกเพื่อตั้งค่าการเชื่อมต่อฐานข้อมูล">
                <span class="status-progress-label">⏳ 0%</span>
                <div class="status-progress-track"><div id="status-progress-fill" class="status-progress-fill" style="width:0%"></div></div>
              </div>
            </div>
            <div id="page-content"></div>
          </main>
        </div>
      </div>
      <div id="toast-container"></div>
    `;

    const toggle = document.getElementById('mobile-nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        document.getElementById('mobile-nav').classList.toggle('hidden');
      });
    }

    document.getElementById('sidebar-db-settings-btn')?.addEventListener('click', openDbSettingsModal);
    document.getElementById('mobile-db-settings-btn')?.addEventListener('click', openDbSettingsModal);
    document.getElementById('status-badge')?.addEventListener('click', openDbSettingsModal);

    setTimeout(checkStatus, 100);
  }

  async function checkStatus() {
    const badge = document.getElementById('status-badge');
    if (!badge) return;

    try {
      await Api.getWorkers();
      if (Api.isCloudConfigured()) {
        badge.className = 'status-badge status-online cursor-pointer';
        badge.innerHTML = '🟢 Cloud (Supabase) ⚙️';
      } else {
        badge.className = 'status-badge status-online cursor-pointer';
        badge.innerHTML = '💾 โหมดในเครื่อง (คลิกตั้งค่า Cloud) ⚙️';
      }
    } catch (e) {
      badge.className = 'status-badge status-offline cursor-pointer';
      badge.innerHTML = '🔴 เชื่อมต่อ Cloud ไม่สำเร็จ (คลิกตั้งค่า) ⚙️';
    }
  }

  function compressImage(file, maxWidth = 1000, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (w > maxWidth) {
            h = (maxWidth / w) * h;
            w = maxWidth;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('ไม่สามารถโหลดรูปภาพได้'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      reader.readAsDataURL(file);
    });
  }

  async function animateProgress(button, actionPromise, initialText, successText) {
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `
      <div class="progress-button-content">
        <span class="progress-label">${initialText}</span>
        <div class="progress-track"><div class="progress-fill"></div></div>
      </div>
    `;

    const label = button.querySelector('.progress-label');
    const fill = button.querySelector('.progress-fill');
    let pct = 0;

    const interval = setInterval(() => {
      if (pct < 60) pct += 5;
      else if (pct < 90) pct += 2;
      fill.style.width = `${pct}%`;
      label.textContent = `${initialText} (${Math.floor(pct)}%)`;
    }, 80);

    try {
      const result = await actionPromise;
      clearInterval(interval);
      fill.style.width = '100%';
      label.textContent = successText;
      button.classList.add('progress-success');
      return result;
    } catch (error) {
      clearInterval(interval);
      button.innerHTML = originalContent;
      button.disabled = false;
      throw error;
    }
  }

  return {
    money,
    smartMoney,
    formatDate,
    toInputDate,
    toApiDate,
    toast,
    verifyPin,
    skeletonRows,
    errorBanner,
    escapeHtml,
    renderShell,
    renderSidebar,
    renderTaskStatusBadge,
    renderProgressBar,
    compressImage,
    animateProgress,
    openDbSettingsModal,
    NAV_ITEMS
  };
})();

// ให้บริการผ่าน window.Utils และ window.WAGE_UTILS สำหรับเบราว์เซอร์ และ CommonJS สำหรับ Node.js
if (typeof window !== 'undefined') {
  window.Utils = Utils;
  window.WAGE_UTILS = Utils;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
