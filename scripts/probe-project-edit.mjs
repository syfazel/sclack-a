// Phase 2 probe (scripts/probe-project-edit.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the home project cards the way a user
// would, and asserts the Phase 2 scope: edit a project in place (name
// / description / goal / final output / deadline) with the custom_fields
// merge preserving stage and member_ids, empty-goal rejection, and the
// two-step rename confirm with a pre-write uniqueness check. No live
// Supabase, no test data in live tables.
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-project-edit.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT2_ID = '33333333-3333-3333-3333-333333333334'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const DOC_ID = '55555555-5555-5555-5555-555555555555'

// 1406/3/1 (the AIM project deadline, decision D1) as a Gregorian day key.
const DEADLINE_KEY = '2027-05-22'
const NEW_DEADLINE_KEY = '2027-06-01'

// Same rule as extract.js endOfTehranDay: a picked date means that
// Tehran day, stored as its end in ISO.
function endOfTehranDay(dayKey) {
  return new Date(dayKey + 'T23:59:00+03:30').toISOString()
}

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

// ---------- in-memory stub backend (same shape as probe-task-edit) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER_ID, muse_id: 'auth:' + USER_ID, name: 'پروب', auth_id: USER_ID, username: 'probe', created_at: now }
    ],
    projects: [
      {
        id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', description: 'توضیح کهنه',
        color: null, icon: null, created_by: MEMBER_ID, created_at: now,
        visibility: 'team', archived: false,
        custom_fields: {
          goal: 'هدف کهنه', final_output: 'خروجی کهنه',
          deadline: endOfTehranDay(DEADLINE_KEY), stage: 'active', member_ids: [MEMBER_ID]
        }
      },
      {
        id: PROJECT2_ID, workspace_id: 'main', name: 'پروژهٔ دوم', description: null,
        color: null, icon: null, created_by: MEMBER_ID, created_at: now,
        visibility: 'team', archived: false,
        custom_fields: {
          goal: 'هدف دوم', final_output: null,
          deadline: endOfTehranDay(NEW_DEADLINE_KEY), stage: 'created', member_ids: []
        }
      }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: DOC_ID, project_id: PROJECT_ID, title: 'سند الف', yjs_doc_id: 'doc-probe-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: '2026-11-20T10:00:00.000Z', version: 1, visibility: 'project', custom_fields: {} }
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
  const calls = { projectPatch: [] }
  // Case 7 flag: when true, PATCH on projects answers 406 PGRST116
  // without touching any row — the PostgREST answer under anon RLS
  // when an expired session lets zero rows through. The stub cannot
  // make the live row vanish (the card needs it), so the flag is the
  // minimal way to drive the zero-row path.
  const flags = { denyProjectPatch: false }

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
      if (table === 'projects' && flags.denyProjectPatch) {
        return json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
      }
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'projects') calls.projectPatch.push({ id: matched.map((r) => r.id), body })
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

function projectRow(w) {
  return stubDb().projects.find((p) => p.id === PROJECT_ID)
}
let dbRef = null
function stubDb() {
  return dbRef
}

function projectCard(w, section) {
  const root = section || w.document
  return [...root.querySelectorAll('.card')].find((c) =>
    c.textContent.includes('پروژهٔ پروب') || c.textContent.includes('پروژهٔ تازه')
  )
}

function projectsSection(w) {
  // The sidebar nav has its own «پروژه‌ها» heading — the real grid is
  // the main-content section with that exact h2 and project cards.
  return [...w.document.querySelectorAll('main section')].find((s) =>
    s.querySelector('h2')?.textContent.trim() === 'پروژه‌ها' && s.querySelector('.card')
  )
}

async function main() {
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')

  const db = makeDb()
  dbRef = db
  const stub = makeStub(db)

  // H4: project cards live on #/projects now, not on home.
  const m1 = await mountApp({ html, js }, stub, '#/projects')
  const { w } = m1
  m1errors = m1.errors
  await waitFor(w, () => w.document.body.textContent.includes('هدف کهنه'), 10000, 'project card renders')
  check('mount: #/projects renders the project card with its goal', true)

  const section = projectsSection(w)
  check('mount: «پروژه‌ها» section found', !!section)
  const card = projectCard(w, section)
  check('mount: project card found in the projects section', !!card)

  // ---- Case 1: edit goal / description / final output / deadline ----
  const editBtn = card.querySelector('button[aria-label^="ویرایش پروژهٔ"]')
  check('edit: «ویرایش پروژه» button present on the card, before the close button', !!editBtn)
  editBtn.click()
  const editForm = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form opens')
  check('edit: form opens under the card', !!editForm)
  check('edit: card carries the amber editing ring', card.className.includes('project-editing'))
  const nameInput = editForm.querySelector('input[placeholder="نام پروژه *"]')
  const goalInput = editForm.querySelector('input[placeholder="هدف پروژه *"]')
  const finalInput = editForm.querySelector('input[placeholder="خروجی نهایی"]')
  const descInput = editForm.querySelector('textarea[placeholder="توضیح (اختیاری)"]')
  const dateInput = editForm.querySelector('input[type="date"]')
  check('edit: name prefilled with the current value', nameInput && nameInput.value === 'پروژهٔ پروب', nameInput?.value)
  check('edit: goal prefilled with the current value', goalInput && goalInput.value === 'هدف کهنه', goalInput?.value)
  check('edit: final output prefilled with the current value', finalInput && finalInput.value === 'خروجی کهنه', finalInput?.value)
  check('edit: description prefilled with the current value', descInput && descInput.value === 'توضیح کهنه', descInput?.value)
  check('edit: deadline prefilled as the Tehran day key of the stored deadline', dateInput && dateInput.value === DEADLINE_KEY, dateInput?.value)
  setInput(w, goalInput, 'هدف تازه')
  setInput(w, descInput, 'توضیح تازه')
  setInput(w, finalInput, 'خروجی تازه')
  setInput(w, dateInput, NEW_DEADLINE_KEY)
  const saveBtn = [...editForm.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn.click()
  await waitFor(w, () => projectRow(w).custom_fields.goal === 'هدف تازه', 10000, 'edited row in stub DB')
  const edited = projectRow(w)
  check('edit: same row changed, no new project created', stub.db.projects.length === 2)
  check('edit: goal saved', edited.custom_fields.goal === 'هدف تازه')
  check('edit: description saved', edited.description === 'توضیح تازه')
  check('edit: final output saved', edited.custom_fields.final_output === 'خروجی تازه')
  check('edit: deadline saved (end of the new Tehran day)', edited.custom_fields.deadline === endOfTehranDay(NEW_DEADLINE_KEY), String(edited.custom_fields.deadline))
  check('edit: stage preserved by the custom_fields merge', edited.custom_fields.stage === 'active', String(edited.custom_fields.stage))
  check('edit: member_ids preserved by the custom_fields merge', JSON.stringify(edited.custom_fields.member_ids) === JSON.stringify([MEMBER_ID]), JSON.stringify(edited.custom_fields.member_ids))
  check('edit: name untouched when not renamed', edited.name === 'پروژهٔ پروب')
  check('edit: not archived by the edit', edited.archived === false)
  check('edit: PATCH recorded once', stub.calls.projectPatch.length === 1, 'patches: ' + stub.calls.projectPatch.length)
  await waitFor(w, () => !w.document.querySelector('[data-edit-form]'), 5000, 'edit form closes after save')
  check('edit: form closes after save', true)
  const cardAfter = await waitFor(
    w,
    () => [...w.document.querySelectorAll('.card')].find((c) => c.textContent.includes('هدف تازه')),
    10000,
    'edited card renders'
  )
  check('edit: card shows the new goal + new final output', cardAfter.textContent.includes('خروجی تازه'))

  // ---- Case 2: empty goal is rejected, row untouched ----
  const editBtn2 = cardAfter.querySelector('button[aria-label^="ویرایش پروژهٔ"]')
  editBtn2.click()
  const editForm2 = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form reopens')
  const goalInput2 = editForm2.querySelector('input[placeholder="هدف پروژه *"]')
  setInput(w, goalInput2, '   ')
  const saveBtn2 = [...editForm2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn2.click()
  await sleep(800)
  check('edit: empty goal shows the create-form error', editForm2.textContent.includes('هدف پروژه را بنویسید.'))
  check('edit: empty goal saves nothing', projectRow(w).custom_fields.goal === 'هدف تازه' && stub.calls.projectPatch.length === 1)

  // ---- Case 3: rename to another project's name — two-step, then rejected ----
  // (Case 2 left the goal empty — restore it first, so the rename path
  // is what gets exercised, not the goal validation.)
  const goalInput3 = editForm2.querySelector('input[placeholder="هدف پروژه *"]')
  setInput(w, goalInput3, 'هدف تازه')
  const nameInput3 = editForm2.querySelector('input[placeholder="نام پروژه *"]')
  setInput(w, nameInput3, 'پروژهٔ دوم')
  const saveBtn3 = [...editForm2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn3.click()
  await sleep(500)
  check('rename: first save tap arms the rename instead of writing', editForm2.textContent.includes('نام پروژه عوض می‌شود') && stub.calls.projectPatch.length === 1, editForm2.textContent.slice(0, 200))
  saveBtn3.click()
  await sleep(800)
  check('rename: duplicate name rejected with a clear message', editForm2.textContent.includes('پروژه‌ای با این نام هست'))
  check('rename: duplicate name writes nothing', projectRow(w).name === 'پروژهٔ پروب' && stub.calls.projectPatch.length === 1)

  // ---- Case 4: rename to a fresh name — two taps, then saved ----
  setInput(w, nameInput3, 'پروژهٔ تازه')
  saveBtn3.click()
  await sleep(500)
  check('rename: retyping a different name re-arms the confirm', editForm2.textContent.includes('نام پروژه عوض می‌شود') && stub.calls.projectPatch.length === 1)
  saveBtn3.click()
  await waitFor(w, () => projectRow(w).name === 'پروژهٔ تازه', 10000, 'renamed row in stub DB')
  check('rename: fresh name saved on the second tap', projectRow(w).name === 'پروژهٔ تازه')
  check('rename: PATCH recorded once more', stub.calls.projectPatch.length === 2, 'patches: ' + stub.calls.projectPatch.length)
  check('rename: goal still the edited value after the rename', projectRow(w).custom_fields.goal === 'هدف تازه')
  await waitFor(w, () => !w.document.querySelector('[data-edit-form]'), 5000, 'edit form closes after rename')
  check('rename: form closes after save', true)

  // ---- Case 5: cancel changes nothing and closes the form ----
  const cardNow = projectCard(w, projectsSection(w))
  const editBtn5 = cardNow.querySelector('button[aria-label^="ویرایش پروژهٔ"]')
  editBtn5.click()
  const editForm5 = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form opens (case 5)')
  const goalInput5 = editForm5.querySelector('input[placeholder="هدف پروژه *"]')
  setInput(w, goalInput5, 'هدفِ لغوشده')
  const cancelBtn = [...editForm5.querySelectorAll('button')].find((b) => b.textContent.trim() === 'انصراف')
  cancelBtn.click()
  await sleep(300)
  check('edit: cancel closes the form', !w.document.querySelector('[data-edit-form]'))
  check('edit: cancel saves nothing', projectRow(w).custom_fields.goal === 'هدف تازه' && stub.calls.projectPatch.length === 2)

  // ---- Case 6: close/delete untouched by the edit ----
  const card6 = projectCard(w, projectsSection(w))
  check('scope: «بستن پروژه» still on the card', [...card6.querySelectorAll('button')].some((b) => b.textContent.trim() === 'بستن پروژه'))
  check('scope: «حذف پروژه» still on the card (creator)', [...card6.querySelectorAll('button')].some((b) => b.textContent.trim() === 'حذف پروژه'))
  check('scope: the second project was never touched', stub.db.projects.find((p) => p.id === PROJECT2_ID).name === 'پروژهٔ دوم' && stub.db.projects.find((p) => p.id === PROJECT2_ID).custom_fields.goal === 'هدف دوم')

  // ---- Case 7: expired session → RLS zero rows → 406 PGRST116 → clear message, nothing written ----
  // (Live incident 2026-11-23 09:15–09:18: project-edit save answered
  // «Cannot coerce the result to a single JSON object» twice after the
  // session had expired. The stub flag makes PATCH on projects answer
  // 406 PGRST116 without mutating, exactly like PostgREST under anon RLS.)
  stub.flags.denyProjectPatch = true
  const card7 = projectCard(w, projectsSection(w))
  const editBtn7 = card7.querySelector('button[aria-label^="ویرایش پروژهٔ"]')
  editBtn7.click()
  const editForm7 = await waitFor(w, () => w.document.querySelector('[data-edit-form]'), 5000, 'edit form opens (case 7)')
  const goalInput7 = editForm7.querySelector('input[placeholder="هدف پروژه *"]')
  setInput(w, goalInput7, 'هدفِ ردشده')
  const saveBtn7 = [...editForm7.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ذخیرهٔ تغییرات')
  saveBtn7.click()
  await sleep(900)
  check('expired-session: clear Persian message shown in the form', editForm7.textContent.includes('پروژه به‌روز نشد — نشست شما تمام شده یا دسترسی ندارید؛ دوباره وارد شوید.'))
  check('expired-session: raw PostgREST text is NOT shown', !/coerce|single JSON/i.test(editForm7.textContent))
  check('expired-session: row untouched', projectRow(w).custom_fields.goal === 'هدف تازه' && projectRow(w).name === 'پروژهٔ تازه')
  check('expired-session: no PATCH recorded', stub.calls.projectPatch.length === 2, 'patches: ' + stub.calls.projectPatch.length)
  check('expired-session: form stays open after the rejection', !!w.document.querySelector('[data-edit-form]'))
  stub.flags.denyProjectPatch = false

  // ---- JS errors (excluding Realtime/WebSocket noise) ----
  const realErrors = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (m1.errors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', m1.errors.length, 'entries')

  m1.dom.window.close()
  console.log(failures === 0 ? 'ALL PROJECT-EDIT PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('PROJECT-EDIT PROBE FAILED:', e.message)
  console.log('window errors (m1):', JSON.stringify(m1errors, null, 2))
  process.exit(1)
})
