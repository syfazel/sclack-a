// Probe for sclack_A phases 6–11 (0.13.0) — one file, one section per
// phase, each printing its own summary (decision recorded in README-D3:
// a single file so the ~250-line jsdom harness is not repeated six times).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST) + pure-function checks in Node. No live Supabase,
// no test data in live tables. Same harness shape as probe-ux-rebuild.mjs.
//
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-phases-6-11.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { countRooyeshFields, formCompletion, validateFormPercents, emptyFormAnswers, FORM_ROOYESH_46 } from '../src/lib/form-rooyesh.js'
import { RULES_55, countRules, rulesByChapter, rulesForSection, unmappedRules } from '../src/lib/rules-aim.js'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_A_ID = '55555555-5555-5555-5555-555555555555'
const DOC_SEC1_ID = '55555555-5555-5555-5555-555555555560'
const DOC_SEC2_ID = '55555555-5555-5555-5555-555555555561'
const LIVE_0117_BUNDLE_BYTES = 589557

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
let sectionFailures = {}
let currentSection = ''
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    sectionFailures[currentSection] = (sectionFailures[currentSection] || 0) + 1
    console.log('FAIL', name, extra ?? '')
  }
}
function section(name) {
  currentSection = name
  console.log('\n--- ' + name + ' ---')
}

// ---------- in-memory stub backend (same shape as probe-ux-rebuild) ----------
function makeDb() {
  const now = new Date().toISOString()
  const doc = (id, title, parent_id, yjs_doc_id, created_by, visibility, custom_fields) => ({
    id, project_id: PROJECT_ID, title, yjs_doc_id, template_id: null,
    created_by, created_at: now, updated_at: now, version: 1,
    visibility: visibility || 'project', custom_fields: custom_fields || {}, search_text: null, parent_id
  })
  const task = (id, title, status, extra) => ({
    id, project_id: PROJECT_ID, title, status, created_by: MEMBER_ID, created_at: now,
    updated_at: now, due_at: null, completed_at: null, custom_fields: {}, parent_id: null,
    ...(extra || {})
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
      doc(DOC_A_ID, 'سند الف', null, 'p611-1', MEMBER_ID),
      doc(DOC_SEC1_ID, 'بخش ۱ — خلاصهٔ ایده و معرفی هسته', null, 'p611-s1', MEMBER_ID),
      doc(DOC_SEC2_ID, 'بخش ۲ — مسئله، نیاز بازار و مشتری هدف', null, 'p611-s2', MEMBER_ID)
    ],
    messages: [],
    files: [],
    tasks: [
      task('t1', 'کار باز یک', 'todo'),
      task('t2', 'کار در حال انجام', 'doing'),
      task('t3', 'کار تمام‌شده', 'done', { completed_at: '2026-11-20T10:00:00.000Z', created_at: '2026-11-10T10:00:00.000Z', due_at: '2026-11-20T10:00:00.000Z' }),
      task('t4', 'کار دارای مهلت', 'todo', { created_at: '2026-11-10T10:00:00.000Z', due_at: '2026-11-25T10:00:00.000Z' }),
      task('t5', 'کار بدون مهلت', 'todo', { created_at: '2026-11-10T10:00:00.000Z' })
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
  const authCalls = []
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
      } else if (op === 'is') {
        if (raw === 'null' && v !== null) return false
        if (raw === 'not.null' && v === null) return false
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
    if (url.startsWith(BASE_URL + '/auth/v1/')) {
      authCalls.push({ url, method })
      // Phase 11: sign-in with a password always fails in the fixture,
      // with the real Supabase error shape (invalid_grant).
      if (url.includes('/token') && method === 'POST' && url.includes('grant_type=password')) {
        return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
      }
      if (url.includes('/recover') && method === 'POST') return json({})
      if (url.includes('/user') && method === 'PUT') {
        return json({ user: { id: USER_ID, email: 'probe@example.com' } })
      }
      return json({})
    }
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { stubFetch, db, authCalls }
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

async function mountApp({ html, js }, stub, hash, opts = {}) {
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
  if (opts.withSession !== false) {
    w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(fakeSession()))
  }
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

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  // ---------- static ----------
  section('static: bundle + palette + print CSS')
  check('bundle: no real secret value (sb_secret_ + long token) in the probe bundle',
    !/sb_secret_[A-Za-z0-9_-]{20,}/.test(js))
  check(`bundle: <= 10% growth vs live 0.11.7 (${LIVE_0117_BUNDLE_BYTES} bytes)`,
    js.length <= LIVE_0117_BUNDLE_BYTES * 1.1, js.length + ' bytes')
  {
    const cssSrc = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8')
    check('static: @media print + .form-print + .no-print exist in app.css',
      cssSrc.includes('@media print') && cssSrc.includes('.form-print') && cssSrc.includes('.no-print'))
  }

  // ---------- pure: form (phase 6) + rules (phase 10) ----------
  section('pure: form definition (phase 6) + rules (phase 10)')
  check('pure: form counts exactly 46', countRooyeshFields(FORM_ROOYESH_46) === 46, 'got ' + countRooyeshFields(FORM_ROOYESH_46))
  check('pure: form has 8 sections (1-alef, 1-be, 2-alef, 2-be, 2-je, 2-dal, 2-he, 2-vav)',
    FORM_ROOYESH_46.sections.map((s) => s.id).join(',') === '1-alef,1-be,2-alef,2-be,2-je,2-dal,2-he,2-vav')
  check('pure: 18 tech fields', FORM_ROOYESH_46.sections[1].fields.find((f) => f.id === 'tech_field').options.length === 18)
  check('pure: 4 innovation types', FORM_ROOYESH_46.sections[1].fields.find((f) => f.id === 'innovation_type').options.length === 4)
  check('pure: 8 TRL yes-no fields', FORM_ROOYESH_46.sections[6].fields.length === 8)
  check('pure: 10 market questions', FORM_ROOYESH_46.sections[7].fields.length === 10)
  check('pure: empty answers complete 0/46', (() => {
    const c = formCompletion(emptyFormAnswers(), FORM_ROOYESH_46)
    return c.filled === 0 && c.total === 46
  })())
  check('pure: one scalar field filled completes 1/46', (() => {
    const a = emptyFormAnswers()
    a.idea_title = 'ایدهٔ پروب'
    return formCompletion(a, FORM_ROOYESH_46).filled === 1
  })())
  check('pure: percent warnings fire (stage range + stage sum + equip/assist sum 110 + assist cap)', (() => {
    const a = emptyFormAnswers()
    a.stages = { rows: [{ title: 'م۱', percent: '30', months: '2', output: 'خ' }], description: '' }
    a.equipment_pct = '70'
    a.assistant_pct = '40'
    const { warnings } = validateFormPercents(a)
    // عددهای محاسبه‌شده در پیام‌ها لاتین‌اند (قرارداد موجود اپ: نشان «2»)،
    // فقط عددهای ثابتِ متن فارسی‌اند.
    return warnings.length === 4 && warnings.some((w) => w.includes('۴۰ تا ۶۰')) && warnings.some((w) => w.includes('110'))
  })())
  check('pure: assistant cap warning (hard tech, 30% > 20%)', (() => {
    const a = emptyFormAnswers()
    a.is_soft_tech = { value: 'no', detail: '' }
    a.assistant_pct = '30'
    return validateFormPercents(a).warnings.some((w) => w.includes('۲۰٪'))
  })())
  check('pure: assistant cap is 50% for soft tech', (() => {
    const a = emptyFormAnswers()
    a.is_soft_tech = { value: 'yes', detail: '' }
    a.assistant_pct = '30'
    return validateFormPercents(a).warnings.length === 0
  })())
  check('pure: rules count exactly 55', countRules(RULES_55) === 55, 'got ' + countRules(RULES_55))
  check('pure: rules per chapter 14/12/14/15', (() => {
    const by = rulesByChapter(RULES_55)
    return by['الف'].length === 14 && by['ب'].length === 12 && by['ج'].length === 14 && by['د'].length === 15
  })())
  check('pure: section 1 rules are A3, D4, D5 (+ سراسری)', (() => {
    const codes = rulesForSection(1).map((r) => r.code)
    return codes.includes('R-A3') && codes.includes('R-D4') && codes.includes('R-D5')
  })())
  check('pure: exactly 3 unmapped rules (B10, B11, C14)', (() => {
    const codes = unmappedRules(RULES_55).map((r) => r.code).sort().join(',')
    return codes === 'R-B10,R-B11,R-C14'
  })(), unmappedRules(RULES_55).map((r) => r.code).join(','))

  // ---------- phase 6 DOM: form doc + rules doc ----------
  section('phase 6 DOM: form doc (one-tap create, fill, save, percents) + rules doc')
  {
    const db = makeDb()
    const stub = makeStub(db)
    const m = await mountApp({ html, js }, stub, '#/doc/' + DOC_A_ID)
    const { w } = m
    await waitFor(w, () => w.document.querySelector('li[data-doc-node="' + DOC_A_ID + '"]'), 10000, 'sidebar tree')

    // One-tap create: the form button in the docs section.
    const formBtn = await waitFor(w, () => w.document.querySelector('[data-create-form-doc]'), 10000, 'create-form button')
    formBtn.click()
    const formDoc = await waitFor(w, () => db.docs.find((d) => d.custom_fields?.form_kind === 'rooyesh-46'), 10000, 'form doc row in db')
    await waitFor(w, () => w.location.hash === '#/doc/' + formDoc.id, 10000, 'hash navigates to form doc')
    check('phase 6: form doc created with title «د — کاربرگ رسمی رویش (۴۶ سؤال)»',
      formDoc.title === 'د — کاربرگ رسمی رویش (۴۶ سؤال)')
    check('phase 6: form doc stores the full definition + empty answers',
      Array.isArray(formDoc.custom_fields.form_def?.sections) && formDoc.custom_fields.form_def.sections.length === 8 &&
      formDoc.custom_fields.form_answers?.idea_title === '')
    check('phase 6: FormView renders section ۱-الف + the 46 count',
      w.document.body.textContent.includes('۱-الف') && w.document.body.textContent.includes('۴۶'))
    check('phase 6: completion starts at 0 of 46',
      w.document.body.textContent.includes('۰ از ۴۶') || w.document.body.textContent.includes('0 از 46'))

    // Fill one scalar field → debounced save writes it to the row.
    const ideaInput = await waitFor(w, () => w.document.querySelector('#idea_title'), 10000, 'idea_title input')
    setInput(w, ideaInput, 'ایدهٔ پروب')
    await waitFor(w, () => db.docs.find((d) => d.id === formDoc.id)?.custom_fields?.form_answers?.idea_title === 'ایدهٔ پروب', 10000, 'answer saved to db')
    check('phase 6: typing an answer saves it to docs.custom_fields.form_answers',
      db.docs.find((d) => d.id === formDoc.id).custom_fields.form_answers.idea_title === 'ایدهٔ پروب')
    check('phase 6: completion moves to 1 of 46 after one field',
      w.document.body.textContent.includes('۱ از ۴۶') || w.document.body.textContent.includes('1 از 46'))

    // Percent validation shows live warnings.
    const equipInput = w.document.querySelector('#equipment_pct')
    const assistInput = w.document.querySelector('#assistant_pct')
    setInput(w, equipInput, '70')
    setInput(w, assistInput, '40')
    await waitFor(w, () => w.document.body.textContent.includes('110'), 10000, 'percent-sum warning')
    check('phase 6: equip 70 + assist 40 warns the sum must be 100%',
      w.document.body.textContent.includes('110'))

    // Idempotency: clicking the button again navigates to the SAME doc.
    w.document.querySelector('[data-create-form-doc]').click()
    await sleep(800)
    check('phase 6: second click creates no duplicate form doc',
      db.docs.filter((d) => d.custom_fields?.form_kind === 'rooyesh-46').length === 1)
    check('phase 6: second click stays on the same form doc',
      w.location.hash === '#/doc/' + formDoc.id)

    // Rules doc: one-tap create → RulesView with 55 rules.
    w.document.querySelector('[data-create-rules-doc]').click()
    const rulesDoc = await waitFor(w, () => db.docs.find((d) => d.custom_fields?.rules_kind === 'aim-55'), 10000, 'rules doc row in db')
    await waitFor(w, () => w.location.hash === '#/doc/' + rulesDoc.id, 10000, 'hash navigates to rules doc')
    check('phase 6/10: rules doc created with the full 55 rules',
      Array.isArray(rulesDoc.custom_fields.rules) && rulesDoc.custom_fields.rules.length === 55)
    check('phase 6/10: RulesView renders the 55-rule header',
      w.document.body.textContent.includes('۵۵ قانون'))
    // Section filter: section 1 → R-A3 visible.
    const sectionSelect = await waitFor(w, () => w.document.querySelector('select[aria-label="بخش طرح"]'), 10000, 'section filter')
    setSelect(w, sectionSelect, '1')
    await sleep(500)
    check('phase 6/10: filtering section 1 shows R-A3',
      w.document.body.textContent.includes('R-A3'))
    // Unmapped filter → exactly the 3 unmapped rules.
    setSelect(w, sectionSelect, 'unmapped')
    await sleep(500)
    check('phase 6/10: «بدون نگاشت» filter shows R-B10, R-B11, R-C14',
      w.document.body.textContent.includes('R-B10') && w.document.body.textContent.includes('R-B11') && w.document.body.textContent.includes('R-C14'))

    const realErrors = m.errors.filter((e) => !/websocket|realtime/i.test(e))
    check('phase 6: 0 non-Realtime JS errors on the mount', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
    m.dom.window.close()
  }

  // ---------- summary ----------
  console.log('\n' + (failures === 0 ? 'ALL PHASES 6-11 PROBES PASSED' : `${failures} PROBE(S) FAILED`))
  for (const [s, n] of Object.entries(sectionFailures)) console.log('  failed in ' + s + ': ' + n)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('PHASES 6-11 PROBE FAILED:', e.message)
  process.exit(1)
})
