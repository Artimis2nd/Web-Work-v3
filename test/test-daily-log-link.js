/**
 * Test Suite for Task 5: Link Daily Logs with Assigned Tasks
 * Tests:
 * 1. daily-log.html and assets/js/pages/daily-log.js syntax validation
 * 2. Form layout: #f-task selector and #task-update-section elements
 * 3. Task dropdown population from Api.getTasks
 * 4. Auto-fill behavior on selecting and deselecting a task
 * 5. Form submission with selected task (taskId in addLogs and call to Api.addTaskProgress)
 * 6. Form submission without task (taskId: null and no addTaskProgress)
 * 7. Edit mode (loadEditGroup) restoring taskId, revealing task update section, and handling completed tasks
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Testing Task 5: Link Daily Logs with Assigned Tasks...\n');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

const htmlPath = path.resolve(__dirname, '../daily-log.html');
const jsPath = path.resolve(__dirname, '../assets/js/pages/daily-log.js');

// 1. Syntax & Files validation
it('daily-log.html and assets/js/pages/daily-log.js should exist and pass syntax checks', () => {
  assert(fs.existsSync(htmlPath), 'daily-log.html must exist');
  assert(fs.existsSync(jsPath), 'assets/js/pages/daily-log.js must exist');
  execSync(`node -c "${jsPath}"`, { stdio: 'pipe' });
});

// Helper for Mock DOM Environment
function setupMockDom(options = {}) {
  const elementMap = {};

  class MockElement {
    constructor(tagName, id = '') {
      this.tagName = (tagName || 'DIV').toUpperCase();
      this.id = id;
      this.className = '';
      this.style = {};
      this.attributes = {};
      this.childNodes = [];
      this.eventListeners = {};
      this._innerHTML = '';
      this._textContent = '';
      this._value = '';
      if (id) elementMap[id] = this;
    }

    get innerHTML() {
      const childHtml = this.childNodes.map(c => c._innerHTML || '').join('\n');
      return this._innerHTML + (childHtml ? '\n' + childHtml : '');
    }

    set innerHTML(html) {
      this._innerHTML = String(html);
      this._textContent = this._innerHTML.replace(/<[^>]+>/g, '').trim();
      this.childNodes = [];
      this._parseChildIds(this._innerHTML);
    }

    get textContent() {
      return this._textContent || this._innerHTML.replace(/<[^>]+>/g, '').trim();
    }

    set textContent(text) {
      this._textContent = String(text);
      this._innerHTML = String(text);
    }

    get value() {
      return this._value;
    }

    set value(v) {
      this._value = String(v ?? '');
    }

    get classList() {
      const self = this;
      return {
        add: (...classes) => {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          classes.forEach(c => set.add(c));
          self.className = Array.from(set).join(' ');
        },
        remove: (...classes) => {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          classes.forEach(c => set.delete(c));
          self.className = Array.from(set).join(' ');
        },
        contains: (c) => self.className.split(/\s+/).includes(c),
        toggle: (c) => {
          if (this.contains(c)) this.remove(c);
          else this.add(c);
        }
      };
    }

    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }

    getAttribute(k) {
      return this.attributes[k] || null;
    }

    hasAttribute(k) {
      return k in this.attributes;
    }

    removeAttribute(k) {
      delete this.attributes[k];
    }

    appendChild(child) {
      this.childNodes.push(child);
      child.parentNode = this;
      if (child.id) elementMap[child.id] = child;
      return child;
    }

    addEventListener(event, fn) {
      if (!this.eventListeners[event]) this.eventListeners[event] = [];
      this.eventListeners[event].push(fn);
    }

    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const fns = this.eventListeners[type] || [];
      const ev = typeof event === 'object' ? event : { type, target: this, defaultPrevented: false, preventDefault: () => {} };
      const promises = [];
      for (const fn of fns) {
        const res = fn.call(this, ev);
        if (res && typeof res.then === 'function') promises.push(res);
      }
      return Promise.all(promises);
    }

    click() {
      const ev = { type: 'click', target: this, defaultPrevented: false, preventDefault: () => {} };
      if (typeof this.onclick === 'function') this.onclick(ev);
      return this.dispatchEvent(ev);
    }

    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }

    closest(sel) {
      let curr = this;
      while (curr) {
        if (curr.tagName) {
          if (sel.startsWith('.') && curr.classList && curr.classList.contains(sel.slice(1))) return curr;
          if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
          if (curr.tagName.toLowerCase() === sel.toLowerCase()) return curr;
        }
        curr = curr.parentNode;
      }
      return null;
    }

    querySelectorAll(sel) {
      const results = [];
      const seen = new Set();
      const match = (el) => {
        if (!el || !el.tagName) return false;
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        if (sel.startsWith('.')) {
          const className = sel.split('[')[0].slice(1);
          const hasClass = el.classList && el.classList.contains(className);
          if (!hasClass) return false;
          if (sel.includes('[') && sel.includes(']')) {
            const attrMatches = [...sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
            return attrMatches.every(m => {
              const attr = m[1];
              const val = m[2];
              return val !== undefined ? el.getAttribute(attr) === val : el.hasAttribute(attr);
            });
          }
          return true;
        }
        if (sel.includes('[') && sel.includes(']')) {
          const attrMatches = [...sel.matchAll(/([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
          if (attrMatches.length > 0) {
            return attrMatches.every(m => {
              const attr = m[1];
              const val = m[2];
              if (val !== undefined) return el.getAttribute(attr) === val;
              return el.hasAttribute(attr);
            });
          }
        }
        return el.tagName.toLowerCase() === sel.toLowerCase();
      };
      const traverse = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        if (match(node)) results.push(node);
        if (node.childNodes) {
          for (const c of node.childNodes) traverse(c);
        }
      };
      for (const c of this.childNodes) traverse(c);
      for (const el of Object.values(elementMap)) {
        if (!seen.has(el) && match(el)) {
          seen.add(el);
          results.push(el);
        }
      }
      return results;
    }

    _parseChildIds(html) {
      const tagMatches = html.matchAll(/<([a-zA-Z0-9-]+)([^>]*)>/g);
      for (const m of tagMatches) {
        const tag = m[1];
        if (tag.startsWith('/')) continue;
        const attrsStr = m[2];
        const idMatch = attrsStr.match(/\sid=["']([^"']+)["']/);
        const id = idMatch ? idMatch[1] : '';
        let el = id ? elementMap[id] : null;
        if (!el) {
          el = new MockElement(tag, id);
          if (id) elementMap[id] = el;
        }
        const attrPairs = attrsStr.matchAll(/([a-zA-Z0-9_-]+)=["']([^"']*)["']/g);
        for (const a of attrPairs) {
          el.setAttribute(a[1], a[2]);
          if (a[1] === 'class') el.className = a[2];
          if (a[1] === 'value') el._value = a[2];
          if (a[1] === 'style') {
            a[2].split(';').forEach(rule => {
              const colonIdx = rule.indexOf(':');
              if (colonIdx !== -1) {
                const k = rule.slice(0, colonIdx).trim();
                const v = rule.slice(colonIdx + 1).trim();
                if (k) el.style[k] = v;
              }
            });
          }
        }
        if (!this.childNodes.includes(el)) {
          this.childNodes.push(el);
          el.parentNode = this;
        }
      }
    }
  }

  const appShell = new MockElement('DIV', 'app-shell');
  const loadingOverlay = new MockElement('DIV', 'loading-overlay');
  const loadingP = new MockElement('P');
  loadingOverlay.appendChild(loadingP);
  elementMap['app-shell'] = appShell;
  elementMap['loading-overlay'] = loadingOverlay;

  const mockDoc = {
    getElementById: (id) => elementMap[id] || null,
    querySelector: (sel) => {
      if (sel.startsWith('#')) return elementMap[sel.slice(1)] || null;
      return appShell.querySelector(sel);
    },
    querySelectorAll: (sel) => appShell.querySelectorAll(sel),
    createElement: (tag) => new MockElement(tag),
    body: new MockElement('BODY'),
    head: new MockElement('HEAD')
  };

  const mockWindow = {
    location: {
      search: options.search || '',
      href: 'daily-log.html'
    }
  };

  global.document = mockDoc;
  global.window = mockWindow;
  global.URLSearchParams = function(search) {
    const params = new Map();
    const query = (search || '').replace(/^\?/, '');
    if (query) {
      query.split('&').forEach(part => {
        const [k, v] = part.split('=');
        params.set(decodeURIComponent(k), decodeURIComponent(v || ''));
      });
    }
    return {
      get: (k) => params.get(k) || null,
      has: (k) => params.has(k)
    };
  };

  global.Litepicker = function(cfg) {
    this.cfg = cfg;
  };

  const calls = {
    addLogs: [],
    updateLogGroup: [],
    addTaskProgress: []
  };

  global.Utils = {
    renderShell: (activePage, pageTitle) => {
      const pageContent = new MockElement('DIV', 'page-content');
      appShell.appendChild(pageContent);
    },
    escapeHtml: (str) => String(str ?? '').replace(/[&<>"']/g, ''),
    money: (val) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    toInputDate: (dateStr) => {
      if (!dateStr) return '';
      const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : dateStr;
    },
    toast: () => {},
    animateProgress: async (btn, promise) => await promise,
    errorBanner: (msg) => {
      const el = new MockElement('DIV');
      el.textContent = msg;
      return el;
    },
    compressImage: async (f) => 'data:image/jpeg;base64,mock'
  };

  const sampleTasks = options.tasks || [
    {
      id: 101,
      task_code: 'TSK-001',
      title: 'เทพื้นคอนกรีต',
      site: 'โครงการ A',
      progress_percent: 40,
      ordered_by: 'คุณสมชาย',
      location_detail: 'โซนหน้าบ้าน',
      status: 'In Progress'
    },
    {
      id: 102,
      task_code: 'TSK-002',
      title: 'งานโครงหลังคา',
      site: 'โครงการ B',
      progress_percent: 15,
      ordered_by: 'วิศวกรวิชัย',
      location_detail: 'อาคาร 1',
      status: 'Pending'
    }
  ];

  global.Api = {
    getWorkers: async () => [
      { ID: 1, FullName: 'สมศักดิ์', DailyWage: 500, Status: 'Active' },
      { ID: 2, FullName: 'เฟิร์น', DailyWage: 450, Status: 'Active' }
    ],
    getSiteHistory: async () => ['โครงการ A', 'โครงการ B'],
    getRequesterHistory: async () => ['คุณสมชาย', 'วิศวกรวิชัย'],
    getTasks: async (filter = {}) => {
      if (filter.status === 'Active' || filter.excludeCompleted) {
        return sampleTasks.filter(t => t.status !== 'Completed');
      }
      return sampleTasks;
    },
    getTaskById: async (id) => {
      return (options.allTasks || sampleTasks).find(t => t.id === Number(id)) || null;
    },
    addLogs: async (payload) => {
      calls.addLogs.push(payload);
      return { ok: true, groupId: 'new-grp-uuid' };
    },
    updateLogGroup: async (payload) => {
      calls.updateLogGroup.push(payload);
      return { ok: true };
    },
    getLogGroup: async ({ groupId }) => {
      if (options.mockLogGroup) return options.mockLogGroup;
      return {
        groupId,
        date: '2026-11-07',
        site: 'โครงการ A',
        jobDetail: 'เทปูนพื้น',
        requestedBy: 'คุณสมชาย',
        taskId: 101,
        imageUrls: [],
        workers: [{ workerName: 'สมศักดิ์', hours: 8, wageType: 'hourly' }]
      };
    },
    addTaskProgress: async (taskId, progressInfo) => {
      calls.addTaskProgress.push({ taskId, progressInfo });
      return { ok: true };
    }
  };

  return { elementMap, calls, sampleTasks };
}

(async () => {
  try {
    // -------------------------------------------------------------
    // 2. Form Layout & Elements Test
    // -------------------------------------------------------------
    await runAsyncTest('Form layout must render #f-task selector and #task-update-section elements', async () => {
      const { elementMap } = setupMockDom();
      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 50));

      const fTask = elementMap['f-task'];
      assert(fTask, 'Element #f-task (<select>) must exist in layout');
      assert(fTask.tagName === 'SELECT', '#f-task must be a <select> element');

      const taskSection = elementMap['task-update-section'];
      assert(taskSection, 'Element #task-update-section must exist in layout');

      const progressInput = elementMap['f-task-progress'];
      assert(progressInput, 'Element #f-task-progress must exist inside #task-update-section');

      const issuesInput = elementMap['f-task-issues'];
      assert(issuesInput, 'Element #f-task-issues must exist inside #task-update-section');

      const resolutionInput = elementMap['f-task-resolution'];
      assert(resolutionInput, 'Element #f-task-resolution must exist inside #task-update-section');
    });

    // -------------------------------------------------------------
    // 3. Dropdown population & Auto-Fill Behavior Test
    // -------------------------------------------------------------
    await runAsyncTest('Selecting a task auto-fills site, detail, requester, and progress %', async () => {
      const { elementMap } = setupMockDom();
      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 50));

      const fTask = elementMap['f-task'];
      const taskSection = elementMap['task-update-section'];
      const fSite = elementMap['f-site'];
      const fDetail = elementMap['f-detail'];
      const fRequester = elementMap['f-requester'];
      const fProgress = elementMap['f-task-progress'];

      assert(fTask, '#f-task must be present');
      assert(taskSection.style.display === 'none' || taskSection.classList.contains('hidden'), 'Section should be hidden when no task selected');

      // Select task 101
      fTask.value = '101';
      fTask.dispatchEvent('change');

      assert(taskSection.style.display !== 'none' && !taskSection.classList.contains('hidden'), 'Section should be visible when task is selected');
      assert.strictEqual(fSite.value, 'โครงการ A', 'Site should be auto-filled with task site');
      assert(fDetail.value.includes('เทพื้นคอนกรีต'), 'Detail should contain task title');
      assert(fDetail.value.includes('โซนหน้าบ้าน'), 'Detail should contain location detail');
      assert.strictEqual(fRequester.value, 'คุณสมชาย', 'Requester should be auto-filled with ordered_by');
      assert.strictEqual(Number(fProgress.value), 40, 'Progress input should be pre-filled with task progress_percent');

      // Switch back to empty ("")
      fTask.value = '';
      fTask.dispatchEvent('change');
      assert(taskSection.style.display === 'none' || taskSection.classList.contains('hidden'), 'Section should be hidden again when task is deselected');
    });

    // -------------------------------------------------------------
    // 4. Form Submission with Task
    // -------------------------------------------------------------
    await runAsyncTest('Submitting form with selected task passes taskId to Api.addLogs and calls Api.addTaskProgress', async () => {
      const { elementMap, calls } = setupMockDom();
      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 50));

      const fTask = elementMap['f-task'];
      fTask.value = '101';
      fTask.dispatchEvent('change');

      const fProgress = elementMap['f-task-progress'];
      fProgress.value = '65';

      const fIssues = elementMap['f-task-issues'];
      fIssues.value = 'ปูนส่งช้ากว่ากำหนด 1 ชม.';

      const fResolution = elementMap['f-task-resolution'];
      fResolution.value = 'ปรับแผนเทโซนบ่ายแทน';

      // Toggle worker 1 so form validation passes
      const worker1Check = elementMap['worker-list'].querySelector('.worker-check[data-id="1"]');
      assert(worker1Check, 'worker-check for worker 1 should exist');
      worker1Check.click();

      // Submit form
      const logForm = elementMap['log-form'];
      await logForm.dispatchEvent('submit');

      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(calls.addLogs.length, 1, 'Api.addLogs should have been called once');
      const logPayload = calls.addLogs[0];
      assert.strictEqual(logPayload.taskId, 101, 'logPayload.taskId should be 101');

      assert.strictEqual(calls.addTaskProgress.length, 1, 'Api.addTaskProgress should have been called once');
      const progCall = calls.addTaskProgress[0];
      assert.strictEqual(progCall.taskId, 101, 'addTaskProgress taskId should be 101');
      assert.strictEqual(progCall.progressInfo.percent, 65, 'addTaskProgress percent should be 65');
      assert.strictEqual(progCall.progressInfo.issues, 'ปูนส่งช้ากว่ากำหนด 1 ชม.', 'addTaskProgress issues should match');
      assert.strictEqual(progCall.progressInfo.resolution, 'ปรับแผนเทโซนบ่ายแทน', 'addTaskProgress resolution should match');
    });

    // -------------------------------------------------------------
    // 5. Form Submission without Task
    // -------------------------------------------------------------
    await runAsyncTest('Submitting form without task passes taskId: null and does NOT call Api.addTaskProgress', async () => {
      const { elementMap, calls } = setupMockDom();
      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 50));

      const fTask = elementMap['f-task'];
      fTask.value = '';
      elementMap['f-site'].value = 'งานทั่วไป ซ่อมบำรุง';
      elementMap['f-detail'].value = 'เปลี่ยนหลอดไฟ';
      elementMap['f-requester'].value = 'หัวหน้าแดง';

      // Select worker 1
      const worker1Check = elementMap['worker-list'].querySelector('.worker-check[data-id="1"]');
      assert(worker1Check, 'worker-check for worker 1 should exist');
      worker1Check.click();

      const logForm = elementMap['log-form'];
      await logForm.dispatchEvent('submit');

      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(calls.addLogs.length, 1, 'Api.addLogs should be called');
      assert.strictEqual(calls.addLogs[0].taskId, null, 'taskId should be null');
      assert.strictEqual(calls.addTaskProgress.length, 0, 'Api.addTaskProgress should NOT be called when no task is selected');
    });

    // -------------------------------------------------------------
    // 6. Edit Mode (loadEditGroup) with Task
    // -------------------------------------------------------------
    await runAsyncTest('Edit mode with linked task restores task selection and reveals task section', async () => {
      const { elementMap } = setupMockDom({
        search: '?edit=grp-1',
        mockLogGroup: {
          groupId: 'grp-1',
          date: '2026-11-07',
          site: 'โครงการ A',
          jobDetail: 'เทปูนพื้น',
          requestedBy: 'คุณสมชาย',
          taskId: 101,
          imageUrls: [],
          workers: [{ workerName: 'สมศักดิ์', hours: 8, wageType: 'hourly' }]
        }
      });

      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 100));

      const fTask = elementMap['f-task'];
      assert(fTask, '#f-task must exist');
      assert.strictEqual(fTask.value, '101', '#f-task value should be restored to "101"');

      const taskSection = elementMap['task-update-section'];
      assert(taskSection.style.display !== 'none' && !taskSection.classList.contains('hidden'), 'Task update section should be visible in edit mode');
    });

    // -------------------------------------------------------------
    // 7. Edit Mode with Completed Task (included in dropdown)
    // -------------------------------------------------------------
    await runAsyncTest('Edit mode with a Completed task includes that task in dropdown options and keeps it selected', async () => {
      const completedTask = {
        id: 999,
        task_code: 'TSK-999',
        title: 'งานปูกระเบื้องแล้วเสร็จ',
        site: 'โครงการ C',
        progress_percent: 100,
        status: 'Completed',
        ordered_by: 'ผู้จัดการประหยัด'
      };

      const { elementMap } = setupMockDom({
        search: '?edit=grp-completed',
        allTasks: [completedTask],
        mockLogGroup: {
          groupId: 'grp-completed',
          date: '2026-11-07',
          site: 'โครงการ C',
          jobDetail: 'เก็บงาน',
          requestedBy: 'ผู้จัดการประหยัด',
          taskId: 999,
          imageUrls: [],
          workers: [{ workerName: 'สมศักดิ์', hours: 8, wageType: 'hourly' }]
        }
      });

      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 100));

      const fTask = elementMap['f-task'];
      assert(fTask, '#f-task must exist');
      assert.strictEqual(fTask.value, '999', '#f-task value should be "999" even if task status is Completed');
    });

    // -------------------------------------------------------------
    // 8. Auto-detail only includes changed sub-items with "คืบหน้า XX%(เดิม YY%)" and no "ทำได้ 0 (สะสม 0)"
    // -------------------------------------------------------------
    await runAsyncTest('Updating sub-item progress auto-fills ONLY changed sub-item with "คืบหน้า 50%(เดิม 10%)" without "ทำได้ 0 (สะสม 0)"', async () => {
      const taskWithSubs = {
        id: 505,
        task_code: 'TSK-505',
        title: 'งานเดินท่อ PE',
        site: 'หมู่บ้านริเวอร์ไซด์',
        progress_percent: 55,
        status: 'In Progress',
        ordered_by: 'เฮีย',
        sub_items: [
          { id: 's1', name: 'วางท่อช่วงสโมสร', status: 'Completed', progress_percent: 100, actual_qty: 0 },
          { id: 's2', name: 'วางท่อช่วงบ้าน A4', status: 'In Progress', progress_percent: 10, actual_qty: 0 }
        ]
      };

      const { elementMap, calls } = setupMockDom({
        tasks: [taskWithSubs]
      });

      const code = fs.readFileSync(jsPath, 'utf8');
      eval(code);

      await new Promise(r => setTimeout(r, 50));

      const fTask = elementMap['f-task'];
      const fDetail = elementMap['f-detail'];
      fTask.value = '505';
      fTask.dispatchEvent('change');

      // Before changing any sub-item, completed item s1 must NOT produce "ทำได้ 0 (สะสม 0)"
      assert(!fDetail.value.includes('ทำได้ 0'), 'Detail must NOT contain "ทำได้ 0"');

      // Clear detail (simulate worker leaving detail blank) and update sub-item index 1 (s2) from 10% to 50%
      fDetail.value = '';
      const subList = elementMap['task-subitems-log-list'];
      const pctInputs = subList.querySelectorAll('[data-sub-pct-idx]');
      const s2PctInput = pctInputs.find(el => el.getAttribute('data-sub-pct-idx') === '1');
      assert(s2PctInput, 'Should find progress_percent input for sub-item index 1');

      s2PctInput.value = '50';
      if (typeof s2PctInput.oninput === 'function') {
        s2PctInput.oninput();
      }

      assert(fDetail.value.includes('วางท่อช่วงบ้าน A4'), 'Detail must include changed sub-item name');
      assert(fDetail.value.includes('คืบหน้า 50%(เดิม 10%)'), 'Detail must include "คืบหน้า 50%(เดิม 10%)"');
      assert(!fDetail.value.includes('วางท่อช่วงสโมสร'), 'Detail must NOT include unchanged sub-item');
      assert(!fDetail.value.includes('ทำได้ 0'), 'Detail must NOT include "ทำได้ 0"');
    });

    console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
    if (passedTests !== totalTests) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Execution error:', err);
    process.exit(1);
  }
})();
