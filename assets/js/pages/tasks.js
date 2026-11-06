/**
 * Task Board & Job Orders Page (assets/js/pages/tasks.js)
 * สั่งงานและติดตามความคืบหน้า (Job Orders)
 * Integrated with WAGE_API and Utils
 */
(() => {
  // 1. Initial shell layout
  const UTILS = window.WAGE_UTILS || window.Utils || (typeof Utils !== 'undefined' ? Utils : {});
  const API = window.WAGE_API || (typeof Api !== 'undefined' ? Api : {});

  UTILS.renderShell('tasks.html', 'สั่งงานและติดตามความคืบหน้า (Job Orders)');
  const content = document.getElementById('page-content');
  if (!content) return;

  // Local state
  let allTasks = [];
  let allWorkers = [];
  let editingTaskId = null;
  let activeTimelineTaskId = null;
  let activeCompletionTaskId = null;

  // 2. Base Page Structure (KPI Cards, Action Bar, Task Container, Modals)
  content.innerHTML = `
    <!-- KPI Summary Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="ledger-card kpi-card p-4" style="--tick-color: var(--blueprint);">
        <div class="kpi-label">งานทั้งหมด (Total Tasks)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-slate-800" id="kpi-total-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">ใบสั่งงานในระบบทั้งหมด</div>
      </div>
      <div class="ledger-card kpi-card p-4" style="--tick-color: var(--amber);">
        <div class="kpi-label">กำลังทำ (In Progress)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-amber-600" id="kpi-inprogress-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">กำลังดำเนินการหน้างาน</div>
      </div>
      <div class="ledger-card kpi-card p-4" style="--tick-color: var(--red);">
        <div class="kpi-label">ติดปัญหา (Blocked)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-red-600" id="kpi-blocked-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">ต้องการการแก้ไขเร่งด่วน</div>
      </div>
      <div class="ledger-card kpi-card p-4" style="--tick-color: var(--green);">
        <div class="kpi-label">เสร็จสมบูรณ์ (Completed)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-green-700" id="kpi-completed-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">ตรวจรับและปิดงานแล้ว</div>
      </div>
    </div>

    <!-- Action Bar & Filters -->
    <div class="ledger-card p-4 mb-6">
      <div class="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div class="flex-1 flex flex-col sm:flex-row gap-2">
          <!-- Search Input -->
          <div class="relative flex-1">
            <input
              type="text"
              id="task-search"
              placeholder="🔍 ค้นหารหัสงาน, ชื่องาน, ไซต์, ผู้รับผิดชอบ..."
              class="field-input w-full"
            >
          </div>

          <!-- Status Filter -->
          <div class="w-full sm:w-48">
            <select id="filter-status" name="filter-status" class="field-input w-full">
              <option value="">สถานะทั้งหมด</option>
              <option value="Active">เฉพาะงานที่ยังไม่เสร็จ (Active)</option>
              <option value="Pending">รอดำเนินการ (Pending)</option>
              <option value="In Progress">กำลังดำเนินการ (In Progress)</option>
              <option value="Blocked">ติดปัญหา (Blocked)</option>
              <option value="Completed">เสร็จสมบูรณ์ (Completed)</option>
            </select>
          </div>

          <!-- Site Filter -->
          <div class="w-full sm:w-48">
            <select id="filter-site" name="filter-site" class="field-input w-full">
              <option value="">ทุกไซต์งาน</option>
            </select>
          </div>
        </div>

        <!-- Add Task Button -->
        <button
          type="button"
          id="btn-create-task"
          data-action="create-task"
          class="btn btn-primary shrink-0 flex items-center justify-center gap-1.5"
        >
          <span>➕</span>
          <span>สั่งงานใหม่</span>
        </button>
      </div>
    </div>

    <!-- Task List / Cards Container -->
    <div id="tasks-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div class="col-span-full text-center py-12 text-slate-500">
        <div class="inline-block animate-spin text-2xl mb-2">⏳</div>
        <div>กำลังโหลดรายการใบสั่งงาน...</div>
      </div>
    </div>

    <!-- Modal 1: Create / Edit Task Modal -->
    <div id="modal-task-form" class="modal-backdrop hidden">
      <div class="modal-box max-w-xl">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold text-slate-800" id="task-modal-title">➕ สั่งงานใหม่ (Job Order)</h3>
          <button type="button" id="btn-close-task-modal" class="btn btn-outline btn-sm">✕</button>
        </div>
        <form id="task-form" class="modal-body space-y-4">
          <input type="hidden" id="task-input-id" value="">

          <div>
            <label class="field-label" for="task-input-title">ชื่องาน / รายละเอียดคำสั่ง <span class="text-red-500">*</span></label>
            <input type="text" id="task-input-title" name="title" class="field-input w-full" required placeholder="เช่น งานเทเสาชั้น 2, ก่ออิฐห้องน้ำ">
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="task-input-site">ไซต์งาน (Site) <span class="text-red-500">*</span></label>
              <input type="text" id="task-input-site" name="site" class="field-input w-full" required placeholder="เช่น ไซต์สุขุมวิท 101" list="sites-datalist">
              <datalist id="sites-datalist"></datalist>
            </div>
            <div>
              <label class="field-label" for="task-input-location">ตำแหน่ง / โซนในไซต์</label>
              <input type="text" id="task-input-location" name="location_detail" class="field-input w-full" placeholder="เช่น โซน B อาคาร 1 ชั้น 2">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="task-input-assigned">ผู้รับผิดชอบ / หัวหน้างาน</label>
              <input type="text" id="task-input-assigned" name="assigned_to" class="field-input w-full" placeholder="เลือกหรือพิมพ์ชื่อคนงาน" list="workers-datalist">
              <datalist id="workers-datalist"></datalist>
            </div>
            <div>
              <label class="field-label" for="task-input-ordered-by">ผู้สั่งงาน</label>
              <input type="text" id="task-input-ordered-by" name="ordered_by" class="field-input w-full" placeholder="เช่น วิศวกรธีรเดช">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="task-input-order-date">วันที่สั่งงาน</label>
              <input type="date" id="task-input-order-date" name="order_date" class="field-input w-full">
            </div>
            <div>
              <label class="field-label" for="task-input-due-date">กำหนดเสร็จ (Due Date)</label>
              <input type="date" id="task-input-due-date" name="due_date" class="field-input w-full">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="edit-status-row">
            <div>
              <label class="field-label" for="task-input-status">สถานะงาน</label>
              <select id="task-input-status" name="status" class="field-input w-full">
                <option value="Pending">รอดำเนินการ (Pending)</option>
                <option value="In Progress">กำลังดำเนินการ (In Progress)</option>
                <option value="Blocked">ติดปัญหา (Blocked)</option>
                <option value="Completed">เสร็จสมบูรณ์ (Completed)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="task-input-percent">ความคืบหน้า (%)</label>
              <input type="number" id="task-input-percent" name="progress_percent" class="field-input w-full" min="0" max="100" value="0">
            </div>
          </div>

          <div>
            <label class="field-label" for="task-input-desc">รายละเอียดเพิ่มเติม / ขอบเขตงาน</label>
            <textarea id="task-input-desc" name="description" rows="3" class="field-input w-full" placeholder="ระบุรายละเอียด ข้อกำหนด เครื่องมือที่ต้องใช้ หรือข้อควรระวัง..."></textarea>
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button type="button" id="btn-cancel-task-form" class="btn btn-outline">ยกเลิก</button>
            <button type="submit" id="btn-submit-task-form" class="btn btn-primary">
              <span id="task-form-submit-label">บันทึกใบสั่งงาน</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal 2: Progress & Issue Timeline Modal -->
    <div id="modal-timeline" class="modal-backdrop hidden">
      <div class="modal-box max-w-2xl">
        <div class="modal-header">
          <div>
            <h3 class="font-display text-lg font-semibold text-slate-800" id="timeline-modal-title">🔍 ไทม์ไลน์ความคืบหน้า & ปัญหา</h3>
            <div class="text-xs text-slate-500" id="timeline-modal-subtitle">รหัสงาน: -</div>
          </div>
          <button type="button" id="btn-close-timeline-modal" class="btn btn-outline btn-sm">✕</button>
        </div>
        <div class="modal-body space-y-5">
          <!-- Timeline History Display -->
          <div>
            <h4 class="text-sm font-semibold text-slate-700 mb-2">ประวัติการอัปเดตงาน</h4>
            <div id="timeline-history-container" class="space-y-3 max-h-60 overflow-y-auto pr-1">
              <!-- Dynamically populated entries -->
            </div>
          </div>

          <!-- New Progress Note Form -->
          <div class="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <h4 class="text-sm font-semibold text-slate-700 mb-3">➕ บันทึกความคืบหน้า / อัปเดตปัญหาใหม่</h4>
            <form id="timeline-progress-form" class="space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="field-label" for="timeline-input-percent">ความคืบหน้า (%) <span class="text-red-500">*</span></label>
                  <input type="number" id="timeline-input-percent" name="percent" min="0" max="100" class="field-input w-full" required placeholder="0-100">
                </div>
                <div>
                  <label class="field-label" for="timeline-input-date">วันที่อัปเดต</label>
                  <input type="date" id="timeline-input-date" name="date" class="field-input w-full">
                </div>
                <div>
                  <label class="field-label" for="timeline-input-by">ผู้รายงาน / บันทึก</label>
                  <input type="text" id="timeline-input-by" name="by" class="field-input w-full" placeholder="ชื่อผู้บันทึก">
                </div>
              </div>

              <div>
                <label class="field-label" for="timeline-input-issues">ปัญหาหรืออุปสรรคที่พบ (ถ้ามี)</label>
                <input type="text" id="timeline-input-issues" name="issues" class="field-input w-full" placeholder="เช่น ฝนตกหนัก, ขาดวัสดุชั่วคราว, รอตรวจงาน">
              </div>

              <div>
                <label class="field-label" for="timeline-input-resolution">แนวทางแก้ไข / วิธีจัดการ</label>
                <input type="text" id="timeline-input-resolution" name="resolution" class="field-input w-full" placeholder="เช่น กางผ้าใบคลุม, เร่งสั่งของเพิ่มรอบบ่าย">
              </div>

              <div class="flex justify-end pt-2">
                <button type="submit" class="btn btn-primary btn-sm">บันทึกความคืบหน้า</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal 3: Completion Modal (Supervisor Sign-off) -->
    <div id="modal-complete-task" class="modal-backdrop hidden">
      <div class="modal-box max-w-lg">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold text-slate-800">✅ ตรวจรับและปิดงาน (Supervisor Sign-off)</h3>
          <button type="button" id="btn-close-complete-modal" class="btn btn-outline btn-sm">✕</button>
        </div>
        <form id="complete-task-form" class="modal-body space-y-4">
          <div class="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 text-sm">
            การปิดงานจะปรับความคืบหน้าของงานเป็น <strong>100%</strong> และเปลี่ยนสถานะเป็น <strong>เสร็จสมบูรณ์ (Completed)</strong>
          </div>

          <div>
            <label class="field-label" for="complete-input-summary">
              สรุปผลการทำงานจริง & หมายเหตุการตรวจรับ <span class="text-red-500">*</span>
            </label>
            <textarea
              id="complete-input-summary"
              name="completion_summary"
              rows="4"
              class="field-input w-full"
              required
              placeholder="สรุปผลการทำงานจริง วิธีการแก้ปัญหาที่ใช้ และผลการตรวจรับงานก่อนปิด..."
            ></textarea>
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button type="button" id="btn-cancel-complete-modal" class="btn btn-outline">ยกเลิก</button>
            <button type="submit" class="btn btn-primary" style="background:var(--green); border-color:var(--green);">
              ✅ ยืนยันปิดงาน (100%)
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  // 3. Helper functions & Rendering
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(d) {
    if (!d) return '-';
    if (typeof UTILS.formatDate === 'function') {
      return UTILS.formatDate(d);
    }
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('th-TH', { year: '2-digit', month: '2-digit', day: 'numeric' });
  }

  function getTodayString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 4. Update KPI Dashboard Cards
  function updateKpiCards(tasks) {
    const total = tasks.length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    const completed = tasks.filter(t => t.status === 'Completed').length;

    const elTotal = document.getElementById('kpi-total-tasks');
    const elInProgress = document.getElementById('kpi-inprogress-tasks');
    const elBlocked = document.getElementById('kpi-blocked-tasks');
    const elCompleted = document.getElementById('kpi-completed-tasks');

    if (elTotal) elTotal.textContent = String(total);
    if (elInProgress) elInProgress.textContent = String(inProgress);
    if (elBlocked) elBlocked.textContent = String(blocked);
    if (elCompleted) elCompleted.textContent = String(completed);
  }

  // 5. Update Site Filter Dropdown Options
  function updateSiteFilterOptions(tasks) {
    const siteSelect = document.getElementById('filter-site');
    const sitesDatalist = document.getElementById('sites-datalist');
    if (!siteSelect) return;

    const currentVal = siteSelect.value;
    const uniqueSites = Array.from(new Set(tasks.map(t => t.site).filter(Boolean))).sort();

    siteSelect.innerHTML = '<option value="">ทุกไซต์งาน</option>' +
      uniqueSites.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    if (uniqueSites.includes(currentVal)) {
      siteSelect.value = currentVal;
    }

    if (sitesDatalist) {
      sitesDatalist.innerHTML = uniqueSites.map(s => `<option value="${escapeHtml(s)}">`).join('');
    }
  }

  // 6. Update Workers Datalist
  function updateWorkersDatalist(workers) {
    const dl = document.getElementById('workers-datalist');
    if (!dl) return;
    const names = workers.map(w => w.FullName || w.name).filter(Boolean);
    dl.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join('');
  }

  // 7. Filter & Search Logic
  function getFilteredTasks() {
    const searchInput = document.getElementById('task-search');
    const statusSelect = document.getElementById('filter-status');
    const siteSelect = document.getElementById('filter-site');

    const query = (searchInput?.value || '').trim().toLowerCase();
    const statusVal = statusSelect?.value || '';
    const siteVal = siteSelect?.value || '';

    return allTasks.filter(task => {
      // Status filter
      if (statusVal === 'Active') {
        if (task.status === 'Completed') return false;
      } else if (statusVal) {
        if (task.status !== statusVal) return false;
      }

      // Site filter
      if (siteVal && task.site !== siteVal) {
        return false;
      }

      // Search query
      if (query) {
        const matchCode = (task.task_code || '').toLowerCase().includes(query);
        const matchTitle = (task.title || '').toLowerCase().includes(query);
        const matchSite = (task.site || '').toLowerCase().includes(query);
        const matchLoc = (task.location_detail || '').toLowerCase().includes(query);
        const matchAssigned = (task.assigned_to || '').toLowerCase().includes(query);
        const matchOrdered = (task.ordered_by || '').toLowerCase().includes(query);
        if (!matchCode && !matchTitle && !matchSite && !matchLoc && !matchAssigned && !matchOrdered) {
          return false;
        }
      }

      return true;
    });
  }

  // 8. Render Task Cards
  function renderTasks() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    const filtered = getFilteredTasks();

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="col-span-full ledger-card p-12 text-center text-slate-500">
          <div class="text-4xl mb-3">📋</div>
          <div class="font-display text-lg font-semibold text-slate-700 mb-1">ไม่พบใบสั่งงานตามเงื่อนไขที่เลือก</div>
          <div class="text-sm">ลองปรับคำค้นหา หรือเปลี่ยนตัวกรองสถานะ/ไซต์งาน</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(task => {
      const badgeHtml = typeof UTILS.renderTaskStatusBadge === 'function'
        ? UTILS.renderTaskStatusBadge(task.status)
        : `<span class="badge">${escapeHtml(task.status)}</span>`;

      const progressHtml = typeof UTILS.renderProgressBar === 'function'
        ? UTILS.renderProgressBar(task.progress_percent, { status: task.status })
        : `<div class="text-sm font-semibold">${task.progress_percent || 0}%</div>`;

      const hasIssues = Boolean(task.issues && task.issues.trim());
      const hasResolution = Boolean(task.resolution && task.resolution.trim());
      const hasCompletionSummary = Boolean(task.completion_summary && task.completion_summary.trim());
      const isCompleted = task.status === 'Completed';

      return `
        <div class="ledger-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow relative">
          <!-- Top Row: Code & Status Badge -->
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                ${escapeHtml(task.task_code || `TSK-${task.id}`)}
              </span>
              <div>${badgeHtml}</div>
            </div>

            <!-- Task Title -->
            <h3 class="font-semibold text-base text-slate-800 leading-snug mb-1">
              ${escapeHtml(task.title || 'ไม่ระบุชื่อใบสั่งงาน')}
            </h3>

            <!-- Site & Location -->
            <div class="text-xs text-slate-500 mb-3 flex items-center gap-1 flex-wrap">
              <span>📍 <strong>${escapeHtml(task.site || '-')}</strong></span>
              ${task.location_detail ? `<span class="text-slate-400">• ${escapeHtml(task.location_detail)}</span>` : ''}
            </div>

            <!-- Progress Bar -->
            <div class="mb-3">
              <div class="text-xs font-semibold text-slate-600 mb-1 flex justify-between">
                <span>ความคืบหน้า</span>
                <span>${task.progress_percent || 0}%</span>
              </div>
              ${progressHtml}
            </div>

            <!-- Assignment & Dates Info -->
            <div class="text-xs text-slate-600 space-y-1 mb-3 pt-2 border-t border-slate-100">
              <div class="flex items-center justify-between">
                <span class="text-slate-400">👤 ผู้รับผิดชอบ:</span>
                <span class="font-medium text-slate-700">${escapeHtml(task.assigned_to || '-')}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-400">📅 วันที่สั่ง:</span>
                <span>${formatDate(task.order_date)}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-400">⏱️ กำหนดเสร็จ:</span>
                <span class="${task.due_date && new Date(task.due_date) < new Date() && !isCompleted ? 'text-red-600 font-medium' : ''}">${formatDate(task.due_date)}</span>
              </div>
            </div>

            <!-- Issues / Resolution Excerpt -->
            ${hasIssues || hasResolution ? `
              <div class="mb-3 p-2.5 rounded bg-amber-50/70 border border-amber-200/80 text-xs space-y-1">
                ${hasIssues ? `<div class="text-red-700 font-medium">⚠️ ปัญหา: ${escapeHtml(task.issues)}</div>` : ''}
                ${hasResolution ? `<div class="text-emerald-800">💡 แนวทาง: ${escapeHtml(task.resolution)}</div>` : ''}
              </div>
            ` : ''}

            <!-- Completion Summary (if Completed) -->
            ${isCompleted && hasCompletionSummary ? `
              <div class="mb-3 p-2.5 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                <div class="font-semibold mb-0.5">🏁 สรุปปิดงาน:</div>
                <div>${escapeHtml(task.completion_summary)}</div>
              </div>
            ` : ''}
          </div>

          <!-- Bottom Actions -->
          <div class="pt-3 border-t border-slate-100 flex flex-wrap gap-1.5 justify-end">
            <!-- Timeline & Issues Button -->
            <button
              type="button"
              id="btn-timeline-task-${task.id}"
              data-action="timeline-task"
              data-id="${task.id}"
              class="btn btn-outline btn-sm text-xs"
              title="ดูประวัติไทม์ไลน์และบันทึกปัญหา"
            >
              🔍 ไทม์ไลน์
            </button>

            <!-- Cost Report Button -->
            <a
              href="task-cost-report.html?task_id=${task.id}"
              class="btn btn-outline btn-sm text-xs inline-flex items-center gap-1"
              title="ดูรายงานสรุปต้นทุนค่าแรงของงานนี้"
            >
              📊 ต้นทุนค่าแรง
            </a>

            <!-- Edit Button -->
            <button
              type="button"
              id="btn-edit-task-${task.id}"
              data-action="edit-task"
              data-id="${task.id}"
              class="btn btn-outline btn-sm text-xs"
              title="แก้ไขข้อมูลใบสั่งงาน"
            >
              ✏️ แก้ไข
            </button>

            <!-- Complete Sign-off Button (Non-completed only) -->
            ${!isCompleted ? `
              <button
                type="button"
                id="btn-complete-task-${task.id}"
                data-action="complete-task"
                data-id="${task.id}"
                class="btn btn-sm text-xs font-medium text-white"
                style="background:var(--green); border-color:var(--green);"
                title="ตรวจรับงานและปิดงาน (100%)"
              >
                ✅ ปิดงาน
              </button>
            ` : ''}

            <!-- Delete Button -->
            <button
              type="button"
              id="btn-delete-task-${task.id}"
              data-action="delete-task"
              data-id="${task.id}"
              class="btn btn-danger btn-sm text-xs"
              title="ลบใบสั่งงาน (ต้องใส่ PIN)"
            >
              🗑️ ลบ
            </button>
          </div>
        </div>
      `;
    }).join('');

    attachCardActionHandlers();
  }

  // 9. Attach Event Listeners to Card Buttons
  function attachCardActionHandlers() {
    // Edit buttons
    document.querySelectorAll('[data-action="edit-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openEditModal(id);
      };
    });

    // Timeline buttons
    document.querySelectorAll('[data-action="timeline-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openTimelineModal(id);
      };
    });

    // Complete buttons
    document.querySelectorAll('[data-action="complete-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openCompleteModal(id);
      };
    });

    // Delete buttons
    document.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        handleDeleteTask(id);
      };
    });
  }

  // 10. Modal 1: Create / Edit Handlers
  function openCreateModal() {
    editingTaskId = null;
    document.getElementById('task-modal-title').textContent = '➕ สั่งงานใหม่ (Job Order)';
    document.getElementById('task-form-submit-label').textContent = 'บันทึกใบสั่งงาน';
    document.getElementById('task-input-id').value = '';
    document.getElementById('task-input-title').value = '';
    document.getElementById('task-input-site').value = '';
    document.getElementById('task-input-location').value = '';
    document.getElementById('task-input-assigned').value = '';
    document.getElementById('task-input-ordered-by').value = '';
    document.getElementById('task-input-order-date').value = getTodayString();
    document.getElementById('task-input-due-date').value = '';
    document.getElementById('task-input-status').value = 'Pending';
    document.getElementById('task-input-percent').value = '0';
    document.getElementById('task-input-desc').value = '';

    document.getElementById('modal-task-form').classList.remove('hidden');
    document.getElementById('task-input-title').focus?.();
  }

  function openEditModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    editingTaskId = taskId;
    document.getElementById('task-modal-title').textContent = `✏️ แก้ไขใบสั่งงาน ${task.task_code || '#' + task.id}`;
    document.getElementById('task-form-submit-label').textContent = 'บันทึกการแก้ไข';
    document.getElementById('task-input-id').value = String(task.id);
    document.getElementById('task-input-title').value = task.title || '';
    document.getElementById('task-input-site').value = task.site || '';
    document.getElementById('task-input-location').value = task.location_detail || '';
    document.getElementById('task-input-assigned').value = task.assigned_to || '';
    document.getElementById('task-input-ordered-by').value = task.ordered_by || '';
    document.getElementById('task-input-order-date').value = task.order_date || '';
    document.getElementById('task-input-due-date').value = task.due_date || '';
    document.getElementById('task-input-status').value = task.status || 'Pending';
    document.getElementById('task-input-percent').value = String(task.progress_percent || 0);
    document.getElementById('task-input-desc').value = task.description || '';

    document.getElementById('modal-task-form').classList.remove('hidden');
    document.getElementById('task-input-title').focus?.();
  }

  function closeTaskModal() {
    document.getElementById('modal-task-form').classList.add('hidden');
    editingTaskId = null;
  }

  async function handleTaskFormSubmit(e) {
    if (e) e.preventDefault();

    const title = (document.getElementById('task-input-title')?.value || '').trim();
    const site = (document.getElementById('task-input-site')?.value || '').trim();
    const locationDetail = (document.getElementById('task-input-location')?.value || '').trim();
    const assignedTo = (document.getElementById('task-input-assigned')?.value || '').trim();
    const orderedBy = (document.getElementById('task-input-ordered-by')?.value || '').trim();
    const orderDate = document.getElementById('task-input-order-date')?.value || getTodayString();
    const dueDate = document.getElementById('task-input-due-date')?.value || null;
    const status = document.getElementById('task-input-status')?.value || 'Pending';
    const percent = Math.min(100, Math.max(0, Number(document.getElementById('task-input-percent')?.value) || 0));
    const description = (document.getElementById('task-input-desc')?.value || '').trim();

    if (!title) {
      alert('กรุณากรอกชื่องาน / รายละเอียดคำสั่ง');
      return;
    }
    if (!site) {
      alert('กรุณากรอกชื่อไซต์งาน');
      return;
    }

    try {
      if (editingTaskId) {
        // Update Task
        const patch = {
          title,
          site,
          location_detail: locationDetail,
          assigned_to: assignedTo,
          ordered_by: orderedBy,
          order_date: orderDate,
          due_date: dueDate,
          status,
          progress_percent: percent,
          description
        };
        await API.updateTask(editingTaskId, patch);
        if (UTILS.toast) UTILS.toast('บันทึกการแก้ไขเรียบร้อยแล้ว', 'success');
      } else {
        // Create Task
        const newPayload = {
          title,
          site,
          location_detail: locationDetail,
          assigned_to: assignedTo,
          ordered_by: orderedBy,
          order_date: orderDate,
          due_date: dueDate,
          status,
          progress_percent: percent,
          description
        };
        await API.createTask(newPayload);
        if (UTILS.toast) UTILS.toast('สร้างใบสั่งงานใหม่เรียบร้อยแล้ว', 'success');
      }

      closeTaskModal();
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (UTILS.toast) UTILS.toast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
  }

  // 11. Modal 2: Timeline & Issues Handlers
  function openTimelineModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    activeTimelineTaskId = taskId;
    document.getElementById('timeline-modal-title').textContent = `🔍 ไทม์ไลน์ความคืบหน้า & ปัญหา — ${task.title || ''}`;
    document.getElementById('timeline-modal-subtitle').textContent = `รหัสงาน: ${task.task_code || '#' + task.id} | ไซต์: ${task.site || '-'}`;

    // Reset progress note form
    document.getElementById('timeline-input-percent').value = String(task.progress_percent || 0);
    document.getElementById('timeline-input-date').value = getTodayString();
    document.getElementById('timeline-input-by').value = task.assigned_to || '';
    document.getElementById('timeline-input-issues').value = task.issues || '';
    document.getElementById('timeline-input-resolution').value = task.resolution || '';

    renderTimelineHistory(task);
    document.getElementById('modal-timeline').classList.remove('hidden');
  }

  function renderTimelineHistory(task) {
    const container = document.getElementById('timeline-history-container');
    if (!container) return;

    const history = Array.isArray(task.progress_history) ? task.progress_history : [];

    if (history.length === 0) {
      container.innerHTML = `
        <div class="text-xs text-slate-400 py-3 text-center italic">
          ยังไม่มีบันทึกประวัติความคืบหน้า
        </div>
      `;
      return;
    }

    // Sort descending by date/time
    const sorted = [...history].reverse();

    container.innerHTML = sorted.map((entry, idx) => {
      const p = Math.round(Number(entry.percent) || 0);
      const by = entry.by ? `โดย ${escapeHtml(entry.by)}` : '';
      const dateText = formatDate(entry.date || entry.created_at);

      return `
        <div class="p-3 bg-white rounded border border-slate-200 text-xs shadow-sm">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-slate-800">
              ความคืบหน้า: <span class="text-blue-700">${p}%</span>
            </span>
            <span class="text-slate-400">${dateText} ${by}</span>
          </div>
          ${entry.issues ? `
            <div class="text-red-700 mt-1">
              ⚠️ <strong>ปัญหา:</strong> ${escapeHtml(entry.issues)}
            </div>
          ` : ''}
          ${entry.resolution ? `
            <div class="text-emerald-800 mt-0.5">
              💡 <strong>การแก้ไข:</strong> ${escapeHtml(entry.resolution)}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function closeTimelineModal() {
    document.getElementById('modal-timeline').classList.add('hidden');
    activeTimelineTaskId = null;
  }

  async function handleTimelineFormSubmit(e) {
    if (e) e.preventDefault();
    if (!activeTimelineTaskId) return;

    const percent = Math.min(100, Math.max(0, Number(document.getElementById('timeline-input-percent')?.value) || 0));
    const date = document.getElementById('timeline-input-date')?.value || getTodayString();
    const by = (document.getElementById('timeline-input-by')?.value || '').trim();
    const issues = (document.getElementById('timeline-input-issues')?.value || '').trim();
    const resolution = (document.getElementById('timeline-input-resolution')?.value || '').trim();

    try {
      await API.addTaskProgress(activeTimelineTaskId, {
        percent,
        date,
        by,
        issues,
        resolution
      });

      if (UTILS.toast) UTILS.toast('บันทึกความคืบหน้าเรียบร้อยแล้ว', 'success');
      closeTimelineModal();
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (UTILS.toast) UTILS.toast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
  }

  // 12. Modal 3: Completion Handlers
  function openCompleteModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    activeCompletionTaskId = taskId;
    const summaryInput = document.getElementById('complete-input-summary');
    if (summaryInput) {
      summaryInput.value = task.completion_summary || '';
    }

    document.getElementById('modal-complete-task').classList.remove('hidden');
    summaryInput?.focus?.();
  }

  function closeCompleteModal() {
    document.getElementById('modal-complete-task').classList.add('hidden');
    activeCompletionTaskId = null;
  }

  async function handleCompleteFormSubmit(e) {
    if (e) e.preventDefault();
    if (!activeCompletionTaskId) return;

    const summary = (document.getElementById('complete-input-summary')?.value || '').trim();
    if (!summary) {
      alert('กรุณากรอกสรุปผลการทำงานจริง & หมายเหตุการตรวจรับ');
      return;
    }

    try {
      await API.updateTask(activeCompletionTaskId, {
        status: 'Completed',
        progress_percent: 100,
        completion_summary: summary
      });

      if (UTILS.toast) UTILS.toast('ตรวจรับและปิดงานเรียบร้อยแล้ว', 'success');
      closeCompleteModal();
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (UTILS.toast) UTILS.toast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
  }

  // 13. Delete Handler with PIN 1225
  async function handleDeleteTask(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    const code = task?.task_code || '#' + taskId;

    // PIN check
    const pinCheck = typeof UTILS.verifyPin === 'function'
      ? UTILS.verifyPin('ใส่รหัส PIN เพื่อยืนยันการลบงาน:')
      : true;

    if (!pinCheck) return;

    try {
      await API.deleteTask(taskId);
      if (UTILS.toast) UTILS.toast(`ลบใบสั่งงาน ${code} เรียบร้อยแล้ว`, 'success');
      await loadTasks();
    } catch (err) {
      console.error(err);
      if (UTILS.toast) UTILS.toast(`เกิดข้อผิดพลาดในการลบงาน: ${err.message}`, 'error');
    }
  }

  // 14. Load Data from API
  async function loadTasks() {
    try {
      allTasks = await API.getTasks();
      if (!Array.isArray(allTasks)) allTasks = [];

      updateKpiCards(allTasks);
      updateSiteFilterOptions(allTasks);
      renderTasks();
    } catch (err) {
      console.error('Error loading tasks:', err);
      const container = document.getElementById('tasks-container');
      if (container) {
        container.innerHTML = `
          <div class="col-span-full ledger-card p-8 text-center text-red-600">
            <div class="text-3xl mb-2">⚠️</div>
            <div class="font-semibold">ไม่สามารถโหลดรายการใบสั่งงานได้</div>
            <div class="text-xs text-slate-500 mt-1">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    }
  }

  async function loadWorkers() {
    try {
      if (typeof API.getWorkers === 'function') {
        allWorkers = await API.getWorkers();
        if (Array.isArray(allWorkers)) {
          updateWorkersDatalist(allWorkers);
        }
      }
    } catch (err) {
      console.warn('Error loading workers:', err);
    }
  }

  // 15. Setup Event Listeners
  function initEvents() {
    // Search input
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => renderTasks());
    }

    // Status filter
    const statusFilter = document.getElementById('filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => renderTasks());
    }

    // Site filter
    const siteFilter = document.getElementById('filter-site');
    if (siteFilter) {
      siteFilter.addEventListener('change', () => renderTasks());
    }

    // Create task button
    const createBtn = document.getElementById('btn-create-task');
    if (createBtn) {
      createBtn.addEventListener('click', openCreateModal);
    }

    // Modal 1 controls
    document.getElementById('btn-close-task-modal')?.addEventListener('click', closeTaskModal);
    document.getElementById('btn-cancel-task-form')?.addEventListener('click', closeTaskModal);
    document.getElementById('task-form')?.addEventListener('submit', handleTaskFormSubmit);

    // Modal 2 controls
    document.getElementById('btn-close-timeline-modal')?.addEventListener('click', closeTimelineModal);
    document.getElementById('timeline-progress-form')?.addEventListener('submit', handleTimelineFormSubmit);

    // Modal 3 controls
    document.getElementById('btn-close-complete-modal')?.addEventListener('click', closeCompleteModal);
    document.getElementById('btn-cancel-complete-modal')?.addEventListener('click', closeCompleteModal);
    document.getElementById('complete-task-form')?.addEventListener('submit', handleCompleteFormSubmit);
  }

  // 16. Initialize Page
  initEvents();
  loadTasks();
  loadWorkers();
})();
