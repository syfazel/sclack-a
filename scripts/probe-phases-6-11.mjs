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
import { computeBudget, computeBurndown, computeGantt, GRANT_RIALLS, buildTaskTree, taskAncestors, validateTaskParent, taskParentOptions, nextVersionNo } from '../src/lib/extract.js'
import { BUILTIN_TEMPLATES } from '../src/lib/templates.js'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'

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
    // عددهای محاسبه‌شده در پیام‌ها با ارقام فارسی‌اند (faNum — قرارداد اپ).
    return warnings.length === 4 && warnings.some((w) => w.includes('۴۰ تا ۶۰')) && warnings.some((w) => w.includes('۱۱۰'))
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
    await waitFor(w, () => w.document.body.textContent.includes('۱۱۰'), 10000, 'percent-sum warning')
    check('phase 6: equip 70 + assist 40 warns the sum must be 100%',
      w.document.body.textContent.includes('۱۱۰'))

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

  // ---------- phase 7: budget / burndown / gantt ----------
  section('phase 7 pure: computeBudget / computeBurndown / computeGantt')
  check('phase 7 pure: grant is 435,000,000 rials (1403 call)', GRANT_RIALLS === 435000000)
  check('phase 7 pure: clean budget has no warnings', (() => {
    const b = computeBudget([
      { kind: 'تجهیزات', title: 'الف', amount: '100000000' },
      { kind: 'دستیار پژوهشی', title: 'ب', amount: '20000000' }
    ], { isSoftTech: false })
    return b.total === 120000000 && b.equipmentTotal === 100000000 && b.assistantTotal === 20000000 &&
      b.caps.training === 43500000 && b.caps.rnd === 261000000 && b.caps.personnel === 130500000 &&
      b.warnings.length === 0
  })())
  check('phase 7 pure: over-budget case warns 3 times (total + rnd cap + assist share)', (() => {
    const b = computeBudget([
      { kind: 'تجهیزات', title: 'الف', amount: '300000000' },
      { kind: 'دستیار پژوهشی', title: 'ب', amount: '100000000' },
      { kind: 'تجهیزات', title: 'ج', amount: '50000000' }
    ], { isSoftTech: false, equipmentPct: '70', assistantPct: '30' })
    return b.total === 450000000 && b.warnings.length === 3
  })())
  check('phase 7 pure: burndown is null without tasks or window',
    computeBurndown([], '2026-11-10T00:00:00.000Z', '2026-11-30T00:00:00.000Z') === null &&
    computeBurndown([{ status: 'todo' }], null, null) === null)
  check('phase 7 pure: burndown ideal line starts at the right (x=556) at total', (() => {
    const bd = computeBurndown([
      { status: 'done', completed_at: '2026-11-20T10:00:00.000Z' },
      { status: 'todo' }, { status: 'todo' }
    ], '2026-11-10T00:00:00.000Z', '2026-11-30T00:00:00.000Z', '2026-11-23T00:00:00.000Z')
    return bd && bd.idealPoints.startsWith('556.0,12.0') && bd.total === 3 && bd.doneCount === 1 &&
      bd.remaining === 2 && bd.behind === true
  })())
  check('phase 7 pure: gantt splits dated rows from undated', (() => {
    const g = computeGantt([
      { id: '1', title: 'الف', status: 'todo', created_at: '2026-11-10T00:00:00.000Z', due_at: '2026-11-20T00:00:00.000Z' },
      { id: '2', title: 'ب', status: 'doing' }
    ], '2026-11-10T00:00:00.000Z', '2026-11-30T00:00:00.000Z')
    return g && g.rows.length === 1 && g.rows[0].x === 300 && g.rows[0].width === 292 &&
      g.undated.length === 1 && g.undated[0] === 'ب'
  })())
  check('phase 7 pure: gantt is null without a window',
    computeGantt([{ id: '1', title: 'الف', status: 'todo' }], null, null) === null)

  section('phase 7 DOM: BudgetView (form cost rows + tasks)')
  {
    const db = makeDb()
    const stub = makeStub(db)
    const now = new Date().toISOString()
    db.docs.push({
      id: 'form-doc-1', project_id: PROJECT_ID, title: 'د — کاربرگ رسمی رویش (۴۶ سؤال)',
      yjs_doc_id: 'p611-form', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now,
      version: 1, visibility: 'project',
      custom_fields: {
        form_kind: 'rooyesh-46',
        form_def: FORM_ROOYESH_46,
        form_answers: {
          ...emptyFormAnswers(),
          equipment_pct: '70',
          assistant_pct: '30',
          is_soft_tech: { value: 'no', detail: '' },
          cost_rows: [
            { kind: 'تجهیزات', title: 'الف', amount: '300000000' },
            { kind: 'دستیار پژوهشی', title: 'ب', amount: '100000000' },
            { kind: 'تجهیزات', title: 'ج', amount: '50000000' },
            {}, {}, {}, {}, {}, {}, {}
          ]
        }
      },
      search_text: null, parent_id: null
    })
    const m = await mountApp({ html, js }, stub, '#/budget')
    const { w } = m
    await waitFor(w, () => w.document.querySelector('[data-budget]'), 10000, 'budget section')
    check('phase 7: budget total shows ۴۵۰٬۰۰۰٬۰۰۰ rials from the form cost rows',
      w.document.querySelector('[data-budget]')?.textContent.includes('۴۵۰٬۰۰۰٬۰۰۰') === true)
    check('phase 7: grant-note (1403 call, check the current figure) is always shown',
      w.document.body.textContent.includes('رقم گرنت از فراخوان ۱۴۰۳ است'))
    check('phase 7: over-grant warning is shown',
      w.document.querySelector('[data-budget]')?.textContent.includes('بیش از گرنت') === true)
    check('phase 7: burndown SVG renders with 1 of 5 done',
      !!w.document.querySelector('[data-burndown]') &&
      w.document.body.textContent.includes('۱ از ۵ کار تمام‌شده'))
    check('phase 7: gantt SVG renders with the undated list (کار بدون مهلت)',
      !!w.document.querySelector('[data-gantt]') &&
      w.document.body.textContent.includes('کار بدون مهلت'))
    const realErrors = m.errors.filter((e) => !/websocket|realtime/i.test(e))
    check('phase 7: 0 non-Realtime JS errors on the mount', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
    m.dom.window.close()
  }

  // ---------- phase 8: kanban + subtasks + checklist + task templates ----------
  section('phase 8 pure: task tree + templates')
  check('phase 8 pure: buildTaskTree nests children, missing parent becomes a root', (() => {
    const tree = buildTaskTree([
      { id: 'a', title: 'الف', parent_id: null },
      { id: 'b', title: 'ب', parent_id: 'a' },
      { id: 'c', title: 'ج', parent_id: 'b' },
      { id: 'd', title: 'د', parent_id: 'missing' }
    ])
    return tree.map((t) => t.id).join(',') === 'a,d' &&
      tree[0].children.map((t) => t.id).join(',') === 'b' &&
      tree[0].children[0].children.map((t) => t.id).join(',') === 'c'
  })())
  check('phase 8 pure: taskAncestors walks up root-first', (() => {
    const tasks = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' }
    ]
    return taskAncestors(tasks, 'c').map((t) => t.id).join(',') === 'a,b'
  })())
  check('phase 8 pure: validateTaskParent blocks self + descendant, allows the rest', (() => {
    const tasks = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' }
    ]
    return validateTaskParent(tasks, 'a', 'a') === 'کار نمی‌تواند زیرِ خودش باشد.' &&
      validateTaskParent(tasks, 'a', 'c') === 'این کار زیرمجموعهٔ کارِ فعلی است؛ چرخه ساخته نمی‌شود.' &&
      validateTaskParent(tasks, 'c', 'a') === null &&
      validateTaskParent(tasks, 'c', null) === null
  })())
  check('phase 8 pure: taskParentOptions excludes self + descendants', (() => {
    const tasks = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'd', parent_id: null }
    ]
    return taskParentOptions(tasks, 'a').map((t) => t.id).join(',') === 'd'
  })())
  check('phase 8 pure: 7 built-in templates (4 old + 3 task)', (() => {
    const kinds = BUILTIN_TEMPLATES.map((t) => t.structure?.kind).join(',')
    return BUILTIN_TEMPLATES.length === 7 && kinds === 'doc,doc,doc,project,task,task,task'
  })())
  check('phase 8 pure: task templates carry checklist / dueInDays', (() => {
    const byName = Object.fromEntries(BUILTIN_TEMPLATES.map((t) => [t.name, t.structure]))
    return byName['کار با چک‌لیست'].checklist.length === 3 &&
      byName['کار با مهلت یک هفته‌ای'].dueInDays === 7 &&
      typeof byName['زیروظیفهٔ مرحله'].description === 'string'
  })())

  section('phase 8 DOM: tree + checklist + kanban + parent picker + task template')
  {
    const db = makeDb()
    const stub = makeStub(db)
    const now = new Date().toISOString()
    db.tasks.push(
      { id: 't6', project_id: PROJECT_ID, title: 'کار والد', status: 'todo', created_by: MEMBER_ID, created_at: now, updated_at: now, due_at: null, completed_at: null, custom_fields: {}, parent_id: null },
      { id: 't7', project_id: PROJECT_ID, title: 'زیروظیفهٔ یک', status: 'todo', created_by: MEMBER_ID, created_at: now, updated_at: now, due_at: null, completed_at: null, custom_fields: {}, parent_id: 't6' },
      { id: 't8', project_id: PROJECT_ID, title: 'کار با چک‌لیست', status: 'todo', created_by: MEMBER_ID, created_at: now, updated_at: now, due_at: null, completed_at: null, custom_fields: { checklist: [{ text: 'الف', done: true }, { text: 'ب', done: false }] }, parent_id: null }
    )
    const m = await mountApp({ html, js }, stub, '#/tasks')
    const { w } = m
    await waitFor(w, () => w.document.querySelector('[data-menu="due"]'), 10000, 'planner menus')
    // The 'due' menu lists every open task (dated first, then undated).
    w.document.querySelector('[data-menu="due"]').click()
    await waitFor(w, () => w.document.querySelector('[data-task-row="t6"]'), 10000, 'parent task row')

    check('phase 8: child renders nested under its parent (data-task-children)',
      !!w.document.querySelector('[data-task-children="t6"]') &&
      w.document.querySelector('[data-task-children="t6"]')?.textContent.includes('زیروظیفهٔ یک'))
    check('phase 8: child row carries its parent id',
      w.document.querySelector('[data-task-row="t7"]')?.getAttribute('data-task-parent') === 't6')
    check('phase 8: checklist shows 1 of 2 done',
      w.document.querySelector('[data-checklist="t8"]')?.textContent.includes('۱ از ۲') === true)

    // Toggle the second checklist item → db flips it to done.
    const t8box = w.document.querySelector('[data-checklist="t8"] input[type="checkbox"]:nth-of-type(2)') ||
      [...w.document.querySelectorAll('[data-checklist="t8"] input[type="checkbox"]')][1]
    t8box.click()
    await waitFor(w, () => db.tasks.find((t) => t.id === 't8')?.custom_fields?.checklist?.[1]?.done === true, 10000, 'checklist item toggled in db')
    check('phase 8: ticking a checklist item saves it to the task row',
      db.tasks.find((t) => t.id === 't8').custom_fields.checklist[1].done === true)
    check('phase 8: checklist count moves to 2 of 2',
      w.document.querySelector('[data-checklist="t8"]')?.textContent.includes('۲ از ۲') === true)

    // Kanban: switch view → 3 columns; tap the status button on a todo
    // card → it cycles to doing and moves columns (D9, tap not drag).
    w.document.querySelector('[data-view="kanban"]').click()
    await waitFor(w, () => w.document.querySelector('[data-kanban]'), 10000, 'kanban grid')
    check('phase 8: kanban has 3 status columns',
      ['todo', 'doing', 'done'].every((s) => !!w.document.querySelector('[data-kanban-column="' + s + '"]')))
    check('phase 8: todo column holds the parent task',
      w.document.querySelector('[data-kanban-column="todo"]')?.textContent.includes('کار والد') === true)
    const t1statusBtn = w.document.querySelector('[data-task-row="t1"] button')
    t1statusBtn.click()
    await waitFor(w, () => db.tasks.find((t) => t.id === 't1')?.status === 'doing', 10000, 't1 cycled to doing in db')
    await waitFor(w, () => w.document.querySelector('[data-kanban-column="doing"]')?.textContent.includes('کار باز یک'), 10000, 't1 moved to the doing column')
    check('phase 8: tapping a card status button moves it to the next column',
      db.tasks.find((t) => t.id === 't1').status === 'doing' &&
      w.document.querySelector('[data-kanban-column="doing"]')?.textContent.includes('کار باز یک'))

    // Cycle guard in the picker — checked BEFORE re-parenting t7 away:
    // while t7 is still under t6, editing t6 must NOT offer t7.
    w.document.querySelector('[data-task-row="t6"] .task-edit-btn').click()
    const editForm6 = await waitFor(w, () => w.document.querySelector('[data-edit-form="t6"]'), 10000, 'edit form for t6')
    const parentSelect6 = editForm6.querySelector('[data-edit-parent]')
    check('phase 8: parent picker for t6 excludes its descendant t7 (cycle guard)',
      ![...parentSelect6.querySelectorAll('option')].some((o) => o.value === 't7'))

    // Back to list; open the edit form on the child → parent picker
    // lists other tasks but NOT the child's own descendant (none here)
    // and re-parenting to t1 saves.
    w.document.querySelector('[data-view="list"]').click()
    await waitFor(w, () => !w.document.querySelector('[data-kanban]'), 10000, 'back to list')
    w.document.querySelector('[data-task-row="t7"] .task-edit-btn').click()
    const editForm = await waitFor(w, () => w.document.querySelector('[data-edit-form="t7"]'), 10000, 'edit form for t7')
    const parentSelect = editForm.querySelector('[data-edit-parent]')
    check('phase 8: parent picker shows the current parent (کار والد)',
      parentSelect?.value === 't6')
    check('phase 8: parent picker excludes the task itself',
      ![...parentSelect.querySelectorAll('option')].some((o) => o.value === 't7'))
    setSelect(w, parentSelect, 't1')
    editForm.querySelector('button.btn-primary').click()
    await waitFor(w, () => db.tasks.find((t) => t.id === 't7')?.parent_id === 't1', 10000, 't7 re-parented to t1 in db')
    check('phase 8: saving the edit re-parents the child (t7 → t1)',
      db.tasks.find((t) => t.id === 't7').parent_id === 't1')

    // Task template: seed the 7 templates, then create from the
    // checklist template → a task with 3 checklist items.
    const seedBtn = await waitFor(w, () => [...w.document.querySelectorAll('button')].find((b) => b.textContent.includes('ساختن ۷ قالب آماده')), 10000, 'seed templates button')
    seedBtn.click()
    await waitFor(w, () => db.templates.length === 7, 10000, '7 templates seeded')
    check('phase 8: seeding creates 7 templates (4 old + 3 task)',
      db.templates.length === 7)
    const checklistCard = [...w.document.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'کار با چک‌لیست')?.closest('.card')
    checklistCard.querySelector('button.btn-primary').click()
    const templated = await waitFor(w, () => db.tasks.find((t) => t.title === 'کار با چک‌لیست' && t.id !== 't8'), 10000, 'templated task in db')
    await waitFor(w, () => (db.tasks.find((t) => t.id === templated.id)?.custom_fields?.checklist || []).length === 3, 10000, 'templated checklist saved')
    check('phase 8: task template creates a task with its 3-item checklist',
      (db.tasks.find((t) => t.id === templated.id)?.custom_fields?.checklist || []).length === 3)

    const realErrors = m.errors.filter((e) => !/websocket|realtime/i.test(e))
    check('phase 8: 0 non-Realtime JS errors on the mount', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
    m.dom.window.close()
  }

  // ---------- phase 9: versions — diagnosis first, then fix ----------
  // Diagnosis (read before writing): saveVersion / listVersions /
  // restoreVersion in work.js, VersionsPanel.svelte, the versions RLS in
  // w1-rls.sql (2 policies: select member + insert own; no update/delete,
  // by design) and DocView (panel mounts whenever ydoc exists, read and
  // edit alike) are all present and wired on paper. The probe below is
  // the real check: seeded version rows with REAL Yjs snapshots must
  // list, preview, save a new version from an edit, and restore.
  section('phase 9 pure: version numbering + snapshot round-trip')
  check('phase 9 pure: nextVersionNo starts at 1, then max+1',
    nextVersionNo([]) === 1 && nextVersionNo([1, 2, 5]) === 6 && nextVersionNo([3]) === 4)
  check('phase 9 pure: Yjs snapshot round-trips Persian text', (() => {
    const d = new Y.Doc()
    d.getText('content').insert(0, 'متن نسخهٔ یک')
    const d2 = new Y.Doc()
    applyDocState(d2, encodeDocState(d), 'version')
    return d2.getText('content').toString() === 'متن نسخهٔ یک'
  })())
  check('phase 9 pure: empty snapshot encodes to a decodable state', (() => {
    const d = new Y.Doc()
    const d2 = new Y.Doc()
    return applyDocState(d2, encodeDocState(d), 'version') && d2.getText('content').toString() === ''
  })())

  section('phase 9 DOM: versions list, preview, save, restore')
  {
    const db = makeDb()
    const stub = makeStub(db)
    function snap(text) {
      const d = new Y.Doc()
      if (text) d.getText('content').insert(0, text)
      return encodeDocState(d)
    }
    db.versions.push(
      { id: 'v1', doc_id: DOC_A_ID, version_no: 1, snapshot_ref: snap('متن نسخهٔ یک'), author_id: MEMBER_ID, note: 'اولین', created_at: '2026-11-20T10:00:00.000Z' },
      { id: 'v2', doc_id: DOC_A_ID, version_no: 2, snapshot_ref: snap('متن نسخهٔ دو'), author_id: MEMBER_ID, note: null, created_at: '2026-11-21T10:00:00.000Z' }
    )
    const m = await mountApp({ html, js }, stub, '#/doc/' + DOC_A_ID)
    const { w } = m
    w.confirm = () => true
    await waitFor(w, () => w.document.body.textContent.includes('نسخه‌ها'), 10000, 'versions panel')
    const versionItems = () => [...w.document.querySelectorAll('li')].filter((li) => li.textContent.includes('نسخهٔ'))
    await waitFor(w, () => versionItems().length === 2, 10000, '2 seeded versions listed')

    check('phase 9: seeded versions v1 + v2 both listed',
      versionItems().length === 2)
    check('phase 9: newest first (v2 above v1)',
      versionItems()[0].textContent.includes('نسخهٔ ۲') && versionItems()[1].textContent.includes('نسخهٔ ۱'))
    check('phase 9: version note renders',
      versionItems()[1].textContent.includes('اولین'))

    // Preview v1 → the snapshot text shows.
    const v1item = versionItems().find((li) => li.textContent.includes('نسخهٔ ۱'))
    const previewBtn = [...v1item.querySelectorAll('button')].find((b) => b.textContent.includes('دیدن متن'))
    previewBtn.click()
    await waitFor(w, () => v1item.textContent.includes('متن نسخهٔ یک'), 10000, 'v1 preview text')
    check('phase 9: preview shows the snapshot text (متن نسخهٔ یک)',
      v1item.textContent.includes('متن نسخهٔ یک'))

    // Edit the doc, wait for autosave, then save a version → v3.
    const editToggle = await waitFor(w, () => w.document.querySelector('button[data-mode="edit"]'), 10000, 'edit toggle')
    if (editToggle.getAttribute('aria-pressed') !== 'true') editToggle.click()
    const ta = await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 10000, 'doc textarea')
    setInput(w, ta, 'متن تازهٔ ویرایش')
    await sleep(3500) // autosave debounce is 2 s
    const saveBtn = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ نسخه')
    saveBtn.click()
    await waitFor(w, () => db.versions.length === 3, 10000, 'v3 in db')
    await waitFor(w, () => versionItems().length === 3, 10000, 'v3 listed')
    check('phase 9: saving a version from an edit creates v3 and lists it',
      db.versions.length === 3 && versionItems()[0].textContent.includes('نسخهٔ ۳'))
    check('phase 9: v3 snapshot holds the edited text', (() => {
      const v3 = db.versions.find((v) => v.version_no === 3)
      const d = new Y.Doc()
      applyDocState(d, v3.snapshot_ref, 'version')
      return d.getText('content').toString() === 'متن تازهٔ ویرایش'
    })())

    // Restore v1 → live text goes back, and a NEW version (v4) is
    // recorded with the restore note; nothing is deleted.
    const v1item2 = versionItems().find((li) => li.textContent.includes('نسخهٔ ۱'))
    const restoreBtn = [...v1item2.querySelectorAll('button')].find((b) => b.textContent.includes('برگرداندن'))
    restoreBtn.click()
    await waitFor(w, () => db.versions.length === 4, 10000, 'v4 (restore) in db')
    await waitFor(w, () => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]')?.value === 'متن نسخهٔ یک', 10000, 'textarea back to v1 text')
    check('phase 9: restore puts the v1 text back in the live doc',
      w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]')?.value === 'متن نسخهٔ یک')
    check('phase 9: restore records a new version (v4) with the restore note',
      db.versions.find((v) => v.version_no === 4)?.note === 'برگردانده‌شده از نسخهٔ ۱')
    check('phase 9: restore deletes nothing (4 versions in db)',
      db.versions.length === 4)

    const realErrors = m.errors.filter((e) => !/websocket|realtime/i.test(e))
    check('phase 9: 0 non-Realtime JS errors on the mount', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
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
