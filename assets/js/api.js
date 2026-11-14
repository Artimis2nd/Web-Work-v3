/**
 * โมดูลกลางสำหรับจัดการข้อมูล (Supabase Cloud API + Local Storage Fallback)
 * แทนที่ Google Apps Script (Code.gs) เดิมทั้งหมด 100% ด้วยความเร็วระดับมิลลิวินาที
 */
const Api = (() => {
  const LOCAL_KEYS = {
    WORKERS: 'WAGE_LOCAL_WORKERS',
    LOGS: 'WAGE_LOCAL_LOGS',
    IMAGES: 'WAGE_LOCAL_IMAGES',
    BACKUPS: 'WAGE_LOCAL_BACKUPS',
    TASKS: 'WAGE_LOCAL_TASKS',
    CALENDAR_OVERRIDES: 'WAGE_CALENDAR_OVERRIDES'
  };

  function getConfig() {
    const url = (localStorage.getItem('WAGE_SUPABASE_URL') || window.WAGE_CONFIG?.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (localStorage.getItem('WAGE_SUPABASE_KEY') || window.WAGE_CONFIG?.SUPABASE_ANON_KEY || '').trim();
    return {
      url,
      key,
      bucket: window.WAGE_CONFIG?.STORAGE_BUCKET || 'wage-images',
      markupRate: window.WAGE_CONFIG?.MARKUP_RATE || 1.2,
      hourlyDivisor: window.WAGE_CONFIG?.HOURLY_DIVISOR || 8,
      exemptWorker: window.WAGE_CONFIG?.EXEMPT_WORKER || 'เฟิร์น',
      isCloud: Boolean(url && key && url.startsWith('http'))
    };
  }

  function isCloudConfigured() {
    return getConfig().isCloud;
  }

  // ============================================================
  // สูตรคำนวณค่าแรง (ตรงกับ Code.gs เดิม 100%)
  // ============================================================
  function calcWage(dailyWage, wageType, hours, otHours, fixedAmount) {
    const cfg = getConfig();
    dailyWage = Number(dailyWage) || 0;
    hours = Number(hours) || 0;
    otHours = Number(otHours) || 0;
    fixedAmount = Number(fixedAmount) || 0;
    if (wageType === 'fixed') return fixedAmount;
    const hourlyRate = dailyWage / cfg.hourlyDivisor;
    return (hourlyRate * hours) + (hourlyRate * 2 * otHours);
  }

  function calcTotal(rawWage, workerName, wageType, role) {
    const cfg = getConfig();
    if (wageType === 'fixed') return rawWage;
    // หัวหน้างาน (Supervisor) หรือชื่อที่ระบุยกเว้น (เฟิร์น) จะไม่คิด +20%
    if (role === 'Supervisor' || role === 'หัวหน้างาน') return rawWage;
    if (workerName && workerName.indexOf(cfg.exemptWorker) !== -1) return rawWage;
    return rawWage * cfg.markupRate;
  }

  function generateUuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function formatBackupDate() {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // ============================================================
  // SUPABASE REST & STORAGE HELPER
  // ============================================================
  async function sbFetch(path, options = {}) {
    const cfg = getConfig();
    const headers = {
      'apikey': cfg.key,
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${cfg.url}${path}`, {
      ...options,
      headers
    });
    if (!res.ok) {
      let errMsg = `Supabase Error (${res.status})`;
      try {
        const errJson = await res.json();
        errMsg = errJson.message || errJson.error_description || errJson.hint || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function uploadBase64ToSupabase(base64, groupId, index) {
    const cfg = getConfig();
    const matches = base64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!matches) return base64;

    const mime = `image/${matches[1]}`;
    const ext = matches[1] === 'png' ? 'png' : 'jpg';
    const bstr = atob(matches[2]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    const blob = new Blob([u8arr], { type: mime });

    const shortId = groupId.substring(0, 8);
    const filePath = `${new Date().toISOString().slice(0, 10)}/${shortId}_${Date.now()}_${index}.${ext}`;

    const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${filePath}`, {
      method: 'POST',
      headers: {
        'apikey': cfg.key,
        'Authorization': `Bearer ${cfg.key}`,
        'Content-Type': mime,
        'x-upsert': 'true'
      },
      body: blob
    });

    if (!res.ok) {
      // หากอัปโหลดเข้า Storage ไม่สำเร็จ ให้เก็บ Base64 ที่บีบอัดแล้วลงตารางโดยตรงเพื่อไม่ให้รูปหาย
      return base64;
    }
    return `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${filePath}`;
  }

  // ============================================================
  // LOCAL STORAGE FALLBACK HELPERS (เมื่อยังไม่ได้ใส่คีย์คลาวด์)
  // ============================================================
  function readLocal(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultVal;
      return JSON.parse(raw);
    } catch (_) {
      return defaultVal;
    }
  }

  let syncDbTimer = null;
  function triggerLocalDbSync() {
    if (typeof fetch === 'undefined') return;
    clearTimeout(syncDbTimer);
    syncDbTimer = setTimeout(() => {
      try {
        const payload = {
          workers: readLocal(LOCAL_KEYS.WORKERS, []),
          logs: readLocal(LOCAL_KEYS.LOGS, []),
          tasks: readLocal(LOCAL_KEYS.TASKS, []),
          images: readLocal(LOCAL_KEYS.IMAGES, {}),
          syncedAt: new Date().toISOString()
        };
        fetch('/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch (_) {}
    }, 500);
  }

  // ผสานและซิงค์ข้อมูลสองทาง (Smart Merge) ระหว่างเบราว์เซอร์กับไดรฟ์ E:\#SRRC\Web-Work-v3\_local_data\db.json
  async function loadLocalDiskDbIfAvailable() {
    if (typeof fetch === 'undefined') return;
    try {
      const res = await fetch('/api/local-db');
      if (!res.ok) return;

      const diskDb = await res.json();
      if (!diskDb || typeof diskDb !== 'object') return;

      let needPushToDisk = false;

      // 1. ผสาน Tasks (คำสั่งงาน)
      const localTasks = readLocal(LOCAL_KEYS.TASKS, []) || [];
      const diskTasks = Array.isArray(diskDb.tasks) ? diskDb.tasks : [];
      const tasksMap = new Map();

      // นำงานจากดิสก์ใส่ Map
      diskTasks.forEach(t => {
        const key = t.task_code || String(t.id);
        if (key) tasksMap.set(key, t);
      });

      // นำงานจากเบราว์เซอร์นี้มาตรวจสอบ
      localTasks.forEach(t => {
        const key = t.task_code || String(t.id);
        if (!key) return;
        if (!tasksMap.has(key)) {
          // พบงานใหม่ในเบราว์เซอร์ที่ดิสก์ยังไม่มี (เช่น TSK-202611-006 ใน VS Code) -> เพิ่มเข้าไปทันที!
          tasksMap.set(key, t);
          needPushToDisk = true;
        } else {
          const diskItem = tasksMap.get(key);
          const localUpdated = t.updated_at || t.created_at || '';
          const diskUpdated = diskItem.updated_at || diskItem.created_at || '';
          if (localUpdated && localUpdated > diskUpdated) {
            tasksMap.set(key, t);
            needPushToDisk = true;
          }
        }
      });
      const mergedTasks = Array.from(tasksMap.values());
      mergedTasks.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      localStorage.setItem(LOCAL_KEYS.TASKS, JSON.stringify(mergedTasks));

      // 2. ผสาน Daily Logs (บันทึกงานประจำวัน)
      const localLogs = readLocal(LOCAL_KEYS.LOGS, []) || [];
      const diskLogs = Array.isArray(diskDb.logs) ? diskDb.logs.map(mapLogRowFromDb) : [];
      const logsMap = new Map();

      diskLogs.forEach(r => {
        const key = `${r.GroupID || r.group_id}_${r.WorkerName || r.worker_name}`;
        logsMap.set(key, r);
      });

      localLogs.forEach(r => {
        const key = `${r.GroupID || r.group_id}_${r.WorkerName || r.worker_name}`;
        if (!logsMap.has(key)) {
          logsMap.set(key, r);
          needPushToDisk = true;
        }
      });
      const mergedLogs = Array.from(logsMap.values());
      localStorage.setItem(LOCAL_KEYS.LOGS, JSON.stringify(mergedLogs));

      // 3. ผสาน Workers (คนงาน)
      const localWorkers = readLocal(LOCAL_KEYS.WORKERS, []) || [];
      const diskWorkers = Array.isArray(diskDb.workers) ? diskDb.workers : [];
      const workersMap = new Map();
      diskWorkers.forEach(w => workersMap.set(w.FullName || String(w.ID), w));
      localWorkers.forEach(w => {
        const key = w.FullName || String(w.ID);
        if (!workersMap.has(key)) {
          workersMap.set(key, w);
          needPushToDisk = true;
        }
      });
      const mergedWorkers = Array.from(workersMap.values());
      localStorage.setItem(LOCAL_KEYS.WORKERS, JSON.stringify(mergedWorkers));

      // 4. ผสาน Images
      const localImages = readLocal(LOCAL_KEYS.IMAGES, {}) || {};
      const diskImages = (diskDb.images && typeof diskDb.images === 'object') ? diskDb.images : {};
      const mergedImages = { ...diskImages, ...localImages };
      localStorage.setItem(LOCAL_KEYS.IMAGES, JSON.stringify(mergedImages));

      // 5. ผสาน Calendar Overrides (วันทำงานโรงงาน / วันหยุดบริษัท)
      const localOverrides = readLocal(LOCAL_KEYS.CALENDAR_OVERRIDES, {}) || {};
      const diskOverrides = (diskDb.calendar_day_status && typeof diskDb.calendar_day_status === 'object') ? diskDb.calendar_day_status : {};
      const mergedOverrides = { ...diskOverrides, ...localOverrides };
      localStorage.setItem(LOCAL_KEYS.CALENDAR_OVERRIDES, JSON.stringify(mergedOverrides));

      // หากเบราว์เซอร์นี้มีงานใหม่ที่ดิสก์ยังไม่มี ให้ส่งบันทึกขึ้น _local_data/db.json ทันที!
      if (needPushToDisk) {
        fetch('/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workers: mergedWorkers,
            logs: mergedLogs,
            tasks: mergedTasks,
            images: mergedImages
          })
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // กู้คืนรูปภาพจาก IndexedDB ของเครื่องลงโฟลเดอร์ E:\#SRRC\Web-Work-v3\_local_data\images\ อัตโนมัติ
  async function migrateIndexedDbToLocalDisk() {
    if (typeof fetch === 'undefined') return 0;
    try {
      const db = await openMediaDb();
      if (!db) return 0;

      let existingIds = new Set();
      try {
        const listRes = await fetch('/api/local-media-list');
        if (listRes.ok) {
          const listJson = await listRes.json();
          if (Array.isArray(listJson.mediaIds)) {
            existingIds = new Set(listJson.mediaIds);
          }
        }
      } catch (_) {}

      const allRecords = await new Promise((res) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const req = store.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        } catch (_) {
          res([]);
        }
      });

      let count = 0;
      for (const rec of allRecords) {
        if (!rec || !rec.id || !rec.data) continue;
        if (existingIds.has(rec.id)) continue;

        await fetch('/api/local-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rec)
        }).catch(() => {});
        count++;
      }
      return count;
    } catch (_) {
      return 0;
    }
  }

  function writeLocal(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
    if (key === LOCAL_KEYS.WORKERS || key === LOCAL_KEYS.LOGS || key === LOCAL_KEYS.TASKS || key === LOCAL_KEYS.IMAGES) {
      triggerLocalDbSync();
    }
  }

  function ensureLocalSeed() {
    const seed = (typeof window !== 'undefined' && window.INITIAL_REAL_DATA) ? window.INITIAL_REAL_DATA : null;
    const existingWorkers = readLocal(LOCAL_KEYS.WORKERS, null);
    const existingLogs = readLocal(LOCAL_KEYS.LOGS, null);

    // หากยังไม่มีคนงาน หรือเป็นตัวอย่าง 3 คนเดิม ให้เปลี่ยนเป็นข้อมูลจริง 10 คน
    const isDefaultSeed = Array.isArray(existingWorkers) && existingWorkers.length === 3 && existingWorkers[0]?.FullName === 'สมชาย ใจดี';
    if (!existingWorkers || isDefaultSeed) {
      if (seed && Array.isArray(seed.workers) && seed.workers.length > 0) {
        writeLocal(LOCAL_KEYS.WORKERS, seed.workers);
      } else {
        writeLocal(LOCAL_KEYS.WORKERS, [
          { ID: 'W1784178589597', FullName: 'สิน', DailyWage: 550, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178619159', FullName: 'เต้ย', DailyWage: 450, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178630869', FullName: 'เฟิร์น', DailyWage: 500, Status: 'Active', Role: 'Supervisor', Gender: 'F', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178640773', FullName: 'ทิง', DailyWage: 400, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178651489', FullName: 'ทน', DailyWage: 550, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178662554', FullName: 'เวิ่ง', DailyWage: 380, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178673827', FullName: 'วิท', DailyWage: 450, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178683969', FullName: 'โอ๊ต', DailyWage: 400, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178692709', FullName: 'ล่อน', DailyWage: 550, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' },
          { ID: 'W1784178692999', FullName: 'วุฒิ', DailyWage: 450, Status: 'Active', Role: 'Worker', Gender: 'M', BaseAge: 30, RegisteredDate: '2026-10-23' }
        ]);
      }
    }

    // หากยังไม่มีใบงานในเครื่อง (เพิ่งเปิดใช้งานครั้งแรก) ให้โหลดข้อมูลจริง 15 ใบงาน (85 แถวคนงาน) พร้อมรูปภาพเข้าทันที
    if (existingLogs === null) {
      if (seed && Array.isArray(seed.rawLogs) && seed.rawLogs.length > 0) {
        writeLocal(LOCAL_KEYS.LOGS, seed.rawLogs.map(mapLogRowFromDb));
        if (seed.imagesData) {
          writeLocal(LOCAL_KEYS.IMAGES, seed.imagesData);
        }
      }
    }

    // หากยังไม่มีใบสั่งงานในเครื่อง (เพิ่งเปิดใช้งานครั้งแรก) ให้โหลดใบสั่งงานตั้งต้นจาก seed-data.js
    const existingTasks = readLocal(LOCAL_KEYS.TASKS, null);
    if (existingTasks === null && seed && Array.isArray(seed.tasks) && seed.tasks.length > 0) {
      writeLocal(LOCAL_KEYS.TASKS, seed.tasks);
    }
  }

  // แปลงแถวจาก Supabase (snake_case) เป็นรูปแบบเดียวกับระบบเดิม (PascalCase) พร้อมคงคีย์ snake_case
  function mapLogRowFromDb(r) {
    const tid = r.task_id != null ? Number(r.task_id) : (r.TaskId != null ? Number(r.TaskId) : null);
    return {
      ID: r.id ?? r.ID,
      id: r.id ?? r.ID,
      GroupID: r.group_id ?? r.GroupID,
      group_id: r.group_id ?? r.GroupID,
      Date: r.work_date ?? r.Date,
      work_date: r.work_date ?? r.Date,
      Site: r.site ?? r.Site,
      site: r.site ?? r.Site,
      JobDetail: r.job_detail ?? r.JobDetail ?? '',
      job_detail: r.job_detail ?? r.JobDetail ?? '',
      RequestedBy: r.requested_by ?? r.RequestedBy ?? '',
      requested_by: r.requested_by ?? r.RequestedBy ?? '',
      WorkerName: r.worker_name ?? r.WorkerName,
      worker_name: r.worker_name ?? r.WorkerName,
      DailyWage: Number(r.daily_wage ?? r.DailyWage) || 0,
      daily_wage: Number(r.daily_wage ?? r.DailyWage) || 0,
      WageType: r.wage_type ?? r.WageType ?? 'hourly',
      wage_type: r.wage_type ?? r.WageType ?? 'hourly',
      Hours: Number(r.hours ?? r.Hours) || 0,
      hours: Number(r.hours ?? r.Hours) || 0,
      OTHours: Number(r.ot_hours ?? r.OTHours) || 0,
      ot_hours: Number(r.ot_hours ?? r.OTHours) || 0,
      FixedAmount: Number(r.fixed_amount ?? r.FixedAmount) || 0,
      fixed_amount: Number(r.fixed_amount ?? r.FixedAmount) || 0,
      RawWage: Number(r.raw_wage ?? r.RawWage) || 0,
      raw_wage: Number(r.raw_wage ?? r.RawWage) || 0,
      TotalWithMarkup: Number(r.total_with_markup ?? r.TotalWithMarkup) || 0,
      total_with_markup: Number(r.total_with_markup ?? r.TotalWithMarkup) || 0,
      TaskId: tid,
      task_id: tid,
      CreatedAt: r.created_at ?? r.CreatedAt,
      created_at: r.created_at ?? r.CreatedAt
    };
  }

  function calcWorkerCurrentAge(w) {
    const baseAge = Number(w.BaseAge ?? w.base_age) || 30;
    const regDateStr = w.RegisteredDate || w.registered_date;
    if (!regDateStr) return baseAge;
    const regYear = new Date(regDateStr).getFullYear();
    const currentYear = new Date().getFullYear();
    const diff = currentYear - regYear;
    return baseAge + Math.max(0, diff);
  }

  // ============================================================
  // CORE DATA FETCHERS (WORKERS & LOGS)
  // ============================================================
  async function fetchAllWorkers() {
    const cfg = getConfig();
    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/workers?select=*&order=id.asc');
      return (rows || []).map(r => {
        const item = {
          ID: r.id,
          FullName: r.full_name,
          DailyWage: Number(r.daily_wage) || 0,
          Status: r.status || 'Active',
          Role: r.role || (r.full_name && r.full_name.indexOf(cfg.exemptWorker) !== -1 ? 'Supervisor' : 'Worker'),
          Gender: r.gender || (r.full_name && r.full_name.indexOf('เฟิร์น') !== -1 ? 'F' : 'M'),
          BaseAge: Number(r.base_age) || 30,
          RegisteredDate: r.registered_date ? String(r.registered_date).slice(0, 10) : '2026-10-23'
        };
        item.CurrentAge = calcWorkerCurrentAge(item);
        return item;
      });
    }
    ensureLocalSeed();
    const list = readLocal(LOCAL_KEYS.WORKERS, []);
    return list.map(w => {
      const item = {
        ...w,
        Role: w.Role || (w.FullName && w.FullName.indexOf(cfg.exemptWorker) !== -1 ? 'Supervisor' : 'Worker'),
        Gender: w.Gender || (w.FullName && w.FullName.indexOf('เฟิร์น') !== -1 ? 'F' : 'M'),
        BaseAge: Number(w.BaseAge) || 30,
        RegisteredDate: w.RegisteredDate ? String(w.RegisteredDate).slice(0, 10) : '2026-10-23'
      };
      item.CurrentAge = calcWorkerCurrentAge(item);
      return item;
    });
  }

  async function fetchAllLogRows(filters = {}) {
    if (isCloudConfigured()) {
      let query = '/rest/v1/daily_logs?select=*&order=work_date.desc,id.asc';
      if (filters.startDate) query += `&work_date=gte.${encodeURIComponent(filters.startDate)}`;
      if (filters.endDate) query += `&work_date=lte.${encodeURIComponent(filters.endDate)}`;
      if (filters.workerName) query += `&worker_name=eq.${encodeURIComponent(filters.workerName)}`;
      if (filters.groupId) query += `&group_id=eq.${encodeURIComponent(filters.groupId)}`;
      if (filters.taskId != null) query += `&task_id=eq.${encodeURIComponent(filters.taskId)}`;
      const rows = await sbFetch(query);
      return (rows || []).map(mapLogRowFromDb);
    }

    ensureLocalSeed();
    let logs = readLocal(LOCAL_KEYS.LOGS, []);
    if (filters.startDate) logs = logs.filter(r => (r.Date || r.work_date) >= filters.startDate);
    if (filters.endDate) logs = logs.filter(r => (r.Date || r.work_date) <= filters.endDate);
    if (filters.workerName) logs = logs.filter(r => (r.WorkerName || r.worker_name) === filters.workerName);
    if (filters.groupId) logs = logs.filter(r => String(r.GroupID || r.group_id) === String(filters.groupId));
    if (filters.taskId != null) logs = logs.filter(r => String(r.TaskId ?? r.task_id) === String(filters.taskId));
    return logs;
  }

  async function getDailyWorkerHoursSummary(dateStr, excludeGroupId = null) {
    if (!dateStr) return {};
    const dStr = String(dateStr).slice(0, 10);
    const rows = await fetchAllLogRows({ startDate: dStr, endDate: dStr });
    const summary = {};
    const relevantRows = excludeGroupId
      ? rows.filter(r => String(r.GroupID || r.group_id) !== String(excludeGroupId))
      : rows;

    relevantRows.forEach(r => {
      const name = r.WorkerName || r.worker_name;
      if (!name) return;
      if (!summary[name]) {
        summary[name] = {
          regularHours: 0,
          otHours: 0,
          fixedAmount: 0,
          entries: []
        };
      }
      const h = Number(r.Hours ?? r.hours) || 0;
      const ot = Number(r.OTHours ?? r.ot_hours) || 0;
      const fixed = Number(r.FixedAmount ?? r.fixed_amount) || 0;
      summary[name].regularHours += h;
      summary[name].otHours += ot;
      summary[name].fixedAmount += fixed;
      summary[name].entries.push({
        taskId: r.TaskId ?? r.task_id,
        hours: h,
        otHours: ot,
        site: r.Site || r.site,
        jobDetail: r.JobDetail || r.job_detail
      });
    });
    return summary;
  }

  async function fetchImageUrls(groupId) {
    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/log_images?select=image_urls&group_id=eq.${encodeURIComponent(groupId)}`);
      if (rows && rows.length > 0) {
        return Array.isArray(rows[0].image_urls) ? rows[0].image_urls : [];
      }
      return [];
    }
    const imgMap = readLocal(LOCAL_KEYS.IMAGES, {});
    return imgMap[groupId] || [];
  }

  async function getAllImages() {
    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/log_images?select=group_id,image_urls');
      const map = {};
      (rows || []).forEach(r => {
        if (r && r.group_id) {
          map[r.group_id] = Array.isArray(r.image_urls) ? r.image_urls : [];
        }
      });
      return map;
    }
    return readLocal(LOCAL_KEYS.IMAGES, {});
  }

  async function saveGroupImages(groupId, urls) {
    if (isCloudConfigured()) {
      await sbFetch('/rest/v1/log_images', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          group_id: groupId,
          image_urls: urls,
          updated_at: new Date().toISOString()
        })
      });
      return;
    }

    // โหมดไดรฟ์พกพา/ออฟไลน์: บันทึกรูปภาพ Base64 เป็นไฟล์ภาพจริงใน _local_data/images/ บนไดรฟ์ E:
    const diskUrls = [];
    for (let i = 0; i < (urls || []).length; i++) {
      const u = urls[i];
      if (typeof u === 'string' && u.startsWith('data:image/')) {
        const mediaId = `log_${groupId}_${i + 1}`;
        try {
          if (typeof fetch !== 'undefined') {
            const upRes = await fetch('/api/local-media', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: mediaId,
                group_id: groupId,
                name: `${mediaId}.jpg`,
                type: 'image/jpeg',
                media_kind: 'image',
                data: u
              })
            });
            if (upRes.ok) {
              const upJson = await upRes.json();
              diskUrls.push(upJson.url || `/api/local-media/${encodeURIComponent(mediaId)}?raw=1`);
              continue;
            }
          }
        } catch (_) {}
      }
      diskUrls.push(u);
    }

    const imgMap = readLocal(LOCAL_KEYS.IMAGES, {});
    imgMap[groupId] = diskUrls;
    writeLocal(LOCAL_KEYS.IMAGES, imgMap);
  }

  // ============================================================
  // PUBLIC API METHODS (ตรงกับทุก Action ของระบบเดิม)
  // ============================================================
  async function getWorkers() {
    return fetchAllWorkers();
  }

  async function addWorker(payload) {
    const role = payload.role || 'Worker';
    const gender = payload.gender || 'M';
    const baseAge = Number(payload.baseAge) || 30;
    const registeredDate = payload.registeredDate ? String(payload.registeredDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/workers', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          full_name: payload.fullName,
          daily_wage: Number(payload.dailyWage) || 0,
          status: payload.status || 'Active',
          role,
          gender,
          base_age: baseAge,
          registered_date: registeredDate
        })
      });
      return { id: rows?.[0]?.id };
    }
    const workers = await fetchAllWorkers();
    const maxId = workers.reduce((m, w) => Math.max(m, Number(w.ID) || 0), 0);
    const newId = maxId + 1;
    const newWorker = {
      ID: newId,
      FullName: payload.fullName,
      DailyWage: Number(payload.dailyWage) || 0,
      Status: payload.status || 'Active',
      Role: role,
      Gender: gender,
      BaseAge: baseAge,
      RegisteredDate: registeredDate
    };
    newWorker.CurrentAge = calcWorkerCurrentAge(newWorker);
    workers.push(newWorker);
    writeLocal(LOCAL_KEYS.WORKERS, workers);
    return { id: newId };
  }

  async function updateWorker(payload) {
    if (isCloudConfigured()) {
      const body = {
        full_name: payload.fullName,
        daily_wage: Number(payload.dailyWage) || 0,
        status: payload.status || 'Active'
      };
      if (payload.role) body.role = payload.role;
      if (payload.gender) body.gender = payload.gender;
      if (payload.baseAge != null) body.base_age = Number(payload.baseAge) || 30;
      if (payload.registeredDate) body.registered_date = String(payload.registeredDate).slice(0, 10);

      await sbFetch(`/rest/v1/workers?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      return { id: payload.id };
    }
    const workers = await fetchAllWorkers();
    const idx = workers.findIndex(w => String(w.ID) === String(payload.id));
    if (idx === -1) throw new Error('ไม่พบคนงาน ID: ' + payload.id);
    const updated = {
      ...workers[idx],
      FullName: payload.fullName,
      DailyWage: Number(payload.dailyWage) || 0,
      Status: payload.status || 'Active',
      Role: payload.role || workers[idx].Role || 'Worker',
      Gender: payload.gender || workers[idx].Gender || 'M',
      BaseAge: payload.baseAge != null ? (Number(payload.baseAge) || 30) : (workers[idx].BaseAge || 30),
      RegisteredDate: payload.registeredDate ? String(payload.registeredDate).slice(0, 10) : (workers[idx].RegisteredDate || '2026-10-23')
    };
    updated.CurrentAge = calcWorkerCurrentAge(updated);
    workers[idx] = updated;
    writeLocal(LOCAL_KEYS.WORKERS, workers);
    return { id: payload.id };
  }

  async function deleteWorker(payload) {
    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/workers?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'DELETE'
      });
      return { deleted: true };
    }
    const workers = await fetchAllWorkers();
    const filtered = workers.filter(w => String(w.ID) !== String(payload.id));
    writeLocal(LOCAL_KEYS.WORKERS, filtered);
    return { deleted: true };
  }

  async function getDashboard() {
    const [workers, logs, tasks] = await Promise.all([
      fetchAllWorkers(),
      fetchAllLogRows(),
      getTasks().catch(() => [])
    ]);
    const totalWorkers = workers.filter(w => w.Status === 'Active').length;
    const taskMap = new Map((tasks || []).map(t => [String(t.id), t]));
    const groups = {};

    logs.forEach(row => {
      const gid = row.GroupID;
      if (!gid) return;
      const rowTaskId = row.TaskId != null ? Number(row.TaskId) : (row.task_id != null ? Number(row.task_id) : null);
      if (!groups[gid]) {
        groups[gid] = {
          groupId: gid,
          date: row.Date,
          site: row.Site,
          jobDetail: row.JobDetail,
          requestedBy: row.RequestedBy,
          taskId: rowTaskId,
          workers: [],
          totalRaw: 0,
          totalNormal: 0,
          totalFixed: 0,
          createdAt: row.CreatedAt
        };
      }
      if (!groups[gid].jobDetail && row.JobDetail) groups[gid].jobDetail = row.JobDetail;
      if (!groups[gid].requestedBy && row.RequestedBy) groups[gid].requestedBy = row.RequestedBy;
      if (groups[gid].taskId == null && rowTaskId != null) groups[gid].taskId = rowTaskId;

      const g = groups[gid];
      g.workers.push(row.WorkerName);
      g.totalRaw += Number(row.RawWage) || 0;
      if (row.WageType === 'fixed') {
        g.totalFixed += Number(row.TotalWithMarkup) || 0;
      } else {
        g.totalNormal += Number(row.TotalWithMarkup) || 0;
      }
    });

    const groupList = Object.values(groups);
    groupList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    let totalNormalWage = 0;
    let totalFixedWage = 0;
    groupList.forEach(g => {
      totalNormalWage += g.totalNormal;
      totalFixedWage += g.totalFixed;
    });

    const recentGroups = groupList.slice(0, 50).map(g => {
      const linkedTask = g.taskId != null ? taskMap.get(String(g.taskId)) : null;
      return {
        groupId: g.groupId,
        date: g.date,
        site: g.site,
        jobDetail: g.jobDetail,
        requestedBy: g.requestedBy,
        taskId: g.taskId != null ? g.taskId : null,
        taskCode: linkedTask ? (linkedTask.task_code || `TSK-${linkedTask.id}`) : null,
        taskTitle: linkedTask ? (linkedTask.title || '') : null,
        workerCount: g.workers.length,
        totalNormal: g.totalNormal,
        totalFixed: g.totalFixed
      };
    });

    return {
      totalWorkers,
      totalLogGroups: groupList.length,
      totalNormalWage,
      totalFixedWage,
      recentGroups
    };
  }

  async function getLogs(payload = {}) {
    await loadLocalDiskDbIfAvailable().catch(() => {});
    const logs = await fetchAllLogRows({
      startDate: payload.startDate,
      endDate: payload.endDate
    });

    const groups = {};
    logs.forEach(row => {
      const gid = row.GroupID;
      if (!gid) return;
      if (!groups[gid]) {
        groups[gid] = {
          GroupID: gid,
          Date: row.Date,
          Site: row.Site,
          JobDetail: row.JobDetail,
          RequestedBy: row.RequestedBy,
          TaskId: row.TaskId != null ? row.TaskId : (row.task_id != null ? row.task_id : null),
          Workers: []
        };
      }
      groups[gid].Workers.push(row);
    });

    const groupList = Object.values(groups);
    groupList.sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    return { logs: groupList };
  }

  async function addLogs(payload) {
    const groupId = generateUuid();
    const date = payload.date;
    const site = payload.site || '';
    const jobDetail = payload.jobDetail || '';
    const requestedBy = payload.requestedBy || '';
    const workers = payload.workers || [];
    const images = payload.images || [];
    const taskId = payload.taskId != null ? Number(payload.taskId) : (payload.task_id != null ? Number(payload.task_id) : null);
    const now = new Date().toISOString();

    let imageUrls = [];
    if (images.length > 0) {
      if (isCloudConfigured()) {
        imageUrls = await Promise.all(images.map((img, i) =>
          img.startsWith('data:') ? uploadBase64ToSupabase(img, groupId, i) : Promise.resolve(img)
        ));
      } else {
        imageUrls = [...images];
      }
      await saveGroupImages(groupId, imageUrls);
    }

    let totalMarkup = 0;
    const dbRows = workers.map(w => {
      const rawWage = calcWage(w.dailyWage, w.wageType, w.hours, w.otHours, w.fixedAmount);
      const totalWage = calcTotal(rawWage, w.workerName, w.wageType, w.role);
      totalMarkup += totalWage;
      return {
        group_id: groupId,
        work_date: date,
        site,
        job_detail: jobDetail,
        requested_by: requestedBy,
        worker_name: w.workerName,
        daily_wage: Number(w.dailyWage) || 0,
        wage_type: w.wageType || 'hourly',
        hours: Number(w.hours) || 0,
        ot_hours: Number(w.otHours) || 0,
        fixed_amount: Number(w.fixedAmount) || 0,
        raw_wage: rawWage,
        total_with_markup: totalWage,
        task_id: taskId,
        created_at: now
      };
    });

    if (isCloudConfigured()) {
      await sbFetch('/rest/v1/daily_logs', {
        method: 'POST',
        body: JSON.stringify(dbRows)
      });
    } else {
      const existing = readLocal(LOCAL_KEYS.LOGS, []);
      let maxId = existing.reduce((m, r) => Math.max(m, Number(r.ID ?? r.id) || 0), 0);
      dbRows.forEach(r => {
        maxId++;
        existing.push(mapLogRowFromDb({ ...r, id: maxId }));
      });
      writeLocal(LOCAL_KEYS.LOGS, existing);
    }

    return {
      count: dbRows.length,
      totalMarkup,
      groupId,
      taskId,
      imageCount: imageUrls.length
    };
  }

  async function deleteLogGroup(payload) {
    const groupId = payload.groupId;
    const groupRows = await fetchAllLogRows({ groupId }).catch(() => []);
    const linkedTaskId = groupRows.length > 0
      ? (groupRows[0].TaskId != null ? Number(groupRows[0].TaskId) : (groupRows[0].task_id != null ? Number(groupRows[0].task_id) : null))
      : null;
    const linkedWorkDate = groupRows.length > 0 ? String(groupRows[0].Date || groupRows[0].work_date || '').slice(0, 10) : '';

    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/daily_logs?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      await sbFetch(`/rest/v1/log_images?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
    } else {
      const existing = readLocal(LOCAL_KEYS.LOGS, []).filter(r => String(r.GroupID || r.group_id) !== String(groupId));
      writeLocal(LOCAL_KEYS.LOGS, existing);
      const imgMap = readLocal(LOCAL_KEYS.IMAGES, {});
      delete imgMap[groupId];
      writeLocal(LOCAL_KEYS.IMAGES, imgMap);
    }

    let revertedTask = null;
    if (linkedTaskId != null) {
      try {
        revertedTask = await revertTaskProgressOnLogDelete(linkedTaskId, groupId, linkedWorkDate);
      } catch (err) {
        console.warn('ไม่สามารถคืนค่าความคืบหน้าใบสั่งงานเมื่อลบใบงาน:', err);
      }
    }

    return { deleted: true, revertedTask };
  }

  async function getLogGroup(payload) {
    const groupId = payload.groupId;
    const [groupRows, imageUrls] = await Promise.all([
      fetchAllLogRows({ groupId }),
      fetchImageUrls(groupId)
    ]);
    if (!groupRows.length) throw new Error('ไม่พบใบงานที่ระบุ');
    const first = groupRows[0];
    const firstTaskId = first.TaskId != null ? Number(first.TaskId) : (first.task_id != null ? Number(first.task_id) : null);
    const workers = groupRows.map(row => ({
      workerName: row.WorkerName || row.worker_name,
      dailyWage: Number(row.DailyWage ?? row.daily_wage) || 0,
      wageType: row.WageType || row.wage_type || 'hourly',
      hours: Number(row.Hours ?? row.hours) || 0,
      otHours: Number(row.OTHours ?? row.ot_hours) || 0,
      fixedAmount: Number(row.FixedAmount ?? row.fixed_amount) || 0,
      RawWage: Number(row.RawWage ?? row.raw_wage) || 0,
      TotalWithMarkup: Number(row.TotalWithMarkup ?? row.total_with_markup) || 0,
      TaskId: row.TaskId != null ? Number(row.TaskId) : (row.task_id != null ? Number(row.task_id) : null),
      task_id: row.task_id != null ? Number(row.task_id) : (row.TaskId != null ? Number(row.TaskId) : null)
    }));
    return {
      groupId,
      date: first.Date || first.work_date,
      site: first.Site || first.site,
      jobDetail: first.JobDetail || first.job_detail,
      requestedBy: first.RequestedBy || first.requested_by,
      taskId: firstTaskId,
      imageUrls,
      workers
    };
  }

  async function updateLogGroup(payload) {
    const groupId = payload.groupId;
    if (!groupId) throw new Error('ต้องระบุ GroupId สำหรับการแก้ไข');
    const date = payload.date;
    const site = payload.site || '';
    const jobDetail = payload.jobDetail || '';
    const requestedBy = payload.requestedBy || '';
    const workers = payload.workers || [];
    const images = payload.images || [];
    let taskId = payload.taskId != null ? Number(payload.taskId) : (payload.task_id != null ? Number(payload.task_id) : null);
    if (taskId === null && payload.taskId === undefined && payload.task_id === undefined) {
      const existingRows = await fetchAllLogRows({ groupId });
      if (existingRows.length > 0 && (existingRows[0].TaskId != null || existingRows[0].task_id != null)) {
        taskId = Number(existingRows[0].TaskId ?? existingRows[0].task_id);
      }
    }
    const now = new Date().toISOString();

    let finalUrls = [];
    if (isCloudConfigured()) {
      finalUrls = await Promise.all(images.map((img, i) =>
        img.startsWith('data:') ? uploadBase64ToSupabase(img, groupId, i) : Promise.resolve(img)
      ));
    } else {
      finalUrls = [...images];
    }
    await saveGroupImages(groupId, finalUrls);

    let totalMarkup = 0;
    const dbRows = workers.map(w => {
      const rawWage = calcWage(w.dailyWage, w.wageType, w.hours, w.otHours, w.fixedAmount);
      const totalWage = calcTotal(rawWage, w.workerName, w.wageType, w.role);
      totalMarkup += totalWage;
      return {
        group_id: groupId,
        work_date: date,
        site,
        job_detail: jobDetail,
        requested_by: requestedBy,
        worker_name: w.workerName,
        daily_wage: Number(w.dailyWage) || 0,
        wage_type: w.wageType || 'hourly',
        hours: Number(w.hours) || 0,
        ot_hours: Number(w.otHours) || 0,
        fixed_amount: Number(w.fixedAmount) || 0,
        raw_wage: rawWage,
        total_with_markup: totalWage,
        task_id: taskId,
        created_at: now
      };
    });

    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/daily_logs?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      await sbFetch('/rest/v1/daily_logs', {
        method: 'POST',
        body: JSON.stringify(dbRows)
      });
    } else {
      const existing = readLocal(LOCAL_KEYS.LOGS, []).filter(r => String(r.GroupID || r.group_id) !== String(groupId));
      let maxId = existing.reduce((m, r) => Math.max(m, Number(r.ID ?? r.id) || 0), 0);
      dbRows.forEach(r => {
        maxId++;
        existing.push(mapLogRowFromDb({ ...r, id: maxId }));
      });
      writeLocal(LOCAL_KEYS.LOGS, existing);
    }

    return {
      count: dbRows.length,
      totalMarkup,
      groupId,
      taskId,
      imageCount: finalUrls.length
    };
  }

  async function getSiteHistory() {
    const logs = await fetchAllLogRows();
    const sites = new Set();
    logs.forEach(r => { if (r.Site) sites.add(r.Site); });
    return Array.from(sites).sort();
  }

  async function getRequesterHistory() {
    const logs = await fetchAllLogRows();
    const reqs = new Set();
    logs.forEach(r => { if (r.RequestedBy) reqs.add(r.RequestedBy); });
    return Array.from(reqs).sort();
  }

  async function getReport(payload = {}) {
    const logs = await fetchAllLogRows({
      workerName: payload.workerName,
      startDate: payload.startDate,
      endDate: payload.endDate
    });
    let totalRaw = 0;
    let totalMarkup = 0;
    const logList = logs.map(row => {
      const raw = Number(row.RawWage) || 0;
      const markup = Number(row.TotalWithMarkup) || 0;
      totalRaw += raw;
      totalMarkup += markup;
      return {
        Date: row.Date,
        Site: row.Site,
        JobDetail: row.JobDetail,
        RequestedBy: row.RequestedBy,
        WorkerName: row.WorkerName,
        WageType: row.WageType,
        Hours: row.Hours,
        OTHours: row.OTHours,
        FixedAmount: row.FixedAmount,
        RawWage: raw,
        TotalWithMarkup: markup
      };
    });
    return { totalRaw, totalMarkup, logs: logList };
  }

  async function getPivotReport(payload = {}) {
    const logs = await fetchAllLogRows({
      startDate: payload.startDate,
      endDate: payload.endDate
    });
    const groupBy = payload.groupBy === 'site' ? 'Site' : 'Date';
    const groups = {};
    logs.forEach(row => {
      const key = row[groupBy] || '(ไม่ระบุ)';
      if (!groups[key]) {
        groups[key] = { key, workerSet: {}, logCount: 0, totalRaw: 0, totalMarkup: 0 };
      }
      const g = groups[key];
      g.workerSet[row.WorkerName] = true;
      g.logCount++;
      g.totalRaw += Number(row.RawWage) || 0;
      g.totalMarkup += Number(row.TotalWithMarkup) || 0;
    });

    const rows = Object.values(groups).map(g => ({
      key: g.key,
      workerCount: Object.keys(g.workerSet).length,
      logCount: g.logCount,
      totalRaw: g.totalRaw,
      totalMarkup: g.totalMarkup
    }));
    rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));

    let grandTotalRaw = 0;
    let grandTotalMarkup = 0;
    rows.forEach(r => {
      grandTotalRaw += r.totalRaw;
      grandTotalMarkup += r.totalMarkup;
    });
    return { groupBy, grandTotalRaw, grandTotalMarkup, rows };
  }

  // ============================================================
  // ระบบจัดเก็บไฟล์สื่อ (รูปภาพ & วิดีโอสั้น) สำหรับใบสั่งงานด้วย IndexedDB
  // รองรับโหมด Local ไฟล์ขนาดใหญ่ (จำกัดสูงสุด 50 MB ต่อไฟล์)
  // ============================================================
  const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
  const IDB_NAME = 'WAGE_MEDIA_DB';
  const IDB_VERSION = 1;
  const IDB_STORE = 'task_media';
  const memoryMediaStore = {}; // Fallback สำหรับสภาพแวดล้อมที่ไม่มี IndexedDB (เช่น Node.js Test)

  function openMediaDb() {
    return new Promise((resolve, reject) => {
      const idb = (typeof window !== 'undefined' && window.indexedDB) || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      if (!idb) {
        resolve(null);
        return;
      }
      try {
        const req = idb.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            store.createIndex('task_id', 'task_id', { unique: false });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function saveTaskMedia(taskId, fileOrData, meta = {}) {
    let size = Number(meta.size) || 0;
    let name = meta.name || 'ไฟล์แนบ';
    let type = meta.type || 'application/octet-stream';
    let dataPayload = fileOrData;

    if (fileOrData && typeof fileOrData === 'object') {
      if (typeof fileOrData.size === 'number') size = fileOrData.size;
      if (fileOrData.name) name = fileOrData.name;
      if (fileOrData.type) type = fileOrData.type;
    } else if (typeof fileOrData === 'string') {
      size = size || Math.round((fileOrData.length * 3) / 4);
      const m = fileOrData.match(/^data:([^;]+);/);
      if (m) type = m[1];
    }

    if (size > MAX_MEDIA_SIZE_BYTES) {
      throw new Error('ขนาดไฟล์เกินกำหนด (สูงสุดไม่เกิน 50 MB ต่อไฟล์)');
    }

    const isPdf = type === 'application/pdf' || type.includes('pdf') || String(name).toLowerCase().endsWith('.pdf');
    const isVideo = type.startsWith('video/') || String(name).toLowerCase().match(/\.(mp4|mov|webm|avi|m4v)$/);
    const mediaKind = isVideo ? 'video' : (isPdf ? 'pdf' : 'image');
    const mediaId = meta.id || ('med_' + generateUuid());
    const now = new Date().toISOString();

    const record = {
      id: mediaId,
      task_id: taskId != null ? Number(taskId) : null,
      name,
      type,
      media_kind: mediaKind,
      size,
      data: dataPayload,
      created_at: now
    };

    const db = await openMediaDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('ไม่สามารถบันทึกไฟล์ลง IndexedDB ได้'));
      });
    } else {
      memoryMediaStore[mediaId] = record;
    }

    // ซิงค์ไฟล์แนบลงโฟลเดอร์เครื่อง E:\#SRRC\Web-Work-v3\_local_data\images\ แบบอัตโนมัติ (ไม่ส่งขึ้น GitHub)
    try {
      if (typeof fetch !== 'undefined') {
        fetch('/api/local-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        }).catch(() => {});
      }
    } catch (_) {}

    // หากอยู่ในโหมด Cloud ให้อัปโหลดไฟล์แนบขึ้น Supabase Storage (task_media)
    if (isCloudConfigured() && typeof dataPayload === 'string') {
      try {
        const cfg = getConfig();
        if (cfg.url && dataPayload.startsWith('data:')) {
          const ext = isPdf ? 'pdf' : (isVideo ? 'mp4' : (type.includes('png') ? 'png' : 'jpg'));
          const storageFilename = `task_media/${mediaId}.${ext}`;
          const cleanB64 = dataPayload.split(',')[1];
          const byteChars = atob(cleanB64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type });

          await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${storageFilename}`, {
            method: 'POST',
            headers: {
              'apikey': cfg.key,
              'Authorization': `Bearer ${cfg.key}`,
              'Content-Type': type,
              'x-upsert': 'true'
            },
            body: blob
          });
          const publicUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${storageFilename}`;
          record.data = publicUrl;
          record.url = publicUrl;
        }
      } catch (err) {
        console.warn('Upload task media to Supabase failed, fallback to local', err);
      }
    }

    return {
      id: record.id,
      task_id: record.task_id,
      name: record.name,
      type: record.type,
      media_kind: record.media_kind,
      size: record.size,
      created_at: record.created_at
    };
  }

  async function getTaskMedia(mediaId) {
    if (!mediaId) return null;
    let localRecord = null;
    const db = await openMediaDb();
    if (db) {
      localRecord = await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(mediaId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } else {
      localRecord = memoryMediaStore[mediaId] || null;
    }

    if (localRecord && localRecord.data) {
      return localRecord;
    }

    // หากอยู่ในโหมด Cloud หรือ localRecord ไม่มีข้อมูล: ค้นหาจาก Supabase Storage
    if (isCloudConfigured()) {
      try {
        const cfg = getConfig();
        const tasks = await getTasks();
        for (const t of tasks) {
          const match = (t.attachments || []).find(a => a && a.id === mediaId);
          if (match) {
            const dataUrl = match.data || match.url || (cfg.url ? `${cfg.url}/storage/v1/object/public/${cfg.bucket}/task_media/${mediaId}.jpg` : '');
            if (dataUrl) {
              return {
                id: mediaId,
                task_id: t.id,
                name: match.name,
                type: match.type || 'image/jpeg',
                media_kind: match.media_kind || 'image',
                size: match.size || 0,
                data: dataUrl
              };
            }
          }
        }
        if (cfg.url) {
          const publicUrl = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/task_media/${mediaId}.jpg`;
          return {
            id: mediaId,
            data: publicUrl,
            name: 'เอกสารแนบ',
            type: 'image/jpeg',
            media_kind: 'image'
          };
        }
      } catch (_) {}
    }

    // หากในเบราว์เซอร์ไม่มีข้อมูล ให้ลองดึงจากโฟลเดอร์ในเครื่อง E:\#SRRC\Web-Work-v3\_local_data\images\
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch(`/api/local-media/${encodeURIComponent(mediaId)}`);
        if (res.ok) {
          const diskRecord = await res.json();
          if (diskRecord && diskRecord.data) {
            // บันทึกกลับลง IndexedDB ในเครื่องเพื่อความรวดเร็วในครั้งถัดไป
            if (db) {
              try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(diskRecord);
              } catch (_) {}
            } else {
              memoryMediaStore[mediaId] = diskRecord;
            }
            return diskRecord;
          }
        }
      }
    } catch (_) {}

    return localRecord;
  }

  async function listTaskMedia(taskId) {
    if (taskId == null) return [];
    const numId = Number(taskId);
    const db = await openMediaDb();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          resolve(all.filter(r => Number(r.task_id) === numId).map(r => ({
            id: r.id,
            task_id: r.task_id,
            name: r.name,
            type: r.type,
            media_kind: r.media_kind,
            size: r.size,
            created_at: r.created_at
          })));
        };
        req.onerror = () => resolve([]);
      });
    }
    return Object.values(memoryMediaStore)
      .filter(r => Number(r.task_id) === numId)
      .map(r => ({
        id: r.id,
        task_id: r.task_id,
        name: r.name,
        type: r.type,
        media_kind: r.media_kind,
        size: r.size,
        created_at: r.created_at
      }));
  }

  async function deleteTaskMedia(mediaId) {
    if (!mediaId) return { deleted: false };
    const db = await openMediaDb();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.delete(mediaId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } else {
      delete memoryMediaStore[mediaId];
    }
    return { deleted: true };
  }

  // ============================================================
  // ใบสั่งงาน / งานโครงการ (TASKS / JOB ORDERS & TASK COSTING)
  // ============================================================
  function normalizeSubItems(rawItems) {
    let items = rawItems;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (_) { items = []; }
    }
    if (!Array.isArray(items)) return [];

    return items
      .filter(it => it && typeof it === 'object' && String(it.name || '').trim() !== '')
      .map((it, idx) => {
        const hasTarget = it.target_qty !== null && it.target_qty !== '' && it.target_qty !== undefined && Number(it.target_qty) > 0;
        const targetQty = hasTarget ? Math.round(Number(it.target_qty) * 100) / 100 : null;
        const actualQty = Math.max(0, Math.round((Number(it.actual_qty) || 0) * 100) / 100);
        let status = it.status || 'Pending';
        const validStatuses = ['Pending', 'In Progress', 'Completed', 'Blocked', 'Cancelled'];
        if (!validStatuses.includes(status)) status = 'Pending';

        let pct = Math.max(0, Math.min(100, Math.round(Number(it.progress_percent) || 0)));
        if (status === 'Completed') {
          pct = 100;
        } else if (status === 'Cancelled') {
          pct = 0;
        } else if (targetQty && targetQty > 0) {
          pct = Math.min(100, Math.round((actualQty / targetQty) * 100));
          if (pct >= 100 && status !== 'Blocked') {
            status = 'Completed';
          } else if (actualQty > 0 && status === 'Pending') {
            status = 'In Progress';
          }
        } else {
          // งานที่ไม่ได้กำหนดปริมาณเป้าหมายตั้งแต่ต้น (เก็บยอดทำจริงสะสมหน้างาน)
          if (actualQty > 0 && status === 'Pending') {
            status = 'In Progress';
          }
        }

        return {
          id: it.id ? String(it.id) : `sub_${idx + 1}`,
          name: String(it.name || '').trim(),
          target_qty: targetQty,
          unit: String(it.unit || '').trim(),
          actual_qty: actualQty,
          done_qty: actualQty,
          progress_percent: pct,
          percent: pct,
          status,
          issue_note: String(it.issue_note || '').trim(),
          added_from_log: Boolean(it.added_from_log)
        };
      });
  }

  function calculateTaskSummaryFromSubItems(subItems, fallbackStatus = 'Pending', fallbackPercent = 0, fallbackIssues = '') {
    const normalized = normalizeSubItems(subItems);
    if (!normalized.length) {
      return {
        sub_items: [],
        status: fallbackStatus || 'Pending',
        progress_percent: Number(fallbackPercent) || 0,
        issues: fallbackIssues || ''
      };
    }

    const activeItems = normalized.filter(it => it.status !== 'Cancelled');
    if (!activeItems.length) {
      return {
        sub_items: normalized,
        status: 'Pending',
        progress_percent: 0,
        issues: fallbackIssues || ''
      };
    }

    const sumPct = activeItems.reduce((acc, it) => acc + (Number(it.progress_percent) || 0), 0);
    let overallPct = Math.max(0, Math.min(100, Math.round(sumPct / activeItems.length)));

    const blockedItems = activeItems.filter(it => it.status === 'Blocked' || (it.issue_note && it.issue_note.trim() !== ''));
    const allCompleted = activeItems.every(it => it.status === 'Completed');
    const anyStarted = activeItems.some(it => it.status === 'In Progress' || it.status === 'Completed' || it.actual_qty > 0 || it.progress_percent > 0);

    let overallStatus = 'Pending';
    if (blockedItems.length > 0) {
      overallStatus = 'Blocked';
    } else if (allCompleted) {
      overallStatus = 'Completed';
      overallPct = 100;
    } else if (anyStarted || overallPct > 0) {
      overallStatus = 'In Progress';
    }

    const itemIssues = blockedItems
      .map(it => it.issue_note ? `${it.name}: ${it.issue_note}` : `${it.name}: ติดปัญหา`)
      .join(' | ');

    return {
      sub_items: normalized,
      status: overallStatus,
      progress_percent: overallPct,
      issues: itemIssues || fallbackIssues || ''
    };
  }

  function mapTaskRowFromDb(r, allLogsCache = null) {
    if (!r) return null;
    let history = r.progress_history;
    if (typeof history === 'string') {
      try {
        history = JSON.parse(history);
      } catch (_) {
        history = [];
      }
    }
    if (!Array.isArray(history)) history = [];

    let attachments = r.attachments;
    if (typeof attachments === 'string') {
      try { attachments = JSON.parse(attachments); } catch (_) { attachments = []; }
    }
    if (!Array.isArray(attachments)) attachments = [];

    const subItems = normalizeSubItems(r.sub_items);
    const accumDays = Number(r.accumulated_days) || 0;

    let currentDaysWorked = Number(r.current_days_worked) || 0;
    let workedDates = Array.isArray(r.worked_dates) ? r.worked_dates : [];

    if (Array.isArray(allLogsCache)) {
      const taskLogs = allLogsCache.filter(l => String(l.task_id ?? l.TaskId) === String(r.id));
      const uniqueDates = Array.from(new Set(taskLogs.map(l => l.work_date || l.Date).filter(Boolean))).sort();
      currentDaysWorked = uniqueDates.length;
      workedDates = uniqueDates;
    }

    return {
      id: Number(r.id),
      task_code: r.task_code || '',
      title: r.title || '',
      site: r.site || '',
      location_detail: r.location_detail || '',
      assigned_to: r.assigned_to || '',
      ordered_by: r.ordered_by || '',
      order_date: r.order_date || '',
      due_date: r.due_date || null,
      status: r.status || 'Pending',
      progress_percent: Number(r.progress_percent) || 0,
      description: r.description || '',
      issues: r.issues || '',
      resolution: r.resolution || '',
      completion_summary: r.completion_summary || '',
      sub_items: subItems,
      attachments,
      progress_history: history,
      accumulated_cost: Number(r.accumulated_cost) || 0,
      accumulated_markup_cost: Number(r.accumulated_markup_cost) || 0,
      accumulated_hours: Number(r.accumulated_hours) || 0,
      accumulated_man_days: Number(r.accumulated_man_days) || 0,
      accumulated_days: accumDays,
      current_days_worked: currentDaysWorked,
      total_days_worked: accumDays + currentDaysWorked,
      worked_dates: workedDates,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }

  async function generateNextTaskCode(orderDate) {
    const dateStr = (orderDate || new Date().toISOString().slice(0, 10)).trim();
    const yyyymm = dateStr.replace(/[^0-9]/g, '').slice(0, 6) || new Date().toISOString().slice(0, 7).replace('-', '');
    const prefix = `TSK-${yyyymm}-`;

    let maxNum = 0;
    if (isCloudConfigured()) {
      try {
        const rows = await sbFetch(`/rest/v1/tasks?select=task_code&task_code=like.${encodeURIComponent(prefix)}*`);
        (rows || []).forEach(r => {
          if (r.task_code && r.task_code.startsWith(prefix)) {
            const numPart = parseInt(r.task_code.slice(prefix.length), 10);
            if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
          }
        });
      } catch (_) {}
    } else {
      const tasks = readLocal(LOCAL_KEYS.TASKS, []);
      tasks.forEach(t => {
        if (t.task_code && t.task_code.startsWith(prefix)) {
          const numPart = parseInt(t.task_code.slice(prefix.length), 10);
          if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
        }
      });
    }

    const nextNum = maxNum + 1;
    return `${prefix}${String(nextNum).padStart(3, '0')}`;
  }

  async function createTask(taskData = {}) {
    const now = new Date().toISOString();
    const orderDate = taskData.order_date || now.slice(0, 10);
    const taskCode = taskData.task_code || (await generateNextTaskCode(orderDate));

    const hasSubItems = Array.isArray(taskData.sub_items) && taskData.sub_items.length > 0;
    const calc = hasSubItems
      ? calculateTaskSummaryFromSubItems(taskData.sub_items, taskData.status || 'Pending', taskData.progress_percent || 0, taskData.issues || '')
      : {
          sub_items: [],
          status: taskData.status || 'Pending',
          progress_percent: Number(taskData.progress_percent) || 0,
          issues: taskData.issues || ''
        };

    const taskPayload = {
      task_code: taskCode,
      title: taskData.title || '',
      site: taskData.site || '',
      location_detail: taskData.location_detail || '',
      assigned_to: taskData.assigned_to || '',
      ordered_by: taskData.ordered_by || '',
      order_date: orderDate,
      due_date: taskData.due_date || null,
      status: calc.status,
      progress_percent: calc.progress_percent,
      description: taskData.description || '',
      issues: calc.issues,
      resolution: taskData.resolution || '',
      completion_summary: taskData.completion_summary || '',
      sub_items: calc.sub_items,
      attachments: Array.isArray(taskData.attachments) ? taskData.attachments : [],
      progress_history: Array.isArray(taskData.progress_history) ? taskData.progress_history : [],
      accumulated_cost: Number(taskData.accumulated_cost) || 0,
      accumulated_markup_cost: Number(taskData.accumulated_markup_cost) || 0,
      accumulated_hours: Number(taskData.accumulated_hours) || 0,
      accumulated_man_days: Number(taskData.accumulated_man_days) || 0,
      accumulated_days: Number(taskData.accumulated_days) || 0,
      created_at: now,
      updated_at: now
    };

    if (isCloudConfigured()) {
      const cloudPayload = { ...taskPayload };
      delete cloudPayload.sub_items;
      delete cloudPayload.attachments;
      const rows = await sbFetch('/rest/v1/tasks', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(cloudPayload)
      });
      return mapTaskRowFromDb({ ...(rows?.[0] || {}), sub_items: taskPayload.sub_items, attachments: taskPayload.attachments });
    }

    const tasks = readLocal(LOCAL_KEYS.TASKS, []);
    const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
    const newTask = {
      ...taskPayload,
      id: maxId + 1
    };
    tasks.push(newTask);
    writeLocal(LOCAL_KEYS.TASKS, tasks);
    return mapTaskRowFromDb(newTask, readLocal(LOCAL_KEYS.LOGS, []));
  }

  async function getTasks(filter = {}) {
    await loadLocalDiskDbIfAvailable().catch(() => {});
    let taskList = [];
    const allLogs = await fetchAllLogRows().catch(() => []);

    if (isCloudConfigured()) {
      let query = '/rest/v1/tasks?select=*&order=created_at.desc,order_date.desc';
      if (filter.site) query += `&site=eq.${encodeURIComponent(filter.site)}`;
      if (filter.status) {
        if (filter.status === '!Completed' || filter.status === 'Active' || filter.status === 'ExcludeCompleted') {
          query += '&status=neq.Completed';
        } else {
          query += `&status=eq.${encodeURIComponent(filter.status)}`;
        }
      } else if (filter.excludeCompleted) {
        query += '&status=neq.Completed';
      }
      const rows = await sbFetch(query);
      taskList = (rows || []).map(r => mapTaskRowFromDb(r, allLogs));
    } else {
      taskList = readLocal(LOCAL_KEYS.TASKS, []).map(r => mapTaskRowFromDb(r, allLogs));
      if (filter.site) {
        taskList = taskList.filter(t => t.site === filter.site);
      }
      if (filter.status) {
        if (filter.status === '!Completed' || filter.status === 'Active' || filter.status === 'ExcludeCompleted') {
          taskList = taskList.filter(t => t.status !== 'Completed');
        } else {
          taskList = taskList.filter(t => t.status === filter.status);
        }
      } else if (filter.excludeCompleted) {
        taskList = taskList.filter(t => t.status !== 'Completed');
      }
      taskList.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || (b.order_date || '').localeCompare(a.order_date || ''));
    }

    if (filter.search && typeof filter.search === 'string') {
      const q = filter.search.toLowerCase().trim();
      if (q) {
        taskList = taskList.filter(t => {
          return (t.task_code && t.task_code.toLowerCase().includes(q)) ||
                 (t.title && t.title.toLowerCase().includes(q)) ||
                 (t.site && t.site.toLowerCase().includes(q)) ||
                 (t.assigned_to && t.assigned_to.toLowerCase().includes(q));
        });
      }
    }

    return taskList;
  }

  async function getTaskById(id) {
    if (id == null) return null;
    const allLogs = await fetchAllLogRows().catch(() => []);
    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/tasks?select=*&id=eq.${encodeURIComponent(id)}`);
      if (!rows || !rows.length) return null;
      return mapTaskRowFromDb(rows[0], allLogs);
    }
    const tasks = readLocal(LOCAL_KEYS.TASKS, []);
    const found = tasks.find(t => String(t.id) === String(id));
    return found ? mapTaskRowFromDb(found, allLogs) : null;
  }

  async function updateTask(id, taskData = {}) {
    if (id == null) throw new Error('ต้องระบุ id ของใบสั่งงาน');
    const now = new Date().toISOString();
    const updatePayload = {
      ...taskData,
      updated_at: now
    };
    delete updatePayload.id;

    // หากมีการส่ง sub_items มาอัปเดต และไม่ได้บังคับปิดงาน (Completed) ให้คำนวณสรุปจากรายการย่อยอัตโนมัติ
    if (Array.isArray(updatePayload.sub_items)) {
      if (updatePayload.status === 'Completed') {
        updatePayload.sub_items = normalizeSubItems(updatePayload.sub_items).map(it =>
          it.status === 'Cancelled' ? it : { ...it, status: 'Completed', progress_percent: 100 }
        );
        updatePayload.progress_percent = 100;
      } else {
        const calc = calculateTaskSummaryFromSubItems(
          updatePayload.sub_items,
          updatePayload.status,
          updatePayload.progress_percent,
          updatePayload.issues
        );
        updatePayload.sub_items = calc.sub_items;
        if (taskData.status === undefined) updatePayload.status = calc.status;
        if (taskData.progress_percent === undefined) updatePayload.progress_percent = calc.progress_percent;
        if (taskData.issues === undefined) updatePayload.issues = calc.issues;
      }
    }

    const allLogs = await fetchAllLogRows().catch(() => []);

    if (isCloudConfigured()) {
      const cloudPayload = { ...updatePayload };
      delete cloudPayload.sub_items;
      delete cloudPayload.attachments;
      const rows = await sbFetch(`/rest/v1/tasks?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(cloudPayload)
      });
      if (!rows || !rows.length) throw new Error('ไม่พบใบสั่งงาน ID: ' + id);
      return mapTaskRowFromDb({ ...rows[0], sub_items: updatePayload.sub_items, attachments: updatePayload.attachments }, allLogs);
    }

    const tasks = readLocal(LOCAL_KEYS.TASKS, []);
    const idx = tasks.findIndex(t => String(t.id) === String(id));
    if (idx === -1) throw new Error('ไม่พบใบสั่งงาน ID: ' + id);
    const updated = {
      ...tasks[idx],
      ...updatePayload,
      id: tasks[idx].id
    };
    tasks[idx] = updated;
    writeLocal(LOCAL_KEYS.TASKS, tasks);
    return mapTaskRowFromDb(updated, allLogs);
  }

  async function deleteTask(id) {
    if (id == null) throw new Error('ต้องระบุ id ของใบสั่งงาน');

    // ลบไฟล์สื่อใน IndexedDB ที่ผูกกับใบสั่งงานนี้
    try {
      const mediaList = await listTaskMedia(id);
      for (const m of mediaList) {
        await deleteTaskMedia(m.id);
      }
    } catch (_) {}

    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/daily_logs?task_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ task_id: null })
      }).catch(() => {});

      await sbFetch(`/rest/v1/tasks?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      return { deleted: true };
    }

    const tasks = readLocal(LOCAL_KEYS.TASKS, []).filter(t => String(t.id) !== String(id));
    writeLocal(LOCAL_KEYS.TASKS, tasks);

    const logs = readLocal(LOCAL_KEYS.LOGS, []);
    let modified = false;
    logs.forEach(l => {
      if (String(l.TaskId ?? l.task_id) === String(id)) {
        l.TaskId = null;
        l.task_id = null;
        modified = true;
      }
    });
    if (modified) writeLocal(LOCAL_KEYS.LOGS, logs);
    return { deleted: true };
  }

  async function addTaskProgress(id, progressInfo = {}) {
    const task = await getTaskById(id);
    if (!task) throw new Error('ไม่พบใบสั่งงาน ID: ' + id);

    const now = new Date().toISOString();
    const dateStr = progressInfo.date || now.slice(0, 10);
    const resolution = progressInfo.resolution !== undefined ? String(progressInfo.resolution) : '';
    const by = progressInfo.by !== undefined ? String(progressInfo.by) : '';
    const groupId = progressInfo.groupId || progressInfo.group_id || null;

    // เก็บค่าก่อนอัปเดตไว้สำหรับกรณีลบใบรายงานประจำวันออกในภายหลัง
    const prevSubItems = Array.isArray(task.sub_items)
      ? task.sub_items.map(it => ({ ...it }))
      : [];
    const prevPercent = Number(task.progress_percent) || 0;
    const prevStatus = task.status || 'Pending';
    const prevIssues = task.issues || '';
    const prevResolution = task.resolution || '';

    let currentSubItems = prevSubItems.map(it => ({ ...it }));
    const subItemChangesSummary = [];

    // 1. อัปเดตยอดทำจริง/สถานะ/เป้าหมาย ของรายการงานย่อยเดิม (จากหน้าบันทึกรายวัน)
    if (Array.isArray(progressInfo.sub_items_updates) && progressInfo.sub_items_updates.length > 0) {
      currentSubItems = currentSubItems.map(item => {
        const upd = progressInfo.sub_items_updates.find(u => String(u.id) === String(item.id) || (u.name && u.name === item.name));
        if (!upd) return item;

        const prevItemState = {
          actual_qty: Number(item.actual_qty) || 0,
          progress_percent: Number(item.progress_percent) || 0,
          status: item.status || 'Pending',
          issue_note: item.issue_note || ''
        };

        const nextItem = { ...item };
        if (upd.target_qty !== undefined) {
          nextItem.target_qty = (upd.target_qty !== null && upd.target_qty !== '' && Number(upd.target_qty) > 0)
            ? Number(upd.target_qty)
            : null;
        }
        if (upd.added_qty !== undefined && Number(upd.added_qty) > 0) {
          nextItem.actual_qty = Math.round(((Number(nextItem.actual_qty) || 0) + Number(upd.added_qty)) * 100) / 100;
        } else if (upd.actual_qty !== undefined) {
          nextItem.actual_qty = Math.max(0, Math.round(Number(upd.actual_qty) * 100) / 100);
        }
        if (upd.status) {
          nextItem.status = upd.status;
        }
        if (upd.progress_percent !== undefined) {
          nextItem.progress_percent = Number(upd.progress_percent) || 0;
        }
        if (upd.issue_note !== undefined) {
          nextItem.issue_note = String(upd.issue_note || '').trim();
        }

        subItemChangesSummary.push({
          id: nextItem.id,
          name: nextItem.name,
          added_qty: Number(upd.added_qty) || 0,
          actual_qty: nextItem.actual_qty,
          target_qty: nextItem.target_qty,
          unit: nextItem.unit,
          status: nextItem.status,
          progress_percent: nextItem.progress_percent,
          issue_note: nextItem.issue_note,
          prev_actual_qty: prevItemState.actual_qty,
          prev_progress_percent: prevItemState.progress_percent,
          prev_status: prevItemState.status,
          prev_issue_note: prevItemState.issue_note
        });

        return nextItem;
      });
    }

    // 2. เพิ่มรายการงานย่อยใหม่ที่งอกหน้างาน (จากหน้าบันทึกรายวัน)
    if (Array.isArray(progressInfo.new_sub_items) && progressInfo.new_sub_items.length > 0) {
      progressInfo.new_sub_items.forEach((newIt, idx) => {
        if (!newIt || !String(newIt.name || '').trim()) return;
        const addedItem = {
          id: newIt.id || `sub_${Date.now()}_${idx + 1}`,
          name: String(newIt.name).trim(),
          target_qty: (newIt.target_qty !== null && newIt.target_qty !== '' && Number(newIt.target_qty) > 0) ? Number(newIt.target_qty) : null,
          unit: String(newIt.unit || '').trim(),
          actual_qty: Math.max(0, Number(newIt.actual_qty ?? newIt.added_qty) || 0),
          progress_percent: Number(newIt.progress_percent) || 0,
          status: newIt.status || 'In Progress',
          issue_note: String(newIt.issue_note || '').trim(),
          added_from_log: true
        };
        currentSubItems.push(addedItem);
        subItemChangesSummary.push({
          id: addedItem.id,
          name: addedItem.name,
          added_qty: addedItem.actual_qty,
          actual_qty: addedItem.actual_qty,
          target_qty: addedItem.target_qty,
          unit: addedItem.unit,
          status: addedItem.status,
          progress_percent: addedItem.progress_percent,
          issue_note: addedItem.issue_note,
          added_from_log: true
        });
      });
    }

    let percentNum = progressInfo.percent !== undefined ? Number(progressInfo.percent) : Number(task.progress_percent) || 0;
    let status = task.status;
    let issues = progressInfo.issues !== undefined ? String(progressInfo.issues) : task.issues;

    if (currentSubItems.length > 0 && (Array.isArray(progressInfo.sub_items_updates) || Array.isArray(progressInfo.new_sub_items))) {
      const calc = calculateTaskSummaryFromSubItems(currentSubItems, status, percentNum, progressInfo.issues !== undefined ? String(progressInfo.issues) : '');
      currentSubItems = calc.sub_items;
      status = calc.status;
      percentNum = progressInfo.percent !== undefined ? Number(progressInfo.percent) : calc.progress_percent;
      issues = calc.issues;
    } else {
      if (status === 'Pending' && percentNum > 0) {
        status = 'In Progress';
      }
    }

    const newHistoryEntry = {
      group_id: groupId || undefined,
      date: dateStr,
      percent: percentNum,
      status,
      issues: progressInfo.issues !== undefined ? String(progressInfo.issues) : issues,
      resolution,
      by,
      sub_items_snapshot: subItemChangesSummary.length > 0 ? subItemChangesSummary : undefined,
      prev_percent: prevPercent,
      prev_status: prevStatus,
      prev_issues: prevIssues,
      prev_resolution: prevResolution,
      prev_sub_items: prevSubItems,
      created_at: now
    };

    const history = Array.isArray(task.progress_history) ? [...task.progress_history] : [];
    history.push(newHistoryEntry);

    const updates = {
      sub_items: currentSubItems,
      progress_history: history,
      progress_percent: percentNum,
      issues,
      resolution: progressInfo.resolution !== undefined ? resolution : task.resolution,
      status
    };

    return updateTask(id, updates);
  }

  /**
   * คืนค่าความคืบหน้า (%) ปริมาณงาน และสถานะงานของรายการย่อยและใบสั่งงาน
   * เมื่อมีการลบใบรายงานประจำวันที่เคยผูกกับใบสั่งงานนี้ออก
   */
  async function revertTaskProgressOnLogDelete(taskId, groupId, workDate) {
    const task = await getTaskById(taskId);
    if (!task) return null;

    const remainingTaskLogs = await fetchAllLogRows({ taskId }).catch(() => []);
    const history = Array.isArray(task.progress_history) ? [...task.progress_history] : [];

    // 1. ค้นหาประวัติการอัปเดตที่เกิดจากใบรายงานประจำวันใบที่ถูกลบ
    let matchedIndices = [];
    if (groupId) {
      history.forEach((h, idx) => {
        if (h && h.group_id && String(h.group_id) === String(groupId)) {
          matchedIndices.push(idx);
        }
      });
    }

    // กรณีเป็นข้อมูลเก่าที่ยังไม่มี group_id ใน progress_history ให้จับคู่ตามวันที่ของใบงาน
    if (matchedIndices.length === 0 && workDate) {
      const hasOtherLogsOnSameDate = remainingTaskLogs.some(
        l => String(l.Date || l.work_date || '').slice(0, 10) === workDate
      );
      const sameDateIndices = [];
      history.forEach((h, idx) => {
        if (h && String(h.date || '').slice(0, 10) === workDate) {
          sameDateIndices.push(idx);
        }
      });
      if (sameDateIndices.length > 0) {
        if (!hasOtherLogsOnSameDate) {
          // ไม่มีใบงานอื่นของวันที่นี้เหลืออยู่แล้ว -> ลบประวัติของวันนั้นออกทั้งหมด
          matchedIndices = sameDateIndices;
        } else {
          // ยังมีใบงานอื่นในวันเดียวกัน -> ถอดเฉพาะรายการล่าสุดของวันนั้น
          matchedIndices = [sameDateIndices[sameDateIndices.length - 1]];
        }
      }
    }

    const removedSet = new Set(matchedIndices);
    const removedEntries = history.filter((_, idx) => removedSet.has(idx));
    const keptHistory = history.filter((_, idx) => !removedSet.has(idx));

    // กรณีลบใบงานล่าสุด และมี prev_sub_items บันทึกไว้ครบถ้วน
    const isRemovingTailOnly = matchedIndices.length > 0 &&
      matchedIndices[matchedIndices.length - 1] === history.length - 1 &&
      matchedIndices.every((val, i) => i === 0 || val === matchedIndices[i - 1] + 1);

    if (isRemovingTailOnly && Array.isArray(removedEntries[0]?.prev_sub_items)) {
      const firstRemoved = removedEntries[0];
      const restoredSubItems = normalizeSubItems(firstRemoved.prev_sub_items);
      return updateTask(taskId, {
        sub_items: restoredSubItems,
        progress_history: keptHistory,
        progress_percent: firstRemoved.prev_percent !== undefined ? Number(firstRemoved.prev_percent) : 0,
        status: firstRemoved.prev_status || 'Pending',
        issues: firstRemoved.prev_issues !== undefined ? firstRemoved.prev_issues : '',
        resolution: firstRemoved.prev_resolution !== undefined ? firstRemoved.prev_resolution : ''
      });
    }

    // กรณีลบใบงานจนไม่เหลือทั้งใบงานรายวันและไม่เหลือประวัติความคืบหน้าเลย (และไม่มีวันสะสมจากงวดก่อน)
    let currentSubItems = Array.isArray(task.sub_items) ? task.sub_items.map(it => ({ ...it })) : [];

    // ถอดรายการย่อยที่เคยเพิ่มหน้างาน (added_from_log) จากใบงานที่ถูกลบออก
    const addedFromLogIdsToRemove = new Set();
    removedEntries.forEach(entry => {
      (entry.sub_items_snapshot || []).forEach(snap => {
        if (snap && snap.added_from_log) {
          addedFromLogIdsToRemove.add(String(snap.id));
        }
      });
    });
    if (addedFromLogIdsToRemove.size > 0) {
      currentSubItems = currentSubItems.filter(it => !addedFromLogIdsToRemove.has(String(it.id)));
    }

    if (keptHistory.length === 0 && remainingTaskLogs.length === 0 && !(Number(task.accumulated_days) > 0)) {
      const resetItems = currentSubItems
        .filter(it => !it.added_from_log)
        .map(it => ({
          ...it,
          actual_qty: 0,
          done_qty: 0,
          progress_percent: 0,
          percent: 0,
          status: 'Pending',
          issue_note: ''
        }));
      return updateTask(taskId, {
        sub_items: resetItems,
        progress_history: [],
        progress_percent: 0,
        status: 'Pending',
        issues: '',
        resolution: ''
      });
    }

    // กรณีลบใบงานบางใบ แต่ยังมีประวัติหรือใบงานวันอื่นเหลืออยู่
    currentSubItems = currentSubItems.map(item => {
      const nextItem = { ...item };

      // 1) หักลบปริมาณที่เคยบวกเพิ่มในใบงานที่ถูกลบ
      let removedAddedQty = 0;
      let wasTouchedInRemoved = false;
      let earliestPrevState = null;

      removedEntries.forEach(entry => {
        const snap = (entry.sub_items_snapshot || []).find(
          s => String(s.id) === String(item.id) || (s.name && s.name === item.name)
        );
        if (snap) {
          wasTouchedInRemoved = true;
          removedAddedQty += Number(snap.added_qty) || 0;
          if (!earliestPrevState && snap.prev_status !== undefined) {
            earliestPrevState = {
              actual_qty: snap.prev_actual_qty,
              progress_percent: snap.prev_progress_percent,
              status: snap.prev_status,
              issue_note: snap.prev_issue_note
            };
          }
        }
      });

      if (removedAddedQty > 0) {
        nextItem.actual_qty = Math.max(0, Math.round(((Number(nextItem.actual_qty) || 0) - removedAddedQty) * 100) / 100);
      }

      // 2) ค้นหาสถานะและ % ความคืบหน้าล่าสุดจากประวัติที่ยังเหลืออยู่ (keptHistory)
      let latestKeptSnap = null;
      for (let i = keptHistory.length - 1; i >= 0; i--) {
        const snap = (keptHistory[i].sub_items_snapshot || []).find(
          s => String(s.id) === String(item.id) || (s.name && s.name === item.name)
        );
        if (snap) {
          latestKeptSnap = snap;
          break;
        }
      }

      if (latestKeptSnap) {
        nextItem.status = latestKeptSnap.status || 'Pending';
        if (latestKeptSnap.progress_percent !== undefined) {
          nextItem.progress_percent = Number(latestKeptSnap.progress_percent) || 0;
        } else if (nextItem.status === 'Completed') {
          nextItem.progress_percent = 100;
        } else if (nextItem.target_qty && nextItem.target_qty > 0) {
          nextItem.progress_percent = Math.min(100, Math.round((nextItem.actual_qty / nextItem.target_qty) * 100));
        } else {
          nextItem.progress_percent = 0;
        }
        nextItem.issue_note = latestKeptSnap.issue_note || '';
      } else if (wasTouchedInRemoved) {
        if (earliestPrevState) {
          nextItem.actual_qty = Number(earliestPrevState.actual_qty) || 0;
          nextItem.progress_percent = Number(earliestPrevState.progress_percent) || 0;
          nextItem.status = earliestPrevState.status || 'Pending';
          nextItem.issue_note = earliestPrevState.issue_note || '';
        } else {
          nextItem.actual_qty = 0;
          nextItem.progress_percent = 0;
          nextItem.status = 'Pending';
          nextItem.issue_note = '';
        }
      }

      return nextItem;
    });

    const lastKept = keptHistory.length > 0 ? keptHistory[keptHistory.length - 1] : null;
    const fallbackPct = lastKept ? (Number(lastKept.percent) || 0) : 0;
    const fallbackStatus = lastKept
      ? (lastKept.status || (fallbackPct >= 100 ? 'Completed' : (fallbackPct > 0 ? 'In Progress' : 'Pending')))
      : (remainingTaskLogs.length > 0 ? 'In Progress' : 'Pending');
    const fallbackIssues = lastKept ? (lastKept.issues || '') : '';
    const fallbackRes = lastKept ? (lastKept.resolution || '') : '';

    const calc = calculateTaskSummaryFromSubItems(currentSubItems, fallbackStatus, fallbackPct, fallbackIssues);
    return updateTask(taskId, {
      sub_items: calc.sub_items,
      progress_history: keptHistory,
      progress_percent: currentSubItems.length > 0 ? calc.progress_percent : fallbackPct,
      status: currentSubItems.length > 0 ? calc.status : fallbackStatus,
      issues: calc.issues,
      resolution: fallbackRes
    });
  }

  async function getTaskCostSummary(taskId) {
    const task = await getTaskById(taskId);
    if (!task) return null;

    const logs = await fetchAllLogRows({ taskId });
    const cfg = getConfig();

    const uniqueDates = new Set(logs.map(l => l.work_date || l.Date).filter(Boolean));
    const currentDaysWorked = uniqueDates.size;

    let currentHours = 0;
    let currentManDays = 0;
    let currentRawWage = 0;
    let currentMarkupWage = 0;

    const workerMap = {};

    logs.forEach(l => {
      const h = Number(l.hours ?? l.Hours) || 0;
      const ot = Number(l.ot_hours ?? l.OTHours) || 0;
      const raw = Number(l.raw_wage ?? l.RawWage) || 0;
      const markup = Number(l.total_with_markup ?? l.TotalWithMarkup) || 0;
      const wageType = l.wage_type || l.WageType || 'hourly';
      const wName = l.worker_name || l.WorkerName || 'ไม่ระบุ';
      const wDate = l.work_date || l.Date || '';

      const totalH = h + ot;
      const md = wageType === 'fixed' ? 1.0 : (h / (cfg.hourlyDivisor || 8));

      currentHours += totalH;
      currentManDays += md;
      currentRawWage += raw;
      currentMarkupWage += markup;

      if (!workerMap[wName]) {
        workerMap[wName] = {
          worker_name: wName,
          workerName: wName,
          hours: 0,
          man_days: 0,
          manDays: 0,
          raw_wage: 0,
          rawWage: 0,
          markup_wage: 0,
          markupWage: 0,
          datesSet: new Set()
        };
      }
      const entry = workerMap[wName];
      entry.hours += totalH;
      entry.man_days += md;
      entry.raw_wage += raw;
      entry.markup_wage += markup;
      if (wDate) entry.datesSet.add(wDate);
    });

    const workerBreakdown = Object.values(workerMap).map(w => ({
      worker_name: w.worker_name,
      workerName: w.workerName,
      hours: Math.round(w.hours * 100) / 100,
      man_days: Math.round(w.man_days * 100) / 100,
      manDays: Math.round(w.man_days * 100) / 100,
      days: w.datesSet.size,
      raw_wage: Math.round(w.raw_wage * 100) / 100,
      rawWage: Math.round(w.raw_wage * 100) / 100,
      markup_wage: Math.round(w.markup_wage * 100) / 100,
      markupWage: Math.round(w.markup_wage * 100) / 100
    }));
    workerBreakdown.sort((a, b) => b.raw_wage - a.raw_wage);

    currentHours = Math.round(currentHours * 100) / 100;
    currentManDays = Math.round(currentManDays * 100) / 100;
    currentRawWage = Math.round(currentRawWage * 100) / 100;
    currentMarkupWage = Math.round(currentMarkupWage * 100) / 100;

    const accumDays = Number(task.accumulated_days) || 0;
    const accumHours = Number(task.accumulated_hours) || 0;
    const accumManDays = Number(task.accumulated_man_days) || 0;
    const accumCost = Number(task.accumulated_cost) || 0;
    const accumMarkupCost = Number(task.accumulated_markup_cost) || 0;

    const currentSummary = {
      daysWorked: currentDaysWorked,
      hours: currentHours,
      manDays: currentManDays,
      rawCost: currentRawWage,
      markupCost: currentMarkupWage,
      currentDaysWorked,
      currentHours,
      currentManDays,
      currentRawWage,
      currentMarkupWage
    };

    const accumulatedSummary = {
      daysWorked: accumDays,
      hours: accumHours,
      manDays: accumManDays,
      rawCost: accumCost,
      markupCost: accumMarkupCost,
      accumulated_days: accumDays,
      accumulated_hours: accumHours,
      accumulated_man_days: accumManDays,
      accumulated_cost: accumCost,
      accumulated_markup_cost: accumMarkupCost
    };

    const totalDaysWorked = currentDaysWorked + accumDays;
    const totalHours = Math.round((currentHours + accumHours) * 100) / 100;
    const totalManDays = Math.round((currentManDays + accumManDays) * 100) / 100;
    const totalCost = Math.round((currentRawWage + accumCost) * 100) / 100;
    const totalMarkupCost = Math.round((currentMarkupWage + accumMarkupCost) * 100) / 100;

    const totalSummary = {
      totalDaysWorked,
      totalHours,
      totalManDays,
      totalCost,
      totalMarkupCost,
      daysWorked: totalDaysWorked,
      hours: totalHours,
      manDays: totalManDays,
      rawCost: totalCost,
      markupCost: totalMarkupCost
    };

    return {
      task,
      logs,
      currentSummary,
      accumulatedSummary,
      totalSummary,
      workerBreakdown
    };
  }

  function isDateInRange(dateStr, startDate, endDate) {
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    if (startDate && d < String(startDate).slice(0, 10)) return false;
    if (endDate && d > String(endDate).slice(0, 10)) return false;
    return true;
  }

  async function snapshotActiveTasksBeforeClear(dateFilter = {}) {
    const activeTasks = await getTasks({ excludeCompleted: true });
    const allLogs = await fetchAllLogRows();
    const cfg = getConfig();
    const { startDate, endDate } = dateFilter || {};

    const filteredLogs = (startDate || endDate)
      ? allLogs.filter(l => isDateInRange(l.work_date || l.Date, startDate, endDate))
      : allLogs;

    let updatedCount = 0;
    for (const task of activeTasks) {
      const taskLogs = filteredLogs.filter(l => String(l.task_id ?? l.TaskId) === String(task.id));
      if (!taskLogs.length) continue;

      const uniqueDates = new Set(taskLogs.map(l => l.work_date || l.Date).filter(Boolean));
      const daysWorked = uniqueDates.size;

      let hours = 0;
      let manDays = 0;
      let rawCost = 0;
      let markupCost = 0;

      taskLogs.forEach(l => {
        const h = Number(l.hours ?? l.Hours) || 0;
        const ot = Number(l.ot_hours ?? l.OTHours) || 0;
        const raw = Number(l.raw_wage ?? l.RawWage) || 0;
        const markup = Number(l.total_with_markup ?? l.TotalWithMarkup) || 0;
        const wageType = l.wage_type || l.WageType || 'hourly';

        hours += (h + ot);
        manDays += (wageType === 'fixed' ? 1.0 : (h / (cfg.hourlyDivisor || 8)));
        rawCost += raw;
        markupCost += markup;
      });

      const newDays = (Number(task.accumulated_days) || 0) + daysWorked;
      const newHours = Math.round(((Number(task.accumulated_hours) || 0) + hours) * 100) / 100;
      const newManDays = Math.round(((Number(task.accumulated_man_days) || 0) + manDays) * 100) / 100;
      const newCost = Math.round(((Number(task.accumulated_cost) || 0) + rawCost) * 100) / 100;
      const newMarkupCost = Math.round(((Number(task.accumulated_markup_cost) || 0) + markupCost) * 100) / 100;

      await updateTask(task.id, {
        accumulated_days: newDays,
        accumulated_hours: newHours,
        accumulated_man_days: newManDays,
        accumulated_cost: newCost,
        accumulated_markup_cost: newMarkupCost
      });
      updatedCount++;
    }

    return { updatedCount };
  }

  // ============================================================
  // ระบบสำรองข้อมูล "เบิกงวด / ตัดงวดค่าแรง (~15 วัน)" และกู้คืนใบงาน (Backups)
  // ============================================================
  async function closePayrollPeriod(options = {}) {
    const { startDate = null, endDate = null, customName = '', archiveCompletedTasks = true } = options;
    const allLogs = await fetchAllLogRows();

    const targetLogs = (startDate || endDate)
      ? allLogs.filter(l => isDateInRange(l.work_date || l.Date, startDate, endDate))
      : allLogs;

    const remainingLogs = (startDate || endDate)
      ? allLogs.filter(l => !isDateInRange(l.work_date || l.Date, startDate, endDate))
      : [];

    // 1. บันทึกยอดสะสมของใบสั่งงานที่ยังไม่เสร็จในช่วงวันที่ตัดจ่าย
    const snapRes = await snapshotActiveTasksBeforeClear({ startDate, endDate });

    // 2. รวบรวมใบสั่งงานที่เสร็จสมบูรณ์แล้ว (Completed) เพื่อเก็บเข้าชุด Backup ของงวดนี้
    const allTasksNow = await getTasks();
    const completedTasks = archiveCompletedTasks
      ? allTasksNow.filter(t => t.status === 'Completed')
      : [];
    const activeTasksSnapshot = allTasksNow.filter(t => t.status !== 'Completed');

    // 3. ตั้งชื่องวด Backup
    let fileName = customName ? String(customName).trim() : '';
    if (!fileName) {
      if (startDate && endDate) {
        fileName = `งวดค่าแรง ${startDate} ถึง ${endDate}`;
      } else if (startDate) {
        fileName = `งวดค่าแรงตั้งแต่ ${startDate}`;
      } else if (endDate) {
        fileName = `งวดค่าแรงถึง ${endDate}`;
      } else {
        fileName = `เบิกงวด ${formatBackupDate()}`;
      }
    }

    const targetGroupIds = new Set(targetLogs.map(l => String(l.GroupID || l.group_id)).filter(Boolean));
    let allImages = {};
    const targetImages = {};

    if (isCloudConfigured()) {
      const imgRows = await sbFetch('/rest/v1/log_images?select=*');
      (imgRows || []).forEach(r => {
        allImages[r.group_id] = r.image_urls;
        if (targetGroupIds.has(String(r.group_id))) {
          targetImages[r.group_id] = r.image_urls;
        }
      });

      const created = await sbFetch('/rest/v1/log_backups', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          name: fileName,
          logs_data: targetLogs,
          images_data: targetImages
        })
      });

      // ลบเฉพาะบันทึกรายวันในช่วงวันที่ตัดจ่าย
      if (!startDate && !endDate) {
        await clearAllLogs();
      } else {
        for (const gid of targetGroupIds) {
          await sbFetch(`/rest/v1/daily_logs?group_id=eq.${encodeURIComponent(gid)}`, { method: 'DELETE' }).catch(() => {});
          await sbFetch(`/rest/v1/log_images?group_id=eq.${encodeURIComponent(gid)}`, { method: 'DELETE' }).catch(() => {});
        }
      }

      // ลบใบสั่งงานที่เสร็จสมบูรณ์แล้วออกจากตารางปัจจุบัน (เก็บใน Backup แล้ว)
      if (archiveCompletedTasks && completedTasks.length > 0) {
        for (const ct of completedTasks) {
          await deleteTask(ct.id).catch(() => {});
        }
      }

      return {
        fileId: created?.[0]?.id,
        fileName,
        archivedLogsCount: targetLogs.length,
        archivedGroupsCount: targetGroupIds.size,
        archivedCompletedTasksCount: completedTasks.length,
        updatedActiveTasksCount: snapRes.updatedCount
      };
    }

    // โหมด Local Storage
    allImages = readLocal(LOCAL_KEYS.IMAGES, {});
    targetGroupIds.forEach(gid => {
      if (allImages[gid]) targetImages[gid] = allImages[gid];
    });

    const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
    const newBackup = {
      id: generateUuid(),
      name: fileName,
      startDate: startDate || null,
      endDate: endDate || null,
      createdDate: new Date().toISOString(),
      logsData: targetLogs,
      imagesData: targetImages,
      completedTasksData: completedTasks,
      activeTasksSnapshot
    };
    backups.unshift(newBackup);
    writeLocal(LOCAL_KEYS.BACKUPS, backups);

    // ลบเฉพาะบันทึกรายวันในช่วงวันที่ตัดจ่าย (คงวันที่อยู่นอกช่วงไว้)
    writeLocal(LOCAL_KEYS.LOGS, remainingLogs);
    const remainingImages = {};
    Object.keys(allImages).forEach(gid => {
      if (!targetGroupIds.has(String(gid))) {
        remainingImages[gid] = allImages[gid];
      }
    });
    writeLocal(LOCAL_KEYS.IMAGES, remainingImages);

    // ย้ายใบสั่งงานที่เสร็จแล้ว (Completed) ออกจากรายการปัจจุบัน (คงใบงานที่ยังไม่เสร็จไว้ทำต่อในงวดถัดไป)
    if (archiveCompletedTasks && completedTasks.length > 0) {
      const completedIdsSet = new Set(completedTasks.map(t => String(t.id)));
      const rawTasks = readLocal(LOCAL_KEYS.TASKS, []);
      const keptTasks = rawTasks.filter(t => !completedIdsSet.has(String(t.id)));
      writeLocal(LOCAL_KEYS.TASKS, keptTasks);
    }

    return {
      fileId: newBackup.id,
      fileName,
      archivedLogsCount: targetLogs.length,
      archivedGroupsCount: targetGroupIds.size,
      archivedCompletedTasksCount: completedTasks.length,
      updatedActiveTasksCount: snapRes.updatedCount
    };
  }

  async function backupSpreadsheet(options = {}) {
    const { startDate = null, endDate = null, customName = '' } = options || {};
    const allLogs = await fetchAllLogRows();
    const logs = (startDate || endDate)
      ? allLogs.filter(l => isDateInRange(l.work_date || l.Date, startDate, endDate))
      : allLogs;

    const allTasksNow = await getTasks().catch(() => []);
    const completedTasks = allTasksNow.filter(t => t.status === 'Completed');
    const workers = await fetchAllWorkers().catch(() => []);

    let fileName = customName ? String(customName).trim() : '';
    if (!fileName) {
      if (startDate && endDate) {
        fileName = `Backup ${startDate} ถึง ${endDate}`;
      } else if (startDate) {
        fileName = `Backup ตั้งแต่ ${startDate}`;
      } else if (endDate) {
        fileName = `Backup ถึง ${endDate}`;
      } else {
        fileName = `เบิกงวด ${formatBackupDate()}`;
      }
    }

    const targetGroupIds = new Set(logs.map(l => String(l.GroupID || l.group_id)).filter(Boolean));
    let imagesData = {};

    if (isCloudConfigured()) {
      const imgRows = await sbFetch('/rest/v1/log_images?select=*');
      (imgRows || []).forEach(r => {
        if (!startDate && !endDate) {
          imagesData[r.group_id] = r.image_urls;
        } else if (targetGroupIds.has(String(r.group_id))) {
          imagesData[r.group_id] = r.image_urls;
        }
      });
      const created = await sbFetch('/rest/v1/log_backups', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          name: fileName,
          logs_data: logs,
          images_data: imagesData
        })
      });
      return { fileId: created?.[0]?.id, fileName, url: '#', logsCount: logs.length, groupsCount: targetGroupIds.size };
    }

    const allLocalImages = readLocal(LOCAL_KEYS.IMAGES, {});
    if (!startDate && !endDate) {
      imagesData = { ...allLocalImages };
    } else {
      targetGroupIds.forEach(gid => {
        if (allLocalImages[gid]) imagesData[gid] = allLocalImages[gid];
      });
    }

    const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
    const newBackup = {
      id: generateUuid(),
      name: fileName,
      startDate: startDate || null,
      endDate: endDate || null,
      createdDate: new Date().toISOString(),
      logsData: logs,
      imagesData,
      completedTasksData: completedTasks,
      allTasksData: allTasksNow,
      workersData: workers
    };
    backups.unshift(newBackup);
    writeLocal(LOCAL_KEYS.BACKUPS, backups);
    return { fileId: newBackup.id, fileName, url: '#', logsCount: logs.length, groupsCount: targetGroupIds.size };
  }

  async function clearAllLogs() {
    if (isCloudConfigured()) {
      await sbFetch('/rest/v1/daily_logs?id=gt.0', { method: 'DELETE' });
      await sbFetch('/rest/v1/log_images?group_id=neq.__none__', { method: 'DELETE' });
      return { cleared: true };
    }
    writeLocal(LOCAL_KEYS.LOGS, []);
    writeLocal(LOCAL_KEYS.IMAGES, {});
    return { cleared: true };
  }

  async function listBackups() {
    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/log_backups?select=id,name,created_at&order=created_at.desc');
      return (rows || []).map(r => ({
        id: r.id,
        name: r.name,
        createdDate: r.created_at
      }));
    }
    const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
    return backups.map(b => ({
      id: b.id,
      name: b.name,
      startDate: b.startDate || null,
      endDate: b.endDate || null,
      createdDate: b.createdDate,
      completedTasksCount: Array.isArray(b.completedTasksData) ? b.completedTasksData.length : 0
    }));
  }

  function groupLogRows(logs = []) {
    const groups = {};
    logs.forEach(row => {
      const gid = row.GroupID || row.group_id;
      if (!gid) return;
      if (!groups[gid]) {
        groups[gid] = {
          GroupID: gid,
          Date: row.Date || row.work_date,
          Site: row.Site || row.site || '',
          JobDetail: row.JobDetail || row.job_detail || '',
          RequestedBy: row.RequestedBy || row.requested_by || '',
          TaskId: row.TaskId ?? row.task_id ?? null,
          Workers: []
        };
      }
      groups[gid].Workers.push(mapLogRowFromDb(row));
    });
    const groupList = Object.values(groups);
    groupList.sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    return groupList;
  }

  async function getBackupData(payload) {
    const fileId = payload.fileId;
    let backupName = '';
    let logs = [];
    let imagesData = {};
    let completedTasks = [];
    let allTasks = [];
    let workers = [];
    let startDate = null;
    let endDate = null;
    let createdDate = null;

    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/log_backups?select=*&id=eq.${encodeURIComponent(fileId)}`);
      if (!rows || !rows.length) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupName = rows[0].name;
      logs = (rows[0].logs_data || []).map(mapLogRowFromDb);
      imagesData = rows[0].images_data || {};
      createdDate = rows[0].created_at || null;
      workers = await fetchAllWorkers().catch(() => []);
      allTasks = await getTasks().catch(() => []);
    } else {
      const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
      const found = backups.find(b => String(b.id) === String(fileId));
      if (!found) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupName = found.name;
      logs = (found.logsData || []).map(mapLogRowFromDb);
      imagesData = found.imagesData || {};
      completedTasks = Array.isArray(found.completedTasksData) ? found.completedTasksData : [];
      allTasks = Array.isArray(found.allTasksData) ? found.allTasksData : await getTasks().catch(() => []);
      workers = Array.isArray(found.workersData) ? found.workersData : await fetchAllWorkers().catch(() => []);
      startDate = found.startDate || null;
      endDate = found.endDate || null;
      createdDate = found.createdDate || null;
    }

    const groupList = groupLogRows(logs);
    if (!startDate || !endDate) {
      const dates = groupList.map(g => String(g.Date || '').slice(0, 10)).filter(Boolean).sort();
      if (!startDate && dates.length) startDate = dates[0];
      if (!endDate && dates.length) endDate = dates[dates.length - 1];
    }

    return {
      fileId,
      fileName: backupName,
      startDate,
      endDate,
      createdDate,
      logs: groupList,
      rawLogs: logs,
      imagesData,
      completedTasks,
      tasks: allTasks,
      workers
    };
  }

  async function buildBackupPackageData(options = {}) {
    const { fileId = null, startDate = null, endDate = null, customName = '', saveToHistory = false } = options;

    if (fileId) {
      const data = await getBackupData({ fileId });
      return {
        version: '3.0-offline-package',
        exportedAt: new Date().toISOString(),
        fileId: data.fileId,
        fileName: data.fileName,
        startDate: data.startDate,
        endDate: data.endDate,
        workers: data.workers || [],
        rawLogs: data.rawLogs || [],
        logs: data.logs || [],
        imagesData: data.imagesData || {},
        tasks: data.tasks || [],
        completedTasks: data.completedTasks || []
      };
    }

    let savedFileId = null;
    if (saveToHistory) {
      const saved = await backupSpreadsheet({ startDate, endDate, customName });
      savedFileId = saved.fileId;
      return await buildBackupPackageData({ fileId: savedFileId });
    }

    const allLogs = await fetchAllLogRows();
    const rawLogs = (startDate || endDate)
      ? allLogs.filter(l => isDateInRange(l.work_date || l.Date, startDate, endDate))
      : allLogs;
    const groupList = groupLogRows(rawLogs);
    const targetGroupIds = new Set(rawLogs.map(l => String(l.GroupID || l.group_id)).filter(Boolean));
    let imagesData = {};

    if (isCloudConfigured()) {
      const imgRows = await sbFetch('/rest/v1/log_images?select=*');
      (imgRows || []).forEach(r => {
        if (targetGroupIds.has(String(r.group_id))) {
          imagesData[r.group_id] = r.image_urls;
        }
      });
    } else {
      const allLocalImages = readLocal(LOCAL_KEYS.IMAGES, {});
      targetGroupIds.forEach(gid => {
        if (allLocalImages[gid]) imagesData[gid] = allLocalImages[gid];
      });
    }

    const workers = await fetchAllWorkers().catch(() => []);
    const tasks = await getTasks().catch(() => []);
    const completedTasks = tasks.filter(t => t.status === 'Completed');

    let fileName = customName ? String(customName).trim() : '';
    if (!fileName) {
      if (startDate && endDate) fileName = `Backup_${startDate}_ถึง_${endDate}`;
      else fileName = `Backup_${formatBackupDate()}`;
    }

    return {
      version: '3.0-offline-package',
      exportedAt: new Date().toISOString(),
      fileName,
      startDate: startDate || null,
      endDate: endDate || null,
      workers,
      rawLogs,
      logs: groupList,
      imagesData,
      tasks,
      completedTasks
    };
  }

  async function importBackupPackage(packageData, options = {}) {
    const {
      mode = 'replace_matching', // 'replace_matching' | 'replace_date_range'
      selectedGroupIds = null,
      selectedTaskIds = null,
      saveToBackupHistory = true
    } = options;

    if (!packageData || typeof packageData !== 'object') {
      throw new Error('รูปแบบไฟล์ Backup ไม่ถูกต้อง');
    }

    let incomingRows = [];
    if (Array.isArray(packageData.rawLogs) && packageData.rawLogs.length > 0) {
      incomingRows = packageData.rawLogs.map(mapLogRowFromDb);
    } else if (Array.isArray(packageData.logs)) {
      packageData.logs.forEach(item => {
        if (Array.isArray(item.Workers)) {
          item.Workers.forEach(w => {
            incomingRows.push(mapLogRowFromDb({
              ...w,
              GroupID: w.GroupID || item.GroupID,
              Date: w.Date || item.Date,
              Site: w.Site || item.Site,
              JobDetail: w.JobDetail || item.JobDetail,
              RequestedBy: w.RequestedBy || item.RequestedBy,
              TaskId: w.TaskId ?? item.TaskId ?? null
            }));
          });
        } else if (item.GroupID || item.group_id) {
          incomingRows.push(mapLogRowFromDb(item));
        }
      });
    }

    if (Array.isArray(selectedGroupIds) && selectedGroupIds.length > 0) {
      const allowedSet = new Set(selectedGroupIds.map(String));
      incomingRows = incomingRows.filter(r => allowedSet.has(String(r.GroupID)));
    }

    const incomingImages = packageData.imagesData || packageData.images || {};
    const incomingTasks = [
      ...(Array.isArray(packageData.tasks) ? packageData.tasks : []),
      ...(Array.isArray(packageData.completedTasks) ? packageData.completedTasks : [])
    ];
    const taskMap = new Map();
    incomingTasks.forEach(t => {
      if (t && t.id != null) taskMap.set(String(t.id), t);
    });
    let tasksToImport = Array.from(taskMap.values());
    if (Array.isArray(selectedTaskIds)) {
      const allowedTaskSet = new Set(selectedTaskIds.map(String));
      tasksToImport = tasksToImport.filter(t => allowedTaskSet.has(String(t.id)));
    }

    const incomingGroupIds = Array.from(new Set(incomingRows.map(r => String(r.GroupID)).filter(Boolean)));
    const startDate = packageData.startDate || null;
    const endDate = packageData.endDate || null;

    if (saveToBackupHistory && incomingRows.length > 0) {
      const histName = packageData.fileName
        ? `${packageData.fileName} (นำเข้าจาก PC)`
        : `นำเข้าจาก PC ${formatBackupDate()}`;
      if (isCloudConfigured()) {
        await sbFetch('/rest/v1/log_backups', {
          method: 'POST',
          body: JSON.stringify({
            name: histName,
            logs_data: incomingRows,
            images_data: incomingImages
          })
        }).catch(() => {});
      } else {
        const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
        backups.unshift({
          id: generateUuid(),
          name: histName,
          startDate,
          endDate,
          createdDate: new Date().toISOString(),
          logsData: incomingRows,
          imagesData: incomingImages,
          completedTasksData: tasksToImport.filter(t => t.status === 'Completed'),
          allTasksData: tasksToImport,
          workersData: packageData.workers || []
        });
        writeLocal(LOCAL_KEYS.BACKUPS, backups);
      }
    }

    let updatedGroupsCount = 0;
    if (incomingRows.length > 0 || (mode === 'replace_date_range' && startDate && endDate)) {
      const currentLogs = await fetchAllLogRows();
      const groupsToRemove = new Set(incomingGroupIds);

      if (mode === 'replace_date_range' && (startDate || endDate)) {
        currentLogs.forEach(l => {
          const d = l.Date || l.work_date;
          if (isDateInRange(d, startDate, endDate)) {
            groupsToRemove.add(String(l.GroupID || l.group_id));
          }
        });
      }

      if (isCloudConfigured()) {
        for (const gid of groupsToRemove) {
          await sbFetch(`/rest/v1/daily_logs?group_id=eq.${encodeURIComponent(gid)}`, { method: 'DELETE' }).catch(() => {});
          await sbFetch(`/rest/v1/log_images?group_id=eq.${encodeURIComponent(gid)}`, { method: 'DELETE' }).catch(() => {});
        }

        if (incomingRows.length > 0) {
          const dbPayload = incomingRows.map(r => ({
            group_id: r.GroupID,
            work_date: r.Date,
            site: r.Site || '',
            job_detail: r.JobDetail || '',
            requested_by: r.RequestedBy || '',
            worker_name: r.WorkerName,
            daily_wage: Number(r.DailyWage) || 0,
            wage_type: r.WageType || 'hourly',
            hours: Number(r.Hours) || 0,
            ot_hours: Number(r.OTHours) || 0,
            fixed_amount: Number(r.FixedAmount) || 0,
            raw_wage: Number(r.RawWage) || 0,
            total_with_markup: Number(r.TotalWithMarkup) || 0,
            task_id: r.TaskId != null ? Number(r.TaskId) : null,
            created_at: r.CreatedAt || new Date().toISOString()
          }));
          await sbFetch('/rest/v1/daily_logs', {
            method: 'POST',
            body: JSON.stringify(dbPayload)
          });
        }

        for (const gid of incomingGroupIds) {
          const imgs = incomingImages[gid];
          if (Array.isArray(imgs) && imgs.length > 0) {
            const uploadedUrls = [];
            for (let i = 0; i < imgs.length; i++) {
              const imgStr = imgs[i];
              if (typeof imgStr === 'string' && imgStr.startsWith('data:image/')) {
                const url = await uploadBase64ToSupabase(imgStr, gid, i);
                uploadedUrls.push(url);
              } else if (imgStr) {
                uploadedUrls.push(imgStr);
              }
            }
            if (uploadedUrls.length > 0) {
              await saveGroupImages(gid, uploadedUrls);
            }
          }
        }
      } else {
        const currentLocal = readLocal(LOCAL_KEYS.LOGS, []);
        const keptLocal = currentLocal.filter(r => !groupsToRemove.has(String(r.GroupID || r.group_id)));
        let maxId = keptLocal.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
        incomingRows.forEach(r => {
          maxId++;
          keptLocal.push({ ...r, ID: maxId, id: maxId });
        });
        writeLocal(LOCAL_KEYS.LOGS, keptLocal);

        const liveImgs = readLocal(LOCAL_KEYS.IMAGES, {});
        groupsToRemove.forEach(gid => { delete liveImgs[gid]; });
        incomingGroupIds.forEach(gid => {
          if (Array.isArray(incomingImages[gid]) && incomingImages[gid].length > 0) {
            liveImgs[gid] = incomingImages[gid];
          }
        });
        writeLocal(LOCAL_KEYS.IMAGES, liveImgs);
      }
      updatedGroupsCount = incomingGroupIds.length;
    }

    let updatedTasksCount = 0;
    if (tasksToImport.length > 0) {
      if (isCloudConfigured()) {
        for (const t of tasksToImport) {
          try {
            await updateTask(t.id, t);
            updatedTasksCount++;
          } catch (_) {
            try {
              await createTask(t);
              updatedTasksCount++;
            } catch (__) {}
          }
        }
      } else {
        const liveTasks = readLocal(LOCAL_KEYS.TASKS, []);
        const liveMap = new Map(liveTasks.map(t => [String(t.id), t]));
        tasksToImport.forEach(t => {
          liveMap.set(String(t.id), t);
          updatedTasksCount++;
        });
        writeLocal(LOCAL_KEYS.TASKS, Array.from(liveMap.values()));
      }
    }

    return {
      updatedGroupsCount,
      updatedRowsCount: incomingRows.length,
      updatedTasksCount
    };
  }

  async function restoreBackupGroups(payload) {
    const fileId = payload.fileId;
    const groupIds = payload.groupIds || [];
    const taskIds = payload.taskIds || [];
    if (!groupIds.length && !taskIds.length) {
      throw new Error('กรุณาเลือกใบงานหรือใบสั่งงานที่ต้องการกู้คืนอย่างน้อย 1 รายการ');
    }

    let backupLogs = [];
    let backupImages = {};
    let backupCompletedTasks = [];

    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/log_backups?select=*&id=eq.${encodeURIComponent(fileId)}`);
      if (!rows || !rows.length) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupLogs = rows[0].logs_data || [];
      backupImages = rows[0].images_data || {};
    } else {
      const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
      const found = backups.find(b => String(b.id) === String(fileId));
      if (!found) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupLogs = found.logsData || [];
      backupImages = found.imagesData || {};
      backupCompletedTasks = Array.isArray(found.completedTasksData) ? found.completedTasksData : [];
    }

    const currentLogs = await fetchAllLogRows();
    const existingSet = new Set(currentLogs.map(r => String(r.GroupID)));

    const restored = [];
    const skipped = [];
    const rowsToRestore = [];

    groupIds.forEach(gidRaw => {
      const gid = String(gidRaw);
      const matching = backupLogs.filter(r => String(r.GroupID) === gid);
      if (existingSet.has(gid) || !matching.length) {
        skipped.push(gid);
        return;
      }
      matching.forEach(r => rowsToRestore.push(r));
      restored.push(gid);
    });

    if (rowsToRestore.length > 0) {
      if (isCloudConfigured()) {
        const dbPayload = rowsToRestore.map(r => ({
          group_id: r.GroupID,
          work_date: r.Date,
          site: r.Site || '',
          job_detail: r.JobDetail || '',
          requested_by: r.RequestedBy || '',
          worker_name: r.WorkerName,
          daily_wage: Number(r.DailyWage) || 0,
          wage_type: r.WageType || 'hourly',
          hours: Number(r.Hours) || 0,
          ot_hours: Number(r.OTHours) || 0,
          fixed_amount: Number(r.FixedAmount) || 0,
          raw_wage: Number(r.RawWage) || 0,
          total_with_markup: Number(r.TotalWithMarkup) || 0,
          created_at: r.CreatedAt || new Date().toISOString()
        }));
        await sbFetch('/rest/v1/daily_logs', {
          method: 'POST',
          body: JSON.stringify(dbPayload)
        });
        for (const gid of restored) {
          if (backupImages[gid]) {
            await saveGroupImages(gid, backupImages[gid]);
          }
        }
      } else {
        const live = readLocal(LOCAL_KEYS.LOGS, []);
        let maxId = live.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
        rowsToRestore.forEach(r => {
          maxId++;
          live.push({ ...r, ID: maxId });
        });
        writeLocal(LOCAL_KEYS.LOGS, live);
        const liveImgs = readLocal(LOCAL_KEYS.IMAGES, {});
        restored.forEach(gid => {
          if (backupImages[gid]) liveImgs[gid] = backupImages[gid];
        });
        writeLocal(LOCAL_KEYS.IMAGES, liveImgs);
      }
    }

    // กู้คืนใบสั่งงานที่เสร็จแล้วกลับเข้าหน้าใบสั่งงาน (ถ้าเลือก)
    const restoredTasks = [];
    if (!isCloudConfigured() && taskIds.length > 0 && backupCompletedTasks.length > 0) {
      const liveTasks = readLocal(LOCAL_KEYS.TASKS, []);
      const existingTaskIds = new Set(liveTasks.map(t => String(t.id)));
      taskIds.forEach(tid => {
        const foundTask = backupCompletedTasks.find(t => String(t.id) === String(tid));
        if (foundTask && !existingTaskIds.has(String(foundTask.id))) {
          liveTasks.push(foundTask);
          restoredTasks.push(foundTask.id);
        }
      });
      writeLocal(LOCAL_KEYS.TASKS, liveTasks);
    }

    return { restored, skipped, restoredTasks };
  }

  // ============================================================
  // OFFLINE PC MANAGER INTEGRATION (ทำงานร่วมกับ offline_manager.py)
  // ============================================================
  async function checkOfflineMode() {
    try {
      const res = await fetch('/api/offline/info');
      if (!res.ok) return null;
      const json = await res.json();
      return json && json.is_offline_mode ? json : null;
    } catch (_) {
      return null;
    }
  }

  async function loadOfflineFolderData(options = {}) {
    const { folder = '', zip = '' } = options;
    let url = '/api/offline/load';
    if (folder) url += `?folder=${encodeURIComponent(folder)}`;
    else if (zip) url += `?zip=${encodeURIComponent(zip)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'โหลดข้อมูลงวดงานบน PC ไม่สำเร็จ');

    const pkg = json.data || {};
    if (Array.isArray(pkg.rawLogs) && pkg.rawLogs.length > 0) {
      writeLocal(LOCAL_KEYS.LOGS, pkg.rawLogs.map(mapLogRowFromDb));
    } else if (Array.isArray(pkg.logs)) {
      const flat = [];
      pkg.logs.forEach(g => {
        (g.Workers || []).forEach(w => flat.push(mapLogRowFromDb(w)));
      });
      writeLocal(LOCAL_KEYS.LOGS, flat);
    }
    if (Array.isArray(pkg.tasks)) writeLocal(LOCAL_KEYS.TASKS, pkg.tasks);
    if (Array.isArray(pkg.workers) && pkg.workers.length > 0) writeLocal(LOCAL_KEYS.WORKERS, pkg.workers);
    if (pkg.imagesData) writeLocal(LOCAL_KEYS.IMAGES, pkg.imagesData);

    return json;
  }


  async function getCalendarDayOverrides() {
    await loadLocalDiskDbIfAvailable();
    return readLocal(LOCAL_KEYS.CALENDAR_OVERRIDES, {}) || {};
  }

  async function saveCalendarDayOverride(dateIso, type, note = '') {
    const overrides = readLocal(LOCAL_KEYS.CALENDAR_OVERRIDES, {}) || {};
    if (!type || type === 'clear') {
      delete overrides[dateIso];
    } else {
      overrides[dateIso] = { type, note, updated_at: new Date().toISOString() };
    }
    localStorage.setItem(LOCAL_KEYS.CALENDAR_OVERRIDES, JSON.stringify(overrides));

    // บันทึกลง _local_data/db.json
    if (typeof fetch !== 'undefined') {
      try {
        await fetch('/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendar_day_status: overrides })
        });
      } catch (_) {}
    }
    return overrides;
  }

  async function saveOfflineCurrentState() {
    const pkg = await buildBackupPackageData({});
    const res = await fetch('/api/offline/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg)
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'บันทึกข้อมูลงวดงานลง PC ไม่สำเร็จ');
    return json;
  }

  async function exportOfflineCurrentZip() {
    const res = await fetch('/api/offline/export-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'แพ็กไฟล์ .zip ไม่สำเร็จ');
    return json;
  }

  return {
    isCloudConfigured,
    getConfig,
    getDashboard,
    getWorkers,
    addWorker,
    updateWorker,
    deleteWorker,
    getLogs,
    addLogs,
    deleteLogGroup,
    getLogGroup,
    updateLogGroup,
    getReport,
    getPivotReport,
    getDailyWorkerHoursSummary,
    getSiteHistory,
    getRequesterHistory,
    backupSpreadsheet,
    closePayrollPeriod,
    clearAllLogs,
    listBackups,
    getBackupData,
    buildBackupPackageData,
    importBackupPackage,
    restoreBackupGroups,
    // Tasks API
    getTasks,
    getTaskById,
    createTask,
    updateTask,
    deleteTask,
    addTaskProgress,
    getTaskCostSummary,
    snapshotActiveTasksBeforeClear,
    normalizeSubItems,
    calculateTaskSummaryFromSubItems,
    // Task Media (IndexedDB)
    saveTaskMedia,
    getTaskMedia,
    listTaskMedia,
    deleteTaskMedia,
    getAllImages,
    MAX_MEDIA_SIZE_BYTES,
    // Offline PC Manager API
    checkOfflineMode,
    loadOfflineFolderData,
    saveOfflineCurrentState,
    exportOfflineCurrentZip,
    // Calendar Overrides API
    getCalendarDayOverrides,
    saveCalendarDayOverride,
    // Portable Local Disk API
    loadLocalDiskDbIfAvailable,
    migrateIndexedDbToLocalDisk
  };
})();

// Auto-init for portable drive (ดึง db.json จากไดรฟ์ E: และกู้คืนรูปจาก IndexedDB ลงโฟลเดอร์เครื่อง)
if (typeof window !== 'undefined') {
  try {
    Api.loadLocalDiskDbIfAvailable().then(() => {
      Api.migrateIndexedDbToLocalDisk().catch(() => {});
    }).catch(() => {});
  } catch (_) {}
}

// ให้บริการผ่าน window.Api และ window.WAGE_API สำหรับเบราว์เซอร์ และ CommonJS สำหรับ Node.js
if (typeof window !== 'undefined') {
  window.Api = Api;
  window.WAGE_API = Api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Api;
}
