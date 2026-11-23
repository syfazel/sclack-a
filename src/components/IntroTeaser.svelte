<!-- تیزر ورودی ۸ ثانیه‌ای لندینگ — «چهار نقطه، یک خط» (۰٫۱۵٫۰).
     موشن‌گرافیک کدی (SVG + CSS)؛ صحنهٔ سه‌بعدی تازه‌ای ندارد و
     HeroScene موجود دست نخورده پشت آن می‌ماند. تایم‌لاین با
     کلاس‌های مرحله‌ای beat-0..beat-7 روی ریشه پیش می‌رود
     (data-beat پردهٔ جاری، برای پروب)؛ ساعت در Login است و beat را
     prop می‌دهد. کلاس‌ها انباشته می‌شوند تا انیمیشن هر پرده پس از
     ردشدن از آن همچنان سر جایش بماند. -->
<script>
  let { beat = 0 } = $props()

  const stageClass = $derived(
    Array.from({ length: Math.min(beat, 7) + 1 }, (_, i) => `beat-${i}`).join(' ')
  )
</script>

<div class="intro-teaser {stageClass}" data-teaser data-beat={beat} aria-hidden="true">
  <svg class="teaser-svg" viewBox="0 0 360 120" aria-hidden="true">
    <path class="teaser-line" d="M20 60 H340" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" />
    <g class="teaser-dots">
      <circle class="teaser-dot teaser-dot-1" cx="60" cy="60" r="9" fill="#cbd5e1" />
      <circle class="teaser-dot teaser-dot-2" cx="140" cy="60" r="9" fill="#94a3b8" />
      <circle class="teaser-dot teaser-dot-3" cx="220" cy="60" r="9" fill="#64748b" />
      <circle class="teaser-dot teaser-dot-4" cx="300" cy="60" r="9" fill="#991b1b" />
    </g>
    <rect class="teaser-caret-rect" x="298.5" y="42" width="3" height="36" rx="1.5" fill="#991b1b" />
  </svg>

  <div class="teaser-cards">
    <div class="teaser-card teaser-card-1 glass-card">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <span>گفت‌وگو</span>
    </div>
    <div class="teaser-card teaser-card-2 glass-card">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </svg>
      <span>سند</span>
    </div>
    <div class="teaser-card teaser-card-3 glass-card">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="8 12.5 11 15.5 16.5 9" />
      </svg>
      <span>کار</span>
    </div>
  </div>
</div>

<style>
  .intro-teaser {
    position: absolute;
    inset: 0;
    z-index: 20;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 0 16px 18vh;
    transition: opacity 0.9s ease;
  }
  /* پردهٔ ۷ (۷–۸ ثانیه): overlay محو می‌شود؛ کارت ورود هم‌زمان می‌نشیند. */
  .intro-teaser.beat-7 {
    opacity: 0;
  }

  .teaser-svg {
    width: min(88vw, 380px);
    height: auto;
    overflow: visible;
  }

  /* پردهٔ ۰ (۰–۱ ثانیه): خط از چپ به راست کشیده می‌شود. */
  .teaser-line {
    stroke-dasharray: 320;
    stroke-dashoffset: 320;
  }
  .intro-teaser.beat-0 .teaser-line {
    animation: teaser-line-draw 0.95s ease-out forwards;
  }
  @keyframes teaser-line-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  /* پردهٔ ۱ (۱–۲ ثانیه): چهار نقطه با موج دومینو روشن می‌شوند. */
  .teaser-dot {
    opacity: 0;
    transform: scale(0.5);
    transform-box: fill-box;
    transform-origin: center;
  }
  .intro-teaser.beat-1 .teaser-dot {
    animation: teaser-dot-in 0.35s ease-out forwards;
  }
  .intro-teaser.beat-1 .teaser-dot-2 {
    animation-delay: 0.15s;
  }
  .intro-teaser.beat-1 .teaser-dot-3 {
    animation-delay: 0.3s;
  }
  .intro-teaser.beat-1 .teaser-dot-4 {
    animation-delay: 0.45s;
  }
  @keyframes teaser-dot-in {
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* پردهٔ ۵ (۵–۶ ثانیه): نقطهٔ جیگری می‌تپد. */
  .intro-teaser.beat-5 .teaser-dot-4 {
    animation: teaser-dot-pulse 0.9s ease forwards;
  }
  @keyframes teaser-dot-pulse {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    35% {
      opacity: 1;
      transform: scale(1.5);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  /* پردهٔ ۶ (۶–۷ ثانیه): نقطهٔ جیگری جای خود را به نشانگر تایپ می‌دهد. */
  .intro-teaser.beat-6 .teaser-dot-4 {
    animation: none;
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .teaser-caret-rect {
    opacity: 0;
  }
  .intro-teaser.beat-6 .teaser-caret-rect {
    opacity: 1;
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

  /* پردهٔ ۲ (۲–۳ ثانیه): سه کارت شیشه‌ای مثل بادبزن از دل خط باز می‌شوند.
     پردهٔ ۳ (۳–۴ ثانیه): کارت‌ها می‌نشینند — داشبورد کوچک.
     پردهٔ ۴ (۴–۵ ثانیه): کارت‌ها به سمت نقطهٔ جیگری مکیده می‌شوند. */
  .teaser-cards {
    display: flex;
    gap: 10px;
  }
  .teaser-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1;
    opacity: 0;
    transform: translate(0, -24px) scale(0.6);
    transition:
      transform 0.9s ease,
      opacity 0.9s ease;
  }
  .teaser-card svg {
    width: 16px;
    height: 16px;
    color: #991b1b;
  }
  .intro-teaser.beat-2 .teaser-card {
    opacity: 1;
    transform: translate(var(--fan-x), 0) rotate(var(--fan-rot));
  }
  .intro-teaser.beat-3 .teaser-card {
    transform: translate(0, 0) rotate(0deg);
  }
  .intro-teaser.beat-4 .teaser-card {
    opacity: 0;
    transform: translate(var(--suck-x), -120px) scale(0.15);
  }
  .teaser-card-1 {
    --fan-x: -52px;
    --fan-rot: -9deg;
    --suck-x: 60px;
  }
  .teaser-card-2 {
    --fan-x: 0px;
    --fan-rot: 0deg;
    --suck-x: 90px;
  }
  .teaser-card-3 {
    --fan-x: 52px;
    --fan-rot: 9deg;
    --suck-x: 120px;
  }
  @media (max-width: 480px) {
    .teaser-card-1 {
      --fan-x: -28px;
    }
    .teaser-card-3 {
      --fan-x: 28px;
    }
  }
</style>
