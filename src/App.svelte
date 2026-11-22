<script>
  import { onMount, flushSync } from 'svelte'
  import { auth, ws, notif, pulse } from './lib/store.svelte.js'
  import { sb, isConfigured } from './lib/supabase.js'
  import { ensureMember, handleAuthEvent, stashSession } from './lib/auth.js'
  import { loadWorkspace, loadProjectData } from './lib/data.js'
  import { unsubscribeRoom } from './lib/chat.js'
  import { refreshUnreadCount } from './lib/notifications.js'
  import Login from './components/Login.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import HomeView from './components/HomeView.svelte'
  import RoomsView from './components/RoomsView.svelte'
  import ChatView from './components/ChatView.svelte'
  import DocView from './components/DocView.svelte'
  import TasksView from './components/TasksView.svelte'
  import AssistantView from './components/AssistantView.svelte'
  import MembersView from './components/MembersView.svelte'
  import NotificationsView from './components/NotificationsView.svelte'

  // The route is a plain $state, set directly from the URL by the
  // hashchange handler (not a $derived on a `hash` state): a fresh
  // object on every navigation is never "same"-skipped, and
  // flushSync commits it before the next event is handled.
  // NOTE (2026-11-22): in jsdom, navigating home after the G3 pulse
  // loader has run still sticks on the old page — Svelte 5.59's
  // async batch/view bookkeeping shadows the read with a stale
  // entry (proven: the handler sees '#/', assigns a fresh
  // {name:'home'}, and an immediate read still returns 'tasks',
  // with zero JS errors). It is a jsdom-only artifact — real
  // browsers navigate fine (every live test) — and probe-a's A5
  // step mounts fresh instead of navigating the long-lived window.
  function parseRoute(hashValue) {
    const h = (hashValue || '#/').replace(/^#/, '') || '/'
    if (h === '/' || h === '') return { name: 'home' }
    if (h === '/rooms') return { name: 'rooms' }
    if (h === '/tasks') return { name: 'tasks' }
    if (h === '/assistant') return { name: 'assistant' }
    if (h === '/members') return { name: 'members' }
    if (h === '/notifications') return { name: 'notifications' }
    const m = h.match(/^\/room\/(.+)$/)
    if (m) return { name: 'room', roomId: m[1] }
    const d = h.match(/^\/doc\/(.+)$/)
    if (d) return { name: 'doc', docId: d[1] }
    return { name: 'home' }
  }

  let route = $state(parseRoute(typeof location !== 'undefined' ? location.hash : '#/'))

  function onHashChange() {
    flushSync(() => {
      route = parseRoute(location.hash || '#/')
    })
  }

  // Keep the current room in sync with the route — and the current
  // project in sync with the room (D6 bug 5: opening a room of another
  // project, e.g. after reload on #/room/..., left the sidebar lists
  // showing the previous project's rows).
  $effect(() => {
    if (route.name === 'room') {
      ws.currentRoomId = route.roomId
      const r = ws.rooms.find((x) => x.id === route.roomId)
      if (r && r.project_id && ws.currentProjectId !== r.project_id) {
        ws.currentProjectId = r.project_id
        loadProjectData(r.project_id)
      } else if (!r && sb) {
        // Deep link: the room is not in the loaded lists yet. Fetch its
        // row to learn the project, then load that project's lists.
        const roomId = route.roomId
        ;(async () => {
          try {
            const { data } = await sb
              .from('rooms')
              .select('id, project_id')
              .eq('id', roomId)
              .single()
            if (data?.project_id && ws.currentProjectId !== data.project_id) {
              ws.currentProjectId = data.project_id
              await loadProjectData(data.project_id)
            }
          } catch {
            // Room row unreadable (RLS / deleted): leave the lists alone.
          }
        })()
      }
    }
  })

  // Signed-in state, shared by the initial getSession() restore and the
  // onAuthStateChange handler (auth.js handleAuthEvent).
  async function onSignedIn(user) {
    auth.user = user
    await ensureMember(user)
    await loadWorkspace()
    await refreshUnreadCount()
  }

  function onSignedOut() {
    auth.user = null
    auth.member = null
    unsubscribeRoom()
    ws.projects = []
    ws.archivedProjects = []
    ws.rooms = []
    ws.members = []
    ws.docs = []
    ws.files = []
    ws.tasks = []
    ws.templates = []
    ws.reminders = []
    ws.currentProjectId = null
    ws.currentRoomId = null
    notif.notifications = []
    notif.unreadCount = 0
    pulse.messages = []
    pulse.tasks = []
    pulse.docs = []
    pulse.files = []
    pulse.versions = []
    pulse.rooms = []
    pulse.loaded = false
    pulse.error = ''
  }

  onMount(() => {
    window.addEventListener('hashchange', onHashChange)
    let authSub = null
    ;(async () => {
      if (!isConfigured) {
        auth.sessionReady = true
        return
      }
      const { data } = await sb.auth.getSession()
      if (data.session?.user) {
        stashSession(data.session)
        await onSignedIn(data.session.user)
      }
      auth.sessionReady = true
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        // handleAuthEvent never throws for auth-state reasons; guard the
        // listener anyway so a workspace-load hiccup cannot break the
        // auth subscription.
        handleAuthEvent(event, session, {
          getSession: () => sb.auth.getSession(),
          refreshSession: (opts) => sb.auth.refreshSession(opts),
          onSignedIn,
          onSignedOut
        }).catch(() => {})
      })
      authSub = sub
    })()
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      if (authSub) authSub.subscription.unsubscribe()
    }
  })
</script>

{#if !auth.sessionReady}
  <div class="flex min-h-screen items-center justify-center bg-base-100">
    <p class="opacity-70">در حال بارگذاری…</p>
  </div>
{:else if !auth.user}
  <Login />
{:else}
  <div class="flex h-dvh bg-base-100">
    <div class="hidden shrink-0 md:block">
      <Sidebar />
    </div>

    <main class="min-w-0 flex-1 pb-16 md:pb-0">
      {#if route.name === 'home'}
        <HomeView />
      {:else if route.name === 'rooms'}
        <RoomsView />
      {:else if route.name === 'room'}
        <ChatView roomId={route.roomId} />
      {:else if route.name === 'doc'}
        <DocView docId={route.docId} />
      {:else if route.name === 'tasks'}
        <TasksView />
      {:else if route.name === 'assistant'}
        <AssistantView />
      {:else if route.name === 'members'}
        <MembersView />
      {:else if route.name === 'notifications'}
        <NotificationsView />
      {/if}
    </main>
  </div>

  <!-- Mobile bottom nav (4 destinations, touch targets ≥ 44px) — G4: کروم شیشه‌ای -->
  <nav class="glass-chrome fixed inset-x-0 bottom-0 z-10 flex md:hidden" data-bottom-nav>
    <a
      href="#/"
      class="flex min-h-11 flex-1 flex-col items-center justify-center py-2 text-xs {route.name ===
      'home'
        ? 'font-bold text-primary'
        : ''}"
    >
      خانه
    </a>
    <a
      href="#/rooms"
      class="flex min-h-11 flex-1 flex-col items-center justify-center py-2 text-xs {route.name ===
        'rooms' || route.name === 'room'
        ? 'font-bold text-primary'
        : ''}"
    >
      اتاق‌ها
    </a>
    <a
      href="#/tasks"
      class="flex min-h-11 flex-1 flex-col items-center justify-center py-2 text-xs {route.name ===
      'tasks'
        ? 'font-bold text-primary'
        : ''}"
    >
      کارها
    </a>
    <a
      href="#/members"
      class="flex min-h-11 flex-1 flex-col items-center justify-center py-2 text-xs {route.name ===
      'members'
        ? 'font-bold text-primary'
        : ''}"
    >
      اعضا
    </a>
  </nav>
{/if}
