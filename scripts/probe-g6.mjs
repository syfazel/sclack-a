// G6 (assistant expansion — 30 top commands) sandbox probes (Node, no
// network, no live data).
//
// Layers:
//  1. PURE (Node, direct import of extract.js): for each of the 30 top
//     commands, at least one positive check (seeded rows → the right
//     answer) and one empty check (empty rows → «found:false» / empty
//     list, never a fabricated number). The 6 existing commands reuse
//     their pure functions (room/doc summaries, chat/doc suggestions,
//     deadline guardian, team pulse); #45/#77/#92/#99 are loader-only
//     and are covered in the mount layer.
//  2. MOUNT (the REAL built bundle in jsdom with a stubbed Supabase
//     backend): #/assistant with a seeded two-project DB — every one of
//     the 24 new commands is run from its own button and its rendered
//     result is asserted; the 6 existing commands are re-exercised
//     (guardian is covered by probe-p01-d's regression, room/doc
//     summaries and ask by probe-d5's regression — here they are run
//     once more through the panel). «No creation without a tap» is
//     checked for the four suggestion commands (30-list #3 close,
//     #7 chat-to-task, #13 doc-to-task, #30 template): running them
//     creates nothing; the tap then creates exactly one row.
//  3. EMPTY MOUNT: a DB with members only — every new command shows
//     its empty state («چیزی پیدا نشد») or the honest «پروژه/سند
//     انتخاب نشده است» error, never a number.
//
// HERMETIC BUILD (same as probe-p01-a/b/c/d/s5/g3/g7): this probe
// BUILDS the bundle itself with the probe Supabase URL + placeholder
// key before mounting, and refuses to mount a bundle that is not
// probe-configured.
//
// Usage:
//   node scripts/probe-g6.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from '../src/lib/yjs-sync.js'
import {
  computeProjectReview,
  computeDeadlineGuardian,
  computeTeamPulse,
  extractRoomSummary,
  extractDocSummary,
  extractChatTaskSuggestions,
  extractDocTaskSuggestions,
  projectDeadlineInfo,
  suggestProjectClose,
  todayMessages,
  unansweredMessages,
  openThreads,
  mentionsFirst,
  groupNotificationsByType,
  staleDocs,
  openComments,
  freshFiles,
  unattachedFiles,
  myTodayTasks,
  overdueTasks,
  undatedTasks,
  unassignedTasks,
  todayReminders,
  overdueReminders,
  searchDocLines,
  lastActivityByMember,
  suggestDueAt,
  faNum,
  tehranDayKey,
  addTehranDays
} from '../src/lib/extract.js'

const PLACEHOLDER_KEY = 'sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY'
const BASE_URL = 'https://probe-ref.supabase.co'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const ZAHRA_USER_ID = '99999999-9999-9999-9999-999999999999'
const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
const MEMBER2_ID = '22222222-2222-2222-2222-222222222223'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT2_ID = '33333333-3333-3333-3333-333333333334'
const ROOM_ID = '44444444-4444-4444-4444-444444444444'
const ROOM2_ID = '44444444-4444-4444-4444-444444444445'
const DOC_ID = '55555555-5555-5555-5555-555555555555'
const DOC2_ID = '55555555-5555-5555-5555-555555555556'
const DOC3_ID = '55555555-5555-5555-5555-555555555557'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// ---------- 1. PURE: the 30 top commands (pinned clock) ----------
function pureChecks() {
  // Pinned clock: Sunday 2026-11-22 10:00 Tehran. Week = Sat 21 Nov ..
  // Fri 27 Nov. Previous 7 days = 8..14 Nov.
  const PIN = new Date('2026-11-22T10:00:00+03:30')
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(PIN, dayOffset)) + 'T' + time + '+03:30'

  const nameOf = (id) => (id === MEMBER_ID ? 'yasin' : id === MEMBER2_ID ? 'زهرا' : 'عضو')
  const msgs = [
    { id: 'pm1', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'باید گزارش ماهانه را آماده کنیم', parent_id: null, created_at: isoAt(0, '09:00:00') },
    { id: 'pm2', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سلام، امروز جلسه داریم؟', parent_id: null, created_at: isoAt(0, '10:00:00') },
    { id: 'pm3', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پیام دیروز', parent_id: null, created_at: isoAt(-1, '15:00:00') },
    { id: 'pm4', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سؤال', parent_id: null, created_at: isoAt(0, '08:00:00') },
    { id: 'pm5', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ به سؤال', parent_id: 'pm4', created_at: isoAt(0, '09:30:00') },
    { id: 'pm6', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'بحث اصلی ترد', parent_id: null, created_at: isoAt(0, '07:00:00') },
    { id: 'pm7', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ اول به ترد', parent_id: 'pm6', created_at: isoAt(0, '09:00:00') },
    { id: 'pm8', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'پاسخ دوم به ترد', parent_id: 'pm6', created_at: isoAt(0, '09:15:00') }
  ]
  const tasks = [
    { id: 'pt1', title: 'کار امروز من', assignee_id: MEMBER_ID, status: 'todo', due_at: isoAt(0, '23:59:00'), completed_at: null, created_by: MEMBER_ID, created_at: isoAt(-1, '10:00:00') },
    { id: 'pt2', title: 'کار عقب‌مانده', assignee_id: MEMBER2_ID, status: 'todo', due_at: isoAt(-1, '10:00:00'), completed_at: null, created_by: MEMBER_ID, created_at: isoAt(-2, '10:00:00') },
    { id: 'pt3', title: 'کار بدون سررسید', assignee_id: MEMBER_ID, status: 'todo', due_at: null, completed_at: null, created_by: MEMBER_ID, created_at: isoAt(-1, '11:00:00') },
    { id: 'pt4', title: 'کار بدون مسئول', assignee_id: null, status: 'todo', due_at: isoAt(1, '23:59:00'), completed_at: null, created_by: MEMBER_ID, created_at: isoAt(-1, '12:00:00') },
    { id: 'pt5', title: 'کار تمام‌شدهٔ امروز', assignee_id: MEMBER_ID, status: 'done', due_at: isoAt(0, '23:59:00'), completed_at: isoAt(0, '09:00:00'), created_by: MEMBER_ID, created_at: isoAt(-3, '10:00:00') },
    { id: 'pt6', title: 'کار تمام‌شدهٔ قدیمی', assignee_id: MEMBER2_ID, status: 'done', due_at: isoAt(-10, '10:00:00'), completed_at: isoAt(-10, '09:00:00'), created_by: MEMBER2_ID, created_at: isoAt(-11, '10:00:00') },
    { id: 'pt7', title: 'کار تمام‌شدهٔ عقب‌مانده', assignee_id: MEMBER_ID, status: 'done', due_at: isoAt(-1, '10:00:00'), completed_at: isoAt(0, '08:00:00'), created_by: MEMBER_ID, created_at: isoAt(-2, '10:00:00') }
  ]
  const docs = [
    { id: 'pd1', title: 'سند تازه', created_by: MEMBER_ID, created_at: isoAt(-3, '10:00:00'), updated_at: isoAt(0, '08:00:00') },
    { id: 'pd2', title: 'سند کهنه', created_by: MEMBER2_ID, created_at: isoAt(-10, '10:00:00'), updated_at: isoAt(-10, '10:00:00') },
    { id: 'pd3', title: 'سند بی‌زمان', created_by: MEMBER_ID, created_at: isoAt(-10, '10:00:00'), updated_at: null }
  ]
  const files = [
    { id: 'pf1', name: 'تازه.txt', uploaded_by: MEMBER_ID, uploaded_at: isoAt(0, '08:30:00'), attached_to_type: null },
    { id: 'pf2', name: 'قدیمی.txt', uploaded_by: MEMBER_ID, uploaded_at: isoAt(-10, '10:00:00'), attached_to_type: null },
    { id: 'pf3', name: 'وصل‌شده.txt', uploaded_by: MEMBER2_ID, uploaded_at: isoAt(0, '08:00:00'), attached_to_type: 'task' },
    { id: 'pf4', name: 'تازهٔ بی‌وصل.txt', uploaded_by: MEMBER2_ID, uploaded_at: isoAt(0, '08:45:00'), attached_to_type: null }
  ]
  const reminders = [
    { id: 'pr1', user_id: MEMBER_ID, text: 'یادآوری امروز', remind_at: isoAt(0, '12:00:00'), done: false },
    { id: 'pr2', user_id: MEMBER_ID, text: 'یادآوری عقب‌مانده', remind_at: isoAt(-1, '09:00:00'), done: false },
    { id: 'pr3', user_id: MEMBER_ID, text: 'یادآوری فردا', remind_at: isoAt(1, '12:00:00'), done: false },
    { id: 'pr4', user_id: MEMBER_ID, text: 'یادآوری انجام‌شده', remind_at: isoAt(-1, '09:00:00'), done: true }
  ]
  const notifications = [
    { id: 'pn1', type: 'mention', user_id: MEMBER_ID, read: false, created_at: isoAt(0, '10:05:00') },
    { id: 'pn2', type: 'mention', user_id: MEMBER_ID, read: true, created_at: isoAt(-1, '10:00:00') },
    { id: 'pn3', type: 'reply', user_id: MEMBER_ID, read: false, created_at: isoAt(0, '09:35:00') },
    { id: 'pn4', type: 'reminder', user_id: MEMBER_ID, read: false, created_at: isoAt(0, '09:00:00') }
  ]
  const comments = [
    { id: 'pc1', body: 'نظر باز', resolved: false, created_at: isoAt(0, '08:00:00') },
    { id: 'pc2', body: 'نظر حل‌شده', resolved: true, created_at: isoAt(-1, '08:00:00') }
  ]
  const members = [
    { id: MEMBER_ID, name: 'yasin', username: 'yasin' },
    { id: MEMBER2_ID, name: 'زهرا', username: 'zahraariapour97' },
    { id: 'member-no-rows', name: 'سارا', username: 'sara' }
  ]
  const projReview = { id: PROJECT_ID, custom_fields: { goal: 'هدف', deadline: '2026-11-25', stage: 'review' } }
  const projActive = { id: PROJECT2_ID, custom_fields: { goal: 'هدف', deadline: '2026-12-02', stage: 'active' } }
  const projNoDeadline = { id: 'p-nodl', custom_fields: { goal: 'هدف', stage: 'active' } }

  // #1 (100-list) project status — existing computeProjectReview
  {
    const r = computeProjectReview({ tasks, docs, files }, PIN)
    check('G6 pure #1: review counts are exact (todo 4 / doing 0 / done 3 / overdue 1 / docs 3 / newFiles 3)',
      r.todo === 4 && r.doing === 0 && r.done === 3 && r.overdue === 1 && r.docs === 3 && r.newFiles === 3, JSON.stringify(r))
    const e = computeProjectReview({ tasks: [], docs: [], files: [] }, PIN)
    check('G6 pure #1 empty: all review numbers are 0',
      e.todo === 0 && e.doing === 0 && e.done === 0 && e.overdue === 0 && e.docs === 0 && e.newFiles === 0, JSON.stringify(e))
  }
  // #3 (100-list) project deadline
  {
    const info = projectDeadlineInfo(projReview, tasks, PIN)
    check('G6 pure #3: deadline found, 3 days left, 3 unfinished tasks due by it',
      info.found === true && info.daysLeft === 3 && info.tasksDueByDeadline === 3, JSON.stringify(info))
    check('G6 pure #3: deadline label is Jalali', info.deadlineLabel === '۴ آذر ۱۴۰۵', info.deadlineLabel)
    check('G6 pure #3 empty: project without a deadline → found:false',
      projectDeadlineInfo(projNoDeadline, tasks, PIN).found === false)
    const past = projectDeadlineInfo({ custom_fields: { deadline: '2026-11-20' } }, tasks, PIN)
    check('G6 pure #3: past deadline → daysLeft is -2', past.daysLeft === -2, JSON.stringify(past))
  }
  // #8 (100-list) suggest closing the project
  {
    check('G6 pure #8: review + all tasks done → suggested',
      suggestProjectClose(projReview, tasks.filter((t) => t.status === 'done')).suggested === true)
    const open = suggestProjectClose(projReview, tasks)
    check('G6 pure #8: review + open tasks → not suggested (open-tasks)',
      open.suggested === false && open.reason === 'open-tasks' && open.openCount === 4, JSON.stringify(open))
    check('G6 pure #8: active stage → not suggested (stage)',
      suggestProjectClose(projActive, tasks.filter((t) => t.status === 'done')).suggested === false)
    check('G6 pure #8: review + no tasks → not suggested (no-tasks)',
      suggestProjectClose(projReview, []).suggested === false)
  }
  // #11 (100-list) room summary — existing
  {
    const s = extractRoomSummary(msgs, nameOf)
    check('G6 pure #11: room summary counts 8 messages', s.count === 8, JSON.stringify(s.count))
    check('G6 pure #11 empty: 0 messages, no key lines',
      extractRoomSummary([], nameOf).count === 0 && extractRoomSummary([], nameOf).keyLines.length === 0)
  }
  // #13 (100-list) today's messages
  {
    const list = todayMessages(msgs, PIN)
    check('G6 pure #13: exactly the 7 today messages, newest first',
      list.length === 7 && list[0].id === 'pm2' && list.every((m) => tehranDayKey(m.created_at) === '2026-11-22'),
      JSON.stringify(list.map((m) => m.id)))
    check('G6 pure #13 empty: yesterday-only input → []',
      todayMessages(msgs.filter((m) => m.id === 'pm3'), PIN).length === 0)
  }
  // #15 (100-list) unanswered messages
  {
    const list = unansweredMessages(msgs)
    check('G6 pure #15: unanswered parents are pm1/pm2/pm3 (pm4/pm6 have replies)',
      list.map((m) => m.id).join(',') === 'pm3,pm1,pm2', JSON.stringify(list.map((m) => m.id)))
    check('G6 pure #15 empty: every parent answered → []',
      unansweredMessages(msgs.filter((m) => ['pm4', 'pm5', 'pm6', 'pm7', 'pm8'].includes(m.id))).length === 0)
  }
  // #21 (100-list) chat-to-task suggestions — existing
  {
    const sug = extractChatTaskSuggestions(msgs, PIN)
    check('G6 pure #21: exactly 1 suggestion from the action line, assignee is the author',
      sug.length === 1 && sug[0].assigneeId === MEMBER_ID && sug[0].source_message_id === 'pm1',
      JSON.stringify(sug))
    check('G6 pure #21 empty: no action lines → []',
      extractChatTaskSuggestions([{ id: 'x', body: 'سلام، چطوری؟', author_id: MEMBER_ID }], PIN).length === 0)
  }
  // #23 (100-list) open threads
  {
    const threads = openThreads(msgs)
    check('G6 pure #23: 2 open threads; pm6 has 2 replies, last is pm8; most recent first is pm4',
      threads.length === 2 &&
      threads[0].parent.id === 'pm4' && threads[0].replyCount === 1 &&
      threads[1].parent.id === 'pm6' && threads[1].replyCount === 2 && threads[1].lastReply.id === 'pm8',
      JSON.stringify(threads.map((t) => [t.parent.id, t.replyCount, t.lastReply.id])))
    check('G6 pure #23 empty: no replies at all → []',
      openThreads(msgs.filter((m) => !m.parent_id)).length === 0)
  }
  // #25 (100-list) my mentions first
  {
    const list = mentionsFirst(notifications)
    check('G6 pure #25: only mentions, unread first (pn1 before pn2)',
      list.map((n) => n.id).join(',') === 'pn1,pn2', JSON.stringify(list.map((n) => n.id)))
    check('G6 pure #25 empty: no mentions → []',
      mentionsFirst(notifications.filter((n) => n.type !== 'mention')).length === 0)
  }
  // #27 (100-list) unread notifications grouped by type
  {
    const groups = groupNotificationsByType(notifications)
    check('G6 pure #27: 3 groups in order mention/reply/reminder with 2/1/1 rows',
      groups.map((g) => g.type + ':' + g.rows.length).join(',') === 'mention:2,reply:1,reminder:1',
      JSON.stringify(groups.map((g) => [g.type, g.rows.length])))
    check('G6 pure #27 empty: [] → []', groupNotificationsByType([]).length === 0)
  }
  // #31 (100-list) doc summary — existing
  {
    const s = extractDocSummary('پاراگراف اول عیناً.\n\nخط دوم سند اینجاست.')
    check('G6 pure #31: chars > 0 and first paragraph is verbatim',
      s.chars > 0 && s.firstParagraph === 'پاراگراف اول عیناً.', JSON.stringify(s))
    check('G6 pure #31 empty: empty text → 0 chars', extractDocSummary('').chars === 0)
  }
  // #33 (100-list) stale docs
  {
    const list = staleDocs(docs, PIN)
    check('G6 pure #33: stale docs are pd2 and pd3 (pd3 has no updated_at)',
      list.map((d) => d.id).join(',') === 'pd2,pd3', JSON.stringify(list.map((d) => d.id)))
    check('G6 pure #33 empty: fresh-only input → []',
      staleDocs(docs.filter((d) => d.id === 'pd1'), PIN).length === 0)
  }
  // #36 (100-list) doc task suggestions — existing
  {
    const sug = extractDocTaskSuggestions('باید بودجهٔ پروژه را بررسی کنیم\nمتن عادی بدون فعل', DOC_ID, PIN)
    check('G6 pure #36: exactly 1 suggestion, source_doc_id set, assignee null',
      sug.length === 1 && sug[0].source_doc_id === DOC_ID && sug[0].assigneeId === null,
      JSON.stringify(sug))
    check('G6 pure #36 empty: no action lines → []',
      extractDocTaskSuggestions('متن عادی بدون فعل', DOC_ID, PIN).length === 0)
  }
  // #41 (100-list) open comments
  {
    check('G6 pure #41: only the unresolved comment', openComments(comments).map((c) => c.id).join(',') === 'pc1')
    check('G6 pure #41 empty: all resolved → []',
      openComments(comments.filter((c) => c.resolved)).length === 0)
  }
  // #49 (100-list) fresh files
  {
    check('G6 pure #49: fresh files are pf4/pf1/pf3 (newest first)',
      freshFiles(files, PIN).map((f) => f.id).join(',') === 'pf4,pf1,pf3',
      JSON.stringify(freshFiles(files, PIN).map((f) => f.id)))
    check('G6 pure #49 empty: old-only input → []',
      freshFiles(files.filter((f) => f.id === 'pf2'), PIN).length === 0)
  }
  // #54 (100-list) unattached files
  {
    check('G6 pure #54: unattached files are pf4/pf1/pf2 (pf3 is attached, newest first)',
      unattachedFiles(files).map((f) => f.id).join(',') === 'pf4,pf1,pf2',
      JSON.stringify(unattachedFiles(files).map((f) => f.id)))
    check('G6 pure #54 empty: all attached → []',
      unattachedFiles(files.filter((f) => f.attached_to_type)).length === 0)
  }
  // #57 (100-list) deadline guardian — existing
  {
    const g = computeDeadlineGuardian(tasks, reminders, PIN)
    check('G6 pure #57: guardian buckets today 1 / overdue 1 / soon 1 / remindersToday 1',
      g.today.length === 1 && g.overdue.length === 1 && g.soon.length === 1 && g.remindersToday.length === 1,
      JSON.stringify({ t: g.today.length, o: g.overdue.length, s: g.soon.length, r: g.remindersToday.length }))
    check('G6 pure #57 empty: found is false', computeDeadlineGuardian([], [], PIN).found === false)
  }
  // #58 (100-list) my tasks due today
  {
    const list = myTodayTasks(tasks, MEMBER_ID, PIN)
    check('G6 pure #58: pt1 and pt5 (mine, due today — done-today still counts, same as the planner)',
      list.map((t) => t.id).join(',') === 'pt1,pt5', JSON.stringify(list.map((t) => t.id)))
    check('G6 pure #58 empty: other member’s today task is not mine',
      myTodayTasks([{ id: 'x', assignee_id: MEMBER2_ID, status: 'todo', due_at: isoAt(0, '23:59:00') }], MEMBER_ID, PIN).length === 0)
  }
  // #59 (100-list) overdue tasks
  {
    const list = overdueTasks(tasks, PIN)
    check('G6 pure #59: only pt2 (done overdue pt7 is excluded)',
      list.map((t) => t.id).join(',') === 'pt2', JSON.stringify(list.map((t) => t.id)))
    check('G6 pure #59 empty: nothing overdue → []',
      overdueTasks(tasks.filter((t) => t.id === 'pt1'), PIN).length === 0)
  }
  // #63 (100-list) undated tasks
  {
    check('G6 pure #63: only pt3', undatedTasks(tasks).map((t) => t.id).join(',') === 'pt3')
    check('G6 pure #63 empty: all dated → []',
      undatedTasks(tasks.filter((t) => t.due_at)).length === 0)
  }
  // #64 (100-list) unassigned tasks
  {
    check('G6 pure #64: only pt4', unassignedTasks(tasks).map((t) => t.id).join(',') === 'pt4')
    check('G6 pure #64 empty: all assigned → []',
      unassignedTasks(tasks.filter((t) => t.assignee_id)).length === 0)
  }
  // #71 (100-list) today's reminders
  {
    check('G6 pure #71: only pr1', todayReminders(reminders, PIN).map((r) => r.id).join(',') === 'pr1')
    check('G6 pure #71 empty: tomorrow-only input → []',
      todayReminders(reminders.filter((r) => r.id === 'pr3'), PIN).length === 0)
  }
  // #72 (100-list) overdue reminders
  {
    check('G6 pure #72: only pr2 (done pr4 is excluded)',
      overdueReminders(reminders, PIN).map((r) => r.id).join(',') === 'pr2')
    check('G6 pure #72 empty: nothing overdue → []',
      overdueReminders(reminders.filter((r) => r.id === 'pr3'), PIN).length === 0)
  }
  // #84 (100-list) search inside doc text
  {
    const hits = searchDocLines(
      [
        { docId: 'd1', title: 'سند ۱', text: 'خط بودجهٔ پروژه\nخط دیگر' },
        { docId: 'd2', title: 'سند ۲', text: 'بدون واژه' }
      ],
      'بودجه'
    )
    check('G6 pure #84: one hit, verbatim line, doc without the word is absent',
      hits.length === 1 && hits[0].docId === 'd1' && hits[0].lines[0] === 'خط بودجهٔ پروژه',
      JSON.stringify(hits))
    check('G6 pure #84 empty: no match → []',
      searchDocLines([{ docId: 'd1', title: 'سند ۱', text: 'خط بودجه' }], 'ناموجود').length === 0)
  }
  // #85 (100-list) team pulse today — existing
  {
    const p = computeTeamPulse({ messages: msgs, tasks, docs, files }, PIN)
    check('G6 pure #85: pulse numbers are exact (today 7 / doneThisWeek 2 / activeDocs 1 / newFiles 3)',
      p.todayMessages === 7 && p.doneThisWeek === 2 && p.activeDocs === 1 && p.newFiles === 3,
      JSON.stringify({ m: p.todayMessages, d: p.doneThisWeek, a: p.activeDocs, f: p.newFiles }))
    const e = computeTeamPulse({ messages: [], tasks: [], docs: [], files: [] }, PIN)
    check('G6 pure #85 empty: all four numbers are 0 and no change %',
      e.todayMessages === 0 && e.doneThisWeek === 0 && e.activeDocs === 0 && e.newFiles === 0 &&
      e.changeMessages === null && e.changeDone === null, JSON.stringify(e))
  }
  // #95 (100-list) last activity per member
  {
    const rows = lastActivityByMember({ messages: msgs, docs, tasks, files }, members)
    const me = rows.find((r) => r.memberId === MEMBER_ID)
    const zahra = rows.find((r) => r.memberId === MEMBER2_ID)
    const sara = rows.find((r) => r.memberId === 'member-no-rows')
    check('G6 pure #95: my last activity is a message (pm5 at 09:30, the newest)',
      me.activity && me.activity.kind === 'message', JSON.stringify(me.activity))
    check('G6 pure #95: Zahra’s last activity is a message (pm2 at 10:00)',
      zahra.activity && zahra.activity.kind === 'message', JSON.stringify(zahra.activity))
    check('G6 pure #95 empty: member with no rows → activity null',
      sara.activity === null, JSON.stringify(sara))
  }
}

// ---------- 2. STUB BACKEND + HARNESS (adapted from probe-p01-d) ----------
const FILES_BUCKET = 'sclack-files'
const allErrors = []

function encodeText(text) {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return encodeDocState(doc)
}

function makeDb() {
  const now = new Date().toISOString()
  return {
    members: [
      { id: MEMBER2_ID, muse_id: 'auth:' + ZAHRA_USER_ID, name: 'زهرا', username: 'zahraariapour97', avatar: null, joined_at: now, auth_id: ZAHRA_USER_ID }
    ],
    projects: [],
    rooms: [],
    docs: [],
    messages: [],
    files: [],
    tasks: [],
    comments: [],
    templates: [],
    versions: [],
    reminders: [],
    notifications: [],
    integrations: []
  }
}

// Two projects: project 1 (active, mixed rows — most commands) and
// project 2 (stage review, all tasks done — the #8 close suggestion).
// All dates are relative to the probe's real clock, like probe-p01-d.
function seedG6(db, now) {
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'
  const iso = (d) => new Date(d).toISOString()
  const task = (id, projectId, title, assignee, dueAt, status, createdOffset, completedAt = null) => ({
    id, project_id: projectId, title, description: null, assignee_id: assignee,
    status, due_at: dueAt, completed_at: status === 'done' ? (completedAt || iso(now)) : null,
    created_by: MEMBER_ID, created_at: isoAt(createdOffset, '10:00:00'), visibility: 'project',
    custom_fields: { link_type: null, link_id: null }
  })
  db.projects.push(
    { id: PROJECT_ID, workspace_id: 'main', name: 'پروژهٔ پروب G6', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف G6', deadline: tehranDayKey(addTehranDays(now, 3)), stage: 'active', member_ids: [MEMBER_ID, MEMBER2_ID] } },
    { id: PROJECT2_ID, workspace_id: 'main', name: 'پروژهٔ بستنی', description: null, color: null, icon: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'team', archived: false, custom_fields: { goal: 'هدف دوم', deadline: tehranDayKey(addTehranDays(now, 5)), stage: 'review', member_ids: [MEMBER_ID, MEMBER2_ID] } }
  )
  db.rooms.push(
    { id: ROOM_ID, project_id: PROJECT_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} },
    { id: ROOM2_ID, project_id: PROJECT2_ID, name: 'گفت‌وگو', type: 'project', member_a: null, member_b: null, created_by: MEMBER_ID, created_at: iso(now), visibility: 'project', custom_fields: {} }
  )
  db.docs.push(
    { id: DOC_ID, project_id: PROJECT_ID, title: 'سند تازه', yjs_doc_id: 'doc-g6-1', template_id: null, created_by: MEMBER_ID, created_at: isoAt(-3, '10:00:00'), updated_at: isoAt(0, '08:00:00'), version: 1, visibility: 'project', custom_fields: { yjs_state_b64: encodeText('باید بودجهٔ پروژه را بررسی کنیم\nمتن عادی') } },
    { id: DOC2_ID, project_id: PROJECT_ID, title: 'سند کهنه', yjs_doc_id: 'doc-g6-2', template_id: null, created_by: MEMBER2_ID, created_at: isoAt(-10, '10:00:00'), updated_at: isoAt(-10, '10:00:00'), version: 1, visibility: 'project', custom_fields: { yjs_state_b64: encodeText('متن سند کهنه') } },
    { id: DOC3_ID, project_id: PROJECT_ID, title: 'سند بی‌زمان', yjs_doc_id: 'doc-g6-3', template_id: null, created_by: MEMBER_ID, created_at: isoAt(-10, '10:00:00'), updated_at: null, version: 1, visibility: 'project', custom_fields: { yjs_state_b64: encodeText('متن دیگر') } }
  )
  db.messages.push(
    { id: 'msg-1', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'باید گزارش ماهانه را آماده کنیم', parent_id: null, created_at: isoAt(0, '09:00:00'), visibility: 'project' },
    { id: 'msg-2', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سلام، امروز جلسه داریم؟', parent_id: null, created_at: isoAt(0, '10:00:00'), visibility: 'project' },
    { id: 'msg-3', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پیام دیروز', parent_id: null, created_at: isoAt(-1, '15:00:00'), visibility: 'project' },
    { id: 'msg-4', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'سؤال', parent_id: null, created_at: isoAt(0, '08:00:00'), visibility: 'project' },
    { id: 'msg-5', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ به سؤال', parent_id: 'msg-4', created_at: isoAt(0, '09:30:00'), visibility: 'project' },
    { id: 'msg-6', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'بحث اصلی ترد', parent_id: null, created_at: isoAt(0, '07:00:00'), visibility: 'project' },
    { id: 'msg-7', room_id: ROOM_ID, author_id: MEMBER_ID, body: 'پاسخ اول به ترد', parent_id: 'msg-6', created_at: isoAt(0, '09:00:00'), visibility: 'project' },
    { id: 'msg-8', room_id: ROOM_ID, author_id: MEMBER2_ID, body: 'پاسخ دوم به ترد', parent_id: 'msg-6', created_at: isoAt(0, '09:15:00'), visibility: 'project' }
  )
  db.tasks.push(
    task('task-today', PROJECT_ID, 'کار امروز من', MEMBER_ID, isoAt(0, '23:59:00'), 'todo', -1),
    task('task-overdue', PROJECT_ID, 'کار عقب‌مانده', MEMBER2_ID, isoAt(-1, '10:00:00'), 'todo', -2),
    task('task-undated', PROJECT_ID, 'کار بدون سررسید', MEMBER_ID, null, 'todo', -1),
    task('task-unassigned', PROJECT_ID, 'کار بدون مسئول', null, isoAt(1, '23:59:00'), 'todo', -1),
    task('task-done-today', PROJECT_ID, 'کار تمام‌شدهٔ امروز', MEMBER_ID, isoAt(0, '23:59:00'), 'done', -3, isoAt(0, '09:00:00')),
    task('task-done-old', PROJECT_ID, 'کار تمام‌شدهٔ قدیمی', MEMBER2_ID, isoAt(-10, '10:00:00'), 'done', -11, isoAt(-10, '09:00:00')),
    task('p2-task-1', PROJECT2_ID, 'کار تمام‌شدهٔ دوم ۱', MEMBER_ID, isoAt(1, '23:59:00'), 'done', -1, isoAt(0, '08:00:00')),
    task('p2-task-2', PROJECT2_ID, 'کار تمام‌شدهٔ دوم ۲', MEMBER2_ID, isoAt(1, '23:59:00'), 'done', -1, isoAt(0, '08:30:00'))
  )
  db.files.push(
    { id: 'file-1', project_id: PROJECT_ID, name: 'تازه.txt', size: 1024, uploaded_by: MEMBER_ID, uploaded_at: isoAt(0, '08:30:00'), attached_to_type: null, attached_to_id: null },
    { id: 'file-2', project_id: PROJECT_ID, name: 'قدیمی.txt', size: 2048, uploaded_by: MEMBER_ID, uploaded_at: isoAt(-10, '10:00:00'), attached_to_type: null, attached_to_id: null },
    { id: 'file-3', project_id: PROJECT_ID, name: 'وصل‌شده.txt', size: 512, uploaded_by: MEMBER2_ID, uploaded_at: isoAt(0, '08:00:00'), attached_to_type: 'task', attached_to_id: 'task-today' }
  )
  db.reminders.push(
    { id: 'rem-1', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری امروز', remind_at: isoAt(0, '23:59:00'), done: false, created_at: iso(now) },
    { id: 'rem-2', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری عقب‌مانده', remind_at: isoAt(-1, '09:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-3', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری فردا', remind_at: isoAt(1, '12:00:00'), done: false, created_at: iso(now) },
    { id: 'rem-4', user_id: MEMBER_ID, target_type: null, target_id: null, text: 'یادآوری انجام‌شده', remind_at: isoAt(-1, '09:00:00'), done: true, created_at: iso(now) }
  )
  db.notifications.push(
    { id: 'n1', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-2', read: false, created_at: isoAt(0, '10:05:00') },
    { id: 'n2', user_id: MEMBER_ID, type: 'mention', target_id: 'msg-7', read: true, created_at: isoAt(-1, '10:00:00') },
    { id: 'n3', user_id: MEMBER_ID, type: 'reply', target_id: 'msg-5', read: false, created_at: isoAt(0, '09:35:00') },
    { id: 'n4', user_id: MEMBER_ID, type: 'reminder', target_id: 'task-done-old', read: false, created_at: isoAt(0, '09:00:00') }
    // NOTE: n4 deliberately targets a DONE task, not the overdue one —
    // so the guardian's de-dup does not see the overdue pointer as
    // already recorded, and #92/#57 can prove a fresh pointer is made.
  )
  db.comments.push(
    { id: 'c1', doc_id: DOC_ID, author_id: MEMBER2_ID, body: 'نظر باز روی سند', anchor: { quote: 'بودجه' }, resolved: false, parent_id: null, created_at: isoAt(0, '08:00:00'), visibility: 'project' },
    { id: 'c2', doc_id: DOC_ID, author_id: MEMBER_ID, body: 'نظر حل‌شده', anchor: null, resolved: true, parent_id: null, created_at: isoAt(-1, '08:00:00'), visibility: 'project' }
  )
  db.versions.push(
    { id: 'ver-1', doc_id: DOC_ID, version_no: 1, snapshot_ref: null, author_id: MEMBER_ID, note: 'نسخهٔ اول', created_at: isoAt(-3, '10:00:00') },
    { id: 'ver-2', doc_id: DOC_ID, version_no: 2, snapshot_ref: null, author_id: MEMBER2_ID, note: 'نسخهٔ دوم', created_at: isoAt(0, '08:00:00') }
  )
  db.templates.push(
    { id: 'tpl-1', name: 'یادداشت جلسه', type: 'doc', structure: { kind: 'doc', skeleton: 'دستور جلسه\n\nحاضرین' }, created_by: MEMBER_ID, created_at: iso(now) },
    { id: 'tpl-2', name: 'فهرست کار', type: 'doc', structure: { kind: 'doc', skeleton: 'فهرست کار\n\n۱. ' }, created_by: MEMBER_ID, created_at: iso(now) },
    { id: 'tpl-3', name: 'سند خالی', type: 'doc', structure: { kind: 'doc', skeleton: '' }, created_by: MEMBER_ID, created_at: iso(now) }
  )
}

function makeStub(db) {
  const calls = { projectInserts: [], roomInserts: [], docInserts: [], taskInserts: [], projectPatches: [], storageUploads: [], storageRemoves: [], storageSigns: [] }
  const store = new Map()

  function ilikeMatch(value, pattern) {
    let p = pattern
    if (p.startsWith('%')) p = p.slice(1)
    if (p.endsWith('%') && !p.endsWith('\\%')) p = p.slice(0, -1)
    p = p.replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\\\/g, '\\')
    return (value || '').toLowerCase().includes(p.toLowerCase())
  }

  function rowMatches(row, params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
      const m = val.match(/^([a-z_]+)\.(.*)$/)
      if (!m) continue
      const [, op, raw] = m
      const v = row[key]
      if (op === 'eq') {
        if (String(v) !== raw && !(v === false && raw === 'false') && !(v === true && raw === 'true')) return false
      } else if (op === 'ilike') {
        if (!ilikeMatch(v, raw)) return false
      } else if (op === 'neq') {
        if (String(v) === raw) return false
      }
    }
    const orParam = params.get('or')
    if (orParam) {
      const parts = orParam.split(',')
      const ok = parts.some((part) => {
        const m = part.match(/^([a-z_]+)\.ilike\.(.*)$/)
        if (!m) return false
        return ilikeMatch(row[m[1]], m[2])
      })
      if (!ok) return false
    }
    return true
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  async function handleRest(url, method, headers, bodyText) {
    const u = new URL(url)
    const table = u.pathname.split('/').pop()
    const params = u.searchParams
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object+json')
    const order = params.get('order') || ''
    const rows = db[table]
    if (!rows) return json({ message: 'table not found: ' + table }, 404)

    if (method === 'GET') {
      let out = rows.filter((r) => rowMatches(r, params))
      if (order) {
        const [col, dir] = order.split('.')
        out = [...out].sort((a, b) => {
          const av = a[col] ?? ''
          const bv = b[col] ?? ''
          return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
        })
      }
      const limit = params.get('limit')
      if (limit) out = out.slice(0, Number(limit))
      out = out.map((r) => {
        const c = { ...r }
        if (table === 'messages') {
          const room = db.rooms.find((x) => x.id === r.room_id)
          c.rooms = room ? { name: room.name } : null
        }
        if (['docs', 'files', 'tasks'].includes(table)) {
          const p = db.projects.find((x) => x.id === r.project_id)
          c.projects = p ? { name: p.name } : null
        }
        return c
      })
      if (single) {
        if (out.length !== 1) return json({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
        return json(out[0])
      }
      return json(out)
    }

    if (method === 'POST') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      if (table === 'projects' && rows.some((r) => r.name === body.name)) {
        return json({ message: 'duplicate key value violates unique constraint "projects_name_key"', code: '23505' }, 400)
      }
      const onConflict = params.get('on_conflict') || params.get('onConflict')
      const now = new Date().toISOString()
      const row = { ...body }
      if (table === 'projects' && row.archived === undefined) row.archived = false
      if (table === 'projects' && row.custom_fields === undefined) row.custom_fields = {}
      if (!row.id) {
        if (table === 'members' && body.auth_id === USER_ID) row.id = MEMBER_ID
        else if (table === 'members' && body.auth_id === ZAHRA_USER_ID) row.id = MEMBER2_ID
        else row.id = 'stub-' + Math.random().toString(36).slice(2, 10)
      }
      if (!row.created_at) row.created_at = now
      if (onConflict) {
        const existing = rows.find((r) => String(r[onConflict]) === String(body[onConflict]))
        if (existing) {
          Object.assign(existing, row)
          return single ? json(existing) : json([existing])
        }
      }
      rows.push(row)
      if (table === 'projects') calls.projectInserts.push(row)
      if (table === 'rooms') calls.roomInserts.push(row)
      if (table === 'docs') calls.docInserts.push(row)
      if (table === 'tasks') calls.taskInserts.push(row)
      return single ? json(row) : json([row])
    }

    if (method === 'PATCH') {
      const body = bodyText ? JSON.parse(bodyText) : {}
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) Object.assign(r, body)
      if (table === 'projects') calls.projectPatches.push({ ids: matched.map((r) => r.id), body })
      if (single) return matched.length === 1 ? json(matched[0]) : json({ message: 'JSON object requested, multiple (or no) rows returned' }, 406)
      return new Response(null, { status: 204 })
    }

    if (method === 'DELETE') {
      const matched = rows.filter((r) => rowMatches(r, params))
      for (const r of matched) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      return json(matched)
    }

    return json({ message: 'unsupported method ' + method }, 405)
  }

  async function readBodyBytes(body) {
    if (!body) return new Uint8Array(0)
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof Uint8Array) return body
    if (typeof body.arrayBuffer === 'function') {
      try {
        return new Uint8Array(await body.arrayBuffer())
      } catch {
        return new Uint8Array(0)
      }
    }
    if (typeof body.entries === 'function') {
      for (const [, v] of body.entries()) {
        if (v && typeof v.arrayBuffer === 'function') return new Uint8Array(await v.arrayBuffer())
      }
      for (const [, v] of body.entries()) {
        if (typeof v === 'string') return new TextEncoder().encode(v)
      }
    }
    return new Uint8Array(0)
  }

  async function handleStorage(url, method, bodyText, rawBody) {
    const u = new URL(url)
    if (u.pathname.includes('/object/sign/')) {
      const path = decodeURIComponent(u.pathname.split('/object/sign/' + FILES_BUCKET + '/')[1] || '')
      const signedUrl = 'https://probe-ref.storage/' + FILES_BUCKET + '/' + path + '?token=probe'
      calls.storageSigns.push({ path, url: signedUrl })
      return json({ signedUrl })
    }
    if (u.pathname.endsWith('/object/remove')) {
      const parsed = bodyText ? JSON.parse(bodyText) : {}
      const prefixes = parsed.prefixes || []
      for (const p of prefixes) {
        store.delete(p)
        calls.storageRemoves.push(p)
      }
      return json([])
    }
    if (method === 'DELETE' && u.pathname === '/storage/v1/object/' + FILES_BUCKET) {
      const parsed = bodyText ? JSON.parse(bodyText) : {}
      const prefixes = parsed.prefixes || []
      for (const p of prefixes) {
        store.delete(p)
        calls.storageRemoves.push(p)
      }
      return json([])
    }
    if (method === 'POST' && u.pathname.includes('/object/' + FILES_BUCKET + '/')) {
      const path = decodeURIComponent(u.pathname.split('/object/' + FILES_BUCKET + '/')[1] || '')
      const bytes = await readBodyBytes(rawBody)
      store.set(path, bytes)
      calls.storageUploads.push({ path, size: bytes.length })
      return json({ Key: path })
    }
    return json({ message: 'stub: unknown storage url ' + url }, 404)
  }

  async function stubFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase()
    const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {})
    const rawBody = init.body || (typeof input !== 'string' && input.body) || null
    const bodyText = typeof rawBody === 'string' ? rawBody : null
    if (url.startsWith(BASE_URL + '/rest/v1/')) {
      return handleRest(url, method, headers, bodyText)
    }
    if (url.startsWith(BASE_URL + '/storage/v1/')) {
      return handleStorage(url, method, bodyText, rawBody)
    }
    if (url.startsWith('https://probe-ref.storage/')) {
      const u = new URL(url)
      const path = decodeURIComponent(u.pathname.replace('/' + FILES_BUCKET + '/', ''))
      const bytes = store.get(path)
      if (!bytes) return json({ message: 'not found' }, 404)
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
    }
    if (url.startsWith(BASE_URL + '/auth/v1/')) return json({})
    return json({ error: 'stub: unknown url ' + url }, 404)
  }

  return { calls, stubFetch, db, store }
}

// ---------- fake sessions ----------
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function fakeSession(userId = USER_ID, email = 'yasin@probe.test') {
  const jwt = b64url({ alg: 'none', typ: 'JWT' }) + '.' +
    b64url({ sub: userId, email, aud: 'authenticated', exp: 9999999999 }) + '.sig'
  return {
    access_token: jwt,
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated' }
  }
}

function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
}

function buildProbeBundle() {
  console.log('building probe bundle (probe URL + placeholder key)…')
  try {
    execFileSync('npm', ['run', 'build'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: BASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: PLACEHOLDER_KEY
      },
      stdio: 'inherit'
    })
  } catch (e) {
    throw new Error('probe build failed (npm run build): ' + (e.message || e))
  }
}

function assertProbeConfigured(js) {
  if (!js.includes('probe-ref')) {
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no probe-ref URL — ' +
      'the app would talk to the wrong project and the fake session would never restore'
    )
  }
  if (!js.includes(PLACEHOLDER_KEY)) {
    throw new Error(
      'probe bundle is NOT probe-configured: built bundle has no placeholder key — ' +
      'with no key the createClient call is dead-code-eliminated and the app can only show the login screen'
    )
  }
}

async function mountApp({ html, js }, stub, hash, session = fakeSession()) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
  virtualConsole.on('error', (msg) => errors.push('console.error: ' + String(msg)))
  const dom = new JSDOM(html, {
    url: 'http://localhost/sclack-a/' + hash,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const w = dom.window
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  if (!w.WebSocket) {
    w.WebSocket = class {
      constructor() { this.readyState = 0 }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
  }
  w.fetch = stub.stubFetch
  w.confirm = () => true
  w.localStorage.setItem('sb-probe-ref-auth-token', JSON.stringify(session))
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    // S5 made the bundle code-split: Vite's dynamic-import helper uses
    // import.meta (module-only) and Rollup emits a trailing facade
    // export — both are parse errors in a classic script. Patch the
    // eval'd copy only; the real browser loads the bundle as a module.
    const jsForEval = js
      .replaceAll('import.meta.resolve', 'void 0')
      .replaceAll('import.meta.url', "'http://localhost/'")
      .replace(/export\{[^}]*\};?\s*$/, '')
    w.eval(jsForEval)
  } catch (e) {
    errors.push('eval threw: ' + (e.message || e))
  }
  return { dom, w, errors }
}

async function waitFor(w, fn, timeoutMs = 10000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fn()
      if (v) return v
    } catch { /* retry */ }
    await sleep(150)
  }
  const screen = (w.document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400)
  throw new Error('timeout waiting for ' + label + ' — screen shows: ' + JSON.stringify(screen))
}

function setInput(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
function setSelect(w, el, value) {
  el.value = value
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
}
function clickButton(w, scope, label) {
  const btn = [...(scope || w.document).querySelectorAll('button')].find(
    (b) => b.textContent.trim() === label
  )
  if (!btn) throw new Error('button not found: ' + label)
  btn.click()
  return btn
}

// ---------- G6 mount helpers ----------
const g6Card = (w, n) => w.document.querySelector(`[data-g6-cmd="${n}"]`)
const g6Text = (w, n) => { const c = g6Card(w, n); return c ? norm(c.textContent) : '' }
const g6RowIds = (w, n) =>
  [...(g6Card(w, n)?.querySelectorAll('[data-g6-row]') || [])].map((li) => li.getAttribute('data-g6-row'))
const g6RowText = (w, n, id) => {
  const li = g6Card(w, n)?.querySelector(`[data-g6-row="${id}"]`)
  return li ? norm(li.textContent) : ''
}

async function runG6(w, n, { projectId = undefined, docId = undefined, word = undefined } = {}) {
  if (projectId !== undefined) {
    setSelect(w, w.document.querySelector('[data-g6-project]'), projectId)
    await sleep(300)
  }
  if (docId !== undefined) {
    setSelect(w, w.document.querySelector('[data-g6-doc]'), docId)
    await sleep(300)
  }
  if (word !== undefined) {
    setInput(w, w.document.querySelector('[data-g6-word]'), word)
    await sleep(200)
  }
  const btn = w.document.querySelector(`[data-g6-run="${n}"]`)
  if (!btn) throw new Error('G6 run button not found: ' + n)
  btn.click()
  await waitFor(w, () => {
    const c = g6Card(w, n)
    if (!c) return false
    return (
      c.querySelector('[data-g6-row], [data-g6-template], .text-error') ||
      c.textContent.includes('چیزی پیدا نشد') ||
      c.textContent.includes('قالب سندی پیدا نشد') ||
      c.textContent.includes('برای امروز کاری نیست')
    )
  }, 10000, 'G6 result for #' + n)
  await sleep(150)
}

function sectionByHeading(w, heading) {
  const h = [...w.document.querySelectorAll('h2')].find((x) => norm(x.textContent) === heading)
  if (!h) throw new Error('section not found: ' + heading)
  return h.closest('section')
}

// ---------- 3. MOUNT: #/assistant with the seeded two-project DB ----------
async function main() {
  const now = new Date()
  const isoAt = (dayOffset, time) =>
    tehranDayKey(addTehranDays(now, dayOffset)) + 'T' + time + '+03:30'

  // Source lock: the pulse messages select must carry `body` — G6
  // #13/#15/#23 render the message body as the row title, and live
  // PostgREST returns only selected columns (the stub returns whole
  // rows, so it cannot catch this on its own). The select sits a few
  // lines below the .from('messages') call (with a comment in between),
  // so match on the loadTeamPulseData block, not on adjacency.
  const dataJs = readFileSync(new URL('../src/lib/data.js', import.meta.url).pathname, 'utf8')
  const pulseBlock = dataJs.slice(dataJs.indexOf('loadTeamPulseData'))
  check('G6 source: pulse messages select includes body (titles for #13/#15/#23)',
    pulseBlock.slice(0, 2000).includes(".select('id, created_at, room_id, author_id, body')"))

  buildProbeBundle()
  const { html, js, jsFile } = loadBundle()
  console.log('bundle:', jsFile, js.length, 'bytes')
  assertProbeConfigured(js)
  check('G6 UI strings in built bundle',
    ['دستورهای تازهٔ دستیار', 'پیشنهاد بستن پروژه', 'چیزی پیدا نشد', 'پیشنهاد — هنوز بسته نشده'].every((s) => js.includes(s)))

  pureChecks()

  // ---- seeded mount ----
  const db = makeDb()
  seedG6(db, now)
  const stub = makeStub(db)

  // Oracles from the same pure functions (probe-p01-d pattern).
  const p1Tasks = db.tasks.filter((t) => t.project_id === PROJECT_ID)
  const p1Docs = db.docs.filter((d) => d.project_id === PROJECT_ID)
  const p1Files = db.files.filter((f) => f.project_id === PROJECT_ID)
  const p1Msgs = db.messages.filter((m) => m.room_id === ROOM_ID)
  // NOTE on input order: queryProjectRows returns tasks ordered by
  // created_at, so oracles whose sort has ties (#58: two tasks due at
  // the same time) must be fed the same order the loader sees.
  const byCreated = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  const p1TasksOrd = [...p1Tasks].sort(byCreated)
  const myReminders = db.reminders.filter((r) => r.user_id === MEMBER_ID)
  const review = computeProjectReview({ tasks: p1Tasks, docs: p1Docs, files: p1Files }, now)
  const deadline = projectDeadlineInfo(db.projects[0], p1Tasks, now)
  const pulse = computeTeamPulse({ messages: db.messages, tasks: db.tasks, docs: db.docs, files: db.files }, now)

  const m = await mountApp({ html, js }, stub, '#/assistant')
  const w = m.w
  allErrors.push(...m.errors)
  await waitFor(w, () => w.document.querySelector('[data-g6-area]'), 10000, 'G6 area')
  await waitFor(w, () => [...w.document.querySelectorAll('[data-g6-project] option')].some((o) => o.value === PROJECT_ID), 10000, 'project option loaded')
  await waitFor(w, () => [...w.document.querySelectorAll('[data-g6-doc] option')].some((o) => o.value === DOC_ID), 10000, 'doc option loaded')
  check('G6 mount: 24 new-command cards render', w.document.querySelectorAll('[data-g6-cmd]').length === 24, String(w.document.querySelectorAll('[data-g6-cmd]').length))

  // #1 project status
  await runG6(w, 1, { projectId: PROJECT_ID })
  check('G6 mount #1: row ids are the 6 review counters',
    JSON.stringify(g6RowIds(w, 1)) === JSON.stringify(['todo', 'doing', 'done', 'overdue', 'docs', 'newFiles']), JSON.stringify(g6RowIds(w, 1)))
  check('G6 mount #1: counters match the oracle (todo/done/overdue/docs/newFiles)',
    g6RowText(w, 1, 'todo').includes(String(review.todo)) &&
    g6RowText(w, 1, 'done').includes(String(review.done)) &&
    g6RowText(w, 1, 'overdue').includes(String(review.overdue)) &&
    g6RowText(w, 1, 'docs').includes(String(review.docs)) &&
    g6RowText(w, 1, 'newFiles').includes(String(review.newFiles)),
    g6Text(w, 1).slice(0, 300))

  // #3 project deadline
  await runG6(w, 3, { projectId: PROJECT_ID })
  check('G6 mount #3: days-left matches the oracle',
    g6RowText(w, 3, 'days').includes(faNum(deadline.daysLeft)), g6Text(w, 3).slice(0, 300))
  check('G6 mount #3: tasks-due-by-deadline matches the oracle',
    g6RowText(w, 3, 'tasks').includes(String(deadline.tasksDueByDeadline)), g6Text(w, 3).slice(0, 300))
  check('G6 mount #3: deadline label is the Jalali label from the oracle',
    g6RowText(w, 3, 'deadline').includes(deadline.deadlineLabel), g6Text(w, 3).slice(0, 300))

  // #8 suggest closing — project 1 (active) must NOT suggest…
  await runG6(w, 8, { projectId: PROJECT_ID })
  check('G6 mount #8: active project → «چیزی پیدا نشد» (no suggestion)',
    g6Text(w, 8).includes('چیزی پیدا نشد'), g6Text(w, 8).slice(0, 200))
  // …project 2 (review, all done) MUST suggest, and nothing closes
  // before the tap (30-list #3: no creation without a tap).
  check('G6 mount #8: before any tap, no project is archived',
    db.projects.every((p) => !p.archived))
  await runG6(w, 8, { projectId: PROJECT2_ID })
  check('G6 mount #8: review + all-done project → suggestion row + close button',
    g6RowIds(w, 8).includes('close') && !!w.document.querySelector(`[data-g6-close="${PROJECT2_ID}"]`), g6Text(w, 8).slice(0, 300))
  check('G6 mount #8: suggestion says «پیشنهاد — هنوز بسته نشده»',
    g6Text(w, 8).includes('پیشنهاد — هنوز بسته نشده'))
  check('G6 mount #8: running the suggestion still archives nothing',
    db.projects.every((p) => !p.archived))
  const closeBtn = w.document.querySelector(`[data-g6-close="${PROJECT2_ID}"]`)
  closeBtn.click()
  await waitFor(w, () => db.projects.find((p) => p.id === PROJECT2_ID).archived === true, 10000, 'project 2 archived after the tap')
  check('G6 mount #8: the one tap archives exactly project 2',
    db.projects.find((p) => p.id === PROJECT2_ID).archived === true &&
    db.projects.find((p) => p.id === PROJECT_ID).archived === false)
  await sleep(400)
  check('G6 mount #8: the button now says «بسته شد»',
    w.document.querySelector(`[data-g6-close="${PROJECT2_ID}"]`).textContent.trim() === 'بسته شد')

  // #13 today's messages
  await runG6(w, 13)
  check('G6 mount #13: row ids match the oracle (today, newest first)',
    JSON.stringify(g6RowIds(w, 13)) === JSON.stringify(todayMessages(db.messages, now).map((x) => x.id)), JSON.stringify(g6RowIds(w, 13)))
  check('G6 mount #13: first row is the newest message body',
    g6RowText(w, 13, g6RowIds(w, 13)[0]).includes('سلام، امروز جلسه داریم؟'))

  // #15 unanswered messages
  await runG6(w, 15, { projectId: PROJECT_ID })
  check('G6 mount #15: row ids match the oracle (oldest first)',
    JSON.stringify(g6RowIds(w, 15)) === JSON.stringify(unansweredMessages(p1Msgs).map((x) => x.id)), JSON.stringify(g6RowIds(w, 15)))

  // #23 open threads
  await runG6(w, 23, { projectId: PROJECT_ID })
  check('G6 mount #23: row ids match the oracle (most recent reply first)',
    JSON.stringify(g6RowIds(w, 23)) === JSON.stringify(openThreads(p1Msgs).map((t) => t.parent.id)), JSON.stringify(g6RowIds(w, 23)))
  check('G6 mount #23: first thread shows «۱ پاسخ»',
    g6RowText(w, 23, g6RowIds(w, 23)[0]).includes('۱ پاسخ'), g6Text(w, 23).slice(0, 300))

  // #25 my mentions (pointers only — no message text)
  await runG6(w, 25)
  check('G6 mount #25: row ids are the mentions, unread first',
    JSON.stringify(g6RowIds(w, 25)) === JSON.stringify(['n1', 'n2']), JSON.stringify(g6RowIds(w, 25)))
  check('G6 mount #25: unread mention shows sender + «خوانده‌نشده»',
    g6RowText(w, 25, 'n1').includes('منشن از زهرا') && g6RowText(w, 25, 'n1').includes('خوانده‌نشده'))
  check('G6 mount #25: read mention shows its sender, no unread mark',
    g6RowText(w, 25, 'n2').includes('منشن از yasin') && !g6RowText(w, 25, 'n2').includes('خوانده‌نشده'))

  // #27 unread notifications, grouped
  await runG6(w, 27)
  check('G6 mount #27: three groups of one row each',
    g6Text(w, 27).includes('منشن (1)') && g6Text(w, 27).includes('پاسخ (1)') && g6Text(w, 27).includes('یادآوری (1)'), g6Text(w, 27).slice(0, 300))
  check('G6 mount #27: rows name the sender / the overdue task',
    g6Text(w, 27).includes('منشن — زهرا') && g6Text(w, 27).includes('پاسخ — yasin') &&
    g6Text(w, 27).includes('یادآوری — کار «کار تمام‌شدهٔ قدیمی»'))

  // #33 stale docs
  await runG6(w, 33, { projectId: PROJECT_ID })
  check('G6 mount #33: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 33)) === JSON.stringify(staleDocs(p1Docs, now).map((d) => d.id)), JSON.stringify(g6RowIds(w, 33)))

  // #41 open comments of a doc
  await runG6(w, 41, { docId: DOC_ID })
  check('G6 mount #41: only the unresolved comment shows',
    JSON.stringify(g6RowIds(w, 41)) === JSON.stringify(['c1']), JSON.stringify(g6RowIds(w, 41)))
  check('G6 mount #41: the verbatim anchor quote shows',
    g6RowText(w, 41, 'c1').includes('بودجه'))

  // #45 versions of a doc
  await runG6(w, 45, { docId: DOC_ID })
  check('G6 mount #45: both versions, newest first',
    JSON.stringify(g6RowIds(w, 45)) === JSON.stringify(['ver-2', 'ver-1']), JSON.stringify(g6RowIds(w, 45)))
  check('G6 mount #45: version titles + notes render',
    g6RowText(w, 45, 'ver-2').includes('نسخهٔ ۲') && g6RowText(w, 45, 'ver-2').includes('نسخهٔ دوم'))

  // #49 fresh files / #54 unattached files
  await runG6(w, 49, { projectId: PROJECT_ID })
  check('G6 mount #49: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 49)) === JSON.stringify(freshFiles(p1Files, now).map((f) => f.id)), JSON.stringify(g6RowIds(w, 49)))
  await runG6(w, 54, { projectId: PROJECT_ID })
  check('G6 mount #54: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 54)) === JSON.stringify(unattachedFiles(p1Files).map((f) => f.id)), JSON.stringify(g6RowIds(w, 54)))

  // #58 / #59 / #63 / #64 task lists
  await runG6(w, 58, { projectId: PROJECT_ID })
  check('G6 mount #58: row ids match the oracle (loader order: created_at)',
    JSON.stringify(g6RowIds(w, 58)) === JSON.stringify(myTodayTasks(p1TasksOrd, MEMBER_ID, now).map((t) => t.id)), JSON.stringify(g6RowIds(w, 58)))
  await runG6(w, 59, { projectId: PROJECT_ID })
  check('G6 mount #59: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 59)) === JSON.stringify(overdueTasks(p1Tasks, now).map((t) => t.id)), JSON.stringify(g6RowIds(w, 59)))
  await runG6(w, 63, { projectId: PROJECT_ID })
  check('G6 mount #63: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 63)) === JSON.stringify(undatedTasks(p1Tasks).map((t) => t.id)), JSON.stringify(g6RowIds(w, 63)))
  await runG6(w, 64, { projectId: PROJECT_ID })
  check('G6 mount #64: row ids match the oracle',
    JSON.stringify(g6RowIds(w, 64)) === JSON.stringify(unassignedTasks(p1Tasks).map((t) => t.id)), JSON.stringify(g6RowIds(w, 64)))

  // #71 / #72 reminders — oracle, not hardcoded ids: whether «امروز»
  // counts as overdue depends on the real clock at run time.
  await runG6(w, 71)
  check('G6 mount #71: row ids match the oracle (today’s reminders)',
    JSON.stringify(g6RowIds(w, 71)) === JSON.stringify(todayReminders(myReminders, now).map((r) => r.id)), JSON.stringify(g6RowIds(w, 71)))
  await runG6(w, 72)
  check('G6 mount #72: row ids match the oracle (overdue reminders)',
    JSON.stringify(g6RowIds(w, 72)) === JSON.stringify(overdueReminders(myReminders, now).map((r) => r.id)), JSON.stringify(g6RowIds(w, 72)))

  // #84 search inside doc text
  await runG6(w, 84, { projectId: PROJECT_ID, word: 'بودجه' })
  check('G6 mount #84: exactly one hit row for «بودجه»',
    JSON.stringify(g6RowIds(w, 84)) === JSON.stringify([DOC_ID + '-0']), JSON.stringify(g6RowIds(w, 84)))
  check('G6 mount #84: the hit quotes the verbatim line + the doc title',
    g6RowText(w, 84, DOC_ID + '-0').includes('باید بودجهٔ پروژه را بررسی کنیم') &&
    g6RowText(w, 84, DOC_ID + '-0').includes('سند تازه'))
  await runG6(w, 84, { projectId: PROJECT_ID, word: 'ناموجود' })
  check('G6 mount #84 empty: no match → «چیزی پیدا نشد»',
    g6Text(w, 84).includes('چیزی پیدا نشد'))

  // #85 team pulse today
  await runG6(w, 85)
  check('G6 mount #85: row ids are the four pulse counters',
    JSON.stringify(g6RowIds(w, 85)) === JSON.stringify(['messages', 'done', 'docs', 'files']), JSON.stringify(g6RowIds(w, 85)))
  check('G6 mount #85: numbers match the oracle',
    g6RowText(w, 85, 'messages').includes(String(pulse.todayMessages)) &&
    g6RowText(w, 85, 'done').includes(String(pulse.doneThisWeek)) &&
    g6RowText(w, 85, 'docs').includes(String(pulse.activeDocs)) &&
    g6RowText(w, 85, 'files').includes(String(pulse.newFiles)), g6Text(w, 85).slice(0, 300))

  // #92 daily team report (guardian + pulse + unread mentions)
  await runG6(w, 92, { projectId: PROJECT_ID })
  check('G6 mount #92: all three section headings render',
    g6Text(w, 92).includes('مهلت‌ها') && g6Text(w, 92).includes('نبض تیم') && g6Text(w, 92).includes('منشن‌های خوانده‌نشدهٔ من'), g6Text(w, 92).slice(0, 400))
  check('G6 mount #92: guardian tasks + pulse numbers + unread mention all present',
    g6Text(w, 92).includes('کار امروز من') && g6Text(w, 92).includes('کار عقب‌مانده') &&
    g6Text(w, 92).includes('کار بدون مسئول') && g6Text(w, 92).includes('منشن از زهرا'))
  check('G6 mount #92: guardian recorded exactly one reminder pointer (4 seeded + 1)',
    db.notifications.length === 5, JSON.stringify(db.notifications.map((n) => [n.type, n.target_id])))

  // #95 last activity per member (before #99 creates a doc — a new doc
  // would become yasin's newest activity and change the expectation).
  await runG6(w, 95)
  check('G6 mount #95: one row per member',
    JSON.stringify(g6RowIds(w, 95)) === JSON.stringify([MEMBER_ID, MEMBER2_ID]), JSON.stringify(g6RowIds(w, 95)))
  check('G6 mount #95: yasin’s last activity is a message',
    g6RowText(w, 95, MEMBER_ID).includes('پیام'), g6RowText(w, 95, MEMBER_ID))
  check('G6 mount #95: Zahra’s last activity is a message',
    g6RowText(w, 95, MEMBER2_ID).includes('پیام'), g6RowText(w, 95, MEMBER2_ID))

  // #99 template suggestion — nothing is created before the tap
  // (30-list #30: no creation without a tap).
  await runG6(w, 99)
  check('G6 mount #99: three doc templates listed',
    w.document.querySelectorAll('[data-g6-template]').length === 3,
    String(w.document.querySelectorAll('[data-g6-template]').length))
  check('G6 mount #99: every template is labelled «پیشنهاد — هنوز ساخته نشده»',
    g6Text(w, 99).includes('پیشنهاد — هنوز ساخته نشده'))
  check('G6 mount #99: before the tap, still exactly the 3 seeded docs',
    db.docs.length === 3, String(db.docs.length))
  const tplRow = w.document.querySelector('[data-g6-template="tpl-1"]')
  const tplBtn = [...tplRow.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن سند')
  check('G6 mount #99: create button exists on the first template', !!tplBtn)
  tplBtn.click()
  await waitFor(w, () => db.docs.length === 4, 10000, 'doc created from template')
  const freshDoc = db.docs.find((d) => d.title === 'یادداشت جلسه')
  check('G6 mount #99: the tap creates exactly one doc from the template',
    !!freshDoc && freshDoc.project_id === PROJECT_ID, JSON.stringify(freshDoc))
  await sleep(400)
  check('G6 mount #99: the tapped template now says «ساخته شد»',
    tplRow.textContent.includes('ساخته شد'))

  // ---- the 6 existing commands, re-exercised through the panel ----
  // #57 deadline guardian
  const guardianSection = () => w.document.querySelector('[data-guardian]')
  clickButton(w, w.document, 'خلاصهٔ امروز')
  await waitFor(w, () => guardianSection().textContent.includes('کار امروز من'), 10000, 'guardian today task renders')
  const gText = norm(guardianSection().textContent)
  check('G6 mount #57: guardian groups show 1/1/1',
    gText.includes('کارهای امروز (1)') && gText.includes('کارهای عقب‌مانده (1)') && gText.includes('سررسیدهای نزدیک (۴۸ ساعت آینده) (1)'), gText.slice(0, 300))
  check('G6 mount #57: second summary adds no duplicate pointer (still 5 notifications)',
    db.notifications.length === 5, String(db.notifications.length))

  // #11 room summary
  const roomSection = sectionByHeading(w, 'خلاصهٔ اتاق')
  setSelect(w, roomSection.querySelector('select'), ROOM_ID)
  await sleep(300)
  clickButton(w, roomSection, 'خلاصه کن')
  await waitFor(w, () => roomSection.textContent.includes('8 پیام'), 10000, 'room summary renders')
  check('G6 mount #11: room summary counts 8 messages + a verbatim line',
    roomSection.textContent.includes('8 پیام') && roomSection.textContent.includes('باید گزارش ماهانه را آماده کنیم'))

  // #31 doc summary
  const docSection = sectionByHeading(w, 'خلاصهٔ سند')
  setSelect(w, docSection.querySelector('select'), DOC_ID)
  await sleep(300)
  clickButton(w, docSection, 'خلاصه کن')
  await waitFor(w, () => docSection.textContent.includes('نویسه'), 10000, 'doc summary renders')
  check('G6 mount #31: doc summary shows the first paragraph verbatim',
    docSection.textContent.includes('باید بودجهٔ پروژه را بررسی کنیم'))

  // #21 chat-to-task (30-list #7): no task before the tap.
  const chatSection = w.document.querySelector('[data-chat-sug]')
  setSelect(w, chatSection.querySelector('select'), ROOM_ID)
  await sleep(300)
  check('G6 mount #21: before running, still exactly the 8 seeded tasks',
    db.tasks.length === 8, String(db.tasks.length))
  clickButton(w, chatSection, 'پیشنهاد از چت')
  await waitFor(w, () => chatSection.textContent.includes('باید گزارش ماهانه را آماده کنیم'), 10000, 'chat suggestion renders')
  const chatRows = [...w.document.querySelectorAll('[data-chat-suggestion]')]
  check('G6 mount #21: exactly 1 suggestion from the action line',
    chatRows.length === 1, String(chatRows.length))
  check('G6 mount #21: running the suggestion creates nothing',
    db.tasks.length === 8, String(db.tasks.length))
  const chatBtn = [...chatRows[0].querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')
  chatBtn.click()
  await waitFor(w, () => db.tasks.length === 9, 10000, 'task created from chat suggestion')
  const chatTask = db.tasks.find((t) => t.title === 'باید گزارش ماهانه را آماده کنیم')
  check('G6 mount #21: created row has the quoted title + author assignee + source fields',
    !!chatTask && chatTask.assignee_id === MEMBER_ID &&
    chatTask.custom_fields?.source_message_id === 'msg-1' &&
    chatTask.custom_fields?.source_quote === 'باید گزارش ماهانه را آماده کنیم',
    JSON.stringify(chatTask && chatTask.custom_fields))
  check('G6 mount #21: created row due_at is the suggested due date',
    !!chatTask && chatTask.due_at === suggestDueAt('باید گزارش ماهانه را آماده کنیم', now),
    JSON.stringify(chatTask && chatTask.due_at))
  await sleep(400)
  check('G6 mount #21: the created suggestion now says «ساخته شد»',
    chatRows[0].textContent.includes('ساخته شد'))

  // #36 doc-to-task (30-list #13): no task before the tap.
  const sugBtn = [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'پیشنهاد بده')
  const sugSection = sugBtn.closest('section')
  setSelect(w, sugSection.querySelector('select'), DOC_ID)
  await sleep(300)
  check('G6 mount #36: before running, still exactly 9 tasks',
    db.tasks.length === 9, String(db.tasks.length))
  sugBtn.click()
  await waitFor(w, () => sugSection.textContent.includes('باید بودجهٔ پروژه را بررسی کنیم'), 10000, 'doc suggestion renders')
  const docRows = [...sugSection.querySelectorAll('[data-doc-suggestion]')]
  check('G6 mount #36: exactly 1 suggestion from the doc action line',
    docRows.length === 1, String(docRows.length))
  check('G6 mount #36: running the suggestion creates nothing',
    db.tasks.length === 9, String(db.tasks.length))
  const docBtn = [...docRows[0].querySelectorAll('button')].find((b) => b.textContent.trim() === 'ساختن کار')
  docBtn.click()
  await waitFor(w, () => db.tasks.length === 10, 10000, 'task created from doc suggestion')
  const docTask = db.tasks.find((t) => t.title === 'باید بودجهٔ پروژه را بررسی کنیم')
  check('G6 mount #36: created row has source_doc_id + source_quote, assignee null',
    !!docTask && docTask.custom_fields?.source_doc_id === DOC_ID &&
    docTask.custom_fields?.source_quote === 'باید بودجهٔ پروژه را بررسی کنیم' &&
    docTask.assignee_id === null, JSON.stringify(docTask && docTask.custom_fields))
  m.dom.window.close()

  // ---- empty mount: members only — honest empty states, never a number ----
  const db2 = makeDb()
  const stub2 = makeStub(db2)
  const m2 = await mountApp({ html, js }, stub2, '#/assistant')
  const w2 = m2.w
  allErrors.push(...m2.errors)
  await waitFor(w2, () => w2.document.querySelector('[data-g6-area]'), 10000, 'G6 area (empty)')
  for (const n of [1, 3, 8, 15, 23, 33, 49, 54, 58, 59, 63, 64, 92]) {
    await runG6(w2, n, { projectId: '' })
    check(`G6 empty #${n}: honest «پروژه انتخاب نشده است»`,
      g6Text(w2, n).includes('پروژه انتخاب نشده است'), g6Text(w2, n).slice(0, 200))
  }
  for (const n of [41, 45]) {
    await runG6(w2, n, { docId: '' })
    check(`G6 empty #${n}: honest «سند انتخاب نشده است»`,
      g6Text(w2, n).includes('سند انتخاب نشده است'), g6Text(w2, n).slice(0, 200))
  }
  await runG6(w2, 84, { projectId: '', word: 'بودجه' })
  check('G6 empty #84: honest «پروژه انتخاب نشده است»',
    g6Text(w2, 84).includes('پروژه انتخاب نشده است'))
  for (const n of [13, 25, 27, 71, 72, 85, 95]) {
    await runG6(w2, n)
    check(`G6 empty #${n}: honest «چیزی پیدا نشد»`,
      g6Text(w2, n).includes('چیزی پیدا نشد'), g6Text(w2, n).slice(0, 200))
  }
  await runG6(w2, 99)
  check('G6 empty #99: honest «قالب سندی پیدا نشد»',
    g6Text(w2, 99).includes('قالب سندی پیدا نشد'))
  check('G6 empty: the empty mount created nothing',
    db2.projects.length === 0 && db2.tasks.length === 0 && db2.docs.length === 0 && db2.notifications.length === 0,
    JSON.stringify({ p: db2.projects.length, t: db2.tasks.length, d: db2.docs.length, n: db2.notifications.length }))
  m2.dom.window.close()

  // ---- JS errors ----
  const realErrors = allErrors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors across all mounts', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)))
  if (allErrors.length > 0) console.log('note: filtered Realtime/WebSocket noise:', allErrors.length, 'entries')

  console.log(failures === 0 ? 'ALL G6 PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('G6 PROBE FAILED:', e.message)
  console.log('window errors:', JSON.stringify(allErrors, null, 2))
  process.exit(1)
})
