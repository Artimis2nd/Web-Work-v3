(() => {
  Utils.renderShell('pivot-report.html', 'รายงานสรุปค่าแรงรายวัน / ไซต์งาน');
  const content = document.getElementById('page-content');

  let picker;
  let siteHistory = [];

  function layout() {
    content.innerHTML = `
      <div class="ledger-card p-4 mb-4">
        <div class="flex flex-wrap gap-3 items-end">
            <div>
                <label class="field-label">เลือกช่วงวันที่</label>
                <input type="text" id="date-range" class="field-input" placeholder="เลือกวันที่...">
            </div>
            <div>
                <label class="field-label">ไซต์งาน / โครงการ</label>
                <select id="f-site" class="field-input">
                    <option value="">-- ทุกไซต์งาน --</option>
                </select>
            </div>
            <div>
                <button id="run-report-btn" class="btn btn-primary w-full">สร้างรายงาน</button>
            </div>
            <div>
                <button id="print-report-btn" class="btn btn-outline w-full" hidden>
                  <span class="mr-1">&#128424;</span> พิมพ์งาน
                </button>
            </div>
        </div>
      </div>

      <div id="printable-area">
        <div class="ledger-card p-4">
          <h2 id="report-title" class="text-lg font-semibold mb-4">สรุปค่าแรงรายวัน</h2>
          <div class="overflow-x-auto">
            <table class="tape-table" style="min-width: 1200px;">
              <thead>
                <tr id="table-head"></tr>
              </thead>
              <tbody id="rows">
                <tr><td colspan="5" class="text-center py-6" style="color:var(--ink-soft)">กรุณากด 'สร้างรายงาน' เพื่อดูข้อมูล</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div id="summary-card-container" class="mt-6"></div>
      </div>
    `;

    picker = new Litepicker({
      element: document.getElementById('date-range'),
      singleMode: false,
      format: 'DD/MM/YYYY',
      lang: 'th-TH',
      autoApply: true,
    });

    document.getElementById('run-report-btn').addEventListener('click', () => {
        load();
    });

    document.getElementById('print-report-btn').addEventListener('click', () => {
        window.print();
    });
  }

  async function loadSiteHistory() {
    try {
      const sites = await Api.getSiteHistory();
      siteHistory = sites || [];
      const select = document.getElementById('f-site');
      siteHistory.forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        select.appendChild(opt);
      });
    } catch (err) {
      Utils.toast('โหลดรายชื่อไซต์งานไม่สำเร็จ', 'error');
    }
  }

  function parseDaterangeValue(value) {
    if (!value) return { startDate: null, endDate: null };
    const parts = value.split(' - ').map(s => s.trim());
    if (parts.length !== 2) return { startDate: null, endDate: null };

    const parseDDMMYYYY = (str) => {
      const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };

    return {
      startDate: parseDDMMYYYY(parts[0]),
      endDate: parseDDMMYYYY(parts[1])
    };
  }

  async function load() {
    const daterangeInput = document.getElementById('date-range');
    const { startDate: startDateStr, endDate: endDateStr } = parseDaterangeValue(daterangeInput ? daterangeInput.value : '');

    if (!startDateStr || !endDateStr) {
      Utils.toast('กรุณาเลือกช่วงวันที่ให้ครบ', 'error');
      return;
    }

    const selectedSite = document.getElementById('f-site').value;

    const reportTitle = document.getElementById('report-title');
    let titleText = `ค่าแรงรายวันประจำ วันที่ ${startDateStr.split('-').reverse().join('/')} - วันที่ ${endDateStr.split('-').reverse().join('/')}`;
    if (selectedSite) {
      titleText += ` | โครงการ: ${selectedSite}`;
    }
    reportTitle.textContent = titleText;

    const tableHead = document.getElementById('table-head');

    const tbody = document.getElementById('rows');
    const printBtn = document.getElementById('print-report-btn');
    const summaryContainer = document.getElementById('summary-card-container');
    tableHead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="5">${Utils.skeletonRows(8, 5)}</td></tr>`;
    summaryContainer.innerHTML = ''; // Clear previous summary
    printBtn.hidden = true; // Hide print button while loading

    const payload = {
      startDate: startDateStr,
      endDate: endDateStr
    };

    try {
      const data = await Api.getLogs(payload);
      let logs = data.logs || [];

      // Filter by selected site if specified
      if (selectedSite) {
        logs = logs.filter(log => log.Site === selectedSite);
      }

      // Sort logs by date descending. Handle cases where date might be a string or an object.
      logs.sort((a, b) => {
        // Convert date to a consistent YYYY-MM-DD string format for reliable sorting
        const dateA = a.Date ? new Date(a.Date).toISOString().split('T')[0] : '';
        const dateB = b.Date ? new Date(b.Date).toISOString().split('T')[0] : '';
        return dateB.localeCompare(dateA);
      });

      if (!logs.length) {
        tableHead.innerHTML = `<th>ผลลัพธ์</th>`;
        tbody.innerHTML = `<tr><td class="text-center py-6" style="color:var(--ink-soft)">${selectedSite ? 'ไม่พบข้อมูลสำหรับโครงการที่เลือก' : 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก'}</td></tr>`;
        printBtn.hidden = true;
        summaryContainer.innerHTML = '';
        return;
      }

      // 1. Collect all unique workers for dynamic columns
      const workerHeaders = new Set();
      logs.forEach(log => {
        log.Workers.forEach(w => {
          workerHeaders.add(`${Utils.escapeHtml(w.WorkerName)}<br>(${w.DailyWage})`);
        });
      });
      const sortedWorkerHeaders = Array.from(workerHeaders).sort();

      // 2. Define column widths and render table header
      const columnWidths = {
        'ลำดับ': '20px',
        'วันที่': '35px',
        'โครงการ': '60px',
        'รายละเอียด': '150px',
        'ค่าแรงดิบ': '30px',
        'ปกติ+OT': '30px',
        'เหมา': '30px',
        'รวมทั้งหมด': '40px',
        'ผู้สั่งงาน': '40px',
      };
      const defaultWorkerWidth = '26px'; // ความกว้างสำหรับคอลัมน์คนงาน

      const staticHeadersStart = ['ลำดับ', 'วันที่', 'โครงการ', 'รายละเอียด'];
      const staticHeadersEnd = ['ค่าแรงดิบ', 'ปกติ+OT', 'เหมา', 'รวมทั้งหมด', 'ผู้สั่งงาน'];
      const allHeaders = [...staticHeadersStart, ...sortedWorkerHeaders, ...staticHeadersEnd];
      tableHead.innerHTML = allHeaders.map(h => {
        const width = columnWidths[h] || defaultWorkerWidth;
        return `<th style="width: ${width}; min-width: ${width};">${h}</th>`;
      }).join('');

      // 3. Render table body
      let grandTotalRaw = 0;
      let grandTotalNormalOt = 0;
      let grandTotalFixed = 0;
      let grandTotalOverall = 0;
      let grandTotalMarkup = 0;

      const tableRows = logs.map((log, index) => {
        const workerDataMap = new Map();
        let totalRaw = 0;
        let totalNormalOt = 0;
        let totalFixed = 0;

        log.Workers.forEach(w => {
          const headerKey = `${Utils.escapeHtml(w.WorkerName)}<br>(${w.DailyWage})`;
          let displayValue = '';
          if (w.WageType === 'fixed') { // ค่าแรงเหมา
            displayValue = `${Utils.smartMoney(w.FixedAmount)}-เหมา`;
            totalFixed += w.RawWage;
          } else { // ค่าแรงรายวัน/OT
            displayValue = Utils.smartMoney(w.RawWage);
            totalNormalOt += w.TotalWithMarkup;
            grandTotalMarkup += (w.TotalWithMarkup - w.RawWage);
          }
          totalRaw += w.RawWage;
          workerDataMap.set(headerKey, displayValue);
        });

        const grandTotal = totalNormalOt + totalFixed;

        // Accumulate grand totals
        grandTotalRaw += totalRaw;
        grandTotalNormalOt += totalNormalOt;
        grandTotalFixed += totalFixed;
        grandTotalOverall += grandTotal;

        const staticCellsStart = `
          <td class="text-center">${index + 1}</td>
          <td class="text-center">${Utils.formatDate(log.Date)}</td>
          <td class="text-center">${Utils.escapeHtml(log.Site)}</td>
          <td class="text-truncate text-left" title="${Utils.escapeHtml(log.JobDetail)}">${Utils.escapeHtml(log.JobDetail)}</td>
        `;

        const dynamicWorkerCells = sortedWorkerHeaders.map(header => {
          const wage = workerDataMap.get(header);
          return `<td class="font-mono text-center">${wage ? wage : '-'}</td>`;
        }).join('');

        const staticCellsEnd = `
          <td class="font-mono text-center">${Utils.smartMoney(totalRaw)}</td>
          <td class="font-mono text-center">${Utils.smartMoney(totalNormalOt)}</td>
          <td class="font-mono text-center">${Utils.smartMoney(totalFixed)}</td>
          <td class="font-mono text-right font-semibold" style="color:var(--blueprint-dark)">${Utils.smartMoney(grandTotal)}</td>
          <td class="text-center">${Utils.escapeHtml(log.RequestedBy)}</td>
        `;

        return `<tr>${staticCellsStart}${dynamicWorkerCells}${staticCellsEnd}</tr>`;
      });

      tbody.innerHTML = tableRows.join('');

      renderSummaryCard({ grandTotalRaw, grandTotalNormalOt, grandTotalFixed, grandTotalOverall, grandTotalMarkup });
      printBtn.hidden = false; // Show print button

    } catch (err) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = tableHead.children.length || 9;
      td.appendChild(Utils.errorBanner(err.message, load));
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  function renderSummaryCard(totals) {
    const container = document.getElementById('summary-card-container');
    container.innerHTML = `
      <div class="ledger-card p-5">
        <h2 class="font-display text-xl font-semibold mb-4">รายการสรุปเพื่อตรวจทาน</h2>
        <div class="grid md:grid-cols-3 gap-6">
          
          <!-- Part 1: Fixed Wage -->
          <div class="space-y-3">
            <h3 class="font-semibold text-base border-b pb-2">กลุ่มค่าแรงเหมา</h3>
            <div class="flex justify-between items-center text-sm">
              <label for="summary-transport-cost" class="font-medium">ค่าขนส่งชิ้นส่วนคงที่:</label>
              <input type="text" id="summary-transport-cost" class="w-32 font-mono text-right rounded-md p-1 border" style="border-color: var(--line); border-width: 1.5px;" value="0.00">
            </div>
            <div class="flex justify-between text-sm pt-2">
              <span class="font-medium">ยอดรวมค่าแรงเหมาทั้งหมด:</span>
              <span class="font-mono" id="summary-total-fixed">฿${Utils.money(totals.grandTotalFixed)}</span>
            </div>
          </div>

          <!-- Part 2: Daily Wage -->
          <div class="space-y-2">
            <h3 class="font-semibold text-base border-b pb-2">กลุ่มค่าแรงรายวัน</h3>
            <div class="flex justify-between text-sm"><span class="text-gray-600">ยอดรวมค่าแรงดิบทั้งหมด:</span><span class="font-mono">฿${Utils.money(totals.grandTotalRaw)}</span></div>
            <div class="flex justify-between text-sm"><span class="text-gray-600">ยอดส่วนเพิ่ม (+20%):</span><span class="font-mono">฿${Utils.money(totals.grandTotalMarkup)}</span></div>
            <div class="flex justify-between text-sm font-medium"><span class="">ยอดรวมค่าแรงทั้งหมด:</span><span class="font-mono" id="summary-total-overall">฿${Utils.money(totals.grandTotalOverall)}</span></div>
          </div>

          <!-- Part 3: Grand Total -->
          <div class="space-y-2">
            <h3 class="font-semibold text-base border-b pb-2">สรุปค่าแรงงวดนี้</h3>
            <div class="p-4 rounded-lg" style="background-color: #eef1f3;">
              <div class="flex justify-between items-center text-lg font-bold" style="color: var(--blueprint-dark);">
                <span>ยอดรวมค่าแรงสุทธิทั้งหมด:</span>
                <span class="font-mono text-xl" id="summary-net-total">฿0.00</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    const transportInput = document.getElementById('summary-transport-cost');
    const netTotalEl = document.getElementById('summary-net-total');

    function updateNetTotal() {
      const transportCost = parseFloat(transportInput.value.replace(/,/g, '')) || 0;
      const totalFixed = totals.grandTotalFixed;
      const totalOverall = totals.grandTotalOverall; // This is totalNormalOt + totalFixed from table

      // ยอดรวมค่าแรงสุทธิทั้งหมด = ค่าขนส่ง + ยอดรวมค่าแรงเหมา + ยอดรวมค่าแรงทั้งหมด
      // Note: grandTotalOverall already includes grandTotalFixed. So we need to be careful.
      // The request is: "ค่าขนส่งชิ้นส่วนคงที่:"+"ยอดรวมค่าแรงเหมาทั้งหมด:"+"ยอดรวมค่าแรงทั้งหมด:"
      // This seems like double counting. Let's assume "ยอดรวมค่าแรงทั้งหมด" refers to the grand total from the table.
      // So, Net Total = Transport Cost + Grand Total from table.
      const netTotal = transportCost + totalOverall;

      netTotalEl.textContent = '฿' + Utils.money(netTotal);
    }

    transportInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/[^0-9.]/g, '');
      updateNetTotal();
    });
    transportInput.addEventListener('blur', (e) => {
        const num = parseFloat(e.target.value.replace(/,/g, '')) || 0;
        e.target.value = Utils.money(num);
    });

    updateNetTotal(); // Initial calculation
  }

  layout();
  loadSiteHistory();
})();
