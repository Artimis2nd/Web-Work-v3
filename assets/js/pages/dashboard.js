(() => {
  Utils.renderShell('index.html', 'หน้าแรก');

  const content = document.getElementById('page-content');

  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('site-filter-dropdown');
    const wrap = document.getElementById('site-filter-wrap');
    if (dropdown && wrap && !wrap.contains(e.target)) dropdown.classList.add('hidden');
  });

  function skeletonKpis() {
    content.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${[0,1,2,3].map(() => `
          <div class="ledger-card p-4">
            <div class="skeleton" style="height:12px;width:60%;margin-bottom:10px"></div>
            <div class="skeleton" style="height:26px;width:80%"></div>
          </div>
        `).join('')}
      </div>
      <div class="ledger-card p-4">
        <div class="skeleton" style="height:18px;width:200px;margin-bottom:16px"></div>
        <table class="tape-table"><tbody>${Utils.skeletonRows(6, 8)}</tbody></table>
      </div>
    `;
  }

  function kpiCard(label, value, colorVar, prefix = '') {
    return `
      <div class="ledger-card kpi-card p-4" style="--tick-color:${colorVar}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value text-2xl mt-1">${prefix}${value}</div>
      </div>
    `;
  }

  function renderGroupRow(group) {
    return `
      <tr>
        <td class="text-center"><input type="checkbox" class="group-checkbox" value="${Utils.escapeHtml(group.groupId)}"></td>
        <td class="text-center">${Utils.formatDate(group.date)}</td>
        <td class="text-center text-truncate" title="${Utils.escapeHtml(group.site || '-')}">${Utils.escapeHtml(group.site || '-')}</td>
        <td class="truncate max-w-xs" title="${Utils.escapeHtml(group.jobDetail || '-')}">${Utils.escapeHtml(group.jobDetail || '-')}</td>
        <td class="font-mono text-center">${group.workerCount || 0} คน</td>
        <td class="font-mono font-semibold text-center" style="color:var(--blueprint-dark)">฿${Utils.money(group.totalNormal + group.totalFixed)}</td>
        <td class="text-center">${Utils.escapeHtml(group.requestedBy || '-')}</td>
        <td>
          <div class="flex gap-1 justify-center">
            <button class="btn btn-outline btn-sm" data-edit-group="${Utils.escapeHtml(group.groupId)}" title="แก้ไขใบงาน">&#9998;</button>
            <button class="btn btn-danger btn-sm" data-delete-group="${Utils.escapeHtml(group.groupId)}" title="ลบใบงาน">&#128465;</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ============================================================
  // Backup Viewer Modal (รองรับทั้ง Supabase & ดาวน์โหลดไฟล์ JSON)
  // ============================================================
  // Backup Viewer & Payroll Period Cutoff Modals
  // ============================================================
  function closeModal() {
    const backdrop = document.getElementById('backup-modal-backdrop');
    if (backdrop) backdrop.remove();
  }

  async function openCutoffPeriodModal(recentGroups = []) {
    closeModal();
    const dates = recentGroups.map(g => String(g.date || '').slice(0, 10)).filter(Boolean).sort();
    const defaultStart = dates.length > 0 ? dates[0] : new Date().toISOString().slice(0, 10);
    const defaultEnd = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);

    let allTasksNow = [];
    try {
      if (typeof Api.getTasks === 'function') {
        allTasksNow = await Api.getTasks();
      }
    } catch (_) {}

    const completedTasksCount = allTasksNow.filter(t => t.status === 'Completed').length;
    const activeTasksCount = allTasksNow.filter(t => t.status !== 'Completed').length;

    const backdrop = document.createElement('div');
    backdrop.id = 'backup-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box" style="max-width:540px">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">💰 ตัดงวดจ่ายค่าแรง & เก็บประวัติ (Payroll Cutoff)</h3>
          <button id="modal-close-btn" class="btn btn-outline btn-sm">✕ ปิด</button>
        </div>
        <form id="cutoff-period-form" class="modal-body space-y-4">
          <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-slate-700 space-y-1">
            <div class="font-semibold text-amber-900">📌 สิ่งที่ระบบจะจัดการให้อัตโนมัติเมื่อตัดงวด:</div>
            <div>1. เก็บบันทึกรายวันของช่วงวันที่เลือก + ใบสั่งงานที่ <strong>เสร็จแล้ว (${completedTasksCount} ใบ)</strong> เข้าชุดประวัติ Backup</div>
            <div>2. บันทึกยอดวันเข้าทำและค่าแรงสะสมเข้าใบสั่งงานที่ <strong>ยังไม่เสร็จ (${activeTasksCount} ใบ)</strong> เพื่อทำต่อเนื่องในงวดหน้า</div>
            <div>3. ลบเฉพาะบันทึกรายวันของช่วงวันที่ตัดจ่ายออกจากหน้าแรก (วันที่ทำในงวดใหม่จะยังอยู่ครบ)</div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label text-xs" for="cutoff-start-date">ตั้งแต่วันที่ <span class="text-red-500">*</span></label>
              <input type="date" id="cutoff-start-date" class="field-input w-full" value="${Utils.escapeHtml(defaultStart)}" required>
            </div>
            <div>
              <label class="field-label text-xs" for="cutoff-end-date">ถึงวันที่ <span class="text-red-500">*</span></label>
              <input type="date" id="cutoff-end-date" class="field-input w-full" value="${Utils.escapeHtml(defaultEnd)}" required>
            </div>
          </div>

          <div>
            <label class="field-label text-xs" for="cutoff-period-name">ชื่องวดงาน (เว้นว่างให้ตั้งตามวันที่อัตโนมัติได้)</label>
            <input type="text" id="cutoff-period-name" class="field-input w-full text-sm" placeholder="เช่น งวดวันที่ 1 - 15 พ.ย. 2026">
          </div>

          <div id="cutoff-preview-box" class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
            <!-- สรุปยอดก่อนตัดงวด -->
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button type="button" id="cutoff-cancel-btn" class="btn btn-outline">ยกเลิก</button>
            <button type="submit" id="cutoff-submit-btn" class="btn btn-primary">
              ✅ ยืนยันตัดงวด & เก็บ Backup
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('cutoff-cancel-btn').addEventListener('click', closeModal);

    const startInp = document.getElementById('cutoff-start-date');
    const endInp = document.getElementById('cutoff-end-date');
    const previewBox = document.getElementById('cutoff-preview-box');

    function updateCutoffPreview() {
      const s = startInp.value;
      const e = endInp.value;
      const matched = recentGroups.filter(g => {
        const d = String(g.date || '').slice(0, 10);
        if (s && d < s) return false;
        if (e && d > e) return false;
        return true;
      });
      const remaining = recentGroups.length - matched.length;
      const sumPay = matched.reduce((acc, g) => acc + (Number(g.totalPay) || 0), 0);

      previewBox.innerHTML = `
        <div class="flex justify-between"><span>จำนวนใบงานรายวันที่จะตัดจ่ายงวดนี้:</span><strong class="font-mono text-blue-700">${matched.length} ใบงาน</strong></div>
        <div class="flex justify-between"><span>ยอดค่าแรงรวมในงวดที่เลือก:</span><strong class="font-mono text-emerald-700">฿${Utils.money(sumPay)}</strong></div>
        <div class="flex justify-between"><span>ใบงานรายวันที่จะคงเหลือในหน้าแรก (งวดใหม่):</span><strong class="font-mono">${remaining} ใบงาน</strong></div>
      `;
    }

    startInp.addEventListener('change', updateCutoffPreview);
    endInp.addEventListener('change', updateCutoffPreview);
    updateCutoffPreview();

    const form = document.getElementById('cutoff-period-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const startDate = startInp.value;
      const endDate = endInp.value;
      const customName = (document.getElementById('cutoff-period-name')?.value || '').trim();

      if (startDate && endDate && startDate > endDate) {
        Utils.toast('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', 'error');
        return;
      }
      if (!Utils.verifyPin('ใส่รหัส PIN (1225) เพื่อยืนยันการตัดงวดจ่ายค่าแรง:')) return;

      const submitBtn = document.getElementById('cutoff-submit-btn');
      try {
        const result = await Utils.animateProgress(
          submitBtn,
          Api.closePayrollPeriod({ startDate, endDate, customName, archiveCompletedTasks: true }),
          'กำลังตัดงวดและเก็บสำรองข้อมูล...',
          '✅ ตัดงวดสำเร็จ'
        );
        Utils.toast(`ตัดงวดสำเร็จ: ${result.fileName} (เก็บรายวัน ${result.archivedGroupsCount} ใบ, ปิดใบสั่งงานที่เสร็จ ${result.archivedCompletedTasksCount} ใบ)`, 'success');
        closeModal();
        load();
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
    });
  }

  function openBackupListModal() {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'backup-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box" style="max-width:760px">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">📂 ประวัติงวดงานย้อนหลัง (Backup เบิกงวด)</h3>
          <button id="modal-close-btn" class="btn btn-outline btn-sm">✕ ปิด</button>
        </div>
        <div id="modal-body" class="modal-body">
          <div class="text-center py-6" style="color:var(--ink-soft)">กำลังโหลดรายชื่อชุดข้อมูลสำรอง...</div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);

    loadBackupList();
  }

  async function loadBackupList() {
    const body = document.getElementById('modal-body');
    if (!body) return;
    body.innerHTML = `<div class="text-center py-6" style="color:var(--ink-soft)">กำลังโหลดรายชื่อชุดข้อมูลสำรอง...</div>`;
    try {
      const files = await Api.listBackups();
      if (!body.isConnected) return;
      if (!files.length) {
        body.innerHTML = `<div class="text-center py-6" style="color:var(--ink-soft)">ยังไม่มีข้อมูลสำรอง — กดปุ่ม "💰 ตัดงวดค่าแรง" หรือ "💾 Backup ไฟล์" ก่อน</div>`;
        return;
      }
      body.innerHTML = `
        <div class="flex flex-col gap-2">
          ${files.map(f => `
            <button class="btn btn-outline w-full justify-between backup-file-row" data-file-id="${Utils.escapeHtml(f.id)}">
              <div class="flex items-center gap-2 text-left">
                <span>📦 ${Utils.escapeHtml(f.name)}</span>
                ${f.completedTasksCount ? `<span class="badge badge-success text-[11px]">ใบสั่งงานที่จบ ${f.completedTasksCount} ใบ</span>` : ''}
              </div>
              <span class="font-mono text-xs" style="color:var(--ink-soft)">${Utils.formatDate(f.createdDate)}</span>
            </button>
          `).join('')}
        </div>
      `;
      body.querySelectorAll('.backup-file-row').forEach(btn => {
        btn.addEventListener('click', () => loadBackupData(btn.getAttribute('data-file-id')));
      });
    } catch (err) {
      if (!body.isConnected) return;
      body.innerHTML = '';
      body.appendChild(Utils.errorBanner(err.message, loadBackupList));
    }
  }

  async function loadBackupData(fileId) {
    const body = document.getElementById('modal-body');
    if (!body) return;
    body.innerHTML = `<table class="tape-table"><tbody>${Utils.skeletonRows(6, 6)}</tbody></table>`;
    try {
      const data = await Api.getBackupData({ fileId });
      if (!body.isConnected) return;
      const logs = data.logs || [];
      const completedTasks = data.completedTasks || [];
      const backHtml = `<div class="mt-3"><button id="back-to-list-btn" class="btn btn-outline btn-sm">← กลับไปเลือกรายการอื่น</button></div>`;

      if (!logs.length && !completedTasks.length) {
        body.innerHTML = `<div class="text-center py-6" style="color:var(--ink-soft)">ไม่พบข้อมูลใบงานในชุดสำรองนี้</div>${backHtml}`;
        document.getElementById('back-to-list-btn').addEventListener('click', loadBackupList);
        return;
      }

      const rows = logs.map(g => {
        const totalNormal = g.Workers.reduce((sum, w) => sum + (w.WageType !== 'fixed' ? Number(w.TotalWithMarkup) || 0 : 0), 0);
        const totalFixed = g.Workers.reduce((sum, w) => sum + (w.WageType === 'fixed' ? Number(w.TotalWithMarkup) || 0 : 0), 0);
        return `
          <tr>
            <td class="text-center"><input type="checkbox" class="backup-group-checkbox" value="${Utils.escapeHtml(g.GroupID)}"></td>
            <td class="text-center">${Utils.formatDate(g.Date)}</td>
            <td class="text-center">${Utils.escapeHtml(g.Site || '-')}</td>
            <td class="text-truncate text-left" title="${Utils.escapeHtml(g.JobDetail || '-')}">${Utils.escapeHtml(g.JobDetail || '-')}</td>
            <td class="font-mono text-center">${g.Workers.length} คน</td>
            <td class="font-mono font-semibold text-center" style="color:var(--blueprint-dark)">฿${Utils.money(totalNormal + totalFixed)}</td>
            <td class="text-center">${Utils.escapeHtml(g.RequestedBy || '-')}</td>
          </tr>
        `;
      }).join('');

      const tasksHtml = completedTasks.length > 0 ? `
        <div class="mt-4 pt-3 border-t border-slate-200">
          <div class="text-xs font-semibold text-emerald-800 mb-2">🏁 ใบสั่งงานที่เสร็จสมบูรณ์และถูกเก็บในงวดนี้ (${completedTasks.length} ใบ):</div>
          <div class="space-y-1.5 max-h-44 overflow-y-auto">
            ${completedTasks.map(ct => `
              <label class="flex items-center justify-between p-2 rounded bg-emerald-50/60 border border-emerald-200 text-xs cursor-pointer">
                <div class="flex items-center gap-2">
                  <input type="checkbox" class="backup-task-checkbox" value="${Utils.escapeHtml(ct.id)}">
                  <span class="font-mono font-semibold text-slate-700">${Utils.escapeHtml(ct.task_code || '#' + ct.id)}</span>
                  <span class="font-medium text-slate-800">${Utils.escapeHtml(ct.title || '')}</span>
                  <span class="text-slate-500">(${Utils.escapeHtml(ct.site || '-')})</span>
                </div>
                <span class="text-emerald-700 font-semibold">เสร็จ 100%</span>
              </label>
            `).join('')}
          </div>
        </div>
      ` : '';

      body.innerHTML = `
        <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div class="font-semibold">📦 ${Utils.escapeHtml(data.fileName)}</div>
          <button id="download-backup-json-btn" class="btn btn-outline btn-sm">📥 ดาวน์โหลดไฟล์เก็บไว้ (.json)</button>
        </div>
        ${logs.length > 0 ? `
          <div class="text-xs font-semibold text-slate-600 mb-1.5">📝 รายการบันทึกประจำวันในงวดนี้ (${logs.length} ใบงาน):</div>
          <div class="overflow-x-auto max-h-64">
            <table class="tape-table">
              <thead>
                <tr>
                  <th style="width:36px"><input type="checkbox" id="backup-select-all"></th>
                  <th>วันที่</th><th>ไซต์งาน</th><th>รายละเอียด</th><th>จำนวนคน</th><th>รวมจ่าย</th><th>ผู้สั่งงาน</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        ` : `<div class="text-xs text-slate-400 py-2">ไม่มีรายการบันทึกประจำวันในงวดนี้</div>`}
        ${tasksHtml}
        <div class="flex items-center justify-between mt-4 gap-2 flex-wrap">
          <button id="back-to-list-btn" class="btn btn-outline btn-sm">← กลับไปเลือกรายการอื่น</button>
          <button id="restore-selected-btn" class="btn btn-primary btn-sm">↩️ นำรายการที่เลือกกลับเข้าระบบ</button>
        </div>
      `;
      document.getElementById('back-to-list-btn').addEventListener('click', loadBackupList);

      document.getElementById('download-backup-json-btn').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${data.fileName || 'backup'}.json`;
        a.click();
      });

      const selectAll = document.getElementById('backup-select-all');
      if (selectAll) {
        selectAll.addEventListener('change', () => {
          body.querySelectorAll('.backup-group-checkbox').forEach(cb => cb.checked = selectAll.checked);
        });
      }

      const restoreBtn = document.getElementById('restore-selected-btn');
      restoreBtn.addEventListener('click', async () => {
        const checkedGroups = body.querySelectorAll('.backup-group-checkbox:checked');
        const checkedTasks = body.querySelectorAll('.backup-task-checkbox:checked');
        const groupIds = Array.from(checkedGroups).map(cb => cb.value);
        const taskIds = Array.from(checkedTasks).map(cb => cb.value);

        if (!groupIds.length && !taskIds.length) {
          Utils.toast('กรุณาเลือกใบงานหรือใบสั่งงานที่ต้องการนำกลับก่อน', 'error');
          return;
        }
        if (!confirm(`นำรายการที่เลือกกลับเข้าระบบปัจจุบันหรือไม่?`)) return;

        try {
          const result = await Utils.animateProgress(
            restoreBtn,
            Api.restoreBackupGroups({ fileId, groupIds, taskIds }),
            'กำลังนำเข้า...',
            '✅ นำเข้าสำเร็จ'
          );
          const restoredCount = (result.restored || []).length;
          const restoredTasksCount = (result.restoredTasks || []).length;
          const skippedCount = (result.skipped || []).length;
          let msg = `นำเข้าสำเร็จ (รายวัน ${restoredCount} ใบ, ใบสั่งงาน ${restoredTasksCount} ใบ)`;
          if (skippedCount) msg += ` [ข้าม ${skippedCount} รายการที่มีอยู่แล้ว]`;
          Utils.toast(msg, 'success');
          closeModal();
          load();
        } catch (err) {
          Utils.toast(err.message, 'error');
        }
      });
    } catch (err) {
      if (!body.isConnected) return;
      body.innerHTML = '';
      body.appendChild(Utils.errorBanner(err.message, () => loadBackupData(fileId)));
    }
  }

  function renderData(data) {
    const sortedRecentGroups = data.recentGroups
      ? [...data.recentGroups].sort((a, b) => new Date(b.date) - new Date(a.date))
      : [];

    const allSites = Array.from(new Set(sortedRecentGroups.map(g => g.site || '(ไม่ระบุไซต์งาน)'))).sort();
    let selectedSites = new Set(allSites);

    function getFilteredGroups() {
      if (selectedSites.size === allSites.length) return sortedRecentGroups;
      return sortedRecentGroups.filter(g => selectedSites.has(g.site || '(ไม่ระบุไซต์งาน)'));
    }

    function attachRowListeners() {
      content.querySelectorAll('[data-edit-group]').forEach(btn => {
        btn.addEventListener('click', () => {
          const groupId = btn.getAttribute('data-edit-group');
          window.location.href = 'daily-log.html?edit=' + encodeURIComponent(groupId);
        });
      });

      content.querySelectorAll('[data-delete-group]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const groupId = btn.getAttribute('data-delete-group');
          if (!confirm('ยืนยันการลบใบงานนี้ทั้งหมด?')) return;
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner spinner-dark"></span>';
          try {
            await Api.deleteLogGroup({ groupId });
            Utils.toast('ลบใบงานเรียบร้อย', 'success');
            load();
          } catch (err) {
            Utils.toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '🗑️';
          }
        });
      });
    }

    function updateFilterBadge() {
      const badge = document.getElementById('site-filter-badge');
      if (!badge) return;
      badge.textContent = selectedSites.size === allSites.length ? '' : ` (${selectedSites.size}/${allSites.length})`;
    }

    function renderTableBody() {
      const filtered = getFilteredGroups();
      const tbody = document.getElementById('log-rows');
      tbody.innerHTML = filtered.length
        ? filtered.map(renderGroupRow).join('')
        : `<tr><td colspan="8" class="text-center py-6" style="color:var(--ink-soft)">ไม่พบใบงานตามไซต์งานที่เลือก</td></tr>`;
      attachRowListeners();
      updateFilterBadge();
    }

    content.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${kpiCard('จำนวนคนงานทั้งหมด', data.totalWorkers, 'var(--blueprint)')}
        ${kpiCard('ใบงานที่บันทึกแล้ว', data.totalLogGroups, 'var(--amber-dark)')}
        ${kpiCard('ยอดค่าแรงปกติ+OT สะสม', Utils.money(data.totalNormalWage), 'var(--green)', '฿')}
        ${kpiCard('ยอดค่าแรงเหมาสะสม', Utils.money(data.totalFixedWage), 'var(--red)', '฿')}
      </div>

      <div class="ledger-card p-4">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 class="font-display text-lg font-semibold">รายการใบงานล่าสุด</h2>
          <div class="flex gap-2 flex-wrap">
            ${allSites.length ? `
            <div class="site-filter-wrap" id="site-filter-wrap">
              <button id="site-filter-btn" type="button" class="btn btn-outline btn-sm">🔍 กรองไซต์งาน<span id="site-filter-badge"></span></button>
              <div id="site-filter-dropdown" class="site-filter-dropdown hidden">
                <div class="site-filter-actions">
                  <button id="site-filter-all" type="button" class="btn btn-outline btn-sm">เลือกทั้งหมด</button>
                  <button id="site-filter-none" type="button" class="btn btn-outline btn-sm">ไม่เลือกเลย</button>
                </div>
                <div id="site-filter-list" class="site-filter-list">
                  ${allSites.map(site => `
                    <label class="site-filter-item">
                      <input type="checkbox" class="site-filter-checkbox" value="${Utils.escapeHtml(site)}" checked>
                      <span>${Utils.escapeHtml(site)}</span>
                    </label>
                  `).join('')}
                </div>
              </div>
            </div>` : ''}
            <button id="view-selected-btn" class="btn btn-outline btn-sm">📋 ดูรายการ / พิมพ์</button>
            <a href="daily-log.html" class="btn btn-amber btn-sm">+ บันทึกงานใหม่</a>
            <button id="cutoff-period-btn" class="btn btn-primary btn-sm" title="ตัดจ่ายค่าแรงตามช่วงวันที่ (ประมาณ 15 วัน) เก็บ Backup งวดงาน และล้างเฉพาะวันที่จ่ายแล้ว">💰 ตัดงวดค่าแรง</button>
            <button id="backup-btn" class="btn btn-outline btn-sm">💾 Backup ไฟล์</button>
            <button id="load-backup-btn" class="btn btn-outline btn-sm">📂 โหลด Backup</button>
            <button id="clear-logs-btn" class="btn btn-danger btn-sm">🗑️ ล้างบันทึก</button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="tape-table" style="table-layout: fixed; width: 100%;">
            <thead>
              <tr>
                <th style="width: 40px;"><input type="checkbox" id="select-all-checkbox" title="เลือกทั้งหมด"></th>
                <th style="width: 100px;">วันที่</th>
                <th style="width: 120px;">ไซต์งาน</th>
                <th style="width: 150px;">รายละเอียดงาน</th>
                <th style="width: 80px;">จำนวนคน</th>
                <th style="width: 100px;">รวมจ่าย</th>
                <th style="width: 100px;">ผู้สั่งงาน</th>
                <th style="width: 80px;"></th>
              </tr>
            </thead>
            <tbody id="log-rows">
              ${sortedRecentGroups.length
                ? sortedRecentGroups.map(renderGroupRow).join('')
                : `<tr><td colspan="8" class="text-center py-6" style="color:var(--ink-soft)">ยังไม่มีบันทึกงาน — เริ่มบันทึกได้ที่ปุ่ม "+ บันทึกงานใหม่" ด้านบน</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    attachRowListeners();

    const siteFilterBtn = document.getElementById('site-filter-btn');
    if (siteFilterBtn) {
      const siteFilterDropdown = document.getElementById('site-filter-dropdown');

      siteFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        siteFilterDropdown.classList.toggle('hidden');
      });

      siteFilterDropdown.querySelectorAll('.site-filter-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSites.add(cb.value);
          else selectedSites.delete(cb.value);
          renderTableBody();
        });
      });

      document.getElementById('site-filter-all').addEventListener('click', () => {
        selectedSites = new Set(allSites);
        siteFilterDropdown.querySelectorAll('.site-filter-checkbox').forEach(cb => cb.checked = true);
        renderTableBody();
      });
      document.getElementById('site-filter-none').addEventListener('click', () => {
        selectedSites = new Set();
        siteFilterDropdown.querySelectorAll('.site-filter-checkbox').forEach(cb => cb.checked = false);
        renderTableBody();
      });
    }

    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.group-checkbox');
        checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
      });
    }

    const viewBtn = document.getElementById('view-selected-btn');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        const checked = document.querySelectorAll('.group-checkbox:checked');
        const ids = Array.from(checked).map(cb => cb.value);
        if (ids.length === 0) {
          Utils.toast('กรุณาเลือกรายการใบงานก่อน', 'error');
          return;
        }
        sessionStorage.setItem('printGroups', JSON.stringify(ids));
        window.open('summary-print.html', '_blank');
      });
    }

    const cutoffPeriodBtn = document.getElementById('cutoff-period-btn');
    if (cutoffPeriodBtn) {
      cutoffPeriodBtn.addEventListener('click', () => {
        if (!Utils.verifyPin()) return;
        openCutoffPeriodModal(sortedRecentGroups);
      });
    }

    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        if (!Utils.verifyPin()) return;
        if (!confirm('สำรองข้อมูลใบงานทั้งหมด (เบิกงวด) ตอนนี้หรือไม่?')) return;
        try {
          const result = await Utils.animateProgress(
            backupBtn,
            Api.backupSpreadsheet(),
            'กำลังสำรองข้อมูล...',
            '✅ สำรองสำเร็จ'
          );
          Utils.toast('สำรองข้อมูลเรียบร้อย: ' + result.fileName, 'success');
          setTimeout(() => {
            backupBtn.disabled = false;
            backupBtn.innerHTML = '💾 Backup ไฟล์';
          }, 1500);
        } catch (err) {
          Utils.toast(err.message, 'error');
        }
      });
    }

    const loadBackupBtn = document.getElementById('load-backup-btn');
    if (loadBackupBtn) {
      loadBackupBtn.addEventListener('click', () => {
        if (!Utils.verifyPin()) return;
        openBackupListModal();
      });
    }

    const clearBtn = document.getElementById('clear-logs-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!Utils.verifyPin()) return;
        const typed = prompt('การกระทำนี้จะลบ "ใบงานทั้งหมด" ออกจากระบบปัจจุบัน\nแนะนำให้กด "Backup ไฟล์" ก่อนทุกครั้ง\n\nพิมพ์คำว่า ลบ เพื่อยืนยันการล้างบันทึก:');
        if (typed === null) return;
        if (typed.trim() !== 'ลบ') {
          Utils.toast('ข้อความยืนยันไม่ถูกต้อง — ยกเลิกการล้างบันทึก', 'error');
          return;
        }
        try {
          const clearAction = (async () => {
            if (typeof Api.snapshotActiveTasksBeforeClear === 'function') {
              await Api.snapshotActiveTasksBeforeClear();
            }
            return await Api.clearAllLogs();
          })();
          await Utils.animateProgress(
            clearBtn,
            clearAction,
            'กำลังบันทึกยอดสะสมและล้างบันทึก...',
            '✅ ล้างสำเร็จ'
          );
          Utils.toast('ล้างบันทึกเรียบร้อย', 'success');
          load();
        } catch (err) {
          Utils.toast(err.message, 'error');
        }
      });
    }
  }

  async function load() {
    skeletonKpis();
    try {
      const data = await Api.getDashboard();
      renderData(data);
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(Utils.errorBanner(err.message, load));
    }
  }

  load();
})();
