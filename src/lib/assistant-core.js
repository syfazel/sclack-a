// «دستیار میوز» — هستهٔ دستیار (پکیج A/B + جارویس ای آی فاز ۱).
//
// یک `dispatch` برای همهٔ اکشن‌ها: اجرا → اعتبارسنجیِ شکلی → خروجی.
// بازیابی و پرامپت سیستم سمت سرور است (فاز ۱): AssistantView دیگر
// کانتکست نمی‌سازد؛ dispatch فقط { action, params, history } می‌فرستد
// و تابع خودش از Supabase می‌خواند (با JWT کاربر) و منبع‌ها را برابر
// خوانده‌های خودش اعتبارسنجی می‌کند (R1 سرور-محور). اعتبارسنجی اینجا
// فقط شکلی است (آرایه/رشته بودن) — مالک منبع‌ها تابع است.
// AssistantView دیگر ۳۰ تابع جدا صدا نمی‌زند؛ فقط dispatch می‌کند.
// موتور اجرا برای هر اکشن از رجیستری می‌آید (lib/assistant-prompts.js):
//  * اکشن‌های ai:true — اول Edge Function 'ai-assistant' را صدا می‌زنند؛
//    اگر تابع در دسترس نبود (دیپلوی نشده / کلید وصل نشده / خطا)،
//    همان تابع استخراجی امروز اجرا می‌شود (R7) — دستیار هرگز خالی
//    نمی‌ماند و ورودی هرگز وانمودی نمی‌ماند (R9).
//  * اکشن‌های ai:false — همیشه همان loader قانون‌محور امروز.
//  * هیچ نوشته‌ای اینجا انجام نمی‌شود؛ نوشته‌ها (ساخت کار/سند، بستن
//    پروژه، ثبت اشاره‌گر یادآوری) با تأیید یک‌تپی کاربر در UI می‌مانند
//    (R2) و created_by همیشه عضوِ واردشده است (R3).
//
// وضعیت هوش (latch برای یک نشست): وقتی تابع ۴۰۴ بدهد (دیپلوی نشده)
// یا ۵۰۳ not_configured (کلید جمینای هنوز set نشده)، دیگر در همین
// نشست صدا زده نمی‌شود و همه‌چیز استخراجی می‌ماند؛ سقف روزانه (۴۲۹)
// و خطاهای گذرا latch نمی‌شوند و نوبت بعد دوباره امتحان می‌شوند.
import { sb } from './supabase.js'
import { auth } from './store.svelte.js'
import { getAction } from './assistant-prompts.js'

const FUNCTION_NAME = 'ai-assistant'
const AI_TIMEOUT_MS = 30000
const HISTORY_TURNS = 20
const HISTORY_ROWS = HISTORY_TURNS * 2

// null = هنوز امتحان نشده؛ { reason } = در این نشست خاموش است.
let aiDisabled = null
let aiWorked = false
let historyMissing = false

export function aiStatus() {
  if (aiDisabled) return { state: 'off', reason: aiDisabled.reason }
  if (aiWorked) return { state: 'on', reason: null }
  return { state: 'unknown', reason: null }
}

export function historyAvailable() {
  return !historyMissing
}

function isTableMissingError(err) {
  const msg = String(err?.message || err || '')
  return err?.code === 'PGRST205' || msg.includes('PGRST205')
}

// ---------- فراخوانی Edge Function ----------

async function callAiAssistant(body) {
  if (!sb || aiDisabled) return { ok: false, reason: aiDisabled ? aiDisabled.reason : 'no-client' }
  const invoke = sb.functions.invoke(FUNCTION_NAME, { body })
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, reason: 'timeout' }), AI_TIMEOUT_MS)
  )
  const raced = await Promise.race([
    invoke.then(
      (res) => ({ ok: true, res }),
      (err) => ({ ok: false, reason: 'invoke-error', err })
    ),
    timeout
  ])
  if (!raced.ok) return { ok: false, reason: raced.reason, err: raced.err }
  const { data, error, response } = raced.res
  if (error) {
    // FunctionsHttpError.context همان Response است (status + بدنهٔ JSON
    // خطای ساخت‌یافتهٔ تابع)؛ FunctionsFetchError نه response دارد نه
    // status (خطای گذرای شبکه). بدنه فقط یک بار خوانده می‌شود.
    let bodyError = null
    const resObj = response || error.context
    try {
      const j = resObj && typeof resObj.json === 'function' ? await resObj.json() : null
      bodyError = j?.error || null
    } catch {
      /* بدنه خواندنی نیست — فقط status ملاک است */
    }
    const status = error.context?.status ?? resObj?.status ?? error.status
    if (status === 404) {
      aiDisabled = { reason: 'not_deployed' }
      return { ok: false, reason: 'not_deployed' }
    }
    if (status === 503 || bodyError === 'not_configured') {
      aiDisabled = { reason: 'not_configured' }
      return { ok: false, reason: 'not_configured' }
    }
    if (status === 429 || bodyError === 'rate_limited' || bodyError === 'daily_cap') {
      return { ok: false, reason: bodyError || 'rate_limited' }
    }
    return { ok: false, reason: 'model_error', err: error }
  }
  if (data?.error) {
    if (data.error === 'not_configured') {
      aiDisabled = { reason: 'not_configured' }
      return { ok: false, reason: 'not_configured' }
    }
    if (data.error === 'rate_limited' || data.error === 'daily_cap') {
      return { ok: false, reason: data.error }
    }
    return { ok: false, reason: 'model_error' }
  }
  aiWorked = true
  return { ok: true, data }
}

// ---------- اعتبارسنجی خروجی مدل (سمت کلاینت؛ فقط شکلی) ----------
// R1 سرور-محور (فاز ۱): تابع منبع‌ها را برابر خوانده‌های خودش
// اعتبارسنجی می‌کند؛ اینجا فقط شکلِ خروجی چک می‌شود (نکتهٔ متنی،
// جواب رشته‌ای، منبع‌های { table, id }) و همان‌طور که تابع فرستاده
// برمی‌گردد — کلاینت دیگر منبع را از کانتکست خودش فیلتر نمی‌کند،
// چون کانتکستی ندارد.

function validRoomSummary(data) {
  if (!data || !Array.isArray(data.points)) return null
  const points = data.points
    .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => ({
      text: p.text.trim(),
      source_ids: (Array.isArray(p.source_ids) ? p.source_ids : []).filter((id) => typeof id === 'string')
    }))
    .filter((p) => p.source_ids.length > 0)
  if (points.length === 0) return { found: false, points: [] }
  return { found: true, points }
}

function validDocSummary(data) {
  if (!data || !Array.isArray(data.points)) return null
  const points = data.points
    .filter((p) => p && typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => ({
      text: p.text.trim(),
      paragraph: Number(p.paragraph) || null
    }))
  if (points.length === 0) return { found: false, points: [] }
  return { found: true, points }
}

function validAnswer(data) {
  if (!data || typeof data.answer !== 'string' || data.answer.trim().length === 0) {
    return { found: false, answer: '', sources: [] }
  }
  const sources = (Array.isArray(data.sources) ? data.sources : []).filter(
    (s) => s && typeof s.table === 'string' && typeof s.id === 'string'
  )
  return { found: true, answer: data.answer.trim(), sources }
}

// ---------- dispatch ----------

export async function dispatch(actionId, inputs = {}) {
  const entry = getAction(actionId)
  if (!entry) throw new Error('دستور ناشناخته است.')
  if (entry.ai) {
    const tried = await tryAi(entry, inputs)
    if (tried) {
      // سقف روزانه از tryAi با engine کامل برمی‌گردد (fallback + اعلام)؛
      // نتیجهٔ هوش واقعی engine ندارد و اینجا 'ai' می‌گیرد.
      if (tried.engine) return { ...tried, action: entry.id }
      return { ...tried, engine: 'ai', action: entry.id }
    }
    // R7: fallback استخراجی، با اعلام دلیل.
    const fallback = await entry.runFallback(inputs)
    return {
      ...fallback,
      engine: 'extractive',
      action: entry.id,
      fallbackNotice:
        aiDisabled?.reason === 'not_configured'
          ? 'هوش فعلاً وصل نیست — کلید هوش هنوز وصل نشده؛ جواب از ردیف‌های واقعی است.'
          : aiDisabled?.reason === 'not_deployed'
            ? 'هوش فعلاً وصل نیست — تابع هوش هنوز مستقر نشده؛ جواب از ردیف‌های واقعی است.'
            : 'هوش این بار جواب نداد — جواب از ردیف‌های واقعی است.'
    }
  }
  const result = await entry.load(inputs)
  if (Array.isArray(result)) {
    // Loaderهای فهرستی (پیشنهاد چت) آرایه برمی‌گردانند؛ spread روی
    // آرایه آن را به آبجکتِ {0: …} تبدیل می‌کند و {#each} در بخش
    // می‌شکند. پس آرایه دست‌نخورده می‌ماند و engine/action فقط
    // خاصیت روی همان آرایه‌اند (length و {#each} سالم می‌مانند).
    result.engine = 'extractive'
    result.action = entry.id
    return result
  }
  return { ...result, engine: 'extractive', action: entry.id }
}

async function tryAi(entry, inputs) {
  // فاز ۱: کلاینت فقط { action, params, history } می‌فرستد — نه
  // کانتکست، نه پرامپت سیستم، نه شناسهٔ منبع. تابع خودش می‌خواند.
  const params = {}
  if (entry.id === 'summarize-room') params.roomId = inputs.roomId
  else if (entry.id === 'summarize-doc') params.docId = inputs.docId
  else if (entry.id === 'ask-workspace') params.question = inputs.question
  else if (entry.id === 'open-chat') params.message = inputs.message
  const body = {
    action: entry.id,
    params,
    maxTokens: entry.maxTokens
  }
  if (entry.id === 'open-chat' && Array.isArray(inputs.history)) {
    body.history = inputs.history
      .slice(-10)
      .map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: String(t.content || '')
      }))
      .filter((t) => t.content.trim().length > 0)
  }
  const res = await callAiAssistant(body)
  if (!res.ok) {
    if (res.reason === 'rate_limited' || res.reason === 'daily_cap') {
      // سقف روزانه: fallback با اعلام صریح، بدون latch.
      const fallback = await entry.runFallback(inputs)
      return {
        ...fallback,
        engine: 'extractive',
        action: entry.id,
        rateLimited: true,
        fallbackNotice: 'سقف روزانهٔ هوش پر شده — جواب از ردیف‌های واقعی است.'
      }
    }
    if (res.reason === 'timeout' || res.reason === 'invoke-error') {
      // تایم‌اوت (۳۰ ثانیه) یا خطای فراخوانی: fallback با اعلام
      // صریحِ دلیل، بدون latch — نه سکوت، نه خطای خام.
      const fallback = await entry.runFallback(inputs)
      return {
        ...fallback,
        engine: 'extractive',
        action: entry.id,
        fallbackNotice:
          res.reason === 'timeout'
            ? 'هوش دیر جواب داد — جواب از ردیف‌های واقعی است.'
            : 'ارتباط با هوش برقرار نشد — جواب از ردیف‌های واقعی است.'
      }
    }
    return null
  }
  if (entry.id === 'summarize-room') return validRoomSummary(res.data)
  if (entry.id === 'summarize-doc') return validDocSummary(res.data)
  if (entry.id === 'ask-workspace' || entry.id === 'open-chat') {
    return validAnswer(res.data)
  }
  return null
}

// ---------- سابقهٔ گفت‌وگو (assistant_messages) ----------
// سابقه فقط برای عضوِ واردشده خوانده/نوشته می‌شود (RLS: own). اگر
// جدول هنوز در دیتابیس زنده نیست (مهاجرت اعمال نشده)، گفت‌وگو در
// همان نشست کار می‌کند و فقط ذخیره نمی‌شود — هیچ خطایی به کاربر
// نشان داده نمی‌شود جز یک یادداشت کوتاه در پنل.

export async function loadChatHistory(limitTurns = HISTORY_TURNS) {
  if (!sb || !auth.member) return []
  const { data, error } = await sb
    .from('assistant_messages')
    .select('role, content, action, sources, created_at')
    .eq('user_id', auth.member.id)
    .order('created_at', { ascending: false })
    .limit(limitTurns * 2)
  if (error) {
    if (isTableMissingError(error)) historyMissing = true
    return []
  }
  return (data || []).reverse().map((r) => ({
    role: r.role,
    content: r.content,
    action: r.action || null,
    sources: Array.isArray(r.sources) ? r.sources : [],
    created_at: r.created_at
  }))
}

export async function saveChatExchange({ userText, assistantText, action, sources }) {
  if (!sb || !auth.member) return false
  // دو درج جدا (نه یک آرایه) — ساده‌تر و با همهٔ بک‌اندها سازگار است.
  const rows = [
    { user_id: auth.member.id, role: 'user', content: userText, action: action || null, sources: [] },
    {
      user_id: auth.member.id,
      role: 'assistant',
      content: assistantText,
      action: action || null,
      sources: Array.isArray(sources) ? sources : []
    }
  ]
  for (const row of rows) {
    const { error } = await sb.from('assistant_messages').insert(row)
    if (error) {
      if (isTableMissingError(error)) historyMissing = true
      return false
    }
  }
  // هرس: فقط ۲۰ نوبت آخر (۴۰ ردیف) نگه داشته می‌شود — با limit و
  // برش در کلاینت (نه Range header)، تا با هر بک‌اندی کار کند.
  try {
    const { data } = await sb
      .from('assistant_messages')
      .select('id')
      .eq('user_id', auth.member.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_ROWS + 200)
    const stale = (data || []).slice(HISTORY_ROWS).map((r) => r.id)
    if (stale.length > 0) {
      await sb.from('assistant_messages').delete().in('id', stale)
    }
  } catch {
    /* هرس بهترین‌تلاش است؛ گفت‌وگو را خراب نمی‌کند */
  }
  return true
}
