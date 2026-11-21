import { sb } from './supabase.js'
import { auth, ws, notif } from './store.svelte.js'

// Notifications are pointers only (type + target_id). The table has no
// text column, so no message text is ever written here — the list view
// resolves the sender / room from the target message row at read time.
// No push notifications are sent; the list in the app is the whole
// notification surface, and the UI says so.

// One pointer row. Used by chat.js (mention / reply) and by the
// deadline guardian's reminder pointers (assistant.js keeps its own
// de-duplicated insert; this helper is the shared shape).
export async function createNotification(userId, type, targetId) {
  if (!sb || !userId || !type) throw new Error('اعلان مشخص نیست.')
  const { error } = await sb.from('notifications').insert({
    user_id: userId,
    type,
    target_id: targetId || null,
    read: false
  })
  if (error) throw error
}

// Load my notifications, newest first, enriched with the target
// message (author + room) when the pointer is a chat event. A pointer
// whose message is gone (deleted / invisible) still lists — with no
// sender — rather than vanishing silently.
export async function loadNotifications() {
  if (!sb || !auth.member) {
    notif.notifications = []
    notif.unreadCount = 0
    return []
  }
  notif.loading = true
  notif.error = ''
  try {
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .eq('user_id', auth.member.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    const rows = data || []
    const enriched = []
    for (const n of rows) {
      let message = null
      if ((n.type === 'mention' || n.type === 'reply') && n.target_id) {
        const { data: m } = await sb
          .from('messages')
          .select('id, author_id, room_id')
          .eq('id', n.target_id)
          .single()
        if (m) message = m
      }
      enriched.push({ ...n, message })
    }
    notif.notifications = enriched
    notif.unreadCount = enriched.filter((n) => !n.read).length
    return enriched
  } catch (e) {
    notif.error = e.message || String(e)
    notif.notifications = []
    notif.unreadCount = 0
    throw e
  } finally {
    notif.loading = false
  }
}

// Count only — used on workspace load / login to refresh the sidebar
// badge without loading (and enriching) the whole list.
export async function refreshUnreadCount() {
  if (!sb || !auth.member) {
    notif.unreadCount = 0
    return 0
  }
  try {
    const { data, error } = await sb
      .from('notifications')
      .select('id')
      .eq('user_id', auth.member.id)
      .eq('read', false)
    if (error) throw error
    notif.unreadCount = (data || []).length
    return notif.unreadCount
  } catch {
    // The badge must never break the workspace load; the list view
    // shows the real error when the user opens it.
    return notif.unreadCount
  }
}

export function unreadCount() {
  return notif.unreadCount
}

export async function markRead(id) {
  if (!sb || !id) return
  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
  if (error) throw error
  notif.notifications = notif.notifications.map((n) =>
    n.id === id ? { ...n, read: true } : n
  )
  notif.unreadCount = notif.notifications.filter((n) => !n.read).length
}

export async function markAllRead() {
  if (!sb || !auth.member) return
  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('user_id', auth.member.id)
    .eq('read', false)
  if (error) throw error
  notif.notifications = notif.notifications.map((n) => ({ ...n, read: true }))
  notif.unreadCount = 0
}

export function roomNameFor(notification) {
  const roomId = notification?.message?.room_id
  if (!roomId) return ''
  const room = ws.rooms.find((r) => r.id === roomId)
  return room ? room.name : 'اتاق'
}

export function notificationTypeLabel(type) {
  if (type === 'mention') return 'منشن'
  if (type === 'reply') return 'پاسخ'
  if (type === 'reminder') return 'یادآوری'
  return type || 'اعلان'
}

// Where a notification row links to: the room for chat events, the
// planner for a reminder pointer (its target is a task id).
export function notificationLink(notification) {
  if (notification?.type === 'reminder') return '#/tasks'
  const roomId = notification?.message?.room_id
  return roomId ? '#/room/' + roomId : '#/notifications'
}
