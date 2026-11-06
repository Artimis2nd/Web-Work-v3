(() => {
  Utils.renderShell('report.html', 'สรุปยอดค่าแรงรายบุคคล');
  const content = document.getElementById('page-content');

  let datepicker = null;

  function layout() {
    content.innerHTML = `
      <div class="ledger-card p-4 mb-6">
        <form id="filter-form" class="grid sm:grid-cols-4 gap-3 items-end">
          <div>
            <label class="field-label">ชื่อคนงาน</label>
            <select id="f-worker" class="field-input">
              <option value="">-- ทุกคน --</option>
            </select>
          </div>
          <div>
            <label class="field-label">ช่วงวันที่</label>
            <input type="text" id="f-daterange" class="field-input" placeholder="เลือกช่วงวันที่">
          </div>
          <div>
            <!-- Label ว่างเพื่อให้ปุ่มจัดตำแหน่งตรงกับ input อื่นๆ -->
            <label class="field-label">&nbsp;</label>
            <button type="submit" class="btn btn-primary w-full">กรองข้อมูล</button>
          </div>
        </form>
      </div>

      <div class="ledger-card p-4 mb-6">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-5 text-center">
          <div class="flex-1">
            <div class="kpi-label">ยอดค่าแรงดิบ</div>
            <div id="summary-raw" class="font-mono text-lg mt-1">-</div>
          </div>
          <div class="flex-1">
            <div class="kpi-label">เพิ่ม+20%</div>
            <div id="summary-markup" class="font-mono text-lg mt-1" style="color:var(--green)">-</div>
          </div>
          <div class="flex-1">
            <div class="kpi-label">ค่าแรงเหมา</div>
            <div id="summary-fixed" class="font-mono text-lg mt-1">-</div>
          </div>
          <div class="flex-1 border-b md:border-b-0 md:border-r border-dashed border-slate-200 pb-4 md:pb-0 md:pr-4">
            <div class="kpi-label">ค่าแรง OT</div>
            <div id="summary-ot" class="font-mono text-lg mt-1">-</div>
          </div>
          <div class="col-span-2 md:col-span-1">
            <div class="kpi-label">ยอดรวมทั้งหมด</div>
            <div id="report-grand-total" class="font-mono font-bold text-2xl mt-1" style="color:var(--blueprint-dark)">-</div>
          </div>
        </div>
      </div>

      <div class="ledger-card p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-display text-lg font-semibold">ตารางสรุปค่าแรง</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="tape-table">
            <thead>
              <tr><th>ชื่อคนงาน</th><th>วันที่มาทำงานรวม</th><th>ยอดค่าแรงรวมดิบ</th><th>เพิ่ม+20%</th><th>ค่าแรงเหมา</th><th>ค่าแรง OT</th><th>รวมค่าแรงทั้งหมด</th></tr>
            </thead>
            <tbody id="rows"><tr><td colspan="6" class="text-center py-6" style="color:var(--ink-soft)">กรุณาเลือกเงื่อนไขและกด 'กรองข้อมูล' เพื่อแสดงรายงาน</td></tr></tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('filter-form').addEventListener('submit', (e) => {
      e.preventDefault();
      load();
    });

    // Initialize Litepicker
    datepicker = new Litepicker({
      element: document.getElementById('f-daterange'),
      singleMode: false,
      format: 'DD/MM/YYYY',
      lang: 'th-TH',
      autoApply: true // ทำให้ปฏิทินปิดเองเมื่อเลือกวันที่เสร็จ
    });
  }

  async function loadWorkerOptions() {
    try {
      const workers = await Api.getWorkers();
      const select = document.getElementById('f-worker');
      workers.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.FullName;
        opt.textContent = w.FullName;
        select.appendChild(opt);
      });
    } catch (err) {
      Utils.toast('โหลดรายชื่อคนงานไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  /**
   * Processes raw log data and groups it by worker for the new report format.
   * @param {Array<Object>} logs - The raw log data from the API.
   * @returns {Array<Object>} An array of aggregated worker report objects.
   */
  function processReportData(logs) {
    const workerData = new Map();

    for (const log of logs) {
      if (!workerData.has(log.WorkerName)) {
        workerData.set(log.WorkerName, {
          workerName: log.WorkerName,
          dailyWage: 0, // Initialize with 0, will find the correct one later
          fullDays: 0,
          partialHours: 0,
          otHours: 0,
          fixedDays: 0,
          totalRawWage: 0,
          totalMarkup: 0,
          totalFixedWage: 0,
          totalOtWage: 0,
        });
      }

      const data = workerData.get(log.WorkerName);
      data.totalRawWage += log.RawWage;
      data.totalMarkup += (log.TotalWithMarkup - log.RawWage);

      if (log.WageType === 'fixed') {
        data.fixedDays += 1;
        data.totalFixedWage += log.FixedAmount;
      } else { // hourly
        if (log.Hours === 8) {
          data.fullDays += 1;
        } else {
          data.partialHours += log.Hours;
        }

        if (log.OTHours > 0) {
          data.otHours += log.OTHours;
          // คำนวณค่าแรง OT จาก RawWage เพื่อความแม่นยำและหลีกเลี่ยงการหารด้วยศูนย์
          const totalHoursEquivalent = log.Hours + (log.OTHours * 2);
          if (totalHoursEquivalent > 0) {
            data.totalOtWage += (log.RawWage / totalHoursEquivalent) * (log.OTHours * 2);
          }
        }
      }
    }

    // Second pass to ensure the correct dailyWage is populated for everyone
    for (const log of logs) {
      const data = workerData.get(log.WorkerName);
      if (data && data.dailyWage === 0 && log.DailyWage > 0) {
        data.dailyWage = log.DailyWage;
      }
    }

    return Array.from(workerData.values());
  }

  function renderRow(workerReport) {
    const {
      workerName, dailyWage, fullDays, partialHours, otHours, fixedDays,
      totalRawWage, totalMarkup, totalFixedWage, totalOtWage
    } = workerReport;

    // Format "วันที่มาทำงานรวม"
    const workParts = [];
    if (fullDays > 0) workParts.push(`${fullDays} วัน`);
    if (fixedDays > 0) workParts.push(`เหมา ${fixedDays} วัน`);
    if (partialHours > 0) workParts.push(`${partialHours} ชม.`);
    if (otHours > 0) workParts.push(`OT ${otHours} ชม.`);
    const workSummary = workParts.length > 0 ? workParts.join(' - ') : '0 วัน';

    const grandTotal = totalRawWage + totalMarkup;

    // ฟังก์ชันสำหรับจัดรูปแบบตัวเลขตามเงื่อนไข
    const formatConditionalMoney = (num) => {
      if (Number.isInteger(num)) {
        return num.toLocaleString('en-US');
      }
      return Utils.money(num);
    };

    return `
      <tr>
        <td class="text-center">${Utils.escapeHtml(workerName)}</td>
        <td class="text-center">${workSummary}</td>
        <td class="font-mono text-center">${formatConditionalMoney(totalRawWage)}</td>
        <td class="font-mono text-center" style="color:var(--green)">${formatConditionalMoney(totalMarkup)}</td>
        <td class="font-mono text-center">${formatConditionalMoney(totalFixedWage)}</td>
        <td class="font-mono text-center">${formatConditionalMoney(totalOtWage)}</td>
        <td class="font-mono font-semibold text-center" style="color:var(--blueprint-dark)">${formatConditionalMoney(grandTotal)}</td>
      </tr>
    `;
  }

  function parseDaterangeValue(value) {
    if (!value) return { startDate: null, endDate: null };
    // Value format from Litepicker: "DD/MM/YYYY - DD/MM/YYYY"
    const parts = value.split(' - ').map(s => s.trim());
    if (parts.length !== 2) return { startDate: null, endDate: null };

    const parseDDMMYYYY = (str) => {
      const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1; // JS month 0-based
      const y = parseInt(m[3], 10);
      return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };

    return {
      startDate: parseDDMMYYYY(parts[0]),
      endDate: parseDDMMYYYY(parts[1])
    };
  }

  async function load() {
    const tbody = document.getElementById('rows');
    tbody.innerHTML = Utils.skeletonRows(6, 7);

    // Parse date range from input field directly instead of relying on Litepicker methods
    const daterangeInput = document.getElementById('f-daterange');
    const { startDate, endDate } = parseDaterangeValue(daterangeInput ? daterangeInput.value : '');

    const payload = {
      workerName: document.getElementById('f-worker').value || null,
      startDate,
      endDate
    };

    try {
      const data = await Api.getReport(payload);

      if (data.logs.length > 0) {
        const processedData = processReportData(data.logs);
        
        // Calculate all totals
        const totalRaw = processedData.reduce((sum, w) => sum + w.totalRawWage, 0);
        const totalMarkup = processedData.reduce((sum, w) => sum + w.totalMarkup, 0);
        const totalFixed = processedData.reduce((sum, w) => sum + w.totalFixedWage, 0);
        const totalOt = processedData.reduce((sum, w) => sum + w.totalOtWage, 0);
        const grandTotal = totalRaw + totalMarkup;

        // Update UI
        document.getElementById('report-grand-total').textContent = '฿' + Utils.money(grandTotal);
        document.getElementById('summary-raw').textContent = '฿' + Utils.money(totalRaw);
        document.getElementById('summary-markup').textContent = '฿' + Utils.money(totalMarkup);
        document.getElementById('summary-fixed').textContent = '฿' + Utils.money(totalFixed);
        document.getElementById('summary-ot').textContent = '฿' + Utils.money(totalOt);

        tbody.innerHTML = processedData.map(renderRow).join('');
      } else {
        document.getElementById('report-grand-total').textContent = '฿0.00';
        document.getElementById('summary-raw').textContent = '฿0.00';
        document.getElementById('summary-markup').textContent = '฿0.00';
        document.getElementById('summary-fixed').textContent = '฿0.00';
        document.getElementById('summary-ot').textContent = '฿0.00';
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6" style="color:var(--ink-soft)">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.appendChild(Utils.errorBanner(err.message, load));
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  async function initializePage() {
    layout();
    // โหลดเฉพาะรายชื่อคนงานมาใส่ใน dropdown
    await loadWorkerOptions();
  }
  initializePage();
})();
