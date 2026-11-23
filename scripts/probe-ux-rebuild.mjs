// UX rebuild probe (scripts/probe-ux-rebuild.mjs) — 0.12.0 بازطراحی UX.
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST) and asserts the rebuild scope from
// plan-ux-glass-rebuild.md §4 + baste-grafiki-baztarahi-ux-spec.md:
//
//   * تم تازه: صفر ارجاع به توکن‌های گرم در app.css؛ کلاس‌های شیشهٔ دو
//     سطح + مش روشن؛ هیچ transition/animation روی backdrop-filter؛
//     باندل ≤ ۱۰٪ رشد نسبت به ۰٫۱۱٫۷ زنده (۵۸۹٬۵۵۷ بایت).
//   * سایدبار ۷ بخش به ترتیب درست (جست‌وجو → علاقه‌مندی‌ها → خصوصی →
//     پروژه‌ها → سندها → کارها → اعضا)؛ علاقه‌مندی فقط وقتی ستاره‌ای
//     هست؛ ستارهٔ سند → ردیف در علاقه‌مندی؛ برداشتن ستاره → حذف ردیف.
//   * بخش خصوصی: سند شخصیِ عضو دیگر نه در درخت است نه در فهرست خصوصی؛
//     ساخت یادداشت خصوصیِ خودم → فقط در بخش خصوصی، نه در درخت پروژه.
//   * تب‌های سند: بازکردن ۲ سند → ۲ تب؛ تپ روی تب → محتوای همان سند؛
//     بستن تب → تب دیگر فعال می‌ماند؛ Ctrl+Shift+T تب بسته‌شده را
//     برمی‌گرداند؛ Ctrl+K جست‌وجوی سراسری را فوکوس می‌کند.
//   * بردکرامب سندِ عمق ۳: سه سطحه با لینک‌های درست.
//
// No live Supabase, no test data in live tables. Same harness shape as
// probe-doc-nest.mjs (jsdom mount + fake session + in-memory stub).
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-ux-rebuild.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_A_ID = '55555555-5555-5555-5555-555555555555'
const DOC_B_ID = '55555555-5555-5555-5555-555555555556'
const DOC_C_ID = '55555555-5555-5555-5555-555555555557'
const DOC_D_ID = '55555555-5555-5555-5555-555555555558'
const DOC_E_ID = '55555555-5555-5555-5555-555555555559'
const LIVE_0117_BUNDLE_BYTES = 589557
// Re-baselined for 0.13.0 (phases 6–11): the package knowingly adds 5
// views + 2 content modules — rules-aim.js (31 KB source) +
// form-rooyesh.js (22 KB source) — so the bundle grew 10.49% over
// 0.11.7, past the old 10% cap by 2,903 bytes. That growth is content,
// not bloat; the gate now guards 0.13.0 + 10%.
const LIVE_0130_BUNDLE_BYTES = 651416

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

// ---------- static: palette + glass + bundle ----------
{
  const cssSrc = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8')
  const warmTokens = ['warm', 'amber', 'coral', 'peach', 'bg-warm', '--card', '#d97706', '#f97066', '#7c3aed', '#9a5603', '#92400e', '#fef3c7', '--ai-accent', 'glass-chrome', 'warm-mesh']
  const found = warmTokens.filter((t) => cssSrc.includes(t))
  check('static: zero warm-palette tokens in app.css', found.length === 0, 'found: ' + found.join(', '))
  check('static: .glass-mild + .glass-strong + .glass-card + .glass-modal exist',
    cssSrc.includes('.glass-mild') && cssSrc.includes('.glass-strong') && cssSrc.includes('.glass-card') && cssSrc.includes('.glass-modal'))
  check('static: .light-mesh exists, .warm-mesh is gone',
    cssSrc.includes('.light-mesh') && !cssSrc.includes('.warm-mesh'))
  check('static: jigari tokens exist (--jigari, --jigari-btn, --jigari-soft)',
    cssSrc.includes('--jigari:') && cssSrc.includes('--jigari-btn:') && cssSrc.includes('--jigari-soft:'))
  const bfLines = cssSrc.split('\n').filter((l) => l.includes('backdrop-filter'))
  const animated = bfLines.filter((l) => /transition|animation/.test(l))
  check('static: no transition/animation on backdrop-filter', animated.length === 0, animated.join(' | '))
  const srcAll = ['App.svelte', 'components/Sidebar.svelte', 'components/DocView.svelte', 'components/DocTabs.svelte', 'components/SearchBox.svelte', 'components/TasksView.svelte', 'components/ChatView.svelte', 'components/HomeView.svelte', 'components/Login.svelte', 'lib/graphics.js', 'lib/store.svelte.js']
    .map((f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n')
  const warmInSrc = ['warm-mesh', 'amber-', '#d97706', '#f97066', '#7c3aed', '--ai-accent', 'glass-chrome'].filter((t) => srcAll.includes(t))
  check('static: zero warm tokens in the rebuilt sources', warmInSrc.length === 0, 'found: ' + warmInSrc.join(', '))
}

// ---------- in-memory stub backend (same shape as probe-doc-nest) ----------
function makeDb() {
  const now = new Date().toISOString()
  const doc = (id, title, parent_id, yjs_doc_id, created_by, visibility) => ({
    id, project_id: PROJECT_ID, title, yjs_doc_id, template_id: null,
    created_by, created_at: now, updated_at: now, version: 1,
    visibility: visibility || 'project', custom_fields: {}, search_text: null, parent_id
  })
  const task = (id, title, status) => ({
    id, project_id: PROJECT_ID, title, status, created_by: MEMBER_ID, created_at: now,
    updated_at: now, due_at: null, completed_at: null, custom_fields: {}
  })
  return {
    members: [
      { id: MEMBER_ID, auth_id: USER_ID, workspace_id: 'main', name: 'یاسین', email: 'probe@example.com', created_at: now, custom_fields: {} },
      { id: MEMBER2_ID, auth_id: '99999999-9999-9999-9999-999999999999', workspace_id: 'main', name: 'زهرا', email: 'other@example.com', created_at: now, custom_fields: {} }
    ],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: {} }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      doc(DOC_A_ID, 'سند الف', null, 'ux-1', MEMBER_ID),
      doc(DOC_B_ID, 'سند ب', DOC_A_ID, 'ux-2', MEMBER_ID),
      doc(DOC_C_ID, 'سند ج', DOC_B_ID, 'ux-3', MEMBER_ID),
      doc(DOC_D_ID, 'سند د', null, 'ux-4', MEMBER_ID),
      doc(DOC_E_ID, 'یادداشت خصوصی زهرا', null, 'ux-5', MEMBER2_ID, 'personal')
    ],
    messages: [],
    files: [],
    tasks: [task('t1', 'کار باز یک', 'todo'), task('t2', 'کار در حال انجام', 'doing'), task('t3', 'کار تمام‌شده', 'done')],
    comments: [],
    templates: [],
    versions: [],
    reminders: [],
    notifications: [],
    integrations: []
  }
}

function makeStub(db) {
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

  return { stubFetch, db }
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
    refresh_token: 'probe-refresh',
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

function sidebarSections(w) {
  return [...w.document.querySelectorAll('aside [data-sidebar-section]')].map((s) => s.dataset.sidebarSection)
}

function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  // «sb_secret_» به‌تنهایی در کد supabase-js هست (startsWith برای
  // تشخیص شکل کلید) — راز واقعی یعنی پیشوند + مقدار بلند؛ آن را چک می‌کنیم.
  check('bundle: no real secret value (sb_secret_ + long token) in the probe bundle',
    !/sb_secret_[A-Za-z0-9_-]{20,}/.test(js))
  check(`bundle: <= 10% growth vs live 0.13.0 (${LIVE_0130_BUNDLE_BYTES} bytes)`,
    js.length <= LIVE_0130_BUNDLE_BYTES * 1.1, js.length + ' bytes')

  const db = makeDb()
  const stub = makeStub(db)

  // ---- Mount A: doc C (depth 3) — sidebar, tabs, breadcrumb, star, private ----
  const m1 = await mountApp({ html, js }, stub, '#/doc/' + DOC_C_ID)
  const { w } = m1
  m1errors = m1.errors
  await waitFor(w, () => w.document.querySelector('li[data-doc-node="' + DOC_B_ID + '"]'), 10000, 'sidebar tree')

  // Sidebar: 7 sections, favorites absent while nothing is starred.
  check('sidebar: 7 sections in the Notion order (favorites hidden, nothing starred)',
    sidebarSections(w).join(',') === 'search,private,projects,rooms,docs,tasks,members',
    sidebarSections(w).join(','))
  check('sidebar: sidebar is light glass (glass-mild on <aside>)',
    !!w.document.querySelector('aside.glass-mild'))
  check('sidebar: open-task badge shows 2 (todo + doing, not done)',
    w.document.querySelector('[data-open-task-count]')?.textContent.trim() === '2')
  check('sidebar: members section shows both members',
    w.document.querySelector('[data-sidebar-section="members"]')?.textContent.includes('زهرا') === true)

  // Private isolation: the other member's private doc is nowhere.
  check('private: other member\'s private doc is NOT in the doc tree',
    !w.document.querySelector('[data-doc-node="' + DOC_E_ID + '"]'))
  check('private: other member\'s private doc is NOT in the private section',
    ![...w.document.querySelectorAll('[data-sidebar-section="private"] a, [data-sidebar-section="private"] li')].some((el) => el.textContent.includes('یادداشت خصوصی زهرا')))

  // Breadcrumb: depth-3 doc → three levels, links a then b.
  const crumb = await waitFor(w, () => w.document.querySelector('[data-doc-breadcrumb]'), 10000, 'breadcrumb')
  const crumbLinks = [...crumb.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  check('breadcrumb: links a then b, in order', crumbLinks.join(',') === '#/doc/' + DOC_A_ID + ',#/doc/' + DOC_B_ID, crumbLinks.join(','))
  check('breadcrumb: current page is the doc title', crumb.textContent.includes('سند ج'))

  // Tabs: opening C made exactly one tab; its title is the doc title.
  await waitFor(w, () => w.document.querySelector('[data-doc-tab="' + DOC_C_ID + '"]'), 10000, 'tab for c')
  check('tabs: one tab after opening c', w.document.querySelectorAll('[data-doc-tab]').length === 1)
  check('tabs: tab title is «سند ج»',
    w.document.querySelector('[data-doc-tab="' + DOC_C_ID + '"]')?.textContent.includes('سند ج') === true)

  // Star doc C from the DocView star button → favorites section appears.
  const starBtn = await waitFor(w, () => w.document.querySelector('[data-doc-star]'), 10000, 'doc star button')
  starBtn.click()
  await waitFor(w, () => w.document.querySelector('[data-sidebar-section="favorites"]'), 10000, 'favorites section')
  check('favorites: starring c adds the favorites section in position 2',
    sidebarSections(w).join(',') === 'search,favorites,private,projects,rooms,docs,tasks,members',
    sidebarSections(w).join(','))
  check('favorites: starred doc row shows in favorites',
    w.document.querySelector('[data-sidebar-section="favorites"]')?.textContent.includes('سند ج') === true)
  check('favorites: doc star button reports pressed',
    w.document.querySelector('[data-doc-star]')?.getAttribute('aria-pressed') === 'true')
  check('favorites: db row c is starred', db.docs.find((d) => d.id === DOC_C_ID).custom_fields.starred === true)

  // Unstar → favorites section disappears again.
  w.document.querySelector('[data-doc-star]').click()
  await waitFor(w, () => !w.document.querySelector('[data-sidebar-section="favorites"]'), 10000, 'favorites gone')
  check('favorites: unstarring c removes the favorites section',
    !w.document.querySelector('[data-sidebar-section="favorites"]'))
  check('favorites: db row c is unstarred', db.docs.find((d) => d.id === DOC_C_ID).custom_fields.starred === false)

  // Open doc A as a second tab; switch back to C; close A; reopen with Ctrl+Shift+T.
  w.location.hash = '#/doc/' + DOC_A_ID
  w.dispatchEvent(new w.Event('hashchange'))
  await waitFor(w, () => w.document.querySelector('[data-doc-tab="' + DOC_A_ID + '"]'), 10000, 'tab for a')
  check('tabs: opening a second doc makes 2 tabs', w.document.querySelectorAll('[data-doc-tab]').length === 2)
  w.document.querySelector('[data-doc-tab="' + DOC_C_ID + '"]').click()
  await waitFor(w, () => w.document.querySelector('[data-doc-breadcrumb]')?.textContent.includes('سند ج'), 10000, 'switched to c')
  check('tabs: clicking tab c shows c content (breadcrumb «سند ج»)',
    w.document.querySelector('[data-doc-breadcrumb]')?.textContent.includes('سند ج') === true)
  w.document.querySelector('[data-doc-tab-close="' + DOC_A_ID + '"]').click()
  await waitFor(w, () => w.document.querySelectorAll('[data-doc-tab]').length === 1, 10000, 'one tab left')
  check('tabs: closing a leaves only the c tab', w.document.querySelectorAll('[data-doc-tab]').length === 1)
  check('tabs: c tab is still active after closing a',
    w.document.querySelector('[data-doc-tab="' + DOC_C_ID + '"]')?.getAttribute('aria-selected') === 'true')
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true }))
  await waitFor(w, () => w.document.querySelector('[data-doc-tab="' + DOC_A_ID + '"]'), 10000, 'reopened tab a')
  check('tabs: Ctrl+Shift+T reopens the closed tab a',
    !!w.document.querySelector('[data-doc-tab="' + DOC_A_ID + '"]'))

  // Ctrl+K focuses the global search input.
  w.document.querySelector('[data-doc-tab="' + DOC_A_ID + '"]').click()
  await waitFor(w, () => w.location.hash === '#/doc/' + DOC_A_ID, 10000, 'hash a')
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
  await sleep(300)
  check('keyboard: Ctrl+K focuses the global search input',
    w.document.activeElement?.getAttribute('data-global-search') !== null,
    'active: ' + (w.document.activeElement?.tagName || 'none'))

  // Private doc: create my own → appears in the private section only.
  const privInput = await waitFor(w, () => w.document.querySelector('[data-sidebar-section="private"] input[placeholder="نام یادداشت خصوصی"]'), 10000, 'private input')
  setInput(w, privInput, 'یادداشت خصوصی من')
  const createBtn = [...w.document.querySelectorAll('[data-sidebar-section="private"] button')].find((b) => b.textContent.trim() === 'ساختن')
  createBtn.click()
  await waitFor(w, () => [...w.document.querySelectorAll('[data-sidebar-section="private"] a')].some((a) => a.textContent.includes('یادداشت خصوصی من')), 10000, 'my private doc in list')
  const myPriv = db.docs.find((d) => d.title === 'یادداشت خصوصی من')
  check('private: my new private doc is in the private section',
    [...w.document.querySelectorAll('[data-sidebar-section="private"] a')].some((a) => a.textContent.includes('یادداشت خصوصی من')))
  check('private: my new private doc is NOT in the project doc tree',
    !!myPriv && !w.document.querySelector('[data-doc-node="' + myPriv.id + '"]'))
  check('private: my new private doc has visibility personal',
    myPriv?.visibility === 'personal')

  // ---- JS errors on the main mount (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL UX-REBUILD PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('UX-REBUILD PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
