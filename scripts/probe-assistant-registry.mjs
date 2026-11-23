// Assistant registry + open-chat + home handover probes (Node, no
// network, no live data).
//
// Layers:
//  1. STATIC (source text of the registry): 31 entries, 30 numbered
//     chips + open-chat (n: null), the 30 numbers are exactly the
//     100-list set, 12 groups, 7 §3-4 prompts with system text, 4 AI
//     actions, G6_META 24, no hardcoded «۸ پیام» in the teaser.
//  2. MOUNT (the REAL built bundle in jsdom with a stubbed Supabase
//     backend + a stubbed /functions/v1/ai-assistant route): chips
//     render from the registry, the AI room/doc summaries and the
//     ask/chat answers render with honest labels and sources, the
//     open-chat exchange is saved to assistant_messages and reloads
//     on a fresh mount, the guardian still records only on tap, the
//     suggestion rows still say «پیش‌فرض», the extractive fallback
//     renders with an explicit notice when the function fails (500)
//     or is rate-limited (429), and the home «از میوز بپرس» input
//     hands its question to the open chat.
//
// HERMETIC BUILD (same as probe-g6): this probe BUILDS the bundle
// itself with the probe Supabase URL + placeholder key before
// mounting, and refuses to mount a bundle that is not
// probe-configured.
//
// Usage:
//   node scripts/probe-assistant-registry.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { encodeDocState } from '../src/lib/yjs-sync.js'
import { tehranDayKey, addTehranDays } from '../src/lib/extract.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'

const EXPECTED_NUMBERS = [
  1, 3, 8, 11, 13, 15, 21, 23, 25, 27, 31, 33, 36, 41, 45, 49, 54, 57,
  58, 59, 63, 64, 71, 72, 77, 84, 85, 92, 95, 99
]
const EXPECTED_GROUPS = [
  'الف — پروژه‌ها', 'ب — اتاق‌ها و پیام‌ها', 'ج — ترد، منشن، اعلان',
  'د — سندها', 'ه — نظرها و نسخه‌ها', 'و — فایل‌ها',
  'ز — کارها و برنامه‌ریز', 'ح — یادآوری‌ها', 'ط — جست‌وجو و پرس‌وجو',
  'ی — داشبورد و نبض تیم', 'ک — اعضا و تیم', 'ل — قالب‌ها و شروع سریع'
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// ---------- 1. STATIC ----------

function staticChecks() {
  const src = readFileSync(new URL('../src/lib/assistant-prompts.js', import.meta.url).pathname, 'utf8')
  const entryIds = [...src.matchAll(/^\s+id: '([a-z-]+)',/gm)].map((m) => m[1])
  check('registry: 31 entries (30 chips + open-chat)', entryIds.length === 31, String(entryIds.length))
  check('registry: entry ids are unique', new Set(entryIds).size === entryIds.length)
  const numbers = [...src.matchAll(/\bn: (\d+),/g)].map((m) => Number(m[1]))
  check(
    'registry: 30 numbered entries, exactly the 100-list set',
    numbers.length === 30 &&
      JSON.stringify([...numbers].sort((a, b) => a - b)) === JSON.stringify(EXPECTED_NUMBERS),
    JSON.stringify([...numbers].sort((a, b) => a - b))
  )
  check('registry: open-chat is the only unnumbered entry', (src.match(/^\s+n: null,/gm) || []).length === 1)
  check('registry: open-chat is the only chip:false entry', (src.match(/^\s+chip: false,/gm) || []).length === 1)
  const groups = [...new Set([...src.matchAll(/group: '([^']+)'/g)].map((m) => m[1]))].sort()
  check(
    'registry: 12 groups',
    groups.length === 12 && JSON.stringify(groups) === JSON.stringify([...EXPECTED_GROUPS].sort()),
    JSON.stringify(groups)
  )
  const aiTrue = (src.match(/^\s+ai: true,/gm) || []).length
  check('registry: exactly 4 AI actions (summarize-room/doc, ask, open-chat)', aiTrue === 4, String(aiTrue))
  check(
    'registry: the 4 AI action ids are the §3-4 ones',
    ['summarize-room', 'summarize-doc', 'ask-workspace', 'open-chat'].every((id) => src.includes(`id: '${id}'`))
  )
  check(
    'registry: suggest-task-* and deadline-guardian are ai:false (package C)',
    ['suggest-task-from-chat', 'suggest-task-from-doc', 'deadline-guardian'].every((id) => {
      const i = src.indexOf(`id: '${id}'`)
      return i >= 0 && /ai: false/.test(src.slice(i, i + 600))
    })
  )
  const systems = (src.match(/^\s+system: '/gm) || []).length
  check('registry: 7 §3-4 prompts with system text', systems === 7, String(systems))
  const meta = src.match(/const G6_META = \{([\s\S]*?)\n\}/)
  const metaCount = meta ? (meta[1].match(/^\s+\d+:/gm) || []).length : 0
  check('registry: G6_META has 24 desc/scope entries', metaCount === 24, String(metaCount))

  const teaser = readFileSync(
    new URL('../src/components/IntroTeaser.svelte', import.meta.url).pathname,
    'utf8'
  )
  check('teaser: no hardcoded «۸ پیام» capability claim', !teaser.includes('۸ پیام'))
  check('teaser: station 19 is «خط‌های برگزیدهٔ اتاق»', teaser.includes('خط‌های برگزیدهٔ اتاق'))

  const home = readFileSync(
    new URL('../src/components/HomeView.svelte', import.meta.url).pathname,
    'utf8'
  )
  check('home: the ask input hands the question via sclack-ai-question', home.includes("localStorage.setItem('sclack-ai-question'"))

  // Finesse: no hardcoded command count anywhere in the UI — the
  // badge, the G6 heading and the teaser rail all derive it from
  // the registry at render time.
  const uiFiles = ['AssistantView', 'IntroTeaser', 'Sidebar', 'HomeView'].map((n) =>
    readFileSync(new URL(`../src/components/${n}.svelte`, import.meta.url).pathname, 'utf8')
  )
  check(
    'counts: no hardcoded «۳۰ دستور» / «۲۴ دستور تازه» in any UI file',
    uiFiles.every((s) => !s.includes('۳۰ دستور') && !s.includes('۲۴ دستور تازه'))
  )
  check(
    'counts: the badge derives its number from the registry',
    uiFiles[0].includes('{faNum(CHIP_COUNT)} دستور') && uiFiles[0].includes('CHIP_COUNT = AI_GROUPS.reduce')
  )
  check(
    'counts: the G6 heading derives both numbers from the registry',
    uiFiles[0].includes('{faNum(G6_NEW_COUNT)} دستور تازه از {faNum(CHIP_COUNT)} دستور برتر')
  )
  check(
    'counts: the teaser rail derives its number from the registry',
    uiFiles[1].includes('{faNum(chipCount)} دستور') && uiFiles[1].includes("chipGroups().reduce")
  )
  const sidebar = uiFiles[2]
  check(
    'sidebar: subtitle no longer claims «چیزی نمی‌سازد»',
    !sidebar.includes('چیزی نمی‌سازد') && sidebar.includes('با ذکر منبع') && sidebar.includes('«پیدا نشد» می‌گوید')
  )
  const core = readFileSync(
    new URL('../src/lib/assistant-core.js', import.meta.url).pathname,
    'utf8'
  )
  check(
    'core: timeout gets its own clear Persian notice',
    core.includes("res.reason === 'timeout'") && core.includes('هوش دیر جواب داد')
  )
  check(
    'core: invoke-error gets its own clear Persian notice',
    core.includes("res.reason === 'invoke-error'") && core.includes('ارتباط با هوش برقرار نشد')
  )
  check(
    'core: daily cap still has its own clear Persian notice',
    core.includes('سقف روزانهٔ هوش پر شده')
  )
}

// ---------- 2. SEED + STUB ----------

function encodeText(text) {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return encodeDocState(doc)
}

function makeDb() {
  return {
    members: [],
    projects: [],
    rooms: [],
    docs: [],
    messages: [],
    files: [],
    tasks: [],
    comments: [],
    templates: [],
    versions: [],
    reminders: [],
    notifications: [],
    integrations: [],
    assistant_messages: []
  }
}

function seed(db, now) {
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  const iso = (d) => new Date(d).toISOString()
  db.members.push({
    id: MEMBER2_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', username: 'zahraariapour97',
    avatar: null, joined_at: iso(now), auth_id: ZAHRA_USER_ID
  })
  db.projects.push({
    id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null,
    icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false,
    custom_fields: { goal: 'هدف پروب', deadline: tehranDayKey(addTehranDays(now, 3)), stage: 'active', member_ids: [MEMBER_ID, MEMBER2_ID] }
  })
  db.rooms.push({
    id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null,
    member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {}
  })
  db.docs.push({
    id: DOC_ID, project_id: PROJECT_ID, title: 'سند تازه', yjs_doc_id: 'doc-reg-1', template_id: null,
    created_by: MEMBER_ID, created_at: isoAt(-3, '10:00:00'), updated_at: isoAt(0, '08:00:00'), version: 1,
    visibility: 'project',
    custom_fields: { yjs_state_b64: encodeText('باید بودجهٔ پروژه را بررسی کنیم\nمتن عادی') }
  })
  db.messages.push(
    { id: 'msg-1', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'باید گزارش ماهانه را آماده کنیم', parent_id: null, created_at: isoAt(0, '09:00:00'), visibility: 'project' },
    { id: 'msg-2', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سلام، امروز جلسه داریم؟', parent_id: null, created_at: isoAt(0, '10:00:00'), visibility: 'project' },
    { id: 'msg-3', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پیام دیروز', parent_id: null, created_at: isoAt(-1, '15:00:00'), visibility: 'project' },
    { id: 'msg-4', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سؤال', parent_id: null, created_at: isoAt(0, '08:00:00'), visibility: 'project' },
    { id: 'msg-5', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ به سؤال', parent_id: 'msg-4', created_at: isoAt(0, '09:30:00'), visibility: 'project' },
    { id: 'msg-6', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'بحث اصلی ترد', parent_id: null, created_at: isoAt(0, '07:00:00'), visibility: 'project' },
    { id: 'msg-7', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ اول به ترد', parent_id: 'msg-6', created_at: isoAt(0, '09:00:00'), visibility: 'project' },
    { id: 'msg-8', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'پاسخ دوم به ترد', parent_id: 'msg-6', created_at: isoAt(0, '09:15:00'), visibility: 'project' }
  )
  const task = (id, title, assignee, dueAt, status, createdOffset, completedAt = null) => ({
    id, project_id: PROJECT_ID, title, description: null, assignee_id: assignee,
    status, due_at: dueAt, completed_at: status === 'done' ? (completedAt || iso(now)) : null,
    created_by: MEMBER_ID, created_at: isoAt(createdOffset, '10:00:00'), visibility: 'project',
    custom_fields: { link_type: null, link_id: null }
  })
  db.tasks.push(
    task('task-today', 'کار امروز من', MEMBER_ID, isoAt(0, '23:59:00'), 'todo', -1),
    task('task-overdue', 'کار عقب‌مانده', MEMBER2_ID, isoAt(-1, '10:00:00'), 'todo', -2),
    task('task-undated', 'کار بدون سررسید', MEMBER_ID, null, 'todo', -1),
    task('task-unassigned', 'کار بدون مسئول', null, isoAt(1, '23:59:00'), 'todo', -1),
    task('task-done-today', 'کار تمام‌شدهٔ امروز', MEMBER_ID, isoAt(0, '23:59:00'), 'done', -3, isoAt(0, '09:00:00')),
    task('task-done-old', 'کار تمام‌شدهٔ قدیمی', MEMBER2_ID, isoAt(-10, '10:00:00'), 'done', -11, isoAt(-10, '09:00:00'))
  )
  db.files.push(
    { id: 'file-1', project_id: PROJECT_ID, name: 'تازه.txt', size: 1024, uploaded_by: MEMBER_ID, uploaded_at: isoAt(0, '08:30:00'), attached_to_type: null, attached_to_id: null },
    { id: 'file-2', project_id: PROJECT_ID, name: 'قدیمی.txt', size: 2048, uploaded_by: MEMBER_ID, uploaded_at: isoAt(-10, '10:00:00'), attached_to_type: null, attached_to_id: null }
  )
  db.reminders.push(
    { id: 'rem-1', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری امروز', remind_at: isoAt(0, '23:59:00'), done: false, created_at: iso(now) },
    { id: 'rem-2', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری عقب‌مانده', remind_at: isoAt(-1, '09:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-3', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری فردا', remind_at: isoAt(1, '12:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-4', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری انجام‌شده', remind_at: isoAt(-1, '09:00:00'), done: true, created_at: iso(now) }
  )
  db.notifications.push(
    { id: 'n1', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-2', read: false, created_at: isoAt(0, '10:05:00') },
    { id: 'n2', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-7', read: true, created_at: isoAt(-1, '10:00:00') },
    { id: 'n3', user_id: MEMBER_ID, type: 'reply', target_id: 'msg-5', read: false, created_at: isoAt(0, '09:35:00') },
    // n4 deliberately targets a DONE task, not the overdue one — so
    // the guardian's de-dup does not see the overdue pointer as
    // already recorded, and the tap can prove a fresh pointer is made.
    { id: 'n4', user_id: MEMBER_ID, type: 'reminder', target_id: 'task-done-old', read: false, created_at: isoAt(0, '09:00:00') }
  )
  db.comments.push(
    { id: 'c1', doc_id: DOC_ID, author_id: MEMBER2_ID, body: 'نظر باز روی سند', anchor: { quote: 'بودجه' }, resolved: false, parent_id: null, created_at: isoAt(0, '08:00:00'), visibility: 'project' },
    { id: 'c2', doc_id: DOC_ID, author_id: MEMBER_ID, body: 'نظر حل‌شده', anchor: null, resolved: true, parent_id: null, created_at: isoAt(-1, '08:00:00'), visibility: 'project' }
  )
  db.versions.push(
    { id: 'ver-1', doc_id: DOC_ID, version_no: 1, snapshot_ref: null, author_id: MEMBER_ID, note: 'نسخهٔ اول', created_at: isoAt(-3, '10:00:00') },
    { id: 'ver-2', doc_id: DOC_ID, version_no: 2, snapshot_ref: null, author_id: MEMBER2_ID, note: 'نسخهٔ دوم', created_at: isoAt(0, '08:00:00') }
  )
  db.templates.push(
    { id: 'tpl-1', name: 'یادداشت جلسه', type: 'doc', structure: { kind: 'doc', skeleton: 'دستور جلسه\n\nحاضرین' }, created_by: MEMBER_ID, created_at: iso(now) },
    { id: 'tpl-2', name: 'فهرست کار', type: 'doc', structure: { kind: 'doc', skeleton: 'فهرست کار\n\n۱. ' }, created_by: MEMBER_ID, created_at: iso(now) }
  )
}

function makeStub(db) {
  // fnMode: 'ok' | 'fail' (500 model_error) | 'rate-limited' (429) |
  // 'not-configured' (503) | 'hang' (never resolves — the client's
  // 30s timeout must fire). The fixture answers cite only ids the
  // client sent, like the real function would.
  const stub = { fnMode: 'ok', calls: { fnBodies: [] } }

  function ilikeMatch(value, pattern) {
    let p = pattern
    if (p.startsWith('%')) p = p.slice(1)
    if (p.endsWith('%') && !p.endsWith('\\%')) p = p.slice(0, -1)
    p = p.replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\\\/g, '\\')
    return (value || '').toLowerCase().includes(p.toLowerCase())
  }

  function rowMatches(row, params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
      const m = val.match(/^([a-z_]+)\.(.*)$/)
      if (!m) continue
      const [, op, raw] = m
      const v = row[key]
      if (op === 'eq') {
        if (String(v) !== raw && !(v === false && raw === 'false') && !(v === true && raw === 'true')) return false
      } else if (op === 'ilike') {
        if (!ilikeMatch(v, raw)) return false
      } else if (op === 'neq') {
        if (String(v) === raw) return false
      } else if (op === 'in') {
        const vals = raw.replace(/^\(|\)$/g, '').split(',')
        if (!vals.includes(String(v))) return false
      }
    }
    const orParam = params.get('or')
    if (orParam) {
      const parts = orParam.split(',')
      const ok = parts.some((part) => {
        const m = part.match(/^([a-z_]+)\.ilike\.(.*)$/)
        if (!m) return false
        return ilikeMatch(row[m[1]], m[2])
      })
      if (!ok) return false
    }
    return true
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  async function handleRest(url, method, headers, bodyText) {
    const u = new URL(url)
    const table = u.pathname.split('/').pop()
    const params = u.searchParams
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object+json')
    const order = params.get('order') || ''
    const rows = db[table]
    if (!rows) return json({ message: 'table not found: ' + table }, 404)

    if (method === 'GET') {
      let out = rows.filter((r) => rowMatches(r, params))
      if (order) {
        const [col, dir] = order.split('.')
        out = [...out].sort((a, b) => {
          const av = a[col] ?? ''
          const bv = b[col] ?? ''
          return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
        })
      }
      const limit = params.get('limit')
      if (limit) out = out.slice(0, Number(limit))
      out = out.map((r) => {
        const c = { ...r }
        if (table === 'messages') {
          const room = db.rooms.find((x) => x.id === r.room_id)
          c.rooms = room ? { name: room.name } : null
        }
        if (['docs', 'files', 'tasks'].includes(table)) {
          const p = db.projects.find((x) => x.id === r.project_id)
          c.projects = p ? { name: p.name } : null
        }
        return c
      })
      if (single) {
        if (out.length !== 1) return json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
        return json(out[0])
      }
      return json(out)
    }

    if (method === 'POST') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const onConflict = params.get('on_conflict') || params.get('onConflict')
      const now = new Date().toISOString()
      const row = { ...body }
      if (table === 'projects' && row.archived === undefined) row.archived = false
      if (table === 'projects' && row.custom_fields === undefined) row.custom_fields = {}
      if (!row.id) {
        if (table === 'members' && body.auth_id === USER_ID) row.id = MEMBER_ID
        else if (table === 'members' && body.auth_id === ZAHRA_USER_ID) row.id = MEMBER2_ID
        else row.id = 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at) row.created_at = now
      if (onConflict) {
        const existing = rows.find((r) => String(r[onConflict]) === String(body[onConflict]))
        if (existing) {
          Object.assign(existing, row)
          return single ? json(existing) : json([existing])
        }
      }
      rows.push(row)
      return single ? json(row) : json([row])
    }

    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (single) return matched.length === 1 ? json(matched[0]) : json({ message: 'JSON object requested, multiple (or no) rows returned' }, 406)
      return new Response(null, { status: 204 })
    }

    if (method === 'DELETE') {
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      return json(matched)
    }

    return json({ message: 'unsupported method ' + method }, 405)
  }

  function handleFunction(bodyText) {
    const body = bodyText ? JSON.parse(bodyText) : {}
    stub.calls.fnBodies.push(body)
    if (stub.fnMode === 'hang') return new Promise(() => {}) // never resolves: the client's 30s timeout must fire
    if (stub.fnMode === 'fail') return json({ error: 'model_error' }, 500)
    if (stub.fnMode === 'rate-limited') return json({ error: 'rate_limited' }, 429)
    if (stub.fnMode === 'not-configured') return json({ error: 'not_configured' }, 503)
    if (body.action === 'summarize-room') {
      return json({ found: true, points: [{ text: 'خلاصهٔ واقعیِ اتاق: گزارش ماهانه باید آماده شود', source_ids: ['msg-1'] }] })
    }
    if (body.action === 'summarize-doc') {
      return json({ found: true, points: [{ text: 'نکتهٔ واقعیِ سند: بودجهٔ پروژه بررسی شود', paragraph: 1 }] })
    }
    if (body.action === 'ask-workspace' || body.action === 'open-chat') {
      return json({ found: true, answer: 'جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.', sources: [{ table: 'message', id: 'msg-2' }] })
    }
    return json({ error: 'unknown_action' }, 400)
  }

  async function stubFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {})
    const rawBody = init.body || (typeof input !== 'string' && input.body) || null
    const bodyText = typeof rawBody === 'string' ? rawBody : null
    if (url.startsWith(BASE_URL + '/rest/v1/')) {
      return handleRest(url, method, headers, bodyText)
    }
    if (url.startsWith(BASE_URL + '/functions/v1/ai-assistant')) {
      return handleFunction(bodyText)
    }
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  stub.stubFetch = stubFetch
  stub.db = db
  return stub
}

// ---------- 3. HARNESS ----------

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function fakeSession(userId = USER_ID, email = 'yasin@probe.test') {
  const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' +
    b64url({ sub: userId, email, aud: 'authenticated', exp: 9999999999 }) + '.sig'
  return {
    access_token: jwt,
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated' }
  }
}

function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
}

function buildProbeBundle() {
  console.log('building probe bundle (probe URL + placeholder key)…')
  try {
    execFileSync('npm', ['run', 'build'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: BASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: PLACEHOLDER_KEY
      },
      stdio: 'inherit'
    })
  } catch (e) {
    throw new Error('probe build failed (npm run build): ' + (e.message || e))
  }
}

function assertProbeConfigured(js) {
  if (!js.includes('probe-ref')) {
    throw new Error('probe bundle is NOT probe-configured: built bundle has no probe-ref URL')
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error('probe bundle is NOT probe-configured: built bundle has no placeholder key')
  }
}

async function mountApp({ html, js }, stub, hash, session = fakeSession()) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
  virtualConsole.on('error', (msg) => errors.push('console.error: ' + String(msg)))
  const dom = new JSDOM(html, {
    url: 'http://localhost/sclack-a/' + hash,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const w = dom.window
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  if (!w.WebSocket) {
    w.WebSocket = class {
      constructor() { this.readyState = 0 }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
  }
  w.fetch = stub.stubFetch
  w.confirm = () => true
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    const jsForEval = js
      .replaceAll('import.meta.resolve', 'void 0')
      .replaceAll('import.meta.url', "'http://localhost/'")
      .replace(/export\{[^}]*\};?\s*$/, '')
    w.eval(jsForEval)
  } catch (e) {
    errors.push('eval threw: ' + (e.message || e))
  }
  return { dom, w, errors }
}

async function waitFor(w, fn, timeoutMs = 10000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fn()
      if (v) return v
    } catch { /* retry */ }
    await sleep(150)
  }
  const screen = (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400)
  throw new Error('timeout waiting for ' + label + ' — screen shows: ' + JSON.stringify(screen))
}

function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
function setSelect(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}
function clickIn(w, scope, label) {
  const btn = [...(scope || w.document).querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}
const section = (w, name) => w.document.querySelector(`[data-ai-section="${name}"]`)
const sectionText = (w, name) => norm(section(w, name)?.textContent || '')
// The chips render from the registry before the workspace data
// arrives — a select's options only exist once ws.* is loaded, so
// wait for the option before touching the select (else the value
// silently stays '' and the run button stays disabled).
async function waitForSelectOption(w, sectionName, value) {
  await waitFor(
    w,
    () => {
      const sel = section(w, sectionName)?.querySelector('select')
      return sel && [...sel.options].some((o) => o.value === value)
    },
    15000,
    `select option ${value} in ${sectionName}`
  )
}

// ---------- 4. MOUNT ----------

async function mountOk(bundle) {
  const now = new Date()
  const db = makeDb()
  seed(db, now)
  const stub = makeStub(db)
  stub.fnMode = 'ok'
  const { w, errors } = await mountApp(bundle, stub, '#/assistant')
  await waitFor(w, () => w.document.querySelector('.ai-chips'), 15000, 'assistant chips')

  // Chips render from the registry.
  check('mount: 30 chips render from the registry', w.document.querySelectorAll('[data-ai-chip]').length === 30)
  check('mount: 12 group labels render', w.document.querySelectorAll('.ai-chip-group-label').length === 12)
  check(
    'mount: 12 group labels are the registry groups',
    EXPECTED_GROUPS.every((g) =>
      [...w.document.querySelectorAll('.ai-chip-group-label')].some((el) => norm(el.textContent) === g)
    )
  )
  check('mount: 6 existing chips carry the «موجود» tag', w.document.querySelectorAll('.ai-chip-tag').length === 6)
  check('mount: AI status starts as «هنوز امتحان نشده»', norm(w.document.querySelector('[data-ai-status]')?.textContent || '').includes('هنوز امتحان نشده'))
  check('mount: the badge shows the derived chip count', norm(w.document.querySelector('.ai-badge')?.textContent || '') === '۳۰ دستور')
  check(
    'mount: the G6 heading shows the derived counts',
    norm(w.document.querySelector('[data-g6-area]')?.textContent || '').includes('۲۴ دستور تازه از ۳۰ دستور برتر')
  )

  // Room summary, AI path.
  await waitForSelectOption(w, 'room', ROOM_ID)
  const roomSection = section(w, 'room')
  setSelect(w, roomSection.querySelector('select'), ROOM_ID)
  await sleep(300) // Svelte flush: the run button enables only after it
  clickIn(w, roomSection, 'خلاصه کن')
  await waitFor(w, () => sectionText(w, 'room').includes('خلاصهٔ واقعی'), 10000, 'AI room summary')
  check('mount: room summary is the real AI summary', sectionText(w, 'room').includes('خلاصهٔ واقعیِ اتاق: گزارش ماهانه باید آماده شود'))
  check('mount: room summary cites its source', sectionText(w, 'room').includes('منبع: 1 پیام در اتاق'))
  check('mount: room summary shows no extractive badge', !sectionText(w, 'room').includes('خط‌های برگزیده'))
  check('mount: AI status is «هوش وصل است» after a real call', norm(w.document.querySelector('[data-ai-status]')?.textContent || '').includes('هوش وصل است'))

  // Doc summary, AI path.
  await waitForSelectOption(w, 'doc', DOC_ID)
  const docSection = section(w, 'doc')
  setSelect(w, docSection.querySelector('select'), DOC_ID)
  await sleep(300)
  clickIn(w, docSection, 'خلاصه کن')
  await waitFor(w, () => sectionText(w, 'doc').includes('خلاصهٔ واقعی'), 10000, 'AI doc summary')
  check('mount: doc summary is the real AI summary', sectionText(w, 'doc').includes('نکتهٔ واقعیِ سند: بودجهٔ پروژه بررسی شود'))

  // Ask, AI path.
  const askSection = section(w, 'ask')
  setInput(w, askSection.querySelector('input'), 'جلسهٔ هفتهٔ پیش چه شد؟')
  await sleep(300)
  clickIn(w, askSection, 'بپرس')
  await waitFor(w, () => sectionText(w, 'ask').includes('جواب واقعی'), 10000, 'AI ask answer')
  check('mount: ask answer is the real AI answer', sectionText(w, 'ask').includes('جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.'))
  check('mount: ask answer cites its source', sectionText(w, 'ask').includes('منبع'))

  // Open chat, AI path + history is saved.
  setInput(w, w.document.querySelector('[data-chat-input]'), 'جلسهٔ امروز چه ساعتی است؟')
  await sleep(300)
  w.document.querySelector('[data-chat-send]').click()
  await waitFor(
    w,
    () => norm(w.document.querySelector('[data-chat-history]')?.textContent || '').includes('جواب واقعی از مدل'),
    10000,
    'AI chat answer'
  )
  const historyText = norm(w.document.querySelector('[data-chat-history]')?.textContent || '')
  check('mount: open chat shows the user message', historyText.includes('جلسهٔ امروز چه ساعتی است؟'))
  check('mount: open chat shows the AI answer', historyText.includes('جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.'))
  await sleep(500)
  const saved = db.assistant_messages.filter((r) => r.user_id === MEMBER_ID)
  check('mount: the exchange is saved (2 rows, user + assistant)', saved.length === 2 && saved[0].role === 'user' && saved[1].role === 'assistant', JSON.stringify(saved.map((r) => r.role)))
  check('mount: the saved assistant row holds the AI answer', saved[1]?.content === 'جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.')

  // History reloads on a fresh mount (same DB, no sending).
  const { w: w2, errors: errors2 } = await mountApp(bundle, stub, '#/assistant')
  await waitFor(
    w2,
    () => norm(w2.document.querySelector('[data-chat-history]')?.textContent || '').includes('جلسهٔ امروز چه ساعتی است؟'),
    15000,
    'chat history reload'
  )
  const history2 = norm(w2.document.querySelector('[data-chat-history]')?.textContent || '')
  check('mount: history reloads the user message on a fresh mount', history2.includes('جلسهٔ امروز چه ساعتی است؟'))
  check('mount: history reloads the AI answer on a fresh mount', history2.includes('جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.'))
  check('mount (history): no non-Realtime JS errors', errors2.length === 0, JSON.stringify(errors2.slice(0, 3)))

  // Guardian: run records nothing; the tap records exactly one pointer.
  await waitForSelectOption(w, 'guardian', PROJECT_ID)
  const guardianSection = section(w, 'guardian')
  setSelect(w, guardianSection.querySelector('select'), PROJECT_ID)
  await sleep(300)
  clickIn(w, guardianSection, 'خلاصهٔ امروز')
  await waitFor(w, () => sectionText(w, 'guardian').includes('کارهای عقب‌مانده (1)'), 10000, 'guardian result')
  check('mount: guardian run records nothing (still 4 notifications)', db.notifications.length === 4, String(db.notifications.length))
  const recordBtn = guardianSection.querySelector('[data-guardian-record]')
  check('mount: guardian shows the tap-to-record button', !!recordBtn)
  recordBtn.click()
  await waitFor(w, () => db.notifications.length === 5, 10000, 'guardian pointer recorded')
  check('mount: the tap records exactly one pointer (5 notifications)', db.notifications.length === 5)
  const pointer = db.notifications.find((n) => n.target_id === 'task-overdue')
  check('mount: the pointer is a reminder notification for the overdue task', !!pointer && pointer.type === 'reminder')
  await sleep(300)
  check('mount: the record button is gone after the tap', !guardianSection.querySelector('[data-guardian-record]'))

  // Suggestion rows still say «پیش‌فرض» (honest labels).
  await waitForSelectOption(w, 'chat-sug', ROOM_ID)
  const chatSugSection = section(w, 'chat-sug')
  setSelect(w, chatSugSection.querySelector('select'), ROOM_ID)
  await sleep(300)
  clickIn(w, chatSugSection, 'پیشنهاد از چت')
  await waitFor(w, () => sectionText(w, 'chat-sug').includes('مسئول پیش‌فرض'), 10000, 'chat suggestion')
  check('mount: chat suggestion labels the assignee «پیش‌فرض»', sectionText(w, 'chat-sug').includes('مسئول پیش‌فرض'))
  check('mount: chat suggestion labels the due date «پیش‌فرض»', sectionText(w, 'chat-sug').includes('سررسید پیش‌فرض'))

  check('mount (ok): no non-Realtime JS errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
}

async function mountFail(bundle, mode, notice, label, waitMs = 10000) {
  const now = new Date()
  const db = makeDb()
  seed(db, now)
  const stub = makeStub(db)
  stub.fnMode = mode
  const { w, errors } = await mountApp(bundle, stub, '#/assistant')
  await waitFor(w, () => w.document.querySelector('.ai-chips'), 15000, 'assistant chips')

  const roomSection = section(w, 'room')
  await waitForSelectOption(w, 'room', ROOM_ID)
  setSelect(w, roomSection.querySelector('select'), ROOM_ID)
  await sleep(300)
  clickIn(w, roomSection, 'خلاصه کن')
  await waitFor(w, () => sectionText(w, 'room').includes('خط‌های برگزیده'), waitMs, 'extractive room fallback')
  check(`mount (${label}): room summary falls back to the extractive lines`, sectionText(w, 'room').includes('8 پیام'))
  check(`mount (${label}): the fallback quotes a real line verbatim`, sectionText(w, 'room').includes('باید گزارش ماهانه را آماده کنیم'))
  check(`mount (${label}): the fallback announces the reason`, sectionText(w, 'room').includes(notice))

  setInput(w, w.document.querySelector('[data-chat-input]'), 'جلسه')
  await sleep(300)
  w.document.querySelector('[data-chat-send]').click()
  await waitFor(
    w,
    () => norm(w.document.querySelector('[data-chat-notice]')?.textContent || '').includes(notice),
    waitMs,
    'chat fallback notice'
  )
  const historyText = norm(w.document.querySelector('[data-chat-history]')?.textContent || '')
  check(`mount (${label}): open chat falls back to real rows`, historyText.includes('جلسه داریم؟'))
  check(`mount (${label}): open chat announces the reason`, norm(w.document.querySelector('[data-chat-notice]')?.textContent || '').includes(notice))

  check(`mount (${label}): no non-Realtime JS errors`, errors.length === 0, JSON.stringify(errors.slice(0, 3)))
}

async function mountHome(bundle) {
  const now = new Date()
  const db = makeDb()
  seed(db, now)
  const stub = makeStub(db)
  stub.fnMode = 'ok'
  const { w, errors } = await mountApp(bundle, stub, '')
  await waitFor(w, () => w.document.querySelector('[data-home-card="assistant"]'), 15000, 'home assistant card')
  const card = w.document.querySelector('[data-home-card="assistant"]')
  setInput(w, card.querySelector('input[placeholder="از میوز بپرس"]'), 'جلسهٔ امروز چه ساعتی است؟')
  await sleep(300)
  clickIn(w, card, 'بپرس')
  await waitFor(
    w,
    () => norm(w.document.querySelector('[data-chat-history]')?.textContent || '').includes('جواب واقعی از مدل'),
    15000,
    'home handover to open chat'
  )
  const historyText = norm(w.document.querySelector('[data-chat-history]')?.textContent || '')
  check('mount (home): the question lands in the open chat', historyText.includes('جلسهٔ امروز چه ساعتی است؟'))
  check('mount (home): the handover question gets the AI answer', historyText.includes('جواب واقعی از مدل: جلسهٔ امروز ساعت ۱۰ است.'))
  check('mount (home): the handover key is cleared after use', w.localStorage.getItem('sclack-ai-question') === null)
  check('mount (home): no non-Realtime JS errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
}

async function main() {
  staticChecks()
  buildProbeBundle()
  const bundle = loadBundle()
  assertProbeConfigured(bundle.js)
  await mountOk(bundle)
  await mountFail(bundle, 'fail', 'هوش این بار جواب نداد', 'fail-500')
  await mountFail(bundle, 'rate-limited', 'سقف روزانهٔ هوش پر شده', 'rate-limited')
  await mountFail(bundle, 'not-configured', 'کلید هوش هنوز وصل نشده', 'not-configured')
  await mountFail(bundle, 'hang', 'هوش دیر جواب داد', 'timeout', 45000)
  await mountHome(bundle)
  console.log(failures === 0 ? 'ALL ASSISTANT-REGISTRY PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('PROBE ERROR:', e.message || e)
  process.exit(1)
})
