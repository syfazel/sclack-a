<script>
  import { auth } from '../lib/store.svelte.js'
  import { completePasswordReset } from '../lib/auth.js'
  import LogoMark from './LogoMark.svelte'

  // Phase 11 (D10): the new-password form. Reached two ways:
  //   * the '#/reset-password' route (deep link / probe), and
  //   * auth.recoveryMode, set by the App when the Supabase client
  //     fires PASSWORD_RECOVERY (the email link lands on the site root
  //     with a recovery session — see requestPasswordReset).
  // The form renders even without a session (the route takes priority
  // in the App); submitting without a recovery session fails at
  // Supabase with a clear message, it never pretends to work.
  let next = $state('')
  let confirm = $state('')
  let busy = $state(false)
  let msg = $state('')
  let kind = $state('')
  let done = $state(false)

  async function doReset() {
    busy = true
    msg = 'در حال ثبت رمز تازه…'
    kind = ''
    const res = await completePasswordReset(next, confirm)
    msg = res.text
    kind = res.kind
    busy = false
    if (res.ok) done = true
  }

  function goHome() {
    auth.recoveryMode = false
    location.hash = '#/'
  }
</script>

<div class="relative flex min-h-screen items-center justify-center px-4 py-10">
  <div class="absolute inset-0"><div class="light-mesh absolute inset-0"></div></div>
  <div class="card glass-card relative z-10 w-full max-w-md shadow-xl">
    <div class="card-body">
      <div class="mb-2 flex items-center gap-3">
        <LogoMark class="h-8 w-16" />
        <div>
          <h1 class="text-2xl font-bold">رمز تازه</h1>
          <p class="text-sm opacity-70">بازیابی رمز عبور sclack_A</p>
        </div>
      </div>

      {#if done}
        <div class="alert alert-success"><span>{msg}</span></div>
        <button class="btn btn-sclack btn-primary mt-2 w-full" onclick={goHome}>
          رفتن به صفحهٔ ورود
        </button>
      {:else}
        <p class="text-sm leading-6 opacity-80">
          رمز تازه‌ات را بنویس. بعد از ثبت، با همان رمز تازه وارد می‌شوی.
        </p>
        <label class="form-control w-full">
          <span class="label-text mb-1">رمز تازه</span>
          <input
            type="password"
            class="input input-sclack input-bordered w-full bg-base-100"
            placeholder="دست‌کم ۶ نویسه"
            bind:value={next}
            disabled={busy}
            dir="ltr"
          />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1">تکرار رمز تازه</span>
          <input
            type="password"
            class="input input-sclack input-bordered w-full bg-base-100"
            placeholder="دوباره همان رمز"
            bind:value={confirm}
            disabled={busy}
            dir="ltr"
            onkeydown={(e) => {
              if (e.key === 'Enter') doReset()
            }}
          />
        </label>

        {#if msg}
          <div
            class="alert {kind === 'error'
              ? 'alert-error'
              : kind === 'ok'
                ? 'alert-success'
                : 'alert-info'}"
          >
            <span>{msg}</span>
          </div>
        {/if}

        <button class="btn btn-sclack btn-primary mt-2 w-full" onclick={doReset} disabled={busy}>
          {busy ? '…' : 'ثبت رمز تازه'}
        </button>
        <button class="btn btn-sclack btn-ghost mt-2 w-full" onclick={goHome} disabled={busy}>
          بازگشت به ورود
        </button>
      {/if}
    </div>
  </div>
</div>
