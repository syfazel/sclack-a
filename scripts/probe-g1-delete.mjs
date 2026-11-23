// G1 item 8 sandbox probes (Node, no network, no live data).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// and asserts the three in-site deletes: message delete (author only,
// replies first), project delete (creator only, FK-safe cascade with a
// pre-check that refuses when a child cannot go), and the BLOCKED doc
// delete (no control exists — versions are immutable, see below).
//
// Live findings fixed here (2026-11-22):
//  * Finding 1 — the delete button on a freshly sent message: the probe
//    sends one through the UI and asserts the button is there at once,
//    no reload. (In the live test it did not show until reload; the
//    bundle check below plus this mount check pin the behaviour.)
//  * Finding 2 — live delete propagation: the probe mounts TWO clients
//    on the same room (A = yasin, B = Zahra) sharing one stub DB. A
//    deletes through the UI; the DELETE event is then delivered to B's
//    socket the way the Realtime server would, and B's list must lose
//    the message without reload. The socket is faked (FakeRealtimeSocket
//    in mountApp): it speaks just enough Phoenix for supabase-js to
//    join — join replies echo the client's postgres_changes filters
//    back with server ids — and deliverPostgresChange pushes a change
//    event. The real server is the only bridge between two browser
//    profiles, so this is the honest sandbox stand-in for it.
//
// Unlike probe-p01-a..d, this stub models the real DELETE rules:
//  * RLS delete is owner-only per table (w1/d2/d4); versions and members
//    have NO delete policy at all, so a delete always matches 0 rows.
//  * FKs have NO ON DELETE CASCADE anywhere (schema-sclack-a.sql), so a
//    delete of a referenced row fails with 23503 and deletes nothing.
//  * Storage remove only removes objects owned by the signed-in member.
// A delete that matches 0 rows is exactly what PostgREST returns when
// RLS blocks it — the app must surface it, never stay silent.
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d): this probe BUILDS the
// bundle itself with the probe Supabase URL + placeholder key before
// mounting, and refuses to mount a bundle that is not probe-configured.
//
// Usage:
//   node scripts/probe-g1-delete.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const FILES_BUCKET = 'sclack-files'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const P1 = '33333333-3333-3333-3333-333333333331'
const P2 = '33333333-3333-3333-3333-333333333332'
const P3 = '33333333-3333-3333-3333-333333333333'
const R1 = '44444444-4444-4444-4444-444444444441'
const R2 = '44444444-4444-4444-4444-444444444442'
const R3 = '44444444-4444-4444-4444-444444444443'
const D1 = '55555555-5555-5555-5555-555555555551'
const D2 = '55555555-5555-5555-5555-555555555552'
const D3 = '55555555-5555-5555-5555-555555555553'

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

// ---------- in-memory stub backend (RLS + FK aware on DELETE) ----------
function makeDb() {
  const now = new Date().toISOString()
  const proj = (id, name, creator) => ({
    id, workspace_id: 'main', name, description: null, color: null, icon: null,
    created_by: creator, created_at: now, visibility: 'team', archived: false,
    custom_fields: { goal: 'هدف', deadline: now, stage: 'created', member_ids: [MEMBER_ID, MEMBER2_ID] }
  })
  const msg = (id, room, author, body, parent) => ({
    id, room_id: room, author_id: author, body, parent_id: parent || null,
    mentions: [], attachments: [], created_at: now, edited_at: null,
    visibility: 'project', custom_fields: {}
  })
  return {
    members: [
      { id: MEMBER2_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', avatar: null, joined_at: now, auth_id: ZAHRA_USER_ID }
    ],
    projects: [
      proj(P1, 'پروژهٔ پروب حذف', MEMBER_ID),
      proj(P2, 'پروژهٔ پاک‌شدنی', MEMBER_ID),
      proj(P3, 'پروژهٔ زهرا', MEMBER2_ID)
    ],
    rooms: [
      { id: R1, project_id: P1, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} },
      { id: R2, project_id: P1, name: 'اتاق زهرا', type: 'project', member_a: null, member_b: null, created_by: MEMBER2_ID, created_at: now, visibility: 'project', custom_fields: {} },
      { id: R3, project_id: P2, name: 'اتاق دوم', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: now, visibility: 'project', custom_fields: {} }
    ],
    docs: [
      { id: D1, project_id: P1, title: 'سند یک', yjs_doc_id: 'doc-g1-1', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {} },
      { id: D2, project_id: P1, title: 'سند نسخه‌دار', yjs_doc_id: 'doc-g1-2', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {} },
      { id: D3, project_id: P2, title: 'سند پروژهٔ پاک‌شدنی', yjs_doc_id: 'doc-g1-3', template_id: null, created_by: MEMBER_ID, created_at: now, updated_at: now, version: 1, visibility: 'project', custom_fields: {} }
    ],
    messages: [
      msg('msg-1', R1, MEMBER_ID, 'پیام والد من', null),
      msg('msg-2', R1, MEMBER_ID, 'پاسخ من به والد', 'msg-1'),
      msg('msg-3', R1, MEMBER2_ID, 'پیام والد زهرا', null),
      msg('msg-4', R1, MEMBER_ID, 'پاسخ من به زهرا', 'msg-3'),
      msg('msg-5', R1, MEMBER2_ID, 'پاسخ زهرا به والد من', 'msg-1'),
      msg('msg-6', R3, MEMBER_ID, 'پیام پروژهٔ پاک‌شدنی', null),
      msg('msg-7', R3, MEMBER_ID, 'پاسخ پروژهٔ پاک‌شدنی', 'msg-6')
    ],
    files: [
      { id: 'file-1', project_id: P1, name: 'f1.txt', size: 10, mime: 'text/plain', storage: 'supabase', storage_path: P1 + '/f1.txt', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: now, attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} },
      { id: 'file-2', project_id: P1, name: 'f2.txt', size: 10, mime: 'text/plain', storage: 'supabase', storage_path: P1 + '/f2.txt', drive_id: null, uploaded_by: MEMBER2_ID, uploaded_at: now, attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} },
      { id: 'file-3', project_id: P2, name: 'f3.txt', size: 10, mime: 'text/plain', storage: 'supabase', storage_path: P2 + '/f3.txt', drive_id: null, uploaded_by: MEMBER_ID, uploaded_at: now, attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} }
    ],
    tasks: [
      { id: 'task-1', project_id: P1, title: 'کار من', description: null, assignee_id: MEMBER_ID, status: 'todo', due_at: null, created_by: MEMBER_ID, created_at: now, completed_at: null, visibility: 'project', custom_fields: {} },
      { id: 'task-2', project_id: P1, title: 'کار زهرا', description: null, assignee_id: MEMBER2_ID, status: 'todo', due_at: null, created_by: MEMBER2_ID, created_at: now, completed_at: null, visibility: 'project', custom_fields: {} },
      { id: 'task-3', project_id: P2, title: 'کار پروژهٔ پاک‌شدنی', description: null, assignee_id: MEMBER_ID, status: 'todo', due_at: null, created_by: MEMBER_ID, created_at: now, completed_at: null, visibility: 'project', custom_fields: {} }
    ],
    comments: [
      { id: 'cmt-1', doc_id: D2, author_id: MEMBER2_ID, body: 'نظر زهرا', anchor: null, resolved: false, parent_id: null, created_at: now, visibility: 'project' },
      { id: 'cmt-2', doc_id: D2, author_id: MEMBER_ID, body: 'نظر من', anchor: null, resolved: false, parent_id: null, created_at: now, visibility: 'project' }
    ],
    templates: [],
    versions: [
      { id: 'ver-1', doc_id: D2, version_no: 1, snapshot_ref: null, author_id: MEMBER_ID, note: null, created_at: now }
    ],
    reminders: [
      { id: 'rem-1', user_id: MEMBER_ID, target_type: 'task', target_id: 'task-1', text: 'یادآوری من', remind_at: null, done: false, created_at: now },
      { id: 'rem-2', user_id: MEMBER2_ID, target_type: 'task', target_id: 'task-1', text: 'یادآوری زهرا', remind_at: null, done: false, created_at: now },
      { id: 'rem-3', user_id: MEMBER_ID, target_type: 'task', target_id: 'task-3', text: 'یادآوری پروژهٔ پاک‌شدنی', remind_at: null, done: false, created_at: now }
    ],
    notifications: [
      { id: 'notif-1', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-1', read: false, created_at: now },
      { id: 'notif-2', user_id: MEMBER2_ID, type: 'mention', target_id: 'msg-1', read: false, created_at: now },
      { id: 'notif-3', user_id: MEMBER_ID, type: 'reminder', target_id: 'task-1', read: false, created_at: now },
      { id: 'notif-4', user_id: MEMBER_ID, type: 'reply', target_id: 'msg-4', read: false, created_at: now },
      { id: 'notif-5', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-6', read: false, created_at: now }
    ],
    integrations: []
  }
}

// FK references with NO ON DELETE CASCADE (schema-sclack-a.sql):
// child table + column -> parent table.
const FK_REFS = [
  { child: 'messages', col: 'parent_id', parent: 'messages' },
  { child: 'messages', col: 'room_id', parent: 'rooms' },
  { child: 'rooms', col: 'project_id', parent: 'projects' },
  { child: 'docs', col: 'project_id', parent: 'projects' },
  { child: 'comments', col: 'doc_id', parent: 'docs' },
  { child: 'comments', col: 'parent_id', parent: 'comments' },
  { child: 'files', col: 'project_id', parent: 'projects' },
  { child: 'tasks', col: 'project_id', parent: 'projects' },
  { child: 'versions', col: 'doc_id', parent: 'docs' }
]

// RLS delete owner column per table (w1-rls.sql, d2, d4). versions and
// members have NO delete policy at all — always 0 rows.
const DELETE_OWNER = {
  messages: 'author_id',
  projects: 'created_by',
  rooms: 'created_by',
  docs: 'created_by',
  comments: 'author_id',
  files: 'uploaded_by',
  tasks: 'created_by',
  notifications: 'user_id',
  reminders: 'user_id',
  templates: 'created_by',
  integrations: 'created_by'
}

function canDeleteRow(table, row, me) {
  if (table === 'versions' || table === 'members') return false
  if (table === 'rooms') {
    return (
      row.created_by === me ||
      (row.type === 'dm' && (row.member_a === me || row.member_b === me))
    )
  }
  const col = DELETE_OWNER[table]
  if (!col) return false
  return row[col] === me
}

function makeStub(db) {
  const calls = { storageRemoves: [], storageRemoveBlocked: [] }
  const store = new Map() // storage path -> { bytes, owner }
  store.set(P1 + '/f1.txt', { bytes: new TextEncoder().encode('f1'), owner: MEMBER_ID })
  store.set(P1 + '/f2.txt', { bytes: new TextEncoder().encode('f2'), owner: MEMBER2_ID })
  store.set(P2 + '/f3.txt', { bytes: new TextEncoder().encode('f3'), owner: MEMBER_ID })

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
      } else if (op === 'in') {
        // in.(a,b,c) — PostgREST list filter.
        if (!raw.startsWith('(') || !raw.endsWith(')')) return false
        const items = raw.slice(1, -1).split(',').filter(Boolean)
        if (!items.includes(String(v))) return false
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
      if (table === 'projects' && rows.some((r) => r.name === body.name)) {
        return json({ message: 'duplicate key value violates unique constraint "projects_name_key"', code: '23505' }, 400)
      }
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
      // FK first: a referenced row cannot be deleted at all (no
      // cascade) — Postgres fails the whole statement, deleting nothing.
      for (const row of matched) {
        for (const ref of FK_REFS) {
          if (ref.parent !== table) continue
          const hit = (db[ref.child] || []).find((c) => c[ref.col] === row.id)
          if (hit) {
            return json(
              {
                message:
                  'update or delete on table "' +
                  table +
                  '" violates foreign key constraint "' +
                  ref.child +
                  '_' +
                  ref.col +
                  '_fkey" on table "' +
                  ref.child +
                  '"',
                code: '23503'
              },
              409
            )
          }
        }
      }
      // RLS second: only rows the signed-in member may delete are
      // removed and returned; the rest silently match 0 rows.
      const allowed = matched.filter((r) => canDeleteRow(table, r, MEMBER_ID))
      for (const r of allowed) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      return json(allowed)
    }

    return json({ message: 'unsupported method ' + method }, 405)
  }

  async function handleStorage(url, method, bodyText) {
    const u = new URL(url)
    // storage-js remove(): DELETE /object/<bucket> with { prefixes }.
    if (method === 'DELETE' && u.pathname === '/storage/v1/object/' + FILES_BUCKET) {
      const parsed = bodyText ? JSON.parse(bodyText) : {}
      const prefixes = parsed.prefixes || []
      for (const p of prefixes) {
        const entry = store.get(p)
        if (!entry) continue
        // d4: storage delete is owner-only.
        if (entry.owner === MEMBER_ID) {
          store.delete(p)
          calls.storageRemoves.push(p)
        } else {
          calls.storageRemoveBlocked.push(p)
        }
      }
      return json([])
    }
    return json({ message: 'stub: unknown storage url ' + url }, 404)
  }

  async function stubFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {})
    const rawBody = init.body || (typeof input !== 'string' && input.body) || null
    const bodyText = typeof rawBody === 'string' ? rawBody : null
    if (url.startsWith(BASE_URL + '/rest/v1/')) {
      return handleRest(url, method, headers, bodyText)
    }
    if (url.startsWith(BASE_URL + '/storage/v1/')) {
      return handleStorage(url, method, bodyText)
    }
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { calls, stubFetch, db, store }
}

// ---------- fake session ----------
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
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no probe-ref URL'
    )
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no placeholder key'
    )
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
  // Per-window BroadcastChannel (probe only): the real BroadcastChannel
  // is shared across jsdom windows of the same origin — and gotrue uses
  // one (named by the storage key) to sync auth state across tabs, so
  // two probe windows signed in as different users would adopt each
  // other's session (correct multi-tab behaviour in a real browser,
  // where two profiles have separate channels — but the probe's two
  // windows are meant to be two PROFILES). This local bus delivers only
  // inside the same window, which keeps the two clients isolated while
  // preserving in-window behaviour (Yjs doc sync, gotrue's listeners).
  if (!w.__bcBus) w.__bcBus = new Map() // name -> Set of channels
  const bcBus = w.__bcBus
  w.BroadcastChannel = class LocalBroadcastChannel {
    constructor(name) {
      this.name = name
      this.onmessage = null
      this._listeners = new Set()
      if (!bcBus.has(name)) bcBus.set(name, new Set())
      bcBus.get(name).add(this)
    }
    postMessage(data) {
      for (const peer of [...(bcBus.get(this.name) || [])]) {
        if (peer === this) continue // a sender never receives its own post
        setTimeout(() => {
          if (peer.onmessage) peer.onmessage({ data })
          for (const fn of peer._listeners) fn({ data })
        }, 0)
      }
    }
    addEventListener(type, fn) {
      if (type === 'message') this._listeners.add(fn)
    }
    removeEventListener(type, fn) {
      if (type === 'message') this._listeners.delete(fn)
    }
    close() {
      bcBus.get(this.name)?.delete(this)
    }
  }
  if (!w.__probeSockets) w.__probeSockets = []
  const probeSockets = w.__probeSockets
  // Fake Phoenix/Realtime socket (probe only): speaks just enough of the
  // Phoenix wire protocol for supabase-js to join a channel and receive
  // postgres_changes. Join replies echo the client's own filters back
  // with server ids; deliverPostgresChange pushes a change the way the
  // real server would. The real server is the only bridge between two
  // browser profiles, so this is the honest sandbox stand-in for it.
  w.WebSocket = class FakeRealtimeSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.binaryType = 'arraybuffer'
      this.topics = new Set()
      this.postgresBindings = [] // [{id, event, schema, table, filter}]
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      probeSockets.push(this)
      setTimeout(() => {
        this.readyState = 1
        if (this.onopen) this.onopen()
      }, 0)
    }
    addEventListener() {}
    removeEventListener() {}
    send(data) {
      // Phoenix JSON messages are ARRAYS: [join_ref, ref, topic, event, payload].
      let arr
      try { arr = JSON.parse(data) } catch { return }
      if (!Array.isArray(arr)) return
      const [join_ref, ref, topic, event, payload] = arr
      if (event === 'phx_join' && topic) {
        this.topics.add(topic)
        const filters = payload?.config?.postgres_changes || []
        this.postgresBindings = filters.map((f, i) => ({ ...f, id: i + 1 }))
        this._reply(join_ref, ref, topic, {
          status: 'ok',
          response: { postgres_changes: this.postgresBindings }
        })
        return
      }
      // Heartbeat / presence / broadcast pushes: ack so the client
      // never times out waiting for a reply.
      if (ref) this._reply(join_ref, ref, topic, { status: 'ok', response: {} })
    }
    _reply(join_ref, ref, topic, payload) {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify([join_ref, ref, topic, 'phx_reply', payload]) })
        }
      }, 0)
    }
    deliver(msg) {
      // msg is a {topic, event, payload, ref?} object; encode it the
      // way the server would.
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify([null, msg.ref || null, msg.topic, msg.event, msg.payload]) })
      }
    }
    close() { this.readyState = 3 }
  }
  w.fetch = stub.stubFetch
  w.confirm = () => true
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    // S5 made the bundle code-split: Vite's dynamic-import helper uses
    // import.meta (module-only) and Rollup emits a trailing facade
    // export — both are parse errors in a classic script. Patch the
    // eval'd copy only; the real browser loads the bundle as a module.
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
function clickButton(w, label) {
  const btn = [...w.document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}
function chatInput(w) {
  return w.document.querySelector('input[placeholder*="پیام بنویسید"]')
}

// ---------- fake Realtime delivery ----------
// Find the fake socket that joined the room channel in window w.
function socketFor(w, roomId) {
  const topic = 'realtime:room-' + roomId
  return (w.__probeSockets || []).find((s) => s.topics.has(topic)) || null
}
async function waitForSocket(w, roomId, label) {
  return waitFor(w, () => {
    const s = socketFor(w, roomId)
    return s && s.postgresBindings.length > 0 ? s : null
  }, 10000, label || 'realtime socket joined for room ' + roomId)
}
// Push a postgres_changes event into window w the way the Realtime
// server would: the binding id is the one the join reply assigned to
// that event type (INSERT first, DELETE second in chat.js).
function deliverPostgresChange(w, roomId, { type, record, oldRecord }) {
  const s = socketFor(w, roomId)
  if (!s) throw new Error('no realtime socket for room ' + roomId)
  const binding = s.postgresBindings.find((b) => b.event === type)
  if (!binding) throw new Error('no ' + type + ' postgres binding on the channel')
  const columns = [
    { name: 'id', type: 'uuid' },
    { name: 'room_id', type: 'uuid' },
    { name: 'author_id', type: 'uuid' },
    { name: 'body', type: 'text' },
    { name: 'parent_id', type: 'uuid' },
    { name: 'mentions', type: 'jsonb' },
    { name: 'visibility', type: 'text' },
    { name: 'created_at', type: 'timestamptz' }
  ]
  s.deliver({
    topic: 'realtime:room-' + roomId,
    event: 'postgres_changes',
    payload: {
      data: {
        schema: 'public',
        table: 'messages',
        commit_timestamp: new Date().toISOString(),
        type,
        columns,
        record: record || null,
        old_record: oldRecord || null,
        errors: null
      },
      ids: [binding.id]
    },
    ref: 'probe-' + Date.now()
  })
}

// ---------- main ----------
async function main() {
  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('G1-delete UI strings in built bundle', ['حذف پیام', 'حذف پروژه', 'مطمئنید؟'].every((s) => js.includes(s)))

  const db = makeDb()
  const stub = makeStub(db)
  const msgIds = () => db.messages.map((m) => m.id)

  // ---- mount 1: chat — message delete ----
  const m1 = await mountApp({ html, js }, stub, '#/room/' + R1)
  const w1 = m1.w
  allErrors.push(...m1.errors)
  await waitFor(w1, () => w1.document.body.textContent.includes('پیام والد من'), 10000, 'parent message renders')
  await waitFor(w1, () => w1.document.body.textContent.includes('پاسخ زهرا به والد من'), 10000, 'all messages render')

  // The delete button lives inside the message bubble (rounded-2xl).
  const msgDeleteBtn = (w, body) => {
    const btns = [...w.document.querySelectorAll('button[title="حذف پیام"]')]
    for (const b of btns) {
      const bubble = b.closest('div[class*="rounded-2xl"]')
      if (bubble && norm(bubble.textContent).includes(body)) return b
    }
    return null
  }
  const msgVisible = (w, body) => norm(w.document.body.textContent).includes(body)

  check('msg-delete: delete button exists on my parent message', !!msgDeleteBtn(w1, 'پیام والد من'))
  check('msg-delete: delete button exists on my reply', !!msgDeleteBtn(w1, 'پاسخ من به والد'))
  check('msg-delete: delete button exists on my reply to Zahra', !!msgDeleteBtn(w1, 'پاسخ من به زهرا'))
  check('msg-delete: NO delete button on Zahra’s parent message', !msgDeleteBtn(w1, 'پیام والد زهرا'))
  check('msg-delete: NO delete button on Zahra’s reply', !msgDeleteBtn(w1, 'پاسخ زهرا به والد من'))

  // Delete my reply msg-2: first tap arms, second tap removes the row.
  let btn = msgDeleteBtn(w1, 'پاسخ من به والد')
  btn.click()
  await sleep(300)
  check('msg-delete: first tap only arms («مطمئنید؟») and deletes nothing',
    !!msgDeleteBtn(w1, 'پاسخ من به والد') &&
    msgDeleteBtn(w1, 'پاسخ من به والد').textContent.trim() === 'مطمئنید؟' &&
    db.messages.some((m) => m.id === 'msg-2'))
  msgDeleteBtn(w1, 'پاسخ من به والد').click()
  await waitFor(w1, () => !db.messages.some((m) => m.id === 'msg-2'), 10000, 'reply row removed from stub DB')
  check('msg-delete: second tap removes the reply row from the stub DB', !db.messages.some((m) => m.id === 'msg-2'), 'messages=' + msgIds().join(','))
  await sleep(400)
  check('msg-delete: the reply is gone from the chat list', !msgVisible(w1, 'پاسخ من به والد'))

  // Delete my reply to Zahra (msg-4): my own notification pointer at
  // it must go too; Zahra's pointer at msg-1 must stay.
  msgDeleteBtn(w1, 'پاسخ من به زهرا').click()
  await sleep(300)
  msgDeleteBtn(w1, 'پاسخ من به زهرا').click()
  await waitFor(w1, () => !db.messages.some((m) => m.id === 'msg-4'), 10000, 'second reply row removed')
  check('msg-delete: reply to Zahra’s message is removed', !db.messages.some((m) => m.id === 'msg-4'))
  check('msg-delete: my notification pointer at the deleted reply is gone', !db.notifications.some((n) => n.id === 'notif-4'), 'notifications=' + db.notifications.map((n) => n.id).join(','))
  check('msg-delete: Zahra’s pointer at msg-1 is untouched', db.notifications.some((n) => n.id === 'notif-2'))

  // Delete my parent msg-1: it still has Zahra's reply msg-5, so the
  // delete must refuse with a clear error and delete nothing.
  msgDeleteBtn(w1, 'پیام والد من').click()
  await sleep(300)
  check('msg-delete: parent first tap arms too', !!msgDeleteBtn(w1, 'پیام والد من') && msgDeleteBtn(w1, 'پیام والد من').textContent.trim() === 'مطمئنید؟')
  msgDeleteBtn(w1, 'پیام والد من').click()
  await waitFor(w1, () => w1.document.body.textContent.includes('پاسخ از عضو دیگر'), 10000, 'clear blocked-parent error shows')
  check('msg-delete: blocked parent delete shows a clear error, not silence', w1.document.body.textContent.includes('پاسخ از عضو دیگر'))
  check('msg-delete: the blocked parent is still in the DB', db.messages.some((m) => m.id === 'msg-1'))
  check('msg-delete: Zahra’s reply is still in the DB', db.messages.some((m) => m.id === 'msg-5'))
  check('msg-delete: the failed delete leaves the DB otherwise untouched',
    db.messages.length === 5 && db.notifications.length === 4,
    'messages=' + db.messages.length + ' notifications=' + db.notifications.length)
  check('msg-delete: after the failed delete the button is back to «حذف»',
    !!msgDeleteBtn(w1, 'پیام والد من') && msgDeleteBtn(w1, 'پیام والد من').textContent.trim() === 'حذف')

  // Finding 1 (live, 2026-11-22): the delete button did not show on a
  // freshly sent message until the room was reloaded. Send one through
  // the UI and assert the button is there immediately, no reload.
  setInput(w1, chatInput(w1), 'پیام تازهٔ پروب حذف')
  await sleep(200)
  clickButton(w1, 'فرستادن')
  await waitFor(w1, () => msgVisible(w1, 'پیام تازهٔ پروب حذف'), 10000, 'sent message renders')
  check('msg-delete: delete button exists on the message I JUST sent (no reload)',
    !!msgDeleteBtn(w1, 'پیام تازهٔ پروب حذف'))
  m1.dom.window.close()

  // ---- mount 2: projects page — project delete ----
  const m2 = await mountApp({ html, js }, stub, '#/projects')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.body.textContent.includes('پروژهٔ پاک‌شدنی'), 10000, 'project cards render')

  const projectCard = (w, name) => {
    const h = [...w.document.querySelectorAll('h3')].find((x) => x.textContent.trim() === name)
    return h ? h.closest('.card') : null
  }
  const projectDeleteBtn = (w, name) => {
    const card = projectCard(w, name)
    return card ? card.querySelector('button[title="حذف پروژه"]') : null
  }
  const projectOpenBtn = (w, name) => {
    const card = projectCard(w, name)
    return card ? card.querySelector('button.text-start') : null
  }

  check('proj-delete: delete button exists on my project', !!projectDeleteBtn(w2, 'پروژهٔ پروب حذف'))
  check('proj-delete: delete button exists on my deletable project', !!projectDeleteBtn(w2, 'پروژهٔ پاک‌شدنی'))
  check('proj-delete: NO delete button on Zahra’s project', !projectDeleteBtn(w2, 'پروژهٔ زهرا'))

  // P1 is blocked: versioned doc + other members' rows. The refusal
  // must name the blockers and delete nothing.
  const countsBefore = {
    projects: db.projects.length, rooms: db.rooms.length, messages: db.messages.length,
    docs: db.docs.length, files: db.files.length, tasks: db.tasks.length,
    comments: db.comments.length, versions: db.versions.length,
    notifications: db.notifications.length, reminders: db.reminders.length
  }
  projectDeleteBtn(w2, 'پروژهٔ پروب حذف').click()
  await sleep(300)
  check('proj-delete: first tap arms («مطمئنید؟ حذف پروژه») + warning shows',
    !!projectDeleteBtn(w2, 'پروژهٔ پروب حذف') &&
    projectDeleteBtn(w2, 'پروژهٔ پروب حذف').textContent.trim() === 'مطمئنید؟ حذف پروژه' &&
    norm(projectCard(w2, 'پروژهٔ پروب حذف').textContent).includes('برنمی‌گردند'))
  projectDeleteBtn(w2, 'پروژهٔ پروب حذف').click()
  await waitFor(w2, () => w2.document.body.textContent.includes('پروژه حذف نشد'), 10000, 'clear blocked-project error shows')
  const errText = norm(w2.document.body.textContent)
  check('proj-delete: refusal names the version blocker', errText.includes('نسخه'), errText.slice(0, 400))
  check('proj-delete: refusal names other members’ rows', errText.includes('زهرا'), errText.slice(0, 400))
  check('proj-delete: the refused delete deletes NOTHING',
    db.projects.length === countsBefore.projects && db.rooms.length === countsBefore.rooms &&
    db.messages.length === countsBefore.messages && db.docs.length === countsBefore.docs &&
    db.files.length === countsBefore.files && db.tasks.length === countsBefore.tasks &&
    db.comments.length === countsBefore.comments && db.versions.length === countsBefore.versions &&
    db.notifications.length === countsBefore.notifications && db.reminders.length === countsBefore.reminders,
    JSON.stringify({ projects: db.projects.length, messages: db.messages.length, files: db.files.length }))
  check('proj-delete: after the refused delete the button is back to «حذف پروژه»',
    !!projectDeleteBtn(w2, 'پروژهٔ پروب حذف') &&
    projectDeleteBtn(w2, 'پروژهٔ پروب حذف').textContent.trim() === 'حذف پروژه')

  // Make P2 the current project first (its card), then go to the
  // projects page and delete it: the current project must switch away
  // afterwards.
  projectOpenBtn(w2, 'پروژهٔ پاک‌شدنی').click()
  await waitFor(w2, () => w2.document.body.textContent.includes('پیام پروژهٔ پاک‌شدنی'), 10000, 'P2 room opens')
  w2.location.hash = '#/projects'
  w2.dispatchEvent(new w2.Event('hashchange'))
  await waitFor(w2, () => projectDeleteBtn(w2, 'پروژهٔ پاک‌شدنی'), 10000, 'back to projects, P2 card renders')
  projectDeleteBtn(w2, 'پروژهٔ پاک‌شدنی').click()
  await sleep(300)
  projectDeleteBtn(w2, 'پروژهٔ پاک‌شدنی').click()
  await waitFor(w2, () => !db.projects.some((p) => p.id === P2), 10000, 'P2 row removed from stub DB')
  check('proj-delete: project row is gone', !db.projects.some((p) => p.id === P2))
  check('proj-delete: its room is gone', !db.rooms.some((r) => r.id === R3))
  check('proj-delete: its messages are gone', !db.messages.some((m) => m.id === 'msg-6' || m.id === 'msg-7'), 'messages=' + msgIds().join(','))
  check('proj-delete: its doc is gone', !db.docs.some((d) => d.id === D3))
  check('proj-delete: its file row is gone', !db.files.some((f) => f.id === 'file-3'))
  check('proj-delete: its storage object was removed', stub.calls.storageRemoves.includes(P2 + '/f3.txt') && !stub.store.has(P2 + '/f3.txt'), JSON.stringify(stub.calls.storageRemoves))
  check('proj-delete: P1 storage objects were NOT touched', stub.store.has(P1 + '/f1.txt') && stub.store.has(P1 + '/f2.txt'))
  check('proj-delete: its task is gone', !db.tasks.some((t) => t.id === 'task-3'))
  check('proj-delete: my notification pointer at its message is gone', !db.notifications.some((n) => n.id === 'notif-5'))
  check('proj-delete: my reminder at its task is gone', !db.reminders.some((r) => r.id === 'rem-3'))
  check('proj-delete: P1 and its children are untouched',
    db.projects.some((p) => p.id === P1) && db.rooms.some((r) => r.id === R1) &&
    db.messages.some((m) => m.id === 'msg-1') && db.docs.some((d) => d.id === D1) &&
    db.files.some((f) => f.id === 'file-1') && db.tasks.some((t) => t.id === 'task-1') &&
    db.versions.some((v) => v.id === 'ver-1'),
    JSON.stringify({ projects: db.projects.length, rooms: db.rooms.length, messages: db.messages.length }))
  check('proj-delete: Zahra’s project is untouched', db.projects.some((p) => p.id === P3))
  await sleep(500)
  check('proj-delete: the deleted project card is gone from the projects page', !projectCard(w2, 'پروژهٔ پاک‌شدنی'))
  check('proj-delete: the other project card is still there', !!projectCard(w2, 'پروژهٔ پروب حذف'))
  check('proj-delete: current project switched away from the deleted one',
    !norm(w2.document.body.textContent).includes('اتاق دوم') && norm(w2.document.body.textContent).includes('گفت‌وگو'),
    norm(w2.document.body.textContent).slice(0, 300))
  m2.dom.window.close()

  // ---- mount 3: doc — doc delete is BLOCKED by design ----
  // versions.doc_id has no ON DELETE CASCADE and versions has NO delete
  // policy (immutable, w1), so a doc with versions can never be deleted
  // — and a doc delete control must not exist until that is decided.
  const m3 = await mountApp({ html, js }, stub, '#/doc/' + D1)
  const w3 = m3.w
  allErrors.push(...m3.errors)
  await waitFor(w3, () => w3.document.body.textContent.includes('سند یک'), 10000, 'doc page renders')
  check('doc-delete: NO «حذف سند» button exists on the doc page',
    ![...w3.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'حذف سند' || b.getAttribute('title') === 'حذف سند'))
  m3.dom.window.close()

  // ---- mount 4: two clients — live delete propagation (finding 2) ----
  // Client A (yasin) and client B (Zahra) share one stub DB and one
  // room. A deletes through the UI; the server broadcast is faked by
  // delivering the DELETE event to B's socket — the real server is the
  // only bridge between two browser profiles, so this is the honest
  // sandbox stand-in for it.
  const db4 = makeDb()
  const stub4 = makeStub(db4)
  const mA = await mountApp({ html, js }, stub4, '#/room/' + R1, fakeSession())
  const wA = mA.w
  allErrors.push(...mA.errors)
  const mB = await mountApp({ html, js }, stub4, '#/room/' + R1, fakeSession(ZAHRA_USER_ID, 'zahra@probe.test'))
  const wB = mB.w
  allErrors.push(...mB.errors)
  await waitFor(wA, () => wA.document.body.textContent.includes('پیام والد من'), 10000, 'client A renders the room')
  await waitFor(wB, () => wB.document.body.textContent.includes('پیام والد من'), 10000, 'client B renders the room')
  await waitForSocket(wB, R1, 'client B realtime join')
  check('live-delete: client B sees the parent message', msgVisible(wB, 'پیام والد من'))
  check('live-delete: client B sees my reply', msgVisible(wB, 'پاسخ من به والد'))
  check('live-delete: client B has the DELETE binding subscribed',
    (socketFor(wB, R1)?.postgresBindings || []).some((b) => b.event === 'DELETE'))

  // The two windows must stay two different users: gotrue syncs auth
  // across tabs via BroadcastChannel, so a shared channel would swap
  // their sessions (see the per-window bus in mountApp).
  const signedInName = (w) => norm(w.document.body.textContent).match(/([^\s]+) \(شما\)/)?.[1] || null
  check('live-delete: client A is signed in as yasin', signedInName(wA) === 'yasin')
  check('live-delete: client B is signed in as Zahra', signedInName(wB) === 'زهرا')
  // A deletes its own reply msg-2 through the UI (two taps).
  await waitFor(wA, () => msgDeleteBtn(wA, 'پاسخ من به والد'), 10000, 'A’s reply has a delete button')
  msgDeleteBtn(wA, 'پاسخ من به والد').click()
  await sleep(300)
  await waitFor(wA, () => {
    const b = msgDeleteBtn(wA, 'پاسخ من به والد')
    return b && b.textContent.trim() === 'مطمئنید؟' ? b : null
  }, 10000, 'A’s delete button arms')
  msgDeleteBtn(wA, 'پاسخ من به والد').click()
  await waitFor(wA, () => !db4.messages.some((m) => m.id === 'msg-2'), 10000, 'A’s delete removes the row from the stub DB')
  check('live-delete: A’s delete removes the row', !db4.messages.some((m) => m.id === 'msg-2'))
  await sleep(400)
  check('live-delete: A’s own list loses the reply', !msgVisible(wA, 'پاسخ من به والد'))
  check('live-delete: before the event, B still shows the reply', msgVisible(wB, 'پاسخ من به والد'))
  // The server broadcasts the DELETE — deliver it to B.
  deliverPostgresChange(wB, R1, { type: 'DELETE', oldRecord: { id: 'msg-2' } })
  await waitFor(wB, () => !msgVisible(wB, 'پاسخ من به والد'), 10000, 'B’s list loses the deleted reply')
  check('live-delete: the DELETE event removes the reply from B’s list', !msgVisible(wB, 'پاسخ من به والد'))
  check('live-delete: the parent is still in B’s list', msgVisible(wB, 'پیام والد من'))
  // Live arrival still works: an INSERT event adds a message to B’s list.
  deliverPostgresChange(wB, R1, {
    type: 'INSERT',
    record: {
      id: 'msg-live-1', room_id: R1, author_id: MEMBER_ID, body: 'پیام زندهٔ تازه',
      parent_id: null, mentions: '[]', visibility: 'project',
      created_at: new Date().toISOString()
    }
  })
  await waitFor(wB, () => msgVisible(wB, 'پیام زندهٔ تازه'), 10000, 'B’s list gains the live message')
  check('live-delete: the INSERT event adds the message to B’s list', msgVisible(wB, 'پیام زندهٔ تازه'))
  check('live-delete: the INSERT delivered only to B does NOT appear in A’s list',
    !msgVisible(wA, 'پیام زندهٔ تازه'))
  // And its DELETE removes it again.
  deliverPostgresChange(wB, R1, { type: 'DELETE', oldRecord: { id: 'msg-live-1' } })
  await waitFor(wB, () => !msgVisible(wB, 'پیام زندهٔ تازه'), 10000, 'B’s list loses the live message again')
  check('live-delete: the DELETE event removes the live message from B’s list', !msgVisible(wB, 'پیام زندهٔ تازه'))
  // Unknown id: no crash, no change.
  deliverPostgresChange(wB, R1, { type: 'DELETE', oldRecord: { id: 'msg-zzz' } })
  await sleep(300)
  check('live-delete: a DELETE for an unknown id changes nothing', msgVisible(wB, 'پیام والد من'))
  // Another room’s message: the handler only touches ids in this room’s list.
  deliverPostgresChange(wB, R1, { type: 'DELETE', oldRecord: { id: 'msg-6' } })
  await sleep(300)
  check('live-delete: a DELETE for another room’s message changes nothing',
    msgVisible(wB, 'پیام والد من') && !msgVisible(wB, 'پیام پروژهٔ پاک‌شدنی'))
  mA.dom.window.close()
  mB.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL G1-DELETE PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('G1-DELETE PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
