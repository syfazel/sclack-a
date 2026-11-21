import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import { memberName } from './data.js'
import { loadDocRow } from './docs.js'
import { createTask, searchWorkspace, textFromStateB64 } from './work.js'
import {
  extractRoomSummary,
  extractDocSummary,
  extractTaskSuggestions
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
  const suggestions = extractTaskSuggestions(text)
  return { doc: row, suggestions }
}

export async function createTaskFromSuggestion(doc, quote) {
  return createTask({
    projectId: doc.project_id,
    title: quote,
    description: 'پیشنهاد دستیار از سند «' + doc.title + '»',
    assigneeId: null,
    dueAt: null,
    linkType: 'doc',
    linkId: doc.id
  })
}

// Ask the workspace: real search hits only. Nothing found -> found: false.
export async function askWorkspace(query) {
  const hits = await searchWorkspace(query)
  return { found: hits.length > 0, hits }
}

export function assistantState() {
  return { user: auth.user, member: auth.member, projects: ws.projects }
}
