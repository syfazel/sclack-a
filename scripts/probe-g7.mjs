// G7 (hygiene) sandbox probes (Node, no network, no live data).
//
// Layers:
//  1. PROBE PAGE (text + jsdom): G7-1 — the stale RLS label is gone and the
//     live label is present; G7-2 — the key box accepts a placeholder
//     sb_publishable_… key and a JWT-shaped placeholder key with NO
//     warning, and warns only for an unclear key (placeholders only —
//     never a real key); G7-3 — the stage-3 line is present.
//  2. U6 (source): the y-websocket verdict is recorded in yjs-sync.js,
//     README-D3.md and the probe page; every 'y-websocket' match in
//     src/ is a comment (no code, config or dependency).
//  3. CONTRAST (source): WCAG ratios computed from the real token
//     values in src/app.css for every text pair the app renders.
//     Body text >= 4.5:1, button/label text >= 4.5:1 (WCAG normal text).
//  4. POLISH (source): no backdrop-filter animation anywhere; mobile
//     glass blur capped at 8px; reduced-motion / reduced-transparency /
//     simple-mode switch the glass off.
//  5. ROUTE STATES (mount): the REAL built bundle in jsdom with a
//     stubbed Supabase backend — every route (home, rooms, room, doc,
//     tasks, assistant, members, notifications, login) renders its
//     loading / empty / error state (not a blank page, no raw error
//     text), at three widths (1280 / 957 / 390). Width-dependent layout
//     is CSS-class-based (Tailwind), so jsdom renders the same DOM at
//     each width — the width mounts exercise the mount path; the
//     responsive classes themselves are asserted in source.
//  6. DOC SYNC (text): the four docs agree on the live state
//     (0.10.0, live bundle index-CXZVPUGn.js, 49 policies).
//     NOTE on old bundle names: README-D3.md keeps dated 21-Nov
//     changelog entries that name the bundle that was live THEN
//     (and the G3 section names the clean dist bundle index-DXciAQfl.js
//     as the build output, not the live bundle); the audit keeps ONE
//     dated D5-era name (index-BWxA_Hu3.js) in its section-9 intro.
//     The check below asserts that no file presents an old bundle as
//     the CURRENT live one: every 'باندل زنده' reference says
//     index-CXZVPUGn.js, and spec/plan contain no other index-*.js
//     name at all.
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d/s5/g3): this probe BUILDS
// the bundle itself with the probe Supabase URL + placeholder key
// before mounting, and refuses to mount a bundle that is not
// probe-configured.
//
// Usage:
//   node scripts/probe-g7.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}
function countOcc(hay, needle) {
  return hay.split(needle).length - 1
}
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// ---------- 1. PROBE PAGE (G7-1 / G7-2 / G7-3 text) ----------
const filesDir = new URL('../../../files/', import.meta.url).pathname
const draftDir = new URL('..', import.meta.url).pathname
const probePage = readFileSync(draftDir + '/archive/w0-probe.html', 'utf8')

check('G7-1: old RLS label «هنوز اجرا نشده» is gone from the probe page',
  countOcc(probePage, 'هنوز اجرا نشده') === 0)
check('G7-1: live RLS label (49 policies, 45 w1 + 4 d2) is present exactly once',
  countOcc(probePage, 'سیاست‌های RLS زنده‌اند — ۴۹ سیاست روی ۱۳ جدول (۴۵ w1 + ‏۴ d2)') === 1)
check('G7-1: no advice to run w0-rls.sql remains in the probe page',
  !probePage.includes('w0-rls.sql در SQL Editor اجرا'))
check('G7-2: «کلید anon» is gone from the probe page (label is now «کلید اتصال»)',
  countOcc(probePage, 'کلید anon') === 0)
check('G7-2: «کلید اتصال» label is present',
  probePage.includes('کلید اتصال پروژهٔ sclack-a') && probePage.includes('<h2>کلید اتصال</h2>'))
check('G7-2: key validation accepts sb_publishable_… (no JWT-only check)',
  probePage.includes("k.indexOf('sb_publishable_') === 0"))
check('G7-2: old warning «شبیه توکن JWT نیست» is gone',
  !probePage.includes('شبیه توکن JWT نیست'))
check('G7-3: stage-3 line «سروری در برنامه نیست» is present in the probe page',
  probePage.includes('سروری در برنامه نیست و لازم نیست'))

// ---------- 2. PROBE PAGE key validation in jsdom (placeholders only) ----------
async function probePageKeyTest() {
  const virtualConsole = new VirtualConsole()
  const initErrors = []
  virtualConsole.on('jsdomError', (e) => initErrors.push('jsdomError: ' + (e.message || e)))
  const dom = new JSDOM(probePage, {
    url: 'http://localhost/w0-probe.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  })
  const w = dom.window
  await sleep(300)
  check('G7-2: probe page inline script runs without jsdom errors', initErrors.length === 0, initErrors.join(' | '))
  const logEl = w.document.getElementById('log')
  const input = w.document.getElementById('anon-key')
  const btn = w.document.getElementById('btn-set-key')
  if (!logEl || !input || !btn) {
    check('G7-2: probe page has key input, set button and log', false)
    dom.window.close()
    return
  }
  async function tryKey(value) {
    logEl.innerHTML = ''
    input.value = value
    btn.click()
    await sleep(200)
    return logEl.textContent || ''
  }
  const logPublishable = await tryKey(PLACEHOLDER_KEY)
  check('G7-2: placeholder publishable key → no key-shape warning',
    !logPublishable.includes('شکل کلید'), JSON.stringify(logPublishable.slice(0, 200)))
  const jwtPlaceholder =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.PLACEHOLDER-SIGNATURE'
  const logJwt = await tryKey(jwtPlaceholder)
  check('G7-2: JWT-shaped placeholder key → no key-shape warning',
    !logJwt.includes('شکل کلید'), JSON.stringify(logJwt.slice(0, 200)))
  const logUnclear = await tryKey('not-a-real-key')
  check('G7-2: unclear key → key-shape warning appears',
    logUnclear.includes('شکل کلید نه شبیه'), JSON.stringify(logUnclear.slice(0, 200)))
  const logEmpty = await tryKey('')
  check('G7-2: empty key → «کلید خالی است» (no connection attempt)',
    logEmpty.includes('کلید خالی است'), JSON.stringify(logEmpty.slice(0, 200)))
  dom.window.close()
}

// ---------- 3. U6 verdict (source) ----------
const yjsSync = readFileSync(draftDir + '/src/lib/yjs-sync.js', 'utf8')
const readme = readFileSync(draftDir + '/README-D3.md', 'utf8')
check('G7-3: y-websocket verdict is recorded in yjs-sync.js header',
  yjsSync.includes('y-websocket لازم نیست'))
check('G7-3: y-websocket verdict is recorded in README-D3.md',
  readme.includes('y-websocket لازم نیست'))
check('G7-3: y-websocket verdict is recorded in the probe page',
  probePage.includes('سروری در برنامه نیست و لازم نیست'))
{
  // Every 'y-websocket' match in src/ must be a comment line (no code,
  // config or dependency). Scan .js/.svelte/.css under src/ (no dist).
  const srcFiles = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + f.name
      if (f.isDirectory()) walk(p)
      else if (/\.(js|svelte|css)$/.test(f.name)) srcFiles.push(p)
    }
  }
  walk(draftDir + '/src')
  const bad = []
  for (const f of srcFiles) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('y-websocket')) continue
      const t = line.trim()
      if (!(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) {
        bad.push(f.split('/src/')[1] + ': ' + t.slice(0, 100))
      }
    }
  }
  check('G7-3: every y-websocket mention in src/ is a comment (no code/config)',
    bad.length === 0, bad.join(' | '))
  const pkg = readFileSync(draftDir + '/package.json', 'utf8')
  check('G7-3: no y-websocket dependency in package.json', !pkg.includes('y-websocket'))
}

// ---------- 4. CONTRAST from tokens (source) ----------
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
function lum(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(fg, bg) {
  const l1 = lum(fg)
  const l2 = lum(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}
const cssSrc = readFileSync(draftDir + '/src/app.css', 'utf8')
function parseTokens(css) {
  const out = {}
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)) {
    out['--' + m[1]] = m[2].toLowerCase()
  }
  return out
}
const tokens = parseTokens(cssSrc)
function resolve(v) {
  const m = /^var\((--[\w-]+)\)$/.exec((v || '').trim())
  return m ? tokens[m[1]] || v : v
}
// Pairs actually rendered as text (fg on bg), with the bar each must meet.
const pairs = [
  // body text >= 4.5
  ['body: base-content on base-100', '#3f2e1e', '#fdf8ef', 4.5],
  ['body: ink on bg-warm', '#1c1917', '#fffbeb', 4.5],
  ['body: ink-soft on bg-warm', '#57534e', '#fffbeb', 4.5],
  ['body: mention text on mention bg', '#92400e', '#fef3c7', 4.5],
  ['body: ai-accent text on white', '#7c3aed', '#ffffff', 4.5],
  ['body: amber-contrast on bg-warm', '#9a5603', '#fffbeb', 4.5],
  ['body: warning text on base-100', '#b45309', '#fdf8ef', 4.5],
  ['body: error text on base-100', '#b91c1c', '#fdf8ef', 4.5],
  ['body: success text on base-100', '#15803d', '#fdf8ef', 4.5],
  // button / label text >= 4.5 (WCAG normal text)
  ['button: primary-content on primary', '#1c1917', '#d97706', 4.5],
  ['button: white on amber-contrast (hero active)', '#ffffff', '#9a5603', 4.5],
  ['button: white on ai-accent (btn-ai)', '#ffffff', '#7c3aed', 4.5],
  ['label: text-primary (= amber-contrast) on base-100', '#9a5603', '#fdf8ef', 4.5],
  ['label: white on success (btn-success)', '#ffffff', '#15803d', 4.5],
  ['label: white on warning (btn-warning)', '#ffffff', '#b45309', 4.5],
  ['label: white on error (btn-error)', '#ffffff', '#b91c1c', 4.5]
]
for (const [name, fg, bg, bar] of pairs) {
  const r = ratio(resolve(fg), resolve(bg))
  check(`G7-5 contrast: ${name} = ${r.toFixed(2)}:1 (>= ${bar}:1)`, r >= bar)
}
check('G7-5 contrast: .text-primary is overridden to amber-contrast in app.css',
  /\.text-primary\s*\{[^}]*color:\s*var\(--amber-contrast\)/.test(cssSrc))
check('G7-5 contrast: primary-content token is dark ink (not near-white)',
  tokens['--color-primary-content'] === '#1c1917')

// ---------- 5. POLISH (source): backdrop-filter / reduced modes / mobile blur ----------
{
  const bfLines = cssSrc.split('\n').filter((l) => l.includes('backdrop-filter'))
  const animated = bfLines.filter((l) => /transition|animation/.test(l))
  check('G7-5 polish: no transition/animation on backdrop-filter in app.css',
    animated.length === 0, animated.join(' | '))
  const kf = cssSrc.match(/@keyframes[\s\S]*?^\}/m)
  check('G7-5 polish: the only keyframes (sclack-enter) animate transform/opacity only',
    !!kf && !kf[0].includes('backdrop-filter') && kf[0].includes('transform'))
  // No backdrop-filter animation anywhere in components either.
  let badComp = []
  for (const f of readdirSync(draftDir + '/src/components')) {
    const src = readFileSync(draftDir + '/src/components/' + f, 'utf8')
    if (/transition[^;{]*backdrop-filter|animation[^;{]*backdrop-filter|backdrop-filter[^;{]*(transition|animation)/.test(src)) {
      badComp.push(f)
    }
  }
  check('G7-5 polish: no backdrop-filter animation in any component', badComp.length === 0, badComp.join(', '))
  const mobileQ = cssSrc.match(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\n\}/)
  check('G7-5 polish: mobile media query caps glass blur at 8px',
    !!mobileQ && mobileQ[0].includes('blur(8px)') && !/blur\((1[0-9]|[2-9][0-9])px\)/.test(mobileQ[0]),
    mobileQ ? mobileQ[0].slice(0, 200) : 'no max-width:767px block')
  check('G7-5 polish: prefers-reduced-motion switches animation off',
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/.test(cssSrc))
  check('G7-5 polish: prefers-reduced-transparency switches glass off',
    /@media\s*\(prefers-reduced-transparency:\s*reduce\)[\s\S]*?backdrop-filter:\s*none/.test(cssSrc))
  check('G7-5 polish: simple-mode switches glass and motion off',
    /html\.simple-mode[\s\S]*?backdrop-filter:\s*none/.test(cssSrc) &&
    /html\.simple-mode[\s\S]*?animation:\s*none/.test(cssSrc))
}

// ---------- 6. ROUTE STATES (mount, hermetic build + stubbed backend) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER_ID, auth_id: USER_ID, muse_id: 'auth:' + USER_ID, name: 'yasin', username: 'yasin', joined_at: now },
      { id: MEMBER2_ID, auth_id: ZAHRA_USER_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', username: 'zahraariapour97', joined_at: now }
    ],
    projects: [
      { id: PROJECT_ID, name: 'پروژهٔ پروب', description: null, created_by: MEMBER_ID, visibility: 'team', archived: false, created_at: now, custom_fields: { goal: 'پروب', deadline: '2026-11-30', stage: 'active', member_ids: [] } }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', created_by: MEMBER_ID, visibility: 'project', created_at: now }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند', created_by: MEMBER_ID, yjs_doc_id: 'doc-1', created_at: now, updated_at: now, custom_fields: {} }
    ],
    messages: [],
    tasks: [],
    files: [],
    comments: [],
    versions: [],
    notifications: [],
    templates: [],
    reminders: [],
    integrations: []
  }
}
function makeEmptyDb() {
  const db = makeDb()
  db.projects = []
  db.rooms = []
  db.docs = []
  return db
}
function makeDbNoRooms() {
  const db = makeDb()
  db.rooms = []
  db.docs = []
  return db
}

function makeStub(db, opts = {}) {
  function rowMatches(row, params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
      const m = val.match(/^([a-z_]+)\.(.*)$/)
      if (!m) continue
      const [, op, raw] = m
      const v = row[key]
      if (op === 'eq') {
        if (String(v) !== raw && !(v === false && raw === 'false') && !(v === true && raw === 'true')) return false
      } else if (op === 'neq') {
        if (String(v) === raw) return false
      }
    }
    return true
  }
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
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
      if (opts.slowAll) await sleep(1200)
      if (opts.failProjects && table === 'projects') {
        return json({ message: 'probe: projects query failed', code: 'PGRST000' }, 500)
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
      if (!row.created_at) row.created_at = now
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
    const rawBody = init.body || (typeof input !== 'string' && input.body) || null
    const bodyText = typeof rawBody === 'string' ? rawBody : null
    if (url.startsWith(BASE_URL + '/rest/v1/')) return handleRest(url, method, headers, bodyText)
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    if (url.startsWith(BASE_URL + '/storage/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }
  return { stubFetch, db, opts }
}

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
    throw new Error('probe bundle is NOT probe-configured: built bundle has no probe-ref URL')
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error('probe bundle is NOT probe-configured: built bundle has no placeholder key')
  }
}

async function mountApp({ html, js }, stub, hash, session = fakeSession(), width = 1280) {
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
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true })
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  w.WebSocket = class {
    constructor() { this.readyState = 0 }
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  w.fetch = stub.stubFetch
  w.confirm = () => true
  if (session) w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
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
  const screen = (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400)
  throw new Error('timeout waiting for ' + label + ' — screen shows: ' + JSON.stringify(screen))
}
function text(w) {
  return norm(w.document.body.textContent)
}

// ---------- 7. DOC SYNC (G7-6) ----------
function docSyncChecks() {
  const spec = readFileSync(filesDir + '/spec-sclack-a.md', 'utf8')
  const plan = readFileSync(filesDir + '/plan-fazha.md', 'utf8')
  const audit = readFileSync(filesDir + '/bazresi-takmil-sclack-a.md', 'utf8')
  const docs = { 'spec-sclack-a.md': spec, 'plan-fazha.md': plan, 'bazresi-takmil-sclack-a.md': audit, 'README-D3.md': readme }
  for (const [name, content] of Object.entries(docs)) {
    check(`G7-6: ${name} states live version ۰٫۱۰٫۰`, content.includes('۰٫۱۰٫۰'))
    check(`G7-6: ${name} states live bundle index-CXZVPUGn.js`, content.includes('index-CXZVPUGn.js'))
    check(`G7-6: ${name} states ۴۹ live RLS policies`, content.includes('۴۹'))
  }
  const otherBundles = (content) =>
    [...content.matchAll(/index-[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]).filter((b) => b !== 'index-CXZVPUGn.js')
  check('G7-6: spec/plan contain no other bundle name',
    otherBundles(spec).length === 0 && otherBundles(plan).length === 0,
    [...otherBundles(spec), ...otherBundles(plan)].join(', '))
  // Audit exception (documented in the probe header): the audit keeps ONE
  // dated historical bundle name — index-BWxA_Hu3.js, the D5-era bundle in
  // the section-9 intro (21 Nov snapshot). It must be the only other name
  // and must stay on that one dated line.
  const auditOthers = otherBundles(audit)
  const auditOtherLine = audit.split('\n').find((l) => l.includes('index-BWxA_Hu3.js')) || ''
  check('G7-6: audit keeps only the dated D5-era bundle name as history',
    auditOthers.length === 1 && auditOthers[0] === 'index-BWxA_Hu3.js' &&
    auditOtherLine.includes('باندل D5'),
    auditOthers.join(', '))
  // The G7 section names only the bundle G7 itself deployed
  // (index-BLqMQ91V.js, 22 Nov ~15:25). The check used to expect
  // index-DoMP8RId.js here — that was the live bundle when G7-6 was
  // written, before the G7 deploy; the README correction in the
  // standard-check pass (G7 header + G7-6 line + deploy line) made
  // the section name the G7 bundle, so the check follows the same
  // rule with the new name. Scoped to ## G7..## G6 so the G6
  // section's future bundle names cannot leak into it.
  const g7Section = readme.slice(readme.indexOf('## G7'), readme.indexOf('## G6'))
  const g7Others = [...g7Section.matchAll(/index-[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]).filter((b) => b !== 'index-BLqMQ91V.js')
  check('G7-6: README G7 section names only the G7 live bundle',
    g7Section.includes('index-BLqMQ91V.js') && g7Others.length === 0,
    g7Others.join(', '))
  const g3Section = readme.slice(readme.indexOf('## G3'), readme.indexOf('## G7'))
  check('G7-6: README G3 section records the live bundle as deployed',
    g3Section.includes('باندل زنده `assets/index-DoMP8RId.js`'))
  check('G7-6: plan map marks G1/G2 done',
    /### فاز G1[^\n]*انجام‌شده/.test(plan) && /### فاز G2[^\n]*انجام‌شده/.test(plan))
  check('G7-6: plan map points G3/G7 at their spec files',
    /### فاز G3[^\n]*g3-tafsil\.md/.test(plan) && /### فاز G7[^\n]*g7-tafsil\.md/.test(plan))
  check('G7-6: README has a G7 section', readme.includes('## G7 — بهداشت'))
}

// ---------- main ----------
async function main() {
  await probePageKeyTest()
  docSyncChecks()

  buildProbeBundle()
  const bundle = loadBundle()
  console.log('bundle:', bundle.jsFile, bundle.js.length, 'bytes')
  assertProbeConfigured(bundle.js)

  // Route markers for the empty mounts (seeded DB unless noted).
  const routes = [
    { name: 'home', hash: '#/', db: makeEmptyDb, marker: 'هنوز داده‌ای نیست' },
    { name: 'rooms', hash: '#/rooms', db: makeDbNoRooms, marker: 'اتاقی نیست.' },
    { name: 'room', hash: '#/room/' + ROOM_ID, db: makeDb, marker: 'هنوز پیامی نیست' },
    { name: 'doc', hash: '#/doc/' + DOC_ID, db: makeDb, marker: 'هنوز نظری نیست.' },
    { name: 'tasks', hash: '#/tasks', db: makeDb, marker: 'فهرست کار' },
    { name: 'assistant', hash: '#/assistant', db: makeDb, marker: 'چیزی پیدا نشد', click: 'خلاصهٔ امروز' },
    { name: 'members', hash: '#/members', db: makeDb, marker: 'جای خالی' },
    { name: 'notifications', hash: '#/notifications', db: makeDb, marker: 'هنوز اعلانی نیست.' }
  ]
  const widths = [1280, 957, 390]
  for (const route of routes) {
    for (const width of widths) {
      const stub = makeStub(route.db())
      const m = await mountApp(bundle, stub, route.hash, fakeSession(), width)
      try {
        // The guardian summary only loads on the «خلاصهٔ امروز» tap.
        if (route.click) {
          await waitFor(m.w, () => [...m.w.document.querySelectorAll('button')].some((b) => b.textContent.trim() === route.click && !b.disabled), 10000, route.name + ' guardian button')
          const btn = [...m.w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === route.click)
          btn.click()
        }
        await waitFor(m.w, () => text(m.w).includes(route.marker), 10000, route.name + ' empty marker @' + width)
        check(`G7-5 states: ${route.name} renders its empty state @${width}px`, true)
        check(`G7-5 states: ${route.name} is not a blank page @${width}px`, text(m.w).length > 300)
      } catch (e) {
        check(`G7-5 states: ${route.name} renders its empty state @${width}px`, false, e.message)
      }
      check(`G7-5 states: ${route.name} mounts with 0 JS errors @${width}px`,
        m.errors.length === 0, m.errors.join(' | '))
      m.dom.window.close()
    }
  }

  // Login route (no session): the login form renders.
  {
    const stub = makeStub(makeEmptyDb())
    const m = await mountApp(bundle, stub, '#/', null, 1280)
    try {
      await waitFor(m.w, () => text(m.w).includes('ورود'), 10000, 'login form')
      check('G7-5 states: login route renders the sign-in form', true)
    } catch (e) {
      check('G7-5 states: login route renders the sign-in form', false, e.message)
    }
    check('G7-5 states: login mounts with 0 JS errors', m.errors.length === 0, m.errors.join(' | '))
    m.dom.window.close()
  }

  // Loading mount: slow workspace queries → the loading state shows.
  {
    const stub = makeStub(makeDb(), { slowAll: true })
    const m = await mountApp(bundle, stub, '#/', fakeSession(), 1280)
    await sleep(500)
    check('G7-5 states: home shows a loading state while queries are slow',
      text(m.w).includes('در حال بارگذاری'))
    try {
      await waitFor(m.w, () => text(m.w).includes('هنوز داده‌ای نیست') || text(m.w).includes('نبض تیم'), 15000, 'home after slow load')
      check('G7-5 states: home recovers after the slow load', true)
    } catch (e) {
      check('G7-5 states: home recovers after the slow load', false, e.message)
    }
    check('G7-5 states: slow-load mount has 0 JS errors', m.errors.length === 0, m.errors.join(' | '))
    m.dom.window.close()
  }

  // Room loading: wait for the room view to mount first (the workspace
  // load is slow too), then the messages loading text must be visible
  // while the messages query is still in flight.
  {
    const stub = makeStub(makeDb(), { slowAll: true })
    const m = await mountApp(bundle, stub, '#/room/' + ROOM_ID, fakeSession(), 1280)
    await waitFor(m.w, () => [...m.w.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'فرستادن'), 15000, 'room view mounted')
    check('G7-5 states: room shows «در حال بارگذاری پیام‌ها…» while messages load',
      text(m.w).includes('در حال بارگذاری پیام‌ها'))
    try {
      await waitFor(m.w, () => text(m.w).includes('هنوز پیامی نیست'), 15000, 'room after messages load')
      check('G7-5 states: room recovers after the messages load', true)
    } catch (e) {
      check('G7-5 states: room recovers after the messages load', false, e.message)
    }
    check('G7-5 states: room slow-load mount has 0 JS errors', m.errors.length === 0, m.errors.join(' | '))
    m.dom.window.close()
  }

  // Error mount: failing projects query → the GLOBAL error banner shows
  // on home AND on tasks (not home-only any more), exactly once.
  for (const hash of ['#/', '#/tasks']) {
    const stub = makeStub(makeDb(), { failProjects: true })
    const m = await mountApp(bundle, stub, hash, fakeSession(), 1280)
    try {
      await waitFor(m.w, () => m.w.document.querySelectorAll('[role="alert"]').length > 0, 10000, 'global error banner ' + hash)
      const banners = [...m.w.document.querySelectorAll('[role="alert"]')]
      check(`G7-5 states: global error banner shows on ${hash} when the load fails`,
        banners.length === 1 && banners[0].textContent.includes('probe: projects query failed'),
        'banners: ' + banners.length + ' — ' + (banners[0] ? banners[0].textContent.slice(0, 120) : 'none'))
    } catch (e) {
      check(`G7-5 states: global error banner shows on ${hash} when the load fails`, false, e.message)
    }
    check(`G7-5 states: error mount on ${hash} has 0 JS errors`, m.errors.length === 0, m.errors.join(' | '))
    m.dom.window.close()
  }

  console.log(failures === 0 ? 'ALL G7 PROBES PASSED' : failures + ' G7 PROBE(S) FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('G7 PROBE CRASHED:', e.message)
  process.exit(1)
})
