import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'
import { loadDocs, createAutoDoc, listFiles } from './docs.js'
import { loadTasks, loadTemplates, loadReminders } from './work.js'

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
  const [p, m] = await Promise.all([
    sb.from('projects').select('*').eq('archived', false).order('created_at'),
    sb.from('members').select('*').order('joined_at')
  ])
  if (p.error) ws.error = p.error.message
  else ws.projects = p.data || []
  if (!m.error) ws.members = m.data || []
  if (m.error && !ws.error) ws.error = m.error.message
  if (!ws.currentProjectId && ws.projects.length > 0) {
    ws.currentProjectId = ws.projects[0].id
  }
  ws.loading = false
  if (ws.currentProjectId) {
    await loadProjectData(ws.currentProjectId)
  }
  await loadTemplates()
  await loadReminders()
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

// Create a project (name + one tap) with its auto room «گفت‌وگو» and its
// auto doc «سند» (D4). The current project is switched FIRST, then the
// lists are loaded — loading them before the switch loaded the OLD
// project's lists (D6 bug 5).
export async function createProject(name) {
  const clean = (name || '').trim()
  if (!clean) throw new Error('نام پروژه را بنویسید.')
  if (!auth.member) throw new Error('ردیف عضو هنوز ساخته نشده است.')
  const { data, error } = await sb
    .from('projects')
    .insert({ name: clean, created_by: auth.member.id, visibility: 'team' })
    .select()
    .single()
  if (error) throw error
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

export function memberName(memberId) {
  const m = ws.members.find((x) => x.id === memberId)
  return m ? m.name : 'عضو'
}
