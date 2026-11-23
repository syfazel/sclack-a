<script>
  import { memberName } from '../lib/data.js'
  import { faNum } from '../lib/extract.js'
  import { listVersions, saveVersion, restoreVersion, textFromStateB64 } from '../lib/work.js'

  // Version list for one doc (restore points). Versions are immutable:
  // restore applies a snapshot to the live doc, saves the row, then
  // records a NEW version — nothing is ever updated or deleted.
  let { docRow, ydoc, saveNow } = $props()

  let versions = $state([])
  let loading = $state(true)
  let error = $state('')
  let busy = $state(false)
  let note = $state('')
  let previewId = $state(null)
  let previewText = $state('')

  async function refresh() {
    loading = true
    error = ''
    try {
      versions = await listVersions(docRow.id)
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (docRow?.id) refresh()
  })

  function fmt(iso) {
    return iso ? new Date(iso).toLocaleString('fa-IR') : ''
  }

  async function doSaveVersion() {
    if (busy) return
    busy = true
    error = ''
    try {
      await saveVersion(docRow, ydoc, note)
      note = ''
      await refresh()
    } catch (e) {
      error = e.message || String(e)
    } finally {
      busy = false
    }
  }

  async function doRestore(v) {
    if (busy) return
    if (!confirm('سند به نسخهٔ ' + faNum(v.version_no) + ' برگردد؟ (یک نسخهٔ تازه ساخته می‌شود.)')) return
    busy = true
    error = ''
    try {
      await restoreVersion(docRow, ydoc, v, saveNow)
      await refresh()
    } catch (e) {
      error = e.message || String(e)
    } finally {
      busy = false
    }
  }

  function togglePreview(v) {
    if (previewId === v.id) {
      previewId = null
      previewText = ''
      return
    }
    previewId = v.id
    previewText = textFromStateB64(v.snapshot_ref)
  }
</script>

<section class="mt-8">
  <h2 class="mb-2 text-lg font-bold">نسخه‌ها</h2>
  <p class="mb-2 text-xs opacity-60">
    برگرداندن یک نسخه، خودش یک نسخهٔ تازه می‌سازد؛ هیچ نسخه‌ای پاک نمی‌شود.
  </p>
  <div class="flex gap-2">
    <input
      class="input input-bordered input-sclack min-w-0 flex-1 bg-base-100"
      placeholder="یادداشت نسخه (اختیاری)"
      bind:value={note}
      disabled={busy}
    />
    <button class="btn btn-sclack btn-outline" onclick={doSaveVersion} disabled={busy}>
      ذخیرهٔ نسخه
    </button>
  </div>
  {#if error}
    <p class="mt-2 text-xs text-error">{error}</p>
  {/if}
  {#if loading}
    <p class="mt-3 text-sm opacity-60">در حال بارگذاری…</p>
  {:else if versions.length === 0}
    <p class="mt-3 text-sm opacity-60">هنوز نسخه‌ای نیست — با «ذخیرهٔ نسخه» اولین نقطهٔ بازیابی را بسازید.</p>
  {:else}
    <ul class="mt-3 flex flex-col gap-2">
      {#each versions as v (v.id)}
        <li class="card bg-base-200">
          <div class="card-body gap-1 py-3">
            <div class="flex items-center gap-2">
              <span class="font-bold">نسخهٔ {faNum(v.version_no)}</span>
              <span class="text-xs opacity-60">
                {memberName(v.author_id)} · {fmt(v.created_at)}
              </span>
              <span class="ms-auto flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick={() => togglePreview(v)}>
                  {previewId === v.id ? 'بستن متن' : 'دیدن متن'}
                </button>
                <button class="btn btn-sclack btn-sm btn-primary" onclick={() => doRestore(v)} disabled={busy}>
                  برگرداندن
                </button>
              </span>
            </div>
            {#if v.note}
              <p class="text-sm opacity-70">{v.note}</p>
            {/if}
            {#if previewId === v.id}
              <p class="mt-1 whitespace-pre-wrap rounded-xl bg-base-100 p-3 text-sm">{previewText || '—'}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
