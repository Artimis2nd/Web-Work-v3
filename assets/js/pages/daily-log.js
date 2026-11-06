(() => {
  Utils.renderShell('daily-log.html', 'บันทึกงานประจำวัน');
  const content = document.getElementById('page-content');

  const MARKUP_RATE = 1.2;
  const MAX_IMAGES = 6;
  const HOURLY_RATE_DIVISOR = 8;
  const FERN_NAME = 'เฟิร์น';

  let allWorkers = [];
  let selectedWorkers = new Map(); // id -> { worker, wageType, hours, otHours, fixedAmount }
  // แต่ละ element: { type: 'url', data: 'https://...' } หรือ { type: 'base64', data: 'data:...' }
  let compressedImages = [];
  let editGroupId = null; // ถ้ามีค่า = กำลังแก้ไขใบงานนี้
  let datepicker = null; // Litepicker instance
  let siteHistory = [];
  let loadingAnimationInterval = null;
  let requesterHistory = [];

  // ─── Helper: safe number ─────────────────────────────
  function safeNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  // ─── Layout ────────────────────────────────────────────────
  function layout() {
    content.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <form id="log-form" class="ledger-card p-5 lg:col-span-2 space-y-4">
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
            <textarea id="f-detail" class="field-input" rows="6" required
                      placeholder="เช่น เทปูนพื้นชั้น 2, ผูกเหล็กเสา&#10;ระบุรายละเอียดเพิ่มเติม..."></textarea>
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
                คลิกเพื่อเลือกรูปภาพ หรือลากไฟล์มาวางที่นี่
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
        picker.on('selected', (date) => {
          // Litepicker sets the input value automatically in DD/MM/YYYY format
        });
      }
    });
    // Set default date to today
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    document.getElementById('f-date').value = `${dd}/${mm}/${yyyy}`;

    document.getElementById('log-form').addEventListener('submit', onSubmit);

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
      const isFern = w.FullName.includes(FERN_NAME);
      return `
        <div class="worker-item" data-id="${w.ID}">
          <label class="worker-check ${checked}" data-id="${w.ID}">
            <span>
              <span class="font-medium block">${Utils.escapeHtml(w.FullName)}</span>
              <span class="text-xs font-mono" style="color:var(--ink-soft)">฿${Utils.money(w.DailyWage)}/วัน</span>
              ${isFern ? '<span class="no-markup" style="color:var(--red);font-size:0.7rem;margin-left:0.5rem">(ไม่คิด +20%)</span>' : ''}
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
    `;
  }

  // ─── Worker Logic ──────────────────────────────────────────
  function toggleWorker(id) {
    const worker = allWorkers.find(w => String(w.ID) === id);
    if (!worker) return;

    if (selectedWorkers.has(id)) {
      selectedWorkers.delete(id);
    } else {
      selectedWorkers.set(id, {
        worker,
        wageType: 'hourly',
        hours: 8,
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

  function calcTotalWage(rawWage, isFern) {
    const rw = safeNum(rawWage);
    if (isFern) return rw;
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
        const isFern = w.FullName.includes(FERN_NAME);
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
        // hourly: แสดง total wage (รวม markup)
        let displayWage;
        if (sel.wageType === 'fixed') {
          displayWage = rawWage;
        } else {
          displayWage = calcTotalWage(rawWage, isFern);
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
      const isFern = w.FullName.includes(FERN_NAME);
      const rawWage = calcRawWage(w, sel);
      totalRaw += rawWage;
      if (sel.wageType === 'fixed') {
        totalFixed += rawWage; // fixed = no +20%
      } else {
        totalNormal += calcTotalWage(rawWage, isFern); // already with +20%
      }
    });

    document.getElementById('sum-count').textContent = entries.length + ' คน';
    document.getElementById('sum-raw').textContent = '฿' + Utils.money(totalRaw);
    document.getElementById('sum-normal').textContent = '฿' + Utils.money(totalNormal);
    document.getElementById('sum-fixed').textContent = '฿' + Utils.money(totalFixed);
    document.getElementById('sum-total').textContent = '฿' + Utils.money(totalNormal + totalFixed);
  }

  // ─── Load Data ─────────────────────────────────────────────
  async function loadWorkers() {
    try {
      allWorkers = (await Api.getWorkers()).filter(w => w.Status === 'Active');
      document.getElementById('worker-loading').textContent = '';
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
      document.getElementById('f-site').value = data.site || '';
      document.getElementById('f-detail').value = data.jobDetail || '';
      document.getElementById('f-requester').value = data.requestedBy || '';

      // Load images
      if (data.imageUrls && Array.isArray(data.imageUrls)) {
        compressedImages = data.imageUrls.filter(u => u).map(url => ({ type: 'url', data: url }));
        renderImagePreviews();
      }

      // Select workers and set their wage data
      if (data.workers && Array.isArray(data.workers)) {
        data.workers.forEach(w => {
          const worker = allWorkers.find(a => a.FullName === w.workerName);
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

    const workersPayload = Array.from(selectedWorkers.values()).map(sel => ({
      workerName: sel.worker.FullName,
      dailyWage: safeNum(sel.worker.DailyWage),
      wageType: sel.wageType,
      hours: safeNum(sel.hours),
      otHours: safeNum(sel.otHours),
      fixedAmount: safeNum(sel.fixedAmount)
    }));

    // Convert date from DD/MM/YYYY to YYYY-MM-DD for API
    const dateInput = document.getElementById('f-date').value;
    const dateMatch = dateInput.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const apiDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : dateInput;

    const payload = {
      date: apiDate,
      site: document.getElementById('f-site').value.trim(),
      jobDetail: document.getElementById('f-detail').value.trim(),
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
      const action = editGroupId ? Api.updateLogGroup(payload) : Api.addLogs(payload);
      const successMessage = editGroupId ? 'แก้ไขสำเร็จ!' : 'บันทึกสำเร็จ!';

      await Utils.animateProgress(submitBtn, action, 'กำลังบันทึก...', successMessage);

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

    if (editParam) {
      // In edit mode, show the full-page loader immediately
      document.getElementById('loading-overlay').style.display = 'flex';
      manageLoadingAnimation(true); // Start animation
      document.getElementById('worker-loading').style.display = 'none';
    }

    // 3. Load initial data (workers and history)
    // This will run in parallel
    await Promise.all([loadWorkers(), loadHistory()]);

    // 4. If in edit mode, now load the group data
    if (editParam) {
      await loadEditGroup(editParam); // The finally block in this function will hide the overlay
    }
  }

  initializePage();
})();