/**
 * Test Suite for Task Costing & Effort Summary Report (Task 6)
 *
 * Verifies:
 * 1. task-cost-report.html structure, meta tags, and script dependencies.
 * 2. assets/js/pages/task-cost-report.js syntax and executable validity.
 * 3. Control bar rendering: task selector, back to tasks link, print button.
 * 4. Automatic task selection via URL parameters (?task_id= or ?taskId=).
 * 5. Task metadata header rendering (task_code, title, site, dates, status badge, progress bar, issues, completion summary).
 * 6. 4 KPI cards rendering (Actual Working Days, Total Man-Days / Total Hours, Raw Labor Cost, Total with Markup).
 * 7. Accumulated snapshot breakdown banner (for tasks with previous period carry-over).
 * 8. Worker breakdown table with worker rows and totals.
 * 9. Daily logs history table.
 * 10. Progress and issue timeline section.
 * 11. Print action trigger (window.print).
 * 12. Dynamic task switching via dropdown selector.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Testing Task Costing & Effort Summary Report (Task 6)...\n');

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

// -------------------------------------------------------------
// 1. File Structure & HTML Shell Tests
// -------------------------------------------------------------
const reportHtmlPath = path.resolve(__dirname, '../task-cost-report.html');
const reportJsPath = path.resolve(__dirname, '../assets/js/pages/task-cost-report.js');

it('task-cost-report.html should exist and contain required markup, styles, and scripts', () => {
  assert(fs.existsSync(reportHtmlPath), 'task-cost-report.html file must exist');
  const html = fs.readFileSync(reportHtmlPath, 'utf8');

  assert(html.includes('<!DOCTYPE html>'), 'task-cost-report.html must be valid HTML5');
  assert(html.includes('id="app-shell"'), 'task-cost-report.html must contain #app-shell div');
  assert(html.includes('assets/css/style.css'), 'task-cost-report.html must include style.css');
  assert(html.includes('assets/js/config.js'), 'task-cost-report.html must load config.js');
  assert(html.includes('assets/js/api.js'), 'task-cost-report.html must load api.js');
  assert(html.includes('assets/js/utils.js'), 'task-cost-report.html must load utils.js');
  assert(html.includes('assets/js/pages/task-cost-report.js'), 'task-cost-report.html must load pages/task-cost-report.js');
  assert(html.includes('@media print'), 'task-cost-report.html must include print styles');
});

it('assets/js/pages/task-cost-report.js should exist and pass syntax validation', () => {
  assert(fs.existsSync(reportJsPath), 'assets/js/pages/task-cost-report.js must exist');
  execSync(`node -c "${reportJsPath}"`, { stdio: 'pipe' });
});

// -------------------------------------------------------------
// Helper: Mock DOM Environment for task-cost-report.js execution
// -------------------------------------------------------------
function setupMockDom(urlSearch = '?task_id=1') {
  const listeners = {};
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

    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      const fns = this.eventListeners[type] || [];
      const ev = typeof event === 'object' ? event : { type, target: this, defaultPrevented: false, preventDefault: () => {} };
      for (const fn of fns) {
        fn.call(this, ev);
      }
    }

    click() {
      const ev = { type: 'click', target: this, defaultPrevented: false, preventDefault: () => {} };
      if (typeof this.onclick === 'function') {
        this.onclick(ev);
      }
      this.dispatchEvent(ev);
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
      const tagRegex = /<([a-zA-Z0-9-]+)([^>]*?\sid=["']([^"']+)["'][^>]*)>/g;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        const tag = m[1];
        const attrsStr = m[2];
        const id = m[3];
        const afterOpenTagIdx = m.index + m[0].length;

        let el = elementMap[id];
        if (!el) {
          el = new MockElement(tag, id);
          elementMap[id] = el;
        }

        const attrPairs = attrsStr.matchAll(/([a-zA-Z0-9_-]+)=["']([^"']*)["']/g);
        for (const a of attrPairs) {
          el.setAttribute(a[1], a[2]);
          if (a[1] === 'class') el.className = a[2];
          if (a[1] === 'value') el._value = a[2];
        }

        // Find balanced closing tag
        const openTag = `<${tag}`;
        const closeTag = `</${tag}>`;
        let depth = 1;
        let idx = afterOpenTagIdx;
        let innerContent = '';

        while (depth > 0 && idx < html.length) {
          const nextOpen = html.indexOf(openTag, idx);
          const nextClose = html.indexOf(closeTag, idx);
          if (nextClose === -1) break;

          if (nextOpen !== -1 && nextOpen < nextClose) {
            const charAfter = html[nextOpen + openTag.length];
            if (charAfter === ' ' || charAfter === '>' || charAfter === '/') {
              depth++;
            }
            idx = nextOpen + openTag.length;
          } else {
            depth--;
            if (depth === 0) {
              innerContent = html.substring(afterOpenTagIdx, nextClose);
              break;
            }
            idx = nextClose + closeTag.length;
          }
        }

        if (innerContent) {
          el._innerHTML = innerContent;
          el._textContent = innerContent.replace(/<[^>]+>/g, '').trim();
        }

        if (!this.childNodes.includes(el)) {
          this.childNodes.push(el);
          el.parentNode = this;
        }
      }
    }
  }

  const appShell = new MockElement('DIV', 'app-shell');
  elementMap['app-shell'] = appShell;

  const mockDoc = {
    readyState: 'complete',
    getElementById: (id) => elementMap[id] || null,
    querySelector: (sel) => {
      if (sel.startsWith('#')) return elementMap[sel.slice(1)] || null;
      return appShell.querySelector(sel);
    },
    querySelectorAll: (sel) => appShell.querySelectorAll(sel),
    createElement: (tag) => new MockElement(tag),
    body: new MockElement('BODY'),
    head: new MockElement('HEAD'),
    addEventListener: (ev, fn) => {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    }
  };

  mockDoc.body.appendChild(appShell);

  let printCalled = false;
  const mockWindow = {
    document: mockDoc,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    location: {
      href: `task-cost-report.html${urlSearch}`,
      search: urlSearch,
      reload: () => {}
    },
    history: {
      replaceState: (state, title, url) => {
        if (url && url.includes('?')) {
          mockWindow.location.search = url.slice(url.indexOf('?'));
        }
      }
    },
    print: () => {
      printCalled = true;
    },
    get printCalled() {
      return printCalled;
    },
    scrollTo: () => {}
  };

  return { mockDoc, mockWindow, elementMap, appShell };
}

// -------------------------------------------------------------
// 2. Integration / DOM Simulation Tests
// -------------------------------------------------------------
async function runDomTests() {
  const { mockDoc, mockWindow, elementMap, appShell } = setupMockDom('?task_id=1');

  // Set globals
  global.window = mockWindow;
  global.document = mockDoc;
  global.localStorage = mockWindow.localStorage;

  // Load utils.js
  const utilsCode = fs.readFileSync(path.resolve(__dirname, '../assets/js/utils.js'), 'utf8');
  eval(utilsCode);
  const UTILS = global.window.WAGE_UTILS || global.window.Utils || Utils;
  global.Utils = UTILS;
  global.WAGE_UTILS = UTILS;

  // Prepare Mock Tasks Data
  const sampleTasks = [
    {
      id: 1,
      task_code: 'TSK-202611-001',
      title: 'งานเทเสาชั้น 2',
      site: 'ไซต์สุขุมวิท 101',
      location_detail: 'โซน B ลานด้านหน้า',
      assigned_to: 'สมศักดิ์ ช่างไม้',
      ordered_by: 'วิศวกรธีรเดช',
      order_date: '2026-11-01',
      due_date: '2026-11-10',
      status: 'In Progress',
      progress_percent: 65,
      description: 'เทคอนกรีตเสา 8 ต้น ชั้น 2',
      issues: 'ฝนตกช่วงบ่าย',
      resolution: 'เตรียมผ้าใบคลุมและเลื่อนเทปูน 2 ชม.',
      completion_summary: 'ปิดงานตามแผนเรียบร้อย',
      accumulated_days: 2,
      accumulated_hours: 16,
      accumulated_man_days: 2.0,
      accumulated_cost: 1000,
      accumulated_markup_cost: 1200,
      progress_history: [
        { date: '2026-11-01', percent: 20, issues: '', resolution: '', by: 'ธีรเดช' },
        { date: '2026-11-04', percent: 65, issues: 'ฝนตกช่วงบ่าย', resolution: 'เตรียมผ้าใบคลุม', by: 'สมศักดิ์' }
      ]
    },
    {
      id: 2,
      task_code: 'TSK-202611-002',
      title: 'งานปูกระเบื้องห้องน้ำ',
      site: 'ไซต์สาทร',
      location_detail: 'ชั้น 4 ห้อง 401-404',
      assigned_to: 'วิชัย ช่างปูน',
      ordered_by: 'ผู้รับเหมาสมเกียรติ',
      order_date: '2026-11-02',
      due_date: '2026-11-12',
      status: 'Pending',
      progress_percent: 0,
      description: 'ปูกระเบื้อง 4 ห้อง',
      issues: '',
      resolution: '',
      completion_summary: '',
      accumulated_days: 0,
      accumulated_hours: 0,
      accumulated_man_days: 0,
      accumulated_cost: 0,
      accumulated_markup_cost: 0,
      progress_history: []
    }
  ];

  const sampleSummaryTask1 = {
    task: sampleTasks[0],
    logs: [
      { work_date: '2026-11-02', worker_name: 'สมชาย', wage_type: 'daily', hours: 8, ot_hours: 0, raw_wage: 500, total_with_markup: 600, job_detail: 'ผูกเหล็กเสา' },
      { work_date: '2026-11-03', worker_name: 'สมชาย', wage_type: 'daily', hours: 8, ot_hours: 0, raw_wage: 500, total_with_markup: 600, job_detail: 'เข้าแบบเสา' },
      { work_date: '2026-11-04', worker_name: 'เฟิร์น', wage_type: 'daily', hours: 8, ot_hours: 0, raw_wage: 500, total_with_markup: 600, job_detail: 'เทคอนกรีตเสา' }
    ],
    currentSummary: {
      daysWorked: 3,
      hours: 24,
      manDays: 3.0,
      rawCost: 1500,
      markupCost: 1800
    },
    accumulatedSummary: {
      daysWorked: 2,
      hours: 16,
      manDays: 2.0,
      rawCost: 1000,
      markupCost: 1200
    },
    totalSummary: {
      totalDaysWorked: 5,
      totalHours: 40,
      totalManDays: 5.0,
      totalCost: 2500,
      totalMarkupCost: 3000
    },
    workerBreakdown: [
      {
        worker_name: 'สมชาย',
        workerName: 'สมชาย',
        days: 2,
        hours: 16,
        man_days: 2.0,
        manDays: 2.0,
        raw_wage: 1000,
        rawWage: 1000,
        markup_wage: 1200,
        markupWage: 1200
      },
      {
        worker_name: 'เฟิร์น',
        workerName: 'เฟิร์น',
        days: 1,
        hours: 8,
        man_days: 1.0,
        manDays: 1.0,
        raw_wage: 500,
        rawWage: 500,
        markup_wage: 600,
        markupWage: 600
      }
    ]
  };

  const sampleSummaryTask2 = {
    task: sampleTasks[1],
    logs: [],
    currentSummary: { daysWorked: 0, hours: 0, manDays: 0, rawCost: 0, markupCost: 0 },
    accumulatedSummary: { daysWorked: 0, hours: 0, manDays: 0, rawCost: 0, markupCost: 0 },
    totalSummary: { totalDaysWorked: 0, totalHours: 0, totalManDays: 0, totalCost: 0, totalMarkupCost: 0 },
    workerBreakdown: []
  };

  let getTaskCostSummaryCalls = [];
  const mockApi = {
    getTasks: async () => sampleTasks,
    getTaskById: async (id) => sampleTasks.find(t => String(t.id) === String(id)) || null,
    getTaskCostSummary: async (taskId) => {
      getTaskCostSummaryCalls.push(taskId);
      if (String(taskId) === '1') return sampleSummaryTask1;
      if (String(taskId) === '2') return sampleSummaryTask2;
      return null;
    },
    getConfig: () => ({ hourlyDivisor: 8, isCloud: false })
  };

  global.window.Api = mockApi;
  global.window.WAGE_API = mockApi;
  global.Api = mockApi;
  global.WAGE_API = mockApi;

  // Execute task-cost-report.js
  const pageJsCode = fs.readFileSync(reportJsPath, 'utf8');
  eval(pageJsCode);

  // Allow any pending promises/microtasks to resolve
  await new Promise(r => setTimeout(r, 60));

  await runAsyncTest('Control bar should render task selector, print button, and link back to tasks', () => {
    const selectTask = elementMap['select-task'];
    assert(selectTask, '#select-task must exist in DOM');
    assert(selectTask.innerHTML.includes('TSK-202611-001'), 'Task selector must contain TSK-202611-001');
    assert(selectTask.innerHTML.includes('TSK-202611-002'), 'Task selector must contain TSK-202611-002');
    assert.strictEqual(selectTask.value, '1', 'Task selector must auto-select task 1 based on URL parameter ?task_id=1');

    const printBtn = elementMap['btn-print-report'];
    assert(printBtn, '#btn-print-report must exist');

    // Test print button click
    printBtn.click();
    assert.strictEqual(mockWindow.printCalled, true, 'Clicking #btn-print-report must trigger window.print()');

    // Link back to tasks
    const backLink = elementMap['btn-back-to-tasks'] || appShell.querySelector('#btn-back-to-tasks');
    assert(backLink && (backLink.getAttribute('href') || '').includes('tasks.html') || appShell.innerHTML.includes('tasks.html'), 'Must contain a link back to tasks.html');
  });

  await runAsyncTest('Task metadata header card (#report-task-header) should render task details', () => {
    const headerCard = elementMap['report-task-header'];
    assert(headerCard, '#report-task-header must exist');
    const text = headerCard.innerHTML;

    assert(text.includes('TSK-202611-001'), 'Header must contain task_code TSK-202611-001');
    assert(text.includes('งานเทเสาชั้น 2'), 'Header must contain task title');
    assert(text.includes('ไซต์สุขุมวิท 101'), 'Header must contain site');
    assert(text.includes('สมศักดิ์ ช่างไม้'), 'Header must contain assigned_to');
    assert(text.includes('วิศวกรธีรเดช'), 'Header must contain ordered_by');
    assert(text.includes('เทคอนกรีตเสา 8 ต้น ชั้น 2'), 'Header must contain description');
    assert(text.includes('ฝนตกช่วงบ่าย'), 'Header must contain issues');
    assert(text.includes('เตรียมผ้าใบคลุม'), 'Header must contain resolution');
    assert(text.includes('ปิดงานตามแผนเรียบร้อย'), 'Header must contain completion_summary');
    assert(text.includes('badge'), 'Header must render status badge');
    assert(text.includes('progress-container') || text.includes('65%'), 'Header must render progress bar');
  });

  await runAsyncTest('4 Cost & Effort KPI Cards (#report-kpi-grid) should display accurate figures', () => {
    const kpiGrid = elementMap['report-kpi-grid'];
    assert(kpiGrid, '#report-kpi-grid must exist');
    const text = kpiGrid.innerHTML;

    // Days worked (5 days total, 3 current + 2 accumulated)
    assert(text.includes('5') && (text.includes('วัน') || text.includes('days')), 'KPI grid must show 5 days total');
    assert(text.includes('3') && text.includes('2'), 'KPI grid must show separation of 3 current and 2 accumulated days');

    // Man-Days & Hours (5 man-days, 40 hours)
    assert(text.includes('5') && (text.includes('แรง') || text.includes('Man-Days')), 'KPI grid must show 5 man-days');
    assert(text.includes('40') && (text.includes('ชม.') || text.includes('hours')), 'KPI grid must show 40 total hours');

    // Raw Labor Cost (2,500 total, 1,500 current + 1,000 accum)
    assert(text.includes('2,500') || text.includes('2500'), 'KPI grid must show raw cost 2,500');

    // Total Markup Cost (3,000 total, 1,800 current + 1,200 accum)
    assert(text.includes('3,000') || text.includes('3000'), 'KPI grid must show total markup cost 3,000');
  });

  await runAsyncTest('Accumulated snapshot breakdown banner should appear when task has accumulated amounts', () => {
    const banner = elementMap['accumulated-banner'] || appShell.querySelector('.accumulated-banner') || appShell.querySelector('#report-accumulated-banner');
    assert(banner, 'Accumulated breakdown banner must exist when task has accumulatedSummary > 0');
    const bannerText = banner.innerHTML;
    assert(bannerText.includes('1,000') || bannerText.includes('1000'), 'Banner must show accumulated raw cost 1,000');
    assert(bannerText.includes('1,500') || bannerText.includes('1500'), 'Banner must show current raw cost 1,500');
    assert(bannerText.includes('2,500') || bannerText.includes('2500'), 'Banner must show total raw cost 2,500');
  });

  await runAsyncTest('Worker breakdown table (#worker-breakdown-body) should list worker rows and totals', () => {
    const workerBody = elementMap['worker-breakdown-body'];
    assert(workerBody, '#worker-breakdown-body must exist');
    const rowsHtml = workerBody.innerHTML;

    assert(rowsHtml.includes('สมชาย'), 'Worker table must contain สมชาย');
    assert(rowsHtml.includes('1,000') || rowsHtml.includes('1000'), 'Worker table must contain raw wage 1,000 for สมชาย');
    assert(rowsHtml.includes('1,200') || rowsHtml.includes('1200'), 'Worker table must contain markup wage 1,200 for สมชาย');
    assert(rowsHtml.includes('เฟิร์น'), 'Worker table must contain เฟิร์น');
    assert(rowsHtml.includes('500'), 'Worker table must contain raw wage 500 for เฟิร์น');
    assert(rowsHtml.includes('600'), 'Worker table must contain markup wage 600 for เฟิร์น');

    // Check footer totals
    const tableEl = elementMap['worker-breakdown-table'] || workerBody.parentNode;
    const tableText = tableEl ? tableEl.innerHTML : rowsHtml;
    assert(tableText.includes('1,500') || tableText.includes('1500'), 'Worker breakdown totals must show 1,500 sum');
    assert(tableText.includes('1,800') || tableText.includes('1800'), 'Worker breakdown totals must show 1,800 markup sum');
  });

  await runAsyncTest('Daily logs table (#task-logs-body) should list log rows for the task', () => {
    const logsBody = elementMap['task-logs-body'];
    assert(logsBody, '#task-logs-body must exist');
    const html = logsBody.innerHTML;

    assert(html.includes('ผูกเหล็กเสา'), 'Logs table must list job detail ผูกเหล็กเสา');
    assert(html.includes('เข้าแบบเสา'), 'Logs table must list job detail เข้าแบบเสา');
    assert(html.includes('เทคอนกรีตเสา'), 'Logs table must list job detail เทคอนกรีตเสา');
  });

  await runAsyncTest('Progress & Issue timeline section (#report-timeline-body) should render history entries', () => {
    const timelineBody = elementMap['report-timeline-body'];
    assert(timelineBody, '#report-timeline-body must exist');
    const html = timelineBody.innerHTML;

    assert(html.includes('20%'), 'Timeline must show 20% update');
    assert(html.includes('65%'), 'Timeline must show 65% update');
    assert(html.includes('ธีรเดช'), 'Timeline must show recorder name ธีรเดช');
    assert(html.includes('ฝนตกช่วงบ่าย'), 'Timeline must show issue in history');
  });

  await runAsyncTest('Changing task selector dropdown should fetch and display new task report', async () => {
    const selectTask = elementMap['select-task'];
    selectTask.value = '2';
    selectTask.dispatchEvent('change');

    await new Promise(r => setTimeout(r, 60));

    assert(getTaskCostSummaryCalls.includes(2) || getTaskCostSummaryCalls.includes('2'), 'Changing selector must invoke getTaskCostSummary(2)');
    const headerCard = elementMap['report-task-header'];
    assert(headerCard.innerHTML.includes('TSK-202611-002'), 'Header should update to display TSK-202611-002');
    assert(headerCard.innerHTML.includes('งานปูกระเบื้องห้องน้ำ'), 'Header should update to display Task 2 title');
  });
}

// -------------------------------------------------------------
// Run Test Suite
// -------------------------------------------------------------
(async () => {
  try {
    await runDomTests();
    console.log(`\n========================================`);
    console.log(`All ${passedTests}/${totalTests} tests passed successfully!`);
    console.log(`========================================\n`);
  } catch (err) {
    console.error(`\nTest suite stopped due to error: ${err.message}`);
    process.exit(1);
  }
})();
