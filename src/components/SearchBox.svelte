<script>
  import { searchWorkspace } from '../lib/work.js'

  let q = $state('')
  let hits = $state(null) // null = not searched yet
  let searching = $state(false)
  let searchError = $state('')
  let partialErrors = $state([])

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
  <p class="mt-1 text-xs opacity-50">جست‌وجو در عنوان سند است، نه در متن آن (متن سند در حالت Yjs ذخیره می‌شود).</p>
  {#if searchError}
    <p class="mt-1 text-xs text-error">{searchError}</p>
  {/if}
  {#if partialErrors.length > 0}
    <p class="mt-1 text-xs text-warning">
      جست‌وجو در {partialErrors.map((p) => p.source).join(' و ')} کامل نشد؛ نتیجه‌های
      دیگر نشان داده شده‌اند.
    </p>
  {/if}
  {#if hits !== null}
    {#if hits.length === 0}
      <p class="mt-2 text-sm opacity-60">چیزی پیدا نشد.</p>
    {:else}
      <ul class="mt-2 flex flex-col gap-1">
        {#each hits as h (h.kind + '-' + h.id)}
          <li>
            <a href={h.link} class="block rounded-xl bg-base-100 px-3 py-2 text-sm hover:bg-base-300">
              <span class="font-bold">{h.kindLabel}</span>
              <span class="opacity-60"> · {h.place}</span>
              <span class="block truncate opacity-90">{h.title}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
