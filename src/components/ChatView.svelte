<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import { loadMessages, subscribeRoom, unsubscribeRoom, sendTyping, sendMessage, deleteMessage } from '../lib/chat.js'
  import { filterMentionSuggestions, renderMentionSegments } from '../lib/mentions.js'
  import FileList from './FileList.svelte'

  let { roomId } = $props()
  let draft = $state('')
  let scrollBox = $state(null)
  let inputEl = $state(null)
  let stickToBottom = $state(true)
  let showRoomFiles = $state(false)

  // Thread (one level): replying to a reply takes the same top parent.
  let replyTo = $state(null) // { id, parent_id, author_id, body } | null
  const replyParentId = $derived(
    replyTo ? replyTo.parent_id || replyTo.id : null
  )

  // Mention autocomplete: open while the caret sits after an '@' that
  // has no space after it yet.
  let mentionCaret = $state(0)
  const mentionSuggestions = $derived(
    filterMentionSuggestions(draft, mentionCaret, ws.members)
  )
  const mentionOpen = $derived(
    mentionSuggestions.length > 0 && draft.includes('@')
  )

  const room = $derived(ws.rooms.find((r) => r.id === roomId))
  const onlineNames = $derived(chat.presence.map((p) => p.name).join('، '))
  const typingNames = $derived(chat.typing.map((t) => t.name).join('، '))
  const topMessages = $derived(chat.messages.filter((m) => !m.parent_id))
  const repliesOf = (id) => chat.messages.filter((m) => m.parent_id === id)

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  function onScroll() {
    if (!scrollBox) return
    stickToBottom = scrollBox.scrollHeight - scrollBox.scrollTop - scrollBox.clientHeight < 80
  }

  // Room change: reload messages + (re)subscribe to the private channel.
  $effect(() => {
    const id = roomId
    chat.messages = []
    chat.sendState = ''
    replyTo = null
    draft = ''
    loadMessages(id)
    subscribeRoom(id)
    return () => unsubscribeRoom()
  })

  // Follow new messages only while the user is already near the bottom
  // (never yank the scroll while they read history).
  $effect(() => {
    void chat.messages.length
    if (stickToBottom && scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight
  })

  function onDraftInput(e) {
    mentionCaret = e.target.selectionStart ?? draft.length
    sendTyping()
  }

  function pickMention(member) {
    if (!inputEl) return
    const caret = inputEl.selectionStart ?? draft.length
    const upto = draft.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at < 0) return
    draft = draft.slice(0, at) + '@' + member.name + ' ' + draft.slice(caret)
    mentionCaret = at + member.name.length + 2
    inputEl.focus()
    // Put the caret right after the inserted token.
    requestAnimationFrame(() => {
      inputEl.setSelectionRange(mentionCaret, mentionCaret)
    })
  }

  function onComposerKeydown(e) {
    if (e.key === 'Escape') {
      if (replyTo) replyTo = null
      return
    }
    if (e.key === 'Enter' && mentionOpen) {
      e.preventDefault()
      pickMention(mentionSuggestions[0])
      return
    }
    if (e.key === 'Enter') doSend()
  }

  // G1 item 8 — message delete: author only (D2), two-tap in-app
  // confirm, same pattern as task/file delete. No native confirm().
  let armDeleteMsgId = $state(null)
  let deleteErrorById = $state({})

  async function doDeleteMessage(m) {
    if (armDeleteMsgId !== m.id) {
      armDeleteMsgId = m.id
      return
    }
    armDeleteMsgId = null
    try {
      await deleteMessage(m)
      const { [m.id]: _gone, ...rest } = deleteErrorById
      deleteErrorById = rest
      if (replyTo && (replyTo.id === m.id || replyTo.parent_id === m.id)) replyTo = null
    } catch (e) {
      deleteErrorById = { ...deleteErrorById, [m.id]: e.message || String(e) }
    }
  }

  function startReply(m) {
    replyTo = m
    if (inputEl) inputEl.focus()
  }

  async function doSend() {
    const ok = await sendMessage(roomId, draft, room?.type, { parentId: replyParentId })
    if (ok) {
      draft = ''
      replyTo = null
    }
  }
</script>

<div class="flex h-full flex-col bg-base-100">
  <header class="border-b border-base-300 px-4 py-3">
    <h1 class="text-lg font-bold">{room ? room.name : 'اتاق'}</h1>
    <p class="text-xs opacity-70">
      {#if chat.presence.length > 0}
        آنلاین: {onlineNames}
      {:else}
        کسی آنلاین نیست
      {/if}
      {#if typingNames}
        <span class="text-primary"> — {typingNames} در حال نوشتن…</span>
      {/if}
    </p>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" bind:this={scrollBox} onscroll={onScroll}>
    {#if chat.loading}
      <p class="text-sm opacity-60">در حال بارگذاری پیام‌ها…</p>
    {:else if chat.messages.length === 0}
      <div class="flex h-full flex-col items-center justify-center text-center">
        <p class="font-medium">هنوز پیامی نیست</p>
        <p class="mt-1 text-sm opacity-60">اولین پیام این اتاق را بنویسید.</p>
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        {#each topMessages as m (m.id)}
          {@const mine = auth.member && m.author_id === auth.member.id}
          {@const replies = repliesOf(m.id)}
          <div>
            <div class="flex {mine ? 'justify-start' : 'justify-end'}">
              <div
                class="max-w-[80%] rounded-2xl px-3 py-2 shadow-sm {mine ? 'msg-mine' : 'msg-other'}"
              >
                <div class="mb-0.5 flex items-baseline gap-2 text-xs opacity-70">
                  <span class="font-medium">{memberName(m.author_id)}</span>
                  <span>{fmtTime(m.created_at)}</span>
                </div>
                <p class="whitespace-pre-wrap break-words text-sm leading-6">{#each renderMentionSegments(m.body, ws.members) as seg}{#if seg.mentionId}<span class="msg-mention">{seg.text}</span>{:else}{seg.text}{/if}{/each}</p>
                <div class="mt-1 flex items-center gap-2">
                  <button class="btn btn-ghost btn-xs" onclick={() => startReply(m)}>
                    پاسخ
                  </button>
                  {#if replies.length > 0}
                    <span class="text-xs opacity-60">{replies.length} پاسخ</span>
                  {/if}
                  {#if mine}
                    <button
                      class="btn btn-ghost btn-xs {armDeleteMsgId === m.id ? 'btn-error' : 'text-error'}"
                      title="حذف پیام"
                      onclick={() => doDeleteMessage(m)}
                    >
                      {armDeleteMsgId === m.id ? 'مطمئنید؟' : 'حذف'}
                    </button>
                  {/if}
                </div>
                {#if deleteErrorById[m.id]}
                  <p class="mt-1 text-xs text-error">{deleteErrorById[m.id]}</p>
                {/if}
              </div>
            </div>
            {#if replies.length > 0}
              <ul class="mt-2 flex flex-col gap-2 border-s-2 border-amber-500/60 ps-3">
                {#each replies as r (r.id)}
                  {@const rmine = auth.member && r.author_id === auth.member.id}
                  <li class="flex {rmine ? 'justify-start' : 'justify-end'}">
                    <div
                      class="max-w-[85%] rounded-2xl px-3 py-2 shadow-sm {rmine ? 'msg-mine' : 'msg-other'}"
                    >
                      <div class="mb-0.5 flex items-baseline gap-2 text-xs opacity-70">
                        <span class="font-medium">{memberName(r.author_id)}</span>
                        <span>{fmtTime(r.created_at)}</span>
                      </div>
                      <p class="whitespace-pre-wrap break-words text-sm leading-6">{#each renderMentionSegments(r.body, ws.members) as seg}{#if seg.mentionId}<span class="msg-mention">{seg.text}</span>{:else}{seg.text}{/if}{/each}</p>
                      <div class="mt-1">
                        <button class="btn btn-ghost btn-xs" onclick={() => startReply(r)}>
                          پاسخ
                        </button>
                        {#if rmine}
                          <button
                            class="btn btn-ghost btn-xs {armDeleteMsgId === r.id ? 'btn-error' : 'text-error'}"
                            title="حذف پیام"
                            onclick={() => doDeleteMessage(r)}
                          >
                            {armDeleteMsgId === r.id ? 'مطمئنید؟' : 'حذف'}
                          </button>
                        {/if}
                      </div>
                      {#if deleteErrorById[r.id]}
                        <p class="mt-1 text-xs text-error">{deleteErrorById[r.id]}</p>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <footer class="border-t border-base-300 px-3 py-3">
    <div class="mb-2 flex">
      <button
        class="btn btn-ghost btn-xs"
        onclick={() => (showRoomFiles = !showRoomFiles)}
      >
        {showRoomFiles ? 'پنهان کردن فایل‌های اتاق' : 'فایل‌های اتاق'}
      </button>
    </div>
    {#if showRoomFiles && room}
      <div class="mb-3 rounded-xl bg-base-200 px-3 py-2">
        <FileList projectId={room.project_id} attachedTo={{ type: 'room', id: room.id }} />
      </div>
    {/if}
    {#if replyTo}
      <div class="mb-2 flex items-center gap-2 rounded-xl bg-base-200 px-3 py-2 text-sm">
        <span class="min-w-0 flex-1 truncate">
          پاسخ به {memberName(replyTo.author_id)}: «{(replyTo.body || '').slice(0, 80)}»
        </span>
        <button class="btn btn-ghost btn-xs shrink-0" onclick={() => (replyTo = null)}>
          لغو
        </button>
      </div>
    {/if}
    {#if mentionOpen}
      <div class="mb-2 flex flex-col gap-1 rounded-xl bg-base-200 px-2 py-2" data-mention-list>
        {#each mentionSuggestions as member (member.id)}
          <button
            class="btn btn-ghost btn-sm w-full justify-start"
            onclick={() => pickMention(member)}
          >
            @{member.name}
          </button>
        {/each}
        <p class="px-2 text-xs opacity-50">Enter انتخاب می‌کند؛ Esc می‌بندد.</p>
      </div>
    {/if}
    <div class="flex gap-2">
      <input
        class="input input-bordered input-sclack min-w-0 flex-1 bg-base-200"
        placeholder="پیام بنویسید…"
        bind:value={draft}
        bind:this={inputEl}
        oninput={onDraftInput}
        onkeydown={onComposerKeydown}
      />
      <!-- The send button is never disabled: every click explains itself. -->
      <button class="btn btn-send btn-primary shrink-0 px-5" onclick={doSend}>فرستادن</button>
    </div>
    {#if chat.sendState}
      <p class="mt-2 text-xs opacity-70">{chat.sendState}</p>
    {/if}
  </footer>
</div>
