// Intro teaser probe (scripts/probe-teaser.mjs) — 0.15.0 تیزر ورودی لندینگ.
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (signed-out, so the landing renders) and asserts the teaser spec from
// plan-teaser-intro.md:
//
//   * تیزر ۸ ثانیه‌ای روی لندینگ mount می‌شود؛ پرده‌ها ۰ تا ۷ به ترتیب
//     می‌آیند؛ بعد از ۸ ثانیه overlay می‌رود، کارت ورود کامل است و
//     نشانگر در فیلد ایمیل چشمک می‌زند.
//   * کارت ورود تا پردهٔ ۶ پنهان است.
//   * با prefers-reduced-motion یا «حالت ساده» تیزر رد می‌شود و ورود
//     مستقیم نشان داده می‌شود (بدون نشانگر).
//   * بدون دکمهٔ رد کردن؛ هیچ صحنهٔ سه‌بعدی تازه‌ای نیست.
//
// No live Supabase, no test data in live tables. Same harness shape as
// probe-ux-rebuild.mjs (jsdom mount + eval'd bundle + stub fetch).
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-teaser.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
// Bundle gate from probe-ux-rebuild: 0.13.0 live (651,416) + 10%.
const BUNDLE_CAP = Math.floor(651416 * 1.1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

// ---------- static: sources + version ----------
{
  const teaserSrc = readFileSync(new URL('../src/components/IntroTeaser.svelte', import.meta.url), 'utf8')
  const loginSrc = readFileSync(new URL('../src/components/Login.svelte', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  check('static: version is 0.15.0', pkg.version === '0.15.0', 'version ' + pkg.version)
  check('static: IntroTeaser exists with data-teaser + data-beat',
    teaserSrc.includes('data-teaser') && teaserSrc.includes('data-beat'))
  check('static: 8 beats — stage classes beat-0..beat-7',
    [0, 1, 2, 3, 4, 5, 6, 7].every((i) => teaserSrc.includes('beat-' + i)))
  check('static: line + 4 dots + 3 glass cards + caret rect in the teaser',
    teaserSrc.includes('teaser-line') && teaserSrc.includes('teaser-dot-4') &&
    teaserSrc.includes('teaser-card-3') && teaserSrc.includes('teaser-caret-rect'))
  check('static: Login mounts IntroTeaser',
    loginSrc.includes("import IntroTeaser from './IntroTeaser.svelte'") && loginSrc.includes('<IntroTeaser'))
  check('static: Login clock — beats at 1s steps, done at 8000ms',
    loginSrc.includes('b * 1000') && loginSrc.includes('8000'))
  check('static: reduced-motion + simple-mode skip the teaser',
    loginSrc.includes('prefers-reduced-motion') && loginSrc.includes('displayPrefs.simple'))
  check('static: email caret after the teaser (data-teaser-caret)',
    loginSrc.includes('data-teaser-caret'))
  check('static: no skip button anywhere in the teaser',
    !teaserSrc.toLowerCase().includes('skip') && !teaserSrc.includes('رد کردن'))
  check('static: no new 3D scene — teaser is SVG/CSS only',
    (() => {
      // The header comment names HeroScene (it stays untouched behind
      // the teaser) — check the code, not the comment.
      const code = teaserSrc.replace(/<!--[\s\S]*?-->/g, '')
      return !code.includes('three') && !code.includes('graphics.js') && !code.includes('HeroScene')
    })())
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
  check('bundle: probe bundle within the 0.13.0 + 10% gate', bundle.js.length <= BUNDLE_CAP, 'bytes ' + bundle.js.length)

  // ---- Mount 1: default — the teaser plays through all 8 beats ----
  const m1 = await mountApp(bundle, { noSession: true })
  const w1 = m1.dom.window
  await waitFor(w1, () => w1.document.querySelector('[data-teaser]'), 10000, 'teaser overlay')
  check('mount: teaser overlay mounts on the landing', !!w1.document.querySelector('[data-teaser]'))
  check('mount: teaser starts at beat 0',
    w1.document.querySelector('[data-teaser]')?.getAttribute('data-beat') === '0')
  check('mount: login card is hidden while the teaser plays (beats 0-5)',
    !!w1.document.querySelector('.teaser-card-hidden'))
  check('mount: sign-in form is in the DOM behind the teaser', signInFormRenders(w1))

  // Poll the beat attribute until the overlay unmounts (8s timeline).
  const seen = []
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const el = w1.document.querySelector('[data-teaser]')
    if (el) {
      const b = el.getAttribute('data-beat')
      if (b !== null && (seen.length === 0 || seen[seen.length - 1] !== b)) seen.push(b)
    } else if (seen.includes('7')) {
      break
    }
    await sleep(200)
  }
  check('mount: beats arrive in order 0..7', seen.join(',') === '0,1,2,3,4,5,6,7', 'seen: ' + seen.join(','))
  await waitFor(w1, () => !w1.document.querySelector('[data-teaser]'), 5000, 'overlay gone')
  check('mount: overlay is gone after 8s', !w1.document.querySelector('[data-teaser]'))
  check('mount: login card is fully visible after the teaser',
    !!w1.document.querySelector('.glass-card-landing') && !w1.document.querySelector('.teaser-card-hidden'))
  check('mount: caret blinks in the email field after the teaser',
    !!w1.document.querySelector('[data-teaser-caret]'))
  check('mount: sign-in form renders after the teaser', signInFormRenders(w1))
  const realErrors1 = m1.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('mount: 0 non-Realtime JS errors on the teaser mount', realErrors1.length === 0, JSON.stringify(realErrors1.slice(0, 3)))
  m1.dom.window.close()

  // ---- Mount 2: prefers-reduced-motion — teaser skipped ----
  const m2 = await mountApp(bundle, { noSession: true, reducedMotion: true })
  const w2 = m2.dom.window
  await waitFor(w2, () => w2.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('reduced-motion: no teaser overlay', !w2.document.querySelector('[data-teaser]'))
  check('reduced-motion: login card is visible immediately',
    !!w2.document.querySelector('.glass-card-landing') && !w2.document.querySelector('.teaser-card-hidden'))
  check('reduced-motion: no caret (teaser never played)', !w2.document.querySelector('[data-teaser-caret]'))
  check('reduced-motion: sign-in form renders', signInFormRenders(w2))
  const realErrors2 = m2.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('reduced-motion: 0 non-Realtime JS errors', realErrors2.length === 0, JSON.stringify(realErrors2.slice(0, 3)))
  m2.dom.window.close()

  // ---- Mount 3: simple mode — teaser skipped ----
  const m3 = await mountApp(bundle, { noSession: true, simpleMode: true })
  const w3 = m3.dom.window
  await waitFor(w3, () => w3.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('simple-mode: no teaser overlay', !w3.document.querySelector('[data-teaser]'))
  check('simple-mode: login card is visible immediately',
    !!w3.document.querySelector('.glass-card-landing') && !w3.document.querySelector('.teaser-card-hidden'))
  check('simple-mode: no caret (teaser never played)', !w3.document.querySelector('[data-teaser-caret]'))
  check('simple-mode: sign-in form renders', signInFormRenders(w3))
  const realErrors3 = m3.errors.filter((e) => !/websocket|realtime/i.test(e))
  check('simple-mode: 0 non-Realtime JS errors', realErrors3.length === 0, JSON.stringify(realErrors3.slice(0, 3)))
  m3.dom.window.close()

  console.log(failures === 0 ? 'ALL TEASER PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('TEASER PROBE FAILED:', e.message)
  process.exit(1)
})
