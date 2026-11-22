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

// Escape PostgREST ilike wildcards (Space bug #4: '%' and '_' were treated
// as wildcards in global search). Backslash first, then % and _.
export function escapeSearchPattern(q) {
  return String(q || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
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
