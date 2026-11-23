// Jarvis AI — server-side retrieval (Phase 1).
//
// Pure JS: no Deno APIs, no direct network — everything goes through the
// injected fetchFn (global fetch in production, a stub in the probe).
// Every read uses the CALLER's JWT + anon key, so RLS applies exactly
// as in the app. No service-role key, ever. The function writes nothing.
//
// This is the same retrieval the client did in package B
// (buildContext in assistant-prompts.js, searchWorkspace in work.js),
// moved here so the function — not the client — owns what the model
// sees (R1, server-side). The client now sends only { action, params,
// history }; the prompt text is composed here, from the same templates
// the registry used, and the valid source set comes from these reads.
//
// ctx = { fetchFn, supabaseUrl, restHeaders, decodeDocText }
//   decodeDocText(b64) — injected Yjs decoder (index.ts: real one via
//   esm.sh yjs; the probe builds one from the installed yjs package).
//   If absent, doc text reads as '' (empty doc).

export const MAX_CONTEXT_CHARS = 8000
export const MAX_HISTORY_TURNS = 10
export const MAX_HISTORY_CHARS = 8000
const MAX_ROWS_PER_SOURCE = 20
const MAX_ROOM_MESSAGES = 50

// Same escaping as extract.js escapeSearchPattern: % _ \ are escaped
// so a user's question cannot break the ilike pattern.
export function escapeSearchPattern(q) {
  return String(q || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// PostgREST reports an unknown column as PGRST204 (schema cache) or
// the Postgres 42703; the message patterns cover both, same as the
// client's isMissingColumnError (docs.js).
function isMissingColumnBody(body) {
  if (!body || typeof body !== 'object') return false
  if (body.code === '42703' || body.code === 'PGRST204') return true
  const m = body.message || String(body)
  return /undefined column/i.test(m) || /column .* does not exist/i.test(m)
}

function truncateLines(lines, maxChars) {
  let used = 0
  const out = []
  for (const line of lines) {
    if (used + line.length > maxChars) break
    out.push(line)
    used += line.length + 1
  }
  return out
}

// One PostgREST GET. Returns { ok, rows, status, total, error } —
// total comes from the content-range header when countExact is set
// (Prefer: count=exact); otherwise it is rows.length.
async function restGet(ctx, table, params, countExact = false) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v))
  }
  const headers = { ...ctx.restHeaders }
  if (countExact) headers.Prefer = 'count=exact'
  const res = await ctx.fetchFn(ctx.supabaseUrl + '/rest/v1/' + table + '?' + qs.toString(), {
    headers
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) return { ok: false, rows: [], status: res.status, total: 0, error: body }
  const rows = Array.isArray(body) ? body : []
  let total = rows.length
  if (countExact) {
    const range = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('content-range')
      : null
    const m = range && /\/(\d+)$/.exec(range)
    if (m) total = Number(m[1])
  }
  return { ok: true, rows, status: res.status, total, error: null }
}

// ---------- workspace search (server twin of work.js searchWorkspace) ----------
// Hits keep the client's shape: { kind, kindLabel, id, title, place,
// link, at, matchIn } — the model cites { table, id } and the handler
// enriches them from these hits, so the UI (which renders kindLabel /
// place / title / link) keeps working without the client re-reading.

export async function searchWorkspaceServer(ctx, query) {
  const q = (query || '').trim()
  if (!q) return { hits: [], partialErrors: [] }
  const pattern = '%' + escapeSearchPattern(q) + '%'

  const docsWithText = () =>
    restGet(ctx, 'docs', {
      select: 'id,title,search_text,created_at,project_id,projects(name)',
      or: '(title.ilike.' + pattern + ',search_text.ilike.' + pattern + ')',
      order: 'created_at.desc',
      limit: String(MAX_ROWS_PER_SOURCE)
    })
  const docsTitleOnly = () =>
    restGet(ctx, 'docs', {
      select: 'id,title,created_at,project_id,projects(name)',
      title: 'ilike.' + pattern,
      order: 'created_at.desc',
      limit: String(MAX_ROWS_PER_SOURCE)
    })

  const settled = await Promise.allSettled([
    restGet(ctx, 'messages', {
      select: 'id,body,created_at,room_id,rooms(name)',
      body: 'ilike.' + pattern,
      order: 'created_at.desc',
      limit: String(MAX_ROWS_PER_SOURCE)
    }),
    // Docs: title-or-search_text first; if the search_text column is
    // not live yet, fall back silently to title-only (same as the
    // client) — the search still works, it just does not grep doc text.
    (async () => {
      const first = await docsWithText()
      if (!first.ok && isMissingColumnBody(first.error)) return docsTitleOnly()
      return first
    })(),
    restGet(ctx, 'files', {
      select: 'id,name,uploaded_at,project_id,projects(name)',
      name: 'ilike.' + pattern,
      order: 'uploaded_at.desc',
      limit: String(MAX_ROWS_PER_SOURCE)
    }),
    restGet(ctx, 'tasks', {
      select: 'id,title,description,created_at,project_id,projects(name)',
      or: '(title.ilike.' + pattern + ',description.ilike.' + pattern + ')',
      order: 'created_at.desc',
      limit: String(MAX_ROWS_PER_SOURCE)
    })
  ])

  const hits = []
  const partialErrors = []
  const byName = {}
  const names = ['پیام‌ها', 'سندها', 'فایل‌ها', 'کارها']
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.ok) {
      byName[names[i]] = r.value.rows
    } else {
      const msg =
        r.status === 'rejected'
          ? r.reason?.message || String(r.reason)
          : r.value.error?.message || String(r.value.error)
      partialErrors.push({ source: names[i], message: msg })
    }
  })
  for (const m of byName['پیام‌ها'] || []) {
    hits.push({
      kind: 'message',
      kindLabel: 'پیام',
      id: m.id,
      title: m.body,
      place: m.rooms?.name || 'اتاق',
      link: '#/room/' + m.room_id,
      at: m.created_at
    })
  }
  for (const d of byName['سندها'] || []) {
    const titleMatch = (d.title || '').toLowerCase().includes(q.toLowerCase())
    const textMatch = !!d.search_text
    hits.push({
      kind: 'doc',
      kindLabel: 'سند',
      id: d.id,
      title: d.title,
      place: d.projects?.name || 'پروژه',
      link: '#/doc/' + d.id,
      at: d.created_at,
      matchIn: titleMatch && textMatch ? 'both' : textMatch ? 'text' : 'title'
    })
  }
  for (const f of byName['فایل‌ها'] || []) {
    hits.push({
      kind: 'file',
      kindLabel: 'فایل',
      id: f.id,
      title: f.name,
      place: f.projects?.name || 'پروژه',
      link: '#/',
      at: f.uploaded_at
    })
  }
  for (const t of byName['کارها'] || []) {
    hits.push({
      kind: 'task',
      kindLabel: 'کار',
      id: t.id,
      title: t.title,
      place: t.projects?.name || 'پروژه',
      link: '#/tasks',
      at: t.created_at
    })
  }
  hits.sort((a, b) => new Date(b.at) - new Date(a.at))
  if (partialErrors.length > 0 && hits.length === 0) {
    throw new Error(partialErrors[0].message)
  }
  return { hits, partialErrors }
}

// ---------- room + doc reads ----------

// Last 50 messages of the room, ascending (the client's
// loadRoomMessages took the last 50 of up to 200). total is the true
// room count from content-range — more honest than the client's
// "messages.length" (capped at 200).
export async function loadRoomMessagesServer(ctx, roomId) {
  const res = await restGet(
    ctx,
    'messages',
    {
      select: 'id,body,created_at',
      room_id: 'eq.' + roomId,
      order: 'created_at.desc',
      limit: String(MAX_ROOM_MESSAGES)
    },
    true
  )
  if (!res.ok) throw new Error(res.error?.message || 'room read failed')
  const messages = [...res.rows].reverse()
  return { messages, total: res.total }
}

// Doc row + decoded text. Returns null when the doc is not visible to
// the caller (RLS) or does not exist. decodeDocText is injected; if it
// is absent the text reads as '' (empty doc).
export async function loadDocServer(ctx, docId) {
  const res = await restGet(ctx, 'docs', {
    select: 'id,title,custom_fields',
    id: 'eq.' + docId,
    limit: '1'
  })
  if (!res.ok) throw new Error(res.error?.message || 'doc read failed')
  const row = res.rows[0]
  if (!row) return null
  let text = ''
  if (typeof ctx.decodeDocText === 'function') {
    try {
      text = ctx.decodeDocText(row.custom_fields?.yjs_state_b64) || ''
    } catch {
      text = ''
    }
  }
  return { row, text }
}

// ---------- per-action retrieval + user-text composition ----------
// Returns { userText, sourceIds, sources, paragraphCount, empty }.
// sourceIds: raw message ids (summarize-room). sources: enriched hits
// (ask-workspace / open-chat) — the handler validates the model's
// citations against exactly these. empty: nothing was retrieved, so
// the handler answers found:false without spending a model call.

export async function retrieveForAction(ctx, action, params, history) {
  if (action === 'summarize-room') {
    const { messages, total } = await loadRoomMessagesServer(ctx, params.roomId)
    const lines = messages.map((m) => '[' + m.id + '] ' + (m.body || ''))
    const kept = truncateLines(lines, MAX_CONTEXT_CHARS)
    const shownIds = messages.slice(0, kept.length).map((m) => m.id)
    return {
      userText:
        'این پیام‌های اتاق است (آخرین ' +
        kept.length +
        ' پیام از ' +
        total +
        ' پیام):\n' +
        kept.join('\n') +
        '\n— در حداکثر ۵ نکته، مهم‌ترین‌ها را با شناسهٔ منبع بنویس. اگر پیامی نیست، بنویس چیزی نیست.',
      sourceIds: shownIds,
      sources: [],
      paragraphCount: 0,
      empty: messages.length === 0
    }
  }
  if (action === 'summarize-doc') {
    const doc = await loadDocServer(ctx, params.docId)
    if (!doc) {
      return { userText: '', sourceIds: [], sources: [], paragraphCount: 0, empty: true }
    }
    const paragraphs = String(doc.text || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    const lines = paragraphs.map((p, i) => '[پاراگراف ' + (i + 1) + '] ' + p)
    const kept = truncateLines(lines, MAX_CONTEXT_CHARS)
    return {
      userText:
        'متن سند «' +
        (doc.row.title || '') +
        '» (پاراگراف‌بندی‌شده، ' +
        kept.length +
        ' پاراگراف از ' +
        paragraphs.length +
        '):\n' +
        kept.join('\n\n') +
        '\n— در حداکثر ۵ نکته، مهم‌ترین‌ها را با شمارهٔ پاراگراف بنویس.',
      sourceIds: [],
      sources: [],
      paragraphCount: paragraphs.length,
      empty: paragraphs.length === 0
    }
  }
  if (action === 'ask-workspace' || action === 'open-chat') {
    const question = action === 'ask-workspace' ? params.question : params.message
    const { hits } = await searchWorkspaceServer(ctx, question)
    const lines = hits
      .slice(0, MAX_ROWS_PER_SOURCE)
      .map((h) => '[' + h.kind + ':' + h.id + '] ' + h.kindLabel + ' — ' + h.title + ' (' + h.place + ')')
    const kept = truncateLines(lines, MAX_CONTEXT_CHARS)
    const sources = hits.slice(0, kept.length)
    let historyText = '—'
    let turns = 0
    if (action === 'open-chat') {
      const clean = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY_TURNS)
      turns = clean.length
      if (turns > 0) {
        historyText = clean
          .map((t) => (t.role === 'user' ? 'کاربر: ' : 'دستیار: ') + t.content)
          .join('\n')
      }
    }
    const userText =
      action === 'open-chat'
        ? 'سابقهٔ گفت‌وگو (آخرین ' +
          turns +
          ' نوبت):\n' +
          historyText +
          '\n— ردیف‌های مرتبط:\n' +
          kept.join('\n') +
          '\n— پیام کاربر: ' +
          question +
          '\n— جواب کوتاه فارسی با منبع. اگر جواب در ردیف‌ها و سابقه نیست، بنویس پیدا نشد.'
        : 'سؤال: ' +
          question +
          '\n— ردیف‌های مرتبط:\n' +
          kept.join('\n') +
          '\n— جواب کوتاه فارسی با منبع. اگر جواب در ردیف‌ها نیست، بنویس پیدا نشد.'
    return {
      userText,
      sourceIds: [],
      sources,
      paragraphCount: 0,
      // open-chat may still answer from history with no workspace hits;
      // ask-workspace with no hits has nothing to answer from.
      empty: hits.length === 0 && (action === 'ask-workspace' || turns === 0)
    }
  }
  throw new Error('unknown_action')
}
