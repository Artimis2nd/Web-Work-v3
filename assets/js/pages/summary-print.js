(() => {
  const container = document.getElementById('cards-container');
  const imagesContainer = document.getElementById('images-container');

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
    return Number(n || 0).toLocaleString();
  }

  function formatWorkerLine(w) {
    const name = w.workerName || '(ไม่ระบุ)';
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

    let workersHtml = '';
    (workers || []).forEach(w => {
      const info = formatWorkerLine(w);
      workersHtml += `
        <div class="worker-item">
          - ${info.name} จำนวน ${info.detail} ค่าแรงวันนี้ ${formatWage(info.wageDisplay)} บาท
        </div>
      `;
    });

    return `
      <div class="print-card">
        <div class="card-header">
          <div class="row">
            <span class="label">วันที่ :</span>${dateStr}
            <span class="sep"></span>
            <span class="label">โครงการ :</span>${Utils.escapeHtml(site)}
            <span class="sep"></span>
            <span class="label">ผู้สั่งงาน :</span>${Utils.escapeHtml(requestedBy)}
          </div>
          <div class="row">
            <span class="label">รายละเอียดงาน :</span>${Utils.escapeHtml(group.jobDetail || '(ไม่ระบุ)')}
          </div>
        </div>
        <div class="card-workers">
          ${workersHtml || '<div class="worker-item" style="color:#999;">ไม่มีข้อมูลคนงาน</div>'}
        </div>
        <div class="card-footer">
          <div class="sub-row">รวมค่าแรงดิบ : ${formatWage(totalRaw)} บาท</div>
          <div class="sub-row">รวมค่าแรงปกติ+OT (รวม +20%) : ${formatWage(totalNormalOt)} บาท</div>
          <div class="sub-row">รวมค่าแรงเหมา (ไม่มี +20%) : ${formatWage(totalFixed)} บาท</div>
          <div class="total-row">รวมค่าแรงวันนี้ : ${formatWage(grandTotal)} บาท</div>
        </div>
      </div>
    `;
  }

  function renderCardsInPairs(groupsData) {
    let html = '';
    for (let i = 0; i < groupsData.length; i += 2) {
      const card1 = renderCard(groupsData[i]);
      const card2 = i + 1 < groupsData.length ? renderCard(groupsData[i + 1]) : '';
      html += `<div class="card-pair">${card1}${card2}</div>`;
    }
    return html;
  }

  function renderImages(allGroups) {
    const imageEntries = [];
    allGroups.forEach(group => {
      const urls = group.imageUrls || [];
      urls.forEach(url => {
        imageEntries.push({
          url: url,
          site: group.site || '',
          date: group.date, // Keep original date for sorting
          dateStr: formatDateForPrint(group.date)
        });
      });
    });

    if (imageEntries.length === 0) {
      imagesContainer.innerHTML = '';
      return;
    }

    imageEntries.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });

    // Force 12 images per page (2 columns × 6 rows)
    const IMAGES_PER_PAGE = 12;
    let html = '';

    for (let pageIdx = 0; pageIdx < imageEntries.length; pageIdx += IMAGES_PER_PAGE) {
      const pageItems = imageEntries.slice(pageIdx, pageIdx + IMAGES_PER_PAGE);
      html += `<div class="image-page">`;
      html += `<div class="image-grid">`;
      pageItems.forEach(item => {
        html += `
          <div class="img-cell">
            <div class="img-wrapper">
              <img src="${Utils.escapeHtml(item.url)}" alt="รูปภาพจาก ${Utils.escapeHtml(item.site)} วันที่ ${item.dateStr}" loading="lazy">
            </div>
            <div class="img-date">📅 ${Utils.escapeHtml(item.site)} - ${item.dateStr}</div>
          </div>
        `;
      });
      html += `</div>`;
      html += `</div>`;
    }

    imagesContainer.innerHTML = html;
  }

  async function initialize() {
    const printBtn = document.getElementById('print-btn');
    let groupIds = [];
    try {
      const stored = sessionStorage.getItem('printGroups');
      if (stored) groupIds = JSON.parse(stored);
    } catch (e) {}

    if (!groupIds || groupIds.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">ไม่พบข้อมูลที่เลือก กรุณากลับไปเลือกข้อมูลที่หน้าแดชบอร์ด</div>';
      if (printBtn) printBtn.disabled = true;
      return;
    }

    try {
      const groupPromises = groupIds.map(gid => Api.getLogGroup({ groupId: gid }));
      const groupsData = await Promise.all(groupPromises);

      groupsData.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return da - db;
      });

      container.innerHTML = renderCardsInPairs(groupsData);
      renderImages(groupsData);

      if (printBtn) {
        printBtn.disabled = false;
      }

    } catch (err) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:red;">เกิดข้อผิดพลาด: ${Utils.escapeHtml(err.message)}</div>`;
    }
  }

  initialize();
})();