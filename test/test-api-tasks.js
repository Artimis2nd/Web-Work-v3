/**
 * Test Suite for Task CRUD, Progress Timeline & Costing Aggregation API
 * Runs in Node.js simulating browser localStorage and window.WAGE_API
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Setup Mock Browser Environment
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

// Load api.js
const apiPath = path.resolve(__dirname, '../assets/js/api.js');
const apiCode = fs.readFileSync(apiPath, 'utf8');

// Evaluate in global context
eval(apiCode);

const API = global.window?.WAGE_API || (typeof Api !== 'undefined' ? Api : null);

console.log('Testing Task API Implementation...\n');

let passedTests = 0;
let totalTests = 0;

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

async function runTests() {
  // Test 1: API Object and required methods exist
  it('API and Task methods should be defined', () => {
    assert(API, 'window.WAGE_API or Api must be defined');
    const methods = [
      'getTasks',
      'getTaskById',
      'createTask',
      'updateTask',
      'deleteTask',
      'addTaskProgress',
      'getTaskCostSummary',
      'snapshotActiveTasksBeforeClear'
    ];
    for (const m of methods) {
      assert.strictEqual(typeof API[m], 'function', `API.${m} must be a function`);
    }
  });

  // Test 2: Task creation and auto task_code generation
  let task1, task2;
  await (async () => {
    totalTests++;
    try {
      task1 = await API.createTask({
        title: 'ติดตั้งตู้คอนโทรลปั๊มน้ำ',
        site: 'ไซท์สุขุมวิท 71',
        location_detail: 'ห้องเครื่องชั้น B1',
        assigned_to: 'ช่างนพ',
        ordered_by: 'คุณวิชัย',
        order_date: '2026-11-06',
        due_date: '2026-11-20',
        description: 'งานเดินท่อและติดตั้งระบบไฟตู้ควบคุม'
      });

      assert(task1, 'Created task1 must be returned');
      assert(task1.id, 'Task1 must have an ID');
      assert.strictEqual(task1.task_code, 'TSK-202611-001', 'First task code must be TSK-202611-001');
      assert.strictEqual(task1.status, 'Pending', 'Default status must be Pending');
      assert.strictEqual(task1.progress_percent, 0, 'Default progress_percent must be 0');
      assert.deepStrictEqual(task1.progress_history, [], 'Default progress_history must be empty array');
      assert.strictEqual(task1.accumulated_cost, 0, 'Default accumulated_cost must be 0');
      assert.strictEqual(task1.accumulated_markup_cost, 0, 'Default accumulated_markup_cost must be 0');
      assert.strictEqual(task1.accumulated_hours, 0, 'Default accumulated_hours must be 0');
      assert.strictEqual(task1.accumulated_man_days, 0, 'Default accumulated_man_days must be 0');
      assert.strictEqual(task1.accumulated_days, 0, 'Default accumulated_days must be 0');

      task2 = await API.createTask({
        title: 'ซ่อมแซมกระเบื้องสระว่ายน้ำ',
        site: 'ไซท์พัทยา',
        assigned_to: 'สมชาย ใจดี',
        order_date: '2026-11-07'
      });

      assert(task2, 'Created task2 must be returned');
      assert.strictEqual(task2.task_code, 'TSK-202611-002', 'Second task code must increment to TSK-202611-002');

      console.log('[PASS] Task creation and auto task_code generation');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Task creation and auto task_code generation:', err.message);
      throw err;
    }
  })();

  // Test 3: Task retrieval and filtering
  await (async () => {
    totalTests++;
    try {
      const single = await API.getTaskById(task1.id);
      assert(single, 'getTaskById should return task1');
      assert.strictEqual(single.id, task1.id);

      const notFound = await API.getTaskById(99999);
      assert.strictEqual(notFound, null, 'Non-existent task should return null');

      const allTasks = await API.getTasks();
      assert.strictEqual(allTasks.length, 2, 'Should have 2 tasks total');

      const siteFiltered = await API.getTasks({ site: 'ไซท์สุขุมวิท 71' });
      assert.strictEqual(siteFiltered.length, 1, 'Filter by site should return 1 task');
      assert.strictEqual(siteFiltered[0].id, task1.id);

      const searchCode = await API.getTasks({ search: '002' });
      assert.strictEqual(searchCode.length, 1, 'Search by code suffix should return 1 task');
      assert.strictEqual(searchCode[0].id, task2.id);

      const searchAssignee = await API.getTasks({ search: 'ช่างนพ' });
      assert.strictEqual(searchAssignee.length, 1, 'Search by assigned_to should return 1 task');
      assert.strictEqual(searchAssignee[0].id, task1.id);

      console.log('[PASS] Task retrieval and filtering (by site, status, search)');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Task retrieval and filtering:', err.message);
      throw err;
    }
  })();

  // Test 4: Task update and progress timeline appending
  await (async () => {
    totalTests++;
    try {
      // Add progress entry 1
      const updatedProg1 = await API.addTaskProgress(task1.id, {
        percent: 30,
        issues: 'รออะไหล่แมกเนติก',
        resolution: 'จัดซื้อเร่งด่วน',
        by: 'ช่างนพ',
        date: '2026-11-08'
      });

      assert.strictEqual(updatedProg1.progress_percent, 30);
      assert.strictEqual(updatedProg1.status, 'In Progress', 'Status should auto-transition from Pending to In Progress');
      assert.strictEqual(updatedProg1.progress_history.length, 1);
      assert.strictEqual(updatedProg1.progress_history[0].percent, 30);
      assert.strictEqual(updatedProg1.progress_history[0].issues, 'รออะไหล่แมกเนติก');
      assert.strictEqual(updatedProg1.progress_history[0].by, 'ช่างนพ');

      // Add progress entry 2
      const updatedProg2 = await API.addTaskProgress(task1.id, {
        percent: 75,
        issues: '',
        resolution: 'ติดตั้งอุปกรณ์เรียบร้อย กำลังทดสอบระบบ',
        by: 'ช่างนพ',
        date: '2026-11-09'
      });

      assert.strictEqual(updatedProg2.progress_percent, 75);
      assert.strictEqual(updatedProg2.progress_history.length, 2);
      assert.strictEqual(updatedProg2.progress_history[1].percent, 75);

      console.log('[PASS] Progress timeline appending and auto-transition to In Progress');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Progress timeline appending:', err.message);
      throw err;
    }
  })();

  // Test 5: Cost Aggregation with Hourly, OT, Exempt worker, and Fixed wage
  await (async () => {
    totalTests++;
    try {
      // Add daily log group linked to task1
      // Worker A: สมชาย (Daily 400, Hours 8, OT 2) -> Hourly = 50
      //           Raw = 50*8 + 50*2*2 = 600, Markup (+20%) = 720
      //           Hours = 10, Man-Days = 8 / 8 = 1.0
      // Worker B: เฟิร์น (Exempt worker, Daily 500, Hours 4, OT 0) -> Hourly = 62.5
      //           Raw = 62.5*4 = 250, Markup = 250 (no markup for เฟิร์น)
      //           Hours = 4, Man-Days = 4 / 8 = 0.5
      // Worker C: สมศรี (Fixed wage, 500 fixed)
      //           Raw = 500, Markup = 500
      //           Hours = 0, Man-Days = 1.0 (fixed wage = 1.0 man-day per entry)
      await API.addLogs({
        date: '2026-11-08',
        site: task1.site,
        jobDetail: 'ติดตั้งตู้คอนโทรล',
        requestedBy: task1.ordered_by,
        taskId: task1.id,
        workers: [
          { workerName: 'สมชาย ใจดี', dailyWage: 400, wageType: 'hourly', hours: 8, otHours: 2, fixedAmount: 0 },
          { workerName: 'เฟิร์น', dailyWage: 500, wageType: 'hourly', hours: 4, otHours: 0, fixedAmount: 0 },
          { workerName: 'สมศรี ขยันงาน', dailyWage: 0, wageType: 'fixed', hours: 0, otHours: 0, fixedAmount: 500 }
        ]
      });

      // Add a second log group on another day for same task1
      // Worker A: สมชาย (Daily 400, Hours 8, OT 0) -> Raw = 400, Markup = 480, Man-Days = 1.0
      await API.addLogs({
        date: '2026-11-09',
        site: task1.site,
        jobDetail: 'ทดสอบระบบตู้ไฟ',
        taskId: task1.id,
        workers: [
          { workerName: 'สมชาย ใจดี', dailyWage: 400, wageType: 'hourly', hours: 8, otHours: 0, fixedAmount: 0 }
        ]
      });

      const summary = await API.getTaskCostSummary(task1.id);
      assert(summary, 'Cost summary must be returned');
      assert.strictEqual(summary.logs.length, 4, 'Should have 4 worker log entries linked to task1');

      // Current cycle metrics:
      // Unique dates: 2026-11-08 and 2026-11-09 -> 2 days worked
      // Total hours: 10 + 4 + 0 + 8 = 22 hours
      // Total man-days: 1.0 + 0.5 + 1.0 + 1.0 = 3.5 man-days
      // Total raw wage: 600 + 250 + 500 + 400 = 1750
      // Total markup wage: 720 + 250 + 500 + 480 = 1950
      assert.strictEqual(summary.currentSummary.daysWorked, 2, 'Current days worked must be 2');
      assert.strictEqual(summary.currentSummary.hours, 22, 'Current hours must be 22');
      assert.strictEqual(summary.currentSummary.manDays, 3.5, 'Current man-days must be 3.5');
      assert.strictEqual(summary.currentSummary.rawCost, 1750, 'Current raw cost must be 1750');
      assert.strictEqual(summary.currentSummary.markupCost, 1950, 'Current markup cost must be 1950');

      // Worker breakdown checks
      const somchai = summary.workerBreakdown.find(w => w.worker_name === 'สมชาย ใจดี' || w.workerName === 'สมชาย ใจดี');
      assert(somchai, 'สมชาย must exist in breakdown');
      assert.strictEqual(somchai.raw_wage, 1000);
      assert.strictEqual(somchai.markup_wage, 1200);
      assert.strictEqual(somchai.hours, 18);
      assert.strictEqual(somchai.man_days, 2.0);
      assert.strictEqual(somchai.days, 2);

      const fern = summary.workerBreakdown.find(w => w.worker_name === 'เฟิร์น' || w.workerName === 'เฟิร์น');
      assert(fern, 'เฟิร์น must exist in breakdown');
      assert.strictEqual(fern.raw_wage, 250);
      assert.strictEqual(fern.markup_wage, 250, 'เฟิร์น must be exempt from 20% markup');
      assert.strictEqual(fern.man_days, 0.5);

      const somsri = summary.workerBreakdown.find(w => w.worker_name === 'สมศรี ขยันงาน' || w.workerName === 'สมศรี ขยันงาน');
      assert(somsri, 'สมศรี must exist in breakdown');
      assert.strictEqual(somsri.raw_wage, 500);
      assert.strictEqual(somsri.markup_wage, 500);
      assert.strictEqual(somsri.man_days, 1.0, 'Fixed wage must count as 1.0 man-day');

      console.log('[PASS] Task cost aggregation (hourly, OT, exempt worker, fixed wage)');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Task cost aggregation:', err.message);
      throw err;
    }
  })();

  // Test 6: Snapshot Active Tasks Before Clear and Cross-Cycle Persistence
  await (async () => {
    totalTests++;
    try {
      // Perform snapshot before pay cycle clear
      await API.snapshotActiveTasksBeforeClear();

      // Check task1 accumulated values are populated
      const snapshottedTask1 = await API.getTaskById(task1.id);
      assert.strictEqual(snapshottedTask1.accumulated_days, 2);
      assert.strictEqual(snapshottedTask1.accumulated_hours, 22);
      assert.strictEqual(snapshottedTask1.accumulated_man_days, 3.5);
      assert.strictEqual(snapshottedTask1.accumulated_cost, 1750);
      assert.strictEqual(snapshottedTask1.accumulated_markup_cost, 1950);

      // Now clear all logs (simulating "เบิกงวด" cycle purge)
      await API.clearAllLogs();

      // Check cost summary right after clear: current is 0, total reflects accumulated
      const postClearSummary = await API.getTaskCostSummary(task1.id);
      assert.strictEqual(postClearSummary.logs.length, 0, 'Current logs should be empty after clear');
      assert.strictEqual(postClearSummary.currentSummary.rawCost, 0);
      assert.strictEqual(postClearSummary.accumulatedSummary.rawCost, 1750);
      assert.strictEqual(postClearSummary.totalSummary.totalCost, 1750);
      assert.strictEqual(postClearSummary.totalSummary.totalMarkupCost, 1950);
      assert.strictEqual(postClearSummary.totalSummary.totalHours, 22);
      assert.strictEqual(postClearSummary.totalSummary.totalManDays, 3.5);
      assert.strictEqual(postClearSummary.totalSummary.totalDaysWorked, 2);

      // Add new log in the next cycle for task1
      // Worker A: สมชาย 8 hours = Raw 400, Markup 480, Man-Days = 1.0, 1 day
      await API.addLogs({
        date: '2026-11-15',
        site: task1.site,
        jobDetail: 'บำรุงรักษาตามรอบ',
        taskId: task1.id,
        workers: [
          { workerName: 'สมชาย ใจดี', dailyWage: 400, wageType: 'hourly', hours: 8, otHours: 0, fixedAmount: 0 }
        ]
      });

      // Check combined totals across cycles
      const combinedSummary = await API.getTaskCostSummary(task1.id);
      assert.strictEqual(combinedSummary.currentSummary.rawCost, 400);
      assert.strictEqual(combinedSummary.currentSummary.markupCost, 480);
      assert.strictEqual(combinedSummary.totalSummary.totalCost, 2150, 'Total cost should be 1750 + 400 = 2150');
      assert.strictEqual(combinedSummary.totalSummary.totalMarkupCost, 2430, 'Total markup cost should be 1950 + 480 = 2430');
      assert.strictEqual(combinedSummary.totalSummary.totalHours, 30, 'Total hours should be 22 + 8 = 30');
      assert.strictEqual(combinedSummary.totalSummary.totalManDays, 4.5, 'Total man-days should be 3.5 + 1.0 = 4.5');
      assert.strictEqual(combinedSummary.totalSummary.totalDaysWorked, 3, 'Total days worked should be 2 + 1 = 3');

      console.log('[PASS] Snapshot active tasks before clear and cross-cycle cost aggregation');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Snapshot active tasks before clear:', err.message);
      throw err;
    }
  })();

  // Test 7: Task deletion unlinks daily_logs
  await (async () => {
    totalTests++;
    try {
      // task1 currently has 1 log in the current cycle
      const logsBefore = await API.getLogs({});
      const task1Logs = logsBefore.logs.flatMap(g => g.Workers).filter(w => String(w.TaskId ?? w.task_id) === String(task1.id));
      assert(task1Logs.length > 0, 'Task 1 must have linked logs before delete');

      await API.deleteTask(task1.id);

      const deletedTask = await API.getTaskById(task1.id);
      assert.strictEqual(deletedTask, null, 'Deleted task must not be found');

      const logsAfter = await API.getLogs({});
      const unlinkedLogs = logsAfter.logs.flatMap(g => g.Workers).filter(w => String(w.TaskId ?? w.task_id) === String(task1.id));
      assert.strictEqual(unlinkedLogs.length, 0, 'Daily logs must have task_id unlinked (null) after task deletion');

      console.log('[PASS] Task deletion unlinks daily_logs task_id');
      passedTests++;
    } catch (err) {
      console.error('[FAIL] Task deletion unlinks daily_logs:', err.message);
      throw err;
    }
  })();

  console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
  if (passedTests === totalTests) {
    console.log('All Task API tests passed successfully!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('\nTest suite execution failed:', err.message);
  process.exit(1);
});
