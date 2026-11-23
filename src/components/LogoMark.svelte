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
    stroke="#D1D5DB"
    stroke-width="3"
    stroke-linecap="round"
  />
  <circle cx="8" cy="25" r="5.5" fill="#D1D5DB" />
  <circle cx="25" cy="11" r="5.5" fill="#9CA3AF" />
  <circle cx="40" cy="21" r="5.5" fill="#6B7280" />
  <circle cx="56" cy="25" r="5.5" fill="#7F1D1D" />
</svg>
