import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import {
  stashSession,
  clearStashedSession,
  handleAuthEvent
} from './auth-events.js'
import { isRateLimitError, loginErrorMessage, validateNewPassword } from './extract.js'

// The App's onAuthStateChange handler lives in auth-events.js (no
// imports, so the probe can drive it directly); re-exported here.
export { handleAuthEvent, stashSession, clearStashedSession }

// Re-exported so existing imports of isRateLimitError from here keep working.
export { isRateLimitError }

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

// The exact Supabase error text is shown as-is, never summarized.
// A 429 shows the amber "rate limit, wait and retry" state.
// (isRateLimitError lives in extract.js now, re-exported above.)
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

// The members row. Two rules that the old upsert broke:
// 1. `name` is the DISPLAY name and is NEVER overwritten here. The old
//    code upserted name = email local part on every login, so any
//    display name (set in the dashboard or in the app) reverted to the
//    username at the next login — that is why live «@زهرا» matched
//    nothing while the sandbox probe (which seeded display names)
//    passed. Now: read the row first; keep the stored name.
// 2. `username` is the stable login handle (email local part), written
//    on insert and backfilled on first sight of an old row. The column
//    comes from the G2 migration (files/g2-members-username.sql); until
//    it runs, the insert/update fall back to the old shape (no username)
//    so the code works with the pre-migration schema too.
export async function ensureMember(user) {
  if (!sb || !user) return null
  if (auth.member && auth.member.muse_id === 'auth:' + user.id) return auth.member
  if (ensureRunning) return null
  ensureRunning = true
  try {
    const username = (user.email || 'user').split('@')[0]
    // Display name: Auth user_metadata first (dashboard-created accounts
    // can carry full_name/name), else the username.
    const displayName =
      user.user_metadata?.full_name || user.user_metadata?.name || username
    const { data: existing } = await sb
      .from('members')
      .select('*')
      .eq('auth_id', user.id)
      .single()
    if (existing) {
      if (!existing.username) {
        // Old row: backfill the username, keep the stored display name.
        const { data } = await sb
          .from('members')
          .update({ username })
          .eq('id', existing.id)
          .select()
          .single()
        auth.member = data || existing
      } else {
        auth.member = existing
      }
      auth.memberError = null
      return auth.member
    }
    const row = {
      muse_id: 'auth:' + user.id,
      name: displayName,
      auth_id: user.id,
      username
    }
    let { data, error } = await sb.from('members').insert(row).select().single()
    if (error) {
      if (isMissingUsernameColumnError(error)) {
        // Pre-migration schema: retry without the username field.
        const retry = await sb
          .from('members')
          .insert({
            muse_id: 'auth:' + user.id,
            name: displayName,
            auth_id: user.id
          })
          .select()
          .single()
        data = retry.data
        error = retry.error
      } else if (error.code === '23505') {
        // Lost a race with another tab's insert: re-read the row.
        const { data: raced } = await sb
          .from('members')
          .select('*')
          .eq('auth_id', user.id)
          .single()
        if (raced) {
          auth.member = raced
          auth.memberError = null
          return raced
        }
      }
    }
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

// PostgREST "column does not exist" for `username` (PGRST204): the G2
// migration has not run yet on this project.
export function isMissingUsernameColumnError(err) {
  const m = (err && (err.message || '')) + ' ' + (err && err.code ? String(err.code) : '')
  return /username/.test(m) && (/PGRST204/.test(m) || /Could not find the .username. column/i.test(m))
}

// The signed-in member's display name, edited in the app (MembersView).
// RLS allows updating only one's own row (w1 members update own).
export async function updateDisplayName(name) {
  if (!sb || !auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const clean = (name || '').trim()
  if (!clean) throw new Error('نام نمایشی را بنویسید.')
  if (clean.length > 80) throw new Error('نام نمایشی خیلی طولانی است.')
  const { data, error } = await sb
    .from('members')
    .update({ name: clean })
    .eq('id', auth.member.id)
    .select()
    .single()
  if (error) throw error
  auth.member = data
  const i = ws.members.findIndex((m) => m.id === data.id)
  if (i >= 0) ws.members[i] = data
  return data
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, ...loginErrorMessage(error) }
  auth.user = data.user
  stashSession(data.session)
  await ensureMember(data.user)
  return { ok: true, text: 'ورود انجام شد.', kind: 'ok' }
}

// ---------- password reset by email (Phase 11, D10) ----------
// redirectTo is the SITE ROOT, deliberately without a hash route:
// Supabase appends `#access_token=...&type=recovery` to it, and the
// Supabase client only parses that hash when it is the whole hash — a
// `#/reset-password` in front would hide the access_token from it.
// The client then fires PASSWORD_RECOVERY with a session, and the App
// shows the reset form (auth.recoveryMode). The '#/reset-password'
// route exists for deep links and the probe, and renders the same form.
export async function requestPasswordReset(email) {
  const clean = (email || '').trim()
  if (!clean) return { ok: false, text: 'ایمیلت را بنویس.', kind: 'error' }
  const { error } = await sb.auth.resetPasswordForEmail(clean, {
    redirectTo: location.origin + location.pathname
  })
  if (error) return { ok: false, ...authErrorMessage('ارسال پیوند بازیابی', error) }
  return {
    ok: true,
    text: 'پیوند بازیابی رمز به ' + clean + ' فرستاده شد — صندوق ایمیلت را چک کن (پوشهٔ اسپم را هم ببین).',
    kind: 'ok'
  }
}

export async function completePasswordReset(next, confirm) {
  const bad = validateNewPassword(next, confirm)
  if (bad) return { ok: false, text: bad, kind: 'error' }
  const { error } = await sb.auth.updateUser({ password: next })
  if (error) return { ok: false, ...authErrorMessage('تغییر رمز', error) }
  return { ok: true, text: 'رمز تازه ثبت شد — حالا با رمز تازه وارد شو.', kind: 'ok' }
}

export async function signUp(email, password) {
  const bad = validateSignupEmail(email)
  if (bad) return { ok: false, text: bad, kind: 'error' }
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) return { ok: false, ...authErrorMessage('ثبت‌نام', error) }
  if (data.session && data.user) {
    auth.user = data.user
    stashSession(data.session)
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
  // Clear the stashed refresh token FIRST: a deliberate sign-out must
  // never be "recovered" by the SIGNED_OUT handler's stashed-token path.
  clearStashedSession()
  if (sb) await sb.auth.signOut()
  auth.user = null
  auth.member = null
  auth.memberError = null
}

// ---------- change password ----------
// Client-side validation first; then re-authenticate with the current
// password (proves the user knows it) and update the password.
// signInWithPassword refreshes the session, so the user stays signed in.
export function validateChangePassword(current, next, confirm) {
  if (!current || !next || !confirm) return 'هر سه فیلد را کامل وارد کنید.'
  if (next.length < 6) return 'رمز تازه باید دست‌کم ۶ نویسه باشد.'
  if (next !== confirm) return 'تکرار رمز تازه با رمز تازه یکی نیست.'
  if (next === current) return 'رمز تازه باید با رمز فعلی فرق کند.'
  return null
}

export async function changePassword(email, current, next) {
  const { error: authErr } = await sb.auth.signInWithPassword({
    email,
    password: current
  })
  if (authErr) return { ok: false, ...authErrorMessage('تأیید رمز فعلی', authErr) }
  const { error } = await sb.auth.updateUser({ password: next })
  if (error) return { ok: false, ...authErrorMessage('تغییر رمز', error) }
  return { ok: true, text: 'رمز عبور با موفقیت تغییر کرد.', kind: 'ok' }
}
