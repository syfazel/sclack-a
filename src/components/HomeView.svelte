<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { createProject, closeProject, loadProjectData } from '../lib/data.js'
  import {
    PROJECT_STAGE_LABEL,
    endOfTehranDay,
    plannerMenuTasks,
    isOverdueTask
  } from '../lib/extract.js'
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
  <!-- G2 — هیروی خانه: «سلام + کارهای امروز»؛ صحنهٔ آرام (سبک، کند)
       پشت کارت شیشه‌ای. حرکت نباید خواندن کارهای امروز را بگیرد. -->
  <section class="relative overflow-hidden rounded-3xl" data-home-hero>
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
          <h1 class="text-2xl font-bold">سلام{auth.member ? ' ' + auth.member.name : ''}</h1>
          <p class="mt-2 flex items-baseline gap-4 text-sm">
            <span>
              <span class="text-2xl font-bold">{todayCount}</span> کار امروز
            </span>
            <span>
              <span class="text-2xl font-bold {overdueCount > 0 ? 'text-error' : ''}">
                {overdueCount}
              </span>
              عقب‌مانده
            </span>
          </p>
          <p class="mt-1 text-xs opacity-70">به فضای کاری sclack_A خوش آمدید.</p>
        </div>
      </div>
    </div>
  </section>

  {#if ws.error}
    <div class="alert alert-error mt-4"><span>{ws.error}</span></div>
  {/if}

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
          <div class="card glass-card anim-enter shadow-sm transition hover:shadow-md">
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
              <div class="mt-2 flex justify-end">
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => doCloseProject(p)}
                  disabled={closingId === p.id}
                  title="بستن پروژه — به بایگانی می‌رود، پاک نمی‌شود"
                >
                  بستن پروژه
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
      {#if closeError}
        <p class="mt-2 text-xs text-error">{closeError}</p>
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
            </div>
          </div>
        {/each}
      </div>
      <p class="mt-2 text-xs opacity-60">پروژه‌های بایگانی‌شده پاک نمی‌شوند؛ سند و فایل و کارهایشان خواندنی می‌مانند.</p>
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
