// Debug: hash navigation doc -> tasks in the mounted app.
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const db = {
  members: [],
  projects: [{ id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب', created_by: MEMBER_ID, created_at: new Date().toISOString(), visibility: 'team', archived: false, custom_fields: {} }],
  rooms: [{ id: '44444444-4444-4444-4444-444444444444', project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', created_by: MEMBER_ID, created_at: new Date().toISOString(), visibility: 'project', custom_fields: {} }],
  docs: [{ id: DOC_ID, project_id: PROJECT_ID, title: 'سند پروب', yjs_doc_id: 'doc-probe-1', created_by: MEMBER_ID, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1, visibility: 'project', custom_fields: {} }],
  messages: [], files: [], tasks: [], comments: [], templates: [], versions: [], reminders: [], notifications: [], integrations: []
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
async function stubFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers || {})
  const u = new URL(url)
  if (url.startsWith(BASE_URL + '/rest/v1/')) {
    const table = u.pathname.split('/').pop()
    const params = u.searchParams
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object+json')
    const rows = db[table] || []
    if (method === 'GET') {
      let out = rows.filter((r) => {
        for (const [k, v] of params.entries()) {
          if (['select', 'order', 'limit', 'offset', 'or'].includes(k)) continue
          const m = v.match(/^([a-z_]+)\.(.*)$/)
          if (!m) continue
          if (m[1] === 'eq' && String(r[k]) !== m[2]) return false
        }
        return true
      })
      if (single) return out.length === 1 ? json(out[0]) : json({ message: 'no rows' }, 406)
      return json(out)
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body || '{}')
      const row = { ...body }
      if (!row.id) row.id = table === 'members' ? MEMBER_ID : 'stub-' + Math.random().toString(36).slice(2, 6)
      rows.push(row)
      return single ? json(row) : json([row])
    }
    if (method === 'PATCH') return new Response(null, { status: 204 })
    if (method === 'DELETE') return json([])
  }
  if (url.startsWith(BASE_URL + '/storage/v1/')) return json({})
  if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
  return json({ error: 'unknown ' + url }, 404)
}
function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url({ sub: USER_ID, email: 'probe@example.com', exp: 9999999999 }) + '.sig'
const session = { access_token: jwt, refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: USER_ID, email: 'probe@example.com' } }

const distDir = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(distDir + 'index.html', 'utf8')
const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
const js = readFileSync(distDir + 'assets/' + jsFile, 'utf8')
const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
vc.on('error', (m) => errors.push('console.error: ' + String(m)))
const dom = new JSDOM(html, { url: 'http://localhost/sclack-a/#/doc/' + DOC_ID, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
const w = dom.window
if (!w.fetch) w.fetch = fetch
if (!w.Headers) w.Headers = Headers
if (!w.Request) w.Request = Request
if (!w.Response) w.Response = Response
if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
if (!w.WebSocket) w.WebSocket = class { constructor() { this.readyState = 0 } addEventListener() {} removeEventListener() {} send() {} close() {} }
w.fetch = stubFetch
w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
w.eval(js)

async function waitFor(fn, label, ms = 10000) {
  const dl = Date.now() + ms
  while (Date.now() < dl) { try { const v = fn(); if (v) return v } catch {} await sleep(150) }
  throw new Error('timeout: ' + label)
}
const mainText = () => (w.document.querySelector('main')?.textContent || '').replace(/\s+/g, ' ').slice(0, 120)

await waitFor(() => w.document.querySelector('textarea[placeholder="اینجا بنویسید…"]'), 'doc textarea')
console.log('1. on doc route. main:', mainText())
console.log('   hash:', w.location.hash)

// Intermediate navigations, mirroring the full probe: doc -> home -> doc -> tasks
w.location.hash = '#/'
w.dispatchEvent(new w.Event('hashchange'))
await sleep(600)
console.log('1b. after nav to home. hash:', w.location.hash, 'main:', mainText())
w.location.hash = '#/doc/' + DOC_ID
w.dispatchEvent(new w.Event('hashchange'))
await sleep(600)
console.log('1c. after nav back to doc. hash:', w.location.hash, 'main:', mainText())

// Attempt A: set hash + synthetic hashchange (same as probe)
w.location.hash = '#/tasks'
w.dispatchEvent(new w.Event('hashchange'))
await sleep(1000)
console.log('2. after set hash + synthetic dispatch. hash:', w.location.hash, 'main:', mainText())

// Attempt B: click the sidebar #/tasks link
const link = w.document.querySelector('a[href="#/tasks"]')
console.log('3. sidebar tasks link exists:', !!link)
if (link) {
  link.click()
  await sleep(1000)
  console.log('   after link click. hash:', w.location.hash, 'main:', mainText())
}
console.log('errors:', errors)
w.close()
process.exit(0)
