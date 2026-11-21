<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import {
    createTask,
    cycleTaskStatus,
    deleteTask,
    seedTemplates,
    createFromTemplate,
    createReminder,
    setReminderDone,
    deleteReminder,
    isOverdue
  } from '../lib/work.js'
  import { TASK_STATUS_LABEL } from '../lib/extract.js'
  import SearchBox from './SearchBox.svelte'

  // --- task form ---
  let taskTitle = $state('')
  let taskDesc = $state('')
  let taskAssignee = $state('')
  let taskDue = $state('')
  let taskLinkType = $state('')
  let taskLinkId = $state('')
  let taskError = $state('')
  let taskBusy = $state(false)

  // --- templates ---
  let projectTemplateName = $state('')
  let templateMsg = $state('')
  let templateBusy = $state(false)
  let seeding = $state(false)

  // --- reminders ---
  let remText = $state('')
  let remTargetType = $state('')
  let remTargetId = $state('')
  let remAt = $state('')
  let remError = $state('')
  let remBusy = $state(false)

  let taskErrorById = $state({})

  const linkTargets = $derived.by(() => {
    const rooms = ws.rooms.map((r) => ({ type: 'room', id: r.id, label: 'اتاق: ' + r.name }))
    const docs = ws.docs.map((d) => ({ type: 'doc', id: d.id, label: 'سند: ' + d.title }))
    return [...rooms, ...docs]
  })

  function onLinkTypeChange() {
    taskLinkId = ''
  }

  function linkLabel(task) {
    const cf = task.custom_fields || {}
    if (!cf.link_type || !cf.link_id) return ''
    if (cf.link_type === 'room') {
      const r = ws.rooms.find((x) => x.id === cf.link_id)
      return r ? 'اتاق: ' + r.name : 'اتاق'
    }
    if (cf.link_type === 'doc') {
      const d = ws.docs.find((x) => x.id === cf.link_id)
      return d ? 'سند: ' + d.title : 'سند'
    }
    return ''
  }

  function linkHref(task) {
    const cf = task.custom_fields || {}
    if (cf.link_type === 'room') return '#/room/' + cf.link_id
    if (cf.link_type === 'doc') return '#/doc/' + cf.link_id
    return '#/tasks'
  }

  function isDue(task) {
    return (
      task.status !== 'done' &&
      !!task.due_at &&
      new Date(task.due_at).getTime() < Date.now()
    )
  }

  function fmtDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('fa-IR')
  }

  function fmtDateTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('fa-IR')
  }

  async function doCreateTask() {
    if (taskBusy || !ws.currentProjectId) return
    taskBusy = true
    taskError = ''
    try {
      await createTask({
        projectId: ws.currentProjectId,
        title: taskTitle,
        description: taskDesc,
        assigneeId: taskAssignee || null,
        dueAt: taskDue ? new Date(taskDue + 'T23:59:00').toISOString() : null,
        linkType: taskLinkType || null,
        linkId: taskLinkId || null
      })
      taskTitle = ''
      taskDesc = ''
      taskAssignee = ''
      taskDue = ''
      taskLinkType = ''
      taskLinkId = ''
    } catch (e) {
      taskError = e.message || String(e)
    } finally {
      taskBusy = false
    }
  }

  async function doCycleTask(task) {
    try {
      await cycleTaskStatus(task)
    } catch (e) {
      taskErrorById = { ...taskErrorById, [task.id]: e.message || String(e) }
    }
  }

  async function doDeleteTask(task) {
    if (!confirm('این کار حذف شود؟')) return
    try {
      await deleteTask(task)
    } catch (e) {
      taskErrorById = { ...taskErrorById, [task.id]: e.message || String(e) }
    }
  }

  async function doSeedTemplates() {
    if (seeding) return
    seeding = true
    templateMsg = ''
    try {
      await seedTemplates()
      templateMsg = '۴ قالب آماده ساخته شد.'
    } catch (e) {
      templateMsg = e.message || String(e)
    } finally {
      seeding = false
    }
  }

  async function doCreateFromTemplate(t) {
    if (templateBusy) return
    templateBusy = true
    templateMsg = ''
    try {
      const res = await createFromTemplate(t, {
        projectId: ws.currentProjectId,
        projectName: projectTemplateName
      })
      if (res.project) {
        projectTemplateName = ''
        templateMsg = 'پروژهٔ «' + res.project.name + '» ساخته شد.'
        location.hash = '#/room/' + res.room.id
      } else if (res.doc) {
        templateMsg = 'سند «' + res.doc.title + '» ساخته شد.'
        location.hash = '#/doc/' + res.doc.id
      }
    } catch (e) {
      templateMsg = e.message || String(e)
    } finally {
      templateBusy = false
    }
  }

  async function doCreateReminder() {
    if (remBusy) return
    remBusy = true
    remError = ''
    try {
      await createReminder({
        text: remText,
        targetType: remTargetType || null,
        targetId: remTargetId || null,
        remindAt: remAt ? new Date(remAt).toISOString() : null
      })
      remText = ''
      remTargetType = ''
      remTargetId = ''
      remAt = ''
    } catch (e) {
      remError = e.message || String(e)
    } finally {
      remBusy = false
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <h1 class="text-2xl font-bold">کارها</h1>
  <p class="mt-1 text-sm opacity-70">فهرست کار، قالب و یادآوری پروژهٔ جاری.</p>

  <div class="mt-6">
    <SearchBox />
  </div>

  {#if !ws.currentProjectId}
    <p class="mt-6 text-sm opacity-60">اول یک پروژه بسازید یا انتخاب کنید.</p>
  {:else}
    <!-- tasks -->
    <section class="mt-8">
      <h2 class="mb-2 text-lg font-bold">فهرست کار</h2>
      <div class="card bg-base-200">
        <div class="card-body gap-2">
          <input
            class="input input-bordered input-sclack w-full bg-base-100"
            placeholder="عنوان کار تازه"
            bind:value={taskTitle}
            disabled={taskBusy}
          />
          <input
            class="input input-bordered input-sclack w-full bg-base-100"
            placeholder="توضیح (اختیاری)"
            bind:value={taskDesc}
            disabled={taskBusy}
          />
          <div class="flex flex-wrap gap-2">
            <select
              class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
              bind:value={taskAssignee}
              disabled={taskBusy}
            >
              <option value="">بدون سپردن</option>
              {#each ws.members as m (m.id)}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
            <input
              type="date"
              class="input input-bordered input-sclack bg-base-100"
              bind:value={taskDue}
              disabled={taskBusy}
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <select
              class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
              bind:value={taskLinkType}
              onchange={onLinkTypeChange}
              disabled={taskBusy}
            >
              <option value="">بدون پیوند</option>
              <option value="room">پیوند به اتاق</option>
              <option value="doc">پیوند به سند</option>
            </select>
            {#if taskLinkType}
              <select
                class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                bind:value={taskLinkId}
                disabled={taskBusy}
              >
                <option value="">انتخاب کنید</option>
                {#each linkTargets.filter((t) => t.type === taskLinkType) as t (t.id)}
                  <option value={t.id}>{t.label}</option>
                {/each}
              </select>
            {/if}
          </div>
          {#if taskError}
            <p class="text-xs text-error">{taskError}</p>
          {/if}
          <button class="btn btn-sclack btn-primary w-full" onclick={doCreateTask} disabled={taskBusy}>
            ساختن کار
          </button>
        </div>
      </div>

      {#if ws.tasks.length === 0}
        <p class="mt-3 text-sm opacity-60">هنوز کاری نیست.</p>
      {:else}
        <ul class="mt-3 flex flex-col gap-2">
          {#each ws.tasks as t (t.id)}
            <li class="card bg-base-200">
              <div class="card-body gap-1 py-3">
                <div class="flex items-start gap-2">
                  <button
                    class="btn btn-sclack btn-sm {t.status === 'done'
                      ? 'btn-success'
                      : t.status === 'doing'
                        ? 'btn-warning'
                        : 'btn-outline'}"
                    onclick={() => doCycleTask(t)}
                    title="تغییر وضعیت"
                  >
                    {TASK_STATUS_LABEL[t.status] || t.status}
                  </button>
                  <span
                    class="min-w-0 flex-1 font-medium {t.status === 'done' ? 'line-through opacity-60' : ''}"
                  >
                    {t.title}
                  </span>
                  {#if auth.member && t.created_by === auth.member.id}
                    <button
                      class="btn btn-ghost btn-sm text-error"
                      onclick={() => doDeleteTask(t)}
                      title="حذف کار"
                    >
                      حذف
                    </button>
                  {/if}
                </div>
                {#if t.description}
                  <p class="text-sm opacity-70">{t.description}</p>
                {/if}
                <p class="text-xs opacity-60">
                  {#if t.assignee_id}سپرده به {memberName(t.assignee_id)} · {/if}
                  {#if t.due_at}
                    سررسید {fmtDate(t.due_at)}
                    {#if isDue(t)}<span class="font-bold text-error"> · سررسید گذشته</span>{/if}
                    ·
                  {/if}
                  {#if t.completed_at}تمام‌شده در {fmtDateTime(t.completed_at)} · {/if}
                  ساختهٔ {memberName(t.created_by)}
                </p>
                {#if linkLabel(t)}
                  <p class="text-xs">
                    <a href={linkHref(t)} class="link link-primary">{linkLabel(t)}</a>
                  </p>
                {/if}
                {#if taskErrorById[t.id]}
                  <p class="text-xs text-error">{taskErrorById[t.id]}</p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- templates -->
    <section class="mt-8">
      <h2 class="mb-2 text-lg font-bold">قالب‌های آماده</h2>
      {#if ws.templates.length === 0}
        <div class="card bg-base-200">
          <div class="card-body">
            <p class="text-sm opacity-70">هنوز قالبی نیست.</p>
            <button class="btn btn-sclack btn-outline" onclick={doSeedTemplates} disabled={seeding}>
              ساختن ۴ قالب آماده
            </button>
          </div>
        </div>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each ws.templates as t (t.id)}
            <div class="card bg-base-200">
              <div class="card-body gap-2">
                <h3 class="font-bold">{t.name}</h3>
                <p class="text-sm opacity-70">
                  {t.structure?.kind === 'project'
                    ? 'یک پروژهٔ تازه با اتاق «گفت‌وگو» و سند یادداشت جلسه می‌سازد.'
                    : 'یک سند تازه با همین ساختار در پروژهٔ جاری می‌سازد.'}
                </p>
                {#if t.structure?.kind === 'project'}
                  <input
                    class="input input-bordered input-sclack w-full bg-base-100"
                    placeholder="نام پروژهٔ تازه"
                    bind:value={projectTemplateName}
                    disabled={templateBusy}
                  />
                {/if}
                <button
                  class="btn btn-sclack btn-primary"
                  onclick={() => doCreateFromTemplate(t)}
                  disabled={templateBusy}
                >
                  ساختن با این قالب
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if templateMsg}
        <p class="mt-2 text-xs opacity-70">{templateMsg}</p>
      {/if}
    </section>

    <!-- reminders -->
    <section class="mt-8">
      <h2 class="mb-2 text-lg font-bold">یادآوری‌ها</h2>
      <p class="mb-2 text-xs opacity-60">
        فقط فهرست درون‌اپی است — اعلان پوش نمی‌فرستیم.
      </p>
      <div class="card bg-base-200">
        <div class="card-body gap-2">
          <input
            class="input input-bordered input-sclack w-full bg-base-100"
            placeholder="متن یادآوری"
            bind:value={remText}
            disabled={remBusy}
          />
          <div class="flex flex-wrap gap-2">
            <select
              class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
              bind:value={remTargetType}
              onchange={() => (remTargetId = '')}
              disabled={remBusy}
            >
              <option value="">بدون پیوند</option>
              <option value="task">پیوند به کار</option>
              <option value="doc">پیوند به سند</option>
            </select>
            {#if remTargetType}
              <select
                class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                bind:value={remTargetId}
                disabled={remBusy}
              >
                <option value="">انتخاب کنید</option>
                {#if remTargetType === 'task'}
                  {#each ws.tasks as t (t.id)}
                    <option value={t.id}>{t.title}</option>
                  {/each}
                {:else}
                  {#each ws.docs as d (d.id)}
                    <option value={d.id}>{d.title}</option>
                  {/each}
                {/if}
              </select>
            {/if}
            <input
              type="datetime-local"
              class="input input-bordered input-sclack bg-base-100"
              bind:value={remAt}
              disabled={remBusy}
            />
          </div>
          {#if remError}
            <p class="text-xs text-error">{remError}</p>
          {/if}
          <button class="btn btn-sclack btn-primary w-full" onclick={doCreateReminder} disabled={remBusy}>
            ساختن یادآوری
          </button>
        </div>
      </div>
      {#if ws.reminders.length === 0}
        <p class="mt-3 text-sm opacity-60">یادآوری نیست.</p>
      {:else}
        <ul class="mt-3 flex flex-col gap-2">
          {#each ws.reminders as r (r.id)}
            <li class="card bg-base-200">
              <div class="card-body flex-row items-center gap-2 py-3">
                <input
                  type="checkbox"
                  class="checkbox checkbox-primary"
                  checked={r.done}
                  onchange={(e) => setReminderDone(r, e.target.checked)}
                />
                <span class="min-w-0 flex-1 {r.done ? 'line-through opacity-60' : ''}">
                  {r.text}
                  {#if r.remind_at}
                    <span class="block text-xs opacity-60">
                      {fmtDateTime(r.remind_at)}
                      {#if isOverdue(r)}<span class="font-bold text-error"> · سررسید گذشته</span>{/if}
                    </span>
                  {/if}
                </span>
                <button class="btn btn-ghost btn-sm text-error" onclick={() => deleteReminder(r)}>
                  حذف
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
