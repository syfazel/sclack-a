<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import {
    createProject,
    updateProject,
    closeProject,
    deleteProject,
    loadProjectData
  } from '../lib/data.js'
  import { PROJECT_STAGE_LABEL, endOfTehranDay, tehranDayKey } from '../lib/extract.js'
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
  // H1-1: closing is two-tap in-app, like delete — no native dialog.
  let armCloseProjectId = $state(null)

  // G1 item 8 — project delete: creator only (w1), two-tap in-app
  // confirm with a warning (no native dialog). A delete that the
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

  // P01 A5 — close = archive, not delete. Two-step in-app confirm
  // (H1-1, same pattern as delete); docs, files and tasks stay
  // readable afterwards.
  async function doCloseProject(p) {
    if (armCloseProjectId !== p.id) {
      armCloseProjectId = p.id
      return
    }
    armCloseProjectId = null
    if (closingId) return
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
  <h1 class="mb-4 text-xl font-bold">پروژه‌ها</h1>

  <!-- P01 A1: project creation form -->
  <section class="mt-6">
    <h2 class="mb-2 text-lg font-bold">ساختن پروژهٔ تازه</h2>
    <div class="card glass-card">
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
                  class="btn btn-ghost btn-sm {armCloseProjectId === p.id ? 'btn-error' : ''}"
                  onclick={() => doCloseProject(p)}
                  disabled={closingId === p.id}
                  title="بستن پروژه — به بایگانی می‌رود، پاک نمی‌شود"
                >
                  {armCloseProjectId === p.id ? 'مطمئنید؟ بستن پروژه' : 'بستن پروژه'}
                </button>
              </div>
              {#if armDeleteProjectId === p.id}
                <p class="mt-1 text-xs text-error">
                  با تپ دوم، همهٔ اتاق‌ها، پیام‌ها، سندها، فایل‌ها و کارهای پروژه پاک می‌شوند و
                  برنمی‌گردند.
                </p>
              {/if}
              {#if armCloseProjectId === p.id}
                <p class="mt-1 text-xs text-error">
                  با تپ دوم، پروژه بسته و به بایگانی می‌رود؛ سند و فایل و کارهایش خواندنی می‌مانند.
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
