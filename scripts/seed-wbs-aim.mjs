// Phase 8 one-off WBS rebuild for the AIM project: 13 parent tasks
// (one per section of the Rooyesh plan) + re-parent the 39 existing
// tasks under them. PREPARED ONLY — not run: it needs the live login
// (the migration + this script run in Yasin's hands; see README-D3).
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   [AIM_PROJECT_ID=<uuid>] \
//   node scripts/seed-wbs-aim.mjs [--dry-run]
//
// --dry-run prints the plan and writes nothing. Without the service-role
// key the script refuses with a clear message and writes nothing — the
// key is never hardcoded, never logged, and never printed here.
// Run AFTER the tasks.parent_id migration
// (sql/2026-11-23-tasks-parent-id.sql) — the script checks for the
// column first and refuses with a clear message when it is missing.
// This is NOT a live test: it only creates parent tasks and sets
// tasks.parent_id (no RLS change, no other column touched).
//
// Mapping (from the plan itself, ~/workspace/aim-rooyesh-plan.md):
//   * «نوشتن متن بخش N» → section N (13 tasks).
//   * «نیازسنجی، سؤال N» → the NEED_SECTION map in the plan §ب-۳
//     (each question lists the section it feeds): 1→1, 2→3, 3→3, 4→8,
//     5→8, 6→11, 7→2, 8→7, 9→10, 10→11, 11→3, 12→13, 13→13.
//   * «پذیرش، مرحله N» → the admission chain (§ب-۴): steps about
//     documents/registration/evaluation → 11 (مدارک و الزامات پذیرش);
//     step 2 (writing the plan) → 1; steps 9–10 (mid/end evaluations)
//     → 9 (برنامهٔ اجرایی); step 11 (entering Shekoufaei) → 13.
//   * «تکمیل کاربرگ رسمی رویش» → 11 (the worksheet is a مدارک item).
//   * «پاسخ به ۸ گروه سؤال پارک» → 2 (the first group is مسئله; the
//     single task spans all 8 groups — §ب-۵ — so it sits under the
//     first group it answers).
// The 39 existing tasks match these patterns exactly; anything else is
// reported as UNMATCHED and the script exits 1 without writing.
import { createClient } from '@supabase/supabase-js'

const SECTION_NAMES = {
  1: 'خلاصهٔ ایده و معرفی هسته',
  2: 'مسئله، نیاز بازار و مشتری هدف',
  3: 'سطح آمادگی فناوری (TRL) و اثبات مفهومی',
  4: 'امکان‌پذیری فنی و عملیاتی',
  5: 'محصول، نمونهٔ اولیه و دستاورد نهایی',
  6: 'قابلیت تجاری‌سازی و مدل کسب‌وکار',
  7: 'بازار، رقبا و مزیت رقابتی',
  8: 'تیم کاری هسته و تقسیم نقش‌ها',
  9: 'برنامهٔ اجرایی و زمان‌بندی دوره',
  10: 'برآورد هزینه‌ها و برنامهٔ مالی',
  11: 'مدارک و الزامات پذیرش',
  12: 'ریسک‌ها و برنامهٔ جایگزین',
  13: 'مسیر پس از رویش: از هسته تا شرکت AIM'
}

const NEED_SECTION = { 1: 1, 2: 3, 3: 3, 4: 8, 5: 8, 6: 11, 7: 2, 8: 7, 9: 10, 10: 11, 11: 3, 12: 13, 13: 13 }
const ADMISSION_SECTION = { 1: 11, 2: 1, 3: 11, 4: 11, 5: 11, 6: 11, 7: 11, 8: 11, 9: 9, 10: 9, 11: 13 }
const WORKSHEET_SECTION = 11
const PARK_GROUPS_SECTION = 2

// عنوان‌های کارها ارقام فارسی دارند («بخش ۳»، «سؤال ۱») — \d در
// جاوااسکریپت فقط لاتین می‌خواند؛ این تابع هر دو را به عدد می‌کند.
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
function faToNum(s) {
  let out = ''
  for (const ch of String(s)) {
    const i = FA_DIGITS.indexOf(ch)
    out += i >= 0 ? String(i) : ch
  }
  return Number(out)
}

function sectionForTask(title) {
  const t = title || ''
  let m = t.match(/^نوشتن متن بخش\s*([0-9۰-۹]+)/)
  if (m) return faToNum(m[1])
  m = t.match(/^نیازسنجی، س[ؤو]ال\s*([0-9۰-۹]+)/)
  if (m) return NEED_SECTION[faToNum(m[1])] || null
  m = t.match(/^پذیرش، مرحله\s*([0-9۰-۹]+)/)
  if (m) return ADMISSION_SECTION[faToNum(m[1])] || null
  if (t.includes('کاربرگ')) return WORKSHEET_SECTION
  if (t.includes('گروه سؤال پارک') || t.includes('گروه سوال پارک')) return PARK_GROUPS_SECTION
  return null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'seed-wbs refus: SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY را در env بگذارید؛ بدون کلید service_role هیچ‌چیز خوانده/نوشته نمی‌شود.'
    )
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // The parent_id column must exist first (migration in the SQL Editor).
  const { error: colErr } = await sb.from('tasks').select('parent_id').limit(1)
  if (colErr) {
    console.error(
      'seed-wbs refus: ستون tasks.parent_id روی دادهٔ زنده نیست — اول sql/2026-11-23-tasks-parent-id.sql را در SQL Editor اجرا کنید. خطا: ' +
        (colErr.message || String(colErr))
    )
    process.exit(1)
  }

  let projectId = process.env.AIM_PROJECT_ID || null
  if (!projectId) {
    const { data, error } = await sb
      .from('projects')
      .select('id')
      .eq('name', 'طرح رویش شرکت AIM')
      .single()
    if (error || !data) {
      console.error('seed-wbs refus: پروژهٔ «طرح رویش شرکت AIM» پیدا نشد (AIM_PROJECT_ID را بدهید).')
      process.exit(1)
    }
    projectId = data.id
  }

  const { data: tasks, error } = await sb
    .from('tasks')
    .select('id, title, parent_id, created_by, status')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) {
    console.error('seed-wbs: خواندن کارها رد شد:', error.message || String(error))
    process.exit(1)
  }
  const rows = tasks || []
  console.log('seed-wbs' + (dryRun ? ' --dry-run (هیچ‌چیز نوشته نشد)' : '') + ': ' + rows.length + ' کار در پروژه')

  const unmatched = []
  const bySection = {}
  for (const t of rows) {
    const section = sectionForTask(t.title)
    if (!section) {
      unmatched.push(t.title)
      continue
    }
    if (!bySection[section]) bySection[section] = []
    bySection[section].push(t)
  }
  if (unmatched.length > 0) {
    console.error('seed-wbs: ' + unmatched.length + ' کار با هیچ الگویی جور نشد — هیچ‌چیز نوشته نشد:')
    for (const title of unmatched) console.error('  UNMATCHED: ' + title)
    process.exit(1)
  }

  // Parent tasks: create the missing ones (idempotent by exact title).
  const parentTitles = Object.entries(SECTION_NAMES).map(
    ([n, name]) => 'بخش ' + n + ' — ' + name
  )
  const existingParents = new Map()
  for (const t of rows) {
    if (parentTitles.includes(t.title)) existingParents.set(t.title, t)
  }
  // created_by for new parents: the most common creator of the 39 tasks.
  const creatorCounts = {}
  for (const t of rows) {
    if (t.created_by) creatorCounts[t.created_by] = (creatorCounts[t.created_by] || 0) + 1
  }
  const creatorId = Object.entries(creatorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  const counts = { parentsCreated: 0, parentsExisting: 0, reparented: 0, already: 0 }
  const parentIds = {}
  for (const [n, name] of Object.entries(SECTION_NAMES)) {
    const title = 'بخش ' + n + ' — ' + name
    const existing = existingParents.get(title)
    if (existing) {
      parentIds[n] = existing.id
      counts.parentsExisting++
      continue
    }
    if (dryRun) {
      console.log('  would create parent: ' + title)
      parentIds[n] = '(dry-run)'
      counts.parentsCreated++
      continue
    }
    const { data: created, error: cErr } = await sb
      .from('tasks')
      .insert({
        project_id: projectId,
        title,
        description: 'مایلستون بخش ' + n + ' طرح رویش — والد زیروظیفه‌های این بخش.',
        status: 'todo',
        created_by: creatorId,
        visibility: 'project',
        custom_fields: {}
      })
      .select('id')
      .single()
    if (cErr) {
      console.error('seed-wbs: ساختن والد «' + title + '» رد شد:', cErr.message || String(cErr))
      process.exit(1)
    }
    parentIds[n] = created.id
    counts.parentsCreated++
  }

  for (const [section, children] of Object.entries(bySection)) {
    for (const child of children) {
      if (child.parent_id === parentIds[section]) {
        counts.already++
        continue
      }
      if (dryRun) {
        console.log('  would re-parent: «' + child.title + '» → بخش ' + section)
        counts.reparented++
        continue
      }
      const { error: uErr } = await sb
        .from('tasks')
        .update({ parent_id: parentIds[section] })
        .eq('id', child.id)
      if (uErr) {
        console.error('seed-wbs: انتقال «' + child.title + '» رد شد:', uErr.message || String(uErr))
        process.exit(1)
      }
      counts.reparented++
    }
  }
  console.log('seed-wbs done:', JSON.stringify(counts))
  console.log(
    'seed-wbs: والدها ۱۳ بخش؛ زیروظیفه‌ها ' +
      Object.entries(bySection)
        .map(([s, c]) => 'بخش ' + s + ': ' + c.length)
        .join('، ')
  )
}

main().catch((e) => {
  console.error('seed-wbs failed:', e.message || String(e))
  process.exit(1)
})
