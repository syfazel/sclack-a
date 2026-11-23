import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import * as Y from 'yjs'
import { encodeDocState, applyDocState } from './yjs-sync.js'
import { createAutoDoc, createDoc, saveDocRow, isMissingColumnError } from './docs.js'
import { createProject } from './data.js'
import { BUILTIN_TEMPLATES } from './templates.js'
import {
  buildSearchSnippet,
  escapeSearchPattern,
  nextTaskStatus,
  nextVersionNo,
  validateTaskParent
} from './extract.js'

// Work & memory (D5): tasks, templates, reminders, global search, versions.
// Reads/writes only what RLS allows the signed-in member to see.
// Reminders are an in-app list only — never push notifications.

// ---------- tasks ----------

export async function loadTasks(projectId) {
  if (!sb || !projectId) {
    ws.tasks = []
    return
  }
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  // Stale response (project switched while loading): discard (D6 bug 5).
  if (ws.currentProjectId !== projectId) return
  if (!error) ws.tasks = data || []
  else ws.error = error.message
}

export async function createTask({ projectId, title, description, assigneeId, dueAt, linkType, linkId, source }) {
  const clean = (title || '').trim()
  if (!clean) throw new Error('عنوان کار را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('tasks')
    .insert({
      project_id: projectId,
      title: clean,
      description: (description || '').trim() || null,
      assignee_id: assigneeId || null,
      status: 'todo',
      due_at: dueAt || null,
      created_by: auth.member.id,
      visibility: 'project',
      custom_fields: {
        link_type: linkType || null,
        link_id: linkId || null,
        // P01 D2: provenance of a task created from an assistant
        // suggestion — the verbatim source quote + the id of the message
        // or doc it came from. Only set when the task comes from a
        // suggestion; ordinary tasks carry nulls.
        ...(source
          ? {
              source_message_id: source.source_message_id || null,
              source_doc_id: source.source_doc_id || null,
              source_quote: source.source_quote || null
            }
          : {})
      }
    })
    .select()
    .single()
  if (error) throw error
  await loadTasks(projectId)
  return data
}

// Phase 1 (فاز ۱ پلن کمبودها): edit an existing task in place —
// title, description, assignee, due date and link. status and
// completed_at are never touched here (the cycle/checkbox own them).
// custom_fields is merged so P01 D2 provenance (source_*) survives an
// edit. Same empty-title validation as createTask.
export async function updateTask(task, { title, description, assigneeId, dueAt, linkType, linkId }) {
  if (!task?.id) throw new Error('ردیف کار مشخص نیست.')
  const clean = (title || '').trim()
  if (!clean) throw new Error('عنوان کار را بنویسید.')
  const { data, error } = await sb
    .from('tasks')
    .update({
      title: clean,
      description: (description || '').trim() || null,
      assignee_id: assigneeId || null,
      due_at: dueAt || null,
      custom_fields: {
        ...(task.custom_fields || {}),
        link_type: linkType || null,
        link_id: linkId || null
      }
    })
    .eq('id', task.id)
    .select()
    .single()
  if (error) throw error
  await loadTasks(task.project_id)
  return data
}

// Cycle todo -> doing -> done -> todo. Done sets completed_at; leaving done
// clears it (same rule as the Space app).
export async function cycleTaskStatus(task) {
  const next = nextTaskStatus(task.status, new Date().toISOString())
  const { data, error } = await sb
    .from('tasks')
    .update({ status: next.status, completed_at: next.completed_at })
    .eq('id', task.id)
    .select()
    .single()
  if (error) throw error
  await loadTasks(task.project_id)
  return data
}

// Checkbox toggle for the home "my tasks" card (G3-2 item 3): unlike
// cycleTaskStatus (todo -> doing -> done), a checkbox is binary —
// done sets completed_at, unchecking returns the task to todo and
// clears it (same rule as the Space app).
export async function setTaskDone(task, done) {
  const { data, error } = await sb
    .from('tasks')
    .update({
      status: done ? 'done' : 'todo',
      completed_at: done ? new Date().toISOString() : null
    })
    .eq('id', task.id)
    .select()
    .single()
  if (error) throw error
  await loadTasks(task.project_id)
  return data
}

// ---------- Phase 8: subtasks + checklists ----------
// Move a task under a new parent (null = back to the root). The cycle
// guard runs first, against ws.tasks. When the live table has no
// parent_id column yet (the migration runs by hand in the SQL Editor),
// the write answers 42703 — that turns into a clear Persian message
// instead of breaking anything else. createTask never writes parent_id
// (same pattern as createDoc): a subtask is created, then re-parented
// here, so task creation never breaks on a missing column.
export async function setTaskParent(task, newParentId) {
  if (!task?.id) throw new Error('ردیف کار مشخص نیست.')
  const parent = newParentId || null
  const bad = validateTaskParent(ws.tasks, task.id, parent)
  if (bad) throw new Error(bad)
  if (parent) {
    const parentRow = (ws.tasks || []).find((t) => t.id === parent)
    if (parentRow && parentRow.project_id !== task.project_id) {
      throw new Error('کار والد باید از همان پروژه باشد.')
    }
  }
  const { error } = await sb
    .from('tasks')
    .update({ parent_id: parent })
    .eq('id', task.id)
  if (error) {
    if (isMissingColumnError(error)) {
      throw new Error(
        'ستون زیروظیفه هنوز روی دادهٔ زنده ساخته نشده است؛ اول مهاجرت را در SQL Editor اجرا کنید.'
      )
    }
    throw error
  }
  await loadTasks(task.project_id)
  return { ...task, parent_id: parent }
}

// Replace a task's checklist (custom_fields.checklist: [{text, done}]).
// The rest of custom_fields (link, P01 provenance) is merged, not lost.
export async function updateChecklist(task, checklist) {
  if (!task?.id) throw new Error('ردیف کار مشخص نیست.')
  const clean = (checklist || [])
    .filter((item) => item && typeof item.text === 'string' && item.text.trim() !== '')
    .map((item) => ({ text: item.text.trim(), done: item.done === true }))
  const { data, error } = await sb
    .from('tasks')
    .update({
      custom_fields: {
        ...(task.custom_fields || {}),
        checklist: clean
      }
    })
    .eq('id', task.id)
    .select()
    .single()
  if (error) throw error
  await loadTasks(task.project_id)
  return data
}

export async function deleteTask(task) {
  if (!task?.id) throw new Error('ردیف کار مشخص نیست.')
  // PostgREST DELETE without .select() answers success even when RLS
  // blocks the delete (0 rows affected) — that silent no-op was the live
  // G1 bug (the in-site delete button did nothing, confirmed live twice).
  // Select the deleted row back and treat "0 rows" as a failure.
  const { data, error } = await sb
    .from('tasks')
    .delete()
    .eq('id', task.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('کار حذف نشد — یا وجود ندارد یا فقط سازندهٔ آن می‌تواند حذفش کند.')
  }
  await loadTasks(task.project_id)
}

// ---------- templates ----------

export async function loadTemplates() {
  if (!sb) {
    ws.templates = []
    return
  }
  const { data, error } = await sb.from('templates').select('*').order('created_at')
  if (!error) ws.templates = data || []
  else ws.error = error.message
}

// Insert the 7 built-in templates when the table has none of them yet.
// Team-wide read; any member may seed. Idempotent by name.
export async function seedTemplates() {
  if (!sb || !auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  await loadTemplates()
  const have = new Set((ws.templates || []).map((t) => t.name))
  const missing = BUILTIN_TEMPLATES.filter((t) => !have.has(t.name))
  for (const t of missing) {
    const { error } = await sb.from('templates').insert({
      name: t.name,
      type: t.type,
      structure: t.structure,
      created_by: auth.member.id
    })
    if (error) throw error
  }
  await loadTemplates()
}

// Create a doc prefilled with Yjs text (the template skeleton). Always
// returns the real doc row — never a placeholder id (Space bug P2).
export async function createDocWithText(projectId, title, text) {
  const doc = await createDoc(projectId, title)
  if (text) {
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, text)
    const b64 = encodeDocState(ydoc)
    const { error } = await sb
      .from('docs')
      .update({ custom_fields: { yjs_state_b64: b64 }, updated_at: new Date().toISOString() })
      .eq('id', doc.id)
    if (error) throw error
  }
  return doc
}

// One-tap create from a template. Doc templates make a doc in the current
// project; the project template makes a project (with its auto room + auto
// doc) and fills the auto doc with the meeting skeleton; task templates
// make a task in the current project (with a checklist and/or a due date
// when the template carries them). A project template also goes through
// the P01 form rule: goal and deadline are required (createProject
// validates them).
export async function createFromTemplate(template, { projectId, projectName, projectGoal, projectDeadline }) {
  if (!template) throw new Error('قالب مشخص نیست.')
  const kind = template.structure?.kind || template.type
  if (kind === 'task') {
    if (!projectId) throw new Error('اول یک پروژه انتخاب کنید.')
    const dueInDays = template.structure?.dueInDays
    const dueAt =
      typeof dueInDays === 'number'
        ? new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString()
        : null
    const task = await createTask({
      projectId,
      title: template.structure?.title || template.name,
      description: template.structure?.description || '',
      dueAt
    })
    const checklist = template.structure?.checklist
    if (Array.isArray(checklist) && checklist.length > 0) {
      await updateChecklist(
        task,
        checklist.map((text) => ({ text, done: false }))
      )
    }
    return { task }
  }
  if (kind === 'project') {
    const { project, room, doc } = await createProject({
      name: projectName,
      goal: projectGoal,
      deadline: projectDeadline
    })
    const skeleton = template.structure?.skeleton || ''
    if (skeleton && doc) {
      const ydoc = new Y.Doc()
      ydoc.getText('content').insert(0, skeleton)
      const b64 = encodeDocState(ydoc)
      await sb
        .from('docs')
        .update({ custom_fields: { yjs_state_b64: b64 }, updated_at: new Date().toISOString() })
        .eq('id', doc.id)
    }
    return { project, room, doc }
  }
  if (!projectId) throw new Error('اول یک پروژه انتخاب کنید.')
  const title = template.name === 'سند خالی' ? 'سند تازه' : template.name
  const doc = await createDocWithText(projectId, title, template.structure?.skeleton || '')
  return { doc }
}

// ---------- reminders (in-app list only) ----------

export async function loadReminders() {
  if (!sb || !auth.member) {
    ws.reminders = []
    return
  }
  const { data, error } = await sb
    .from('reminders')
    .select('*')
    .eq('user_id', auth.member.id)
    .order('remind_at', { ascending: true })
  if (!error) ws.reminders = data || []
  else ws.error = error.message
}

export function isOverdue(reminder, now = new Date()) {
  return (
    !reminder.done &&
    !!reminder.remind_at &&
    new Date(reminder.remind_at).getTime() < now.getTime()
  )
}

export async function createReminder({ text, targetType, targetId, remindAt }) {
  const clean = (text || '').trim()
  if (!clean) throw new Error('متن یادآوری را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('reminders')
    .insert({
      user_id: auth.member.id,
      target_type: targetType || null,
      target_id: targetId || null,
      text: clean,
      remind_at: remindAt || null,
      done: false
    })
    .select()
    .single()
  if (error) throw error
  await loadReminders()
  return data
}

export async function setReminderDone(reminder, done) {
  const { error } = await sb
    .from('reminders')
    .update({ done })
    .eq('id', reminder.id)
  if (error) throw error
  await loadReminders()
}

export async function deleteReminder(reminder) {
  const { error } = await sb.from('reminders').delete().eq('id', reminder.id)
  if (error) throw error
  await loadReminders()
}

// ---------- global search ----------
// Messages by body, docs by title, files by name, tasks by title/description.
// Doc content lives in Yjs state, not in a text column, so search covers
// doc TITLES only — stated honestly in the UI. % and _ are escaped.
// The files table has NO created_at column (it has uploaded_at) — using
// created_at in the files query broke the whole search (D6 bug 2).
// One failing source must not break the whole search: sources run with
// allSettled, hits from the working sources are returned, and the failed
// sources are attached as `hits.partialErrors` for the UI to show.

export async function searchWorkspace(query) {
  const q = (query || '').trim()
  if (!q) return []
  const pattern = '%' + escapeSearchPattern(q) + '%'
  const sources = [
    {
      name: 'پیام‌ها',
      run: () =>
        sb
          .from('messages')
          .select('id, body, created_at, room_id, rooms(name)')
          .ilike('body', pattern)
          .order('created_at', { ascending: false })
          .limit(20)
    },
    {
      name: 'سندها',
      // فاز ۳: عنوان یا متن سند (docs.search_text) را می‌گردد. تا وقتی
      // ستون search_text در دیتابیس زنده نیست (مهاجرت اجرا نشده)،
      // کوئری title-or-search_text با خطای ستون ناموجود رد می‌شود —
      // آن‌وقت بی‌صدا به کوئری فقط‌عنوان برمی‌گردیم (بدون partialError)،
      // پس جست‌وجو دقیقاً مثل قبل کار می‌کند.
      run: async () => {
        const withText = await sb
          .from('docs')
          .select('id, title, search_text, created_at, project_id, projects(name)')
          .or('title.ilike.' + pattern + ',search_text.ilike.' + pattern)
          .order('created_at', { ascending: false })
          .limit(20)
        if (withText.error && isMissingColumnError(withText.error)) {
          return sb
            .from('docs')
            .select('id, title, created_at, project_id, projects(name)')
            .ilike('title', pattern)
            .order('created_at', { ascending: false })
            .limit(20)
        }
        return withText
      }
    },
    {
      name: 'فایل‌ها',
      run: () =>
        sb
          .from('files')
          .select('id, name, uploaded_at, project_id, projects(name)')
          .ilike('name', pattern)
          .order('uploaded_at', { ascending: false })
          .limit(20)
    },
    {
      name: 'کارها',
      run: () =>
        sb
          .from('tasks')
          .select('id, title, description, created_at, project_id, projects(name)')
          .or('title.ilike.' + pattern + ',description.ilike.' + pattern)
          .order('created_at', { ascending: false })
          .limit(20)
    }
  ]
  const settled = await Promise.allSettled(sources.map((s) => s.run()))
  const hits = []
  const partialErrors = []
  const byName = {}
  settled.forEach((r, i) => {
    const src = sources[i]
    if (r.status === 'fulfilled' && !r.value.error) {
      byName[src.name] = r.value.data || []
    } else {
      const msg =
        r.status === 'rejected'
          ? r.reason?.message || String(r.reason)
          : r.value.error?.message || String(r.value.error)
      partialErrors.push({ source: src.name, message: msg })
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
    // نشان هم‌خوانی (فاز ۳، مشخصات گرافیکی): عنوان، متن، یا هر دو.
    // snippet خالی یعنی متن هم‌خوان نیست؛ در برگشت به title-only
    // (ستون نیست) همیشه فقط عنوان است.
    const titleMatch = (d.title || '').toLowerCase().includes(q.toLowerCase())
    const snippet = d.search_text ? buildSearchSnippet(d.search_text, q) : ''
    const textMatch = snippet !== ''
    hits.push({
      kind: 'doc',
      kindLabel: 'سند',
      id: d.id,
      title: d.title,
      place: d.projects?.name || 'پروژه',
      link: '#/doc/' + d.id,
      at: d.created_at,
      matchIn: titleMatch && textMatch ? 'both' : textMatch ? 'text' : 'title',
      snippet
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
  if (partialErrors.length > 0) {
    // No hits at all: surface the failure loudly (old behaviour).
    // Partial hits: return them, with the failed sources attached.
    if (hits.length === 0) throw new Error(partialErrors[0].message)
    hits.partialErrors = partialErrors
  }
  return hits
}

// ---------- versions (immutable restore points) ----------
// A version stores a full Yjs state snapshot as base64 in snapshot_ref.
// Restore applies the snapshot to the live doc, saves the row, then
// creates a NEW version — no version row is ever updated or deleted
// (there is no update/delete policy on versions, by design in w1).

export function textFromStateB64(b64) {
  if (!b64) return ''
  const doc = new Y.Doc()
  if (!applyDocState(doc, b64, 'version')) return ''
  return doc.getText('content').toString()
}

export async function listVersions(docId) {
  if (!sb || !docId) return []
  const { data, error } = await sb
    .from('versions')
    .select('*')
    .eq('doc_id', docId)
    .order('version_no', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveVersion(docRow, ydoc, note) {
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const existing = await listVersions(docRow.id)
  const no = nextVersionNo(existing.map((v) => v.version_no))
  const snapshot = encodeDocState(ydoc)
  const { data, error } = await sb
    .from('versions')
    .insert({
      doc_id: docRow.id,
      version_no: no,
      snapshot_ref: snapshot,
      author_id: auth.member.id,
      note: (note || '').trim() || null
    })
    .select()
    .single()
  if (error) throw error
  await sb
    .from('docs')
    .update({ version: no, updated_at: new Date().toISOString() })
    .eq('id', docRow.id)
  return data
}

// Restore = REPLACE the live text with the snapshot's text, save the row
// (via the caller's saveNow, which owns lastSavedB64), then record a NEW
// version of the restored state. Returns the new version row.
// NOTE (P01 B3): merely applying the snapshot (applyDocState) only
// MERGES — Yjs updates are monotonic, so an old snapshot can never remove
// newer text and the doc would keep the newer content. A restore must
// delete the current text and insert the snapshot's text; that is a
// normal Yjs update (origin 'version'), so live peers receive it too,
// the textarea updates via the remote-apply path, and the debounced save
// is NOT scheduled by it (saveNow below owns the write).
export async function restoreVersion(docRow, ydoc, versionRow, saveNow) {
  const snapDoc = new Y.Doc()
  if (!applyDocState(snapDoc, versionRow.snapshot_ref, 'version')) {
    throw new Error('اسنپ‌شات این نسخه خوانده نشد.')
  }
  const snapshotText = snapDoc.getText('content').toString()
  const ytext = ydoc.getText('content')
  ydoc.transact(() => {
    ytext.delete(0, ytext.length)
    if (snapshotText) ytext.insert(0, snapshotText)
  }, 'version')
  if (saveNow) await saveNow()
  const fresh = await saveVersion(docRow, ydoc, 'برگردانده‌شده از نسخهٔ ' + versionRow.version_no)
  return fresh
}
