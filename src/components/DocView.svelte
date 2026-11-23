<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { sb } from '../lib/supabase.js'
  import { memberName, loadProjectData } from '../lib/data.js'
  import {
    loadDocRow,
    loadRowStateInto,
    saveDocRow,
    setDocParent,
    loadComments,
    addComment,
    setCommentResolved,
    makeAnchor,
    resolveAnchor
  } from '../lib/docs.js'
  import { docAncestors, moveParentOptions } from '../lib/extract.js'
  import { createYDoc, connectBroadcast, bindTextarea, applyDocState } from '../lib/yjs-sync.js'
  import { renderMdLite, insertMdSnippet } from '../lib/md-lite.js'
  import { isStarred, toggleStarred } from '../lib/starred.js'
  import { openDocTab } from '../lib/tabs.js'
  import { tick } from 'svelte'
  import FileList from './FileList.svelte'
  import VersionsPanel from './VersionsPanel.svelte'

  let { docId } = $props()

  let docRow = $state(null)
  let loadError = $state('')
  let loading = $state(true)

  let textarea = $state(null)
  let ydoc = null
  let ytext = null
  let bc = null
  let rowChannel = null
  let lastSavedB64 = $state(null)
  let saveState = $state('') // '', 'saving', 'saved', 'error'
  let saveTimer = null

  let presenceList = $state([]) // [{ name, cursor }]
  let comments = $state([])
  let commentDraft = $state('')
  let commentError = $state('')
  let commentBusy = $state(false)
  let showResolved = $state(false)

  // Phase 4 (D3, option A — lite Markdown, faz4 spec): read mode is
  // the default; edit mode is the same <textarea> as before plus a
  // small toolbar. The text stays one Y.Text named `content`; the read
  // view re-renders on every Yjs update (local or remote).
  let mode = $state('read') // 'read' | 'edit'
  let renderedHtml = $state('')

  // Wikilinks resolve by title inside THIS project (ws.docs holds the
  // current project's docs); a duplicate title resolves to the most
  // recently updated doc (resolveWikiDoc in md-lite.js).
  function rerender() {
    if (!ytext || !docRow) return
    const projectDocs = (ws.docs || []).filter((d) => d.project_id === docRow.project_id)
    renderedHtml = renderMdLite(ytext.toString(), projectDocs)
  }
  function onYTextChange() {
    rerender()
  }

  function setMode(next) {
    mode = next
    // In read mode there is no caret: clear the stale cursor position
    // from presence instead of showing where the user last typed.
    if (next === 'read' && bc) bc.awareness.setLocalStateField('cursor', null)
  }

  // Toolbar insert: pure syntax via insertMdSnippet, then one 'input'
  // event so the Yjs binding (bindTextarea) applies it to the doc.
  function applyTool(kind) {
    if (!textarea || !ytext) return
    const { text, selStart, selEnd } = insertMdSnippet(
      textarea.value,
      textarea.selectionStart ?? textarea.value.length,
      textarea.selectionEnd ?? textarea.value.length,
      kind
    )
    textarea.value = text
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
    try {
      textarea.setSelectionRange(selStart, selEnd)
    } catch {
      // ignore
    }
  }

  // P01 B3: one-level threading — a reply's parent_id points at a
  // top-level comment; replies render nested under it and have no reply
  // button of their own.
  let replyTo = $state(null)
  const openCount = $derived(comments.filter((c) => !c.resolved).length)
  const topOpen = $derived(comments.filter((c) => !c.parent_id && !c.resolved))
  const topResolved = $derived(comments.filter((c) => !c.parent_id && c.resolved))
  const repliesOf = (id) => comments.filter((c) => c.parent_id === id)

  function refreshPresence() {
    if (!bc) return
    const out = []
    bc.awareness.getStates().forEach((state, clientId) => {
      if (clientId === bc.awareness.clientID) return
      const user = state.user || {}
      out.push({ name: user.name || 'عضو', cursor: state.cursor ?? null })
    })
    presenceList = out
  }

  let lastCursorSent = 0
  function sendCursor() {
    if (!bc || !textarea) return
    const now = Date.now()
    if (now - lastCursorSent < 300) return
    lastCursorSent = now
    bc.awareness.setLocalStateField('cursor', textarea.selectionStart)
  }

  function scheduleSave() {
    saveState = 'saving'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 2000)
  }

  async function flushSave() {
    if (!docRow || !ydoc) return
    clearTimeout(saveTimer)
    try {
      lastSavedB64 = await saveDocRow(docRow, ydoc, lastSavedB64)
      saveState = 'saved'
    } catch (e) {
      saveState = 'error'
      loadError = 'ذخیرهٔ سند ناموفق بود: ' + (e.message || String(e))
    }
  }

  function onDocUpdate(_update, origin) {
    if (!origin) scheduleSave() // only local edits schedule a row save
  }

  // Phase 5 (D4): breadcrumb path (root → parent) and the move picker.
  // The picker lists every doc of this project except this doc and its
  // descendants — those would close a cycle (moveParentOptions).
  const ancestors = $derived(docRow ? docAncestors(ws.docs, docRow.id) : [])
  const parentOptions = $derived(docRow ? moveParentOptions(ws.docs, docRow.id) : [])
  let moveParentId = $state('')
  let moveMsg = $state('')
  let moveMsgKind = $state('') // '' | 'ok' | 'error'
  let moving = $state(false)

  async function doMoveDoc(newParentId) {
    if (!docRow || moving) return
    moving = true
    moveMsg = ''
    moveMsgKind = ''
    try {
      const updated = await setDocParent(docRow, newParentId)
      docRow = updated
      if (newParentId) {
        const p = (ws.docs || []).find((d) => d.id === newParentId)
        moveMsg = 'سند به زیرِ «' + (p ? p.title : 'سند') + '» منتقل شد.'
      } else {
        moveMsg = 'سند به ریشه برگردانده شد.'
      }
      moveMsgKind = 'ok'
      moveParentId = ''
    } catch (e) {
      moveMsg = e.message || String(e)
      moveMsgKind = 'error'
    } finally {
      moving = false
    }
  }

  async function init() {
    loading = true
    loadError = ''
    moveParentId = ''
    moveMsg = ''
    moveMsgKind = ''
    try {
      docRow = await loadDocRow(docId)
    } catch (e) {
      loadError = 'سند پیدا نشد: ' + (e.message || String(e))
      loading = false
      return
    }
    const { doc, text } = createYDoc()
    ydoc = doc
    ytext = text
    await loadRowStateInto(docRow, ydoc)
    lastSavedB64 = null
    // D-UX6: بازکردن سند، تب آن را می‌سازد/فعال می‌کند (با عنوان واقعی).
    openDocTab(docRow.id, docRow.title)
    // If this doc belongs to another project than the one selected (deep
    // link / reload on #/doc/...), sync the workspace to the doc's project
    // so the sidebar lists and file list show this project's rows.
    if (docRow.project_id && ws.currentProjectId !== docRow.project_id) {
      ws.currentProjectId = docRow.project_id
      await loadProjectData(docRow.project_id)
    }
    bc = connectBroadcast(ydoc, docRow.yjs_doc_id, {
      name: auth.member?.name || 'عضو'
    })
    bc.awareness.on('change', refreshPresence)
    refreshPresence()
    ydoc.on('update', onDocUpdate)
    // Phase 4: re-render the read view on every Yjs update (local or
    // remote — ytext.observe fires for both).
    ytext.observe(onYTextChange)
    rerender()
    // NOTE: the textarea is NOT bound here. It only renders after
    // `loading` turns false below, so `textarea` is still null at this
    // point — binding here silently never happened (D6 bug 1: typed text
    // never reached the Yjs doc). The bind effect below binds it once
    // it is actually mounted.
    // Remote row saves (another browser) arrive here and merge in.
    if (sb) {
      rowChannel = sb
        .channel('doc-row-' + docRow.id, { config: { private: true } })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'docs', filter: `id=eq.${docRow.id}` },
          (payload) => {
            const b64 = payload.new?.custom_fields?.yjs_state_b64
            if (b64 && b64 !== lastSavedB64 && ydoc) {
              applyDocState(ydoc, b64, 'row')
            }
          }
        )
        .subscribe()
    }
    try {
      comments = await loadComments(docRow.id)
    } catch (e) {
      commentError = 'بارگذاری نظرها ناموفق بود: ' + (e.message || String(e))
    }
    loading = false
  }

  function cleanup() {
    clearTimeout(saveTimer)
    if (ydoc && docRow) {
      // Best effort: flush pending edits before leaving (fire and forget).
      // saveDocRow skips the write when nothing changed, so this is cheap.
      flushSave()
    }
    if (ydoc) ydoc.off('update', onDocUpdate)
    if (ytext) ytext.unobserve(onYTextChange)
    if (bc) {
      bc.awareness.off('change', refreshPresence)
      bc.destroy()
      bc = null
    }
    if (rowChannel && sb) {
      sb.removeChannel(rowChannel)
      rowChannel = null
    }
    ydoc = null
    ytext = null
    docRow = null
    presenceList = []
    comments = []
    lastSavedB64 = null
  }

  // (Re)initialise whenever the route doc changes.
  $effect(() => {
    const id = docId
    let cancelled = false
    ;(async () => {
      await init()
      if (cancelled) cleanup()
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  })

  // Bind the textarea to the Yjs text once the textarea is actually
  // mounted. It only renders after `loading` turns false in init(), so
  // binding inside init() (when `textarea` is still null) silently never
  // happened — that was D6 bug 1. This effect re-runs when `textarea`
  // mounts/unmounts; its cleanup unbinds.
  $effect(() => {
    if (!textarea || !ydoc || !ytext) return
    textarea.value = ytext.toString()
    const unbind = bindTextarea(textarea, ytext, ydoc)
    return () => unbind()
  })

  function onBeforeUnload() {
    flushSave()
  }

  // Save on tab hide / close so edits are not stuck in memory.
  $effect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushSave()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVis)
    }
  })

  async function doAddComment() {
    if (commentBusy || !docRow || !ytext) return
    commentBusy = true
    commentError = ''
    try {
      let anchor = null
      if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
        anchor = makeAnchor(ytext, ydoc, textarea.selectionStart, textarea.selectionEnd)
      }
      const row = await addComment(docRow.id, commentDraft, anchor, replyTo?.id)
      comments = [...comments, row]
      commentDraft = ''
      replyTo = null
    } catch (e) {
      commentError = e.message || String(e)
    } finally {
      commentBusy = false
    }
  }

  async function doResolve(c, resolved) {
    try {
      await setCommentResolved(c.id, resolved)
      comments = comments.map((x) => (x.id === c.id ? { ...x, resolved } : x))
    } catch (e) {
      commentError = e.message || String(e)
    }
  }

  // Phase 4 decision (recorded): comments and presence need the
  // textarea, so «رفتن به محل» first switches to edit mode and only
  // then moves the caret there. A comment added while in read mode has
  // no selection to anchor to, so it is stored without an anchor
  // (doAddComment already guards `textarea` for that).
  async function goToAnchor(c) {
    if (!ytext || !ydoc) return
    if (mode === 'read') {
      setMode('edit')
      await tick()
      await tick()
    }
    if (!textarea) return
    const pos = resolveAnchor(ydoc, c.anchor)
    if (!pos) return
    textarea.focus()
    try {
      textarea.setSelectionRange(pos.start, pos.end)
    } catch {
      // ignore
    }
  }

  // ستارهٔ سند (D-UX5): تپ → علاقه‌مندی؛ تپ دوباره → برمی‌گردد.
  async function doToggleDocStar() {
    if (!docRow) return
    try {
      docRow = await toggleStarred('docs', docRow)
    } catch (e) {
      loadError = 'ستاره ناموفق بود: ' + (e.message || String(e))
    }
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleDateString('fa-IR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return ''
    }
  }
</script>

<div class="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
  <div class="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
    {#if loading}
      <p class="px-4 py-6 text-sm opacity-60">در حال بارگذاری سند…</p>
    {:else if loadError && !docRow}
      <div class="px-4 py-6">
        <div class="alert alert-error"><span>{loadError}</span></div>
        <a href="#/" class="btn btn-ghost btn-sm mt-4">بازگشت به خانه</a>
      </div>
    {:else if docRow}
      <header class="doc-page border-b border-base-300 px-4 py-3">
        <!-- Phase 5: breadcrumb — the parent chain up to this doc. -->
        {#if ancestors.length > 0}
          <nav class="doc-breadcrumb mb-1 text-xs" data-doc-breadcrumb aria-label="مسیر سند">
            {#each ancestors as a}
              <a href="#/doc/{a.id}" class="doc-breadcrumb-link">{a.title}</a>
              <span aria-hidden="true"> ‹ </span>
            {/each}
            <span aria-current="page">{docRow.title}</span>
          </nav>
        {/if}
        <div class="flex items-center gap-2">
          <h1 class="min-w-0 flex-1 truncate text-lg font-bold">{docRow.title}</h1>
          {#if docRow.visibility === 'personal'}
            <span class="badge badge-sm search-match-badge shrink-0">خصوصی — فقط شما</span>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-sm shrink-0 {isStarred(docRow) ? 'text-jigari' : ''}"
            data-doc-star
            aria-pressed={isStarred(docRow)}
            aria-label={isStarred(docRow)
              ? 'برداشتن «' + docRow.title + '» از علاقه‌مندی‌ها'
              : 'افزودن «' + docRow.title + '» به علاقه‌مندی‌ها'}
            onclick={doToggleDocStar}
          >
            {isStarred(docRow) ? '★' : '☆'}
          </button>
        </div>
        <!-- Phase 4 (faz4 spec §1): joined read/edit toggle, read active
             by default; min 44px touch target, aria-pressed. -->
        <div class="doc-mode-toggle join mt-2" data-mode-toggle role="group" aria-label="حالت نمایش سند">
          <button
            type="button"
            class="btn join-item min-h-11 {mode === 'read' ? 'btn-primary' : 'btn-ghost'}"
            data-mode="read"
            aria-pressed={mode === 'read'}
            onclick={() => setMode('read')}
          >
            خواندن
          </button>
          <button
            type="button"
            class="btn join-item min-h-11 {mode === 'edit' ? 'btn-primary' : 'btn-ghost'}"
            data-mode="edit"
            aria-pressed={mode === 'edit'}
            onclick={() => setMode('edit')}
          >
            ویرایش
          </button>
        </div>
        <p class="mt-2 text-xs opacity-70">
          {#if presenceList.length > 0}
            {#each presenceList as p, i}
              {p.name}{p.cursor !== null ? ' · نویسهٔ ' + p.cursor : ''}{i < presenceList.length - 1
                ? '، '
                : ''}
            {/each}
          {:else}
            فقط شما در این سند هستید
          {/if}
          {#if saveState === 'saving'}
            <span class="text-warning"> — در حال ذخیره…</span>
          {:else if saveState === 'saved'}
            <span class="text-success"> — ذخیره شد</span>
          {:else if saveState === 'error'}
            <span class="text-error"> — ذخیره ناموفق بود</span>
          {/if}
        </p>
        <p class="mt-1 text-xs opacity-50">
          همگام‌سازی زنده بین تب‌های همین مرورگر است؛ بین مرورگرهای مختلف با
          ذخیرهٔ ردیف (هر ۲ ثانیه) همگام می‌شود.
        </p>
        <!-- Phase 5: move this doc under another doc, or back to the root. -->
        <div class="doc-move mt-3 flex flex-wrap items-center gap-2" data-doc-move>
          <label class="text-xs opacity-70" for="doc-move-parent">انتقال به زیرِ سندِ…</label>
          <select
            id="doc-move-parent"
            class="select select-sm select-bordered bg-base-100"
            bind:value={moveParentId}
            data-move-parent
            disabled={moving}
          >
            <option value="">— انتخاب والد —</option>
            {#each parentOptions as opt (opt.id)}
              <option value={opt.id}>{opt.title}</option>
            {/each}
          </select>
          <button
            type="button"
            class="btn btn-ghost btn-sm min-h-11"
            data-move-apply
            disabled={!moveParentId || moving}
            onclick={() => doMoveDoc(moveParentId)}
          >
            انتقال
          </button>
          {#if docRow.parent_id}
            <button
              type="button"
              class="btn btn-ghost btn-sm min-h-11"
              data-move-root
              disabled={moving}
              onclick={() => doMoveDoc(null)}
            >
              برگرداندن به ریشه
            </button>
          {/if}
          {#if moveMsg}
            <p
              class="w-full text-xs {moveMsgKind === 'error'
                ? 'text-error'
                : 'text-success'}"
              data-move-msg
            >
              {moveMsg}
            </p>
          {/if}
        </div>
      </header>
      {#if mode === 'read'}
        <div class="doc-fade doc-page min-h-0 flex-1 px-4 py-3">
          {#if renderedHtml}
            <div class="doc-read" data-doc-read>{@html renderedHtml}</div>
          {:else}
            <p class="text-base leading-8 opacity-50">
              سند خالی است — برای نوشتن «ویرایش» را بزنید.
            </p>
          {/if}
        </div>
      {:else}
        <div class="doc-fade doc-page min-h-0 flex-1 px-4 py-3">
          <!-- Phase 4 toolbar (faz4 spec §5): text labels, not icons
               only; after insert, focus returns to the textarea. -->
          <div class="doc-toolbar mb-2" role="toolbar" aria-label="ابزار ویرایش سند">
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="h1" aria-label="درج عنوان" onclick={() => applyTool('h1')}>عنوان</button>
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="bold" aria-label="پررنگ کردن" onclick={() => applyTool('bold')}>پررنگ</button>
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="italic" aria-label="کج کردن" onclick={() => applyTool('italic')}>کج</button>
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="list" aria-label="درج فهرست" onclick={() => applyTool('list')}>فهرست</button>
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="table" aria-label="درج جدول" onclick={() => applyTool('table')}>جدول</button>
            <button type="button" class="btn btn-ghost btn-sm min-h-11" data-md-tool="wikilink" aria-label="درج پیوند به سند" onclick={() => applyTool('wikilink')}>پیوند به سند</button>
          </div>
          <textarea
            bind:this={textarea}
            class="textarea textarea-bordered h-full min-h-96 w-full resize-y bg-base-100 text-base leading-8"
            placeholder="اینجا بنویسید…"
            onkeyup={sendCursor}
            onclick={sendCursor}
            onselect={sendCursor}
          ></textarea>
        </div>
      {/if}
      {#if loadError}
        <p class="px-4 pb-3 text-xs text-error">{loadError}</p>
      {/if}
      <div class="border-t border-base-300 px-4 py-4">
        <FileList projectId={docRow.project_id} attachedTo={{ type: 'doc', id: docRow.id }} />
      </div>
      <div class="border-t border-base-300 px-4 py-4">
        {#if ydoc}
          <VersionsPanel docRow={docRow} {ydoc} saveNow={flushSave} />
        {/if}
      </div>
    {/if}
  </div>

  <!-- Comments -->
  {#if docRow}
    <aside
      class="w-full shrink-0 border-t border-base-300 bg-base-200 px-4 py-4 md:w-80 md:overflow-y-auto md:border-t-0 md:border-s"
    >
      {#snippet commentCard(c, nested)}
        <li
          class="rounded-xl bg-base-100 px-3 py-2 shadow-sm {nested
            ? 'ms-4 border-s-2 border-base-300'
            : ''} {c.resolved ? 'opacity-70' : ''}"
        >
          <div class="mb-0.5 flex items-baseline gap-2 text-xs opacity-70">
            <span class="font-medium">{memberName(c.author_id)}</span>
            <span>{fmtTime(c.created_at)}</span>
          </div>
          {#if c.anchor?.quote}
            <p class="mb-1 rounded bg-base-200 px-2 py-1 text-xs opacity-80">
              «{c.anchor.quote}»
            </p>
          {/if}
          <p class="whitespace-pre-wrap break-words text-sm leading-6">{c.body}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#if c.anchor?.quote}
              <button class="btn btn-ghost btn-xs" onclick={() => goToAnchor(c)}>
                رفتن به محل
              </button>
            {/if}
            {#if !nested}
              <button class="btn btn-ghost btn-xs" onclick={() => (replyTo = c)}>
                پاسخ
              </button>
            {/if}
            <button class="btn btn-ghost btn-xs" onclick={() => doResolve(c, !c.resolved)}>
              {c.resolved ? 'باز کردن دوباره' : 'حل‌شده'}
            </button>
          </div>
          {#if !nested}
            <ul class="mt-2 flex flex-col gap-2">
              {#each repliesOf(c.id) as r (r.id)}
                {@render commentCard(r, true)}
              {/each}
            </ul>
          {/if}
        </li>
      {/snippet}

      <h2 class="mb-2 text-sm font-bold opacity-70">نظرها ({openCount} باز)</h2>
      <div class="flex flex-col gap-2">
        {#if replyTo}
          <p class="rounded bg-base-100 px-2 py-1 text-xs opacity-80">
            پاسخ به {memberName(replyTo.author_id)}: «{(replyTo.body || '').slice(0, 60)}»
            <button class="btn btn-ghost btn-xs" onclick={() => (replyTo = null)}>لغو</button>
          </p>
        {/if}
        <textarea
          class="textarea textarea-bordered w-full bg-base-100"
          rows="2"
          placeholder="نظر بنویسید… (اگر متنی در سند انتخاب کرده باشید، نظر به همان بخش می‌چسبد)"
          bind:value={commentDraft}
        ></textarea>
        {#if commentError}
          <p class="text-xs text-error">{commentError}</p>
        {/if}
        <button class="btn btn-sclack btn-primary" onclick={doAddComment} disabled={commentBusy}>
          {commentBusy ? '…' : replyTo ? 'ثبت پاسخ' : 'ثبت نظر'}
        </button>
      </div>

      <ul class="mt-4 flex flex-col gap-2">
        {#each topOpen as c (c.id)}
          {@render commentCard(c, false)}
        {:else}
          <li class="text-sm opacity-50">هنوز نظری نیست.</li>
        {/each}
      </ul>

      {#if topResolved.length > 0}
        <button
          class="btn btn-ghost btn-xs mt-4"
          onclick={() => (showResolved = !showResolved)}
        >
          {showResolved ? 'پنهان کردن' : 'نمایش'} نظرهای حل‌شده ({topResolved.length})
        </button>
        {#if showResolved}
          <ul class="mt-2 flex flex-col gap-2">
            {#each topResolved as c (c.id)}
              {@render commentCard(c, false)}
            {/each}
          </ul>
        {/if}
      {/if}
    </aside>
  {/if}
</div>
