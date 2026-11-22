// P01 section 5 (graphics) sandbox probes (Node, no network, no live data).
//
// Two layers:
//  1. UNIT — the pure logic of src/lib/graphics.js (prefs, particle
//     geometry, camera views, drag math, burst easing) plus create()
//     in jsdom with REAL pointer input: drag rotates, explode() arms the
//     burst, setView/setProps/dispose work. jsdom has no WebGL2, so the
//     handle reports webgl:false and the renderer is never built — the
//     live WebGL render itself needs a real browser/GPU (T1 live
//     re-test on yasin's device stays open).
//  2. MOUNT — the REAL built bundle in jsdom with a stubbed Supabase
//     backend: login fallback hero, home hero + glass, sidebar chrome,
//     planner sticky header, matte chat/doc/task rows (G10), purple
//     only in the assistant (G7), lazy three chunk + self-hosted font.
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d): this probe BUILDS the
// bundle itself with the probe Supabase URL + placeholder key before
// mounting, and refuses to mount a bundle that is not probe-configured.
//
// Usage:
//   node scripts/probe-p01-s5.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tehranDayKey, addTehranDays } from '../src/lib/extract.js'

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
const allErrors = []
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// ---------- 1. UNIT: graphics.js ----------
async function unitTests() {
  // jsdom globals so the module can be imported in Node.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true
  })
  const w = dom.window
  globalThis.window = w
  globalThis.document = w.document
  // Node 21+ exposes globalThis.navigator as a getter-only property:
  // assignment throws «Cannot set property navigator … which has only
  // a getter». defineProperty replaces it instead.
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true, writable: true })
  globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
  globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
  globalThis.HTMLElement = w.HTMLElement

  const g = await import('../src/lib/graphics.js')

  check('S5 unit: three is pinned to 0.187.0 in package.json',
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies.three === '0.187.0')
  check('S5 unit: heavy=900 / light=240 particle budget',
    g.HEAVY_PARTICLES === 900 && g.LIGHT_PARTICLES === 240)
  check('S5 unit: exactly 3 camera views', Object.keys(g.CAMERA_VIEWS).length === 3)
  check('S5 unit: top view phi is 0.34 (T2)',
    Math.abs(g.CAMERA_VIEWS.top.phi - 0.34) < 1e-9)
  check('S5 unit: top view looks down from above (y > z)',
    g.CAMERA_VIEWS.top.position[1] > g.CAMERA_VIEWS.top.position[2])
  check('S5 unit: 4 logo dots, amber -> coral',
    g.LOGO_DOTS.length === 4 && g.LOGO_DOTS[0].color === '#D97706' && g.LOGO_DOTS[3].color === '#F97066')

  // resolveGraphicsPrefs
  const desktop = g.resolveGraphicsPrefs({ isTouch: false, prefersReducedMotion: false, webgl2: true })
  check('S5 unit: desktop defaults to heavy 900, pixelRatio cap 2, animate',
    desktop.mode === 'heavy' && desktop.particles === 900 && desktop.pixelRatioCap === 2 && desktop.animate === true)
  const mobile = g.resolveGraphicsPrefs({ isTouch: true, prefersReducedMotion: false, webgl2: true })
  check('S5 unit: touch defaults to light 240, pixelRatio cap 1.5',
    mobile.mode === 'light' && mobile.particles === 240 && mobile.pixelRatioCap === 1.5)
  const reduced = g.resolveGraphicsPrefs({ isTouch: false, prefersReducedMotion: true, webgl2: true })
  check('S5 unit: prefers-reduced-motion stops animation',
    reduced.animate === false)
  const noGl = g.resolveGraphicsPrefs({ isTouch: false, prefersReducedMotion: false, webgl2: false })
  check('S5 unit: no WebGL2 stops animation',
    noGl.animate === false)
  check('S5 unit: webgl2Available() is false in jsdom (no WebGL)',
    g.webgl2Available() === false)

  // buildParticleGeometry
  const geo = g.buildParticleGeometry(900, 123)
  check('S5 unit: particle geometry has 900 positions (2700 floats)',
    geo.positions.length === 2700 && geo.colors.length === 2700 && geo.directions.length === 2700)
  let inRange = true
  let dirsUnit = true
  for (let i = 0; i < 900; i++) {
    const x = geo.positions[i * 3]
    const y = geo.positions[i * 3 + 1]
    const z = geo.positions[i * 3 + 2]
    if (Math.abs(x) > 4.3 || Math.abs(y) > 2.4 || Math.abs(z) > 4.3) inRange = false
    const dl = Math.hypot(geo.directions[i * 3], geo.directions[i * 3 + 1], geo.directions[i * 3 + 2])
    if (Math.abs(dl - 1) > 1e-5) dirsUnit = false
  }
  check('S5 unit: particle positions stay in the hero shell', inRange)
  check('S5 unit: explode directions are unit vectors', dirsUnit)
  const geo2 = g.buildParticleGeometry(900, 123)
  check('S5 unit: particle geometry is deterministic for a seed',
    geo.positions[0] === geo2.positions[0] && geo.positions[1500] === geo2.positions[1500])

  // applyDragRotation + burstProgress
  const r1 = g.applyDragRotation({ rotY: 0, rotX: 0 }, 100, 0)
  check('S5 unit: drag right rotates right (rotY grows)', r1.rotY > 0)
  const r2 = g.applyDragRotation({ rotY: 0, rotX: 0 }, 0, 10000)
  check('S5 unit: vertical drag is clamped to +-0.6', r2.rotX === 0.6)
  check('S5 unit: burst is 0 at t=0, peaks mid-way, back to 0 at 900ms',
    g.burstProgress(0) === 0 && g.burstProgress(250) === 1 && g.burstProgress(900) === 0 &&
    g.burstProgress(125) > 0 && g.burstProgress(125) < 1 && g.burstProgress(600) > 0 && g.burstProgress(600) < 1)

  // create() with REAL pointer input (jsdom: no WebGL, scene graph only)
  const container = w.document.createElement('div')
  w.document.body.appendChild(container)
  const handle = g.create(container, { onlineCount: 2 })
  const st0 = handle.getState()
  check('S5 unit: create() reports webgl:false without WebGL2', st0.webgl === false)
  check('S5 unit: scene graph is built (curve + 4 dots + points + 5 cards)',
    st0.groupChildren === 11, 'children=' + st0.groupChildren)
  check('S5 unit: desktop default is heavy mode', st0.mode === 'heavy')
  check('S5 unit: onlineCount=2 lights exactly 2 dots (dimming is real)',
    (() => {
      const dots = handle.group.children.filter((o) => o.geometry?.type === 'SphereGeometry')
      return dots.length === 4 && dots.filter((d) => d.material.opacity === 1).length === 2
    })())
  // Drag with real pointer events.
  container.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }))
  container.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 100 }))
  container.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 130 }))
  container.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 130 }))
  const st1 = handle.getState()
  check('S5 unit: real drag right rotates the scene (rotY 0.25)',
    Math.abs(st1.rotY - 0.25) < 1e-9, 'rotY=' + st1.rotY)
  check('S5 unit: real drag down tilts the scene (rotX 0.09)',
    Math.abs(st1.rotX - 0.09) < 1e-9, 'rotX=' + st1.rotX)
  // A drag that starts on a button must NOT rotate (controls sit above the canvas).
  const btn = w.document.createElement('button')
  container.appendChild(btn)
  const before = handle.getState().rotY
  btn.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }))
  btn.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 200 }))
  check('S5 unit: drag starting on a control button does not rotate',
    Math.abs(handle.getState().rotY - before) < 1e-9)
  // Explode / views / modes / pause / dispose.
  handle.explode()
  check('S5 unit: explode() arms the burst', handle.getState().burstActive === true)
  handle.setView('top')
  const st2 = handle.getState()
  check('S5 unit: setView(top) retargets the camera above the scene',
    st2.view === 'top' && st2.cameraTarget[1] > st2.cameraTarget[2],
    JSON.stringify(st2.cameraTarget))
  handle.setProps({ mode: 'light' })
  check('S5 unit: setProps light shows 240 particles', handle.getState().particlesShown === 240)
  handle.setProps({ mode: 'heavy' })
  check('S5 unit: setProps heavy shows 900 particles', handle.getState().particlesShown === 900)
  handle.setPaused(true)
  check('S5 unit: setPaused(true) pauses the loop', handle.getState().paused === true)
  handle.setPaused(false)
  check('S5 unit: setPaused(false) resumes', handle.getState().paused === false)
  handle.dispose()
  check('S5 unit: dispose() marks the handle disposed', handle.getState().disposed === true)
  dom.window.close()
}

// ---------- stub backend (adapted from probe-p01-d; GET/POST/PATCH/DELETE) ----------
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

function seedProject(db) {
  const now = new Date()
  const iso = (d) => new Date(d).toISOString()
  const isoAt = (dayOffset, time) => tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  db.projects.push({ id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب S5', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف S5', deadline: iso(now), stage: 'created', member_ids: [MEMBER_ID, MEMBER2_ID] } })
  db.rooms.push({ id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} })
  db.docs.push({ id: DOC_ID, project_id: PROJECT_ID, title: 'سند', yjs_doc_id: 'doc-p01-s5-1', template_id: null, created_by: MEMBER_ID, created_at: iso(now), updated_at: iso(now), version: 1, visibility: 'project', custom_fields: {} })
  db.tasks.push(
    { id: 'task-today', project_id: PROJECT_ID, title: 'کار امروز', description: null, assignee_id: MEMBER_ID, status: 'todo', due_at: isoAt(0, '23:59:00'), completed_at: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} },
    { id: 'task-today-done', project_id: PROJECT_ID, title: 'کار تمام‌شدهٔ امروز', description: null, assignee_id: MEMBER_ID, status: 'done', due_at: isoAt(0, '23:59:00'), completed_at: iso(now), created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} },
    { id: 'task-overdue', project_id: PROJECT_ID, title: 'کار عقب‌مانده', description: null, assignee_id: MEMBER2_ID, status: 'todo', due_at: isoAt(-1, '10:00:00'), completed_at: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} }
  )
  db.messages.push({ id: 'msg-1', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سلام از زهرا', visibility: 'project', created_at: iso(now) })
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
    return json({ error: 'stub: unknown url ' + url }, 404)
  }
  return { stubFetch, db }
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
  if (session) w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    // jsdom evals the bundle as a CLASSIC script, but Vite's
    // dynamic-import helper uses import.meta (valid only in modules).
    // Patch the two occurrences in the eval'd copy only — the real
    // browser loads the bundle as a module, where import.meta works.
    // The helper is only called when a lazy chunk actually loads, which
    // never happens in jsdom (no WebGL2 -> fallback hero, no import).
    // Rollup also emits a trailing facade export (export{A as C,...})
    // for chunk sharing — a top-level export is a parse error in a
    // classic script, so strip it from the eval'd copy only.
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
  await unitTests()

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)

  // ---- bundle-level checks: lazy three + self-hosted font ----
  const distDir = new URL('../dist/', import.meta.url).pathname
  const assets = readdirSync(distDir + 'assets')
  const cssFile = assets.find((f) => f.startsWith('index-') && f.endsWith('.css'))
  const css = cssFile ? readFileSync(distDir + 'assets/' + cssFile, 'utf8') : ''
  const graphicsChunk = assets.find((f) => f.startsWith('graphics-') && f.endsWith('.js'))
  check('S5 bundle: main bundle has NO WebGLRenderer (three is lazy)',
    !js.includes('WebGLRenderer'))
  check('S5 bundle: a separate graphics chunk exists and holds three',
    !!graphicsChunk && readFileSync(distDir + 'assets/' + graphicsChunk, 'utf8').includes('WebGLRenderer'),
    'chunk=' + graphicsChunk)
  check('S5 bundle: main bundle has no hero control strings (HeroScene is lazy)',
    !js.includes('انفجار ذره'))
  const woff2 = assets.filter((f) => f.endsWith('.woff2'))
  check('S5 bundle: 3 self-hosted Vazirmatn woff2 in dist/assets',
    woff2.length === 3, JSON.stringify(woff2))
  check('S5 bundle: CSS has @font-face Vazirmatn, no Google Fonts',
    css.includes('@font-face') && css.includes('Vazirmatn') && !css.includes('googleapis'))
  check('S5 bundle: CSS has the glass + warm-mesh rules',
    css.includes('glass-card') && css.includes('glass-chrome') && css.includes('warm-mesh'))
  check('S5 bundle: index.html has no Google Fonts link',
    !html.includes('googleapis'))
  check('S5 bundle: CSS carries the locked R3 tokens',
    css.includes('--glass-blur') && css.includes('--ai-accent') && css.includes('#7c3aed'))
  // Purple only inside the assistant: every CSS occurrence of the
  // accent must sit in an .ai- rule or the :root token definition.
  const purpleLines = css.split('}').filter((rule) => rule.includes('#7c3aed') || rule.includes('--ai-accent'))
  check('S5 bundle: purple (#7c3aed) appears only in .ai- / .btn-ai rules / :root token',
    purpleLines.length > 0 && purpleLines.every((r) => r.includes('.ai-') || r.includes('.btn-ai') || r.includes(':root')),
    JSON.stringify(purpleLines.map((r) => r.slice(0, 80))))
  // No purple in the sources of the non-assistant views.
  const srcDir = new URL('../src/', import.meta.url).pathname
  const nonAssistant = ['Login.svelte', 'HomeView.svelte', 'Sidebar.svelte', 'TasksView.svelte', 'ChatView.svelte', 'DocView.svelte', 'RoomsView.svelte', 'MembersView.svelte']
  check('S5 bundle: no purple token in non-assistant view sources',
    nonAssistant.every((f) => {
      const s = readFileSync(srcDir + 'components/' + f, 'utf8')
      return !s.includes('#7C3AED') && !s.includes('#7c3aed') && !s.includes('purple') && !s.includes('btn-ai')
    }))
  check('S5 bundle: no three import in the main (non-lazy) sources',
    !readFileSync(srcDir + 'components/Login.svelte', 'utf8').includes("from 'three'") &&
    !readFileSync(srcDir + 'components/HomeView.svelte', 'utf8').includes("from 'three'") &&
    !readFileSync(srcDir + 'App.svelte', 'utf8').includes("from 'three'"))
  // jsdom cannot run dynamic import() in an eval'd classic script (and
  // it does not execute <script type="module"> at all — verified), so
  // the HeroScene chunk never resolves here: the {#await} blocks stay
  // on their pending branch (warm mesh). The fallback branch itself is
  // verified at the source level here and by the create() unit tests
  // (webgl:false -> mode 'fallback'); a real browser resolves the chunk
  // in milliseconds and mounts HeroScene.
  const heroSrc = readFileSync(srcDir + 'components/HeroScene.svelte', 'utf8')
  check('S5 source: HeroScene renders [data-hero-fallback] when mode is fallback',
    heroSrc.includes("mode === 'fallback'") && heroSrc.includes('data-hero-fallback'))

  const db = makeDb()
  seedProject(db)
  const stub = makeStub(db)

  // ---- login (no session): G1 fallback hero, glass login card ----
  const m0 = await mountApp({ html, js }, stub, '#/', null)
  const w0 = m0.w
  allErrors.push(...m0.errors)
  await waitFor(w0, () => w0.document.body.textContent.includes('ورود به فضای کاری'), 10000, 'login screen')
  check('S5 login: warm mesh is present behind the card (pending branch — chunk import never settles in jsdom)',
    !!w0.document.querySelector('.warm-mesh'))
  check('S5 login: login card is glass, not matte',
    !!w0.document.querySelector('.glass-card'))
  check('S5 login: no canvas on the login page (no WebGL in jsdom)',
    w0.document.querySelectorAll('canvas').length === 0)
  check('S5 login: no hero scene container without a scene',
    !w0.document.querySelector('[data-hero-scene] canvas'))
  m0.dom.window.close()

  // ---- home (fake session): G2 hero + G3/G5 glass ----
  const m1 = await mountApp({ html, js }, stub, '#/')
  const w1 = m1.w
  allErrors.push(...m1.errors)
  await waitFor(w1, () => w1.document.querySelector('[data-home-hero]'), 10000, 'home hero band')
  await waitFor(w1, () => w1.document.body.textContent.includes('پروژهٔ پروب S5'), 10000, 'project loaded')
  const heroText = norm(w1.document.querySelector('[data-home-hero]').textContent)
  check('S5 home: hero greets the member (Tehran time-based)',
    ['صبح بخیر', 'ظهر بخیر', 'عصر بخیر', 'شب بخیر'].some((g) => heroText.includes(g)), heroText)
  check('S5 home: hero shows exactly 1 unfinished task due today (real rows)',
    heroText.includes('۱ کار امروز'), heroText)
  check('S5 home: hero shows exactly 1 overdue task (real rows)',
    heroText.includes('عقب‌مانده') && /۱\s*عقب‌مانده/.test(heroText), heroText)
  check('S5 home: hero band shows the warm mesh while the chunk loads (jsdom: import() never settles)',
    !!w1.document.querySelector('[data-home-hero] .warm-mesh'))
  check('S5 home: project cards are glass with entry animation',
    [...w1.document.querySelectorAll('.glass-card.anim-enter')].length >= 1)
  check('S5 home: review summary cards are glass (G3)',
    [...w1.document.querySelectorAll('section .glass-card')].length >= 6)
  check('S5 home: sidebar is light glass chrome (G4)',
    !!w1.document.querySelector('aside.glass-chrome'))
  check('S5 home: presence dot exists in the member seats (G6)',
    [...w1.document.querySelectorAll('aside .rounded-full')].length >= 1)
  check('S5 home: simple-mode toggle button exists in the sidebar',
    [...w1.document.querySelectorAll('aside button')].some((b) => b.textContent.trim() === 'حالت ساده'))
  // Toggle simple mode: class + localStorage, then back.
  clickButton(w1, w1.document.querySelector('aside'), 'حالت ساده')
  await sleep(400)
  check('S5 home: simple mode sets the class on <html>',
    w1.document.documentElement.classList.contains('simple-mode'))
  check('S5 home: simple mode persists in localStorage',
    w1.localStorage.getItem('sclack-simple-mode') === '1')
  const backBtn = [...w1.document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === 'حالت گرافیکی')
  check('S5 home: toggle label flips to «حالت گرافیکی»', !!backBtn)
  backBtn.click()
  await sleep(400)
  check('S5 home: toggling back removes the simple-mode class',
    !w1.document.documentElement.classList.contains('simple-mode'))

  // ---- planner (same mount, pick the project first): G4 sticky header + G10 matte rows ----
  const projBtn = [...w1.document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === 'پروژهٔ پروب S5')
  check('S5 tasks: project button exists in the sidebar', !!projBtn)
  projBtn.click()
  await waitFor(w1, () => w1.document.querySelector('[data-planner-header]') || w1.location.hash.startsWith('#/room/'), 10000, 'project selected')
  w1.location.hash = '#/tasks'
  w1.dispatchEvent(new w1.Event('hashchange'))
  await waitFor(w1, () => w1.document.querySelector('[data-planner-header]'), 10000, 'planner header')
  await waitFor(w1, () => w1.document.querySelectorAll('[data-menu]').length === 8, 10000, '8 planner menus')
  const header = w1.document.querySelector('[data-planner-header]')
  check('S5 tasks: planner header is sticky glass chrome (G4)',
    header.classList.contains('sticky') && header.classList.contains('glass-chrome'))
  check('S5 tasks: exactly the 8 planner menus, no more no fewer',
    w1.document.querySelectorAll('[data-menu]').length === 8)
  check('S5 tasks: no canvas on the planner page (G10)',
    w1.document.querySelectorAll('canvas').length === 0)
  const taskCards = [...w1.document.querySelectorAll('li.card')]
  check('S5 tasks: task rows exist for the seeded project', taskCards.length >= 1, String(taskCards.length))
  check('S5 tasks: task rows are matte — no glass-card on a task row (G10)',
    taskCards.every((li) => !li.classList.contains('glass-card')))
  check('S5 tasks: task rows carry no 3D scene container',
    !w1.document.querySelector('[data-hero-scene]'))
  m1.dom.window.close()

  // ---- room (chat): G10 matte, G6 presence dot + typing text present in source ----
  const m2 = await mountApp({ html, js }, stub, '#/room/' + ROOM_ID)
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.body.textContent.includes('سلام از زهرا'), 10000, 'chat message renders')
  check('S5 chat: message renders in the room', true)
  check('S5 chat: message bubbles are matte (msg-mine/msg-other, no glass)',
    [...w2.document.querySelectorAll('.msg-mine, .msg-other')].length >= 1 &&
    [...w2.document.querySelectorAll('.msg-mine, .msg-other')].every((el) => !el.classList.contains('glass-card')))
  check('S5 chat: no canvas in the chat view (G10)',
    w2.document.querySelectorAll('canvas').length === 0)
  check('S5 chat: no glass-card inside the chat view (G10)',
    w2.document.querySelectorAll('.glass-card').length === 0)
  m2.dom.window.close()

  // ---- assistant: G7 purple only here ----
  const m3 = await mountApp({ html, js }, stub, '#/assistant')
  const w3 = m3.w
  allErrors.push(...m3.errors)
  await waitFor(w3, () => w3.document.querySelector('.ai-panel'), 10000, 'assistant panel')
  check('S5 assistant: the assistant panel carries the purple accent (G7)',
    !!w3.document.querySelector('.ai-panel'))
  check('S5 assistant: every purple button lives inside the assistant panel',
    [...w3.document.querySelectorAll('.btn-ai')].every((b) => b.closest('.ai-panel')))
  m3.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL P01-S5 PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('P01-S5 PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
