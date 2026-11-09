(() => {
  Utils.renderShell('workers.html', 'จัดการรายชื่อคนงาน');
  const content = document.getElementById('page-content');

  function showLocked() {
    content.innerHTML = `
      <div class="ledger-card p-8 text-center">
        <div class="text-4xl mb-3">🔒</div>
        <h2 class="font-display text-lg font-semibold mb-2">เมนูนี้ถูกจำกัดสิทธิ์การเข้าถึง</h2>
        <p class="mb-4" style="color:var(--ink-soft)">ต้องใส่รหัสผ่านก่อนจึงจะเข้าใช้งาน "จัดการคนงาน" ได้</p>
        <div class="flex gap-2 justify-center">
          <button id="retry-pin-btn" class="btn btn-primary">ใส่รหัสผ่าน</button>
          <a href="index.html" class="btn btn-outline">กลับหน้าแรก</a>
        </div>
      </div>
    `;
    document.getElementById('retry-pin-btn').addEventListener('click', checkAccess);
  }

  function checkAccess() {
    if (Utils.verifyPin('เมนู "จัดการคนงาน" ต้องใส่รหัสผ่านก่อนเข้าใช้งาน\nกรุณาใส่รหัส:')) {
      layout();
      loadTable();
    } else {
      showLocked();
    }
  }

  let editingId = null;

  function layout() {
    content.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <div class="ledger-card p-5 lg:col-span-1 h-fit">
          <h2 class="font-display text-lg font-semibold mb-4" id="form-title">เพิ่มคนงานใหม่</h2>
          <form id="worker-form" class="space-y-4">
            <div>
              <label class="field-label">ชื่อ-นามสกุล</label>
              <input type="text" id="f-name" class="field-input" required placeholder="เช่น สมชาย ใจดี">
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="field-label">เพศ</label>
                <select id="f-gender" class="field-input">
                  <option value="M">ช. (ชาย)</option>
                  <option value="F">ญ. (หญิง)</option>
                </select>
              </div>
              <div>
                <label class="field-label">อายุเริ่มงาน (ปี)</label>
                <input type="number" id="f-age" class="field-input" min="15" max="99" value="30" required placeholder="30">
              </div>
            </div>
            <div>
              <label class="field-label">วันที่เริ่มงาน / วันลงทะเบียน</label>
              <input type="date" id="f-reg-date" class="field-input" required>
            </div>
            <div>
              <label class="field-label">ค่าแรงขั้นต่ำต่อวัน (บาท)</label>
              <input type="number" id="f-wage" class="field-input" required min="0" step="1" placeholder="เช่น 400">
            </div>
            <div>
              <label class="field-label">ตำแหน่ง</label>
              <select id="f-role" class="field-input">
                <option value="Worker">👷 คนงาน (คิด +20%)</option>
                <option value="Supervisor">👑 หัวหน้างาน (ไม่คิด +20%)</option>
              </select>
            </div>
            <div>
              <label class="field-label">สถานะ</label>
              <select id="f-status" class="field-input">
                <option value="Active">ทำงานอยู่ (Active)</option>
                <option value="Inactive">พักงาน (Inactive)</option>
              </select>
            </div>
            <div class="flex gap-2 pt-1">
              <button type="submit" id="f-submit" class="btn btn-primary flex-1">
                <span id="f-submit-label">บันทึกคนงาน</span>
              </button>
              <button type="button" id="f-cancel" class="btn btn-outline hidden">ยกเลิก</button>
            </div>
          </form>
        </div>

        <div class="ledger-card p-4 lg:col-span-2">
          <div class="overflow-x-auto">
            <table class="tape-table">
              <thead>
                <tr>
                  <th class="text-center">ชื่อ-นามสกุล</th>
                  <th class="text-center">ตำแหน่ง</th>
                  <th class="text-center">ค่าแรง/วัน</th>
                  <th class="text-center">สถานะ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="worker-rows">${Utils.skeletonRows(5, 5)}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('worker-form').addEventListener('submit', onSubmit);
    document.getElementById('f-cancel').addEventListener('click', resetForm);
    resetForm();
  }

  function resetForm() {
    editingId = null;
    document.getElementById('form-title').textContent = 'เพิ่มคนงานใหม่';
    document.getElementById('f-submit-label').textContent = 'บันทึกคนงาน';
    document.getElementById('f-cancel').classList.add('hidden');
    document.getElementById('worker-form').reset();
    document.getElementById('f-role').value = 'Worker';
    document.getElementById('f-gender').value = 'M';
    document.getElementById('f-age').value = 30;
    const today = new Date().toISOString().slice(0, 10);
    const regInput = document.getElementById('f-reg-date');
    if (regInput) regInput.value = today;
  }

  function fillForm(w) {
    editingId = w.ID;
    document.getElementById('form-title').textContent = 'แก้ไขข้อมูลคนงาน #' + w.ID;
    document.getElementById('f-submit-label').textContent = 'บันทึกการแก้ไข';
    document.getElementById('f-cancel').classList.remove('hidden');
    document.getElementById('f-name').value = w.FullName;
    document.getElementById('f-wage').value = w.DailyWage;
    document.getElementById('f-status').value = w.Status || 'Active';
    document.getElementById('f-role').value = w.Role === 'Supervisor' ? 'Supervisor' : 'Worker';
    document.getElementById('f-gender').value = (w.Gender === 'F' || w.gender === 'F') ? 'F' : 'M';
    document.getElementById('f-age').value = Number(w.BaseAge ?? w.base_age) || 30;
    const regDate = w.RegisteredDate || w.registered_date;
    document.getElementById('f-reg-date').value = regDate ? String(regDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderRow(w) {
    const stampClass = w.Status === 'Active' ? 'stamp-active' : 'stamp-inactive';
    const stampLabel = w.Status === 'Active' ? 'ทำงานอยู่' : 'พักงาน';
    const isSupervisor = w.Role === 'Supervisor';
    const roleBadge = isSupervisor
      ? `<span class="badge text-[11px] font-semibold" style="background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd;">👑 หัวหน้างาน</span>`
      : `<span class="badge text-[11px]" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">👷 คนงาน</span>`;

    const genderLabel = (w.Gender === 'F' || w.gender === 'F') ? 'ญ.' : 'ช.';
    const displayAge = w.CurrentAge ?? w.current_age ?? (Number(w.BaseAge ?? w.base_age) || 30);
    const regDate = w.RegisteredDate || w.registered_date;
    const regDateText = regDate ? Utils.formatDate(String(regDate).slice(0, 10)) : '-';

    return `
      <tr>
        <td class="text-center align-middle py-2.5">
          <div class="font-semibold text-slate-800">
            ${Utils.escapeHtml(w.FullName)}
            <span class="text-xs font-normal text-slate-500 ml-1">(${genderLabel} ${displayAge} ปี)</span>
          </div>
          <div class="text-[11px] text-slate-400 font-mono mt-0.5">เริ่มงาน: ${regDateText}</div>
        </td>
        <td class="text-center align-middle">${roleBadge}</td>
        <td class="font-mono text-center align-middle">฿${Utils.money(w.DailyWage)}</td>
        <td class="text-center align-middle"><span class="stamp ${stampClass}">${stampLabel}</span></td>
        <td class="text-center align-middle">
          <div class="inline-flex items-center justify-center gap-2">
            <button class="btn btn-outline btn-sm" data-edit="${w.ID}">แก้ไข</button>
            <button class="btn btn-danger btn-sm" data-delete="${w.ID}">ลบ</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function loadTable() {
    const tbody = document.getElementById('worker-rows');
    try {
      const rawWorkers = await Api.getWorkers();
      if (!rawWorkers.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6" style="color:var(--ink-soft)">ยังไม่มีรายชื่อคนงาน</td></tr>`;
        return;
      }

      // จัดเรียงตามคำสั่ง:
      // 1. สถานะ: ทำงานอยู่ (Active) ขึ้นก่อนเสมอ ส่วนคนที่พักงาน (Inactive) จะตกไปอยู่ท้ายตารางเสมอ
      // 2. ตำแหน่ง: หัวหน้างาน (Supervisor) ขึ้นก่อน คนงาน (Worker)
      // 3. ค่าแรงต่อวัน: จากมากไปหาน้อย (Descending)
      // 4. ชื่อภาษาไทย: เรียงตามพยัญชนะไทย ก–ฮ (localeCompare('th'))
      const workers = [...rawWorkers].sort((a, b) => {
        const isActiveA = (a.Status || a.status) === 'Active' ? 1 : 0;
        const isActiveB = (b.Status || b.status) === 'Active' ? 1 : 0;
        if (isActiveA !== isActiveB) return isActiveB - isActiveA;

        const isSuperA = (a.Role === 'Supervisor' || a.role === 'Supervisor') ? 1 : 0;
        const isSuperB = (b.Role === 'Supervisor' || b.role === 'Supervisor') ? 1 : 0;
        if (isSuperA !== isSuperB) return isSuperB - isSuperA;

        const wageA = Number(a.DailyWage ?? a.daily_wage) || 0;
        const wageB = Number(b.DailyWage ?? b.daily_wage) || 0;
        if (wageA !== wageB) return wageB - wageA;

        const nameA = String(a.FullName || a.full_name || '');
        const nameB = String(b.FullName || b.full_name || '');
        return nameA.localeCompare(nameB, 'th');
      });

      tbody.innerHTML = workers.map(renderRow).join('');
      window.__workersCache = workers;

      tbody.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const w = workers.find(x => String(x.ID) === btn.getAttribute('data-edit'));
          if (w) fillForm(w);
        });
      });
      tbody.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('ยืนยันการลบคนงานคนนี้?')) return;
          try {
            await Api.deleteWorker({ id: btn.getAttribute('data-delete') });
            Utils.toast('ลบคนงานเรียบร้อย', 'success');
            loadTable();
          } catch (err) {
            Utils.toast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.appendChild(Utils.errorBanner(err.message, loadTable));
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('f-submit');
    const payload = {
      fullName: document.getElementById('f-name').value.trim(),
      gender: document.getElementById('f-gender').value,
      baseAge: parseInt(document.getElementById('f-age').value, 10) || 30,
      registeredDate: document.getElementById('f-reg-date').value,
      dailyWage: document.getElementById('f-wage').value,
      role: document.getElementById('f-role').value,
      status: document.getElementById('f-status').value
    };
    if (!payload.fullName) return;

    submitBtn.disabled = true;
    const originalLabel = document.getElementById('f-submit-label').textContent;
    document.getElementById('f-submit-label').innerHTML = '<span class="spinner"></span>';

    try {
      if (editingId) {
        await Api.updateWorker({ id: editingId, ...payload });
        Utils.toast('แก้ไขข้อมูลเรียบร้อย', 'success');
      } else {
        await Api.addWorker(payload);
        Utils.toast('เพิ่มคนงานเรียบร้อย', 'success');
      }
      resetForm();
      loadTable();
    } catch (err) {
      Utils.toast(err.message, 'error');
      document.getElementById('f-submit-label').textContent = originalLabel;
    } finally {
      submitBtn.disabled = false;
    }
  }

  checkAccess();
})();
