// Phase 5 probe (scripts/probe-doc-nest.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the UI the way a user would, and asserts
// the Phase 5 scope: the nested-doc tree (src/lib/extract.js), the
// sidebar tree with collapse + child counts, the DocView breadcrumb and
// move action, and the cycle guard in docs.js (setDocParent). Pure Node
// checks run the tree helpers directly. No live Supabase, no test data
// in live tables. A second stub variant answers 42703 for parent_id
// writes, proving the missing-column guard (the live migration has not
// run yet — the SQL Editor path).
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-doc-nest.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import {
  buildDocTree,
  docAncestors,
  isDocDescendantOf,
  validateDocParent,
  moveParentOptions
} from '../src/lib/extract.js'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_A_ID = '55555555-5555-5555-5555-555555555555'
const DOC_B_ID = '55555555-5555-5555-5555-555555555556'
const DOC_C_ID = '55555555-5555-5555-5555-555555555557'
const DOC_D_ID = '55555555-5555-5555-5555-555555555558'

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

// ---------- pure tree checks (Node, no DOM) ----------
{
  const DOCS = [
    { id: 'a', title: 'الف', parent_id: null },
    { id: 'b', title: 'ب', parent_id: 'a' },
    { id: 'c', title: 'ج', parent_id: 'b' },
    { id: 'd', title: 'د', parent_id: null },
    { id: 'x', title: 'یتیم', parent_id: 'missing' },
    { id: 's', title: 'خودوالد', parent_id: 's' }
  ]
  const tree = buildDocTree(DOCS)
  check('pure: roots are a, d, orphan x, self-parent s (input order)', tree.map((n) => n.id).join(',') === 'a,d,x,s', tree.map((n) => n.id).join(','))
  check('pure: b is the child of a', tree[0].children.length === 1 && tree[0].children[0].id === 'b')
  check('pure: c is the child of b (grandchild of a)', tree[0].children[0].children.length === 1 && tree[0].children[0].children[0].id === 'c')
  check('pure: buildDocTree does not mutate the input rows', !('children' in DOCS[1]))
  check('pure: ancestors of c are a then b', docAncestors(DOCS, 'c').map((d) => d.id).join(',') === 'a,b')
  check('pure: ancestors of a are empty', docAncestors(DOCS, 'a').length === 0)
  check('pure: c is a descendant of a', isDocDescendantOf(DOCS, 'c', 'a') === true)
  check('pure: a is not a descendant of c', isDocDescendantOf(DOCS, 'a', 'c') === false)
  check('pure: self-parent is rejected', validateDocParent(DOCS, 'a', 'a') === 'سند نمی‌تواند زیرِ خودش باشد.')
  check('pure: grandchild as parent is rejected (cycle)', validateDocParent(DOCS, 'a', 'c') === 'این سند زیرمجموعهٔ سندِ فعلی است؛ چرخه ساخته نمی‌شود.')
  check('pure: unrelated parent is allowed', validateDocParent(DOCS, 'a', 'd') === null)
  check('pure: back to root is allowed', validateDocParent(DOCS, 'c', null) === null)
  check('pure: missing parent is rejected', validateDocParent(DOCS, 'a', 'missing') === 'سند والد پیدا نشد.')
  check('pure: move options for a exclude a, b, c', moveParentOptions(DOCS, 'a').map((d) => d.id).join(',') === 'd,x,s')
  check('pure: move options for c keep a, b, d', moveParentOptions(DOCS, 'c').map((d) => d.id).join(',') === 'a,b,d,x,s')
}

// ---------- in-memory stub backend (same shape as probe-doc-rich) ----------
function makeDb() {
  const now = new Date().toISOString()
  const doc = (id, title, parent_id, yjs_doc_id) => ({
    id, project_id: PROJECT_ID, title, yjs_doc_id, template_id: null,
    created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1,
    visibility: 'project', custom_fields: {}, search_text: null, parent_id
  })
  return {
    members: [],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      doc(DOC_A_ID, 'سند الف', null, 'doc-nest-1'),
      doc(DOC_B_ID, 'سند ب', DOC_A_ID, 'doc-nest-2'),
      doc(DOC_C_ID, 'سند ج', DOC_B_ID, 'doc-nest-3'),
      doc(DOC_D_ID, 'سند د', null, 'doc-nest-4')
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

function makeStub(db, { rejectParentColumn = false } = {}) {
  const calls = { docParentPatch: [], parentRejected: 0 }

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

  // PostgREST answers 42703 when a named column does not exist —
  // exactly what the live table does before the migration runs.
  function missingColumn() {
    return json({ message: 'column docs.parent_id does not exist', code: '42703', details: null, hint: null }, 400)
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
      if (table === 'docs' && 'parent_id' in body) {
        if (rejectParentColumn) {
          calls.parentRejected++
          return missingColumn()
        }
        calls.docParentPatch.push({ body, params: String(params) })
      }
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

function setSelect(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}

// Svelte flushes the bound select value async, so the apply button
// is still disabled right after setSelect — wait for it to enable.
async function clickApply(w) {
  const btn = await waitFor(
    w,
    () => {
      const b = w.document.querySelector('[data-move-apply]')
      return b && !b.disabled ? b : null
    },
    10000,
    'enabled apply button'
  )
  btn.click()
}

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  const db = makeDb()
  const stub = makeStub(db)

  // ---- Mount A: doc C (grandchild) — tree, breadcrumb, move to root ----
  const m1 = await mountApp({ html, js }, stub, '#/doc/' + DOC_C_ID)
  const { w } = m1
  m1errors = m1.errors
  await waitFor(w, () => w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]'), 10000, 'sidebar tree')
  check('tree: b renders nested inside a', !!w.document.querySelector('li[data-doc-node="' + DOC_A_ID + '"] li[data-doc-node="' + DOC_B_ID + '"]'))
  check('tree: c renders nested inside b', !!w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"] li[data-doc-node="' + DOC_C_ID + '"]'))
  check('tree: d renders at the root level', !!w.document.querySelector('[data-doc-tree] > li[data-doc-node="' + DOC_D_ID + '"]'))
  check('tree: a shows a child-count badge of 1', w.document.querySelector('[data-doc-child-count="' + DOC_A_ID + '"]')?.textContent.trim() === '1')
  check('tree: b shows a child-count badge of 1', w.document.querySelector('[data-doc-child-count="' + DOC_B_ID + '"]')?.textContent.trim() === '1')
  check('tree: d has no child-count badge', !w.document.querySelector('[data-doc-child-count="' + DOC_D_ID + '"]'))

  // Collapse A hides its whole subtree; expanding brings it back.
  w.document.querySelector('[data-doc-toggle="' + DOC_A_ID + '"]').click()
  await waitFor(w, () => !w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]'), 10000, 'collapsed subtree')
  check('tree: collapsing a hides b and c', !w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]') && !w.document.querySelector('li[data-doc-node="' + DOC_C_ID + '"]'))
  w.document.querySelector('[data-doc-toggle="' + DOC_A_ID + '"]').click()
  await waitFor(w, () => w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]'), 10000, 'expanded subtree')
  check('tree: expanding a shows b again', !!w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]'))

  // Breadcrumb: a / b / current.
  const crumb = await waitFor(w, () => w.document.querySelector('[data-doc-breadcrumb]'), 10000, 'breadcrumb')
  const crumbLinks = [...crumb.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  check('breadcrumb: links a then b, in order', crumbLinks.join(',') === '#/doc/' + DOC_A_ID + ',#/doc/' + DOC_B_ID, crumbLinks.join(','))
  check('breadcrumb: current page is the doc title', crumb.textContent.includes('سند ج'))

  // Move picker on C: every doc except C itself is offered.
  const sel = await waitFor(w, () => w.document.querySelector('[data-move-parent]'), 10000, 'move picker')
  const optValues = [...sel.querySelectorAll('option')].map((o) => o.value)
  check('move: picker offers a, b, d but not c itself', optValues.includes(DOC_A_ID) && optValues.includes(DOC_B_ID) && optValues.includes(DOC_D_ID) && !optValues.includes(DOC_C_ID), optValues.join(','))

  // Move C back to the root.
  const rootBtn = await waitFor(w, () => w.document.querySelector('[data-move-root]'), 10000, 'back-to-root button')
  rootBtn.click()
  await waitFor(w, () => stub.calls.docParentPatch.some((p) => p.body.parent_id === null), 10000, 'root PATCH')
  check('move: back-to-root PATCHes parent_id null', stub.calls.docParentPatch.some((p) => p.body.parent_id === null))
  await waitFor(w, () => w.document.querySelector('[data-doc-tree] > li[data-doc-node="' + DOC_C_ID + '"]'), 10000, 'c at root')
  check('move: c is at the root level after the move', !!w.document.querySelector('[data-doc-tree] > li[data-doc-node="' + DOC_C_ID + '"]'))
  check('move: breadcrumb is gone for a root doc', !w.document.querySelector('[data-doc-breadcrumb]'))
  check('move: back-to-root button is gone for a root doc', !w.document.querySelector('[data-move-root]'))
  check('move: success message shows', w.document.querySelector('[data-move-msg]')?.textContent.includes('ریشه') === true)
  check('move: db row c has parent_id null', db.docs.find((d) => d.id === DOC_C_ID).parent_id === null)

  // ---- Mount B: doc A — the picker never offers self or descendants ----
  const m2 = await mountApp({ html, js }, stub, '#/doc/' + DOC_A_ID)
  const w2 = m2.w
  const sel2 = await waitFor(w2, () => w2.document.querySelector('[data-move-parent]'), 10000, 'move picker on a')
  const opt2 = [...sel2.querySelectorAll('option')].map((o) => o.value)
  // NOTE: mount A already moved C to the root in this shared stub DB,
  // so C is no longer a descendant of A here — it is correctly offered.
  // The guard must still exclude A itself and its remaining child B.
  check('guard: picker on a offers c and d (no self, no child b)', opt2.join(',') === ',' + DOC_C_ID + ',' + DOC_D_ID, opt2.join(','))
  check('guard: no root button on a root doc', !w2.document.querySelector('[data-move-root]'))
  check('guard: no breadcrumb on a root doc', !w2.document.querySelector('[data-doc-breadcrumb]'))
  // Move A under D (a legal move) — proves the picker path writes.
  setSelect(w2, sel2, DOC_D_ID)
  await clickApply(w2)
  await waitFor(w2, () => stub.calls.docParentPatch.some((p) => p.body.parent_id === DOC_D_ID), 10000, 'move PATCH')
  check('move: moving a under d PATCHes parent_id d', stub.calls.docParentPatch.some((p) => p.body.parent_id === DOC_D_ID))
  await waitFor(w2, () => w2.document.querySelector('[data-doc-breadcrumb]'), 10000, 'breadcrumb after move')
  check('move: breadcrumb appears after moving a under d', !!w2.document.querySelector('[data-doc-breadcrumb]'))
  check('move: db row a has parent_id d', db.docs.find((d) => d.id === DOC_A_ID).parent_id === DOC_D_ID)
  m2.dom.window.close()

  // ---- Mount C: missing-column guard (live table before migration) ----
  const db3 = makeDb()
  const stub3 = makeStub(db3, { rejectParentColumn: true })
  const m3 = await mountApp({ html, js }, stub3, '#/doc/' + DOC_D_ID)
  const w3 = m3.w
  const sel3 = await waitFor(w3, () => w3.document.querySelector('[data-move-parent]'), 10000, 'move picker (guard mount)')
  setSelect(w3, sel3, DOC_A_ID)
  await clickApply(w3)
  await waitFor(w3, () => {
    const m = w3.document.querySelector('[data-move-msg]')
    return m && m.textContent.includes('ستون تودرتویی') ? m : null
  }, 10000, 'missing-column message')
  check('guard: 42703 shows the clear Persian message', w3.document.querySelector('[data-move-msg]')?.textContent.includes('ستون تودرتویی هنوز روی دادهٔ زنده ساخته نشده است') === true)
  check('guard: the 42703 write was attempted and rejected', stub3.calls.parentRejected >= 1, 'rejected: ' + stub3.calls.parentRejected)
  check('guard: db row d is unchanged', db3.docs.find((d) => d.id === DOC_D_ID).parent_id === null)
  check('guard: no success message after the rejected move', !w3.document.querySelector('[data-move-msg]')?.textContent.includes('منتقل شد'))
  const realErrors3 = m3.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('guard mount: 0 non-Realtime JS errors', realErrors3.length === 0, JSON.stringify(realErrors3.slice(0, 3)))
  m3.dom.window.close()

  // ---- JS errors on the main mount (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL DOC-NEST PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('DOC-NEST PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
