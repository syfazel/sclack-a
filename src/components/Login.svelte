<script>
  import { auth, displayPrefs } from '../lib/store.svelte.js'
  import { isConfigured } from '../lib/supabase.js'
  import { signIn, signUp, requestPasswordReset } from '../lib/auth.js'
  import LogoMark from './LogoMark.svelte'
  import IntroTeaser from './IntroTeaser.svelte'

  let email = $state('')
  let password = $state('')
  let busy = $state(false)
  let showForgot = $state(false)
  let forgotBusy = $state(false)

  // تیزر ورودی ۳۰ ثانیه‌ای (۰٫۱۶٫۰) — «یک خط، نوزده ایستگاه».
  // هر دفعه که لندینگ باز می‌شود پخش می‌شود، با دکمهٔ ظریف «رد کردن»
  // (دستور یاسین ۲۳ نوامبر ~۱۶:۳۱ — برگرداندنِ «بدون رد کردن» نسخهٔ ۱)؛
  // با prefers-reduced-motion یا «حالت ساده» رد می‌شود و ورود
  // مستقیم نشان داده می‌شود. ساعت این‌جاست تا کارت ورود و نشانگر
  // فیلد ایمیل هم با پرده‌ها هماهنگ باشند. teaserDone = تیزر تمام شد
  // (طبیعی یا با رد کردن)؛ teaserCompleted = فقط پایان طبیعی ۳۰ ثانیه‌ای
  // (نشانگر «مهر جیگری» فقط پس از پایان طبیعی می‌آید).
  let teaserActive = $state(false)
  let teaserBeat = $state(0)
  let teaserDone = $state(false)
  let teaserCompleted = $state(false)
  let emailFocused = $state(false)
  let teaserTimers = []

  function clearTeaserTimers() {
    teaserTimers.forEach(clearTimeout)
    teaserTimers = []
  }

  function skipTeaser() {
    clearTeaserTimers()
    teaserDone = true
  }

  function teaserAllowed() {
    if (displayPrefs.simple) return false
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    return true
  }

  $effect(() => {
    if (!teaserAllowed() || teaserDone) {
      teaserActive = false
      return
    }
    teaserActive = true
    teaserTimers = []
    for (let b = 1; b <= 29; b++) teaserTimers.push(setTimeout(() => { teaserBeat = b }, b * 1000))
    teaserTimers.push(
      setTimeout(() => {
        teaserDone = true
        teaserCompleted = true
      }, 30000)
    )
    return () => clearTeaserTimers()
  })

  function setMsg(text, kind) {
    auth.authMsg = text
    auth.authMsgKind = kind
  }

  async function doSignIn() {
    if (!isConfigured) return
    if (!email.trim() || !password) {
      setMsg('ایمیل و رمز را کامل وارد کنید.', 'error')
      return
    }
    busy = true
    setMsg('در حال ورود…', '')
    const res = await signIn(email.trim(), password)
    setMsg(res.text, res.kind)
    busy = false
  }

  async function doSignUp() {
    if (!isConfigured) return
    if (!email.trim() || !password) {
      setMsg('ایمیل و رمز را کامل وارد کنید.', 'error')
      return
    }
    busy = true
    setMsg('در حال ثبت‌نام…', '')
    const res = await signUp(email.trim(), password)
    setMsg(res.text, res.kind)
    busy = false
  }

  async function doForgot() {
    if (!isConfigured) return
    if (!email.trim()) {
      setMsg('اول ایمیلت را در فیلد بالا بنویس، بعد «ارسال پیوند بازیابی» را بزن.', 'error')
      return
    }
    forgotBusy = true
    setMsg('در حال ارسال پیوند بازیابی…', '')
    const res = await requestPasswordReset(email.trim())
    setMsg(res.text, res.kind)
    forgotBusy = false
  }
</script>

<!-- G1 — ورود/لندینگ: صحنهٔ زندهٔ Three.js پشت کارت شیشه‌ای ورود.
     HeroScene با import() پویا لود می‌شود (three در باندل اولیه نیست)؛
     اگر چانک نرسید، مش روشن + لوگو می‌نشیند و صفحه خالی نمی‌ماند. -->
<div class="relative flex min-h-screen flex-col items-center justify-center px-4 pb-24 pt-10">
  <!-- 0.13.1: the 3D emblem lives in this free upper zone — the spacer
       keeps the login card below it so the logo is never covered. The
       spacer is transparent and pointer-transparent: the scene behind
       it stays visible and draggable. -->
  <div
    class="pointer-events-none relative z-10 h-[36vh] min-h-[220px] w-full shrink-0"
    data-landing-emblem-zone
    aria-hidden="true"
  ></div>
  <div class="absolute inset-0">
    {#await import('./HeroScene.svelte')}
      <div class="light-mesh absolute inset-0"></div>
    {:then { default: HeroScene }}
      <HeroScene variant="landing" onlineCount={4} />
    {:catch}
      <div class="light-mesh absolute inset-0 flex items-center justify-center">
        <LogoMark class="h-16 w-32 opacity-90" />
      </div>
    {/await}
  </div>
  {#if teaserActive && !teaserDone}
    <IntroTeaser beat={teaserBeat} onskip={skipTeaser} />
  {/if}
  <div
    class="card glass-card glass-card-landing teaser-card relative z-10 w-full max-w-sm shrink-0 shadow-xl {teaserActive &&
    !teaserDone &&
    teaserBeat < 27
      ? 'teaser-card-hidden'
      : ''}"
  >
    <div class="card-body p-5">
      <div class="mb-1 flex items-center gap-2">
        <LogoMark class="h-6 w-12" />
        <div>
          <h1 class="text-xl font-bold">sclack_A</h1>
          <p class="text-sm opacity-70">ورود به فضای کاری</p>
        </div>
      </div>

      {#if !isConfigured}
        <div class="alert alert-warning">
          <span>
            کلید Supabase هنوز به سایت وصل نشده است. سایت با کلید publishable تازه،
            از راه GitHub Actions Secret در زمان بیلد، ساخته می‌شود.
          </span>
        </div>
      {/if}

      <label class="form-control w-full">
        <span class="label-text mb-1">ایمیل</span>
        <div class="relative">
          <input
            type="email"
            class="input input-landing input-bordered w-full"
            placeholder="name@example.com"
            bind:value={email}
            disabled={!isConfigured || busy}
            dir="ltr"
            onfocus={() => (emailFocused = true)}
            onblur={() => (emailFocused = false)}
          />
          {#if teaserCompleted && !emailFocused && !email}
            <!-- پایان تیزر («مهر جیگری»): نقطهٔ جیگری این‌جا نشانگر تایپ
                 است؛ با فوکوس یا تایپ، نشانگر واقعی جای آن را می‌گیرد.
                 پس از «رد کردن» نشانگر نمی‌آید — تیزر کامل دیده نشده. -->
            <span class="teaser-caret" data-teaser-caret aria-hidden="true"></span>
          {/if}
        </div>
      </label>
      <label class="form-control w-full">
        <span class="label-text mb-1">رمز عبور</span>
        <input
          type="password"
          class="input input-landing input-bordered w-full"
          placeholder="••••••••"
          bind:value={password}
          disabled={!isConfigured || busy}
          dir="ltr"
          onkeydown={(e) => {
            if (e.key === 'Enter') doSignIn()
          }}
        />
      </label>

      {#if auth.authMsg}
        <div
          class="alert {auth.authMsgKind === 'rate-limited'
            ? 'alert-warning'
            : auth.authMsgKind === 'error'
              ? 'alert-error'
              : auth.authMsgKind === 'ok'
                ? 'alert-success'
                : 'alert-info'}"
        >
          <span>{auth.authMsg}</span>
        </div>
      {/if}

      <div class="mt-1 flex gap-2">
        <button class="btn btn-landing btn-landing-primary flex-1" onclick={doSignIn} disabled={!isConfigured || busy}>
          {busy ? '…' : 'ورود'}
        </button>
        <button class="btn btn-landing btn-landing-outline flex-1" onclick={doSignUp} disabled={!isConfigured || busy}>
          ثبت‌نام
        </button>
      </div>

      <!-- Phase 11 (D10): password reset by email. -->
      <div class="mt-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-forgot-toggle
          onclick={() => (showForgot = !showForgot)}
          disabled={!isConfigured}
        >
          رمز را فراموش کردم
        </button>
        {#if showForgot}
          <p class="mt-2 text-xs leading-5 opacity-70">
            ایمیلت را بالا نوشته‌ای؟ پیوند بازیابی به همان ایمیل فرستاده می‌شود؛
            روی پیوند که زدی، همین‌جا رمز تازه را می‌نویسی.
          </p>
          <button
            type="button"
            class="btn btn-sclack btn-outline btn-sm mt-2"
            data-forgot-send
            onclick={doForgot}
            disabled={!isConfigured || forgotBusy}
          >
            {forgotBusy ? '…' : 'ارسال پیوند بازیابی'}
          </button>
        {/if}
      </div>

      <p class="mt-2 text-xs leading-5 opacity-70">
        اگر ثبت‌نام به سقف نرخ ایمیل خورد، حساب از داشبورد Supabase ساخته می‌شود؛
        بعد با همان ایمیل و رمز وارد شوید.
      </p>
    </div>
  </div>
</div>

<style>
  /* تیزر ورودی (۰٫۱۶٫۰): کارت تا پردهٔ پایان (۲۷) پنهان است و با آن می‌نشیند. */
  .teaser-card {
    transition:
      opacity 1.2s ease,
      transform 1.2s ease;
  }
  .teaser-card-hidden {
    opacity: 0;
    transform: translateY(14px);
    pointer-events: none;
  }
  /* نشانگر چشمک‌زن فیلد ایمیل پس از پایان تیزر. */
  .teaser-caret {
    position: absolute;
    left: 12px;
    top: 50%;
    width: 2px;
    height: 20px;
    margin-top: -10px;
    background: #991b1b;
    border-radius: 1px;
    pointer-events: none;
    animation: teaser-caret-blink 1.1s linear infinite;
  }
  @keyframes teaser-caret-blink {
    0%,
    49% {
      opacity: 1;
    }
    50%,
    100% {
      opacity: 0;
    }
  }
</style>
