import { sb } from './supabase.js'
import { auth } from './store.svelte.js'

// ---------- signup validation (proven in the W0 probe page) ----------
// Reserved/unroutable domains are rejected client-side with a message that
// names the domain, before any network call is made.
export function validateSignupEmail(email) {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1)
    return 'ایمیل معتبر نیست: یک ایمیل کامل به شکل name@domain بنویسید.'
  if (!/^[^\s@]+$/.test(email.slice(0, at)))
    return 'ایمیل معتبر نیست: بخش پیش از @ خالی یا نامعتبر است.'
  const domain = email.slice(at + 1).toLowerCase()
  if (/^\[.*\]$/.test(domain))
    return 'ایمیل معتبر نیست: دامنهٔ «' + domain + '» پذیرفته نمی‌شود؛ از یک ایمیل واقعی استفاده کنید.'
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((l) => !l))
    return 'ایمیل معتبر نیست: دامنهٔ «' + domain + '» ناقص است؛ دامنه باید نقطه داشته باشد (مثلاً gmail.com).'
  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,}$/.test(tld))
    return 'ایمیل معتبر نیست: پسوند دامنهٔ «' + domain + '» معتبر نیست.'
  const reserved = ['example.com', 'example.net', 'example.org', 'example.edu']
  const badSuffix = ['.local', '.localhost', '.invalid', '.test', '.example', '.internal', '.onion']
  const bad =
    reserved.indexOf(domain) !== -1 ||
    badSuffix.some((s) => domain === s.slice(1) || domain.endsWith(s))
  if (bad)
    return 'ایمیل معتبر نیست: دامنهٔ «' + domain + '» دامنهٔ واقعی و قابل‌ارسال نیست (دامنهٔ آزمایشی/رزرو شده است)؛ از یک ایمیل واقعی (مثلاً Gmail) استفاده کنید.'
  return null
}

export function isRateLimitError(err) {
  const m = (err && err.message) || ''
  return (err && err.status === 429) || /rate limit/i.test(m)
}

// The exact Supabase error text is shown as-is, never summarized.
// A 429 shows the amber "rate limit, wait and retry" state.
export function authErrorMessage(where, err) {
  const exact = (err && err.message) || String(err)
  if (isRateLimitError(err)) {
    return {
      text:
        'به سقف نرخ ایمیل رسیدی — کمی صبر کن و بعد دوباره تلاش کن. پیام دقیق Supabase: ' +
        exact,
      kind: 'rate-limited'
    }
  }
  return { text: where + ' ناموفق: ' + exact, kind: 'error' }
}

// ---------- members row ----------
// One-shot guard: called from both the sign-in button and onAuthStateChange.
let ensureRunning = false

export async function ensureMember(user) {
  if (!sb || !user) return null
  if (auth.member && auth.member.muse_id === 'auth:' + user.id) return auth.member
  if (ensureRunning) return null
  ensureRunning = true
  try {
    const name = (user.email || 'user').split('@')[0]
    const { data, error } = await sb
      .from('members')
      .upsert(
        { muse_id: 'auth:' + user.id, name, auth_id: user.id },
        { onConflict: 'auth_id' }
      )
      .select()
      .single()
    if (error) throw error
    auth.member = data
    auth.memberError = null
    return data
  } catch (e) {
    auth.memberError = e.message || String(e)
    return null
  } finally {
    ensureRunning = false
  }
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, ...authErrorMessage('ورود', error) }
  auth.user = data.user
  await ensureMember(data.user)
  return { ok: true, text: 'ورود انجام شد.', kind: 'ok' }
}

export async function signUp(email, password) {
  const bad = validateSignupEmail(email)
  if (bad) return { ok: false, text: bad, kind: 'error' }
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) return { ok: false, ...authErrorMessage('ثبت‌نام', error) }
  if (data.session && data.user) {
    auth.user = data.user
    await ensureMember(data.user)
    return { ok: true, text: 'ثبت‌نام و ورود انجام شد.', kind: 'ok' }
  }
  return {
    ok: false,
    text: 'ثبت‌نام انجام شد ولی نشست فوری ساخته نشد (احتمالاً تأیید ایمیل فعال است)؛ حساب را از داشبورد Supabase تأیید کنید و بعد وارد شوید.',
    kind: 'error'
  }
}

export async function signOut() {
  if (sb) await sb.auth.signOut()
  auth.user = null
  auth.member = null
  auth.memberError = null
}
