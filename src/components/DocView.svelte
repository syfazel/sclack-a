<script>
  import { auth, ws } from '../lib/store.svelte.js'
  import { sb } from '../lib/supabase.js'
  import { memberName, loadProjectData } from '../lib/data.js'
  import {
    loadDocRow,
    loadRowStateInto,
    saveDocRow,
    loadComments,
    addComment,
    setCommentResolved,
    makeAnchor,
    resolveAnchor
  } from '../lib/docs.js'
  import { createYDoc, connectBroadcast, bindTextarea, applyDocState } from '../lib/yjs-sync.js'
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

  async function init() {
    loading = true
    loadError = ''
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

  function goToAnchor(c) {
    if (!ytext || !ydoc || !textarea) return
    const pos = resolveAnchor(ydoc, c.anchor)
    if (!pos) return
    textarea.focus()
    try {
      textarea.setSelectionRange(pos.start, pos.end)
    } catch {
      // ignore
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
      <header class="border-b border-base-300 px-4 py-3">
        <h1 class="text-lg font-bold">{docRow.title}</h1>
        <p class="text-xs opacity-70">
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
      </header>
      <div class="min-h-0 flex-1 px-4 py-3">
        <textarea
          bind:this={textarea}
          class="textarea textarea-bordered h-full min-h-96 w-full resize-y bg-base-100 text-base leading-8"
          placeholder="اینجا بنویسید…"
          onkeyup={sendCursor}
          onclick={sendCursor}
          onselect={sendCursor}
        ></textarea>
      </div>
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
