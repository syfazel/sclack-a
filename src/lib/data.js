import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import { validateProjectForm } from './extract.js'
import { loadDocs, createAutoDoc, listFiles } from './docs.js'
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
