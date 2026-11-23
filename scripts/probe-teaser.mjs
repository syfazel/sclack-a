// Intro teaser probe v2 (scripts/probe-teaser.mjs) — 0.16.0 تیزر ورودی لندینگ
// «یک خط، نوزده ایستگاه» (plan-teaser-v2.md §6/§7/§9/§10).
// 0.17.0: کلیپ A از تیزر بیرون رفت (لایهٔ مشترک پایین لندینگ در Login؛
// probe-landing-video) — این پروب فقط کلیپ B را چک می‌کند.
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (signed-out, so the landing renders) and asserts:
//
//   * تیزر ۳۰ ثانیه‌ای روی لندینگ mount می‌شود؛ پرده‌ها ۰ تا ۲۹ به ترتیب
//     می‌آیند؛ پرده‌ها (data-act) ۰ تا ۶ به ترتیب؛ هر ۱۹ ایستگاه با برچسب
//     فارسی‌اش دیده می‌شود؛ در هر پرده دقیقاً یک قهرمان (station-hero)
//     هست (ایستگاه‌های ۱، ۵، ۱۰، ۱۶، ۱۹).
//   * دکمهٔ ظریف «رد کردن» هست؛ کلیک آن تیزر را همان‌جا تمام می‌کند،
//     کارت ورود می‌نشیند و نشانگر نمی‌آید (پایان طبیعی نبوده).
//   * بعد از ۳۰ ثانیه overlay می‌رود، کارت ورود کامل است و نشانگر در
//     فیلد ایمیل چشمک می‌زند.
//   * کارت ورود تا پردهٔ ۲۷ پنهان است.
//   * کلیپ پایانی (clip-b-finale.mp4، پنجرهٔ ۷–۱۰ ثانیه) با src
//     پایه‌محور حاضر است؛ با خطای لود، پایان به‌صورت کدی برمی‌گردد
//     (fallback صریح). کلیپ A (نورِ پس‌زمینه) از ۰٫۱۷٫۰ لایهٔ مشترک
//     پایین لندینگ در Login است و در probe-landing-video چک می‌شود.
//   * با prefers-reduced-motion یا «حالت ساده» تیزر رد می‌شود و ورود
//     مستقیم نشان داده می‌شود (بدون نشانگر).
//   * هیچ صحنهٔ سه‌بعدی تازه‌ای نیست.
//
// No live Supabase, no test data in live tables. Same harness shape as
// probe-ux-rebuild.mjs (jsdom mount + eval'd bundle + stub fetch).
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-teaser.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
// Bundle gate rebased to the 0.15.0 live bundle (696,272) + 10%.
const BUNDLE_CAP = Math.floor(696272 * 1.1)

const STATIONS = [
  [1, 'پیام زنده'], [2, 'منشن'], [3, 'ترد'], [4, 'پیام شخصی'],
  [5, 'سند مشترک'], [6, 'سند غنی'], [7, 'سند تودرتو'], [8, 'نظر'], [9, 'نسخه‌ها'],
  [10, 'چت می‌شود کار'], [11, 'کانبان'], [12, 'زیروظیفه و چک‌لیست'],
  [13, 'نگهبان مهلت‌ها'], [14, 'برنامه‌ریز'],
  [15, 'بودجه و زمان‌بندی'], [16, 'کاربرگ ۴۶ سوالی'], [17, 'جست‌وجو'],
  [18, 'خانه و نبض تیم'], [19, 'دستیار میوز']
]
const HEROES = [1, 5, 10, 16, 19]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

// ---------- static: sources + version + clips on disk ----------
{
  const teaserSrc = readFileSync(new URL('../src/components/IntroTeaser.svelte', import.meta.url), 'utf8')
  const loginSrc = readFileSync(new URL('../src/components/Login.svelte', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  check('static: version is 0.17.0', pkg.version === '0.17.0', 'version ' + pkg.version)
  check('static: IntroTeaser exists with data-teaser + data-beat + data-act',
    teaserSrc.includes('data-teaser') && teaserSrc.includes('data-beat') && teaserSrc.includes('data-act'))
  check('static: all 19 stations present (data-station 1..19)',
    STATIONS.every(([n]) => teaserSrc.includes(`data-station="${n}"`)))
  check('static: all 19 Persian labels present',
    STATIONS.every(([, label]) => teaserSrc.includes(label)),
    'missing: ' + STATIONS.filter(([, l]) => !teaserSrc.includes(l)).map(([, l]) => l).join(', '))
  check('static: hero + background station classes exist',
    teaserSrc.includes('station-hero') && teaserSrc.includes('station-bg'))
  check('static: skip button (data-teaser-skip + «رد کردن» + onskip prop)',
    teaserSrc.includes('data-teaser-skip') && teaserSrc.includes('رد کردن') && teaserSrc.includes('onskip'))
  check('static: Login passes onskip and skips the teaser',
    loginSrc.includes('onskip={skipTeaser}') && loginSrc.includes('function skipTeaser'))
  check('static: Login clock — beats 1..29 at 1s steps, done at 30000ms',
    loginSrc.includes('b <= 29') && loginSrc.includes('b * 1000') && loginSrc.includes('30000'))
  check('static: login card hidden until beat 27; caret only on natural end (teaserCompleted)',
    loginSrc.includes('teaserBeat < 27') && loginSrc.includes('teaserCompleted'))
  check('static: video B (finale window 7-10) with base-aware src; clip A moved to Login (shared landing layer)',
    teaserSrc.includes('data-teaser-video-b') && teaserSrc.includes('clip-b-finale.mp4') &&
    teaserSrc.includes('data-finale-window="7-10"') &&
    teaserSrc.includes('import.meta.env.BASE_URL') &&
    !teaserSrc.includes('clip-a-light.mp4') && !teaserSrc.includes('data-teaser-video-a') &&
    loginSrc.includes('data-landing-video') && loginSrc.includes('clip-a-light.mp4'))
  check('static: video B error fallback (onerror → hide clip, code finale)',
    teaserSrc.includes('onerror=') && teaserSrc.includes('videoBError') &&
    !teaserSrc.includes('videoAError'))
  check('static: reduced-motion + simple-mode skip the teaser',
    loginSrc.includes('prefers-reduced-motion') && loginSrc.includes('displayPrefs.simple'))
  check('static: email caret after the teaser (data-teaser-caret)',
    loginSrc.includes('data-teaser-caret'))
  check('static: no new 3D scene — teaser is SVG/CSS + video only',
    (() => {
      // The header comment names HeroScene (it stays untouched behind
      // the teaser) — check the code, not the comment.
      const code = teaserSrc.replace(/<!--[\s\S]*?-->/g, '')
      return !code.includes('three') && !code.includes('graphics.js') && !code.includes('HeroScene')
    })())
  for (const [file, minBytes] of [['clip-a-light.mp4', 1000000], ['clip-b-finale.mp4', 1000000]]) {
    const p = new URL('../public/teaser/' + file, import.meta.url)
    check(`static: clip on disk public/teaser/${file} (>1MB)`,
      existsSync(p) && statSync(p).size > minBytes,
      existsSync(p) ? 'bytes ' + statSync(p).size : 'missing')
  }
}

// ---------- mount harness (trimmed copy of probe-ux-rebuild) ----------
function loadBundle() {
  const distDir = new URL('../dist/', import.meta.url).pathname
  const html = readFileSync(distDir + 'index.html', 'utf8')
  const jsFile = readdirSync(distDir + 'assets').find((f) => f.startsWith('index-') && f.endsWith('.js'))
  if (!jsFile) throw new Error('no JS asset in dist/assets')
  return { html, js: readFileSync(distDir + 'assets/' + jsFile, 'utf8'), jsFile }
}

function json(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function mountApp({ html, js }, opts = {}) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
  virtualConsole.on('error', (msg) => errors.push('console.error: ' + String(msg)))
  const dom = new JSDOM(html, {
    url: 'http://localhost/sclack-a/#/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  const w = dom.window
  if (!w.fetch) w.fetch = fetch
  if (!w.Headers) w.Headers = Headers
  if (!w.Request) w.Request = Request
  if (!w.Response) w.Response = Response
  if (!w.BroadcastChannel && typeof BroadcastChannel !== 'undefined') w.BroadcastChannel = BroadcastChannel
  if (!w.WebSocket) {
    w.WebSocket = class {
      constructor() { this.readyState = 0 }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
  }
  // Signed-out mount: no session in localStorage; the stub answers every
  // Supabase call with an empty payload (the auth client never needs the
  // network to report "no session").
  w.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url)
    if (url.startsWith(BASE_URL + '/rest/v1/')) return json([])
    return json({})
  }
  if (opts.simpleMode) w.localStorage.setItem('sclack-simple-mode', '1')
  if (opts.reducedMotion) {
    w.matchMedia = (q) => ({
      matches: String(q).includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false }
    })
  }
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    const jsForEval = js
      .replaceAll('import.meta.resolve', 'void 0')
      .replaceAll('import.meta.url', "'http://localhost/'")
      .replace(/export\{[^}]*\};?\s*$/, '')
    w.eval(jsForEval)
  } catch (e) {
    errors.push('eval threw: ' + (e.message || e))
  }
  return { dom, w, errors }
}

async function waitFor(w, fn, timeoutMs = 10000, label = 'condition') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fn()
      if (v) return v
    } catch { /* keep waiting */ }
    await sleep(100)
  }
  throw new Error('timeout waiting for: ' + label)
}

function signInFormRenders(w) {
  return !!w.document.querySelector('input[type="email"]') &&
    !!w.document.querySelector('input[type="password"]') &&
    [...w.document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'ورود')
}

async function main() {
  const bundle = loadBundle()
  console.log('bundle:', bundle.jsFile, bundle.js.length, 'bytes')
  check('bundle: probe bundle within the 0.15.0 + 10% gate', bundle.js.length <= BUNDLE_CAP, 'bytes ' + bundle.js.length)

  // ---- Mount 1: default — the full 30s teaser ----
  const m1 = await mountApp(bundle, { noSession: true })
  const w1 = m1.dom.window
  await waitFor(w1, () => w1.document.querySelector('[data-teaser]'), 10000, 'teaser overlay')
  const root1 = () => w1.document.querySelector('[data-teaser]')
  check('mount: teaser overlay mounts on the landing', !!root1())
  check('mount: teaser starts at beat 0, act 0',
    root1()?.getAttribute('data-beat') === '0' && root1()?.getAttribute('data-act') === '0')
  check('mount: skip button («رد کردن») is present',
    !!w1.document.querySelector('[data-teaser-skip]') &&
    w1.document.querySelector('[data-teaser-skip]')?.textContent.trim() === 'رد کردن')
  check('mount: login card is hidden while the teaser plays (beats 0-26)',
    !!w1.document.querySelector('.teaser-card-hidden'))
  check('mount: sign-in form is in the DOM behind the teaser', signInFormRenders(w1))

  // Poll the whole 30s timeline: stations, beats, acts, heroes, video B.
  const seenStations = new Set()
  const labelsOk = new Set()
  const seenHeroes = new Set()
  const seenBeats = []
  const seenActs = []
  let videoBSeen = false
  let videoBWindow = null
  let videoBFallbackOk = false
  const deadline = Date.now() + 36000
  while (Date.now() < deadline) {
    const el = root1()
    if (el) {
      const b = el.getAttribute('data-beat')
      if (b !== null && (seenBeats.length === 0 || seenBeats[seenBeats.length - 1] !== b)) seenBeats.push(b)
      const a = el.getAttribute('data-act')
      if (a !== null && (seenActs.length === 0 || seenActs[seenActs.length - 1] !== a)) seenActs.push(a)
      for (const st of w1.document.querySelectorAll('[data-station]')) {
        const n = Number(st.getAttribute('data-station'))
        seenStations.add(n)
        const label = STATIONS.find(([id]) => id === n)?.[1]
        if (label && st.textContent.includes(label)) labelsOk.add(n)
        if (st.classList.contains('station-hero')) seenHeroes.add(n)
      }
      const vB = w1.document.querySelector('[data-teaser-video-b]')
      if (vB && !videoBSeen) {
        videoBSeen = true
        videoBWindow = vB.getAttribute('data-finale-window')
        // Video B fallback: a load error hides the clip (code finale continues).
        vB.dispatchEvent(new w1.Event('error'))
        await sleep(250)
        videoBFallbackOk = !w1.document.querySelector('[data-teaser-video-b]') &&
          !!w1.document.querySelector('[data-finale-code]') &&
          root1()?.hasAttribute('data-video-b-fallback')
      }
    } else if (seenBeats.includes('29')) {
      break
    }
    await sleep(200)
  }
  check('mount: all 19 stations appear with their labels',
    seenStations.size === 19 && STATIONS.every(([n]) => seenStations.has(n)),
    'seen: ' + [...seenStations].sort((a, b) => a - b).join(','))
  check('mount: each station shows its Persian label',
    labelsOk.size === 19 && STATIONS.every(([n]) => labelsOk.has(n)),
    'labels verified: ' + [...labelsOk].sort((a, b) => a - b).join(','))
  check('mount: beats arrive in order 0..29',
    seenBeats.join(',') === Array.from({ length: 30 }, (_, i) => String(i)).join(','),
    'seen: ' + seenBeats.join(','))
  check('mount: acts arrive in order 0..6',
    seenActs.join(',') === '0,1,2,3,4,5,6', 'seen: ' + seenActs.join(','))
  check('mount: one hero per act — heroes are stations 1, 5, 10, 16, 19',
    HEROES.every((n) => seenHeroes.has(n)) && seenHeroes.size === 5,
    'heroes seen: ' + [...seenHeroes].sort((a, b) => a - b).join(','))
  check('mount: finale video B appears with the 7-10s window',
    videoBSeen && videoBWindow === '7-10', 'window: ' + videoBWindow)
  check('mount: video B fallback — clip hidden after load error, code finale shown',
    videoBFallbackOk)
  await waitFor(w1, () => !w1.document.querySelector('[data-teaser]'), 5000, 'overlay gone')
  check('mount: overlay is gone after 30s', !w1.document.querySelector('[data-teaser]'))
  check('mount: login card is fully visible after the teaser',
    !!w1.document.querySelector('.glass-card-landing') && !w1.document.querySelector('.teaser-card-hidden'))
  check('mount: caret blinks in the email field after the teaser',
    !!w1.document.querySelector('[data-teaser-caret]'))
  check('mount: sign-in form renders after the teaser', signInFormRenders(w1))
  const realErrors1 = m1.errors.filter((e) => !/websocket|realtime|HTMLMediaElement.*play\(\)/i.test(e))
  check('mount: 0 non-Realtime JS errors on the teaser mount', realErrors1.length === 0, JSON.stringify(realErrors1.slice(0, 3)))
  m1.dom.window.close()

  // ---- Mount 2: skip — clicking «رد کردن» ends the teaser immediately ----
  const m2 = await mountApp(bundle, { noSession: true })
  const w2 = m2.dom.window
  await waitFor(w2, () => w2.document.querySelector('[data-teaser-skip]'), 10000, 'skip button')
  check('skip: skip button is present at the start', !!w2.document.querySelector('[data-teaser-skip]'))
  w2.document.querySelector('[data-teaser-skip]').click()
  await waitFor(w2, () => !w2.document.querySelector('[data-teaser]'), 5000, 'overlay gone after skip')
  check('skip: overlay is gone right after clicking «رد کردن»', !w2.document.querySelector('[data-teaser]'))
  check('skip: login card is fully visible after skipping',
    !!w2.document.querySelector('.glass-card-landing') && !w2.document.querySelector('.teaser-card-hidden'))
  check('skip: no caret (the teaser was skipped, not completed)', !w2.document.querySelector('[data-teaser-caret]'))
  check('skip: sign-in form renders after skipping', signInFormRenders(w2))
  const realErrors2 = m2.errors.filter((e) => !/websocket|realtime|HTMLMediaElement.*play\(\)/i.test(e))
  check('skip: 0 non-Realtime JS errors', realErrors2.length === 0, JSON.stringify(realErrors2.slice(0, 3)))
  m2.dom.window.close()

  // ---- Mount 3: prefers-reduced-motion — teaser skipped ----
  const m3 = await mountApp(bundle, { noSession: true, reducedMotion: true })
  const w3 = m3.dom.window
  await waitFor(w3, () => w3.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('reduced-motion: no teaser overlay', !w3.document.querySelector('[data-teaser]'))
  check('reduced-motion: login card is visible immediately',
    !!w3.document.querySelector('.glass-card-landing') && !w3.document.querySelector('.teaser-card-hidden'))
  check('reduced-motion: no caret (teaser never played)', !w3.document.querySelector('[data-teaser-caret]'))
  check('reduced-motion: sign-in form renders', signInFormRenders(w3))
  const realErrors3 = m3.errors.filter((e) => !/websocket|realtime|HTMLMediaElement.*play\(\)/i.test(e))
  check('reduced-motion: 0 non-Realtime JS errors', realErrors3.length === 0, JSON.stringify(realErrors3.slice(0, 3)))
  m3.dom.window.close()

  // ---- Mount 4: simple mode — teaser skipped ----
  const m4 = await mountApp(bundle, { noSession: true, simpleMode: true })
  const w4 = m4.dom.window
  await waitFor(w4, () => w4.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('simple-mode: no teaser overlay', !w4.document.querySelector('[data-teaser]'))
  check('simple-mode: login card is visible immediately',
    !!w4.document.querySelector('.glass-card-landing') && !w4.document.querySelector('.teaser-card-hidden'))
  check('simple-mode: no caret (teaser never played)', !w4.document.querySelector('[data-teaser-caret]'))
  check('simple-mode: sign-in form renders', signInFormRenders(w4))
  const realErrors4 = m4.errors.filter((e) => !/websocket|realtime|HTMLMediaElement.*play\(\)/i.test(e))
  check('simple-mode: 0 non-Realtime JS errors', realErrors4.length === 0, JSON.stringify(realErrors4.slice(0, 3)))
  m4.dom.window.close()

  console.log(failures === 0 ? 'ALL TEASER PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('TEASER PROBE FAILED:', e.message)
  process.exit(1)
})
