<script>
  import { onMount } from 'svelte'
  import { auth, ws } from './lib/store.svelte.js'
  import { sb, isConfigured } from './lib/supabase.js'
  import { ensureMember } from './lib/auth.js'
  import { loadWorkspace, loadRooms } from './lib/data.js'
  import { unsubscribeRoom } from './lib/chat.js'
  import Login from './components/Login.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import HomeView from './components/HomeView.svelte'
  import RoomsView from './components/RoomsView.svelte'
  import ChatView from './components/ChatView.svelte'
  import DocView from './components/DocView.svelte'
  import TasksView from './components/TasksView.svelte'
  import AssistantView from './components/AssistantView.svelte'
  import MembersView from './components/MembersView.svelte'

  let hash = $state(typeof location !== 'undefined' ? location.hash || '#/' : '#/')

  const route = $derived.by(() => {
    const h = hash.replace(/^#/, '') || '/'
    if (h === '/' || h === '') return { name: 'home' }
    if (h === '/rooms') return { name: 'rooms' }
    if (h === '/tasks') return { name: 'tasks' }
    if (h === '/assistant') return { name: 'assistant' }
    if (h === '/members') return { name: 'members' }
    const m = h.match(/^\/room\/(.+)$/)
    if (m) return { name: 'room', roomId: m[1] }
    const d = h.match(/^\/doc\/(.+)$/)
    if (d) return { name: 'doc', docId: d[1] }
    return { name: 'home' }
  })

  function onHashChange() {
    hash = location.hash || '#/'
  }

  // Keep the current room in sync with the route.
  $effect(() => {
    if (route.name === 'room') {
      ws.currentRoomId = route.roomId
    } else if (route.name !== 'room') {
      // Leaving a room unsubscribes (ChatView's effect cleanup does it);
      // nothing else to do here.
    }
  })

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
        auth.user = data.session.user
        await ensureMember(data.session.user)
        await loadWorkspace()
      }
      auth.sessionReady = true
      const { data: sub } = sb.auth.onAuthStateChange(async (_event, session) => {
        auth.user = session?.user ?? null
        if (session?.user) {
          await ensureMember(session.user)
          await loadWorkspace()
        } else {
          auth.member = null
          unsubscribeRoom()
          ws.projects = []
          ws.rooms = []
          ws.members = []
          ws.docs = []
          ws.files = []
          ws.tasks = []
          ws.templates = []
          ws.reminders = []
          ws.currentProjectId = null
          ws.currentRoomId = null
        }
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
      {/if}
    </main>
  </div>

  <!-- Mobile bottom nav (4 destinations, touch targets ≥ 44px) -->
  <nav class="fixed inset-x-0 bottom-0 z-10 flex border-t border-base-300 bg-base-200 md:hidden">
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
