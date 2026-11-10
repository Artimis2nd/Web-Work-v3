/**
 * หน้าสรุปความคืบหน้า (Task Progress Summary Page Controller)
 * สรุปสถานะงานและความคืบหน้าจากช่วงวันที่-วันที่ ของรายงานประจำวัน แยกตามหน้างาน (Site) และใบสั่งงาน (Task)
 * แสดงยอดค่าแรงรวมเบิก (+20%) เสมอเพื่อตรวจทานยอดตรงกับหน้าแรก พร้อมจัดพิมพ์เป็นเอกสารรายงาน A4 (ไม่มีรูปภาพ)
 */
(() => {
  'use strict';

  let allTasks = [];
  let allRawLogs = [];
  let filterStartDate = '';
  let filterEndDate = '';

  function init() {
    if (typeof Utils !== 'undefined' && typeof Utils.renderShell === 'function') {
      Utils.renderShell('task-progress-summary.html', 'สรุปความคืบหน้า');
    }

    const content = document.getElementById('page-content');
    if (!content) return;

    content.innerHTML = `
      <!-- แถบควบคุมและตัวกรองช่วงวันที่ (ซ่อนเวลาสั่งพิมพ์) -->
      <div class="no-print ledger-card p-4 mb-5" id="summary-control-bar">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-wrap items-end gap-3">
            <div class="w-44">
              <label for="filter-start-date" class="block text-xs font-semibold text-slate-700 mb-1">📅 ตั้งแต่วันที่</label>
              <input type="date" id="filter-start-date" class="field-input text-xs w-full" style="height:36px;padding-top:0.25rem;padding-bottom:0.25rem;">
            </div>
            <div class="w-44">
              <label for="filter-end-date" class="block text-xs font-semibold text-slate-700 mb-1">📅 ถึงวันที่</label>
              <input type="date" id="filter-end-date" class="field-input text-xs w-full" style="height:36px;padding-top:0.25rem;padding-bottom:0.25rem;">
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0 flex-wrap">
            <button type="button" id="btn-reset-dates" class="btn btn-outline btn-sm" style="height:36px;" title="รีเซ็ตช่วงวันที่ให้ครอบคลุมรายงานประจำวันทั้งหมดในรอบนี้">
              🔄 ทั้งหมดในรอบนี้
            </button>
            <button type="button" id="btn-print-summary" class="btn btn-primary btn-sm inline-flex items-center gap-1.5" style="height:36px;">
              <span>🖨️</span>
              <span>พิมพ์รายงานสรุป (Print A4)</span>
            </button>
          </div>
        </div>
      </div>

      <!-- พื้นที่เอกสารรายงานสำหรับแสดงผลและพิมพ์ A4 (ต้องใช้ id="printable-area" ให้ตรงกับ style.css) -->
      <div id="printable-area">
        <div id="summary-report-container">
          <div class="ledger-card p-10 text-center text-slate-500">
            กำลังประมวลผลข้อมูลสรุปความคืบหน้า...
          </div>
        </div>
      </div>
    `;

    bindEvents();
    loadData();
  }

  function bindEvents() {
    const startInp = document.getElementById('filter-start-date');
    const endInp = document.getElementById('filter-end-date');
    const resetBtn = document.getElementById('btn-reset-dates');
    const printBtn = document.getElementById('btn-print-summary');

    if (startInp) {
      startInp.addEventListener('change', () => {
        filterStartDate = startInp.value || '';
        renderSummaryDocument();
      });
    }
    if (endInp) {
      endInp.addEventListener('change', () => {
        filterEndDate = endInp.value || '';
        renderSummaryDocument();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        setDefaultDateRangeFromLogs();
        renderSummaryDocument();
      });
    }
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }
  }

  function setDefaultDateRangeFromLogs() {
    const dates = allRawLogs
      .map(r => String(r.Date || r.work_date || '').slice(0, 10))
      .filter(Boolean)
      .sort();

    if (dates.length > 0) {
      filterStartDate = dates[0];
      filterEndDate = dates[dates.length - 1];
    } else {
      filterStartDate = '';
      filterEndDate = '';
    }

    const startInp = document.getElementById('filter-start-date');
    const endInp = document.getElementById('filter-end-date');
    if (startInp) startInp.value = filterStartDate;
    if (endInp) endInp.value = filterEndDate;
  }

  async function loadData() {
    const container = document.getElementById('summary-report-container');
    try {
      const api = window.Api || window.WAGE_API || (typeof Api !== 'undefined' ? Api : null);
      const [tasksRes, logsRes] = await Promise.all([
        api.getTasks(),
        api.getLogs()
      ]);

      allTasks = Array.isArray(tasksRes) ? tasksRes : [];

      const flatLogs = [];
      const groups = (logsRes && Array.isArray(logsRes.logs)) ? logsRes.logs : [];
      groups.forEach(g => {
        (g.Workers || []).forEach(w => {
          flatLogs.push({
            ...w,
            GroupID: w.GroupID || g.GroupID,
            Date: String(w.Date || w.work_date || g.Date || '').slice(0, 10),
            Site: (w.Site || w.site || g.Site || '').trim(),
            JobDetail: w.JobDetail || w.job_detail || g.JobDetail || '',
            RequestedBy: w.RequestedBy || w.requested_by || g.RequestedBy || '',
            WorkerName: w.WorkerName || w.worker_name || '',
            TaskId: w.TaskId != null ? Number(w.TaskId) : (w.task_id != null ? Number(w.task_id) : (g.TaskId != null ? Number(g.TaskId) : null)),
            RawWage: Number(w.RawWage ?? w.raw_wage) || 0,
            TotalWithMarkup: Number(w.TotalWithMarkup ?? w.total_with_markup) || 0
          });
        });
      });
      allRawLogs = flatLogs;

      setDefaultDateRangeFromLogs();
      renderSummaryDocument();
    } catch (err) {
      if (container) {
        container.innerHTML = '';
        container.appendChild(Utils.errorBanner(err.message || 'โหลดข้อมูลสรุปความคืบหน้าไม่สำเร็จ', loadData));
      }
    }
  }

  function isDateWithinRange(dateStr, start, end) {
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }

  function formatMoneyText(amount) {
    const fmt = (typeof Utils !== 'undefined' && Utils.smartMoney) ? Utils.smartMoney : Utils.money;
    return `${fmt(Number(amount) || 0)} บาท`;
  }

  function formatStatusText(status) {
    switch (status) {
      case 'Completed': return 'เสร็จสมบูรณ์';
      case 'In Progress': return 'กำลังดำเนินการ';
      case 'Blocked': return 'ติดปัญหา';
      case 'Cancelled': return 'ยกเลิก';
      default: return 'รอดำเนินการ';
    }
  }

  function renderSubItemStatusPill(status) {
    switch (status) {
      case 'Completed':
        return '<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">✓ เสร็จแล้ว</span>';
      case 'In Progress':
        return '<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-100 text-sky-800 border border-sky-300">🔨 กำลังทำ</span>';
      case 'Blocked':
        return '<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-800 border border-red-300">⚠️ ติดปัญหา</span>';
      case 'Cancelled':
        return '<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-300">✕ ยกเลิก</span>';
      default:
        return '<span class="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">⏳ รอทำ</span>';
    }
  }

  /**
   * ตรวจสอบข้อมูลงานค้างจากงวดงานก่อน (Carry-over from previous period)
   */
  function analyzeCarryOverInfo(task, startDate) {
    const accumDays = Number(task.accumulated_days) || 0;
    const accumCost = Number(task.accumulated_cost) || 0;
    const accumMarkupCost = Number(task.accumulated_markup_cost) || 0;
    const accumHours = Number(task.accumulated_hours) || 0;

    const history = Array.isArray(task.progress_history) ? task.progress_history : [];
    const priorHistory = startDate
      ? history.filter(h => h && h.date && String(h.date).slice(0, 10) < startDate)
      : [];

    const priorLogs = startDate
      ? allRawLogs.filter(l => l.TaskId === Number(task.id) && l.Date && l.Date < startDate)
      : [];
    const priorLogDates = Array.from(new Set(priorLogs.map(l => l.Date))).sort();
    const priorLogMarkupCost = priorLogs.reduce((s, l) => s + l.TotalWithMarkup, 0);

    const hasAccumulated = accumDays > 0 || accumCost > 0 || accumMarkupCost > 0 || accumHours > 0;
    const hasPriorInPeriod = priorLogDates.length > 0 || priorHistory.length > 0;

    if (!hasAccumulated && !hasPriorInPeriod) {
      return { isCarryOver: false };
    }

    const prevDays = accumDays + priorLogDates.length;
    const prevMarkupCost = (accumMarkupCost > 0 ? accumMarkupCost : accumCost) + priorLogMarkupCost;

    let prevPercent = null;
    if (priorHistory.length > 0) {
      prevPercent = Number(priorHistory[priorHistory.length - 1].percent) || 0;
    } else if (history.length > 0 && history[0].prev_percent !== undefined) {
      prevPercent = Number(history[0].prev_percent) || 0;
    }

    return {
      isCarryOver: true,
      hasAccumulated,
      prevDays,
      prevMarkupCost,
      prevHours: accumHours,
      prevPercent
    };
  }

  function renderSummaryDocument() {
    const container = document.getElementById('summary-report-container');
    if (!container) return;

    // 1. กรองรายงานประจำวันตามช่วงวันที่ที่เลือก (แสดงทุกหน้างานและทุกสถานะเสมอ)
    const filteredLogs = allRawLogs.filter(l => isDateWithinRange(l.Date, filterStartDate, filterEndDate));

    // 2. รวบรวมรายชื่อหน้างาน (Site) ทั้งหมด
    const siteNamesSet = new Set();
    filteredLogs.forEach(l => {
      if (l.Site) siteNamesSet.add(l.Site);
    });
    allTasks.forEach(t => {
      const tSite = (t.site || '').trim();
      if (tSite) siteNamesSet.add(tSite);
    });

    const siteNames = Array.from(siteNamesSet).sort((a, b) => a.localeCompare(b, 'th'));

    // 3. สร้างข้อมูลสรุปแยกตามหน้างาน (Site)
    const siteGroups = [];
    let grandTotalMarkup = 0;
    let totalTasksShown = 0;
    let completedTasksShown = 0;
    let inProgressTasksShown = 0;
    let pendingTasksShown = 0;
    let blockedTasksShown = 0;

    siteNames.forEach(siteName => {
      const siteLogs = filteredLogs.filter(l => l.Site === siteName);
      const siteTasksAll = allTasks.filter(t => (t.site || '').trim() === siteName);

      // คำนวณค่าแรงรวมของหน้างานนี้ (ใช้ยอดรวมเบิก +20% เสมอ)
      const siteMarkupWage = siteLogs.reduce((sum, l) => sum + l.TotalWithMarkup, 0);
      const siteUniqueDates = Array.from(new Set(siteLogs.map(l => l.Date).filter(Boolean))).sort();
      const unlinkedSiteLogs = siteLogs.filter(l => l.TaskId == null);

      if (siteTasksAll.length === 0 && siteLogs.length === 0) {
        return;
      }

      const taskSummaries = siteTasksAll.map(task => {
        const taskLogsInRange = siteLogs.filter(l => Number(l.TaskId) === Number(task.id));
        const taskAllLogsInCurrentCycle = allRawLogs.filter(l => Number(l.TaskId) === Number(task.id));

        const taskMarkupWage = taskLogsInRange.reduce((sum, l) => sum + l.TotalWithMarkup, 0);

        // นับจำนวนวันที่เข้าทำ และนับจำนวนคนงานที่เข้าทำในแต่ละวันของใบสั่งงานนี้
        const dateWorkersMap = new Map();
        taskLogsInRange.forEach(l => {
          if (!l.Date) return;
          if (!dateWorkersMap.has(l.Date)) {
            dateWorkersMap.set(l.Date, new Set());
          }
          if (l.WorkerName) {
            dateWorkersMap.get(l.Date).add(l.WorkerName);
          }
        });

        const workedDatesInRange = Array.from(dateWorkersMap.keys()).sort();
        const dailyWorkerCounts = workedDatesInRange.map(d => ({
          date: d,
          workerCount: dateWorkersMap.get(d).size
        }));

        const allWorkedDatesInCycle = Array.from(new Set(taskAllLogsInCurrentCycle.map(l => l.Date).filter(Boolean))).sort();
        const carryOver = analyzeCarryOverInfo(task, filterStartDate);

        // ตรวจสอบว่าเป็นใบสั่งงานที่ยังไม่ได้มีการเปลี่ยนแปลงหรือยังไม่ได้เข้าทำงานใดๆ หรือไม่
        const isUntouched =
          workedDatesInRange.length === 0 &&
          (Number(task.progress_percent) || 0) === 0 &&
          !(Number(task.accumulated_days) > 0) &&
          task.status === 'Pending';

        totalTasksShown++;
        if (task.status === 'Completed') completedTasksShown++;
        else if (task.status === 'Blocked') blockedTasksShown++;
        else if (task.status === 'In Progress') inProgressTasksShown++;
        else pendingTasksShown++;

        return {
          task,
          taskMarkupWage,
          workedDatesInRange,
          dailyWorkerCounts,
          allWorkedDatesInCycle,
          daysInRange: workedDatesInRange.length,
          totalDaysAll: (Number(task.accumulated_days) || 0) + allWorkedDatesInCycle.length,
          carryOver,
          isUntouched
        };
      });

      // จัดเรียงใบสั่งงาน: งานที่มีการเข้าทำหรือมีความคืบหน้าขึ้นก่อน ส่วนงานที่ยังไม่ได้เริ่มทำใดๆ จัดไว้ท้ายสุด
      taskSummaries.sort((a, b) => {
        if (a.isUntouched !== b.isUntouched) {
          return a.isUntouched ? 1 : -1;
        }
        return String(a.task.task_code || '').localeCompare(String(b.task.task_code || ''), 'th');
      });

      grandTotalMarkup += siteMarkupWage;

      siteGroups.push({
        siteName,
        siteMarkupWage,
        siteUniqueDates,
        taskSummaries,
        unlinkedSiteLogs
      });
    });

    const dateRangeTitle = (filterStartDate && filterEndDate)
      ? `ตั้งแต่วันที่ ${Utils.formatDate(filterStartDate)} ถึงวันที่ ${Utils.formatDate(filterEndDate)}`
      : (filterStartDate ? `ตั้งแต่วันที่ ${Utils.formatDate(filterStartDate)}` : (filterEndDate ? `ถึงวันที่ ${Utils.formatDate(filterEndDate)}` : 'ทั้งหมดในรอบปัจจุบัน'));

    if (siteGroups.length === 0) {
      container.innerHTML = `
        <div class="ledger-card p-10 text-center text-slate-500">
          <div class="text-3xl mb-2">📑</div>
          <div class="font-semibold text-base">ไม่พบข้อมูลใบสั่งงานหรือรายงานประจำวันตามช่วงวันที่ที่เลือก</div>
          <div class="text-xs text-slate-400 mt-1">ลองปรับช่วงวันที่ หรือกดปุ่ม "🔄 ทั้งหมดในรอบนี้" ด้านบน</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      ${renderCoverSummarySheet({
        dateRangeTitle,
        grandTotalMarkup,
        siteGroups,
        totalTasksShown,
        completedTasksShown,
        inProgressTasksShown,
        pendingTasksShown,
        blockedTasksShown
      })}

      <!-- รายละเอียดแยกตามหน้างาน (Site) -->
      <div class="space-y-6">
        ${siteGroups.map((sg, sIdx) => renderSiteGroupCard(sg, sIdx + 1)).join('')}
      </div>
    `;
  }

  function renderCoverSummarySheet({
    dateRangeTitle,
    grandTotalMarkup,
    siteGroups,
    totalTasksShown,
    completedTasksShown,
    inProgressTasksShown,
    pendingTasksShown,
    blockedTasksShown
  }) {
    // รวบรวมงานที่ยังไม่ดำเนินการ (isUntouched) แยกออกมาทำตารางเฉพาะ
    const untouchedTasks = [];
    siteGroups.forEach(sg => {
      sg.taskSummaries.forEach(ts => {
        if (ts.isUntouched) {
          untouchedTasks.push({
            siteName: sg.siteName,
            ...ts
          });
        }
      });
    });

    return `
      <!-- ใบสรุปหน้าปก (Cover Summary Sheet) สำหรับแสดงผลและพิมพ์แยกเป็นหน้าแรก -->
      <div class="ledger-card cover-summary-page p-5 mb-6 border-2 border-slate-800 bg-white">
        <!-- หัวเอกสารรายงานสรุปความคืบหน้า -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b-2 border-slate-800 pb-3 mb-3">
          <div>
            <h1 class="font-display text-xl font-bold text-slate-900">
              📑 สรุปสถานะและความคืบหน้า
            </h1>
            <div class="text-xs text-slate-600 mt-0.5">
              <strong class="text-slate-900">${Utils.escapeHtml(dateRangeTitle)}</strong>
              <span class="mx-1.5">|</span>
              พิมพ์เมื่อ: ${Utils.formatDate(new Date().toISOString().slice(0, 10))}
            </div>
          </div>
          <div class="text-left md:text-right bg-slate-50 px-3.5 py-2 rounded border border-slate-300 shrink-0">
            <div class="font-mono text-base font-bold text-slate-900 whitespace-nowrap">
              ค่าแรงรวมทุกหน้างาน ${Utils.escapeHtml(formatMoneyText(grandTotalMarkup))}
            </div>
          </div>
        </div>

        <!-- แถบตัวเลขภาพรวม (6 การ์ด แสดงผล 2 บรรทัด จัดกึ่งกลาง) -->
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs mb-4">
          <div class="p-2 rounded bg-slate-50 border border-slate-200 text-center">
            <div class="text-slate-500 font-medium">หน้างานที่ทำ</div>
            <div class="text-slate-900 font-bold text-sm mt-0.5">${siteGroups.length} หน้างาน</div>
          </div>
          <div class="p-2 rounded bg-slate-50 border border-slate-200 text-center">
            <div class="text-slate-500 font-medium">ใบสั่งงาน</div>
            <div class="text-slate-900 font-bold text-sm mt-0.5">${totalTasksShown} งาน</div>
          </div>
          <div class="p-2 rounded bg-emerald-50 border border-emerald-200 text-center">
            <div class="text-emerald-700 font-medium">เสร็จแล้ว</div>
            <div class="text-emerald-900 font-bold text-sm mt-0.5">${completedTasksShown} งาน</div>
          </div>
          <div class="p-2 rounded bg-sky-50 border border-sky-200 text-center">
            <div class="text-sky-700 font-medium">กำลังทำ</div>
            <div class="text-sky-900 font-bold text-sm mt-0.5">${inProgressTasksShown} งาน</div>
          </div>
          <div class="p-2 rounded bg-amber-50 border border-amber-200 text-center">
            <div class="text-amber-800 font-medium">รอทำ</div>
            <div class="text-amber-900 font-bold text-sm mt-0.5">${pendingTasksShown} งาน</div>
          </div>
          <div class="p-2 rounded ${blockedTasksShown > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'} text-center">
            <div class="${blockedTasksShown > 0 ? 'text-red-700' : 'text-slate-500'} font-medium">ติดปัญหา</div>
            <div class="${blockedTasksShown > 0 ? 'text-red-900' : 'text-slate-900'} font-bold text-sm mt-0.5">${blockedTasksShown} งาน</div>
          </div>
        </div>

        <!-- 1. ตารางสรุปภาพรวมความคืบหน้ารายหน้างาน (เฉพาะงานที่เข้าดำเนินการ) -->
        <div class="mb-4">
          <div class="text-xs font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded border border-slate-300 mb-2 flex items-center justify-between">
            <span>📊 สรุปความคืบหน้างานแยกตามหน้างาน (ภาพรวมแบบย่อ)</span>
            <span class="text-[11px] text-slate-500 font-normal">แสดงเฉพาะรายการงานที่เข้าทำ/มีความคืบหน้า</span>
          </div>

          <div class="space-y-3">
            ${siteGroups.map((sg, sIdx) => {
              const activeTasks = sg.taskSummaries.filter(ts => !ts.isUntouched);
              const siteWageStr = `รวม ${formatMoneyText(sg.siteMarkupWage)}`;
              return `
                <div class="border border-slate-300 rounded overflow-hidden">
                  <div class="bg-slate-700 text-white px-3 py-1.5 flex items-center justify-between text-xs font-bold">
                    <div>
                      📍 ${sIdx + 1}. ${Utils.escapeHtml(sg.siteName)}
                      <span class="font-mono text-amber-300 ml-1">( ${Utils.escapeHtml(siteWageStr)} )</span>
                    </div>
                    <div class="text-[11px] font-normal text-slate-200">
                      เข้าทำหน้างานนี้รวม <strong>${sg.siteUniqueDates.length} วัน</strong>
                    </div>
                  </div>
                  <div class="p-2 bg-white space-y-1 text-xs">
                    ${activeTasks.length > 0 ? activeTasks.map((ts, tIdx) => {
                      const t = ts.task;
                      const taskWageStr = formatMoneyText(ts.taskMarkupWage);
                      const overallPct = Math.max(0, Math.min(100, Math.round(Number(t.progress_percent) || 0)));
                      const statusIcon = (t.status === 'Completed' || overallPct >= 100)
                        ? '✅'
                        : (t.status === 'Blocked' ? '⚠️' : (t.status === 'In Progress' ? '🔄' : '⏳'));
                      const pctColorClass = (t.status === 'Completed' || overallPct >= 100)
                        ? 'text-emerald-700'
                        : (t.status === 'Blocked' ? 'text-red-700' : (overallPct > 0 ? 'text-blue-700' : 'text-slate-600'));
                      return `
                        <div class="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0 hover:bg-slate-50 px-1.5 rounded">
                          <div class="flex items-center gap-1.5 min-w-0 truncate">
                            <span class="font-mono font-bold text-slate-800 shrink-0">${tIdx + 1}) ${Utils.escapeHtml(t.task_code || ('TSK-' + t.id))}</span>
                            <span class="text-slate-900 font-medium truncate">${Utils.escapeHtml(t.title || '-')}</span>
                          </div>
                          <div class="font-mono font-bold text-xs shrink-0 whitespace-nowrap flex items-center gap-1.5">
                            <span class="font-normal text-slate-700 font-mono">(ค่าแรง ${Utils.escapeHtml(taskWageStr)} )</span>
                            <span class="${pctColorClass}">${statusIcon} ${overallPct}%</span>
                          </div>
                        </div>
                      `;
                    }).join('') : `
                      <div class="text-slate-500 text-center py-1 text-[11px] italic">ไม่มีรายการที่เข้าทำในช่วงนี้ (ดูตารางงานรอทำด้านล่าง)</div>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 2. ตารางงานใบสั่งที่ยังไม่ดำเนินการ (Pending / Untouched Tasks) ต่อท้ายในหน้าแรก -->
        <div class="mt-4 pt-3 border-t border-slate-200">
          <div class="text-xs font-bold text-slate-800 bg-amber-50 px-3 py-1.5 rounded border border-amber-200 mb-2 flex items-center justify-between">
            <span class="text-amber-900 font-bold">⏳ รายการใบสั่งงานที่ยังไม่ดำเนินการ (ยังไม่มีการเข้าทำ / ความคืบหน้า 0%)</span>
            <span class="font-mono text-amber-800 font-semibold text-[11px]">ทั้งหมด ${untouchedTasks.length} งาน</span>
          </div>

          ${untouchedTasks.length > 0 ? `
            <div class="overflow-x-auto border border-slate-200 rounded">
              <table class="w-full text-xs text-left border-collapse">
                <thead class="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th class="py-1.5 px-2 w-10 text-center">#</th>
                    <th class="py-1.5 px-2 w-48">หน้างาน (Site)</th>
                    <th class="py-1.5 px-2 w-32">รหัสใบสั่งงาน</th>
                    <th class="py-1.5 px-2 w-24">วันที่สั่งงาน</th>
                    <th class="py-1.5 px-2">รายการงาน</th>
                    <th class="py-1.5 px-2 w-28 text-center">สถานะ</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 bg-white">
                  ${untouchedTasks.map((ut, uIdx) => {
                    const t = ut.task;
                    const orderDateStr = t.order_date ? Utils.formatDate(t.order_date) : '-';
                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="py-1.5 px-2 text-center text-slate-500 font-mono">${uIdx + 1}</td>
                        <td class="py-1.5 px-2 font-medium text-slate-800">${Utils.escapeHtml(ut.siteName)}</td>
                        <td class="py-1.5 px-2 font-mono font-bold text-slate-900">${Utils.escapeHtml(t.task_code || ('TSK-' + t.id))}</td>
                        <td class="py-1.5 px-2 text-slate-600 font-mono">${Utils.escapeHtml(orderDateStr)}</td>
                        <td class="py-1.5 px-2 text-slate-800">${Utils.escapeHtml(t.title || '-')}</td>
                        <td class="py-1.5 px-2 text-center">
                          ${typeof Utils.renderTaskStatusBadge === 'function' ? Utils.renderTaskStatusBadge(t.status) : `<span class="badge">${Utils.escapeHtml(formatStatusText(t.status))}</span>`}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="p-2.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs text-center">
              ✅ ไม่มีใบสั่งงานค้างรอทำ ทุกใบสั่งงานมีการเข้าดำเนินงานแล้ว
            </div>
          `}
        </div>
      </div>
    `;
  }

  function renderSiteGroupCard(sg, siteNumber) {
    const siteWageStr = `รวม ${formatMoneyText(sg.siteMarkupWage)}`;

    return `
      <div class="ledger-card site-group-card overflow-hidden border border-slate-300 bg-white">
        <!-- หัวข้อหน้างาน พร้อมค่าแรงรวมต่อท้ายชื่อหน้างาน และจำนวนวันเข้าทำรวม (ไม่แจกแจงวันที่ตรงนี้) -->
        <div class="bg-slate-800 text-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="font-display text-base font-bold">
            📍 ${siteNumber}. ${Utils.escapeHtml(sg.siteName)}
            <span class="font-mono text-amber-300 ml-1">( ${Utils.escapeHtml(siteWageStr)} )</span>
          </div>
          <div class="text-xs text-slate-200 font-medium">
            เข้าทำหน้างานนี้รวม <strong>${sg.siteUniqueDates.length} วัน</strong>
          </div>
        </div>

        <div class="p-4 space-y-4">
          ${sg.taskSummaries.length > 0
            ? sg.taskSummaries.map((ts, tIdx) => renderTaskBlock(ts, tIdx + 1)).join('')
            : `<div class="text-xs text-slate-500 py-2">ไม่มีใบสั่งงานในหน้างานนี้</div>`
          }

          ${renderSiteIssuesSummary(sg.taskSummaries)}

          ${sg.unlinkedSiteLogs.length > 0 ? renderUnlinkedSiteLogsNotice(sg.unlinkedSiteLogs) : ''}
        </div>
      </div>
    `;
  }

  function renderSiteIssuesSummary(taskSummaries) {
    const tasksWithIssues = [];

    taskSummaries.forEach(ts => {
      const t = ts.task;
      const subItems = Array.isArray(t.sub_items) ? t.sub_items : [];
      const problemItems = [];

      subItems.forEach((sub, sIdx) => {
        const hasIssueNote = Boolean(sub.issue_note && String(sub.issue_note).trim() !== '' && sub.issue_note !== '-');
        const isBlocked = sub.status === 'Blocked';
        if (hasIssueNote || isBlocked) {
          problemItems.push({
            order: sIdx + 1,
            name: sub.name || '-',
            issue: sub.issue_note || 'ติดปัญหา'
          });
        }
      });

      // ตรวจสอบกรณีใบสั่งงานหลักระบุปัญหาภาพรวม (issues หรือ status === 'Blocked')
      const taskHasIssue = Boolean((t.issues && String(t.issues).trim() !== '') || t.status === 'Blocked');
      if (problemItems.length === 0 && taskHasIssue) {
        problemItems.push({
          order: 1,
          name: t.title || 'ปัญหาภาพรวมของใบสั่งงาน',
          issue: t.issues || 'ติดปัญหา'
        });
      }

      if (problemItems.length > 0) {
        tasksWithIssues.push({
          taskCode: t.task_code || ('TSK-' + t.id),
          taskTitle: t.title || '-',
          items: problemItems
        });
      }
    });

    if (tasksWithIssues.length === 0) {
      return ''; // ไม่มีปัญหาติดขัด ไม่ต้องแสดงตาราง
    }

    return `
      <div class="mt-4 pt-3 border-t-2 border-red-300">
        <div class="text-xs font-bold text-red-900 bg-red-100 px-3 py-1.5 rounded border border-red-200 mb-2.5 flex items-center justify-between">
          <span>⚠️ ตารางสรุปรายการงานที่ติดปัญหาในหน้างานนี้ (${tasksWithIssues.reduce((sum, tw) => sum + tw.items.length, 0)} รายการ)</span>
          <span class="text-[11px] font-normal text-red-700">ต้องการการแก้ไข/ติดตาม</span>
        </div>

        <div class="space-y-3">
          ${tasksWithIssues.map(tw => `
            <div class="border border-red-200 rounded overflow-hidden bg-white text-xs">
              <!-- บรรทัดแรก: รหัสงาน ,ชื่อคำสั่งงาน -->
              <div class="bg-red-50 text-red-950 px-3 py-1.5 font-bold flex items-center gap-2 border-b border-red-200">
                <span class="font-mono bg-red-200 text-red-900 px-1.5 py-0.5 rounded text-[11px]">${Utils.escapeHtml(tw.taskCode)}</span>
                <span>${Utils.escapeHtml(tw.taskTitle)}</span>
              </div>

              <!-- บรรทัดต่อมาเป็น ลำดับ, ชื่อรายการย่อยที่ติดปัญหา ชิดซ้าย ,รายการปัญหา ชิดขวา -->
              <table class="w-full text-xs border-collapse">
                <thead class="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th class="py-1 px-2.5 text-center w-12">ลำดับ</th>
                    <th class="py-1 px-2.5 text-left">ชื่อรายการย่อยที่ติดปัญหา</th>
                    <th class="py-1 px-2.5 text-right w-64 text-red-700">รายการปัญหา</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-red-100">
                  ${tw.items.map(it => `
                    <tr class="hover:bg-red-50/40">
                      <td class="py-1.5 px-2.5 text-center font-mono text-slate-500">${it.order}</td>
                      <td class="py-1.5 px-2.5 text-left font-medium text-slate-800">${Utils.escapeHtml(it.name)}</td>
                      <td class="py-1.5 px-2.5 text-right font-semibold text-red-700">⚠️ ${Utils.escapeHtml(it.issue)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderTaskBlock(ts, idx) {
    const t = ts.task;
    const taskWageStr = formatMoneyText(ts.taskMarkupWage);
    const orderDateStr = t.order_date ? Utils.formatDate(t.order_date) : '-';
    const overallPct = Math.max(0, Math.min(100, Math.round(Number(t.progress_percent) || 0)));
    const subItems = Array.isArray(t.sub_items) ? t.sub_items : [];

    // ข้อมูลวันที่เข้าทำงาน พร้อมจำนวนคนงานในแต่ละวัน เช่น (27/10/69 = 5 คน, 28/10/69 = 6 คน)
    // รองรับกรณีมีวันทำงานมากกว่า 15 วัน ด้วยการจัดวางแบบป้ายย่อย (flex-wrap) เต็มความกว้าง
    let datesDetailHtml = '';
    if (ts.dailyWorkerCounts.length > 0) {
      const chipsHtml = ts.dailyWorkerCounts.map(item =>
        `<span class="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-300 font-mono text-[11px]">${Utils.escapeHtml(Utils.formatDate(item.date))} = <strong>&nbsp;${item.workerCount} คน</strong></span>`
      ).join('');
      datesDetailHtml = `
        <span class="ml-1 text-slate-600">(</span>
        <span class="inline-flex flex-wrap items-center gap-1 mx-0.5">${chipsHtml}</span>
        <span class="text-slate-600">)</span>
      `;
    } else {
      datesDetailHtml = `<span class="text-slate-500 ml-1">(ยังไม่มีวันเข้าทำในช่วงวันที่เลือก)</span>`;
    }

    const accumDays = Number(t.accumulated_days) || 0;
    const daysSummaryPrefix = accumDays > 0
      ? `เข้าทำรวม <strong>${ts.totalDaysAll} วัน</strong> — งวดก่อน ${accumDays} วัน + รอบนี้ <strong>${ts.daysInRange} วัน</strong>`
      : `เข้าทำงานแล้ว <strong>${ts.daysInRange} วัน</strong>`;

    // ตรวจสอบหมายเหตุงานค้างจากงวดงานก่อน
    const co = ts.carryOver;
    let carryOverHtml = '';
    if (co && co.isCarryOver) {
      const prevWageStr = formatMoneyText(co.prevMarkupCost);
      const prevPctStr = co.prevPercent !== null
        ? `ความคืบหน้าจากงวดก่อน <strong>${co.prevPercent}%</strong> ➔ ปัจจุบันทำต่อเป็น <strong>${overallPct}%</strong> (คืบหน้าเพิ่ม <strong>+${Math.max(0, overallPct - co.prevPercent)}%</strong>)`
        : `นำมาทำต่อในงวดปัจจุบันจนมีความคืบหน้ารวม <strong>${overallPct}%</strong>`;

      carryOverHtml = `
        <div class="mt-2 p-2.5 rounded bg-amber-50 border border-amber-300 text-xs text-amber-950">
          <div class="font-bold text-amber-900">
            🔄 หมายเหตุ: งานค้างต่อเนื่องจากงวดงานก่อน
          </div>
          <div class="mt-0.5">
            • <strong>ผลงานของงวดงานก่อน:</strong> เข้าทำไปแล้ว <strong>${co.prevDays} วัน</strong> (ค่าแรงงวดก่อน: <strong>${Utils.escapeHtml(prevWageStr)}</strong>)
            <span class="mx-1">|</span>
            ${prevPctStr}
          </div>
        </div>
      `;
    }

    return `
      <div class="task-item-block rounded-lg border ${ts.isUntouched ? 'border-dashed border-slate-300 bg-slate-50/20' : 'border-slate-300 bg-slate-50/40'} p-3.5">
        <!-- บรรทัดหัวข้อใบสั่งงานตามรูปแบบ: 1) TSK-202610-001 (สั่งงาน 23/10/69) ชื่องาน (ยอดค่าแรง 4,496 บาท ) สถานะ ความคืบหน้ารวม: 100% -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
          <div class="space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-900">
                ${idx}) ${Utils.escapeHtml(t.task_code || ('TSK-' + t.id))} (สั่งงาน ${Utils.escapeHtml(orderDateStr)})
              </span>
              <span class="font-semibold text-sm text-slate-900">
                ${Utils.escapeHtml(t.title || '-')}
              </span>
              <span class="font-mono text-xs font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                (ยอดค่าแรง ${Utils.escapeHtml(taskWageStr)} )
              </span>
            </div>
            ${t.description ? `<div class="text-xs text-slate-600 pl-1">รายละเอียดใบสั่งงาน: ${Utils.escapeHtml(t.description)}</div>` : ''}
          </div>

          <div class="flex items-center gap-2 shrink-0 flex-wrap">
            ${typeof Utils.renderTaskStatusBadge === 'function' ? Utils.renderTaskStatusBadge(t.status) : `<span class="badge">${Utils.escapeHtml(formatStatusText(t.status))}</span>`}
            <span class="px-2.5 py-0.5 rounded font-mono text-xs font-bold ${overallPct >= 100 ? 'bg-emerald-600 text-white' : (overallPct > 0 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700')}">
              ความคืบหน้ารวม: ${overallPct}%
            </span>
          </div>
        </div>

        <!-- แถวจำนวนวันที่เข้าทำงาน พร้อมจำนวนคนงานในแต่ละวัน (เต็มความกว้าง รองรับงานมากกว่า 15 วัน) -->
        <div class="mt-2.5 p-2 rounded bg-white border border-slate-200 text-xs text-slate-700 leading-relaxed">
          📅 <strong>จำนวนวันที่เข้าทำงาน:</strong> ${daysSummaryPrefix} ${datesDetailHtml}
        </div>

        ${carryOverHtml}

        <!-- ตารางรายการงานย่อย (% แยกตามรายการ — ลำดับและชื่องานชิดซ้าย %รายการนี้และสถานะชิดขวา) -->
        ${subItems.length > 0 ? `
          <div class="mt-3">
            <div class="text-xs font-semibold text-slate-700 mb-1.5">
              📋 รายการงานที่ต้องทำและความคืบหน้าแยกตามรายการ (${subItems.filter(s => s.status === 'Completed').length}/${subItems.length} รายการเสร็จแล้ว):
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs border-collapse bg-white border border-slate-200">
                <thead>
                  <tr class="bg-slate-100 text-slate-700 border-b border-slate-200">
                    <th class="py-1.5 px-2.5 text-center w-10">#</th>
                    <th class="py-1.5 px-2.5 text-left">รายการงานย่อย</th>
                    <th class="py-1.5 px-2.5 text-center w-24">% รายการนี้</th>
                    <th class="py-1.5 px-2.5 text-center w-28">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  ${subItems.map((sub, sIdx) => {
                    const subPct = Math.max(0, Math.min(100, Math.round(Number(sub.progress_percent) || 0)));
                    return `
                      <tr class="border-b border-slate-200 ${sub.status === 'Cancelled' ? 'opacity-50 line-through' : ''}">
                        <td class="py-1.5 px-2.5 text-center font-mono text-slate-500">${sIdx + 1}</td>
                        <td class="py-1.5 px-2.5 text-left font-medium text-slate-800 leading-snug">
                          ${Utils.escapeHtml(sub.name)}
                          ${sub.added_from_log ? '<span class="ml-1 px-1 py-0.2 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200">(งานเพิ่มหน้างาน)</span>' : ''}
                        </td>
                        <td class="py-1.5 px-2.5 text-center font-mono font-bold ${subPct >= 100 ? 'text-emerald-700' : (subPct > 0 ? 'text-blue-700' : 'text-slate-500')}">
                          ${subPct}%
                        </td>
                        <td class="py-1.5 px-2.5 text-center">${renderSubItemStatusPill(sub.status)}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderUnlinkedSiteLogsNotice(unlinkedLogs) {
    const byGroup = {};
    unlinkedLogs.forEach(l => {
      const gid = l.GroupID || 'unknown';
      if (!byGroup[gid]) {
        byGroup[gid] = {
          groupId: gid,
          date: l.Date,
          detail: l.JobDetail,
          markupSum: 0
        };
      }
      byGroup[gid].markupSum += l.TotalWithMarkup;
    });
    const groups = Object.values(byGroup);
    const totalMarkup = groups.reduce((s, g) => s + g.markupSum, 0);

    return `
      <div class="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs">
        <div class="font-bold text-amber-900 mb-1">
          ⚠️ รายงานประจำวันในหน้างานนี้ที่ยังไม่ได้เชื่อมโยงกับใบสั่งงาน (${groups.length} ใบงาน — รวม ${Utils.escapeHtml(formatMoneyText(totalMarkup))})
        </div>
        <ul class="list-disc list-inside space-y-0.5 text-amber-950">
          ${groups.map(g => `
            <li>
              วันที่ ${Utils.formatDate(g.date)}: ${Utils.escapeHtml(g.detail || '-')}
              <span class="font-mono font-semibold">(${Utils.escapeHtml(formatMoneyText(g.markupSum))})</span>
              <a href="daily-log.html?edit=${encodeURIComponent(g.groupId)}" class="no-print text-blue-700 underline ml-1">แก้ไข/ผูกงาน</a>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  init();
})();
