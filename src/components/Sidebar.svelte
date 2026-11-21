<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { createProject, loadRooms } from '../lib/data.js'
  import { signOut } from '../lib/auth.js'

  let newProjectName = $state('')
  let createError = $state('')
  let creating = $state(false)

  const seats = $derived.by(() => {
    const list = [...ws.members].slice(0, 4)
    while (list.length < 4) list.push(null)
    return list
  })

  function isOnline(memberId) {
    return chat.presence.some((p) => p.memberId === memberId)
  }

  async function selectProject(id) {
    ws.currentProjectId = id
    ws.currentRoomId = null
    await loadRooms(id)
    if (ws.rooms.length > 0) {
      location.hash = '#/room/' + ws.rooms[0].id
    } else {
      location.hash = '#/'
    }
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

<aside class="flex h-full w-64 flex-col gap-4 overflow-y-auto bg-base-200 p-4">
  <a href="#/" class="flex items-center gap-2">
    <svg viewBox="0 0 64 32" class="h-7 w-14" aria-hidden="true">
      <path
        d="M8 25 C 20 25, 22 7, 32 7 S 44 25, 56 25"
        fill="none"
        stroke="#E8B48A"
        stroke-width="3"
        stroke-linecap="round"
      />
      <circle cx="8" cy="25" r="5.5" fill="#D97706" />
      <circle cx="25" cy="11" r="5.5" fill="#E07830" />
      <circle cx="40" cy="21" r="5.5" fill="#F0705A" />
      <circle cx="56" cy="25" r="5.5" fill="#F97066" />
    </svg>
    <span class="text-xl font-bold">sclack_A</span>
  </a>

  <section>
    <h2 class="mb-2 text-sm font-bold opacity-70">پروژه‌ها</h2>
    {#if ws.loading}
      <p class="text-sm opacity-60">در حال بارگذاری…</p>
    {:else if ws.projects.length === 0}
      <p class="text-sm opacity-60">هنوز پروژه‌ای نیست.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.projects as p (p.id)}
          <li>
            <button
              class="btn btn-ghost btn-sm w-full justify-start {ws.currentProjectId === p.id
                ? 'btn-active'
                : ''}"
              onclick={() => selectProject(p.id)}
            >
              {p.name}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="mt-2 flex gap-2">
      <input
        class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
        placeholder="نام پروژهٔ تازه"
        bind:value={newProjectName}
        onkeydown={(e) => {
          if (e.key === 'Enter') doCreateProject()
        }}
      />
      <button class="btn btn-sclack btn-sm btn-primary" onclick={doCreateProject} disabled={creating}>
        ساختن
      </button>
    </div>
    {#if createError}
      <p class="mt-1 text-xs text-error">{createError}</p>
    {/if}
  </section>

  <section>
    <h2 class="mb-2 text-sm font-bold opacity-70">اتاق‌ها</h2>
    {#if ws.rooms.length === 0}
      <p class="text-sm opacity-60">اتاقی نیست — اول یک پروژه بسازید.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.rooms as r (r.id)}
          <li>
            <a
              href="#/room/{r.id}"
              class="btn btn-ghost btn-sm w-full justify-start {ws.currentRoomId === r.id
                ? 'btn-active'
                : ''}"
              onclick={() => {
                ws.currentRoomId = r.id
              }}
            >
              {r.name}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2 class="mb-2 text-sm font-bold opacity-70">اعضا</h2>
    <ul class="flex flex-col gap-1">
      {#each seats as m, i}
        <li class="flex items-center gap-2 rounded-xl bg-base-100 px-3 py-2 text-sm">
          <span
            class="inline-block h-2.5 w-2.5 rounded-full {m && isOnline(m.id)
              ? 'bg-success'
              : 'bg-base-300'}"
          ></span>
          {#if m}
            <span class="font-medium">{m.name}</span>
            {#if auth.member && m.id === auth.member.id}
              <span class="text-xs opacity-60">(شما)</span>
            {/if}
          {:else}
            <span class="opacity-50">جای خالی {i + 1}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <div class="mt-auto">
    {#if auth.memberError}
      <p class="mb-2 text-xs text-error">ساخت ردیف عضو ناموفق بود: {auth.memberError}</p>
    {/if}
    <button class="btn btn-sclack btn-outline btn-sm w-full" onclick={signOut}>خروج از حساب</button>
    <p class="mt-2 text-center text-xs opacity-50">sclack_A — اسکلت + چت (D3)</p>
  </div>
</aside>
