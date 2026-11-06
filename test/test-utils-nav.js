/**
 * Test Suite for Shared Navigation & Badge Utilities (Task 3)
 * Tests:
 * 1. window.WAGE_UTILS and Utils export
 * 2. renderSidebar(activePage) menu items and active highlighting
 * 3. renderTaskStatusBadge(status) for all statuses & fallbacks
 * 4. renderProgressBar(percent, options) clamping, styling, & color dynamics
 * 5. Backwards compatibility with existing Utils methods
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Setup mock browser environment for Node.js
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); }
};

const mockElements = {};
global.document = {
  getElementById: (id) => mockElements[id] || null,
  querySelector: () => null,
  createElement: (tag) => {
    let _text = '';
    return {
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      get textContent() { return _text; },
      set textContent(v) { _text = String(v); },
      get innerHTML() { return _text; },
      set innerHTML(v) { _text = String(v); },
      appendChild: () => {},
      addEventListener: () => {},
      remove: () => {}
    };
  },
  body: {
    appendChild: () => {}
  },
  head: {
    appendChild: () => {}
  },
  addEventListener: () => {}
};

global.window = {
  localStorage: global.localStorage,
  document: global.document,
  location: { reload: () => {} }
};

// 2. Load utils.js
const utilsPath = path.resolve(__dirname, '../assets/js/utils.js');
const utilsCode = fs.readFileSync(utilsPath, 'utf8');

// Evaluate in global context
eval(utilsCode);

const UTILS = global.window?.WAGE_UTILS || global.window?.Utils || (typeof Utils !== 'undefined' ? Utils : null);

console.log('Testing Shared Navigation & Badge Utilities (Task 3)...\n');

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

// -------------------------------------------------------------
// Test 1: Exports and Availability
// -------------------------------------------------------------
it('should export window.WAGE_UTILS and maintain window.Utils', () => {
  assert(UTILS, 'WAGE_UTILS or Utils must be defined');
  assert.strictEqual(typeof UTILS.renderSidebar, 'function', 'renderSidebar must be a function');
  assert.strictEqual(typeof UTILS.renderTaskStatusBadge, 'function', 'renderTaskStatusBadge must be a function');
  assert.strictEqual(typeof UTILS.renderProgressBar, 'function', 'renderProgressBar must be a function');
});

// -------------------------------------------------------------
// Test 2: renderSidebar Navigation Items & Active State
// -------------------------------------------------------------
it('should include all required menu items in renderSidebar', () => {
  const html = UTILS.renderSidebar('index.html');
  assert(typeof html === 'string', 'renderSidebar must return an HTML string');

  // Verify all 8 menu items
  const requiredHrefs = [
    'index.html',
    'tasks.html',
    'daily-log.html',
    'overview.html',
    'report.html',
    'pivot-report.html',
    'task-cost-report.html',
    'workers.html'
  ];

  for (const href of requiredHrefs) {
    assert(html.includes(`href="${href}"`), `Sidebar must include link to ${href}`);
  }

  // Verify titles / labels for task pages
  assert(html.includes('สั่งงานและติดตามงาน'), 'Sidebar must include label สั่งงานและติดตามงาน');
  assert(html.includes('สรุปต้นทุนตามงาน'), 'Sidebar must include label สรุปต้นทุนตามงาน');
  assert(html.includes('📋'), 'Sidebar must include clipboard icon for tasks.html');
  assert(html.includes('📊'), 'Sidebar must include chart icon for task-cost-report.html');
});

it('should highlight active page correctly in renderSidebar', () => {
  // Test tasks.html active
  const tasksHtml = UTILS.renderSidebar('tasks.html');
  assert(/href="tasks\.html"[^>]*class="[^"]*active[^"]*"|class="[^"]*active[^"]*"[^>]*href="tasks\.html"/.test(tasksHtml),
    'tasks.html link must have active class when activePage is tasks.html');
  assert(!/href="index\.html"[^>]*class="[^"]*active[^"]*"|class="[^"]*active[^"]*"[^>]*href="index\.html"/.test(tasksHtml),
    'index.html link must NOT have active class when activePage is tasks.html');

  // Test task-cost-report.html active
  const costReportHtml = UTILS.renderSidebar('task-cost-report.html');
  assert(/href="task-cost-report\.html"[^>]*class="[^"]*active[^"]*"|class="[^"]*active[^"]*"[^>]*href="task-cost-report\.html"/.test(costReportHtml),
    'task-cost-report.html link must have active class when activePage is task-cost-report.html');

  // Test path normalization (e.g. ./tasks.html or query string)
  const normalizedHtml = UTILS.renderSidebar('./tasks.html?filter=Pending');
  assert(/href="tasks\.html"[^>]*class="[^"]*active[^"]*"|class="[^"]*active[^"]*"[^>]*href="tasks\.html"/.test(normalizedHtml),
    'Normalized active path must match tasks.html');
});

// -------------------------------------------------------------
// Test 3: renderTaskStatusBadge
// -------------------------------------------------------------
it('should render correct badge HTML for all 4 task statuses', () => {
  const pendingBadge = UTILS.renderTaskStatusBadge('Pending');
  assert.strictEqual(pendingBadge, '<span class="badge badge-warning">รอดำเนินการ</span>',
    'Pending status badge must match exact specification');

  const inProgressBadge = UTILS.renderTaskStatusBadge('In Progress');
  assert.strictEqual(inProgressBadge, '<span class="badge badge-info">กำลังดำเนินการ</span>',
    'In Progress status badge must match exact specification');

  const blockedBadge = UTILS.renderTaskStatusBadge('Blocked');
  assert.strictEqual(blockedBadge, '<span class="badge badge-danger">ติดปัญหา</span>',
    'Blocked status badge must match exact specification');

  const completedBadge = UTILS.renderTaskStatusBadge('Completed');
  assert.strictEqual(completedBadge, '<span class="badge badge-success">เสร็จสมบูรณ์</span>',
    'Completed status badge must match exact specification');
});

it('should handle fallback and Thai statuses in renderTaskStatusBadge', () => {
  // Thai status aliases
  assert(UTILS.renderTaskStatusBadge('รอดำเนินการ').includes('badge-warning'));
  assert(UTILS.renderTaskStatusBadge('กำลังดำเนินการ').includes('badge-info'));
  assert(UTILS.renderTaskStatusBadge('ติดปัญหา').includes('badge-danger'));
  assert(UTILS.renderTaskStatusBadge('เสร็จสมบูรณ์').includes('badge-success'));

  // Custom or unknown status fallback
  const customBadge = UTILS.renderTaskStatusBadge('Reviewing');
  assert.strictEqual(customBadge, '<span class="badge">Reviewing</span>');

  // Empty or null fallback
  const emptyBadge = UTILS.renderTaskStatusBadge('');
  assert.strictEqual(emptyBadge, '<span class="badge">-</span>');

  const nullBadge = UTILS.renderTaskStatusBadge(null);
  assert.strictEqual(nullBadge, '<span class="badge">-</span>');
});

// -------------------------------------------------------------
// Test 4: renderProgressBar
// -------------------------------------------------------------
it('should render progress bar with track, fill and clamped values', () => {
  // Regular 50%
  const pb50 = UTILS.renderProgressBar(50);
  assert(pb50.includes('progress-track'), 'Must contain progress-track element');
  assert(pb50.includes('progress-fill'), 'Must contain progress-fill element');
  assert(pb50.includes('50%'), 'Must display 50% text');
  assert(pb50.includes('width:50%') || pb50.includes('width: 50%'), 'Fill width must be 50%');

  // Clamp below 0 -> 0%
  const pbNegative = UTILS.renderProgressBar(-25);
  assert(pbNegative.includes('0%'), 'Clamped negative must display 0%');
  assert(pbNegative.includes('width:0%') || pbNegative.includes('width: 0%'), 'Fill width must clamp to 0%');

  // Clamp above 100 -> 100%
  const pbOver = UTILS.renderProgressBar(150);
  assert(pbOver.includes('100%'), 'Clamped >100 must display 100%');
  assert(pbOver.includes('width:100%') || pbOver.includes('width: 100%'), 'Fill width must clamp to 100%');

  // String parsing
  const pbStr = UTILS.renderProgressBar('75');
  assert(pbStr.includes('75%'), 'String "75" must parse and display 75%');

  // Null / undefined -> 0%
  const pbNull = UTILS.renderProgressBar(null);
  assert(pbNull.includes('0%'), 'Null must default to 0%');
});

it('should reflect dynamic progress bar color based on percentage and options', () => {
  // 100% or Completed should be green/success
  const pb100 = UTILS.renderProgressBar(100);
  assert(pb100.includes('var(--green') || pb100.includes('#3F8F5F') || pb100.includes('success'),
    '100% progress should use green/success color');

  // Blocked status should use red/danger
  const pbBlocked = UTILS.renderProgressBar(40, { status: 'Blocked' });
  assert(pbBlocked.includes('var(--red') || pbBlocked.includes('#C1443C') || pbBlocked.includes('danger'),
    'Blocked progress should use red/danger color');

  // Partial progress should have styling
  const pbPartial = UTILS.renderProgressBar(30);
  assert(pbPartial.includes('progress-fill'), 'Partial progress must render fill properly');
});

// -------------------------------------------------------------
// Test 5: Backwards compatibility
// -------------------------------------------------------------
it('should preserve all existing Utils functions', () => {
  const existingMethods = [
    'money',
    'smartMoney',
    'formatDate',
    'toInputDate',
    'toApiDate',
    'toast',
    'verifyPin',
    'skeletonRows',
    'errorBanner',
    'escapeHtml',
    'renderShell',
    'compressImage',
    'animateProgress',
    'openDbSettingsModal'
  ];

  for (const method of existingMethods) {
    assert.strictEqual(typeof UTILS[method], 'function', `Existing method ${method} must be preserved`);
  }
});

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED!');
}
