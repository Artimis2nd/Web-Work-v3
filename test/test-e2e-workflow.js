/**
 * End-to-End Workflow Verification Suite (Task 7)
 *
 * Verifies:
 * 1. Dashboard UI Integration:
 *    - #clear-logs-btn click handler prompts PIN (1225) & confirmation text ('ลบ')
 *    - Api.snapshotActiveTasksBeforeClear() is called BEFORE Api.clearAllLogs()
 *    - Cancelling PIN or confirmation prevents snapshot and clear
 * 2. Full End-to-End Lifecycle Simulation:
 *    - Worker creation (standard, exempt 'เฟิร์น', fixed-wage 'วิชัย ช่างปูน')
 *    - Task creation (Task A and Task B starting Pending at 0%)
 *    - Day 1: Multiple tasks in single day with 40% & 25% progress, auto In Progress transition, accurate cost split
 *    - Day 2: Progress to 80% with issue/resolution, fixed wage worker (1.0 man-day), chronological history
 *    - Wage Cycle Purge: snapshotActiveTasksBeforeClear() accumulates cost/hours/man-days/days, clearAllLogs() wipes daily_logs
 *    - Day 3 (New Cycle): Additional log on Task A, reaching 100% progress, verifies task stays In Progress until supervisor signs off
 *    - Supervisor Sign-off: Updates task to Completed with completion summary
 *    - Final Cost Report Verification: getTaskCostSummary accurately aggregates Cycle 1 (accumulated) + Cycle 2 (current)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('================================================================');
console.log('Running End-to-End Workflow & Dashboard Verification (Task 7)...');
console.log('================================================================\n');

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

// -----------------------------------------------------------------------------
// Part 1: Syntax check of dashboard.js
// -----------------------------------------------------------------------------
const dashboardJsPath = path.resolve(__dirname, '../assets/js/pages/dashboard.js');

it('assets/js/pages/dashboard.js should exist and pass syntax validation', () => {
  assert(fs.existsSync(dashboardJsPath), 'assets/js/pages/dashboard.js must exist');
  execSync(`node -c "${dashboardJsPath}"`, { stdio: 'pipe' });
});

// -----------------------------------------------------------------------------
// Part 2: Dashboard UI Integration Test (Purge with Snapshot)
// -----------------------------------------------------------------------------
function setupDashboardDom() {
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
      this.disabled = false;
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

    remove() {
      if (this.parentNode && this.parentNode.childNodes) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx !== -1) this.parentNode.childNodes.splice(idx, 1);
      }
      if (this.id && elementMap[this.id] === this) {
        delete elementMap[this.id];
      }
    }

    addEventListener(event, fn) {
      if (!this.eventListeners[event]) this.eventListeners[event] = [];
      this.eventListeners[event].push(fn);
    }

    async dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const fns = this.eventListeners[type] || [];
      const ev = typeof event === 'object' ? event : { type, target: this, defaultPrevented: false, preventDefault: () => {} };
      for (const fn of fns) {
        await fn.call(this, ev);
      }
    }

    async click() {
      const ev = { type: 'click', target: this, defaultPrevented: false, preventDefault: () => {} };
      if (typeof this.onclick === 'function') {
        await this.onclick(ev);
      }
      await this.dispatchEvent(ev);
    }

    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }

    querySelectorAll(sel) {
      const results = [];
      const seen = new Set();
      const match = (el) => {
        if (!el || !el.tagName) return false;
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        if (sel.startsWith('.')) return el.classList && el.classList.contains(sel.slice(1));
        if (sel.includes('[') && sel.includes(']')) {
          const attrMatches = [...sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
          if (attrMatches.length > 0) {
            return attrMatches.every(m => {
              const attr = m[1];
              const val = m[2];
              return val !== undefined ? el.getAttribute(attr) === val : el.hasAttribute(attr);
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
        }
      }
    }
  }

  const appShell = new MockElement('DIV', 'app-shell');
  const pageContent = new MockElement('DIV', 'page-content');
  appShell.appendChild(pageContent);

  const mockDoc = {
    getElementById: (id) => elementMap[id] || null,
    querySelector: (sel) => appShell.querySelector(sel),
    querySelectorAll: (sel) => appShell.querySelectorAll(sel),
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {},
    body: appShell
  };

  const store = {};
  const mockLocalStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };

  return { elementMap, appShell, pageContent, mockDoc, mockLocalStorage };
}

async function runAllTests() {
  await runAsyncTest('Dashboard UI: #clear-logs-btn should call Api.snapshotActiveTasksBeforeClear() BEFORE Api.clearAllLogs()', async () => {
    const { mockDoc, mockLocalStorage } = setupDashboardDom();

    global.document = mockDoc;
    global.localStorage = mockLocalStorage;

    const promptAnswers = ['1225', 'ลบ'];
    let promptIndex = 0;
    global.prompt = (msg) => {
      return promptAnswers[promptIndex++] ?? null;
    };

    global.confirm = () => true;

    const executionLog = [];

    const mockApi = {
      getDashboard: async () => ({
        totalWorkers: 5,
        totalLogGroups: 3,
        totalNormalWage: 5000,
        totalFixedWage: 1000,
        recentGroups: [
          {
            groupId: 'grp-001',
            date: '2026-11-01',
            site: 'ไซต์สุขุมวิท',
            jobDetail: 'เทพื้นคอนกรีต',
            workerCount: 2,
            totalNormal: 2000,
            totalFixed: 0,
            requestedBy: 'คุณสมศักดิ์'
          }
        ]
      }),
      snapshotActiveTasksBeforeClear: async () => {
        executionLog.push('snapshotActiveTasksBeforeClear');
        return { updatedCount: 2 };
      },
      clearAllLogs: async () => {
        executionLog.push('clearAllLogs');
        return { deletedCount: 3 };
      }
    };

    global.Api = mockApi;
    global.window = {
      Api: mockApi,
      WAGE_API: mockApi,
      location: { href: '' }
    };

    global.Utils = {
      renderShell: () => {},
      escapeHtml: (s) => String(s ?? ''),
      formatDate: (d) => String(d ?? ''),
      money: (m) => String(m ?? 0),
      verifyPin: (msg) => {
        const pin = global.prompt(msg || 'PIN:');
        return pin === '1225';
      },
      skeletonRows: (count, cols) => '<tr><td>skeleton</td></tr>',
      toast: () => {},
      animateProgress: async (btn, promise, initialMsg, successMsg) => {
        return await promise;
      },
      errorBanner: (m) => new MockElement('DIV')
    };

    // Load and execute dashboard.js
    const dashboardCode = fs.readFileSync(dashboardJsPath, 'utf8');
    eval(dashboardCode);

    // Wait for initial load()
    await new Promise(resolve => setTimeout(resolve, 50));

    const clearBtn = mockDoc.getElementById('clear-logs-btn');
    assert(clearBtn, '#clear-logs-btn must be rendered on the dashboard');

    // Trigger the clear button click
    await clearBtn.click();

    // Give promises a tick to resolve
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.strictEqual(
      executionLog.length,
      2,
      `Expected 2 API calls on clear, got ${executionLog.length}: [${executionLog.join(', ')}]`
    );
    assert.strictEqual(
      executionLog[0],
      'snapshotActiveTasksBeforeClear',
      'Api.snapshotActiveTasksBeforeClear() must be called FIRST before clearAllLogs()'
    );
    assert.strictEqual(
      executionLog[1],
      'clearAllLogs',
      'Api.clearAllLogs() must be called SECOND after snapshotActiveTasksBeforeClear()'
    );
  });

  await runAsyncTest('Dashboard UI: Cancelling PIN or confirmation should NOT trigger snapshot or clear', async () => {
    const { mockDoc, mockLocalStorage } = setupDashboardDom();

    global.document = mockDoc;
    global.localStorage = mockLocalStorage;

    let executionLog = [];
    const mockApi = {
      getDashboard: async () => ({
        totalWorkers: 1,
        totalLogGroups: 1,
        totalNormalWage: 500,
        totalFixedWage: 0,
        recentGroups: []
      }),
      snapshotActiveTasksBeforeClear: async () => {
        executionLog.push('snapshot');
        return { updatedCount: 0 };
      },
      clearAllLogs: async () => {
        executionLog.push('clear');
        return { deletedCount: 0 };
      }
    };

    global.Api = mockApi;
    global.window = { Api: mockApi, WAGE_API: mockApi };
    global.Utils = {
      renderShell: () => {},
      escapeHtml: (s) => String(s ?? ''),
      formatDate: (d) => String(d ?? ''),
      money: (m) => String(m ?? 0),
      skeletonRows: (count, cols) => '<tr><td>skeleton</td></tr>',
      verifyPin: () => false, // Cancelled or wrong PIN
      toast: () => {},
      animateProgress: async (b, p) => await p,
      errorBanner: (m) => new MockElement('DIV')
    };

    const dashboardCode = fs.readFileSync(dashboardJsPath, 'utf8');
    eval(dashboardCode);
    await new Promise(r => setTimeout(r, 50));

    const clearBtn = mockDoc.getElementById('clear-logs-btn');
    await clearBtn.click();
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(executionLog.length, 0, 'No API should be called if PIN check fails');

    // Next: PIN passes, but confirmation text is wrong
    global.Utils.verifyPin = () => true;
    global.prompt = () => 'ไม่ใช่คำว่าลบ';

    await clearBtn.click();
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(executionLog.length, 0, 'No API should be called if confirmation text is wrong');
  });

  // -----------------------------------------------------------------------------
  // Part 3: Full End-to-End Lifecycle Simulation (Real API + Config + Utils)
  // -----------------------------------------------------------------------------
  await runAsyncTest('E2E Lifecycle: Multi-day, Multi-task, Wage Cycle Purge & Cost Summary Verification', async () => {
  // 1. Fresh LocalStorage & Environment
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };

  global.window = {
    WAGE_CONFIG: {
      MARKUP_RATE: 1.2,
      HOURLY_DIVISOR: 8,
      EXEMPT_WORKER: 'เฟิร์น'
    }
  };

  // Load real api.js
  const apiPath = path.resolve(__dirname, '../assets/js/api.js');
  const apiCode = fs.readFileSync(apiPath, 'utf8');
  eval(apiCode);

  const API = global.window.WAGE_API || global.Api;
  assert(API, 'Real API must be loaded');

  // Step 1: Create Workers
  console.log('  -> Step 1: Creating workers (สมชาย, เฟิร์น, วิชัย)...');
  const w1 = await API.addWorker({ fullName: 'สมชาย ใจดี', dailyWage: 500 });
  const w2 = await API.addWorker({ fullName: 'เฟิร์น', dailyWage: 600 });
  const w3 = await API.addWorker({ fullName: 'วิชัย ช่างปูน', dailyWage: 0 });

  const allWorkers = await API.getWorkers();
  assert(allWorkers.some(w => (w.FullName || w.full_name) === 'สมชาย ใจดี'), 'สมชาย must exist');
  assert(allWorkers.some(w => (w.FullName || w.full_name) === 'เฟิร์น'), 'เฟิร์น must exist');
  assert(allWorkers.some(w => (w.FullName || w.full_name) === 'วิชัย ช่างปูน'), 'วิชัย ช่างปูน must exist');

  // Step 2: Create 2 Tasks
  console.log('  -> Step 2: Creating Task A and Task B...');
  const taskA = await API.createTask({
    title: 'งานเทพื้นคอนกรีตโซนหน้า',
    site: 'ไซต์สุขุมวิท',
    location_detail: 'ลานจอดรถ',
    assigned_to: 'สมชาย ใจดี',
    ordered_by: 'วิศวกรสมศักดิ์',
    order_date: '2026-11-01',
    due_date: '2026-11-05',
    description: 'งานเทพื้นคอนกรีตความหนา 10 ซม.'
  });

  const taskB = await API.createTask({
    title: 'งานก่ออิฐมวลเบาชั้น 2',
    site: 'ไซต์สุขุมวิท',
    location_detail: 'อาคาร A ชั้น 2',
    assigned_to: 'สมชาย ใจดี',
    ordered_by: 'วิศวกรสมศักดิ์',
    order_date: '2026-11-01',
    due_date: '2026-11-05',
    description: 'ก่อผนังอิฐมวลเบาชั้น 2'
  });

  assert.strictEqual(taskA.status, 'Pending', 'Task A initial status must be Pending');
  assert.strictEqual(taskA.progress_percent, 0, 'Task A initial progress must be 0');
  assert.strictEqual(taskB.status, 'Pending', 'Task B initial status must be Pending');
  assert.strictEqual(taskB.progress_percent, 0, 'Task B initial progress must be 0');

  // Step 3: Day 1 (Multiple tasks on same day - 2026-11-01)
  console.log('  -> Step 3: Day 1 (Morning Task A, Afternoon Task B)...');
  // Morning Daily Log on Task A: 4 hours for สมชาย (500/day) & เฟิร์น (600/day)
  await API.addLogs({
    date: '2026-11-01',
    site: 'ไซต์สุขุมวิท',
    jobDetail: 'เทพื้นคอนกรีตโซนหน้า ช่วงเช้า',
    requestedBy: 'วิศวกรสมศักดิ์',
    taskId: taskA.id,
    workers: [
      { workerName: 'สมชาย ใจดี', dailyWage: 500, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 },
      { workerName: 'เฟิร์น', dailyWage: 600, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 }
    ]
  });
  await API.addTaskProgress(taskA.id, {
    percent: 40,
    date: '2026-11-01',
    note: 'เทพื้นเสร็จ 40%'
  });

  // Afternoon Daily Log on Task B: 4 hours for สมชาย & เฟิร์น
  await API.addLogs({
    date: '2026-11-01',
    site: 'ไซต์สุขุมวิท',
    jobDetail: 'ก่ออิฐมวลเบาชั้น 2 ช่วงบ่าย',
    requestedBy: 'วิศวกรสมศักดิ์',
    taskId: taskB.id,
    workers: [
      { workerName: 'สมชาย ใจดี', dailyWage: 500, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 },
      { workerName: 'เฟิร์น', dailyWage: 600, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 }
    ]
  });
  await API.addTaskProgress(taskB.id, {
    percent: 25,
    date: '2026-11-01',
    note: 'ก่อผนังเสร็จ 25%'
  });

  // Verify transitions and Day 1 cost split
  const taskA_day1 = await API.getTaskById(taskA.id);
  const taskB_day1 = await API.getTaskById(taskB.id);
  assert.strictEqual(taskA_day1.status, 'In Progress', 'Task A must auto-transition to In Progress');
  assert.strictEqual(taskA_day1.progress_percent, 40, 'Task A progress must be 40%');
  assert.strictEqual(taskB_day1.status, 'In Progress', 'Task B must auto-transition to In Progress');
  assert.strictEqual(taskB_day1.progress_percent, 25, 'Task B progress must be 25%');

  const costA_day1 = await API.getTaskCostSummary(taskA.id);
  const costB_day1 = await API.getTaskCostSummary(taskB.id);

  // สมชาย: 4h * (500/8) = 250 raw, markup = 250 * 1.2 = 300, man-day = 0.5
  // เฟิร์น: 4h * (600/8) = 300 raw, markup = 300 (exempt), man-day = 0.5
  // Subtotal per task: raw = 550, markup = 600, hours = 8, man-days = 1.0, daysWorked = 1
  assert.strictEqual(costA_day1.currentSummary.rawCost, 550, 'Task A Day 1 raw cost must be 550');
  assert.strictEqual(costA_day1.currentSummary.markupCost, 600, 'Task A Day 1 markup cost must be 600');
  assert.strictEqual(costA_day1.currentSummary.hours, 8, 'Task A Day 1 hours must be 8');
  assert.strictEqual(costA_day1.currentSummary.manDays, 1.0, 'Task A Day 1 man-days must be 1.0');
  assert.strictEqual(costA_day1.currentSummary.daysWorked, 1, 'Task A Day 1 days worked must be 1');

  assert.strictEqual(costB_day1.currentSummary.rawCost, 550, 'Task B Day 1 raw cost must be 550');
  assert.strictEqual(costB_day1.currentSummary.markupCost, 600, 'Task B Day 1 markup cost must be 600');

  // Step 4: Day 2 (Progress + Issue + Fixed Wage - 2026-11-02)
  console.log('  -> Step 4: Day 2 (Task A 8h สมชาย + 1000 THB fixed wage วิชัย + Issue)...');
  await API.addLogs({
    date: '2026-11-02',
    site: 'ไซต์สุขุมวิท',
    jobDetail: 'เทพื้นคอนกรีตช่วงที่สองและงานระบบท่อ',
    requestedBy: 'วิศวกรสมศักดิ์',
    taskId: taskA.id,
    workers: [
      { workerName: 'สมชาย ใจดี', dailyWage: 500, wageType: 'hourly', hours: 8, otHours: 0, fixedAmount: 0 },
      { workerName: 'วิชัย ช่างปูน', dailyWage: 0, wageType: 'fixed', hours: 0, otHours: 0, fixedAmount: 1000 }
    ]
  });

  await API.addTaskProgress(taskA.id, {
    percent: 80,
    date: '2026-11-02',
    issues: 'ท่อประปาเดิมรั่วซึม',
    resolution: 'ปิดวาล์วและต่อท่อพีวีซีใหม่',
    by: 'สมชาย'
  });

  const taskA_day2 = await API.getTaskById(taskA.id);
  assert.strictEqual(taskA_day2.progress_percent, 80, 'Task A progress must be 80%');
  assert.strictEqual(taskA_day2.issues, 'ท่อประปาเดิมรั่วซึม');
  assert.strictEqual(taskA_day2.resolution, 'ปิดวาล์วและต่อท่อพีวีซีใหม่');
  assert.strictEqual(taskA_day2.progress_history.length, 2, 'Task A must have 2 history entries');
  assert.strictEqual(taskA_day2.progress_history[0].percent, 40);
  assert.strictEqual(taskA_day2.progress_history[1].percent, 80);
  assert.strictEqual(taskA_day2.progress_history[1].issues, 'ท่อประปาเดิมรั่วซึม');

  const costA_cycle1 = await API.getTaskCostSummary(taskA.id);
  // Day 1: 550 raw, 600 markup, 8h, 1.0 man-day
  // Day 2: สมชาย 8h @ 500 = 500 raw, 600 markup, 1.0 man-day
  //        วิชัย fixed 1000 = 1000 raw, 1000 markup, 1.0 man-day, 0 hours
  // Day 2 subtotal: 1500 raw, 1600 markup, 8h, 2.0 man-days
  // Cycle 1 total: raw = 2050, markup = 2200, hours = 16, man-days = 3.0, daysWorked = 2
  assert.strictEqual(costA_cycle1.currentSummary.daysWorked, 2, 'Task A Cycle 1 days worked must be 2');
  assert.strictEqual(costA_cycle1.currentSummary.hours, 16, 'Task A Cycle 1 hours must be 16');
  assert.strictEqual(costA_cycle1.currentSummary.manDays, 3.0, 'Task A Cycle 1 man-days must be 3.0');
  assert.strictEqual(costA_cycle1.currentSummary.rawCost, 2050, 'Task A Cycle 1 raw cost must be 2050');
  assert.strictEqual(costA_cycle1.currentSummary.markupCost, 2200, 'Task A Cycle 1 markup cost must be 2200');

  // Step 5: Wage Cycle Purge ("เบิกงวด / ล้างบันทึก")
  console.log('  -> Step 5: Wage Cycle Purge (snapshotActiveTasksBeforeClear + clearAllLogs)...');
  const snapshotRes = await API.snapshotActiveTasksBeforeClear();
  assert(snapshotRes.updatedCount >= 2, 'Both Task A and Task B must be snapshotted');

  await API.clearAllLogs();

  const remainingLogs = await API.getLogs();
  assert.strictEqual(remainingLogs.logs.length, 0, 'daily_logs must be completely cleared');
  const rawLogs = JSON.parse(global.localStorage.getItem('WAGE_LOCAL_LOGS') || '[]');
  assert.strictEqual(rawLogs.length, 0, 'raw daily_logs in storage must be empty');

  // Verify accumulated fields on Task A and Task B
  const taskA_purged = await API.getTaskById(taskA.id);
  const taskB_purged = await API.getTaskById(taskB.id);

  assert.strictEqual(taskA_purged.accumulated_days, 2, 'Task A accumulated_days must be 2');
  assert.strictEqual(taskA_purged.accumulated_hours, 16, 'Task A accumulated_hours must be 16');
  assert.strictEqual(taskA_purged.accumulated_man_days, 3.0, 'Task A accumulated_man_days must be 3.0');
  assert.strictEqual(taskA_purged.accumulated_cost, 2050, 'Task A accumulated_cost must be 2050');
  assert.strictEqual(taskA_purged.accumulated_markup_cost, 2200, 'Task A accumulated_markup_cost must be 2200');

  assert.strictEqual(taskB_purged.accumulated_days, 1, 'Task B accumulated_days must be 1');
  assert.strictEqual(taskB_purged.accumulated_hours, 8, 'Task B accumulated_hours must be 8');
  assert.strictEqual(taskB_purged.accumulated_man_days, 1.0, 'Task B accumulated_man_days must be 1.0');
  assert.strictEqual(taskB_purged.accumulated_cost, 550, 'Task B accumulated_cost must be 550');
  assert.strictEqual(taskB_purged.accumulated_markup_cost, 600, 'Task B accumulated_markup_cost must be 600');

  // Step 6: Post-Purge Cycle (Day 3 - 2026-11-03)
  console.log('  -> Step 6: Post-Purge Cycle (Day 3 log, 100% progress, supervisor sign-off)...');
  await API.addLogs({
    date: '2026-11-03',
    site: 'ไซต์สุขุมวิท',
    jobDetail: 'เก็บความเรียบร้อยผิวคอนกรีต',
    requestedBy: 'วิศวกรสมศักดิ์',
    taskId: taskA.id,
    workers: [
      { workerName: 'สมชาย ใจดี', dailyWage: 500, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 }
    ]
  });

  await API.addTaskProgress(taskA.id, {
    percent: 100,
    date: '2026-11-03',
    note: 'เก็บงานเรียบร้อย รอวิศวกรตรวจรับ'
  });

  const taskA_100 = await API.getTaskById(taskA.id);
  assert.strictEqual(taskA_100.progress_percent, 100, 'Progress must be 100%');
  assert.strictEqual(
    taskA_100.status,
    'In Progress',
    'Task must remain In Progress at 100% until explicit supervisor sign-off'
  );

  // Supervisor Sign-off
  await API.updateTask(taskA.id, {
    status: 'Completed',
    progress_percent: 100,
    completion_summary: 'เทพื้นเรียบร้อย ตรวจสอบระดับผ่าน 100%'
  });

  const taskA_completed = await API.getTaskById(taskA.id);
  assert.strictEqual(taskA_completed.status, 'Completed', 'Task status must now be Completed');
  assert.strictEqual(taskA_completed.completion_summary, 'เทพื้นเรียบร้อย ตรวจสอบระดับผ่าน 100%');

  // Step 7: Final Cost Report Verification (getTaskCostSummary)
  console.log('  -> Step 7: Final Cost Report Verification...');
  const finalSummary = await API.getTaskCostSummary(taskA.id);

  // Accumulated Summary (Cycle 1):
  assert.strictEqual(finalSummary.accumulatedSummary.daysWorked, 2);
  assert.strictEqual(finalSummary.accumulatedSummary.hours, 16);
  assert.strictEqual(finalSummary.accumulatedSummary.manDays, 3.0);
  assert.strictEqual(finalSummary.accumulatedSummary.rawCost, 2050);
  assert.strictEqual(finalSummary.accumulatedSummary.markupCost, 2200);

  // Current Summary (Cycle 2 - Day 3):
  // สมชาย: 4h @ 500 = 250 raw, 300 markup (250*1.2), 0.5 man-day, 4h, 1 day
  assert.strictEqual(finalSummary.currentSummary.daysWorked, 1);
  assert.strictEqual(finalSummary.currentSummary.hours, 4);
  assert.strictEqual(finalSummary.currentSummary.manDays, 0.5);
  assert.strictEqual(finalSummary.currentSummary.rawCost, 250);
  assert.strictEqual(finalSummary.currentSummary.markupCost, 300);

  // Total Summary (Cycle 1 + Cycle 2):
  // Total Days Worked: 2 + 1 = 3 days
  // Total Hours: 16 + 4 = 20 hours
  // Total Man-Days: 3.0 + 0.5 = 3.5 man-days
  // Total Raw Cost: 2050 + 250 = 2300 THB
  // Total Markup Cost: 2200 + 300 = 2500 THB
  assert.strictEqual(finalSummary.totalSummary.daysWorked, 3, 'Total days worked must be 3');
  assert.strictEqual(finalSummary.totalSummary.hours, 20, 'Total hours must be 20');
  assert.strictEqual(finalSummary.totalSummary.manDays, 3.5, 'Total man-days must be 3.5');
  assert.strictEqual(finalSummary.totalSummary.rawCost, 2300, 'Total raw cost must be 2,300 THB');
  assert.strictEqual(finalSummary.totalSummary.markupCost, 2500, 'Total markup cost must be 2,500 THB');

  // Verify Worker Breakdown for Cycle 2
  assert.strictEqual(finalSummary.workerBreakdown.length, 1);
  const wSomchai = finalSummary.workerBreakdown[0];
  assert.strictEqual(wSomchai.worker_name, 'สมชาย ใจดี');
  assert.strictEqual(wSomchai.hours, 4);
  assert.strictEqual(wSomchai.man_days, 0.5);
  assert.strictEqual(wSomchai.raw_wage, 250);
  assert.strictEqual(wSomchai.markup_wage, 300);
  });

  // Summary reporting
  console.log('\n========================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  if (passedTests === totalTests) {
    console.log('All E2E workflow tests passed successfully!');
    console.log('========================================\n');
  } else {
    console.error(`FAILED: ${totalTests - passedTests} tests failed.`);
    console.log('========================================\n');
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Unexpected error running test suite:', err);
  process.exit(1);
});
