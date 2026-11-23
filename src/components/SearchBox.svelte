<script>
  import { searchWorkspace } from '../lib/work.js'

  let q = $state('')
  let hits = $state(null) // null = not searched yet
  let searching = $state(false)
  let searchError = $state('')
  let partialErrors = $state([])

  // فاز ۳ — نشان هم‌خوانی روی نتیجهٔ سند (مشخصات گرافیکی).
  const MATCH_BADGE = {
    title: { label: 'در عنوان', cls: 'badge badge-ghost badge-sm', aria: 'هم‌خوانی در عنوان' },
    text: { label: 'در متن', cls: 'badge badge-sm search-match-badge', aria: 'هم‌خوانی در متن' },
    both: { label: 'در عنوان و متن', cls: 'badge badge-sm search-match-badge', aria: 'هم‌خوانی در عنوان و متن' }
  }

  // برجسته‌کردن عبارت در عنوان/تکه: اول escape، بعد <mark> — تکه هرگز
  // HTML خام سند را رندر نمی‌کند (مشخصات گرافیکی، اصل ۳).
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  function highlight(text, query) {
    const clean = String(text || '')
    const needle = String(query || '').trim()
    if (!needle) return escapeHtml(clean)
    const lower = clean.toLowerCase()
    const nLower = needle.toLowerCase()
    let out = ''
    let pos = 0
    let idx
    while ((idx = lower.indexOf(nLower, pos)) >= 0) {
      out +=
        escapeHtml(clean.slice(pos, idx)) +
        '<mark class="search-mark">' +
        escapeHtml(clean.slice(idx, idx + needle.length)) +
        '</mark>'
      pos = idx + needle.length
    }
    return out + escapeHtml(clean.slice(pos))
  }

  async function doSearch() {
    const query = q.trim()
    if (!query || searching) return
    searching = true
    searchError = ''
    partialErrors = []
    try {
      const res = await searchWorkspace(query)
      hits = res
      partialErrors = res.partialErrors || []
    } catch (e) {
      searchError = e.message || String(e)
      hits = []
    } finally {
      searching = false
    }
  }
</script>

<section>
  <h2 class="mb-2 text-sm font-bold opacity-70">جست‌وجوی سراسری</h2>
  <div class="flex gap-2">
    <input
      class="input input-sm input-bordered input-sclack min-w-0 flex-1 bg-base-100"
      placeholder="در پیام، سند، فایل و کار جست‌وجو کنید…"
      bind:value={q}
      onkeydown={(e) => {
        if (e.key === 'Enter') doSearch()
      }}
    />
    <button class="btn btn-sclack btn-sm btn-primary" onclick={doSearch} disabled={searching}>
      جست‌وجو
    </button>
  </div>
  {#if searchError}
    <p class="mt-1 text-xs text-error">{searchError}</p>
  {/if}
  {#if hits !== null}
    {#if hits.length === 0}
      <p class="mt-2 text-sm opacity-60">چیزی پیدا نشد.</p>
    {:else}
      <ul class="mt-2 flex flex-col gap-1" aria-live="polite">
        {#each hits as h (h.kind + '-' + h.id)}
          <li>
            <a href={h.link} class="block min-h-11 rounded-xl bg-base-100 px-3 py-2 text-sm hover:bg-base-300">
              <span class="flex items-center justify-between gap-2">
                <span>
                  <span class="font-bold">{h.kindLabel}</span>
                  <span class="opacity-60"> · {h.place}</span>
                </span>
                {#if h.kind === 'doc' && h.matchIn}
                  <span class={MATCH_BADGE[h.matchIn].cls} aria-label={MATCH_BADGE[h.matchIn].aria}>
                    {MATCH_BADGE[h.matchIn].label}
                  </span>
                {/if}
              </span>
              {#if h.kind === 'doc' && (h.matchIn === 'title' || h.matchIn === 'both')}
                <span class="block truncate opacity-90">{@html highlight(h.title, q)}</span>
              {:else}
                <span class="block truncate opacity-90">{h.title}</span>
              {/if}
              {#if h.snippet}
                <span class="search-snippet mt-0.5 block text-xs opacity-70">{@html highlight(h.snippet, q)}</span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if partialErrors.length > 0}
    <p class="mt-1 text-xs text-warning">
      جست‌وجو در {partialErrors.map((p) => p.source).join(' و ')} کامل نشد؛ نتیجه‌های
      دیگر نشان داده شده‌اند.
    </p>
  {/if}
</section>
