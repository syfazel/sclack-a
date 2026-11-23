<script>
  import { onMount } from 'svelte'
  import { auth, ws, chat, notif, pulse } from '../lib/store.svelte.js'
  import {
    createProject,
    updateProject,
    closeProject,
    deleteProject,
    loadProjectData,
    loadTeamPulseData,
    memberName
  } from '../lib/data.js'
  import { loadNotifications } from '../lib/notifications.js'
  import { setTaskDone } from '../lib/work.js'
  import {
    PROJECT_STAGE_LABEL,
    endOfTehranDay,
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
    computeProjectReview
  } from '../lib/extract.js'
  import { formatFileSize } from '../lib/docs.js'
  import FileList from './FileList.svelte'
  import ProjectReview from './ProjectReview.svelte'

  // P01 A1 — full project creation form: name (required, unique),
  // description, goal (required), final_output, deadline (required),
  // members. The form is always visible, not only when the workspace
  // is empty — a project is created from here, never name-only.
  let projName = $state('')
  let projDesc = $state('')
  let projGoal = $state('')
  let projFinal = $state('')
  let projDeadline = $state('')
  let projMembers = $state(null) // null = not chosen yet; defaults to all members
  let createError = $state('')
  let creating = $state(false)

  let closeError = $state('')
  let closingId = $state(null)

  // G1 item 8 — project delete: creator only (w1), two-tap in-app
  // confirm with a warning (no native confirm()). A delete that the
  // pre-check refuses (other members' rows, versioned docs) shows its
  // clear error under the projects list instead of deleting anything.
  let armDeleteProjectId = $state(null)
  let deleteError = $state('')

  // Phase 2 — project edit in place (plan gap 7): the form lives
  // under the project card in the «پروژه‌ها» section — that card is
  // where the project's goal / final output / deadline are shown
  // (ProjectReview only renders counts). Members and stage are NOT
  // edited here: updateProject merges custom_fields and keeps them.
  // A rename needs a second tap on save (armRenameName tracks the
  // exact name that was armed, so retyping a different name re-arms).
  let editingProjectId = $state(null)
  let editProjName = $state('')
  let editProjDesc = $state('')
  let editProjGoal = $state('')
  let editProjFinal = $state('')
  let editProjDeadline = $state('') // Tehran day key for the date input
  let editProjError = $state('')
  let editProjBusy = $state(false)
  let editProjSavedId = $state(null)
  let armRenameProjectId = $state(null)
  let armRenameName = $state(null)

  function openProjectEdit(p) {
    // Toggling the same card closes its form without saving.
    if (editingProjectId === p.id) {
      editingProjectId = null
      editProjError = ''
      armRenameProjectId = null
      armRenameName = null
      return
    }
    editingProjectId = p.id
    editProjName = p.name || ''
    editProjDesc = p.description || ''
    const cf = p.custom_fields || {}
    editProjGoal = cf.goal || ''
    editProjFinal = cf.final_output || ''
    editProjDeadline = cf.deadline ? tehranDayKey(cf.deadline) : ''
    editProjError = ''
    armRenameProjectId = null
    armRenameName = null
  }

  function cancelProjectEdit() {
    editingProjectId = null
    editProjError = ''
    armRenameProjectId = null
    armRenameName = null
  }

  async function doSaveProjectEdit() {
    if (editProjBusy || !editingProjectId) return
    const p = ws.projects.find((x) => x.id === editingProjectId)
    if (!p) return
    const cleanName = (editProjName || '').trim()
    if (
      cleanName !== (p.name || '').trim() &&
      (armRenameProjectId !== p.id || armRenameName !== cleanName)
    ) {
      armRenameProjectId = p.id
      armRenameName = cleanName
      editProjError = 'نام پروژه عوض می‌شود — برای تأیید، دوباره «ذخیرهٔ تغییرات» را بزنید.'
      return
    }
    editProjBusy = true
    editProjError = ''
    try {
      await updateProject(p, {
        name: editProjName,
        description: editProjDesc,
        goal: editProjGoal,
        finalOutput: editProjFinal,
        deadline: editProjDeadline ? endOfTehranDay(editProjDeadline) : ''
      })
      editProjSavedId = p.id
      editingProjectId = null
      armRenameProjectId = null
      armRenameName = null
      setTimeout(() => {
        editProjSavedId = null
      }, 700)
    } catch (e) {
      editProjError = e.message || String(e)
    } finally {
      editProjBusy = false
    }
  }

  async function doDeleteProject(p) {
    if (armDeleteProjectId !== p.id) {
      armDeleteProjectId = p.id
      return
    }
    armDeleteProjectId = null
    deleteError = ''
    try {
      await deleteProject(p)
    } catch (e) {
      deleteError = e.message || String(e)
    }
  }

  // Default the member checkboxes to every workspace member once they load.
  $effect(() => {
    if (projMembers === null && ws.members.length > 0) {
      projMembers = ws.members.map((m) => m.id)
    }
  })

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
  const progressId = $derived(progressProjectId || ws.projects[0]?.id || null)
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

  function askAssistant() {
    location.hash = '#/assistant'
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

  function memberNames(ids) {
    if (!ids || ids.length === 0) return ''
    return ids
      .map((id) => ws.members.find((m) => m.id === id)?.name)
      .filter(Boolean)
      .join('، ')
  }

  function stageLabel(p) {
    return PROJECT_STAGE_LABEL[p.custom_fields?.stage] || p.custom_fields?.stage || '—'
  }

  function fmtDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('fa-IR')
  }

  function toggleMember(id, checked) {
    const list = [...(projMembers || [])]
    if (checked) {
      if (!list.includes(id)) list.push(id)
    } else {
      const i = list.indexOf(id)
      if (i >= 0) list.splice(i, 1)
    }
    projMembers = list
  }

  async function openProject(p) {
    ws.currentProjectId = p.id
    await loadProjectData(p.id)
    if (ws.rooms.length > 0) location.hash = '#/room/' + ws.rooms[0].id
  }

  async function doCreateProject() {
    if (creating) return
    creating = true
    createError = ''
    try {
      const { room } = await createProject({
        name: projName,
        description: projDesc,
        goal: projGoal,
        finalOutput: projFinal,
        deadline: projDeadline ? endOfTehranDay(projDeadline) : '',
        memberIds: projMembers || []
      })
      projName = ''
      projDesc = ''
      projGoal = ''
      projFinal = ''
      projDeadline = ''
      projMembers = null
      location.hash = '#/room/' + room.id
    } catch (e) {
      createError = e.message || String(e)
    } finally {
      creating = false
    }
  }

  // P01 A5 — close = archive, not delete. Two-step confirm; docs, files
  // and tasks stay readable afterwards.
  async function doCloseProject(p) {
    if (closingId) return
    if (!confirm('پروژه «' + p.name + '» بسته و به بایگانی می‌رود. سند و فایل و کارهایش خواندنی می‌مانند. ادامه می‌دهید؟')) return
    closingId = p.id
    closeError = ''
    try {
      await closeProject(p)
    } catch (e) {
      closeError = e.message || String(e)
    } finally {
      closingId = null
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <!-- G3-1: bento grid — 12 columns on desktop, 2 on tablet, 1 on
       mobile. DOM order is the mobile reading order (greeting,
       mentions, my tasks, progress, recent docs, activity, reminders,
       files, assistant, pulse); desktop placement is explicit
       lg:col-start/lg:col-span per card. -->
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12" data-home-bento>
  <!-- G2 — هیروی خانه: «سلام + کارهای امروز»؛ صحنهٔ آرام (سبک، کند)
       پشت کارت شیشه‌ای. حرکت نباید خواندن کارهای امروز را بگیرد. -->
  <section class="relative col-span-1 overflow-hidden rounded-3xl md:col-span-2 lg:col-span-12" data-home-hero data-home-card="greeting">
    <div class="relative h-60">
      {#await import('./HeroScene.svelte')}
        <div class="warm-mesh absolute inset-0"></div>
      {:then { default: HeroScene }}
        <HeroScene variant="home" onlineCount={onlineCount} />
      {:catch}
        <div class="warm-mesh absolute inset-0"></div>
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
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-5 lg:col-start-1" data-home-card="my-tasks">
    <h2 class="text-base font-bold">کارهای من</h2>
    {#if pulse.loading && !pulse.loaded}
      <p class="mt-2 text-sm opacity-70">در حال بارگذاری…</p>
    {:else if myTasks.length === 0}
      <p class="mt-2 text-sm opacity-70">کاری به تو سپرده نشده</p>
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
            <span class="min-w-0 flex-1 truncate {t.status === 'done' ? 'line-through opacity-60' : ''}">
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
  </section>

  <!-- Card 4: project progress — SVG ring from computeProjectReview -->
  <section class="glass-card col-span-1 p-4 md:col-span-1 lg:col-span-4 lg:col-start-6" data-home-card="progress">
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
              stroke="var(--amber-dark)"
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
            <span class="shrink-0 text-xs opacity-60">{memberName(d.created_by)}</span>
            <span class="shrink-0 text-xs opacity-60">{jalaliDayLabel(d.updated_at)}</span>
          </li>
        {/each}
      </ul>
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
            <a href={r.link} class="min-w-0 flex-1 truncate">{r.text}</a>
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

  <!-- Card 9: Muse assistant — the ONLY ai-accent card on the home page
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
          <polygon points={chart.messagesArea} fill="rgba(217,119,6,0.12)" />
          <polygon points={chart.doneArea} fill="rgba(21,128,61,0.10)" />
          <polyline
            points={chart.messagesPoints}
            fill="none"
            stroke="#d97706"
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
          <span><span class="inline-block h-2 w-4 bg-[#d97706]"></span> پیام‌ها</span>
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

  <!-- P01 A1: project creation form -->
  <section class="mt-6">
    <h2 class="mb-2 text-lg font-bold">ساختن پروژهٔ تازه</h2>
    <div class="card bg-base-200">
      <div class="card-body gap-2">
        <input
          class="input input-bordered input-sclack w-full bg-base-100"
          placeholder="نام پروژه *"
          bind:value={projName}
          disabled={creating}
        />
        <textarea
          class="textarea textarea-bordered input-sclack w-full bg-base-100"
          placeholder="توضیح (اختیاری)"
          bind:value={projDesc}
          disabled={creating}
        ></textarea>
        <input
          class="input input-bordered input-sclack w-full bg-base-100"
          placeholder="هدف پروژه *"
          bind:value={projGoal}
          disabled={creating}
        />
        <input
          class="input input-bordered input-sclack w-full bg-base-100"
          placeholder="خروجی نهایی"
          bind:value={projFinal}
          disabled={creating}
        />
        <label class="form-control w-full">
          <span class="label-text mb-1">مهلت *</span>
          <input
            type="date"
            class="input input-bordered input-sclack w-full bg-base-100"
            bind:value={projDeadline}
            disabled={creating}
          />
        </label>
        {#if ws.members.length > 0}
          <fieldset>
            <legend class="label-text mb-1">اعضا</legend>
            <div class="flex flex-wrap gap-3">
              {#each ws.members as m (m.id)}
                <label class="flex cursor-pointer items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-primary checkbox-sm"
                    checked={(projMembers || []).includes(m.id)}
                    onchange={(e) => toggleMember(m.id, e.target.checked)}
                    disabled={creating}
                  />
                  {m.name}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
        {#if createError}
          <p class="text-xs text-error">{createError}</p>
        {/if}
        <button
          class="btn btn-sclack btn-primary w-full"
          onclick={doCreateProject}
          disabled={creating}
        >
          ساختن پروژه
        </button>
        <p class="text-xs opacity-60">
          با ساخت هر پروژه، اتاق «گفت‌وگو» و سند «سند» خودشان ساخته می‌شوند. نام و هدف و مهلت اجباری‌اند.
        </p>
      </div>
    </div>
  </section>

  <section class="mt-8">
    <h2 class="mb-2 text-lg font-bold">پروژه‌ها</h2>
    {#if ws.loading}
      <p class="text-sm opacity-60">در حال بارگذاری…</p>
    {:else if ws.projects.length === 0}
      <p class="text-sm opacity-60">هنوز پروژه‌ای نیست — اولین پروژه را از فرم بالا بسازید.</p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each ws.projects as p (p.id)}
          <!-- G5 — کارت پروژه: شیشهٔ کم‌عمق + انیمیشن ورود (فقط transform/opacity) -->
          <div
            class="card glass-card anim-enter shadow-sm transition hover:shadow-md {editingProjectId === p.id
              ? 'project-editing'
              : ''} {editProjSavedId === p.id ? 'project-saved-flash' : ''}"
          >
            <div class="card-body gap-1">
              <button class="text-start" onclick={() => openProject(p)}>
                <h3 class="card-title text-base">{p.name}</h3>
                {#if p.description}
                  <p class="text-sm opacity-70">{p.description}</p>
                {:else}
                  <p class="text-sm opacity-50">بدون توضیح</p>
                {/if}
                {#if p.custom_fields?.goal}
                  <p class="text-sm"><span class="opacity-60">هدف: </span>{p.custom_fields.goal}</p>
                {/if}
                {#if p.custom_fields?.final_output}
                  <p class="text-sm"><span class="opacity-60">خروجی نهایی: </span>{p.custom_fields.final_output}</p>
                {/if}
                {#if p.custom_fields?.deadline}
                  <p class="text-sm"><span class="opacity-60">مهلت: </span>{fmtDate(p.custom_fields.deadline)}</p>
                {/if}
                {#if memberNames(p.custom_fields?.member_ids)}
                  <p class="text-sm"><span class="opacity-60">اعضا: </span>{memberNames(p.custom_fields.member_ids)}</p>
                {/if}
                <p class="text-sm"><span class="opacity-60">مرحله: </span>{stageLabel(p)}</p>
              </button>
              <div class="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  class="btn btn-ghost btn-sm project-edit-btn"
                  aria-label="ویرایش پروژهٔ {p.name}"
                  onclick={() => openProjectEdit(p)}
                  disabled={closingId === p.id}
                >
                  ویرایش پروژه
                </button>
                {#if auth.member && p.created_by === auth.member.id}
                  <button
                    class="btn btn-ghost btn-sm {armDeleteProjectId === p.id ? 'btn-error' : 'text-error'}"
                    title="حذف پروژه"
                    onclick={() => doDeleteProject(p)}
                    disabled={closingId === p.id}
                  >
                    {armDeleteProjectId === p.id ? 'مطمئنید؟ حذف پروژه' : 'حذف پروژه'}
                  </button>
                {/if}
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => doCloseProject(p)}
                  disabled={closingId === p.id}
                  title="بستن پروژه — به بایگانی می‌رود، پاک نمی‌شود"
                >
                  بستن پروژه
                </button>
              </div>
              {#if armDeleteProjectId === p.id}
                <p class="mt-1 text-xs text-error">
                  با تپ دوم، همهٔ اتاق‌ها، پیام‌ها، سندها، فایل‌ها و کارهای پروژه پاک می‌شوند و
                  برنمی‌گردند.
                </p>
              {/if}
              {#if editingProjectId === p.id}
                <!-- Phase 2 — edit form under the card, prefilled; save → updateProject -->
                <div class="project-edit-form mt-2 flex flex-col gap-2 border-t pt-2" data-edit-form={p.id}>
                  <input
                    class="input input-bordered input-sclack w-full bg-base-100"
                    placeholder="نام پروژه *"
                    bind:value={editProjName}
                    disabled={editProjBusy}
                  />
                  <textarea
                    class="textarea textarea-bordered input-sclack w-full bg-base-100"
                    placeholder="توضیح (اختیاری)"
                    bind:value={editProjDesc}
                    disabled={editProjBusy}
                  ></textarea>
                  <input
                    class="input input-bordered input-sclack w-full bg-base-100"
                    placeholder="هدف پروژه *"
                    bind:value={editProjGoal}
                    disabled={editProjBusy}
                  />
                  <input
                    class="input input-bordered input-sclack w-full bg-base-100"
                    placeholder="خروجی نهایی"
                    bind:value={editProjFinal}
                    disabled={editProjBusy}
                  />
                  <label class="form-control w-full">
                    <span class="label-text mb-1">مهلت *</span>
                    <input
                      type="date"
                      class="input input-bordered input-sclack w-full bg-base-100"
                      bind:value={editProjDeadline}
                      disabled={editProjBusy}
                    />
                  </label>
                  {#if editProjError}
                    <p class="text-xs text-error">{editProjError}</p>
                  {/if}
                  <div class="flex gap-2">
                    <button
                      class="btn btn-sclack btn-primary flex-1"
                      onclick={doSaveProjectEdit}
                      disabled={editProjBusy}
                    >
                      ذخیرهٔ تغییرات
                    </button>
                    <button class="btn btn-ghost" onclick={cancelProjectEdit} disabled={editProjBusy}>
                      انصراف
                    </button>
                  </div>
                  <p class="text-xs opacity-60">
                    مرحله و اعضا با ویرایش عوض نمی‌شوند؛ بستن و حذف پروژه دست نمی‌خورند.
                  </p>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if closeError}
        <p class="mt-2 text-xs text-error">{closeError}</p>
      {/if}
      {#if deleteError}
        <p class="mt-2 text-xs text-error">{deleteError}</p>
      {/if}
    {/if}
  </section>

  <!-- P01 A5: archived (closed) projects -->
  {#if ws.archivedProjects.length > 0}
    <section class="mt-8">
      <h2 class="mb-2 text-lg font-bold">بایگانی‌شده</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each ws.archivedProjects as p (p.id)}
          <div class="card glass-card opacity-80 shadow-sm">
            <div class="card-body gap-1">
              <button class="text-start" onclick={() => openProject(p)}>
                <h3 class="card-title text-base">{p.name}</h3>
                {#if p.description}
                  <p class="text-sm opacity-70">{p.description}</p>
                {/if}
                {#if p.custom_fields?.goal}
                  <p class="text-sm"><span class="opacity-60">هدف: </span>{p.custom_fields.goal}</p>
                {/if}
                {#if p.custom_fields?.final_output}
                  <p class="text-sm"><span class="opacity-60">خروجی نهایی: </span>{p.custom_fields.final_output}</p>
                {/if}
                {#if p.custom_fields?.deadline}
                  <p class="text-sm"><span class="opacity-60">مهلت: </span>{fmtDate(p.custom_fields.deadline)}</p>
                {/if}
                {#if memberNames(p.custom_fields?.member_ids)}
                  <p class="text-sm"><span class="opacity-60">اعضا: </span>{memberNames(p.custom_fields.member_ids)}</p>
                {/if}
                <p class="text-sm"><span class="opacity-60">مرحله: </span>{stageLabel(p)}</p>
                {#if p.custom_fields?.closed_at}
                  <p class="text-sm"><span class="opacity-60">بسته‌شده در: </span>{fmtDate(p.custom_fields.closed_at)}</p>
                {/if}
              </button>
              {#if auth.member && p.created_by === auth.member.id}
                <div class="mt-2 flex justify-end">
                  <button
                    class="btn btn-ghost btn-sm {armDeleteProjectId === p.id ? 'btn-error' : 'text-error'}"
                    title="حذف پروژه"
                    onclick={() => doDeleteProject(p)}
                  >
                    {armDeleteProjectId === p.id ? 'مطمئنید؟ حذف پروژه' : 'حذف پروژه'}
                  </button>
                </div>
                {#if armDeleteProjectId === p.id}
                  <p class="mt-1 text-xs text-error">
                    با تپ دوم، همهٔ اتاق‌ها، پیام‌ها، سندها، فایل‌ها و کارهای پروژه پاک می‌شوند و
                    برنمی‌گردند.
                  </p>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if deleteError}
        <p class="mt-2 text-xs text-error">{deleteError}</p>
      {/if}
      <p class="mt-2 text-xs opacity-60">بستن پروژه چیزی را پاک نمی‌کند؛ برای پاک‌کردن کامل، دکمهٔ «حذف پروژه» روی کارت سازندهٔ پروژه است.</p>
    </section>
  {/if}

  <!-- P01 A4: review of the current project -->
  {#if ws.currentProjectId}
    <ProjectReview tasks={ws.tasks} docs={ws.docs} files={ws.files} />
  {/if}

  <section class="mt-8">
    <h2 class="mb-2 text-lg font-bold">اتاق‌های پروژهٔ جاری</h2>
    {#if ws.rooms.length === 0}
      <p class="text-sm opacity-60">اتاقی نیست — اول یک پروژه بسازید یا انتخاب کنید.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.rooms as r (r.id)}
          <li>
            <a href="#/room/{r.id}" class="btn btn-ghost w-full justify-start">{r.name}</a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="mt-8">
    <h2 class="mb-2 text-lg font-bold">سندهای پروژهٔ جاری</h2>
    {#if !ws.currentProjectId}
      <p class="text-sm opacity-60">اول یک پروژه بسازید یا انتخاب کنید.</p>
    {:else if ws.docs.length === 0}
      <p class="text-sm opacity-60">سندی نیست.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.docs as d (d.id)}
          <li>
            <a href="#/doc/{d.id}" class="btn btn-ghost w-full justify-start">{d.title}</a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if ws.currentProjectId}
    <section class="mt-8">
      <h2 class="mb-2 text-lg font-bold">فایل‌های پروژهٔ جاری</h2>
      <FileList projectId={ws.currentProjectId} />
    </section>
  {/if}
</div>
