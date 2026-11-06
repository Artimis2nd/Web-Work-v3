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

  return { normalizeJob, isSameJob, diffDays, addDays, thaiDateShort, buildRuns, buildStreaks, buildOverview, buildOverallSummary };
})();
