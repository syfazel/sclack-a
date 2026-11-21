import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import { memberName } from './data.js'
import { loadDocRow } from './docs.js'
import { createTask, loadTasks, loadReminders, searchWorkspace, textFromStateB64 } from './work.js'
import {
  extractRoomSummary,
  extractDocSummary,
  computeDeadlineGuardian,
  extractChatTaskSuggestions,
  extractDocTaskSuggestions
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
  await loadTasks(projectId)
  await loadReminders()
  const guardian = computeDeadlineGuardian(ws.tasks, ws.reminders, new Date())
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

export function assistantState() {
  return { user: auth.user, member: auth.member, projects: ws.projects }
}
