<!-- صحنهٔ هیروی Three.js — فقط پوسته (ورود/خانه)، G1/G2.
     ماژول گرافیکی با import() پویا لود می‌شود تا three در باندل
     اولیه نباشد؛ اگر WebGL2 نبود، import شکست خورد،
     prefers-reduced-motion روشن بود یا «حالت ساده» فعال بود،
     همان لوگوی SVG ایستا + مش گرم می‌نشیند (fallback). -->
<script>
  import { onDestroy } from 'svelte'
  import { displayPrefs } from '../lib/store.svelte.js'
  import { toggleSimpleMode } from '../lib/display-prefs.js'
  import LogoMark from './LogoMark.svelte'

  let { variant = 'landing', onlineCount = 4 } = $props()

  let containerEl = $state(null)
  let mode = $state('loading') // 'loading' | 'scene' | 'fallback'
  let curMode = $state('light')
  let curView = $state('logo')
  let handle = null
  let starting = false
  let noRetry = false // نبود WebGL2 / شکست import قابل تکرار نیست

  async function startScene() {
    if (starting || handle || !containerEl || noRetry) return
    starting = true
    try {
      if (displayPrefs.simple) {
        mode = 'fallback'
        return
      }
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        noRetry = true
        mode = 'fallback'
        return
      }
      const mod = await import('../lib/graphics.js')
      if (!mod.webgl2Available()) {
        noRetry = true
        mode = 'fallback'
        return
      }
      handle = mod.create(containerEl, {
        mode: variant === 'home' ? 'light' : undefined,
        view: 'logo',
        calm: variant === 'home',
        onlineCount
      })
      if (!handle.webgl) {
        handle.dispose()
        handle = null
        noRetry = true
        mode = 'fallback'
        return
      }
      curMode = handle.getState().mode
      mode = 'scene'
    } catch {
      noRetry = true
      mode = 'fallback'
    } finally {
      starting = false
    }
  }

  function stopScene() {
    if (handle) {
      handle.dispose()
      handle = null
    }
  }

  // «حالت ساده» یا تغییرش: صحنه را خاموش/روشن کن.
  // noRetry فقط وقتی ساده از روشن به خاموش برمی‌گردد صفر می‌شود،
  // تا تلاش ناموفق (نبود WebGL2 / شکست import) تکرار نشود.
  let prevSimple = false
  $effect(() => {
    const simple = displayPrefs.simple
    if (simple) {
      stopScene()
      mode = 'fallback'
      prevSimple = true
    } else {
      if (prevSimple) {
        noRetry = false
        prevSimple = false
      }
      if (mode === 'fallback' || mode === 'loading') startScene()
    }
  })

  onDestroy(() => {
    stopScene()
  })

  function setMode(m) {
    if (!handle) return
    handle.setProps({ mode: m })
    curMode = m
  }
  function setView(v) {
    if (!handle) return
    handle.setView(v)
    curView = v
  }
  function explode() {
    handle?.explode()
  }
</script>

<div
  class="hero-scene warm-mesh relative h-full w-full overflow-hidden"
  data-hero-scene={variant}
>
  <div bind:this={containerEl} class="absolute inset-0" data-hero-canvas></div>

  {#if mode === 'fallback' || mode === 'loading'}
    <!-- fallback ایستا (G9): همان لوگو + مش گرم؛ صفحه هرگز خالی نمی‌ماند -->
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-3"
      data-hero-fallback
    >
      <LogoMark class="h-16 w-32 opacity-90" />
      <p class="text-sm font-medium opacity-60">sclack_A — فضای کاری مشترک</p>
    </div>
  {/if}

  {#if variant === 'landing' && mode === 'scene'}
    <div class="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-center gap-2 p-3">
      <button
        class="btn btn-sm hero-control {curMode === 'heavy' ? 'btn-active' : ''}"
        onclick={() => setMode(curMode === 'heavy' ? 'light' : 'heavy')}
      >
        {curMode === 'heavy' ? 'حالت سبک (۲۴۰ ذره)' : 'حالت سنگین (۹۰۰ ذره)'}
      </button>
      <button
        class="btn btn-sm hero-control {curView === 'logo' ? 'btn-active' : ''}"
        onclick={() => setView('logo')}
      >
        لوگو
      </button>
      <button
        class="btn btn-sm hero-control {curView === 'workspace' ? 'btn-active' : ''}"
        onclick={() => setView('workspace')}
      >
        فضای کاری
      </button>
      <button
        class="btn btn-sm hero-control {curView === 'top' ? 'btn-active' : ''}"
        onclick={() => setView('top')}
      >
        از بالا
      </button>
      <button class="btn btn-sm hero-control" onclick={explode}>انفجار ذره‌ها</button>
      <button class="btn btn-sm hero-control" onclick={toggleSimpleMode}>
        {displayPrefs.simple ? 'حالت گرافیکی' : 'حالت ساده'}
      </button>
    </div>
  {/if}
</div>
