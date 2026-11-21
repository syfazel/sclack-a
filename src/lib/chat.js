import { sb } from './supabase.js'
import { auth, ws, chat } from './store.svelte.js'
import { parseMentions } from './mentions.js'
import { createNotification } from './notifications.js'

// Chat over Supabase + Realtime.
// Public Realtime access is OFF on the project, so the room channel MUST be
// created with private: true — otherwise the subscription is rejected
// (PrivateOnly). Presence + typing ride on the same private channel via
// Broadcast; they are never stored.
// NOTE: since D2 (~19:42) the messages policy is room-members — a signed-in
// user sees the messages of rooms they can see, not only their own.

let channel = null
let lastTypingAt = 0
const typingTimers = {}

export async function loadMessages(roomId) {
  if (!sb || !roomId) {
    chat.messages = []
    return
  }
  chat.loading = true
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200)
  chat.messages = error ? [] : data || []
  chat.loading = false
}

export function subscribeRoom(roomId) {
  unsubscribeRoom()
  if (!sb || !roomId) return
  channel = sb.channel(`room-${roomId}`, { config: { private: true } })
  channel
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new
        if (!row || chat.messages.some((m) => m.id === row.id)) return
        chat.messages = [...chat.messages, row]
      }
    )
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      chat.presence = Object.values(state)
        .flat()
        .map((p) => ({ memberId: p.member_id, name: p.name }))
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.member_id === auth.member?.id) return
      chat.typing = [
        ...chat.typing.filter((t) => t.memberId !== payload.member_id),
        { memberId: payload.member_id, name: payload.name }
      ]
      clearTimeout(typingTimers[payload.member_id])
      typingTimers[payload.member_id] = setTimeout(() => {
        chat.typing = chat.typing.filter((t) => t.memberId !== payload.member_id)
      }, 3000)
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && auth.member) {
        channel.track({
          member_id: auth.member.id,
          name: auth.member.name,
          online_at: new Date().toISOString()
        })
      }
    })
}

export function unsubscribeRoom() {
  if (channel) {
    sb.removeChannel(channel)
    channel = null
  }
  chat.presence = []
  chat.typing = []
}

// Throttled to one broadcast per 2 seconds per client.
export function sendTyping() {
  if (!channel || !auth.member) return
  const now = Date.now()
  if (now - lastTypingAt < 2000) return
  lastTypingAt = now
  channel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { member_id: auth.member.id, name: auth.member.name }
  })
}

// The send button is NEVER disabled (W0 fix A): every click explains itself
// through chat.sendState instead of staying silent.
// Visibility (P01 B2): a message in a DM room (type 'dm') is personal;
// a message in a project room is project-visible. No DM creation exists
// in the draft yet (G2), but the derivation is in place so a DM room's
// messages can never leak into a project.
//
// Thread + mention (0.7.0): options.parentId is the top-level parent
// message (a reply to a reply takes the same top parent — one level
// only). mentions[] is parsed from @name tokens against ws.members.
// The insert uses .select('id').single() so the new message id comes
// back and the mention / reply notification pointers can point at it.
// Notifications are pointers only (type + target_id, no message text).
// If a notification insert fails, the sent message stays and the
// failure is only reported in sendState — the message is never rolled back.
export async function sendMessage(roomId, body, roomType, options = {}) {
  const text = (body || '').trim()
  if (!sb) {
    chat.sendState = 'فرستادن ممکن نیست: کلید Supabase هنوز وصل نشده است.'
    return false
  }
  if (!auth.user) {
    chat.sendState = 'فرستادن ممکن نیست: هنوز وارد نشده‌اید؛ اول با ایمیل و رمز وارد شوید.'
    return false
  }
  if (!auth.member) {
    chat.sendState =
      'فرستادن ممکن نیست: ردیف عضو هنوز ساخته نشده است' +
      (auth.memberError ? ' — خطا: ' + auth.memberError : '؛ چند ثانیه صبر کنید.')
    return false
  }
  if (!roomId) {
    chat.sendState = 'فرستادن ممکن نیست: اتاقی انتخاب نشده است.'
    return false
  }
  if (!text) {
    chat.sendState = 'چیزی برای فرستادن نیست — اول پیام را بنویسید.'
    return false
  }
  const parentId = options.parentId || null
  const mentions = parseMentions(text, ws.members)
  chat.sendState = 'در حال فرستادن…'
  const { data, error } = await sb
    .from('messages')
    .insert({
      room_id: roomId,
      author_id: auth.member.id,
      body: text,
      parent_id: parentId,
      mentions,
      visibility: roomType === 'dm' ? 'personal' : 'project'
    })
    .select('id')
    .single()
  if (error || !data?.id) {
    chat.sendState = 'فرستادن ناموفق بود: ' + (error?.message || 'شناسهٔ پیام برنگشت.')
    return false
  }
  const messageId = data.id
  // Local echo: the Realtime INSERT handler dedupes by id, so showing
  // the message now cannot double it when the broadcast arrives.
  if (!chat.messages.some((m) => m.id === messageId)) {
    chat.messages = [
      ...chat.messages,
      {
        id: messageId,
        room_id: roomId,
        author_id: auth.member.id,
        body: text,
        parent_id: parentId,
        mentions,
        visibility: roomType === 'dm' ? 'personal' : 'project',
        created_at: new Date().toISOString()
      }
    ]
  }
  // Notification pointers (best effort — never roll back the message).
  try {
    const recipients = new Set()
    for (const id of mentions) {
      if (id !== auth.member.id) recipients.add(id)
    }
    for (const id of recipients) {
      await createNotification(id, 'mention', messageId)
    }
    if (parentId) {
      let parentAuthor = chat.messages.find((m) => m.id === parentId)?.author_id || null
      if (!parentAuthor) {
        try {
          const { data: parent } = await sb
            .from('messages')
            .select('author_id')
            .eq('id', parentId)
            .single()
          parentAuthor = parent?.author_id || null
        } catch {
          parentAuthor = null
        }
      }
      if (parentAuthor && parentAuthor !== auth.member.id && !recipients.has(parentAuthor)) {
        await createNotification(parentAuthor, 'reply', messageId)
      }
    }
    chat.sendState = ''
  } catch (e) {
    chat.sendState = 'پیام فرستاده شد، ولی ساخت اعلان ناموفق بود: ' + (e.message || String(e))
  }
  return true
}
