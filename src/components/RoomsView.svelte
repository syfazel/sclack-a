<script>
  import { ws } from '../lib/store.svelte.js'

  async function openRoom(r) {
    ws.currentRoomId = r.id
  }
</script>

<div class="h-full overflow-y-auto px-4 py-6 md:px-8">
  <h1 class="text-2xl font-bold">اتاق‌ها</h1>
  {#if ws.projects.length === 0}
    <p class="mt-4 text-sm opacity-60">هنوز پروژه‌ای نیست — اول از خانه یک پروژه بسازید.</p>
  {:else}
    {#each ws.projects as p (p.id)}
      <section class="mt-6">
        <h2 class="mb-2 text-lg font-bold">{p.name}</h2>
        {#if ws.currentProjectId === p.id}
          {#if ws.rooms.length === 0}
            <p class="text-sm opacity-60">اتاقی نیست.</p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each ws.rooms as r (r.id)}
                <li>
                  <a href="#/room/{r.id}" class="btn btn-ghost w-full justify-start" onclick={() => openRoom(r)}>
                    {r.name}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="text-sm opacity-60">برای دیدن اتاق‌های این پروژه، اول آن را از نوار کناری انتخاب کنید.</p>
        {/if}
      </section>
    {/each}
  {/if}
</div>
