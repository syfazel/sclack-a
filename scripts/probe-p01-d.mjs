// P01 block D sandbox probes (Node, no network, no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the assistant panel on #/assistant the
// way the P01 acceptance criteria say, and asserts each item of
// section 4 (D1–D2). The pure guardian/suggestion functions from
// extract.js are the oracle: the probe computes the expected buckets
// and due dates from the same seeded rows and compares them with what
// the UI renders and what rows the app writes.
//
// HERMETIC BUILD (same as probe-p01-a/b/c): this probe BUILDS the bundle
// itself with the probe Supabase URL + placeholder key before mounting,
// and refuses to mount a bundle that is not probe-configured. Never
// mount ambient dist/ (a no-key build renders only the login screen).
//
// Usage:
//   node scripts/probe-p01-d.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'
import {
  computeDeadlineGuardian,
  extractChatTaskSuggestions,
  suggestDueAt,
  tehranDayKey,
  addTehranDays
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
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  const iso = (d) => new Date(d).toISOString()

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('P01-D UI strings in built bundle', ['نگهبان مهلت‌ها', 'تبدیل چت به کار', 'پیشنهاد — هنوز ساخته نشده', 'خلاصهٔ امروز', 'پیشنهاد از چت'].every((s) => js.includes(s)))

  // Seed: 5 tasks (today / overdue / +47h / done-today / +8d), 2 reminders,
  // 3 room messages (2 action lines, 1 plain), doc text with 2 action lines.
  const db = makeDb()
  const DOC_TEXT = 'باید بودجهٔ پروژه را بررسی کنیم\n- تماس با تامین‌کننده را هماهنگ کن\nاین سند دربارهٔ پروژه است'
  seedProject(db, { docText: DOC_TEXT, yjsDocId: 'doc-p01-d-1' })
  const task = (id, title, assignee, dueAt, status = 'todo') => ({
    id, project_id: PROJECT_ID, title, description: null, assignee_id: assignee,
    status, due_at: dueAt, completed_at: status === 'done' ? iso(now) : null,
    created_by: MEMBER_ID, created_at: iso(now), visibility: 'project',
    custom_fields: { link_type: null, link_id: null }
  })
  const T = {
    today: task('task-today', 'کار امروز', MEMBER_ID, isoAt(0, '23:59:00')),
    overdue: task('task-overdue', 'کار عقب‌مانده', MEMBER2_ID, isoAt(-1, '10:00:00')),
    soon: task('task-soon', 'کار دو روز دیگر', MEMBER_ID, new Date(now.getTime() + 47 * 3600 * 1000).toISOString()),
    doneToday: task('task-done-today', 'کار تمام‌شدهٔ امروز', MEMBER_ID, isoAt(0, '23:59:00'), 'done'),
    far: task('task-far', 'کار دور', MEMBER2_ID, isoAt(8, '23:59:00'))
  }
  db.tasks.push(...Object.values(T))
  db.reminders.push(
    { id: 'rem-1', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری امروز', remind_at: isoAt(0, '12:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-2', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری فردا', remind_at: isoAt(1, '12:00:00'), done: false, created_at: iso(now) }
  )
  const MSG1 = 'باید گزارش ماهانه را آماده کنیم'
  const MSG2 = 'فردا تماس با مشتری را پیگیری کن'
  db.messages.push(
    { id: 'msg-1', room_id: ROOM_ID, author_id: MEMBER2_ID, body: MSG1, visibility: 'project', created_at: iso(now) },
    { id: 'msg-2', room_id: ROOM_ID, author_id: MEMBER_ID, body: MSG2, visibility: 'project', created_at: iso(now) },
    { id: 'msg-3', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'سلام، چطوری؟', visibility: 'project', created_at: iso(now) }
  )
  const stub = makeStub(db)

  // Oracle: expected guardian buckets from the pure function.
  const oracle = computeDeadlineGuardian(db.tasks, db.reminders, now)
  check('D1 oracle: exactly 3 guardian tasks (today/overdue/soon)', oracle.today.length === 1 && oracle.overdue.length === 1 && oracle.soon.length === 1, JSON.stringify({ t: oracle.today.length, o: oracle.overdue.length, s: oracle.soon.length }))
  check('D1 oracle: found is true', oracle.found === true)

  const m = await mountApp({ html, js }, stub, '#/assistant')
  const w = m.w
  allErrors.push(...m.errors)
  await waitFor(w, () => w.document.querySelector('[data-guardian]'), 10000, 'guardian section')
  await waitFor(w, () => w.document.body.textContent.includes('نگهبان مهلت‌ها'), 10000, 'guardian heading')

  // ---- D1: deadline guardian ----
  const guardianSection = () => w.document.querySelector('[data-guardian]')
  const guardianText = () => guardianSection() ? guardianSection().textContent.replace(/\s+/g, ' ') : ''
  clickButton(w, w.document, 'خلاصهٔ امروز')
  await waitFor(w, () => guardianText().includes('کار امروز'), 10000, 'guardian today task renders')
  check('D1: today group heading shows count 1', guardianText().includes('کارهای امروز (1)'), guardianText().slice(0, 300))
  check('D1: overdue group heading shows count 1', guardianText().includes('کارهای عقب‌مانده (1)'), guardianText().slice(0, 300))
  check('D1: soon group heading shows count 1', guardianText().includes('سررسیدهای نزدیک (۴۸ ساعت آینده) (1)'), guardianText().slice(0, 300))
  const shownIds = [...w.document.querySelectorAll('[data-guardian-task]')].map((li) => li.getAttribute('data-guardian-task'))
  check('D1: exactly the 3 seeded tasks shown, no 4th', shownIds.length === 3 && ['task-today', 'task-overdue', 'task-soon'].every((id) => shownIds.includes(id)), JSON.stringify(shownIds))
  check('D1: done task due today is NOT in the guardian', !guardianText().includes('کار تمام‌شدهٔ امروز'))
  check('D1: far task (+8d) is NOT in the guardian', !guardianText().includes('کار دور'))
  check('D1: overdue row carries the red «عقب‌مانده» label', guardianText().includes('عقب‌مانده'))
  check('D1: overdue assignee (زهرا) is shown', guardianText().includes('زهرا'))
  const myName = (db.members.find((x) => x.id === MEMBER_ID) || {}).name || 'عضو'
  check('D1: today assignee name is shown', guardianText().includes(myName), 'myName=' + myName)
  check('D1: each task row shows «سررسید» + a date', [...w.document.querySelectorAll('[data-guardian-task]')].every((li) => li.textContent.includes('سررسید')))
  check('D1: today reminder shown, tomorrow reminder NOT shown', guardianText().includes('یادآوری امروز') && !guardianText().includes('یادآوری فردا'))
  check('D1: every guardian task links to #/tasks', [...w.document.querySelectorAll('[data-guardian-task] a')].every((a) => a.getAttribute('href') === '#/tasks'))

  // R8 (پکیج A): ثبت اشاره‌گر یادآوری دیگر خودکار/بی‌صدا نیست — خلاصه
  // به‌تنهایی چیزی ثبت نمی‌کند؛ UI اعلام می‌کند و فقط با تپ ثبت می‌شود.
  check('D1: summary alone records no pointer (R8)', db.notifications.length === 0, JSON.stringify(db.notifications))
  check('D1: announcement says an overdue task has no pointer yet', guardianText().includes('هنوز یادآوری ثبت نشده'), guardianText().slice(0, 300))
  const recordBtn = w.document.querySelector('[data-guardian-record]')
  check('D1: record-reminder button exists', !!recordBtn)
  recordBtn.click()
  await waitFor(w, () => db.notifications.length === 1, 10000, 'pointer recorded after the tap')
  check('D1: exactly 1 notification row after the tap', db.notifications.length === 1, JSON.stringify(db.notifications))
  const n0 = db.notifications[0]
  check('D1: pointer is type=reminder for the overdue task, viewer as user', !!n0 && n0.type === 'reminder' && n0.target_id === 'task-overdue' && n0.user_id === MEMBER_ID, JSON.stringify(n0))
  check('D1: after the tap, the recorded message shows', guardianText().includes('اعلان یادآوری ثبت شد'), guardianText().slice(0, 300))
  // Idempotent: a second summary records no duplicate.
  clickButton(w, w.document, 'خلاصهٔ امروز')
  await sleep(800)
  check('D1: second summary adds no duplicate pointer', db.notifications.length === 1, JSON.stringify(db.notifications))

  // ---- D2: chat-to-task ----
  function setSelect(el, value) {
    el.value = value
    el.dispatchEvent(new w.Event('change', { bubbles: true }))
  }
  const chatSection = () => w.document.querySelector('[data-chat-sug]')
  const chatText = () => chatSection() ? chatSection().textContent.replace(/\s+/g, ' ') : ''
  const chatSelect = w.document.querySelector('[data-chat-sug] select')
  check('D2 chat: room select exists', !!chatSelect)
  // The room options appear only after loadWorkspace finishes — setting
  // the value before the option exists leaves the select empty and the
  // bound state stays '' (the button then silently does nothing).
  await waitFor(w, () => [...w.document.querySelectorAll('[data-chat-sug] select option')].some((o) => o.value === ROOM_ID), 10000, 'room option loaded')
  setSelect(chatSelect, ROOM_ID)
  // Svelte flushes the `disabled` attribute in a microtask after the
  // state change — clicking in the same tick hits a still-disabled
  // button and jsdom drops the click. Let the DOM catch up first.
  await sleep(300)
  clickButton(w, w.document, 'پیشنهاد از چت')
  await waitFor(w, () => chatText().includes(MSG1), 10000, 'first chat suggestion renders')
  const chatRows = [...w.document.querySelectorAll('[data-chat-suggestion]')]
  check('D2 chat: exactly 2 suggestions from the 2 action messages', chatRows.length === 2, JSON.stringify(chatRows.map((r) => r.getAttribute('data-chat-suggestion'))))
  check('D2 chat: plain message produces no suggestion', !chatText().includes('سلام، چطوری؟'))
  check('D2 chat: verbatim quotes shown', chatText().includes(MSG1) && chatText().includes(MSG2))
  check('D2 chat: every suggestion labelled «پیشنهاد — هنوز ساخته نشده»', chatRows.every((r) => r.textContent.includes('پیشنهاد — هنوز ساخته نشده')))
  check('D2 chat: Zahra shown as suggested assignee of her message', chatRows.find((r) => r.getAttribute('data-chat-suggestion') === 'msg-1').textContent.includes('زهرا'))
  check('D2 chat: suggested due dates shown', chatRows.every((r) => r.textContent.includes('سررسید پیش‌فرض')))

  // Before any tap, no new task rows exist.
  check('D2 chat: before the tap, still exactly the 5 seeded tasks', db.tasks.length === 5, String(db.tasks.length))
  const row1 = chatRows.find((r) => r.getAttribute('data-chat-suggestion') === 'msg-1')
  const btn1 = [...row1.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')
  check('D2 chat: create button exists on the first suggestion', !!btn1)
  btn1.click()
  await waitFor(w, () => db.tasks.length === 6, 10000, 'task row created from chat suggestion')
  const fresh = db.tasks.find((t) => t.title === MSG1)
  const expectedDue = suggestDueAt(MSG1, now)
  check('D2 chat: created row has the quoted title', !!fresh)
  check('D2 chat: created row assignee is the message author (زهرا)', !!fresh && fresh.assignee_id === MEMBER2_ID, JSON.stringify(fresh && fresh.assignee_id))
  check('D2 chat: created row due_at is the suggested due date', !!fresh && fresh.due_at === expectedDue, JSON.stringify(fresh && fresh.due_at))
  check('D2 chat: created row created_by is the tapping member', !!fresh && fresh.created_by === MEMBER_ID, JSON.stringify(fresh && fresh.created_by))
  check('D2 chat: custom_fields carries source_message_id + source_quote', !!fresh && fresh.custom_fields && fresh.custom_fields.source_message_id === 'msg-1' && fresh.custom_fields.source_quote === MSG1, JSON.stringify(fresh && fresh.custom_fields))
  await sleep(400)
  check('D2 chat: created suggestion now says «ساخته شد»', row1.textContent.includes('ساخته شد'))
  const row2 = chatRows.find((r) => r.getAttribute('data-chat-suggestion') === 'msg-2')
  check('D2 chat: the other suggestion is still uncreated', row2.textContent.includes('پیشنهاد — هنوز ساخته نشده') && row2.textContent.includes('ساختن کار'))

  // ---- D2: doc suggestions (enriched with assignee/due/source) ----
  // The doc section has no data attribute; find the select next to the «پیشنهاد بده» button.
  const docBtn = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'پیشنهاد بده')
  const docSection = docBtn.closest('section')
  const docSel = docSection.querySelector('select')
  await waitFor(w, () => [...docSection.querySelectorAll('select option')].some((o) => o.value === DOC_ID), 10000, 'doc option loaded')
  docSel.value = DOC_ID
  docSel.dispatchEvent(new w.Event('change', { bubbles: true }))
  await sleep(300) // same disabled-button race as the chat section
  docBtn.click()
  await waitFor(w, () => docSection.textContent.includes('باید بودجهٔ پروژه را بررسی کنیم'), 10000, 'first doc suggestion renders')
  const docRows = [...docSection.querySelectorAll('[data-doc-suggestion]')]
  check('D2 doc: exactly 2 suggestions from the doc action lines', docRows.length === 2, JSON.stringify(docRows.map((r) => r.textContent.slice(0, 60))))
  check('D2 doc: plain doc line produces no suggestion', !docSection.textContent.includes('این سند دربارهٔ پروژه است'))
  const docQuote = 'باید بودجهٔ پروژه را بررسی کنیم'
  const docBtn1 = [...docRows[0].querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')
  check('D2 doc: create button exists on the first doc suggestion', !!docBtn1)
  docBtn1.click()
  await waitFor(w, () => db.tasks.length === 7, 10000, 'task row created from doc suggestion')
  const freshDoc = db.tasks.find((t) => t.title === docQuote)
  check('D2 doc: created row has source_doc_id + source_quote', !!freshDoc && freshDoc.custom_fields && freshDoc.custom_fields.source_doc_id === DOC_ID && freshDoc.custom_fields.source_quote === docQuote, JSON.stringify(freshDoc && freshDoc.custom_fields))
  check('D2 doc: created row assignee is null (doc lines have no author)', !!freshDoc && freshDoc.assignee_id === null, JSON.stringify(freshDoc && freshDoc.assignee_id))
  check('D2 doc: created row due_at is the suggested due date', !!freshDoc && freshDoc.due_at === suggestDueAt(docQuote, now), JSON.stringify(freshDoc && freshDoc.due_at))
  m.dom.window.close()

  // ---- task delete: two-tap in-app confirm, row really gone (G1 fix) ----
  // Seed one more task owned by the signed-in member, due today so it
  // shows in the default «امروز» menu. Two mounts share the same stub
  // DB: mount B renders the list first, mount A deletes the row, then
  // B's stale delete button proves the 0-row path shows a clear error
  // instead of failing silently (the live bug: the button did nothing).
  db.tasks.push(task('task-deletable', 'کار حذف‌شدنی', MEMBER_ID, isoAt(0, '23:59:00')))
  const taskRow = (wX, title) =>
    [...wX.document.querySelectorAll('li.card')].find((li) => li.textContent.includes(title))
  const taskDeleteBtn = (wX, title) => {
    const row = taskRow(wX, title)
    return row ? row.querySelector('button[title="حذف کار"]') : null
  }
  const openPlanner = async (wX) => {
    await waitFor(wX, () => wX.document.body.textContent.includes('پروژهٔ پروب B'), 10000, 'project listed in sidebar')
    const projBtn = [...wX.document.querySelectorAll('aside button')].find(
      (b) => b.textContent.trim() === 'پروژهٔ پروب B'
    )
    if (!projBtn) throw new Error('project button not found')
    projBtn.click()
    await waitFor(wX, () => wX.document.querySelector('[data-planner-header]') || wX.location.hash.startsWith('#/room/'), 10000, 'project selected')
    wX.location.hash = '#/tasks'
    wX.dispatchEvent(new wX.Event('hashchange'))
    await waitFor(wX, () => wX.document.querySelector('[data-planner-header]'), 10000, 'planner header')
    await waitFor(wX, () => taskRow(wX, 'کار حذف‌شدنی'), 10000, 'deletable task renders')
  }
  // Mount B renders first and stays stale on purpose.
  const mB = await mountApp({ html, js }, stub, '#/')
  const wB = mB.w
  allErrors.push(...mB.errors)
  await openPlanner(wB)
  check('delete: delete button exists on the own task', !!taskDeleteBtn(wB, 'کار حذف‌شدنی'))
  check('delete: no native-confirm text in the built bundle', !js.includes('این کار حذف شود؟'))
  // Mount A deletes the row.
  const mA = await mountApp({ html, js }, stub, '#/')
  const wA = mA.w
  allErrors.push(...mA.errors)
  await openPlanner(wA)
  const btnA1 = taskDeleteBtn(wA, 'کار حذف‌شدنی')
  check('delete: delete button exists in the deleting mount', !!btnA1)
  btnA1.click()
  await sleep(300)
  check('delete: first tap only arms («مطمئنید؟») and deletes nothing',
    !!taskDeleteBtn(wA, 'کار حذف‌شدنی') && taskDeleteBtn(wA, 'کار حذف‌شدنی').textContent.trim() === 'مطمئنید؟' && db.tasks.some((t) => t.id === 'task-deletable') && !!taskRow(wA, 'کار حذف‌شدنی'))
  const btnA2 = taskDeleteBtn(wA, 'کار حذف‌شدنی')
  btnA2.click()
  await waitFor(wA, () => !db.tasks.some((t) => t.id === 'task-deletable'), 10000, 'row removed from stub DB')
  check('delete: second tap removes the row from the stub DB', !db.tasks.some((t) => t.id === 'task-deletable'), 'tasks=' + db.tasks.length)
  await sleep(400)
  check('delete: the task is gone from the planner list', !taskRow(wA, 'کار حذف‌شدنی'))
  mA.dom.window.close()
  // Mount B's stale button now deletes a row that is already gone:
  // deleteTask must throw a clear error instead of staying silent.
  const btnB1 = taskDeleteBtn(wB, 'کار حذف‌شدنی')
  check('delete: stale row is still listed in the other mount', !!btnB1)
  btnB1.click()
  await sleep(300)
  const btnB2 = taskDeleteBtn(wB, 'کار حذف‌شدنی')
  check('delete: stale first tap arms too', !!btnB2 && btnB2.textContent.trim() === 'مطمئنید؟')
  btnB2.click()
  await waitFor(wB, () => wB.document.body.textContent.includes('کار حذف نشد'), 10000, 'clear delete error shows')
  check('delete: stale delete shows a clear error, not silence', wB.document.body.textContent.includes('کار حذف نشد'))
  check('delete: the failed delete leaves the DB untouched', db.tasks.length === 7, 'tasks=' + db.tasks.length)
  mB.dom.window.close()

  // ---- D1 empty: a project with no tasks -> found: false, honest text ----
  const db2 = makeDb()
  seedProject(db2, { yjsDocId: 'doc-p01-d-2' })
  const stub2 = makeStub(db2)
  const m2 = await mountApp({ html, js }, stub2, '#/assistant')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.querySelector('[data-guardian]'), 10000, 'guardian section (empty project)')
  clickButton(w2, w2.document, 'خلاصهٔ امروز')
  await waitFor(w2, () => w2.document.querySelector('[data-guardian]').textContent.includes('برای امروز کاری نیست'), 10000, 'empty guardian honest message')
  check('D1 empty: found:false shows «برای امروز کاری نیست»', true)
  check('D1 empty: no notification pointer is recorded', db2.notifications.length === 0, JSON.stringify(db2.notifications))
  m2.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL P01-D PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('P01-D PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
