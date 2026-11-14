/**
 * tasks-archive.js
 * คลังประวัติใบสั่งงานที่ปิดงวดแล้ว (Archived Job Orders by Payroll Period)
 * จัดเก็บประวัติใบงานที่เสร็จสิ้น 100% แยกตามรอบงวด เพื่อใช้อ้างอิงย้อนหลัง (Read-only)
 */

(function () {
  'use strict';

  const API = window.Api;
  const UTILS = window.Utils;

  let currentBackups = [];
  let selectedBackupId = null;
  let activeBackupData = null;
  let currentTasks = [];
  let filterSearch = '';
  let filterSite = '';

  function escapeHtml(str) {
    return UTILS && typeof UTILS.escapeHtml === 'function' ? UTILS.escapeHtml(str) : String(str || '');
  }

  function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('th-TH', { year: '2-digit', month: '2-digit', day: 'numeric' });
  }

  function renderSubItemStatusIcon(status) {
    switch (status) {
      case 'Completed': return '✅';
      case 'Blocked': return '⚠️';
      case 'Cancelled': return '🚫';
      case 'In Progress': return '🔨';
      default: return '⏳';
    }
  }

  function init() {
    UTILS.renderShell('tasks-archive.html', 'คลังประวัติใบสั่งงานที่ปิดงวด');
    const content = document.getElementById('page-content') || document.getElementById('main-content');
    if (!content) return;

    content.innerHTML = `
      <!-- Header Banner -->
      <div class="ledger-card p-4 sm:p-6 mb-6 bg-gradient-to-r from-slate-900 to-slate-800 text-white border-none shadow-lg">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 text-xs font-semibold mb-2 border border-amber-500/30">
              <span>🔒 โหมดอ่านอย่างเดียว (Read-only Archive)</span>
            </div>
            <h1 class="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <span>📦</span>
              <span>คลังประวัติใบสั่งงานที่ปิดงวดแล้ว</span>
            </h1>
            <p class="text-xs sm:text-sm text-slate-300 mt-1">
              จัดเก็บประวัติใบสั่งงานที่ตรวจรับเสร็จสมบูรณ์ แยกตามรอบการล้างบันทึก/ตัดงวด สำหรับใช้อ้างอิงย้อนหลัง
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <a href="tasks.html" class="btn bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs sm:text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors">
              <span>←</span>
              <span>กลับไปหน้างวดปัจจุบัน</span>
            </a>
          </div>
        </div>
      </div>

      <!-- Period Selector & Summary Bar -->
      <div class="ledger-card p-4 mb-6">
        <div class="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          <div class="flex-1 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <label for="select-archive-backup" class="text-xs font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
              <span>🗓️ เลือกรอบงวดงาน:</span>
            </label>
            <div class="w-full sm:max-w-md">
              <select id="select-archive-backup" class="field-input w-full font-semibold text-slate-800 bg-amber-50/40 border-amber-300">
                <option value="">กำลังโหลดรายการงวดงาน...</option>
              </select>
            </div>
          </div>

          <div id="period-kpi-badges" class="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
            <!-- Badges render dynamic -->
          </div>
        </div>
      </div>

      <!-- Filters & Search -->
      <div class="ledger-card p-4 mb-6">
        <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div class="flex-1 flex flex-col sm:flex-row gap-2">
            <div class="relative flex-1">
              <input
                type="text"
                id="archive-search"
                placeholder="🔍 ค้นหารหัสงาน TSK, ชื่องาน, ไซต์งาน, ผู้สั่งงาน..."
                class="field-input w-full text-xs sm:text-sm"
              >
            </div>
            <div class="w-full sm:w-48">
              <select id="archive-filter-site" class="field-input w-full text-xs sm:text-sm">
                <option value="">ทุกไซต์งาน</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Tasks Grid Container -->
      <div id="archive-tasks-container" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div class="col-span-full ledger-card p-12 text-center text-slate-500">
          <div class="text-4xl mb-3">⏳</div>
          <div class="font-semibold text-slate-700">กำลังโหลดข้อมูลประวัติใบสั่งงาน...</div>
        </div>
      </div>

      <!-- Task Detail Modal (Read-only) -->
      <div id="archive-detail-modal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
          <div class="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div class="flex items-center gap-2">
              <span class="text-lg">📜</span>
              <h3 id="modal-task-title" class="font-bold text-slate-800 text-sm sm:text-base">รายละเอียดใบสั่งงาน</h3>
            </div>
            <button type="button" id="btn-close-modal" class="text-slate-400 hover:text-slate-600 text-lg px-2">✕</button>
          </div>
          <div id="modal-task-body" class="p-4 overflow-y-auto space-y-4 text-xs sm:text-sm">
            <!-- Modal Content -->
          </div>
          <div class="p-3 border-t border-slate-200 bg-slate-50 flex justify-end">
            <button type="button" id="btn-close-modal-footer" class="btn btn-outline text-xs">ปิดหน้าต่าง</button>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    loadBackupsList();
  }

  function bindEvents() {
    const backupSelect = document.getElementById('select-archive-backup');
    if (backupSelect) {
      backupSelect.addEventListener('change', (e) => {
        selectedBackupId = e.target.value;
        if (selectedBackupId) {
          loadBackupDetails(selectedBackupId);
        }
      });
    }

    const searchInput = document.getElementById('archive-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        filterSearch = e.target.value.trim().toLowerCase();
        renderArchiveTasks();
      });
    }

    const siteSelect = document.getElementById('archive-filter-site');
    if (siteSelect) {
      siteSelect.addEventListener('change', (e) => {
        filterSite = e.target.value;
        renderArchiveTasks();
      });
    }

    const closeModalBtn = document.getElementById('btn-close-modal');
    const closeModalFooter = document.getElementById('btn-close-modal-footer');
    const modal = document.getElementById('archive-detail-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
    if (closeModalFooter) closeModalFooter.addEventListener('click', () => modal.classList.add('hidden'));
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }
  }

  async function loadBackupsList() {
    const backupSelect = document.getElementById('select-archive-backup');
    const container = document.getElementById('archive-tasks-container');

    try {
      const backups = await API.listBackups();
      currentBackups = Array.isArray(backups) ? backups : [];

      if (!backupSelect) return;

      if (currentBackups.length === 0) {
        backupSelect.innerHTML = `<option value="">-- ไม่พบชุดสำรองงวดงานในระบบ --</option>`;
        container.innerHTML = `
          <div class="col-span-full ledger-card p-12 text-center text-slate-500">
            <div class="text-4xl mb-3">📭</div>
            <div class="font-display text-lg font-semibold text-slate-700 mb-1">ยังไม่มีประวัติงวดงานที่ปิดยอด</div>
            <div class="text-sm text-slate-500 max-w-md mx-auto">
              เมื่อมีการกดปุ่ม "ล้างบันทึก" หรือตัดงวดงานในอนาคต ใบสั่งงานที่เสร็จสิ้น 100% จะถูกรวบรวมนำมาจัดเก็บไว้ในคลังนี้อัตโนมัติ
            </div>
            <div class="mt-4">
              <a href="tasks.html" class="btn btn-primary text-xs">ไปที่หน้าใบสั่งงานปัจจุบัน</a>
            </div>
          </div>
        `;
        return;
      }

      backupSelect.innerHTML = currentBackups.map((b, idx) => {
        const title = b.name || `งวดวันที่ ${formatDate(b.createdDate || b.created_at)}`;
        return `<option value="${escapeHtml(b.id)}">${idx === 0 ? '📌 (ล่าสุด) ' : ''}${escapeHtml(title)}</option>`;
      }).join('');

      // Auto select the first backup
      selectedBackupId = currentBackups[0].id;
      loadBackupDetails(selectedBackupId);

    } catch (err) {
      console.error('Error loading backup list:', err);
      if (container) {
        container.innerHTML = `
          <div class="col-span-full ledger-card p-8 text-center text-red-600">
            <div class="text-3xl mb-2">⚠️</div>
            <div class="font-semibold">ไม่สามารถโหลดรายการงวดงานได้</div>
            <div class="text-xs text-slate-500 mt-1">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    }
  }

  async function loadBackupDetails(fileId) {
    const container = document.getElementById('archive-tasks-container');
    const badgesEl = document.getElementById('period-kpi-badges');
    if (container) {
      container.innerHTML = `
        <div class="col-span-full ledger-card p-12 text-center text-slate-500">
          <div class="text-4xl mb-3 animate-spin">⏳</div>
          <div class="font-semibold text-slate-700">กำลังดึงข้อมูลใบสั่งงานของงวดนี้...</div>
        </div>
      `;
    }

    try {
      const data = await API.getBackupData({ fileId });
      activeBackupData = data;

      // Extract tasks from backup
      let tasks = [];
      if (Array.isArray(data.completedTasks) && data.completedTasks.length > 0) {
        tasks = data.completedTasks;
      } else if (Array.isArray(data.tasks) && data.tasks.length > 0) {
        const completed = data.tasks.filter(t => t.status === 'Completed' || Number(t.progress) >= 100);
        tasks = completed.length > 0 ? completed : data.tasks;
      } else if (Array.isArray(data.allTasks) && data.allTasks.length > 0) {
        const completed = data.allTasks.filter(t => t.status === 'Completed' || Number(t.progress) >= 100);
        tasks = completed.length > 0 ? completed : data.allTasks;
      }

      currentTasks = tasks;

      // Update KPI Badges
      if (badgesEl) {
        badgesEl.innerHTML = `
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 font-semibold">
            <span>📋</span> งานที่จัดเก็บ: ${currentTasks.length} รายการ
          </span>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
            <span>✅</span> เสร็จสมบูรณ์: ${currentTasks.filter(t => t.status === 'Completed' || Number(t.progress) >= 100).length} รายการ
          </span>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700">
            <span>📅</span> บันทึกเมื่อ: ${formatDate(data.createdDate)}
          </span>
        `;
      }

      // Update site filter
      updateSiteFilter(currentTasks);
      renderArchiveTasks();

    } catch (err) {
      console.error('Error loading backup details:', err);
      if (container) {
        container.innerHTML = `
          <div class="col-span-full ledger-card p-8 text-center text-red-600">
            <div class="text-3xl mb-2">⚠️</div>
            <div class="font-semibold">ไม่สามารถอ่านข้อมูลใบงานในงวดนี้ได้</div>
            <div class="text-xs text-slate-500 mt-1">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    }
  }

  function updateSiteFilter(tasks) {
    const siteSelect = document.getElementById('archive-filter-site');
    if (!siteSelect) return;
    const sites = Array.from(new Set(tasks.map(t => t.site).filter(Boolean))).sort();
    siteSelect.innerHTML = `<option value="">ทุกไซต์งาน (${sites.length} ไซต์)</option>` +
      sites.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  function getFilteredTasks() {
    return currentTasks.filter(task => {
      if (filterSite && task.site !== filterSite) return false;
      if (filterSearch) {
        const text = [
          task.task_code,
          task.title,
          task.site,
          task.zone,
          task.assigned_by,
          task.notes
        ].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(filterSearch)) return false;
      }
      return true;
    });
  }

  function renderArchiveTasks() {
    const container = document.getElementById('archive-tasks-container');
    if (!container) return;

    const filtered = getFilteredTasks();

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="col-span-full ledger-card p-12 text-center text-slate-500">
          <div class="text-4xl mb-3">🔍</div>
          <div class="font-display text-lg font-semibold text-slate-700 mb-1">ไม่พบใบงานตามคำค้นหาในงวดนี้</div>
          <div class="text-sm">ลองเปลี่ยนคำค้นหา หรือเลือกไซต์งานอื่น</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(task => {
      const subItems = Array.isArray(task.sub_items) ? task.sub_items : [];
      const attachments = Array.isArray(task.attachments) ? task.attachments : [];
      const completedSubCount = subItems.filter(i => i.status === 'Completed').length;
      const totalSubCount = subItems.filter(i => i.status !== 'Cancelled').length;

      return `
        <div class="ledger-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow border-slate-200 relative group">
          <!-- Card Header -->
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                ${escapeHtml(task.task_code || `#${task.id}`)}
              </span>
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <span>✅</span> เสร็จสมบูรณ์
              </span>
            </div>

            <!-- Title & Site -->
            <h3 class="font-display font-semibold text-slate-800 text-sm sm:text-base leading-snug mb-1 line-clamp-2">
              ${escapeHtml(task.title || 'ไม่มีชื่อใบงาน')}
            </h3>
            <div class="text-xs text-slate-500 mb-2 flex items-center gap-1 flex-wrap">
              <span>📍 ${escapeHtml(task.site || '-')}</span>
              ${task.zone ? `<span class="text-slate-400">• ${escapeHtml(task.zone)}</span>` : ''}
            </div>

            <!-- Progress bar (100%) -->
            <div class="mb-3">
              <div class="flex justify-between items-center text-xs mb-1">
                <span class="text-slate-500">ความคืบหน้ารวม</span>
                <span class="font-mono font-bold text-emerald-700">100%</span>
              </div>
              <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                <div class="bg-emerald-600 h-full rounded-full w-full"></div>
              </div>
            </div>

            <!-- Sub items preview -->
            ${subItems.length > 0 ? `
              <div class="mb-3 p-2 rounded bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div class="flex justify-between items-center text-[11px] font-semibold text-slate-600 pb-1 border-b border-slate-200">
                  <span>รายการงานย่อย (${completedSubCount}/${totalSubCount} เสร็จ)</span>
                  <span>ปริมาณสะสม</span>
                </div>
                <div class="max-h-24 overflow-y-auto space-y-1 pr-1">
                  ${subItems.map(it => `
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-slate-700 truncate pr-2">${renderSubItemStatusIcon(it.status)} ${escapeHtml(it.name)}</span>
                      <span class="font-mono text-emerald-700 shrink-0 font-semibold">${it.actual_qty || 0} ${escapeHtml(it.unit || '')}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Metadata footer on card -->
            <div class="pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex flex-wrap justify-between gap-1">
              <span>👤 สั่งโดย: ${escapeHtml(task.assigned_by || task.ordered_by || '-')}</span>
              <span>📅 วันที่สั่ง: ${formatDate(task.assigned_date || task.order_date)}</span>
            </div>
          </div>

          <!-- Bottom Action -->
          <div class="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
            <span class="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-medium">
              🔒 ปิดงวดแล้ว
            </span>
            <button
              type="button"
              class="btn btn-outline btn-sm text-xs py-1 px-2.5 btn-view-task-detail"
              data-task-id="${escapeHtml(task.id)}"
            >
              🔍 ดูรายละเอียดทั้งหมด
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to detail buttons
    container.querySelectorAll('.btn-view-task-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.currentTarget.dataset.taskId;
        const task = currentTasks.find(t => String(t.id) === String(taskId));
        if (task) {
          openTaskDetailModal(task);
        }
      });
    });
  }

  function openTaskDetailModal(task) {
    const modal = document.getElementById('archive-detail-modal');
    const titleEl = document.getElementById('modal-task-title');
    const bodyEl = document.getElementById('modal-task-body');
    if (!modal || !bodyEl) return;

    if (titleEl) {
      titleEl.textContent = `[${task.task_code || `#${task.id}`}] ${task.title || ''}`;
    }

    const subItems = Array.isArray(task.sub_items) ? task.sub_items : [];
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];

    bodyEl.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <div><span class="text-slate-400">ไซต์งาน:</span> <strong class="text-slate-800">${escapeHtml(task.site || '-')}</strong></div>
        <div><span class="text-slate-400">ตำแหน่ง/โซน:</span> <strong class="text-slate-800">${escapeHtml(task.zone || '-')}</strong></div>
        <div><span class="text-slate-400">ผู้สั่งงาน:</span> <strong class="text-slate-800">${escapeHtml(task.assigned_by || task.ordered_by || '-')}</strong></div>
        <div><span class="text-slate-400">วันที่สั่งงาน:</span> <strong class="text-slate-800">${formatDate(task.assigned_date || task.order_date)}</strong></div>
      </div>

      <!-- Sub items full list -->
      <div>
        <h4 class="font-semibold text-slate-800 text-xs sm:text-sm mb-2 flex items-center gap-1.5">
          <span>📋</span> รายการงานย่อยทั้งหมดในใบงานนี้:
        </h4>
        ${subItems.length > 0 ? `
          <div class="border border-slate-200 rounded-lg overflow-hidden">
            <table class="w-full text-xs">
              <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                <tr>
                  <th class="p-2 text-left">รายการ</th>
                  <th class="p-2 text-center" style="width: 80px;">สถานะ</th>
                  <th class="p-2 text-right" style="width: 100px;">เป้าหมาย</th>
                  <th class="p-2 text-right" style="width: 100px;">ทำจริงสะสม</th>
                  <th class="p-2 text-right" style="width: 70px;">ความคืบหน้า</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${subItems.map(it => `
                  <tr>
                    <td class="p-2 text-slate-800">${escapeHtml(it.name)}</td>
                    <td class="p-2 text-center font-semibold text-emerald-700">${renderSubItemStatusIcon(it.status)} ${escapeHtml(it.status || '')}</td>
                    <td class="p-2 text-right font-mono text-slate-600">${it.target_qty ? `${it.target_qty} ${escapeHtml(it.unit || '')}` : '-'}</td>
                    <td class="p-2 text-right font-mono font-semibold text-emerald-700">${it.actual_qty || 0} ${escapeHtml(it.unit || '')}</td>
                    <td class="p-2 text-right font-mono text-emerald-700 font-bold">${it.progress_percent || 0}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="p-4 bg-slate-50 border border-slate-200 rounded text-center text-slate-400 text-xs">
            ใบสั่งงานนี้ไม่มีรายการย่อย (ประเมินความคืบหน้ารวม 100%)
          </div>
        `}
      </div>

      ${task.notes ? `
        <div>
          <h4 class="font-semibold text-slate-800 text-xs sm:text-sm mb-1">📝 รายละเอียดเพิ่มเติม / หมายเหตุ:</h4>
          <div class="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap">${escapeHtml(task.notes)}</div>
        </div>
      ` : ''}

      ${attachments.length > 0 ? `
        <div>
          <h4 class="font-semibold text-slate-800 text-xs sm:text-sm mb-1">📎 เอกสาร / รูปภาพแนบ (${attachments.length} ไฟล์):</h4>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${attachments.map(att => `
              <div class="p-2 rounded border border-slate-200 bg-slate-50 flex items-center gap-2 text-xs">
                <span>📄</span>
                <span class="truncate flex-1 font-medium text-slate-700">${escapeHtml(att.name || 'เอกสารแนบ')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
        <span>🔒</span>
        <span>ใบงานนี้ถูกตรวจรับ ปิดยอด และจัดเก็บเข้าชุดสำรองงวดงานเรียบร้อยแล้ว (ไม่สามารถแก้ไขได้)</span>
      </div>
    `;

    modal.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
