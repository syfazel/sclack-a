// Debug: mount the app, go to the doc, click the file delete button.
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
  messages: [],
  files: [{ id: '77777777-7777-7777-7777-777777777777', project_id: PROJECT_ID, name: 'گزارش پروب.pdf', size: 1234, mime: 'application/pdf', storage: 'supabase', storage_path: PROJECT_ID + '/f.pdf', uploaded_by: MEMBER_ID, uploaded_at: new Date().toISOString(), attached_to_type: null, attached_to_id: null, visibility: 'project', custom_fields: {} }],
  tasks: [], comments: [], templates: [], versions: [], reminders: [], notifications: [], integrations: []
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

const fileSection = await waitFor(() => [...w.document.querySelectorAll('section')].find((s) => s.querySelector('h3')?.textContent.includes('فایل‌ها') && s.textContent.includes('گزارش پروب.pdf')), 'file section')
console.log('file section found. li count:', fileSection.querySelectorAll('li').length)
const row = [...fileSection.querySelectorAll('li')].find((li) => li.textContent.includes('گزارش پروب.pdf'))
console.log('row html:', row.innerHTML.slice(0, 600))
const buttons = [...row.querySelectorAll('button')]
console.log('buttons in row:', buttons.map((b) => JSON.stringify(b.textContent.trim()) + ' disabled=' + b.disabled))
const delBtn = buttons.find((b) => b.textContent.trim() === 'حذف')
console.log('delBtn found:', !!delBtn, 'isConnected:', delBtn?.isConnected)
delBtn.click()
await sleep(500)
console.log('after 1st click, delBtn text:', JSON.stringify(delBtn.textContent.trim()), 'isConnected:', delBtn.isConnected)
console.log('any مطمئنید؟ button in doc:', [...w.document.querySelectorAll('button')].some((b) => b.textContent.includes('مطمئنید؟')))
console.log('row html after click:', row.innerHTML.slice(0, 600))
console.log('errors:', errors)
w.close()
process.exit(0)
