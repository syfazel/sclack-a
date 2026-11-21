// Pure mention helpers (no DOM, no Supabase) — the probe imports these
// as the oracle, and ChatView + chat.js use the same functions so the
// UI, the stored mentions[] and the notification recipients can never
// drift apart.
//
// A mention token is `@` + one of a member's names. Every member has a
// DISPLAY name (members.name — what the member list and the message
// author line show) and, after the G2 migration, a stable USERNAME
// (members.username — the email local part, e.g. zahraariapour97).
// Both are mentionable: typing «@زهرا» and typing «@zahra» suggest the
// same person.
//
// WHY two names: live, members.name used to BE the username
// (ensureMember wrote the email local part), so «@زهرا» matched
// nothing while «@zahra» matched — the sandbox probe seeded display
// names, so it passed while live failed. The fix: match on both, and
// keep the display name in `name` (ensureMember never overwrites it
// anymore). Rows without a username yet (pre-migration) match by name
// only — the helpers degrade gracefully.
//
// Names are matched longest-first so `@زهرا آریاپور` wins over a shorter
// `@زهرا` when both exist. A token ends at whitespace, punctuation or
// end of text. Suggestion matching is case-insensitive (typing «@ZAHRA»
// still finds zahraariapour97); parsing/rendering stay exact — the
// token stored in the message is verbatim.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every token a member can be mentioned by: display name first, then
// the username when it differs. Rows without a username yield one token.
export function mentionNames(m) {
  const out = []
  if (m && m.name) out.push(m.name)
  if (m && m.username && m.username !== m.name) out.push(m.username)
  return out
}

export function sortedMembersByNameLength(members) {
  return [...(members || [])]
    .filter((m) => m && m.name)
    .sort((a, b) => b.name.length - a.name.length)
}

// All (member, token) pairs, longest token first — so a longer token
// (a full display name, or a long username) always wins over a shorter
// one that is its prefix, whichever field it came from.
function sortedMentionTokens(members) {
  const pairs = []
  for (const m of members || []) {
    for (const token of mentionNames(m)) pairs.push({ id: m.id, token })
  }
  return pairs.sort((a, b) => b.token.length - a.token.length)
}

// Parse @name tokens out of message text. Returns member ids, in order
// of first appearance, deduplicated. The author's own id is NOT removed
// here — callers decide (chat.js drops self-mentions from notifications,
// but still stores the mention so the highlight renders for everyone).
// Two guards: the '@' must start the text or follow whitespace (so
// 'a@زهرا' is not a mention), and a shorter name that is a prefix of a
// longer name matched at the same spot does not count twice — the
// longest match consumes its span.
export function parseMentions(text, members) {
  const body = text || ''
  const found = [] // { id, pos }
  const seenIds = new Set()
  const consumed = [] // [start, end) spans taken by longer names
  for (const { id, token } of sortedMentionTokens(members)) {
    if (seenIds.has(id)) continue // one entry per member, whichever token matched
    const re = new RegExp('@' + escapeRegExp(token) + '(?=$|[\\s,،؛:.!؟?\\n])', 'g')
    let match
    while ((match = re.exec(body)) !== null) {
      const start = match.index
      const end = start + match[0].length
      const before = start === 0 ? '' : body[start - 1]
      if (before !== '' && !/[\s\n]/.test(before)) continue
      if (consumed.some(([s, e]) => start >= s && start < e)) continue
      consumed.push([start, end])
      found.push({ id, pos: start })
      seenIds.add(id)
      break // one entry per member is enough; later occurrences add nothing
    }
  }
  return found.sort((a, b) => a.pos - b.pos).map((f) => f.id)
}

// The mention prefix being typed right now: the text after the last '@'
// before the caret, or null when there is no open '@' (closed by a space
// or newline, or no '@' at all). Returns { prefix, atIndex }.
export function mentionPrefixAt(text, caret) {
  const upto = (text || '').slice(0, caret ?? (text || '').length)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  const prefix = upto.slice(at + 1)
  if (/[\s\n]/.test(prefix)) return null
  return { prefix, atIndex: at }
}

// Members whose display name OR username starts with the typed prefix
// (empty prefix = all). Case-insensitive: «@zahra» and «@ZAHRA» find the
// same member, and so does «@زهرا» when the display name is زهرا.
export function filterMentionSuggestions(text, caret, members) {
  const found = mentionPrefixAt(text, caret)
  if (!found) return []
  const p = found.prefix.toLowerCase()
  return (members || []).filter(
    (m) =>
      m &&
      mentionNames(m).some((name) => name.toLowerCase().startsWith(p))
  )
}

// Split a message body into render segments: { text, mentionId } where
// mentionId is set only for an exact @name token (display name or
// username). Longest token first, so a shorter name that is a prefix of
// a longer one never steals it.
export function renderMentionSegments(body, members) {
  const text = body || ''
  const ordered = sortedMentionTokens(members)
  const segments = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /[\s\n]/.test(text[i - 1]))) {
      let hit = null
      for (const { id, token } of ordered) {
        const full = '@' + token
        if (text.startsWith(full, i)) {
          const after = text[i + full.length]
          if (after === undefined || /[\s,،؛:.!؟?\n]/.test(after)) {
            hit = { id, token }
            break
          }
        }
      }
      if (hit) {
        segments.push({ text: '@' + hit.token, mentionId: hit.id })
        i += ('@' + hit.token).length
        continue
      }
    }
    // Plain run until the next '@' that starts a real token.
    let j = i + 1
    while (j < text.length) {
      if (text[j] === '@' && /[\s\n]/.test(text[j - 1])) {
        let isToken = false
        for (const { id, token } of ordered) {
          const full = '@' + token
          if (text.startsWith(full, j)) {
            const after = text[j + full.length]
            if (after === undefined || /[\s,،؛:.!؟?\n]/.test(after)) {
              isToken = true
              break
            }
          }
        }
        if (isToken) break
      }
      j++
    }
    segments.push({ text: text.slice(i, j), mentionId: null })
    i = j
  }
  return segments
}
