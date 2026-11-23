<script>
  import { onMount } from 'svelte'
  import { auth, ws, chat, notif, displayPrefs } from '../lib/store.svelte.js'
  import { loadProjectData } from '../lib/data.js'
  import { createDoc, createPrivateDoc, loadPrivateDocs } from '../lib/docs.js'
  import { buildDocTree } from '../lib/extract.js'
  import { signOut, validateChangePassword, changePassword } from '../lib/auth.js'
  import { toggleSimpleMode } from '../lib/display-prefs.js'
  import { isStarred, toggleStarred, starredItems } from '../lib/starred.js'
  import { openDocTab } from '../lib/tabs.js'
  import SearchBox from './SearchBox.svelte'
  import LogoMark from './LogoMark.svelte'

  let newDocTitle = $state('')
  let docError = $state('')
  let creatingDoc = $state(false)

  let newPrivateTitle = $state('')
  let privateError = $state('')
  let creatingPrivate = $state(false)

  let starError = $state('')

  let showChange = $state(false)
  let currentPw = $state('')
  let newPw = $state('')
  let confirmPw = $state('')
  let changeMsg = $state('')
  let changeMsgKind = $state('')
  let changing = $state(false)

  // بخش‌های جمع‌شدهٔ سایدبار (فقط وضعیت محلی).
  let collapsedSections = $state(new Set())
  function toggleSection(name) {
    const next = new Set(collapsedSections)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    collapsedSections = next
  }

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

  // Phase 5 (D4): the docs list is a tree. Roots in loadDocs order
  // (created_at); a collapsed parent hides its whole subtree.
  // یادداشت‌های خصوصی (visibility='personal') در درخت پروژه نیستند —
  // فقط در بخش خصوصی می‌آیند.
  const projectDocs = $derived((ws.docs || []).filter((d) => d.visibility !== 'personal'))
  const docTree = $derived(buildDocTree(projectDocs))
  let collapsedDocIds = $state(new Set())

  function toggleDocNode(id) {
    const next = new Set(collapsedDocIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsedDocIds = next
  }

  const favorites = $derived(starredItems())
  const openTaskCount = $derived((ws.tasks || []).filter((t) => t.status !== 'done').length)

  async function doToggleStar(table, row) {
    starError = ''
    try {
      await toggleStarred(table, row)
    } catch (e) {
      starError = e.message || String(e)
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

  async function doCreatePrivate() {
    if (creatingPrivate) return
    if (!ws.currentProjectId) {
      privateError = 'اول یک پروژه انتخاب کنید.'
      return
    }
    creatingPrivate = true
    privateError = ''
    try {
      const doc = await createPrivateDoc(ws.currentProjectId, newPrivateTitle)
      newPrivateTitle = ''
      location.hash = '#/doc/' + doc.id
    } catch (e) {
      privateError = e.message || String(e)
    } finally {
      creatingPrivate = false
    }
  }

  // Ctrl+کلیک روی سند: بازکردن در تب تازه (D-UX6).
  function openDocLink(e, node) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      openDocTab(node.id, node.title)
      location.hash = '#/doc/' + node.id
    }
  }

  onMount(() => {
    loadPrivateDocs()
  })
</script>

<!-- سایدبار دسته‌بندی‌شده — ۷ بخش (D-UX5 الف): شیشهٔ ملایم روی مش -->
<aside class="glass-mild flex h-full w-[72px] flex-col gap-4 overflow-y-auto p-2 lg:w-[264px] lg:p-4" data-sidebar>
  <a href="#/" class="flex items-center justify-center gap-2 lg:justify-start">
    <LogoMark class="h-6 w-10 lg:h-7 lg:w-14" />
    <span class="hidden text-xl font-bold lg:inline">sclack_A</span>
  </a>

  <!-- ۱ — جست‌وجو (بالا) -->
  <section data-sidebar-section="search">
    <div class="hidden lg:block"><SearchBox /></div>
  </section>

  <!-- ۲ — علاقه‌مندی‌ها: فقط وقتی ظاهر می‌شود که اولین مورد ستاره بخورد -->
  {#if favorites.length > 0}
    <section data-sidebar-section="favorites">
      <button
        type="button"
        class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
        aria-expanded={!collapsedSections.has('favorites')}
        onclick={() => toggleSection('favorites')}
      >
        علاقه‌مندی‌ها
      </button>
      {#if !collapsedSections.has('favorites')}
        <ul class="flex flex-col gap-1">
          {#each favorites as f (f.kind + '-' + f.id)}
            <li class="flex items-center gap-1">
              {#if f.link}
                <a
                  href={f.link}
                  class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start px-2"
                  onclick={(e) => {
                    if (f.kind === 'doc' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      openDocTab(f.id, f.title)
                      location.hash = f.link
                    }
                  }}
                >
                  <span class="truncate">★ {f.title}</span>
                </a>
              {:else}
                <button
                  class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start px-2"
                  onclick={() => selectProject(f.id)}
                >
                  <span class="truncate">★ {f.title}</span>
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0 px-1 text-jigari"
                aria-label="برداشتن «{f.title}» از علاقه‌مندی‌ها"
                onclick={() => {
                  const table = f.kind === 'doc' ? 'docs' : f.kind === 'room' ? 'rooms' : 'projects'
                  const row =
                    f.kind === 'doc'
                      ? (ws.docs || []).concat(ws.privateDocs || []).find((d) => d.id === f.id)
                      : f.kind === 'room'
                        ? (ws.rooms || []).find((r) => r.id === f.id)
                        : (ws.projects || []).find((p) => p.id === f.id)
                  if (row) doToggleStar(table, row)
                }}
              >
                ★
              </button>
            </li>
          {/each}
        </ul>
        {#if starError}
          <p class="mt-1 text-xs text-error">{starError}</p>
        {/if}
      {/if}
    </section>
  {/if}

  <!-- ۳ — خصوصی: یادداشت‌های خصوصیِ فقط خودم (RLS: visibility='personal') -->
  <section data-sidebar-section="private">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('private')}
      onclick={() => toggleSection('private')}
    >
      خصوصی
    </button>
    {#if !collapsedSections.has('private')}
      {#if (ws.privateDocs || []).length === 0}
        <p class="hidden text-sm opacity-60 lg:block">یادداشت خصوصی نیست — از همین‌جا بسازید.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each ws.privateDocs as d (d.id)}
            <li>
              <a
                href="#/doc/{d.id}"
                class="btn btn-ghost btn-sm w-full justify-start px-2"
                onclick={(e) => openDocLink(e, d)}
              >
                <span class="truncate">{d.title}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
      {#if ws.currentProjectId}
        <div class="mt-2 hidden gap-2 lg:flex">
          <input
            class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
            placeholder="نام یادداشت خصوصی"
            bind:value={newPrivateTitle}
            onkeydown={(e) => {
              if (e.key === 'Enter') doCreatePrivate()
            }}
          />
          <button class="btn btn-sclack btn-sm btn-primary" onclick={doCreatePrivate} disabled={creatingPrivate}>
            ساختن
          </button>
        </div>
        {#if privateError}
          <p class="mt-1 hidden text-xs text-error lg:block">{privateError}</p>
        {/if}
      {:else}
        <p class="mt-1 hidden text-xs opacity-60 lg:block">برای ساختن یادداشت خصوصی اول یک پروژه انتخاب کنید.</p>
      {/if}
    {/if}
  </section>

  <!-- ۴ — پروژه‌ها -->
  <section data-sidebar-section="projects">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('projects')}
      onclick={() => toggleSection('projects')}
    >
      پروژه‌ها
    </button>
    {#if !collapsedSections.has('projects')}
      {#if ws.loading}
        <p class="text-sm opacity-60">در حال بارگذاری…</p>
      {:else if ws.projects.length === 0}
        <p class="text-sm opacity-60">هنوز پروژه‌ای نیست.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each ws.projects as p (p.id)}
            <li class="flex items-center gap-1">
              <button
                class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start px-2 {ws.currentProjectId === p.id
                  ? 'bg-jigari-soft font-bold text-jigari'
                  : ''}"
                onclick={() => selectProject(p.id)}
              >
                <span class="truncate">{p.name}</span>
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0 px-1 {isStarred(p) ? 'text-jigari' : 'opacity-40'}"
                aria-label={isStarred(p)
                  ? 'برداشتن «' + p.name + '» از علاقه‌مندی‌ها'
                  : 'افزودن «' + p.name + '» به علاقه‌مندی‌ها'}
                aria-pressed={isStarred(p)}
                onclick={() => doToggleStar('projects', p)}
              >
                {isStarred(p) ? '★' : '☆'}
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
    {/if}
  </section>

  <!-- اتاق‌ها — زیر پروژه‌ها (بخش جدا نیست؛ اتاق‌ها زیرمجموعهٔ پروژه‌اند) -->
  <section data-sidebar-section="rooms">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('rooms')}
      onclick={() => toggleSection('rooms')}
    >
      اتاق‌ها
    </button>
    {#if !collapsedSections.has('rooms')}
      {#if ws.rooms.length === 0}
        <p class="text-sm opacity-60">اتاقی نیست — اول یک پروژه بسازید.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each ws.rooms as r (r.id)}
            <li class="flex items-center gap-1">
              <a
                href="#/room/{r.id}"
                class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start px-2 {ws.currentRoomId === r.id
                  ? 'bg-jigari-soft font-bold text-jigari'
                  : ''}"
                onclick={() => {
                  ws.currentRoomId = r.id
                }}
              >
                <span class="truncate">{r.name}</span>
              </a>
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0 px-1 {isStarred(r) ? 'text-jigari' : 'opacity-40'}"
                aria-label={isStarred(r)
                  ? 'برداشتن «' + r.name + '» از علاقه‌مندی‌ها'
                  : 'افزودن «' + r.name + '» به علاقه‌مندی‌ها'}
                aria-pressed={isStarred(r)}
                onclick={() => doToggleStar('rooms', r)}
              >
                {isStarred(r) ? '★' : '☆'}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ۵ — سندها (درخت تودرتو، فاز ۵) -->
  <section data-sidebar-section="docs">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('docs')}
      onclick={() => toggleSection('docs')}
    >
      سندها
    </button>
    {#if !collapsedSections.has('docs')}
      {#if !ws.currentProjectId}
        <p class="text-sm opacity-60">اول یک پروژه انتخاب کنید.</p>
      {:else if docTree.length === 0}
        <p class="text-sm opacity-60">سندی نیست.</p>
      {:else}
        <!-- Phase 5: nested tree — children under their parent, with a
             collapse toggle and a child-count badge on parents. -->
        {#snippet docNode(node)}
          <li data-doc-node={node.id}>
            <div class="flex items-center gap-1">
              {#if node.children.length > 0}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs doc-tree-toggle shrink-0 px-1"
                  data-doc-toggle={node.id}
                  aria-expanded={!collapsedDocIds.has(node.id)}
                  aria-label={collapsedDocIds.has(node.id)
                    ? 'باز کردن زیرسندهای «' + node.title + '»'
                    : 'جمع کردن زیرسندهای «' + node.title + '»'}
                  onclick={() => toggleDocNode(node.id)}
                >
                  {collapsedDocIds.has(node.id) ? '‹' : '▾'}
                </button>
              {:else}
                <span class="w-6 shrink-0" aria-hidden="true"></span>
              {/if}
              <a
                href="#/doc/{node.id}"
                class="btn btn-ghost btn-sm min-w-0 flex-1 justify-start px-2"
                onclick={(e) => openDocLink(e, node)}
              >
                <span class="truncate">{node.title}</span>
                {#if node.children.length > 0}
                  <span class="badge badge-sm doc-tree-count" data-doc-child-count={node.id}>
                    {node.children.length}
                  </span>
                {/if}
              </a>
            </div>
            {#if node.children.length > 0 && !collapsedDocIds.has(node.id)}
              <ul class="doc-tree-children flex flex-col gap-1">
                {#each node.children as child (child.id)}
                  {@render docNode(child)}
                {/each}
              </ul>
            {/if}
          </li>
        {/snippet}
        <ul class="flex flex-col gap-1" data-doc-tree>
          {#each docTree as root (root.id)}
            {@render docNode(root)}
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
    {/if}
  </section>

  <!-- ۶ — کارها -->
  <section data-sidebar-section="tasks">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('tasks')}
      onclick={() => toggleSection('tasks')}
    >
      کارها
    </button>
    {#if !collapsedSections.has('tasks')}
      <a href="#/tasks" class="btn btn-ghost btn-sm w-full justify-start px-2">
        <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        <span class="hidden lg:inline">همهٔ کارها</span>
        {#if openTaskCount > 0}
          <span class="badge badge-sm doc-tree-count" data-open-task-count>{openTaskCount}</span>
        {/if}
      </a>
    {/if}
  </section>

  <!-- ۷ — اعضا -->
  <section data-sidebar-section="members">
    <button
      type="button"
      class="mb-1 hidden w-full text-start text-xs font-bold text-ink-soft lg:block"
      aria-expanded={!collapsedSections.has('members')}
      onclick={() => toggleSection('members')}
    >
      اعضا
    </button>
    {#if !collapsedSections.has('members')}
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
      <a href="#/members" class="btn btn-ghost btn-sm mt-1 w-full justify-start px-2">
        <span class="hidden lg:inline">همهٔ اعضا</span>
      </a>
    {/if}
  </section>

  <div class="mt-auto flex flex-col gap-1">
    <a href="#/assistant" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" /></svg>
      <span class="hidden lg:inline">دستیار میوز — خلاصه و پیشنهاد</span>
    </a>
    <a href="#/notifications" class="btn btn-ghost btn-sm w-full justify-center px-0 lg:justify-start lg:px-2">
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      <span class="hidden lg:inline">اعلان‌ها</span>
      {#if notif.unreadCount > 0}
        <span class="badge badge-warning badge-sm" data-unread-badge>{notif.unreadCount}</span>
      {/if}
    </a>
    <p class="hidden text-xs opacity-50 lg:block">دستیار فقط استخراجی است؛ جمله‌ای ساخته نمی‌شود.</p>
  </div>

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
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      <span class="hidden lg:inline">{displayPrefs.simple ? 'حالت گرافیکی' : 'حالت ساده'}</span>
    </button>
    <button
      class="btn btn-sclack btn-ghost btn-sm mb-2 w-full justify-center px-0 lg:justify-start lg:px-2"
      onclick={() => (displayPrefs.sidebarHidden = true)}
      title="جمع‌کردن سایدبار (Ctrl+\)"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      <span class="hidden lg:inline">جمع‌کردن سایدبار</span>
    </button>
    <button class="btn btn-sclack btn-outline btn-sm w-full justify-center px-0 lg:justify-start lg:px-2" onclick={signOut}>
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
      <span class="hidden lg:inline">خروج از حساب</span>
    </button>
    <p class="mt-2 hidden text-center text-xs opacity-50 lg:block">sclack_A — اسکلت + چت + سند و فایل + کار و حافظه + دستیار (D5) + گرافیک (P01 بخش ۵)</p>
  </div>
</aside>
