// Shared reactive state (Svelte 5 runes in a .svelte.js module).

export const auth = $state({
  user: null, // Supabase Auth user
  member: null, // members row (auth_id = user.id)
  memberError: null,
  sessionReady: false, // session restore finished
  authMsg: '',
  authMsgKind: '' // '', 'error', 'rate-limited', 'ok'
})

export const ws = $state({
  projects: [],
  archivedProjects: [], // P01 A5: closed projects (archived = true)
  rooms: [],
  members: [],
  docs: [],
  files: [],
  tasks: [],
  templates: [],
  reminders: [],
  currentProjectId: null,
  currentRoomId: null,
  loading: false,
  error: ''
})

export const chat = $state({
  messages: [],
  loading: false,
  sendState: '',
  presence: [], // [{ memberId, name }]
  typing: [] // [{ memberId, name }]
})

// اعلان‌ها — فقط اشاره‌گر (type + target_id)، بدون متن پیام؛ اعلان پوش نیست.
export const notif = $state({
  notifications: [], // enriched rows: { ..., message: { author_id, room_id } | null }
  unreadCount: 0,
  loading: false,
  error: ''
})

// ترجیح‌های نمایشی (بخش ۵ P01): «حالت ساده» شیشه را مات می‌کند و
// صحنهٔ سه‌بعدی را خاموش می‌کند.
export const displayPrefs = $state({
  simple: false
})
