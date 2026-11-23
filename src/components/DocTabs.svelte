<!-- نوار تب‌های سند — D-UX6 الف (چند تب باز مثل نوشن).
     بالای ناحیهٔ ویرایشگر می‌نشیند (نه در سایدبار). بازکردن سند تازه
     تب تازه می‌سازد؛ تپ روی تب جابه‌جا می‌شود بدون رفرش؛ بستن تب سند
     را نمی‌بندد، فقط تب را می‌بندد. تب فعال مات سفید با خط زیرین
     جیگری است. -->
<script>
  import { ws } from '../lib/store.svelte.js'
  import { closeDocTab, openDocTab } from '../lib/tabs.js'

  let { currentDocId = null } = $props()

  function titleOf(id) {
    return (
      ws.docTabs.find((t) => t.id === id)?.title ||
      ws.docs.find((d) => d.id === id)?.title ||
      'سند'
    )
  }

  function activate(id) {
    if (id !== currentDocId) location.hash = '#/doc/' + id
  }

  function closeTab(id, ev) {
    ev.stopPropagation()
    const next = closeDocTab(id)
    if (id === currentDocId) location.hash = next ? '#/doc/' + next : '#/'
  }

  // «+» انتهای نوار: تب تازه از همان صفحه‌ای که روی آن هستی (مثل نوشن).
  function newTab() {
    if (!currentDocId) return
    openDocTab(currentDocId, titleOf(currentDocId))
  }
</script>

<div class="glass-mild doc-tabs" data-doc-tabs role="tablist" aria-label="سندهای باز">
  {#if ws.docTabs.length === 0}
    <p class="py-2 text-xs opacity-60">سندی باز نیست — از سایدبار باز کنید</p>
  {:else}
    {#each ws.docTabs as t (t.id)}
      <div
        role="tab"
        tabindex="0"
        aria-selected={t.id === currentDocId}
        data-doc-tab={t.id}
        class="doc-tab {t.id === currentDocId ? 'doc-tab-active' : ''}"
        onclick={() => activate(t.id)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activate(t.id)
          }
        }}
      >
        <span class="doc-tab-title">{t.title}</span>
        <button
          type="button"
          class="doc-tab-close"
          data-doc-tab-close={t.id}
          aria-label="بستن تب «{t.title}»"
          onclick={(e) => closeTab(t.id, e)}
        >
          ×
        </button>
      </div>
    {/each}
  {/if}
  <button
    type="button"
    class="doc-tab-new"
    data-doc-tab-new
    aria-label="تب تازه"
    title="تب تازه (Ctrl+T)"
    disabled={!currentDocId}
    onclick={newTab}
  >
    +
  </button>
</div>
