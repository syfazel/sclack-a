// md-lite.js — Phase 4 (D3, option A): a hand-made lite-Markdown
// renderer + toolbar-insert helper for sclack_A rich docs.
//
// PURE: no Supabase, no DOM, no Yjs import — the sandbox probe runs it
// in Node unchanged. No new dependency.
//
// Supported syntax (plan phase 4, decision D3):
//   # / ## headings, **bold**, *italic*, - / 1. lists (Latin and
//   Persian/Arabic-Indic digits), Markdown tables -> real <table>,
//   [[doc title]] -> a clickable link to #/doc/<id>, resolved by exact
//   title inside the same project (from ws.docs). An unresolvable
//   [[title]] renders as plain text with the .md-wikilink-missing style
//   — a dead link is NEVER built.
// Raw HTML in the input is escaped first: user content is rendered as
// HTML, so without escaping this would be XSS.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Persian / Arabic-Indic digits -> Latin, for ordered-list numbers.
const FA_DIGITS = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
}
export function latinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] || d)
}

// Resolve a wikilink title to a doc row: exact trimmed-title match
// first, then a case-insensitive fallback. When several docs share a
// title, the most recently updated one wins (faz4 spec, §4 —
// implementation decision recorded here). `docs` is an array of
// { id, title, updated_at } (or a Map id -> row, or null).
export function resolveWikiDoc(docs, title) {
  const t = String(title || '').trim()
  if (!t) return null
  const list = Array.isArray(docs)
    ? docs
    : docs instanceof Map
      ? [...docs.values()]
      : []
  const byUpdated = (a, b) =>
    new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
  const exact = list
    .filter((d) => String(d.title || '').trim() === t)
    .sort(byUpdated)
  if (exact.length > 0) return exact[0]
  const lower = t.toLowerCase()
  const loose = list
    .filter((d) => String(d.title || '').trim().toLowerCase() === lower)
    .sort(byUpdated)
  return loose[0] || null
}

// Inline marks on already-escaped text: **bold** then *italic*.
// (Bold is consumed first, so the italic pass only sees single stars.)
function renderInlineMarks(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

// Inline rendering of one raw line: wikilinks are split out first so
// their title is looked up raw and escaped once on output; every other
// segment is escaped, then bold/italic are applied.
export function renderInline(raw, docs) {
  const parts = String(raw ?? '').split(/(\[\[[^\]]+\]\])/)
  return parts
    .map((p) => {
      const m = p.match(/^\[\[([^\]]+)\]\]$/)
      if (!m) return renderInlineMarks(escapeHtml(p))
      const title = m[1].trim()
      const doc = resolveWikiDoc(docs, title)
      if (doc) {
        return (
          '<a href="#/doc/' +
          escapeHtml(doc.id) +
          '" class="doc-wikilink">' +
          escapeHtml(title) +
          '</a>'
        )
      }
      // Never a dead link: plain text with the «not found» style plus
      // a small badge (faz4 spec §4).
      return (
        '<span class="doc-wikilink-missing" aria-label="سند یافت نشد">' +
        escapeHtml(title) +
        '</span> <span class="badge badge-ghost badge-sm">یافت نشد</span>'
      )
    })
    .join('')
}

function splitTableRow(line) {
  // '| a | b |' -> ['a', 'b']; leading/trailing empty cells dropped.
  const cells = line.trim().split('|')
  if (cells.length > 0 && cells[0].trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function isTableSeparator(line) {
  const t = line.trim()
  return /^\|[\s:|-]+\|$/.test(t) && t.replace(/[\s|:|-]/g, '').length === 0
}

const ORDERED_RE = /^([0-9۰-۹٠-٩]+)[.)]\s+(.*)$/
const UNORDERED_RE = /^[-*]\s+(.*)$/
const HEADING_RE = /^(#{1,2})\s+(.*)$/

// Render a gathered list block (two levels max, faz4 spec §2):
// items are { kind: 'ul'|'ol', level: 0|1, text }. Consecutive items
// of one kind at one level share a list element; deeper items nest
// inside the preceding item.
function renderListBlock(items, docs) {
  function renderLevel(list, level) {
    let html = ''
    let i = 0
    while (i < list.length) {
      const kind = list[i].kind
      const tag = kind === 'ol' ? 'ol' : 'ul'
      let inner = ''
      while (i < list.length && list[i].kind === kind && list[i].level === level) {
        const children = []
        let j = i + 1
        while (j < list.length && list[j].level > level) {
          children.push(list[j])
          j++
        }
        inner +=
          '<li>' + renderInline(list[i].text, docs) + renderLevel(children, level + 1) + '</li>'
        i = j
      }
      html += '<' + tag + '>' + inner + '</' + tag + '>'
    }
    return html
  }
  return renderLevel(items, 0)
}

// Full lite-Markdown render: HTML string. '' for blank input (the
// caller shows its own empty state instead of inventing one).
export function renderMdLite(text, docs) {
  const src = String(text ?? '')
  if (!src.trim()) return ''
  const lines = src.split(/\r?\n/)
  const out = []
  let para = []
  let listItems = [] // [{ kind, level, text }]

  function flushPara() {
    if (para.length === 0) return
    out.push('<p>' + para.map((l) => renderInline(l, docs)).join('<br>') + '</p>')
    para = []
  }
  function flushList() {
    if (listItems.length === 0) return
    out.push(renderListBlock(listItems, docs))
    listItems = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flushPara()
      flushList()
      i++
      continue
    }

    const heading = trimmed.match(HEADING_RE)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1].length === 1 ? 'h1' : 'h2'
      out.push('<' + level + '>' + renderInline(heading[2], docs) + '</' + level + '>')
      i++
      continue
    }

    // Markdown table: a run of |...| lines whose second line is a
    // separator row (| --- | --- |).
    if (trimmed.startsWith('|')) {
      const next = (lines[i + 1] || '').trim()
      if (isTableSeparator(next)) {
        flushPara()
        flushList()
        const header = splitTableRow(trimmed)
        const rows = []
        i += 2
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(splitTableRow(lines[i]))
          i++
        }
        out.push(
          '<div class="doc-table-wrap"><table class="doc-table"><thead><tr>' +
            header.map((c) => '<th scope="col">' + renderInline(c, docs) + '</th>').join('') +
            '</tr></thead><tbody>' +
            rows
              .map(
                (r) =>
                  '<tr>' +
                  r.map((c) => '<td>' + renderInline(c, docs) + '</td>').join('') +
                  '</tr>'
              )
              .join('') +
            '</tbody></table></div>'
        )
        continue
      }
      // A |...| line without a separator row is plain text, not a table.
    }

    const listMatch = line.match(/^(\s*)(.*)$/)
    const indent = listMatch ? listMatch[1].length : 0
    const ordered = trimmed.match(ORDERED_RE)
    const unordered = trimmed.match(UNORDERED_RE)
    if (ordered || unordered) {
      flushPara()
      const kind = ordered ? 'ol' : 'ul'
      const item = (ordered || unordered)[ordered ? 2 : 1]
      // Two levels max: 2+ leading spaces nest under the previous item.
      listItems.push({ kind, level: Math.min(1, Math.floor(indent / 2)), text: item })
      i++
      continue
    }

    flushList()
    para.push(trimmed)
    i++
  }
  flushPara()
  flushList()
  return out.join('\n')
}

// ---------- toolbar insert ----------
// Pure helper for the DocView edit toolbar: inserts the right syntax
// at the caret / around the selection. Returns the new text plus the
// selection to restore, so the component only has to set the value and
// dispatch one 'input' event (the Yjs binding picks it up).
// kinds: 'h1' | 'bold' | 'italic' | 'list' | 'table' | 'wikilink'

const TABLE_SKELETON =
  '\n| ستون ۱ | ستون ۲ |\n| --- | --- |\n|  |  |\n|  |  |\n'

export function insertMdSnippet(text, start, end, kind) {
  const src = String(text ?? '')
  const s = Math.max(0, Math.min(start ?? 0, src.length))
  const e = Math.max(s, Math.min(end ?? s, src.length))
  const selected = src.slice(s, e)

  function lineStart(pos) {
    const idx = src.lastIndexOf('\n', pos - 1)
    return idx === -1 ? 0 : idx + 1
  }

  switch (kind) {
    case 'h1': {
      const ls = lineStart(s)
      const out = src.slice(0, ls) + '# ' + src.slice(ls)
      return { text: out, selStart: s + 2, selEnd: e + 2 }
    }
    case 'list': {
      const ls = lineStart(s)
      const out = src.slice(0, ls) + '- ' + src.slice(ls)
      return { text: out, selStart: s + 2, selEnd: e + 2 }
    }
    case 'bold':
    case 'italic': {
      const mark = kind === 'bold' ? '**' : '*'
      if (selected) {
        const out = src.slice(0, s) + mark + selected + mark + src.slice(e)
        return { text: out, selStart: s + mark.length, selEnd: e + mark.length }
      }
      const placeholder = kind === 'bold' ? 'متن پررنگ' : 'متن کج'
      const out = src.slice(0, s) + mark + placeholder + mark + src.slice(e)
      return { text: out, selStart: s + mark.length, selEnd: s + mark.length + placeholder.length }
    }
    case 'table': {
      const out = src.slice(0, s) + TABLE_SKELETON + src.slice(e)
      const pos = s + TABLE_SKELETON.length
      return { text: out, selStart: pos, selEnd: pos }
    }
    case 'wikilink': {
      if (selected) {
        const out = src.slice(0, s) + '[[' + selected + ']]' + src.slice(e)
        return { text: out, selStart: s + 2, selEnd: e + 2 }
      }
      const out = src.slice(0, s) + '[[ ]]' + src.slice(e)
      return { text: out, selStart: s + 2, selEnd: s + 3 }
    }
    default:
      return { text: src, selStart: s, selEnd: e }
  }
}
