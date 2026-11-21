<script>
  import { ws } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import {
    summarizeRoom,
    summarizeDoc,
    suggestTasksFromDoc,
    createTaskFromSuggestion,
    askWorkspace
  } from '../lib/assistant.js'

  // --- room summary ---
  let roomId = $state('')
  let roomSummary = $state(null)
  let roomBusy = $state(false)
  let roomError = $state('')

  // --- doc summary ---
  let docId = $state('')
  let docSummary = $state(null)
  let docBusy = $state(false)
  let docError = $state('')

  // --- task suggestions ---
  let sugDocId = $state('')
  let sugDoc = $state(null)
  let suggestions = $state(null)
  let sugBusy = $state(false)
  let sugError = $state('')
  let createdQuotes = $state({})

  // --- ask workspace ---
  let question = $state('')
  let askResult = $state(null)
  let askBusy = $state(false)
  let askError = $state('')

  async function doSummarizeRoom() {
    if (!roomId || roomBusy) return
    roomBusy = true
    roomError = ''
    roomSummary = null
    try {
      roomSummary = await summarizeRoom(roomId)
    } catch (e) {
      roomError = e.message || String(e)
    } finally {
      roomBusy = false
    }
  }

  async function doSummarizeDoc() {
    if (!docId || docBusy) return
    docBusy = true
    docError = ''
    docSummary = null
    try {
      docSummary = await summarizeDoc(docId)
    } catch (e) {
      docError = e.message || String(e)
    } finally {
      docBusy = false
    }
  }

  async function doSuggestTasks() {
    if (!sugDocId || sugBusy) return
    sugBusy = true
    sugError = ''
    suggestions = null
    createdQuotes = {}
    try {
      const res = await suggestTasksFromDoc(sugDocId)
      sugDoc = res.doc
      suggestions = res.suggestions
    } catch (e) {
      sugError = e.message || String(e)
    } finally {
      sugBusy = false
    }
  }

  async function doCreateSuggestedTask(s) {
    if (!sugDoc || createdQuotes[s.quote]) return
    try {
      await createTaskFromSuggestion(sugDoc, s.quote)
      createdQuotes = { ...createdQuotes, [s.quote]: true }
    } catch (e) {
      sugError = e.message || String(e)
    }
  }

  async function doAsk() {
    const q = question.trim()
    if (!q || askBusy) return
    askBusy = true
    askError = ''
    askResult = null
    try {
      askResult = await askWorkspace(q)
    } catch (e) {
      askError = e.message || String(e)
    } finally {
      askBusy = false
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <div class="ai-panel card bg-base-200">
    <div class="card-body">
      <h1 class="ai-title text-2xl font-bold">دستیار میوز</h1>
      <p class="mt-1 text-sm opacity-70">
        فقط استخراجی است: خلاصه و پیشنهاد فقط از متن واقعی پیام‌ها و سندها گرفته می‌شود؛
        هیچ جمله‌ای ساخته نمی‌شود و چیزی که نیست، «پیدا نشد» گفته می‌شود.
      </p>

      <!-- room summary -->
      <section class="mt-6">
        <h2 class="ai-title mb-2 text-lg font-bold">خلاصهٔ اتاق</h2>
        <div class="flex gap-2">
          <select class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100" bind:value={roomId}>
            <option value="">اتاق را انتخاب کنید</option>
            {#each ws.rooms as r (r.id)}
              <option value={r.id}>{r.name}</option>
            {/each}
          </select>
          <button class="btn btn-ai" onclick={doSummarizeRoom} disabled={roomBusy || !roomId}>
            خلاصه کن
          </button>
        </div>
        {#if roomError}
          <p class="mt-2 text-xs text-error">{roomError}</p>
        {/if}
        {#if roomSummary}
          <div class="mt-3 rounded-xl bg-base-100 p-3 text-sm">
            <p>{roomSummary.count} پیام</p>
            {#each roomSummary.authors as a}
              <p>{a.name}: {a.count} پیام</p>
            {/each}
            {#if roomSummary.keyLines.length === 0}
              <p class="mt-2 opacity-60">جملهٔ قابل‌نقل‌قولی نیست.</p>
            {:else}
              <p class="mt-2 font-bold">جمله‌های عیناً نقل‌شده:</p>
              <ul class="mt-1 flex flex-col gap-1">
                {#each roomSummary.keyLines as l}
                  <li class="border-s-2 border-base-300 ps-2">
                    «{l.text}»
                    <span class="block text-xs opacity-60">{l.author}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </section>

      <!-- doc summary -->
      <section class="mt-6">
        <h2 class="ai-title mb-2 text-lg font-bold">خلاصهٔ سند</h2>
        <div class="flex gap-2">
          <select class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100" bind:value={docId}>
            <option value="">سند را انتخاب کنید</option>
            {#each ws.docs as d (d.id)}
              <option value={d.id}>{d.title}</option>
            {/each}
          </select>
          <button class="btn btn-ai" onclick={doSummarizeDoc} disabled={docBusy || !docId}>
            خلاصه کن
          </button>
        </div>
        {#if docError}
          <p class="mt-2 text-xs text-error">{docError}</p>
        {/if}
        {#if docSummary}
          <div class="mt-3 rounded-xl bg-base-100 p-3 text-sm">
            <p>{docSummary.chars} نویسه · {docSummary.paragraphs} پاراگراف</p>
            {#if docSummary.firstParagraph}
              <p class="mt-2 font-bold">پاراگراف اول (عیناً):</p>
              <p class="whitespace-pre-wrap">{docSummary.firstParagraph}</p>
            {/if}
            {#if docSummary.keyLines.length > 0}
              <p class="mt-2 font-bold">خط‌های کلیدی (عیناً):</p>
              <ul class="mt-1 flex flex-col gap-1">
                {#each docSummary.keyLines as l}
                  <li class="border-s-2 border-base-300 ps-2">«{l}»</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </section>

      <!-- task suggestions -->
      <section class="mt-6">
        <h2 class="ai-title mb-2 text-lg font-bold">پیشنهاد کار از سند</h2>
        <div class="flex gap-2">
          <select
            class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
            bind:value={sugDocId}
          >
            <option value="">سند را انتخاب کنید</option>
            {#each ws.docs as d (d.id)}
              <option value={d.id}>{d.title}</option>
            {/each}
          </select>
          <button class="btn btn-ai" onclick={doSuggestTasks} disabled={sugBusy || !sugDocId}>
            پیشنهاد بده
          </button>
        </div>
        {#if sugError}
          <p class="mt-2 text-xs text-error">{sugError}</p>
        {/if}
        {#if suggestions !== null}
          {#if suggestions.length === 0}
            <p class="mt-3 text-sm opacity-60">خطِ کاری در این سند پیدا نشد.</p>
          {:else}
            <ul class="mt-3 flex flex-col gap-2">
              {#each suggestions as s (s.quote)}
                <li class="rounded-xl bg-base-100 p-3 text-sm">
                  <p>«{s.quote}»</p>
                  <p class="mt-1 text-xs opacity-60">پیشنهاد — هنوز ساخته نشده</p>
                  <button
                    class="btn btn-ai btn-sm mt-2"
                    onclick={() => doCreateSuggestedTask(s)}
                    disabled={!!createdQuotes[s.quote]}
                  >
                    {createdQuotes[s.quote] ? 'ساخته شد' : 'ساختن کار'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <!-- ask workspace -->
      <section class="mt-6">
        <h2 class="ai-title mb-2 text-lg font-bold">سؤال دربارهٔ فضای کاری</h2>
        <div class="flex gap-2">
          <input
            class="input input-bordered input-sclack min-w-0 flex-1 bg-base-100"
            placeholder="مثلاً: جلسهٔ هفتهٔ پیش چه شد؟"
            bind:value={question}
            onkeydown={(e) => {
              if (e.key === 'Enter') doAsk()
            }}
          />
          <button class="btn btn-ai" onclick={doAsk} disabled={askBusy || !question.trim()}>
            بپرس
          </button>
        </div>
        {#if askError}
          <p class="mt-2 text-xs text-error">{askError}</p>
        {/if}
        {#if askResult}
          {#if !askResult.found}
            <p class="mt-3 text-sm opacity-60">چیزی پیدا نشد.</p>
          {:else}
            <ul class="mt-3 flex flex-col gap-1">
              {#each askResult.hits as h (h.kind + '-' + h.id)}
                <li>
                  <a
                    href={h.link}
                    class="block rounded-xl bg-base-100 px-3 py-2 text-sm hover:bg-base-300"
                  >
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

      <!-- integrations -->
      <section class="mt-6">
        <h2 class="ai-title mb-2 text-lg font-bold">اتصال‌ها</h2>
        <ul class="flex flex-col gap-2 text-sm">
          <li class="flex items-center justify-between rounded-xl bg-base-100 px-3 py-2">
            <span>Supabase</span>
            <span class="font-bold text-success">وصل</span>
          </li>
          <li class="flex items-center justify-between rounded-xl bg-base-100 px-3 py-2">
            <span>Google Drive</span>
            <span class="font-bold opacity-60">وصل نشده</span>
          </li>
        </ul>
        <p class="mt-2 text-xs opacity-60">
          اتصال به Supabase سروری است و کلید در اپ نیست. اتصال به Google Drive از چت میوز
          انجام می‌شود، نه از داخل اپ.
        </p>
      </section>
    </div>
  </div>
</div>
