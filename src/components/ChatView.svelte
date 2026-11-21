<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import { loadMessages, subscribeRoom, unsubscribeRoom, sendTyping, sendMessage } from '../lib/chat.js'
  import FileList from './FileList.svelte'

  let { roomId } = $props()
  let draft = $state('')
  let scrollBox = $state(null)
  let stickToBottom = $state(true)
  let showRoomFiles = $state(false)

  const room = $derived(ws.rooms.find((r) => r.id === roomId))
  const onlineNames = $derived(chat.presence.map((p) => p.name).join('، '))
  const typingNames = $derived(chat.typing.map((t) => t.name).join('، '))

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

  async function doSend() {
    const ok = await sendMessage(roomId, draft)
    if (ok) draft = ''
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
      <ul class="flex flex-col gap-2">
        {#each chat.messages as m (m.id)}
          {@const mine = auth.member && m.author_id === auth.member.id}
          <li class="flex {mine ? 'justify-start' : 'justify-end'}">
            <div
              class="max-w-[80%] rounded-2xl px-3 py-2 shadow-sm {mine ? 'msg-mine' : 'msg-other'}"
            >
              <div class="mb-0.5 flex items-baseline gap-2 text-xs opacity-70">
                <span class="font-medium">{memberName(m.author_id)}</span>
                <span>{fmtTime(m.created_at)}</span>
              </div>
              <p class="whitespace-pre-wrap break-words text-sm leading-6">{m.body}</p>
            </div>
          </li>
        {/each}
      </ul>
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
    <div class="flex gap-2">
      <input
        class="input input-bordered input-sclack min-w-0 flex-1 bg-base-200"
        placeholder="پیام بنویسید…"
        bind:value={draft}
        oninput={sendTyping}
        onkeydown={(e) => {
          if (e.key === 'Enter') doSend()
        }}
      />
      <!-- The send button is never disabled: every click explains itself. -->
      <button class="btn btn-send btn-primary shrink-0 px-5" onclick={doSend}>فرستادن</button>
    </div>
    {#if chat.sendState}
      <p class="mt-2 text-xs opacity-70">{chat.sendState}</p>
    {/if}
  </footer>
</div>
