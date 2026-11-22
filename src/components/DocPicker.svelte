<script>
  import { tick } from 'svelte'
  import { ws } from '../lib/store.svelte.js'

  // Phase 1 (فاز ۱ پلن کمبودها): custom doc picker replacing the native
  // <select> for the doc link target — the native select repeatedly
  // threw browser errors during the live AIM entry. Room targets keep
  // the native select; only the DOC target is custom.
  //
  // 0.11.2 fix-up (live entry pass, 2026-11-22 ~00:16 — all 39 AIM tasks
  // linked, 3 real defects found in the picker):
  // 1) The menu was trapped inside the edit form's stacking context:
  //    `.task-edit-form` keeps `transform: translateY(0)` (animation
  //    fill `both`), so the form is a transformed ancestor and the
  //    menu's z-20 never escaped the card — following task cards
  //    (position:relative, later in DOM) painted above it, and mouse
  //    clicks and wheel events landed on them instead of the menu.
  //    Fix: the menu (and the outside-click overlay) are portaled to
  //    document.body and positioned `fixed` under the toggle button,
  //    so no ancestor can clip or cover them. Repositioned on scroll /
  //    resize; closes if the toggle scrolls out of view.
  // 2) Wheel scroll inside the menu scrolled the page instead — same
  //    root cause (events hit the covering cards) plus missing scroll
  //    containment: the menu now has `overscroll-behavior: contain`
  //    (in .doc-picker-menu, app.css).
  // 3) ArrowDown from the toggle button did nothing once the menu was
  //    open (onToggleKey only handled it while closed). Keyboard is
  //    now roving-tabindex: the toggle is the only tab stop; ArrowDown
  //    / ArrowUp move DOM focus between options (focusIndex always
  //    matches the focused option), Enter/Space picks it, Tab closes
  //    without picking, Escape closes and returns focus to the toggle.
  //    A silent wrong pick via Tab is impossible (defect 5).
  //
  // Props: linkId (selected doc id or ''), onSelect(id), disabled.
  // Menu lists the current project's docs, newest updated first.
  let { linkId = '', onSelect, disabled = false } = $props()

  let open = $state(false)
  let focusIndex = $state(-1)
  let toggleEl = $state(null)
  let menuEl = $state(null)

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

  // --- portal: move the node to document.body on mount. Svelte removes
  // it again when the {#if} block unmounts (destroy is a no-op then).
  function portal(node) {
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
      }
    }
  }

  function positionMenu() {
    if (!menuEl || !toggleEl) return
    menuEl.style.position = 'fixed'
    menuEl.style.zIndex = '60'
    const r = toggleEl.getBoundingClientRect()
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    // jsdom reports a 0x0 rect — fall back to a harmless position.
    const width = r.width || 320
    const left = Math.max(8, Math.min(r.left || 8, vw - width - 8))
    const menuH = Math.min(menuEl.offsetHeight || 240, 240)
    menuEl.style.width = width + 'px'
    menuEl.style.left = left + 'px'
    if (r.bottom && r.bottom + 4 + menuH > vh && r.top - 4 - menuH >= 0) {
      menuEl.style.top = r.top - 4 - menuH + 'px'
    } else {
      menuEl.style.top = (r.bottom || 0) + 4 + 'px'
    }
  }

  function onScrollOrResize() {
    if (!open || !toggleEl) return
    const r = toggleEl.getBoundingClientRect()
    if (r.bottom < 0 || r.top > (window.innerHeight || 768)) {
      close()
      return
    }
    positionMenu()
  }

  function openMenu(focusFirst) {
    if (disabled) return
    open = true
    focusIndex = sortedDocs.findIndex((d) => d.id === linkId)
    if (focusIndex < 0) focusIndex = focusFirst ? 0 : -1
    tick().then(() => {
      positionMenu()
      if (focusFirst) focusOption(focusIndex)
    })
  }

  function close() {
    open = false
    focusIndex = -1
  }

  function pick(id) {
    onSelect(id)
    close()
    toggleEl?.focus()
  }

  function clear() {
    onSelect('')
    close()
    toggleEl?.focus()
  }

  // Keep the highlighted option in view. Plain offset math (not
  // scrollIntoView): jsdom has no layout, so this is a no-op there and
  // correct in real browsers.
  function ensureVisible(btn) {
    if (!menuEl || !btn) return
    const top = btn.offsetTop
    const bottom = top + (btn.offsetHeight || 0)
    if (top < menuEl.scrollTop) menuEl.scrollTop = top
    else if (bottom > menuEl.scrollTop + (menuEl.clientHeight || 0)) {
      menuEl.scrollTop = bottom - (menuEl.clientHeight || 0)
    }
  }

  function focusOption(i) {
    if (sortedDocs.length === 0 || !menuEl) return
    focusIndex = Math.max(0, Math.min(i, sortedDocs.length - 1))
    const btn = menuEl.querySelectorAll('.doc-picker-item')[focusIndex]
    if (btn) {
      btn.focus()
      ensureVisible(btn)
    }
  }

  function toggle() {
    if (disabled) return
    if (open) close()
    else openMenu(false)
  }

  function onToggleKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openMenu(true)
      else focusOption(focusIndex < 0 ? 0 : focusIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) focusOption(focusIndex <= 0 ? 0 : focusIndex - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) openMenu(true)
      else if (focusIndex >= 0 && sortedDocs[focusIndex]) pick(sortedDocs[focusIndex].id)
      else close()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  function onMenuKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusOption(focusIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusOption(focusIndex - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (focusIndex >= 0 && sortedDocs[focusIndex]) pick(sortedDocs[focusIndex].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      toggleEl?.focus()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  // While the menu is open, keep it glued under the toggle on scroll /
  // resize, and close it if the toggle scrolls out of view.
  $effect(() => {
    if (!open) return
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  })
</script>

<div class="doc-picker relative min-w-0 flex-1">
  {#if open}
    <!-- outside-click closer (plain button overlay; works in jsdom too).
         Portaled with the menu: a transformed ancestor (.task-edit-form)
         would otherwise contain `fixed` positioning to the form, so the
         overlay would only cover the form instead of the viewport. -->
    <button
      type="button"
      aria-hidden="true"
      tabindex="-1"
      class="fixed inset-0 z-40 cursor-default"
      use:portal
      onclick={close}
    ></button>
  {/if}
  <div class="relative z-20 flex gap-1">
    <button
      type="button"
      bind:this={toggleEl}
      class="btn btn-sclack min-h-11 flex-1 justify-between bg-base-100 font-normal"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-activedescendant={open && focusIndex >= 0 && sortedDocs[focusIndex]
        ? 'doc-picker-opt-' + sortedDocs[focusIndex].id
        : undefined}
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
    <!-- Portaled to document.body (see the header comment): no ancestor
         stacking context or overflow can clip or cover the menu. It is
         positioned `fixed` under the toggle by positionMenu(); the
         `absolute`/`z-20` classes are gone on purpose — inline styles
         own the position now. -->
    <ul
      role="listbox"
      bind:this={menuEl}
      use:portal
      class="doc-picker-menu menu w-full rounded-box bg-base-100 p-2 shadow-lg"
      onkeydown={onMenuKey}
    >
      {#if sortedDocs.length === 0}
        <li class="px-3 py-2 text-sm opacity-60">سندی نیست — اول یک سند بسازید.</li>
      {:else}
        {#each sortedDocs as d, i (d.id)}
          <li role="option" aria-selected={d.id === linkId}>
            <button
              type="button"
              id={'doc-picker-opt-' + d.id}
              tabindex="-1"
              class="doc-picker-item min-h-11 {d.id === linkId ? 'bg-amber-100 font-bold' : ''} {focusIndex === i ? 'bg-base-300' : ''}"
              onfocus={() => (focusIndex = i)}
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
