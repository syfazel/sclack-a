<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { createProject, loadRooms } from '../lib/data.js'
  import { loadDocs, createDoc } from '../lib/docs.js'
  import { signOut, validateChangePassword, changePassword } from '../lib/auth.js'

  let newProjectName = $state('')
  let createError = $state('')
  let creating = $state(false)

  let newDocTitle = $state('')
  let docError = $state('')
  let creatingDoc = $state(false)

  let showChange = $state(false)
  let currentPw = $state('')
  let newPw = $state('')
  let confirmPw = $state('')
  let changeMsg = $state('')
  let changeMsgKind = $state('')
  let changing = $state(false)

  async function doChangePassword() {
    if (changing) return
    const bad = validateChangePassword(currentPw, newPw, confirmPw)
    if (bad) {
      changeMsg = bad
      changeMsgKind = 'error'
      return
    }
    const email = auth.user?.email
    if (!email) {
      changeMsg = 'نشست شما پیدا نشد؛ دوباره وارد شوید.'
      changeMsgKind = 'error'
      return
    }
    changing = true
    changeMsg = 'در حال تغییر رمز…'
    changeMsgKind = ''
    const res = await changePassword(email, currentPw, newPw)
    changeMsg = res.text
    changeMsgKind = res.kind
    if (res.ok) {
      currentPw = ''
      newPw = ''
      confirmPw = ''
    }
    changing = false
  }

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
    await loadDocs(id)
    if (ws.rooms.length > 0) {
      location.hash = '#/room/' + ws.rooms[0].id
    } else {
      location.hash = '#/'
    }
  }

  async function doCreateDoc() {
    if (creatingDoc || !ws.currentProjectId) return
    creatingDoc = true
    docError = ''
    try {
      const doc = await createDoc(ws.currentProjectId, newDocTitle)
      newDocTitle = ''
      location.hash = '#/doc/' + doc.id
    } catch (e) {
      docError = e.message || String(e)
    } finally {
      creatingDoc = false
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
    <h2 class="mb-2 text-sm font-bold opacity-70">سندها</h2>
    {#if !ws.currentProjectId}
      <p class="text-sm opacity-60">اول یک پروژه انتخاب کنید.</p>
    {:else if ws.docs.length === 0}
      <p class="text-sm opacity-60">سندی نیست.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.docs as d (d.id)}
          <li>
            <a
              href="#/doc/{d.id}"
              class="btn btn-ghost btn-sm w-full justify-start"
            >
              {d.title}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
    {#if ws.currentProjectId}
      <div class="mt-2 flex gap-2">
        <input
          class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
          placeholder="نام سند تازه"
          bind:value={newDocTitle}
          onkeydown={(e) => {
            if (e.key === 'Enter') doCreateDoc()
          }}
        />
        <button class="btn btn-sclack btn-sm btn-primary" onclick={doCreateDoc} disabled={creatingDoc}>
          ساختن
        </button>
      </div>
      {#if docError}
        <p class="mt-1 text-xs text-error">{docError}</p>
      {/if}
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

  <section>
    <button
      class="btn btn-ghost btn-sm w-full justify-start"
      onclick={() => (showChange = !showChange)}
    >
      تغییر رمز
    </button>
    {#if showChange}
      <div class="mt-2 flex flex-col gap-2">
        <label class="form-control w-full">
          <span class="label-text mb-1">رمز فعلی</span>
          <input
            type="password"
            class="input input-sclack input-bordered w-full bg-base-100"
            placeholder="••••••••"
            bind:value={currentPw}
            disabled={changing}
            dir="ltr"
          />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1">رمز تازه</span>
          <input
            type="password"
            class="input input-sclack input-bordered w-full bg-base-100"
            placeholder="••••••••"
            bind:value={newPw}
            disabled={changing}
            dir="ltr"
          />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1">تکرار رمز تازه</span>
          <input
            type="password"
            class="input input-sclack input-bordered w-full bg-base-100"
            placeholder="••••••••"
            bind:value={confirmPw}
            disabled={changing}
            dir="ltr"
            onkeydown={(e) => {
              if (e.key === 'Enter') doChangePassword()
            }}
          />
        </label>
        {#if changeMsg}
          <p
            class="text-xs {changeMsgKind === 'error'
              ? 'text-error'
              : changeMsgKind === 'ok'
                ? 'text-success'
                : 'opacity-70'}"
          >
            {changeMsg}
          </p>
        {/if}
        <button
          class="btn btn-sclack btn-primary w-full"
          onclick={doChangePassword}
          disabled={changing}
        >
          {changing ? '…' : 'ذخیرهٔ رمز تازه'}
        </button>
      </div>
    {/if}
  </section>

  <div class="mt-auto">
    {#if auth.memberError}
      <p class="mb-2 text-xs text-error">ساخت ردیف عضو ناموفق بود: {auth.memberError}</p>
    {/if}
    <button class="btn btn-sclack btn-outline btn-sm w-full" onclick={signOut}>خروج از حساب</button>
    <p class="mt-2 text-center text-xs opacity-50">sclack_A — اسکلت + چت + سند و فایل (D4)</p>
  </div>
</aside>
