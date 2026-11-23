<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import {
    createTask,
    updateTask,
    cycleTaskStatus,
    deleteTask,
    setTaskParent,
    updateChecklist,
    seedTemplates,
    createFromTemplate,
    createReminder,
    setReminderDone,
    deleteReminder,
    isOverdue
  } from '../lib/work.js'
  import {
    TASK_STATUS_LABEL,
    TASK_STATUSES,
    PLANNER_MENUS,
    WEEKDAY_LABELS_FA,
    faNum,
    plannerMenuTasks,
    plannerCalendarCounts,
    plannerDayTasks,
    plannerMenuDefaultDue,
    endOfTehranDay,
    tehranDayKey,
    jalaliMonthDays,
    jalaliMonthLabel,
    jalaliDayLabel,
    weekdayOfDayKey,
    shiftJalaliMonth,
    isOverdueTask,
    buildTaskTree,
    taskParentOptions
  } from '../lib/extract.js'
  import SearchBox from './SearchBox.svelte'
  import FileList from './FileList.svelte'
  import DocPicker from './DocPicker.svelte'

  // --- planner (P01 C): exactly the 8 menus of C1, on #/tasks ---
  let plannerMenu = $state('today')
  // Phase 8: list vs kanban (D9 الف — جابه‌جایی با تپ روی دکمهٔ وضعیت).
  let viewMode = $state('list') // 'list' | 'kanban'
  const showKanban = $derived(
    viewMode === 'kanban' && plannerMenu !== 'calendar' && plannerMenu !== 'reminders'
  )
  // درخت کارها روی فهرستِ فیلترشدهٔ منوی جاری: والدی که در این منو
  // نیست، فرزندش را در این نما ریشه می‌کند (buildTaskTree همین را
  // می‌کند) — فرزند گم نمی‌شود.
  const taskTree = $derived(buildTaskTree(menuData.tasks))
  const calDayTree = $derived(buildTaskTree(calDayTasks))
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
  // Phase 1: while an edit form is open the prefill must not clobber
  // the edited due date.
  $effect(() => {
    if (!editingTaskId) taskDue = plannerMenuDefaultDue(plannerMenu, new Date(), calSelectedDay)
  })

  // --- task edit (Phase 1): one inline form under the row, same fields
  // as the create form, prefilled with the row's current values. Only
  // one edit form is open at a time; cancel saves nothing.
  let editingTaskId = $state(null)
  let editTitle = $state('')
  let editDesc = $state('')
  let editAssignee = $state('')
  let editDue = $state('')
  let editLinkType = $state('')
  let editLinkId = $state('')
  let editParentId = $state('') // Phase 8: والد تازه ('' = ریشه)
  let editError = $state('')
  let editBusy = $state(false)
  let editSavedId = $state(null)

  // Phase 8: پیش‌نویس مورد تازهٔ چک‌لیست، برای هر کار جدا.
  let checklistDrafts = $state({})

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
  // Two-tap delete arm, same pattern as file delete (G1 fix).
  let armDeleteTaskId = $state(null)
  // P01 B4: one task's file section open at a time.
  let openFilesTaskId = $state(null)

  function taskFilesCount(t) {
    return ws.files.filter(
      (f) => f.attached_to_type === 'task' && f.attached_to_id === t.id
    ).length
  }

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
    // Two-tap in-app confirm, same pattern as file delete (G1 fix):
    // native confirm() is gone — first tap arms, second tap deletes.
    // A delete that matches 0 rows now throws in deleteTask, so the
    // error shows under the row instead of failing silently.
    if (armDeleteTaskId !== task.id) {
      armDeleteTaskId = task.id
      return
    }
    armDeleteTaskId = null
    try {
      await deleteTask(task)
      const { [task.id]: _gone, ...rest } = taskErrorById
      taskErrorById = rest
    } catch (e) {
      taskErrorById = { ...taskErrorById, [task.id]: e.message || String(e) }
    }
  }

  function openEdit(t) {
    // Toggling the same row closes its form without saving.
    if (editingTaskId === t.id) {
      editingTaskId = null
      editError = ''
      return
    }
    editingTaskId = t.id
    editTitle = t.title || ''
    editDesc = t.description || ''
    editAssignee = t.assignee_id || ''
    editDue = t.due_at ? tehranDayKey(t.due_at) : ''
    const cf = t.custom_fields || {}
    editLinkType = cf.link_type || ''
    editLinkId = cf.link_id || ''
    editParentId = t.parent_id || ''
    editError = ''
  }

  // Phase 8: چک‌لیست — تیک یک مورد، یا افزودن مورد تازه.
  function checklistOf(t) {
    return Array.isArray(t.custom_fields?.checklist) ? t.custom_fields.checklist : []
  }

  async function doToggleChecklist(t, index) {
    const list = checklistOf(t)
    if (!list[index]) return
    const next = list.map((item, i) => (i === index ? { ...item, done: !item.done } : item))
    try {
      await updateChecklist(t, next)
    } catch (e) {
      taskErrorById = { ...taskErrorById, [t.id]: e.message || String(e) }
    }
  }

  async function doAddChecklistItem(t) {
    const draft = (checklistDrafts[t.id] || '').trim()
    if (!draft) return
    try {
      await updateChecklist(t, [...checklistOf(t), { text: draft, done: false }])
      checklistDrafts = { ...checklistDrafts, [t.id]: '' }
    } catch (e) {
      taskErrorById = { ...taskErrorById, [t.id]: e.message || String(e) }
    }
  }

  function cancelEdit() {
    editingTaskId = null
    editError = ''
  }

  function onEditLinkTypeChange() {
    editLinkId = ''
  }

  async function doSaveEdit() {
    if (editBusy || !editingTaskId) return
    const task = ws.tasks.find((t) => t.id === editingTaskId)
    if (!task) return
    editBusy = true
    editError = ''
    try {
      const updated = await updateTask(task, {
        title: editTitle,
        description: editDesc,
        assigneeId: editAssignee || null,
        dueAt: editDue ? endOfTehranDay(editDue) : null,
        linkType: editLinkType || null,
        linkId: editLinkId || null
      })
      // Phase 8: والد فقط وقتی عوض شده باشد نوشته می‌شود — اگر ستون
      // زیروظیفه روی دادهٔ زنده نیست، setTaskParent با پیام روشن رد
      // می‌کند و ویرایشِ متنِ کار همان‌طور ذخیره‌شده می‌ماند.
      if ((editParentId || '') !== (task.parent_id || '')) {
        await setTaskParent(updated, editParentId || null)
      }
      editSavedId = task.id
      editingTaskId = null
      setTimeout(() => {
        editSavedId = null
      }, 700)
    } catch (e) {
      editError = e.message || String(e)
    } finally {
      editBusy = false
    }
  }

  async function doSeedTemplates() {
    if (seeding) return
    seeding = true
    templateMsg = ''
    try {
      await seedTemplates()
      templateMsg = '۷ قالب آماده ساخته شد.'
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
      } else if (res.task) {
        templateMsg = 'کار «' + res.task.title + '» ساخته شد.'
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
    <li
      class="card bg-base-200 {editingTaskId === t.id ? 'task-editing' : ''} {editSavedId === t.id
        ? 'task-saved-flash'
        : ''}"
      data-task-row={t.id}
      data-task-parent={t.parent_id || ''}
    >
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
          <!-- Phase 1: edit is for every member (RLS allows any member
               who sees the row to update it); delete stays creator-only. -->
          <button
            class="task-edit-btn btn btn-sclack btn-sm btn-outline min-h-11"
            aria-label={'ویرایش کارِ ' + t.title}
            onclick={() => openEdit(t)}
          >
            ویرایش
          </button>
          {#if auth.member && t.created_by === auth.member.id}
            <button
              class="btn btn-ghost btn-sm {armDeleteTaskId === t.id ? 'btn-error' : 'text-error'}"
              onclick={() => doDeleteTask(t)}
              title="حذف کار"
            >
              {armDeleteTaskId === t.id ? 'مطمئنید؟' : 'حذف'}
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
        <!-- Phase 8: چک‌لیست — تیک موردها + افزودن مورد تازه. -->
        <div class="mt-2 rounded-xl bg-base-100 px-3 py-2" data-checklist={t.id}>
          {#if checklistOf(t).length > 0}
            <p class="mb-1 text-xs font-bold opacity-70">
              چک‌لیست ({faNum(checklistOf(t).filter((i) => i.done).length)} از {faNum(checklistOf(t).length)})
            </p>
            <ul class="flex flex-col gap-1">
              {#each checklistOf(t) as item, i}
                <li class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    checked={item.done}
                    onchange={() => doToggleChecklist(t, i)}
                    aria-label={item.text}
                  />
                  <span class="text-sm {item.done ? 'line-through opacity-60' : ''}">{item.text}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mb-1 text-xs font-bold opacity-70">چک‌لیست</p>
          {/if}
          <div class="mt-2 flex gap-2">
            <input
              class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
              placeholder="مورد تازهٔ چک‌لیست"
              value={checklistDrafts[t.id] || ''}
              oninput={(e) =>
                (checklistDrafts = { ...checklistDrafts, [t.id]: e.currentTarget.value })}
              onkeydown={(e) => {
                if (e.key === 'Enter') doAddChecklistItem(t)
              }}
            />
            <button class="btn btn-sm btn-outline" onclick={() => doAddChecklistItem(t)}>
              + مورد
            </button>
          </div>
        </div>
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
        {#if editingTaskId === t.id}
          <!-- Phase 1: inline edit form under the row (accordion, like
               the files section) — same fields as the create form,
               prefilled with the row's current values. -->
          <div
            class="task-edit-form mt-2 rounded-xl bg-base-100 px-3 py-3"
            data-edit-form={t.id}
            aria-live="polite"
          >
            <h3 class="font-bold">ویرایش کار — {t.title}</h3>
            <div class="mt-2 flex flex-col gap-2">
              <input
                class="input input-bordered input-sclack w-full bg-base-100"
                placeholder="عنوان کار"
                bind:value={editTitle}
                disabled={editBusy}
              />
              <input
                class="input input-bordered input-sclack w-full bg-base-100"
                placeholder="توضیح (اختیاری)"
                bind:value={editDesc}
                disabled={editBusy}
              />
              <div class="flex flex-wrap gap-2">
                <select
                  class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                  bind:value={editAssignee}
                  disabled={editBusy}
                >
                  <option value="">بدون سپردن</option>
                  {#each ws.members as m (m.id)}
                    <option value={m.id}>{m.name}</option>
                  {/each}
                </select>
                <input
                  type="date"
                  class="input input-bordered input-sclack bg-base-100"
                  bind:value={editDue}
                  disabled={editBusy}
                />
              </div>
              <div class="flex flex-wrap gap-2">
                <select
                  class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                  bind:value={editLinkType}
                  onchange={onEditLinkTypeChange}
                  disabled={editBusy}
                >
                  <option value="">بدون پیوند</option>
                  <option value="room">پیوند به اتاق</option>
                  <option value="doc">پیوند به سند</option>
                </select>
                {#if editLinkType === 'doc'}
                  <DocPicker
                    linkId={editLinkId}
                    onSelect={(id) => (editLinkId = id)}
                    disabled={editBusy}
                  />
                {:else if editLinkType === 'room'}
                  <select
                    class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                    bind:value={editLinkId}
                    disabled={editBusy}
                  >
                    <option value="">انتخاب کنید</option>
                    {#each ws.rooms as r (r.id)}
                      <option value={r.id}>اتاق: {r.name}</option>
                    {/each}
                  </select>
                {/if}
              </div>
              {#if editError}
                <p class="text-xs text-error">{editError}</p>
              {/if}
              <div class="flex flex-wrap gap-2">
                <label class="flex items-center text-sm opacity-70" for="edit-parent-{t.id}">
                  کار والد (زیروظیفه)
                </label>
                <select
                  id="edit-parent-{t.id}"
                  class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                  bind:value={editParentId}
                  disabled={editBusy}
                  data-edit-parent
                >
                  <option value="">بدون والد — کار در ریشه</option>
                  {#each taskParentOptions(ws.tasks, t.id) as p (p.id)}
                    <option value={p.id}>{p.title}</option>
                  {/each}
                </select>
              </div>
              <div class="flex flex-col gap-2 sm:flex-row">
                <button
                  class="btn btn-sclack btn-primary w-full sm:flex-1"
                  onclick={doSaveEdit}
                  disabled={editBusy}
                >
                  {editBusy ? 'در حال ذخیره…' : 'ذخیرهٔ تغییرات'}
                </button>
                <button class="btn btn-ghost" onclick={cancelEdit} disabled={editBusy}>
                  انصراف
                </button>
              </div>
            </div>
          </div>
        {/if}
        {#if t.children?.length}
          <!-- Phase 8: زیروظیفه‌ها زیر والدشان، با تورفتگی. -->
          <ul
            class="mt-2 flex flex-col gap-2 border-s-2 border-[var(--line)] ps-3"
            data-task-children={t.id}
          >
            {#each t.children as child (child.id)}
              {@render taskRow(child)}
            {/each}
          </ul>
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

  <!-- G4 — هدر چسبان دفتر: شیشهٔ سبک، فقط کروم -->
  <div
    class="glass-mild sticky top-0 z-10 -mx-4 -mt-6 px-4 pt-6 pb-3 md:-mx-8 md:px-8"
    data-planner-header
  >
    <h1 class="text-2xl font-bold">کارها</h1>
    <p class="mt-1 text-sm opacity-70">دفتر برنامه‌ریزی — کارها و یادآوری‌های پروژهٔ جاری بر اساس زمان و تاریخ.</p>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="نمای کارها">
        <button
          type="button"
          class="btn btn-sm join-item {viewMode === 'list' ? 'btn-primary' : 'btn-outline'}"
          data-view="list"
          aria-pressed={viewMode === 'list'}
          onclick={() => (viewMode = 'list')}
        >
          فهرست
        </button>
        <button
          type="button"
          class="btn btn-sm join-item {viewMode === 'kanban' ? 'btn-primary' : 'btn-outline'}"
          data-view="kanban"
          aria-pressed={viewMode === 'kanban'}
          onclick={() => (viewMode = 'kanban')}
        >
          کانبان
        </button>
      </div>
      <a href="#/budget" class="btn btn-ghost btn-sm">بودجه و زمان‌بندی</a>
    </div>

    <div class="mt-6">
      <SearchBox />
    </div>

    {#if ws.currentProjectId}
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
    {/if}
  </div>

  {#if !ws.currentProjectId}
    <p class="mt-6 text-sm opacity-60">اول یک پروژه بسازید یا انتخاب کنید.</p>
  {:else}
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
            {#if taskLinkType === 'doc'}
              <!-- Phase 1: the doc target is a custom dropdown, not a
                   native <select> (the native one threw browser errors
                   repeatedly during the live AIM entry). -->
              <DocPicker
                linkId={taskLinkId}
                onSelect={(id) => (taskLinkId = id)}
                disabled={taskBusy}
              />
            {:else if taskLinkType === 'room'}
              <select
                class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
                bind:value={taskLinkId}
                disabled={taskBusy}
              >
                <option value="">انتخاب کنید</option>
                {#each ws.rooms as r (r.id)}
                  <option value={r.id}>اتاق: {r.name}</option>
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
              {#each calDayTree as t (t.id)}
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
        {:else if showKanban}
          <!-- Phase 8: کانبان — سه ستون وضعیت؛ جابه‌جایی با تپ روی
               دکمهٔ وضعیت هر کارت (D9 الف). زیروظیفه‌ها زیر والدشان
               می‌مانند، هرچند وضعیتشان با والد فرق کند. -->
          <div class="mt-3 grid gap-3 md:grid-cols-3" data-kanban>
            {#each TASK_STATUSES as st}
              <section
                class="rounded-xl border border-[var(--line)] bg-base-100 p-3"
                data-kanban-column={st}
              >
                <h3 class="mb-2 text-sm font-bold">
                  {TASK_STATUS_LABEL[st]} ({taskTree.filter((t) => t.status === st).length})
                </h3>
                <ul class="flex flex-col gap-2">
                  {#each taskTree.filter((t) => t.status === st) as t (t.id)}
                    {@render taskRow(t)}
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
        {:else}
          <ul class="mt-3 flex flex-col gap-2">
            {#each taskTree as t (t.id)}
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
              ساختن ۷ قالب آماده
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
                    : t.structure?.kind === 'task'
                      ? 'یک کار تازه با همین ساختار در پروژهٔ جاری می‌سازد.' +
                        (t.structure?.description ? ' ' + t.structure.description : '')
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
