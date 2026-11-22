// Phase 1 probe (scripts/probe-task-edit.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the tasks UI the way a user would, and
// asserts the Phase 1 scope: create a task with a doc link, edit it in
// place (title / description / assignee / due date / link), change the
// link from one doc to another, and the custom doc picker (no native
// <select> for docs anywhere in the task UI). No live Supabase, no test
// data in live tables.
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-task-edit.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
let m1errors = []
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

// Tehran day key (YYYY-MM-DD) for "today" — the create form prefills the
// due date from the active menu, and the 'today' menu only lists tasks
// due today, so the probe keeps the edited task due today.
function tehranTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

// ---------- in-memory stub backend (same shape as probe-docview) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER_ID, muse_id: 'auth:' + USER_ID, name: 'پروب', auth_id: USER_ID, username: 'probe', created_at: now }
    ],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند الف', yjs_doc_id: 'doc-probe-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: '2026-11-20T10:00:00.000Z', version: 1, visibility: 'project', custom_fields: {} },
      { id: DOC2_ID, project_id: PROJECT_ID, title: 'سند ب', yjs_doc_id: 'doc-probe-2', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: '2026-11-22T10:00:00.000Z', version: 1, visibility: 'project', custom_fields: {} }
    ],
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
  const calls = { taskPatch: [] }

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
      const now = new Date().toISOString()
      const row = { ...body }
      if (!row.id) {
        row.id = table === 'members' && body.auth_id === USER_ID ? MEMBER_ID : 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at && 'created_at' in (rows[0] || {})) row.created_at = now
      rows.push(row)
      return single ? json(row) : json([row])
    }

    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'tasks') calls.taskPatch.push({ id: matched.map((r) => r.id), body })
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
    b64url({ sub: USER_ID, email: 'probe@example.com', aud: 'authenticated', exp: 9999999999 }) + '.sig'
  return {
    access_token: jwt,
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: USER_ID, email: 'probe@example.com', aud: 'authenticated', role: 'authenticated' }
  }
}

function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
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
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(fakeSession()))
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

// The doc picker toggle button (aria-haspopup=listbox) inside a form
// section; the menu lists docs by title.
function pickerToggle(w, root) {
  return root.querySelector('.doc-picker button[aria-haspopup="listbox"]')
}

async function pickDoc(w, root, title) {
  const toggle = pickerToggle(w, root)
  if (!toggle) throw new Error('doc picker toggle not found')
  toggle.click()
  const item = await waitFor(
    w,
    () => [...root.querySelectorAll('.doc-picker-menu .doc-picker-item')].find((b) => b.textContent.includes(title)),
    5000,
    'doc picker item ' + title
  )
  item.click()
  await sleep(100)
}

async function main() {
  const todayKey = tehranTodayKey()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  const db = makeDb()
  const stub = makeStub(db)

  const m1 = await mountApp({ html, js }, stub, '#/tasks')
  const { w } = m1
  m1errors = m1.errors
  await waitFor(w, () => w.document.body.textContent.includes('فهرست کار'), 10000, 'tasks heading')
  check('mount: #/tasks renders the task list section', true)

  const createSection = [...w.document.querySelectorAll('section')].find((s) =>
    s.querySelector('h2')?.textContent.includes('فهرست کار')
  )
  check('mount: create form section found', !!createSection)

  // ---- Case 1: create a task with a doc link (via the custom picker) ----
  const titleInput = createSection.querySelector('input[placeholder="عنوان کار تازه"]')
  check('create: title input present', !!titleInput)
  setInput(w, titleInput, 'کار پروب ویرایش')
  // Link type: the native select with a 'doc' option.
  const linkTypeSelect = [...createSection.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'doc')
  )
  check('create: link-type select present', !!linkTypeSelect)
  setSelect(w, linkTypeSelect, 'doc')
  await sleep(200)
  // The picker menu must list the newest doc first (سند ب, updated later).
  pickerToggle(w, createSection).click()
  const firstItem = await waitFor(
    w,
    () => createSection.querySelector('.doc-picker-menu .doc-picker-item'),
    5000,
    'doc picker menu opens'
  )
  check('picker: menu opens and lists newest doc first', firstItem.textContent.includes('سند ب'), firstItem.textContent)
  // Pick سند الف (not the first item) to prove selection by tap.
  const itemA = [...createSection.querySelectorAll('.doc-picker-menu .doc-picker-item')].find((b) =>
    b.textContent.includes('سند الف')
  )
  itemA.click()
  await sleep(200)
  check('picker: toggle shows the picked doc title', pickerToggle(w, createSection).textContent.includes('سند الف'))
  // No native <select> anywhere in the task UI offers a doc id.
  const docOptionInSelect = [...w.document.querySelectorAll('select option')].some(
    (o) => o.value === DOC_ID || o.value === DOC2_ID
  )
  check('picker: no native <select> option holds a doc id', !docOptionInSelect)

  const createBtn = [...createSection.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')
  createBtn.click()
  await waitFor(w, () => stub.db.tasks.length === 1, 10000, 'task row created in stub DB')
  const created = stub.db.tasks[0]
  check('create: link stored on the row', created.custom_fields?.link_type === 'doc' && created.custom_fields?.link_id === DOC_ID, JSON.stringify(created.custom_fields))
  check('create: status starts todo', created.status === 'todo')
  const createdId = created.id

  // The row renders in the 'today' menu (due date prefilled to today).
  const row = await waitFor(
    w,
    () => [...w.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار پروب ویرایش')),
    10000,
    'created task row renders'
  )
  check('create: row renders with the doc link label', row.textContent.includes('سند: سند الف'), row.textContent.slice(0, 200))

  // ---- Case 2: edit in place — title, assignee, due, link A -> B ----
  const editBtn = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('ویرایش کارِ'))
  check('edit: edit button present before delete', !!editBtn)
  editBtn.click()
  const editForm = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form opens')
  check('edit: form opens under the row', !!editForm)
  const editTitle = editForm.querySelector('input[placeholder="عنوان کار"]')
  check('edit: title prefilled with the current value', editTitle && editTitle.value === 'کار پروب ویرایش', editTitle?.value)
  check('edit: row carries the amber editing ring', row.className.includes('task-editing'))
  setInput(w, editTitle, 'کار ویرایش‌شده')
  const editDesc = editForm.querySelector('input[placeholder="توضیح (اختیاری)"]')
  setInput(w, editDesc, 'توضیح تازه')
  const editAssignee = [...editForm.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === MEMBER_ID)
  )
  setSelect(w, editAssignee, MEMBER_ID)
  const editDue = editForm.querySelector('input[type="date"]')
  setInput(w, editDue, todayKey)
  const editLinkType = [...editForm.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'doc')
  )
  setSelect(w, editLinkType, 'doc')
  await sleep(200)
  await pickDoc(w, editForm, 'سند ب')
  check('edit: picker shows the new doc', pickerToggle(w, editForm).textContent.includes('سند ب'))
  const saveBtn = [...editForm.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn.click()
  await waitFor(w, () => stub.db.tasks.length === 1 && stub.db.tasks[0].title === 'کار ویرایش‌شده', 10000, 'edited row in stub DB')
  const edited = stub.db.tasks[0]
  check('edit: same row changed, no new task created', edited.id === createdId && stub.db.tasks.length === 1)
  check('edit: link changed from doc A to doc B', edited.custom_fields?.link_id === DOC2_ID, JSON.stringify(edited.custom_fields))
  check('edit: description saved', edited.description === 'توضیح تازه')
  check('edit: assignee saved', edited.assignee_id === MEMBER_ID, String(edited.assignee_id))
  check('edit: due date saved (end of today, Tehran)', edited.due_at === new Date(todayKey + 'T23:59:00+03:30').toISOString(), String(edited.due_at))
  check('edit: status untouched by edit', edited.status === 'todo')
  check('edit: PATCH recorded once', stub.calls.taskPatch.length === 1, 'patches: ' + stub.calls.taskPatch.length)
  await waitFor(w, () => !w.document.querySelector('[data-edit-form]'), 5000, 'edit form closes after save')
  check('edit: form closes after save', true)
  const rowAfter = await waitFor(
    w,
    () => [...w.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار ویرایش‌شده')),
    10000,
    'edited row renders'
  )
  check('edit: row shows the new title + new link label', rowAfter.textContent.includes('سند: سند ب'))

  // ---- Case 3: empty title is rejected, row untouched ----
  const editBtn2 = [...rowAfter.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('ویرایش کارِ'))
  editBtn2.click()
  const editForm2 = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form reopens')
  const editTitle2 = editForm2.querySelector('input[placeholder="عنوان کار"]')
  setInput(w, editTitle2, '   ')
  const saveBtn2 = [...editForm2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn2.click()
  await sleep(800)
  check('edit: empty title shows the create-form error', editForm2.textContent.includes('عنوان کار را بنویسید.'))
  check('edit: empty title saves nothing', stub.db.tasks[0].title === 'کار ویرایش‌شده' && stub.calls.taskPatch.length === 1)

  // ---- Case 4: cancel changes nothing and closes the form ----
  setInput(w, editTitle2, 'عنوانِ لغوشده')
  const cancelBtn = [...editForm2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'انصراف')
  cancelBtn.click()
  await sleep(300)
  check('edit: cancel closes the form', !w.document.querySelector('[data-edit-form]'))
  check('edit: cancel saves nothing', stub.db.tasks[0].title === 'کار ویرایش‌شده' && stub.calls.taskPatch.length === 1)

  // ---- Case 5: clear the link from the picker ----
  const rowNow = [...w.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار ویرایش‌شده'))
  const editBtn3 = [...rowNow.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('ویرایش کارِ'))
  editBtn3.click()
  const editForm3 = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form opens (case 5)')
  const clearBtn = editForm3.querySelector('.doc-picker-clear')
  check('edit: clear-link (×) button present when a doc is linked', !!clearBtn)
  clearBtn.click()
  await sleep(200)
  check('edit: clearing shows «انتخاب سند» again', pickerToggle(w, editForm3).textContent.includes('انتخاب سند'))
  const saveBtn3 = [...editForm3.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn3.click()
  await waitFor(w, () => stub.db.tasks[0].custom_fields?.link_id === null, 10000, 'link cleared in stub DB')
  // Clearing the picker empties link_id; link_type stays 'doc' (same as
  // the create form: type picked, no target chosen). The row must show
  // no link label — linkLabel() requires both type and id.
  check('edit: link cleared on the row', stub.db.tasks[0].custom_fields?.link_id === null)
  const rowCleared = await waitFor(
    w,
    () => [...w.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار ویرایش‌شده')),
    10000,
    'row renders after link clear'
  )
  check('edit: row shows no link label after clear', !rowCleared.textContent.includes('سند:'))

  // ---- JS errors (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (m1.errors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', m1.errors.length, 'entries')

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL TASK-EDIT PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('TASK-EDIT PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
