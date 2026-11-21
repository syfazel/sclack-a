<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { createProject, loadRooms } from '../lib/data.js'
  import { loadDocs } from '../lib/docs.js'
  import { loadTasks } from '../lib/work.js'
  import FileList from './FileList.svelte'

  let newProjectName = $state('')
  let createError = $state('')
  let creating = $state(false)

  async function openProject(p) {
    ws.currentProjectId = p.id
    await loadRooms(p.id)
    await loadDocs(p.id)
    await loadTasks(p.id)
    if (ws.rooms.length > 0) location.hash = '#/room/' + ws.rooms[0].id
  }

  async function doCreateProject() {
    if (creating) return
    creating = true
    createError = ''
    try {
      const { room } = await createProject(newProjectName)
      newProjectName = ''
      location.hash = '#/room/' + room.id
    } catch (e) {
      createError = e.message || String(e)
    } finally {
      creating = false
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <h1 class="text-2xl font-bold">سلام{auth.member ? ' ' + auth.member.name : ''}</h1>
  <p class="mt-1 text-sm opacity-70">به فضای کاری sclack_A خوش آمدید.</p>

  {#if ws.error}
    <div class="alert alert-error mt-4"><span>{ws.error}</span></div>
  {/if}

  <section class="mt-6">
    <h2 class="mb-2 text-lg font-bold">پروژه‌ها</h2>
    {#if ws.loading}
      <p class="text-sm opacity-60">در حال بارگذاری…</p>
    {:else if ws.projects.length === 0}
      <div class="card bg-base-200">
        <div class="card-body">
          <p class="font-medium">هنوز پروژه‌ای نیست</p>
          <p class="text-sm opacity-70">
            اولین پروژه را با یک نام بسازید؛ اتاق «گفت‌وگو» و سند «سند» خودشان ساخته می‌شوند.
          </p>
          <div class="mt-3 flex gap-2">
            <input
              class="input input-bordered input-sclack min-w-0 flex-1 bg-base-100"
              placeholder="نام پروژهٔ تازه"
              bind:value={newProjectName}
              onkeydown={(e) => {
                if (e.key === 'Enter') doCreateProject()
              }}
            />
            <button class="btn btn-sclack btn-primary" onclick={doCreateProject} disabled={creating}>
              ساختن پروژه
            </button>
          </div>
          {#if createError}
            <p class="mt-2 text-xs text-error">{createError}</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each ws.projects as p (p.id)}
          <button
            class="card bg-base-200 text-start shadow-sm transition hover:shadow-md"
            onclick={() => openProject(p)}
          >
            <div class="card-body">
              <h3 class="card-title text-base">{p.name}</h3>
              {#if p.description}
                <p class="text-sm opacity-70">{p.description}</p>
              {:else}
                <p class="text-sm opacity-50">بدون توضیح</p>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

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
