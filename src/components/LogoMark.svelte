<!-- لوگوی sclack_A — چهار نقطه روی منحنی S (G9).
     یک منبع واحد برای سایدبار، ورود و fallback ایستای صحنه؛
     لوگو و اعداد هرگز نمی‌چرخند (R3). -->
<script>
  let { class: cls = 'h-7 w-14' } = $props()
</script>

<svg viewBox="0 0 64 32" class={cls} aria-hidden="true">
  <path
    d="M8 25 C 20 25, 22 7, 32 7 S 44 25, 56 25"
    fill="none"
    stroke="#E8B48A"
    stroke-width="3"
    stroke-linecap="round"
  />
  <circle cx="8" cy="25" r="5.5" fill="#D97706" />
  <circle cx="25" cy="11" r="5.5" fill="#E07830" />
  <circle cx="40" cy="21" r="5.5" fill="#F0705A" />
  <circle cx="56" cy="25" r="5.5" fill="#F97066" />
</svg>
