// Edge Function 'ai-assistant' — fixture-based probes (Node, no network,
// no live key, no live Supabase). The handler is imported directly;
// fetch and env are stubbed per case.
//
// Layers:
//  1. STATIC: the model name appears exactly once in the function source
//     (and nowhere in src/); the secret name is GEMINI_API_KEY; no
//     hardcoded key (no 'AIza'); the R5 guard prefix is in the request.
//  2. HANDLER: happy paths for all 4 AI actions (sources restricted to
//     the sent context ids, unknown sources dropped, proposed_action
//     stripped), then every failure mode: Gemini 429 primary → one
//     fallback retry (fallback success → model=fallback; both 429 →
//     rate_limited; primary success → fallback never called), Gemini 401
//     → model_error, missing secret → 503 not_configured,
//     Gemini 401 → model_error, missing secret → 503 not_configured,
//     missing/invalid JWT → 401, non-member → 403, over the daily cap
//     → 429 daily_cap, cap skipped when the table is missing, malformed
//     model JSON → model_error, unknown action → 400, OPTIONS → 204.
import { readFileSync } from 'node:fs'
import {
  handleAssistantRequest,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
  GEMINI_SECRET_NAME,
  DAILY_USER_CAP,
  AI_ACTIONS
} from '../supabase/functions/ai-assistant/handler.js'

const SUPABASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

// ---------- 1. STATIC ----------

const handlerSrc = readFileSync(
  new URL('../supabase/functions/ai-assistant/handler.js', import.meta.url).pathname,
  'utf8'
)
const indexSrc = readFileSync(
  new URL('../supabase/functions/ai-assistant/index.ts', import.meta.url).pathname,
  'utf8'
)
const functionSrc = handlerSrc + '\n' + indexSrc

check(
  'function: primary model is gemini-3.8-flash, fallback is gemini-3.5-flash-lite',
  MODEL_PRIMARY === 'gemini-3.8-flash' && MODEL_FALLBACK === 'gemini-3.5-flash-lite'
)
// Model names are counted in the code (line comments stripped — the
// header comment documents the names, the consts define them once).
const handlerCode = handlerSrc.replace(/^\/\/.*$/gm, '')
check(
  'function: each model name appears exactly once in the function code',
  (handlerCode.match(/gemini-3\.8-flash/g) || []).length === 1 &&
    (handlerCode.match(/gemini-3\.5-flash-lite/g) || []).length === 1,
  JSON.stringify({
    p: (handlerCode.match(/gemini-3\.8-flash/g) || []).length,
    f: (handlerCode.match(/gemini-3\.5-flash-lite/g) || []).length
  })
)
check('function: secret name is GEMINI_API_KEY', GEMINI_SECRET_NAME === 'GEMINI_API_KEY')
check(
  'function: the handler reads the key from env, never hardcoded',
  handlerSrc.includes("env.get(GEMINI_SECRET_NAME)") && !/AIza[0-9A-Za-z_-]{10,}/.test(functionSrc)
)
check(
  'function: no other model name in the function code',
  JSON.stringify(
    [...new Set(handlerCode.match(/gemini-[0-9.]+-flash(-lite)?/g) || [])].sort()
  ) === JSON.stringify(['gemini-3.5-flash-lite', 'gemini-3.8-flash']) &&
    !/gpt-|claude/i.test(functionSrc),
  'a stale model name is in the function source'
)
check(
  'function: the 4 AI actions are exactly the registry AI actions',
  JSON.stringify([...AI_ACTIONS].sort()) ===
    JSON.stringify(['ask-workspace', 'open-chat', 'summarize-doc', 'summarize-room'])
)
check('function: R5 guard prefix is present', handlerSrc.includes('قانونِ داده'))
check('function: daily cap is 40 per user', DAILY_USER_CAP === 40)

// The model name must not leak into the frontend bundle at all.
import { readdirSync } from 'node:fs'
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(dir + '/' + e.name, out)
    else if (/\.(js|svelte)$/.test(e.name)) out.push(dir + '/' + e.name)
  }
  return out
}
const srcFiles = walk(new URL('../src', import.meta.url).pathname)
const leaked = srcFiles.filter((f) => /gemini|GEMINI_API_KEY|generativelanguage/.test(readFileSync(f, 'utf8')))
check('function: no model name / key / Gemini URL anywhere in src/', leaked.length === 0, JSON.stringify(leaked))

// ---------- 2. HANDLER (stubbed fetch + env) ----------

function makeEnv(withKey = true) {
  const m = new Map([
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', 'anon-probe-key']
  ])
  if (withKey) m.set('GEMINI_API_KEY', 'probe-key-not-real')
  return m
}

function geminiOkText(payload) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
  })
}

function makeStub(mode = {}) {
  const calls = { geminiBodies: [], geminiModels: [] }
  const capRows = mode.capRows ?? []
  async function stubFetch(url, init = {}) {
    if (url.startsWith(SUPABASE_URL + '/auth/v1/user')) {
      const token = (init.headers?.Authorization || '').replace(/^Bearer\s+/, '')
      if (token === 'good-token') return json({ id: USER_ID })
      return json({ message: 'invalid token' }, 401)
    }
    if (url.startsWith(SUPABASE_URL + '/rest/v1/members')) {
      if (mode.nonMember) return json([])
      return json([{ id: MEMBER_ID }])
    }
    if (url.startsWith(SUPABASE_URL + '/rest/v1/assistant_messages')) {
      if (mode.tableMissing) return json({ code: 'PGRST205', message: 'table not found' }, 404)
      return json(capRows)
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      // Which model this call went to, from the URL — recorded so the
      // fallback cases can prove the retry went to the right model.
      const modelMatch = url.match(/models\/(gemini-[^:?]+)/)
      const model = modelMatch ? modelMatch[1] : 'unknown'
      calls.geminiModels.push(model)
      // Per-model behaviour wins; otherwise the single mode.gemini
      // string applies to every model (existing cases unchanged).
      const behavior = mode.geminiByModel?.[model] ?? mode.gemini
      if (behavior === 'rate-limited') return json({ error: { message: 'quota' } }, 429)
      if (behavior === 'bad-key') return json({ error: { message: 'bad key' } }, 401)
      if (behavior === 'malformed') {
        return json({ candidates: [{ content: { parts: [{ text: '{oops' }] } }] })
      }
      const bodyText = typeof init.body === 'string' ? init.body : ''
      calls.geminiBodies.push(bodyText)
      return new Response(geminiOkText(mode.geminiPayload || { answer: 'x', sources: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return json({ error: 'stub: unknown url ' + url }, 404)
  }
  return { stubFetch, calls }
}

function makeReq(body, token = 'good-token') {
  return {
    method: 'POST',
    headers: new Headers({
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    }),
    text: async () => JSON.stringify(body)
  }
}

async function run(body, stub, env = makeEnv()) {
  const res = await handleAssistantRequest(makeReq(body), {
    env,
    fetchFn: stub.stubFetch
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body (204/405) */
  }
  return { status: res.status, data, headers: res.headers }
}

const ROOM_BODY = {
  action: 'summarize-room',
  system: 'خلاصه کن.',
  user: 'پیام‌ها: [msg-1] باید گزارش را آماده کنیم',
  maxTokens: 400,
  sourceIds: ['msg-1', 'msg-2'],
  paragraphCount: 0
}

// Happy path: one point with a valid source, one with an unknown source.
{
  const stub = makeStub({
    geminiPayload: {
      points: [
        { text: 'گزارش ماهانه آماده شود', source_ids: ['msg-1'] },
        { text: 'نکتهٔ ساخته‌شده', source_ids: ['msg-unknown'] },
        { text: 'بدون منبع', source_ids: [] }
      ]
    }
  })
  const r = await run(ROOM_BODY, stub)
  check('handler summarize-room: 200 with the valid point only', r.status === 200 && r.data.points.length === 1 && r.data.points[0].text === 'گزارش ماهانه آماده شود' && r.data.found === true, JSON.stringify(r.data))
  check('handler summarize-room: unknown source ids are dropped, not shown', !JSON.stringify(r.data).includes('msg-unknown'))
  check('handler: CORS headers on success', r.headers.get('Access-Control-Allow-Origin') === '*')
  const sent = JSON.parse(stub.calls.geminiBodies[0])
  const sentText = sent.contents[0].parts[0].text
  check('handler: R5 guard prefix is prepended to the system prompt', sentText.startsWith('قانونِ داده'))
  check('handler: the request is JSON mode, temperature 0.2', sent.generationConfig.responseMimeType === 'application/json' && sent.generationConfig.temperature === 0.2)
  check('handler: the system prompt travels unchanged', sentText.includes('خلاصه کن.'))
}

// summarize-doc: paragraph numbers are validated against the count.
{
  const stub = makeStub({
    geminiPayload: {
      points: [
        { text: 'نکتهٔ اول', paragraph: 2 },
        { text: 'پاراگراف ناموجود', paragraph: 99 }
      ]
    }
  })
  const r = await run(
    { action: 'summarize-doc', system: 'خلاصه کن.', user: 'متن سند', maxTokens: 400, sourceIds: [], paragraphCount: 3 },
    stub
  )
  check('handler summarize-doc: out-of-range paragraph is dropped', r.status === 200 && r.data.points.length === 1 && r.data.points[0].paragraph === 2, JSON.stringify(r.data))
}

// ask-workspace: unknown sources dropped, proposed_action stripped.
{
  const stub = makeStub({
    geminiPayload: {
      answer: 'جلسهٔ هفتهٔ پیش برگزار شد.',
      sources: [
        { table: 'message', id: 'msg-1' },
        { table: 'message', id: 'msg-unknown' }
      ],
      proposed_action: { action_id: 'create-task', payload: { title: 'x' } }
    }
  })
  const r = await run(
    {
      action: 'ask-workspace',
      system: 'جواب بده.',
      user: 'سؤال: جلسه چه شد؟',
      maxTokens: 400,
      sourceIds: [{ table: 'message', id: 'msg-1', title: 't', place: 'p', link: '#/' }],
      paragraphCount: 0
    },
    stub
  )
  check('handler ask-workspace: answer + only the known source survive', r.status === 200 && r.data.answer === 'جلسهٔ هفتهٔ پیش برگزار شد.' && r.data.sources.length === 1 && r.data.sources[0].id === 'msg-1', JSON.stringify(r.data))
  check('handler ask-workspace: proposed_action is stripped (package B executes nothing)', !('proposed_action' in r.data))
}

// open-chat: empty answer → found:false (client falls back).
{
  const stub = makeStub({ geminiPayload: { answer: '   ', sources: [] } })
  const r = await run(
    { action: 'open-chat', system: 'جواب بده.', user: 'سلام', maxTokens: 400, sourceIds: [], paragraphCount: 0 },
    stub
  )
  check('handler open-chat: empty answer → found:false', r.status === 200 && r.data.found === false, JSON.stringify(r.data))
}

// Gemini 429 on both models → 429 rate_limited (client falls back to extractive).
// This exercises the §6.4 retry: primary 429, then exactly one fallback call.
{
  const stub = makeStub({ gemini: 'rate-limited' })
  const r = await run(ROOM_BODY, stub)
  check('handler: Gemini 429 → 429 rate_limited', r.status === 429 && r.data.error === 'rate_limited', JSON.stringify(r.data))
  check(
    'handler: both 429 → primary tried once, fallback once',
    JSON.stringify(stub.calls.geminiModels) ===
      JSON.stringify(['gemini-3.8-flash', 'gemini-3.5-flash-lite']),
    JSON.stringify(stub.calls.geminiModels)
  )
}

// §6.4 fallback: primary 429 → exactly one retry with the fallback,
// and the answer is the fallback's (model: 'fallback').
{
  const stub = makeStub({
    geminiByModel: { 'gemini-3.8-flash': 'rate-limited' },
    geminiPayload: { points: [{ text: 'x', source_ids: ['msg-1'] }] }
  })
  const r = await run(ROOM_BODY, stub)
  check(
    'handler: primary 429 → fallback success, model=fallback',
    r.status === 200 && r.data.model === 'fallback' && r.data.found === true,
    JSON.stringify(r.data)
  )
  check(
    'handler: fallback called exactly once after primary 429',
    JSON.stringify(stub.calls.geminiModels) ===
      JSON.stringify(['gemini-3.8-flash', 'gemini-3.5-flash-lite']),
    JSON.stringify(stub.calls.geminiModels)
  )
}

// Primary success → fallback never called, model=primary.
{
  const stub = makeStub({
    geminiPayload: { points: [{ text: 'x', source_ids: ['msg-1'] }] }
  })
  const r = await run(ROOM_BODY, stub)
  check(
    'handler: primary success → model=primary',
    r.status === 200 && r.data.model === 'primary' && r.data.found === true,
    JSON.stringify(r.data)
  )
  check(
    'handler: primary success → fallback never called',
    JSON.stringify(stub.calls.geminiModels) === JSON.stringify(['gemini-3.8-flash']),
    JSON.stringify(stub.calls.geminiModels)
  )
}

// Gemini 401 (bad key) → 502 model_error.
{
  const stub = makeStub({ gemini: 'bad-key' })
  const r = await run(ROOM_BODY, stub)
  check('handler: Gemini 401 → 502 model_error', r.status === 502 && r.data.error === 'model_error', JSON.stringify(r.data))
}

// Malformed model JSON → 502 model_error.
{
  const stub = makeStub({ gemini: 'malformed' })
  const r = await run(ROOM_BODY, stub)
  check('handler: malformed model JSON → 502 model_error', r.status === 502 && r.data.error === 'model_error', JSON.stringify(r.data))
}

// Missing secret → 503 not_configured (client latches to extractive).
{
  const stub = makeStub({})
  const r = await run(ROOM_BODY, stub, makeEnv(false))
  check('handler: missing GEMINI_API_KEY → 503 not_configured', r.status === 503 && r.data.error === 'not_configured', JSON.stringify(r.data))
  check('handler: missing secret → no Gemini call is made', stub.calls.geminiBodies.length === 0)
}

// Missing JWT → 401; bad JWT → 401.
{
  const stub = makeStub({})
  const noAuth = await handleAssistantRequest(
    { method: 'POST', headers: new Headers({ 'Content-Type': 'application/json' }), text: async () => JSON.stringify(ROOM_BODY) },
    { env: makeEnv(), fetchFn: stub.stubFetch }
  )
  check('handler: missing JWT → 401', noAuth.status === 401)
  const badRes = await handleAssistantRequest(makeReq(ROOM_BODY, 'bad-token'), {
    env: makeEnv(),
    fetchFn: stub.stubFetch
  })
  check('handler: invalid JWT → 401', badRes.status === 401)
}

// Non-member → 403.
{
  const stub = makeStub({ nonMember: true })
  const r = await run(ROOM_BODY, stub)
  check('handler: non-member → 403 not_member', r.status === 403 && r.data.error === 'not_member', JSON.stringify(r.data))
}

// Over the daily cap → 429 daily_cap.
{
  const stub = makeStub({
    capRows: Array.from({ length: 41 }, (_, i) => ({ id: 'am-' + i }))
  })
  const r = await run(ROOM_BODY, stub)
  check('handler: 41 user rows today → 429 daily_cap', r.status === 429 && r.data.error === 'daily_cap', JSON.stringify(r.data))
  check('handler: over cap → no Gemini call is made', stub.calls.geminiBodies.length === 0)
}

// Under the cap → the call goes through.
{
  const stub = makeStub({
    geminiPayload: { points: [{ text: 'x', source_ids: ['msg-1'] }] },
    capRows: Array.from({ length: 39 }, (_, i) => ({ id: 'am-' + i }))
  })
  const r = await run(ROOM_BODY, stub)
  check('handler: 39 user rows today → the call goes through', r.status === 200, JSON.stringify(r.data))
}

// Table missing (migration not applied) → the cap is skipped, call goes through.
{
  const stub = makeStub({
    geminiPayload: { points: [{ text: 'x', source_ids: ['msg-1'] }] },
    tableMissing: true
  })
  const r = await run(ROOM_BODY, stub)
  check('handler: assistant_messages missing → cap skipped, call goes through', r.status === 200, JSON.stringify(r.data))
}

// Unknown action → 400; bad body → 400; GET → 405; OPTIONS → 204.
{
  const stub = makeStub({})
  const bad1 = await run({ action: 'delete-everything', system: 'x', user: 'y' }, stub)
  check('handler: unknown action → 400', bad1.status === 400 && bad1.data.error === 'unknown_action', JSON.stringify(bad1.data))
  const bad2 = await run({ action: 'summarize-room', system: 'x', user: '' }, stub)
  check('handler: empty user text → 400', bad2.status === 400, JSON.stringify(bad2.data))
  const getRes = await handleAssistantRequest(
    { method: 'GET', headers: new Headers(), text: async () => '' },
    { env: makeEnv(), fetchFn: stub.stubFetch }
  )
  check('handler: GET → 405', getRes.status === 405)
  const optRes = await handleAssistantRequest(
    { method: 'OPTIONS', headers: new Headers(), text: async () => '' },
    { env: makeEnv(), fetchFn: stub.stubFetch }
  )
  check('handler: OPTIONS → 204 with CORS', optRes.status === 204 && optRes.headers.get('Access-Control-Allow-Origin') === '*')
}

console.log(failures === 0 ? 'ALL AI-FUNCTION PROBES PASSED' : `${failures} PROBE(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
