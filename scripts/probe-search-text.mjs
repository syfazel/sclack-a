// Phase 3 probe (scripts/probe-search-text.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the UI the way a user would, and asserts
// the Phase 3 scope: saving a doc also writes docs.search_text (plain
// Yjs text, capped at 20,000 chars), global search finds text matches
// with a snippet + match badge, title search still works, an empty query
// behaves as before, and — with the search_text column missing (the
// live migration not yet run) — saving a doc still lands and search
// silently falls back to title-only. No live Supabase, no test data in
// live tables.
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-search-text.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import * as Y from 'yjs'
import { decodeDocState } from '../src/lib/yjs-sync.js'
import { buildSearchSnippet, SEARCH_TEXT_MAX_CHARS } from '../src/lib/extract.js'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT2_ID = '33333333-3333-3333-3333-333333333334'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'
const MSG_ID = '66666666-6666-6666-6666-666666666666'
const FILE_ID = '77777777-7777-7777-7777-777777777777'
const TASK_ID = '88888888-8888-8888-8888-888888888888'

const TEXT = 'این سند دربارهٔ مچینگ و TRL حرف می‌زند و بس.'
const TEXT2 = 'متن دوم با واژهٔ مچینگ برای نگهبان ستون ناموجود.'

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

// ---------- pure snippet checks (Node, no DOM) ----------
check('pure: SEARCH_TEXT_MAX_CHARS is 20000 (decision D2)', SEARCH_TEXT_MAX_CHARS === 20000, String(SEARCH_TEXT_MAX_CHARS))
{
  const s = buildSearchSnippet(TEXT, 'مچینگ')
  check('pure: snippet contains the matched word', s.includes('مچینگ'), JSON.stringify(s))
  check('pure: snippet window is about 120 chars', [...s].length <= 120 + 'مچینگ'.length, String([...s].length))
  check('pure: no match gives an empty snippet', buildSearchSnippet(TEXT, 'واژهٔ ناموجود') === '')
  check('pure: empty query gives an empty snippet', buildSearchSnippet(TEXT, '') === '')
  const long = 'x'.repeat(200) + 'مچینگ' + 'y'.repeat(200)
  const ls = buildSearchSnippet(long, 'مچینگ')
  check('pure: long text snippet is cut with … on both ends', ls.startsWith('…') && ls.endsWith('…'), JSON.stringify(ls.slice(0, 20)))
}

// ---------- in-memory stub backend (same shape as probe-docview) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} },
      { id: PROJECT2_ID, workspace_id: 'main', name: 'پروژهٔ دوم', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند پروب', yjs_doc_id: 'doc-probe-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {}, search_text: null },
      { id: DOC2_ID, project_id: PROJECT2_ID, title: 'سند دوم', yjs_doc_id: 'doc-probe-2', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {}, search_text: null }
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
  const calls = { docPatch: [], searchTextRejected: 0 }
  // Case 5 flag: when true, the docs table has NO search_text column —
  // the live state before the Phase 3 migration runs. Any read/write
  // naming the column answers 42703, exactly like PostgREST.
  const flags = { noSearchTextColumn: false }

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
      // supabase-js wraps .or() in parens: or=(a.ilike.x,b.ilike.y)
      const inner = orParam.startsWith('(') && orParam.endsWith(')') ? orParam.slice(1, -1) : orParam
      const parts = inner.split(',')
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

  function missingColumn() {
    return json({ message: 'column docs.search_text does not exist', code: '42703', details: null, hint: null }, 400)
  }

  function mentionsSearchText(params) {
    const select = params.get('select') || ''
    const or = params.get('or') || ''
    return select.includes('search_text') || or.includes('search_text')
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
      if (table === 'docs' && flags.noSearchTextColumn && mentionsSearchText(params)) {
        return missingColumn()
      }
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
      if (table === 'docs' && flags.noSearchTextColumn && 'search_text' in body) {
        calls.searchTextRejected++
        return missingColumn()
      }
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'docs') calls.docPatch.push({ id: matched.map((r) => r.id), body })
      if (single) return matched.length === 1 ? json(matched[0]) : json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
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

  return { calls, stubFetch, db, flags }
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

function docTextFromB64(b64) {
  const doc = new Y.Doc()
  const bytes = decodeDocState(b64)
  Y.applyUpdate(doc, bytes)
  return doc.getText('content').toString()
}

function docRow(db) {
  return db.docs.find((d) => d.id === DOC_ID)
}

function docCard(section) {
  // Scope to the search section: the sidebar also links to #/doc/<id>.
  return section.querySelector('a[href="#/doc/' + DOC_ID + '"]')
}

async function runSearch(w, query) {
  const input = await waitFor(w, () => w.document.querySelector('input[placeholder^="در پیام"]'), 10000, 'search input')
  const section = input.closest('section')
  setInput(w, input, query)
  const btn = [...section.querySelectorAll('button')].find((b) => b.textContent.trim() === 'جست‌وجو')
  btn.click()
  await sleep(900)
  return section
}

async function typeDocText(w, text) {
  const ta = await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea')
  for (const ch of text) {
    ta.value = ta.value + ch
    ta.dispatchEvent(new w.Event('input', { bubbles: true }))
    await sleep(15)
  }
  await sleep(3500) // autosave debounce is 2 s
}

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  // ---- Case 1–4: column present — save writes search_text, search finds text ----
  const db = makeDb()
  const stub = makeStub(db)
  const m1 = await mountApp({ html, js }, stub, '#/doc/' + DOC_ID)
  const { w } = m1
  m1errors = m1.errors
  await typeDocText(w, TEXT)
  check('save: autosave PATCHed the docs row', stub.calls.docPatch.length >= 1, 'patches: ' + stub.calls.docPatch.length)
  const textPatch = [...stub.calls.docPatch].reverse().find((p) => 'search_text' in p.body)
  check('save: a separate PATCH writes search_text', !!textPatch, JSON.stringify(stub.calls.docPatch.map((p) => Object.keys(p.body))))
  check('save: search_text is the plain typed text', textPatch && textPatch.body.search_text === TEXT, JSON.stringify(textPatch?.body?.search_text))
  check('save: stub row carries search_text', docRow(db).search_text === TEXT, JSON.stringify(docRow(db).search_text))
  check('save: snapshot still decodes to the typed text', docTextFromB64(docRow(db).custom_fields.yjs_state_b64) === TEXT)
  check('save: «ذخیره شد» indicator shows', w.document.body.textContent.includes('ذخیره شد'))

  // Go home and search the body word.
  w.location.hash = '#/'
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => w.document.querySelector('input[placeholder^="در پیام"]'), 10000, 'search input after home')
  check('ui: the honest «فقط عنوان» sentence is gone', !w.document.body.textContent.includes('نه در متن آن'))

  let section = await runSearch(w, 'مچینگ')
  const card1 = await waitFor(w, () => docCard(section), 10000, 'doc result for مچینگ')
  check('search: body word finds the doc', !!card1)
  check('search: snippet element shows the matched word', !!card1.querySelector('.search-snippet') && card1.querySelector('.search-snippet').textContent.includes('مچینگ'), card1.querySelector('.search-snippet')?.textContent)
  check('search: matched word is marked in the snippet', !!card1.querySelector('.search-snippet mark') && card1.querySelector('.search-snippet mark').textContent === 'مچینگ')
  check('search: badge says «در متن» (text-only match)', card1.textContent.includes('در متن') && !card1.textContent.includes('در عنوان'), card1.textContent.slice(0, 120))
  check('search: no partial-error warning for the text query', !section.textContent.includes('کامل نشد'))

  // Title search still works — and reports a title-only match.
  section = await runSearch(w, 'پروب')
  const card2 = await waitFor(w, () => docCard(section), 10000, 'doc result for پروب')
  check('search: title word still finds the doc', !!card2)
  check('search: title-only match gets the «در عنوان» badge', card2.textContent.includes('در عنوان'))
  check('search: title-only match shows no snippet', !card2.querySelector('.search-snippet'))

  // Text-only match on the other marker word.
  section = await runSearch(w, 'TRL')
  const card3 = await waitFor(w, () => docCard(section), 10000, 'doc result for TRL')
  check('search: second body word finds the doc with a snippet', !!card3 && !!card3.querySelector('.search-snippet') && card3.querySelector('.search-snippet').textContent.includes('TRL'))

  // Empty query: no search runs — the previous results stay exactly as
  // they were, no error appears.
  const beforeEmpty = section.textContent
  section = await runSearch(w, '')
  check('search: empty query runs no search (results unchanged, no error)', section.textContent === beforeEmpty && !section.querySelector('.text-error'))

  // ---- Case 5: column missing — save lands, search falls back to title-only ----
  const db2 = makeDb()
  const stub2 = makeStub(db2)
  stub2.flags.noSearchTextColumn = true
  const m2 = await mountApp({ html, js }, stub2, '#/doc/' + DOC_ID)
  const w2 = m2.w
  await typeDocText(w2, TEXT2)
  check('guard: save lands with the column missing (snapshot PATCHed)', stub2.calls.docPatch.length >= 1, 'patches: ' + stub2.calls.docPatch.length)
  check('guard: the missing-column write was attempted and swallowed (42703)', stub2.calls.searchTextRejected >= 1, 'rejected: ' + stub2.calls.searchTextRejected)
  check('guard: snapshot decodes to the typed text', docTextFromB64(docRow(db2).custom_fields.yjs_state_b64) === TEXT2, JSON.stringify(docTextFromB64(docRow(db2).custom_fields.yjs_state_b64 || '')))
  check('guard: «ذخیره شد» still shows with the column missing', w2.document.body.textContent.includes('ذخیره شد'))
  check('guard: no column error leaks into the doc view', !/search_text|does not exist|42703/.test(w2.document.body.textContent))

  w2.location.hash = '#/'
  w2.dispatchEvent(new w2.Event('hashchange'))
  await waitFor(w2, () => w2.document.querySelector('input[placeholder^="در پیام"]'), 10000, 'search input (guard mount)')
  section = await runSearch(w2, 'پروب')
  const card5 = await waitFor(w2, () => docCard(section), 10000, 'doc result for پروب (guard mount)')
  check('guard: title search still works with the column missing', !!card5)
  check('guard: fallback shows the «در عنوان» badge, no snippet', card5.textContent.includes('در عنوان') && !card5.querySelector('.search-snippet'))
  check('guard: fallback raises no partial-error warning', !section.textContent.includes('کامل نشد'))
  section = await runSearch(w2, 'مچینگ')
  await waitFor(w2, () => section.textContent.includes('چیزی پیدا نشد'), 10000, 'empty state for body word (guard mount)')
  check('guard: body word finds nothing with the column missing (no crash)', section.textContent.includes('چیزی پیدا نشد'))
  check('guard: no error shown for the body-word search', !section.querySelector('.text-error'))

  // ---- JS errors (excluding Realtime/WebSocket noise) ----
  const allErrors = [...m1.errors, ...m2.errors].filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across both mounts', allErrors.length === 0, JSON.stringify(allErrors.slice(0, 3)))
  if (m1.errors.length + m2.errors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', m1.errors.length + m2.errors.length, 'entries')

  m1.dom.window.close()
  m2.dom.window.close()
  console.log(failures === 0 ? 'ALL SEARCH-TEXT PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('SEARCH-TEXT PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
