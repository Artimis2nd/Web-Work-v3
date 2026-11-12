(() => {
  'use strict';

  const container = document.getElementById('cards-container');

  function formatDateForPrint(d) {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = (date.getFullYear() + 543).toString().slice(-2);
    return `${day} ${month} ${year}`;
  }

  function formatWage(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatWorkerLine(w) {
    const name = w.workerName || w.FullName || '(ไม่ระบุ)';
    const wageType = w.wageType || 'hourly';
    const hours = Number(w.hours) || 0;
    const otHours = Number(w.otHours) || 0;
    const fixedAmount = Number(w.fixedAmount) || 0;
    const rawWage = Number(w.RawWage || w.rawWage || 0);
    const totalWage = Number(w.TotalWithMarkup || w.totalWithMarkup || rawWage);

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
      const rawWage = Number(w.RawWage || w.rawWage || 0);
      totalRaw += rawWage;

      if (w.wageType === 'fixed') {
        totalFixed += Number(w.fixedAmount || w.FixedAmount || rawWage);
      } else {
        totalNormalOt += Number(w.TotalWithMarkup || w.totalWithMarkup || rawWage);
      }
    });

    return { totalRaw, totalNormalOt, totalFixed, grandTotal: totalNormalOt + totalFixed };
  }

  function renderCard(group) {
    const dateStr = formatDateForPrint(group.date);
    const site = group.site || '(ไม่ระบุโครงการ)';
    const requestedBy = group.requestedBy || '(ไม่ระบุ)';
    const workers = group.workers || [];
    const { totalRaw, totalNormalOt, totalFixed, grandTotal } = calcSubTotals(workers);

    // จัดรายชื่อคนงานเป็น 2 คอลัมน์ ประหยัดกระดาษ 50%
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

  // จัดกลุ่มใบงานแยกตามหน้างาน (Site) เพื่อให้พิมพ์หน้างานเดียวกันต่อกัน และขึ้นหน้าใหม่เมื่อขึ้นหน้างานใหม่
  function renderGroupedBySite(groupsData) {
    const bySite = new Map();

    groupsData.forEach(g => {
      const siteName = (g.site || '(ไม่ระบุโครงการ)').trim();
      if (!bySite.has(siteName)) {
        bySite.set(siteName, []);
      }
      bySite.get(siteName).push(g);
    });

    let fullHtml = '';

    bySite.forEach((siteGroups, siteName) => {
      // เรียงวันที่จากน้อยไปหามากในแต่ละหน้างาน
      siteGroups.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return da - db;
      });

      // รวมยอดค่าแรงทั้งหมดของหน้างานนี้
      let siteGrandTotal = 0;
      siteGroups.forEach(g => {
        const { grandTotal } = calcSubTotals(g.workers);
        siteGrandTotal += grandTotal;
      });

      fullHtml += `
        <div class="site-print-section">
          <div class="site-header-banner">
            <div>📍 หน้างาน / โครงการ : ${Utils.escapeHtml(siteName)} (รวม ${siteGroups.length} ใบงาน)</div>
            <div style="font-family:monospace;font-size:12pt;color:#fef08a;">ยอดรวมหน้างานนี้: ${formatWage(siteGrandTotal)} บาท</div>
          </div>
          <div class="site-cards-flow">
            ${siteGroups.map(renderCard).join('')}
          </div>
        </div>
      `;
    });

    return fullHtml;
  }

  async function initialize() {
    const printBtn = document.getElementById('print-btn');
    let groupIds = [];
    try {
      const stored = sessionStorage.getItem('printGroups');
      if (stored) groupIds = JSON.parse(stored);
    } catch (e) {}

    if (!groupIds || groupIds.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">ไม่พบข้อมูลที่เลือก กรุณากลับไปเลือกข้อมูลที่หน้าหลัก</div>';
      if (printBtn) printBtn.disabled = true;
      return;
    }

    try {
      const groupPromises = groupIds.map(gid => Api.getLogGroup({ groupId: gid }));
      const groupsData = await Promise.all(groupPromises);

      container.innerHTML = renderGroupedBySite(groupsData);

      if (printBtn) {
        printBtn.disabled = false;
      }
    } catch (err) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:#b91c1c;">เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}</div>`;
      if (printBtn) printBtn.disabled = true;
    }
  }

  initialize();
})();
