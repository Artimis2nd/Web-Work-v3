(() => {
  Utils.renderShell('overview.html', 'สรุปภาพรวมงาน');
  const content = document.getElementById('page-content');
  const { thaiDateShort, buildOverview } = OverviewLogic;

  function renderRun(run) {
    const rangeLabel = run.startDate === run.endDate
      ? thaiDateShort(run.startDate)
      : `${thaiDateShort(run.startDate)} – ${thaiDateShort(run.endDate)}`;
    const jobLabel = Utils.escapeHtml(run.jobDetail || '(ไม่ระบุรายละเอียด)');
    const desc = run.days > 1
      ? `ทำงาน "${jobLabel}" ต่อเนื่อง ${run.days} วัน (${rangeLabel}) เฉลี่ยใช้คนงาน ${run.avgWorkersPerDay.toFixed(1)} คน/วัน`
      : `ทำงาน "${jobLabel}" วันที่ ${rangeLabel} ใช้คนงาน ${run.avgWorkersPerDay.toFixed(0)} คน`;
    return `
      <div class="overview-run">
        <div class="overview-run-range">${rangeLabel}<span class="overview-run-days">${run.days} วัน</span></div>
        <div class="overview-run-detail">${jobLabel}</div>
        <div class="overview-run-desc">${desc}</div>
      </div>
    `;
  }

  function renderStreaks(site) {
    if (!site.streaks.length) return '<div style="color:var(--ink-soft)">ยังไม่มีข้อมูลวันทำงาน</div>';
    const parts = site.streaks.map(s => {
      const rangeLabel = s.startDate === s.endDate ? thaiDateShort(s.startDate) : `${thaiDateShort(s.startDate)} – ${thaiDateShort(s.endDate)}`;
      let html = `<span class="streak-chip streak-work">ทำงานต่อเนื่อง ${s.days} วัน (${rangeLabel})</span>`;
      if (s.gapDays > 0) {
        const gapLabel = s.gapStart === s.gapEnd ? thaiDateShort(s.gapStart) : `${thaiDateShort(s.gapStart)} – ${thaiDateShort(s.gapEnd)}`;
        html += `<span class="streak-arrow">→</span><span class="streak-chip streak-off">หยุด ${s.gapDays} วัน (${gapLabel})</span><span class="streak-arrow">→</span>`;
      }
      return html;
    });
    return `<div class="streak-flow">${parts.join('')}</div>`;
  }

  function renderSite(site) {
    const dateRangeLabel = site.firstDate
      ? (site.firstDate === site.lastDate ? thaiDateShort(site.firstDate) : `${thaiDateShort(site.firstDate)} – ${thaiDateShort(site.lastDate)}`)
      : '-';

    const requesterHtml = site.requesterReports.map(r => `
      <div class="overview-requester">
        <div class="overview-requester-title">สั่งงานโดย: ${Utils.escapeHtml(r.requester)} <span class="overview-requester-count">(${r.totalGroups} ใบงาน)</span></div>
        <div class="overview-run-list">${r.runs.map(renderRun).join('')}</div>
      </div>
    `).join('');

    return `
      <div class="ledger-card p-5 mb-5">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 class="font-display text-xl font-semibold">${Utils.escapeHtml(site.site)}</h2>
          <div class="text-sm" style="color:var(--ink-soft)">${site.totalGroups} ใบงาน · ${dateRangeLabel}</div>
        </div>

        <div class="overview-section">
          <div class="overview-section-title">สรุปวันทำงาน</div>
          ${renderStreaks(site)}
        </div>

        <div class="overview-section">
          <div class="overview-section-title">งานที่ทำ แยกตามผู้สั่งงาน</div>
          ${requesterHtml}
        </div>
      </div>
    `;
  }

  async function load() {
    content.innerHTML = `<div class="ledger-card p-6 text-center" style="color:var(--ink-soft)"><span class="spinner"></span> กำลังโหลดข้อมูล...</div>`;
    try {
      const data = await Api.getLogs({});
      const logs = data.logs || [];
      if (!logs.length) {
        content.innerHTML = `<div class="ledger-card p-8 text-center" style="color:var(--ink-soft)">ยังไม่มีข้อมูลใบงาน</div>`;
        return;
      }
      const siteReports = buildOverview(logs);
      content.innerHTML = `
        <div class="flex justify-end mb-4">
          <button id="print-overview-btn" class="btn btn-outline btn-sm">🖨️ พิมพ์รายงาน / ส่งภายนอก</button>
        </div>
        ${siteReports.map(renderSite).join('')}
      `;
      document.getElementById('print-overview-btn').addEventListener('click', () => {
        window.open('overview-print.html', '_blank');
      });
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(Utils.errorBanner(err.message, load));
    }
  }

  load();
})();
