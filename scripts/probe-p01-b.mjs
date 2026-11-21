// P01 block B sandbox probes (Node, no network, no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST + an in-memory Storage byte store), drives the UI
// the way the P01 acceptance criteria say, and asserts each item of
// section 2 (B1–B4). The Storage stub keeps the actual uploaded bytes,
// so the B4 download check compares bytes, not just a row.
//
// HERMETIC BUILD (same as probe-p01-a): this probe BUILDS the bundle
// itself with the probe Supabase URL + placeholder key before mounting,
// and refuses to mount a bundle that is not probe-configured. Never
// mount ambient dist/ (a no-key build renders only the login screen).
//
// Usage:
//   node scripts/probe-p01-b.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'

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

const TEXT35 = 'سلام دنیا! این یک پیام آزمایشی است!' // 35 chars (same as probe-yjs)
const TEXT_B = 'متن دوم از زهرا'
const S1 = 'نسخهٔ یک: این متن اول است.'
const ADD2 = ' افزودهٔ نسخهٔ دو.'

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
  check('B1 setup: TEXT35 is exactly 35 chars', [...TEXT35].length === 35, [...TEXT35].length)
  const extraLen = [...TEXT_B].length
  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('P01-B UI strings in built bundle', ['پاسخ', 'فایل‌ها', 'پیوست به این کار', 'ذخیرهٔ نسخه', 'برگرداندن'].every((s) => js.includes(s)))

  // ================= Mount A+B: B1 two divergent clients =================
  const db1 = makeDb()
  seedProject(db1)
  const now1 = new Date().toISOString()
  // A file uploaded by the OTHER member (used for B2 + the B4 gap check).
  db1.files.push({ id: 'file-seed-1', project_id: PROJECT_ID, name: 'فایل زهرا.pdf', size: 100, mime: 'application/pdf', storage: 'supabase', storage_path: PROJECT_ID + '/zahra.pdf', drive_id: null, uploaded_by: MEMBER2_ID, uploaded_at: now1, attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} })
  // A DM room + a personal message (B2): the DM room is seeded with the
  // project id only so the probe can route to it — real DM rooms have
  // project_id null and get their own list in G2.
  db1.rooms.push({ id: DM_ROOM_ID, project_id: PROJECT_ID, name: 'زهرا', type: 'dm', member_a: MEMBER_ID, member_b: MEMBER2_ID, created_by: MEMBER_ID, created_at: now1, visibility: 'personal', custom_fields: {} })
  db1.messages.push({ id: 'msg-dm-1', room_id: DM_ROOM_ID, author_id: MEMBER2_ID, body: 'پیام شخصی زهرا', parent_id: null, mentions: [], attachments: [], created_at: now1, visibility: 'personal', custom_fields: {} })
  const stub1 = makeStub(db1)

  // Both clients open the same EMPTY doc (same base state).
  const mA = await mountApp({ html, js }, stub1, '#/doc/' + DOC_ID)
  const wA = mA.w
  allErrors.push(...mA.errors)
  const taA = await waitFor(wA, () => wA.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea (client A)')
  const mB = await mountApp({ html, js }, stub1, '#/doc/' + DOC_ID, fakeSession(ZAHRA_USER_ID, 'zahra@probe.test'))
  const wB = mB.w
  allErrors.push(...mB.errors)
  const taB = await waitFor(wB, () => wB.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea (client B)')
  check('B1: both clients open the empty doc', taA.value === '' && taB.value === '')

  // Divergent edits from the same base: B types her text, A types TEXT35.
  await typeIntoDoc(wB, taB, TEXT_B)
  await typeIntoDoc(wA, taA, TEXT35)
  // Live path: A's text reaches B's textarea without reload.
  await waitFor(wB, () => taB.value.includes(TEXT35), 5000, 'live: B sees A text')
  check('B1 live: B textarea receives A text via BroadcastChannel', taB.value.includes(TEXT35))
  await waitFor(wA, () => taA.value.includes(TEXT_B), 5000, 'live: A sees B text')
  check('B1 live: A textarea receives B text via BroadcastChannel', taA.value.includes(TEXT_B))
  // Row path: both debounced saves land (2 s), then the row holds the merge.
  await waitFor(wA, () => wA.document.body.textContent.includes('ذخیره شد'), 10000, 'A saved indicator')
  await waitFor(wB, () => wB.document.body.textContent.includes('ذخیره شد'), 10000, 'B saved indicator')
  const merged = textOfDocRow(db1.docs[0])
  check('B1: merged row holds both texts', merged !== null && merged.includes(TEXT35) && merged.includes(TEXT_B), JSON.stringify(merged))
  check('B1: 35 + extra chars, 0 lost', merged !== null && [...merged].length === 35 + extraLen, merged === null ? 'null' : [...merged].length + ' chars')
  mA.dom.window.close()
  mB.dom.window.close()

  // Reload: a fresh mount returns the full merged text.
  const mC = await mountApp({ html, js }, stub1, '#/doc/' + DOC_ID)
  const wC = mC.w
  allErrors.push(...mC.errors)
  const taC = await waitFor(wC, () => wC.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea (reload)')
  await waitFor(wC, () => taC.value.length > 0, 5000, 'reloaded text present')
  check('B1: after reload, full merged text returns', taC.value === merged, JSON.stringify(taC.value))
  // B1 versions: a saved version holds the same text.
  clickButton(wC, wC.document, 'ذخیرهٔ نسخه')
  await waitFor(wC, () => db1.versions.length === 1, 10000, 'version row created')
  const v1b64 = db1.versions[0].snapshot_ref
  const vDoc = new Y.Doc()
  check('B1: version snapshot decodes', applyDocState(vDoc, v1b64, 'probe'))
  check('B1: version holds the same text as the doc', vDoc.getText('content').toString() === merged)
  check('B1: version row has author + server time', db1.versions[0].author_id === MEMBER_ID && !!db1.versions[0].created_at)
  mC.dom.window.close()

  // ================= Mount D: B2 second person + personal message =================
  const mD = await mountApp({ html, js }, stub1, '#/', fakeSession(ZAHRA_USER_ID, 'zahra@probe.test'))
  const wD = mD.w
  allErrors.push(...mD.errors)
  await waitFor(wD, () => wD.document.body.textContent.includes('پروژهٔ پروب B'), 10000, 'home project card (Zahra)')
  check('B2: doc row visibility is project', db1.docs[0].visibility === 'project')
  check('B2: file row visibility is project', db1.files[0].visibility === 'project')
  check('B2: Zahra sees the same file on home', wD.document.body.textContent.includes('فایل زهرا.pdf'))
  // Zahra opens the doc: same text.
  wD.location.hash = '#/doc/' + DOC_ID
  wD.dispatchEvent(new wD.Event('hashchange'))
  const taD = await waitFor(wD, () => wD.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea (Zahra)')
  await waitFor(wD, () => taD.value.length > 0, 5000, 'Zahra doc text present')
  check('B2: Zahra sees the same doc text', taD.value === merged, JSON.stringify(taD.value))
  // Project room: the personal message is NOT there; a project message is project-visible.
  wD.location.hash = '#/room/' + ROOM_ID
  wD.dispatchEvent(new wD.Event('hashchange'))
  const chatInput = await waitFor(wD, () => wD.document.querySelector('input[placeholder="پیام بنویسید…"]'), 10000, 'chat input (project room)')
  await sleep(800)
  check('B2: personal message is NOT shown in the project room', !wD.document.body.textContent.includes('پیام شخصی زهرا'))
  setInput(wD, chatInput, 'پیام پروژه')
  clickButton(wD, wD.document, 'فرستادن')
  await waitFor(wD, () => db1.messages.some((m) => m.body === 'پیام پروژه'), 10000, 'project message row')
  const projMsg = db1.messages.find((m) => m.body === 'پیام پروژه')
  check('B2: project-room message is visibility=project', projMsg.visibility === 'project', JSON.stringify(projMsg.visibility))
  // DM room: the personal message IS there; a reply there is personal.
  wD.location.hash = '#/room/' + DM_ROOM_ID
  wD.dispatchEvent(new wD.Event('hashchange'))
  await waitFor(wD, () => wD.document.body.textContent.includes('پیام شخصی زهرا'), 10000, 'personal message in DM room')
  check('B2: personal message IS shown in the DM room', true)
  const chatInputDm = await waitFor(wD, () => wD.document.querySelector('input[placeholder="پیام بنویسید…"]'), 10000, 'chat input (DM room)')
  setInput(wD, chatInputDm, 'پاسخ شخصی')
  clickButton(wD, wD.document, 'فرستادن')
  await waitFor(wD, () => db1.messages.some((m) => m.body === 'پاسخ شخصی'), 10000, 'DM message row')
  const dmMsg = db1.messages.find((m) => m.body === 'پاسخ شخصی')
  check('B2: DM-room message is visibility=personal', dmMsg.visibility === 'personal', JSON.stringify(dmMsg.visibility))
  mD.dom.window.close()

  // ================= Mount E: B3 comments + versions =================
  // Own yjs_doc_id: jsdom window.close() does not run the app's cleanup,
  // so dead mounts' BroadcastChannels stay registered in Node — a shared
  // channel name would let their stale state leak into this mount.
  const db2 = makeDb()
  seedProject(db2, { docText: S1, yjsDocId: 'doc-p01-b-3' })
  const stub2 = makeStub(db2)
  const mE = await mountApp({ html, js }, stub2, '#/doc/' + DOC_ID)
  const wE = mE.w
  allErrors.push(...mE.errors)
  const taE = await waitFor(wE, () => wE.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea (B3)')
  await waitFor(wE, () => taE.value === S1, 5000, 'seeded doc text present')
  check('B3: seeded doc text loads', taE.value === S1)

  const commentBox = () => wE.document.querySelector('aside textarea')
  async function addCommentViaUI(body, submitLabel) {
    const box = await waitFor(wE, () => commentBox(), 10000, 'comment box')
    setInput(wE, box, body)
    clickButton(wE, wE.document, submitLabel)
  }
  // Comment 1 (top-level, no anchor).
  await addCommentViaUI('نظر یک دربارهٔ سند', 'ثبت نظر')
  await waitFor(wE, () => db2.comments.length === 1, 10000, 'comment 1 row')
  const c1 = db2.comments[0]
  check('B3: comment 1 row has doc/author/body/resolved/parent', c1.doc_id === DOC_ID && c1.author_id === MEMBER_ID && c1.body === 'نظر یک دربارهٔ سند' && c1.resolved === false && c1.parent_id === null, JSON.stringify(c1))
  // Comment 2 (top-level).
  await addCommentViaUI('نظر دو', 'ثبت نظر')
  await waitFor(wE, () => db2.comments.length === 2, 10000, 'comment 2 row')
  const c2 = db2.comments.find((c) => c.body === 'نظر دو')
  check('B3: comment 2 is top-level too', c2 && c2.parent_id === null)
  // Reply to comment 2 (one-level threading).
  const replyBtn = [...wE.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'پاسخ' && b.closest('li')?.textContent.includes('نظر دو')
  )
  check('B3: reply button exists on comment 2', !!replyBtn)
  if (replyBtn) replyBtn.click()
  await waitFor(wE, () => wE.document.body.textContent.includes('پاسخ به'), 5000, 'reply indicator')
  await addCommentViaUI('پاسخ به نظر دو', 'ثبت پاسخ')
  await waitFor(wE, () => db2.comments.length === 3, 10000, 'reply row')
  const reply = db2.comments.find((c) => c.body === 'پاسخ به نظر دو')
  check('B3: reply row parent_id points at comment 2', reply && reply.parent_id === c2.id, JSON.stringify(reply && reply.parent_id))
  check('B3: reply renders nested under its parent', !!wE.document.querySelector('aside li.ms-4'))
  // Resolve comment 1, then reopen it.
  const resolveBtn = [...wE.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'حل‌شده' && b.closest('li')?.textContent.includes('نظر یک دربارهٔ سند')
  )
  check('B3: resolve button exists on comment 1', !!resolveBtn)
  if (resolveBtn) resolveBtn.click()
  await waitFor(wE, () => db2.comments.find((c) => c.id === c1.id).resolved === true, 10000, 'comment 1 resolved in db')
  check('B3: comment 1 resolved', true)
  await waitFor(wE, () => [...wE.document.querySelectorAll('button')].some((b) => b.textContent.includes('نظرهای حل‌شده')), 10000, 'resolved toggle appears')
  clickButton(wE, wE.document, [...wE.document.querySelectorAll('button')].find((b) => b.textContent.includes('نظرهای حل‌شده')).textContent.trim())
  await waitFor(wE, () => wE.document.body.textContent.includes('باز کردن دوباره'), 5000, 'resolved comment shown')
  const reopenBtn = [...wE.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'باز کردن دوباره' && b.closest('li')?.textContent.includes('نظر یک دربارهٔ سند')
  )
  check('B3: reopen button exists on resolved comment 1', !!reopenBtn)
  if (reopenBtn) reopenBtn.click()
  await waitFor(wE, () => db2.comments.find((c) => c.id === c1.id).resolved === false, 10000, 'comment 1 reopened in db')
  check('B3: comment 1 reopened (resolve/reopen round-trip)', true)

  // Versions: save v1 (S1), edit, save v2, restore v1 -> v3, v2 untouched.
  const noteInput = () => wE.document.querySelector('input[placeholder="یادداشت نسخه (اختیاری)"]')
  await waitFor(wE, () => noteInput(), 10000, 'version note input')
  clickButton(wE, wE.document, 'ذخیرهٔ نسخه')
  await waitFor(wE, () => db2.versions.length === 1, 10000, 'version 1 row')
  const v1 = db2.versions[0]
  check('B3: version 1 is version_no 1 with author + note fields', v1.version_no === 1 && v1.author_id === MEMBER_ID, JSON.stringify(v1))
  check('B3: version 1 snapshot holds S1', textOfDocRow({ custom_fields: { yjs_state_b64: v1.snapshot_ref } }) === S1)
  await typeIntoDoc(wE, taE, ADD2) // appends to the loaded S1
  await waitFor(wE, () => wE.document.body.textContent.includes('ذخیره شد'), 10000, 'edited doc saved')
  setInput(wE, noteInput(), 'نسخهٔ دو')
  clickButton(wE, wE.document, 'ذخیرهٔ نسخه')
  await waitFor(wE, () => db2.versions.length === 2, 10000, 'version 2 row')
  const v2 = db2.versions.find((v) => v.version_no === 2)
  const v2snapBefore = v2.snapshot_ref
  check('B3: version 2 snapshot holds S1 + addition', textOfDocRow({ custom_fields: { yjs_state_b64: v2.snapshot_ref } }) === S1 + ADD2)
  check('B3: version 2 note recorded', v2.note === 'نسخهٔ دو')
  // Restore version 1 (confirm() is stubbed true).
  const v1Card = [...wE.document.querySelectorAll('li')].find(
    (li) => li.textContent.includes('نسخهٔ 1') && !li.textContent.includes('نسخهٔ 2') && li.textContent.includes('برگرداندن')
  )
  check('B3: version 1 card with restore button found', !!v1Card)
  if (v1Card) {
    [...v1Card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'برگرداندن').click()
  }
  await waitFor(wE, () => db2.versions.length === 3, 10000, 'version 3 row after restore')
  const v3 = db2.versions.find((v) => v.version_no === 3)
  check('B3: restore creates a NEW version 3', !!v3)
  check('B3: version 3 snapshot holds S1 (restored text)', v3 && textOfDocRow({ custom_fields: { yjs_state_b64: v3.snapshot_ref } }) === S1)
  check('B3: version 3 note names its source', v3 && (v3.note || '').includes('برگردانده‌شده از نسخهٔ 1'), JSON.stringify(v3 && v3.note))
  const v2After = db2.versions.find((v) => v.version_no === 2)
  check('B3: version 2 untouched by the restore', v2After.snapshot_ref === v2snapBefore && v2After.version_no === 2)
  await waitFor(wE, () => taE.value === S1, 10000, 'doc text back to S1 after restore')
  check('B3: doc text is S1 after restore', taE.value === S1)
  await waitFor(wE, () => textOfDocRow(db2.docs[0]) === S1, 10000, 'doc row saved as S1 after restore')
  check('B3: doc row saved as S1 after restore', true)
  mE.dom.window.close()

  // ================= Mount F: B4 file attached to a task =================
  // Own yjs_doc_id (same stale-channel reason as mount E).
  const db3 = makeDb()
  seedProject(db3, { yjsDocId: 'doc-p01-b-4' })
  const stub3 = makeStub(db3)
  const mF = await mountApp({ html, js }, stub3, '#/tasks')
  const wF = mF.w
  allErrors.push(...mF.errors)
  const taskTitle = await waitFor(wF, () => wF.document.querySelector('input[placeholder="عنوان کار تازه"]'), 10000, 'task title input')
  setInput(wF, taskTitle, 'کار با فایل')
  clickButton(wF, wF.document, 'ساختن کار')
  await waitFor(wF, () => db3.tasks.length === 1, 10000, 'task row created')
  const task = db3.tasks[0]
  const taskCard = [...wF.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار با فایل'))
  check('B4: task card renders', !!taskCard)
  const filesToggle = [...taskCard.querySelectorAll('button')].find((b) => hasLabel(b, 'فایل‌ها (0)'))
  check('B4: task file toggle shows count 0', !!filesToggle)
  if (filesToggle) filesToggle.click()
  const fileInput = await waitFor(wF, () => taskCard.querySelector('input[type="file"]'), 10000, 'task file input')
  const fileBytes = new TextEncoder().encode('TASK FILE BYTES — 0123456789')
  const upFile = new wF.File([fileBytes], 'task-file.txt', { type: 'text/plain' })
  setFileInput(wF, fileInput, [upFile])
  await waitFor(wF, () => db3.files.length === 1, 10000, 'task file row created')
  const frow = db3.files[0]
  check('B4: file row attached_to_type=task + attached_to_id=task', frow.attached_to_type === 'task' && frow.attached_to_id === task.id, JSON.stringify({ t: frow.attached_to_type, id: frow.attached_to_id }))
  check('B4: file row visibility=project', frow.visibility === 'project')
  check('B4: file row size matches uploaded bytes', frow.size === fileBytes.length, String(frow.size) + ' vs ' + fileBytes.length)
  check('B4: storage object holds the exact bytes', bytesEqual(stub3.store.get(frow.storage_path), fileBytes))
  await waitFor(wF, () => taskCard.textContent.includes('task-file.txt'), 10000, 'task file listed under the task')
  check('B4: task file listed in the task section with «کار» badge', taskCard.textContent.includes('task-file.txt') && taskCard.textContent.includes('کار'))
  check('B4: task file toggle count is now 1', [...taskCard.querySelectorAll('button')].some((b) => hasLabel(b, 'فایل‌ها (1)')))
  // Project-wide list (home) still shows the task-attached file.
  wF.location.hash = '#/'
  wF.dispatchEvent(new wF.Event('hashchange'))
  await waitFor(wF, () => wF.document.body.textContent.includes('task-file.txt'), 10000, 'task file in project-wide list')
  check('B4: project-wide file list still shows the task file', true)
  // Download: click دانلود -> signed URL -> fetch the bytes back.
  wF.location.hash = '#/tasks'
  wF.dispatchEvent(new wF.Event('hashchange'))
  const taskCard2 = await waitFor(wF, () => [...wF.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار با فایل')), 10000, 'task card after return')
  const toggle2 = [...taskCard2.querySelectorAll('button')].find((b) => hasLabel(b, 'فایل‌ها (1)'))
  if (toggle2) toggle2.click()
  await waitFor(wF, () => taskCard2.querySelector('input[type="file"]'), 10000, 'task file input again')
  // Scope download/delete to the FILE row <li> (innermost <li> holding
  // the file name) — the task card itself has its own «حذف» button (native
  // confirm(), inert in jsdom), which an unscoped search hits first.
  const fileLi = () => {
    const cands = [...taskCard2.querySelectorAll('li')].filter((li) => li.textContent.includes('task-file.txt'))
    return cands[cands.length - 1]
  }
  const dlBtn = [...(fileLi() ? fileLi().querySelectorAll('button') : [])].find((b) => b.textContent.trim() === 'دانلود')
  check('B4: download button exists for the task file', !!dlBtn)
  if (dlBtn) dlBtn.click()
  await waitFor(wF, () => stub3.calls.storageSigns.some((s) => s.path === frow.storage_path), 10000, 'signed URL requested')
  const sign = stub3.calls.storageSigns.find((s) => s.path === frow.storage_path)
  const dlRes = await stub3.stubFetch(sign.url)
  const dlBytes = new Uint8Array(await dlRes.arrayBuffer())
  check('B4: download returns the exact uploaded bytes', bytesEqual(dlBytes, fileBytes), 'got ' + dlBytes.length + ' bytes, expected ' + fileBytes.length)
  // Delete: two taps (arm -> confirm), row + storage object gone.
  const delBtn = [...(fileLi() ? fileLi().querySelectorAll('button') : [])].find((b) => b.textContent.trim() === 'حذف')
  check('B4: delete button exists for own file', !!delBtn)
  if (delBtn) delBtn.click()
  await waitFor(wF, () => [...(fileLi() ? fileLi().querySelectorAll('button') : [])].some((b) => b.textContent.trim() === 'مطمئنید؟'), 5000, 'delete armed')
  const confirmBtn = [...(fileLi() ? fileLi().querySelectorAll('button') : [])].find((b) => b.textContent.trim() === 'مطمئنید؟')
  if (confirmBtn) confirmBtn.click()
  await waitFor(wF, () => db3.files.length === 0, 10000, 'file row deleted')
  check('B4: file row deleted after two taps', db3.files.length === 0)
  check('B4: storage object removed', !stub3.store.has(frow.storage_path) && stub3.calls.storageRemoves.includes(frow.storage_path))
  // The success message itself contains the file name («فایل … حذف شد.»),
  // so assert on the list's empty state, not on the whole card text.
  await waitFor(wF, () => {
    const card = [...wF.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار با فایل'))
    return card && card.textContent.includes('هنوز فایلی نیست')
  }, 10000, 'file gone from task list')
  check('B4: file disappears from the task list', true)
  // 5 MB cap: an oversize file is rejected before any upload.
  const bigFile = new wF.File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.bin', { type: 'application/octet-stream' })
  const uploadsBefore = stub3.calls.storageUploads.length
  setFileInput(wF, taskCard2.querySelector('input[type="file"]'), [bigFile])
  await waitFor(wF, () => taskCard2.textContent.includes('۵ مگابایت'), 10000, 'oversize error shown')
  check('B4: file over 5 MB rejected with a clear message', true)
  check('B4: oversize file wrote no row and no upload', db3.files.length === 0 && stub3.calls.storageUploads.length === uploadsBefore)
  // Known gap (D6 re-test): the delete button is visible only to the uploader.
  db3.files.push({ id: 'file-other', project_id: PROJECT_ID, name: 'فایل زهرا.txt', size: 10, mime: 'text/plain', storage: 'supabase', storage_path: PROJECT_ID + '/other.txt', drive_id: null, uploaded_by: MEMBER2_ID, uploaded_at: new Date().toISOString(), attached_to_type: 'task', attached_to_id: task.id, visibility: 'project', custom_fields: {} })
  const mF2 = await mountApp({ html, js }, stub3, '#/tasks')
  const wF2 = mF2.w
  allErrors.push(...mF2.errors)
  const taskCard3 = await waitFor(wF2, () => [...wF2.document.querySelectorAll('li')].find((li) => li.textContent.includes('کار با فایل')), 10000, 'task card (second mount)')
  const toggle3 = [...taskCard3.querySelectorAll('button')].find((b) => hasLabel(b, 'فایل‌ها (1)'))
  if (toggle3) toggle3.click()
  await waitFor(wF2, () => taskCard3.textContent.includes('فایل زهرا.txt'), 10000, 'other-member file listed')
  // The task card <li> itself contains the file name (the file <li> is
  // nested inside it), so take the LAST matching <li> — the innermost one.
  const otherCandidates = [...taskCard3.querySelectorAll('li')].filter((li) =>
    li.textContent.includes('فایل زهرا.txt')
  )
  const otherLi = otherCandidates[otherCandidates.length - 1]
  const otherHasDelete = [...(otherLi ? otherLi.querySelectorAll('button') : [])].some((b) => b.textContent.trim() === 'حذف')
  const otherHasDownload = [...(otherLi ? otherLi.querySelectorAll('button') : [])].some((b) => b.textContent.trim() === 'دانلود')
  check('B4 gap REMAINS: no in-page delete button for a file uploaded by the other member', !otherHasDelete, 'delete button present: ' + otherHasDelete)
  check('B4 gap: download still offered for the other-member file', otherHasDownload)
  mF2.dom.window.close()
  mF.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL P01-B PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('P01-B PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
