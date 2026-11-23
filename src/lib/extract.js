// Pure extractive helpers for D5 (work, memory, assistant).
// This module is PURE: no Supabase, no DOM, no Yjs import — so the sandbox
// probe can run it in Node unchanged. Every function here only quotes or
// counts what already exists in its input; nothing is invented.
// The assistant is EXTRACTIVE-ONLY by design: no model text generation.

export const TASK_STATUSES = ['todo', 'doing', 'done']

// ---------- P01 block A: full project cycle ----------
// Project stage lives ONLY in projects.custom_fields.stage (no new
// column — step-4 model: strict core + custom_fields bag). Exactly one
// of these five values; a new project starts at 'created'; closing
// (A5) sets 'closed'.
export const PROJECT_STAGES = ['created', 'planned', 'active', 'review', 'closed']

export const PROJECT_STAGE_LABEL = {
  created: 'ساخته‌شده',
  planned: 'برنامه‌ریزی‌شده',
  active: 'در حال اجرا',
  review: 'در بازبینی',
  closed: 'بسته‌شده'
}

// Project creation form validation (A1): name, goal and deadline are
// required. Returns a clear Persian message, or null when valid.
// final_output and description are optional; stage is fixed to
// 'created' at creation. Pure: the sandbox probe runs it unchanged.
export function validateProjectForm({ name, goal, deadline }) {
  if (!String(name || '').trim()) return 'نام پروژه را بنویسید.'
  if (!String(goal || '').trim()) return 'هدف پروژه را بنویسید.'
  if (!String(deadline || '').trim()) return 'مهلت پروژه را انتخاب کنید.'
  return null
}

// Project review numbers (A4), computed ONLY from real rows — never
// hardcoded or guessed. `now` is a Date (the caller passes it so the
// probe can pin the clock). Overdue = due_at past and status != done.
// "New files" = uploaded in the last 7 days (window stated in the UI).
export function computeProjectReview({ tasks, docs, files }, now = new Date()) {
  const list = tasks || []
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000
  let todo = 0
  let doing = 0
  let done = 0
  let overdue = 0
  for (const t of list) {
    if (t.status === 'done') done++
    else if (t.status === 'doing') doing++
    else todo++
    if (t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() < nowMs) overdue++
  }
  const newFiles = (files || []).filter((f) => {
    if (!f.uploaded_at) return false
    const ms = new Date(f.uploaded_at).getTime()
    return ms >= weekAgoMs && ms <= nowMs
  }).length
  return { todo, doing, done, overdue, docs: (docs || []).length, newFiles }
}

export const TASK_STATUS_LABEL = {
  todo: 'باز',
  doing: 'در حال انجام',
  done: 'تمام‌شده'
}

// Status transition: done sets completed_at, leaving done clears it.
// Pure: the caller passes "now" so the probe can pin the clock.
export function nextTaskStatus(current, nowIso) {
  if (current === 'todo') return { status: 'doing', completed_at: null }
  if (current === 'doing') return { status: 'done', completed_at: nowIso }
  return { status: 'todo', completed_at: null }
}

export function nextVersionNo(existingNos) {
  if (!existingNos || existingNos.length === 0) return 1
  return Math.max(...existingNos) + 1
}

// ---------- Phase 11: password reset + clearer login errors (D10) ----------
// Pure helpers live here (not in auth.js) so the probe can import them
// in Node — auth.js holds the Supabase calls and imports these.
export function isRateLimitError(err) {
  const m = (err && err.message) || ''
  return (err && err.status === 429) || /rate limit/i.test(m)
}

// Supabase login failures, in plain Persian. The raw error
// ("Invalid login credentials") tells the user nothing about what to
// do next; the mapping names the fix — retry, confirm the email, or
// use «رمز را فراموش کردم». Unknown errors keep the exact Supabase
// text after the prefix, so nothing is hidden.
export function loginErrorMessage(err) {
  const hay = [err && err.message, err && err.code, err && err.error_description]
    .filter(Boolean)
    .join(' ')
  if (isRateLimitError(err)) {
    return {
      text: 'به سقف نرخ رسیدی — کمی صبر کن و بعد دوباره تلاش کن.',
      kind: 'rate-limited'
    }
  }
  if (/invalid login credentials|invalid_grant/i.test(hay)) {
    return {
      text: 'ایمیل یا رمز اشتباه است. اگر رمزت را فراموش کرده‌ای، از «رمز را فراموش کردم» پایین صفحه استفاده کن.',
      kind: 'error'
    }
  }
  if (/email not confirmed/i.test(hay)) {
    return {
      text: 'ایمیلت هنوز تأیید نشده است. اول پیوند تأیید را از صندوق ایمیلت باز کن و بعد وارد شو.',
      kind: 'error'
    }
  }
  return { text: 'ورود ناموفق: ' + ((err && err.message) || String(err)), kind: 'error' }
}

export function validateNewPassword(next, confirm) {
  if (!next || !confirm) return 'رمز تازه و تکرارش را کامل وارد کنید.'
  if (next.length < 6) return 'رمز تازه باید دست‌کم ۶ نویسه باشد.'
  if (next !== confirm) return 'تکرار رمز تازه با رمز تازه یکی نیست.'
  return null
}

// ---------- Phase 3: doc full-text search ----------
// Cap for docs.search_text (decision D2): the plain Yjs text, capped.
// Long docs still save — only the indexed copy is capped.
export const SEARCH_TEXT_MAX_CHARS = 20000

// A ~120-char window around the first case-insensitive match of `query`
// in `text` (newlines collapsed to spaces, for one-line rendering).
// '…' marks a cut end. '' when there is no match — the caller then
// shows no snippet instead of inventing one.
export function buildSearchSnippet(text, query, windowSize = 120) {
  const flat = String(text || '').replace(/\s+/g, ' ')
  const q = String(query || '').trim()
  if (!flat || !q) return ''
  const idx = flat.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return ''
  const half = Math.floor(windowSize / 2)
  const start = Math.max(0, idx - half)
  const end = Math.min(flat.length, idx + q.length + half)
  let out = flat.slice(start, end)
  if (start > 0) out = '…' + out
  if (end < flat.length) out = out + '…'
  return out
}

// Escape PostgREST ilike wildcards (Space bug #4: '%' and '_' were treated
// as wildcards in global search). Backslash first, then % and _.
export function escapeSearchPattern(q) {
  return String(q || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// ---------- Phase 5: nested docs (decision D4) ----------
// Pure tree helpers over doc rows { id, parent_id, ... }. No Supabase,
// no DOM — the sandbox probe runs them in Node unchanged. `parent_id`
// empty/null means the doc is a root. Rows whose parent is missing,
// self-pointing, or part of a parent cycle are treated as roots so a
// bad row can never hide the tree or loop it.

// Build the tree: roots in input order, each with `children` (also in
// input order, recursively). Input rows are NOT mutated.
export function buildDocTree(docs) {
  const list = docs || []
  const byId = new Map(list.map((d) => [d.id, d]))
  const nodes = new Map(list.map((d) => [d.id, { ...d, children: [] }]))
  const roots = []
  for (const d of list) {
    const node = nodes.get(d.id)
    const pid = d.parent_id || null
    // A usable parent: exists, is not the doc itself, and does not
    // close a cycle back to this doc.
    let ok = false
    if (pid && pid !== d.id && byId.has(pid)) {
      ok = true
      const seen = new Set([d.id])
      let cur = pid
      while (cur) {
        if (seen.has(cur)) {
          ok = false
          break
        }
        seen.add(cur)
        const up = byId.get(cur)
        cur = up ? up.parent_id || null : null
      }
    }
    if (ok) nodes.get(pid).children.push(node)
    else roots.push(node)
  }
  return roots
}

// Ancestors of `docId`, root first (the doc itself excluded).
// Cycle-safe: stops at a repeated id or a missing parent.
export function docAncestors(docs, docId) {
  const byId = new Map((docs || []).map((d) => [d.id, d]))
  const out = []
  const seen = new Set([docId])
  let cur = byId.get(docId)
  while (cur && cur.parent_id) {
    const pid = cur.parent_id
    if (seen.has(pid)) break
    seen.add(pid)
    const up = byId.get(pid)
    if (!up) break
    out.unshift(up)
    cur = up
  }
  return out
}

// True when `docId` is `ancestorId` itself or sits below it in the
// tree (walk up from docId). Cycle-safe.
export function isDocDescendantOf(docs, docId, ancestorId) {
  if (docId === ancestorId) return true
  const byId = new Map((docs || []).map((d) => [d.id, d]))
  const seen = new Set([docId])
  let cur = byId.get(docId)
  while (cur && cur.parent_id) {
    const pid = cur.parent_id
    if (pid === ancestorId) return true
    if (seen.has(pid)) break
    seen.add(pid)
    cur = byId.get(pid)
  }
  return false
}

// Validate a new parent for `docId` (null = back to the root).
// Returns a clear Persian message, or null when the move is allowed.
export function validateDocParent(docs, docId, newParentId) {
  if (!newParentId) return null
  if (newParentId === docId) return 'سند نمی‌تواند زیرِ خودش باشد.'
  const list = docs || []
  const parent = list.find((d) => d.id === newParentId)
  if (!parent) return 'سند والد پیدا نشد.'
  if (isDocDescendantOf(list, newParentId, docId)) {
    return 'این سند زیرمجموعهٔ سندِ فعلی است؛ چرخه ساخته نمی‌شود.'
  }
  return null
}

// Candidate parents for the move picker: every doc except the doc
// itself and its descendants (those would close a cycle).
export function moveParentOptions(docs, docId) {
  return (docs || []).filter(
    (d) => d.id !== docId && !isDocDescendantOf(docs, d.id, docId)
  )
}

// ---------- extractive summarisation ----------

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

// Longest distinct lines (>= 10 chars), up to `limit`, verbatim.
export function pickKeyLines(text, limit = 5) {
  const seen = new Set()
  const lines = splitLines(text).filter((l) => {
    if (l.length < 10) return false
    if (seen.has(l)) return false
    seen.add(l)
    return true
  })
  lines.sort((a, b) => b.length - a.length)
  return lines.slice(0, limit)
}

// Room summary: counts + per-author counts + up to 5 verbatim key lines.
// `messages` are rows { body, author_id, created_at }; `nameOf` maps
// author_id -> display name.
export function extractRoomSummary(messages, nameOf) {
  const list = messages || []
  const authors = {}
  for (const m of list) {
    const name = nameOf(m.author_id) || 'عضو'
    authors[name] = (authors[name] || 0) + 1
  }
  const keyLines = pickKeyLines(list.map((m) => m.body).join('\n'), 5).map(
    (text) => {
      const src = list.find((m) => (m.body || '').includes(text))
      return {
        text,
        author: src ? nameOf(src.author_id) || 'عضو' : 'عضو',
        at: src ? src.created_at : null
      }
    }
  )
  return {
    count: list.length,
    authors: Object.entries(authors)
      .map(([name, n]) => ({ name, count: n }))
      .sort((a, b) => b.count - a.count),
    keyLines
  }
}

// Doc summary: char count, first paragraph verbatim, up to 5 key lines.
export function extractDocSummary(text) {
  const clean = String(text || '')
  const firstParagraph = clean.split(/\n\s*\n/)[0]?.trim() || ''
  return {
    chars: clean.length,
    paragraphs: clean.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    firstParagraph,
    keyLines: pickKeyLines(clean, 5)
  }
}

// Action markers: a line suggests a task when it starts with a list marker
// or contains one of these verbs. The suggestion quotes the line verbatim.
const ACTION_MARKERS = [
  'باید',
  'انجام',
  'پیگیری',
  'آماده',
  'تحویل',
  'تماس',
  'ارسال',
  'بررسی',
  'تکمیل',
  'هماهنگی'
]

export function extractTaskSuggestions(text, limit = 8) {
  const out = []
  const seen = new Set()
  for (const line of splitLines(text)) {
    if (out.length >= limit) break
    if (line.length < 6 || seen.has(line)) continue
    const listed = /^([-*•·\d]+[.)\]]|\(?\d+[.)])\s/.test(line)
    const hasVerb = ACTION_MARKERS.some((v) => line.includes(v))
    if (listed || hasVerb) {
      seen.add(line)
      out.push({ quote: line })
    }
  }
  return out
}

// ---------- P01 block C: planner notebook ----------
// Pure date/menu logic for the planner on #/tasks. All functions take an
// explicit `now` so the sandbox probe can pin the clock. "Tehran day" =
// the Gregorian calendar date in Asia/Tehran (Iran has no DST since
// 2022, so 24h steps keep the same Tehran time-of-day). "Month" is the
// Jalali month in Tehran, matching the تقویم grid and the fa-IR dates
// the UI already shows; the week is today + the next 6 days (7 days
// inclusive of today).

export const PLANNER_MENUS = [
  { id: 'today', label: 'امروز' },
  { id: 'week', label: 'این هفته' },
  { id: 'month', label: 'این ماه' },
  { id: 'due', label: 'سررسیدها' },
  { id: 'mine', label: 'کارهای من' },
  { id: 'other', label: 'کارهای نفر دوم' },
  { id: 'calendar', label: 'تقویم' },
  { id: 'reminders', label: 'یادآوری‌ها' }
]

// Weekday header for the calendar grid: the Iranian week starts Saturday.
export const WEEKDAY_LABELS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']

const TEHRAN_TZ = 'Asia/Tehran'
const DAY_MS = 86400000

const tehranDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
})
const jalaliFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
  timeZone: TEHRAN_TZ, year: 'numeric', month: 'numeric', day: 'numeric'
})
const jalaliMonthLabelFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ, month: 'long', year: 'numeric'
})
const jalaliDayLabelFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ, day: 'numeric', month: 'long', year: 'numeric'
})

function intlParts(fmt, date) {
  const o = {}
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value
  return o
}

function toDate(d) {
  return d instanceof Date ? d : new Date(d)
}

// Tehran calendar day key, 'YYYY-MM-DD' (Gregorian date in Tehran).
export function tehranDayKey(date) {
  const p = intlParts(tehranDayFmt, toDate(date))
  return p.year + '-' + p.month + '-' + p.day
}

// Jalali (Tehran) parts, Latin digits.
export function jalaliParts(date) {
  const p = intlParts(jalaliFmt, toDate(date))
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) }
}

// Jalali month key, 'YYYY-MM' (e.g. '1405-08').
export function jalaliMonthKey(date) {
  const p = jalaliParts(date)
  return p.year + '-' + String(p.month).padStart(2, '0')
}

// Jalali month label, e.g. «آبان ۱۴۰۵».
export function jalaliMonthLabel(date) {
  return jalaliMonthLabelFmt.format(toDate(date))
}

// Jalali day label, e.g. «۳۰ آبان ۱۴۰۵».
export function jalaliDayLabel(date) {
  return jalaliDayLabelFmt.format(toDate(date))
}

// End of a Tehran calendar day as ISO: a date picked in a
// <input type="date"> means that Tehran day, not the browser's local
// day — `new Date(key + 'T23:59:00')` parses in the browser's timezone,
// which moves the day for any user not in Tehran (and for the UTC
// sandbox). Tehran is fixed at UTC+3:30 (no DST since 2022).
export function endOfTehranDay(dayKey) {
  return new Date(dayKey + 'T23:59:00+03:30').toISOString()
}

export function addTehranDays(date, n) {
  return new Date(toDate(date).getTime() + n * DAY_MS)
}

// Weekday of a Tehran day key: 0 = Sunday … 6 = Saturday (the same
// 7-day cycle in every calendar). Noon UTC avoids any TZ edge.
export function weekdayOfDayKey(dayKey) {
  return new Date(dayKey + 'T12:00:00Z').getUTCDay()
}

// Days of the Jalali month containing `anchor`, in order. Each day:
// { dayKey (Tehran), jalaliDay, weekday (0=Sun..6=Sat), date }.
export function jalaliMonthDays(anchor) {
  const a = toDate(anchor)
  const jp = jalaliParts(a)
  const first = new Date(a.getTime() - (jp.day - 1) * DAY_MS)
  const days = []
  let cur = first
  for (;;) {
    const cp = jalaliParts(cur)
    if (cp.year !== jp.year || cp.month !== jp.month) break
    days.push({
      dayKey: tehranDayKey(cur),
      jalaliDay: cp.day,
      weekday: weekdayOfDayKey(tehranDayKey(cur)),
      date: cur
    })
    if (days.length > 40) break // safety: a Jalali month is 29–31 days
    cur = new Date(cur.getTime() + DAY_MS)
  }
  return { year: jp.year, month: jp.month, days }
}

// A date in the Jalali month `delta` months away from `anchor`'s month.
export function shiftJalaliMonth(anchor, delta) {
  let cur = toDate(anchor)
  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      const { days } = jalaliMonthDays(cur)
      cur = new Date(days[days.length - 1].date.getTime() + DAY_MS)
    }
  } else if (delta < 0) {
    for (let i = 0; i < -delta; i++) {
      const jp = jalaliParts(cur)
      cur = new Date(cur.getTime() - jp.day * DAY_MS)
    }
  }
  return cur
}

// Overdue = due_at past and not done (spec C2, same rule as A4).
export function isOverdueTask(task, now = new Date()) {
  return (
    task.status !== 'done' &&
    !!task.due_at &&
    new Date(task.due_at).getTime() < toDate(now).getTime()
  )
}

// The rows one planner menu shows. `now` is a Date (pinned by the
// probe). Literal to the spec: only «سررسیدها» filters status != done;
// today/week/month/calendar/mine/other show done tasks too (their rows
// carry the «تمام‌شده» state). Tasks without due_at never appear in
// today/week/month; in «سررسیدها» they come last with the «بدون تاریخ»
// label (C2 acceptance).
export function plannerMenuTasks(tasks, reminders, menuId, { now = new Date(), meId = null, otherId = null } = {}) {
  const list = tasks || []
  const rems = reminders || []
  const todayKey = tehranDayKey(now)
  const weekKeys = new Set()
  for (let i = 0; i < 7; i++) weekKeys.add(tehranDayKey(addTehranDays(now, i)))
  const monthKey = jalaliMonthKey(now)
  switch (menuId) {
    case 'today':
      return {
        tasks: list.filter((t) => t.due_at && tehranDayKey(t.due_at) === todayKey),
        reminders: rems.filter((r) => r.remind_at && tehranDayKey(r.remind_at) === todayKey)
      }
    case 'week':
      return {
        tasks: list.filter((t) => t.due_at && weekKeys.has(tehranDayKey(t.due_at))),
        reminders: []
      }
    case 'month':
      return {
        tasks: list.filter((t) => t.due_at && jalaliMonthKey(t.due_at) === monthKey),
        reminders: []
      }
    case 'due': {
      const dated = list
        .filter((t) => t.status !== 'done' && t.due_at)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
      const undated = list.filter((t) => t.status !== 'done' && !t.due_at)
      return { tasks: [...dated, ...undated], reminders: [] }
    }
    case 'mine':
      return { tasks: list.filter((t) => t.assignee_id === meId), reminders: [] }
    case 'other':
      return { tasks: list.filter((t) => t.assignee_id === otherId), reminders: [] }
    case 'reminders':
      return { tasks: [], reminders: rems }
    case 'calendar':
      return { tasks: list, reminders: [] }
    default:
      return { tasks: [], reminders: [] }
  }
}

// Per-day task counts for the calendar month containing `anchor`:
// { dayKey: count } — only days of that Jalali month are keys.
export function plannerCalendarCounts(tasks, anchor) {
  const { days } = jalaliMonthDays(anchor)
  const counts = {}
  for (const d of days) counts[d.dayKey] = 0
  for (const t of tasks || []) {
    if (!t.due_at) continue
    const k = tehranDayKey(t.due_at)
    if (k in counts) counts[k]++
  }
  return counts
}

// Tasks due on one Tehran day.
export function plannerDayTasks(tasks, dayKey) {
  return (tasks || []).filter((t) => t.due_at && tehranDayKey(t.due_at) === dayKey)
}

// C3: the due-date prefill for a task created from inside a menu.
// Menus with a date context prefill it (today, or the selected calendar
// day); menus without one (mine / other / reminders) prefill nothing.
export function plannerMenuDefaultDue(menuId, now = new Date(), selectedDayKey = null) {
  if (menuId === 'today' || menuId === 'week' || menuId === 'month' || menuId === 'due') {
    return tehranDayKey(now)
  }
  if (menuId === 'calendar') return selectedDayKey || tehranDayKey(now)
  return ''
}

// ---------- G3: dashboard home + team pulse ----------
// All pure: rows in, numbers out, `now` pinned by the caller so the
// sandbox probe can pin the clock. No number is ever invented — every
// count comes from a real row; an empty input gives zeros and null
// change rates (the UI then shows the empty state, not a fake %).

const faNumFmt = new Intl.NumberFormat('fa-IR')

// Persian digits, e.g. faNum(123) === '۱۲۳'.
export function faNum(n) {
  return faNumFmt.format(Number(n) || 0)
}

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
]

// Short Jalali day label, e.g. «۱ آذر».
export function jalaliShortDay(date) {
  const p = jalaliParts(date)
  return faNum(p.day) + ' ' + JALALI_MONTHS[p.month - 1]
}

const tehranHourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN_TZ, hour: 'numeric', hourCycle: 'h23'
})

// Greeting by Tehran time of day (05–12 صبح، 12–15 ظهر، 15–19 عصر،
/// otherwise شب). Pure: the caller passes `now`.
export function tehranGreeting(now = new Date()) {
  const h = Number(tehranHourFmt.format(toDate(now)))
  if (h >= 5 && h < 12) return 'صبح بخیر'
  if (h >= 12 && h < 15) return 'ظهر بخیر'
  if (h >= 15 && h < 19) return 'عصر بخیر'
  return 'شب بخیر'
}

// The 7 Tehran day keys of the current Tehran week, Saturday to
// Friday (the Iranian week starts Saturday).
export function tehranWeekDayKeys(now = new Date()) {
  const n = toDate(now)
  const wd = weekdayOfDayKey(tehranDayKey(n)) // 0=Sun..6=Sat
  const daysSinceSat = (wd - 6 + 7) % 7
  const start = addTehranDays(n, -daysSinceSat)
  const keys = []
  for (let i = 0; i < 7; i++) keys.push(tehranDayKey(addTehranDays(start, i)))
  return keys
}

// Team pulse (U18), computed ONLY from real rows.
//   todayMessages — messages with created_at on the current Tehran day
//   doneThisWeek  — tasks done (status='done') with completed_at in the
//                   current Tehran week (Saturday 00:00 – Friday 23:59:59)
//   activeDocs    — docs with updated_at in the last 7×24h
//   newFiles      — files with uploaded_at in the last 7×24h
//   days          — the 7 Tehran days (today-6 .. today), each with the
//                   per-day message count and done-task count
//   changeMessages / changeDone — weekly change % of the 7-day sums vs
//     the previous 7 days, rounded; null when the previous 7-day sum is
//     0 (no previous-week data — the UI renders no % element at all).
export function computeTeamPulse(
  { messages = [], tasks = [], docs = [], files = [] },
  now = new Date()
) {
  const n = toDate(now)
  const nowMs = n.getTime()
  const todayKey = tehranDayKey(n)
  const weekKeys = new Set(tehranWeekDayKeys(n))
  const weekAgoMs = nowMs - 7 * DAY_MS
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = addTehranDays(n, -i)
    days.push({ dayKey: tehranDayKey(d), label: jalaliShortDay(d), messages: 0, done: 0 })
  }
  const byKey = new Map(days.map((d) => [d.dayKey, d]))
  const prevKeys = new Set()
  for (let i = 13; i >= 7; i--) prevKeys.add(tehranDayKey(addTehranDays(n, -i)))
  let prevMessages = 0
  let prevDone = 0
  for (const m of messages || []) {
    if (!m.created_at) continue
    const k = tehranDayKey(m.created_at)
    const d = byKey.get(k)
    if (d) d.messages++
    else if (prevKeys.has(k)) prevMessages++
  }
  let doneThisWeek = 0
  for (const t of tasks || []) {
    if (t.status !== 'done' || !t.completed_at) continue
    const k = tehranDayKey(t.completed_at)
    if (weekKeys.has(k)) doneThisWeek++
    const d = byKey.get(k)
    if (d) d.done++
    else if (prevKeys.has(k)) prevDone++
  }
  const activeDocs = (docs || []).filter((d) => {
    if (!d.updated_at) return false
    const ms = new Date(d.updated_at).getTime()
    return ms >= weekAgoMs && ms <= nowMs
  }).length
  const newFiles = (files || []).filter((f) => {
    if (!f.uploaded_at) return false
    const ms = new Date(f.uploaded_at).getTime()
    return ms >= weekAgoMs && ms <= nowMs
  }).length
  const curMessages = days.reduce((s, d) => s + d.messages, 0)
  const curDone = days.reduce((s, d) => s + d.done, 0)
  const changeMessages =
    prevMessages > 0 ? Math.round(((curMessages - prevMessages) / prevMessages) * 100) : null
  const changeDone =
    prevDone > 0 ? Math.round(((curDone - prevDone) / prevDone) * 100) : null
  return {
    todayMessages: days[6].messages,
    doneThisWeek,
    activeDocs,
    newFiles,
    days,
    prevMessages,
    prevDone,
    changeMessages,
    changeDone
  }
}

// Hand-made 7-day line chart geometry (no library): two series
// (messages, done) as polyline point strings + area polygons. The x
// axis is reversed — time flows right-to-left in Persian, so the
// oldest day sits on the right and today on the left; the value axis
// is on the right (PAD_R). Pure: the probe pins the days.
const CHART_W = 600
const CHART_H = 180
const CHART_PAD_L = 8
const CHART_PAD_R = 44
const CHART_PAD_T = 12
const CHART_PAD_B = 26

export function computePulseChart(days) {
  const list = days || []
  const max = Math.max(1, ...list.map((d) => Math.max(d.messages || 0, d.done || 0)))
  const step = list.length > 1 ? (CHART_W - CHART_PAD_L - CHART_PAD_R) / (list.length - 1) : 0
  const x = (i) => CHART_W - CHART_PAD_R - i * step
  const y = (v) => CHART_H - CHART_PAD_B - (v / max) * (CHART_H - CHART_PAD_T - CHART_PAD_B)
  const pts = (key) =>
    list.map((d, i) => x(i).toFixed(1) + ',' + y(d[key] || 0).toFixed(1)).join(' ')
  const area = (key) =>
    x(0).toFixed(1) + ',' + (CHART_H - CHART_PAD_B).toFixed(1) + ' ' +
    pts(key) + ' ' +
    x(list.length - 1).toFixed(1) + ',' + (CHART_H - CHART_PAD_B).toFixed(1)
  return {
    width: CHART_W,
    height: CHART_H,
    max,
    messagesPoints: pts('messages'),
    donePoints: pts('done'),
    messagesArea: area('messages'),
    doneArea: area('done'),
    labels: list.map((d, i) => ({ x: x(i), label: d.label }))
  }
}

// Recent activity (G3-2 item 6): the newest events from real rows —
// task done / task created, doc edited / created, version saved —
// merged by time, newest first. `nameOf` maps a member id to a display
// name (same pattern as extractRoomSummary). Each event: { at,
// actorId, actor, text, link }.
export function buildRecentActivity(
  { tasks = [], docs = [], versions = [] },
  nameOf,
  now = new Date(),
  limit = 5
) {
  const events = []
  for (const t of tasks || []) {
    if (t.status === 'done' && t.completed_at) {
      events.push({
        at: t.completed_at,
        actorId: t.assignee_id || t.created_by,
        text: 'کار «' + t.title + '» را تمام کرد',
        link: '#/tasks'
      })
    }
    if (t.created_at) {
      events.push({
        at: t.created_at,
        actorId: t.created_by,
        text: 'کار «' + t.title + '» را ساخت',
        link: '#/tasks'
      })
    }
  }
  for (const d of docs || []) {
    if (!d.created_at) continue
    if (d.updated_at && new Date(d.updated_at).getTime() > new Date(d.created_at).getTime()) {
      events.push({
        at: d.updated_at,
        actorId: d.created_by,
        text: 'سند «' + d.title + '» را ویرایش کرد',
        link: '#/doc/' + d.id
      })
    } else {
      events.push({
        at: d.created_at,
        actorId: d.created_by,
        text: 'سند «' + d.title + '» را ساخت',
        link: '#/doc/' + d.id
      })
    }
  }
  for (const v of versions || []) {
    if (!v.created_at) continue
    events.push({
      at: v.created_at,
      actorId: v.author_id,
      text: 'نسخهٔ ' + faNum(v.version_no) + ' را ذخیره کرد',
      link: '#/doc/' + v.doc_id
    })
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at))
  return events.slice(0, limit).map((e) => ({
    ...e,
    actor: (nameOf && nameOf(e.actorId)) || 'عضو'
  }))
}

// ---------- G6: assistant expansion — 30 top commands ----------
// Pure helpers for the 24 new G6 commands (the 6 existing commands
// reuse computeProjectReview / extractRoomSummary / extractDocSummary /
// extractDocTaskSuggestions / extractChatTaskSuggestions /
// computeDeadlineGuardian / searchWorkspace). Every function takes
// rows + an explicit `now` so the sandbox probe can pin the clock.
// Nothing is invented: a function returns found:false (the caller
// renders «پیدا نشد») when its input has nothing real.

// #3 (100-list): project deadline — from custom_fields.deadline.
// `deadline` is a 'YYYY-MM-DD' date string (the P01 A1 date input) or
// an ISO datetime. daysLeft is the Tehran calendar-day difference
// (negative when the deadline has passed). tasksDueByDeadline counts
// unfinished tasks due on or before the deadline day.
export function projectDeadlineInfo(project, tasks, now = new Date()) {
  const deadline = project?.custom_fields?.deadline || null
  if (!deadline) return { found: false, deadline: null, deadlineKey: null, deadlineLabel: null, daysLeft: null, tasksDueByDeadline: 0 }
  const deadlineKey = String(deadline).length <= 10 ? String(deadline) : tehranDayKey(deadline)
  const daysLeft = Math.round(
    (new Date(deadlineKey + 'T12:00:00Z').getTime() -
      new Date(tehranDayKey(now) + 'T12:00:00Z').getTime()) / DAY_MS
  )
  const deadlineEndMs = new Date(deadlineKey + 'T23:59:00+03:30').getTime()
  const tasksDueByDeadline = (tasks || []).filter(
    (t) => t.status !== 'done' && t.due_at && new Date(t.due_at).getTime() <= deadlineEndMs
  ).length
  return {
    found: true,
    deadline,
    deadlineKey,
    deadlineLabel: jalaliDayLabel(new Date(deadlineKey + 'T12:00:00+03:30')),
    daysLeft,
    tasksDueByDeadline
  }
}

// #8 (100-list): suggest closing the project — only when the stage is
// 'review' AND there is at least one task AND every task is done. A
// project with no tasks at all is not suggested (nothing proves it is
// finished); a project in another stage is not suggested either.
// The suggestion never closes anything by itself — the UI closes only
// on the user's one tap (closeProject).
export function suggestProjectClose(project, tasks) {
  const stage = project?.custom_fields?.stage
  const list = tasks || []
  if (stage !== 'review') return { suggested: false, reason: 'stage' }
  if (list.length === 0) return { suggested: false, reason: 'no-tasks' }
  const open = list.filter((t) => t.status !== 'done')
  if (open.length > 0) return { suggested: false, reason: 'open-tasks', openCount: open.length }
  return { suggested: true, reason: 'all-done', doneCount: list.length }
}

// #13 (100-list): today's messages (Tehran day), newest first.
export function todayMessages(messages, now = new Date()) {
  const todayKey = tehranDayKey(now)
  return (messages || [])
    .filter((m) => m.created_at && tehranDayKey(m.created_at) === todayKey)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

// #15 (100-list): unanswered messages — a parent (parent_id empty)
// that no row answers (no row has parent_id === its id). Oldest first:
// the longest-waiting unanswered message is the one to catch first.
export function unansweredMessages(messages) {
  const list = messages || []
  const answered = new Set(list.filter((m) => m.parent_id).map((m) => m.parent_id))
  return list
    .filter((m) => !m.parent_id && !answered.has(m.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

// #23 (100-list): open threads — parents with at least one reply,
// with the reply count and the last reply. Most recently active first.
export function openThreads(messages) {
  const list = messages || []
  const replies = new Map()
  for (const m of list) {
    if (!m.parent_id) continue
    if (!replies.has(m.parent_id)) replies.set(m.parent_id, [])
    replies.get(m.parent_id).push(m)
  }
  const out = []
  for (const m of list) {
    if (m.parent_id) continue
    const rs = replies.get(m.id)
    if (!rs || rs.length === 0) continue
    rs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    out.push({ parent: m, replyCount: rs.length, lastReply: rs[rs.length - 1] })
  }
  out.sort((a, b) => new Date(b.lastReply.created_at) - new Date(a.lastReply.created_at))
  return out
}

// #25 (100-list): my mentions first — unread mentions before read
// ones, newest first within each group. Pure filter/sort; the loader
// (assistant.js) reads the rows from notifications.
export function mentionsFirst(notifications) {
  return (notifications || [])
    .filter((n) => n.type === 'mention')
    .sort((a, b) =>
      a.read === b.read
        ? new Date(b.created_at) - new Date(a.created_at)
        : a.read
          ? 1
          : -1
    )
}

// #27 (100-list): group notifications by type (mention / reply /
// reminder / comment first, then any other type). Only non-empty
// groups are returned; rows inside a group are newest first.
const NOTIF_TYPE_LABEL = {
  mention: 'منشن',
  reply: 'پاسخ',
  reminder: 'یادآوری',
  comment: 'نظر'
}
export function groupNotificationsByType(notifications) {
  const order = ['mention', 'reply', 'reminder', 'comment']
  const groups = new Map()
  for (const n of notifications || []) {
    const t = n.type || 'other'
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(n)
  }
  const out = []
  for (const t of order) {
    const rows = groups.get(t)
    if (!rows || rows.length === 0) continue
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    out.push({ type: t, label: NOTIF_TYPE_LABEL[t] || t, rows })
  }
  for (const [t, rows] of groups) {
    if (order.includes(t)) continue
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    out.push({ type: t, label: NOTIF_TYPE_LABEL[t] || t, rows })
  }
  return out
}

// #33 (100-list): stale docs — updated_at (falling back to created_at)
// older than 7×24h. Oldest first.
export function staleDocs(docs, now = new Date()) {
  const weekAgoMs = toDate(now).getTime() - 7 * DAY_MS
  return (docs || [])
    .filter((d) => {
      const at = d.updated_at || d.created_at
      if (!at) return true // no timestamp at all: cannot prove it fresh
      return new Date(at).getTime() < weekAgoMs
    })
    .sort((a, b) => new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0))
}

// #41 (100-list): open comments — resolved === false, in row order.
export function openComments(comments) {
  return (comments || []).filter((c) => !c.resolved)
}

// #49 (100-list): fresh files — uploaded in the last 7×24h (the same
// window as computeProjectReview's "new files"). Newest first.
export function freshFiles(files, now = new Date()) {
  const n = toDate(now).getTime()
  const weekAgoMs = n - 7 * DAY_MS
  return (files || [])
    .filter((f) => {
      if (!f.uploaded_at) return false
      const ms = new Date(f.uploaded_at).getTime()
      return ms >= weekAgoMs && ms <= n
    })
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
}

// #54 (100-list): unattached files — attached_to_type is empty.
// Newest first.
export function unattachedFiles(files) {
  return (files || [])
    .filter((f) => !f.attached_to_type)
    .sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0))
}

// #58 (100-list): my tasks due today (Tehran) — the intersection of
// the planner's «امروز» and «کارهای من» menus. Done tasks are kept
// (the planner shows them with their «تمام‌شده» state).
export function myTodayTasks(tasks, meId, now = new Date()) {
  const todayKey = tehranDayKey(now)
  return (tasks || [])
    .filter((t) => t.assignee_id === meId && t.due_at && tehranDayKey(t.due_at) === todayKey)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
}

// #59 (100-list): overdue tasks — the existing isOverdueTask rule,
// sorted by due date (most overdue first).
export function overdueTasks(tasks, now = new Date()) {
  return (tasks || [])
    .filter((t) => isOverdueTask(t, now))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
}

// #63 (100-list): undated unfinished tasks — they never appear in
// today/week/month and are invisible in every planner menu.
export function undatedTasks(tasks) {
  return (tasks || [])
    .filter((t) => t.status !== 'done' && !t.due_at)
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
}

// #64 (100-list): unassigned unfinished tasks. Oldest first.
export function unassignedTasks(tasks) {
  return (tasks || [])
    .filter((t) => t.status !== 'done' && !t.assignee_id)
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
}

// #71 (100-list): my reminders due today (Tehran) and not done.
export function todayReminders(reminders, now = new Date()) {
  const todayKey = tehranDayKey(now)
  return (reminders || [])
    .filter((r) => !r.done && r.remind_at && tehranDayKey(r.remind_at) === todayKey)
    .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
}

// #72 (100-list): my overdue reminders — remind_at past and not done
// (the same rule as isOverdue in work.js). Earliest first.
export function overdueReminders(reminders, now = new Date()) {
  const n = toDate(now).getTime()
  return (reminders || [])
    .filter((r) => !r.done && r.remind_at && new Date(r.remind_at).getTime() < n)
    .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
}

// #84 (100-list): search inside doc text — pure matching over
// [{ docId, title, text }] (the loader decodes the Yjs base64 with
// textFromStateB64). Lines containing the word, verbatim, up to 5 per
// doc; docs without the word are not returned.
export function searchDocLines(docsWithText, word) {
  const q = String(word || '').trim()
  if (!q) return []
  const out = []
  for (const d of docsWithText || []) {
    const lines = splitLines(d.text).filter((l) => l.includes(q))
    if (lines.length === 0) continue
    out.push({ docId: d.docId, title: d.title, lines: lines.slice(0, 5), total: lines.length })
  }
  return out
}

// #95 (100-list): last activity per member — the newest row of each
// member across messages (author), docs (creator, updated_at),
// tasks (creator or assignee, completed_at or created_at) and files
// (uploader). A member with no row at all gets activity: null.
// Honest limit: a doc's activity is attributed to its creator — the
// docs row carries no "last edited by" member.
export function lastActivityByMember({ messages = [], docs = [], tasks = [], files = [] }, members = []) {
  const out = []
  for (const m of members || []) {
    let best = null
    const consider = (kind, at, label) => {
      if (!at) return
      const ms = new Date(at).getTime()
      if (Number.isNaN(ms)) return
      if (!best || ms > best.ms) best = { kind, at, ms, label }
    }
    for (const msg of messages || []) {
      if (msg.author_id === m.id) consider('message', msg.created_at, 'پیام')
    }
    for (const d of docs || []) {
      if (d.created_by === m.id) consider('doc', d.updated_at || d.created_at, 'سند «' + d.title + '»')
    }
    for (const t of tasks || []) {
      if (t.created_by === m.id || t.assignee_id === m.id) {
        consider('task', t.completed_at || t.created_at, 'کار «' + t.title + '»')
      }
    }
    for (const f of files || []) {
      if (f.uploaded_by === m.id) consider('file', f.uploaded_at, 'فایل «' + f.name + '»')
    }
    out.push({
      memberId: m.id,
      name: m.name,
      username: m.username,
      activity: best ? { kind: best.kind, at: best.at, label: best.label } : null
    })
  }
  return out
}

// ---------- P01 block D: Muse AI — deadline guardian + chat-to-task ----------

// Both features are EXTRACTIVE-ONLY: they quote and point at real rows,
// never invent content. `now` is passed in so the sandbox probe can pin
// the clock. The guardian buckets are disjoint and cover unfinished
// work only (a done task needs no guardian):
//   overdue = due_at past and status != done (same rule as A4/C2)
//   today   = due on the Tehran calendar day, not overdue
//   soon    = due after today, within the next 48 hours
// Reminders of the signed-in member due today ride along as
// remindersToday. found is false only when all four lists are empty.
export function computeDeadlineGuardian(tasks, reminders, now = new Date()) {
  const n = toDate(now)
  const nowMs = n.getTime()
  const todayKey = tehranDayKey(n)
  const todayEndMs = new Date(endOfTehranDay(todayKey)).getTime()
  const soonEndMs = nowMs + 48 * 60 * 60 * 1000
  const today = []
  const overdue = []
  const soon = []
  for (const t of tasks || []) {
    if (t.status === 'done' || !t.due_at) continue
    const dueMs = new Date(t.due_at).getTime()
    if (Number.isNaN(dueMs)) continue
    if (dueMs < nowMs) overdue.push(t)
    else if (tehranDayKey(t.due_at) === todayKey) today.push(t)
    else if (dueMs > todayEndMs && dueMs <= soonEndMs) soon.push(t)
  }
  overdue.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  today.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  soon.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  const remindersToday = (reminders || []).filter(
    (r) => !r.done && r.remind_at && tehranDayKey(r.remind_at) === todayKey
  )
  const found =
    today.length + overdue.length + soon.length + remindersToday.length > 0
  return { today, overdue, soon, remindersToday, found, generatedAt: n.toISOString() }
}

// Suggested due date for a chat/doc suggestion. A transparent,
// documented heuristic — the content (title/quote) is always verbatim;
// only this default deadline is a suggestion: a line saying «فردا»
// suggests tomorrow, «امروز» suggests today, anything else suggests
// the end of the day after tomorrow.
export function suggestDueAt(line, now = new Date()) {
  const n = toDate(now)
  const text = String(line || '')
  if (text.includes('فردا')) return endOfTehranDay(tehranDayKey(addTehranDays(n, 1)))
  if (text.includes('امروز')) return endOfTehranDay(tehranDayKey(n))
  return endOfTehranDay(tehranDayKey(addTehranDays(n, 2)))
}

// D2: task suggestions from room messages. One suggestion per action
// line (the same ACTION_MARKERS rule as the doc suggestions). The
// suggested assignee is the message's author — the person who raised
// it; the title and quote are the line verbatim; the due date is
// suggestDueAt's transparent default. source_message_id points at the
// message row.
export function extractChatTaskSuggestions(messages, now = new Date(), limit = 8) {
  const out = []
  const seen = new Set()
  for (const m of messages || []) {
    for (const line of splitLines(m.body)) {
      if (out.length >= limit) return out
      if (line.length < 6 || seen.has(line)) continue
      const listed = /^([-*•·\d]+[.)\]]|\(?\d+[.)])\s/.test(line)
      const hasVerb = ACTION_MARKERS.some((v) => line.includes(v))
      if (!listed && !hasVerb) continue
      seen.add(line)
      out.push({
        title: line,
        assigneeId: m.author_id || null,
        dueAt: suggestDueAt(line, now),
        quote: line,
        source_message_id: m.id || null,
        source_doc_id: null
      })
    }
  }
  return out
}

// D2: the same rule over doc text. A doc line has no per-line author,
// so the suggested assignee is null — the user picks one when creating.
export function extractDocTaskSuggestions(text, docId, now = new Date(), limit = 8) {
  const out = []
  const seen = new Set()
  for (const line of splitLines(text)) {
    if (out.length >= limit) break
    if (line.length < 6 || seen.has(line)) continue
    const listed = /^([-*•·\d]+[.)\]]|\(?\d+[.)])\s/.test(line)
    const hasVerb = ACTION_MARKERS.some((v) => line.includes(v))
    if (!listed && !hasVerb) continue
    seen.add(line)
    out.push({
      title: line,
      assigneeId: null,
      dueAt: suggestDueAt(line, now),
      quote: line,
      source_message_id: null,
      source_doc_id: docId || null
    })
  }
  return out
}

// ---------- فاز ۷: بودجه / برن‌داون / گانت (SVG دست‌ساز، بدون کتابخانه) ----------

// گرنت فراخوان ۱۴۰۳ (D6 الف). رقم جاری نیست — رقم جاری گرنت باید از
// فراخوان فعال پارک بررسی شود؛ پنل بودجه این را همیشه نشان می‌دهد.
export const GRANT_RIALLS = 435000000
// سرفصل‌های آیین‌نامه (۱۰ / ۶۰ / ۳۰) — سقف‌های مجاز بر مبنای گرنت.
export const BUDGET_CAPS = { training: 0.1, rnd: 0.6, personnel: 0.3 }

// بودجه از ردیف‌های جدول هزینه‌های فرم فاز ۶ (بخش ۲-ج کاربرگ).
// نگاشت (مستند، نه حدس): ردیف «تجهیزات» زیر سقف تحقیق‌وتوسعهٔ ۶۰٪
// می‌نشیند (آیین‌نامه: خرید قطعات و تجهیزات مورد نیاز اجرای پروژه از
// هزینه‌های مجاز تحقیق‌وتوسعه است) و ردیف «دستیار پژوهشی» زیر سقف
// نیروی انسانی ۳۰٪. سرفصل «آموزش» ۱۰٪ در فرم ردیفی ندارد — فقط سقفش
// نشان داده می‌شود. هشدارها فقط وقتی جمع‌ها واقعاً از سقف گذشته‌اند.
export function computeBudget(costRows, opts = {}) {
  const grant = opts.grant ?? GRANT_RIALLS
  const isSoftTech = opts.isSoftTech === true
  const rows = (costRows || []).filter(
    (r) => r && typeof r.amount !== 'undefined' && r.amount !== '' && !Number.isNaN(Number(r.amount))
  )
  const total = rows.reduce((a, r) => a + Number(r.amount), 0)
  const equipmentTotal = rows
    .filter((r) => r.kind === 'تجهیزات')
    .reduce((a, r) => a + Number(r.amount), 0)
  const assistantTotal = rows
    .filter((r) => r.kind === 'دستیار پژوهشی')
    .reduce((a, r) => a + Number(r.amount), 0)
  const caps = {
    training: Math.round(grant * BUDGET_CAPS.training),
    rnd: Math.round(grant * BUDGET_CAPS.rnd),
    personnel: Math.round(grant * BUDGET_CAPS.personnel)
  }
  const warnings = []
  if (total > grant)
    warnings.push(
      'جمع ریز هزینه‌ها (' + faNum(total) + ' ریال) از گرنت (' + faNum(grant) + ' ریال) بیشتر است.'
    )
  if (equipmentTotal > caps.rnd)
    warnings.push(
      'جمع تجهیزات (' + faNum(equipmentTotal) + ' ریال) از سقف تحقیق‌وتوسعه (۶۰٪ گرنت) گذشته است.'
    )
  if (assistantTotal > caps.personnel)
    warnings.push(
      'جمع دستیار پژوهشی (' + faNum(assistantTotal) + ' ریال) از سقف نیروی انسانی (۳۰٪ گرنت) گذشته است.'
    )
  if (total > 0) {
    const assistShareCap = isSoftTech ? 0.5 : 0.2
    if (assistantTotal / total > assistShareCap)
      warnings.push(
        'سهم دستیار پژوهشی از کل هزینه‌ها بیش از ' +
          faNum(Math.round(assistShareCap * 100)) +
          '٪ است (سقف فناوری ' +
          (isSoftTech ? 'نرم' : 'سخت') +
          ').'
      )
  }
  const equipPct = opts.equipmentPct
  const assistPct = opts.assistantPct
  if (
    equipPct !== '' &&
    equipPct !== null &&
    equipPct !== undefined &&
    assistPct !== '' &&
    assistPct !== null &&
    assistPct !== undefined &&
    !Number.isNaN(Number(equipPct)) &&
    !Number.isNaN(Number(assistPct)) &&
    Number(equipPct) + Number(assistPct) !== 100
  ) {
    warnings.push(
      'جمع درصد اعلام‌شدهٔ تجهیزات و دستیار پژوهشی ' +
        faNum(Number(equipPct) + Number(assistPct)) +
        '٪ است؛ باید ۱۰۰٪ شود.'
    )
  }
  return {
    grant,
    total,
    equipmentTotal,
    assistantTotal,
    caps,
    byCategory: [
      { key: 'training', label: 'آموزش', cap: caps.training, actual: 0, note: 'در فرم ردیفی ندارد' },
      { key: 'rnd', label: 'تحقیق و توسعه', cap: caps.rnd, actual: equipmentTotal, note: 'ردیف‌های «تجهیزات»' },
      { key: 'personnel', label: 'نیروی انسانی', cap: caps.personnel, actual: assistantTotal, note: 'ردیف‌های «دستیار پژوهشی»' }
    ],
    warnings,
    grantNote: 'رقم گرنت از فراخوان ۱۴۰۳ است؛ رقم جاری باید از فراخوان فعال پارک بررسی شود.'
  }
}

// برن‌داون: خط ایده‌آل (از کل کارها در شروع تا صفر در پایان، خطی) در
// برابر خط واقعی (باقی‌مانده بر مبنای completed_at). محور زمان مثل
// نمودار پالس راست‌به‌چپ است: شروع راست، پایان چپ. روزهای کاری از
// start تا end؛ اگر start/end یا کارها نباشند null برمی‌گردد.
export function computeBurndown(tasks, startIso, endIso, nowIso) {
  const list = tasks || []
  if (list.length === 0 || !startIso || !endIso) return null
  const start = new Date(startIso)
  const end = new Date(endIso)
  const now = nowIso ? new Date(nowIso) : new Date()
  if (!(start.getTime() <= end.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const totalDays = Math.max(1, Math.round((end - start) / dayMs))
  if (totalDays > 400) return null
  const total = list.length
  const doneAt = (dayEnd) => list.filter((t) => t.status === 'done' && t.completed_at && new Date(t.completed_at) <= dayEnd).length
  const points = []
  const labels = []
  const horizon = now < end ? now : end
  const horizonDays = Math.max(0, Math.round((horizon - start) / dayMs))
  for (let i = 0; i <= horizonDays; i++) {
    const dayEnd = new Date(start.getTime() + i * dayMs + dayMs - 1)
    points.push({ day: i, remaining: total - doneAt(dayEnd) })
    labels.push(i)
  }
  const W = 600
  const H = 180
  const PAD_L = 8
  const PAD_R = 44
  const PAD_T = 12
  const PAD_B = 26
  const x = (i) => W - PAD_R - (i / totalDays) * (W - PAD_L - PAD_R)
  const y = (v) => H - PAD_B - (v / Math.max(1, total)) * (H - PAD_T - PAD_B)
  const idealPoints = x(0).toFixed(1) + ',' + y(total).toFixed(1) + ' ' + x(totalDays).toFixed(1) + ',' + y(0).toFixed(1)
  const actualPoints = points.map((p) => x(p.day).toFixed(1) + ',' + y(p.remaining).toFixed(1)).join(' ')
  const idealNow = total * (1 - horizonDays / totalDays)
  const actualNow = points.length > 0 ? points[points.length - 1].remaining : total
  return {
    width: W,
    height: H,
    total,
    totalDays,
    idealPoints,
    actualPoints,
    labels,
    doneCount: list.filter((t) => t.status === 'done').length,
    remaining: actualNow,
    behind: actualNow > idealNow + 0.5,
    startLabel: start.toISOString().slice(0, 10),
    endLabel: end.toISOString().slice(0, 10)
  }
}

// گانت: هر کارِ دارای created_at و due_at یک میله است (شروع راست،
// پایان چپ — مثل بقیهٔ نمودارها)؛ کارهای بدون تاریخ در فهرست «بی‌زمان»
// می‌آیند، نه در نمودار. اگر پنجرهٔ زمانی نباشد null برمی‌گردد.
export function computeGantt(tasks, startIso, endIso) {
  const list = tasks || []
  if (!startIso || !endIso) return null
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (!(start.getTime() < end.getTime())) return null
  const W = 600
  const ROW_H = 34
  const BAR_H = 10
  const PAD_L = 8
  const PAD_R = 8
  const plotW = W - PAD_L - PAD_R
  const span = end - start
  const x = (t) => W - PAD_R - ((new Date(t) - start) / span) * plotW
  const rows = []
  const undated = []
  for (const t of list) {
    if (!t.created_at || !t.due_at) {
      undated.push(t.title)
      continue
    }
    const x1 = Math.max(W - PAD_R - plotW, Math.min(W - PAD_R, x(t.created_at)))
    const x2 = Math.max(W - PAD_R - plotW, Math.min(W - PAD_R, x(t.due_at)))
    const top = rows.length * ROW_H
    rows.push({
      taskId: t.id,
      title: t.title,
      status: t.status,
      x: Math.min(x1, x2),
      width: Math.max(2, Math.abs(x1 - x2)),
      y: top + 16,
      labelY: top + 11
    })
  }
  return {
    width: W,
    height: Math.max(ROW_H, rows.length * ROW_H),
    rows,
    undated,
    startLabel: start.toISOString().slice(0, 10),
    endLabel: end.toISOString().slice(0, 10)
  }
}

// ---------- فاز ۸: درخت کارها (زیروظیفه) — آینهٔ توابع درخت سند ----------
export function buildTaskTree(tasks) {
  const list = tasks || []
  const byId = new Map(list.map((t) => [t.id, t]))
  const nodes = new Map(list.map((t) => [t.id, { ...t, children: [] }]))
  const roots = []
  for (const t of list) {
    const node = nodes.get(t.id)
    const pid = t.parent_id || null
    // والد قابل‌استفاده: هست، خود کار نیست، و چرخه نمی‌بندد. والدی که
    // در همین فهرست نیست (مثلاً در منوی برنامه‌ریز فیلتر شده) یعنی
    // کار در این نما ریشه حساب می‌شود — نه گم‌شده.
    let ok = false
    if (pid && pid !== t.id && byId.has(pid)) {
      ok = true
      const seen = new Set([t.id])
      let cur = pid
      while (cur) {
        if (seen.has(cur)) {
          ok = false
          break
        }
        seen.add(cur)
        const up = byId.get(cur)
        cur = up ? up.parent_id || null : null
      }
    }
    if (ok) nodes.get(pid).children.push(node)
    else roots.push(node)
  }
  return roots
}

// اجداد کار، از ریشه (خود کار بیرون است). ضدچرخه.
export function taskAncestors(tasks, taskId) {
  const byId = new Map((tasks || []).map((t) => [t.id, t]))
  const out = []
  const seen = new Set([taskId])
  let cur = byId.get(taskId)
  while (cur && cur.parent_id) {
    const pid = cur.parent_id
    if (seen.has(pid)) break
    seen.add(pid)
    const up = byId.get(pid)
    if (!up) break
    out.unshift(up)
    cur = up
  }
  return out
}

// True وقتی taskId خود ancestorId است یا زیر آن نشسته است. ضدچرخه.
export function isTaskDescendantOf(tasks, taskId, ancestorId) {
  if (taskId === ancestorId) return true
  const byId = new Map((tasks || []).map((t) => [t.id, t]))
  const seen = new Set([taskId])
  let cur = byId.get(taskId)
  while (cur && cur.parent_id) {
    const pid = cur.parent_id
    if (pid === ancestorId) return true
    if (seen.has(pid)) break
    seen.add(pid)
    cur = byId.get(pid)
  }
  return false
}

// اعتبارسنجی والد تازه (null = برگرداندن به ریشه).
// پیام روشن فارسی برمی‌گرداند، یا null وقتی جابه‌جایی مجاز است.
export function validateTaskParent(tasks, taskId, newParentId) {
  if (!newParentId) return null
  if (newParentId === taskId) return 'کار نمی‌تواند زیرِ خودش باشد.'
  const list = tasks || []
  const parent = list.find((t) => t.id === newParentId)
  if (!parent) return 'کار والد پیدا نشد.'
  if (isTaskDescendantOf(list, newParentId, taskId)) {
    return 'این کار زیرمجموعهٔ کارِ فعلی است؛ چرخه ساخته نمی‌شود.'
  }
  return null
}

// گزینه‌های والد برای انتخاب‌گر: همهٔ کارها به‌جز خود کار و فرزندانش.
export function taskParentOptions(tasks, taskId) {
  return (tasks || []).filter(
    (t) => t.id !== taskId && !isTaskDescendantOf(tasks, t.id, taskId)
  )
}
