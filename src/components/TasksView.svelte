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
  import {
    TASK_STATUS_LABEL,
    PLANNER_MENUS,
    WEEKDAY_LABELS_FA,
    plannerMenuTasks,
    plannerCalendarCounts,
    plannerDayTasks,
    plannerMenuDefaultDue,
    endOfTehranDay,
    jalaliMonthDays,
    jalaliMonthLabel,
    jalaliDayLabel,
    tehranDayKey,
    weekdayOfDayKey,
    shiftJalaliMonth,
    isOverdueTask
  } from '../lib/extract.js'
  import SearchBox from './SearchBox.svelte'
  import FileList from './FileList.svelte'

  // --- planner (P01 C): exactly the 8 menus of C1, on #/tasks ---
  let plannerMenu = $state('today')
  let calAnchor = $state(new Date())
  let calSelectedDay = $state(null)
  const todayKey = tehranDayKey(new Date())
  const otherMemberId = $derived.by(() => {
    const me = auth.member?.id
    const other = ws.members.find((m) => m.id !== me)
    return other ? other.id : null
  })
  const menuData = $derived(
    plannerMenuTasks(ws.tasks, ws.reminders, plannerMenu, {
      meId: auth.member?.id,
      otherId: otherMemberId
    })
  )
  // Count badges on the menu bar, all from real rows.
  const menuCounts = $derived.by(() => {
    const counts = {}
    for (const m of PLANNER_MENUS) {
      if (m.id === 'calendar') {
        counts[m.id] = Object.values(plannerCalendarCounts(ws.tasks, new Date())).reduce(
          (a, b) => a + b,
          0
        )
      } else if (m.id === 'reminders') {
        counts[m.id] = ws.reminders.length
      } else {
        const r = plannerMenuTasks(ws.tasks, ws.reminders, m.id, {
          meId: auth.member?.id,
          otherId: otherMemberId
        })
        counts[m.id] = r.tasks.length + (r.reminders?.length || 0)
      }
    }
    return counts
  })
  const calMonth = $derived(jalaliMonthDays(calAnchor))
  const calCounts = $derived(plannerCalendarCounts(ws.tasks, calAnchor))
  const calDayTasks = $derived(
    calSelectedDay ? plannerDayTasks(ws.tasks, calSelectedDay) : []
  )
  const calLeadBlanks = $derived(
    calMonth.days.length > 0 ? (weekdayOfDayKey(calMonth.days[0].dayKey) + 1) % 7 : 0
  )
  const currentMenuLabel = $derived(
    (PLANNER_MENUS.find((m) => m.id === plannerMenu) || {}).label || ''
  )
  const currentPrefill = $derived(
    plannerMenuDefaultDue(plannerMenu, new Date(), calSelectedDay)
  )

  function selectMenu(id) {
    plannerMenu = id
    if (id === 'calendar' && !calSelectedDay) calSelectedDay = todayKey
  }

  function shiftCal(delta) {
    calAnchor = shiftJalaliMonth(calAnchor, delta)
    calSelectedDay = null
  }

  // --- task form ---
  let taskTitle = $state('')
  let taskDesc = $state('')
  let taskAssignee = $state('')
  let taskDue = $state('')
  let taskLinkType = $state('')
  let taskLinkId = $state('')
  let taskError = $state('')
  let taskBusy = $state(false)

  // C3: the active menu prefills the form's due date (today, or the
  // selected calendar day). Menus without a date context clear it.
  // Switching menus re-applies the prefill — a date typed by hand in one
  // menu does not carry over to another; clearing the date is how a
  // task is created without due_at (A2, «بدون تاریخ»).
  $effect(() => {
    taskDue = plannerMenuDefaultDue(plannerMenu, new Date(), calSelectedDay)
  })

  // --- templates ---
  let projectTemplateName = $state('')
  let projectTemplateGoal = $state('')
  let projectTemplateDeadline = $state('')
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
  // P01 B4: one task's file section open at a time.
  let openFilesTaskId = $state(null)

  function taskFilesCount(t) {
    return ws.files.filter(
      (f) => f.attached_to_type === 'task' && f.attached_to_id === t.id
    ).length
  }

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
        dueAt: taskDue ? endOfTehranDay(taskDue) : null,
        linkType: taskLinkType || null,
        linkId: taskLinkId || null
      })
      taskTitle = ''
      taskDesc = ''
      taskAssignee = ''
      taskDue = plannerMenuDefaultDue(plannerMenu, new Date(), calSelectedDay)
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
        projectName: projectTemplateName,
        // P01 A1: a project template also goes through the form rule —
        // goal and deadline are required.
        projectGoal: projectTemplateGoal,
        projectDeadline: projectTemplateDeadline
          ? endOfTehranDay(projectTemplateDeadline)
          : ''
      })
      if (res.project) {
        projectTemplateName = ''
        projectTemplateGoal = ''
        projectTemplateDeadline = ''
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
  {#snippet taskRow(t)}
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
            {#if isOverdueTask(t)}<span class="font-bold text-error"> · عقب‌مانده</span>{/if}
            ·
          {:else}
            <!-- P01 A2: a task without due_at is creatable but never
                 appears in the planner menus; it carries this label. -->
            بدون تاریخ ·
          {/if}
          {#if t.completed_at}تمام‌شده در {fmtDateTime(t.completed_at)} · {/if}
          ساختهٔ {memberName(t.created_by)}
        </p>
        {#if linkLabel(t)}
          <p class="text-xs">
            <a href={linkHref(t)} class="link link-primary">{linkLabel(t)}</a>
          </p>
        {/if}
        <div class="mt-1">
          <button
            class="btn btn-ghost btn-xs"
            onclick={() =>
              (openFilesTaskId = openFilesTaskId === t.id ? null : t.id)}
          >
            {openFilesTaskId === t.id ? 'پنهان کردن فایل‌ها' : 'فایل‌ها'}
            ({taskFilesCount(t)})
          </button>
          {#if openFilesTaskId === t.id}
            <div class="mt-2 rounded-xl bg-base-100 px-3 py-2">
              <FileList
                projectId={t.project_id}
                attachedTo={{ type: 'task', id: t.id }}
                filterAttached
              />
            </div>
          {/if}
        </div>
        {#if taskErrorById[t.id]}
          <p class="text-xs text-error">{taskErrorById[t.id]}</p>
        {/if}
      </div>
    </li>
  {/snippet}

  {#snippet reminderRow(r)}
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
  {/snippet}

  <h1 class="text-2xl font-bold">کارها</h1>
  <p class="mt-1 text-sm opacity-70">دفتر برنامه‌ریزی — کارها و یادآوری‌های پروژهٔ جاری بر اساس زمان و تاریخ.</p>

  <div class="mt-6">
    <SearchBox />
  </div>

  {#if !ws.currentProjectId}
    <p class="mt-6 text-sm opacity-60">اول یک پروژه بسازید یا انتخاب کنید.</p>
  {:else}
    <!-- planner menu bar: exactly the 8 menus of P01 C1 -->
    <div
      class="mt-6 flex gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="منوهای دفتر برنامه‌ریزی"
    >
      {#each PLANNER_MENUS as m (m.id)}
        <button
          data-menu={m.id}
          role="tab"
          aria-selected={plannerMenu === m.id}
          class="btn btn-sclack shrink-0 {plannerMenu === m.id ? 'btn-primary' : 'btn-outline'}"
          onclick={() => selectMenu(m.id)}
        >
          {m.label}
          <span class="badge badge-sm {plannerMenu === m.id ? 'badge-neutral' : 'badge-ghost'}">
            {menuCounts[m.id] ?? 0}
          </span>
        </button>
      {/each}
    </div>

    <!-- create a task from inside the active menu (C3) -->
    <section class="mt-4">
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
          {#if currentPrefill}
            <p class="text-xs opacity-60">
              سررسید پیش‌فرض از منوی «{currentMenuLabel}»: {fmtDate(currentPrefill)} — برای کار
              بدون تاریخ، تاریخ را پاک کنید.
            </p>
          {:else}
            <p class="text-xs opacity-60">
              این منو سررسید پیش‌فرض ندارد — تاریخ را خودتان انتخاب کنید یا خالی بگذارید.
            </p>
          {/if}
          {#if taskError}
            <p class="text-xs text-error">{taskError}</p>
          {/if}
          <button class="btn btn-sclack btn-primary w-full" onclick={doCreateTask} disabled={taskBusy}>
            ساختن کار
          </button>
        </div>
      </div>
    </section>

    {#if plannerMenu === 'calendar'}
      <!-- تقویم: نمای ماهانهٔ جلالی؛ هر روز شمار کارهای آن روز را نشان می‌دهد؛
           کلیک روی روز فهرست آن روز را باز می‌کند (C2). -->
      <section class="mt-6">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-bold">تقویم — {jalaliMonthLabel(calAnchor)}</h2>
          <div class="flex gap-2">
            <button class="btn btn-sclack btn-sm btn-outline" onclick={() => shiftCal(-1)}>
              ماه قبل
            </button>
            <button class="btn btn-sclack btn-sm btn-outline" onclick={() => shiftCal(1)}>
              ماه بعد
            </button>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold opacity-70">
          {#each WEEKDAY_LABELS_FA as d}
            <div>{d}</div>
          {/each}
        </div>
        <div class="mt-1 grid grid-cols-7 gap-1">
          {#each Array.from({ length: calLeadBlanks }) as _}
            <div></div>
          {/each}
          {#each calMonth.days as d (d.dayKey)}
            <button
              data-day={d.dayKey}
              class="btn btn-sclack btn-sm h-auto min-h-11 flex-col gap-0 py-1 {calSelectedDay ===
              d.dayKey
                ? 'btn-primary'
                : 'btn-ghost'} {d.dayKey === todayKey ? 'ring-2 ring-primary' : ''}"
              onclick={() => (calSelectedDay = d.dayKey)}
            >
              <span>{d.jalaliDay}</span>
              {#if calCounts[d.dayKey] > 0}
                <span class="badge badge-sm badge-ghost">{calCounts[d.dayKey]}</span>
              {/if}
            </button>
          {/each}
        </div>
        {#if calSelectedDay}
          <h3 class="mt-6 mb-2 text-lg font-bold">کارهای {jalaliDayLabel(calSelectedDay)}</h3>
          {#if calDayTasks.length === 0}
            <p class="mt-3 text-sm opacity-60">در این روز کاری نیست.</p>
          {:else}
            <ul class="mt-3 flex flex-col gap-2">
              {#each calDayTasks as t (t.id)}
                {@render taskRow(t)}
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="mt-6 text-sm opacity-60">یک روز را انتخاب کنید.</p>
        {/if}
      </section>
    {:else if plannerMenu === 'reminders'}
      <!-- یادآوری‌ها: فقط فهرست درون‌اپی است — اعلان پوش نمی‌فرستیم (C2). -->
      <section class="mt-6">
        <h2 class="mb-2 text-lg font-bold">یادآوری‌ها</h2>
        <p class="mb-2 text-xs opacity-60">فقط فهرست درون‌اپی است — اعلان پوش نمی‌فرستیم.</p>
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
            <button
              class="btn btn-sclack btn-primary w-full"
              onclick={doCreateReminder}
              disabled={remBusy}
            >
              ساختن یادآوری
            </button>
          </div>
        </div>
        {#if ws.reminders.length === 0}
          <p class="mt-3 text-sm opacity-60">یادآوری نیست.</p>
        {:else}
          <ul class="mt-3 flex flex-col gap-2">
            {#each ws.reminders as r (r.id)}
              {@render reminderRow(r)}
            {/each}
          </ul>
        {/if}
      </section>
    {:else}
      <!-- the other six menus: one filtered task list -->
      <section class="mt-6">
        {#if plannerMenu === 'mine'}
          <h2 class="mb-2 text-lg font-bold">کارهای من</h2>
        {:else if plannerMenu === 'other'}
          <h2 class="mb-2 text-lg font-bold">
            کارهای {otherMemberId ? memberName(otherMemberId) : 'نفر دوم'}
          </h2>
        {:else if plannerMenu === 'due'}
          <h2 class="mb-2 text-lg font-bold">سررسیدها</h2>
        {:else if plannerMenu === 'week'}
          <h2 class="mb-2 text-lg font-bold">این هفته</h2>
        {:else if plannerMenu === 'month'}
          <h2 class="mb-2 text-lg font-bold">این ماه</h2>
        {:else}
          <h2 class="mb-2 text-lg font-bold">امروز</h2>
        {/if}
        {#if menuData.tasks.length === 0}
          <p class="mt-3 text-sm opacity-60">
            {#if plannerMenu === 'today'}
              کاری برای امروز نیست.
            {:else if plannerMenu === 'week'}
              کاری در ۷ روز آینده نیست.
            {:else if plannerMenu === 'month'}
              کاری در این ماه نیست.
            {:else if plannerMenu === 'due'}
              کاری باز نیست.
            {:else if plannerMenu === 'mine'}
              کاری به شما سپرده نشده است.
            {:else if plannerMenu === 'other'}
              {#if otherMemberId}
                کاری به نفر دوم سپرده نشده است.
              {:else}
                عضو دیگری در پروژه نیست.
              {/if}
            {/if}
          </p>
        {:else}
          <ul class="mt-3 flex flex-col gap-2">
            {#each menuData.tasks as t (t.id)}
              {@render taskRow(t)}
            {/each}
          </ul>
        {/if}
        {#if plannerMenu === 'today' && menuData.reminders.length > 0}
          <h3 class="mt-6 mb-2 text-lg font-bold">یادآوری‌های امروز</h3>
          <ul class="mt-3 flex flex-col gap-2">
            {#each menuData.reminders as r (r.id)}
              {@render reminderRow(r)}
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

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
                  <input
                    class="input input-bordered input-sclack w-full bg-base-100"
                    placeholder="هدف پروژه *"
                    bind:value={projectTemplateGoal}
                    disabled={templateBusy}
                  />
                  <label class="form-control w-full">
                    <span class="label-text mb-1">مهلت *</span>
                    <input
                      type="date"
                      class="input input-bordered input-sclack w-full bg-base-100"
                      bind:value={projectTemplateDeadline}
                      disabled={templateBusy}
                    />
                  </label>
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
  {/if}
</div>
