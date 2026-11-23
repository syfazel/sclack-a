<script>
  import { auth } from '../lib/store.svelte.js'
  import { isConfigured } from '../lib/supabase.js'
  import { signIn, signUp, requestPasswordReset } from '../lib/auth.js'
  import LogoMark from './LogoMark.svelte'

  let email = $state('')
  let password = $state('')
  let busy = $state(false)
  let showForgot = $state(false)
  let forgotBusy = $state(false)

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
  <div class="card glass-card glass-card-landing relative z-10 w-full max-w-md shrink-0 shadow-xl">
    <div class="card-body">
      <div class="mb-2 flex items-center gap-3">
        <LogoMark class="h-8 w-16" />
        <div>
          <h1 class="text-2xl font-bold">sclack_A</h1>
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
        <input
          type="email"
          class="input input-sclack input-bordered w-full bg-base-100"
          placeholder="name@example.com"
          bind:value={email}
          disabled={!isConfigured || busy}
          dir="ltr"
        />
      </label>
      <label class="form-control w-full">
        <span class="label-text mb-1">رمز عبور</span>
        <input
          type="password"
          class="input input-sclack input-bordered w-full bg-base-100"
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

      <div class="mt-2 flex gap-2">
        <button class="btn btn-sclack btn-primary flex-1" onclick={doSignIn} disabled={!isConfigured || busy}>
          {busy ? '…' : 'ورود'}
        </button>
        <button class="btn btn-sclack btn-outline flex-1" onclick={doSignUp} disabled={!isConfigured || busy}>
          ثبت‌نام
        </button>
      </div>

      <!-- Phase 11 (D10): password reset by email. -->
      <div class="mt-3">
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

      <p class="mt-3 text-xs leading-5 opacity-70">
        اگر ثبت‌نام به سقف نرخ ایمیل خورد، حساب از داشبورد Supabase ساخته می‌شود؛
        بعد با همان ایمیل و رمز وارد شوید.
      </p>
    </div>
  </div>
</div>
