<!-- تیزر ورودی ۳۰ ثانیه‌ای لندینگ — نسخهٔ ۲ «یک خط، نوزده ایستگاه» (۰٫۱۶٫۰).
     گسترش نسخهٔ ۱ (۸ ثانیه)؛ زبان بصری همان می‌ماند: خط، چهار نقطه،
     کارت‌های شیشه‌ای، سفید/خاکستری/جیگری. ۵ پرده، ۱۹ ایستگاه — هر
     ایستگاه برچسب کوچک فارسی دارد؛ در هر پرده یک قابلیت قهرمان
     (station-hero) با حرکت/بزرگ‌شدن برجسته است و بقیهٔ ایستگاه‌ها
     کارت شیشه‌ای نیمه‌شفاف پس‌زمینه‌اند (station-bg). دو کلیپ Veo:
     A نورِ پس‌زمینهٔ لوپ پشت صحنه‌ها، B پایان (پنجرهٔ ۷–۱۰ ثانیه)؛
     اگر کلیپی نرسید، همان پرده به‌صورت کدی برمی‌گردد (fallback صریح).
     صحنهٔ سه‌بعدی تازه‌ای ندارد؛ HeroScene دست نخورده پشت آن می‌ماند.
     ساعت در Login است و beat را prop می‌دهد (۰ تا ۲۹؛ پایان ۳۰۰۰۰ms). -->
<script>
  let { beat = 0, onskip = () => {} } = $props()

  const base = import.meta.env.BASE_URL
  let videoAError = $state(false)
  let videoBError = $state(false)
  let finaleVideo = $state(null)

  // پرده: ۰ مقدمه (۰–۲)، ۱ گفت‌وگو (۲–۷)، ۲ سند (۷–۱۲)، ۳ کار (۱۲–۱۸)،
  // ۴ برنامه و حافظه (۱۸–۲۳)، ۵ تیم و دستیار (۲۳–۲۷)، ۶ پایان (۲۷–۳۰).
  const act = $derived(
    beat < 2 ? 0 : beat < 7 ? 1 : beat < 12 ? 2 : beat < 18 ? 3 : beat < 23 ? 4 : beat < 27 ? 5 : 6
  )

  // پایان (۲۷–۳۰): کلیپ B از پنجرهٔ ۷–۱۰ ثانیه پخش می‌شود — فریم
  // پایانی‌اش همان نشانگر تایپ است. (در jsdom پخش no-op است.)
  $effect(() => {
    if (beat >= 27 && finaleVideo && !videoBError) {
      try {
        finaleVideo.currentTime = 7
      } catch {}
      try {
        finaleVideo.play?.()?.catch?.(() => {})
      } catch {}
    }
  })
</script>

<div
  class="intro-teaser {beat >= 29 ? 'teaser-fading' : ''}"
  data-teaser
  data-beat={beat}
  data-act={act}
  data-video-a-fallback={videoAError || undefined}
  data-video-b-fallback={videoBError || undefined}
>
  {#if !videoAError}
    <video
      class="teaser-video-bg"
      data-teaser-video-a
      src="{base}teaser/clip-a-light.mp4"
      autoplay
      muted
      loop
      playsinline
      aria-hidden="true"
      onerror={() => (videoAError = true)}
    ></video>
  {/if}

  {#if beat < 2}
    <div class="teaser-intro" aria-hidden="true">
      <svg class="teaser-svg" viewBox="0 0 360 120" aria-hidden="true">
        <path class="teaser-line" d="M20 60 H340" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" />
        <g class="teaser-dots">
          <circle class="teaser-dot teaser-dot-1" cx="60" cy="60" r="9" fill="#cbd5e1" />
          <circle class="teaser-dot teaser-dot-2" cx="140" cy="60" r="9" fill="#94a3b8" />
          <circle class="teaser-dot teaser-dot-3" cx="220" cy="60" r="9" fill="#64748b" />
          <circle class="teaser-dot teaser-dot-4" cx="300" cy="60" r="9" fill="#991b1b" />
        </g>
      </svg>
      {#if beat >= 1}
        <div class="teaser-intro-label">sclack_A — چهار نفر، یک خط</div>
      {/if}
    </div>
  {:else if beat < 27}
    <div class="teaser-stage" aria-hidden="true">
      {#if act === 1}
        <div class="act-scene" data-act-scene="1">
          {#if beat >= 2}
            <div class="station station-hero glass-card" data-station="1">
              <div class="chat-bubble">سلام، طرح رویش را شروع کنیم؟</div>
              <div class="typing-row"><span class="online-dot"></span><span class="online-dot"></span> زهرا در حال نوشتن…</div>
              <span class="station-label">پیام زنده</span>
            </div>
          {/if}
          {#if beat >= 3}
            <div class="station station-bg glass-card" data-station="2">
              <div class="chat-bubble"><b class="mention">@زهرا</b> نظرت چیه؟</div>
              <div class="bell-chip">🔔 ۱ خوانده‌نشده</div>
              <span class="station-label">منشن</span>
            </div>
          {/if}
          {#if beat >= 4}
            <div class="station station-bg glass-card" data-station="3">
              <div class="thread-reply">بله، سندش را باز می‌کنم</div>
              <div class="thread-count">۲ پاسخ</div>
              <span class="station-label">ترد</span>
            </div>
          {/if}
          {#if beat >= 5}
            <div class="station station-bg glass-card" data-station="4">
              <div class="private-chip">خصوصی — فقط دو نفر</div>
              <div class="chat-bubble">فردا ساعت ۷؟</div>
              <span class="station-label">پیام شخصی</span>
            </div>
          {/if}
        </div>
      {:else if act === 2}
        <div class="act-scene" data-act-scene="2">
          {#if beat >= 7}
            <div class="station station-hero glass-card" data-station="5">
              <div class="doc-title">طرح رویش<span class="caret-inline caret-crimson"></span><span class="caret-inline caret-grey"></span></div>
              <div class="doc-line">دو نفر هم‌زمان می‌نویسند…</div>
              <div class="doc-note">۰ حرف گم‌شده</div>
              <span class="station-label">سند مشترک</span>
            </div>
          {/if}
          {#if beat >= 8}
            <div class="station station-bg glass-card" data-station="6">
              <table class="mini-table">
                <tbody>
                  <tr><th>بخش</th><th>وضعیت</th></tr>
                  <tr><td>۱ـالف</td><td>انجام شد</td></tr>
                </tbody>
              </table>
              <div class="wikilink">[[سند هدف]]</div>
              <span class="station-label">سند غنی</span>
            </div>
          {/if}
          {#if beat >= 9}
            <div class="station station-bg glass-card" data-station="7">
              <div class="tree-row">طرح رویش</div>
              <div class="tree-row tree-l1">↳ بخش ۱</div>
              <div class="tree-row tree-l2">↳ بخش ۱ـ۱ <span class="tree-badge">۱</span></div>
              <span class="station-label">سند تودرتو</span>
            </div>
          {/if}
          {#if beat >= 10}
            <div class="station station-bg glass-card" data-station="8">
              <div class="comment-note">«اینجا عدد گرنت را چک کن»</div>
              <div class="resolved-chip">حل‌شده ✓</div>
              <span class="station-label">نظر</span>
            </div>
          {/if}
          {#if beat >= 11}
            <div class="station station-bg glass-card" data-station="9">
              <div class="version-row"><span class="version-chip">نسخهٔ ۳</span> <span>برگرداندن ↩</span></div>
              <div class="doc-note">هیچ نسخه‌ای پاک نمی‌شود</div>
              <span class="station-label">نسخه‌ها</span>
            </div>
          {/if}
        </div>
      {:else if act === 3}
        <div class="act-scene" data-act-scene="3">
          {#if beat >= 12}
            <div class="station station-hero glass-card" data-station="10">
              <div class="suggest-title">پیشنهاد — هنوز ساخته نشده</div>
              <div class="suggest-quote">«گرنت را چک کن»</div>
              <div class="suggest-btn">ساختن با یک تپ</div>
              {#if beat >= 13}
                <div class="born-task">✓ چک کردن گرنت — ساخته شد</div>
              {/if}
              <span class="station-label">چت می‌شود کار</span>
            </div>
          {/if}
          {#if beat >= 13}
            <div class="station station-bg glass-card" data-station="11">
              <div class="kanban-cols"><span>باز</span><span>در حال انجام</span><span>تمام‌شده</span></div>
              <div class="kanban-track"><div class="kanban-card">چک کردن گرنت ✓</div></div>
              <span class="station-label">کانبان</span>
            </div>
          {/if}
          {#if beat >= 14}
            <div class="station station-bg glass-card" data-station="12">
              <div class="subtask-row">زیروظیفه: تماس با استاد</div>
              <div class="checklist-row"><span class="tick-box ticked">✓</span><span class="tick-box ticked">✓</span><span class="tick-box"></span> ۲ از ۳</div>
              <span class="station-label">زیروظیفه و چک‌لیست</span>
            </div>
          {/if}
          {#if beat >= 15}
            <div class="station station-bg glass-card" data-station="13">
              <div class="guard-row">کار عقب‌مانده <span class="overdue-chip">عقب‌مانده</span></div>
              <div class="guard-note">یادآوری امروز</div>
              <span class="station-label">نگهبان مهلت‌ها</span>
            </div>
          {/if}
          {#if beat >= 16}
            <div class="station station-bg glass-card" data-station="14">
              <div class="planner-rail">
                <span class="planner-menu active">امروز</span><span class="planner-menu">این هفته</span><span class="planner-menu">این ماه</span><span class="planner-menu">سررسیدها</span><span class="planner-menu">کارهای من</span><span class="planner-menu">کارهای نفر دوم</span><span class="planner-menu">تقویم</span><span class="planner-menu">یادآوری‌ها</span>
              </div>
              <div class="planner-tasks">کارهای امروز: چک کردن گرنت • تماس با استاد</div>
              <span class="station-label">برنامه‌ریز</span>
            </div>
          {/if}
        </div>
      {:else if act === 4}
        <div class="act-scene" data-act-scene="4">
          {#if beat >= 18}
            <div class="station station-bg glass-card" data-station="15">
              <div class="budget-bar">گرنت ۴۳۵٬۰۰۰٬۰۰۰ ریال</div>
              <svg class="burndown-svg" viewBox="0 0 220 40" aria-hidden="true">
                <polyline class="burndown-line" points="10,8 70,16 130,24 200,34" fill="none" stroke="#991b1b" stroke-width="2" stroke-linecap="round" />
              </svg>
              <div class="gantt-bar"></div>
              <span class="station-label">بودجه و زمان‌بندی</span>
            </div>
          {/if}
          {#if beat >= 19}
            <div class="station station-hero glass-card" data-station="16">
              <div class="form-section">بخش ۱ـالف</div>
              <div class="form-counter">{beat >= 20 ? '۱ از ۴۶' : '۰ از ۴۶'}</div>
              {#if beat >= 20}
                <div class="form-answer">✓ پاسخ ثبت شد</div>
              {/if}
              <span class="station-label">کاربرگ ۴۶ سوالی</span>
            </div>
          {/if}
          {#if beat >= 21}
            <div class="station station-bg glass-card" data-station="17">
              <div class="search-box">Ctrl+K — گرنت</div>
              {#if beat >= 22}
                <div class="search-results"><span>پیام</span><span>سند</span><span>فایل</span><span>کار</span></div>
              {/if}
              <span class="station-label">جست‌وجو</span>
            </div>
          {/if}
        </div>
      {:else if act === 5}
        <div class="act-scene" data-act-scene="5">
          {#if beat >= 23}
            <div class="station station-bg glass-card" data-station="18">
              <div class="home-greet">ظهر بخیر</div>
              <div class="home-row">کارهای من • حلقهٔ پیشرفت</div>
              <svg class="pulse-svg" viewBox="0 0 220 36" aria-hidden="true">
                <polyline class="pulse-line" points="10,28 60,26 110,20 160,12 205,6" fill="none" stroke="#991b1b" stroke-width="2" stroke-linecap="round" />
              </svg>
              <span class="station-label">خانه و نبض تیم</span>
            </div>
          {/if}
          {#if beat >= 25}
            <div class="station station-hero glass-card" data-station="19">
              <div class="assistant-rail">۳۰ دستور</div>
              {#if beat >= 26}
                <div class="assistant-result">خلاصهٔ اتاق: ۸ پیام</div>
              {/if}
              <span class="station-label">دستیار میوز</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="teaser-thread" aria-hidden="true">
      <span class="thread-line"></span>
      <span class="thread-dot"></span><span class="thread-dot"></span><span class="thread-dot"></span><span class="thread-dot thread-dot-crimson"></span>
    </div>
  {:else}
    <div class="teaser-finale" aria-hidden="true">
      {#if !videoBError}
        <video
          class="teaser-video-finale"
          data-teaser-video-b
          data-finale-window="7-10"
          src="{base}teaser/clip-b-finale.mp4"
          muted
          playsinline
          aria-hidden="true"
          onerror={() => (videoBError = true)}
          bind:this={finaleVideo}
        ></video>
      {:else}
        <div class="finale-code" data-finale-code>
          <span class="finale-dot"></span>
          <span class="finale-caret"></span>
        </div>
      {/if}
    </div>
  {/if}

  <button type="button" class="teaser-skip" data-teaser-skip onclick={onskip}>رد کردن</button>
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
    gap: 14px;
    padding: 0 12px 8vh;
    transition: opacity 0.9s ease;
  }
  .intro-teaser.teaser-fading {
    opacity: 0;
  }

  /* کلیپ A — نورِ پس‌زمینهٔ لوپ پشت صحنه‌ها. */
  .teaser-video-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.45;
    pointer-events: none;
  }

  /* مقدمه (۰–۲ ثانیه): خط + چهار نقطه، همان نسخهٔ ۱. */
  .teaser-intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .teaser-svg {
    width: min(88vw, 380px);
    height: auto;
    overflow: visible;
  }
  .teaser-line {
    stroke-dasharray: 320;
    stroke-dashoffset: 320;
    animation: teaser-line-draw 0.95s ease-out forwards;
  }
  @keyframes teaser-line-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  .teaser-dot {
    opacity: 0;
    transform: scale(0.5);
    transform-box: fill-box;
    transform-origin: center;
    animation: teaser-dot-in 0.35s ease-out forwards;
    animation-delay: 1s;
  }
  .teaser-dot-2 {
    animation-delay: 1.15s;
  }
  .teaser-dot-3 {
    animation-delay: 1.3s;
  }
  .teaser-dot-4 {
    animation-delay: 1.45s;
  }
  @keyframes teaser-dot-in {
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  .teaser-intro-label {
    font-size: 13px;
    opacity: 0.65;
  }

  /* صحنهٔ پردهٔ جاری. */
  .teaser-stage {
    position: relative;
    z-index: 1;
    width: min(94vw, 620px);
    display: flex;
    flex-direction: column;
  }
  .act-scene {
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: act-in 0.55s ease-out;
  }
  @keyframes act-in {
    from {
      opacity: 0;
      transform: translateX(28px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  /* ایستگاه: کارت شیشه‌ای + برچسب کوچک فارسی. */
  .station {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.5;
    animation: station-in 0.5s ease-out;
  }
  @keyframes station-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .station-hero {
    border-color: rgba(153, 27, 27, 0.45);
    box-shadow: 0 8px 24px rgba(153, 27, 27, 0.12);
    transform: scale(1.02);
    font-size: 14px;
  }
  .station-bg {
    opacity: 0.78;
  }
  .station-label {
    font-size: 11px;
    font-weight: 700;
    color: #991b1b;
  }

  .chat-bubble {
    background: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 12px;
    padding: 6px 10px;
    width: fit-content;
  }
  .typing-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    opacity: 0.75;
  }
  .online-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #16a34a;
    display: inline-block;
  }
  .mention {
    color: #991b1b;
    font-weight: 700;
  }
  .bell-chip,
  .private-chip,
  .resolved-chip,
  .version-chip,
  .overdue-chip {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(153, 27, 27, 0.08);
    width: fit-content;
  }
  .overdue-chip {
    background: rgba(220, 38, 38, 0.14);
    color: #b91c1c;
    font-weight: 700;
  }
  .thread-reply {
    margin-inline-start: 18px;
    border-inline-start: 2px solid rgba(153, 27, 27, 0.35);
    padding-inline-start: 8px;
  }
  .thread-count {
    margin-inline-start: 18px;
    font-size: 11px;
    opacity: 0.7;
  }
  .doc-title {
    font-weight: 700;
  }
  .caret-inline {
    display: inline-block;
    width: 2px;
    height: 14px;
    margin-inline-start: 3px;
    vertical-align: -2px;
    border-radius: 1px;
  }
  .caret-crimson {
    background: #991b1b;
    animation: teaser-caret-blink 1.1s linear infinite;
  }
  .caret-grey {
    background: #64748b;
  }
  .doc-note {
    font-size: 11px;
    opacity: 0.7;
  }
  .mini-table {
    border-collapse: collapse;
    font-size: 12px;
  }
  .mini-table th,
  .mini-table td {
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 3px 8px;
    text-align: start;
  }
  .wikilink {
    color: #991b1b;
    font-size: 12px;
  }
  .tree-row {
    font-size: 12px;
  }
  .tree-l1 {
    margin-inline-start: 14px;
  }
  .tree-l2 {
    margin-inline-start: 28px;
  }
  .tree-badge {
    font-size: 10px;
    background: rgba(0, 0, 0, 0.08);
    border-radius: 999px;
    padding: 0 6px;
  }
  .comment-note {
    font-size: 12px;
    font-style: italic;
  }
  .version-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .suggest-title {
    font-weight: 700;
    font-size: 12px;
  }
  .suggest-quote {
    font-size: 12px;
    opacity: 0.8;
  }
  .suggest-btn {
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: rgba(153, 27, 27, 0.85);
    border-radius: 999px;
    padding: 3px 10px;
    width: fit-content;
  }
  .born-task {
    font-size: 12px;
    color: #166534;
  }
  .kanban-cols {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    opacity: 0.7;
  }
  .kanban-track {
    position: relative;
    height: 30px;
    background: rgba(0, 0, 0, 0.04);
    border-radius: 8px;
  }
  .kanban-card {
    position: absolute;
    top: 4px;
    left: 4%;
    font-size: 11px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 8px;
    padding: 3px 8px;
    animation: kanban-slide 0.9s ease forwards;
  }
  @keyframes kanban-slide {
    to {
      left: 64%;
    }
  }
  .subtask-row {
    font-size: 12px;
  }
  .checklist-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .tick-box {
    width: 16px;
    height: 16px;
    border: 1.5px solid rgba(0, 0, 0, 0.25);
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: #fff;
  }
  .tick-box.ticked {
    background: #991b1b;
    border-color: #991b1b;
  }
  .guard-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .guard-note {
    font-size: 11px;
    opacity: 0.7;
  }
  .planner-rail {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .planner-menu {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.05);
  }
  .planner-menu.active {
    background: rgba(153, 27, 27, 0.12);
    color: #991b1b;
    font-weight: 700;
  }
  .planner-tasks {
    font-size: 12px;
  }
  .budget-bar {
    font-size: 12px;
    font-weight: 700;
  }
  .burndown-svg {
    width: 100%;
    height: 40px;
  }
  .burndown-line {
    stroke-dasharray: 260;
    stroke-dashoffset: 260;
    animation: teaser-line-draw 1.4s ease-out forwards;
  }
  .gantt-bar {
    height: 10px;
    width: 62%;
    border-radius: 999px;
    background: linear-gradient(90deg, #991b1b, rgba(153, 27, 27, 0.35));
  }
  .form-section {
    font-weight: 700;
    font-size: 12px;
  }
  .form-counter {
    font-size: 12px;
  }
  .form-answer {
    font-size: 12px;
    color: #166534;
  }
  .search-box {
    font-size: 12px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 8px;
    padding: 5px 10px;
  }
  .search-results {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .search-results span {
    font-size: 11px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .home-greet {
    font-weight: 700;
  }
  .home-row {
    font-size: 12px;
    opacity: 0.8;
  }
  .pulse-svg {
    width: 100%;
    height: 36px;
  }
  .pulse-line {
    stroke-dasharray: 260;
    stroke-dashoffset: 260;
    animation: teaser-line-draw 1.4s ease-out forwards;
  }
  .assistant-rail {
    font-size: 12px;
    font-weight: 700;
  }
  .assistant-result {
    font-size: 12px;
    opacity: 0.85;
  }

  /* نخِ خط در پایین صحنهٔ پرده‌ها (۲–۲۷ ثانیه). */
  .teaser-thread {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .thread-line {
    width: 120px;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, #cbd5e1, #991b1b);
  }
  .thread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
  }
  .thread-dot-crimson {
    background: #991b1b;
  }

  /* پایان (۲۷–۳۰ ثانیه): کلیپ B؛ اگر نرسید، کدِ مکش + نقطه + نشانگر. */
  .teaser-finale {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .teaser-video-finale {
    width: min(88vw, 420px);
    height: auto;
    border-radius: 16px;
    pointer-events: none;
  }
  .finale-code {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(88vw, 420px);
    height: 120px;
  }
  .finale-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #991b1b;
    animation: finale-dot-pulse 0.9s ease forwards;
  }
  @keyframes finale-dot-pulse {
    0% {
      transform: scale(1);
    }
    35% {
      transform: scale(1.5);
    }
    100% {
      transform: scale(1);
    }
  }
  .finale-caret {
    width: 3px;
    height: 36px;
    border-radius: 1.5px;
    background: #991b1b;
    margin-inline-start: 10px;
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

  /* دکمهٔ «رد کردن» — ظریف، گوشهٔ پایین؛ تنها عنصرِ قابل‌کلیکِ تیزر. */
  .teaser-skip {
    position: absolute;
    bottom: 14px;
    inset-inline-end: 16px;
    z-index: 30;
    pointer-events: auto;
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    background: rgba(255, 255, 255, 0.7);
    color: rgba(0, 0, 0, 0.6);
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .intro-teaser {
      gap: 10px;
      padding-bottom: 6vh;
    }
    .teaser-stage {
      width: 94vw;
    }
    .station {
      font-size: 12px;
      padding: 8px 10px;
    }
    .station-hero {
      font-size: 13px;
    }
    .thread-line {
      width: 80px;
    }
  }
</style>
