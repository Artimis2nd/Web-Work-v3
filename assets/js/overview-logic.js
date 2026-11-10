/**
 * ตรรกะประมวลผล "สรุปภาพรวมงาน" — ใช้ร่วมกันระหว่างหน้าจอ (overview.js) และหน้าพิมพ์เอกสาร (overview-print.js)
 * แยกออกมาต่างหากเพื่อไม่ให้ตรรกะการจัดกลุ่ม/คำนวณเพี้ยนกันระหว่าง 2 หน้า
 */
const OverviewLogic = (() => {
  const MIN_MATCH_LEN = 4; // ความยาวขั้นต่ำของข้อความก่อนจะถือว่า "งานเดียวกัน" แบบ substring

  function normalizeJob(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // ถือว่าเป็นงานเดียวกันถ้าข้อความตรงกันเป๊ะ หรือข้อความสั้นเป็นส่วนหนึ่งของข้อความยาว
  // (รองรับกรณีพิมพ์ต่อ เช่น "เทปูน บ้าน B17" กับ "เทปูน บ้าน B17 ต่อจากเมื่อวาน")
  function isSameJob(a, b) {
    const na = normalizeJob(a), nb = normalizeJob(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    return shorter.length >= MIN_MATCH_LEN && longer.indexOf(shorter) !== -1;
  }

  function diffDays(d1, d2) {
    const a = new Date(d1 + 'T00:00:00');
    const b = new Date(d2 + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return Utils.toApiDate(d);
  }

  function thaiDateShort(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function newRun(entry) {
    return {
      jobDetail: entry.jobDetail,
      startDate: entry.date,
      endDate: entry.date,
      dateWorkerMap: new Map([[entry.date, entry.workerCount]]),
      groupCount: 1
    };
  }

  function finalizeRun(run) {
    const days = run.dateWorkerMap.size;
    const totalWorkerDays = Array.from(run.dateWorkerMap.values()).reduce((a, b) => a + b, 0);
    return {
      jobDetail: run.jobDetail,
      startDate: run.startDate,
      endDate: run.endDate,
      days,
      avgWorkersPerDay: days ? totalWorkerDays / days : 0,
      groupCount: run.groupCount
    };
  }

  // รวมรายการที่ "วันติดกัน + รายละเอียดงานเดียวกัน" ให้เป็นช่วงเดียว
  function buildRuns(entries) {
    const runs = [];
    let current = null;
    entries.forEach(entry => {
      if (!current) {
        current = newRun(entry);
        return;
      }
      const gap = diffDays(current.endDate, entry.date);
      if (isSameJob(current.jobDetail, entry.jobDetail) && gap <= 1) {
        current.endDate = entry.date;
        current.dateWorkerMap.set(entry.date, (current.dateWorkerMap.get(entry.date) || 0) + entry.workerCount);
        current.groupCount++;
      } else {
        runs.push(finalizeRun(current));
        current = newRun(entry);
      }
    });
    if (current) runs.push(finalizeRun(current));
    return runs;
  }

  function finalizeStreak(streak, nextDate) {
    const days = diffDays(streak.startDate, streak.endDate) + 1;
    const gapDays = nextDate ? diffDays(streak.endDate, nextDate) - 1 : 0;
    return {
      startDate: streak.startDate,
      endDate: streak.endDate,
      days,
      gapDays,
      gapStart: gapDays > 0 ? addDays(streak.endDate, 1) : null,
      gapEnd: gapDays > 0 ? addDays(nextDate, -1) : null
    };
  }

  // แยกวันที่ทำงาน (ต่อเนื่อง) ออกเป็นช่วงๆ พร้อมช่วงวันหยุดคั่นกลาง
  function buildStreaks(uniqueDatesSorted) {
    const streaks = [];
    let current = null;
    uniqueDatesSorted.forEach(date => {
      if (!current) { current = { startDate: date, endDate: date }; return; }
      const gap = diffDays(current.endDate, date);
      if (gap === 1) {
        current.endDate = date;
      } else {
        streaks.push(finalizeStreak(current, date));
        current = { startDate: date, endDate: date };
      }
    });
    if (current) streaks.push(finalizeStreak(current, null));
    return streaks;
  }

  // สรุปวันทำงานภาพรวมทั้งหมด (ไม่แยกตามไซต์งาน) — ใช้วันที่ของใบงานทั้งหมดรวมกัน
  function buildOverallSummary(logs) {
    const uniqueDates = Array.from(new Set(logs.map(g => Utils.toApiDate(g.Date)).filter(Boolean))).sort();
    if (!uniqueDates.length) {
      return { firstDate: null, lastDate: null, totalDays: 0, workedDays: 0, offDays: 0 };
    }
    const firstDate = uniqueDates[0];
    const lastDate = uniqueDates[uniqueDates.length - 1];
    const totalDays = diffDays(firstDate, lastDate) + 1;
    const workedDays = uniqueDates.length;
    const offDays = totalDays - workedDays;
    return { firstDate, lastDate, totalDays, workedDays, offDays };
  }

  function buildOverview(logs) {
    const bySite = new Map();
    logs.forEach(g => {
      const site = g.Site || '(ไม่ระบุไซต์งาน)';
      if (!bySite.has(site)) bySite.set(site, []);
      bySite.get(site).push(g);
    });

    const siteReports = [];
    bySite.forEach((groups, site) => {
      const sorted = [...groups].sort((a, b) => (Utils.toApiDate(a.Date) || '').localeCompare(Utils.toApiDate(b.Date) || ''));

      const byRequester = new Map();
      sorted.forEach(g => {
        const req = g.RequestedBy || '(ไม่ระบุผู้สั่งงาน)';
        if (!byRequester.has(req)) byRequester.set(req, []);
        byRequester.get(req).push(g);
      });

      const requesterReports = [];
      byRequester.forEach((reqGroups, req) => {
        const entries = reqGroups
          .map(g => ({
            date: Utils.toApiDate(g.Date) || '',
            jobDetail: normalizeJob(g.JobDetail),
            workerCount: (g.Workers || []).length
          }))
          .filter(e => e.date)
          .sort((a, b) => a.date.localeCompare(b.date));
        requesterReports.push({ requester: req, runs: buildRuns(entries), totalGroups: reqGroups.length });
      });
      requesterReports.sort((a, b) => b.totalGroups - a.totalGroups);

      const uniqueDates = Array.from(new Set(sorted.map(g => Utils.toApiDate(g.Date)).filter(Boolean))).sort();
      const streaks = buildStreaks(uniqueDates);

      siteReports.push({
        site,
        totalGroups: groups.length,
        firstDate: uniqueDates[0] || null,
        lastDate: uniqueDates[uniqueDates.length - 1] || null,
        requesterReports,
        streaks
      });
    });

    siteReports.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    return siteReports;
  }

  // ============================================================
  // ตรรกะปฏิทิน 2 เดือนคู่กัน (Dual-Month Calendar)
  // ============================================================
  const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  function formatMonthYearThai(year, monthIndex) {
    const thaiYear = year + 543;
    return `${THAI_MONTHS[monthIndex]} ${thaiYear}`;
  }

  function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function getFirstDayOfWeekMonday(year, monthIndex) {
    const sunBased = new Date(year, monthIndex, 1).getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    return sunBased === 0 ? 6 : sunBased - 1; // 0 = Mon, ..., 6 = Sun
  }

  function buildDualMonthCalendarData(logs = [], customStartDate = null, customEndDate = null) {
    // 1. ดึงวันที่ทำงานจริงทั้งหมดจาก logs พร้อมนับจำนวนคนงานจริงในแต่ละวัน (Unique Workers Map)
    const allWorkDates = Array.from(new Set(logs.map(l => Utils.toApiDate(l.Date)).filter(Boolean))).sort();

    const dailyWorkersMap = new Map();
    logs.forEach(g => {
      const d = Utils.toApiDate(g.Date);
      if (!d) return;
      if (!dailyWorkersMap.has(d)) dailyWorkersMap.set(d, new Set());
      (g.Workers || []).forEach(w => {
        const name = w.WorkerName || w.worker_name || w.FullName;
        if (name) dailyWorkersMap.get(d).add(name);
      });
    });

    let startDate = customStartDate || (allWorkDates.length ? allWorkDates[0] : Utils.toApiDate(new Date()));
    let endDate = customEndDate || (allWorkDates.length ? allWorkDates[allWorkDates.length - 1] : Utils.toApiDate(new Date()));

    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    const workDatesSet = new Set(allWorkDates);

    // 2. กำหนด 2 เดือนที่จะแสดง
    const [startYear, startMonth] = startDate.split('-').map(Number); // startMonth is 1-based
    const [endYear, endMonth] = endDate.split('-').map(Number);

    let m1 = { year: startYear, monthIndex: startMonth - 1 };
    let m2 = { year: endYear, monthIndex: endMonth - 1 };

    // ถ้าทั้งช่วงวันอยู่ในเดือนเดียวกัน ให้เดือนที่ 2 เป็นเดือนถัดไป
    if (m1.year === m2.year && m1.monthIndex === m2.monthIndex) {
      if (m1.monthIndex === 11) {
        m2 = { year: m1.year + 1, monthIndex: 0 };
      } else {
        m2 = { year: m1.year, monthIndex: m1.monthIndex + 1 };
      }
    }

    function generateMonthGrid(year, monthIndex) {
      const title = formatMonthYearThai(year, monthIndex);
      const daysCount = getDaysInMonth(year, monthIndex);
      const firstDay = getFirstDayOfWeekMonday(year, monthIndex); // 0 (Mon) - 6 (Sun) เริ่มสัปดาห์ที่วันจันทร์
      const cells = [];

      // เซลล์ว่างก่อนวันที่ 1
      for (let i = 0; i < firstDay; i++) {
        cells.push({ isEmpty: true });
      }

      for (let day = 1; day <= daysCount; day++) {
        const monthStr = String(monthIndex + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateIso = `${year}-${monthStr}-${dayStr}`;

        const isInRange = dateIso >= startDate && dateIso <= endDate;
        const isWorkDay = isInRange && workDatesSet.has(dateIso);
        const isOffDay = isInRange && !workDatesSet.has(dateIso);
        const workerCount = dailyWorkersMap.has(dateIso) ? dailyWorkersMap.get(dateIso).size : 0;

        cells.push({
          isEmpty: false,
          dayNumber: day,
          dateIso,
          isInRange,
          isWorkDay,
          isOffDay,
          workerCount
        });
      }

      // เติมเซลล์ว่างท้ายเดือนให้ครบสัปดาห์ (7 วัน)
      while (cells.length % 7 !== 0) {
        cells.push({ isEmpty: true });
      }

      // จัดแบ่งเป็นแถวสัปดาห์ละ 7 วัน
      const allRows = [];
      for (let i = 0; i < cells.length; i += 7) {
        allRows.push(cells.slice(i, i + 7));
      }

      // ปรับให้เหลือ 4 แถวตามช่วงวันทำงานจริง (ไม่แสดงสัปดาห์นอกรอบงานที่ไม่จำเป็น)
      let selectedRows = allRows;
      if (allRows.length > 4) {
        const activeRowIndices = [];
        allRows.forEach((row, rIdx) => {
          if (row.some(c => c.isInRange)) {
            activeRowIndices.push(rIdx);
          }
        });

        if (activeRowIndices.length > 0) {
          const minActive = activeRowIndices[0];
          const maxActive = activeRowIndices[activeRowIndices.length - 1];

          // ถ้าวันทำงานอยู่ช่วงท้ายเดือน (เช่น ต.ค.) ให้เลือก 4 แถวท้าย
          if (maxActive >= allRows.length - 2) {
            selectedRows = allRows.slice(allRows.length - 4);
          } else if (minActive <= 1) {
            // ถ้าวันทำงานอยู่ช่วงต้นเดือน (เช่น พ.ย.) ให้เลือก 4 แถวแรก
            selectedRows = allRows.slice(0, 4);
          } else {
            const startIdx = Math.max(0, Math.min(minActive, allRows.length - 4));
            selectedRows = allRows.slice(startIdx, startIdx + 4);
          }
        } else {
          selectedRows = allRows.slice(0, 4);
        }
      }

      const finalCells = selectedRows.reduce((acc, r) => acc.concat(r), []);

      return {
        year,
        monthIndex,
        title,
        cells: finalCells
      };
    }

    const month1 = generateMonthGrid(m1.year, m1.monthIndex);
    const month2 = generateMonthGrid(m2.year, m2.monthIndex);

    // คำนวณสถิติภาพรวมในช่วงวันที่
    let totalRangeDays = 0;
    let totalWorkDays = 0;
    let totalOffDays = 0;

    let cur = new Date(startDate + 'T00:00:00');
    const stop = new Date(endDate + 'T00:00:00');
    while (cur <= stop) {
      const iso = Utils.toApiDate(cur);
      totalRangeDays++;
      if (workDatesSet.has(iso)) {
        totalWorkDays++;
      } else {
        totalOffDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    return {
      startDate,
      endDate,
      totalRangeDays,
      totalWorkDays,
      totalOffDays,
      month1,
      month2
    };
  }

  // ============================================================
  // ตรรกะแยกตารางตามหน้างาน (Site Daily Breakdown)
  // นับจำนวนคนงานจริงในวันนั้นแบบไม่ซ้ำ (Unique Workers)
  // ============================================================
  function parseSubItemsFromDetail(detailText = '') {
    if (!detailText) return [];
    const text = String(detailText).trim();
    if (!text) return [];

    // แยกตามขึ้นบรรทัดใหม่ \n ก่อน
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length > 1) {
      return lines;
    }

    // ถ้าไม่มีขึ้นบรรทัดใหม่ แต่มีจุลภาคคั่นหลายข้อความ
    if (text.includes(',') && text.length > 30) {
      const commaParts = text.split(',').map(s => s.trim()).filter(Boolean);
      if (commaParts.length > 1) {
        return commaParts;
      }
    }

    return [text];
  }

  function buildSiteWorkBreakdown(logs = [], tasks = [], filterStartDate = null, filterEndDate = null) {
    const tasksMap = {};
    (tasks || []).forEach(t => {
      tasksMap[Number(t.id)] = t;
    });

    // กรอง logs ตามช่วงวัน
    const filteredLogs = logs.filter(l => {
      const d = Utils.toApiDate(l.Date);
      if (!d) return false;
      if (filterStartDate && d < filterStartDate) return false;
      if (filterEndDate && d > filterEndDate) return false;
      return true;
    });

    // จัดกลุ่มตามไซต์งาน (Site)
    const bySite = new Map();
    filteredLogs.forEach(g => {
      const site = g.Site || '(ไม่ระบุไซต์งาน)';
      if (!bySite.has(site)) bySite.set(site, []);
      bySite.get(site).push(g);
    });

    const siteBreakdowns = [];

    bySite.forEach((siteLogs, siteName) => {
      // 1. หาวันที่ทำงานทั้งหมดของหน้างานนี้
      const uniqueDates = Array.from(new Set(siteLogs.map(l => Utils.toApiDate(l.Date)).filter(Boolean))).sort();
      const totalDays = uniqueDates.length;

      // 2. จัดกลุ่มในแต่ละวัน
      const dateRows = uniqueDates.map(dateIso => {
        const logsOnDate = siteLogs.filter(l => Utils.toApiDate(l.Date) === dateIso);

        // นับจำนวนคนงานที่ลงงานจริงในวันนั้น โดยตรวจสอบไม่ให้เกินคนที่ลงงานจริง (Unique Workers Set)
        const uniqueWorkersSet = new Set();
        logsOnDate.forEach(g => {
          (g.Workers || []).forEach(w => {
            const name = w.WorkerName || w.worker_name || w.FullName;
            if (name) uniqueWorkersSet.add(name);
          });
        });
        const workerCount = uniqueWorkersSet.size;

        // จัดกลุ่มคำสั่งงานในวันนั้น (Task Groups)
        // กรณีมีหลายคำสั่งงานในวันนั้น
        const taskGroupsMap = new Map();
        logsOnDate.forEach(g => {
          const rawTaskId = g.TaskId ?? g.taskId ?? (g.Workers || []).find(w => w.TaskId || w.task_id)?.TaskId ?? (g.Workers || []).find(w => w.TaskId || w.task_id)?.task_id;
          const tid = (rawTaskId !== null && rawTaskId !== undefined && rawTaskId !== '') ? Number(rawTaskId) : 'unlinked';
          if (!taskGroupsMap.has(tid)) {
            taskGroupsMap.set(tid, []);
          }
          taskGroupsMap.get(tid).push(g);
        });

        const taskRows = [];
        taskGroupsMap.forEach((groupsOfTask, tid) => {
          let taskCode = '';
          let taskTitle = '';
          const subItemsList = [];

          if (tid !== 'unlinked' && tasksMap[tid]) {
            const t = tasksMap[tid];
            taskCode = t.task_code || `TSK-${t.id}`;
            taskTitle = t.title || '-';
          } else {
            taskCode = 'ไม่มีรหัสใบสั่งงาน';
            taskTitle = 'งานทั่วไป / บันทึกหน้างาน';
          }

          groupsOfTask.forEach(g => {
            const parsed = parseSubItemsFromDetail(g.JobDetail);
            parsed.forEach(item => {
              if (!subItemsList.includes(item)) {
                subItemsList.push(item);
              }
            });
          });

          taskRows.push({
            taskId: tid,
            taskCode,
            taskTitle,
            subItems: subItemsList
          });
        });

        return {
          dateIso,
          dateThai: Utils.formatDate(dateIso),
          workerCount,
          workerNames: Array.from(uniqueWorkersSet),
          taskRows
        };
      });

      siteBreakdowns.push({
        siteName,
        totalDays,
        firstDate: uniqueDates[0] || null,
        lastDate: uniqueDates[uniqueDates.length - 1] || null,
        dateRows
      });
    });

    // เรียงตามหน้างานที่มีวันทำงานล่าสุดขึ้นก่อน
    siteBreakdowns.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));

    return siteBreakdowns;
  }

  // สรุปตารางวันทำงานเรียงจากวันแรกไปวันล่าสุด (ไม่รวมวันหยุด) สำหรับแสดงในหน้าพิมพ์งาน
  function buildDailyWorkScheduleSummary(logs = [], filterStartDate = null, filterEndDate = null) {
    const dateMap = new Map();

    (logs || []).forEach(g => {
      const d = Utils.toApiDate(g.Date);
      if (!d) return;
      if (filterStartDate && d < filterStartDate) return;
      if (filterEndDate && d > filterEndDate) return;

      if (!dateMap.has(d)) {
        dateMap.set(d, {
          sites: [],
          siteWorkerMap: {},
          uniqueWorkers: new Set()
        });
      }

      const rec = dateMap.get(d);
      const site = (g.Site || g.SiteName || 'ไม่ระบุไซต์งาน').trim();
      if (site && !rec.sites.includes(site)) {
        rec.sites.push(site);
      }
      if (site && !rec.siteWorkerMap[site]) {
        rec.siteWorkerMap[site] = new Set();
      }

      (g.Workers || []).forEach(w => {
        const name = (w.WorkerName || w.worker_name || w.FullName || '').trim();
        if (name) {
          rec.uniqueWorkers.add(name);
          if (site) rec.siteWorkerMap[site].add(name);
        }
      });
    });

    const sortedDates = Array.from(dateMap.keys()).sort();

    return sortedDates.map((dateIso, idx) => {
      const rec = dateMap.get(dateIso);
      const siteText = rec.sites.map(s => {
        const count = rec.siteWorkerMap[s] ? rec.siteWorkerMap[s].size : 0;
        return rec.sites.length > 1 && count > 0 ? `${s} (${count} คน)` : s;
      }).join(', ');

      return {
        index: idx + 1,
        dateIso,
        dateThai: Utils.formatDate(dateIso),
        sites: rec.sites,
        siteText: siteText || 'ไม่ระบุไซต์งาน',
        workerCount: rec.uniqueWorkers.size
      };
    });
  }

  return {
    normalizeJob,
    isSameJob,
    diffDays,
    addDays,
    thaiDateShort,
    buildRuns,
    buildStreaks,
    buildOverview,
    buildOverallSummary,
    buildDualMonthCalendarData,
    buildSiteWorkBreakdown,
    buildDailyWorkScheduleSummary,
    parseSubItemsFromDetail
  };
})();
