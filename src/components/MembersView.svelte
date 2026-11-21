<script>
  import { auth, ws, chat } from '../lib/store.svelte.js'
  import { updateDisplayName } from '../lib/auth.js'

  const seats = $derived.by(() => {
    const list = [...ws.members].slice(0, 4)
    while (list.length < 4) list.push(null)
    return list
  })

  // Display-name editor (own row only): `name` is the display name and
  // the mention system matches on it; `username` (email local part) is
  // the stable second handle. The name is stored on the members row and
  // is never overwritten by login anymore (auth.js ensureMember).
  let displayNameDraft = $state('')
  let displayNameMsg = $state('')
  let displayNameBusy = $state(false)
  let displayNameEditing = $state(false)

  function isOnline(memberId) {
    return chat.presence.some((p) => p.memberId === memberId)
  }

  async function saveDisplayName() {
    if (!auth.member || displayNameBusy) return
    displayNameBusy = true
    displayNameMsg = ''
    try {
      await updateDisplayName(displayNameDraft)
      displayNameMsg = 'نام نمایشی ذخیره شد.'
      displayNameEditing = false
    } catch (e) {
      displayNameMsg = 'ذخیره نشد: ' + (e.message || String(e))
    } finally {
      displayNameBusy = false
    }
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
              {#if m.username && m.username !== m.name}
                <p class="text-xs opacity-50" dir="ltr">@{m.username}</p>
              {/if}
              <p class="text-sm opacity-60">عضو از {fmtDate(m.joined_at)}</p>
              {#if auth.member && m.id === auth.member.id}
                {#if displayNameEditing}
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      class="input input-bordered input-sm bg-base-100"
                      placeholder="نام نمایشی — مثلاً زهرا"
                      bind:value={displayNameDraft}
                      disabled={displayNameBusy}
                    />
                    <button
                      class="btn btn-primary btn-sm"
                      onclick={saveDisplayName}
                      disabled={displayNameBusy}
                    >
                      ذخیره
                    </button>
                    <button
                      class="btn btn-ghost btn-sm"
                      onclick={() => {
                        displayNameEditing = false
                        displayNameMsg = ''
                      }}
                    >
                      لغو
                    </button>
                  </div>
                {:else}
                  <button
                    class="btn btn-ghost btn-xs mt-1"
                    onclick={() => {
                      displayNameDraft = auth.member?.name || ''
                      displayNameMsg = ''
                      displayNameEditing = true
                    }}
                  >
                    تغییر نام نمایشی
                  </button>
                {/if}
                {#if displayNameMsg}
                  <p class="mt-1 text-xs opacity-70">{displayNameMsg}</p>
                {/if}
              {/if}
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
