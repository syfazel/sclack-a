import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initDisplayPrefs } from './lib/display-prefs.js'

initDisplayPrefs()
mount(App, { target: document.getElementById('app') })

// PWA: ثبت سرویس‌ورکر برای «افزودن به صفحهٔ اصلی» گوشی (بدون کش — فقط نصب‌پذیری)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
