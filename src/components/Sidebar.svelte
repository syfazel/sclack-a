<script>
  import { auth, ws, chat, notif, displayPrefs } from '../lib/store.svelte.js'
  import { loadProjectData } from '../lib/data.js'
  import { createDoc } from '../lib/docs.js'
  import { signOut, validateChangePassword, changePassword } from '../lib/auth.js'
  import { toggleSimpleMode } from '../lib/display-prefs.js'
  import SearchBox from './SearchBox.svelte'
  import LogoMark from './LogoMark.svelte'

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
    await loadProjectData(id)
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

</script>

<!-- G4 — سایدبار: شیشهٔ سبک، فقط کروم -->
<aside class="glass-chrome flex h-full w-[72px] flex-col gap-4 overflow-y-auto p-2 lg:w-[264px] lg:p-4" data-sidebar>
  <a href="#/" class="flex items-center justify-center gap-2 lg:justify-start">
    <LogoMark class="h-6 w-10 lg:h-7 lg:w-14" />
    <span class="hidden text-xl font-bold lg:inline">sclack_A</span>
  </a>

  <div class="hidden lg:block"><SearchBox /></div>

  <section>
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">دستیار میوز</h2>
    <a href="#/assistant" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" /></svg>
      <span class="hidden lg:inline">دستیار میوز — خلاصه و پیشنهاد</span>
    </a>
    <p class="mt-1 hidden text-xs opacity-50 lg:block">فقط استخراجی؛ جمله‌ای ساخته نمی‌شود.</p>
  </section>

  <section>
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">صفحه‌ها</h2>
    <!-- D6 bug 6: the mobile bottom nav is the only tasks entry point and
         it is hidden at md and up, so at 768px and wider the tasks page
         was unreachable from the UI. These links cover every width. -->
    <a href="#/tasks" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
      <span class="hidden lg:inline">کارها</span>
    </a>
    <a href="#/members" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      <span class="hidden lg:inline">اعضا</span>
    </a>
    <a href="#/notifications" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      <span class="hidden lg:inline">اعلان‌ها</span>
      {#if notif.unreadCount > 0}
        <span class="badge badge-warning badge-sm" data-unread-badge>{notif.unreadCount}</span>
      {/if}
    </a>
  </section>

  <section>
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">پروژه‌ها</h2>
    {#if ws.loading}
      <p class="text-sm opacity-60">در حال بارگذاری…</p>
    {:else if ws.projects.length === 0}
      <p class="text-sm opacity-60">هنوز پروژه‌ای نیست.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.projects as p (p.id)}
          <li>
            <button
              class="btn btn-ghost btn-sm w-full justify-start px-2 {ws.currentProjectId === p.id
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
    <!-- P01 A1: no name-only quick create here — a project is created
         from the full form on the home page (name, goal and deadline
         are required), so the sidebar only links to it. -->
    <div class="mt-2">
      <a href="#/" class="btn btn-sclack btn-sm btn-primary w-full">ساختن پروژهٔ تازه</a>
    </div>
  </section>

  <section>
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">اتاق‌ها</h2>
    {#if ws.rooms.length === 0}
      <p class="text-sm opacity-60">اتاقی نیست — اول یک پروژه بسازید.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each ws.rooms as r (r.id)}
          <li>
            <a
              href="#/room/{r.id}"
              class="btn btn-ghost btn-sm w-full justify-start px-2 {ws.currentRoomId === r.id
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
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">سندها</h2>
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
              class="btn btn-ghost btn-sm w-full justify-start px-2"
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
    <h2 class="mb-2 hidden text-sm font-bold opacity-70 lg:block">اعضا</h2>
    <ul class="flex flex-col gap-1">
      {#each seats as m, i}
        <li class="flex items-center justify-center gap-2 rounded-xl bg-base-100 px-3 py-2 text-sm lg:justify-start">
          <span
            class="inline-block h-2.5 w-2.5 rounded-full {m && isOnline(m.id)
              ? 'bg-success'
              : 'bg-base-300'}"
          ></span>
          {#if m}
            <span class="hidden font-medium lg:inline">{m.name}</span>
            {#if auth.member && m.id === auth.member.id}
              <span class="hidden text-xs opacity-60 lg:inline">(شما)</span>
            {/if}
          {:else}
            <span class="hidden opacity-50 lg:inline">جای خالی {i + 1}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="hidden lg:block">
    <button
      class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2"
      onclick={() => (showChange = !showChange)}
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      <span class="hidden lg:inline">تغییر رمز</span>
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
    <!-- G8/R3 — «حالت ساده»: شیشه به مات برمی‌گردد و صحنهٔ سه‌بعدی خاموش می‌شود -->
    <button
      class="btn btn-sclack btn-ghost btn-sm mb-2 w-full justify-center px-0 lg:justify-start lg:px-2"
      onclick={toggleSimpleMode}
      title="شیشه را مات و صحنهٔ سه‌بعدی را خاموش می‌کند"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      <span class="hidden lg:inline">{displayPrefs.simple ? 'حالت گرافیکی' : 'حالت ساده'}</span>
    </button>
    <button class="btn btn-sclack btn-outline btn-sm w-full justify-center px-0 lg:justify-start lg:px-2" onclick={signOut}>
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
      <span class="hidden lg:inline">خروج از حساب</span>
    </button>
    <p class="mt-2 hidden text-center text-xs opacity-50 lg:block">sclack_A — اسکلت + چت + سند و فایل + کار و حافظه + دستیار (D5) + گرافیک (P01 بخش ۵)</p>
  </div>
</aside>
