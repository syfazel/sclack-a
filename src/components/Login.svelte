<script>
  import { auth } from '../lib/store.svelte.js'
  import { isConfigured } from '../lib/supabase.js'
  import { signIn, signUp } from '../lib/auth.js'
  import LogoMark from './LogoMark.svelte'

  let email = $state('')
  let password = $state('')
  let busy = $state(false)

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
</script>

<!-- G1 — ورود/لندینگ: صحنهٔ زندهٔ Three.js پشت کارت شیشه‌ای ورود.
     HeroScene با import() پویا لود می‌شود (three در باندل اولیه نیست)؛
     اگر چانک نرسید، مش گرم + لوگو می‌نشیند و صفحه خالی نمی‌ماند. -->
<div class="relative flex min-h-screen items-center justify-center px-4 py-10">
  <div class="absolute inset-0">
    {#await import('./HeroScene.svelte')}
      <div class="warm-mesh absolute inset-0"></div>
    {:then { default: HeroScene }}
      <HeroScene variant="landing" onlineCount={4} />
    {:catch}
      <div class="warm-mesh absolute inset-0 flex items-center justify-center">
        <LogoMark class="h-16 w-32 opacity-90" />
      </div>
    {/await}
  </div>
  <div class="card glass-card relative z-10 w-full max-w-md shadow-xl">
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

      <p class="mt-3 text-xs leading-5 opacity-70">
        اگر ثبت‌نام به سقف نرخ ایمیل خورد، حساب از داشبورد Supabase ساخته می‌شود؛
        بعد با همان ایمیل و رمز وارد شوید.
      </p>
    </div>
  </div>
</div>
