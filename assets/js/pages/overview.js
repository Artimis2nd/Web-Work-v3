(() => {
  Utils.renderShell('overview.html', 'สรุปภาพรวมงาน');
  const content = document.getElementById('page-content');
  const { buildDualMonthCalendarData, buildSiteWorkBreakdown, buildDailyWorkScheduleSummary } = OverviewLogic;

  let allLogsCache = [];
  let allTasksCache = [];
  let currentFilterStartDate = '';
  let currentFilterEndDate = '';

  const DAY_NAMES = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

  function renderLayout() {
    content.innerHTML = `
      <!-- แถบเครื่องมือด้านบน: ตัวกรองช่วงวันที่และปุ่มพิมพ์ -->
      <div id="overview-controls" class="ledger-card p-3 mb-5 border border-slate-300 bg-white no-print">
        <div class="flex flex-wrap items-end gap-3 justify-between">
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">📅 ตั้งแต่วันที่</label>
              <input type="date" id="f-start-date" class="px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white font-mono h-9">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">📅 ถึงวันที่</label>
              <input type="date" id="f-end-date" class="px-2.5 py-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white font-mono h-9">
            </div>
            <button id="btn-reset-period" class="btn btn-outline text-xs px-3 py-1.5 h-9 inline-flex items-center gap-1.5">
              🔄 ทั้งหมดในรอบนี้
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-print-overview" class="btn btn-primary text-xs px-3.5 py-1.5 h-9 inline-flex items-center gap-1.5 shadow-sm">
              🖨️ พิมพ์สรุปภาพรวม (Print A4)
            </button>
          </div>
        </div>
      </div>

      <!-- พื้นที่แสดงรายงานภาพรวม (รองรับการพิมพ์ Print A4 ผ่าน #printable-area) -->
      <div id="printable-area" class="space-y-6">
        <div class="ledger-card p-8 text-center text-slate-400">
          <span class="spinner"></span> กำลังประมวลผลข้อมูลภาพรวมงาน...
        </div>
      </div>
    `;

    document.getElementById('f-start-date').addEventListener('change', (e) => {
      currentFilterStartDate = e.target.value;
      renderReport();
    });

    document.getElementById('f-end-date').addEventListener('change', (e) => {
      currentFilterEndDate = e.target.value;
      renderReport();
    });

    document.getElementById('btn-reset-period').addEventListener('click', () => {
      resetToDefaultPeriod();
      renderReport();
    });

    document.getElementById('btn-print-overview').addEventListener('click', () => {
      window.print();
    });
  }

  function resetToDefaultPeriod() {
    const dates = Array.from(new Set(allLogsCache.map(l => Utils.toApiDate(l.Date)).filter(Boolean))).sort();
    if (dates.length > 0) {
      currentFilterStartDate = dates[0];
      currentFilterEndDate = dates[dates.length - 1];
    } else {
      const today = Utils.toApiDate(new Date());
      currentFilterStartDate = today;
      currentFilterEndDate = today;
    }
    const inpStart = document.getElementById('f-start-date');
    const inpEnd = document.getElementById('f-end-date');
    if (inpStart) inpStart.value = currentFilterStartDate;
    if (inpEnd) inpEnd.value = currentFilterEndDate;
  }

  function renderMonthCalendarHtml(monthData) {
    return `
      <div class="border border-slate-300 rounded-lg p-3.5 bg-white shadow-xs">
        <div class="font-display text-sm font-bold text-center text-slate-900 pb-2 mb-2 border-b border-slate-200">
          🗓️ ${Utils.escapeHtml(monthData.title)}
        </div>
        <!-- หัววันเริ่มที่วันจันทร์ -->
        <div class="grid grid-cols-7 border-t border-l border-slate-200 text-center text-[11px] font-semibold text-slate-700 bg-slate-100">
          ${DAY_NAMES.map(name => `<div class="py-1.5 border-r border-b border-slate-200">${name}</div>`).join('')}
        </div>
        <!-- ช่องตารางแยกแต่ละวัน พร้อมเส้นตารางล้อมรอบ -->
        <div class="grid grid-cols-7 border-l border-slate-200 text-center">
          ${monthData.cells.map(cell => {
            if (cell.isEmpty) {
              return `<div class="h-14 border-r border-b border-slate-200 bg-slate-50/30"></div>`;
            }
            if (cell.isWorkDay) {
              return `
                <div class="h-14 border-r border-b border-slate-200 p-1 flex flex-col items-center justify-between bg-emerald-50/50 hover:bg-emerald-50 transition-colors" title="วันทำงาน (${Utils.formatDate(cell.dateIso)}: ${cell.workerCount} คน)">
                  <div class="w-6 h-6 rounded-full bg-emerald-600 text-white font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[10px] font-bold text-emerald-800 leading-tight">
                    ${cell.workerCount} คน
                  </div>
                </div>
              `;
            }
            if (cell.isOffDay) {
              return `
                <div class="h-14 border-r border-b border-slate-200 p-1 flex flex-col items-center justify-between bg-red-50/40 hover:bg-red-50 transition-colors" title="หยุดงาน (${Utils.formatDate(cell.dateIso)})">
                  <div class="w-6 h-6 rounded-full bg-red-100 text-red-700 border border-red-400 font-mono font-bold text-xs flex items-center justify-center">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[10px] font-semibold text-red-600 leading-tight">
                    หยุดงาน
                  </div>
                </div>
              `;
            }
            return `
              <div class="h-14 border-r border-b border-slate-200 p-1 flex items-center justify-center bg-slate-50/20" title="${Utils.formatDate(cell.dateIso)}">
                <div class="text-sm font-bold text-slate-800 font-mono">
                  ${cell.dayNumber}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderPrintDailyScheduleTable(dailySchedule = []) {
    if (!dailySchedule || !dailySchedule.length) return '';

    const half = Math.ceil(dailySchedule.length / 2);
    const colLeft = dailySchedule.slice(0, half);
    const colRight = dailySchedule.slice(half);

    const renderColumnTable = (items) => `
      <table class="w-full text-[10px] border-collapse border border-slate-300">
        <thead>
          <tr class="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold">
            <th class="py-1 px-1 text-center w-7 border-r border-slate-300">ลำดับ</th>
            <th class="py-1 px-1.5 text-center w-16 border-r border-slate-300">วันที่ทำงาน</th>
            <th class="py-1 px-2 text-left border-r border-slate-300">หน้างานที่ทำ</th>
            <th class="py-1 px-1.5 text-center w-14">จำนวนคน</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr class="border-b border-slate-200">
              <td class="py-1 px-1 text-center font-mono text-slate-500 border-r border-slate-200">${item.index}</td>
              <td class="py-1 px-1.5 text-center font-semibold text-slate-800 border-r border-slate-200">${item.dateThai}</td>
              <td class="py-1 px-2 text-slate-700 border-r border-slate-200">${Utils.escapeHtml(item.siteText)}</td>
              <td class="py-1 px-1.5 text-center font-bold text-emerald-700">${item.workerCount} คน</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    return `
      <!-- ตารางสรุปวันเข้าทำงานประจำวัน (แสดงผลเฉพาะหน้าพิมพ์งาน overview เพื่ออธิบายวันทำงานในปฏิทิน จัดไม่ให้ล้นหน้าแรก) -->
      <div class="print-only mt-3 pt-2.5 border-t border-slate-300">
        <div class="flex items-center justify-between mb-1.5">
          <div class="font-bold text-[11px] text-slate-800 flex items-center gap-1.5">
            <span>📋 ตารางสรุปวันเข้าทำงาน (เรียงตามลำดับวันแรก – วันล่าสุด รวม ${dailySchedule.length} วัน)</span>
          </div>
          <div class="text-[9px] text-slate-500">
            * แสดงเฉพาะวันที่มีการลงงานจริง (ไม่รวมวันหยุด)
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>${renderColumnTable(colLeft)}</div>
          <div>${colRight.length > 0 ? renderColumnTable(colRight) : ''}</div>
        </div>
      </div>
    `;
  }

  function renderReport() {
    const container = document.getElementById('printable-area');
    if (!container) return;

    if (!allLogsCache.length) {
      container.innerHTML = `
        <div class="ledger-card p-8 text-center text-slate-400">
          <div class="text-3xl mb-2">📑</div>
          <div>ยังไม่มีข้อมูลบันทึกงานประจำวันในระบบ</div>
        </div>
      `;
      return;
    }

    // 1. คำนวณข้อมูลปฏิทิน 2 เดือน
    const calendarData = buildDualMonthCalendarData(allLogsCache, currentFilterStartDate, currentFilterEndDate);

    // 2. คำนวณข้อมูลแจกแจงแยกตามหน้างาน (Site Daily Breakdown)
    const siteBreakdowns = buildSiteWorkBreakdown(allLogsCache, allTasksCache, currentFilterStartDate, currentFilterEndDate);

    // 3. คำนวณตารางสรุปวันเข้าทำงานประจำวัน (สำหรับหน้าพิมพ์งาน)
    const dailySchedule = buildDailyWorkScheduleSummary(allLogsCache, currentFilterStartDate, currentFilterEndDate);

    const rangeTitle = `${Utils.formatDate(calendarData.startDate)} – ${Utils.formatDate(calendarData.endDate)}`;

    container.innerHTML = `
      <!-- ส่วนที่ 1: การ์ดปฏิทิน 2 เดือนคู่กัน พร้อมสรุปวันทำงาน/วันหยุด (พิมพ์แยกเป็นหน้าแรก) -->
      <div class="ledger-card overview-calendar-card p-5 border-2 border-slate-800 bg-white">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b-2 border-slate-800 pb-3 mb-4">
          <div>
            <h1 class="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <span>📅 ปฏิทินรอบวันทำงาน (แสดง 2 เดือนต่อเนื่อง)</span>
            </h1>
            <div class="text-xs text-slate-600 mt-0.5">
              ช่วงเวลารอบงาน: <strong class="text-slate-900 font-mono">${rangeTitle}</strong>
              <span class="mx-1">|</span>
              รวมทั้งหมด <strong>${calendarData.totalRangeDays} วัน</strong>
            </div>
          </div>

          <!-- แถบตัวเลขสรุปวันทำงานและวันหยุด -->
          <div class="flex items-center gap-2 flex-wrap text-xs">
            <div class="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 mr-1.5"></span>
              เข้าทำงาน: <strong>${calendarData.totalWorkDays} วัน</strong>
            </div>
            <div class="px-3 py-1.5 rounded-lg bg-red-50 border border-red-300 text-red-900">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-1.5"></span>
              ไม่ได้ทำงาน: <strong>${calendarData.totalOffDays} วัน</strong>
            </div>
          </div>
        </div>

        <!-- คำอธิบายสัญลักษณ์ (Legend) -->
        <div class="flex items-center gap-4 text-xs text-slate-600 mb-3 px-1 flex-wrap">
          <div class="flex items-center gap-1.5">
            <div class="w-4 h-4 rounded-full bg-emerald-600"></div>
            <span>วันที่ลงงาน (มีบันทึกงานประจำวัน)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-4 h-4 rounded-full bg-red-100 border border-red-500"></div>
            <span>วันที่ไม่ได้ทำงาน (ไม่มีบันทึกงาน)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-4 h-4 text-slate-400 font-mono text-center text-xs">15</div>
            <span>นอกช่วงรอบงาน</span>
          </div>
        </div>

        <!-- กริดปฏิทิน 2 เดือนเคียงกัน -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${renderMonthCalendarHtml(calendarData.month1)}
          ${renderMonthCalendarHtml(calendarData.month2)}
        </div>

        <!-- ตารางสรุปวันเข้าทำงานประจำวัน (แสดงเฉพาะในหน้าพิมพ์งาน overview จัดวางไม่ให้ล้นหน้าแรก) -->
        ${renderPrintDailyScheduleTable(dailySchedule)}
      </div>

      <!-- ส่วนที่ 2: ตารางแจกแจงแยกตามหน้างาน (ไม่ปนกัน) -->
      <div class="space-y-6">
        ${siteBreakdowns.length > 0
          ? siteBreakdowns.map((sb, idx) => renderSiteCard(sb, idx + 1)).join('')
          : `<div class="ledger-card p-6 text-center text-slate-400">ไม่พบข้อมูลการเข้าทำงานตามช่วงวันที่ที่เลือก</div>`
        }
      </div>
    `;
  }

  function renderSiteCard(sb, siteNumber) {
    return `
      <div class="ledger-card site-work-card overflow-hidden border border-slate-300 bg-white">
        <!-- 1. แถวแรกเป็นหัวข้อใหญ่ (หัวตาราง) บอกหน้างาน และเข้าทำงานรวมกี่วัน -->
        <div class="bg-slate-800 text-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="font-display text-base font-bold flex items-center gap-2">
            <span>📍 ${siteNumber}. ${Utils.escapeHtml(sb.siteName)}</span>
          </div>
          <div class="text-xs font-semibold px-3 py-1 rounded bg-slate-700 border border-slate-600 text-amber-300">
            เข้าทำงานรวม <strong>${sb.totalDays} วัน</strong>
          </div>
        </div>

        <!-- 2. ตารางย่อยของหน้างาน -->
        <div class="p-4 overflow-x-auto">
          <table class="w-full text-xs border-collapse border border-slate-200">
            <thead>
              <tr class="bg-slate-100 text-slate-700 border-b border-slate-300 font-semibold">
                <th class="py-2 px-3 text-center w-28 border-r border-slate-200">วันที่</th>
                <th class="py-2 px-3 text-center w-24 border-r border-slate-200">คนงาน</th>
                <th class="py-2 px-3 text-left w-72 border-r border-slate-200">คำสั่งงาน</th>
                <th class="py-2 px-3 text-left">คำสั่งงานย่อย</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 bg-white">
              ${sb.dateRows.map(renderDateRowHtml).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderDateRowHtml(dr) {
    const taskRows = dr.taskRows.length ? dr.taskRows : [{
      taskCode: '-',
      taskTitle: '-',
      subItems: []
    }];
    const totalRowSpan = taskRows.length;

    return taskRows.map((tr, tIdx) => {
      const isFirstRow = tIdx === 0;
      return `
        <tr class="hover:bg-slate-50/60 ${tIdx > 0 ? 'bg-slate-50/20' : ''}">
          ${isFirstRow ? `
            <td rowspan="${totalRowSpan}" class="py-2.5 px-3 text-center font-mono font-bold text-slate-800 align-top bg-slate-50/70 border-r border-slate-200">
              ${Utils.escapeHtml(dr.dateThai)}
            </td>
            <td rowspan="${totalRowSpan}" class="py-2.5 px-3 text-center font-mono font-bold text-blue-900 align-top bg-blue-50/30 border-r border-slate-200" title="รายชื่อคนงาน: ${Utils.escapeHtml(dr.workerNames.join(', '))}">
              <div class="text-sm">${dr.workerCount} คน</div>
            </td>
          ` : ''}

          <!-- 3. คำสั่งงาน ชิดฝั่งซ้าย (ไม่ใส่รหัส ใส่แต่ชื่อลงไป) -->
          <td class="py-2.5 px-3 text-left font-semibold text-slate-900 align-top border-r border-slate-200">
            <span>${Utils.escapeHtml(tr.taskTitle)}</span>
          </td>

          <!-- 3. คำสั่งงานย่อย ชิดฝั่งขวา (แสดงตัดบรรทัดใหม่จนครบ) -->
          <td class="py-2.5 px-3 text-left text-slate-700 align-top">
            ${tr.subItems.length > 0 ? `
              <div class="space-y-1">
                ${tr.subItems.map(item => `
                  <div class="leading-snug text-slate-800 flex items-start gap-1">
                    <span class="text-slate-400 select-none">•</span>
                    <span>${Utils.escapeHtml(item)}</span>
                  </div>
                `).join('')}
              </div>
            ` : `<span class="text-slate-400">-</span>`}
          </td>
        </tr>
      `;
    }).join('');
  }

  async function load() {
    renderLayout();
    try {
      const [logsData, tasks] = await Promise.all([
        Api.getLogs({}),
        Api.getTasks()
      ]);
      allLogsCache = logsData.logs || [];
      allTasksCache = tasks || [];
      resetToDefaultPeriod();
      renderReport();
    } catch (err) {
      const container = document.getElementById('printable-area');
      if (container) {
        container.innerHTML = '';
        container.appendChild(Utils.errorBanner(err.message, load));
      }
    }
  }

  load();
})();
