<script>
  import { ws } from '../lib/store.svelte.js'
  import { RULE_CHAPTERS, rulesByChapter, rulesForSection, unmappedRules } from '../lib/rules-aim.js'

  let { docRow } = $props()

  const rules = docRow.custom_fields.rules || []
  const byChapter = rulesByChapter(rules)
  const unmapped = unmappedRules(rules)

  let chapterFilter = $state('all') // all | الف | ب | ج | د
  let sectionFilter = $state('all') // all | 0 (سراسری) | 1..13 | unmapped

  // سند بخش N در همین پروژه: عنوانش با «بخش N» شروع می‌شود.
  function sectionDocLink(section) {
    if (section === 0 || section === 'unmapped') return null
    const doc = (ws.docs || []).find(
      (d) => d.project_id === docRow.project_id && (d.title || '').startsWith('بخش ' + section)
    )
    return doc ? '#/doc/' + doc.id : null
  }

  function sectionLabel(section) {
    if (section === 0) return 'سراسری'
    return 'بخش ' + section
  }

  let visibleRules = $derived.by(() => {
    let list = rules
    if (sectionFilter === 'unmapped') list = unmapped
    else if (sectionFilter !== 'all') list = rulesForSection(Number(sectionFilter), rules)
    if (chapterFilter !== 'all') list = list.filter((r) => r.chapter === chapterFilter)
    return list
  })
</script>

<div class="mx-auto max-w-3xl p-4">
  <div class="mb-4 rounded-xl border border-[var(--line)] bg-[var(--paper-soft)] p-3 text-sm">
    <p>
      {rules.length} قانون اجرای AIM در ۴ فصل (الف {byChapter['الف']?.length || 0} · ب
      {byChapter['ب']?.length || 0} · ج {byChapter['ج']?.length || 0} · د
      {byChapter['د']?.length || 0}).
    </p>
    <p class="mt-1 text-[var(--ink-soft)]">
      آستانه‌های عددی (مثل «۱۰ مصاحبه»، «۳ نفر عاشق») پیشنهاد نگاشت به AIM‌اند، نه نقل‌قول ویدیو؛
      فرمول ریاضی بقوسیان (R-B7) تایید نشده و فقط کیفی به کار می‌رود.
    </p>
    {#if unmapped.length > 0}
      <p class="mt-1 text-[var(--ink-soft)]">
        {unmapped.length} قانون در سند طرح به بخشی نگاشت نشده‌اند
        ({unmapped.map((r) => r.code).join('، ')}) — تعیین بخششان با یاسین است.
      </p>
    {/if}
  </div>

  <div class="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="پالایش قوانین">
    <select class="input-sclack" aria-label="فصل" bind:value={chapterFilter}>
      <option value="all">همهٔ فصل‌ها</option>
      {#each Object.entries(RULE_CHAPTERS) as [key, ch]}
        <option value={key}>{ch.title}</option>
      {/each}
    </select>
    <select class="input-sclack" aria-label="بخش طرح" bind:value={sectionFilter}>
      <option value="all">همهٔ بخش‌ها</option>
      <option value="0">سراسری</option>
      {#each Array.from({ length: 13 }, (_, i) => i + 1) as n}
        <option value={String(n)}>بخش {n}</option>
      {/each}
      <option value="unmapped">بدون نگاشت</option>
    </select>
    <span class="text-sm text-[var(--ink-soft)]">{visibleRules.length} قانون</span>
  </div>

  {#each visibleRules as rule (rule.code)}
    <article class="mb-3 rounded-xl border border-[var(--line)] bg-white p-4">
      <div class="mb-1 flex flex-wrap items-baseline gap-2">
        <span class="rounded bg-[var(--jigari-soft)] px-2 py-0.5 text-sm font-bold text-[var(--jigari)]">
          {rule.code}
        </span>
        <h2 class="text-base font-bold">{rule.title}</h2>
      </div>
      <p class="text-sm leading-7">{rule.text}</p>
      <dl class="mt-2 text-xs text-[var(--ink-soft)]">
        <div class="flex gap-1">
          <dt class="shrink-0 font-bold">ماشه:</dt>
          <dd>{rule.trigger}</dd>
        </div>
        <div class="mt-1 flex gap-1">
          <dt class="shrink-0 font-bold">معیار انجام‌شدن:</dt>
          <dd>{rule.criterion}</dd>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <dt class="shrink-0 font-bold">بخش:</dt>
          {#if rule.sections.length === 0}
            <dd>بدون نگاشت</dd>
          {:else}
            {#each rule.sections as s}
              {#if sectionDocLink(s)}
                <dd><a href={sectionDocLink(s)} class="text-[var(--jigari)] underline">{sectionLabel(s)}</a></dd>
              {:else}
                <dd>{sectionLabel(s)}</dd>
              {/if}
            {/each}
          {/if}
          <dd class="ms-2">· {RULE_CHAPTERS[rule.chapter]?.source || ''}</dd>
        </div>
      </dl>
    </article>
  {:else}
    <p class="text-sm opacity-60">قانونی با این پالایش نیست.</p>
  {/each}
</div>
