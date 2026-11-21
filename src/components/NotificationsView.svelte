<script>
  import { onMount } from 'svelte'
  import { ws, notif } from '../lib/store.svelte.js'
  import { memberName } from '../lib/data.js'
  import {
    loadNotifications,
    markRead,
    markAllRead,
    roomNameFor,
    notificationTypeLabel,
    notificationLink
  } from '../lib/notifications.js'

  let busyAll = $state(false)
  let actionError = $state('')

  onMount(() => {
    loadNotifications().catch(() => {})
  })

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

  async function openNotification(n) {
    if (!n.read) {
      try {
        await markRead(n.id)
      } catch (e) {
        actionError = e.message || String(e)
      }
    }
  }

  async function doMarkAllRead() {
    if (busyAll) return
    busyAll = true
    actionError = ''
    try {
      await markAllRead()
    } catch (e) {
      actionError = e.message || String(e)
    } finally {
      busyAll = false
    }
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <h1 class="text-2xl font-bold">اعلان‌ها</h1>
  <p class="mt-1 text-sm opacity-70">
    فقط فهرست درون‌اپی است — اعلان پوش نمی‌فرستیم. هر اعلان فقط یک اشاره‌گر است؛ متن پیام در آن نیست.
  </p>

  <div class="mt-4 flex items-center gap-2">
    <button
      class="btn btn-sclack btn-primary"
      onclick={doMarkAllRead}
      disabled={busyAll || notif.unreadCount === 0}
    >
      {busyAll ? '…' : 'خوانده‌شدن همه'}
    </button>
    {#if notif.unreadCount > 0}
      <span class="badge badge-warning">{notif.unreadCount} خوانده‌نشده</span>
    {/if}
  </div>

  {#if actionError}
    <p class="mt-2 text-xs text-error">{actionError}</p>
  {/if}
  {#if notif.error}
    <p class="mt-2 text-xs text-error">بارگذاری اعلان‌ها ناموفق بود: {notif.error}</p>
  {/if}

  {#if notif.loading}
    <p class="mt-4 text-sm opacity-60">در حال بارگذاری اعلان‌ها…</p>
  {:else if notif.notifications.length === 0}
    <p class="mt-4 text-sm opacity-60">هنوز اعلانی نیست.</p>
  {:else}
    <ul class="mt-4 flex flex-col gap-2">
      {#each notif.notifications as n (n.id)}
        <li data-notification={n.id} class="card {n.read ? 'bg-base-200 opacity-70' : 'bg-base-100 shadow-sm'}">
          <a
            href={notificationLink(n)}
            class="card-body gap-1 py-3"
            onclick={() => openNotification(n)}
          >
            <p class="text-sm font-bold">
              {notificationTypeLabel(n.type)}
              {#if n.message}
                <span class="font-normal opacity-70">
                  — {memberName(n.message.author_id)}
                  {#if roomNameFor(n)} در {roomNameFor(n)}{/if}
                </span>
              {/if}
              {#if !n.read}
                <span class="badge badge-warning badge-sm me-2">تازه</span>
              {/if}
            </p>
            <p class="text-xs opacity-60">{fmtTime(n.created_at)}</p>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
