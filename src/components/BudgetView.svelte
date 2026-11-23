<script>
  import { ws } from '../lib/store.svelte.js'
  import { faNum, computeBudget, computeBurndown, computeGantt } from '../lib/extract.js'
  import { findFormDoc } from '../lib/docs.js'

  const formDoc = $derived(findFormDoc(ws.docs))
  const answers = $derived(formDoc?.custom_fields?.form_answers || {})
  const tasks = $derived(ws.tasks || [])

  const budget = $derived(
    computeBudget(answers.cost_rows || [], {
      isSoftTech: answers.is_soft_tech?.value === 'yes',
      equipmentPct: answers.equipment_pct,
      assistantPct: answers.assistant_pct
    })
  )

  // پنجرهٔ زمانی: از قدیمی‌ترین ساخته‌شدن کار تا مهلت پروژه (اگر هست)
  // وگرنه تا دیرترین مهلت کارها. بدون پنجره، برن‌داون و گانت خالی‌اند.
  const windowRange = $derived.by(() => {
    const starts = tasks.map((t) => t.created_at).filter(Boolean)
    if (starts.length === 0) return null
    const start = [...starts].sort()[0]
    const project = (ws.projects || []).find((p) => p.id === ws.currentProjectId)
    const ends = tasks.map((t) => t.due_at).filter(Boolean)
    const latestDue = ends.length > 0 ? [...ends].sort().at(-1) : null
    const end =
      project?.deadline && project.deadline > start ? project.deadline : latestDue
    return end ? { start, end } : null
  })

  const burndown = $derived(windowRange ? computeBurndown(tasks, windowRange.start, windowRange.end) : null)
  const gantt = $derived(windowRange ? computeGantt(tasks, windowRange.start, windowRange.end) : null)
</script>

<div class="mx-auto max-w-3xl p-4">
  <h1 class="mb-1 text-lg font-bold">بودجه و زمان‌بندی</h1>
  <p class="mb-4 text-sm text-[var(--ink-soft)]">
    {#if formDoc}
      ریز هزینه‌ها از <a href="#/doc/{formDoc.id}" class="text-[var(--jigari)] underline">کاربرگ رسمی رویش</a> خوانده می‌شود؛
      برن‌داون و گانت از کارهای همین پروژه.
    {:else}
      کاربرگ هنوز ساخته نشده است — ریز هزینه‌ها پس از ساختن آن از سایدبار خوانده می‌شود.
    {/if}
  </p>

  <!-- هشدار رقم جاری گرنت (D6 الف) — همیشه دیده می‌شود -->
  <div class="alert alert-warning mb-4" role="note">
    <span class="text-sm">{budget.grantNote}</span>
  </div>

  <!-- بودجه -->
  <section class="mb-6 rounded-xl border border-[var(--line)] bg-white p-4" data-budget>
    <h2 class="mb-3 text-base font-bold text-[var(--jigari)]">بودجه — گرنت {faNum(budget.grant)} ریال</h2>
    <p class="mb-3 text-sm">
      جمع ریز هزینه‌ها: <strong>{faNum(budget.total)} ریال</strong>
      {#if budget.total > budget.grant}
        <span class="text-error"> (بیش از گرنت)</span>
      {/if}
    </p>
    <div class="flex flex-col gap-2">
      {#each budget.byCategory as cat}
        <div class="rounded-lg border border-[var(--line)] p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span class="font-bold">{cat.label}</span>
            <span>
              {faNum(cat.actual)} از {faNum(cat.cap)} ریال
              {#if cat.actual > cat.cap}
                <span class="text-error"> — از سقف گذشته</span>
              {/if}
            </span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded bg-[var(--surface)]">
            <div
              class="h-full rounded {cat.actual > cat.cap ? 'bg-error' : 'bg-[var(--jigari-btn)]'}"
              style="width: {cat.cap > 0 ? Math.min(100, Math.round((cat.actual / cat.cap) * 100)) : 0}%"
            ></div>
          </div>
          <p class="mt-1 text-xs text-[var(--ink-soft)]">{cat.note}</p>
        </div>
      {/each}
    </div>
    {#if budget.warnings.length > 0}
      <div class="alert alert-error mt-3" role="alert">
        <ul class="list-disc pr-5 text-sm">
          {#each budget.warnings as w}
            <li>{w}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  <!-- برن‌داون -->
  <section class="mb-6 rounded-xl border border-[var(--line)] bg-white p-4">
    <h2 class="mb-3 text-base font-bold text-[var(--jigari)]">برن‌داون</h2>
    {#if burndown}
      <svg
        data-burndown
        viewBox="0 0 {burndown.width} {burndown.height}"
        class="w-full"
        role="img"
        aria-label="برن‌داون: {faNum(burndown.remaining)} کار باقی‌مانده از {faNum(burndown.total)}"
      >
        <polyline points={burndown.idealPoints} fill="none" stroke="#9CA3AF" stroke-width="2" stroke-dasharray="5,4" />
        <polyline points={burndown.actualPoints} fill="none" stroke="#7F1D1D" stroke-width="2" />
        <text x={burndown.width - 8} y={burndown.height - 6} text-anchor="end" font-size="11" fill="#6B7280">
          {burndown.startLabel}
        </text>
        <text x="8" y={burndown.height - 6} text-anchor="start" font-size="11" fill="#6B7280">
          {burndown.endLabel}
        </text>
      </svg>
      <p class="mt-2 text-sm">
        {faNum(burndown.doneCount)} از {faNum(burndown.total)} کار تمام‌شده؛
        {faNum(burndown.remaining)} باقی‌مانده.
        {#if burndown.behind}
          <span class="text-error"> خط واقعی بالای خط ایده‌آل است — طبق R-C13 همان روز اقدام کنید.</span>
        {/if}
      </p>
    {:else}
      <p class="text-sm opacity-60">برای برن‌داون به کار و پنجرهٔ زمانی (مهلت) نیاز است.</p>
    {/if}
  </section>

  <!-- گانت -->
  <section class="mb-6 rounded-xl border border-[var(--line)] bg-white p-4">
    <h2 class="mb-3 text-base font-bold text-[var(--jigari)]">گانت</h2>
    {#if gantt && gantt.rows.length > 0}
      <svg
        data-gantt
        viewBox="0 0 {gantt.width} {gantt.height}"
        class="w-full"
        role="img"
        aria-label="گانت: {faNum(gantt.rows.length)} کار دارای تاریخ"
      >
        {#each gantt.rows as row}
          <g>
            <text x={gantt.width - 8} y={row.labelY} text-anchor="end" font-size="11" fill="#111827">
              {row.title}
            </text>
            <rect
              x={row.x}
              y={row.y}
              width={row.width}
              height="10"
              rx="5"
              fill={row.status === 'done' ? '#15803D' : row.status === 'doing' ? '#991B1B' : '#9CA3AF'}
            />
          </g>
        {/each}
      </svg>
      <p class="mt-2 text-xs text-[var(--ink-soft)]">{gantt.startLabel} تا {gantt.endLabel} — زمان راست‌به‌چپ می‌رود.</p>
    {:else}
      <p class="text-sm opacity-60">کاری با تاریخ شروع و مهلت نیست.</p>
    {/if}
    {#if gantt && gantt.undated.length > 0}
      <div class="mt-3">
        <p class="mb-1 text-sm font-bold">کارهای بدون تاریخ ({faNum(gantt.undated.length)}):</p>
        <ul class="list-disc pr-5 text-sm">
          {#each gantt.undated as title}
            <li>{title}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
</div>
