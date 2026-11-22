<script>
  import { computeProjectReview, faNum } from '../lib/extract.js'

  // P01 A4 — project review: counts computed ONLY from the real
  // tasks/docs/files rows passed in (never hardcoded or guessed).
  // Props are the current project's lists (already project-scoped by
  // loadProjectData). "New files" = uploaded in the last 7 days.
  let { tasks = [], docs = [], files = [] } = $props()

  const review = $derived(computeProjectReview({ tasks, docs, files }, new Date()))
</script>

<section class="mt-8">
  <h2 class="mb-2 text-lg font-bold">بازبینی</h2>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold">{faNum(review.todo)}</span>
        <span class="text-sm opacity-70">کار باز</span>
      </div>
    </div>
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold">{faNum(review.doing)}</span>
        <span class="text-sm opacity-70">کار در حال انجام</span>
      </div>
    </div>
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold">{faNum(review.done)}</span>
        <span class="text-sm opacity-70">کار تمام‌شده</span>
      </div>
    </div>
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold {review.overdue > 0 ? 'text-error' : ''}">{faNum(review.overdue)}</span>
        <span class="text-sm opacity-70">کار عقب‌مانده</span>
      </div>
    </div>
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold">{faNum(review.docs)}</span>
        <span class="text-sm opacity-70">سند</span>
      </div>
    </div>
    <div class="card glass-card">
      <div class="card-body items-center py-4 text-center">
        <span class="text-2xl font-bold">{faNum(review.newFiles)}</span>
        <span class="text-sm opacity-70">فایل تازه (۷ روز اخیر)</span>
      </div>
    </div>
  </div>
</section>
