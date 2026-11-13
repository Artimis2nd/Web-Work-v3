/**
 * print-center.js
 * หน้าจัดการเอกสาร: ศูนย์รวมการสั่งพิมพ์เอกสารส่วนกลาง (Global Filter)
 * - 📷 รายงานภาพถ่ายหน้างาน (Smart Balanced Pagination)
 * - 📈 ภาพรวมงาน (Overview Report: ปฏิทินรอบวันทำงาน 2 เดือน + ตารางสรุปวันเข้างาน)
 * - 📋 สรุปสถานะและความคืบหน้า (Progress Summary)
 */
const PrintCenterPage = (() => {
  let allLogs = [];
  let allTasks = [];
  let allImages = {};
  let dayOverrides = {};
  let datePicker = null;

  let jobItems = [];

  let filterStartDate = '';
  let filterEndDate = '';

  const DAY_NAMES = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

  function formatDateThai(dateStr) {
    if (!dateStr) return '-';
    try {
      const parts = String(dateStr).split('T')[0].split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        const thYear = y > 2500 ? y : y + 543;
        const thYearShort = String(thYear).slice(-2);
        return `${d}/${m}/${thYearShort}`;
      }
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'numeric', year: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  function getTaskCodeOnly(log, task) {
    if (task && task.task_code) {
      return task.task_code;
    }
    const tId = log.TaskId || log.task_id || (log.Workers && log.Workers[0]?.task_id);
    if (tId) {
      const matched = allTasks.find(t => String(t.id) === String(tId));
      if (matched && matched.task_code) return matched.task_code;
      return `TSK-${String(tId).padStart(3, '0')}`;
    }
    return 'TSK-GENERAL';
  }

  /**
   * พรีโหลดรูปภาพทั้งหมดเข้าสู่แคชเบราว์เซอร์ล่วงหน้า
   */
  function preloadAllImages() {
    if (!jobItems || !jobItems.length) return;
    const allUrls = [];
    jobItems.forEach(j => {
      if (Array.isArray(j.images)) {
        j.images.forEach(u => allUrls.push(u));
      }
    });

    // ทยอยพรีโหลดรูปทีละชุด (Batch Preload) เพื่อไม่ให้กระทบ Socket
    let idx = 0;
    function loadNextBatch() {
      const batch = allUrls.slice(idx, idx + 6);
      idx += 6;
      batch.forEach(url => {
        const pre = new Image();
        pre.src = url;
      });
      if (idx < allUrls.length) {
        setTimeout(loadNextBatch, 100);
      }
    }
    loadNextBatch();
  }

  async function loadData() {
    try {
      const [logsRes, tasks, overrides] = await Promise.all([
        Api.getLogs(),
        Api.getTasks(),
        typeof Api.getCalendarDayOverrides === 'function' ? Api.getCalendarDayOverrides() : Promise.resolve({})
      ]);
      allLogs = Array.isArray(logsRes) ? logsRes : (logsRes?.logs || []);
      allTasks = tasks || [];
      dayOverrides = overrides || {};

      // ดึงรูปภาพทั้งหมดจาก Storage/Local
      if (typeof Api.getAllImages === 'function') {
        allImages = await Api.getAllImages();
      } else {
        const raw = localStorage.getItem('WAGE_LOCAL_IMAGES');
        allImages = raw ? JSON.parse(raw) : {};
      }

      processJobItems();
      preloadAllImages();
      populateSiteFilter();
      initDateRangePicker();
      renderPrintPreview();
    } catch (err) {
      console.error('Error loading print center data:', err);
      if (typeof Utils.toast === 'function') {
        Utils.toast('เกิดข้อผิดพลาดในการโหลดข้อมูล', 'error');
      }
    }
  }

  function processJobItems() {
    const groupMap = new Map();
    allLogs.forEach(l => {
      const gid = String(l.GroupID || l.group_id || '');
      if (!gid) return;
      if (!groupMap.has(gid)) {
        const tId = l.TaskId != null ? l.TaskId : (l.task_id != null ? l.task_id : (l.Workers && l.Workers[0]?.task_id));
        groupMap.set(gid, {
          groupId: gid,
          date: l.Date || l.work_date,
          site: l.Site || l.site || 'ไม่ระบุหน้างาน',
          jobDetail: l.JobDetail || l.job_detail || '',
          taskId: tId,
          requestedBy: l.RequestedBy || l.requested_by || ''
        });
      }
    });

    jobItems = [];
    groupMap.forEach(group => {
      const imgs = allImages[group.groupId] || [];
      if (Array.isArray(imgs) && imgs.length > 0) {
        const task = allTasks.find(t => String(t.id) === String(group.taskId));
        jobItems.push({
          ...group,
          task,
          taskCode: getTaskCodeOnly(group, task),
          images: imgs,
          imageCount: imgs.length
        });
      }
    });

    // เรียงตามวันที่แรกสุด ไปยังล่าสุด (Ascending)
    jobItems.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function populateSiteFilter() {
    const siteSelect = document.getElementById('filter-site');
    if (!siteSelect) return;
    
    // รวมหน้างานจากทั้ง allLogs และ jobItems
    const sitesSet = new Set();
    allLogs.forEach(l => { if (l.Site || l.site) sitesSet.add(l.Site || l.site); });
    jobItems.forEach(j => { if (j.site) sitesSet.add(j.site); });
    
    const sites = Array.from(sitesSet).sort();
    siteSelect.innerHTML = '<option value="">-- หน้างานทั้งหมด --</option>' +
      sites.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('');
  }

  function initDateRangePicker() {
    const rangeInput = document.getElementById('filter-date-range');
    if (!rangeInput || typeof Litepicker === 'undefined') return;

    if (datePicker) datePicker.destroy();

    datePicker = new Litepicker({
      element: rangeInput,
      singleMode: false,
      lang: 'th-TH',
      format: 'DD/MM/YYYY',
      numberOfMonths: 2,
      numberOfColumns: 2,
      setup: (picker) => {
        picker.on('selected', (d1, d2) => {
          if (d1 && d2) {
            filterStartDate = d1.format('YYYY-MM-DD');
            filterEndDate = d2.format('YYYY-MM-DD');
          } else {
            filterStartDate = '';
            filterEndDate = '';
          }
          renderPrintPreview();
        });
        picker.on('clear:selection', () => {
          filterStartDate = '';
          filterEndDate = '';
          renderPrintPreview();
        });
      }
    });
  }

  function getFilteredLogs() {
    const siteVal = (document.getElementById('filter-site')?.value || '').trim();

    return allLogs.filter(l => {
      const lSite = l.Site || l.site || '';
      const lDate = l.Date || l.work_date || '';
      if (siteVal && lSite !== siteVal) return false;
      if (filterStartDate && lDate < filterStartDate) return false;
      if (filterEndDate && lDate > filterEndDate) return false;
      return true;
    });
  }

  function getFilteredJobs() {
    const siteVal = (document.getElementById('filter-site')?.value || '').trim();

    return jobItems.filter(item => {
      if (siteVal && item.site !== siteVal) return false;
      if (filterStartDate && item.date < filterStartDate) return false;
      if (filterEndDate && item.date > filterEndDate) return false;
      return true;
    });
  }

  /**
   * เรนเดอร์ปฏิทินรายเดือนในแผ่นพิมพ์ A4
   */
  function renderPrintMonthCalendar(monthData) {
    if (!monthData) return '';
    return `
      <div class="border border-slate-300 rounded p-2 bg-white flex-1 flex flex-col justify-between">
        <div class="text-xs font-bold text-center text-slate-800 pb-1 mb-1 border-b border-slate-200">
          🗓️ ${Utils.escapeHtml(monthData.title)}
        </div>
        <div class="grid grid-cols-7 border-t border-l border-slate-200 text-center text-[9px] font-bold text-slate-600 bg-slate-100">
          ${DAY_NAMES.map(name => `<div class="py-0.5 border-r border-b border-slate-200">${name}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 border-l border-slate-200 text-center flex-1">
          ${monthData.cells.map(cell => {
            if (cell.isEmpty) {
              return `<div class="min-h-[38px] border-r border-b border-slate-200 bg-slate-50/20"></div>`;
            }
            if (cell.isWorkDay) {
              return `
                <div class="min-h-[38px] border-r border-b border-slate-200 p-0.5 flex flex-col items-center justify-between bg-emerald-50/60">
                  <div class="w-5 h-5 rounded-full bg-emerald-600 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[8.5px] font-bold text-emerald-800 leading-none">
                    ${cell.workerCount} คน
                  </div>
                </div>
              `;
            }
            if (cell.isFactoryDay) {
              return `
                <div class="min-h-[38px] border-r border-b border-slate-200 p-0.5 flex flex-col items-center justify-between bg-sky-50/60">
                  <div class="w-5 h-5 rounded-full bg-sky-500 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[8px] font-bold text-sky-700 leading-none">
                    โรงงาน
                  </div>
                </div>
              `;
            }
            if (cell.isCompanyHoliday) {
              return `
                <div class="min-h-[38px] border-r border-b border-slate-200 p-0.5 flex flex-col items-center justify-between bg-amber-50/60">
                  <div class="w-5 h-5 rounded-full bg-amber-500 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[8px] font-bold text-amber-700 leading-none">
                    หยุด
                  </div>
                </div>
              `;
            }
            if (cell.isOffDay) {
              return `
                <div class="min-h-[38px] border-r border-b border-slate-200 p-0.5 flex flex-col items-center justify-between bg-red-50/40">
                  <div class="w-5 h-5 rounded-full bg-red-100 text-red-700 border border-red-300 font-mono font-bold text-[10px] flex items-center justify-center">
                    ${cell.dayNumber}
                  </div>
                  <div class="text-[8px] font-semibold text-red-600 leading-none">
                    หยุดงาน
                  </div>
                </div>
              `;
            }
            return `
              <div class="min-h-[38px] border-r border-b border-slate-200 p-0.5 flex items-center justify-center bg-slate-50/10">
                <div class="text-xs font-semibold text-slate-700 font-mono">
                  ${cell.dayNumber}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  /**
   * เรนเดอร์ตารางสรุปวันเข้าทำงาน 2 ฝั่ง (ซ้าย-ขวา) สำหรับหน้า A4
   * ปรับขนาดตัวอักษรให้อ่านง่าย ชัดเจน ไม่ใช้ truncate ตัดคำ
   */
  function renderPrintDailyScheduleTable(dailySchedule = []) {
    if (!dailySchedule || !dailySchedule.length) {
      return `<div class="p-3 text-center text-xs text-slate-400 border border-slate-200 rounded">ไม่พบประวัติการเข้าทำงานตามช่วงที่เลือก</div>`;
    }

    const half = Math.ceil(dailySchedule.length / 2);
    const colLeft = dailySchedule.slice(0, half);
    const colRight = dailySchedule.slice(half);

    const renderCol = (items) => `
      <table class="w-full text-[11px] border-collapse border border-slate-300">
        <thead>
          <tr class="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold">
            <th class="py-1 px-1.5 text-center w-8 border-r border-slate-300">ลำดับ</th>
            <th class="py-1 px-2 text-center w-16 border-r border-slate-300">วันที่ทำงาน</th>
            <th class="py-1 px-2 text-left border-r border-slate-300">หน้างานที่ทำ</th>
            <th class="py-1 px-1.5 text-center w-14">จำนวนคน</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr class="border-b border-slate-200 hover:bg-slate-50">
              <td class="py-1 px-1.5 text-center font-mono text-slate-500 border-r border-slate-200">${item.index}</td>
              <td class="py-1 px-2 text-center font-semibold text-slate-800 border-r border-slate-200 whitespace-nowrap">${item.dateThai}</td>
              <td class="py-1 px-2 text-slate-800 border-r border-slate-200 break-words leading-tight">${Utils.escapeHtml(item.siteText)}</td>
              <td class="py-1 px-1.5 text-center font-bold text-emerald-700 whitespace-nowrap">${item.workerCount} คน</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    return `
      <div class="mt-2.5 pt-2 border-t border-slate-300 flex-1 flex flex-col justify-between">
        <div class="flex items-center justify-between mb-1.5">
          <div class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
            <span>📋 ตารางสรุปวันเข้าทำงาน (เรียงตามลำดับวันแรก – วันล่าสุด รวม ${dailySchedule.length} วัน)</span>
          </div>
          <div class="text-[9.5px] text-slate-500">
            * แสดงเฉพาะวันที่มีการลงงานจริง
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3 flex-1 items-start">
          <div>${renderCol(colLeft)}</div>
          <div>${colRight.length > 0 ? renderCol(colRight) : ''}</div>
        </div>
      </div>
    `;
  }

  /**
   * สร้างแผ่นพิมพ์ A4 ภาพรวมงาน (Overview Report)
   */
  function renderOverviewPrintSheet(filteredLogs) {
    const siteVal = (document.getElementById('filter-site')?.value || '').trim();
    const startDate = filterStartDate || null;
    const endDate = filterEndDate || null;

    const logic = typeof OverviewLogic !== 'undefined' ? OverviewLogic : (window.OverviewLogic || {});
    if (!logic.buildDualMonthCalendarData) return null;

    const calendarData = logic.buildDualMonthCalendarData(filteredLogs, startDate, endDate, dayOverrides);
    const dailySchedule = logic.buildDailyWorkScheduleSummary ? logic.buildDailyWorkScheduleSummary(filteredLogs, startDate, endDate) : [];

    const pageElem = document.createElement('div');
    pageElem.className = 'a4-print-page';

    // 1. หัวกระดาษ A4
    const header = document.createElement('div');
    header.className = 'border-b-2 border-slate-800 pb-1.5 mb-2 flex justify-between items-end';
    header.innerHTML = `
      <div>
        <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">รายงานสรุปภาพรวมงาน & ปฏิทินรอบวันทำงาน</div>
        <div class="text-lg font-bold text-slate-900 leading-tight">
          ${siteVal ? `โครงการ: ${Utils.escapeHtml(siteVal)}` : 'สรุปภาพรวมงานทุกโครงการ'}
        </div>
      </div>
      <div class="text-right">
        <span class="inline-block bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded text-xs font-bold text-slate-700">
          เอกสารภาพรวม
        </span>
      </div>
    `;
    pageElem.appendChild(header);

    // 2. กล่องปฏิทินรอบวันทำงาน
    const calendarBox = document.createElement('div');
    calendarBox.className = 'border border-slate-300 rounded p-2.5 bg-white mb-2';

    const rangeStr = calendarData.rangeText || (startDate && endDate ? `${formatDateThai(startDate)} - ${formatDateThai(endDate)}` : '-');
    const totalDays = calendarData.totalRangeDays || calendarData.totalCalendarDays || 0;
    const workDays = calendarData.totalWorkDays ?? calendarData.workDaysCount ?? 0;
    const factoryDays = calendarData.totalFactoryDays ?? calendarData.factoryDaysCount ?? 0;
    const companyHolidays = calendarData.totalCompanyHolidayDays ?? calendarData.companyHolidayCount ?? 0;
    const offDays = calendarData.totalOffDays ?? calendarData.offDaysCount ?? 0;

    calendarBox.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-1 mb-2">
        <div class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
          <span>📅 ปฏิทินรอบวันทำงาน (แสดง 2 เดือนต่อเนื่อง)</span>
          <span class="text-[10px] text-slate-500 font-normal">
            ช่วงเวลารอบงาน: ${rangeStr} | รวมทั้งหมด ${totalDays} วัน
          </span>
        </div>
        <div class="flex items-center gap-1.5 text-[10px] font-semibold">
          <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
            หน้างาน: ${workDays} วัน
          </span>
          <span class="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300">
            โรงงาน: ${factoryDays} วัน
          </span>
          ${companyHolidays > 0 ? `
            <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
              หยุดบริษัท: ${companyHolidays} วัน
            </span>
          ` : ''}
          <span class="px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300">
            ไม่ได้ทำงาน: ${offDays} วัน
          </span>
        </div>
      </div>

      <!-- สัญลักษณ์สี -->
      <div class="flex items-center gap-3 text-[9px] text-slate-600 mb-2 pb-1.5 border-b border-slate-200">
        <div class="flex items-center gap-1">
          <div class="w-2.5 h-2.5 rounded-full bg-emerald-600"></div>
          <span>ลงงานหน้างาน</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-2.5 h-2.5 rounded-full bg-sky-500"></div>
          <span>ทำงานที่โรงงาน</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-2.5 h-2.5 rounded-full bg-amber-500"></div>
          <span>วันหยุดบริษัท</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-2.5 h-2.5 rounded-full bg-red-100 border border-red-500"></div>
          <span>ไม่ได้ทำงานจริง</span>
        </div>
      </div>

      <!-- กริดปฏิทิน 2 เดือนเคียงกัน -->
      <div class="grid grid-cols-2 gap-2">
        ${renderPrintMonthCalendar(calendarData.month1)}
        ${renderPrintMonthCalendar(calendarData.month2)}
      </div>

      <!-- ตารางสรุปวันเข้าทำงานใต้ปฏิทิน -->
      ${renderPrintDailyScheduleTable(dailySchedule)}
    `;
    pageElem.appendChild(calendarBox);

    // 3. ท้ายกระดาษ (Footer)
    const footer = document.createElement('div');
    footer.className = 'pt-1.5 mt-auto border-t border-slate-200 flex justify-between text-[9px] text-slate-400';
    footer.innerHTML = `
      <div>ระบบคิดค่าแรงคนงาน &bull; เอกสารสรุปภาพรวมงานรอบงวด</div>
      <div>พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH')}</div>
    `;
    pageElem.appendChild(footer);

    return pageElem;
  }

  // ==========================================
  // ฟังก์ชันช่วยเหลือสำหรับรายงานค่าแรงรายวัน
  // ==========================================
  function formatWage(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatWorkerLine(w) {
    const name = w.workerName || w.FullName || w.worker_name || '(ไม่ระบุ)';
    const wageType = w.wageType || w.wage_type || 'hourly';
    const hours = Number(w.hours) || 0;
    const otHours = Number(w.otHours || w.ot_hours) || 0;
    const fixedAmount = Number(w.fixedAmount || w.fixed_amount) || 0;
    const rawWage = Number(w.RawWage || w.raw_wage || w.rawWage || 0);
    const totalWage = Number(w.TotalWithMarkup || w.total_with_markup || w.totalWithMarkup || rawWage);

    let detail = '';
    let wageDisplay = 0;

    if (wageType === 'fixed') {
      detail = 'เหมา';
      wageDisplay = fixedAmount || rawWage;
    } else {
      const parts = [];
      if (hours > 0) parts.push(`${hours} ชม.`);
      if (otHours > 0) parts.push(`OT ${otHours} ชม.`);
      if (hours === 0 && otHours === 0) parts.push('0 ชม.');
      detail = parts.join(' ');
      wageDisplay = totalWage;
    }

    return { name, detail, wageDisplay };
  }

  function calcSubTotals(workers) {
    let totalRaw = 0;
    let totalNormalOt = 0;
    let totalFixed = 0;

    (workers || []).forEach(w => {
      const rawWage = Number(w.RawWage || w.raw_wage || w.rawWage || 0);
      totalRaw += rawWage;

      const wageType = w.wageType || w.wage_type || 'hourly';
      if (wageType === 'fixed') {
        totalFixed += Number(w.fixedAmount || w.fixed_amount || w.FixedAmount || rawWage);
      } else {
        totalNormalOt += Number(w.TotalWithMarkup || w.total_with_markup || w.totalWithMarkup || rawWage);
      }
    });

    return { totalRaw, totalNormalOt, totalFixed, grandTotal: totalNormalOt + totalFixed };
  }

  function renderWageCard(group) {
    const dateStr = formatDateThai(group.date);
    const site = group.site || '(ไม่ระบุโครงการ)';
    const requestedBy = group.requestedBy || '(ไม่ระบุ)';
    const workers = group.workers || [];
    const { totalRaw, totalNormalOt, totalFixed, grandTotal } = calcSubTotals(workers);

    let workersGridHtml = '';
    if (workers.length > 0) {
      workersGridHtml = workers.map(w => {
        const info = formatWorkerLine(w);
        return `
          <div class="worker-item">
            <span class="worker-name-hours">• <strong>${Utils.escapeHtml(info.name)}</strong> (${info.detail})</span>
            <span class="worker-wage">${formatWage(info.wageDisplay)} บ.</span>
          </div>
        `;
      }).join('');
    } else {
      workersGridHtml = '<div class="worker-item" style="color:#94a3b8;">ไม่มีข้อมูลคนงานในบันทึกนี้</div>';
    }

    return `
      <div class="print-card">
        <div class="card-header">
          <div class="row-top">
            <div><span class="label">วันที่ :</span> <strong>${dateStr}</strong></div>
            <div><span class="label">โครงการ :</span> <strong>${Utils.escapeHtml(site)}</strong></div>
            <div><span class="label">ผู้สั่งงาน :</span> <strong>${Utils.escapeHtml(requestedBy)}</strong></div>
            <div><span class="label">จำนวน :</span> <strong>${workers.length} คน</strong></div>
          </div>
          <div class="row-detail">
            <span class="label">รายละเอียดงาน :</span> ${Utils.escapeHtml(group.jobDetail || '(ไม่ระบุ)')}
          </div>
        </div>

        <div class="card-workers-grid">
          ${workersGridHtml}
        </div>

        <div class="card-footer">
          <div class="totals-box">
            <div class="sub-row">รวมค่าแรงดิบ : ${formatWage(totalRaw)} บาท</div>
            <div class="sub-row">รวมค่าแรงปกติ+OT (รวม +20%) : ${formatWage(totalNormalOt)} บาท</div>
            <div class="sub-row">รวมค่าแรงเหมา (ไม่มี +20%) : ${formatWage(totalFixed)} บาท</div>
            <div class="total-row">รวมค่าแรงวันนี้ : ${formatWage(grandTotal)} บาท</div>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // ฟังก์ชันเรนเดอร์: 📋 รายงานสถานะและค่าแรง (Progress and Wage Report)
  // ==========================================
  function renderProgressAndWageSheets(filteredLogs) {
    const siteSelect = document.getElementById('filter-site');
    const selectedSite = siteSelect ? siteSelect.value.trim() : '';
    const shippingInput = document.getElementById('input-shipping-cost');
    const shippingCost = shippingInput ? (parseFloat(shippingInput.value) || 0) : 0;

    // 1. หาหน้างานทั้งหมดตามตัวกรอง
    const siteNamesSet = new Set();
    filteredLogs.forEach(l => {
      const s = (l.Site || l.site || '').trim();
      if (s) siteNamesSet.add(s);
    });

    if (selectedSite) {
      siteNamesSet.clear();
      if (filteredLogs.some(l => (l.Site || l.site || '').trim() === selectedSite)) {
        siteNamesSet.add(selectedSite);
      }
    } else {
      allTasks.forEach(t => {
        const ts = (t.site || '').trim();
        if (ts && filteredLogs.some(l => (l.Site || l.site || '').trim() === ts)) {
          siteNamesSet.add(ts);
        }
      });
    }

    const siteNames = Array.from(siteNamesSet).sort((a, b) => a.localeCompare(b, 'th'));
    if (siteNames.length === 0) return '';

    // 2. ประมวลผลข้อมูลแยกตามหน้างาน
    let grandTotalRaw = 0;
    let grandTotalNormalOt = 0;
    let grandTotalFixed = 0;
    let grandTotalSitesWage = 0;

    const siteDataList = [];

    siteNames.forEach(siteName => {
      const siteLogs = filteredLogs.filter(l => (l.Site || l.site || '').trim() === siteName);

      // ดึงคนงานทั้งหมดเพื่อคำนวณยอด 4 รายการ
      const allSiteWorkers = [];
      siteLogs.forEach(l => {
        if (Array.isArray(l.Workers) && l.Workers.length > 0) {
          l.Workers.forEach(w => allSiteWorkers.push(w));
        } else if (l.WorkerName || l.worker_name) {
          allSiteWorkers.push(l);
        }
      });

      const { totalRaw, totalNormalOt, totalFixed, grandTotal: siteGrandTotal } = calcSubTotals(allSiteWorkers);

      grandTotalRaw += totalRaw;
      grandTotalNormalOt += totalNormalOt;
      grandTotalFixed += totalFixed;
      grandTotalSitesWage += siteGrandTotal;

      const siteUniqueDates = Array.from(new Set(siteLogs.map(l => l.Date || l.work_date).filter(Boolean))).sort();

      // ใบสั่งงานในหน้างานนี้
      const siteTasks = allTasks.filter(t => (t.site || '').trim() === siteName);

      const activeTasks = [];
      siteTasks.forEach(t => {
        const taskLogs = siteLogs.filter(l => {
          const tId = l.TaskId != null ? l.TaskId : (l.task_id != null ? l.task_id : (l.Workers && l.Workers[0]?.task_id));
          return Number(tId) === Number(t.id);
        });

        const taskWorkers = [];
        taskLogs.forEach(l => {
          if (Array.isArray(l.Workers) && l.Workers.length > 0) {
            l.Workers.forEach(w => taskWorkers.push(w));
          } else if (l.WorkerName || l.worker_name) {
            taskWorkers.push(l);
          }
        });

        const { grandTotal: taskWage } = calcSubTotals(taskWorkers);
        const overallPct = Math.max(0, Math.min(100, Math.round(Number(t.progress_percent) || 0)));

        const isUntouched = taskLogs.length === 0 && overallPct === 0 && (t.status === 'Pending' || !t.status);
        if (!isUntouched || taskLogs.length > 0 || overallPct > 0 || (t.status && t.status !== 'Pending')) {
          let rawSubItems = t.sub_items;
          if (typeof rawSubItems === 'string') {
            try { rawSubItems = JSON.parse(rawSubItems); } catch(e) { rawSubItems = []; }
          }
          const subItems = Array.isArray(rawSubItems) ? rawSubItems : [];
          const unfinishedSubItems = subItems.filter(s => {
            const sPct = Number(s.progress_percent || s.percent || 0);
            return s.status !== 'Completed' && sPct < 100;
          });

          activeTasks.push({
            task: t,
            taskWage,
            overallPct,
            unfinishedSubItems
          });
        }
      });

      activeTasks.sort((a, b) => String(a.task.task_code || '').localeCompare(String(b.task.task_code || ''), 'th'));

      siteDataList.push({
        siteName,
        totalRaw,
        totalNormalOt,
        totalFixed,
        siteGrandTotal,
        siteUniqueDates,
        activeTasks
      });
    });

    const finalGrandTotal = grandTotalSitesWage + shippingCost;

    // คำนวณช่วงวันที่จริงจากตัวกรอง หรือดึงวันที่แรกสุด-ล่าสุดที่มีบันทึกงาน
    const allLogDates = filteredLogs.map(l => l.Date || l.work_date).filter(Boolean).sort();
    const effectiveStartDate = filterStartDate || allLogDates[0];
    const effectiveEndDate = filterEndDate || allLogDates[allLogDates.length - 1];

    let dateRangeText = '-';
    if (effectiveStartDate && effectiveEndDate) {
      if (effectiveStartDate === effectiveEndDate) {
        dateRangeText = formatDateThai(effectiveStartDate);
      } else {
        dateRangeText = `${formatDateThai(effectiveStartDate)} ถึง ${formatDateThai(effectiveEndDate)}`;
      }
    } else if (effectiveStartDate) {
      dateRangeText = formatDateThai(effectiveStartDate);
    } else if (effectiveEndDate) {
      dateRangeText = formatDateThai(effectiveEndDate);
    }

    // ฟังก์ชันสร้าง Top Grand Summary Card
    const renderTopGrandSummary = () => `
      <div class="border-2 border-slate-700 rounded-lg p-3 mb-3 bg-slate-50/80 shadow-2xs">
        <div class="flex items-center justify-between border-b border-slate-300 pb-1.5 mb-2">
          <div class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>📊 สรุปผลรวมค่าแรงทุกหน้างาน</span>
            ${selectedSite ? `<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-medium font-sans">เฉพาะโครงการ: ${Utils.escapeHtml(selectedSite)}</span>` : ''}
          </div>
          <div class="text-[11px] text-slate-600 font-medium">
            📅 ประจำงวดวันที่: <strong class="text-slate-900">${dateRangeText}</strong>
          </div>
        </div>

        <div class="grid grid-cols-12 gap-3 items-center">
          <!-- คอลัมน์ซ้าย: แจกแจงรายการ -->
          <div class="col-span-7 space-y-1 text-xs text-slate-700 pr-3 border-r border-slate-300">
            <div class="flex justify-between items-center">
              <span>• รวมค่าแรงดิบ :</span>
              <strong class="font-mono text-slate-900">${formatWage(grandTotalRaw)} บาท</strong>
            </div>
            <div class="flex justify-between items-center">
              <span>• รวมค่าแรงปกติ+OT (รวม +20%) :</span>
              <strong class="font-mono text-slate-900">${formatWage(grandTotalNormalOt)} บาท</strong>
            </div>
            <div class="flex justify-between items-center">
              <span>• รวมค่าแรงเหมา (ไม่มี +20%) :</span>
              <strong class="font-mono text-slate-900">${formatWage(grandTotalFixed)} บาท</strong>
            </div>
            <div class="flex justify-between items-center pt-1 border-t border-slate-200 font-semibold text-slate-900">
              <span>• รวมค่าแรงรวมทุกหน้างาน :</span>
              <span class="font-mono text-blue-700 font-bold">${formatWage(grandTotalSitesWage)} บาท</span>
            </div>
            <div class="flex justify-between items-center text-amber-900 font-medium bg-amber-100/60 px-1.5 py-0.5 rounded">
              <span>• ค่าขึ้นของ-ขนส่ง :</span>
              <strong class="font-mono text-amber-800">${formatWage(shippingCost)} บาท</strong>
            </div>
          </div>

          <!-- คอลัมน์ขวา: แยกคอลัมน์ชัดเจน ล้อมกรอบเส้นชัดเจน สรุปค่าแรงรวมทั้งหมด -->
          <div class="col-span-5 flex flex-col justify-center items-center p-3 bg-white border-2 border-slate-900 rounded-lg shadow-xs text-center">
            <div class="text-[11px] font-bold text-slate-900 uppercase tracking-wide mb-1">
              สรุปค่าแรงรวมทั้งหมดของงวดงานนี้
            </div>
            <div class="text-2xl font-black text-black font-mono tracking-tight leading-none my-1">
              ${formatWage(finalGrandTotal)} บาท
            </div>
            <div class="text-[9.5px] text-slate-500 font-medium">
              (รวมทุกหน้างาน + ค่าขึ้นของ-ขนส่ง)
            </div>
          </div>
        </div>
      </div>
    `;

    // ฟังก์ชันสร้าง Card ของแต่ละหน้างาน
    const renderSiteCardHtml = (sg, sIdx) => `
      <div class="border border-slate-300 rounded-lg overflow-hidden mb-3 bg-white shadow-2xs">
        <!-- Expanded Header ของแต่ละหน้างาน (ปรับเพื่อการพิมพ์ขาวดำ คมชัด อ่านง่าย ไม่เปลืองหมึก) -->
        <div class="bg-slate-100 border-b border-slate-300 p-2 text-slate-900">
          <div class="flex items-center justify-between text-xs font-bold mb-1.5 pb-1 border-b border-slate-200">
            <div class="text-xs sm:text-sm text-slate-900 font-bold flex items-center gap-1.5">
              <span>📍 ${sIdx + 1}. ${Utils.escapeHtml(sg.siteName)}</span>
            </div>
            <div class="text-[10.5px] font-semibold text-slate-700">
              เข้าทำหน้างานนี้รวม <strong class="text-slate-950 font-bold">${sg.siteUniqueDates.length} วัน</strong>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-2 text-center bg-white border border-slate-300 px-3 py-2 rounded shadow-2xs">
            <div class="border-r border-slate-200 pr-2">
              <div class="text-[11px] text-slate-600 font-medium">รวมค่าแรงดิบ</div>
              <div class="text-xs sm:text-[13px] font-bold font-mono text-black mt-0.5">${formatWage(sg.totalRaw)} บ.</div>
            </div>
            <div class="border-r border-slate-200 pr-2">
              <div class="text-[11px] text-slate-600 font-medium">ปกติ+OT (+20%)</div>
              <div class="text-xs sm:text-[13px] font-bold font-mono text-black mt-0.5">${formatWage(sg.totalNormalOt)} บ.</div>
            </div>
            <div class="border-r border-slate-200 pr-2">
              <div class="text-[11px] text-slate-600 font-medium">เหมา (ไม่มี+20%)</div>
              <div class="text-xs sm:text-[13px] font-bold font-mono text-black mt-0.5">${formatWage(sg.totalFixed)} บ.</div>
            </div>
            <div class="pl-2">
              <div class="text-[11px] text-slate-900 font-bold">รวมหน้างานนี้</div>
              <div class="text-xs sm:text-[14px] font-black font-mono text-black mt-0.5">${formatWage(sg.siteGrandTotal)} บ.</div>
            </div>
          </div>
        </div>

        <!-- รายการใบสั่งงานในหน้างานนี้ -->
        <div class="p-2 space-y-1.5 text-xs">
          ${sg.activeTasks.length > 0 ? sg.activeTasks.map((item, tIdx) => {
            const t = item.task;
            const statusIcon = (t.status === 'Completed' || item.overallPct >= 100)
              ? '✅'
              : (t.status === 'Blocked' ? '⚠️' : (t.status === 'In Progress' ? '🔄' : '⏳'));
            const pctColorClass = (t.status === 'Completed' || item.overallPct >= 100)
              ? 'text-emerald-700 bg-emerald-50 border-emerald-300'
              : (t.status === 'Blocked' ? 'text-red-700 bg-red-50 border-red-300' : 'text-blue-700 bg-blue-50 border-blue-300');

            return `
              <div class="border-b border-slate-100 last:border-0 pb-1.5 pt-0.5">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex items-start gap-1.5 min-w-0 max-w-[68%] pr-4">
                    <span class="font-mono font-bold text-slate-800 shrink-0 mt-0.5">${tIdx + 1}) ${Utils.escapeHtml(t.task_code || ('TSK-' + t.id))}</span>
                    <span class="text-slate-900 font-medium break-words leading-snug">${Utils.escapeHtml(t.title || '-')}</span>
                  </div>
                  <div class="font-mono font-bold text-xs shrink-0 whitespace-nowrap flex items-center gap-2 mt-0.5">
                    <span class="font-normal text-slate-600 font-mono">(ค่าแรง ${formatWage(item.taskWage)} บาท )</span>
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10.5px] font-semibold ${pctColorClass}">
                      ${statusIcon} ${item.overallPct}%
                    </span>
                  </div>
                </div>

                <!-- กรณีไม่ครบ 100% ดึงรายการย่อยที่ยังไม่เสร็จมาแสดง -->
                ${item.overallPct < 100 ? `
                  <div class="ml-5 mt-1 pl-2.5 border-l-2 border-amber-400 bg-amber-50/70 rounded-r py-1 px-2 text-[10.5px] space-y-1">
                    <div class="font-semibold text-amber-900 flex items-center gap-1">
                      <span>⚠️ งานส่วนที่ยังไม่เสร็จ (ความคืบหน้า ${item.overallPct}%):</span>
                    </div>
                    ${item.unfinishedSubItems.length > 0 ? item.unfinishedSubItems.map((sub, subIdx) => {
                      const subPct = Math.max(0, Math.min(100, Math.round(Number(sub.progress_percent || sub.percent || 0))));
                      const subStatusText = sub.status === 'In Progress' ? 'กำลังดำเนินการ' : (sub.status === 'Blocked' ? 'ติดปัญหา' : 'รอเริ่มทำ');
                      const subName = sub.name || sub.title || `รายการย่อยที่ ${subIdx + 1}`;
                      return `
                        <div class="flex items-start justify-between gap-6 text-slate-700 pl-1">
                          <div class="max-w-[70%] min-w-0 break-words leading-tight pr-6">
                            • <span class="font-medium text-slate-800">${Utils.escapeHtml(subName)}</span>
                            ${sub.issue_note && sub.issue_note !== '-' ? `<span class="text-red-600 font-normal ml-1">(${Utils.escapeHtml(sub.issue_note)})</span>` : ''}
                          </div>
                          <div class="shrink-0 font-mono text-[10.5px] text-slate-600 flex items-center gap-1.5 whitespace-nowrap pt-0.5">
                            <span>สถานะ: ${subStatusText}</span>
                            <span class="font-bold text-slate-700">(${subPct}%)</span>
                          </div>
                        </div>
                      `;
                    }).join('') : `
                      <div class="text-[10px] text-slate-500 italic pl-1">
                        (รายการหลักยังไม่ครบ 100% โดยไม่มีการแตกรายการย่อยในระบบ)
                      </div>
                    `}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('') : `
            <div class="text-slate-400 text-center py-2 text-xs italic">ไม่มีรายการใบสั่งงานที่เข้าดำเนินการในช่วงเวลานี้</div>
          `}
        </div>
      </div>
    `;

    // 3. จัดหน้าลงในแผ่น A4 (Dynamic Pagination)
    const pages = [];
    let currentPageSites = [];
    let currentUnits = 6; // เริ่มต้นด้วย Top Grand Summary Card
    let isFirstPage = true;

    siteDataList.forEach((sg, sIdx) => {
      let siteUnits = 3 + (sg.activeTasks.length * 1.1);
      sg.activeTasks.forEach(at => {
        if (at.overallPct < 100) {
          siteUnits += Math.max(1, at.unfinishedSubItems.length * 0.7);
        }
      });

      const maxUnits = isFirstPage ? 23 : 26;
      if (currentPageSites.length > 0 && (currentUnits + siteUnits > maxUnits)) {
        pages.push({ isFirst: isFirstPage, sites: currentPageSites });
        currentPageSites = [{ sg, sIdx }];
        currentUnits = siteUnits;
        isFirstPage = false;
      } else {
        currentPageSites.push({ sg, sIdx });
        currentUnits += siteUnits;
      }
    });

    if (currentPageSites.length > 0) {
      pages.push({ isFirst: isFirstPage, sites: currentPageSites });
    }

    const totalPages = pages.length;
    let fullHtml = '';

    pages.forEach((p, pIdx) => {
      const pageNum = pIdx + 1;
      fullHtml += `
        <div class="a4-print-page">
          <!-- ส่วนหัวเอกสาร A4 -->
          <div class="border-b-2 border-slate-800 pb-2 mb-3 flex justify-between items-end gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
                ระบบจัดการและพิมพ์เอกสารส่วนกลาง
              </div>
              <div class="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                📋 รายงานสรุปสถานะความคืบหน้างานและค่าแรง ${totalPages > 1 ? `(แผ่นที่ ${pageNum})` : ''}
              </div>
            </div>
            <div class="text-right shrink-0">
              <span class="inline-block bg-slate-100 border border-slate-300 px-3 py-1 rounded text-xs font-bold text-slate-700">
                หน้า ${pageNum} / ${totalPages}
              </span>
            </div>
          </div>

          <!-- เนื้อหาในแผ่น A4 -->
          <div class="flex-1 flex flex-col justify-start">
            ${p.isFirst ? renderTopGrandSummary() : ''}
            <div>
              ${p.sites.map(item => renderSiteCardHtml(item.sg, item.sIdx)).join('')}
            </div>
          </div>

          <!-- ส่วนท้ายกระดาษ (Footer) -->
          <div class="pt-1.5 mt-auto border-t border-slate-200 flex justify-between text-[9px] text-slate-400">
            <div>ระบบคิดค่าแรงคนงาน &bull; รายงานสถานะและค่าแรงรายโครงการ</div>
            <div>พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH')}</div>
          </div>
        </div>
      `;
    });

    return fullHtml;
  }

  function renderWageReportSheets(filteredLogs) {
    const groupMap = new Map();

    filteredLogs.forEach(row => {
      const gid = String(row.GroupID || row.group_id || '');
      if (!gid) return;

      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          groupId: gid,
          date: row.Date || row.work_date,
          site: row.Site || row.site || '(ไม่ระบุโครงการ)',
          jobDetail: row.JobDetail || row.job_detail || '',
          requestedBy: row.RequestedBy || row.requested_by || '',
          workers: []
        });
      }

      if (Array.isArray(row.Workers) && row.Workers.length > 0) {
        groupMap.get(gid).workers = row.Workers;
      } else if (row.WorkerName || row.worker_name) {
        groupMap.get(gid).workers.push(row);
      }
    });

    const groupsData = Array.from(groupMap.values());
    if (!groupsData.length) return '';

    // แยกกลุ่มตามหน้างาน (Site) เพื่อให้ขึ้นหน้าใหม่เมื่อขึ้นหน้างานใหม่
    const bySite = new Map();
    groupsData.forEach(g => {
      const siteName = (g.site || '(ไม่ระบุโครงการ)').trim();
      if (!bySite.has(siteName)) bySite.set(siteName, []);
      bySite.get(siteName).push(g);
    });

    let fullHtml = '';

    bySite.forEach((siteGroups, siteName) => {
      // เรียงลำดับวันที่แรกสุดไปยังล่าสุด
      siteGroups.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return da - db;
      });

      let siteGrandTotal = 0;
      siteGroups.forEach(g => {
        const { grandTotal } = calcSubTotals(g.workers);
        siteGrandTotal += grandTotal;
      });

      // จัดแบ่งหน้ากระดาษ A4 หน้าละ 3-4 ใบงาน พร้อมหัวกระดาษและเลขหน้ากำกับทุกแผ่น
      const cardsPerPage = 3;
      const totalPages = Math.ceil(siteGroups.length / cardsPerPage);

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageCards = siteGroups.slice((pageNum - 1) * cardsPerPage, pageNum * cardsPerPage);

        fullHtml += `
          <div class="a4-print-page">
            <!-- ส่วนหัวเอกสาร A4 ประจำหน้า (Header พร้อมชื่อโครงการ ยอดรวมกรอบแดง และเลขหน้า - บังคับบรรทัดเดียวเสมอ) -->
            <div class="border-b-2 border-slate-800 pb-2 mb-3.5 flex justify-between items-end gap-3">
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">รายงานสรุปบันทึกค่าแรงคนงานประจำวัน</div>
                <div class="flex items-center gap-2.5 whitespace-nowrap overflow-hidden">
                  <span class="text-base sm:text-lg font-bold text-slate-900 leading-tight shrink-0">
                    โครงการ: ${Utils.escapeHtml(siteName)}
                  </span>
                  <span class="text-base sm:text-lg font-bold text-slate-900 bg-white border-2 border-red-500 px-2.5 py-0.5 rounded shadow-xs font-mono shrink-0">
                    ยอดรวมโครงการ: ${formatWage(siteGrandTotal)} บ.
                  </span>
                </div>
              </div>
              <div class="text-right shrink-0">
                <span class="inline-block bg-slate-100 border border-slate-300 px-3 py-1 rounded text-xs font-bold text-slate-700">
                  หน้า ${pageNum} / ${totalPages}
                </span>
              </div>
            </div>

            <!-- รายการใบงานในหน้านี้ (3-4 ใบงานต่อแผ่นพอดี) -->
            <div class="flex-1 flex flex-col justify-start gap-2">
              ${pageCards.map(renderWageCard).join('')}
            </div>

            <!-- ส่วนท้ายกระดาษ (Footer) -->
            <div class="pt-1.5 mt-auto border-t border-slate-200 flex justify-between text-[9px] text-slate-400">
              <div>ระบบคิดค่าแรงคนงาน &bull; เอกสารแจกแจงค่าแรงรายวัน</div>
              <div>พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH')}</div>
            </div>
          </div>
        `;
      }
    });

    return fullHtml;
  }

  function calculateBalancedPageSlices(totalPhotos) {
    if (totalPhotos <= 0) return [];
    if (totalPhotos <= 14) {
      return [{ count: totalPhotos, cols: totalPhotos <= 6 ? 3 : (totalPhotos <= 8 ? 4 : (totalPhotos <= 12 ? 3 : 4)), rows: totalPhotos <= 6 ? 2 : (totalPhotos <= 8 ? 2 : (totalPhotos <= 12 ? 4 : 4)) }];
    }

    const pageCount = Math.ceil(totalPhotos / 12);
    const basePer = Math.floor(totalPhotos / pageCount);
    let remainder = totalPhotos % pageCount;

    const pages = [];
    for (let i = 0; i < pageCount; i++) {
      const count = basePer + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      let cols = 3;
      let rows = 4;
      if (count <= 6) { cols = 3; rows = 2; }
      else if (count <= 8) { cols = 4; rows = 2; }
      else if (count <= 9) { cols = 3; rows = 3; }
      else if (count <= 12) { cols = 3; rows = 4; }
      else { cols = 4; rows = 4; }

      pages.push({ count, cols, rows });
    }
    return pages;
  }

  function renderPrintPreview() {
    const printArea = document.getElementById('printable-area');
    if (!printArea) return;

    const printOverviewChecked = document.getElementById('chk-print-overview')?.checked ?? true;
    const printProgressChecked = document.getElementById('chk-print-progress')?.checked ?? false;
    const printWageChecked = document.getElementById('chk-print-wage')?.checked ?? false;
    const printPhotosChecked = document.getElementById('chk-print-photos')?.checked ?? false;

    if (!printPhotosChecked && !printOverviewChecked && !printWageChecked && !printProgressChecked) {
      printArea.innerHTML = `
        <div class="a4-print-page flex items-center justify-center text-slate-400 p-12 text-center">
          <div>
            <div class="text-4xl mb-3">🖨️</div>
            <div class="text-base font-semibold">ยังไม่ได้เลือกรายงานสำหรับพิมพ์</div>
            <div class="text-sm">กรุณาติ๊กเลือกประเภทเอกสารที่ต้องการด้านบน</div>
          </div>
        </div>
      `;
      return;
    }

    printArea.innerHTML = '';

    // ==========================================
    // 1. เรนเดอร์หน้าภาพรวมงาน (Overview Report) ถ้าเลือก
    // ==========================================
    if (printOverviewChecked) {
      const filteredLogs = getFilteredLogs();
      const overviewPage = renderOverviewPrintSheet(filteredLogs);
      if (overviewPage) {
        printArea.appendChild(overviewPage);
      }
    }

    // ==========================================
    // 2. เรนเดอร์หน้ารายงานสถานะและค่าแรง (Progress and Wage Report) ถ้าเลือก
    // ==========================================
    if (printProgressChecked) {
      const filteredLogs = getFilteredLogs();
      const progressHtml = renderProgressAndWageSheets(filteredLogs);
      if (progressHtml) {
        const progressWrapper = document.createElement('div');
        progressWrapper.className = 'progress-report-wrapper';
        progressWrapper.innerHTML = progressHtml;
        printArea.appendChild(progressWrapper);
      }
    }

    // ==========================================
    // 3. เรนเดอร์หน้ารายงานค่าแรงรายวัน (Wage Report) ถ้าเลือก
    // ==========================================
    if (printWageChecked) {
      const filteredLogs = getFilteredLogs();
      const wageHtml = renderWageReportSheets(filteredLogs);
      if (wageHtml) {
        const wageWrapper = document.createElement('div');
        wageWrapper.className = 'wage-report-wrapper';
        wageWrapper.innerHTML = wageHtml;
        printArea.appendChild(wageWrapper);
      } else if (!printOverviewChecked && !printProgressChecked && !printPhotosChecked) {
        printArea.innerHTML = `
          <div class="a4-print-page flex items-center justify-center text-slate-400 p-12 text-center">
            <div>
              <div class="text-4xl mb-3">📄</div>
              <div class="text-base font-semibold">ไม่พบบันทึกค่าแรงตามเงื่อนไขที่เลือก</div>
              <div class="text-sm">ลองปรับตัวกรองหน้างานหรือช่วงวันที่ใหม่อีกครั้ง</div>
            </div>
          </div>
        `;
        return;
      }
    }

    // ==========================================
    // 4. เรนเดอร์หน้ารายงานภาพถ่ายหน้างาน ถ้าเลือก
    // ==========================================
    if (printPhotosChecked) {
      const filtered = getFilteredJobs();
      if (filtered.length === 0 && !printOverviewChecked) {
        printArea.innerHTML = `
          <div class="a4-print-page flex items-center justify-center text-slate-400 p-12 text-center">
            <div>
              <div class="text-4xl mb-3">📄</div>
              <div class="text-base font-semibold">ไม่พบรูปภาพตามเงื่อนไขที่เลือก</div>
              <div class="text-sm">ลองปรับตัวกรองหน้างานหรือช่วงวันที่ใหม่อีกครั้ง</div>
            </div>
          </div>
        `;
        return;
      }

      // แยกกลุ่มตามหน้างาน (Site) เพื่อขึ้นหน้าใหม่แยกจากกันเสมอ
      const siteGroups = new Map();
      filtered.forEach(job => {
        const s = job.site || 'ไม่ระบุหน้างาน';
        if (!siteGroups.has(s)) siteGroups.set(s, []);
        siteGroups.get(s).push(job);
      });

      siteGroups.forEach((jobsAtSite, siteName) => {
        const sitePhotos = [];
        jobsAtSite.forEach(job => {
          job.images.forEach((imgUrl, imgIdx) => {
            sitePhotos.push({
              imgUrl,
              date: job.date,
              taskCode: job.taskCode,
              imgIndex: imgIdx + 1
            });
          });
        });

        if (sitePhotos.length === 0) return;

        const pageLayouts = calculateBalancedPageSlices(sitePhotos.length);
        const totalPages = pageLayouts.length;

        let photoOffset = 0;
        pageLayouts.forEach((layout, pageIdx) => {
          const pageNum = pageIdx + 1;
          const pagePhotos = sitePhotos.slice(photoOffset, photoOffset + layout.count);
          photoOffset += layout.count;

          const pageElem = document.createElement('div');
          pageElem.className = 'a4-print-page';

          // ส่วนหัวเอกสาร A4
          const header = document.createElement('div');
          header.className = 'border-b-2 border-slate-800 pb-1.5 mb-2.5 flex justify-between items-end';
          header.innerHTML = `
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">รายงานรูปถ่ายบันทึกการทำงานประจำวัน</div>
              <div class="text-lg font-bold text-slate-900 leading-tight">โครงการ: ${Utils.escapeHtml(siteName)}</div>
            </div>
            <div class="text-right">
              <span class="inline-block bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded text-xs font-bold text-slate-700">
                หน้า ${pageNum} / ${totalPages}
              </span>
            </div>
          `;
          pageElem.appendChild(header);

          // ตารางรูปภาพ
          const gridElem = document.createElement('div');
          gridElem.className = `photo-grid grid-cols-${layout.cols} grid-rows-${layout.rows}`;

          pagePhotos.forEach(p => {
            const frame = document.createElement('div');
            frame.className = 'photo-frame';

            const imgWrap = document.createElement('div');
            imgWrap.className = 'photo-img-wrap';

            const img = document.createElement('img');
            img.src = p.imgUrl;
            img.loading = 'eager';
            img.decoding = 'async';
            img.alt = p.taskCode;

            // ระบบลองโหลดซ้ำอัตโนมัติ (Auto-Retry on Error สูงสุด 3 ครั้ง)
            let retryCount = 0;
            img.onerror = () => {
              if (retryCount < 3) {
                retryCount++;
                setTimeout(() => {
                  img.src = p.imgUrl + (p.imgUrl.includes('?') ? '&' : '?') + 'retry=' + Date.now();
                }, 300 * retryCount);
              }
            };

            imgWrap.appendChild(img);
            frame.appendChild(imgWrap);

            const caption = document.createElement('div');
            caption.className = 'px-1.5 py-1 bg-white text-[11px] border-t border-slate-200 flex justify-between items-center';
            caption.innerHTML = `
              <span class="font-bold text-blue-700 font-mono tracking-tight">${Utils.escapeHtml(p.taskCode)}</span>
              <span class="text-slate-500 font-mono text-[10px] ml-1 shrink-0">${formatDateThai(p.date)}</span>
            `;
            frame.appendChild(caption);

            gridElem.appendChild(frame);
          });

          // เติมช่องว่างให้เต็มกริด
          const totalSlots = layout.cols * layout.rows;
          const emptySlots = totalSlots - pagePhotos.length;
          for (let i = 0; i < emptySlots; i++) {
            const emptyFrame = document.createElement('div');
            emptyFrame.className = 'border border-dashed border-slate-200 rounded bg-slate-50/40';
            gridElem.appendChild(emptyFrame);
          }

          pageElem.appendChild(gridElem);

          // ส่วนท้ายกระดาษ
          const footer = document.createElement('div');
          footer.className = 'pt-1.5 mt-auto border-t border-slate-200 flex justify-between text-[9px] text-slate-400';
          footer.innerHTML = `
            <div>ระบบคิดค่าแรงคนงาน &bull; เอกสารแนบภาพถ่ายหน้างาน</div>
            <div>พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH')}</div>
          `;
          pageElem.appendChild(footer);

          printArea.appendChild(pageElem);
        });
      });
    }
  }

  function initUI() {
    Utils.renderShell('print-center.html', '🖨️ จัดการเอกสาร');

    const mainContainer = document.querySelector('main');
    if (!mainContainer) return;

    mainContainer.innerHTML = `
      <!-- Control Bar (Global Filters & Action) -->
      <div class="no-print space-y-4 mb-6">
        <div class="ledger-card p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
                <span>🖨️</span> ศูนย์จัดการเอกสารและสั่งพิมพ์รายงาน
              </h2>
              <p class="text-xs text-slate-500 mt-0.5">
                กำหนดเงื่อนไขหน้างานและช่วงวันที่ส่วนกลาง แล้วเลือกประเภทรายงานที่ต้องการพิมพ์ A4
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button id="btn-print" class="btn btn-primary px-5 py-2.5 font-semibold flex items-center gap-2 shadow">
                <span>🖨️ พิมพ์เอกสาร (Print A4)</span>
              </button>
            </div>
          </div>

          <!-- แผงตัวกรองส่วนกลาง (Global Filter Panel) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">🏗️ หน้างาน / โครงการ (ส่วนกลาง)</label>
              <select id="filter-site" class="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white">
                <option value="">-- หน้างานทั้งหมด --</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">📅 ช่วงวันที่ทำงาน (คลิกเพื่อเลือกช่วงวัน)</label>
              <input type="text" id="filter-date-range" class="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white cursor-pointer" placeholder="วว/ดด/ปป - วว/ดด/ปป (คลิกเลือกช่วงวันที่)">
            </div>
          </div>
        </div>

        <!-- การ์ดตัวเลือกรายงานสำหรับสั่งพิมพ์ (เรียง 4 การ์ด) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          
          <!-- การ์ด 1: ภาพรวมงาน (เปิดใช้งานเป็นค่าเริ่มต้น) -->
          <div class="ledger-card bg-white border-2 border-emerald-500 rounded-lg shadow-sm p-3.5 flex flex-col justify-between">
            <div class="flex items-start gap-2.5">
              <input type="checkbox" id="chk-print-overview" class="mt-1 cursor-pointer w-4 h-4 text-emerald-600 rounded" checked>
              <div>
                <label for="chk-print-overview" class="font-bold text-slate-900 cursor-pointer text-xs block">
                  📈 ภาพรวมงาน (Overview Report)
                </label>
                <p class="text-[11px] text-slate-500 mt-1 leading-snug">
                  พิมพ์ปฏิทินรอบวันทำงาน 2 เดือนต่อเนื่อง และตารางสรุปวันเข้างาน
                </p>
                <div class="mt-2 inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                  ✓ แสดงผลเป็นค่าเริ่มต้น
                </div>
              </div>
            </div>
          </div>

          <!-- การ์ด 2: รายงานสถานะและค่าแรง (เปิดใช้งานแล้ว) -->
          <div class="ledger-card bg-white border-2 border-indigo-500 rounded-lg shadow-sm p-3.5 flex flex-col justify-between">
            <div class="flex items-start gap-2.5">
              <input type="checkbox" id="chk-print-progress" class="mt-1 cursor-pointer w-4 h-4 text-indigo-600 rounded">
              <div class="flex-1 min-w-0">
                <label for="chk-print-progress" class="font-bold text-slate-900 cursor-pointer text-xs block">
                  📋 รายงานสถานะและค่าแรง
                </label>
                <p class="text-[11px] text-slate-500 mt-1 leading-snug">
                  สรุปความคืบหน้าแยกตามหน้างาน ที่มาของยอดรวมค่าแรง และงานย่อยที่ยังไม่เสร็จ
                </p>
                <div class="mt-2.5 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded p-1.5">
                  <label for="input-shipping-cost" class="text-[11px] font-semibold text-slate-700 shrink-0">
                    ค่าขึ้นของ-ขนส่ง (บ.):
                  </label>
                  <input type="number" id="input-shipping-cost" min="0" step="any" placeholder="0.00"
                    class="w-28 px-2 py-0.5 border border-slate-300 rounded text-xs text-right font-mono focus:border-indigo-500 focus:outline-none bg-white">
                </div>
              </div>
            </div>
          </div>

          <!-- การ์ด 3: รายงานค่าแรงรายวัน (เปิดใช้งานแล้ว) -->
          <div class="ledger-card bg-white border-2 border-amber-500 rounded-lg shadow-sm p-3.5 flex flex-col justify-between">
            <div class="flex items-start gap-2.5">
              <input type="checkbox" id="chk-print-wage" class="mt-1 cursor-pointer w-4 h-4 text-amber-600 rounded">
              <div>
                <label for="chk-print-wage" class="font-bold text-slate-900 cursor-pointer text-xs block">
                  💵 รายงานค่าแรงรายวัน
                </label>
                <p class="text-[11px] text-slate-500 mt-1 leading-snug">
                  พิมพ์รายงานสรุปค่าแรง 3 คอลัมน์ แยกตามโครงการ และขึ้นหน้าใหม่
                </p>
                <div class="mt-2 inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium">
                  ✓ จัด 3 คอลัมน์ แยกหน้างาน
                </div>
              </div>
            </div>
          </div>

          <!-- การ์ด 4: รายงานภาพถ่ายหน้างาน -->
          <div class="ledger-card bg-white border-2 border-blue-500 rounded-lg shadow-sm p-3.5 flex flex-col justify-between">
            <div class="flex items-start gap-2.5">
              <input type="checkbox" id="chk-print-photos" class="mt-1 cursor-pointer w-4 h-4 text-blue-600 rounded">
              <div>
                <label for="chk-print-photos" class="font-bold text-slate-900 cursor-pointer text-xs block">
                  📷 รายงานภาพถ่ายหน้างาน
                </label>
                <p class="text-[11px] text-slate-500 mt-1 leading-snug">
                  จัดหน้าสมดุลอัตโนมัติ (เฉลี่ยเท่ากัน ไม่เหลือเศษรูปเดี่ยว) แยกตามโครงการ
                </p>
                <div class="mt-2 inline-flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-medium">
                  ✓ จัดรูปแนวนอนและลงรหัสงาน
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- หัวข้อแสดงตัวอย่างพิมพ์ A4 -->
      <div class="no-print mb-3 flex items-center justify-between">
        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider">
          ตัวอย่างหน้ากระดาษพิมพ์ A4 (Print Preview)
        </div>
        <div class="text-xs text-slate-400">
          * แสดงตัวอย่างเอกสารตามรายการที่เลือกติ๊กถูกด้านบน
        </div>
      </div>

      <!-- พื้นที่สำหรับพิมพ์จริง และแสดงตัวอย่างหน้า A4 -->
      <div id="printable-area">
        <!-- Rendered dynamically -->
      </div>
    `;

    // ผูก Event Listeners
    document.getElementById('filter-site')?.addEventListener('change', () => {
      renderPrintPreview();
    });

    document.getElementById('chk-print-photos')?.addEventListener('change', () => {
      renderPrintPreview();
    });

    document.getElementById('chk-print-overview')?.addEventListener('change', () => {
      renderPrintPreview();
    });

    document.getElementById('chk-print-progress')?.addEventListener('change', () => {
      renderPrintPreview();
    });

    document.getElementById('input-shipping-cost')?.addEventListener('input', () => {
      if (document.getElementById('chk-print-progress')?.checked) {
        renderPrintPreview();
      }
    });

    // ฟังก์ชันสั่งพิมพ์ทางเครื่องพิมพ์ / บันทึก PDF ผ่านเบราว์เซอร์
    async function triggerPrintDocument() {
      const printBtn = document.getElementById('btn-print');
      const originalText = printBtn ? printBtn.innerHTML : '';
      if (printBtn) {
        printBtn.disabled = true;
        printBtn.innerHTML = `<span>⏳ กำลังเตรียมพิมพ์...</span>`;
      }

      const allImgs = Array.from(document.querySelectorAll('#printable-area img'));
      await Promise.all(allImgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));

      const now = new Date();
      const d = String(now.getDate()).padStart(2, '0');
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const y = now.getFullYear() > 2500 ? now.getFullYear() : now.getFullYear() + 543;
      const pdfFileName = `เอกสารและรายงาน_${d}-${m}-${y}`;

      const originalTitle = document.title;
      document.title = pdfFileName;

      if (printBtn) {
        printBtn.disabled = false;
        printBtn.innerHTML = originalText;
      }

      window.print();

      setTimeout(() => {
        document.title = originalTitle;
      }, 1000);
    }

    document.getElementById('chk-print-wage')?.addEventListener('change', () => {
      renderPrintPreview();
    });

    document.getElementById('btn-print')?.addEventListener('click', () => {
      triggerPrintDocument();
    });
  }

  return {
    init: async () => {
      initUI();
      await loadData();
    }
  };
})();
