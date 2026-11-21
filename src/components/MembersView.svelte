<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'

  const seats = $derived.by(() => {
    const list = [...ws.members].slice(0, 4)
    while (list.length < 4) list.push(null)
    return list
  })

  function isOnline(memberId) {
    return chat.presence.some((p) => p.memberId === memberId)
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('fa-IR')
    } catch {
      return ''
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <h1 class="text-2xl font-bold">اعضا</h1>
  <p class="mt-1 text-sm opacity-70">فضای کاری حداکثر ۴ نفر است.</p>
  <ul class="mt-6 flex flex-col gap-3">
    {#each seats as m, i}
      <li class="card bg-base-200 shadow-sm">
        <div class="card-body flex-row items-center gap-3 py-4">
          <span
            class="inline-block h-3 w-3 shrink-0 rounded-full {m && isOnline(m.id)
              ? 'bg-success'
              : 'bg-base-300'}"
          ></span>
          {#if m}
            <div>
              <p class="font-bold">
                {m.name}
                {#if auth.member && m.id === auth.member.id}
                  <span class="text-sm font-normal opacity-60">(شما)</span>
                {/if}
              </p>
              <p class="text-sm opacity-60">عضو از {fmtDate(m.joined_at)}</p>
            </div>
            {#if isOnline(m.id)}
              <span class="badge badge-success me-auto">آنلاین</span>
            {/if}
          {:else}
            <p class="opacity-50">جای خالی {i + 1} — هنوز کسی اینجا نیست</p>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</div>
