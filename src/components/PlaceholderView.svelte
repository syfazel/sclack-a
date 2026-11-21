<script>
  let { title, note } = $props()
</script>

<div class="flex h-full flex-col items-center justify-center px-4 text-center">
  <h1 class="text-xl font-bold">{title}</h1>
  <p class="mt-2 max-w-sm text-sm leading-6 opacity-70">{note}</p>
</div>
