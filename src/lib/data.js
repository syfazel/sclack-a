import { sb } from './supabase.js'
import { auth, ws } from './store.svelte.js'

// Workspace data: projects, rooms, members. Reads only what RLS allows the
// signed-in member to see. No test data is ever written here.

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
  if (ws.currentProjectId) await loadRooms(ws.currentProjectId)
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
  if (!error) ws.rooms = data || []
  else ws.error = error.message
}

// Create a project (name + one tap) and its auto room «گفت‌وگو».
// The auto doc «سند» is NOT created here — docs arrive in D4.
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
  await loadWorkspace()
  ws.currentProjectId = data.id
  ws.currentRoomId = room.id
  return { project: data, room }
}

export function memberName(memberId) {
  const m = ws.members.find((x) => x.id === memberId)
  return m ? m.name : 'عضو'
}
