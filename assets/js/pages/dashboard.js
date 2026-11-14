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
    const isUnlinked = group.taskId === null || group.taskId === undefined || group.taskId === '';
    const alertIconHtml = isUnlinked
      ? `<span class="inline-block text-amber-600 mr-1 font-bold text-sm" title="รายงานประจำวันใบนี้ยังไม่มีรหัสใบสั่งงาน (กดปุ่มดินสอเพื่อเชื่อมโยง)">⚠️</span>`
      : '';

    return `
      <tr class="${isUnlinked ? 'bg-amber-50/40' : ''}">
        <td class="text-center"><input type="checkbox" class="group-checkbox" value="${Utils.escapeHtml(group.groupId)}"></td>
        <td class="text-center">${Utils.formatDate(group.date)}</td>
        <td class="text-center text-truncate" title="${Utils.escapeHtml(group.site || '-')}">${Utils.escapeHtml(group.site || '-')}</td>
        <td class="truncate max-w-xs" title="${Utils.escapeHtml(group.jobDetail || '-')}">${alertIconHtml}<span>${Utils.escapeHtml(group.jobDetail || '-')}</span></td>
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
  // Backup Package (.zip) Builder & Importer + Modals
  // ============================================================

  function toDisplayDate(isoStr) {
    if (!isoStr) return '';
    const clean = String(isoStr).slice(0, 10);
    const parts = clean.split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    return clean;
  }

  function toIsoDate(displayStr) {
    if (!displayStr) return '';
    const clean = String(displayStr).trim();
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length === 3) return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }
    return clean;
  }
  function closeModal() {
    const backdrop = document.getElementById('backup-modal-backdrop');
    if (backdrop) backdrop.remove();
  }

  function sanitizeFilePart(str, maxLen = 36) {
    const cleaned = String(str || '')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return (cleaned || 'item').slice(0, maxLen);
  }

  function csvEscape(val) {
    const s = String(val ?? '');
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function buildLogsCsvContent(rawLogs = [], localImageFiles = {}) {
    const headers = [
      'วันที่', 'ไซต์งาน', 'รายละเอียดงาน', 'ผู้สั่งงาน',
      'ชื่อคนงาน', 'ประเภทค่าแรง', 'ค่าแรงรายวัน', 'ชั่วโมงปกติ',
      'ชั่วโมง_OT', 'ยอดเหมา', 'ค่าแรงดิบ', 'รวมสุทธิ(+20%)',
      'รหัสใบสั่งงาน(TaskID)', 'ไฟล์รูปภาพในโฟลเดอร์', 'GroupID'
    ];
    const lines = [headers.map(csvEscape).join(',')];
    rawLogs.forEach(r => {
      const gid = String(r.GroupID || r.group_id || '');
      const imgFiles = Array.isArray(localImageFiles[gid]) ? localImageFiles[gid].join(' ; ') : '';
      const row = [
        r.Date || r.work_date || '',
        r.Site || r.site || '',
        r.JobDetail || r.job_detail || '',
        r.RequestedBy || r.requested_by || '',
        r.WorkerName || r.worker_name || '',
        (r.WageType || r.wage_type) === 'fixed' ? 'เหมาจ่าย' : 'รายชั่วโมง',
        Number(r.DailyWage ?? r.daily_wage) || 0,
        Number(r.Hours ?? r.hours) || 0,
        Number(r.OTHours ?? r.ot_hours) || 0,
        Number(r.FixedAmount ?? r.fixed_amount) || 0,
        Number(r.RawWage ?? r.raw_wage) || 0,
        Number(r.TotalWithMarkup ?? r.total_with_markup) || 0,
        r.TaskId ?? r.task_id ?? '',
        imgFiles,
        gid
      ];
      lines.push(row.map(csvEscape).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function buildTasksCsvContent(tasks = []) {
    const headers = [
      'รหัสใบงาน', 'หัวข้องาน', 'ไซต์งาน', 'สถานะ', 'ความคืบหน้า(%)',
      'วันที่สั่งงาน', 'กำหนดเสร็จ', 'ผู้สั่งงาน', 'ผู้รับผิดชอบ',
      'วันสะสม', 'แรงงานสะสม(Man-Days)', 'ต้นทุนค่าแรงสะสม', 'ต้นทุนรวม+20%สะสม'
    ];
    const lines = [headers.map(csvEscape).join(',')];
    tasks.forEach(t => {
      const row = [
        t.task_code || `#${t.id}`,
        t.title || '',
        t.site || '',
        t.status || '',
        Number(t.progress_percent ?? t.progress) || 0,
        t.order_date || t.assigned_date || '',
        t.due_date || '',
        t.ordered_by || t.requested_by || '',
        t.assigned_to || t.assigned_workers || '',
        Number(t.total_days_worked ?? t.accumulated_days) || 0,
        Number(t.accumulated_man_days) || 0,
        Number(t.accumulated_cost) || 0,
        Number(t.accumulated_markup_cost) || 0
      ];
      lines.push(row.map(csvEscape).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  async function resolveImageToBlobAndExt(imgSource) {
    if (!imgSource || typeof imgSource !== 'string') return null;
    if (imgSource.startsWith('data:image/')) {
      const match = imgSource.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) return null;
      const subtype = match[1].toLowerCase();
      const ext = subtype === 'png' ? 'png' : (subtype === 'webp' ? 'webp' : 'jpg');
      const bstr = atob(match[2]);
      const u8 = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
      return { blob: new Blob([u8], { type: `image/${subtype}` }), ext };
    }
    try {
      const res = await fetch(imgSource);
      if (!res.ok) return null;
      const blob = await res.blob();
      let ext = 'jpg';
      if (blob.type.includes('png')) ext = 'png';
      else if (blob.type.includes('webp')) ext = 'webp';
      return { blob, ext };
    } catch (_) {
      return null;
    }
  }

  async function downloadBackupAsZip(pkgData) {
    if (typeof JSZip === 'undefined') {
      const blob = new Blob([JSON.stringify(pkgData, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${sanitizeFilePart(pkgData.fileName || 'backup', 60)}.json`;
      a.click();
      return;
    }

    const zip = new JSZip();
    const imagesFolder = zip.folder('images');
    const localImageFiles = {};
    const groupMetaMap = {};

    (pkgData.logs || []).forEach(g => {
      if (g && g.GroupID) groupMetaMap[String(g.GroupID)] = g;
    });

    const imagesData = pkgData.imagesData || {};
    for (const gid of Object.keys(imagesData)) {
      const urls = Array.isArray(imagesData[gid]) ? imagesData[gid] : [];
      if (!urls.length) continue;
      const meta = groupMetaMap[String(gid)] || {};
      const datePart = sanitizeFilePart(meta.Date || 'nodate', 12);
      const sitePart = sanitizeFilePart(meta.Site || 'site', 20);
      const jobPart = sanitizeFilePart(meta.JobDetail || 'job', 24);
      const shortGid = sanitizeFilePart(String(gid).slice(0, 6), 8);

      localImageFiles[gid] = [];
      for (let i = 0; i < urls.length; i++) {
        const resolved = await resolveImageToBlobAndExt(urls[i]);
        if (resolved && resolved.blob) {
          const idxStr = String(i + 1).padStart(2, '0');
          const imgName = `${datePart}_${sitePart}_${jobPart}_${shortGid}_${idxStr}.${resolved.ext}`;
          imagesFolder.file(imgName, resolved.blob);
          localImageFiles[gid].push(`images/${imgName}`);
        }
      }
    }

    const fullJsonPayload = {
      ...pkgData,
      localImageFiles
    };

    zip.file('backup_data.json', JSON.stringify(fullJsonPayload, null, 2));
    zip.file('daily_logs.csv', buildLogsCsvContent(pkgData.rawLogs || [], localImageFiles));
    zip.file('tasks_summary.csv', buildTasksCsvContent(pkgData.tasks || []));

    const readmeText = [
      `============================================================`,
      `ชุดข้อมูลสำรองงวดงาน (Offline Backup Package)`,
      `ชื่อชุดข้อมูล: ${pkgData.fileName || '-'}`,
      `ช่วงวันที่: ${pkgData.startDate || '-'} ถึง ${pkgData.endDate || '-'}`,
      `ส่งออกเมื่อ: ${new Date().toLocaleString('th-TH')}`,
      `============================================================`,
      ``,
      `โครงสร้างไฟล์ภายในชุดนี้:`,
      `1. โฟลเดอร์ images/      -> เก็บไฟล์รูปถ่ายหน้างานจริงทั้งหมด แยกตามวันที่และชื่องาน สามารถส่งต่อให้แผนกอื่นเปิดดูได้ทันที`,
      `2. ไฟล์ daily_logs.csv   -> ตารางสรุปบันทึกงานรายวัน เปิดดูด้วยโปรแกรม Microsoft Excel ได้ทันที`,
      `3. ไฟล์ tasks_summary.csv -> ตารางสรุปใบสั่งงานและต้นทุน เปิดดูด้วยโปรแกรม Microsoft Excel ได้ทันที`,
      `4. ไฟล์ backup_data.json -> ฐานข้อมูลฉบับสมบูรณ์สำหรับเปิดดู/แก้ไขย้อนหลังด้วยโปรแกรมจัดการออฟไลน์บน PC (start_offline_pc.bat)`,
      `                           หรืออัปโหลดกลับเข้าสู่เว็บผ่านปุ่ม "📂 โหลด Backup -> 📤 นำเข้าไฟล์ Backup จาก PC"`
    ].join('\r\n');
    zip.file('README_วิธีใช้งานบน_PC.txt', readmeText);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${sanitizeFilePart(pkgData.fileName || 'Backup_Package', 60)}.zip`;
    a.click();
  }

  async function parseUploadedBackupFile(file) {
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.json')) {
      const text = await file.text();
      return JSON.parse(text);
    }
    if (name.endsWith('.zip')) {
      if (typeof JSZip === 'undefined') {
        throw new Error('ไม่พบไลบรารี JSZip สำหรับแตกไฟล์ .zip');
      }
      const zip = await JSZip.loadAsync(file);
      let jsonEntry = zip.file('backup_data.json');
      if (!jsonEntry) {
        const jsonFiles = zip.file(/\.json$/i);
        if (jsonFiles && jsonFiles.length > 0) jsonEntry = jsonFiles[0];
      }
      if (!jsonEntry) {
        throw new Error('ไม่พบไฟล์ backup_data.json ภายในไฟล์ .zip นี้');
      }
      const jsonText = await jsonEntry.async('string');
      const pkgData = JSON.parse(jsonText);

      // แปลงรูปภาพจากโฟลเดอร์ images/ ในไฟล์ .zip กลับมาเป็น Data URL เพื่อให้แสดงผลและอัปโหลดกลับขึ้นเว็บได้ครบถ้วน
      const localMap = pkgData.localImageFiles || {};
      const imagesData = pkgData.imagesData || {};
      for (const gid of Object.keys(localMap)) {
        const relPaths = Array.isArray(localMap[gid]) ? localMap[gid] : [];
        const loadedDataUrls = [];
        for (const relPath of relPaths) {
          const imgFile = zip.file(relPath);
          if (imgFile) {
            const b64 = await imgFile.async('base64');
            const ext = relPath.toLowerCase().endsWith('.png') ? 'png' : (relPath.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg');
            loadedDataUrls.push(`data:image/${ext};base64,${b64}`);
          }
        }
        if (loadedDataUrls.length > 0) {
          imagesData[gid] = loadedDataUrls;
        }
      }
      pkgData.imagesData = imagesData;
      return pkgData;
    }
    throw new Error('กรุณาเลือกไฟล์นามสกุล .zip หรือ .json เท่านั้น');
  }

  function openExportBackupModal(recentGroups = []) {
    closeModal();
    const dates = recentGroups.map(g => String(g.date || '').slice(0, 10)).filter(Boolean).sort();
    const defaultStart = dates.length > 0 ? dates[0] : new Date().toISOString().slice(0, 10);
    const defaultEnd = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);

    const backdrop = document.createElement('div');
    backdrop.id = 'backup-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box" style="max-width:540px">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">💾 สำรองข้อมูล & ส่งออกแพ็กเกจลง PC (.zip)</h3>
          <button id="modal-close-btn" class="btn btn-outline btn-sm">✕ ปิด</button>
        </div>
        <form id="export-backup-form" class="modal-body space-y-4">
          <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-slate-700 space-y-1">
            <div class="font-semibold text-blue-900">📦 แพ็กเกจไฟล์ .zip ที่ได้จะแยกโครงสร้างไฟล์พร้อมใช้งาน:</div>
            <div>• <strong>โฟลเดอร์ images/</strong> — รวมไฟล์รูปถ่ายหน้างานจริงทั้งหมดในช่วงวันที่เลือก ส่งต่อให้แผนกอื่นได้ทันที</div>
            <div>• <strong>daily_logs.csv & tasks_summary.csv</strong> — เปิดดูตารางสรุปใน Excel ได้ทันที</div>
            <div>• <strong>backup_data.json</strong> — เปิดดูและแก้ไขงานย้อนหลังแบบ Offline บน PC โดยไม่กระทบข้อมูลหน้าเว็บ</div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="field-label text-xs" for="export-start-date">ตั้งแต่วันที่</label>
              <input type="text" id="export-start-date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off" value="${Utils.escapeHtml(toDisplayDate(defaultStart))}">
            </div>
            <div>
              <label class="field-label text-xs" for="export-end-date">ถึงวันที่</label>
              <input type="text" id="export-end-date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off" value="${Utils.escapeHtml(toDisplayDate(defaultEnd))}">
            </div>
          </div>

          <div>
            <label class="field-label text-xs" for="export-backup-name">ชื่อชุดไฟล์สำรอง (เว้นว่างให้ตั้งตามช่วงวันที่อัตโนมัติได้)</label>
            <input type="text" id="export-backup-name" class="field-input w-full text-sm" placeholder="เช่น งานวันที่ 21-26 ก.ย. 69">
          </div>

          <div id="export-preview-box" class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1"></div>

          <div class="flex justify-end gap-2 pt-2 border-t border-slate-200 flex-wrap">
            <button type="button" id="export-cancel-btn" class="btn btn-outline">ยกเลิก</button>
            <button type="submit" id="export-zip-btn" class="btn btn-primary">
              📦 บันทึก Backup & ดาวน์โหลดลง PC (.zip)
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('export-cancel-btn').addEventListener('click', closeModal);

    const startInp = document.getElementById('export-start-date');
    const endInp = document.getElementById('export-end-date');
    const previewBox = document.getElementById('export-preview-box');

    let exportRangePicker = null;
    if (typeof Litepicker !== 'undefined' && startInp && endInp) {
      exportRangePicker = new Litepicker({
        element: startInp,
        elementEnd: endInp,
        singleMode: false,
        format: 'DD/MM/YYYY',
        lang: 'th-TH',
        autoApply: true,
        setup: (picker) => {
          picker.on('selected', () => {
            updatePreview();
          });
        }
      });
    }

    function updatePreview() {
      const s = toIsoDate(startInp.value);
      const e = toIsoDate(endInp.value);
      const matched = recentGroups.filter(g => {
        const d = String(g.date || '').slice(0, 10);
        if (s && d < s) return false;
        if (e && d > e) return false;
        return true;
      });
      const sumPay = matched.reduce((acc, g) => acc + (Number(g.totalPay) || 0), 0);
      previewBox.innerHTML = `
        <div class="flex justify-between"><span>จำนวนใบงานรายวันในช่วงที่เลือก:</span><strong class="font-mono text-blue-700">${matched.length} ใบงาน</strong></div>
        <div class="flex justify-between"><span>ยอดค่าแรงรวมในช่วงที่เลือก:</span><strong class="font-mono text-emerald-700">฿${Utils.money(sumPay)}</strong></div>
      `;
    }
    startInp.addEventListener('change', updatePreview);
    endInp.addEventListener('change', updatePreview);
    updatePreview();

    const form = document.getElementById('export-backup-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const startDate = toIsoDate(startInp.value) || null;
      const endDate = toIsoDate(endInp.value) || null;
      const customName = (document.getElementById('export-backup-name')?.value || '').trim();

      if (startDate && endDate && startDate > endDate) {
        Utils.toast('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', 'error');
        return;
      }

      const submitBtn = document.getElementById('export-zip-btn');
      try {
        const action = (async () => {
          const pkgData = await Api.buildBackupPackageData({
            startDate,
            endDate,
            customName,
            saveToHistory: true
          });
          await downloadBackupAsZip(pkgData);
          return pkgData;
        })();

        const pkgData = await Utils.animateProgress(
          submitBtn,
          action,
          'กำลังรวบรวมข้อมูลและรูปภาพลงไฟล์ .zip...',
          '✅ ดาวน์โหลดสำเร็จ'
        );
        Utils.toast(`สำรองและดาวน์โหลดแพ็กเกจเรียบร้อย: ${pkgData.fileName}.zip`, 'success');
        closeModal();
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
    });
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
              <input type="text" id="cutoff-start-date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off" value="${Utils.escapeHtml(toDisplayDate(defaultStart))}" required>
            </div>
            <div>
              <label class="field-label text-xs" for="cutoff-end-date">ถึงวันที่ <span class="text-red-500">*</span></label>
              <input type="text" id="cutoff-end-date" class="field-input w-full" placeholder="วว/ดด/ปปปป" autocomplete="off" value="${Utils.escapeHtml(toDisplayDate(defaultEnd))}" required>
            </div>
          </div>

          <div>
            <label class="field-label text-xs" for="cutoff-period-name">ชื่องวดงาน (เว้นว่างให้ตั้งตามวันที่อัตโนมัติได้)</label>
            <input type="text" id="cutoff-period-name" class="field-input w-full text-sm" placeholder="เช่น งวดวันที่ 1 - 15 พ.ย. 2026">
          </div>

          <div id="cutoff-preview-box" class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
            <!-- สรุปยอดก่อนตัดงวด -->
          </div>

          <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" id="cutoff-auto-zip" checked>
            <span>📦 ดาวน์โหลดแพ็กเกจไฟล์ Backup (.zip พร้อมโฟลเดอร์รูปภาพ) ลงเครื่อง PC ทันทีหลังตัดงวด</span>
          </label>

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

    let cutoffRangePicker = null;
    if (typeof Litepicker !== 'undefined' && startInp && endInp) {
      cutoffRangePicker = new Litepicker({
        element: startInp,
        elementEnd: endInp,
        singleMode: false,
        format: 'DD/MM/YYYY',
        lang: 'th-TH',
        autoApply: true,
        setup: (picker) => {
          picker.on('selected', () => {
            updateCutoffPreview();
          });
        }
      });
    }

    function updateCutoffPreview() {
      const s = toIsoDate(startInp.value);
      const e = toIsoDate(endInp.value);
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
      const startDate = toIsoDate(startInp.value);
      const endDate = toIsoDate(endInp.value);
      const customName = (document.getElementById('cutoff-period-name')?.value || '').trim();
      const autoZip = Boolean(document.getElementById('cutoff-auto-zip')?.checked);

      if (startDate && endDate && startDate > endDate) {
        Utils.toast('วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด', 'error');
        return;
      }
      if (!Utils.verifyPin('ใส่รหัส PIN (1225) เพื่อยืนยันการตัดงวดจ่ายค่าแรง:')) return;

      const submitBtn = document.getElementById('cutoff-submit-btn');
      try {
        const cutoffTask = (async () => {
          const res = await Api.closePayrollPeriod({ startDate, endDate, customName, archiveCompletedTasks: true });
          if (autoZip && res.fileId) {
            const pkg = await Api.buildBackupPackageData({ fileId: res.fileId });
            await downloadBackupAsZip(pkg);
          }
          return res;
        })();

        const result = await Utils.animateProgress(
          submitBtn,
          cutoffTask,
          'กำลังตัดงวดและแพ็กไฟล์สำรองข้อมูล...',
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
      <div class="modal-box" style="max-width:780px">
        <div class="modal-header">
          <h3 class="font-display text-lg font-semibold">📂 ประวัติงวดงานย้อนหลัง & นำเข้าไฟล์ Backup จาก PC</h3>
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

      const uploadBoxHtml = `
        <div class="p-3 mb-4 rounded-lg bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-3 flex-wrap">
          <div class="text-xs text-slate-700">
            <div class="font-semibold text-blue-900">📤 นำเข้าไฟล์ Backup ที่แก้ไขจากเครื่อง PC (.zip หรือ .json)</div>
            <div>เมื่อนำไฟล์ที่แก้ไขจากโปรแกรมบน PC กลับมาโหลด ระบบจะอัปเดตข้อมูลบนเว็บให้ตรงกับที่แก้ไขทันที</div>
          </div>
          <div>
            <input type="file" id="import-backup-file-inp" accept=".zip,.json" class="hidden">
            <button type="button" id="import-backup-file-btn" class="btn btn-primary btn-sm">📤 เลือกไฟล์จาก PC (.zip / .json)</button>
          </div>
        </div>
      `;

      const listHtml = files.length
        ? `<div class="flex flex-col gap-2">
            ${files.map(f => `
              <button class="btn btn-outline w-full justify-between backup-file-row" data-file-id="${Utils.escapeHtml(f.id)}">
                <div class="flex items-center gap-2 text-left">
                  <span>📦 ${Utils.escapeHtml(f.name)}</span>
                  ${f.completedTasksCount ? `<span class="badge badge-success text-[11px]">ใบสั่งงานที่จบ ${f.completedTasksCount} ใบ</span>` : ''}
                </div>
                <span class="font-mono text-xs" style="color:var(--ink-soft)">${Utils.formatDate(f.createdDate)}</span>
              </button>
            `).join('')}
          </div>`
        : `<div class="text-center py-6" style="color:var(--ink-soft)">ยังไม่มีประวัติในระบบ — กดปุ่ม "💰 ตัดงวดค่าแรง" หรือ "💾 Backup ไฟล์" หรือเลือกไฟล์จาก PC ด้านบน</div>`;

      body.innerHTML = uploadBoxHtml + listHtml;

      const fileInp = document.getElementById('import-backup-file-inp');
      const fileBtn = document.getElementById('import-backup-file-btn');
      if (fileBtn && fileInp) {
        fileBtn.addEventListener('click', () => fileInp.click());
        fileInp.addEventListener('change', async () => {
          const file = fileInp.files?.[0];
          if (!file) return;
          fileBtn.disabled = true;
          fileBtn.textContent = 'กำลังอ่านไฟล์...';
          try {
            const pkgData = await parseUploadedBackupFile(file);
            renderImportedPackagePreview(pkgData, file.name);
          } catch (err) {
            Utils.toast(err.message, 'error');
            fileBtn.disabled = false;
            fileBtn.textContent = '📤 เลือกไฟล์จาก PC (.zip / .json)';
          }
        });
      }

      body.querySelectorAll('.backup-file-row').forEach(btn => {
        btn.addEventListener('click', () => loadBackupData(btn.getAttribute('data-file-id')));
      });
    } catch (err) {
      if (!body.isConnected) return;
      body.innerHTML = '';
      body.appendChild(Utils.errorBanner(err.message, loadBackupList));
    }
  }

  function renderImportedPackagePreview(pkgData, sourceFileName) {
    const body = document.getElementById('modal-body');
    if (!body) return;

    // จัดกลุ่ม logs เพื่อแสดงพรีวิว
    let logs = Array.isArray(pkgData.logs) && pkgData.logs.length > 0 && pkgData.logs[0]?.Workers
      ? pkgData.logs
      : [];
    if (!logs.length && Array.isArray(pkgData.rawLogs)) {
      const gMap = {};
      pkgData.rawLogs.forEach(r => {
        const gid = r.GroupID || r.group_id;
        if (!gid) return;
        if (!gMap[gid]) {
          gMap[gid] = {
            GroupID: gid,
            Date: r.Date || r.work_date,
            Site: r.Site || r.site,
            JobDetail: r.JobDetail || r.job_detail,
            RequestedBy: r.RequestedBy || r.requested_by,
            Workers: []
          };
        }
        gMap[gid].Workers.push(r);
      });
      logs = Object.values(gMap).sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    }

    const allTasks = [
      ...(Array.isArray(pkgData.tasks) ? pkgData.tasks : []),
      ...(Array.isArray(pkgData.completedTasks) ? pkgData.completedTasks : [])
    ];
    const uniqTasksMap = new Map();
    allTasks.forEach(t => { if (t && t.id != null) uniqTasksMap.set(String(t.id), t); });
    const tasksList = Array.from(uniqTasksMap.values());

    const rowsHtml = logs.map(g => {
      const totalPay = (g.Workers || []).reduce((sum, w) => sum + (Number(w.TotalWithMarkup ?? w.total_with_markup) || 0), 0);
      return `
        <tr>
          <td class="text-center"><input type="checkbox" class="import-group-cb" value="${Utils.escapeHtml(g.GroupID)}" checked></td>
          <td class="text-center">${Utils.formatDate(g.Date)}</td>
          <td class="text-center">${Utils.escapeHtml(g.Site || '-')}</td>
          <td class="text-truncate text-left">${Utils.escapeHtml(g.JobDetail || '-')}</td>
          <td class="font-mono text-center">${(g.Workers || []).length} คน</td>
          <td class="font-mono font-semibold text-center" style="color:var(--blueprint-dark)">฿${Utils.money(totalPay)}</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = `
      <div class="p-3 mb-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-slate-700 space-y-1">
        <div class="font-semibold text-emerald-900">📂 อ่านไฟล์สำเร็จ: ${Utils.escapeHtml(pkgData.fileName || sourceFileName)}</div>
        <div>พบใบงานรายวัน <strong>${logs.length} ใบงาน</strong> และใบสั่งงาน <strong>${tasksList.length} รายการ</strong></div>
      </div>

      ${logs.length > 0 ? `
        <div class="overflow-x-auto max-h-60 mb-3">
          <table class="tape-table">
            <thead>
              <tr>
                <th style="width:36px"><input type="checkbox" id="import-select-all" checked></th>
                <th>วันที่</th><th>ไซต์งาน</th><th>รายละเอียด</th><th>จำนวนคน</th><th>รวมจ่าย</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      ` : `<div class="text-xs text-slate-500 py-3">ไม่มีรายการใบงานรายวันในไฟล์นี้</div>`}

      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2 mb-4">
        <div class="font-semibold text-slate-800">เลือกรูปแบบการอัปเดตเข้าสู่เว็บ:</div>
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="radio" name="import-mode" value="replace_matching" checked class="mt-0.5">
          <span><strong>อัปเดตทับเฉพาะใบงานที่เลือก (แนะนำ):</strong> แทนที่ใบงานเดิมที่แก้ไขมาจาก PC และเพิ่มใบงานใหม่ โดยไม่ลบใบงานอื่นนอกรายการ</span>
        </label>
        ${(pkgData.startDate && pkgData.endDate) ? `
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="radio" name="import-mode" value="replace_date_range" class="mt-0.5">
          <span><strong>แทนที่ข้อมูลทั้งช่วงวันที่ (${Utils.escapeHtml(pkgData.startDate)} ถึง ${Utils.escapeHtml(pkgData.endDate)}):</strong> ล้างใบงานเก่าในช่วงวันดังกล่าวบนเว็บแล้วใช้ข้อมูลจากไฟล์นี้แทนทั้งหมด</span>
        </label>` : ''}
      </div>

      <div class="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" id="back-to-list-btn" class="btn btn-outline btn-sm">← กลับไปหน้ารายการ</button>
        <button type="button" id="confirm-import-pkg-btn" class="btn btn-primary btn-sm">🔄 ยืนยันอัปเดตข้อมูลเข้าสู่เว็บ</button>
      </div>
    `;

    document.getElementById('back-to-list-btn').addEventListener('click', loadBackupList);
    const selAll = document.getElementById('import-select-all');
    if (selAll) {
      selAll.addEventListener('change', () => {
        body.querySelectorAll('.import-group-cb').forEach(cb => cb.checked = selAll.checked);
      });
    }

    const confirmBtn = document.getElementById('confirm-import-pkg-btn');
    confirmBtn.addEventListener('click', async () => {
      const selectedGroupIds = Array.from(body.querySelectorAll('.import-group-cb:checked')).map(cb => cb.value);
      const mode = body.querySelector('input[name="import-mode"]:checked')?.value || 'replace_matching';
      if (!selectedGroupIds.length && mode !== 'replace_date_range') {
        Utils.toast('กรุณาเลือกใบงานอย่างน้อย 1 รายการ', 'error');
        return;
      }
      if (!confirm('ยืนยันการอัปเดตข้อมูลจากไฟล์ Backup นี้เข้าสู่ระบบเว็บปัจจุบันหรือไม่?')) return;

      try {
        const res = await Utils.animateProgress(
          confirmBtn,
          Api.importBackupPackage(pkgData, { mode, selectedGroupIds, saveToBackupHistory: true }),
          'กำลังอัปเดตข้อมูลเข้าสู่เว็บ...',
          '✅ อัปเดตสำเร็จ'
        );
        Utils.toast(`อัปเดตข้อมูลบนเว็บสำเร็จ (ใบงานรายวัน ${res.updatedGroupsCount} ใบ, ใบสั่งงาน ${res.updatedTasksCount} ใบ)`, 'success');
        closeModal();
        load();
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
    });
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
          <div class="flex gap-2 flex-wrap">
            <button id="download-backup-zip-btn" class="btn btn-primary btn-sm">📦 ดาวน์โหลดแพ็กเกจลง PC (.zip พร้อมรูป)</button>
            <button id="download-backup-json-btn" class="btn btn-outline btn-sm">📥 ดาวน์โหลดเฉพาะ .json</button>
          </div>
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

      const zipBtn = document.getElementById('download-backup-zip-btn');
      if (zipBtn) {
        zipBtn.addEventListener('click', async () => {
          try {
            const action = (async () => {
              const pkg = await Api.buildBackupPackageData({ fileId });
              await downloadBackupAsZip(pkg);
            })();
            await Utils.animateProgress(zipBtn, action, 'กำลังสร้างไฟล์ .zip พร้อมรูป...', '✅ ดาวน์โหลดแล้ว');
            setTimeout(() => {
              zipBtn.disabled = false;
              zipBtn.innerHTML = '📦 ดาวน์โหลดแพ็กเกจลง PC (.zip พร้อมรูป)';
            }, 1200);
          } catch (err) {
            Utils.toast(err.message, 'error');
          }
        });
      }

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

    const unlinkedCount = sortedRecentGroups.filter(
      g => g.taskId === null || g.taskId === undefined || g.taskId === ''
    ).length;

    content.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${kpiCard('จำนวนคนงานทั้งหมด', data.totalWorkers, 'var(--blueprint)')}
        ${kpiCard('ใบงานที่บันทึกแล้ว', data.totalLogGroups, 'var(--amber-dark)')}
        ${kpiCard('ยอดค่าแรงปกติ+OT สะสม', Utils.money(data.totalNormalWage), 'var(--green)', '฿')}
        ${kpiCard('ยอดค่าแรงเหมาสะสม', Utils.money(data.totalFixedWage), 'var(--red)', '฿')}
      </div>

      <div class="ledger-card p-4">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="font-display text-lg font-semibold">รายการใบงานล่าสุด</h2>
            ${sortedRecentGroups.length > 0 ? (
              unlinkedCount > 0
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300" id="unlinked-logs-summary-badge">⚠️ ยังไม่ผูกใบสั่งงาน ${unlinkedCount} ใบ</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" id="unlinked-logs-summary-badge">✓ เชื่อมโยงใบสั่งงานครบทุกใบ</span>`
            ) : ''}
          </div>
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
      backupBtn.addEventListener('click', () => {
        if (!Utils.verifyPin()) return;
        openExportBackupModal(sortedRecentGroups);
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
        const typed = prompt('การกระทำนี้จะสำรองข้อมูลอัตโนมัติ ล้างบันทึกรายวันทั้งหมด และย้ายใบสั่งงานที่เสร็จสิ้น (100%) เข้าชุดสำรอง โดยคงไว้เฉพาะใบสั่งงานที่ยังค้างอยู่เพื่องวดถัดไป\n\nพิมพ์คำว่า ลบ เพื่อยืนยันการเริ่มงวดใหม่:');
        if (typed === null) return;
        if (typed.trim() !== 'ลบ') {
          Utils.toast('ข้อความยืนยันไม่ถูกต้อง — ยกเลิกการล้างบันทึก', 'error');
          return;
        }
        try {
          const clearAction = (async () => {
            try {
              await Api.backupSpreadsheet({ customName: `สำรองก่อนล้างงวด ${new Date().toLocaleDateString("th-TH")}` });
            } catch (e) {
              console.warn('Auto backup before clear error:', e);
            }
            if (typeof Api.snapshotActiveTasksBeforeClear === 'function') {
              await Api.snapshotActiveTasksBeforeClear();
            }
            return await Api.clearAllLogs({ archiveCompletedTasks: true });
          })();
          await Utils.animateProgress(
            clearBtn,
            clearAction,
            'กำลังสำรองข้อมูล ย้ายงานที่เสร็จสิ้น และล้างบันทึก...',
            '✅ ล้างสำเร็จ'
          );
          Utils.toast('ล้างบันทึกและเริ่มงวดใหม่เรียบร้อย (คงเหลืองานที่ยังไม่เสร็จ)', 'success');
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
