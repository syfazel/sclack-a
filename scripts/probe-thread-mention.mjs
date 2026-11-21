// Thread + mention + notifications sandbox probes (Node, no network,
// no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (in-memory PostgREST), drives the chat room on #/room/... the way a
// two-person project actually runs, and asserts: one-level threading,
// @mention autocomplete + stored mentions[], mention/reply notification
// pointers (no message text), the notifications list + mark-read /
// mark-all-read, and that a notification failure never loses the
// message. Pure mention helpers from src/lib/mentions.js are the oracle.
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d): this probe BUILDS the
// bundle itself with the probe Supabase URL + placeholder key before
// mounting, and refuses to mount a bundle that is not probe-configured.
// Never mount ambient dist/ (a no-key build renders only the login).
//
// Usage:
//   node scripts/probe-thread-mention.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  parseMentions,
  filterMentionSuggestions,
  renderMentionSegments
} from '../src/lib/mentions.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const SARA_USER_ID = '88888888-8888-8888-8888-888888888888'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222' // یاسین (signed in)
const ZAHRA_ID = '22222222-2222-2222-2222-222222222223'
const SARA_ID = '22222222-2222-2222-2222-222222222224'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'

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

// ---------- in-memory stub backend (adapted from probe-p01-d) ----------
function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: ZAHRA_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', avatar: null, joined_at: now, auth_id: ZAHRA_USER_ID },
      { id: SARA_ID, muse_id: 'auth:' + SARA_USER_ID, name: 'سارا', avatar: null, joined_at: now, auth_id: SARA_USER_ID }
    ],
    projects: [
      { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب ترد', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: now, visibility: 'team', archived: false, custom_fields: { goal: 'هدف', deadline: now, stage: 'created', member_ids: [MEMBER_ID, ZAHRA_ID, SARA_ID] } }
    ],
    rooms: [
      { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [],
    messages: [
      { id: 'msg-parent', room_id: ROOM_ID, author_id: ZAHRA_ID, body: 'گزارش را تا فردا آماده می‌کنی؟', parent_id: null, mentions: [], visibility: 'project', created_at: now }
    ],
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
  let failNotifications = false
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
      if (single) {
        if (out.length !== 1) return json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
        return json(out[0])
      }
      return json(out)
    }
    if (method === 'POST') {
      if (table === 'notifications' && failNotifications) {
        return json({ message: 'simulated notification insert failure', code: '42501' }, 400)
      }
      const body = bodyText ? JSON.parse(bodyText) : {}
      const onConflict = params.get('on_conflict') || params.get('onConflict')
      const now = new Date().toISOString()
      const row = { ...body }
      if (!row.id) {
        if (table === 'members' && body.auth_id === USER_ID) row.id = MEMBER_ID
        else if (table === 'members' && body.auth_id === ZAHRA_USER_ID) row.id = ZAHRA_ID
        else if (table === 'members' && body.auth_id === SARA_USER_ID) row.id = SARA_ID
        else row.id = 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at) row.created_at = now
      if (table === 'messages' && row.mentions === undefined) row.mentions = []
      if (table === 'notifications' && row.read === undefined) row.read = false
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
  return {
    stubFetch,
    db,
    setFailNotifications(v) {
      failNotifications = v
    }
  }
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
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
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

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim() }
function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
function clickButton(w, scope, label) {
  const btn = [...(scope || w.document).querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}
function replyButtons(w) {
  return [...w.document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'پاسخ')
}
function chatInput(w) {
  return w.document.querySelector('input[placeholder*="پیام بنویسید"]')
}
async function sendChat(w, text) {
  const before = w.document.body.textContent
  void before
  setInput(w, chatInput(w), text)
  await sleep(200)
  clickButton(w, w.document, 'فرستادن')
}

// ---------- main ----------
async function main() {
  const members = [
    { id: MEMBER_ID, name: 'yasin' },
    { id: ZAHRA_ID, name: 'زهرا' },
    { id: SARA_ID, name: 'سارا' }
  ]

  // ---- pure mention helpers (oracle) ----
  check('pure: parseMentions finds 2 members in order', JSON.stringify(parseMentions('@زهرا و @سارا سلام', members)) === JSON.stringify([ZAHRA_ID, SARA_ID]))
  check('pure: parseMentions dedupes a repeated @name', parseMentions('@زهرا @زهرا', members).length === 1)
  check('pure: longest name wins over its prefix', JSON.stringify(parseMentions('@زهرا آریاپور سلام', [...members, { id: 'long-1', name: 'زهرا آریاپور' }])) === JSON.stringify(['long-1']))
  // Both inputs must yield no mention — the old check used ||, so it
  // passed when only ONE of the two was clean. Verified directly:
  // parseMentions('ایمیل a@زهرا') === [] and
  // parseMentions('سلام@زهرا') === [] (and 'foo@زهرا' === []), and
  // renderMentionSegments('سلام@زهرا') is a single plain segment.
  check('pure: @name inside a word is not a mention', parseMentions('ایمیل a@زهرا', members).length === 0 && parseMentions('سلام@زهرا', members).length === 0)
  check('pure: filterMentionSuggestions filters by prefix', JSON.stringify(filterMentionSuggestions('@ز', 2, members).map((m) => m.id)) === JSON.stringify([ZAHRA_ID]))
  check('pure: filterMentionSuggestions empty prefix returns all', filterMentionSuggestions('@', 1, members).length === 3)
  check('pure: filterMentionSuggestions closed by a space returns none', filterMentionSuggestions('@زهرا ', 6, members).length === 0)
  const segs = renderMentionSegments('سلام @زهرا و @سارا', members)
  check('pure: render segments mark both mentions', segs.filter((s) => s.mentionId).length === 2 && segs.some((s) => s.text === '@زهرا'))

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('bundle strings: thread + mention + notifications UI present',
    ['پاسخ', 'اعلان‌ها', 'خوانده‌شدن همه', 'msg-mention'].every((s) => js.includes(s)),
    'missing one of پاسخ/اعلان‌ها/خوانده‌شدن همه/msg-mention')

  const db = makeDb()
  const stub = makeStub(db)

  // ---- mount 1: یاسین در اتاق گفت‌وگو ----
  const m1 = await mountApp({ html, js }, stub, '#/room/' + ROOM_ID)
  const w = m1.w
  allErrors.push(...m1.errors)
  await waitFor(w, () => chatInput(w), 10000, 'chat composer')
  await waitFor(w, () => w.document.body.textContent.includes('گزارش را تا فردا آماده می‌کنی؟'), 10000, 'seeded parent message renders')
  check('chat: seeded parent message renders', true)
  check('chat: parent has a «پاسخ» button', replyButtons(w).length >= 1)

  // ---- top-level message ----
  await sendChat(w, 'سلام به همه')
  await waitFor(w, () => db.messages.length === 2, 10000, 'top-level message row')
  const topMsg = db.messages.find((x) => x.body === 'سلام به همه')
  check('thread: top-level message has parent_id null', !!topMsg && topMsg.parent_id === null, JSON.stringify(topMsg))
  check('thread: top-level message has empty mentions', !!topMsg && Array.isArray(topMsg.mentions) && topMsg.mentions.length === 0)
  check('thread: no notification for a plain message', db.notifications.length === 0, JSON.stringify(db.notifications))

  // ---- reply 1 (to Zahra's parent) ----
  replyButtons(w)[0].click()
  await waitFor(w, () => w.document.body.textContent.includes('پاسخ به زهرا'), 10000, 'reply quote bar')
  check('thread: reply quote bar shows parent author + quote', w.document.body.textContent.includes('پاسخ به زهرا'))
  await sendChat(w, 'باشه، انجام می‌دهم')
  await waitFor(w, () => db.messages.length === 3, 10000, 'reply row')
  const reply1 = db.messages.find((x) => x.body === 'باشه، انجام می‌دهم')
  check('thread: reply stores parent_id of the top message', !!reply1 && reply1.parent_id === 'msg-parent', JSON.stringify(reply1))
  // Counts render with Latin digits (same as the P01 probes: «(1)» not «(۱)»).
  check('thread: «1 پاسخ» shows under the parent', norm(w.document.body.textContent).includes('1 پاسخ'), norm(w.document.body.textContent).slice(0, 400))
  check('thread: replies render indented with a quote border', !!w.document.querySelector('ul.border-s-2'))
  check('notif: exactly 1 reply pointer for Zahra after reply 1',
    db.notifications.filter((n) => n.type === 'reply' && n.user_id === ZAHRA_ID).length === 1,
    JSON.stringify(db.notifications))

  // ---- reply 2 (to the reply — must take the SAME top parent) ----
  const buttons2 = replyButtons(w)
  check('thread: the reply itself also has a «پاسخ» button', buttons2.length >= 2, String(buttons2.length))
  buttons2[1].click()
  await waitFor(w, () => w.document.body.textContent.includes('پاسخ به yasin'), 10000, 'reply-to-reply quote bar')
  await sendChat(w, 'دوباره: چشم')
  await waitFor(w, () => db.messages.length === 4, 10000, 'second reply row')
  const reply2 = db.messages.find((x) => x.body === 'دوباره: چشم')
  check('thread: reply-to-reply takes the same top parent (one level)', !!reply2 && reply2.parent_id === 'msg-parent', JSON.stringify(reply2))
  check('thread: count is now «2 پاسخ»', norm(w.document.body.textContent).includes('2 پاسخ'))
  check('notif: second reply adds a second reply pointer for Zahra',
    db.notifications.filter((n) => n.type === 'reply' && n.user_id === ZAHRA_ID).length === 2,
    JSON.stringify(db.notifications))

  // ---- cancel reply ----
  replyButtons(w)[0].click()
  await waitFor(w, () => w.document.body.textContent.includes('پاسخ به زهرا'), 10000, 'quote bar again')
  clickButton(w, w.document, 'لغو')
  await sleep(300)
  check('thread: «لغو» clears the reply quote bar', !w.document.body.textContent.includes('پاسخ به زهرا'))

  // ---- mention autocomplete ----
  setInput(w, chatInput(w), '@ز')
  await sleep(300)
  check('mention: typing @ز opens the suggestion list with زهرا',
    !!w.document.querySelector('[data-mention-list]') && w.document.querySelector('[data-mention-list]').textContent.includes('@زهرا'),
    norm(w.document.querySelector('[data-mention-list]')?.textContent || ''))
  const sugBtn = [...w.document.querySelectorAll('[data-mention-list] button')].find((b) => b.textContent.trim() === '@زهرا')
  check('mention: suggestion button exists', !!sugBtn)
  sugBtn.click()
  await sleep(300)
  check('mention: picking the suggestion inserts «@زهرا »', chatInput(w).value === '@زهرا ', JSON.stringify(chatInput(w).value))

  // ---- mention 2 members in one message ----
  await sendChat(w, '@زهرا و @سارا سلام')
  await waitFor(w, () => db.messages.length === 5, 10000, 'mention message row')
  const mentionMsg = db.messages.find((x) => x.body === '@زهرا و @سارا سلام')
  check('mention: stored mentions[] has both members in order',
    !!mentionMsg && JSON.stringify(mentionMsg.mentions) === JSON.stringify([ZAHRA_ID, SARA_ID]),
    JSON.stringify(mentionMsg && mentionMsg.mentions))
  check('mention: @نام renders with the amber highlight class',
    w.document.querySelectorAll('.msg-mention').length >= 2,
    String(w.document.querySelectorAll('.msg-mention').length))
  const zahraMentions = db.notifications.filter((n) => n.type === 'mention' && n.user_id === ZAHRA_ID)
  const saraMentions = db.notifications.filter((n) => n.type === 'mention' && n.user_id === SARA_ID)
  check('notif: exactly 1 mention pointer for Zahra', zahraMentions.length === 1, JSON.stringify(zahraMentions))
  check('notif: exactly 1 mention pointer for Sara', saraMentions.length === 1, JSON.stringify(saraMentions))
  check('notif: mention pointers point at the message id',
    zahraMentions[0]?.target_id === mentionMsg.id && saraMentions[0]?.target_id === mentionMsg.id,
    JSON.stringify({ z: zahraMentions[0], s: saraMentions[0] }))
  check('notif: no notification row carries message text',
    db.notifications.every((n) => !('body' in n) && !('text' in n) && !('message' in n)),
    JSON.stringify(db.notifications.map((n) => Object.keys(n))))

  // ---- self-mention: stored, but no notification for the author ----
  await sendChat(w, '@yasin سلام')
  await waitFor(w, () => db.messages.length === 6, 10000, 'self-mention row')
  const selfMsg = db.messages.find((x) => x.body === '@yasin سلام')
  check('mention: self-mention is stored in mentions[]',
    !!selfMsg && selfMsg.mentions.includes(MEMBER_ID), JSON.stringify(selfMsg && selfMsg.mentions))
  check('notif: self-mention creates no notification for the author',
    db.notifications.filter((n) => n.user_id === MEMBER_ID).length === 0,
    JSON.stringify(db.notifications.filter((n) => n.user_id === MEMBER_ID)))

  // ---- reply that also mentions the parent author: mention only, no duplicate reply ----
  replyButtons(w)[0].click()
  await waitFor(w, () => w.document.body.textContent.includes('پاسخ به زهرا'), 10000, 'quote bar for mention-reply')
  await sendChat(w, '@زهرا چشم، انجام شد')
  await waitFor(w, () => db.messages.length === 7, 10000, 'mention-reply row')
  check('notif: mention-reply adds a mention but no extra reply pointer',
    db.notifications.filter((n) => n.type === 'mention' && n.user_id === ZAHRA_ID).length === 2 &&
    db.notifications.filter((n) => n.type === 'reply' && n.user_id === ZAHRA_ID).length === 2,
    JSON.stringify(db.notifications.filter((n) => n.user_id === ZAHRA_ID)))

  // ---- notification failure must not lose the message ----
  stub.setFailNotifications(true)
  await sendChat(w, '@زهرا تست خطا')
  await waitFor(w, () => db.messages.length === 8, 10000, 'message row despite notification failure')
  check('notif-fail: message is still stored when notification insert fails',
    db.messages.some((x) => x.body === '@زهرا تست خطا'))
  check('notif-fail: sendState warns about the notification, it does not claim success silently',
    (w.document.body.textContent || '').includes('اعلان'),
    (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 300))
  check('notif-fail: no notification row was recorded for the failed message',
    db.notifications.filter((n) => n.type === 'mention' && n.user_id === ZAHRA_ID).length === 2)
  stub.setFailNotifications(false)
  m1.dom.window.close()

  // ---- mount 2: زهرا opens her notifications ----
  const zahraSession = fakeSession(ZAHRA_USER_ID, 'zahra@probe.test')
  const m2 = await mountApp({ html, js }, stub, '#/notifications', zahraSession)
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.body.textContent.includes('اعلان‌ها'), 10000, 'notifications heading')
  await waitFor(w2, () => w2.document.querySelectorAll('[data-notification]').length > 0, 10000, 'notification rows render')
  const rows = [...w2.document.querySelectorAll('[data-notification]')]
  check('list: Zahra sees exactly her 4 pointers (2 reply + 2 mention)',
    rows.length === 4, JSON.stringify(rows.map((r) => r.getAttribute('data-notification'))))
  const listText = norm(w2.document.body.textContent)
  check('list: type labels منشن / پاسخ are shown', listText.includes('منشن') && listText.includes('پاسخ'))
  check('list: sender name and room name are shown', listText.includes('yasin') && listText.includes('گفت‌وگو'))
  check('list: the page says there is no push notification', listText.includes('اعلان پوش نمی‌فرستیم'))
  const badge = w2.document.querySelector('[data-unread-badge]')
  check('list: sidebar unread badge shows 4', !!badge && badge.textContent.trim() === '4', badge ? badge.textContent : 'no badge')

  // Click one row: it marks that notification read (and links to its room).
  const firstRow = rows[0]
  const firstId = firstRow.getAttribute('data-notification')
  const link = firstRow.querySelector('a')
  check('list: each row links to its room', !!link && link.getAttribute('href') === '#/room/' + ROOM_ID, link ? link.getAttribute('href') : 'no link')
  link.click()
  await waitFor(w2, () => db.notifications.find((n) => n.id === firstId)?.read === true, 10000, 'clicked notification marked read')
  check('list: clicking a row marks exactly that notification read',
    db.notifications.find((n) => n.id === firstId)?.read === true &&
    db.notifications.filter((n) => n.read).length === 1,
    JSON.stringify(db.notifications.map((n) => [n.type, n.read])))
  await sleep(400)
  const badgeAfterOne = w2.document.querySelector('[data-unread-badge]')
  check('list: badge drops to 3 after one read', !!badgeAfterOne && badgeAfterOne.textContent.trim() === '3', badgeAfterOne ? badgeAfterOne.textContent : 'no badge')

  // Back to the list, mark all read.
  w2.location.hash = '#/notifications'
  w2.dispatchEvent(new w2.Event('hashchange'))
  await waitFor(w2, () => [...w2.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'خوانده‌شدن همه'), 10000, 'mark-all button')
  await sleep(800)
  const markAllBtn = [...w2.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'خوانده‌شدن همه')
  markAllBtn.click()
  // Only Zahra's own pointers must flip — Sara's mention pointer must
  // stay unread (mark-all-read is scoped to the signed-in member).
  const zahraNotifs = () => db.notifications.filter((n) => n.user_id === ZAHRA_ID)
  await waitFor(w2, () => zahraNotifs().every((n) => n.read), 10000, 'all notifications read')
  check('list: «خوانده‌شدن همه» marks every notification read',
    zahraNotifs().every((n) => n.read), JSON.stringify(zahraNotifs().map((n) => n.read)))
  check('list: mark-all-read does NOT touch another member’s pointer',
    db.notifications.some((n) => n.user_id === SARA_ID && !n.read),
    JSON.stringify(db.notifications.filter((n) => n.user_id === SARA_ID)))
  await sleep(400)
  check('list: unread badge disappears after mark-all-read', !w2.document.querySelector('[data-unread-badge]'))
  m2.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL THREAD-MENTION PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('THREAD-MENTION PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
