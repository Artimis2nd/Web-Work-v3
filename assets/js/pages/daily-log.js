(() => {
  Utils.renderShell('daily-log.html', 'บันทึกงานประจำวัน');
  const content = document.getElementById('page-content');

  const MARKUP_RATE = 1.2;
  const MAX_IMAGES = 6;
  const HOURLY_RATE_DIVISOR = 8;
  const FERN_NAME = 'เฟิร์น';

  function isSupervisorWorker(w) {
    if (!w) return false;
    if (w.Role === 'Supervisor' || w.role === 'Supervisor' || w.Role === 'หัวหน้างาน') return true;
    if (w.FullName && w.FullName.includes(FERN_NAME)) return true;
    return false;
  }

  // จัดเรียงคนงานตามเงื่อนไขเดียวกับ workers.html:
  // 1. สถานะ: ทำงานอยู่ (Active) ขึ้นก่อน พักงาน (Inactive)
  // 2. ตำแหน่ง: หัวหน้างาน (Supervisor) ขึ้นก่อน คนงาน (Worker)
  // 3. ค่าแรงต่อวัน: จากมากไปหาน้อย (Descending)
  // 4. ชื่อภาษาไทย: เรียงตามพยัญชนะไทย ก-ฮ
  function sortWorkersByStandardOrder(list) {
    return [...list].sort((a, b) => {
      const isActiveA = (a.Status || a.status) === 'Active' ? 1 : 0;
      const isActiveB = (b.Status || b.status) === 'Active' ? 1 : 0;
      if (isActiveA !== isActiveB) return isActiveB - isActiveA;

      const isSuperA = isSupervisorWorker(a) ? 1 : 0;
      const isSuperB = isSupervisorWorker(b) ? 1 : 0;
      if (isSuperA !== isSuperB) return isSuperB - isSuperA;

      const wageA = Number(a.DailyWage ?? a.daily_wage) || 0;
      const wageB = Number(b.DailyWage ?? b.daily_wage) || 0;
      if (wageA !== wageB) return wageB - wageA;

      const nameA = String(a.FullName || a.full_name || '');
      const nameB = String(b.FullName || b.full_name || '');
      return nameA.localeCompare(nameB, 'th');
    });
  }

  let rawAllWorkers = [];
  let allWorkers = [];
  let selectedWorkers = new Map(); // id -> { worker, wageType, hours, otHours, fixedAmount }
  // แต่ละ element: { type: 'url', data: 'https://...' } หรือ { type: 'base64', data: 'data:...' }
  let compressedImages = [];
  let editGroupId = null; // ถ้ามีค่า = กำลังแก้ไขใบงานนี้
  let datepicker = null; // Litepicker instance
  let siteHistory = [];
  let loadingAnimationInterval = null;
  let requesterHistory = [];
  let availableTasks = [];
  let lastAutoFilledDetail = '';
  let lastAutoFilledRequester = '';
  let logSubItemsState = []; // รายการย่อยของใบสั่งงานที่เลือก [{ id, name, base_actual_qty, added_qty, target_qty, unit, status, progress_percent, issue_note }]
  let newLogSubItemsState = []; // รายการย่อยที่เพิ่มใหม่จากหน้างาน [{ id, name, added_qty, target_qty, unit, status, progress_percent, issue_note }]
  let dailyWorkerHoursSummary = {}; // เก็บสรุปชั่วโมงทำงานสะสมรายวันของคนงานแต่ละคนในวันที่เลือก { [workerName]: { regularHours, otHours, fixedAmount, entries: [...] } }

  // ─── Helper: safe number ─────────────────────────────
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  function getCurrentApiDate() {
    const dateInput = document.getElementById('f-date')?.value || '';
    const dateMatch = dateInput.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : dateInput;
  }

  async function refreshDailyHoursSummary() {
    const apiDate = getCurrentApiDate();
    if (!apiDate) {
      dailyWorkerHoursSummary = {};
      return;
    }
    try {
      if (typeof Api !== 'undefined' && Api.getDailyWorkerHoursSummary) {
        dailyWorkerHoursSummary = await Api.getDailyWorkerHoursSummary(apiDate, editGroupId);
      } else {
        dailyWorkerHoursSummary = {};
      }
    } catch (err) {
      console.warn('โหลดสรุปชั่วโมงคนงานรายวันไม่สำเร็จ:', err);
      dailyWorkerHoursSummary = {};
    }
  }

  function renderHourAlertBanner(workerName, hours, wageType) {
    if (wageType !== 'hourly') return '';
    const dailyInfo = dailyWorkerHoursSummary[workerName];
    const alreadyRegular = dailyInfo ? (dailyInfo.regularHours || 0) : 0;
    if (alreadyRegular <= 0) return '';

    const currentTotal = alreadyRegular + Number(hours || 0);
    if (currentTotal > 8) {
      const over = currentTotal - 8;
      const rec = Math.max(0, 8 - alreadyRegular);
      return `
        <div class="p-2 rounded bg-red-50 border border-red-300 text-xs text-red-700 flex items-start gap-1.5 animate-pulse mt-2">
          <span class="text-sm">⚠️</span>
          <div>
            <strong>คำเตือนเวลาเกิน 8 ชม./วัน:</strong> วันนี้ลงไปแล้ว ${alreadyRegular} ชม. + ใบนี้ ${hours} ชม. = <strong>รวม ${currentTotal} ชม.</strong> (เกิน ${over} ชม.)
            <div class="text-[11px] text-red-600 mt-0.5">💡 แนะนำ: ปรับเวลาปกติในใบนี้เหลือ <strong>${rec} ชม.</strong> แล้วใส่ส่วนเกิน <strong>${over} ชม.</strong> ในช่อง OT แทน</div>
          </div>
        </div>
      `;
    }
    if (alreadyRegular >= 8) {
      return `
        <div class="p-2 rounded bg-amber-50 border border-amber-300 text-xs text-amber-800 flex items-start gap-1.5 mt-2">
          <span class="text-sm">⛔</span>
          <div>
            <strong>เวลาปกติครบ 8 ชม. แล้ว:</strong> วันนี้คนงานบันทึกเวลาปกติครบเต็มวันแล้ว หากทำงานเพิ่มในใบนี้กรุณาใส่ในช่อง <strong>OT</strong>
          </div>
        </div>
      `;
    }
    return `
      <div class="p-2 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-start gap-1.5 mt-2">
        <span class="text-sm">💡</span>
        <div>
          <strong>ปรับชั่วโมงอัตโนมัติ:</strong> วันนี้ทำงานอื่นไปแล้ว ${alreadyRegular} ชม. → ใบนี้ปรับเป็น <strong>${hours} ชม.</strong> เพื่อให้ครบ 8 ชม./วัน พอดี
        </div>
      </div>
    `;
  }

  // ─── Layout ────────────────────────────────────────────────
  function layout() {
    content.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <form id="log-form" class="ledger-card p-5 lg:col-span-2 space-y-4">
          <div>
            <label class="field-label" for="f-task">งานที่ได้รับมอบหมาย (ถ้ามี)</label>
            <select id="f-task" class="field-input">
              <option value="">-- งานทั่วไป / ไม่ระบุใบสั่งงาน --</option>
            </select>
          </div>

          <div id="task-update-section" class="hidden p-4 rounded-lg space-y-3" style="display:none;background:var(--paper-warm);border:1px solid var(--line);">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider" style="color:var(--blueprint)">📋 บันทึกผลงานตามรายการย่อย & ความคืบหน้าใบสั่งงาน</span>
              <span id="task-code-badge" class="font-mono text-xs px-2 py-0.5 rounded bg-[var(--paper)] border border-[var(--line)]"></span>
            </div>

            <!-- ตารางรายการงานย่อยสำหรับลงบันทึกประจำวัน -->
            <div id="task-subitems-log-wrapper" class="space-y-2 pt-1">
              <div id="task-subitems-log-list" class="space-y-2"></div>
              <div id="task-new-subitems-log-list" class="space-y-2"></div>
              <div class="flex justify-end pt-1">
                <button type="button" id="btn-add-log-subitem" class="btn btn-outline btn-sm text-xs">
                  ➕ เพิ่มรายการย่อยหน้างาน (งานพ่วง/งานงอก)
                </button>
              </div>
            </div>

            <div class="grid sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/80">
              <div>
                <label class="field-label text-xs" for="f-task-progress">ความคืบหน้ารวมวันนี้ (%)</label>
                <input type="number" id="f-task-progress" class="field-input text-sm" min="0" max="100" placeholder="0 - 100">
              </div>
              <div class="sm:col-span-2">
                <label class="field-label text-xs" for="f-task-issues">ปัญหาที่พบหน้างานวันนี้ (ถ้ามี)</label>
                <input type="text" id="f-task-issues" class="field-input text-sm" placeholder="เช่น วัสดุส่งช้า, ฝนตก (สรุปอัตโนมัติจากรายการที่ติดปัญหา)">
              </div>
            </div>
            <div>
              <label class="field-label text-xs" for="f-task-resolution">แนวทางแก้ไข / สิ่งที่ทำได้</label>
              <input type="text" id="f-task-resolution" class="field-input text-sm" placeholder="เช่น ประสานงานร้านค้า, เปลี่ยนจุดทำงาน">
            </div>
          </div>
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="field-label">วันที่</label>
              <input type="text" id="f-date" class="field-input" placeholder="เลือกวันที่" required autocomplete="off">
            </div>
            <div>
              <label class="field-label">ไซต์งาน / โครงการ</label>
              <input type="text" id="f-site" class="field-input" required
                     placeholder="เช่น โครงการบ้านคุณเอ - ถนนสุขุมวิท" list="site-list" autocomplete="off">
              <datalist id="site-list"></datalist>
            </div>
          </div>
          <div>
            <label class="field-label">รายละเอียดงาน</label>
            <textarea id="f-detail" class="field-input" rows="6"
                      placeholder="เช่น เทปูนพื้นชั้น 2, ผูกเหล็กเสา (หากเลือกใบสั่งงานและปรับความคืบหน้า ระบบจะดึงรายการที่เปลี่ยนแปลงมาใส่ให้อัตโนมัติ)"></textarea>
          </div>
          <div>
            <label class="field-label">ผู้สั่งงาน</label>
            <input type="text" id="f-requester" class="field-input" required
                   placeholder="ชื่อหัวหน้างาน / ผู้ควบคุมงาน" list="requester-list" autocomplete="off">
            <datalist id="requester-list"></datalist>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="field-label mb-0">เลือกคนงาน (เลือกได้หลายคน)</label>
              <span id="worker-loading" class="text-xs" style="color:var(--ink-soft)">กำลังโหลด...</span>
            </div>
            <div id="worker-list" class="space-y-2 max-h-[500px] overflow-y-auto pr-1"></div>
          </div>

          <div>
            <label class="field-label">รูปภาพแนบ (สูงสุด ${MAX_IMAGES} รูป)</label>
            <div class="image-upload-area" id="image-upload-area">
              <div style="font-size:2rem;margin-bottom:0.25rem">&#128247;</div>
              <div style="font-size:0.85rem;color:var(--ink-soft)">
                คลิกเพื่อเลือกรูปภาพ, ลากไฟล์มาวาง หรือกด Ctrl+V วางจากคลิปบอร์ด
              </div>
              <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:0.25rem">
                รองรับ JPG, PNG — บีบอัดอัตโนมัติ
              </div>
              <input type="file" id="f-images" accept="image/*" multiple style="display:none">
            </div>
            <div id="image-preview-grid" class="image-grid"></div>
            <div id="image-count" class="image-count">0 / ${MAX_IMAGES} รูป</div>
          </div>

          <div id="form-error"></div>

          <div class="flex gap-2">
            <button type="submit" id="f-submit" class="btn btn-primary w-full sm:w-auto">
              <span id="f-submit-label">บันทึกงาน</span>
            </button>
          </div>
        </form>

        <div class="ledger-card p-5 h-fit lg:sticky lg:top-6">
          <h2 class="font-display text-lg font-semibold mb-3">สรุปยอดก่อนบันทึก</h2>
          <div id="summary-list" class="space-y-2 mb-4 text-sm"></div>
          <div class="pt-3 space-y-1" style="border-top:1.5px dashed var(--line)">
            <div class="flex justify-between text-sm">
              <span style="color:var(--ink-soft)">คนงานที่เลือก</span>
              <span class="font-mono" id="sum-count">0 คน</span>
            </div>
            <div class="flex justify-between text-sm">
              <span style="color:var(--ink-soft)">รวมค่าแรงดิบ</span>
              <span class="font-mono" id="sum-raw">฿0.00</span>
            </div>
            <div class="flex justify-between text-sm">
              <span style="color:var(--ink-soft)">รวมค่าแรงปกติ+OT (รวม +20%)</span>
              <span class="font-mono" id="sum-normal">฿0.00</span>
            </div>
            <div class="flex justify-between text-sm">
              <span style="color:var(--ink-soft)">รวมค่าแรงเหมา (ไม่มี +20%)</span>
              <span class="font-mono" id="sum-fixed">฿0.00</span>
            </div>
            <div class="flex justify-between text-base font-semibold" style="color:var(--blueprint-dark)">
              <span>รวมจ่ายทั้งสิ้น</span>
              <span class="font-mono" id="sum-total">฿0.00</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initialize Litepicker (Thai-friendly)
    datepicker = new Litepicker({
      element: document.getElementById('f-date'),
      singleMode: true,
      format: 'DD/MM/YYYY',
      lang: 'th-TH',
      autoApply: true,
      setup: (picker) => {
        picker.on('selected', async () => {
          await refreshDailyHoursSummary();
          renderWorkerList();
          updateSummary();
        });
      }
    });
    // Set default date to today
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    document.getElementById('f-date').value = `${dd}/${mm}/${yyyy}`;

    document.getElementById('f-date').addEventListener('change', async () => {
      await refreshDailyHoursSummary();
      renderWorkerList();
      updateSummary();
    });

    document.getElementById('f-task').addEventListener('change', onTaskChange);
    document.getElementById('log-form').addEventListener('submit', onSubmit);

    const addLogSubItemBtn = document.getElementById('btn-add-log-subitem');
    if (addLogSubItemBtn) {
      addLogSubItemBtn.addEventListener('click', () => {
        newLogSubItemsState.push({
          id: `new_sub_${Date.now()}_${newLogSubItemsState.length + 1}`,
          name: '',
          added_qty: 0,
          target_qty: null,
          unit: '',
          status: 'In Progress',
          progress_percent: 50,
          issue_note: ''
        });
        const currentTask = getSelectedTaskObj();
        renderTaskSubItemsForLog(currentTask);
      });
    }

    // Image upload handlers
    setupImageUpload();
  }

  // ─── Image Upload ──────────────────────────────────────────
  function setupImageUpload() {
    const area = document.getElementById('image-upload-area');
    const fileInput = document.getElementById('f-images');

    area.addEventListener('click', () => fileInput.click());

    area.addEventListener('dragover', (e) => {
      e.preventDefault();
      area.classList.add('dragover');
    });
    area.addEventListener('dragleave', () => {
      area.classList.remove('dragover');
    });
    area.addEventListener('drop', (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });

    // รองรับการวางรูปภาพจากคลิปบอร์ด (Clipboard Paste / Ctrl+V หรือ Screenshot)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('paste', (e) => {
      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      const items = clipboardData.items;
      if (!items) return;

      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        area.classList.add('dragover');
        setTimeout(() => area.classList.remove('dragover'), 300);
        handleFiles(imageFiles);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        handleFiles(fileInput.files);
      }
    });
  }

  async function handleFiles(files) {
    const remaining = MAX_IMAGES - compressedImages.length;
    if (remaining <= 0) {
      Utils.toast('สามารถแนบรูปได้สูงสุด ' + MAX_IMAGES + ' รูปเท่านั้น', 'error');
      return;
    }

    const toProcess = Math.min(files.length, remaining);
    for (let i = 0; i < toProcess; i++) {
      try {
        const base64 = await Utils.compressImage(files[i]);
        compressedImages.push({ type: 'base64', data: base64 });
      } catch (err) {
        Utils.toast('ไม่สามารถประมวลผลรูป ' + files[i].name, 'error');
      }
    }
    renderImagePreviews();
    document.getElementById('f-images').value = '';
  }

  function renderImagePreviews() {
    const grid = document.getElementById('image-preview-grid');
    const count = document.getElementById('image-count');

    if (!compressedImages.length) {
      grid.innerHTML = '';
      count.textContent = '0 / ' + MAX_IMAGES + ' รูป';
      return;
    }

    grid.innerHTML = compressedImages.map((img, idx) => `
      <div class="image-preview">
        <img src="${Utils.escapeHtml(img.data)}" alt="รูปที่ ${idx + 1}">
        <button type="button" class="remove-btn" data-img-index="${idx}">&times;</button>
      </div>
    `).join('');

    grid.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-img-index'));
        compressedImages.splice(idx, 1);
        renderImagePreviews();
      });
    });

    count.textContent = compressedImages.length + ' / ' + MAX_IMAGES + ' รูป';
  }

  // ─── Worker List ───────────────────────────────────────────
  function renderWorkerList() {
    const list = document.getElementById('worker-list');
    if (!allWorkers.length) {
      list.innerHTML = `<div class="text-sm" style="color:var(--ink-soft)">ยังไม่มีรายชื่อคนงาน — เพิ่มได้ที่หน้า "จัดการคนงาน"</div>`;
      return;
    }

    list.innerHTML = allWorkers.map(w => {
      const sel = selectedWorkers.get(String(w.ID));
      const checked = sel ? 'checked' : '';
      const isSuper = isSupervisorWorker(w);
      const isInactive = w.Status === 'Inactive';

      const dailyInfo = dailyWorkerHoursSummary[w.FullName];
      let dailyInfoHtml = '';
      if (dailyInfo && (dailyInfo.regularHours > 0 || dailyInfo.otHours > 0 || dailyInfo.fixedAmount > 0)) {
        const taskLabels = (dailyInfo.entries || []).map(e => {
          const t = availableTasks.find(x => String(x.id) === String(e.taskId));
          const code = t ? (t.task_code || `TSK-${t.id}`) : 'งานทั่วไป';
          return `${code} (${e.hours}h${e.otHours > 0 ? `+OT${e.otHours}` : ''})`;
        }).join(', ');

        const isMaxed = dailyInfo.regularHours >= 8;
        const badgeStyle = isMaxed
          ? 'background:#fef2f2; color:#991b1b; border:1px solid #fecaca;'
          : 'background:#fefce8; color:#854d0e; border:1px solid #fef08a;';

        dailyInfoHtml = `
          <div class="mt-1 flex items-center gap-1.5 flex-wrap">
            <span class="badge text-[11px] font-medium" style="${badgeStyle}">
              ⏱️ วันนี้ลงแล้ว: ปกติ ${dailyInfo.regularHours} ชม.${dailyInfo.otHours > 0 ? ` + OT ${dailyInfo.otHours} ชม.` : ''}
            </span>
            ${taskLabels ? `<span class="text-[11px] text-slate-400 font-mono">[${taskLabels}]</span>` : ''}
          </div>
        `;
      }

      return `
        <div class="worker-item" data-id="${w.ID}">
          <label class="worker-check ${checked}" data-id="${w.ID}">
            <span>
              <span class="font-medium block">${Utils.escapeHtml(w.FullName)} ${isInactive ? '<span class="text-xs text-amber-600 font-normal">(พักงาน)</span>' : ''}</span>
              <span class="text-xs font-mono" style="color:var(--ink-soft)">฿${Utils.money(w.DailyWage)}/วัน</span>
              ${isSuper ? '<span class="no-markup" style="color:var(--red);font-size:0.7rem;margin-left:0.5rem">👑 หัวหน้างาน (ไม่คิด +20%)</span>' : ''}
              ${dailyInfoHtml}
            </span>
            <input type="checkbox" data-checkbox-id="${w.ID}" ${checked}>
          </label>
          <div class="worker-options ${checked ? 'open' : ''}" data-options-id="${w.ID}">
            ${renderWageOptions(w, sel)}
          </div>
        </div>
      `;
    }).join('');

    // Checkbox click
    list.querySelectorAll('.worker-check').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.closest('.remove-btn')) return;
        const id = el.getAttribute('data-id');
        toggleWorker(id);
      });
    });

    // Checkbox input click (stop propagation)
    list.querySelectorAll('.worker-check input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = cb.getAttribute('data-checkbox-id');
        toggleWorker(id);
      });
    });

    // Wage type toggle
    list.querySelectorAll('.wage-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-worker-id');
        const type = btn.getAttribute('data-type');
        setWageType(id, type);
      });
    });

    // Hours/OT/Fixed inputs
    list.querySelectorAll('.wage-hours').forEach(el => {
      el.addEventListener('change', () => {
        const id = el.getAttribute('data-worker-id');
        updateWorkerCalc(id);
      });
    });
    list.querySelectorAll('.wage-ot').forEach(el => {
      el.addEventListener('change', () => {
        const id = el.getAttribute('data-worker-id');
        updateWorkerCalc(id);
      });
    });
    list.querySelectorAll('.wage-fixed').forEach(el => {
      el.addEventListener('input', () => {
        const id = el.getAttribute('data-worker-id');
        updateWorkerCalc(id);
      });
    });
  }

  function renderWageOptions(worker, sel) {
    const isFern = worker.FullName.includes(FERN_NAME);
    const wageType = sel ? sel.wageType : 'hourly';
    const hours = sel ? safeNum(sel.hours) : 0;
    const otHours = sel ? safeNum(sel.otHours) : 0;
    const fixedAmount = sel ? safeNum(sel.fixedAmount) : '';

    const hourlyActive = wageType === 'hourly' ? 'active' : '';
    const fixedActive = wageType === 'fixed' ? 'active' : '';

    const hourlyDisplay = wageType === 'hourly' ? 'style="display:flex"' : 'style="display:none"';
    const fixedDisplay = wageType === 'fixed' ? 'style="display:block"' : 'style="display:none"';

    const rawWage = calcRawWage(worker, { wageType, hours, otHours, fixedAmount });
    const totalWage = calcTotalWage(rawWage, isFern);

    // ข้อความแสดงผล สำหรับ fixed จะไม่แสดง markup
    let resultText;
    if (wageType === 'fixed') {
      resultText = `≈ ฿${Utils.money(rawWage)} (เหมาจ่าย ไม่มี +20%)`;
    } else {
      resultText = `≈ ฿${Utils.money(rawWage)}`;
      if (isFern) {
        resultText += ' <span class="no-markup">(ไม่มี +20%)</span>';
      } else {
        resultText += ` → รวม ฿${Utils.money(totalWage)}`;
      }
    }

    return `
      <div class="wage-type-toggle">
        <button type="button" class="wage-type-btn ${hourlyActive}" data-worker-id="${worker.ID}" data-type="hourly">รายชั่วโมง/OT</button>
        <button type="button" class="wage-type-btn ${fixedActive}" data-worker-id="${worker.ID}" data-type="fixed">เหมาจ่าย</button>
      </div>

      <div class="wage-inputs-hourly" ${hourlyDisplay}>
        <div class="wage-input-group">
          <label>ปกติ:</label>
          <select class="wage-hours" data-worker-id="${worker.ID}">
            ${[0,1,2,3,4,5,6,7,8].map(h => {
              let label = h + ' ชม.';
              if (h === 4) label += ' (ครึ่งวัน)';
              if (h === 8) label += ' (เต็มวัน)';
              return `<option value="${h}" ${hours === h ? 'selected' : ''}>${label}</option>`;
            }).join('')}
          </select>
          <label>OT:</label>
          <select class="wage-ot" data-worker-id="${worker.ID}">
            ${[0,1,2,3,4].map(h => `<option value="${h}" ${otHours === h ? 'selected' : ''}>${h} ชม.</option>`).join('')}
          </select>
          <span style="font-size:0.75rem;color:var(--ink-soft)">(OT คิด 2 เท่า)</span>
        </div>
      </div>

      <div class="wage-inputs-fixed" ${fixedDisplay}>
        <div class="wage-input-group">
          <label>จำนวนเงิน:</label>
          <input type="number" class="wage-fixed" data-worker-id="${worker.ID}"
                 value="${fixedAmount}" min="0" step="1" placeholder="เช่น 500">
          <span style="font-size:0.75rem;color:var(--ink-soft)">บาท</span>
        </div>
      </div>

      <div class="wage-calc-result" data-result-id="${worker.ID}">
        ${resultText}
      </div>

      <div class="wage-hours-alert" data-alert-id="${worker.ID}">
        ${renderHourAlertBanner(worker.FullName, hours, wageType)}
      </div>
    `;
  }

  // ─── Worker Logic ──────────────────────────────────────────
  function toggleWorker(id) {
    const worker = allWorkers.find(w => String(w.ID) === id);
    if (!worker) return;

    if (selectedWorkers.has(id)) {
      selectedWorkers.delete(id);
    } else {
      const dailyInfo = dailyWorkerHoursSummary[worker.FullName];
      const alreadyRegular = dailyInfo ? (dailyInfo.regularHours || 0) : 0;
      const suggestedHours = Math.max(0, 8 - alreadyRegular);

      selectedWorkers.set(id, {
        worker,
        wageType: 'hourly',
        hours: suggestedHours,
        otHours: 0,
        fixedAmount: 0
      });
    }
    renderWorkerList();
    updateSummary();
  }

  function setWageType(id, type) {
    const sel = selectedWorkers.get(id);
    if (!sel) return;
    sel.wageType = type;
    if (type === 'hourly') {
      sel.fixedAmount = 0;
    } else {
      sel.hours = 0;
      sel.otHours = 0;
    }
    renderWorkerList();
    updateSummary();
  }

  function updateWorkerCalc(id) {
    const sel = selectedWorkers.get(id);
    if (!sel) return;

    const container = document.querySelector(`[data-options-id="${id}"]`);
    if (!container) return;

    const hoursEl = container.querySelector('.wage-hours');
    const otEl = container.querySelector('.wage-ot');
    const fixedEl = container.querySelector('.wage-fixed');

    if (hoursEl) sel.hours = safeNum(parseInt(hoursEl.value));
    if (otEl) sel.otHours = safeNum(parseInt(otEl.value));
    if (fixedEl) sel.fixedAmount = safeNum(parseFloat(fixedEl.value));

    const worker = sel.worker;
    const isFern = worker.FullName.includes(FERN_NAME);
    const rawWage = calcRawWage(worker, sel);
    const totalWage = calcTotalWage(rawWage, isFern);

    const resultEl = container.querySelector('.wage-calc-result');
    if (resultEl) {
      let text;
      if (sel.wageType === 'fixed') {
        text = `≈ ฿${Utils.money(rawWage)} (เหมาจ่าย ไม่มี +20%)`;
      } else {
        text = `≈ ฿${Utils.money(rawWage)}`;
        if (isFern) {
          text += ' <span class="no-markup">(ไม่มี +20%)</span>';
        } else {
          text += ` → รวม ฿${Utils.money(totalWage)}`;
        }
      }
      resultEl.innerHTML = text;
    }

    const alertEl = container.querySelector(`[data-alert-id="${id}"]`);
    if (alertEl) {
      alertEl.innerHTML = renderHourAlertBanner(worker.FullName, sel.hours, sel.wageType);
    }

    updateSummary();
  }

  function calcRawWage(worker, sel) {
    const dailyWage = safeNum(worker ? worker.DailyWage : 0);
    if (!sel || sel.wageType === 'fixed') {
      return safeNum(sel ? sel.fixedAmount : 0);
    }
    const hourlyRate = dailyWage / HOURLY_RATE_DIVISOR;
    const normalPay = hourlyRate * safeNum(sel.hours);
    const otPay = hourlyRate * 2 * safeNum(sel.otHours);
    return normalPay + otPay;
  }

  function calcTotalWage(rawWage, isSupervisor) {
    const rw = safeNum(rawWage);
    if (isSupervisor) return rw;
    return rw * MARKUP_RATE;
  }

  // ─── Summary ───────────────────────────────────────────────
  function updateSummary() {
    const summaryList = document.getElementById('summary-list');
    const entries = Array.from(selectedWorkers.values());

    if (!entries.length) {
      summaryList.innerHTML = `<div style="color:var(--ink-soft)">ยังไม่ได้เลือกคนงาน</div>`;
    } else {
      summaryList.innerHTML = entries.map(sel => {
        const w = sel.worker;
        if (!w) return '';
        const isSuper = isSupervisorWorker(w);
        const rawWage = calcRawWage(w, sel);
        let detail = '';
        if (sel.wageType === 'fixed') {
          detail = 'เหมา ฿' + Utils.money(safeNum(sel.fixedAmount));
        } else {
          const parts = [];
          if (safeNum(sel.hours) > 0) parts.push(safeNum(sel.hours) + ' ชม.');
          if (safeNum(sel.otHours) > 0) parts.push('OT ' + safeNum(sel.otHours) + ' ชม.');
          detail = parts.join(' + ') || '0 ชม.';
        }
        // fixed: แสดง raw wage (ไม่มี markup)
        // hourly: แสดง total wage (รวม markup หรือไม่บวกถ้าเป็นหัวหน้างาน)
        let displayWage;
        if (sel.wageType === 'fixed') {
          displayWage = rawWage;
        } else {
          displayWage = calcTotalWage(rawWage, isSuper);
        }
        return `
          <div class="flex justify-between">
            <span>${Utils.escapeHtml(w.FullName)} <span style="font-size:0.75rem;color:var(--ink-soft)">(${detail})</span></span>
            <span class="font-mono">฿${Utils.money(displayWage)}</span>
          </div>
        `;
      }).join('');
    }

    let totalRaw = 0;
    let totalNormal = 0;
    let totalFixed = 0;

    entries.forEach(sel => {
      const w = sel.worker;
      if (!w) return;
      const isSuper = isSupervisorWorker(w);
      const rawWage = calcRawWage(w, sel);
      totalRaw += rawWage;
      if (sel.wageType === 'fixed') {
        totalFixed += rawWage; // fixed = no +20%
      } else {
        totalNormal += calcTotalWage(rawWage, isSuper); // with +20% (except supervisor)
      }
    });

    document.getElementById('sum-count').textContent = entries.length + ' คน';
    document.getElementById('sum-raw').textContent = '฿' + Utils.money(totalRaw);
    document.getElementById('sum-normal').textContent = '฿' + Utils.money(totalNormal);
    document.getElementById('sum-fixed').textContent = '฿' + Utils.money(totalFixed);
    document.getElementById('sum-total').textContent = '฿' + Utils.money(totalNormal + totalFixed);
  }

  // ─── Task Integration ──────────────────────────────────────
  function populateTaskDropdown(selectedId = null) {
    const taskSelect = document.getElementById('f-task');
    if (!taskSelect) return;
    const currentVal = selectedId != null ? String(selectedId) : taskSelect.value;

    let html = '<option value="">-- งานทั่วไป / ไม่ระบุใบสั่งงาน --</option>';
    availableTasks.forEach(task => {
      const code = task.task_code || `TSK-${task.id}`;
      const title = task.title || '';
      const site = task.site || 'ไม่ระบุไซต์';
      const pct = task.progress_percent ?? 0;
      const isCompleted = task.status === 'Completed' ? ' (เสร็จสิ้นแล้ว)' : '';
      const label = `[${code}] ${title} (${site} - คืบหน้า ${pct}%)${isCompleted}`;
      const isSelected = String(task.id) === String(currentVal) ? 'selected' : '';
      html += `<option value="${task.id}" ${isSelected}>${Utils.escapeHtml(label)}</option>`;
    });
    taskSelect.innerHTML = html;
    if (currentVal) {
      taskSelect.value = currentVal;
    }
  }

  async function loadTasks(selectedTaskId = null) {
    try {
      availableTasks = await Api.getTasks({ status: 'Active' });
      if (selectedTaskId) {
        const found = availableTasks.some(t => String(t.id) === String(selectedTaskId));
        if (!found) {
          const task = await Api.getTaskById(selectedTaskId);
          if (task) {
            availableTasks.push(task);
          }
        }
      }
      populateTaskDropdown(selectedTaskId);
    } catch (err) {
      console.warn('โหลดใบสั่งงานไม่สำเร็จ:', err);
    }
  }

  function getSelectedTaskObj() {
    const taskSelect = document.getElementById('f-task');
    if (!taskSelect || !taskSelect.value) return null;
    return availableTasks.find(t => String(t.id) === String(taskSelect.value)) || null;
  }

  function initSubItemsStateForTask(task) {
    const rawItems = Array.isArray(task?.sub_items) ? task.sub_items : [];
    logSubItemsState = rawItems.map(it => ({
      id: it.id,
      name: it.name || '',
      base_actual_qty: Number(it.actual_qty) || 0,
      base_progress_percent: Number(it.progress_percent) || 0,
      base_status: it.status || 'Pending',
      base_issue_note: it.issue_note || '',
      added_qty: 0,
      target_qty: it.target_qty != null && Number(it.target_qty) > 0 ? Number(it.target_qty) : null,
      unit: it.unit || '',
      status: it.status || 'Pending',
      progress_percent: Number(it.progress_percent) || 0,
      issue_note: it.issue_note || ''
    }));
    newLogSubItemsState = [];
  }

  function buildAutoDetailText(task) {
    if (!task) return '';
    let header = task.title || '';
    if (task.location_detail) {
      header += ` (${task.location_detail})`;
    } else if (task.description) {
      header += ` - ${task.description}`;
    }

    const activeLines = [];
    logSubItemsState.forEach((it) => {
      const added = Number(it.added_qty) || 0;
      const currPct = Number(it.progress_percent) || 0;
      const basePct = Number(it.base_progress_percent) || 0;
      const baseStatus = it.base_status || 'Pending';
      const baseIssue = it.base_issue_note || '';
      const hasChanged =
        added > 0 ||
        currPct !== basePct ||
        it.status !== baseStatus ||
        (it.status === 'Blocked' && String(it.issue_note || '') !== String(baseIssue));

      if (!hasChanged) return;

      const totalActual = Math.round(((Number(it.base_actual_qty) || 0) + added) * 100) / 100;
      const unitStr = it.unit ? ` ${it.unit}` : '';
      const cleanName = String(it.name || '').replace(/\s+/g, ' ').trim();
      const pctSuffix = `คืบหน้า ${currPct}%(เดิม ${basePct}%)`;

      if (it.status === 'Cancelled') {
        activeLines.push(`- ${cleanName}: ยกเลิกรายการ (${pctSuffix})`);
      } else if (it.status === 'Blocked') {
        const issueTxt = it.issue_note ? ` (${it.issue_note})` : '';
        activeLines.push(`- ${cleanName}: ติดปัญหา${issueTxt} ${pctSuffix}`);
      } else if (added > 0) {
        const targetStr = it.target_qty ? `/${it.target_qty}` : '';
        activeLines.push(`- ${cleanName}: ทำได้ ${added}${unitStr} (สะสม ${totalActual}${targetStr}${unitStr}) ${pctSuffix}`);
      } else {
        activeLines.push(`- ${cleanName} ${pctSuffix}`);
      }
    });

    newLogSubItemsState.forEach((it) => {
      const name = String(it.name || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      const desc = String(it.description || '').replace(/\s+/g, ' ').trim();
      const added = Number(it.added_qty) || 0;
      const currPct = it.status === 'Completed' ? 100 : (Number(it.progress_percent) || 50);
      const unitStr = it.unit ? ` ${it.unit}` : '';
      const pctSuffix = `คืบหน้า ${currPct}%(เดิม 0%)`;
      const descStr = desc ? ` - ${desc}` : '';
      if (added > 0) {
        activeLines.push(`- (งานเพิ่มหน้างาน) ${name}${descStr}: ทำได้ ${added}${unitStr} ${pctSuffix}`);
      } else {
        activeLines.push(`- (งานเพิ่มหน้างาน) ${name}${descStr} (${pctSuffix})`);
      }
    });

    if (activeLines.length > 0) {
      return activeLines.join('\n');
    }
    return header;
  }

  function recalculateAndAutoFillFromSubItems(task) {
    const allCombined = [
      ...logSubItemsState.map(it => {
        const totalActual = Math.round(((Number(it.base_actual_qty) || 0) + (Number(it.added_qty) || 0)) * 100) / 100;
        let pct = Number(it.progress_percent) || 0;
        let status = it.status || 'Pending';
        if (status === 'Completed') {
          pct = 100;
        } else if (status === 'Cancelled') {
          pct = 0;
        } else if (it.target_qty && it.target_qty > 0) {
          pct = Math.min(100, Math.round((totalActual / it.target_qty) * 100));
          if (pct >= 100 && status !== 'Blocked') status = 'Completed';
          else if (totalActual > 0 && status === 'Pending') status = 'In Progress';
        } else if ((Number(it.added_qty) || 0) > 0 && status === 'Pending') {
          status = 'In Progress';
        }
        return { ...it, actual_qty: totalActual, progress_percent: pct, status };
      }),
      ...newLogSubItemsState
        .filter(it => String(it.name || '').trim() !== '')
        .map(it => ({
          ...it,
          actual_qty: Number(it.added_qty) || 0,
          progress_percent: it.status === 'Completed' ? 100 : (Number(it.progress_percent) || 50)
        }))
    ];

    if (allCombined.length > 0) {
      const active = allCombined.filter(i => i.status !== 'Cancelled');
      const overallPct = active.length > 0
        ? Math.max(0, Math.min(100, Math.round(active.reduce((s, i) => s + (Number(i.progress_percent) || 0), 0) / active.length)))
        : 0;

      const progressInput = document.getElementById('f-task-progress');
      if (progressInput) {
        progressInput.value = String(overallPct);
      }

      const blockedNotes = active
        .filter(i => i.status === 'Blocked' || (i.issue_note && i.issue_note.trim() !== ''))
        .map(i => i.issue_note ? `${i.name}: ${i.issue_note}` : `${i.name}: ติดปัญหา`);

      const issuesInput = document.getElementById('f-task-issues');
      if (issuesInput && blockedNotes.length > 0) {
        issuesInput.value = blockedNotes.join(' | ');
      }
    }

    // อัปเดตช่องรายละเอียดงาน (#f-detail) อัตโนมัติเมื่อมีการลงปริมาณหรือเปลี่ยนสถานะรายการย่อย
    const detailInput = document.getElementById('f-detail');
    if (detailInput && task) {
      const nextDetail = buildAutoDetailText(task);
      if (!detailInput.value.trim() || detailInput.value === lastAutoFilledDetail) {
        detailInput.value = nextDetail;
        lastAutoFilledDetail = nextDetail;
      }
    }
  }

  function renderTaskSubItemsForLog(task) {
    const listEl = document.getElementById('task-subitems-log-list');
    const newListEl = document.getElementById('task-new-subitems-log-list');
    if (!listEl || !newListEl) return;

    if (!logSubItemsState.length) {
      listEl.innerHTML = `
        <div class="text-xs text-slate-500 bg-white/80 p-2.5 rounded border border-dashed border-slate-300">
          ใบสั่งงานนี้ยังไม่ได้แยกรายการย่อยไว้ — สามารถกรอก % ความคืบหน้ารวมด้านล่าง หรือกดปุ่ม <strong>"➕ เพิ่มรายการย่อยหน้างาน"</strong> เพื่อบันทึกปริมาณงานที่ทำจริงวันนี้ได้ทันที
        </div>
      `;
    } else {
      listEl.innerHTML = logSubItemsState.map((it, idx) => {
        const isCompleted = it.status === 'Completed';
        const isBlocked = it.status === 'Blocked';
        const isCancelled = it.status === 'Cancelled';
        const isInProgress = it.status === 'In Progress';
        const unitStr = it.unit ? Utils.escapeHtml(it.unit) : 'หน่วย';
        const hasTarget = it.target_qty != null && it.target_qty > 0;
        const totalAfterToday = Math.round(((Number(it.base_actual_qty) || 0) + (Number(it.added_qty) || 0)) * 100) / 100;

        return `
          <div class="p-3 bg-white rounded-lg border ${isBlocked ? 'border-red-300 bg-red-50/30' : (isCompleted ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200')} space-y-2">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div class="text-xs font-semibold text-slate-800 ${isCancelled ? 'line-through opacity-50' : ''}">
                ${idx + 1}. ${Utils.escapeHtml(it.name)}
                <span class="font-mono font-normal text-slate-500 ml-1">
                  (สะสมเดิม: ${it.base_actual_qty}${hasTarget ? '/' + it.target_qty : ''} ${unitStr} → รวมวันนี้: <strong>${totalAfterToday}</strong> ${unitStr})
                </span>
              </div>
              <!-- ปุ่มกดเปลี่ยนสถานะรายการย่อยในคลิกเดียว -->
              <div class="flex flex-wrap gap-1">
                <button type="button" data-sub-status-idx="${idx}" data-status-val="In Progress"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isInProgress ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}">
                  🔨 กำลังทำ
                </button>
                <button type="button" data-sub-status-idx="${idx}" data-status-val="Completed"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isCompleted ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'}">
                  ✓ เสร็จรายการนี้
                </button>
                <button type="button" data-sub-status-idx="${idx}" data-status-val="Blocked"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isBlocked ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-300 hover:bg-red-50'}">
                  ⚠️ ติดปัญหา
                </button>
                <button type="button" data-sub-status-idx="${idx}" data-status-val="Cancelled"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isCancelled ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100'}">
                  ✕ ยกเลิก
                </button>
              </div>
            </div>

            ${!isCancelled ? `
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 items-end">
                <div class="sm:col-span-2">
                  <details class="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200">
                    <summary class="cursor-pointer font-medium text-slate-700 hover:text-sky-700 select-none">
                      📏 ระบุจำนวน/หน่วย (ตัวเลือกเสริม ถ้ามีวัดเป็นตัวเลข)
                    </summary>
                    <div class="grid grid-cols-2 gap-2 pt-2 mt-1 border-t border-slate-200">
                      <div>
                        <label class="text-[11px] text-slate-500 block mb-0.5">ทำได้วันนี้ (+ ${unitStr})</label>
                        <input type="number" step="any" min="0" data-sub-added-idx="${idx}"
                          class="field-input text-xs py-1" placeholder="เช่น 5 ${unitStr}"
                          value="${it.added_qty > 0 ? it.added_qty : ''}">
                      </div>
                      <div>
                        <label class="text-[11px] text-slate-500 block mb-0.5">เป้าหมายรวม (${unitStr})</label>
                        <input type="number" step="any" min="0" data-sub-target-idx="${idx}"
                          class="field-input text-xs py-1" placeholder="เว้นว่าง = นับตามจริง"
                          value="${hasTarget ? it.target_qty : ''}">
                      </div>
                    </div>
                  </details>
                </div>
                <div>
                  <label class="text-[11px] font-semibold text-slate-700 block mb-0.5">ความคืบหน้ารายการนี้ (%)</label>
                  <div class="relative">
                    <input type="number" min="0" max="100" data-sub-pct-idx="${idx}"
                      class="field-input text-xs py-1.5 font-bold text-sky-800 w-full pr-7" placeholder="0-100"
                      value="${it.progress_percent || 0}">
                    <span class="absolute right-2 top-1.5 text-xs text-slate-400 font-bold pointer-events-none">%</span>
                  </div>
                </div>
              </div>
            ` : ''}

            ${isBlocked ? `
              <div class="pt-1">
                <input type="text" data-sub-issue-idx="${idx}"
                  class="field-input text-xs py-1 border-red-300 bg-white w-full"
                  placeholder="⚠️ ระบุปัญหาของรายการนี้ เช่น วัสดุยังไม่มา, ติดแนวท่อเดิม..."
                  value="${Utils.escapeHtml(it.issue_note || '')}">
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    // รายการย่อยที่เพิ่มใหม่หน้างาน (งานงอก/งานพ่วง)
    if (!newLogSubItemsState.length) {
      newListEl.innerHTML = '';
    } else {
      newListEl.innerHTML = newLogSubItemsState.map((nit, nidx) => {
        const isCompleted = nit.status === 'Completed' || Number(nit.progress_percent) === 100;
        const isInProgress = !isCompleted;

        return `
        <div class="p-3 bg-blue-50/50 rounded-lg border border-blue-200 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-blue-900">➕ รายการเพิ่มหน้างาน #${nidx + 1}</span>
              <div class="flex gap-1">
                <button type="button" data-new-sub-status-btn="${nidx}" data-val="In Progress"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isInProgress ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}">
                  🔨 กำลังทำ
                </button>
                <button type="button" data-new-sub-status-btn="${nidx}" data-val="Completed"
                  class="px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${isCompleted ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'}">
                  ✓ เสร็จ 100%
                </button>
              </div>
            </div>
            <button type="button" data-remove-new-sub="${nidx}" class="text-xs text-red-600 hover:underline">🗑️ ลบรายการนี้</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div class="sm:col-span-6">
              <label class="text-[11px] font-semibold text-slate-700 block mb-0.5">ชื่อรายการที่ทำเพิ่ม</label>
              <input type="text" data-new-sub-name="${nidx}" class="field-input text-xs py-1.5 w-full"
                placeholder="เช่น สกัดพื้นคอนกรีต, วางบ่อพักเพิ่ม" value="${Utils.escapeHtml(nit.name || '')}">
            </div>
            <div class="sm:col-span-4">
              <label class="text-[11px] text-slate-600 block mb-0.5">อธิบายสิ่งที่ทำวันนี้</label>
              <input type="text" data-new-sub-desc="${nidx}" class="field-input text-xs py-1.5 w-full"
                placeholder="เช่น สกัดไปได้ครึ่งทาง, ขุดหลุมเตรียมวาง" value="${Utils.escapeHtml(nit.description || '')}">
            </div>
            <div class="sm:col-span-2">
              <label class="text-[11px] font-semibold text-slate-700 block mb-0.5">% งานที่ทำได้</label>
              <div class="relative">
                <input type="number" min="0" max="100" data-new-sub-pct="${nidx}" class="field-input text-xs py-1.5 font-bold text-sky-800 w-full pr-6"
                  placeholder="0-100" value="${nit.progress_percent != null ? nit.progress_percent : 50}">
                <span class="absolute right-2 top-1.5 text-xs text-slate-400 font-bold pointer-events-none">%</span>
              </div>
            </div>
          </div>

          <details class="text-[11px] text-slate-500 bg-white/70 p-1.5 rounded border border-blue-100">
            <summary class="cursor-pointer text-slate-600 hover:text-sky-700 select-none">
              📏 ระบุปริมาณ/หน่วย (ตัวเลือกเสริม ถ้าต้องการวัดความยาวหรือจำนวน)
            </summary>
            <div class="grid grid-cols-2 gap-2 pt-1.5 mt-1 border-t border-blue-100">
              <div>
                <input type="number" step="any" min="0" data-new-sub-qty="${nidx}" class="field-input text-xs py-1 w-full"
                  placeholder="ทำได้วันนี้ (เช่น 5)" value="${nit.added_qty > 0 ? nit.added_qty : ''}">
              </div>
              <div>
                <input type="text" data-new-sub-unit="${nidx}" class="field-input text-xs py-1 w-full"
                  placeholder="หน่วย (เช่น เมตร, จุด, บ่อ)" value="${Utils.escapeHtml(nit.unit || '')}">
              </div>
            </div>
          </details>
        </div>
      `;
      }).join('');
    }

    // ผูก Event Listeners สำหรับรายการย่อยเดิม
    listEl.querySelectorAll('[data-sub-status-idx]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-sub-status-idx'));
        const statusVal = btn.getAttribute('data-status-val');
        const item = logSubItemsState[idx];
        if (!item) return;
        item.status = statusVal;
        if (statusVal === 'Completed') {
          item.progress_percent = 100;
          if (item.target_qty && item.target_qty > item.base_actual_qty && !item.added_qty) {
            item.added_qty = Math.max(0, Math.round((item.target_qty - item.base_actual_qty) * 100) / 100);
          }
        } else if (statusVal === 'Cancelled') {
          item.progress_percent = 0;
          item.added_qty = 0;
        }
        renderTaskSubItemsForLog(task);
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    listEl.querySelectorAll('[data-sub-added-idx]').forEach(inp => {
      inp.oninput = () => {
        const idx = Number(inp.getAttribute('data-sub-added-idx'));
        const item = logSubItemsState[idx];
        if (!item) return;
        item.added_qty = Math.max(0, Number(inp.value) || 0);
        const totalActual = (Number(item.base_actual_qty) || 0) + item.added_qty;
        if (item.target_qty && item.target_qty > 0) {
          item.progress_percent = Math.min(100, Math.round((totalActual / item.target_qty) * 100));
          if (item.progress_percent >= 100 && item.status !== 'Blocked') item.status = 'Completed';
          else if (item.added_qty > 0 && item.status === 'Pending') item.status = 'In Progress';
        } else if (item.added_qty > 0 && item.status === 'Pending') {
          item.status = 'In Progress';
        }
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    listEl.querySelectorAll('[data-sub-target-idx]').forEach(inp => {
      inp.oninput = () => {
        const idx = Number(inp.getAttribute('data-sub-target-idx'));
        const item = logSubItemsState[idx];
        if (!item) return;
        const v = Number(inp.value);
        item.target_qty = v > 0 ? v : null;
        if (item.target_qty) {
          const totalActual = (Number(item.base_actual_qty) || 0) + (Number(item.added_qty) || 0);
          item.progress_percent = Math.min(100, Math.round((totalActual / item.target_qty) * 100));
        }
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    listEl.querySelectorAll('[data-sub-pct-idx]').forEach(inp => {
      inp.oninput = () => {
        const idx = Number(inp.getAttribute('data-sub-pct-idx'));
        const item = logSubItemsState[idx];
        if (!item) return;
        item.progress_percent = Math.max(0, Math.min(100, Number(inp.value) || 0));
        if (item.progress_percent >= 100 && item.status !== 'Blocked') {
          item.status = 'Completed';
        } else if (item.progress_percent < 100 && item.status === 'Completed') {
          item.status = item.progress_percent > 0 ? 'In Progress' : 'Pending';
        } else if (item.progress_percent > 0 && item.status === 'Pending') {
          item.status = 'In Progress';
        }
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    listEl.querySelectorAll('[data-sub-issue-idx]').forEach(inp => {
      inp.oninput = () => {
        const idx = Number(inp.getAttribute('data-sub-issue-idx'));
        const item = logSubItemsState[idx];
        if (!item) return;
        item.issue_note = inp.value;
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    // ผูก Event Listeners สำหรับรายการย่อยที่เพิ่มใหม่หน้างาน
    newListEl.querySelectorAll('[data-remove-new-sub]').forEach(btn => {
      btn.onclick = () => {
        const nidx = Number(btn.getAttribute('data-remove-new-sub'));
        newLogSubItemsState.splice(nidx, 1);
        renderTaskSubItemsForLog(task);
        recalculateAndAutoFillFromSubItems(task);
      };
    });

    newListEl.querySelectorAll('[data-new-sub-status-btn]').forEach(btn => {
      btn.onclick = () => {
        const nidx = Number(btn.getAttribute('data-new-sub-status-btn'));
        const val = btn.getAttribute('data-val');
        if (newLogSubItemsState[nidx]) {
          newLogSubItemsState[nidx].status = val;
          if (val === 'Completed') {
            newLogSubItemsState[nidx].progress_percent = 100;
          } else {
            if (newLogSubItemsState[nidx].progress_percent === 100) {
              newLogSubItemsState[nidx].progress_percent = 50;
            }
          }
          renderTaskSubItemsForLog(task);
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });

    newListEl.querySelectorAll('[data-new-sub-name]').forEach(inp => {
      inp.oninput = () => {
        const nidx = Number(inp.getAttribute('data-new-sub-name'));
        if (newLogSubItemsState[nidx]) {
          newLogSubItemsState[nidx].name = inp.value;
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });

    newListEl.querySelectorAll('[data-new-sub-desc]').forEach(inp => {
      inp.oninput = () => {
        const nidx = Number(inp.getAttribute('data-new-sub-desc'));
        if (newLogSubItemsState[nidx]) {
          newLogSubItemsState[nidx].description = inp.value;
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });

    newListEl.querySelectorAll('[data-new-sub-pct]').forEach(inp => {
      inp.oninput = () => {
        const nidx = Number(inp.getAttribute('data-new-sub-pct'));
        if (newLogSubItemsState[nidx]) {
          const p = Math.max(0, Math.min(100, Number(inp.value) || 0));
          newLogSubItemsState[nidx].progress_percent = p;
          if (p >= 100) {
            newLogSubItemsState[nidx].status = 'Completed';
          } else {
            newLogSubItemsState[nidx].status = 'In Progress';
          }
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });

    newListEl.querySelectorAll('[data-new-sub-qty]').forEach(inp => {
      inp.oninput = () => {
        const nidx = Number(inp.getAttribute('data-new-sub-qty'));
        if (newLogSubItemsState[nidx]) {
          newLogSubItemsState[nidx].added_qty = Math.max(0, Number(inp.value) || 0);
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });

    newListEl.querySelectorAll('[data-new-sub-unit]').forEach(inp => {
      inp.oninput = () => {
        const nidx = Number(inp.getAttribute('data-new-sub-unit'));
        if (newLogSubItemsState[nidx]) {
          newLogSubItemsState[nidx].unit = inp.value;
          recalculateAndAutoFillFromSubItems(task);
        }
      };
    });
  }

  function onTaskChange() {
    const taskSelect = document.getElementById('f-task');
    const updateSection = document.getElementById('task-update-section');
    if (!taskSelect || !updateSection) return;

    const val = taskSelect.value;
    if (!val) {
      updateSection.style.display = 'none';
      updateSection.classList.add('hidden');
      logSubItemsState = [];
      newLogSubItemsState = [];
      return;
    }

    const task = availableTasks.find(t => String(t.id) === String(val));
    if (!task) return;

    updateSection.style.display = 'block';
    updateSection.classList.remove('hidden');

    const badge = document.getElementById('task-code-badge');
    if (badge) {
      badge.textContent = task.task_code || `TSK-${task.id}`;
    }

    initSubItemsStateForTask(task);
    renderTaskSubItemsForLog(task);

    // Auto-fill site
    const siteInput = document.getElementById('f-site');
    if (siteInput && task.site) {
      siteInput.value = task.site;
    }

    // Auto-fill detail
    const detailInput = document.getElementById('f-detail');
    if (detailInput) {
      const fullDetail = buildAutoDetailText(task);
      if (!detailInput.value.trim() || detailInput.value === lastAutoFilledDetail) {
        detailInput.value = fullDetail;
        lastAutoFilledDetail = fullDetail;
      }
    }

    // Auto-fill requester
    const reqInput = document.getElementById('f-requester');
    if (reqInput && task.ordered_by) {
      if (!reqInput.value.trim() || reqInput.value === lastAutoFilledRequester) {
        reqInput.value = task.ordered_by;
        lastAutoFilledRequester = task.ordered_by;
      }
    }

    // Set progress
    const progressInput = document.getElementById('f-task-progress');
    if (progressInput) {
      progressInput.value = task.progress_percent != null ? task.progress_percent : 0;
    }
  }

  // ─── Load Data ─────────────────────────────────────────────
  async function loadWorkers() {
    try {
      rawAllWorkers = await Api.getWorkers();
      // แสดงเฉพาะคนงานที่สถานะ ทำงานอยู่ (Active)
      allWorkers = sortWorkersByStandardOrder(rawAllWorkers.filter(w => w.Status === 'Active'));
      document.getElementById('worker-loading').textContent = '';
      await refreshDailyHoursSummary();
      renderWorkerList();
    } catch (err) {
      document.getElementById('worker-loading').textContent = '';
      document.getElementById('worker-list').appendChild(Utils.errorBanner(err.message, loadWorkers));
    }
  }

  async function loadHistory() {
    try {
      const [sites, requesters] = await Promise.all([
        Api.getSiteHistory(),
        Api.getRequesterHistory()
      ]);
      siteHistory = sites || [];
      requesterHistory = requesters || [];

      const siteDatalist = document.getElementById('site-list');
      siteDatalist.innerHTML = siteHistory.map(s => `<option value="${Utils.escapeHtml(s)}">`).join('');

      const reqDatalist = document.getElementById('requester-list');
      reqDatalist.innerHTML = requesterHistory.map(r => `<option value="${Utils.escapeHtml(r)}">`).join('');
    } catch (err) {
      // ไม่เป็นไร ถ้าโหลดประวัติไม่ได้
    }
  }

  async function loadEditGroup(groupId) {
    try {
      // 1. แสดงหน้าจอโหลด
      document.getElementById('loading-overlay').style.display = 'flex';

      const data = await Api.getLogGroup({ groupId });

      if (!data) {
        Utils.toast('ไม่พบข้อมูลใบงานที่ต้องการแก้ไข', 'error');
        return;
      }

      editGroupId = groupId;
      document.getElementById('f-date').value = Utils.toInputDate(data.date);
      await refreshDailyHoursSummary();
      document.getElementById('f-site').value = data.site || '';
      document.getElementById('f-detail').value = data.jobDetail || '';
      document.getElementById('f-requester').value = data.requestedBy || '';

      // Restore linked task if available
      const editTaskId = data.taskId != null ? data.taskId : (data.task_id != null ? data.task_id : null);
      if (editTaskId != null) {
        let task = availableTasks.find(t => String(t.id) === String(editTaskId));
        if (!task) {
          try {
            task = await Api.getTaskById(editTaskId);
            if (task) {
              availableTasks.push(task);
              populateTaskDropdown(editTaskId);
            }
          } catch (err) {
            console.warn('โหลดใบสั่งงานที่เชื่อมโยงไม่สำเร็จ:', err);
          }
        }
        const taskSelect = document.getElementById('f-task');
        if (taskSelect) {
          taskSelect.value = String(editTaskId);
        }
        const updateSection = document.getElementById('task-update-section');
        if (updateSection) {
          updateSection.style.display = 'block';
          updateSection.classList.remove('hidden');
        }
        const badge = document.getElementById('task-code-badge');
        if (badge && task) {
          badge.textContent = task.task_code || `TSK-${task.id}`;
        }
        if (task) {
          initSubItemsStateForTask(task);
          renderTaskSubItemsForLog(task);
        }
        const progressInput = document.getElementById('f-task-progress');
        if (progressInput && task) {
          progressInput.value = task.progress_percent != null ? task.progress_percent : 0;
        }
      }

      // Load images
      if (data.imageUrls && Array.isArray(data.imageUrls)) {
        compressedImages = data.imageUrls.filter(u => u).map(url => ({ type: 'url', data: url }));
        renderImagePreviews();
      }

      // Select workers and set their wage data
      if (data.workers && Array.isArray(data.workers)) {
        data.workers.forEach(w => {
          let worker = allWorkers.find(a => a.FullName === w.workerName);
          if (!worker && rawAllWorkers.length > 0) {
            // กรณีคนงานนี้ถูกพักงานไปแล้ว แต่เคยมีชื่อในใบงานเดิมนี้ ให้ดึงเข้ามาแสดงผลด้วย
            const inactiveWorker = rawAllWorkers.find(a => a.FullName === w.workerName);
            if (inactiveWorker) {
              allWorkers.push(inactiveWorker);
              allWorkers = sortWorkersByStandardOrder(allWorkers);
              worker = inactiveWorker;
            }
          }
          if (worker) {
            selectedWorkers.set(String(worker.ID), {
              worker,
              wageType: w.wageType || 'hourly',
              hours: safeNum(w.hours),
              otHours: safeNum(w.otHours),
              fixedAmount: safeNum(w.fixedAmount)
            });
          }
        });
        renderWorkerList();
        updateSummary();
      }

      // Change button text
      const submitBtn = document.getElementById('f-submit');
      submitBtn.innerHTML = '<span id="f-submit-label">บันทึกการแก้ไข</span>';

      // Add cancel button dynamically
      const form = document.getElementById('log-form');
      const btnContainer = form.querySelector('.flex.gap-2');
      if (btnContainer && !document.getElementById('f-cancel-edit')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'f-cancel-edit';
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.textContent = 'ยกเลิกแก้ไข';
        cancelBtn.addEventListener('click', () => {
          window.location.href = 'index.html';
        });
        btnContainer.appendChild(cancelBtn);
      }

      Utils.toast('โหลดข้อมูลใบงานเรียบร้อย', 'success');
    } catch (err) {
      Utils.toast('ไม่สามารถโหลดข้อมูลใบงาน: ' + err.message, 'error');
    } finally {
      // 2. ซ่อนหน้าจอโหลดเสมอ ไม่ว่าจะสำเร็จหรือล้มเหลว
      document.getElementById('loading-overlay').style.display = 'none';
    }
  }

  // ─── Animation ─────────────────────────────────────────────
  /**
   * Manages the loading text animation (e.g., "Loading...")
   * @param {boolean} start - True to start the animation, false to stop.
   */
  function manageLoadingAnimation(start = true) {
    const p = document.querySelector('#loading-overlay p');
    if (!p) return;

    // Clear any existing animation interval
    if (loadingAnimationInterval) {
      clearInterval(loadingAnimationInterval);
      loadingAnimationInterval = null;
    }

    const baseText = 'กำลังดึงรายการ รอสักครู่';
    p.textContent = baseText; // Reset text

    if (start) {
      let dots = 0;
      loadingAnimationInterval = setInterval(() => {
        dots = (dots + 1) % 4; // Cycle 0, 1, 2, 3
        p.textContent = baseText + '.'.repeat(dots);
      }, 400); // Update every 400ms
    }
  }

  // ─── Submit ────────────────────────────────────────────────
  async function onSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById('form-error');
    errorBox.innerHTML = '';

    if (selectedWorkers.size === 0) {
      errorBox.appendChild(Utils.errorBanner('กรุณาเลือกคนงานอย่างน้อย 1 คน'));
      return;
    }

    // Validate each worker has some wage data
    for (const [id, sel] of selectedWorkers) {
      if (sel.wageType === 'hourly' && safeNum(sel.hours) === 0 && safeNum(sel.otHours) === 0) {
        errorBox.appendChild(Utils.errorBanner(
          'กรุณาระบุชั่วโมงทำงานให้ ' + Utils.escapeHtml(sel.worker.FullName)
        ));
        return;
      }
      if (sel.wageType === 'fixed' && safeNum(sel.fixedAmount) <= 0) {
        errorBox.appendChild(Utils.errorBanner(
          'กรุณาระบุจำนวนเงินเหมาจ่ายให้ ' + Utils.escapeHtml(sel.worker.FullName)
        ));
        return;
      }
    }

    // ตรวจสอบชั่วโมงทำงานสะสมในวันเดียวกัน ป้องกันการลงเวลาปกติซ้ำซ้อนเกิน 8 ชม./วัน
    const overLimitWorkers = [];
    selectedWorkers.forEach(sel => {
      if (sel.wageType === 'hourly') {
        const dailyInfo = dailyWorkerHoursSummary[sel.worker.FullName];
        const already = dailyInfo ? (dailyInfo.regularHours || 0) : 0;
        const currentH = safeNum(sel.hours);
        if (already + currentH > 8) {
          overLimitWorkers.push({
            name: sel.worker.FullName,
            already,
            current: currentH,
            total: already + currentH,
            over: (already + currentH) - 8,
            suggested: Math.max(0, 8 - already)
          });
        }
      }
    });

    if (overLimitWorkers.length > 0) {
      const workerLines = overLimitWorkers.map(w => 
        `• ${w.name}: เดิม ${w.already} ชม. + ใบนี้ ${w.current} ชม. = รวม ${w.total} ชม. (เกิน ${w.over} ชม. -> แนะนำเวลาปกติ ${w.suggested} ชม. แล้วใส่ OT ${w.over} ชม.)`
      ).join('\n');
      const confirmMsg = `⚠️ ตรวจพบคนงานทำงานปกติเกิน 8 ชม. ในวันเดียวกัน:\n\n${workerLines}\n\nต้องการยืนยันบันทึกหรือไม่?\n(แนะนำให้กดยกเลิก แล้วลดเวลาปกติลงและใส่ส่วนเกินในช่อง OT แทน)`;
      if (!confirm(confirmMsg)) {
        return;
      }
    }

    const workersPayload = Array.from(selectedWorkers.values()).map(sel => ({
      workerName: sel.worker.FullName,
      dailyWage: safeNum(sel.worker.DailyWage),
      wageType: sel.wageType,
      hours: safeNum(sel.hours),
      otHours: safeNum(sel.otHours),
      fixedAmount: safeNum(sel.fixedAmount),
      role: sel.worker.Role || (isSupervisorWorker(sel.worker) ? 'Supervisor' : 'Worker')
    }));

    // Convert date from DD/MM/YYYY to YYYY-MM-DD for API
    const dateInput = document.getElementById('f-date').value;
    const dateMatch = dateInput.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const apiDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : dateInput;

    const taskSelect = document.getElementById('f-task');
    const selectedTaskId = (taskSelect && taskSelect.value) ? Number(taskSelect.value) : null;

    const detailEl = document.getElementById('f-detail');
    let finalJobDetail = detailEl ? detailEl.value.trim() : '';
    if (!finalJobDetail && selectedTaskId) {
      const selectedTaskObj = getSelectedTaskObj();
      if (selectedTaskObj) {
        finalJobDetail = buildAutoDetailText(selectedTaskObj);
        if (detailEl) detailEl.value = finalJobDetail;
      }
    }

    if (!finalJobDetail) {
      errorBox.appendChild(Utils.errorBanner('กรุณาระบุรายละเอียดงาน หรือเลือกใบสั่งงาน'));
      return;
    }

    const payload = {
      taskId: selectedTaskId,
      date: apiDate,
      site: document.getElementById('f-site').value.trim(),
      jobDetail: finalJobDetail,
      requestedBy: document.getElementById('f-requester').value.trim(),
      // ส่งเฉพาะ Base64 ไปให้ Backend อัปโหลด, ส่วน URL ส่งตรงๆ
      images: compressedImages.map(img => img.data),
      workers: workersPayload
    };

    if (editGroupId) {
      payload.groupId = editGroupId;
    }

    const submitBtn = document.getElementById('f-submit');

    try {
      const saveAction = async () => {
        const res = editGroupId ? await Api.updateLogGroup(payload) : await Api.addLogs(payload);
        if (selectedTaskId) {
          const progressVal = safeNum(document.getElementById('f-task-progress')?.value);
          const issuesVal = (document.getElementById('f-task-issues')?.value || '').trim();
          const resolutionVal = (document.getElementById('f-task-resolution')?.value || '').trim();

          const subItemsUpdates = logSubItemsState.length > 0
            ? logSubItemsState.map(it => ({
                id: it.id,
                name: it.name,
                added_qty: Number(it.added_qty) || 0,
                target_qty: it.target_qty,
                status: it.status,
                progress_percent: Number(it.progress_percent) || 0,
                issue_note: it.issue_note || ''
              }))
            : undefined;

          const validNewSubItems = newLogSubItemsState
            .filter(it => String(it.name || '').trim() !== '')
            .map(it => ({
              id: it.id,
              name: String(it.name).trim(),
              description: String(it.description || '').trim(),
              added_qty: Number(it.added_qty) || 0,
              actual_qty: Number(it.added_qty) || 0,
              target_qty: null,
              unit: String(it.unit || '').trim(),
              status: it.status || (Number(it.progress_percent) >= 100 ? 'Completed' : 'In Progress'),
              progress_percent: it.progress_percent != null ? Number(it.progress_percent) : 50,
              issue_note: it.issue_note || ''
            }));

          await Api.addTaskProgress(selectedTaskId, {
            groupId: (res && res.groupId) ? res.groupId : (editGroupId || undefined),
            percent: progressVal,
            issues: issuesVal,
            resolution: resolutionVal,
            by: payload.requestedBy || 'หน้างาน (Daily Log)',
            date: apiDate,
            sub_items_updates: subItemsUpdates,
            new_sub_items: validNewSubItems.length > 0 ? validNewSubItems : undefined
          });
        }
        return res;
      };
      const successMessage = editGroupId ? 'แก้ไขสำเร็จ!' : 'บันทึกสำเร็จ!';

      await Utils.animateProgress(submitBtn, saveAction(), 'กำลังบันทึก...', successMessage);

      if (editGroupId) {
        Utils.toast('แก้ไขใบงานสำเร็จ', 'success');
      } else {
        Utils.toast('บันทึกใบงานสำเร็จ', 'success');
      }

      // Redirect to dashboard after short delay
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
    } catch (err) {
      errorBox.innerHTML = '';
      errorBox.appendChild(Utils.errorBanner(err.message));
    }
  }

  // ─── Init ──────────────────────────────────────────────────
  async function initializePage() {
    // 1. Render the basic layout
    layout();
    updateSummary();

    // 2. Check for edit mode
    const urlParams = new URLSearchParams(window.location.search);
    const editParam = urlParams.get('edit');
    const taskIdParam = urlParams.get('taskId') || urlParams.get('task_id');

    if (editParam) {
      // In edit mode, show the full-page loader immediately
      document.getElementById('loading-overlay').style.display = 'flex';
      manageLoadingAnimation(true); // Start animation
      document.getElementById('worker-loading').style.display = 'none';
    }

    // 3. Load initial data (workers and history)
    // This will run in parallel
    await Promise.all([loadWorkers(), loadHistory(), loadTasks(taskIdParam)]);

    if (taskIdParam && !editParam) {
      const taskSelect = document.getElementById('f-task');
      if (taskSelect) {
        taskSelect.value = String(taskIdParam);
        onTaskChange();
      }
    }

    // 4. If in edit mode, now load the group data
    if (editParam) {
      await loadEditGroup(editParam); // The finally block in this function will hide the overlay
    }
  }

  initializePage();
})();