import { sb } from './supabase.js'
import { auth, ws, pulse } from './store.svelte.js'
import { memberName, loadTeamPulseData, closeProject } from './data.js'
import { loadDocRow, loadComments, formatFileSize } from './docs.js'
import {
  createTask,
  loadReminders,
  loadTemplates,
  searchWorkspace,
  textFromStateB64,
  listVersions,
  createFromTemplate
} from './work.js'
import { loadNotifications, roomNameFor, notificationLink, notificationTypeLabel } from './notifications.js'
import {
  extractRoomSummary,
  extractDocSummary,
  computeDeadlineGuardian,
  computeProjectReview,
  computeTeamPulse,
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
  faNum,
  jalaliDayLabel,
  TASK_STATUS_LABEL
} from './extract.js'

// «دستیار میوز» — EXTRACTIVE-ONLY by design (no model text generation).
// Every answer quotes or counts real content; when there is nothing real,
// the answer is found: false. The purple accent (--ai-accent) lives ONLY
// in the assistant panel.

export async function loadDocText(docId) {
  const row = await loadDocRow(docId)
  const b64 = row.custom_fields?.yjs_state_b64
  return { row, text: textFromStateB64(b64) }
}

export async function summarizeRoom(roomId) {
  if (!sb || !roomId) throw new Error('اتاقی انتخاب نشده است.')
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return extractRoomSummary(data || [], (id) => memberName(id))
}

export async function summarizeDoc(docId) {
  const { row, text } = await loadDocText(docId)
  return { ...extractDocSummary(text), title: row.title }
}

export async function suggestTasksFromDoc(docId) {
  const { row, text } = await loadDocText(docId)
  const suggestions = extractDocTaskSuggestions(text, docId)
  return { doc: row, suggestions }
}

// P01 D2 (chat): suggestions from a room's messages. The suggestion
// carries the verbatim quote, the suggested assignee (the message's
// author) and the suggested due date; nothing is created here.
export async function suggestTasksFromChat(roomId) {
  if (!sb || !roomId) throw new Error('اتاقی انتخاب نشده است.')
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return extractChatTaskSuggestions(data || [])
}

// P01 D2: create ONE task from a suggestion, only when the user taps.
// The row carries the suggested assignee and due date plus the source
// provenance in custom_fields (source_message_id / source_doc_id /
// source_quote); created_by is the member who tapped, as always.
export async function createTaskFromSuggestion(suggestion, { projectId, linkType, linkId }) {
  if (!suggestion) throw new Error('پیشنهادی انتخاب نشده است.')
  return createTask({
    projectId,
    title: suggestion.title || suggestion.quote,
    description: null,
    assigneeId: suggestion.assigneeId || null,
    dueAt: suggestion.dueAt || null,
    linkType: linkType || null,
    linkId: linkId || null,
    source: {
      source_message_id: suggestion.source_message_id || null,
      source_doc_id: suggestion.source_doc_id || null,
      source_quote: suggestion.quote || null
    }
  })
}

// P01 D1: deadline guardian. Loads the project's tasks + the member's
// reminders, computes the three buckets (today / overdue / due within
// 48 h), and records a reminder pointer for each overdue task. The
// pointer goes to the SIGNED-IN member (the person reading the summary):
// the notifications table's SELECT policy is recipient-only, so a
// pointer recorded for someone else could never be de-duplicated by
// its viewer — recording for the viewer keeps the check exact and the
// summary idempotent. The row is a pointer only (type + target_id);
// the table has no text column, so no message text is ever stored.
export async function loadDeadlineGuardian(projectId) {
  if (!projectId) throw new Error('پروژه انتخاب نشده است.')
  // Direct read of THIS project's tasks — not via loadTasks/ws.tasks:
  // loadTasks drops the result when projectId differs from the
  // sidebar's current project (its stale-response guard), so the
  // guardian used to compute on the current project's tasks for a
  // non-current selected project. Same direct-read pattern as the
  // G6 loaders (queryProjectRows). loadTasks itself is untouched —
  // its stale guard is still needed on the other paths.
  const { tasks } = await queryProjectRows(projectId)
  await loadReminders()
  const guardian = computeDeadlineGuardian(tasks, ws.reminders, new Date())
  const remindersRecorded = await ensureOverdueReminderPointers(guardian.overdue)
  return { ...guardian, remindersRecorded }
}

export async function ensureOverdueReminderPointers(overdueTasks) {
  if (!sb || !auth.member || !overdueTasks.length) return 0
  const { data, error } = await sb
    .from('notifications')
    .select('target_id')
    .eq('type', 'reminder')
    .eq('user_id', auth.member.id)
  if (error) throw error
  const have = new Set((data || []).map((r) => r.target_id))
  let recorded = 0
  for (const t of overdueTasks) {
    if (have.has(t.id)) continue
    const { error: ierr } = await sb.from('notifications').insert({
      user_id: auth.member.id,
      type: 'reminder',
      target_id: t.id,
      read: false
    })
    if (ierr) throw ierr
    have.add(t.id)
    recorded++
  }
  return recorded
}

// Ask the workspace: real search hits only. Nothing found -> found: false.
export async function askWorkspace(query) {
  const hits = await searchWorkspace(query)
  return { found: hits.length > 0, hits }
}

// ---------- G6: 30 top commands (24 new + 6 existing) ----------
// Every loader below returns { found, ... } — found:false means "nothing
// real here", rendered as «پیدا نشد», never a fabricated number. No
// loader creates, changes or deletes anything by itself; the only
// writes are the documented ones: the guardian's reminder pointers
// (D1, existing) and the user's one-tap actions (close project,
// create from a template, create a task from a suggestion).

// Direct project-scoped reads (local rows, not ws): the ws loaders
// discard results for a non-current project (D6 bug 5 guard), so a
// command on a selected-but-not-current project must query directly.
async function queryProject(projectId) {
  if (!sb || !projectId) throw new Error('پروژه انتخاب نشده است.')
  const { data, error } = await sb.from('projects').select('*').eq('id', projectId).single()
  if (error) throw error
  return data
}

async function queryProjectRows(projectId) {
  if (!sb || !projectId) throw new Error('پروژه انتخاب نشده است.')
  const [tasks, docs, files, rooms] = await Promise.all([
    sb.from('tasks').select('*').eq('project_id', projectId).order('created_at'),
    sb.from('docs').select('*').eq('project_id', projectId).order('created_at'),
    sb.from('files').select('*').eq('project_id', projectId).order('uploaded_at', { ascending: false }),
    sb.from('rooms').select('id, project_id, name').eq('project_id', projectId).order('created_at')
  ])
  for (const r of [tasks, docs, files, rooms]) if (r.error) throw r.error
  return {
    tasks: tasks.data || [],
    docs: docs.data || [],
    files: files.data || [],
    rooms: rooms.data || []
  }
}

function taskRow(t) {
  return {
    id: t.id,
    title: t.title,
    sub:
      (TASK_STATUS_LABEL[t.status] || t.status) +
      ' · ' +
      memberName(t.assignee_id) +
      (t.due_at ? ' · سررسید ' + jalaliDayLabel(t.due_at) : ' · بدون تاریخ'),
    link: '#/tasks'
  }
}

function pulseRoomName(roomId) {
  const r = (pulse.rooms || []).find((x) => x.id === roomId)
  return r ? r.name : 'اتاق'
}

// #1 (100-list): project status — the existing computeProjectReview,
// rendered as label rows.
export async function projectStatus(projectId) {
  const project = await queryProject(projectId)
  const { tasks, docs, files } = await queryProjectRows(projectId)
  const review = computeProjectReview({ tasks, docs, files }, new Date())
  return {
    found: true,
    project,
    rows: [
      { id: 'todo', title: 'کارهای باز', sub: String(review.todo) },
      { id: 'doing', title: 'در حال انجام', sub: String(review.doing) },
      { id: 'done', title: 'تمام‌شده', sub: String(review.done) },
      { id: 'overdue', title: 'عقب‌مانده', sub: String(review.overdue) },
      { id: 'docs', title: 'سندها', sub: String(review.docs) },
      { id: 'newFiles', title: 'فایل‌های تازه (۷ روز اخیر)', sub: String(review.newFiles) }
    ]
  }
}

// #3 (100-list): project deadline.
export async function projectDeadline(projectId) {
  const project = await queryProject(projectId)
  const { tasks } = await queryProjectRows(projectId)
  const info = projectDeadlineInfo(project, tasks, new Date())
  if (!info.found) return { found: false, project, rows: [] }
  return {
    found: true,
    project,
    rows: [
      { id: 'deadline', title: 'مهلت', sub: info.deadlineLabel },
      { id: 'days', title: 'روزهای مانده', sub: faNum(info.daysLeft) },
      { id: 'tasks', title: 'کارهای ناتمام تا مهلت', sub: String(info.tasksDueByDeadline) }
    ]
  }
}

// #8 (100-list): suggest closing the project. The suggestion never
// closes anything — the UI closes only on the user's one tap
// (closeProjectFromSuggestion below).
export async function suggestCloseProject(projectId) {
  const project = await queryProject(projectId)
  const { tasks } = await queryProjectRows(projectId)
  const s = suggestProjectClose(project, tasks)
  if (!s.suggested) return { found: false, project, suggested: false, reason: s.reason, rows: [] }
  return {
    found: true,
    project,
    suggested: true,
    rows: [
      {
        id: 'close',
        title: 'همهٔ کارها تمام شده‌اند (' + faNum(s.doneCount) + ' کار)',
        sub: 'مرحله: در بازبینی'
      }
    ]
  }
}

export async function closeProjectFromSuggestion(project) {
  return closeProject(project)
}

// #13 (100-list): today's messages, workspace-wide.
export async function listTodayMessages() {
  await loadTeamPulseData()
  const list = todayMessages(pulse.messages, new Date())
  return {
    found: list.length > 0,
    rows: list.map((m) => ({
      id: m.id,
      title: m.body,
      sub: memberName(m.author_id) + ' · ' + pulseRoomName(m.room_id),
      link: '#/room/' + m.room_id
    }))
  }
}

// #15 (100-list): unanswered messages in the project's rooms.
export async function listUnansweredMessages(projectId) {
  if (!projectId) throw new Error('پروژه انتخاب نشده است.')
  await loadTeamPulseData()
  const roomIds = new Set(
    (pulse.rooms || []).filter((r) => r.project_id === projectId).map((r) => r.id)
  )
  const list = unansweredMessages((pulse.messages || []).filter((m) => roomIds.has(m.room_id)))
  return {
    found: list.length > 0,
    rows: list.map((m) => ({
      id: m.id,
      title: m.body,
      sub: memberName(m.author_id) + ' · ' + pulseRoomName(m.room_id),
      link: '#/room/' + m.room_id
    }))
  }
}

// #23 (100-list): open threads in the project's rooms.
export async function listOpenThreads(projectId) {
  if (!projectId) throw new Error('پروژه انتخاب نشده است.')
  await loadTeamPulseData()
  const roomIds = new Set(
    (pulse.rooms || []).filter((r) => r.project_id === projectId).map((r) => r.id)
  )
  const list = openThreads((pulse.messages || []).filter((m) => roomIds.has(m.room_id)))
  return {
    found: list.length > 0,
    rows: list.map((t) => ({
      id: t.parent.id,
      title: t.parent.body,
      sub:
        faNum(t.replyCount) +
        ' پاسخ · آخرین پاسخ از ' +
        memberName(t.lastReply.author_id) +
        ' · ' +
        pulseRoomName(t.parent.room_id),
      link: '#/room/' + t.parent.room_id
    }))
  }
}

// #25 (100-list): my mentions — pointers only (no message text).
export async function loadMyMentions() {
  const all = await loadNotifications()
  const mentions = mentionsFirst(all)
  return {
    found: mentions.length > 0,
    rows: mentions.map((n) => ({
      id: n.id,
      title: 'منشن از ' + memberName(n.message?.author_id),
      sub: roomNameFor(n) + (n.read ? '' : ' · خوانده‌نشده'),
      link: notificationLink(n),
      read: n.read
    }))
  }
}

// #27 (100-list): my unread notifications, grouped by type.
export async function loadUnreadNotifications() {
  const all = await loadNotifications()
  const unread = (all || []).filter((n) => !n.read)
  await loadTeamPulseData()
  const taskById = new Map((pulse.tasks || []).map((t) => [t.id, t]))
  const groups = groupNotificationsByType(unread).map((g) => ({
    ...g,
    rows: g.rows.map((n) => {
      let title = notificationTypeLabel(n.type)
      if (n.message) title += ' — ' + memberName(n.message.author_id)
      else if (n.type === 'reminder' && taskById.get(n.target_id)) {
        title += ' — کار «' + taskById.get(n.target_id).title + '»'
      }
      return {
        id: n.id,
        title,
        sub: roomNameFor(n) || (n.type === 'reminder' ? 'یادآوری کار عقب‌مانده' : ''),
        link: notificationLink(n)
      }
    })
  }))
  return { found: unread.length > 0, groups, total: unread.length }
}

// #33 (100-list): stale docs — untouched for 7 days or more.
export async function listStaleDocs(projectId) {
  const { docs } = await queryProjectRows(projectId)
  const list = staleDocs(docs, new Date())
  return {
    found: list.length > 0,
    rows: list.map((d) => ({
      id: d.id,
      title: d.title,
      sub: 'آخرین تغییر: ' + jalaliDayLabel(d.updated_at || d.created_at),
      link: '#/doc/' + d.id
    }))
  }
}

// #41 (100-list): open comments of one doc — verbatim quotes.
export async function listOpenComments(docId) {
  if (!docId) throw new Error('سند انتخاب نشده است.')
  const comments = await loadComments(docId)
  const list = openComments(comments)
  return {
    found: list.length > 0,
    rows: list.map((c) => ({
      id: c.id,
      title: c.body,
      sub: memberName(c.author_id) + (c.anchor?.quote ? ' · «' + c.anchor.quote + '»' : ''),
      link: '#/doc/' + docId
    }))
  }
}

// #45 (100-list): versions of one doc, newest version first.
export async function listDocVersions(docId) {
  if (!docId) throw new Error('سند انتخاب نشده است.')
  const versions = await listVersions(docId)
  return {
    found: versions.length > 0,
    rows: versions.map((v) => ({
      id: v.id,
      title: 'نسخهٔ ' + faNum(v.version_no),
      sub: memberName(v.author_id) + (v.note ? ' · ' + v.note : ''),
      link: '#/doc/' + docId
    }))
  }
}

// #49 (100-list): fresh files — uploaded in the last 7 days.
export async function listFreshFiles(projectId) {
  const { files } = await queryProjectRows(projectId)
  const list = freshFiles(files, new Date())
  return {
    found: list.length > 0,
    rows: list.map((f) => ({
      id: f.id,
      title: f.name,
      sub: formatFileSize(f.size) + ' · ' + memberName(f.uploaded_by),
      link: '#/'
    }))
  }
}

// #54 (100-list): unattached files — uploaded but linked to nothing.
export async function listUnattachedFiles(projectId) {
  const { files } = await queryProjectRows(projectId)
  const list = unattachedFiles(files)
  return {
    found: list.length > 0,
    rows: list.map((f) => ({
      id: f.id,
      title: f.name,
      sub: formatFileSize(f.size) + ' · ' + memberName(f.uploaded_by),
      link: '#/'
    }))
  }
}

// #58 (100-list): my tasks due today (Tehran).
export async function listMyTodayTasks(projectId) {
  const { tasks } = await queryProjectRows(projectId)
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const list = myTodayTasks(tasks, auth.member.id, new Date())
  return { found: list.length > 0, rows: list.map(taskRow) }
}

// #59 (100-list): overdue tasks, most overdue first.
export async function listOverdueTasks(projectId) {
  const { tasks } = await queryProjectRows(projectId)
  const list = overdueTasks(tasks, new Date())
  return {
    found: list.length > 0,
    rows: list.map((t) => ({ ...taskRow(t), sub: 'عقب‌مانده · ' + taskRow(t).sub }))
  }
}

// #63 (100-list): undated unfinished tasks.
export async function listUndatedTasks(projectId) {
  const { tasks } = await queryProjectRows(projectId)
  const list = undatedTasks(tasks)
  return {
    found: list.length > 0,
    rows: list.map((t) => ({ ...taskRow(t), sub: 'بدون تاریخ · ' + taskRow(t).sub }))
  }
}

// #64 (100-list): unassigned unfinished tasks.
export async function listUnassignedTasks(projectId) {
  const { tasks } = await queryProjectRows(projectId)
  const list = unassignedTasks(tasks)
  return {
    found: list.length > 0,
    rows: list.map((t) => ({ ...taskRow(t), sub: 'بدون مسئول · ' + taskRow(t).sub }))
  }
}

// #71 (100-list): my reminders due today (Tehran).
export async function listTodayReminders() {
  await loadReminders()
  const list = todayReminders(ws.reminders, new Date())
  return {
    found: list.length > 0,
    rows: list.map((r) => ({ id: r.id, title: r.text, sub: 'امروز', link: '#/tasks' }))
  }
}

// #72 (100-list): my overdue reminders.
export async function listOverdueReminders() {
  await loadReminders()
  const list = overdueReminders(ws.reminders, new Date())
  return {
    found: list.length > 0,
    rows: list.map((r) => ({
      id: r.id,
      title: r.text,
      sub: 'عقب‌مانده · ' + jalaliDayLabel(r.remind_at),
      link: '#/tasks'
    }))
  }
}

// #84 (100-list): search inside doc text — the doc text is decoded
// from Yjs state (textFromStateB64) and searched client-side.
export async function searchDocsText(projectId, word) {
  const q = (word || '').trim()
  if (!q) throw new Error('واژه‌ای برای جست‌وجو بنویسید.')
  const { docs } = await queryProjectRows(projectId)
  const withText = []
  for (const d of docs) {
    const { text } = await loadDocText(d.id)
    withText.push({ docId: d.id, title: d.title, text })
  }
  const hits = searchDocLines(withText, q)
  return {
    found: hits.length > 0,
    word: q,
    rows: hits.flatMap((h) =>
      h.lines.map((line, i) => ({
        id: h.docId + '-' + i,
        title: '«' + line + '»',
        sub: h.title + (h.total > h.lines.length ? ' · +' + faNum(h.total - h.lines.length) + ' خط دیگر' : ''),
        link: '#/doc/' + h.docId
      }))
    )
  }
}

// #85 (100-list): team pulse today — the four home-dashboard numbers.
export async function loadTeamPulseToday() {
  await loadTeamPulseData()
  const p = computeTeamPulse(
    { messages: pulse.messages, tasks: pulse.tasks, docs: pulse.docs, files: pulse.files },
    new Date()
  )
  const total = p.todayMessages + p.doneThisWeek + p.activeDocs + p.newFiles
  return {
    found: total > 0,
    pulse: p,
    rows: [
      { id: 'messages', title: 'پیام‌های امروز', sub: String(p.todayMessages) },
      { id: 'done', title: 'کارهای تمام‌شدهٔ این هفته', sub: String(p.doneThisWeek) },
      { id: 'docs', title: 'سندهای فعال', sub: String(p.activeDocs) },
      { id: 'files', title: 'فایل‌های تازه (۷ روز اخیر)', sub: String(p.newFiles) }
    ]
  }
}

// #92 (100-list): daily team report — guardian + pulse + my unread
// mentions, each with its own empty state. The guardian's reminder
// pointers (D1) are the one documented silent write.
export async function loadDailyReport(projectId) {
  if (!projectId) throw new Error('پروژه انتخاب نشده است.')
  const guardian = await loadDeadlineGuardian(projectId)
  const pulseRes = await loadTeamPulseToday()
  const mentions = await loadMyMentions()
  const found = guardian.found || pulseRes.found || mentions.found
  const sections = [
    {
      title: 'مهلت‌ها',
      rows: [
        ...guardian.today.map((t) => ({ ...taskRow(t), sub: 'امروز · ' + taskRow(t).sub })),
        ...guardian.overdue.map((t) => ({ ...taskRow(t), sub: 'عقب‌مانده · ' + taskRow(t).sub })),
        ...guardian.soon.map((t) => ({ ...taskRow(t), sub: 'نزدیک · ' + taskRow(t).sub }))
      ]
    },
    { title: 'نبض تیم', rows: pulseRes.rows },
    { title: 'منشن‌های خوانده‌نشدهٔ من', rows: mentions.rows.filter((r) => !r.read) }
  ]
  return { found, sections, remindersRecorded: guardian.remindersRecorded }
}

// #95 (100-list): last activity of every member.
export async function lastActivity() {
  await loadTeamPulseData()
  const members = ws.members.length > 0 ? ws.members : await queryMembers()
  const rows = lastActivityByMember(
    { messages: pulse.messages, docs: pulse.docs, tasks: pulse.tasks, files: pulse.files },
    members
  )
  return {
    found: rows.some((r) => r.activity),
    rows: rows.map((r) => ({
      id: r.memberId,
      title: r.name,
      sub: r.activity
        ? r.activity.label + ' · ' + jalaliDayLabel(r.activity.at)
        : 'هنوز فعالیتی نیست'
    }))
  }
}

async function queryMembers() {
  if (!sb) return []
  const { data, error } = await sb.from('members').select('*').order('joined_at')
  if (error) throw error
  return data || []
}

// #99 (100-list): doc templates — suggestion only; the doc is created
// on the user's one tap (createDocFromTemplate below).
export async function listDocTemplates() {
  await loadTemplates()
  const templates = (ws.templates || []).filter((t) => (t.structure?.kind || t.type) === 'doc')
  return { found: templates.length > 0, templates }
}

export async function createDocFromTemplate(template, projectId) {
  if (!template) throw new Error('قالب مشخص نیست.')
  if (!projectId) throw new Error('اول یک پروژه انتخاب کنید.')
  return createFromTemplate(template, { projectId })
}

export function assistantState() {
  return { user: auth.user, member: auth.member, projects: ws.projects }
}
