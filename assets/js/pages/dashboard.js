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
  function closeModal() {
    const backdrop = document.getElementById('backup-modal-backdrop');
    if (backdrop) backdrop.remove();
  }

  function openBackupListModal() {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'backup-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">โหลดบันทึกจาก Backup (เบิกงวด)</h3>
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
        body.innerHTML = `<div class="text-center py-6" style="color:var(--ink-soft)">ยังไม่มีข้อมูลสำรอง — กดปุ่ม "💾 Backup ไฟล์" ก่อน</div>`;
        return;
      }
      body.innerHTML = `
        <div class="flex flex-col gap-2">
          ${files.map(f => `
            <button class="btn btn-outline w-full justify-between backup-file-row" data-file-id="${Utils.escapeHtml(f.id)}">
              <span>📦 ${Utils.escapeHtml(f.name)}</span>
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
      const backHtml = `<div class="mt-3"><button id="back-to-list-btn" class="btn btn-outline btn-sm">← กลับไปเลือกรายการอื่น</button></div>`;

      if (!logs.length) {
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

      body.innerHTML = `
        <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div class="font-semibold">📦 ${Utils.escapeHtml(data.fileName)}</div>
          <button id="download-backup-json-btn" class="btn btn-outline btn-sm">📥 ดาวน์โหลดไฟล์เก็บไว้ (.json)</button>
        </div>
        <div class="overflow-x-auto">
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
        <div class="flex items-center justify-between mt-3 gap-2 flex-wrap">
          <button id="back-to-list-btn" class="btn btn-outline btn-sm">← กลับไปเลือกรายการอื่น</button>
          <button id="restore-selected-btn" class="btn btn-primary btn-sm">↩️ นำใบงานที่เลือกกลับเข้าระบบ</button>
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
      selectAll.addEventListener('change', () => {
        body.querySelectorAll('.backup-group-checkbox').forEach(cb => cb.checked = selectAll.checked);
      });

      const restoreBtn = document.getElementById('restore-selected-btn');
      restoreBtn.addEventListener('click', async () => {
        const checked = body.querySelectorAll('.backup-group-checkbox:checked');
        const groupIds = Array.from(checked).map(cb => cb.value);
        if (!groupIds.length) {
          Utils.toast('กรุณาเลือกใบงานที่ต้องการนำกลับก่อน', 'error');
          return;
        }
        if (!confirm(`นำใบงาน ${groupIds.length} รายการที่เลือกกลับเข้าระบบปัจจุบันหรือไม่?`)) return;

        try {
          const result = await Utils.animateProgress(
            restoreBtn,
            Api.restoreBackupGroups({ fileId, groupIds }),
            'กำลังนำเข้า...',
            '✅ นำเข้าสำเร็จ'
          );
          const restoredCount = (result.restored || []).length;
          const skippedCount = (result.skipped || []).length;
          let msg = `นำเข้าสำเร็จ ${restoredCount} รายการ`;
          if (skippedCount) msg += ` (ข้าม ${skippedCount} รายการเพราะมีอยู่แล้วในระบบ)`;
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
