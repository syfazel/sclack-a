<script>
  import { onMount, flushSync } from 'svelte'
  import { auth, ws, notif, pulse, displayPrefs } from './lib/store.svelte.js'
  import { sb, isConfigured } from './lib/supabase.js'
  import { ensureMember, handleAuthEvent, stashSession } from './lib/auth.js'
  import { loadWorkspace, loadProjectData } from './lib/data.js'
  import { unsubscribeRoom } from './lib/chat.js'
  import { refreshUnreadCount } from './lib/notifications.js'
  import { openDocTab, reopenClosedTab, restoreDocTabs } from './lib/tabs.js'
  import Login from './components/Login.svelte'
  import ResetPassword from './components/ResetPassword.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import DocTabs from './components/DocTabs.svelte'
  import HomeView from './components/HomeView.svelte'
  import RoomsView from './components/RoomsView.svelte'
  import ChatView from './components/ChatView.svelte'
  import DocView from './components/DocView.svelte'
  import TasksView from './components/TasksView.svelte'
  import BudgetView from './components/BudgetView.svelte'
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
    if (h === '/budget') return { name: 'budget' }
    if (h === '/assistant') return { name: 'assistant' }
    if (h === '/members') return { name: 'members' }
    if (h === '/notifications') return { name: 'notifications' }
    // Phase 11: the reset route. The suffix allows the recovery hash
    // Supabase appends (…#/reset-password#access_token=…) — parseRoute
    // must still see the route through it.
    if (h === '/reset-password' || h.startsWith('/reset-password#') || h.startsWith('/reset-password?'))
      return { name: 'reset-password' }
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
    if (route.name === 'doc') {
      // D-UX6: opening a doc opens (or activates) its tab.
      const known = ws.docs.find((d) => d.id === route.docId)
      openDocTab(route.docId, known?.title || 'سند')
    }
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
    auth.recoveryMode = false
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
    restoreDocTabs()
    // میان‌برهای سراسری (D-UX6 + تحقیق: با کلید فیزیکی بسته می‌شوند،
    // event.code — نه نویسه — تا در چیدمان فارسی هم کار کنند).
    const onKey = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.code === 'KeyK') {
        e.preventDefault()
        document.querySelector('[data-global-search]')?.focus()
      } else if (e.code === 'KeyT' && route.name === 'doc') {
        if (e.shiftKey) {
          e.preventDefault()
          const id = reopenClosedTab()
          if (id) location.hash = '#/doc/' + id
        } else {
          // تب تازه از همان صفحه‌ای که روی آن هستی (مثل نوشن).
          e.preventDefault()
          openDocTab(route.docId, ws.docs.find((d) => d.id === route.docId)?.title || 'سند')
        }
      } else if (e.code === 'Backslash') {
        e.preventDefault()
        displayPrefs.sidebarHidden = !displayPrefs.sidebarHidden
      }
    }
    window.addEventListener('keydown', onKey)
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
        // Phase 11: a recovery session (email link) shows the reset
        // form instead of the shell — even though the user IS signed
        // in with that session. The flag is in-memory only; a fresh
        // load without a recovery link never sets it.
        if (event === 'PASSWORD_RECOVERY') auth.recoveryMode = true
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
      window.removeEventListener('keydown', onKey)
      if (authSub) authSub.subscription.unsubscribe()
    }
  })
</script>

{#if !auth.sessionReady}
  <div class="flex min-h-screen items-center justify-center bg-base-100">
    <p class="opacity-70">در حال بارگذاری…</p>
  </div>
{:else if route.name === 'reset-password' || auth.recoveryMode}
  <!-- Phase 11: the reset form wins over the shell — a PASSWORD_RECOVERY
       session IS a signed-in session, so the plain !auth.user check
       below would hide the form behind the workspace. -->
  <ResetPassword />
{:else if !auth.user}
  <Login />
{:else}
  <div class="flex h-dvh bg-base-100">
    {#if !displayPrefs.sidebarHidden}
      <div class="hidden shrink-0 md:block">
        <Sidebar />
      </div>
    {/if}

    <main class="min-w-0 flex-1 pb-16 md:pb-0">
      {#if displayPrefs.sidebarHidden}
        <button
          class="btn btn-ghost btn-sm m-2"
          onclick={() => (displayPrefs.sidebarHidden = false)}
          title="نمایش سایدبار (Ctrl+\)"
        >
          ☰ سایدبار
        </button>
      {/if}
      {#if ws.docTabs.length > 0}
        <DocTabs currentDocId={route.name === 'doc' ? route.docId : null} />
      {/if}
      {#if ws.error}
        <div class="alert alert-error m-4" role="alert"><span>{ws.error}</span></div>
      {/if}
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
      {:else if route.name === 'budget'}
        <BudgetView />
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
  <nav class="glass-mild fixed inset-x-0 bottom-0 z-10 flex md:hidden" data-bottom-nav>
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
