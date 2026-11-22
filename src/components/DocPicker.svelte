<script>
  import { ws } from '../lib/store.svelte.js'

  // Phase 1 (فاز ۱ پلن کمبودها): custom doc picker replacing the native
  // <select> for the doc link target — the native select repeatedly
  // threw browser errors during the live AIM entry. Room targets keep
  // the native select; only the DOC target is custom.
  //
  // Props: linkId (selected doc id or ''), onSelect(id), disabled.
  // Menu lists the current project's docs, newest updated first.
  let { linkId = '', onSelect, disabled = false } = $props()

  let open = $state(false)
  let focusIndex = $state(-1)

  const sortedDocs = $derived(
    [...ws.docs].sort(
      (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    )
  )
  const selectedDoc = $derived(ws.docs.find((d) => d.id === linkId) || null)

  function fmtDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('fa-IR')
  }

  function toggle() {
    if (disabled) return
    open = !open
    focusIndex = open ? sortedDocs.findIndex((d) => d.id === linkId) : -1
  }

  function close() {
    open = false
    focusIndex = -1
  }

  function pick(id) {
    onSelect(id)
    close()
  }

  function clear() {
    onSelect('')
    close()
  }

  function onToggleKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        open = true
        focusIndex = sortedDocs.findIndex((d) => d.id === linkId)
        if (focusIndex < 0) focusIndex = 0
      } else if (e.key === 'Enter' && focusIndex >= 0 && sortedDocs[focusIndex]) {
        pick(sortedDocs[focusIndex].id)
      }
    } else if (e.key === 'Escape') {
      close()
    }
  }

  function onMenuKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusIndex = Math.min(focusIndex + 1, sortedDocs.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusIndex = Math.max(focusIndex - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (focusIndex >= 0 && sortedDocs[focusIndex]) pick(sortedDocs[focusIndex].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
</script>

<div class="doc-picker relative min-w-0 flex-1">
  {#if open}
    <!-- outside-click closer (plain button overlay; works in jsdom too) -->
    <button
      type="button"
      aria-hidden="true"
      tabindex="-1"
      class="fixed inset-0 z-10 cursor-default"
      onclick={close}
    ></button>
  {/if}
  <div class="relative z-20 flex gap-1">
    <button
      type="button"
      class="btn btn-sclack min-h-11 flex-1 justify-between bg-base-100 font-normal"
      aria-haspopup="listbox"
      aria-expanded={open}
      {disabled}
      onclick={toggle}
      onkeydown={onToggleKey}
    >
      <span class="min-w-0 flex-1 truncate text-start {selectedDoc ? '' : 'opacity-60'}">
        {selectedDoc ? selectedDoc.title : 'انتخاب سند'}
      </span>
      <span aria-hidden="true" class="shrink-0 opacity-60">{open ? '▲' : '▼'}</span>
    </button>
    {#if selectedDoc}
      <button
        type="button"
        class="doc-picker-clear btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
        aria-label="پاک‌کردن پیوند"
        title="پاک‌کردن پیوند"
        {disabled}
        onclick={clear}
      >
        ×
      </button>
    {/if}
  </div>
  {#if open}
    <ul
      role="listbox"
      class="doc-picker-menu menu absolute z-20 mt-1 w-full rounded-box bg-base-100 p-2 shadow-lg"
      onkeydown={onMenuKey}
    >
      {#if sortedDocs.length === 0}
        <li class="px-3 py-2 text-sm opacity-60">سندی نیست — اول یک سند بسازید.</li>
      {:else}
        {#each sortedDocs as d, i (d.id)}
          <li role="option" aria-selected={d.id === linkId}>
            <button
              type="button"
              class="doc-picker-item min-h-11 {d.id === linkId ? 'bg-amber-100 font-bold' : ''} {focusIndex === i ? 'bg-base-300' : ''}"
              onclick={() => pick(d.id)}
            >
              <span class="min-w-0 flex-1 truncate text-start">{d.title}</span>
              {#if d.updated_at}
                <span class="shrink-0 text-xs opacity-60">{fmtDate(d.updated_at)}</span>
              {/if}
            </button>
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>
