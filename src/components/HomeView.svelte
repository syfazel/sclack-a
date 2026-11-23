<script>
  import { onMount } from 'svelte'
  import { auth, ws, chat, notif, pulse } from '../lib/store.svelte.js'
  import {
    loadTeamPulseData,
    loadRecentRooms,
    memberName
  } from '../lib/data.js'
  import { loadNotifications } from '../lib/notifications.js'
  import { setTaskDone } from '../lib/work.js'
  import { createTask } from '../lib/work.js'
  import { createDoc } from '../lib/docs.js'
  import { isStarred } from '../lib/starred.js'
  import {
    tehranDayKey,
    plannerMenuTasks,
    isOverdueTask,
    TASK_STATUS_LABEL,
    jalaliDayLabel,
    faNum,
    tehranGreeting,
    computeTeamPulse,
    computePulseChart,
    buildRecentActivity,
    computeProjectReview,
    pickProgressProjectId,
    buildTodayTimeline,
    tehranTimeLabel
  } from '../lib/extract.js'
  import { formatFileSize } from '../lib/docs.js'


  // G2 — هیروی خانه: شمار کارهای امروز و عقب‌مانده، فقط از ردیف‌های
  // واقعی (همان منطق خالص دفتر برنامه‌ریزی).
  const todayCount = $derived(
    plannerMenuTasks(ws.tasks, ws.reminders, 'today', {
      meId: auth.member?.id
    }).tasks.filter((t) => t.status !== 'done').length
  )
  const overdueCount = $derived(ws.tasks.filter((t) => isOverdueTask(t)).length)
  const onlineCount = $derived(Math.max(1, chat.presence.length))

  // ---------- G3: home dashboard + team pulse ----------
  // Greeting by Tehran time; the pulse slice is loaded once per home
  // mount (workspace-wide rows only RLS shows) and the notifications
  // are the same enriched pointer rows the bell uses — no new
  // Realtime channel is opened here.
  let mentionsReady = $state(false)
  let assistantQuery = $state('')
  let progressProjectId = $state(null)
  const greeting = $derived(tehranGreeting(new Date()))
  const pulseData = $derived(
    pulse.loaded
      ? computeTeamPulse(
          { messages: pulse.messages, tasks: pulse.tasks, docs: pulse.docs, files: pulse.files },
          new Date()
        )
      : null
  )
  const chart = $derived(pulseData ? computePulseChart(pulseData.days) : null)
  const chartHasData = $derived(
    pulseData ? pulseData.days.some((d) => d.messages > 0 || d.done > 0) : false
  )
  // Unread mention pointers, newest first (same source as the bell).
  const unreadMentions = $derived(
    (notif.notifications || [])
      .filter((n) => n.type === 'mention' && !n.read)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  )
  const mentionsLink = $derived(
    unreadMentions[0]?.message?.room_id
      ? '#/room/' + unreadMentions[0].message.room_id
      : '#/notifications'
  )
  const myTasks = $derived(
    [...(pulse.tasks || [])]
      .filter((t) => t.assignee_id === auth.member?.id)
      .sort((a, b) => {
        // Unfinished first (nearest due first), then done tasks — a
        // done task with an old due date must not push live work out
        // of the 4-row card. Done rows stay so they can be unchecked.
        const doneA = a.status === 'done' ? 1 : 0
        const doneB = b.status === 'done' ? 1 : 0
        if (doneA !== doneB) return doneA - doneB
        return (a.due_at || '9999').localeCompare(b.due_at || '9999')
      })
      .slice(0, 4)
  )
  // H3-1: today timeline — my unfinished tasks due today or overdue +
  // undone reminders due today or overdue, by time, max 5.
  const todayItems = $derived(
    buildTodayTimeline(
      { tasks: pulse.tasks, reminders: ws.reminders },
      new Date(),
      { meId: auth.member?.id }
    )
  )
  // H3-2: recent rooms enriched with the live room name and the unread
  // mention count from the same notification pointers as the bell.
  const recentRooms = $derived(
    (ws.recentRooms || []).map((r) => {
      const room = ws.rooms.find((x) => x.id === r.roomId)
      const unreadMentions = (notif.notifications || []).filter(
        (n) => n.type === 'mention' && !n.read && n.message?.room_id === r.roomId
      ).length
      return { ...r, name: room?.name || 'اتاق', unreadMentions }
    })
  )

  function roomTimeLabel(iso) {
    if (!iso) return ''
    return tehranDayKey(iso) === tehranDayKey(new Date())
      ? tehranTimeLabel(iso)
      : jalaliDayLabel(iso)
  }
  // H1-4: the progress ring defaults to the current project, else the
  // first project that has tasks, else the first project — so the ring
  // never says «هنوز کاری نیست» while «کارهای من» shows open tasks.
  const progressId = $derived(
    progressProjectId ||
      pickProgressProjectId(ws.projects, pulse.tasks, ws.currentProjectId)
  )
  const progressReview = $derived.by(() => {
    if (!progressId) return null
    return computeProjectReview(
      {
        tasks: (pulse.tasks || []).filter((t) => t.project_id === progressId),
        docs: [],
        files: []
      },
      new Date()
    )
  })
  const progressTotal = $derived(
    progressReview ? progressReview.todo + progressReview.doing + progressReview.done : 0
  )
  const progressFrac = $derived(progressTotal > 0 ? progressReview.done / progressTotal : 0)
  const recentDocs = $derived(
    [...(pulse.docs || [])]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 5)
  )
  // H2-3: starred docs, same source as the sidebar favorites
  // (pulse.docs + isStarred), newest first, max 5.
  const starredDocs = $derived(
    [...(pulse.docs || [])]
      .filter(isStarred)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 5)
  )
  const activity = $derived(
    pulse.loaded
      ? buildRecentActivity(
          { tasks: pulse.tasks, docs: pulse.docs, versions: pulse.versions },
          (id) => memberName(id),
          new Date(),
          5
        )
      : []
  )
  // Reminders menu: undone in-app reminders + unfinished tasks with a
  // due date, nearest first, max 5. In-app list only — no push.
  const remindersList = $derived.by(() => {
    const items = []
    for (const r of ws.reminders || []) {
      if (!r.done) items.push({ text: r.text, at: r.remind_at, link: '#/tasks' })
    }
    for (const t of pulse.tasks || []) {
      if (t.status !== 'done' && t.due_at) {
        items.push({ text: t.title, at: t.due_at, link: '#/tasks' })
      }
    }
    items.sort((a, b) => new Date(a.at || '9999') - new Date(b.at || '9999'))
    return items.slice(0, 5)
  })
  const recentFiles = $derived(
    [...(pulse.files || [])]
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
      .slice(0, 5)
  )
  const heroRoomLink = $derived(ws.rooms[0] ? '#/room/' + ws.rooms[0].id : null)
  const heroDocLink = $derived(ws.docs[0] ? '#/doc/' + ws.docs[0].id : null)

  function roomLinkForProject(projectId) {
    const r = (pulse.rooms || []).find((x) => x.project_id === projectId)
    return r ? '#/room/' + r.id : '#/rooms'
  }

  function projectName(id) {
    return ws.projects.find((p) => p.id === id)?.name || 'پروژه'
  }

  async function toggleMyTask(t) {
    const done = t.status !== 'done'
    // Optimistic flip so the ring moves at once; the pulse slice is
    // reloaded right after the row is written.
    pulse.tasks = pulse.tasks.map((x) =>
      x.id === t.id
        ? {
            ...x,
            status: done ? 'done' : 'todo',
            completed_at: done ? new Date().toISOString() : null
          }
        : x
    )
    try {
      await setTaskDone(t, done)
    } catch (e) {
      // The row was not written (RLS / network) — reload the true rows.
    }
    await loadTeamPulseData()
  }

  // R9: سؤال خانه دور ریخته نمی‌شود — با همان سازوکار localStorage
  // چیپ‌ها به گفت‌وگوی باز در پنل دستیار می‌رود و خودکار فرستاده می‌شود.
  function askAssistant() {
    const q = assistantQuery.trim()
    if (q) {
      try {
        window.localStorage.setItem('sclack-ai-question', q)
      } catch {
        /* storage unavailable */
      }
      assistantQuery = ''
    }
    location.hash = '#/assistant'
  }

  // H2-1: quick task for me in the current project — same API as
  // TasksView, then the pulse slice reloads so the cards refresh.
  let quickTaskTitle = $state('')
  let quickTaskBusy = $state(false)
  let quickTaskError = $state('')

  async function doQuickTask() {
    const title = quickTaskTitle.trim()
    if (!title || quickTaskBusy || !ws.currentProjectId) return
    quickTaskBusy = true
    quickTaskError = ''
    try {
      await createTask({
        projectId: ws.currentProjectId,
        title,
        description: null,
        assigneeId: auth.member?.id || null,
        dueAt: null,
        linkType: null,
        linkId: null
      })
      quickTaskTitle = ''
      await loadTeamPulseData()
    } catch (e) {
      quickTaskError = e.message || String(e)
    } finally {
      quickTaskBusy = false
    }
  }

  // H2-2: new doc in the current project — same path as the sidebar
  // (createDoc + go to the doc).
  let newHomeDocTitle = $state('')
  let homeDocBusy = $state(false)
  let homeDocError = $state('')

  async function doCreateHomeDoc() {
    const title = newHomeDocTitle.trim()
    if (!title || homeDocBusy || !ws.currentProjectId) return
    homeDocBusy = true
    homeDocError = ''
    try {
      const doc = await createDoc(ws.currentProjectId, title)
      newHomeDocTitle = ''
      location.hash = '#/doc/' + doc.id
    } catch (e) {
      homeDocError = e.message || String(e)
    } finally {
      homeDocBusy = false
    }
  }

  // Quick chips on the assistant home card: hand the command number
  // to the assistant view through localStorage, then navigate there.
  function goAssistant(n) {
    try {
      window.localStorage.setItem('sclack-ai-active-cmd', String(n))
    } catch {
      /* storage unavailable */
    }
    location.hash = '#/assistant'
  }

  onMount(() => {
    loadTeamPulseData()
    loadNotifications()
      .catch(() => {})
      .finally(() => {
        mentionsReady = true
      })
  })

  // H3-2: reload the recent rooms whenever the room list changes
  // (workspace load, project switch). Track the room ids, not just the
  // count — a switch can keep the count while changing the rooms.
  $effect(() => {
    const roomIds = ws.rooms.map((r) => r.id).join(',')
    void roomIds
    loadRecentRooms()
  })

</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <!-- G3-1: bento grid — 12 columns on desktop, 2 on tablet, 1 on
       mobile. DOM order is the mobile reading order (greeting, today,
       mentions, my tasks, progress, recent docs, activity,
       recent-rooms, favorites, reminders, files, assistant, pulse);
       desktop placement is explicit lg:col-start/lg:col-span per card. -->
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12" data-home-bento>
  <!-- G2 — هیروی خانه: «سلام + کارهای امروز»؛ صحنهٔ آرام (سبک، کند)
       پشت کارت شیشه‌ای. حرکت نباید خواندن کارهای امروز را بگیرد. -->
  <section class="relative col-span-1 overflow-hidden rounded-3xl md:col-span-2 lg:col-span-12" data-home-hero data-home-card="greeting">
    <div class="relative h-44">
      {#await import('./HeroScene.svelte')}
        <div class="light-mesh absolute inset-0"></div>
      {:then { default: HeroScene }}
        <HeroScene variant="home" onlineCount={onlineCount} />
      {:catch}
        <div class="light-mesh absolute inset-0"></div>
      {/await}
      <div class="absolute inset-0 flex items-center p-5">
        <div class="glass-card px-5 py-4">
          <h1 class="text-2xl font-bold">{greeting}{auth.member ? ' ' + auth.member.name : ''}</h1>
          <p class="mt-2 flex items-baseline gap-4 text-sm">
            <span>
              <span class="text-2xl font-bold">{faNum(todayCount)}</span> کار امروز
            </span>
            <span>
              <span class="text-2xl font-bold {overdueCount > 0 ? 'text-error' : ''}">
                {faNum(overdueCount)}
              </span>
              عقب‌مانده
            </span>
          </p>
          <p class="mt-1 text-xs opacity-70">به فضای کاری sclack_A خوش آمدید.</p>
          <div class="mt-3 flex gap-2">
            {#if heroRoomLink}<a href={heroRoomLink} class="btn btn-sm btn-sclack">رفتن به اتاق</a>{/if}
            {#if heroDocLink}<a href={heroDocLink} class="btn btn-sm btn-sclack-secondary">رفتن به سند</a>{/if}
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- G3-2: home cards — every number comes from a real row; every
       card has an empty state. No number without a source; no
       consumption-percentage bar is built. -->
  <!-- H3-1: today timeline — my unfinished tasks due today or overdue
       + undone reminders due today or overdue, by time, max 5. -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-5 lg:col-start-1" data-home-card="today">
    <h2 class="text-base font-bold">امروز</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if pulse.error}
      <p class="mt-2 text-sm text-error">امروز بارگذاری نشد</p>
    {:else if todayItems.length === 0}
      <p class="mt-2 text-sm opacity-70">برای امروز چیزی نیست</p>
      <p class="mt-1 text-xs opacity-60">کار یا یادآوری با سررسید امروز اینجا می‌آید</p>
    {:else}
      <ul class="mt-2 space-y-2" data-today-list>
        {#each todayItems as item (item.kind + ':' + item.id)}
          <li class="flex items-center gap-2 text-sm">
            <span class="shrink-0 text-xs font-bold text-primary">{tehranTimeLabel(item.dueAt)}</span>
            <span class="min-w-0 flex-1 truncate">{item.title}</span>
            {#if item.overdue}
              <span class="shrink-0 text-xs text-error">عقب‌مانده</span>
            {:else if item.kind === 'reminder'}
              <span class="shrink-0 text-xs opacity-60">یادآوری</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Card 2: mentions (unread mention pointers, same rows as the bell) -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-3 lg:col-start-10" data-home-card="mentions">
    <h2 class="text-base font-bold">منشن‌ها</h2>
    {#if !mentionsReady}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if unreadMentions.length === 0}
      <p class="mt-2 text-sm opacity-70">منشنی نیست</p>
      <p class="mt-1 text-xs opacity-60">بر اساس اعلان‌ها</p>
    {:else}
      <p class="mt-2 text-sm">
        <span class="text-2xl font-bold" data-mentions-count>{faNum(unreadMentions.length)}</span>
        منشن خوانده‌نشده
      </p>
      <p class="mt-1 text-xs opacity-60">بر اساس اعلان‌ها</p>
      <a href={mentionsLink} class="btn btn-sm btn-sclack mt-3">رفتن به اتاق</a>
    {/if}
  </section>

  <!-- Card 3: my tasks — nearest due first, max 4; checkbox toggles done -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-6" data-home-card="my-tasks">
    <h2 class="text-base font-bold">کارهای من</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if myTasks.length === 0}
      <p class="mt-2 text-sm opacity-70">کاری به تو سپرده نشده</p>
      <a href="#/tasks" class="btn btn-sm btn-sclack-secondary mt-3">رفتن به کارها</a>
    {:else}
      <ul class="mt-2 space-y-2" data-my-tasks-list>
        {#each myTasks as t (t.id)}
          <li class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox checkbox-sm shrink-0"
              checked={t.status === 'done'}
              onchange={() => toggleMyTask(t)}
            />
            <span class="min-w-0 flex-1 line-clamp-2 {t.status === 'done' ? 'line-through opacity-60' : ''}">
              {t.title}
            </span>
            {#if t.due_at}
              <span class="shrink-0 text-xs opacity-60">{jalaliDayLabel(t.due_at)}</span>
            {/if}
            <span class="badge badge-sm shrink-0">{TASK_STATUS_LABEL[t.status]}</span>
          </li>
        {/each}
      </ul>
      <a href="#/tasks" class="btn btn-sm btn-sclack-secondary mt-3">همهٔ کارها</a>
    {/if}
    <!-- H2-1: quick task for me in the current project -->
    <div class="mt-3 flex gap-2">
      <input
        class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
        placeholder="کار تازه برای من"
        bind:value={quickTaskTitle}
        onkeydown={(e) => {
          if (e.key === 'Enter') doQuickTask()
        }}
        disabled={quickTaskBusy || !ws.currentProjectId}
      />
      <button
        class="btn btn-sclack btn-sm btn-primary"
        onclick={doQuickTask}
        disabled={quickTaskBusy || !ws.currentProjectId || !quickTaskTitle.trim()}
      >
        ساختن
      </button>
    </div>
    {#if quickTaskError}
      <p class="mt-1 text-xs text-error">{quickTaskError}</p>
    {/if}
  </section>

  <!-- Card 4: project progress — SVG ring from computeProjectReview -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-1" data-home-card="progress">
    <h2 class="text-base font-bold">پیشرفت پروژه</h2>
    {#if ws.projects.length === 0}
      <p class="mt-2 text-sm opacity-70">هنوز پروژه‌ای نیست</p>
    {:else}
      <select
        class="select select-sm select-bordered mt-2 w-full"
        value={progressId}
        onchange={(e) => (progressProjectId = e.currentTarget.value)}
      >
        {#each ws.projects as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      {#if pulse.loading && !pulse.loaded}
        <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
      {:else if !progressReview || progressTotal === 0}
        <p class="mt-2 text-sm opacity-70">هنوز کاری نیست</p>
      {:else}
        <div class="mt-3 flex items-center gap-4">
          <svg viewBox="0 0 100 100" class="h-24 w-24 shrink-0" role="img" aria-label="پیشرفت پروژه">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-base-300)" stroke-width="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--jigari)"
              stroke-width="10"
              stroke-linecap="round"
              stroke-dasharray="263.9"
              stroke-dashoffset={263.9 * (1 - progressFrac)}
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="55" text-anchor="middle" class="text-lg font-bold">{faNum(Math.round(progressFrac * 100))}٪</text>
          </svg>
          <div class="text-sm">
            <p data-progress-count>
              {faNum(progressReview.done)} از {faNum(progressTotal)} کار تمام‌شده
            </p>
            <p class="mt-1 opacity-70">
              {faNum(progressReview.todo)} باز · {faNum(progressReview.doing)} در حال انجام · {faNum(progressReview.done)} تمام‌شده
            </p>
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Card 5: recent docs — last edited first, max 5 -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-7 lg:col-start-1" data-home-card="recent-docs">
    <h2 class="text-base font-bold">سندهای اخیر</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if recentDocs.length === 0}
      <p class="mt-2 text-sm opacity-70">هنوز سندی نیست</p>
    {:else}
      <ul class="mt-2 space-y-2" data-recent-docs-list>
        {#each recentDocs as d (d.id)}
          <li class="flex items-center gap-2 text-sm">
            <a href={'#/doc/' + d.id} class="min-w-0 flex-1 truncate text-primary">{d.title}</a>
            <span class="shrink-0 text-xs opacity-60">{projectName(d.project_id)}</span>
            <span class="shrink-0 text-xs opacity-60">{memberName(d.created_by)}</span>
            <span class="shrink-0 text-xs opacity-60">{jalaliDayLabel(d.updated_at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <!-- H2-2: new doc in the current project (same path as the sidebar) -->
    <div class="mt-3 flex gap-2">
      <input
        class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
        placeholder="نام سند تازه در این پروژه"
        bind:value={newHomeDocTitle}
        onkeydown={(e) => {
          if (e.key === 'Enter') doCreateHomeDoc()
        }}
        disabled={homeDocBusy || !ws.currentProjectId}
      />
      <button
        class="btn btn-sclack btn-sm btn-primary"
        onclick={doCreateHomeDoc}
        disabled={homeDocBusy || !ws.currentProjectId || !newHomeDocTitle.trim()}
      >
        ساختن
      </button>
    </div>
    {#if homeDocError}
      <p class="mt-1 text-xs text-error">{homeDocError}</p>
    {/if}
  </section>

  <!-- Card 6: recent activity — merged task/doc/version events, max 5 -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-5 lg:col-start-8" data-home-card="activity">
    <h2 class="text-base font-bold">فعالیت اخیر</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if activity.length === 0}
      <p class="mt-2 text-sm opacity-70">هنوز فعالیتی نیست</p>
    {:else}
      <ul class="mt-2 space-y-2" data-activity-list>
        {#each activity as a}
          <li class="flex items-center gap-2 text-sm">
            <a href={a.link} class="min-w-0 flex-1 truncate">{a.actor} {a.text}</a>
            <span class="shrink-0 text-xs opacity-60">{jalaliDayLabel(a.at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- H3-2: recent rooms — newest message per room, newest room first,
       with the unread mention count from the bell pointers. -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-5" data-home-card="recent-rooms">
    <h2 class="text-base font-bold">اتاق‌های اخیر</h2>
    {#if ws.recentRoomsLoading}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if ws.recentRoomsError}
      <p class="mt-2 text-sm text-error">اتاق‌های اخیر بارگذاری نشد</p>
    {:else if recentRooms.length === 0}
      <p class="mt-2 text-sm opacity-70">هنوز پیامی نیست</p>
    {:else}
      <ul class="mt-2 space-y-3" data-recent-rooms-list>
        {#each recentRooms as room (room.roomId)}
          <li class="text-sm">
            <div class="flex items-center gap-2">
              <a href={'#/room/' + room.roomId} class="min-w-0 flex-1 truncate font-bold text-primary">{room.name}</a>
              {#if room.unreadMentions > 0}
                <span class="badge badge-error badge-sm shrink-0">{faNum(room.unreadMentions)}</span>
              {/if}
              <span class="shrink-0 text-xs opacity-60">{roomTimeLabel(room.lastMessage.created_at)}</span>
            </div>
            <p class="mt-0.5 truncate text-xs opacity-70">{room.lastMessage.body}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- H2-3: favorites — starred docs, same source as the sidebar
       favorites (pulse.docs + isStarred), max 5. -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-9" data-home-card="favorites">
    <h2 class="text-base font-bold">علاقه‌مندی‌ها</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if starredDocs.length === 0}
      <p class="mt-2 text-sm opacity-70">سندی ستاره‌دار نیست</p>
      <p class="mt-1 text-xs opacity-60">از سایدبار روی سند ستاره بزن</p>
    {:else}
      <ul class="mt-2 space-y-2" data-favorites-list>
        {#each starredDocs as d (d.id)}
          <li class="flex items-center gap-2 text-sm">
            <a href={'#/doc/' + d.id} class="min-w-0 flex-1 truncate text-primary">{d.title}</a>
            <span class="shrink-0 text-xs opacity-60">{projectName(d.project_id)}</span>
            <span class="shrink-0 text-xs opacity-60">{jalaliDayLabel(d.updated_at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Card 7: reminders — undone reminders + due tasks, nearest first.
       In-app list only — no push. -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-1" data-home-card="reminders">
    <h2 class="text-base font-bold">یادآوری‌ها</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if remindersList.length === 0}
      <p class="mt-2 text-sm opacity-70">یادآوری‌ای نیست</p>
    {:else}
      <ul class="mt-2 space-y-2" data-reminders-list>
        {#each remindersList as r}
          <li class="flex items-center gap-2 text-sm">
            <a href={r.link} class="min-w-0 flex-1 line-clamp-2">{r.text}</a>
            <span class="shrink-0 text-xs opacity-60">{r.at ? jalaliDayLabel(r.at) : 'بدون تاریخ'}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="mt-2 text-xs opacity-60">فقط درون‌اپی — پوش نمی‌فرستیم</p>
  </section>

  <!-- Card 8: recent files — newest upload first, max 5 -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-5" data-home-card="files">
    <h2 class="text-base font-bold">فایل‌های اخیر</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if recentFiles.length === 0}
      <p class="mt-2 text-sm opacity-70">هنوز فایلی نیست</p>
    {:else}
      <ul class="mt-2 space-y-2" data-recent-files-list>
        {#each recentFiles as f (f.id)}
          <li class="flex items-center gap-2 text-sm">
            <a href={roomLinkForProject(f.project_id)} class="min-w-0 flex-1 truncate text-primary">{f.name}</a>
            <span class="shrink-0 text-xs opacity-60">{formatFileSize(f.size)}</span>
            <span class="shrink-0 text-xs opacity-60">{projectName(f.project_id)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Card 9: Muse assistant — the ONLY jigari card on the home page
       (G3-5 layer law). Clicking goes to the assistant view. -->
  <section class="glass-card ai-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-9" data-home-card="assistant">
    <h2 class="text-base font-bold">دستیار میوز</h2>
    <p class="mt-2 text-sm opacity-70">از میوز بپرس — فقط از ردیف‌های واقعی جواب می‌دهد.</p>
    <input
      class="input input-bordered input-sclack mt-3 w-full bg-base-100"
      placeholder="از میوز بپرس"
      bind:value={assistantQuery}
      onkeydown={(e) => {
        if (e.key === 'Enter') askAssistant()
      }}
    />
    <button class="ai-btn mt-2 w-full" onclick={askAssistant}>بپرس</button>
    <a href="#/assistant" class="btn btn-sm btn-sclack-secondary mt-2">رفتن به دستیار</a>
    <div class="mt-2 flex flex-wrap gap-2">
      <button type="button" class="ai-chip" onclick={() => goAssistant(57)}>
        نگهبان مهلت‌ها
      </button>
      <button type="button" class="ai-chip" onclick={() => goAssistant(77)}>
        سؤال دربارهٔ فضای کاری
      </button>
      <button type="button" class="ai-chip" onclick={() => goAssistant(13)}>
        پیام‌های امروز
      </button>
    </div>
  </section>

  <!-- G3-3: team pulse — four real counts + hand-made 7-day SVG line
       chart with a text-alternative table. Weekly change % is rendered
       ONLY when the previous 7-day sum is > 0. -->
  <section class="glass-card col-span-1 p-4 md:col-span-2 lg:col-span-12" data-home-card="pulse">
    <h2 class="text-base font-bold">نبض تیم</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری نبض تیم…</p>
    {:else if pulse.error}
      <div class="alert alert-error mt-2"><span>{pulse.error}</span></div>
      <button class="btn btn-sm btn-sclack mt-2" onclick={() => loadTeamPulseData()}>تلاش دوباره</button>
    {:else if pulseData}
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="text-center">
          <div class="text-2xl font-bold" data-pulse-number="messages">{faNum(pulseData.todayMessages)}</div>
          <div class="text-xs opacity-70">پیام‌های امروز</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold" data-pulse-number="done-week">{faNum(pulseData.doneThisWeek)}</div>
          <div class="text-xs opacity-70">کار تمام‌شدهٔ این هفته</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold" data-pulse-number="docs">{faNum(pulseData.activeDocs)}</div>
          <div class="text-xs opacity-70">سند فعال (۷ روز اخیر)</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold" data-pulse-number="files">{faNum(pulseData.newFiles)}</div>
          <div class="text-xs opacity-70">فایل تازه (۷ روز اخیر)</div>
        </div>
      </div>
      {#if chartHasData}
        <svg
          viewBox="0 0 600 180"
          class="mt-4 w-full"
          role="img"
          aria-label="نمودار ۷ روزهٔ نبض تیم"
          data-pulse-chart
        >
          <polygon points={chart.messagesArea} fill="rgba(127,29,29,0.10)" />
          <polygon points={chart.doneArea} fill="rgba(21,128,61,0.10)" />
          {#each chart.gridlines as g}
            <line x1="8" x2="556" y1={g.y} y2={g.y} stroke="rgba(16,24,40,0.10)" stroke-width="1" />
            <text x="594" y={g.y + 4} text-anchor="end" font-size="11" fill="rgba(16,24,40,0.55)">{faNum(g.value)}</text>
          {/each}
          <polyline
            points={chart.messagesPoints}
            fill="none"
            stroke="#7F1D1D"
            stroke-width="2"
            data-pulse-series="messages"
          />
          <polyline
            points={chart.donePoints}
            fill="none"
            stroke="#15803d"
            stroke-width="2"
            data-pulse-series="done"
          />
          {#each chart.labels as l}
            <text x={l.x} y="172" text-anchor="middle" font-size="11">{l.label}</text>
          {/each}
        </svg>
        <p class="mt-1 flex gap-4 text-xs opacity-70">
          <span><span class="inline-block h-2 w-4 bg-[#7F1D1D]"></span> پیام‌ها</span>
          <span><span class="inline-block h-2 w-4 bg-[#15803d]"></span> کار تمام‌شده</span>
        </p>
        <table class="mt-2 w-full text-xs" data-pulse-chart-table>
          <thead>
            <tr><th class="text-start">روز</th><th>پیام</th><th>کار تمام‌شده</th></tr>
          </thead>
          <tbody>
            {#each pulseData.days as d}
              <tr>
                <td>{d.label}</td>
                <td>{faNum(d.messages)}</td>
                <td>{faNum(d.done)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="mt-2 flex gap-4 text-xs">
          {#if pulseData.changeMessages !== null}
            <span data-pulse-change-messages>
              پیام‌ها: {faNum(pulseData.changeMessages)}٪ نسبت به ۷ روز قبل
            </span>
          {/if}
          {#if pulseData.changeDone !== null}
            <span data-pulse-change-done>
              کار تمام‌شده: {faNum(pulseData.changeDone)}٪ نسبت به ۷ روز قبل
            </span>
          {/if}
        </p>
      {:else}
        <p class="mt-3 text-sm opacity-70">هنوز داده‌ای نیست</p>
      {/if}
    {/if}
  </section>
  </div>

</div>
