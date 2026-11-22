<script>
  import { onMount } from 'svelte'
  import { ws, displayPrefs } from '../lib/store.svelte.js'
  import { toggleSimpleMode } from '../lib/display-prefs.js'
  import { memberName } from '../lib/data.js'
  import {
    summarizeRoom,
    summarizeDoc,
    suggestTasksFromDoc,
    suggestTasksFromChat,
    loadDeadlineGuardian,
    createTaskFromSuggestion,
    askWorkspace,
    projectStatus,
    projectDeadline,
    suggestCloseProject,
    closeProjectFromSuggestion,
    listTodayMessages,
    listUnansweredMessages,
    listOpenThreads,
    loadMyMentions,
    loadUnreadNotifications,
    listStaleDocs,
    listOpenComments,
    listDocVersions,
    listFreshFiles,
    listUnattachedFiles,
    listMyTodayTasks,
    listOverdueTasks,
    listUndatedTasks,
    listUnassignedTasks,
    listTodayReminders,
    listOverdueReminders,
    searchDocsText,
    loadTeamPulseToday,
    loadDailyReport,
    lastActivity,
    listDocTemplates,
    createDocFromTemplate
  } from '../lib/assistant.js'

  function fmtDue(iso) {
    return iso ? new Date(iso).toLocaleDateString('fa-IR') : '—'
  }

  // --- G6: 24 new commands (the other 6 of the top 30 — room summary,
  // chat-to-task, doc summary, doc task suggestions, deadline guardian,
  // ask workspace — already have their sections above) ---
  // One shared project / doc / word input; each command card has its
  // own run button (data-g6-run) and result area (data-g6-cmd).
  let g6ProjectId = $state('')
  let g6DocId = $state('')
  let g6Word = $state('')
  let g6 = $state({}) // n -> { busy, error, result }
  let g6Closed = $state(false) // #8: project closed by the one tap
  let g6CreatedTemplates = $state({}) // template id -> true (#99 tap)

  $effect(() => {
    if (!g6ProjectId && ws.currentProjectId) g6ProjectId = ws.currentProjectId
  })

  // n = the number in the 100-command list (g6-tafsil.md).
  const G6_COMMANDS = [
    { n: 1, title: 'وضعیت پروژه', desc: 'کارهای باز / در حال انجام / تمام‌شده، عقب‌مانده، سندها، فایل‌های تازه.', scope: 'project', run: (pid) => projectStatus(pid) },
    { n: 3, title: 'مهلت پروژه', desc: 'مهلت پروژه، روزهای مانده و کارهای ناتمام تا مهلت.', scope: 'project', run: (pid) => projectDeadline(pid) },
    { n: 8, title: 'پیشنهاد بستن پروژه', desc: 'وقتی همهٔ کارها تمام شده‌اند و پروژه در بازبینی است، بستن را پیشنهاد می‌دهد — بستن فقط با یک تپ شما.', scope: 'project', run: (pid) => suggestCloseProject(pid) },
    { n: 13, title: 'پیام‌های امروز', desc: 'پیام‌های امروز تهران در همهٔ اتاق‌ها، تازه‌ترین اول.', scope: 'none', run: () => listTodayMessages() },
    { n: 15, title: 'پیام‌های بی‌پاسخ', desc: 'پیام‌هایی که هیچ پاسخی نگرفته‌اند — قدیمی‌ترین اول.', scope: 'project', run: (pid) => listUnansweredMessages(pid) },
    { n: 23, title: 'تردهای باز', desc: 'بحث‌هایی که پاسخ دارند، با شمار پاسخ‌ها و آخرین پاسخ.', scope: 'project', run: (pid) => listOpenThreads(pid) },
    { n: 25, title: 'منشن‌های من', desc: 'منشن‌های من، خوانده‌نشده اول — فقط اتاق و فرستنده، بدون متن پیام.', scope: 'none', run: () => loadMyMentions() },
    { n: 27, title: 'اعلان‌های خوانده‌نشده', desc: 'اعلان‌های خوانده‌نشدهٔ من، دسته‌بندی‌شده بر اساس نوع.', scope: 'none', run: () => loadUnreadNotifications() },
    { n: 33, title: 'سندهای بدون تغییر', desc: 'سندهایی که ۷ روز یا بیشتر ویرایش نشده‌اند.', scope: 'project', run: (pid) => listStaleDocs(pid) },
    { n: 41, title: 'نظرهای باز یک سند', desc: 'نظرهای حل‌نشدهٔ سند با نقل عین متن و لنگر.', scope: 'doc', run: (pid, docId) => listOpenComments(docId) },
    { n: 45, title: 'نسخه‌های یک سند', desc: 'فهرست نسخه‌ها با شماره، نویسنده، یادداشت و زمان.', scope: 'doc', run: (pid, docId) => listDocVersions(docId) },
    { n: 49, title: 'فایل‌های تازه', desc: 'فایل‌های ۷ روز اخیر با اندازه و فرستنده.', scope: 'project', run: (pid) => listFreshFiles(pid) },
    { n: 54, title: 'فایل‌های بی‌وصل', desc: 'فایل‌هایی که آپلود شده‌اند ولی به هیچ کار/سند/اتاقی وصل نیستند.', scope: 'project', run: (pid) => listUnattachedFiles(pid) },
    { n: 58, title: 'کارهای امروز من', desc: 'کارهای سپرده‌شده به من با سررسید امروز تهران.', scope: 'project', run: (pid) => listMyTodayTasks(pid) },
    { n: 59, title: 'کارهای عقب‌مانده', desc: 'کارهای ناتمام با سررسید گذشته، عقب‌مانده‌ترین اول.', scope: 'project', run: (pid) => listOverdueTasks(pid) },
    { n: 63, title: 'کارهای بدون سررسید', desc: 'کارهای ناتمام بدون تاریخ سررسید — در هیچ منویی دیده نمی‌شوند.', scope: 'project', run: (pid) => listUndatedTasks(pid) },
    { n: 64, title: 'کارهای بدون مسئول', desc: 'کارهای ناتمام بدون مسئول.', scope: 'project', run: (pid) => listUnassignedTasks(pid) },
    { n: 71, title: 'یادآوری‌های امروز من', desc: 'یادآوری‌های من با سررسید امروز تهران.', scope: 'none', run: () => listTodayReminders() },
    { n: 72, title: 'یادآوری‌های عقب‌مانده', desc: 'یادآوری‌های من با سررسید گذشته و انجام‌نشده.', scope: 'none', run: () => listOverdueReminders() },
    { n: 84, title: 'جست‌وجو در متن سندها', desc: 'خط‌هایی از متن واقعی سندها که واژه را دارند، با نقل عین خط.', scope: 'project-word', run: (pid, docId, word) => searchDocsText(pid, word) },
    { n: 85, title: 'نبض تیم امروز', desc: 'چهار عدد نبض: پیام‌های امروز، کارهای تمام‌شدهٔ این هفته، سندهای فعال، فایل‌های تازه.', scope: 'none', run: () => loadTeamPulseToday() },
    { n: 92, title: 'گزارش روزانهٔ تیم', desc: 'مهلت‌ها + نبض + منشن‌های خوانده‌نشدهٔ من — شروع روز با یک گزارش.', scope: 'project', run: (pid) => loadDailyReport(pid) },
    { n: 95, title: 'آخرین فعالیت هر عضو', desc: 'تازه‌ترین فعالیت هر عضو — آخرین بار کی فعال بود؟', scope: 'none', run: () => lastActivity() },
    { n: 99, title: 'پیشنهاد قالب برای سند تازه', desc: 'قالب‌های سند — ساخت سند از قالب فقط با یک تپ شما.', scope: 'none', run: () => listDocTemplates() }
  ]

  // --- G6 graphics: chip rail — 30 top commands in 12 groups
  // (g6-grafik-spec.md). `existing` marks the 6 commands that already
  // have their own section above; the other 24 are the G6 cards.
  const AI_GROUPS = [
    { label: 'الف — پروژه‌ها', cmds: [
      { n: 1, title: 'وضعیت پروژه' },
      { n: 3, title: 'مهلت پروژه' },
      { n: 8, title: 'پیشنهاد بستن پروژه' }
    ] },
    { label: 'ب — اتاق‌ها و پیام‌ها', cmds: [
      { n: 11, title: 'خلاصهٔ اتاق', existing: 'room' },
      { n: 13, title: 'پیام‌های امروز' },
      { n: 15, title: 'پیام‌های بی‌پاسخ' },
      { n: 21, title: 'پیشنهاد کار از چت', existing: 'chat-sug' }
    ] },
    { label: 'ج — ترد، منشن، اعلان', cmds: [
      { n: 23, title: 'تردهای باز' },
      { n: 25, title: 'منشن‌های من' },
      { n: 27, title: 'اعلان‌های خوانده‌نشده' }
    ] },
    { label: 'د — سندها', cmds: [
      { n: 31, title: 'خلاصهٔ سند', existing: 'doc' },
      { n: 33, title: 'سندهای بدون تغییر' },
      { n: 36, title: 'پیشنهاد کار از سند', existing: 'doc-sug' }
    ] },
    { label: 'ه — نظرها و نسخه‌ها', cmds: [
      { n: 41, title: 'نظرهای باز یک سند' },
      { n: 45, title: 'نسخه‌های یک سند' }
    ] },
    { label: 'و — فایل‌ها', cmds: [
      { n: 49, title: 'فایل‌های تازه' },
      { n: 54, title: 'فایل‌های بی‌وصل' }
    ] },
    { label: 'ز — کارها و برنامه‌ریز', cmds: [
      { n: 57, title: 'نگهبان مهلت‌ها', existing: 'guardian' },
      { n: 58, title: 'کارهای امروز من' },
      { n: 59, title: 'کارهای عقب‌مانده' },
      { n: 63, title: 'کارهای بدون سررسید' },
      { n: 64, title: 'کارهای بدون مسئول' }
    ] },
    { label: 'ح — یادآوری‌ها', cmds: [
      { n: 71, title: 'یادآوری‌های امروز من' },
      { n: 72, title: 'یادآوری‌های عقب‌مانده' }
    ] },
    { label: 'ط — جست‌وجو و پرس‌وجو', cmds: [
      { n: 77, title: 'سؤال دربارهٔ فضای کاری', existing: 'ask' },
      { n: 84, title: 'جست‌وجو در متن سندها' }
    ] },
    { label: 'ی — داشبورد و نبض تیم', cmds: [
      { n: 85, title: 'نبض تیم امروز' },
      { n: 92, title: 'گزارش روزانهٔ تیم' }
    ] },
    { label: 'ک — اعضا و تیم', cmds: [
      { n: 95, title: 'آخرین فعالیت هر عضو' }
    ] },
    { label: 'ل — قالب‌ها و شروع سریع', cmds: [
      { n: 99, title: 'پیشنهاد قالب برای سند تازه' }
    ] }
  ]

  // Active command from the chip rail: a G6 card number (100-list n,
  // null = all cards expanded) or an existing section key.
  let activeG6 = $state(null)
  let activeExisting = $state(null)

  function scrollToEl(sel) {
    const el = typeof document !== 'undefined' ? document.querySelector(sel) : null
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest' })
      } catch {
        /* jsdom: no-op */
      }
    }
  }

  function activateCmd(cmd) {
    if (cmd.existing) {
      activeExisting = activeExisting === cmd.existing ? null : cmd.existing
      activeG6 = null
      scrollToEl(`[data-ai-section="${cmd.existing}"]`)
    } else {
      activeG6 = activeG6 === cmd.n ? null : cmd.n
      activeExisting = null
      if (activeG6 !== null) scrollToEl(`[data-g6-cmd="${cmd.n}"]`)
    }
  }

  // Quick chips from the home card hand over the command number through
  // localStorage; read once on mount, then clear it.
  onMount(() => {
    try {
      const raw = window.localStorage.getItem('sclack-ai-active-cmd')
      if (raw) {
        window.localStorage.removeItem('sclack-ai-active-cmd')
        const n = Number(raw)
        const found = AI_GROUPS.flatMap((g) => g.cmds).find((c) => c.n === n)
        if (found) activateCmd(found)
      }
    } catch {
      /* storage unavailable */
    }
  })

  // G6 graphics: result-card type per command (g6-grafik-spec.md).
  // #8's suggestion border lives on the row itself, not on the list.
  function g6ResultClass(n) {
    if (n === 92) return 'ai-result-guardian'
    return 'ai-result-list'
  }

  // A count tile shows its value big only when it is a plain number
  // (fa digits, optional minus); a date label stays normal size.
  function isCountValue(s) {
    return /^[-−]?[۰-۹0-9]+$/.test(String(s || '').trim())
  }

  async function runG6(cmd) {
    const pid = g6ProjectId || ws.currentProjectId
    const needProject = cmd.scope === 'project' || cmd.scope === 'project-word'
    if (needProject && !pid) {
      g6 = { ...g6, [cmd.n]: { busy: false, error: 'پروژه انتخاب نشده است.', result: null } }
      return
    }
    if (cmd.scope === 'doc' && !g6DocId) {
      g6 = { ...g6, [cmd.n]: { busy: false, error: 'سند انتخاب نشده است.', result: null } }
      return
    }
    if (cmd.scope === 'project-word' && !g6Word.trim()) {
      g6 = { ...g6, [cmd.n]: { busy: false, error: 'واژه‌ای برای جست‌وجو بنویسید.', result: null } }
      return
    }
    if (g6[cmd.n]?.busy) return
    g6 = { ...g6, [cmd.n]: { busy: true, error: '', result: null } }
    try {
      const result = await cmd.run(pid, g6DocId, g6Word.trim())
      g6 = { ...g6, [cmd.n]: { busy: false, error: '', result } }
    } catch (e) {
      g6 = { ...g6, [cmd.n]: { busy: false, error: e.message || String(e), result: null } }
    }
  }

  async function doCloseG6(result) {
    if (!result?.project || g6Closed) return
    try {
      await closeProjectFromSuggestion(result.project)
      g6Closed = true
    } catch (e) {
      g6 = { ...g6, [8]: { busy: false, error: e.message || String(e), result } }
    }
  }

  async function doCreateTemplateDoc(t) {
    const pid = g6ProjectId || ws.currentProjectId
    if (!pid || g6CreatedTemplates[t.id]) return
    try {
      await createDocFromTemplate(t, pid)
      g6CreatedTemplates = { ...g6CreatedTemplates, [t.id]: true }
    } catch (e) {
      g6 = {
        ...g6,
        [99]: { busy: false, error: e.message || String(e), result: g6[99]?.result || null }
      }
    }
  }

  // --- deadline guardian (P01 D1) ---
  let guardianProjectId = $state('')
  let guardian = $state(null)
  let guardianBusy = $state(false)
  let guardianError = $state('')

  $effect(() => {
    if (!guardianProjectId && ws.currentProjectId) guardianProjectId = ws.currentProjectId
  })

  async function doGuardian() {
    const pid = guardianProjectId || ws.currentProjectId
    if (!pid || guardianBusy) return
    guardianBusy = true
    guardianError = ''
    guardian = null
    try {
      guardian = await loadDeadlineGuardian(pid)
    } catch (e) {
      guardianError = e.message || String(e)
    } finally {
      guardianBusy = false
    }
  }

  // --- chat-to-task suggestions (P01 D2) ---
  let chatRoomId = $state('')
  let chatSuggestions = $state(null)
  let chatBusy = $state(false)
  let chatError = $state('')
  let createdChatKeys = $state({})

  async function doSuggestFromChat() {
    if (!chatRoomId || chatBusy) return
    chatBusy = true
    chatError = ''
    chatSuggestions = null
    createdChatKeys = {}
    try {
      chatSuggestions = await suggestTasksFromChat(chatRoomId)
    } catch (e) {
      chatError = e.message || String(e)
    } finally {
      chatBusy = false
    }
  }

  async function doCreateChatSuggestion(s) {
    const key = (s.source_message_id || '') + '|' + s.quote
    if (createdChatKeys[key]) return
    try {
      const room = ws.rooms.find((r) => r.id === chatRoomId)
      await createTaskFromSuggestion(s, {
        projectId: room?.project_id || ws.currentProjectId,
        linkType: 'room',
        linkId: chatRoomId
      })
      createdChatKeys = { ...createdChatKeys, [key]: true }
    } catch (e) {
      chatError = e.message || String(e)
    }
  }

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
      await createTaskFromSuggestion(s, {
        projectId: sugDoc.project_id,
        linkType: 'doc',
        linkId: sugDoc.id
      })
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
      <div class="ai-head glass-chrome">
        <h1 class="ai-title text-2xl font-bold">دستیار میوز</h1>
        <span class="ai-badge">۳۰ دستور</span>
        <button
          type="button"
          class="ai-simple-btn"
          aria-pressed={displayPrefs.simple}
          onclick={toggleSimpleMode}
        >
          حالت ساده
        </button>
      </div>
      <p class="mt-1 text-sm opacity-70">
        فقط استخراجی است: خلاصه و پیشنهاد فقط از متن واقعی پیام‌ها و سندها گرفته می‌شود؛
        هیچ جمله‌ای ساخته نمی‌شود و چیزی که نیست، «پیدا نشد» گفته می‌شود.
      </p>

      {#snippet aiSkeleton()}
        <div class="ai-skeleton mt-3" role="status">
          <p class="text-xs">
            <span class="ai-spinner" aria-hidden="true"></span>
            در حال خواندن ردیف‌ها…
          </p>
          <div class="ai-skeleton-bar mt-2"></div>
          <div class="ai-skeleton-bar mt-2"></div>
          <div class="ai-skeleton-bar mt-2"></div>
        </div>
      {/snippet}

      <!-- ریل چیپ‌ها — ۳۰ دستور برتر در ۱۲ گروه (G6 graphics) -->
      <nav class="ai-chips" aria-label="دستورهای دستیار">
        {#each AI_GROUPS as g}
          <div class="ai-chip-group">
            <span class="ai-chip-group-label">{g.label}</span>
            <div class="ai-chip-row">
              {#each g.cmds as c (c.n)}
                <button
                  type="button"
                  class="ai-chip"
                  data-ai-chip={c.n}
                  aria-pressed={c.existing ? activeExisting === c.existing : activeG6 === c.n}
                  onclick={() => activateCmd(c)}
                >
                  {c.title}
                  {#if c.existing}<span class="ai-chip-tag">موجود</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </nav>

      <!-- deadline guardian (P01 D1) -->
      <section
        class="mt-6 {activeExisting === 'guardian' ? 'ai-active' : ''}"
        data-guardian
        data-ai-section="guardian"
      >
        <h2 class="ai-title mb-2 text-lg font-bold">نگهبان مهلت‌ها</h2>
        <p class="mb-2 text-xs opacity-60">
          خلاصهٔ روزانه از روی کارهای واقعی پروژه: کارهای امروز، عقب‌مانده و
          سررسیدهای ۴۸ ساعت آینده. برای کارهای عقب‌مانده یک اعلان یادآوری
          (فقط اشاره‌گر، بدون متن) ثبت می‌شود.
        </p>
        <div class="flex gap-2">
          <select
            class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
            bind:value={guardianProjectId}
          >
            <option value="">پروژه را انتخاب کنید</option>
            {#each ws.projects as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
          <button
            class="btn btn-ai"
            onclick={doGuardian}
            disabled={guardianBusy || !(guardianProjectId || ws.currentProjectId)}
          >
            خلاصهٔ امروز
          </button>
        </div>
        {#if guardianBusy}
          {@render aiSkeleton()}
        {/if}
        {#if guardianError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{guardianError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doGuardian}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if guardian}
          {#if !guardian.found}
            <p class="ai-result ai-result-empty ai-enter mt-3 text-sm opacity-60">
              برای امروز کاری نیست — چیزی پیدا نشد.
            </p>
          {:else}
            <div class="ai-result ai-result-guardian" aria-live="polite">
            {#snippet guardianGroup(title, tasks, overdue = false)}
              <div class="mt-3">
                <h3 class="font-bold">{title} ({tasks.length})</h3>
                {#if tasks.length === 0}
                  <p class="mt-1 text-sm opacity-60">—</p>
                {:else}
                  <ul class="ai-result-list mt-1 flex flex-col gap-1">
                    {#each tasks as t, i (t.id)}
                      <li
                        data-guardian-task={t.id}
                        class="ai-result-row ai-enter rounded-xl bg-base-100 px-3 py-2 text-sm"
                        style="animation-delay:{Math.min(i, 5) * 30}ms"
                      >
                        <a href="#/tasks" class="font-bold hover:underline">{t.title}</a>
                        {#if overdue}
                          <span class="ms-2 text-xs font-bold text-error">عقب‌مانده</span>
                        {/if}
                        <span class="block text-xs opacity-60">
                          {memberName(t.assignee_id)} · سررسید {fmtDue(t.due_at)}
                        </span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/snippet}
            {@render guardianGroup('کارهای امروز', guardian.today)}
            {@render guardianGroup('کارهای عقب‌مانده', guardian.overdue, true)}
            {@render guardianGroup('سررسیدهای نزدیک (۴۸ ساعت آینده)', guardian.soon)}
            {#if guardian.remindersToday.length > 0}
              <div class="mt-3">
                <h3 class="font-bold">یادآوری‌های امروز ({guardian.remindersToday.length})</h3>
                <ul class="ai-result-list mt-1 flex flex-col gap-1">
                  {#each guardian.remindersToday as r, i (r.id)}
                    <li
                      class="ai-result-row ai-enter rounded-xl bg-base-100 px-3 py-2 text-sm"
                      style="animation-delay:{Math.min(i, 5) * 30}ms"
                    >
                      {r.text}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if guardian.overdue.length > 0}
              <p class="mt-2 text-xs opacity-60">
                اعلان یادآوری ثبت‌شده: {guardian.remindersRecorded} مورد تازه{guardian.remindersRecorded === 0
                  ? ' — اعلان این کارها قبلاً ثبت شده بود.'
                  : ''}
              </p>
            {/if}
            </div>
          {/if}
        {/if}
      </section>

      <!-- room summary -->
      <section
        class="mt-6 {activeExisting === 'room' ? 'ai-active' : ''}"
        data-ai-section="room"
      >
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
        {#if roomBusy}
          {@render aiSkeleton()}
        {/if}
        {#if roomError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{roomError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doSummarizeRoom}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if roomSummary}
          <div class="ai-result mt-3 rounded-xl bg-base-100 p-3 text-sm" aria-live="polite">
            <p>{roomSummary.count} پیام</p>
            {#each roomSummary.authors as a}
              <p>{a.name}: {a.count} پیام</p>
            {/each}
            {#if roomSummary.keyLines.length === 0}
              <p class="ai-result-empty ai-enter mt-2 opacity-60">جملهٔ قابل‌نقل‌قولی نیست.</p>
            {:else}
              <p class="mt-2 font-bold">جمله‌های عیناً نقل‌شده:</p>
              <ul class="ai-result-list mt-1 flex flex-col gap-1">
                {#each roomSummary.keyLines as l, i}
                  <li
                    class="ai-result-row ai-result-quote ai-enter ps-2"
                    style="animation-delay:{Math.min(i, 5) * 30}ms"
                  >
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
      <section
        class="mt-6 {activeExisting === 'doc' ? 'ai-active' : ''}"
        data-ai-section="doc"
      >
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
        {#if docBusy}
          {@render aiSkeleton()}
        {/if}
        {#if docError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{docError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doSummarizeDoc}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if docSummary}
          <div class="ai-result mt-3 rounded-xl bg-base-100 p-3 text-sm" aria-live="polite">
            <p>{docSummary.chars} نویسه · {docSummary.paragraphs} پاراگراف</p>
            {#if docSummary.firstParagraph}
              <p class="mt-2 font-bold">پاراگراف اول (عیناً):</p>
              <p class="ai-result-quote ai-enter whitespace-pre-wrap ps-2">
                {docSummary.firstParagraph}
              </p>
            {/if}
            {#if docSummary.keyLines.length > 0}
              <p class="mt-2 font-bold">خط‌های کلیدی (عیناً):</p>
              <ul class="ai-result-list mt-1 flex flex-col gap-1">
                {#each docSummary.keyLines as l, i}
                  <li
                    class="ai-result-row ai-result-quote ai-enter ps-2"
                    style="animation-delay:{Math.min(i, 5) * 30}ms"
                  >
                    «{l}»
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </section>

      <!-- task suggestions -->
      <section
        class="mt-6 {activeExisting === 'doc-sug' ? 'ai-active' : ''}"
        data-ai-section="doc-sug"
      >
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
        {#if sugBusy}
          {@render aiSkeleton()}
        {/if}
        {#if sugError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{sugError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doSuggestTasks}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if suggestions !== null}
          {#if suggestions.length === 0}
            <p class="ai-result ai-result-empty ai-enter mt-3 text-sm opacity-60">
              خطِ کاری در این سند پیدا نشد.
            </p>
          {:else}
            <ul class="ai-result ai-result-list mt-3 flex flex-col gap-2" aria-live="polite">
              {#each suggestions as s, i (s.quote)}
                <li
                  data-doc-suggestion={s.source_doc_id}
                  class="ai-result-row ai-result-suggest ai-enter rounded-xl bg-base-100 p-3 text-sm"
                  style="animation-delay:{Math.min(i, 5) * 30}ms"
                >
                  <p>«{s.quote}»</p>
                  <p class="mt-1 text-xs opacity-60">
                    مسئول پیشنهادی: {s.assigneeId ? memberName(s.assigneeId) : '—'} ·
                    سررسید پیشنهادی: {fmtDue(s.dueAt)}
                  </p>
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

      <!-- chat-to-task (P01 D2) -->
      <section
        class="mt-6 {activeExisting === 'chat-sug' ? 'ai-active' : ''}"
        data-chat-sug
        data-ai-section="chat-sug"
      >
        <h2 class="ai-title mb-2 text-lg font-bold">تبدیل چت به کار</h2>
        <p class="mb-2 text-xs opacity-60">
          از پیام‌های اتاق: هر خطِ کاری با نقل عین جمله پیشنهاد می‌شود؛
          مسئول پیشنهادی نویسندهٔ پیام است و سررسید پیشنهادی شفاف است
          (فردا / امروز / پس‌فردا). ساخت فقط با یک تپ شما انجام می‌شود.
        </p>
        <div class="flex gap-2">
          <select
            class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
            bind:value={chatRoomId}
          >
            <option value="">اتاق را انتخاب کنید</option>
            {#each ws.rooms as r (r.id)}
              <option value={r.id}>{r.name}</option>
            {/each}
          </select>
          <button class="btn btn-ai" onclick={doSuggestFromChat} disabled={chatBusy || !chatRoomId}>
            پیشنهاد از چت
          </button>
        </div>
        {#if chatBusy}
          {@render aiSkeleton()}
        {/if}
        {#if chatError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{chatError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doSuggestFromChat}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if chatSuggestions !== null}
          {#if chatSuggestions.length === 0}
            <p class="ai-result ai-result-empty ai-enter mt-3 text-sm opacity-60">
              خطِ کاری در این اتاق پیدا نشد.
            </p>
          {:else}
            <ul class="ai-result ai-result-list mt-3 flex flex-col gap-2" aria-live="polite">
              {#each chatSuggestions as s, i (s.source_message_id + '|' + s.quote)}
                <li
                  data-chat-suggestion={s.source_message_id}
                  class="ai-result-row ai-result-suggest ai-enter rounded-xl bg-base-100 p-3 text-sm"
                  style="animation-delay:{Math.min(i, 5) * 30}ms"
                >
                  <p>«{s.quote}»</p>
                  <p class="mt-1 text-xs opacity-60">
                    مسئول پیشنهادی: {s.assigneeId ? memberName(s.assigneeId) : '—'} ·
                    سررسید پیشنهادی: {fmtDue(s.dueAt)}
                  </p>
                  <p class="mt-1 text-xs opacity-60">پیشنهاد — هنوز ساخته نشده</p>
                  <button
                    class="btn btn-ai btn-sm mt-2"
                    onclick={() => doCreateChatSuggestion(s)}
                    disabled={!!createdChatKeys[(s.source_message_id || '') + '|' + s.quote]}
                  >
                    {createdChatKeys[(s.source_message_id || '') + '|' + s.quote]
                      ? 'ساخته شد'
                      : 'ساختن کار'}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <!-- ask workspace -->
      <section
        class="mt-6 {activeExisting === 'ask' ? 'ai-active' : ''}"
        data-ai-section="ask"
      >
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
        {#if askBusy}
          {@render aiSkeleton()}
        {/if}
        {#if askError}
          <div class="ai-result ai-result-error mt-2">
            <p class="text-xs text-error">{askError}</p>
            <button type="button" class="btn btn-ai btn-sm mt-2" onclick={doAsk}>
              دوباره تلاش کن
            </button>
          </div>
        {/if}
        {#if askResult}
          {#if !askResult.found}
            <p class="ai-result ai-result-empty ai-enter mt-3 text-sm opacity-60">چیزی پیدا نشد.</p>
          {:else}
            <ul class="ai-result ai-result-list mt-3 flex flex-col gap-1" aria-live="polite">
              {#each askResult.hits as h, i (h.kind + '-' + h.id)}
                <li class="ai-result-row ai-enter" style="animation-delay:{Math.min(i, 5) * 30}ms">
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

      <!-- G6: 24 new commands (top 30) -->
      <section class="mt-6" data-g6-area>
        <h2 class="ai-title mb-2 text-lg font-bold">دستورهای تازهٔ دستیار (G6)</h2>
        <p class="mb-2 text-xs opacity-60">
          ۲۴ دستور تازه از ۳۰ دستور برتر؛ ۶ دستور دیگر (خلاصهٔ اتاق، تبدیل چت به کار،
          خلاصهٔ سند، پیشنهاد کار از سند، نگهبان مهلت‌ها، سؤال دربارهٔ فضای کاری)
          همین بالا در پنل هستند. همه فقط از ردیف‌های واقعی نقل یا شمارش می‌کنند؛
          وقتی چیزی نیست، «پیدا نشد» می‌گویند و هیچ‌چیز خودبه‌خود ساخته نمی‌شود.
        </p>
        <div class="flex flex-col gap-2 md:flex-row">
          <select
            class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
            data-g6-project
            bind:value={g6ProjectId}
          >
            <option value="">پروژه را انتخاب کنید</option>
            {#each ws.projects as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
          <select
            class="select select-bordered input-sclack min-w-0 flex-1 bg-base-100"
            data-g6-doc
            bind:value={g6DocId}
          >
            <option value="">سند را انتخاب کنید</option>
            {#each ws.docs as d (d.id)}
              <option value={d.id}>{d.title}</option>
            {/each}
          </select>
          <input
            class="input input-bordered input-sclack min-w-0 flex-1 bg-base-100"
            data-g6-word
            placeholder="واژه برای جست‌وجو در متن سندها"
            bind:value={g6Word}
          />
        </div>
        {#each G6_COMMANDS as cmd (cmd.n)}
          <div
            class="ai-g6-card mt-4 {activeG6 !== null && activeG6 !== cmd.n
              ? 'ai-g6-collapsed'
              : ''}"
            data-g6-cmd={cmd.n}
          >
            <div
              class="ai-g6-head"
              role="button"
              tabindex="0"
              aria-expanded={activeG6 === null || activeG6 === cmd.n}
              onclick={() => {
                activeG6 = activeG6 === cmd.n ? null : cmd.n
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  activeG6 = activeG6 === cmd.n ? null : cmd.n
                }
              }}
            >
              <h3 class="font-bold">{cmd.title}</h3>
              <p class="text-xs opacity-60">{cmd.desc}</p>
            </div>
            <div class="ai-g6-body">
            <button
              class="btn btn-ai btn-sm mt-2"
              data-g6-run={cmd.n}
              onclick={() => runG6(cmd)}
              disabled={g6[cmd.n]?.busy}
            >
              اجرا
            </button>
            {#if g6[cmd.n]?.busy}
              {@render aiSkeleton()}
            {/if}
            {#if g6[cmd.n]?.error}
              <div class="ai-result ai-result-error mt-2">
                <p class="text-xs text-error">{g6[cmd.n].error}</p>
                <button type="button" class="btn btn-ai btn-sm mt-2" onclick={() => runG6(cmd)}>
                  دوباره تلاش کن
                </button>
              </div>
            {/if}
            {#if g6[cmd.n]?.result}
              {@const r = g6[cmd.n].result}
              {#if r.groups}
                {#if !r.found}
                  <p class="ai-result ai-result-empty ai-enter mt-2 text-sm opacity-60">
                    چیزی پیدا نشد.
                  </p>
                {:else}
                  <div class="ai-result" aria-live="polite">
                  {#each r.groups as gr}
                    <h4 class="mt-3 font-bold">{gr.label} ({gr.rows.length})</h4>
                    <ul class="ai-result-list mt-1 flex flex-col gap-1">
                      {#each gr.rows as row, i (row.id)}
                        <li
                          data-g6-row={row.id}
                          class="ai-result-row ai-enter rounded-xl bg-base-100 px-3 py-2 text-sm"
                          style="animation-delay:{Math.min(i, 5) * 30}ms"
                        >
                          <a href={row.link} class="font-bold hover:underline">{row.title}</a>
                          {#if row.sub}
                            <span class="block text-xs opacity-60">{row.sub}</span>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/each}
                  </div>
                {/if}
              {:else if r.sections}
                {#if !r.found}
                  <p class="ai-result ai-result-empty ai-enter mt-2 text-sm opacity-60">
                    برای امروز کاری نیست — چیزی پیدا نشد.
                  </p>
                {:else}
                  <div class="ai-result ai-result-guardian" aria-live="polite">
                  {#each r.sections as sec}
                    <h4 class="mt-3 font-bold">{sec.title}</h4>
                    {#if sec.rows.length === 0}
                      <p class="mt-1 text-sm opacity-60">—</p>
                    {:else}
                      <ul class="ai-result-list mt-1 flex flex-col gap-1">
                        {#each sec.rows as row, i (row.id + '-' + row.title)}
                          <li
                            data-g6-row={row.id}
                            class="ai-result-row ai-enter rounded-xl bg-base-100 px-3 py-2 text-sm"
                            style="animation-delay:{Math.min(i, 5) * 30}ms"
                          >
                            {#if row.link}
                              <a href={row.link} class="font-bold hover:underline">{row.title}</a>
                            {:else}
                              <span class="font-bold">{row.title}</span>
                            {/if}
                            {#if row.sub}
                              <span class="block text-xs opacity-60">{row.sub}</span>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  {/each}
                  </div>
                {/if}
              {:else if r.templates}
                {#if !r.found}
                  <p class="ai-result ai-result-empty ai-enter mt-2 text-sm opacity-60">
                    قالب سندی پیدا نشد.
                  </p>
                {:else}
                  <ul
                    class="ai-result ai-result-list mt-2 flex flex-col gap-2"
                    aria-live="polite"
                  >
                    {#each r.templates as t, i (t.id)}
                      <li
                        data-g6-template={t.id}
                        class="ai-result-row ai-result-suggest ai-enter rounded-xl bg-base-100 p-3 text-sm"
                        style="animation-delay:{Math.min(i, 5) * 30}ms"
                      >
                        <p class="font-bold">{t.name}</p>
                        <p class="mt-1 text-xs opacity-60">پیشنهاد — هنوز ساخته نشده</p>
                        <button
                          class="btn btn-ai btn-sm mt-2"
                          onclick={() => doCreateTemplateDoc(t)}
                          disabled={!!g6CreatedTemplates[t.id]}
                        >
                          {g6CreatedTemplates[t.id] ? 'ساخته شد' : 'ساختن سند'}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {:else}
                {#if !r.found}
                  <p class="ai-result ai-result-empty ai-enter mt-2 text-sm opacity-60">
                    چیزی پیدا نشد.
                  </p>
                {:else if cmd.n === 1 || cmd.n === 3 || cmd.n === 85}
                  <div class="ai-result ai-result-count mt-2" aria-live="polite">
                    {#each r.rows as row, i (row.id)}
                      <div
                        class="ai-count ai-enter"
                        data-g6-row={row.id}
                        style="animation-delay:{Math.min(i, 5) * 30}ms"
                      >
                        {#if isCountValue(row.sub)}
                          <span class="ai-count-num">{row.sub}</span>
                          <span class="ai-count-label">{row.title}</span>
                        {:else}
                          <span class="ai-count-label">{row.title}</span>
                          <span class="ai-count-value">{row.sub}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <ul
                    class="ai-result {g6ResultClass(cmd.n)} mt-2 flex flex-col gap-1"
                    aria-live="polite"
                  >
                    {#each r.rows as row, i (row.id)}
                      <li
                        data-g6-row={row.id}
                        class="ai-result-row ai-enter {cmd.n === 41 || cmd.n === 84
                          ? 'ai-result-quote'
                          : ''} {cmd.n === 8 ? 'ai-result-suggest' : ''} rounded-xl bg-base-100 px-3 py-2 text-sm"
                        style="animation-delay:{Math.min(i, 5) * 30}ms"
                      >
                        {#if row.link}
                          <a href={row.link} class="font-bold hover:underline">{row.title}</a>
                        {:else}
                          <span class="font-bold">{row.title}</span>
                        {/if}
                        {#if row.sub}
                          <span class="block text-xs opacity-60">{row.sub}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  {#if cmd.n === 8}
                    <p class="mt-2 text-xs opacity-60">پیشنهاد — هنوز بسته نشده</p>
                    <button
                      class="btn btn-ai btn-sm mt-2"
                      data-g6-close={r.project.id}
                      onclick={() => doCloseG6(r)}
                      disabled={g6Closed}
                    >
                      {g6Closed ? 'بسته شد' : 'بستن پروژه'}
                    </button>
                  {/if}
                {/if}
              {/if}
            {/if}
            </div>
          </div>
        {/each}
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
