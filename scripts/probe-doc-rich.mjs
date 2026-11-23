// Phase 4 probe (scripts/probe-doc-rich.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the UI the way a user would, and asserts
// the Phase 4 scope: the lite-Markdown renderer (src/lib/md-lite.js),
// read mode as the default, the edit toolbar, wikilinks, and live Yjs
// re-render of the read view. Pure Node checks run the renderer
// directly. No live Supabase, no test data in live tables.
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-doc-rich.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import * as Y from 'yjs'
import { decodeDocState } from '../src/lib/yjs-sync.js'
import { renderMdLite, insertMdSnippet, resolveWikiDoc } from '../src/lib/md-lite.js'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'
const DOC3_ID = '55555555-5555-5555-5555-555555555557'

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

// ---------- pure renderer checks (Node, no DOM) ----------
const DOCS = [
  { id: DOC3_ID, title: 'سند هدف', updated_at: '2026-11-20T00:00:00.000Z' },
  { id: DOC2_ID, title: 'سند هدف', updated_at: '2026-11-22T00:00:00.000Z' }
]
{
  const rows = Array.from({ length: 10 }, (_, i) => '| ردیف ' + (i + 1) + ' | ' + (i + 1) * 1000 + ' |').join('\n')
  const text =
    '# عنوان بزرگ\n\n## عنوان متوسط\n\nمتن **پررنگ** و *کج* و [[سند هدف]] و [[سند ناموجود]]\n\n' +
    '- آیتم یک\n  - زیرآیتم\n- آیتم دو\n\n۱. اول\n۲. دوم\n\n' +
    '| ستون ۱ | ستون ۲ |\n| --- | --- |\n' + rows + '\n\n<script>alert(1)</script>'
  const html = renderMdLite(text, DOCS)
  check('pure: # renders h1', html.includes('<h1>عنوان بزرگ</h1>'))
  check('pure: ## renders h2', html.includes('<h2>عنوان متوسط</h2>'))
  check('pure: **bold** renders strong', html.includes('<strong>پررنگ</strong>'))
  check('pure: *italic* renders em', html.includes('<em>کج</em>'))
  check('pure: unordered list renders with nested item', html.includes('<li>آیتم یک<ul><li>زیرآیتم</li></ul></li>'))
  check('pure: Persian-numbered list renders ol', html.includes('<ol><li>اول</li><li>دوم</li></ol>'), html.slice(0, 400))
  const tbody = (html.split('<tbody>')[1] || '').split('</tbody>')[0] || ''
  check('pure: 10-row table has 10 body rows', (tbody.match(/<tr>/g) || []).length === 10, String((tbody.match(/<tr>/g) || []).length))
  check('pure: table header uses th scope=col', html.includes('<th scope="col">ستون ۱</th>'))
  check('pure: duplicate title resolves to the newest-updated doc', html.includes('href="#/doc/' + DOC2_ID + '"'))
  check('pure: missing wikilink is not a link', !html.includes('سند ناموجود</a>') && html.includes('doc-wikilink-missing') && html.includes('یافت نشد'))
  check('pure: raw HTML is escaped (no XSS)', !html.includes('<script>') && html.includes('&lt;script&gt;'))
  check('pure: blank text renders empty', renderMdLite('  \n ', DOCS) === '')
  check('pure: resolveWikiDoc picks newest duplicate', resolveWikiDoc(DOCS, 'سند هدف')?.id === DOC2_ID)
  check('pure: resolveWikiDoc returns null for a missing title', resolveWikiDoc(DOCS, 'نیست') === null)
}
{
  const w = insertMdSnippet('سلام دنیا', 0, 4, 'bold')
  check('pure: toolbar bold wraps the selection', w.text === '**سلام** دنیا', JSON.stringify(w))
  const b2 = insertMdSnippet('', 0, 0, 'bold')
  check('pure: toolbar bold without selection inserts a placeholder and selects it', b2.text === '**متن پررنگ**' && b2.selStart === 2 && b2.selEnd === 11, JSON.stringify(b2))
  const h = insertMdSnippet('خط تازه', 0, 0, 'h1')
  check('pure: toolbar h1 prefixes the line', h.text === '# خط تازه', JSON.stringify(h))
  const t = insertMdSnippet('متن', 4, 4, 'table')
  check('pure: toolbar table inserts a skeleton (header + separator + 2 empty rows)', t.text.includes('| --- | --- |') && (t.text.match(/\|  \|  \|/g) || []).length === 2, JSON.stringify(t.text))
  const l = insertMdSnippet('', 0, 0, 'wikilink')
  check('pure: toolbar wikilink inserts [[ ]] with the caret inside', l.text === '[[ ]]' && l.selStart === 2 && l.selEnd === 3, JSON.stringify(l))
  const li = insertMdSnippet('متن', 0, 0, 'list')
  check('pure: toolbar list prefixes the line with -', li.text === '- متن', JSON.stringify(li))
}

// ---------- in-memory stub backend (same shape as probe-search-text) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند پروب', yjs_doc_id: 'doc-rich-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {}, search_text: null },
      { id: DOC2_ID, project_id: PROJECT_ID, title: 'سند هدف', yjs_doc_id: 'doc-rich-2', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: '2026-11-22T00:00:00.000Z', version: 1, visibility: 'project', custom_fields: {}, search_text: null },
      { id: DOC3_ID, project_id: PROJECT_ID, title: 'سند هدف', yjs_doc_id: 'doc-rich-3', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: '2026-11-20T00:00:00.000Z', version: 1, visibility: 'project', custom_fields: {}, search_text: null }
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
  const calls = { docPatch: [] }

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
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'docs') calls.docPatch.push({ id: matched.map((r) => r.id), body })
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

// Phase 4: the doc view defaults to READ mode (no textarea). Switch to
// EDIT mode first, then wait for the textarea to mount.
async function switchToEdit(w, label) {
  const toggle = await waitFor(w, () => w.document.querySelector('button[data-mode="edit"]'), 10000, 'mode toggle (' + label + ')')
  if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click()
  return waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, label)
}

async function switchToRead(w, label) {
  const toggle = await waitFor(w, () => w.document.querySelector('button[data-mode="read"]'), 10000, 'mode toggle (' + label + ')')
  if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click()
  return waitFor(w, () => w.document.querySelector('[data-doc-read]'), 10000, label)
}

const TABLE_ROWS = Array.from({ length: 10 }, (_, i) => '| ردیف ' + (i + 1) + ' | ' + (i + 1) * 1000 + ' |').join('\n')
const FIXTURE =
  '# بخش ۳ — مچینگ و TRL\n\n## ریز هزینه‌ها\n\nمتن **پررنگ** و *کج* است و به [[سند هدف]] و [[سند ناموجود]] اشاره می‌کند.\n\n' +
  '- آیتم یک\n  - زیرآیتم\n- آیتم دو\n\n۱. اول\n۲. دوم\n\n' +
  '| ستون ۱ | ستون ۲ |\n| --- | --- |\n' + TABLE_ROWS + '\n\n<script>alert(1)</script>'

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  const db = makeDb()
  const stub = makeStub(db)

  // ---- Mount A: default mode is READ, empty doc shows the empty state ----
  const m1 = await mountApp({ html, js }, stub, '#/doc/' + DOC_ID)
  const { w } = m1
  m1errors = m1.errors
  const readToggle = await waitFor(w, () => w.document.querySelector('button[data-mode="read"]'), 10000, 'mode toggle')
  check('ui: read mode is the default (read toggle pressed)', readToggle.getAttribute('aria-pressed') === 'true')
  check('ui: no doc textarea in read mode', !w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'))
  await waitFor(w, () => w.document.body.textContent.includes('سند خالی است'), 10000, 'empty state')
  check('ui: empty doc shows the empty state in read mode', true)

  // ---- Type the fixture in edit mode, wait for autosave ----
  const ta = await switchToEdit(w, 'doc textarea')
  setInput(w, ta, FIXTURE)
  await sleep(3500) // autosave debounce is 2 s
  check('save: autosave PATCHed the docs row', stub.calls.docPatch.length >= 1, 'patches: ' + stub.calls.docPatch.length)
  check('save: «ذخیره شد» indicator shows', w.document.body.textContent.includes('ذخیره شد'))

  // ---- Read mode renders the fixture ----
  const readView = await switchToRead(w, 'read view')
  check('render: h1 renders', !!readView.querySelector('h1') && readView.querySelector('h1').textContent === 'بخش ۳ — مچینگ و TRL')
  check('render: h2 renders', !!readView.querySelector('h2') && readView.querySelector('h2').textContent === 'ریز هزینه‌ها')
  check('render: bold renders', !!readView.querySelector('strong') && readView.querySelector('strong').textContent === 'پررنگ')
  check('render: italic renders', !!readView.querySelector('em') && readView.querySelector('em').textContent === 'کج')
  check('render: unordered list with nested item', [...readView.querySelectorAll('ul li')].some((li) => li.textContent.includes('زیرآیتم')))
  check('render: Persian-numbered ordered list', !!readView.querySelector('ol') && readView.querySelectorAll('ol li').length === 2)
  const tbodyRows = readView.querySelectorAll('.doc-table tbody tr')
  check('render: 10-row table has 10 body rows', tbodyRows.length === 10, 'rows: ' + tbodyRows.length)
  check('render: table header uses th scope=col', !!readView.querySelector('.doc-table th[scope="col"]'))
  const wikiLink = readView.querySelector('a.doc-wikilink[href="#/doc/' + DOC2_ID + '"]')
  check('render: [[سند هدف]] links to the newest doc of that title', !!wikiLink && wikiLink.textContent === 'سند هدف')
  check('render: [[سند ناموجود]] is not a link', ![...readView.querySelectorAll('a')].some((a) => a.textContent.includes('سند ناموجود')))
  check('render: missing wikilink shows the «یافت نشد» badge', [...readView.querySelectorAll('.doc-wikilink-missing')].some((s) => s.textContent === 'سند ناموجود') && readView.textContent.includes('یافت نشد'))
  check('render: raw HTML is escaped (no script element in the read view)', !readView.querySelector('script') && readView.innerHTML.includes('&lt;script&gt;'))

  // ---- Comment anchor: go-to from read mode switches to edit ----
  const ta2 = await switchToEdit(w, 'doc textarea for comment')
  ta2.setSelectionRange(0, 5)
  const commentBox = await waitFor(w, () => w.document.querySelector('textarea[placeholder^="نظر بنویسید"]'), 10000, 'comment box')
  setInput(w, commentBox, 'نظر روی عنوان')
  const submitBtn = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ثبت نظر')
  submitBtn.click()
  const goBtn = await waitFor(
    w,
    () => [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'رفتن به محل'),
    10000,
    'go-to-anchor button'
  )
  check('comment: anchored comment shows «رفتن به محل»', !!goBtn)
  await switchToRead(w, 'read view before go-to')
  goBtn.click()
  const ta3 = await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'textarea after go-to')
  check('comment: go-to from read mode switches to edit mode', w.document.querySelector('button[data-mode="edit"]').getAttribute('aria-pressed') === 'true')
  check('comment: go-to selects the anchored range', ta3.selectionStart === 0 && ta3.selectionEnd === 5, 'sel: ' + ta3.selectionStart + '..' + ta3.selectionEnd)

  // ---- Toolbar inserts ----
  const tool = (kind) => w.document.querySelector('button[data-md-tool="' + kind + '"]')
  check('toolbar: all six tools render', ['h1', 'bold', 'italic', 'list', 'table', 'wikilink'].every((k) => !!tool(k)))
  setInput(w, ta3, 'سلام')
  ta3.setSelectionRange(0, 4)
  tool('bold').click()
  check('toolbar: bold wraps the selection', ta3.value === '**سلام**', JSON.stringify(ta3.value))
  setInput(w, ta3, '')
  tool('bold').click()
  check('toolbar: bold without selection inserts a placeholder and selects it', ta3.value === '**متن پررنگ**' && ta3.selectionStart === 2, JSON.stringify(ta3.value) + ' sel ' + ta3.selectionStart)
  setInput(w, ta3, '')
  tool('table').click()
  check('toolbar: table inserts a skeleton with 2 empty rows', ta3.value.includes('| --- | --- |') && (ta3.value.match(/\|  \|  \|/g) || []).length === 2, JSON.stringify(ta3.value))
  setInput(w, ta3, 'خط تازه')
  ta3.setSelectionRange(0, 0)
  tool('h1').click()
  check('toolbar: h1 prefixes the line', ta3.value === '# خط تازه', JSON.stringify(ta3.value))
  setInput(w, ta3, '')
  tool('wikilink').click()
  check('toolbar: wikilink inserts [[ ]] with the caret inside', ta3.value === '[[ ]]' && ta3.selectionStart === 2 && ta3.selectionEnd === 3, JSON.stringify(ta3.value) + ' sel ' + ta3.selectionStart + '..' + ta3.selectionEnd)
  setInput(w, ta3, 'متن')
  ta3.setSelectionRange(0, 0)
  tool('list').click()
  check('toolbar: list prefixes the line', ta3.value === '- متن', JSON.stringify(ta3.value))

  // ---- Live Yjs update re-renders the read view (second client) ----
  await switchToRead(w, 'read view before live update')
  const m2 = await mountApp({ html, js }, stub, '#/doc/' + DOC_ID)
  const w2 = m2.w
  const taB = await switchToEdit(w2, 'doc textarea (client B)')
  await waitFor(w2, () => taB.value.length > 0, 10000, 'client B loads the doc text')
  setInput(w2, taB, taB.value + '\n## عنوان زنده')
  await waitFor(w, () => {
    const rv = w.document.querySelector('[data-doc-read]')
    return rv && rv.textContent.includes('عنوان زنده') ? rv : null
  }, 10000, 'live heading in read view')
  check('live: a remote Yjs update re-renders the read view', true)
  m2.dom.window.close()

  // ---- JS errors (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL DOC-RICH PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('DOC-RICH PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
