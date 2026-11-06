(() => {
  const { thaiDateShort, buildOverview, buildOverallSummary } = OverviewLogic;

  function renderRunRow(run) {
    const rangeLabel = run.startDate === run.endDate
      ? thaiDateShort(run.startDate)
      : `${thaiDateShort(run.startDate)} – ${thaiDateShort(run.endDate)}`;
    return `
      <tr>
        <td class="nowrap">${rangeLabel}</td>
        <td class="text-center nowrap">${run.days}</td>
        <td>${Utils.escapeHtml(run.jobDetail || '(ไม่ระบุรายละเอียด)')}</td>
        <td class="text-center nowrap">${run.avgWorkersPerDay.toFixed(1)}</td>
      </tr>
    `;
  }

  function renderOverallSummary(logs) {
    const s = buildOverallSummary(logs);
    if (!s.firstDate) return '';
    const rangeLabel = `${thaiDateShort(s.firstDate)} – ${thaiDateShort(s.lastDate)}`;
    return `
      <div class="overall-summary">
        <strong>สรุปวันทำงานภาพรวม:</strong> ตั้งแต่วันที่ ${rangeLabel} (รวม ${s.totalDays} วัน) —
        มาทำงาน <strong>${s.workedDays}</strong> วัน · หยุด <strong>${s.offDays}</strong> วัน
      </div>
    `;
  }

  function renderSite(site) {
    const dateRangeLabel = site.firstDate
      ? (site.firstDate === site.lastDate ? thaiDateShort(site.firstDate) : `${thaiDateShort(site.firstDate)} – ${thaiDateShort(site.lastDate)}`)
      : '-';

    const requesterBlocks = site.requesterReports.map(r => `
      <div class="req-block">
        <div class="req-title">สั่งงานโดย: ${Utils.escapeHtml(r.requester)} (${r.totalGroups} ใบงาน)</div>
        <table class="doc-table">
          <colgroup>
            <col style="width:24mm">
            <col style="width:14mm">
            <col>
            <col style="width:22mm">
          </colgroup>
          <thead>
            <tr><th class="nowrap">ช่วงวันที่</th><th class="text-center nowrap">วัน</th><th>รายละเอียดงาน</th><th class="text-center nowrap">คนงาน</th></tr>
          </thead>
          <tbody>${r.runs.map(renderRunRow).join('')}</tbody>
        </table>
      </div>
    `).join('');

    return `
      <div class="site-block">
        <h2>${Utils.escapeHtml(site.site)}</h2>
        <div class="site-meta">${site.totalGroups} ใบงาน · ${dateRangeLabel}</div>
        ${requesterBlocks}
      </div>
    `;
  }

  async function load() {
    const container = document.getElementById('sites-container');
    const summaryEl = document.getElementById('overall-summary');
    document.getElementById('generated-at').textContent = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
    try {
      const data = await Api.getLogs({});
      const logs = data.logs || [];
      if (!logs.length) {
        container.innerHTML = '<p>ยังไม่มีข้อมูลใบงาน</p>';
        return;
      }
      summaryEl.innerHTML = renderOverallSummary(logs);
      const siteReports = buildOverview(logs);
      container.innerHTML = siteReports.map(renderSite).join('');
      document.getElementById('print-btn').disabled = false;
    } catch (err) {
      container.innerHTML = `<p style="color:#c1443c">โหลดข้อมูลไม่สำเร็จ: ${Utils.escapeHtml(err.message)}</p>`;
    }
  }

  load();
})();
