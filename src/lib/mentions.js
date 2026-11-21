// Pure mention helpers (no DOM, no Supabase) — the probe imports these
// as the oracle, and ChatView + chat.js use the same functions so the
// UI, the stored mentions[] and the notification recipients can never
// drift apart.
//
// A mention token is `@` + a member's exact name. Names are matched
// longest-first so `@زهرا آریاپور` wins over a shorter `@زهرا` when both
// exist. A token ends at whitespace, punctuation or end of text.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sortedMembersByNameLength(members) {
  return [...(members || [])]
    .filter((m) => m && m.name)
    .sort((a, b) => b.name.length - a.name.length)
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
  const consumed = [] // [start, end) spans taken by longer names
  for (const m of sortedMembersByNameLength(members)) {
    const re = new RegExp('@' + escapeRegExp(m.name) + '(?=$|[\\s,،؛:.!؟?\\n])', 'g')
    let match
    while ((match = re.exec(body)) !== null) {
      const start = match.index
      const end = start + match[0].length
      const before = start === 0 ? '' : body[start - 1]
      if (before !== '' && !/[\s\n]/.test(before)) continue
      if (consumed.some(([s, e]) => start >= s && start < e)) continue
      consumed.push([start, end])
      found.push({ id: m.id, pos: start })
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

// Members whose name starts with the typed prefix (empty prefix = all).
export function filterMentionSuggestions(text, caret, members) {
  const found = mentionPrefixAt(text, caret)
  if (!found) return []
  const p = found.prefix
  return (members || []).filter((m) => m && m.name && m.name.startsWith(p))
}

// Split a message body into render segments: { text, mentionId } where
// mentionId is set only for an exact @name token. Longest name first,
// so a shorter name that is a prefix of a longer one never steals it.
export function renderMentionSegments(body, members) {
  const text = body || ''
  const ordered = sortedMembersByNameLength(members)
  const segments = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /[\s\n]/.test(text[i - 1]))) {
      let hit = null
      for (const m of ordered) {
        const token = '@' + m.name
        if (text.startsWith(token, i)) {
          const after = text[i + token.length]
          if (after === undefined || /[\s,،؛:.!؟?\n]/.test(after)) {
            hit = m
            break
          }
        }
      }
      if (hit) {
        segments.push({ text: '@' + hit.name, mentionId: hit.id })
        i += ('@' + hit.name).length
        continue
      }
    }
    // Plain run until the next '@' that starts a real token.
    let j = i + 1
    while (j < text.length) {
      if (text[j] === '@' && /[\s\n]/.test(text[j - 1])) {
        let isToken = false
        for (const m of ordered) {
          const token = '@' + m.name
          if (text.startsWith(token, j)) {
            const after = text[j + token.length]
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
