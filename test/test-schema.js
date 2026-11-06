const fs = require('fs');
const path = require('path');
const assert = require('assert');

const schemaPath = path.resolve(__dirname, '../supabase/schema.sql');
console.log('Testing schema at:', schemaPath);

assert(fs.existsSync(schemaPath), 'schema.sql must exist');
const content = fs.readFileSync(schemaPath, 'utf8');

// Extract the CREATE TABLE public.tasks statement block
const tasksTableMatch = content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.tasks\s*\(([\s\S]*?)\);/i);

const taskColumns = [
  { name: 'id', regex: /id\s+BIGINT\s+GENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\s+PRIMARY\s+KEY/i },
  { name: 'task_code', regex: /task_code\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i },
  { name: 'title', regex: /title\s+TEXT\s+NOT\s+NULL/i },
  { name: 'site', regex: /site\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+''/i },
  { name: 'location_detail', regex: /location_detail\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'assigned_to', regex: /assigned_to\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'ordered_by', regex: /ordered_by\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'order_date', regex: /order_date\s+DATE\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_DATE/i },
  { name: 'due_date', regex: /due_date\s+DATE/i },
  { name: 'status', regex: /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'Pending'\s+CHECK\s*\(\s*status\s+IN\s*\('Pending',\s*'In Progress',\s*'Blocked',\s*'Completed'\)\s*\)/i },
  { name: 'progress_percent', regex: /progress_percent\s+INT\s+NOT\s+NULL\s+DEFAULT\s+0\s+CHECK\s*\(\s*progress_percent\s+BETWEEN\s+0\s+AND\s+100\s*\)/i },
  { name: 'description', regex: /description\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'issues', regex: /issues\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'resolution', regex: /resolution\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'completion_summary', regex: /completion_summary\s+TEXT\s+DEFAULT\s+''/i },
  { name: 'progress_history', regex: /progress_history\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/i },
  { name: 'accumulated_cost', regex: /accumulated_cost\s+NUMERIC\(12,\s*2\)\s+NOT\s+NULL\s+DEFAULT\s+0/i },
  { name: 'accumulated_markup_cost', regex: /accumulated_markup_cost\s+NUMERIC\(12,\s*2\)\s+NOT\s+NULL\s+DEFAULT\s+0/i },
  { name: 'accumulated_hours', regex: /accumulated_hours\s+NUMERIC\(8,\s*2\)\s+NOT\s+NULL\s+DEFAULT\s+0/i },
  { name: 'accumulated_man_days', regex: /accumulated_man_days\s+NUMERIC\(8,\s*2\)\s+NOT\s+NULL\s+DEFAULT\s+0/i },
  { name: 'accumulated_days', regex: /accumulated_days\s+INT\s+NOT\s+NULL\s+DEFAULT\s+0/i },
  { name: 'created_at', regex: /created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i },
  { name: 'updated_at', regex: /updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i }
];

const generalChecks = [
  { name: 'Index: idx_tasks_status', regex: /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_tasks_status\s+ON\s+public\.tasks\s*\(\s*status\s*\);/i },
  { name: 'Index: idx_tasks_site', regex: /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_tasks_site\s+ON\s+public\.tasks\s*\(\s*site\s*\);/i },
  { name: 'Index: idx_tasks_task_code', regex: /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_tasks_task_code\s+ON\s+public\.tasks\s*\(\s*task_code\s*\);/i },
  { name: 'RLS: Enable tasks RLS', regex: /ALTER\s+TABLE\s+public\.tasks\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/i },
  { name: 'RLS: Drop existing tasks policy', regex: /DROP\s+POLICY\s+IF\s+EXISTS\s+"Allow public access on tasks"\s+ON\s+public\.tasks;/i },
  { name: 'RLS: Create tasks policy', regex: /CREATE\s+POLICY\s+"Allow public access on tasks"\s+ON\s+public\.tasks\s+FOR\s+ALL\s+USING\s*\(true\)\s+WITH\s+CHECK\s*\(true\);/i },
  { name: 'Migration: ALTER TABLE public.daily_logs ADD COLUMN task_id', regex: /ALTER\s+TABLE\s+public\.daily_logs\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+task_id\s+BIGINT\s+REFERENCES\s+public\.tasks\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL;/i },
  { name: 'Migration: CREATE INDEX idx_daily_logs_task_id', regex: /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_daily_logs_task_id\s+ON\s+public\.daily_logs\s*\(\s*task_id\s*\);/i }
];

let failed = 0;

if (!tasksTableMatch) {
  console.error('[FAIL] Table public.tasks not found in schema.sql');
  failed++;
  for (const col of taskColumns) {
    console.error(`  [FAIL] Column tasks.${col.name} (table missing)`);
    failed++;
  }
} else {
  console.log('[PASS] Table public.tasks found');
  const tableBody = tasksTableMatch[1];
  for (const col of taskColumns) {
    if (col.regex.test(tableBody)) {
      console.log(`  [PASS] Column tasks.${col.name}`);
    } else {
      console.error(`  [FAIL] Column tasks.${col.name}`);
      failed++;
    }
  }
}

for (const check of generalChecks) {
  if (check.regex.test(content)) {
    console.log(`[PASS] ${check.name}`);
  } else {
    console.error(`[FAIL] ${check.name}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\nTotal failures: ${failed}`);
  process.exit(1);
} else {
  console.log(`\nAll ${taskColumns.length + generalChecks.length + 1} checks passed successfully.`);
  process.exit(0);
}
