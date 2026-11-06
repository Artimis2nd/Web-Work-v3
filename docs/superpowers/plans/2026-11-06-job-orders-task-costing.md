# Job Orders & Task Costing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างระบบสั่งงาน ติดตามความคืบหน้า (Progress & Issue Timeline) เชื่อมโยงกับใบงานประจำวัน และออกรายงานวิเคราะห์ต้นทุนแรงงานตามชิ้นงาน (Task Costing) ทั้งโหมด Supabase Cloud และ LocalStorage Fallback

**Architecture:** สถาปัตยกรรม Client-Side (Vanilla HTML5 / JavaScript / CSS) เชื่อมต่อ Supabase REST API & Storage พร้อมโหมด LocalStorage Fallback โดยเพิ่มตาราง `tasks` ผูกกับ `daily_logs.task_id`, มีระบบ Accumulated Snapshot เมื่อเบิกงวดล้างใบงาน, และคำนวณต้นทุน/Man-Days แยกชิ้นงาน

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3 (Theme: Blueprint & Ledger), Supabase (PostgreSQL 15+), Node.js (สำหรับ Verification scripts)

**Spec:** `docs/superpowers/specs/2026-11-06-job-orders-task-costing-design.md`

## Global Constraints

- ห้ามใช้ Node build tools / npm bundler ที่ทำให้เปิดไฟล์ตรงๆ ไม่ได้ ต้องเป็น Pure Client-Side Static Web App
- โค้ดทั้งหมดต้องรองรับทั้ง 2 โหมด: Supabase Cloud Mode และ LocalStorage Fallback Mode
- กฎการคิดค่าแรงต้องตรงกับระบบเดิม: Markup 1.2x (+20%), Hourly divisor 8, ยกเว้นคนงานชื่อ 'เฟิร์น'
- คุมสิทธิ์การจัดการและล้างข้อมูลด้วย PIN: `1225`
- ดีไซน์ UI ต้องใช้ชุดสีและฟอนต์ตาม `assets/css/style.css` (Blueprint & Ledger)

## Review Focus

1. **การเบิกงวด/ล้างบันทึกแล้วต้นทุนงานที่ยังไม่เสร็จหาย:** เมื่อผู้ใช้สั่งล้างบันทึกรายวันเพื่อเริ่มรอบคิดเงินใหม่ ฟังก์ชันต้องบันทึกยอดเงินและแรงงานสะสม (`accumulated_*`) เข้าการ์ดงานก่อนล้าง `daily_logs` เสมอ
2. **คนงานเหมาจ่าย (`wage_type = 'fixed'`):** ต้องนับเป็น 1.0 Man-Day (1 แรง) ต่องาน เพื่อไม่ให้ยอดแรงงานแสดงเป็น 0
3. **การทำงานหลายงาน/หลายไซต์ใน 1 วัน:** ระบบต้องยอมให้คนงานคนเดียวกันบันทึกใบงานเช้าที่ Task หนึ่ง และใบงานบ่ายที่อีก Task หนึ่ง โดยคำนวณต้นทุนแยกกันอิสระ
4. **ความคืบหน้างาน 100% แต่ยังไม่ปิดงาน:** เมื่อคนงานลง 100% ในใบงานรายวัน Task ต้องยังคงรอหัวหน้างานตรวจสอบและกรอก `completion_summary` ก่อนเปลี่ยนสถานะเป็น `Completed`
5. **ความเข้ากันได้กับข้อมูลใบงานเดิม:** ข้อมูลเก่าใน `daily_logs` ที่ไม่มี `task_id` (เป็น null) ต้องสามารถเปิดดูและคำนวณในแดชบอร์ดและรายงานเดิมได้ตามปกติ 100%

---

### Task 1: อัปเดตโครงสร้างฐานข้อมูล (Database Schema & Migration Script)

**Files:**
- Modify: `supabase/schema.sql`
- Test: `test/test-schema.js`

**Interfaces:**
- Consumes: PostgreSQL syntax, Supabase RLS policies
- Produces: Table `public.tasks` with columns (`id`, `task_code`, `title`, `site`, `location_detail`, `assigned_to`, `ordered_by`, `order_date`, `due_date`, `status`, `progress_percent`, `description`, `issues`, `resolution`, `completion_summary`, `progress_history`, `accumulated_cost`, `accumulated_markup_cost`, `accumulated_hours`, `accumulated_man_days`, `accumulated_days`), altered `daily_logs.task_id` with foreign key and index.

- [ ] **Step 1: Write test script to verify SQL schema definitions**
Create `test/test-schema.js` to parse `supabase/schema.sql` and verify that `CREATE TABLE IF NOT EXISTS public.tasks`, columns, and `ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS task_id` exist.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-schema.js`
Expected: FAIL (missing `public.tasks` table in schema.sql)

- [ ] **Step 3: Update `supabase/schema.sql`**
Add `public.tasks` table definition with RLS, indexes, and add `task_id` column to `public.daily_logs`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-schema.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add supabase/schema.sql test/test-schema.js
git commit -m "feat(db): add tasks table schema and task_id relation in daily_logs"
```

---

### Task 2: เพิ่มฟังก์ชันจัดการงานและคำนวณต้นทุนใน API Layer (`assets/js/api.js`)

**Files:**
- Modify: `assets/js/api.js`
- Test: `test/test-api-tasks.js`

**Interfaces:**
- Consumes: `WAGE_CONFIG`, `supabaseClient` / `localStorage`
- Produces: 
  - `WAGE_API.getTasks(filter)`
  - `WAGE_API.getTaskById(id)`
  - `WAGE_API.createTask(taskData)`
  - `WAGE_API.updateTask(id, taskData)`
  - `WAGE_API.deleteTask(id)`
  - `WAGE_API.addTaskProgress(id, { percent, issues, resolution, by })`
  - `WAGE_API.getTaskCostSummary(taskId)`
  - `WAGE_API.snapshotActiveTasksBeforeClear()`

- [ ] **Step 1: Write test script for Task API operations**
Create `test/test-api-tasks.js` to simulate task creation, progress timeline appending, cost calculation (hourly + fixed wage 1 man-day), and accumulated snapshot logic on local storage simulation.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-api-tasks.js`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement task CRUD and cost aggregation methods in `assets/js/api.js`**
Implement both Supabase REST query and LocalStorage fallback logic for all task methods, including `getTaskCostSummary` and `snapshotActiveTasksBeforeClear`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-api-tasks.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add assets/js/api.js test/test-api-tasks.js
git commit -m "feat(api): implement task CRUD, progress timeline, and costing aggregation"
```

---

### Task 3: เพิ่มเมนูและการแสดงผลร่วมใน Shared Utilities (`assets/js/utils.js`)

**Files:**
- Modify: `assets/js/utils.js`
- Test: `test/test-utils-nav.js`

**Interfaces:**
- Consumes: Sidebar navigation configuration
- Produces: Updated sidebar with "📋 สั่งงานและติดตามงาน" (`tasks.html`) and "📊 สรุปต้นทุนตามงาน" (`task-cost-report.html`), helper `renderTaskStatusBadge(status)`, `renderProgressBar(percent)`.

- [ ] **Step 1: Write test script for navigation links and badge renderers**
Create `test/test-utils-nav.js` to verify `utils.js` exports the new sidebar menu items and badge rendering helpers.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-utils-nav.js`
Expected: FAIL

- [ ] **Step 3: Update `assets/js/utils.js`**
Add sidebar navigation links for `tasks.html` and `task-cost-report.html`, and add `renderTaskStatusBadge` and `renderProgressBar` functions.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-utils-nav.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add assets/js/utils.js test/test-utils-nav.js
git commit -m "feat(ui): add task navigation and status badge utilities"
```

---

### Task 4: หน้ากระดานสั่งงานและติดตามงาน (`tasks.html` & `assets/js/pages/tasks.js`)

**Files:**
- Create: `tasks.html`
- Create: `assets/js/pages/tasks.js`
- Test: `test/test-tasks-page.js`

**Interfaces:**
- Consumes: `WAGE_API`, `WAGE_UTILS`
- Produces: Interactive Task Board with KPIs, search/filter, "➕ สั่งงานใหม่" modal, "ดูรายละเอียด & ประวัติปัญหา" timeline modal, and "ปิดงาน/สรุปผล" modal.

- [ ] **Step 1: Write test script to verify `tasks.html` structure and `tasks.js` syntax**
Create `test/test-tasks-page.js` to ensure HTML includes required KPI containers, filter inputs, modals, and `tasks.js` contains valid syntax without errors.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-tasks-page.js`
Expected: FAIL (files do not exist)

- [ ] **Step 3: Create `tasks.html` and `assets/js/pages/tasks.js`**
Build the user interface following Blueprint & Ledger styling, hook up KPI counts, task listing, filter controls, and modals.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-tasks-page.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add tasks.html assets/js/pages/tasks.js test/test-tasks-page.js
git commit -m "feat: add task board and job order management page"
```

---

### Task 5: ปรับปรุงหน้าบันทึกรายวันเพื่อเชื่อมโยงกับงาน (`daily-log.html` & `daily-log.js`)

**Files:**
- Modify: `daily-log.html`
- Modify: `assets/js/pages/daily-log.js`
- Test: `test/test-daily-log-link.js`

**Interfaces:**
- Consumes: Active tasks from `WAGE_API.getTasks()`, user input
- Produces: Daily log saving with `task_id`, auto-fills site/detail, captures today's progress % and issue notes, and updates task's `progress_history`.

- [ ] **Step 1: Write test script for daily log task dropdown and payload verification**
Create `test/test-daily-log-link.js` to verify DOM elements in `daily-log.html` and functions in `daily-log.js`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-daily-log-link.js`
Expected: FAIL

- [ ] **Step 3: Update `daily-log.html` and `assets/js/pages/daily-log.js`**
Add the assigned task selector, auto-fill event listeners, progress/issues input fields, and update the save routine to link `task_id` and push updates to `progress_history`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-daily-log-link.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add daily-log.html assets/js/pages/daily-log.js test/test-daily-log-link.js
git commit -m "feat(daily-log): link daily logs with assigned tasks and record daily progress"
```

---

### Task 6: หน้ารายงานสรุปต้นทุนตามชิ้นงาน (`task-cost-report.html` & `task-cost-report.js`)

**Files:**
- Create: `task-cost-report.html`
- Create: `assets/js/pages/task-cost-report.js`
- Test: `test/test-task-cost-report.js`

**Interfaces:**
- Consumes: `WAGE_API.getTaskCostSummary(taskId)`, `WAGE_UTILS`
- Produces: Cost report page showing task metadata, KPI cards (Actual Days, Total Man-Days, Raw Labor Cost, Customer Markup Cost), worker breakdown table, and print button.

- [ ] **Step 1: Write test script to verify report structure and syntax**
Create `test/test-task-cost-report.js` to verify report HTML elements and script syntax.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-task-cost-report.js`
Expected: FAIL

- [ ] **Step 3: Create `task-cost-report.html` and `assets/js/pages/task-cost-report.js`**
Implement the report UI, aggregation data bindings, worker breakdown table, and print styling.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-task-cost-report.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add task-cost-report.html assets/js/pages/task-cost-report.js test/test-task-cost-report.js
git commit -m "feat: add task costing and effort summary report"
```

---

### Task 7: ผสานระบบเบิกงวดและคงยอดสะสมในแดชบอร์ด (`dashboard.js`) และการทดสอบครบวงจร (End-to-End)

**Files:**
- Modify: `assets/js/pages/dashboard.js`
- Create: `test/test-e2e-workflow.js`

**Interfaces:**
- Consumes: `WAGE_API.snapshotActiveTasksBeforeClear()`, `WAGE_API.clearAllLogs()`
- Produces: Safe log clearing that preserves unfinished task costs into `accumulated_*` fields.

- [ ] **Step 1: Write End-to-End simulation test script**
Create `test/test-e2e-workflow.js` to simulate:
  1. Creating a Task (TSK-001)
  2. Recording daily log for morning (4 hours Task A) and afternoon (4 hours Task B)
  3. Recording daily log for another day (reaching 80% progress and logging an issue)
  4. Performing "เบิกงวด / ล้างบันทึก" and verifying Task A still has its accumulated cost and man-days intact
  5. Closing Task A (100% and completion summary)
  6. Generating final cost report and verifying totals match.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/test-e2e-workflow.js`
Expected: FAIL

- [ ] **Step 3: Update `assets/js/pages/dashboard.js`**
Ensure that before clearing logs, `snapshotActiveTasksBeforeClear()` is executed.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/test-e2e-workflow.js`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add assets/js/pages/dashboard.js test/test-e2e-workflow.js
git commit -m "feat: integrate wage cycle snapshot and verify end-to-end task costing flow"
```
