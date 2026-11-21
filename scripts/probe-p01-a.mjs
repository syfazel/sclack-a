// P01 block A sandbox probes (Node, no network, no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the UI the way the P01 acceptance
// criteria say, and asserts each item of section 1 (A1–A5). The stub
// reproduces the Postgres unique-violation for a duplicate project name
// (23505) so the rejection is proven, not assumed.
//
// HERMETIC BUILD (fixed 2026-11-21): this probe BUILDS the bundle itself
// with the probe Supabase URL + placeholder key before mounting, and
// refuses to mount a bundle that is not probe-configured. Rationale:
// the app's Supabase client is created only when a key is baked in at
// build time (Vite constant-folds `isConfigured` to false otherwise and
// dead-code-eliminates the createClient call entirely — the bundle then
// contains no Supabase URL/key at all and the app can only ever show the
// login screen with the "key not connected" notice). A previous run
// claimed 59/59 against a hand-built probe bundle, but the committed
// script mounted whatever dist/ happened to contain; run against a
// plain no-key dist it silently timed out on the first input with zero
// JS errors. The probe must never again depend on ambient dist state.
//
// Usage:
//   node scripts/probe-p01-a.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  validateProjectForm,
  computeProjectReview,
  PROJECT_STAGES
} from '../src/lib/extract.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'

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

// ---------- pure checks (no mount) ----------
check('A1 pure: empty form rejected (name)', validateProjectForm({}) === 'نام پروژه را بنویسید.')
check('A1 pure: name only rejected (goal)', validateProjectForm({ name: 'x' }) === 'هدف پروژه را بنویسید.')
check('A1 pure: whitespace goal rejected', validateProjectForm({ name: 'x', goal: '   ' }) === 'هدف پروژه را بنویسید.')
check('A1 pure: no deadline rejected', validateProjectForm({ name: 'x', goal: 'y' }) === 'مهلت پروژه را انتخاب کنید.')
check('A1 pure: full form valid', validateProjectForm({ name: 'x', goal: 'y', deadline: '2026-12-31' }) === null)
check('A1 pure: exactly 5 stages', PROJECT_STAGES.length === 5 && PROJECT_STAGES.join(',') === 'created,planned,active,review,closed')

{
  const now = new Date('2026-11-21T12:00:00.000Z')
  const tasks = [
    { status: 'done', due_at: '2026-11-20T00:00:00.000Z' },
    { status: 'done', due_at: '2026-11-25T00:00:00.000Z' },
    { status: 'todo', due_at: '2026-11-20T00:00:00.000Z' },
    { status: 'doing', due_at: '2026-11-22T00:00:00.000Z' },
    { status: 'todo', due_at: '2026-11-27T00:00:00.000Z' }
  ]
  const docs = [{ id: 'd1' }, { id: 'd2' }]
  const files = [
    { uploaded_at: '2026-11-21T10:00:00.000Z' },
    { uploaded_at: '2026-11-11T10:00:00.000Z' }
  ]
  const r = computeProjectReview({ tasks, docs, files }, now)
  check(
    'A4 pure: review numbers exact (2 todo, 1 doing, 2 done, 1 overdue, 2 docs, 1 new file)',
    r.todo === 2 && r.doing === 1 && r.done === 2 && r.overdue === 1 && r.docs === 2 && r.newFiles === 1,
    JSON.stringify(r)
  )
  check(
    'A4 pure: done tasks never count as overdue',
    computeProjectReview({ tasks: [{ status: 'done', due_at: '2020-01-01T00:00:00.000Z' }], docs: [], files: [] }, now).overdue === 0
  )
}

// ---------- in-memory stub backend (adapted from probe-docview) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER2_ID, muse_id: 'auth:zahra', name: 'زهرا', avatar: null, joined_at: now, auth_id: 'zahra-id' }
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

function makeStub(db) {
  const calls = { projectInserts: [], roomInserts: [], docInserts: [], taskInserts: [], projectPatches: [] }

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
      // projects.name is unique in the schema — reproduce the exact
      // Postgres error so the duplicate-name rejection is proven.
      if (table === 'projects' && rows.some((r) => r.name === body.name)) {
        return json({ message: 'duplicate key value violates unique constraint "projects_name_key"', code: '23505' }, 400)
      }
      const onConflict = params.get('on_conflict') || params.get('onConflict')
      const now = new Date().toISOString()
      const row = { ...body }
      // Schema defaults the real DB applies (the insert body omits them).
      if (table === 'projects' && row.archived === undefined) row.archived = false
      if (table === 'projects' && row.custom_fields === undefined) row.custom_fields = {}
      if (!row.id) {
        row.id = table === 'members' && body.auth_id === USER_ID ? MEMBER_ID : 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at && 'created_at' in (rows[0] || {})) row.created_at = now
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

  async function stubFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {})
    const bodyText = init.body || (typeof input !== 'string' && input.body) || null
    if (url.startsWith(BASE_URL + '/rest/v1/')) {
      return handleRest(url, method, headers, typeof bodyText === 'string' ? bodyText : null)
    }
    if (url.startsWith(BASE_URL + '/storage/v1/')) return json({})
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { calls, stubFetch, db }
}

// ---------- fake session ----------
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function fakeSession() {
  const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' +
    b64url({ sub: USER_ID, email: 'yasin@probe.test', aud: 'authenticated', exp: 9999999999 }) + '.sig'
  return {
    access_token: jwt,
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: USER_ID, email: 'yasin@probe.test', aud: 'authenticated', role: 'authenticated' }
  }
}

function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
}

// Build dist/ with the probe Supabase URL + placeholder key, then prove
// the built bundle is actually probe-configured before mounting. Without
// this, a stale no-key dist mounts the login screen and every UI wait
// times out with zero JS errors (the 2026-11-21 false 59/59).
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

async function mountApp({ html, js }, stub, hash) {
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
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(fakeSession()))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    w.eval(js)
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
  throw new Error('timeout waiting for ' + label)
}

function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
function setSelect(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}

// P01 C: the planner on #/tasks filters by menu — a task is visible only
// in the menus its due date / assignee puts it in. This helper switches
// menus by data-menu id (the acceptance criteria are unchanged; only the
// navigation to reach the rows moved).
function clickMenu(w, id) {
  const b = w.document.querySelector(`button[data-menu="${id}"]`)
  if (!b) throw new Error('menu button not found: ' + id)
  b.click()
}

// ---------- main ----------
async function main() {
  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('P01 UI strings in built bundle', ['بازبینی', 'بایگانی‌شده', 'بدون تاریخ', 'هدف پروژه', 'خروجی نهایی', 'بستن پروژه'].every((s) => js.includes(s)))

  // ================= Mount A: A1 create + reject, A3, one task, A5 =================
  const db1 = makeDb()
  const stub1 = makeStub(db1)
  const m1 = await mountApp({ html, js }, stub1, '#/')
  const w = m1.w
  allErrors.push(...m1.errors)

  // If the fake session did not restore, the app sits on the login
  // screen and this wait times out with zero JS errors. Say so plainly
  // instead of the bare timeout: dump what the screen actually shows.
  let nameInput
  try {
    nameInput = await waitFor(w, () => w.document.querySelector('input[placeholder="نام پروژه *"]'), 10000, 'project form name input')
  } catch (e) {
    const screen = (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400)
    throw new Error(e.message + ' — screen shows: ' + JSON.stringify(screen))
  }
  const formSection = nameInput.closest('section')
  const goalInput = formSection.querySelector('input[placeholder="هدف پروژه *"]')
  const finalInput = formSection.querySelector('input[placeholder="خروجی نهایی"]')
  const descInput = formSection.querySelector('textarea[placeholder="توضیح (اختیاری)"]')
  const deadlineInput = formSection.querySelector('input[type="date"]')
  const createBtn = [...formSection.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن پروژه')
  check('A1: creation form renders (name/goal/final/deadline)', !!(nameInput && goalInput && finalInput && deadlineInput && createBtn))
  // Member checkboxes render once members load. Note: the signed-in
  // member's name comes from the session email prefix ('yasin'), the
  // seeded second member is 'زهرا'.
  await waitFor(w, () => formSection.querySelectorAll('input[type="checkbox"]').length === 2, 10000, 'member checkboxes')
  check('A1: member checkboxes list both members', formSection.textContent.includes('yasin') && formSection.textContent.includes('زهرا'))

  // A1 rejection 1: no goal.
  setInput(w, nameInput, 'پروژهٔ پروب P01')
  setInput(w, descInput, 'توضیح پروب')
  setInput(w, finalInput, 'خروجی پروب')
  setInput(w, deadlineInput, '2026-12-31')
  createBtn.click()
  await sleep(800)
  check('A1: project without goal rejected with a clear message', formSection.textContent.includes('هدف پروژه را بنویسید.'), formSection.textContent.slice(0, 200))
  check('A1: rejected project wrote no row', db1.projects.length === 0)

  // A1 rejection 2: no deadline.
  setInput(w, goalInput, 'هدف پروب')
  setInput(w, deadlineInput, '')
  createBtn.click()
  await sleep(800)
  check('A1: project without deadline rejected with a clear message', formSection.textContent.includes('مهلت پروژه را انتخاب کنید.'))
  check('A1: rejected project wrote no row (2)', db1.projects.length === 0)

  // A1 success: uncheck زهرا to prove member selection, then create.
  setInput(w, deadlineInput, '2026-12-31')
  const zahraBox = [...formSection.querySelectorAll('input[type="checkbox"]')].find((c) => c.closest('label')?.textContent.includes('زهرا'))
  zahraBox.checked = false
  zahraBox.dispatchEvent(new w.Event('change', { bubbles: true }))
  createBtn.click()
  await waitFor(w, () => w.location.hash.startsWith('#/room/'), 10000, 'navigate to auto room after create')
  check('A1: project row created', db1.projects.length === 1, 'count: ' + db1.projects.length)
  const p1 = db1.projects[0]
  const cf = p1.custom_fields || {}
  check('A1: custom_fields hold goal/final_output/deadline/stage', cf.goal === 'هدف پروب' && cf.final_output === 'خروجی پروب' && !!cf.deadline && cf.stage === 'created', JSON.stringify(cf))
  check('A1: member_ids hold only the checked member', Array.isArray(cf.member_ids) && cf.member_ids.length === 1 && cf.member_ids[0] === MEMBER_ID, JSON.stringify(cf.member_ids))
  check('A1: no new columns used (description is a real column)', p1.description === 'توضیح پروب')
  // A3: auto room + auto doc share the project id.
  check('A3: auto room «گفت‌وگو» created for the project', stub1.calls.roomInserts.length === 1 && stub1.calls.roomInserts[0].project_id === p1.id && stub1.calls.roomInserts[0].name === 'گفت‌وگو')
  check('A3: auto doc «سند» created for the project', stub1.calls.docInserts.length === 1 && stub1.calls.docInserts[0].project_id === p1.id && stub1.calls.docInserts[0].title === 'سند')
  const doc1 = db1.docs[0]
  const room1 = db1.rooms[0]

  // A1 rejection 3: duplicate name.
  w.location.hash = '#/'
  w.dispatchEvent(new w.Event('hashchange'))
  await sleep(800)
  const nameInput2 = await waitFor(w, () => w.document.querySelector('input[placeholder="نام پروژه *"]'), 10000, 'project form after return home')
  const form2 = nameInput2.closest('section')
  setInput(w, nameInput2, 'پروژهٔ پروب P01')
  setInput(w, form2.querySelector('input[placeholder="هدف پروژه *"]'), 'هدف دیگر')
  setInput(w, form2.querySelector('input[type="date"]'), '2027-01-15')
  ;[...form2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن پروژه').click()
  await sleep(1000)
  check('A1: duplicate name rejected with a clear message', form2.textContent.includes('پروژه‌ای با این نام هست'), form2.textContent.slice(0, 300))
  check('A1: duplicate wrote no second row', db1.projects.length === 1)

  // A3 UI: home shows the project's room and doc (the file check runs
  // in the reload mount below: the file is seeded after this mount's
  // FileList already loaded, and nothing re-fetches it here).
  w.location.hash = '#/'
  w.dispatchEvent(new w.Event('hashchange'))
  await sleep(800)
  check('A3: home shows the project room «گفت‌وگو»', w.document.body.textContent.includes('گفت‌وگو'))
  check('A3: home shows the project doc «سند»', w.document.body.textContent.includes('سند'))

  // One task for the A5 readability check.
  w.location.hash = '#/tasks'
  w.dispatchEvent(new w.Event('hashchange'))
  const taskTitle = await waitFor(w, () => w.document.querySelector('input[placeholder="عنوان کار تازه"]'), 10000, 'task title input')
  setInput(w, taskTitle, 'کار پروب بایگانی')
  // P01 C: the planner prefills the form's due date with today (menu
  // «امروز»); a no-date task is created by clearing the date first.
  const taskDueA = w.document.querySelector('section input[type="date"]')
  if (taskDueA) setInput(w, taskDueA, '')
  ;[...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار').click()
  await waitFor(w, () => db1.tasks.length === 1, 10000, 'task row created')
  check('A2: task without due_at is creatable', db1.tasks[0].due_at === null)
  // The undated task lives in «سررسیدها», not in «امروز».
  clickMenu(w, 'due')
  await waitFor(w, () => w.document.body.textContent.includes('بدون تاریخ'), 10000, 'no-date label')
  check('A2: task without due_at shows «بدون تاریخ»', w.document.body.textContent.includes('بدون تاریخ'))

  // ---- Reload (fresh mount, same db): all 5 fields in place ----
  // Seed a file for the project first: the fresh mount loads it.
  db1.files.push({ id: 'file-1', project_id: p1.id, name: 'فایل پروب.pdf', size: 100, mime: 'application/pdf', storage: 'supabase', storage_path: p1.id + '/f.pdf', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: new Date().toISOString(), attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} })
  const m1r = await mountApp({ html, js }, stub1, '#/')
  const wr = m1r.w
  allErrors.push(...m1r.errors)
  const expectedDate = new Date('2026-12-31T23:59:00').toLocaleDateString('fa-IR')
  await waitFor(wr, () => wr.document.body.textContent.includes('پروژهٔ پروب P01'), 10000, 'project card after reload')
  // Scope to the project card itself: the sidebar also lists both
  // members, so the member check must not read the whole body.
  const card = [...wr.document.querySelectorAll('.card')].find((c) => c.textContent.includes('پروژهٔ پروب P01'))
  const cardText = card ? card.textContent : ''
  check('A1: after reload, name is in place', cardText.includes('پروژهٔ پروب P01'))
  check('A1: after reload, description is in place', cardText.includes('توضیح پروب'))
  check('A1: after reload, goal is in place', cardText.includes('هدف پروب'))
  check('A1: after reload, final_output is in place', cardText.includes('خروجی پروب'))
  check('A1: after reload, deadline is in place', cardText.includes(expectedDate), 'expected: ' + expectedDate)
  check('A1: after reload, members are in place (only the checked one)', cardText.includes('yasin') && !cardText.includes('زهرا'))
  check('A1: after reload, stage label is «ساخته‌شده»', cardText.includes('ساخته‌شده'))
  check('A3: after reload, home shows the project file', wr.document.body.textContent.includes('فایل پروب.pdf'))
  m1r.dom.window.close()

  // ---- A5: close the project (two-step confirm is stubbed true) ----
  // Go home first: the close button lives on the project card.
  w.location.hash = '#/'
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => [...w.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'بستن پروژه'), 10000, 'close button on card')
  const closeBtn2 = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'بستن پروژه')
  closeBtn2.click()
  await waitFor(w, () => db1.projects[0].archived === true, 10000, 'project archived in db')
  const closed = db1.projects[0]
  check('A5: close sets archived = true', closed.archived === true)
  check('A5: close sets stage = closed in custom_fields', closed.custom_fields.stage === 'closed', JSON.stringify(closed.custom_fields))
  check('A5: close records closed_at', !!closed.custom_fields.closed_at)
  check('A5: close preserves goal and deadline in custom_fields', closed.custom_fields.goal === 'هدف پروب' && !!closed.custom_fields.deadline)
  await waitFor(w, () => w.document.body.textContent.includes('بایگانی‌شده'), 10000, 'archive section')
  const activeSection = [...w.document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'پروژه‌ها')
  check('A5: closed project leaves the active list', activeSection && !activeSection.textContent.includes('پروژهٔ پروب P01'))
  const archSection = [...w.document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'بایگانی‌شده')
  check('A5: closed project appears in «بایگانی‌شده»', archSection && archSection.textContent.includes('پروژهٔ پروب P01'))
  // Its doc and tasks stay readable.
  w.location.hash = '#/doc/' + doc1.id
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'archived project doc opens')
  check('A5: archived project doc still readable', true)
  w.location.hash = '#/tasks'
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => w.document.querySelector('button[data-menu="due"]'), 10000, 'planner menu bar')
  clickMenu(w, 'due')
  await waitFor(w, () => w.document.body.textContent.includes('کار پروب بایگانی'), 10000, 'archived project task listed')
  check('A5: archived project tasks still readable', true)
  check('A5: no project row was deleted', db1.projects.length === 1 && db1.docs.length === 1 && db1.tasks.length === 1)
  m1.dom.window.close()

  // ================= Mount B: A2 full — 3 tasks, cycle, reload =================
  const db2 = makeDb()
  const now2 = new Date()
  const iso = (d) => new Date(d).toISOString()
  db2.projects.push({ id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ کار', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now2), visibility: 'team', archived: false, custom_fields: { goal: 'هدف کار', deadline: iso(now2), stage: 'created', member_ids: [MEMBER_ID, MEMBER2_ID] } })
  db2.rooms.push({ id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now2), visibility: 'project', custom_fields: {} })
  db2.docs.push({ id: DOC_ID, project_id: PROJECT_ID, title: 'سند', yjs_doc_id: 'doc-p01-2', template_id: null, created_by: MEMBER_ID, created_at: iso(now2), updated_at: iso(now2), version: 1, visibility: 'project', custom_fields: {} })
  const stub2 = makeStub(db2)
  const m2 = await mountApp({ html, js }, stub2, '#/tasks')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  const tTitle = await waitFor(w2, () => w2.document.querySelector('input[placeholder="عنوان کار تازه"]'), 10000, 'task form on mount B')
  const tForm = tTitle.closest('section')
  const tDesc = tForm.querySelector('input[placeholder="توضیح (اختیاری)"]')
  const tAssignee = tForm.querySelector('select')
  const tDue = tForm.querySelector('input[type="date"]')
  const tCreate = [...tForm.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')

  async function makeTask(title, assigneeId, due) {
    setInput(w2, tTitle, title)
    if (assigneeId) setSelect(w2, tAssignee, assigneeId)
    else setSelect(w2, tAssignee, '')
    setInput(w2, tDue, due || '')
    tCreate.click()
    await waitFor(w2, () => db2.tasks.some((t) => t.title === title), 10000, 'task row: ' + title)
  }
  const tomorrow = new Date(now2.getTime() + 86400000).toISOString().slice(0, 10)
  const nextWeek = new Date(now2.getTime() + 6 * 86400000).toISOString().slice(0, 10)
  await makeTask('کار یک', MEMBER_ID, tomorrow)
  await makeTask('کار دو', MEMBER2_ID, nextWeek)
  await makeTask('کار سه', null, '')
  check('A2: 3 tasks created with different assignees/due dates', db2.tasks.length === 3, 'count: ' + db2.tasks.length)
  const tk1 = db2.tasks.find((t) => t.title === 'کار یک')
  const tk2 = db2.tasks.find((t) => t.title === 'کار دو')
  const tk3 = db2.tasks.find((t) => t.title === 'کار سه')
  check('A2: assignee_ids recorded', tk1.assignee_id === MEMBER_ID && tk2.assignee_id === MEMBER2_ID, JSON.stringify(db2.tasks.map((t) => t.assignee_id)))
  check('A2: due_at recorded, no-date task has null due_at', !!tk1.due_at && !!tk2.due_at && tk3.due_at === null)
  check('A2: all tasks start at todo', db2.tasks.every((t) => t.status === 'todo'))
  check('A2: tasks link to the project', db2.tasks.every((t) => t.project_id === PROJECT_ID))

  // Cycle task 1: todo -> doing -> done (completed_at set) -> todo (cleared).
  function statusBtn(w, title) {
    const li = [...w.document.querySelectorAll('li')].find((el) => el.textContent.includes(title))
    return li ? li.querySelector('button') : null
  }
  // P01 C: the 3 tasks (tomorrow / +6d / no date) are not in «امروز»;
  // switch to «سررسیدها» before cycling their status.
  await waitFor(w2, () => w2.document.querySelector('button[data-menu="due"]'), 10000, 'planner menu bar')
  clickMenu(w2, 'due')
  await sleep(300)
  let b1 = await waitFor(w2, () => statusBtn(w2, 'کار یک'), 10000, 'status button for task 1')
  check('A2: status button starts at «باز»', b1.textContent.trim() === 'باز', b1.textContent.trim())
  b1.click()
  await waitFor(w2, () => db2.tasks.find((t) => t.title === 'کار یک').status === 'doing', 10000, 'todo->doing')
  b1 = statusBtn(w2, 'کار یک')
  check('A2: todo -> doing, completed_at stays null', db2.tasks.find((t) => t.title === 'کار یک').completed_at === null)
  b1.click()
  await waitFor(w2, () => db2.tasks.find((t) => t.title === 'کار یک').status === 'done', 10000, 'doing->done')
  const doneRow = db2.tasks.find((t) => t.title === 'کار یک')
  check('A2: doing -> done sets completed_at', !!doneRow.completed_at, JSON.stringify(doneRow.completed_at))
  // P01 C: a done task leaves «سررسیدها» (status != done); reopen it
  // from «کارهای من», where done tasks still show.
  clickMenu(w2, 'mine')
  b1 = await waitFor(w2, () => statusBtn(w2, 'کار یک'), 10000, 'status button for done task 1')
  b1.click()
  await waitFor(w2, () => db2.tasks.find((t) => t.title === 'کار یک').status === 'todo', 10000, 'done->todo')
  check('A2: done -> todo clears completed_at', db2.tasks.find((t) => t.title === 'کار یک').completed_at === null)
  // Reload: all 3 tasks stable.
  const m2r = await mountApp({ html, js }, stub2, '#/tasks')
  const w2r = m2r.w
  allErrors.push(...m2r.errors)
  await waitFor(w2r, () => w2r.document.querySelector('button[data-menu="due"]'), 10000, 'planner menu bar after reload')
  clickMenu(w2r, 'due')
  await waitFor(w2r, () => ['کار یک', 'کار دو', 'کار سه'].every((t) => w2r.document.body.textContent.includes(t)), 10000, 'all 3 tasks after reload')
  check('A2: 3 tasks stable after reload', true)
  check('A2: no-date task still shows «بدون تاریخ» after reload', w2r.document.body.textContent.includes('بدون تاریخ'))
  m2r.dom.window.close()
  m2.dom.window.close()

  // ================= Mount C: A4 review numbers, exact =================
  const db3 = makeDb()
  const now3 = Date.now()
  const day = 86400000
  db3.projects.push({ id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ بازبینی', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: new Date(now3).toISOString(), visibility: 'team', archived: false, custom_fields: { goal: 'هدف', deadline: new Date(now3).toISOString(), stage: 'active', member_ids: [] } })
  db3.rooms.push({ id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: new Date(now3).toISOString(), visibility: 'project', custom_fields: {} })
  db3.docs.push(
    { id: DOC_ID, project_id: PROJECT_ID, title: 'سند یک', yjs_doc_id: 'doc-a4-1', template_id: null, created_by: MEMBER_ID, created_at: new Date(now3).toISOString(), updated_at: new Date(now3).toISOString(), version: 1, visibility: 'project', custom_fields: {} },
    { id: DOC2_ID, project_id: PROJECT_ID, title: 'سند دو', yjs_doc_id: 'doc-a4-2', template_id: null, created_by: MEMBER_ID, created_at: new Date(now3).toISOString(), updated_at: new Date(now3).toISOString(), version: 1, visibility: 'project', custom_fields: {} }
  )
  db3.files.push(
    { id: 'f-new', project_id: PROJECT_ID, name: 'تازه.pdf', size: 10, mime: 'application/pdf', storage: 'supabase', storage_path: PROJECT_ID + '/new.pdf', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: new Date(now3).toISOString(), attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} },
    { id: 'f-old', project_id: PROJECT_ID, name: 'قدیمی.pdf', size: 10, mime: 'application/pdf', storage: 'supabase', storage_path: PROJECT_ID + '/old.pdf', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: new Date(now3 - 10 * day).toISOString(), attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} }
  )
  const mkTask = (id, title, status, dueMs) => ({
    id, project_id: PROJECT_ID, title, description: null, assignee_id: MEMBER_ID, status,
    due_at: dueMs === null ? null : new Date(dueMs).toISOString(),
    created_by: MEMBER_ID, created_at: new Date(now3).toISOString(),
    completed_at: status === 'done' ? new Date(now3).toISOString() : null,
    visibility: 'project', custom_fields: {}
  })
  db3.tasks.push(
    mkTask('t1', 'تمام یک', 'done', now3 - day),
    mkTask('t2', 'تمام دو', 'done', now3 + day),
    mkTask('t3', 'عقب‌مانده', 'todo', now3 - day),
    mkTask('t4', 'در حال انجام', 'doing', now3 + day),
    mkTask('t5', 'باز', 'todo', now3 + 6 * day)
  )
  const stub3 = makeStub(db3)
  const m3 = await mountApp({ html, js }, stub3, '#/')
  const w3 = m3.w
  allErrors.push(...m3.errors)
  const reviewSection = await waitFor(
    w3,
    () => [...w3.document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim() === 'بازبینی'),
    10000,
    'review section'
  )
  const nums = [...reviewSection.querySelectorAll('.text-2xl')].map((e) => e.textContent.trim())
  check('A4: review numbers exact [todo 2, doing 1, done 2, overdue 1, docs 2, new files 1]', JSON.stringify(nums) === JSON.stringify(['2', '1', '2', '1', '2', '1']), JSON.stringify(nums))
  check('A4: review section labels the 7-day window for new files', reviewSection.textContent.includes('۷ روز اخیر'))
  m3.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL P01-A PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('P01-A PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
