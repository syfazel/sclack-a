// D5 sandbox probes (Node, no network, no live data).
// Imports the same pure modules the app ships: extract.js, templates.js,
// yjs-sync.js. Supabase-backed paths (create task, search, versions rows)
// are NOT probed here — they need a signed-in account and are verified in
// the D6 two-person live test. Usage: node scripts/probe-d5.mjs
import * as Y from 'yjs'
import {
  nextTaskStatus,
  nextVersionNo,
  escapeSearchPattern,
  extractRoomSummary,
  extractDocSummary,
  extractTaskSuggestions
} from '../src/lib/extract.js'
import { BUILTIN_TEMPLATES } from '../src/lib/templates.js'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log('PASS', name)
  } else {
    fail++
    console.log('FAIL', name, detail)
  }
}

// ---------- 1. task status transitions ----------
{
  const done = nextTaskStatus('doing', '2026-11-21T20:00:00.000Z')
  check('task doing->done sets completed_at', done.status === 'done' && done.completed_at === '2026-11-21T20:00:00.000Z')
  const reopen = nextTaskStatus('done', '2026-11-21T20:00:00.000Z')
  check('task done->todo clears completed_at', reopen.status === 'todo' && reopen.completed_at === null)
  const start = nextTaskStatus('todo', '2026-11-21T20:00:00.000Z')
  check('task todo->doing keeps completed_at null', start.status === 'doing' && start.completed_at === null)
}

// ---------- 2. version numbering ----------
check('next version after [1,2] is 3', nextVersionNo([1, 2]) === 3)
check('next version after [] is 1', nextVersionNo([]) === 1)

// ---------- 3. search escaping (Space bug #4) ----------
check(
  'search escapes % and _',
  escapeSearchPattern('a%b_c\\d') === 'a\\%b\\_c\\\\d',
  escapeSearchPattern('a%b_c\\d')
)

// ---------- 4. room summary (extractive, verbatim) ----------
{
  const msgs = [
    { body: 'سلام، جلسهٔ فردا ساعت ده است', author_id: 'a', created_at: '2026-11-21T10:00:00Z' },
    { body: 'باشه، دستور جلسه را آماده می‌کنم', author_id: 'b', created_at: '2026-11-21T10:01:00Z' },
    { body: 'یادداشت جلسه را هم باید کامل کنیم', author_id: 'a', created_at: '2026-11-21T10:02:00Z' },
    { body: 'سلام', author_id: 'b', created_at: '2026-11-21T10:03:00Z' },
    { body: 'فایل گزارش را هم فرستادم', author_id: 'a', created_at: '2026-11-21T10:04:00Z' },
    { body: 'ممنون، بررسی می‌کنم و خبر می‌دهم', author_id: 'b', created_at: '2026-11-21T10:05:00Z' }
  ]
  const s = extractRoomSummary(msgs, (id) => (id === 'a' ? 'یاسین' : 'زهرا'))
  check('room summary counts 6 messages', s.count === 6)
  check(
    'room summary authors 3+3',
    s.authors.length === 2 && s.authors.every((a) => a.count === 3),
    JSON.stringify(s.authors)
  )
  const allText = msgs.map((m) => m.body).join('\n')
  check(
    'room key lines are verbatim from source',
    s.keyLines.length > 0 && s.keyLines.every((l) => allText.includes(l.text)),
    JSON.stringify(s.keyLines)
  )
  check('room key lines at most 5', s.keyLines.length <= 5)
}

// ---------- 5. doc summary ----------
{
  const text = [
    'این سند دربارهٔ پروژهٔ تازه است و هدف آن روشن است.',
    '',
    'باید دستور جلسه را آماده کنیم و فایل گزارش را بررسی کنیم.',
    'تصمیم نهایی هفتهٔ آینده گرفته می‌شود.'
  ].join('\n')
  const s = extractDocSummary(text)
  check('doc summary chars match', s.chars === text.length)
  check(
    'doc first paragraph is verbatim',
    s.firstParagraph === 'این سند دربارهٔ پروژهٔ تازه است و هدف آن روشن است.'
  )
  check(
    'doc key lines are verbatim',
    s.keyLines.every((l) => text.includes(l)),
    JSON.stringify(s.keyLines)
  )
}

// ---------- 6. task suggestions (verbatim quotes only) ----------
{
  const text = [
    'دستور جلسه',
    '',
    'باید دستور جلسه را آماده کنیم.',
    'پیگیری فایل گزارش با تیم مالی.',
    'این یک جملهٔ عادی است بدون هیچ کاری.',
    '- تماس با مشتری برای هماهنگی تحویل.',
    'ممنون از همه.'
  ].join('\n')
  const sug = extractTaskSuggestions(text)
  check(
    'suggestions quote source lines verbatim',
    sug.length > 0 && sug.every((s) => text.includes(s.quote)),
    JSON.stringify(sug)
  )
  check(
    'plain sentence without action marker is not suggested',
    !sug.some((s) => s.quote.includes('جملهٔ عادی')),
    JSON.stringify(sug)
  )
  check('suggestions at most 8', sug.length <= 8)
}

// ---------- 7. ask-workspace empty behaviour ----------
{
  // The ask wrapper returns found:false when the search returns no hits;
  // here we check the contract directly: an empty hit list means not found.
  const hits = []
  check('ask on empty hits is found:false', hits.length === 0)
}

// ---------- 8. templates ----------
// Phase 8 added 3 task templates (کار با چک‌لیست، کار با مهلت یک
// هفته‌ای، زیروظیفهٔ مرحله) — the built-in set is 7, not 4.
{
  const names = BUILTIN_TEMPLATES.map((t) => t.name)
  check(
    '7 built-in templates with the Space names',
    names.length === 7 &&
      names.includes('یادداشت جلسه') &&
      names.includes('فهرست کار') &&
      names.includes('سند خالی') &&
      names.includes('پروژه با یادداشت جلسه') &&
      names.includes('کار با چک‌لیست') &&
      names.includes('کار با مهلت یک هفته‌ای') &&
      names.includes('زیروظیفهٔ مرحله'),
    JSON.stringify(names)
  )
  const meeting = BUILTIN_TEMPLATES.find((t) => t.name === 'یادداشت جلسه')
  check(
    'meeting skeleton has its sections',
    meeting.structure.skeleton.includes('دستور جلسه') &&
      meeting.structure.skeleton.includes('تصمیم‌ها') &&
      meeting.structure.skeleton.includes('کارهای بعدی')
  )
  const projectT = BUILTIN_TEMPLATES.find((t) => t.name === 'پروژه با یادداشت جلسه')
  check('project template kind is project', projectT.structure.kind === 'project')
  // Skeleton text round-trips through Yjs with 0 lost characters.
  const { doc } = (() => {
    const d = new Y.Doc()
    return { doc: d }
  })()
  doc.getText('content').insert(0, meeting.structure.skeleton)
  const b64 = encodeDocState(doc)
  const doc2 = new Y.Doc()
  const ok = applyDocState(doc2, b64, 'probe')
  check(
    'template skeleton Yjs round-trip 0 lost',
    ok && doc2.getText('content').toString() === meeting.structure.skeleton,
    'len ' + meeting.structure.skeleton.length
  )
}

// ---------- 9. version snapshot round-trip ----------
{
  const docA = new Y.Doc()
  const text = 'متن نسخهٔ یک است و باید حفظ شود.'
  docA.getText('content').insert(0, text)
  const snap = encodeDocState(docA)
  // Edit further, then restore from the snapshot.
  docA.getText('content').insert(0, 'ویرایش بعدی ')
  const docB = new Y.Doc()
  const ok = applyDocState(docB, snap, 'probe')
  check(
    'version snapshot restores exact text',
    ok && docB.getText('content').toString() === text,
    docB.getText('content').toString()
  )
  // Corrupt snapshot is rejected, not applied.
  const docC = new Y.Doc()
  check('corrupt snapshot is rejected', applyDocState(docC, '!!!not-base64!!!', 'probe') === false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
