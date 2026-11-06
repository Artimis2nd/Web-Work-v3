/**
 * โมดูลกลางสำหรับจัดการข้อมูล (Supabase Cloud API + Local Storage Fallback)
 * แทนที่ Google Apps Script (Code.gs) เดิมทั้งหมด 100% ด้วยความเร็วระดับมิลลิวินาที
 */
const Api = (() => {
  const LOCAL_KEYS = {
    WORKERS: 'WAGE_LOCAL_WORKERS',
    LOGS: 'WAGE_LOCAL_LOGS',
    IMAGES: 'WAGE_LOCAL_IMAGES',
    BACKUPS: 'WAGE_LOCAL_BACKUPS'
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

  // แปลงแถวจาก Supabase (snake_case) เป็นรูปแบบเดียวกับระบบเดิม (PascalCase)
  function mapLogRowFromDb(r) {
    return {
      ID: r.id,
      GroupID: r.group_id,
      Date: r.work_date,
      Site: r.site,
      JobDetail: r.job_detail || '',
      RequestedBy: r.requested_by || '',
      WorkerName: r.worker_name,
      DailyWage: Number(r.daily_wage) || 0,
      WageType: r.wage_type || 'hourly',
      Hours: Number(r.hours) || 0,
      OTHours: Number(r.ot_hours) || 0,
      FixedAmount: Number(r.fixed_amount) || 0,
      RawWage: Number(r.raw_wage) || 0,
      TotalWithMarkup: Number(r.total_with_markup) || 0,
      CreatedAt: r.created_at
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
      const rows = await sbFetch(query);
      return (rows || []).map(mapLogRowFromDb);
    }

    let logs = readLocal(LOCAL_KEYS.LOGS, []);
    if (filters.startDate) logs = logs.filter(r => r.Date >= filters.startDate);
    if (filters.endDate) logs = logs.filter(r => r.Date <= filters.endDate);
    if (filters.workerName) logs = logs.filter(r => r.WorkerName === filters.workerName);
    if (filters.groupId) logs = logs.filter(r => String(r.GroupID) === String(filters.groupId));
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
      let maxId = existing.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
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
    const existing = readLocal(LOCAL_KEYS.LOGS, []).filter(r => String(r.GroupID) !== String(groupId));
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
    const workers = groupRows.map(row => ({
      workerName: row.WorkerName,
      dailyWage: Number(row.DailyWage) || 0,
      wageType: row.WageType || 'hourly',
      hours: Number(row.Hours) || 0,
      otHours: Number(row.OTHours) || 0,
      fixedAmount: Number(row.FixedAmount) || 0,
      RawWage: Number(row.RawWage) || 0,
      TotalWithMarkup: Number(row.TotalWithMarkup) || 0
    }));
    return {
      groupId,
      date: first.Date,
      site: first.Site,
      jobDetail: first.JobDetail,
      requestedBy: first.RequestedBy,
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
      const existing = readLocal(LOCAL_KEYS.LOGS, []).filter(r => String(r.GroupID) !== String(groupId));
      let maxId = existing.reduce((m, r) => Math.max(m, Number(r.ID) || 0), 0);
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
    restoreBackupGroups
  };
})();
