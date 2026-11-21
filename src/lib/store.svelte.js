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
