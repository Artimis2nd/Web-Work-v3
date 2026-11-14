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

  let orderDatePicker = null;
  let timelineDatePicker = null;

  function toDisplayDate(isoStr) {
    if (!isoStr) return '';
    const clean = String(isoStr).slice(0, 10);
    const parts = clean.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return clean;
  }

  function toIsoDate(displayStr) {
    if (!displayStr) return '';
    const clean = String(displayStr).trim();
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return clean;
  }

  let activeTimelineTaskId = null;
  let activeCompletionTaskId = null;
  let draftSubItems = [];
  let draftAttachments = []; // [{ id, name, type, media_kind, size, isNew, rawData }]
  let removedMediaIds = [];
  let activeObjectUrl = null;

  // 2. Base Page Structure (KPI Cards, Action Bar, Task Container, Modals)
  content.innerHTML = `
    <!-- KPI Summary Cards (5 Status Cards) -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      <div class="ledger-card kpi-card p-4" style="--tick-color: var(--blueprint);">
        <div class="kpi-label">งานทั้งหมด (Total Tasks)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-slate-800" id="kpi-total-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">ใบสั่งงานในระบบทั้งหมด</div>
      </div>
      <div class="ledger-card kpi-card p-4" style="--tick-color: #64748b;">
        <div class="kpi-label">รอดำเนินการ (Pending)</div>
        <div class="kpi-value text-2xl font-bold mt-1 text-slate-600" id="kpi-pending-tasks">0</div>
        <div class="text-xs text-slate-500 mt-1">สั่งงานแล้ว รอเริ่มทำ</div>
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
      <div class="modal-box max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="modal-header sticky top-0 bg-white z-10 border-b border-slate-200">
          <h3 class="font-display text-lg font-semibold text-slate-800" id="task-modal-title">➕ สั่งงานใหม่ (Job Order)</h3>
          <button type="button" id="btn-close-task-modal" class="btn btn-outline btn-sm">✕</button>
        </div>
        <form id="task-form" class="modal-body space-y-4">
          <input type="hidden" id="task-input-id" value="">
          <!-- ซ่อนฟิลด์ที่ไม่ได้ใช้งานบนหน้าจอ เพื่อความคล่องตัวและคงความเข้ากันได้ของระบบ -->
          <input type="hidden" id="task-input-assigned" name="assigned_to" value="">
          <input type="hidden" id="task-input-due-date" name="due_date" value="">
          <input type="hidden" id="task-input-status" name="status" value="Pending">
          <input type="hidden" id="task-input-percent" name="progress_percent" value="0">
          <datalist id="workers-datalist"></datalist>
          <datalist id="common-units-datalist">
            <option value="ตร.ม.">
            <option value="เมตร">
            <option value="จุด">
            <option value="ชุด">
            <option value="คิว">
            <option value="ต้น">
            <option value="ห้อง">
            <option value="งาน">
          </datalist>

          <div>
            <label class="field-label" for="task-input-title">ชื่องาน / รายละเอียดคำสั่งหลัก <span class="text-red-500">*</span></label>
            <input type="text" id="task-input-title" name="title" class="field-input w-full" required placeholder="เช่น งานเดินท่อสายไฟ+วางบ่อพัก, งานเทเสาชั้น 2">
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="task-input-site">ไซต์งาน (Site) <span class="text-red-500">*</span></label>
              <input type="text" id="task-input-site" name="site" class="field-input w-full" required placeholder="เช่น หมู่บ้านริเวอร์ไซด์" list="sites-datalist">
              <datalist id="sites-datalist"></datalist>
            </div>
            <div>
              <label class="field-label" for="task-input-location">ตำแหน่ง / โซนในไซต์</label>
              <input type="text" id="task-input-location" name="location_detail" class="field-input w-full" placeholder="เช่น โซน B อาคาร 1 ชั้น 2">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label" for="task-input-ordered-by">ผู้สั่งงาน</label>
              <input type="text" id="task-input-ordered-by" name="ordered_by" class="field-input w-full" placeholder="เช่น เฮีย" value="เฮีย">
            </div>
            <div>
              <label class="field-label" for="task-input-order-date">วันที่สั่งงาน</label>
              <input type="text" id="task-input-order-date" name="order_date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off">
            </div>
          </div>

          <!-- ส่วนที่ 1: รายการงานย่อย (Sub-items) -->
          <div class="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <label class="field-label mb-0 text-slate-800">📋 รายการงานย่อยในใบสั่งงานนี้</label>
                <div class="text-xs text-slate-500">ระบุรายการที่สั่งทำ (หากยังไม่รู้ปริมาณแน่นอน ให้เว้นช่อง "เป้าหมาย" ว่างไว้ เพื่อนับยอดทำจริงหน้างาน)</div>
              </div>
              <button type="button" id="btn-add-subitem" class="btn btn-outline btn-sm text-xs">
                ➕ เพิ่มรายการย่อย
              </button>
            </div>

            <div id="subitems-list-container" class="space-y-2">
              <!-- แถวรายการงานย่อยจะถูกสร้างด้วย JS -->
            </div>
          </div>

          <!-- ส่วนที่ 2: เอกสารแนบ รูปถ่ายกระดาษสั่งงาน / ไฟล์ PDF / วิดีโอสั้น -->
          <div class="p-3.5 rounded-lg bg-amber-50/40 border border-amber-200/80 space-y-2.5 transition-all" id="task-attachments-dropzone">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <label class="field-label mb-0 text-slate-800">📎 เอกสารแนบ / แบบแปลน PDF / รูปถ่าย / คลิปสั่งงาน</label>
                <div class="text-xs text-slate-500">รองรับรูปถ่าย, ไฟล์ PDF หรือคลิปวิดีโอ (สูงสุด 50 MB) • <span class="text-amber-800 font-medium">กดปุ่ม หรือกด Ctrl+V เพื่อวางรูปที่ Copy ไว้ได้ทันที</span></div>
              </div>
              <div class="flex gap-1.5 flex-wrap">
                <button type="button" id="btn-attach-photo" class="btn btn-outline btn-sm text-xs inline-flex items-center gap-1">
                  📷 แนบรูป / ถ่ายรูป
                </button>
                <button type="button" id="btn-attach-paste" class="btn btn-outline btn-sm text-xs inline-flex items-center gap-1 bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100" title="กดเพื่อดึงรูปภาพที่ Copy ไว้ในเครื่องมาแนบ">
                  📋 วางรูปที่ Copy
                </button>
                <button type="button" id="btn-attach-pdf" class="btn btn-outline btn-sm text-xs inline-flex items-center gap-1">
                  📄 แนบไฟล์ PDF
                </button>
                <button type="button" id="btn-attach-video" class="btn btn-outline btn-sm text-xs inline-flex items-center gap-1">
                  🎥 แนบวิดีโอสั้น
                </button>
                <input type="file" id="input-attach-photo" accept="image/*" multiple class="hidden" style="display:none">
                <input type="file" id="input-attach-pdf" accept="application/pdf,.pdf" multiple class="hidden" style="display:none">
                <input type="file" id="input-attach-video" accept="video/*" multiple class="hidden" style="display:none">
              </div>
            </div>

            <div id="task-attachments-preview" class="space-y-1.5">
              <!-- รายการไฟล์แนบจะถูกสร้างด้วย JS -->
            </div>
          </div>

          <div>
            <label class="field-label" for="task-input-desc">รายละเอียดเพิ่มเติม / ผลงานที่ต้องการ / ข้อควรระวัง</label>
            <textarea id="task-input-desc" name="description" rows="3" class="field-input w-full" placeholder="ระบุสเปกผลงานที่ต้องการ ข้อกำหนด เครื่องมือที่ต้องใช้ หรือข้อควรระวัง..."></textarea>
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
                  <input type="text" id="timeline-input-date" name="date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off">
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

    <!-- Modal 4: Media Viewer Modal (เปิดดูรูปภาพแบบกระดาษ & เล่นวิดีโอสั่งงาน) -->
    <div id="modal-media-viewer" class="modal-backdrop hidden">
      <div class="modal-box max-w-3xl">
        <div class="modal-header">
          <h3 class="font-display text-base font-semibold text-slate-800 truncate" id="media-viewer-title">📎 เปิดดูเอกสารแนบ</h3>
          <button type="button" id="btn-close-media-viewer" class="btn btn-outline btn-sm">✕ ปิด</button>
        </div>
        <div class="modal-body flex flex-col items-center justify-center bg-slate-900/95 rounded-b-lg p-4 min-h-[280px]" id="media-viewer-body">
          <!-- รูปภาพหรือวิดีโอจะถูกแสดงที่นี่ -->
        </div>
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

  function formatSize(bytes) {
    if (typeof UTILS.formatFileSize === 'function') return UTILS.formatFileSize(bytes);
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getTodayString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 4. Update KPI Dashboard Cards
  function updateKpiCards(tasks) {
    const total = tasks.length;
    const pending = tasks.filter(t => t.status === 'Pending').length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    const completed = tasks.filter(t => t.status === 'Completed').length;

    const elTotal = document.getElementById('kpi-total-tasks');
    const elPending = document.getElementById('kpi-pending-tasks');
    const elInProgress = document.getElementById('kpi-inprogress-tasks');
    const elBlocked = document.getElementById('kpi-blocked-tasks');
    const elCompleted = document.getElementById('kpi-completed-tasks');

    if (elTotal) elTotal.textContent = String(total);
    if (elPending) elPending.textContent = String(pending);
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
      if (statusVal === 'Active') {
        if (task.status === 'Completed') return false;
      } else if (statusVal) {
        if (task.status !== statusVal) return false;
      }

      if (siteVal && task.site !== siteVal) {
        return false;
      }

      if (query) {
        const matchCode = (task.task_code || '').toLowerCase().includes(query);
        const matchTitle = (task.title || '').toLowerCase().includes(query);
        const matchSite = (task.site || '').toLowerCase().includes(query);
        const matchLoc = (task.location_detail || '').toLowerCase().includes(query);
        const matchAssigned = (task.assigned_to || '').toLowerCase().includes(query);
        const matchOrdered = (task.ordered_by || '').toLowerCase().includes(query);
        const matchSubItem = Array.isArray(task.sub_items) && task.sub_items.some(it => (it.name || '').toLowerCase().includes(query));
        if (!matchCode && !matchTitle && !matchSite && !matchLoc && !matchAssigned && !matchOrdered && !matchSubItem) {
          return false;
        }
      }

      return true;
    });
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

      const subItems = Array.isArray(task.sub_items) ? task.sub_items : [];
      const attachments = Array.isArray(task.attachments) ? task.attachments : [];
      const hasBlockedSubItem = subItems.some(it => it.status === 'Blocked' || (it.issue_note && it.issue_note.trim()));
      const hasIssues = Boolean((task.issues && task.issues.trim()) || hasBlockedSubItem);
      const hasResolution = Boolean(task.resolution && task.resolution.trim());
      const hasCompletionSummary = Boolean(task.completion_summary && task.completion_summary.trim());
      const isCompleted = task.status === 'Completed';
      const isBlocked = task.status === 'Blocked' || hasBlockedSubItem;

      const daysWorked = Number(task.total_days_worked) || Number(task.accumulated_days) || 0;
      const workedDates = Array.isArray(task.worked_dates) ? task.worked_dates : [];
      const lastWorkedDate = workedDates.length > 0 ? formatDate(workedDates[workedDates.length - 1]) : null;

      // สรุปรายการงานย่อยบนการ์ด
      const subItemsHtml = subItems.length > 0 ? `
        <div class="mb-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/90 space-y-1.5">
          <div class="flex items-center justify-between text-xs font-semibold text-slate-700 pb-1 border-b border-slate-200">
            <span>รายการงานย่อย (${subItems.filter(i => i.status === 'Completed').length}/${subItems.filter(i => i.status !== 'Cancelled').length} เสร็จ)</span>
            <span class="text-slate-400 font-normal">ปริมาณสะสม</span>
          </div>
          <div class="space-y-1 max-h-36 overflow-y-auto pr-0.5">
            ${subItems.map(it => {
              const icon = renderSubItemStatusIcon(it.status);
              const isCancelled = it.status === 'Cancelled';
              const isItemBlocked = it.status === 'Blocked';
              const unitStr = it.unit ? ` ${escapeHtml(it.unit)}` : '';
              let qtyLabel = '';
              if (isCancelled) {
                qtyLabel = '<span class="text-slate-400">ยกเลิก</span>';
              } else if (it.target_qty && it.target_qty > 0) {
                qtyLabel = `<span class="font-mono font-semibold text-slate-700">${it.actual_qty || 0}/${it.target_qty}${unitStr}</span> <span class="text-slate-400">(${it.progress_percent || 0}%)</span>`;
              } else {
                qtyLabel = `<span class="font-mono font-semibold text-blue-700">ทำจริง ${it.actual_qty || 0}${unitStr}</span> <span class="text-slate-400">(${it.progress_percent || 0}%)</span>`;
              }
              return `
                <div class="text-xs flex flex-col gap-0.5 py-0.5 ${isCancelled ? 'opacity-50 line-through' : ''}">
                  <div class="flex items-start justify-between gap-2">
                    <span class="${isItemBlocked ? 'text-red-700 font-semibold' : 'text-slate-700'}">${icon} ${escapeHtml(it.name)}</span>
                    <span class="shrink-0">${qtyLabel}</span>
                  </div>
                  ${it.issue_note ? `<div class="text-[11px] text-red-600 pl-4">↳ ปัญหา: ${escapeHtml(it.issue_note)}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : '';

      // เอกสารแนบ รูปภาพ / วิดีโอสั้น
      const attachmentsHtml = attachments.length > 0 ? `
        <div class="mb-3">
          <div class="text-[11px] font-semibold text-slate-500 mb-1">📎 เอกสารแนบตอนสั่งงาน (${attachments.length} ไฟล์):</div>
          <div class="flex flex-wrap gap-1.5">
            ${attachments.map(att => {
              const isVideo = att.media_kind === 'video' || (att.type && att.type.startsWith('video/'));
              const isPdf = att.media_kind === 'pdf' || (att.type && att.type.includes('pdf')) || String(att.name).toLowerCase().endsWith('.pdf');
              const icon = isVideo ? '🎥' : (isPdf ? '📄' : '📷');
              const defaultName = isVideo ? 'วิดีโอสั่งงาน' : (isPdf ? 'เอกสาร PDF' : 'รูปใบสั่งงาน');
              const mediaKind = isVideo ? 'video' : (isPdf ? 'pdf' : 'image');
              return `
                <button
                  type="button"
                  data-action="view-media"
                  data-media-id="${escapeHtml(att.id)}"
                  data-media-name="${escapeHtml(att.name || 'ไฟล์แนบ')}"
                  data-media-kind="${mediaKind}"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 transition-colors"
                  title="คลิกเพื่อเปิดดู ${escapeHtml(att.name || '')}"
                >
                  <span>${icon}</span>
                  <span class="truncate max-w-[130px]">${escapeHtml(att.name || defaultName)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      ` : '';

      return `
        <div class="ledger-card p-4 flex flex-col justify-between hover:shadow-md transition-shadow relative ${isBlocked ? 'ring-2 ring-red-400/80' : ''}">
          <div>
            <!-- จุดแจ้งเตือนเด่นชัดเมื่อมีปัญหา -->
            ${isBlocked ? `
              <div class="mb-2.5 px-2.5 py-1.5 rounded bg-red-600 text-white text-xs font-semibold flex items-center justify-between shadow-sm">
                <span>🚨 มีรายการติดปัญหาหน้างาน!</span>
                <span class="text-[11px] font-normal opacity-90">ต้องตรวจสอบ</span>
              </div>
            ` : ''}

            <!-- Top Row: Code & Status Badge -->
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
                <span>ความคืบหน้ารวม</span>
                <span>${task.progress_percent || 0}%</span>
              </div>
              ${progressHtml}
            </div>

            <!-- Sub-items Summary -->
            ${subItemsHtml}

            <!-- Attachments Chips -->
            ${attachmentsHtml}

            <!-- Days Worked & Order Dates Info -->
            <div class="text-xs text-slate-600 space-y-1 mb-3 pt-2 border-t border-slate-100">
              <div class="flex items-center justify-between">
                <span class="text-slate-500 font-medium">👷 เข้าทำหน้างานแล้ว:</span>
                <span class="font-mono font-bold ${daysWorked > 0 ? 'text-blue-700' : 'text-slate-500'}">
                  ${daysWorked} วัน ${lastWorkedDate ? `<span class="font-sans font-normal text-slate-400">(ล่าสุด ${lastWorkedDate})</span>` : ''}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-400">📅 วันที่สั่งงาน:</span>
                <span>${formatDate(task.order_date)} ${task.ordered_by ? `<span class="text-slate-400">(${escapeHtml(task.ordered_by)})</span>` : ''}</span>
              </div>
              ${task.assigned_to ? `<span class="hidden">${escapeHtml(task.assigned_to)}</span>` : ''}
            </div>

            <!-- Description Excerpt -->
            ${task.description ? `
              <div class="mb-3 text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                <span class="font-semibold text-slate-700">📝 สเปก/หมายเหตุ:</span> ${escapeHtml(task.description)}
              </div>
            ` : ''}

            <!-- Issues / Resolution Excerpt -->
            ${hasIssues || hasResolution ? `
              <div class="mb-3 p-2.5 rounded bg-red-50/80 border border-red-200 text-xs space-y-1">
                ${task.issues ? `<div class="text-red-700 font-medium">⚠️ ปัญหา: ${escapeHtml(task.issues)}</div>` : ''}
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
            ${!isCompleted ? `
              <a
                href="daily-log.html?task_id=${task.id}"
                class="btn btn-amber btn-sm text-xs inline-flex items-center gap-1"
                title="ดึงใบสั่งงานนี้ไปลงบันทึกงานประจำวัน"
              >
                📝 ลงรายวัน
              </a>
            ` : ''}

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
              title="ดูรายงานสรุปต้นทุนค่าแรงและปริมาณงานของใบงานนี้"
            >
              📊 ต้นทุน/ปริมาณ
            </a>

            <!-- Edit Button -->
            <button
              type="button"
              id="btn-edit-task-${task.id}"
              data-action="edit-task"
              data-id="${task.id}"
              class="btn btn-outline btn-sm text-xs"
              title="แก้ไขข้อมูลใบสั่งงาน / เพิ่มลดรายการและรูปแนบ"
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
    document.querySelectorAll('[data-action="edit-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openEditModal(id);
      };
    });

    document.querySelectorAll('[data-action="timeline-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openTimelineModal(id);
      };
    });

    document.querySelectorAll('[data-action="complete-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        openCompleteModal(id);
      };
    });

    document.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
      btn.onclick = () => {
        const id = Number(btn.getAttribute('data-id'));
        handleDeleteTask(id);
      };
    });

    document.querySelectorAll('[data-action="view-media"]').forEach(btn => {
      btn.onclick = () => {
        const mediaId = btn.getAttribute('data-media-id');
        const mediaName = btn.getAttribute('data-media-name');
        const mediaKind = btn.getAttribute('data-media-kind');
        openMediaViewerModal(mediaId, mediaName, mediaKind);
      };
    });
  }

  // 9.5 Sub-items & Attachments Form Helpers
  function syncDraftSubItemsFromDom() {
    const container = document.getElementById('subitems-list-container');
    if (!container) return;
    const rows = container.querySelectorAll('.subitem-row');
    if (!rows.length) return;

    const updated = [];
    rows.forEach((row, idx) => {
      const id = row.getAttribute('data-subitem-id') || `sub_${idx + 1}`;
      const nameInput = row.querySelector('.subitem-name-input');
      const targetInput = row.querySelector('.subitem-target-input');
      const unitInput = row.querySelector('.subitem-unit-input');
      const statusSelect = row.querySelector('.subitem-status-select');

      const existing = draftSubItems.find(it => String(it.id) === String(id)) || {};
      const nameVal = (nameInput?.value || '').trim();
      const targetRaw = (targetInput?.value || '').trim();
      const targetQty = targetRaw !== '' && Number(targetRaw) > 0 ? Number(targetRaw) : null;
      const unitVal = (unitInput?.value || '').trim();
      const statusVal = statusSelect ? statusSelect.value : (existing.status || 'Pending');

      updated.push({
        ...existing,
        id,
        name: nameVal,
        target_qty: targetQty,
        unit: unitVal,
        actual_qty: Number(existing.actual_qty) || 0,
        progress_percent: Number(existing.progress_percent) || 0,
        status: statusVal,
        issue_note: existing.issue_note || ''
      });
    });
    draftSubItems = updated;
  }

  function renderDraftSubItems() {
    const container = document.getElementById('subitems-list-container');
    if (!container) return;

    if (!draftSubItems.length) {
      container.innerHTML = `
        <div class="text-xs text-slate-400 text-center py-2 bg-white rounded border border-dashed border-slate-300">
          ยังไม่มีรายการย่อย — กดปุ่ม "➕ เพิ่มรายการย่อย" เพื่อแยกย่อยงาน (เช่น 1. เดินท่อไฟ, 2. วางบ่อพัก)
        </div>
      `;
      return;
    }

    container.innerHTML = draftSubItems.map((it, idx) => {
      const targetVal = it.target_qty !== null && it.target_qty !== undefined && it.target_qty > 0 ? String(it.target_qty) : '';
      const hasActual = (Number(it.actual_qty) || 0) > 0;
      return `
        <div class="subitem-row p-2.5 bg-white rounded border border-slate-200 shadow-sm space-y-2" data-subitem-id="${escapeHtml(it.id || `sub_${idx + 1}`)}">
          <div class="flex items-start gap-2">
            <span class="font-mono text-xs font-bold text-slate-400 w-5 pt-1.5 text-center shrink-0">${idx + 1}.</span>
            <textarea
              rows="2"
              class="field-input text-xs flex-1 subitem-name-input leading-relaxed py-1.5 resize-y"
              placeholder="ชื่อรายการ (เช่น เดินท่อสายไฟ, วางบ่อพักสาย, ก่ออิฐ)"
            >${escapeHtml(it.name || '')}</textarea>
          </div>
          <div class="flex items-center justify-between flex-wrap gap-2 pl-7">
            <div class="flex items-center gap-1.5 flex-wrap">
              <div class="flex items-center gap-1">
                <span class="text-[11px] text-slate-400">เป้า:</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  class="field-input text-xs w-24 sm:w-28 subitem-target-input"
                  placeholder="เป้า (เว้นได้)"
                  title="ปริมาณเป้าหมาย (เว้นว่างได้หากนับตามจริงหน้างาน)"
                  value="${escapeHtml(targetVal)}"
                >
              </div>
              <div class="flex items-center gap-1">
                <span class="text-[11px] text-slate-400">หน่วย:</span>
                <input
                  type="text"
                  list="common-units-datalist"
                  class="field-input text-xs w-20 subitem-unit-input"
                  placeholder="หน่วย"
                  value="${escapeHtml(it.unit || '')}"
                >
              </div>
              ${editingTaskId ? `
                <div class="flex items-center gap-1">
                  <span class="text-[11px] text-slate-400">สถานะ:</span>
                  <select class="field-input text-xs w-24 sm:w-28 subitem-status-select" title="สถานะรายการย่อย">
                    <option value="Pending" ${it.status === 'Pending' ? 'selected' : ''}>รอทำ</option>
                    <option value="In Progress" ${it.status === 'In Progress' ? 'selected' : ''}>กำลังทำ</option>
                    <option value="Completed" ${it.status === 'Completed' ? 'selected' : ''}>เสร็จแล้ว</option>
                    <option value="Blocked" ${it.status === 'Blocked' ? 'selected' : ''}>ติดปัญหา</option>
                    <option value="Cancelled" ${it.status === 'Cancelled' ? 'selected' : ''}>ยกเลิก</option>
                  </select>
                </div>
              ` : ''}
            </div>
            <div class="flex items-center gap-2 ml-auto">
              ${hasActual ? `<span class="text-[11px] text-blue-700 font-mono">↳ ทำสะสม: ${it.actual_qty} ${escapeHtml(it.unit || '')}</span>` : ''}
              <button
                type="button"
                data-remove-subitem="${idx}"
                class="btn btn-outline btn-sm text-red-600 px-2 py-1 text-xs inline-flex items-center gap-1"
                title="ลบรายการย่อยนี้"
              >✕ ลบ</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-remove-subitem]').forEach(btn => {
      btn.onclick = () => {
        syncDraftSubItemsFromDom();
        const removeIdx = Number(btn.getAttribute('data-remove-subitem'));
        draftSubItems.splice(removeIdx, 1);
        renderDraftSubItems();
      };
    });
  }

  function renderDraftAttachments() {
    const container = document.getElementById('task-attachments-preview');
    if (!container) return;

    if (!draftAttachments.length) {
      container.innerHTML = `
        <div class="text-xs text-slate-400 text-center py-2 bg-white/80 rounded border border-dashed border-amber-300">
          ยังไม่มีไฟล์แนบ — กด "📷 แนบรูป", "📄 แนบ PDF", "🎥 วิดีโอ" หรือกด <span class="font-semibold text-slate-600">Ctrl+V</span> เพื่อวางรูปภาพที่ Copy ไว้
        </div>
      `;
      return;
    }

    container.innerHTML = draftAttachments.map((att, idx) => {
      const isVideo = att.media_kind === 'video' || (att.type && att.type.startsWith('video/'));
      const isPdf = att.media_kind === 'pdf' || (att.type && att.type.includes('pdf')) || String(att.name).toLowerCase().endsWith('.pdf');
      const icon = isVideo ? '🎥' : (isPdf ? '📄' : '📷');
      const kindLabel = isVideo ? 'วิดีโอสั้น' : (isPdf ? 'เอกสาร PDF' : 'รูปภาพ');
      return `
        <div class="flex items-center justify-between gap-2 p-2 bg-white rounded border border-amber-200 text-xs">
          <div class="flex items-center gap-2 truncate">
            <span class="text-base">${icon}</span>
            <div class="truncate">
              <div class="font-medium text-slate-700 truncate">${escapeHtml(att.name || 'ไฟล์แนบ')}</div>
              <div class="text-[11px] text-slate-400">${kindLabel} • ${formatSize(att.size)}</div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" data-preview-draft-att="${idx}" class="btn btn-outline btn-sm text-xs px-2 py-0.5">👁️ ดู</button>
            <button type="button" data-remove-draft-att="${idx}" class="btn btn-outline btn-sm text-red-600 text-xs px-2 py-0.5">🗑️ ลบ</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-preview-draft-att]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-preview-draft-att'));
        const att = draftAttachments[idx];
        if (!att) return;
        if (att.rawData) {
          openMediaViewerWithRawData(att.rawData, att.name, att.media_kind, att.type);
        } else if (att.id) {
          openMediaViewerModal(att.id, att.name, att.media_kind);
        }
      };
    });

    container.querySelectorAll('[data-remove-draft-att]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-remove-draft-att'));
        const removed = draftAttachments.splice(idx, 1)[0];
        if (removed && removed.id && !removed.isNew) {
          removedMediaIds.push(removed.id);
        }
        renderDraftAttachments();
      };
    });
  }

  async function handleFilesSelected(fileList, defaultKind = 'image') {
    if (!fileList || !fileList.length) return;
    const maxBytes = API.MAX_MEDIA_SIZE_BYTES || (50 * 1024 * 1024);

    for (const file of Array.from(fileList)) {
      if (file.size > maxBytes) {
        if (UTILS.toast) UTILS.toast(`ไฟล์ "${file.name}" มีขนาดเกิน 50 MB กรุณาใช้ไฟล์ที่เล็กลง`, 'error');
        else alert(`ไฟล์ "${file.name}" มีขนาดเกิน 50 MB`);
        continue;
      }

      const isVideo = (file.type && file.type.startsWith('video/')) || defaultKind === 'video';
      const isPdf = (file.type && (file.type === 'application/pdf' || file.type.includes('pdf'))) || String(file.name).toLowerCase().endsWith('.pdf') || defaultKind === 'pdf';
      let rawData = file;
      const mediaKind = isVideo ? 'video' : (isPdf ? 'pdf' : 'image');

      // สำหรับรูปภาพ หากมีฟังก์ชันบีบอัดรูปให้บีบอัดเพื่อประหยัดพื้นที่ (PDF และ Video ไม่ต้องบีบอัด)
      if (mediaKind === 'image' && typeof UTILS.compressImage === 'function') {
        try {
          rawData = await UTILS.compressImage(file);
        } catch (_) {
          rawData = file;
        }
      }

      let fallbackName = 'image.jpg';
      if (mediaKind === 'video') fallbackName = 'video.mp4';
      else if (mediaKind === 'pdf') fallbackName = 'document.pdf';

      draftAttachments.push({
        id: 'med_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: file.name || fallbackName,
        type: file.type || (mediaKind === 'video' ? 'video/mp4' : (mediaKind === 'pdf' ? 'application/pdf' : 'image/jpeg')),
        media_kind: mediaKind,
        size: file.size || (rawData.size || 0),
        isNew: true,
        rawData
      });
    }

    renderDraftAttachments();
  }

  function cleanupActiveObjectUrl() {
    if (activeObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(activeObjectUrl); } catch (_) {}
      activeObjectUrl = null;
    }
  }

  function openMediaViewerWithRawData(dataPayload, name, mediaKind, mimeType) {
    cleanupActiveObjectUrl();
    const modal = document.getElementById('modal-media-viewer');
    const titleEl = document.getElementById('media-viewer-title');
    const bodyEl = document.getElementById('media-viewer-body');
    if (!modal || !bodyEl) return;

    if (titleEl) titleEl.textContent = `📎 ${name || 'เอกสารแนบใบสั่งงาน'}`;

    let srcUrl = '';
    if (typeof dataPayload === 'string') {
      srcUrl = dataPayload;
    } else if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && dataPayload) {
      activeObjectUrl = URL.createObjectURL(dataPayload);
      srcUrl = activeObjectUrl;
    }

    const isVideo = mediaKind === 'video' || (mimeType && mimeType.startsWith('video/'));
    const isPdf = mediaKind === 'pdf' || (mimeType && mimeType.includes('pdf')) || String(name).toLowerCase().endsWith('.pdf');

    if (isVideo) {
      bodyEl.innerHTML = `
        <video controls autoplay class="max-h-[70vh] max-w-full rounded shadow-lg bg-black">
          <source src="${escapeHtml(srcUrl)}" type="${escapeHtml(mimeType || 'video/mp4')}">
          เบราว์เซอร์ของคุณไม่รองรับการเล่นวิดีโอ
        </video>
      `;
    } else if (isPdf) {
      bodyEl.innerHTML = `
        <div class="w-full flex flex-col items-center gap-2">
          <div class="w-full flex justify-end">
            <a href="${escapeHtml(srcUrl)}" target="_blank" download="${escapeHtml(name || 'document.pdf')}" class="btn btn-primary btn-sm text-xs inline-flex items-center gap-1 shadow">
              ⬇️ ดาวน์โหลด / เปิดแท็บใหม่
            </a>
          </div>
          <iframe src="${escapeHtml(srcUrl)}" class="w-full h-[68vh] rounded border border-slate-700 bg-white shadow-lg"></iframe>
        </div>
      `;
    } else {
      bodyEl.innerHTML = `
        <img src="${escapeHtml(srcUrl)}" alt="${escapeHtml(name || 'รูปใบสั่งงาน')}" class="max-h-[72vh] max-w-full object-contain rounded shadow-lg">
      `;
    }

    modal.classList.remove('hidden');
  }

  async function openMediaViewerModal(mediaId, fallbackName = '', fallbackKind = 'image') {
    if (!mediaId || typeof API.getTaskMedia !== 'function') return;
    try {
      const record = await API.getTaskMedia(mediaId);
      if (!record || !record.data) {
        if (UTILS.toast) UTILS.toast('ไม่พบข้อมูลไฟล์แนบในเครื่อง', 'error');
        return;
      }
      openMediaViewerWithRawData(record.data, record.name || fallbackName, record.media_kind || fallbackKind, record.type);
    } catch (err) {
      if (UTILS.toast) UTILS.toast('ไม่สามารถเปิดไฟล์แนบได้: ' + err.message, 'error');
    }
  }

  function closeMediaViewerModal() {
    const modal = document.getElementById('modal-media-viewer');
    const bodyEl = document.getElementById('media-viewer-body');
    if (bodyEl) bodyEl.innerHTML = '';
    if (modal) modal.classList.add('hidden');
    cleanupActiveObjectUrl();
  }

  // 10. Modal 1: Create / Edit Handlers
  function openCreateModal() {
    editingTaskId = null;
    draftSubItems = [
      { id: 'sub_1', name: '', target_qty: null, unit: '', actual_qty: 0, progress_percent: 0, status: 'Pending', issue_note: '' }
    ];
    draftAttachments = [];
    removedMediaIds = [];

    document.getElementById('task-modal-title').textContent = '➕ สั่งงานใหม่ (Job Order)';
    document.getElementById('task-form-submit-label').textContent = 'บันทึกใบสั่งงาน';
    document.getElementById('task-input-id').value = '';
    document.getElementById('task-input-title').value = '';
    document.getElementById('task-input-site').value = '';
    document.getElementById('task-input-location').value = '';
    document.getElementById('task-input-assigned').value = '';
    document.getElementById('task-input-ordered-by').value = 'เฮีย';
    const defToday = getTodayString();
document.getElementById('task-input-order-date').value = toDisplayDate(defToday);
if (orderDatePicker) { orderDatePicker.setDate(toDisplayDate(defToday)); }
    document.getElementById('task-input-due-date').value = '';
    document.getElementById('task-input-status').value = 'Pending';
    document.getElementById('task-input-percent').value = '0';
    document.getElementById('task-input-desc').value = '';

    renderDraftSubItems();
    renderDraftAttachments();

    document.getElementById('modal-task-form').classList.remove('hidden');
    document.getElementById('task-input-title').focus?.();
  }

  function openEditModal(taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    editingTaskId = taskId;
    draftSubItems = Array.isArray(task.sub_items) && task.sub_items.length > 0
      ? JSON.parse(JSON.stringify(task.sub_items))
      : [];
    draftAttachments = Array.isArray(task.attachments)
      ? JSON.parse(JSON.stringify(task.attachments))
      : [];
    removedMediaIds = [];

    document.getElementById('task-modal-title').textContent = `✏️ แก้ไขใบสั่งงาน ${task.task_code || '#' + task.id}`;
    document.getElementById('task-form-submit-label').textContent = 'บันทึกการแก้ไข';
    document.getElementById('task-input-id').value = String(task.id);
    document.getElementById('task-input-title').value = task.title || '';
    document.getElementById('task-input-site').value = task.site || '';
    document.getElementById('task-input-location').value = task.location_detail || '';
    document.getElementById('task-input-assigned').value = task.assigned_to || '';
    document.getElementById('task-input-ordered-by').value = task.ordered_by || 'เฮีย';
    const curOrderDate = task.order_date || '';
document.getElementById('task-input-order-date').value = toDisplayDate(curOrderDate);
if (orderDatePicker && curOrderDate) { orderDatePicker.setDate(toDisplayDate(curOrderDate)); }
    document.getElementById('task-input-due-date').value = task.due_date || '';
    document.getElementById('task-input-status').value = task.status || 'Pending';
    document.getElementById('task-input-percent').value = String(task.progress_percent || 0);
    document.getElementById('task-input-desc').value = task.description || '';

    renderDraftSubItems();
    renderDraftAttachments();

    document.getElementById('modal-task-form').classList.remove('hidden');
    document.getElementById('task-input-title').focus?.();
  }

  function closeTaskModal() {
    document.getElementById('modal-task-form').classList.add('hidden');
    editingTaskId = null;
  }

  async function persistAttachmentsForTask(taskId) {
    if (typeof API.deleteTaskMedia === 'function') {
      for (const remId of removedMediaIds) {
        await API.deleteTaskMedia(remId).catch(() => {});
      }
    }

    const savedAttachmentsMeta = [];
    for (const att of draftAttachments) {
      if (att.isNew && att.rawData && typeof API.saveTaskMedia === 'function') {
        const saved = await API.saveTaskMedia(taskId, att.rawData, {
          id: att.id,
          name: att.name,
          type: att.type,
          size: att.size
        });
        savedAttachmentsMeta.push(saved);
      } else {
        savedAttachmentsMeta.push({
          id: att.id,
          task_id: Number(taskId),
          name: att.name,
          type: att.type,
          media_kind: att.media_kind,
          size: att.size,
          created_at: att.created_at || new Date().toISOString()
        });
      }
    }
    return savedAttachmentsMeta;
  }

  async function handleTaskFormSubmit(e) {
    if (e) e.preventDefault();

    syncDraftSubItemsFromDom();
    const validSubItems = draftSubItems.filter(it => it && String(it.name || '').trim() !== '');

    const title = (document.getElementById('task-input-title')?.value || '').trim();
    const site = (document.getElementById('task-input-site')?.value || '').trim();
    const locationDetail = (document.getElementById('task-input-location')?.value || '').trim();
    const assignedTo = (document.getElementById('task-input-assigned')?.value || '').trim();
    const orderedBy = (document.getElementById('task-input-ordered-by')?.value || '').trim();
    const rawOrderDate = document.getElementById('task-input-order-date')?.value;
    const orderDate = toIsoDate(rawOrderDate) || getTodayString();
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
        const attachmentsMeta = await persistAttachmentsForTask(editingTaskId);
        const patch = {
          title,
          site,
          location_detail: locationDetail,
          assigned_to: assignedTo,
          ordered_by: orderedBy,
          order_date: orderDate,
          due_date: dueDate,
          description,
          sub_items: validSubItems,
          attachments: attachmentsMeta
        };
        if (!validSubItems.length) {
          patch.status = status;
          patch.progress_percent = percent;
        }
        await API.updateTask(editingTaskId, patch);
        if (UTILS.toast) UTILS.toast('บันทึกการแก้ไขเรียบร้อยแล้ว', 'success');
      } else {
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
          description,
          sub_items: validSubItems,
          attachments: []
        };
        const created = await API.createTask(newPayload);
        if (created && created.id && draftAttachments.length > 0 && typeof API.updateTask === 'function') {
          const attachmentsMeta = await persistAttachmentsForTask(created.id);
          await API.updateTask(created.id, { attachments: attachmentsMeta });
        }
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

    document.getElementById('timeline-input-percent').value = String(task.progress_percent || 0);
    const defTlToday = getTodayString();
document.getElementById('timeline-input-date').value = toDisplayDate(defTlToday);
if (timelineDatePicker) { timelineDatePicker.setDate(toDisplayDate(defTlToday)); }
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

    const sorted = [...history].reverse();

    container.innerHTML = sorted.map((entry) => {
      const p = Math.round(Number(entry.percent) || 0);
      const by = entry.by ? `โดย ${escapeHtml(entry.by)}` : '';
      const dateText = formatDate(entry.date || entry.created_at);
      const snapshot = Array.isArray(entry.sub_items_snapshot) ? entry.sub_items_snapshot : [];

      return `
        <div class="p-3 bg-white rounded border border-slate-200 text-xs shadow-sm">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-slate-800">
              ความคืบหน้ารวม: <span class="text-blue-700">${p}%</span>
            </span>
            <span class="text-slate-400">${dateText} ${by}</span>
          </div>
          ${snapshot.length > 0 ? `
            <div class="mt-1.5 mb-1 pl-2 border-l-2 border-blue-200 space-y-0.5 text-slate-600">
              ${snapshot.map(s => `
                <div>• <strong>${escapeHtml(s.name)}</strong>: ${s.added_qty > 0 ? `+${s.added_qty}` : ''} (สะสม ${s.actual_qty || 0}${s.target_qty ? '/' + s.target_qty : ''} ${escapeHtml(s.unit || '')}) [${escapeHtml(s.status)}]</div>
              `).join('')}
            </div>
          ` : ''}
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
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => renderTasks());
    }

    const statusFilter = document.getElementById('filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => renderTasks());
    }

    const siteFilter = document.getElementById('filter-site');
    if (siteFilter) {
      siteFilter.addEventListener('change', () => renderTasks());
    }

    const createBtn = document.getElementById('btn-create-task');
    if (createBtn) {
      createBtn.addEventListener('click', openCreateModal);
    }

    // ปุ่มเพิ่มรายการงานย่อยในฟอร์ม
    const addSubItemBtn = document.getElementById('btn-add-subitem');
    if (addSubItemBtn) {
      addSubItemBtn.addEventListener('click', () => {
        syncDraftSubItemsFromDom();
        draftSubItems.push({
          id: `sub_${Date.now()}_${draftSubItems.length + 1}`,
          name: '',
          target_qty: null,
          unit: '',
          actual_qty: 0,
          progress_percent: 0,
          status: 'Pending',
          issue_note: ''
        });
        renderDraftSubItems();
      });
    }

    // ปุ่มแนบรูปภาพ ไฟล์ PDF และวิดีโอสั้น
    const btnAttachPhoto = document.getElementById('btn-attach-photo');
    const inputAttachPhoto = document.getElementById('input-attach-photo');
    if (btnAttachPhoto && inputAttachPhoto) {
      btnAttachPhoto.addEventListener('click', () => inputAttachPhoto.click());
      inputAttachPhoto.addEventListener('change', async (e) => {
        await handleFilesSelected(e.target.files, 'image');
        inputAttachPhoto.value = '';
      });
    }

    // ปุ่ม "📋 วางรูปที่ Copy" (อ่านจากคลิปบอร์ดตรงๆ ทันที)
    const btnAttachPaste = document.getElementById('btn-attach-paste');
    if (btnAttachPaste) {
      btnAttachPaste.addEventListener('click', async () => {
        if (!navigator.clipboard) {
          if (UTILS.toast) UTILS.toast('เบราว์เซอร์ไม่รองรับการอ่านคลิปบอร์ด กรุณาใช้ปุ่ม "📷 แนบรูป" แทน', 'warning');
          return;
        }

        try {
          if (navigator.clipboard.read) {
            const clipItems = await navigator.clipboard.read();
            const pastedFiles = [];

            for (const item of clipItems) {
              const imgType = item.types.find(t => t.startsWith('image/'));
              if (imgType) {
                const blob = await item.getType(imgType);
                const timeTag = new Date().toISOString().slice(11, 19).replace(/:/g, '');
                const ext = imgType.includes('png') ? 'png' : 'jpg';
                const file = new File([blob], `clipboard_${timeTag}.${ext}`, { type: imgType });
                pastedFiles.push(file);
              }
            }

            if (pastedFiles.length > 0) {
              await handleFilesSelected(pastedFiles, 'image');
              if (UTILS.toast) UTILS.toast(`📋 วางรูปภาพที่ Copy เรียบร้อย (${pastedFiles.length} รูป)`, 'success');
              return;
            }
          }

          if (UTILS.toast) {
            UTILS.toast('ไม่พบรูปภาพในคลิปบอร์ด — กรุณา Copy รูปภาพ หรือแคปหน้าจอก่อนกดปุ่มนี้', 'error');
          } else {
            alert('ไม่พบรูปภาพในคลิปบอร์ด — กรุณา Copy รูปภาพก่อนกดปุ่มนี้');
          }
        } catch (err) {
          console.warn('Clipboard read error:', err);
          if (err.name === 'NotAllowedError' || String(err).includes('permission')) {
            if (UTILS.toast) {
              UTILS.toast('เบราว์เซอร์ต้องการสิทธิ์เข้าถึงคลิปบอร์ด — กรุณากด "อนุญาต (Allow)" ในเบราว์เซอร์', 'warning');
            }
          } else {
            if (UTILS.toast) {
              UTILS.toast('ไม่สามารถอ่านคลิปบอร์ดได้: ' + err.message, 'error');
            }
          }
        }
      });
    }

    const btnAttachPdf = document.getElementById('btn-attach-pdf');
    const inputAttachPdf = document.getElementById('input-attach-pdf');
    if (btnAttachPdf && inputAttachPdf) {
      btnAttachPdf.addEventListener('click', () => inputAttachPdf.click());
      inputAttachPdf.addEventListener('change', async (e) => {
        await handleFilesSelected(e.target.files, 'pdf');
        inputAttachPdf.value = '';
      });
    }

    const btnAttachVideo = document.getElementById('btn-attach-video');
    const inputAttachVideo = document.getElementById('input-attach-video');
    if (btnAttachVideo && inputAttachVideo) {
      btnAttachVideo.addEventListener('click', () => inputAttachVideo.click());
      inputAttachVideo.addEventListener('change', async (e) => {
        await handleFilesSelected(e.target.files, 'video');
        inputAttachVideo.value = '';
      });
    }

    // รองรับการวางรูปภาพจากคลิปบอร์ด (Ctrl+V) เมื่อเปิดหน้าต่างสั่งงาน
    document.addEventListener('paste', async (e) => {
      const modal = document.getElementById('modal-task');
      if (!modal || modal.classList.contains('hidden')) return;

      const pastedFiles = [];

      // ตรวจสอบทั้ง e.clipboardData.files (ไฟล์ที่ copy มา) และ e.clipboardData.items
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        for (const file of Array.from(e.clipboardData.files)) {
          if (file.type && (file.type.startsWith('image/') || file.type.includes('pdf'))) {
            pastedFiles.push(file);
          }
        }
      }

      if (!pastedFiles.length && e.clipboardData?.items) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.type && item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            if (blob) {
              const timeTag = new Date().toISOString().slice(11, 19).replace(/:/g, '');
              const pastedFile = new File([blob], `screenshot_${timeTag}.png`, { type: blob.type || 'image/png' });
              pastedFiles.push(pastedFile);
            }
          } else if (item.type === 'application/pdf') {
            const blob = item.getAsFile();
            if (blob) pastedFiles.push(blob);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        await handleFilesSelected(pastedFiles, 'image');
        if (UTILS.toast) {
          UTILS.toast(`📋 วางรูปภาพจากคลิปบอร์ดเรียบร้อย (${pastedFiles.length} รูป)`, 'success');
        }
      }
    });

    // รองรับ Drag & Drop ลากไฟล์รูป/PDF มาวางในกรอบแนบไฟล์
    const dropzone = document.getElementById('task-attachments-dropzone');
    if (dropzone) {
      ['dragenter', 'dragover'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('ring-2', 'ring-amber-500', 'bg-amber-100/60');
        });
      });
      ['dragleave', 'drop'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('ring-2', 'ring-amber-500', 'bg-amber-100/60');
        });
      });
      dropzone.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          await handleFilesSelected(dt.files, 'image');
          if (UTILS.toast) UTILS.toast(`📥 เพิ่มไฟล์แนบ ${dt.files.length} รายการเรียบร้อย`, 'success');
        }
      });
    }

    
    // เริ่มต้น Litepicker ภาษาไทย สำหรับวันที่สั่งงาน และวันที่อัปเดตไทม์ไลน์
    if (typeof Litepicker !== 'undefined') {
      const orderEl = document.getElementById('task-input-order-date');
      if (orderEl) {
        orderDatePicker = new Litepicker({
          element: orderEl,
          singleMode: true,
          format: 'DD/MM/YYYY',
          lang: 'th-TH',
          autoApply: true
        });
      }
      const tlEl = document.getElementById('timeline-input-date');
      if (tlEl) {
        timelineDatePicker = new Litepicker({
          element: tlEl,
          singleMode: true,
          format: 'DD/MM/YYYY',
          lang: 'th-TH',
          autoApply: true
        });
      }
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

    // Modal 4 controls (Media Viewer)
    document.getElementById('btn-close-media-viewer')?.addEventListener('click', closeMediaViewerModal);
  }

  // 16. Initialize Page
  initEvents();
  loadTasks();
  loadWorkers();
})();
