// Component-level probe for the D6 bug fixes (scripts/probe-docview.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST + storage), drives the UI the way the D6 live test
// did, and asserts each fix. No live Supabase, no test data in live tables.
// The stub deliberately reproduces the Postgres error for the OLD files
// query ("column files.created_at does not exist") so the search fix is
// proven, not assumed.
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-docview.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import * as Y from 'yjs'
import { decodeDocState } from '../src/lib/yjs-sync.js'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT2_ID = '33333333-3333-3333-3333-333333333334'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const ROOM2_ID = '44444444-4444-4444-4444-444444444445'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'
const MSG_ID = '66666666-6666-6666-6666-666666666666'
const FILE_ID = '77777777-7777-7777-7777-777777777777'
const TASK_ID = '88888888-8888-8888-8888-888888888888'
const TEXT35 = 'سلام دنیا! این یک پیام آزمایشی است!' // 35 chars

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

// ---------- in-memory stub backend ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} },
      { id: PROJECT2_ID, workspace_id: 'main', name: 'پروژهٔ دوم', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} },
      { id: ROOM2_ID, project_id: PROJECT2_ID, name: 'اتاق دوم', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند پروب', yjs_doc_id: 'doc-probe-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {} },
      { id: DOC2_ID, project_id: PROJECT2_ID, title: 'سند دوم', yjs_doc_id: 'doc-probe-2', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {} }
    ],
    messages: [
      { id: MSG_ID, room_id: ROOM_ID, author_id: MEMBER_ID, body: 'سلام پروب', parent_id: null, mentions: [], attachments: [], created_at: now, edited_at: null, visibility: 'project', custom_fields: {} }
    ],
    files: [
      { id: FILE_ID, project_id: PROJECT_ID, name: 'گزارش پروب.pdf', size: 1234, mime: 'application/pdf', storage: 'supabase', storage_path: PROJECT_ID + '/گزارش پروب.pdf', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: now, attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} }
    ],
    tasks: [
      { id: TASK_ID, project_id: PROJECT_ID, title: 'کار پروب', description: null, assignee_id: null, status: 'todo', due_at: null, created_by: MEMBER_ID, created_at: now, completed_at: null, visibility: 'project', custom_fields: {} }
    ],
    comments: [],
    templates: [],
    versions: [],
    reminders: [],
    notifications: [],
    integrations: []
  }
}

function makeStub(db) {
  const calls = { docPatch: [], fileDelete: [], storageRemove: [], filesCreatedAtQuery: 0 }
  const failSources = new Set() // e.g. 'docs' — to prove per-source isolation
  let blockFileDelete = false

  function ilikeMatch(value, pattern) {
    // pattern like %foo% (with \% \_ escapes); case-insensitive substring
    let p = pattern
    if (p.startsWith('%')) p = p.slice(1)
    if (p.endsWith('%') && !p.endsWith('\\%')) p = p.slice(0, -1)
    p = p.replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\\\/g, '\\')
    return (value || '').toLowerCase().includes(p.toLowerCase())
  }

  function rowMatches(row, params, table) {
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

    // The OLD files query references files.created_at (no such column).
    // Reproduce the exact Postgres error so the fix is proven.
    if (table === 'files' && /created_at/.test(select + '|' + order)) {
      calls.filesCreatedAtQuery++
      return json({ message: 'column files.created_at does not exist', code: '42703' }, 400)
    }
    if (failSources.has(table)) {
      return json({ message: 'stubbed failure of ' + table, code: 'P0001' }, 500)
    }

    const rows = db[table]
    if (!rows) return json({ message: 'table not found: ' + table }, 404)

    if (method === 'GET') {
      let out = rows.filter((r) => rowMatches(r, params, table))
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
      // embedded resources (rooms(name) / projects(name))
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
      if (!row.id) {
        // Deterministic id for the probe member so auth.member.id matches
        // the uploaded_by / created_by ids used elsewhere in the stub.
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
      return single ? json(row) : json([row])
    }

    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params, table))
      for (const r of matched) Object.assign(r, body)
      if (table === 'docs') calls.docPatch.push({ id: matched.map((r) => r.id), body })
      if (single) return matched.length === 1 ? json(matched[0]) : json({ message: 'JSON object requested, multiple (or no) rows returned' }, 406)
      return new Response(null, { status: 204 })
    }

    if (method === 'DELETE') {
      const matched = rows.filter((r) => rowMatches(r, params, table))
      if (table === 'files') {
        calls.fileDelete.push({ ids: matched.map((r) => r.id), blocked: blockFileDelete })
        if (blockFileDelete) return json([])
      }
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
    if (url.startsWith(BASE_URL + '/storage/v1/')) {
      calls.storageRemove.push({ url, method })
      return json({})
    }
    if (url.startsWith(BASE_URL + '/auth/v1/')) {
      return json({})
    }
    // Anything else (e.g. realtime websocket upgrade attempts over fetch):
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { calls, failSources, setBlockFileDelete: (v) => { blockFileDelete = v }, stubFetch, db }
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
  // Node fetch/Response/Headers + BroadcastChannel into the jsdom window
  // (jsdom does not implement window.fetch); supabase-js uses them.
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  // Dummy WebSocket so Realtime subscribe() never throws (it never
  // connects in the sandbox; the row path is what is probed).
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
  throw new Error('timeout waiting for ' + label)
}

function docTextFromB64(b64) {
  const doc = new Y.Doc()
  const bytes = decodeDocState(b64)
  Y.applyUpdate(doc, bytes)
  return doc.getText('content').toString()
}

async function main() {
  if ([...TEXT35].length !== 35) {
    console.log('FAIL probe setup: TEXT35 is not 35 chars')
    process.exit(1)
  }
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  console.log('stale warning in bundle:', js.includes('فقط برای خودتان') ? 'PRESENT (bad)' : 'absent')
  check('bug 4: stale D2 warning absent from built bundle', !js.includes('فقط برای خودتان'))

  const db = makeDb()
  const stub = makeStub(db)

  // ---- Mount 1: doc view, type text, wait for autosave ----
  const m1 = await mountApp({ html, js }, stub, '#/doc/' + DOC_ID)
  const { w } = m1
  m1errors = m1.errors
  const ta = await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea')
  check('bug 1: doc textarea mounts', !!ta)
  // Sidebar lists populate on login without a manual re-select (bug 5).
  await waitFor(w, () => w.document.body.textContent.includes('گفت‌وگو') && w.document.body.textContent.includes('سند پروب'), 10000, 'sidebar lists')
  check('bug 5: sidebar shows room + doc after login (no re-select)', true)
  // Sidebar has a tasks link (bug 6).
  check('bug 6: sidebar has a #/tasks link', !!w.document.querySelector('a[href="#/tasks"]'))
  // Mobile bottom nav (md:hidden) must also reach #/tasks — the D6 live
  // test could not find the tasks UI at 957px because the sidebar is
  // hidden below md; the bottom nav is the mobile path.
  const mobileTasksLink = w.document.querySelector('nav a[href="#/tasks"]')
  check('bug 6: mobile bottom nav has a کارها link to #/tasks', !!mobileTasksLink && mobileTasksLink.textContent.includes('کارها'))

  // Type the 35 chars key by key, like a real user.
  for (const ch of TEXT35) {
    ta.value = ta.value + ch
    ta.dispatchEvent(new w.Event('input', { bubbles: true }))
    await sleep(15)
  }
  await sleep(3500) // autosave debounce is 2 s
  check('bug 1: autosave PATCHed the docs row', stub.calls.docPatch.length >= 1, 'patches: ' + stub.calls.docPatch.length)
  // Phase 3: saveDocRow now PATCHes twice (snapshot, then search_text) —
  // the snapshot is the last patch carrying custom_fields.yjs_state_b64.
  const lastPatch = [...stub.calls.docPatch].reverse().find((p) => p.body?.custom_fields?.yjs_state_b64)
  const savedB64 = lastPatch?.body?.custom_fields?.yjs_state_b64
  check('bug 1: saved snapshot is non-empty (not AAA=)', !!savedB64 && savedB64 !== 'AAA=', savedB64)
  const savedText = savedB64 ? docTextFromB64(savedB64) : ''
  check('bug 1: saved snapshot decodes to the typed 35 chars', savedText === TEXT35, JSON.stringify(savedText))
  check('bug 1: save indicator shows ذخیره شد', w.document.body.textContent.includes('ذخیره شد'))

  // ---- Mount 2 (reload): same stub DB, fresh page ----
  const m2 = await mountApp({ html, js }, stub, '#/doc/' + DOC_ID)
  const ta2 = await waitFor(m2.w, () => m2.w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea after reload')
  await waitFor(m2.w, () => ta2.value.length > 0, 10000, 'textarea filled after reload')
  check('bug 1: text survives reload', ta2.value === TEXT35, JSON.stringify(ta2.value))
  m2.dom.window.close()
  console.log('errcount after mount2 close:', m1errors.length, JSON.stringify(m1errors))

  // ---- Search (bug 2) in mount 1: go home, search for پروب ----
  w.location.hash = '#/'
  w.dispatchEvent(new w.Event('hashchange'))
  const searchInput = await waitFor(w, () => w.document.querySelector('input[placeholder^="در پیام"]'), 10000, 'search input')
  const searchSection = searchInput.closest('section')
  searchInput.value = 'پروب'
  searchInput.dispatchEvent(new w.Event('input', { bubbles: true }))
  const searchBtn = [...searchSection.querySelectorAll('button')].find((b) => b.textContent.trim() === 'جست‌وجو')
  searchBtn.click()
  // Wait for the search itself to finish: the message hit only exists in
  // the results list (the filename also appears in the home FileList, so
  // waiting on it would return before the search completes).
  await waitFor(w, () => searchSection.textContent.includes('سلام پروب'), 10000, 'message hit in search results')
  check('bug 2: search returns the message hit', searchSection.textContent.includes('سلام پروب'))
  check('bug 2: search returns the file hit (files query works)', searchSection.textContent.includes('گزارش پروب.pdf'))
  check('bug 2: no "column files.created_at" error shown', !w.document.body.textContent.includes('column files.created_at'))
  check('bug 2: old files query never sent', stub.calls.filesCreatedAtQuery === 0, 'count: ' + stub.calls.filesCreatedAtQuery)

  // Per-source isolation: fail the docs source, search again.
  stub.failSources.add('docs')
  searchInput.value = 'پروب'
  searchInput.dispatchEvent(new w.Event('input', { bubbles: true }))
  searchBtn.click()
  await sleep(1500)
  check('bug 2: one failing source does not kill the search (file hit still there)', searchSection.textContent.includes('گزارش پروب.pdf'))
  check('bug 2: partial failure is shown as a warning, not an error', searchSection.textContent.includes('کامل نشد'))
  stub.failSources.clear()
  console.log('errcount after search x2:', m1errors.length, JSON.stringify(m1errors))

  // ---- File delete (bug 3): blocked delete first, then real delete ----
  // Go to the doc view (FileList mounted there for this project). Wait for
  // the doc textarea first: the route change flushes async, and polling
  // for the file section too early catches the HOME view's FileList,
  // which unmounts on the route change (detached nodes — the clicks
  // then hit nothing).
  w.location.hash = '#/doc/' + DOC_ID
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea on return')
  const fileSection = await waitFor(
    w,
    () => [...w.document.querySelectorAll('section')].find((s) => s.isConnected && s.querySelector('h3')?.textContent.includes('فایل‌ها') && s.textContent.includes('گزارش پروب.pdf')),
    10000,
    'file list section with the file row'
  )
  check('bug 3: file row renders', !!fileSection)
  const row = [...fileSection.querySelectorAll('li')].find((li) => li.textContent.includes('گزارش پروب.pdf'))
  const delBtn = row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حذف') : null
  check('bug 3: delete button shown to the uploader', !!delBtn)
  // Blocked delete (RLS): stub returns [] -> must surface an error, row stays.
  stub.setBlockFileDelete(true)
  delBtn.click()
  await sleep(300)
  const armedNow = [...w.document.querySelectorAll('button')].some((b) => b.textContent.includes('مطمئنید؟'))
  check('bug 3: first tap arms the button (مطمئنید؟)', armedNow)
  delBtn.click()
  await sleep(1200)
  check('bug 3: blocked delete shows a clear error', w.document.body.textContent.includes('فقط فرستندهٔ فایل'))
  check('bug 3: blocked delete leaves the row present', fileSection.textContent.includes('گزارش پروب.pdf'))
  // Real delete.
  stub.setBlockFileDelete(false)
  const del2 = [...fileSection.querySelectorAll('li')]
    .find((li) => li.textContent.includes('گزارش پروب.pdf'))
    ?.querySelectorAll('button')
  const delBtn2 = del2 ? [...del2].find((b) => b.textContent.trim() === 'حذف') : null
  check('bug 3: delete button still there for the real delete', !!delBtn2)
  delBtn2.click()
  await sleep(300)
  delBtn2.click()
  await waitFor(w, () => stub.db.files.length === 0 && w.document.body.textContent.includes('حذف شد'), 10000, 'file row gone')
  check('bug 3: row delete recorded', stub.calls.fileDelete.some((c) => c.ids.includes(FILE_ID) && !c.blocked))
  check('bug 3: storage object removal recorded', stub.calls.storageRemove.length >= 1, 'count: ' + stub.calls.storageRemove.length)
  check('bug 3: success message shown', w.document.body.textContent.includes('حذف شد'))
  console.log('errcount after real delete:', m1errors.length, JSON.stringify(m1errors))
  // The success message itself contains the filename, so "row gone"
  // must be checked on the list items, not on the section text.
  check('bug 3: file row gone from the list', ![...fileSection.querySelectorAll('li')].some((li) => li.textContent.includes('گزارش پروب.pdf')))

  // ---- Tasks page (bug 6) ----
  w.location.hash = '#/tasks'
  w.dispatchEvent(new w.Event('hashchange'))
  await sleep(500)
  console.log('debug: hash after tasks nav:', w.location.hash, '| main snippet:', (w.document.querySelector('main')?.textContent || '').slice(0, 200).replace(/\s+/g, ' '))
  console.log('debug: window errors so far:', JSON.stringify(m1errors))
  await waitFor(w, () => w.document.body.textContent.includes('فهرست کار'), 10000, 'tasks heading')
  check('bug 6: #/tasks renders the task list section', true)

  // ---- Project switch (bug 5): click the second project in the sidebar ----
  const proj2Btn = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'پروژهٔ دوم')
  check('bug 5: second project button exists', !!proj2Btn)
  if (proj2Btn) {
    proj2Btn.click()
    await waitFor(w, () => w.document.body.textContent.includes('اتاق دوم') && w.document.body.textContent.includes('سند دوم'), 10000, 'second project lists')
    check('bug 5: sidebar lists switch to the selected project', true)
  }

  // ---- JS errors (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (m1.errors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', m1.errors.length, 'entries')

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL DOCVIEW PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('DOCVIEW PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
