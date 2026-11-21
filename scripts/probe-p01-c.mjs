// P01 block C sandbox probes (Node, no network, no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the planner notebook on #/tasks the way
// the P01 acceptance criteria say, and asserts each item of section 3
// (C1–C3). The pure planner functions from extract.js are the oracle:
// the probe computes the expected menu membership from the same seeded
// rows and compares it with what the UI renders.
//
// HERMETIC BUILD (same as probe-p01-a/b): this probe BUILDS the bundle
// itself with the probe Supabase URL + placeholder key before mounting,
// and refuses to mount a bundle that is not probe-configured. Never
// mount ambient dist/ (a no-key build renders only the login screen).
//
// Usage:
//   node scripts/probe-p01-c.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'
import {
  plannerMenuTasks,
  plannerDayTasks,
  plannerCalendarCounts,
  tehranDayKey,
  jalaliMonthKey,
  addTehranDays,
  jalaliMonthDays,
  jalaliMonthLabel,
  jalaliDayLabel
} from '../src/lib/extract.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const FILES_BUCKET = 'sclack-files'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DM_ROOM_ID = '44444444-4444-4444-4444-444444444445'
const DOC_ID = '55555555-5555-5555-5555-555555555555'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const allErrors = []
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

function textOfDocRow(row) {
  const b64 = row?.custom_fields?.yjs_state_b64
  if (!b64) return ''
  const doc = new Y.Doc()
  if (!applyDocState(doc, b64, 'probe')) return null
  return doc.getText('content').toString()
}
function encodeText(text) {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return encodeDocState(doc)
}
function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------- in-memory stub backend (adapted from probe-p01-a) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER2_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', avatar: null, joined_at: now, auth_id: ZAHRA_USER_ID }
    ],
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
    integrations: []
  }
}

function seedProject(db, { docText = null, yjsDocId = 'doc-p01-b-1' } = {}) {
  const now = new Date().toISOString()
  db.projects.push({ id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب B', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: { goal: 'هدف B', deadline: now, stage: 'created', member_ids: [MEMBER_ID, MEMBER2_ID] } })
  db.rooms.push({ id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} })
  db.docs.push({ id: DOC_ID, project_id: PROJECT_ID, title: 'سند', yjs_doc_id: yjsDocId, template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: docText ? { yjs_state_b64: encodeText(docText) } : {} })
}

function makeStub(db) {
  const calls = { projectInserts: [], roomInserts: [], docInserts: [], taskInserts: [], projectPatches: [], storageUploads: [], storageRemoves: [], storageSigns: [] }
  const store = new Map() // storage path -> Uint8Array (real bytes)

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
    const select = params.get('select') || ''
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
      if (table === 'projects' && rows.some((r) => r.name === body.name)) {
        return json({ message: 'duplicate key value violates unique constraint "projects_name_key"', code: '23505' }, 400)
      }
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
      // Postgres defaults created_at to now() on every table that has the
      // column; the stub mirrors that so first-row inserts carry a time.
      if (!row.created_at) row.created_at = now
      if (onConflict) {
        const existing = rows.find((r) => String(r[onConflict]) === String(body[onConflict]))
        if (existing) {
          Object.assign(existing, row)
          return single ? json(existing) : json([existing])
        }
      }
      rows.push(row)
      if (table === 'projects') calls.projectInserts.push(row)
      if (table === 'rooms') calls.roomInserts.push(row)
      if (table === 'docs') calls.docInserts.push(row)
      if (table === 'tasks') calls.taskInserts.push(row)
      return single ? json(row) : json([row])
    }

    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'projects') calls.projectPatches.push({ ids: matched.map((r) => r.id), body })
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

  // storage-js wraps a Blob upload in FormData; JSON bodies are strings.
  async function readBodyBytes(body) {
    if (!body) return new Uint8Array(0)
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof Uint8Array) return body
    if (typeof body.arrayBuffer === 'function') {
      try {
        return new Uint8Array(await body.arrayBuffer())
      } catch {
        return new Uint8Array(0)
      }
    }
    // storage-js prepareUploadFormData appends cacheControl (a string,
    // '3600') FIRST and the file LAST — take the first Blob/File entry,
    // not the first entry.
    if (typeof body.entries === 'function') {
      for (const [, v] of body.entries()) {
        if (v && typeof v.arrayBuffer === 'function') return new Uint8Array(await v.arrayBuffer())
      }
      for (const [, v] of body.entries()) {
        if (typeof v === 'string') return new TextEncoder().encode(v)
      }
    }
    return new Uint8Array(0)
  }

  async function handleStorage(url, method, bodyText, rawBody) {
    const u = new URL(url)
    if (u.pathname.includes('/object/sign/')) {
      const path = decodeURIComponent(u.pathname.split('/object/sign/' + FILES_BUCKET + '/')[1] || '')
      const signedUrl = 'https://probe-ref.storage/' + FILES_BUCKET + '/' + path + '?token=probe'
      calls.storageSigns.push({ path, url: signedUrl })
      return json({ signedUrl })
    }
    if (u.pathname.endsWith('/object/remove')) {
      const parsed = bodyText ? JSON.parse(bodyText) : {}
      const prefixes = parsed.prefixes || []
      for (const p of prefixes) {
        store.delete(p)
        calls.storageRemoves.push(p)
      }
      return json([])
    }
    // storage-js remove() in this version: DELETE /object/<bucket> with
    // { prefixes: [...] } — NOT the legacy /object/remove endpoint.
    if (method === 'DELETE' && u.pathname === '/storage/v1/object/' + FILES_BUCKET) {
      const parsed = bodyText ? JSON.parse(bodyText) : {}
      const prefixes = parsed.prefixes || []
      for (const p of prefixes) {
        store.delete(p)
        calls.storageRemoves.push(p)
      }
      return json([])
    }
    if (method === 'POST' && u.pathname.includes('/object/' + FILES_BUCKET + '/')) {
      const path = decodeURIComponent(u.pathname.split('/object/' + FILES_BUCKET + '/')[1] || '')
      const bytes = await readBodyBytes(rawBody)
      store.set(path, bytes)
      calls.storageUploads.push({ path, size: bytes.length })
      return json({ Key: path })
    }
    return json({ message: 'stub: unknown storage url ' + url }, 404)
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
    if (url.startsWith(BASE_URL + '/storage/v1/')) {
      return handleStorage(url, method, bodyText, rawBody)
    }
    if (url.startsWith('https://probe-ref.storage/')) {
      const u = new URL(url)
      const path = decodeURIComponent(u.pathname.replace('/' + FILES_BUCKET + '/', ''))
      const bytes = store.get(path)
      if (!bytes) return json({ message: 'not found' }, 404)
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
    }
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { calls, stubFetch, db, store }
}

// ---------- fake sessions ----------
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
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no probe-ref URL — ' +
      'the app would talk to the wrong project and the fake session would never restore'
    )
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no placeholder key — ' +
      'with no key the createClient call is dead-code-eliminated and the app can only show the login screen'
    )
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
    // S5 made the bundle code-split: Vite's dynamic-import helper uses
    // import.meta (module-only) and Rollup emits a trailing facade
    // export — both are parse errors in a classic script. Patch the
    // eval'd copy only; the real browser loads the bundle as a module.
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
// Type into the DOC textarea. It is bound to Yjs by a $effect that runs
// just after the textarea mounts, so a single-shot setInput can race the
// bind and be silently lost (the D6 bug-1 shape). Typing key by key like
// probe-docview, plus a settle sleep, avoids it; the save indicator
// («در حال ذخیره…») proves the bind is live before returning.
async function typeIntoDoc(w, ta, text) {
  await sleep(500)
  for (const ch of text) {
    ta.value = ta.value + ch
    ta.dispatchEvent(new w.Event('input', { bubbles: true }))
    await sleep(15)
  }
  await waitFor(w, () => w.document.body.textContent.includes('در حال ذخیره'), 5000, 'save indicator (doc bind live)')
}
function setFileInput(w, el, files) {
  Object.defineProperty(el, 'files', { value: files, configurable: true })
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}

// Svelte renders some labels as separate text nodes (e.g. «فایل‌ها» then
// «(0)»), so textContent carries a newline between them. Collapse
// whitespace before matching such labels.
function norm(s) { return (s || '').replace(/\s+/g, ' ').trim() }
function hasLabel(el, label) { return norm(el.textContent).includes(label) }
function clickButton(w, scope, label) {
  const btn = [...(scope || w.document).querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}


// ---------- main ----------
async function main() {
  const now = new Date()
  const todayKey = tehranDayKey(now)
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('P01-C UI strings in built bundle', ['امروز', 'این هفته', 'این ماه', 'سررسیدها', 'کارهای من', 'کارهای نفر دوم', 'تقویم', 'یادآوری‌ها', 'بدون تاریخ', 'عقب‌مانده'].every((s) => js.includes(s)))

  // Seed: 9 tasks + 2 reminders, dates relative to real now.
  const db = makeDb()
  seedProject(db, { yjsDocId: 'doc-p01-c-1' })
  const iso = (d) => new Date(d).toISOString()
  const task = (id, title, assignee, dueAt, status = 'todo') => ({
    id, project_id: PROJECT_ID, title, description: null, assignee_id: assignee,
    status, due_at: dueAt, completed_at: status === 'done' ? iso(now) : null,
    created_by: MEMBER_ID, created_at: iso(now), visibility: 'project',
    custom_fields: { link_type: null, link_id: null }
  })
  const T = {
    today: task('task-today', 'کار امروز', MEMBER_ID, isoAt(0, '23:59:00')),
    tomorrow: task('task-tomorrow', 'کار فردا', MEMBER2_ID, isoAt(1, '23:59:00')),
    week: task('task-week', 'کار هفته', MEMBER_ID, isoAt(6, '23:59:00')),
    nextWeek: task('task-nextweek', 'کار هفتهٔ بعد', MEMBER2_ID, isoAt(8, '23:59:00')),
    overdue: task('task-overdue', 'کار عقب‌مانده', MEMBER_ID, isoAt(-1, '10:00:00')),
    nodate: task('task-nodate', 'کار بدون تاریخ', MEMBER_ID, null),
    doneToday: task('task-done-today', 'کار تمام‌شدهٔ امروز', MEMBER_ID, isoAt(0, '23:59:00'), 'done'),
    nextMonth: task('task-nextmonth', 'کار ماه بعد', MEMBER2_ID, isoAt(35, '23:59:00')),
    plus7: task('task-plus7', 'کار هفت روز بعد', MEMBER_ID, isoAt(7, '23:59:00'))
  }
  db.tasks.push(...Object.values(T))
  db.reminders.push(
    { id: 'rem-1', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری امروز', remind_at: isoAt(0, '12:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-2', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری فردا', remind_at: isoAt(1, '12:00:00'), done: false, created_at: iso(now) }
  )
  const stub = makeStub(db)

  // Oracle: expected membership from the pure functions.
  const oracle = (menuId) =>
    plannerMenuTasks(db.tasks, db.reminders, menuId, { now, meId: MEMBER_ID, otherId: MEMBER2_ID })
  const titlesOf = (rows) => rows.map((t) => t.title)

  const m = await mountApp({ html, js }, stub, '#/tasks')
  const w = m.w
  allErrors.push(...m.errors)
  await waitFor(w, () => w.document.querySelector('button[data-menu="today"]'), 10000, 'planner menu bar')
  await waitFor(w, () => w.document.body.textContent.includes('کار امروز'), 10000, 'today task renders')
  await waitFor(w, () => w.document.body.textContent.includes('یادآوری‌های امروز'), 10000, 'today reminders section')

  // ---- C1: exactly the 8 menus, in order ----
  const menuBtns = [...w.document.querySelectorAll('button[data-menu]')]
  const menuIds = menuBtns.map((b) => b.getAttribute('data-menu'))
  check('C1: exactly 8 planner menus', menuBtns.length === 8, JSON.stringify(menuIds))
  check('C1: menu order is today/week/month/due/mine/other/calendar/reminders',
    JSON.stringify(menuIds) === JSON.stringify(['today', 'week', 'month', 'due', 'mine', 'other', 'calendar', 'reminders']),
    JSON.stringify(menuIds))
  const menuLabels = menuBtns.map((b) => b.textContent.replace(/\s+/g, ' ').trim())
  check('C1: menu labels are the spec words',
    ['امروز', 'این هفته', 'این ماه', 'سررسیدها', 'کارهای من', 'کارهای نفر دوم', 'تقویم', 'یادآوری‌ها'].every((l, i) => menuLabels[i].startsWith(l)),
    JSON.stringify(menuLabels))

  // Helpers to read what the UI shows.
  function clickMenu(id) {
    const b = w.document.querySelector(`button[data-menu="${id}"]`)
    if (!b) throw new Error('menu button not found: ' + id)
    b.click()
  }
  // Task rows carry a status button (باز/در حال انجام/تمام‌شده); reminder
  // rows carry a checkbox instead. Nested file <li>s have neither.
  function shownTaskTitles() {
    const out = []
    for (const li of w.document.querySelectorAll('main li')) {
      const btns = [...li.querySelectorAll('button')]
      if (!btns.some((b) => ['باز', 'در حال انجام', 'تمام‌شده'].includes(b.textContent.trim()))) continue
      const span = li.querySelector('span.min-w-0')
      if (span) out.push(span.textContent.trim())
    }
    return out
  }
  function shownBadge(id) {
    const b = w.document.querySelector(`button[data-menu="${id}"] .badge`)
    return b ? Number(b.textContent.trim()) : null
  }
  function sameSet(a, b) {
    return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
  }

  // ---- C2: menu membership, per the oracle ----
  // today (default menu): T1 + T7 tasks + R1 reminder.
  check('C2 today: tasks match the oracle', sameSet(shownTaskTitles(), titlesOf(oracle('today').tasks)), JSON.stringify(shownTaskTitles()))
  check('C2 today: badge counts tasks + today reminders', shownBadge('today') === oracle('today').tasks.length + oracle('today').reminders.length, String(shownBadge('today')))
  check('C2 today: today reminder shown', w.document.body.textContent.includes('یادآوری امروز'))
  check('C2 today: tomorrow reminder NOT shown', !w.document.body.textContent.includes('یادآوری فردا'))
  check('C2 today: done task due today IS shown (spec filters status only in سررسیدها)', shownTaskTitles().includes('کار تمام‌شدهٔ امروز'))

  clickMenu('week')
  await sleep(300)
  check('C2 week: tasks match the oracle', sameSet(shownTaskTitles(), titlesOf(oracle('week').tasks)), JSON.stringify(shownTaskTitles()))
  check('C2 week: +6d is in, +7d is out (week = today..+6)', shownTaskTitles().includes('کار هفته') && !shownTaskTitles().includes('کار هفت روز بعد'))

  clickMenu('month')
  await sleep(300)
  check('C2 month: tasks match the oracle (Jalali month)', sameSet(shownTaskTitles(), titlesOf(oracle('month').tasks)), JSON.stringify(shownTaskTitles()))

  clickMenu('due')
  await sleep(300)
  const dueShown = shownTaskTitles()
  const dueExpected = titlesOf(oracle('due').tasks)
  check('C2 due: tasks match the oracle', sameSet(dueShown, dueExpected), JSON.stringify(dueShown))
  check('C2 due: exact order is due_at ascending, undated last',
    JSON.stringify(dueShown) === JSON.stringify(dueExpected), JSON.stringify(dueShown))
  check('C2 due: done task excluded', !dueShown.includes('کار تمام‌شدهٔ امروز'))
  check('C2 due: overdue first with red «عقب‌مانده» label', dueShown[0] === 'کار عقب‌مانده' && w.document.body.textContent.includes('عقب‌مانده'))
  check('C2 due: no-date task last with «بدون تاریخ»', dueShown[dueShown.length - 1] === 'کار بدون تاریخ' && w.document.body.textContent.includes('بدون تاریخ'))

  clickMenu('mine')
  await sleep(300)
  check('C2 mine: tasks match the oracle', sameSet(shownTaskTitles(), titlesOf(oracle('mine').tasks)), JSON.stringify(shownTaskTitles()))

  clickMenu('other')
  await sleep(300)
  check('C2 other: tasks match the oracle', sameSet(shownTaskTitles(), titlesOf(oracle('other').tasks)), JSON.stringify(shownTaskTitles()))
  check('C2 other: heading names the other member', w.document.body.textContent.includes('زهرا'))

  // No-date task is in NONE of today/week/month.
  clickMenu('today')
  await sleep(300)
  check('C2: no-date task NOT in today', !shownTaskTitles().includes('کار بدون تاریخ'))
  clickMenu('week')
  await sleep(300)
  check('C2: no-date task NOT in week', !shownTaskTitles().includes('کار بدون تاریخ'))
  clickMenu('month')
  await sleep(300)
  check('C2: no-date task NOT in month', !shownTaskTitles().includes('کار بدون تاریخ'))

  // Badges for the remaining menus.
  check('C2 badges: week/month/due/mine/other/reminders/calendar match the oracle',
    shownBadge('week') === oracle('week').tasks.length &&
    shownBadge('month') === oracle('month').tasks.length &&
    shownBadge('due') === oracle('due').tasks.length &&
    shownBadge('mine') === oracle('mine').tasks.length &&
    shownBadge('other') === oracle('other').tasks.length &&
    shownBadge('reminders') === db.reminders.length &&
    shownBadge('calendar') === Object.values(plannerCalendarCounts(db.tasks, now)).reduce((a, b) => a + b, 0),
    JSON.stringify({ week: shownBadge('week'), month: shownBadge('month'), due: shownBadge('due'), mine: shownBadge('mine'), other: shownBadge('other'), rem: shownBadge('reminders'), cal: shownBadge('calendar') }))

  // ---- C2 calendar: per-day counts, click a day opens its list ----
  clickMenu('calendar')
  await sleep(300)
  check('C2 calendar: month heading shows the Jalali month', w.document.body.textContent.includes(jalaliMonthLabel(now)), w.document.body.textContent.slice(0, 200))
  const todayCell = w.document.querySelector(`button[data-day="${todayKey}"]`)
  check('C2 calendar: today cell exists', !!todayCell)
  const todayCount = plannerCalendarCounts(db.tasks, now)[todayKey]
  const todayBadge = todayCell ? todayCell.querySelector('.badge') : null
  check('C2 calendar: today cell count matches the oracle', !!todayBadge && Number(todayBadge.textContent.trim()) === todayCount, todayBadge ? todayBadge.textContent : 'no badge')
  if (todayCell) todayCell.click()
  await sleep(300)
  check('C2 calendar: day heading shows the Jalali day', w.document.body.textContent.includes(jalaliDayLabel(todayKey)))
  check('C2 calendar: clicking today lists exactly today tasks', sameSet(shownTaskTitles(), titlesOf(plannerDayTasks(db.tasks, todayKey))), JSON.stringify(shownTaskTitles()))
  // A day with no tasks shows the empty state.
  const emptyDay = jalaliMonthDays(now).days.find((d) => (plannerCalendarCounts(db.tasks, now)[d.dayKey] || 0) === 0)
  if (emptyDay) {
    const cell = w.document.querySelector(`button[data-day="${emptyDay.dayKey}"]`)
    if (cell) cell.click()
    await sleep(300)
    check('C2 calendar: an empty day shows «در این روز کاری نیست.»', w.document.body.textContent.includes('در این روز کاری نیست.'))
  } else {
    check('C2 calendar: an empty day shows the empty state', false, 'no empty day in this month')
  }

  // ---- C2 reminders menu: in-app list, no push ----
  clickMenu('reminders')
  await waitFor(w, () => w.document.body.textContent.includes('یادآوری فردا'), 10000, 'reminders list')
  check('C2 reminders: both reminders listed', w.document.body.textContent.includes('یادآوری امروز') && w.document.body.textContent.includes('یادآوری فردا'))
  check('C2 reminders: honestly labelled in-app only', w.document.body.textContent.includes('فقط فهرست درون‌اپی است'))

  // ---- C3: create from inside a menu, with that menu's due_at prefilled ----
  clickMenu('today')
  await sleep(300)
  const dateInput = () => w.document.querySelector('section input[type="date"]')
  check('C3: from «امروز» the date input is prefilled with today', dateInput() && dateInput().value === todayKey, dateInput() ? dateInput().value : 'no input')
  const taskTitle = await waitFor(w, () => w.document.querySelector('input[placeholder="عنوان کار تازه"]'), 10000, 'task title input')
  setInput(w, taskTitle, 'کار تازه از امروز')
  clickButton(w, w.document, 'ساختن کار')
  await waitFor(w, () => db.tasks.some((t) => t.title === 'کار تازه از امروز'), 10000, 'task row created from today')
  const fresh = db.tasks.find((t) => t.title === 'کار تازه از امروز')
  check('C3: created task carries today as due_at', !!fresh && tehranDayKey(fresh.due_at) === todayKey, JSON.stringify(fresh && fresh.due_at))
  await waitFor(w, () => shownTaskTitles().includes('کار تازه از امروز'), 10000, 'new task shown in today')
  check('C3: new task appears in «امروز» right away', true)
  // After reload it is still in امروز.
  m.dom.window.close()
  const m2 = await mountApp({ html, js }, stub, '#/tasks')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.body.textContent.includes('کار تازه از امروز'), 10000, 'new task after reload')
  check('C3: task created from «امروز» is still there after reload', true)
  // A menu without a date context prefills nothing.
  const menuBtn2 = [...w2.document.querySelectorAll('button[data-menu="mine"]')]
  check('C3: «کارهای من» menu exists after reload', menuBtn2.length === 1)
  if (menuBtn2.length) menuBtn2[0].click()
  await sleep(300)
  const dateInput2 = w2.document.querySelector('section input[type="date"]')
  check('C3: from «کارهای من» the date input is blank (no prefill)', !!dateInput2 && dateInput2.value === '', dateInput2 ? dateInput2.value : 'no input')
  m2.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL P01-C PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('P01-C PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
