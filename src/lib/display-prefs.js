// ترجیح‌های نمایشی (بخش ۵ P01 — G8/R3).
//
// «حالت ساده» شیشه را به مات برمی‌گرداند و صحنهٔ سه‌بعدی را خاموش
// می‌کند؛ در localStorage می‌ماند. پیش‌فرض هم از
// prefers-reduced-transparency خوانده می‌شود.
import { displayPrefs } from './store.svelte.js'

const KEY = 'sclack-simple-mode'

export function initDisplayPrefs() {
  if (typeof window === 'undefined') return
  let saved = null
  try {
    saved = window.localStorage.getItem(KEY)
  } catch {
    saved = null
  }
  const reduced =
    !!window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches
  const simple = saved === '1' || (saved === null && reduced)
  applySimpleMode(simple, false)
}

export function toggleSimpleMode() {
  applySimpleMode(!displayPrefs.simple, true)
}

export function applySimpleMode(on, persist = true) {
  displayPrefs.simple = !!on
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('simple-mode', !!on)
  }
  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* فضای ذخیره‌سازی در دسترس نیست */
    }
  }
}
