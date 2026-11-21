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
