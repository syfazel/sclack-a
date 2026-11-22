import { sb } from './supabase.js'
import { auth, ws, pulse } from './store.svelte.js'
import { validateProjectForm } from './extract.js'
import { loadDocs, createAutoDoc, listFiles, FILES_BUCKET } from './docs.js'
import { loadTasks, loadTemplates, loadReminders } from './work.js'
import { refreshUnreadCount } from './notifications.js'

// Workspace data: projects, rooms, members, docs, files. Reads only what
// RLS allows the signed-in member to see. No test data is ever written here.

// Load all four project-scoped lists for one project, in parallel.
// Each list loader below discards its result when the current project has
// moved on meanwhile (D6 bug 5: overlapping loads resolved out of order
// and left the sidebar showing another project's — or empty — lists
// until the project was explicitly re-selected).
export async function loadProjectData(projectId) {
  if (!sb || !projectId) return
  await Promise.all([
    loadRooms(projectId),
    loadDocs(projectId),
    loadTasks(projectId),
    listFiles(projectId)
  ])
}

export async function loadWorkspace() {
  if (!sb || !auth.member) return
  ws.loading = true
  ws.error = ''
  const [p, m, pa] = await Promise.all([
    sb.from('projects').select('*').eq('archived', false).order('created_at'),
    sb.from('members').select('*').order('joined_at'),
    sb.from('projects').select('*').eq('archived', true).order('created_at')
  ])
  if (p.error) ws.error = p.error.message
  else ws.projects = p.data || []
  if (!m.error) ws.members = m.data || []
  if (m.error && !ws.error) ws.error = m.error.message
  if (pa.error) ws.archivedProjects = []
  else ws.archivedProjects = pa.data || []
  if (!ws.currentProjectId && ws.projects.length > 0) {
    ws.currentProjectId = ws.projects[0].id
  }
  ws.loading = false
  if (ws.currentProjectId) {
    await loadProjectData(ws.currentProjectId)
  }
  await loadTemplates()
  await loadReminders()
  // Sidebar unread badge: refresh on every workspace load / login.
  // refreshUnreadCount never throws (it swallows its own errors), so a
  // notification read failure cannot break the workspace load.
  await refreshUnreadCount()
}

export async function loadRooms(projectId) {
  if (!sb || !projectId) {
    ws.rooms = []
    return
  }
  const { data, error } = await sb
    .from('rooms')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  // Stale response (project switched while loading): discard, do not
  // overwrite the current project's lists.
  if (ws.currentProjectId !== projectId) return
  if (!error) ws.rooms = data || []
  else ws.error = error.message
}

// Create a project with the full P01 form (A1): name (required,
// unique), description, goal (required), final_output, deadline
// (required), members. goal / final_output / deadline / stage /
// member_ids live ONLY in projects.custom_fields — no new column.
// stage starts at 'created'. A project without goal or without deadline
// is rejected with a clear message, before any network call.
// Creating a project still auto-creates room «گفت‌وگو» + doc «سند» (D4).
// The current project is switched FIRST, then the lists are loaded —
// loading them before the switch loaded the OLD project's lists
// (D6 bug 5).
export async function createProject({ name, description, goal, finalOutput, deadline, memberIds }) {
  const bad = validateProjectForm({ name, goal, deadline })
  if (bad) throw new Error(bad)
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const clean = (name || '').trim()
  const cf = {
    goal: (goal || '').trim(),
    final_output: (finalOutput || '').trim() || null,
    deadline: (deadline || '').trim(),
    stage: 'created',
    member_ids: (memberIds || []).filter(Boolean)
  }
  const { data, error } = await sb
    .from('projects')
    .insert({
      name: clean,
      description: (description || '').trim() || null,
      created_by: auth.member.id,
      visibility: 'team',
      custom_fields: cf
    })
    .select()
    .single()
  if (error) {
    // Unique name (projects.name is unique in the schema).
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
      throw new Error('پروژه‌ای با این نام هست؛ نام دیگری انتخاب کنید.')
    }
    throw error
  }
  const { data: room, error: rerr } = await sb
    .from('rooms')
    .insert({
      project_id: data.id,
      name: 'گفت‌وگو',
      type: 'project',
      created_by: auth.member.id,
      visibility: 'project'
    })
    .select()
    .single()
  if (rerr) throw rerr
  const doc = await createAutoDoc(data.id)
  ws.currentProjectId = data.id
  ws.currentRoomId = room.id
  await loadWorkspace()
  return { project: data, room, doc }
}

// Close a project (P01 A5): archive, not delete. Sets archived = true,
// custom_fields.stage = 'closed' and custom_fields.closed_at (close
// date), preserving the other custom_fields (goal, deadline, ...).
// The project's docs, files and tasks stay readable and are NOT deleted.
// Real deletion stays the existing two-step deleteProject — P01 adds
// no new deletion (note: no deleteProject exists in the draft yet; the
// in-site delete controls are G1 item 8 in the re-plan).
export async function closeProject(project) {
  if (!project?.id) throw new Error('پروژه مشخص نیست.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const cf = {
    ...(project.custom_fields || {}),
    stage: 'closed',
    closed_at: new Date().toISOString()
  }
  const { data, error } = await sb
    .from('projects')
    .update({ archived: true, custom_fields: cf })
    .eq('id', project.id)
    .select()
    .single()
  if (error) throw error
  await loadWorkspace()
  return data
}

export function memberName(memberId) {
  const m = ws.members.find((x) => x.id === memberId)
  return m ? m.name : 'عضو'
}

// ---------- delete a project (G1 item 8) ----------
// Creator only (w1 projects delete own), two-tap confirm in the UI
// (HomeView). The schema has NO ON DELETE CASCADE anywhere, so every
// child is deleted explicitly, FK-safe: notifications/reminders (own
// pointers) → messages (replies, then parents) → rooms → comments
// (replies, then parents) → docs → files (storage objects first, then
// rows) → tasks → the project row.
// A pre-check refuses the delete — deleting NOTHING — when a child
// cannot be removed under RLS:
//  * any version row under the project's docs: versions have NO delete
//    policy at all (immutable by design, w1) and versions.doc_id has no
//    cascade, so no member can ever remove them;
//  * any child row owned by another member (room/message/doc/comment/
//    file/task): RLS delete is owner-only.
// Other members' notification/reminder pointers at the project's rows
// cannot be deleted either (recipient-only) but carry no FK, so they
// stay as orphans and do NOT block the delete; the notifications list
// already renders a missing target without a sender.

async function loadProjectChildren(projectId) {
  const me = auth.member.id
  const { data: rooms, error: rerr } = await sb
    .from('rooms')
    .select('id, created_by')
    .eq('project_id', projectId)
  if (rerr) throw rerr
  const roomIds = (rooms || []).map((r) => r.id)
  const { data: messages, error: merr } =
    roomIds.length > 0
      ? await sb.from('messages').select('id, author_id, parent_id').in('room_id', roomIds)
      : { data: [] }
  if (merr) throw merr
  const { data: docs, error: derr } = await sb
    .from('docs')
    .select('id, created_by')
    .eq('project_id', projectId)
  if (derr) throw derr
  const docIds = (docs || []).map((d) => d.id)
  const { data: comments, error: cerr } =
    docIds.length > 0
      ? await sb.from('comments').select('id, author_id, parent_id').in('doc_id', docIds)
      : { data: [] }
  if (cerr) throw cerr
  const { data: versions, error: verr } =
    docIds.length > 0
      ? await sb.from('versions').select('id').in('doc_id', docIds)
      : { data: [] }
  if (verr) throw verr
  const { data: files, error: ferr } = await sb
    .from('files')
    .select('id, uploaded_by, storage_path')
    .eq('project_id', projectId)
  if (ferr) throw ferr
  const { data: tasks, error: terr } = await sb
    .from('tasks')
    .select('id, created_by')
    .eq('project_id', projectId)
  if (terr) throw terr
  const allIds = [
    projectId,
    ...roomIds,
    ...(messages || []).map((m) => m.id),
    ...docIds,
    ...(files || []).map((f) => f.id),
    ...(tasks || []).map((t) => t.id)
  ]
  const { data: myNotifications, error: nerr } =
    allIds.length > 0
      ? await sb.from('notifications').select('id').eq('user_id', me).in('target_id', allIds)
      : { data: [] }
  if (nerr) throw nerr
  const { data: myReminders, error: remerr } =
    allIds.length > 0
      ? await sb.from('reminders').select('id').eq('user_id', me).in('target_id', allIds)
      : { data: [] }
  if (remerr) throw remerr
  return {
    rooms: rooms || [],
    messages: messages || [],
    docs: docs || [],
    comments: comments || [],
    versions: versions || [],
    files: files || [],
    tasks: tasks || [],
    myNotifications: myNotifications || [],
    myReminders: myReminders || []
  }
}

// Rows that make the project undeletable, as Persian fragments for the
// refusal message (empty = the delete may proceed).
function projectDeleteBlockers(children, me) {
  const out = []
  const byOwner = (rows, ownerCol, label) => {
    const foreign = rows.filter((r) => r[ownerCol] !== me)
    if (foreign.length === 0) return
    const byName = {}
    for (const r of foreign) {
      const name = memberName(r[ownerCol])
      byName[name] = (byName[name] || 0) + 1
    }
    for (const [name, n] of Object.entries(byName)) out.push(n + ' ' + label + ' از ' + name)
  }
  if (children.versions.length > 0) {
    out.push(
      children.versions.length +
        ' نسخهٔ ذخیره‌شده دارد (نسخه‌ها تغییرناپذیرند و هیچ‌کس نمی‌تواند آن‌ها را حذف کند)'
    )
  }
  byOwner(children.rooms, 'created_by', 'اتاق')
  byOwner(children.messages, 'author_id', 'پیام')
  byOwner(children.docs, 'created_by', 'سند')
  byOwner(children.comments, 'author_id', 'نظر')
  byOwner(children.files, 'uploaded_by', 'فایل')
  byOwner(children.tasks, 'created_by', 'کار')
  return out
}

// Delete a set of rows by id and prove all of them are really gone
// (same 0-row trap as deleteTask/deleteFile: without .select() a
// blocked delete answers success).
async function deleteRowsByIds(table, ids) {
  if (!ids || ids.length === 0) return []
  const { data, error } = await sb.from(table).delete().in('id', ids).select('id')
  if (error) throw error
  if (!data || data.length !== ids.length) {
    throw new Error(
      'حذف پروژه ناتمام ماند — ' +
        (ids.length - (data || []).length) +
        ' ردیف از ' +
        table +
        ' باقی ماند؛ دوباره امتحان کنید.'
    )
  }
  return data
}

export async function deleteProject(project) {
  if (!project?.id) throw new Error('پروژه مشخص نیست.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  if (project.created_by !== auth.member.id) {
    throw new Error('پروژه حذف نشد — فقط سازندهٔ پروژه می‌تواند آن را حذف کند.')
  }
  const me = auth.member.id
  const children = await loadProjectChildren(project.id)
  const blockers = projectDeleteBlockers(children, me)
  if (blockers.length > 0) {
    throw new Error('پروژه حذف نشد — ' + blockers.join('؛ ') + '.')
  }
  // Storage objects first: if the bucket removal fails, nothing has
  // been deleted yet and the error aborts cleanly.
  const paths = children.files.map((f) => f.storage_path).filter(Boolean)
  if (paths.length > 0) {
    const { error } = await sb.storage.from(FILES_BUCKET).remove(paths)
    if (error) {
      throw new Error('حذف فایل‌ها از انباره ناموفق بود: ' + (error.message || String(error)))
    }
  }
  await deleteRowsByIds(
    'notifications',
    children.myNotifications.map((n) => n.id)
  )
  await deleteRowsByIds(
    'reminders',
    children.myReminders.map((r) => r.id)
  )
  // Messages: replies before parents (parent_id has no cascade).
  await deleteRowsByIds(
    'messages',
    children.messages.filter((m) => m.parent_id).map((m) => m.id)
  )
  await deleteRowsByIds(
    'messages',
    children.messages.filter((m) => !m.parent_id).map((m) => m.id)
  )
  await deleteRowsByIds(
    'rooms',
    children.rooms.map((r) => r.id)
  )
  // Comments: replies before parents (same self-FK shape).
  await deleteRowsByIds(
    'comments',
    children.comments.filter((c) => c.parent_id).map((c) => c.id)
  )
  await deleteRowsByIds(
    'comments',
    children.comments.filter((c) => !c.parent_id).map((c) => c.id)
  )
  await deleteRowsByIds(
    'docs',
    children.docs.map((d) => d.id)
  )
  await deleteRowsByIds(
    'files',
    children.files.map((f) => f.id)
  )
  await deleteRowsByIds(
    'tasks',
    children.tasks.map((t) => t.id)
  )
  const { data, error } = await sb
    .from('projects')
    .delete()
    .eq('id', project.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('پروژه حذف نشد — یا وجود ندارد یا فقط سازندهٔ آن می‌تواند حذفش کند.')
  }
  if (ws.currentProjectId === project.id) {
    ws.currentProjectId = null
    ws.currentRoomId = null
  }
  await loadWorkspace()
}

// ---------- G3-3: team pulse ----------

// Load the workspace-wide rows the pulse numbers are derived from —
// messages, tasks, docs, files, versions, rooms. These are plain
// workspace-wide SELECTs: they return only rows RLS lets this member
// see (per-member policies on messages/reminders/comments, team
// visibility on projects/rooms/docs/tasks/files — w1/d2), and the
// numbers come from these rows alone (computeTeamPulse). One failed
// query fails the whole load into a visible error state with retry —
// no silent partial numbers. Never throws uncaught.
// NOTE: every query carries an explicit .limit() — the sandbox stub
// distinguishes these workspace-wide pulse queries from the
// project-scoped loaders by that limit (see probe-g3.mjs).
export async function loadTeamPulseData() {
  if (!sb) {
    pulse.error = 'کلید وصل نشده.'
    return
  }
  pulse.loading = true
  pulse.error = ''
  try {
    const [messages, tasks, docs, files, versions, rooms] = await Promise.all([
      sb
        .from('messages')
        // body is selected too: G6 #13/#15/#23 render the message body
        // as the row title (the pulse counts never needed it).
        .select('id, created_at, room_id, author_id, body')
        .order('created_at', { ascending: false })
        .limit(500),
      sb
        .from('tasks')
        .select('id, project_id, title, status, assignee_id, created_by, due_at, completed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      sb
        .from('docs')
        .select('id, project_id, title, created_by, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200),
      sb
        .from('files')
        .select('id, project_id, name, size, uploaded_by, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(200),
      sb
        .from('versions')
        .select('id, doc_id, version_no, author_id, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      sb
        .from('rooms')
        .select('id, project_id, name')
        .order('created_at')
        .limit(200)
    ])
    for (const r of [messages, tasks, docs, files, versions, rooms]) {
      if (r.error) throw r.error
    }
    pulse.messages = messages.data || []
    pulse.tasks = tasks.data || []
    pulse.docs = docs.data || []
    pulse.files = files.data || []
    pulse.versions = versions.data || []
    pulse.rooms = rooms.data || []
    pulse.loaded = true
  } catch (e) {
    pulse.error = 'نبض تیم بارگذاری نشد: ' + (e?.message || String(e))
  } finally {
    pulse.loading = false
  }
}
