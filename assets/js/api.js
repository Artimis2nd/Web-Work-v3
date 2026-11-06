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
    TASKS: 'WAGE_LOCAL_TASKS'
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

  function calcTotal(rawWage, workerName, wageType) {
    const cfg = getConfig();
    if (wageType === 'fixed') return rawWage;
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

  function writeLocal(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function ensureLocalSeed() {
    const existing = localStorage.getItem(LOCAL_KEYS.WORKERS);
    if (!existing) {
      writeLocal(LOCAL_KEYS.WORKERS, [
        { ID: 1, FullName: 'สมชาย ใจดี', DailyWage: 450, Status: 'Active' },
        { ID: 2, FullName: 'สมศรี ขยันงาน', DailyWage: 400, Status: 'Active' },
        { ID: 3, FullName: 'เฟิร์น', DailyWage: 500, Status: 'Active' }
      ]);
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

  // ============================================================
  // CORE DATA FETCHERS (WORKERS & LOGS)
  // ============================================================
  async function fetchAllWorkers() {
    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/workers?select=*&order=id.asc');
      return (rows || []).map(r => ({
        ID: r.id,
        FullName: r.full_name,
        DailyWage: Number(r.daily_wage) || 0,
        Status: r.status || 'Active'
      }));
    }
    ensureLocalSeed();
    return readLocal(LOCAL_KEYS.WORKERS, []);
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

    let logs = readLocal(LOCAL_KEYS.LOGS, []);
    if (filters.startDate) logs = logs.filter(r => (r.Date || r.work_date) >= filters.startDate);
    if (filters.endDate) logs = logs.filter(r => (r.Date || r.work_date) <= filters.endDate);
    if (filters.workerName) logs = logs.filter(r => (r.WorkerName || r.worker_name) === filters.workerName);
    if (filters.groupId) logs = logs.filter(r => String(r.GroupID || r.group_id) === String(filters.groupId));
    if (filters.taskId != null) logs = logs.filter(r => String(r.TaskId ?? r.task_id) === String(filters.taskId));
    return logs;
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
    const imgMap = readLocal(LOCAL_KEYS.IMAGES, {});
    imgMap[groupId] = urls;
    writeLocal(LOCAL_KEYS.IMAGES, imgMap);
  }

  // ============================================================
  // PUBLIC API METHODS (ตรงกับทุก Action ของระบบเดิม)
  // ============================================================
  async function getWorkers() {
    return fetchAllWorkers();
  }

  async function addWorker(payload) {
    if (isCloudConfigured()) {
      const rows = await sbFetch('/rest/v1/workers', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          full_name: payload.fullName,
          daily_wage: Number(payload.dailyWage) || 0,
          status: payload.status || 'Active'
        })
      });
      return { id: rows?.[0]?.id };
    }
    const workers = await fetchAllWorkers();
    const maxId = workers.reduce((m, w) => Math.max(m, Number(w.ID) || 0), 0);
    const newId = maxId + 1;
    workers.push({
      ID: newId,
      FullName: payload.fullName,
      DailyWage: Number(payload.dailyWage) || 0,
      Status: payload.status || 'Active'
    });
    writeLocal(LOCAL_KEYS.WORKERS, workers);
    return { id: newId };
  }

  async function updateWorker(payload) {
    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/workers?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: payload.fullName,
          daily_wage: Number(payload.dailyWage) || 0,
          status: payload.status || 'Active'
        })
      });
      return { id: payload.id };
    }
    const workers = await fetchAllWorkers();
    const idx = workers.findIndex(w => String(w.ID) === String(payload.id));
    if (idx === -1) throw new Error('ไม่พบคนงาน ID: ' + payload.id);
    workers[idx] = {
      ...workers[idx],
      FullName: payload.fullName,
      DailyWage: Number(payload.dailyWage) || 0,
      Status: payload.status || 'Active'
    };
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
    const [workers, logs] = await Promise.all([fetchAllWorkers(), fetchAllLogRows()]);
    const totalWorkers = workers.filter(w => w.Status === 'Active').length;
    const groups = {};

    logs.forEach(row => {
      const gid = row.GroupID;
      if (!gid) return;
      if (!groups[gid]) {
        groups[gid] = {
          groupId: gid,
          date: row.Date,
          site: row.Site,
          jobDetail: row.JobDetail,
          requestedBy: row.RequestedBy,
          workers: [],
          totalRaw: 0,
          totalNormal: 0,
          totalFixed: 0,
          createdAt: row.CreatedAt
        };
      }
      if (!groups[gid].jobDetail && row.JobDetail) groups[gid].jobDetail = row.JobDetail;
      if (!groups[gid].requestedBy && row.RequestedBy) groups[gid].requestedBy = row.RequestedBy;

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

    const recentGroups = groupList.slice(0, 50).map(g => ({
      groupId: g.groupId,
      date: g.date,
      site: g.site,
      jobDetail: g.jobDetail,
      requestedBy: g.requestedBy,
      workerCount: g.workers.length,
      totalNormal: g.totalNormal,
      totalFixed: g.totalFixed
    }));

    return {
      totalWorkers,
      totalLogGroups: groupList.length,
      totalNormalWage,
      totalFixedWage,
      recentGroups
    };
  }

  async function getLogs(payload = {}) {
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
      const totalWage = calcTotal(rawWage, w.workerName, w.wageType);
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
    if (isCloudConfigured()) {
      await sbFetch(`/rest/v1/daily_logs?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      await sbFetch(`/rest/v1/log_images?group_id=eq.${encodeURIComponent(groupId)}`, { method: 'DELETE' });
      return { deleted: true };
    }
    const existing = readLocal(LOCAL_KEYS.LOGS, []).filter(r => String(r.GroupID || r.group_id) !== String(groupId));
    writeLocal(LOCAL_KEYS.LOGS, existing);
    const imgMap = readLocal(LOCAL_KEYS.IMAGES, {});
    delete imgMap[groupId];
    writeLocal(LOCAL_KEYS.IMAGES, imgMap);
    return { deleted: true };
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
      const totalWage = calcTotal(rawWage, w.workerName, w.wageType);
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
  // ใบสั่งงาน / งานโครงการ (TASKS / JOB ORDERS & TASK COSTING)
  // ============================================================
  function mapTaskRowFromDb(r) {
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
      progress_history: history,
      accumulated_cost: Number(r.accumulated_cost) || 0,
      accumulated_markup_cost: Number(r.accumulated_markup_cost) || 0,
      accumulated_hours: Number(r.accumulated_hours) || 0,
      accumulated_man_days: Number(r.accumulated_man_days) || 0,
      accumulated_days: Number(r.accumulated_days) || 0,
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

    const taskPayload = {
      task_code: taskCode,
      title: taskData.title || '',
      site: taskData.site || '',
      location_detail: taskData.location_detail || '',
      assigned_to: taskData.assigned_to || '',
      ordered_by: taskData.ordered_by || '',
      order_date: orderDate,
      due_date: taskData.due_date || null,
      status: taskData.status || 'Pending',
      progress_percent: Number(taskData.progress_percent) || 0,
      description: taskData.description || '',
      issues: taskData.issues || '',
      resolution: taskData.resolution || '',
      completion_summary: taskData.completion_summary || '',
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
      const rows = await sbFetch('/rest/v1/tasks', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(taskPayload)
      });
      return mapTaskRowFromDb(rows?.[0]);
    }

    const tasks = readLocal(LOCAL_KEYS.TASKS, []);
    const maxId = tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
    const newTask = {
      ...taskPayload,
      id: maxId + 1
    };
    tasks.push(newTask);
    writeLocal(LOCAL_KEYS.TASKS, tasks);
    return mapTaskRowFromDb(newTask);
  }

  async function getTasks(filter = {}) {
    let taskList = [];
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
      taskList = (rows || []).map(mapTaskRowFromDb);
    } else {
      taskList = readLocal(LOCAL_KEYS.TASKS, []).map(mapTaskRowFromDb);
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
    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/tasks?select=*&id=eq.${encodeURIComponent(id)}`);
      if (!rows || !rows.length) return null;
      return mapTaskRowFromDb(rows[0]);
    }
    const tasks = readLocal(LOCAL_KEYS.TASKS, []);
    const found = tasks.find(t => String(t.id) === String(id));
    return found ? mapTaskRowFromDb(found) : null;
  }

  async function updateTask(id, taskData = {}) {
    if (id == null) throw new Error('ต้องระบุ id ของใบสั่งงาน');
    const now = new Date().toISOString();
    const updatePayload = {
      ...taskData,
      updated_at: now
    };
    delete updatePayload.id;

    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/tasks?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(updatePayload)
      });
      if (!rows || !rows.length) throw new Error('ไม่พบใบสั่งงาน ID: ' + id);
      return mapTaskRowFromDb(rows[0]);
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
    return mapTaskRowFromDb(updated);
  }

  async function deleteTask(id) {
    if (id == null) throw new Error('ต้องระบุ id ของใบสั่งงาน');
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
    const percentNum = Number(progressInfo.percent);
    const dateStr = progressInfo.date || now.slice(0, 10);
    const issues = progressInfo.issues !== undefined ? String(progressInfo.issues) : '';
    const resolution = progressInfo.resolution !== undefined ? String(progressInfo.resolution) : '';
    const by = progressInfo.by !== undefined ? String(progressInfo.by) : '';

    const newHistoryEntry = {
      date: dateStr,
      percent: percentNum,
      issues,
      resolution,
      by,
      created_at: now
    };

    const history = Array.isArray(task.progress_history) ? [...task.progress_history] : [];
    history.push(newHistoryEntry);

    let status = task.status;
    if (status === 'Pending' && percentNum > 0) {
      status = 'In Progress';
    }

    const updates = {
      progress_history: history,
      progress_percent: percentNum,
      issues: progressInfo.issues !== undefined ? issues : task.issues,
      resolution: progressInfo.resolution !== undefined ? resolution : task.resolution,
      status
    };

    return updateTask(id, updates);
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

  async function snapshotActiveTasksBeforeClear() {
    const activeTasks = await getTasks({ excludeCompleted: true });
    const allLogs = await fetchAllLogRows();
    const cfg = getConfig();

    let updatedCount = 0;
    for (const task of activeTasks) {
      const taskLogs = allLogs.filter(l => String(l.task_id ?? l.TaskId) === String(task.id));
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
  // ระบบสำรองข้อมูล "เบิกงวด" และกู้คืนใบงาน (Backups)
  // ============================================================
  async function backupSpreadsheet() {
    const logs = await fetchAllLogRows();
    const fileName = `เบิกงวด ${formatBackupDate()}`;
    let imagesData = {};

    if (isCloudConfigured()) {
      const imgRows = await sbFetch('/rest/v1/log_images?select=*');
      (imgRows || []).forEach(r => { imagesData[r.group_id] = r.image_urls; });
      const created = await sbFetch('/rest/v1/log_backups', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          name: fileName,
          logs_data: logs,
          images_data: imagesData
        })
      });
      return { fileId: created?.[0]?.id, fileName, url: '#' };
    }

    imagesData = readLocal(LOCAL_KEYS.IMAGES, {});
    const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
    const newBackup = {
      id: generateUuid(),
      name: fileName,
      createdDate: new Date().toISOString(),
      logsData: logs,
      imagesData
    };
    backups.unshift(newBackup);
    writeLocal(LOCAL_KEYS.BACKUPS, backups);
    return { fileId: newBackup.id, fileName, url: '#' };
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
    return backups.map(b => ({ id: b.id, name: b.name, createdDate: b.createdDate }));
  }

  async function getBackupData(payload) {
    const fileId = payload.fileId;
    let backupName = '';
    let logs = [];

    if (isCloudConfigured()) {
      const rows = await sbFetch(`/rest/v1/log_backups?select=*&id=eq.${encodeURIComponent(fileId)}`);
      if (!rows || !rows.length) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupName = rows[0].name;
      logs = rows[0].logs_data || [];
    } else {
      const backups = readLocal(LOCAL_KEYS.BACKUPS, []);
      const found = backups.find(b => String(b.id) === String(fileId));
      if (!found) throw new Error('ไม่พบข้อมูลสำรองนี้');
      backupName = found.name;
      logs = found.logsData || [];
    }

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
          Workers: []
        };
      }
      groups[gid].Workers.push(row);
    });

    const groupList = Object.values(groups);
    groupList.sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    return { fileName: backupName, logs: groupList };
  }

  async function restoreBackupGroups(payload) {
    const fileId = payload.fileId;
    const groupIds = payload.groupIds || [];
    if (!groupIds.length) throw new Error('กรุณาเลือกใบงานที่ต้องการกู้คืนอย่างน้อย 1 รายการ');

    let backupLogs = [];
    let backupImages = {};

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

    return { restored, skipped };
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
    getSiteHistory,
    getRequesterHistory,
    backupSpreadsheet,
    clearAllLogs,
    listBackups,
    getBackupData,
    restoreBackupGroups,
    // Tasks API
    getTasks,
    getTaskById,
    createTask,
    updateTask,
    deleteTask,
    addTaskProgress,
    getTaskCostSummary,
    snapshotActiveTasksBeforeClear
  };
})();

// ให้บริการผ่าน window.Api และ window.WAGE_API สำหรับเบราว์เซอร์ และ CommonJS สำหรับ Node.js
if (typeof window !== 'undefined') {
  window.Api = Api;
  window.WAGE_API = Api;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Api;
}
