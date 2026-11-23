// Landing video background probe (scripts/probe-landing-video.mjs) — 0.17.0
// باند ویدیویی پایین صفحهٔ ورودی (plan-landing-video-bg.md §3/§4).
//
// Clip A (clip-a-light.mp4) is ONE shared layer in Login.svelte — NOT
// inside the teaser any more: it plays frame-by-frame as the background
// of the lower part of the landing page, during the 30s teaser AND after
// it ends. Clip B stays inside the teaser (finale, checked by
// probe-teaser.mjs).
//
// Mounts the REAL built bundle in jsdom with a stubbed Supabase backend
// (signed-out, so the landing renders) and asserts:
//
//   * the video band mounts on the landing; src is clip-a-light.mp4
//     (base-aware); attributes muted/loop/autoplay/playsinline +
//     preload="auto" are set; it is bottom-anchored in the lower part
//     of the page (45vh desktop / 35vh mobile, gradient mask fading
//     into the page); layering: HeroScene < band (z 5) < card (z-10)
//     < teaser overlay (z-20).
//   * the band is present DURING the teaser and STILL present after the
//     teaser ends (not unmounted with the overlay).
//   * a load error hides the band (fallback) and the login still works.
//   * with prefers-reduced-motion or «حالت ساده» the band is hidden
//     (same rule as the teaser) and the login shows directly.
//   * no new 3D scene — the band is a plain <video> over HeroScene.
//
// No live Supabase, no test data in live tables. Same harness shape as
// probe-teaser.mjs (jsdom mount + eval'd bundle + stub fetch).
//
// Usage:
//   VITE_SUPABASE_URL=https://probe-ref.supabase.co \
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PLACEHOLDER-NOT-A-REAL-KEY \
//   npm run build && node scripts/probe-landing-video.mjs
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const BASE_URL = 'https://probe-ref.supabase.co'
// Bundle gate rebased to the 0.16.0 live bundle (707,326) + 10%.
const BUNDLE_CAP = Math.floor(707326 * 1.1)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS', name)
  else {
    failures++
    console.log('FAIL', name, extra ?? '')
  }
}

// ---------- static: sources + version + clip on disk ----------
{
  const loginSrc = readFileSync(new URL('../src/components/Login.svelte', import.meta.url), 'utf8')
  const teaserSrc = readFileSync(new URL('../src/components/IntroTeaser.svelte', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  check('static: version is 0.17.0', pkg.version === '0.17.0', 'version ' + pkg.version)
  check('static: shared video band in Login (data-landing-video + clip-a-light.mp4 + BASE_URL)',
    loginSrc.includes('data-landing-video') && loginSrc.includes('clip-a-light.mp4') &&
    loginSrc.includes('import.meta.env.BASE_URL'))
  check('static: video attrs — muted + loop + autoplay + playsinline + preload="auto"',
    loginSrc.includes('muted') && loginSrc.includes('loop') && loginSrc.includes('autoplay') &&
    loginSrc.includes('playsinline') && loginSrc.includes('preload="auto"'))
  check('static: band is bottom-anchored (absolute inset-x-0 bottom-0) with height 45vh',
    loginSrc.includes('absolute inset-x-0 bottom-0') && loginSrc.includes('height: 45vh'))
  check('static: mobile band height 35vh (max-width 480px media query)',
    loginSrc.includes('@media (max-width: 480px)') && loginSrc.includes('height: 35vh'))
  check('static: top edge fades with a gradient mask',
    loginSrc.includes('mask-image: linear-gradient(to bottom, transparent, black 30%)'))
  check('static: layering — band z 5 < card z-10 < teaser overlay z-20',
    loginSrc.includes('z-index: 5') && loginSrc.includes('relative z-10') &&
    teaserSrc.includes('z-index: 20'))
  check('static: band gated on teaserAllowed() (reduced-motion + simple-mode hide it)',
    loginSrc.includes('teaserAllowed() && !videoError') &&
    loginSrc.includes('prefers-reduced-motion') && loginSrc.includes('displayPrefs.simple'))
  check('static: video error fallback (onerror → hide band)',
    loginSrc.includes('onerror=') && loginSrc.includes('videoError'))
  check('static: clip A moved out of the teaser (no clip-a-light / data-teaser-video-a in IntroTeaser); clip B stays',
    !teaserSrc.includes('clip-a-light.mp4') && !teaserSrc.includes('data-teaser-video-a') &&
    teaserSrc.includes('clip-b-finale.mp4') && teaserSrc.includes('data-teaser-video-b'))
  check('static: clip on disk public/teaser/clip-a-light.mp4 (>1MB)',
    (() => {
      const p = new URL('../public/teaser/clip-a-light.mp4', import.meta.url)
      return existsSync(p) && statSync(p).size > 1000000
    })(),
    'missing or too small')
  check('static: no new 3D scene — the band is a plain <video> over HeroScene',
    !loginSrc.includes('WebGLRenderer') && !loginSrc.includes('graphics.js') &&
    !loginSrc.includes('new THREE'))
}

// ---------- mount harness (trimmed copy of probe-teaser) ----------
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

function realErrors(errors) {
  return errors.filter((e) => !/websocket|realtime|HTMLMediaElement.*play\(\)/i.test(e))
}

async function main() {
  const bundle = loadBundle()
  console.log('bundle:', bundle.jsFile, bundle.js.length, 'bytes')
  check('bundle: probe bundle within the 0.16.0 + 10% gate', bundle.js.length <= BUNDLE_CAP, 'bytes ' + bundle.js.length)

  // ---- Mount 1: default — the band is there during the teaser AND after it ----
  const m1 = await mountApp(bundle, { noSession: true })
  const w1 = m1.dom.window
  await waitFor(w1, () => w1.document.querySelector('[data-teaser]'), 10000, 'teaser overlay')
  const band1 = () => w1.document.querySelector('[data-landing-video]')
  check('mount: video band mounts on the landing', !!band1())
  check('mount: band src is clip-a-light.mp4',
    (band1()?.getAttribute('src') || '').includes('clip-a-light.mp4'),
    'src: ' + (band1()?.getAttribute('src') || ''))
  // Svelte sets `muted` as a property on media elements (not an
  // attribute) — assert the property, which is what makes autoplay work.
  check('mount: band attrs — muted (property) + loop + autoplay + playsinline + preload auto',
    band1()?.muted === true && band1()?.hasAttribute('loop') &&
    band1()?.hasAttribute('autoplay') && band1()?.hasAttribute('playsinline') &&
    band1()?.getAttribute('preload') === 'auto')
  check('mount: band is bottom-anchored in the landing root, before the login card',
    (() => {
      const v = band1()
      if (!v) return false
      const root = v.parentElement
      const card = w1.document.querySelector('.glass-card-landing')
      return !!root && root.classList.contains('min-h-screen') &&
        v.classList.contains('bottom-0') && v.classList.contains('inset-x-0') &&
        !!card && (v.compareDocumentPosition(card) & w1.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    })())
  check('mount: band is present DURING the teaser (shared layer, not inside the overlay)',
    !!band1() && !!w1.document.querySelector('[data-teaser]'))
  check('mount: sign-in form is in the DOM behind the teaser', signInFormRenders(w1))
  // The key behaviour: the overlay unmounts after 30s, the band must stay.
  await waitFor(w1, () => !w1.document.querySelector('[data-teaser]'), 40000, 'overlay gone after 30s')
  check('mount: overlay is gone after 30s', !w1.document.querySelector('[data-teaser]'))
  check('mount: band is STILL present after the teaser ends (not unmounted)',
    !!band1() && (band1()?.getAttribute('src') || '').includes('clip-a-light.mp4'))
  check('mount: login card is fully visible after the teaser',
    !!w1.document.querySelector('.glass-card-landing') && !w1.document.querySelector('.teaser-card-hidden'))
  check('mount: sign-in form renders after the teaser', signInFormRenders(w1))
  check('mount: 0 non-Realtime JS errors', realErrors(m1.errors).length === 0, JSON.stringify(realErrors(m1.errors).slice(0, 3)))
  m1.dom.window.close()

  // ---- Mount 2: fallback — a load error hides the band, the login still works ----
  const m2 = await mountApp(bundle, { noSession: true })
  const w2 = m2.dom.window
  await waitFor(w2, () => w2.document.querySelector('[data-landing-video]'), 10000, 'video band')
  check('fallback: video band is present at the start', !!w2.document.querySelector('[data-landing-video]'))
  w2.document.querySelector('[data-landing-video]').dispatchEvent(new w2.Event('error'))
  await sleep(250)
  check('fallback: band hidden after load error', !w2.document.querySelector('[data-landing-video]'))
  check('fallback: sign-in form still renders', signInFormRenders(w2))
  check('fallback: 0 non-Realtime JS errors', realErrors(m2.errors).length === 0, JSON.stringify(realErrors(m2.errors).slice(0, 3)))
  m2.dom.window.close()

  // ---- Mount 3: prefers-reduced-motion — no band, no teaser, login directly ----
  const m3 = await mountApp(bundle, { noSession: true, reducedMotion: true })
  const w3 = m3.dom.window
  await waitFor(w3, () => w3.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('reduced-motion: no video band', !w3.document.querySelector('[data-landing-video]'))
  check('reduced-motion: no teaser overlay', !w3.document.querySelector('[data-teaser]'))
  check('reduced-motion: login card is visible immediately',
    !!w3.document.querySelector('.glass-card-landing') && !w3.document.querySelector('.teaser-card-hidden'))
  check('reduced-motion: sign-in form renders', signInFormRenders(w3))
  check('reduced-motion: 0 non-Realtime JS errors', realErrors(m3.errors).length === 0, JSON.stringify(realErrors(m3.errors).slice(0, 3)))
  m3.dom.window.close()

  // ---- Mount 4: simple mode — no band, no teaser, login directly ----
  const m4 = await mountApp(bundle, { noSession: true, simpleMode: true })
  const w4 = m4.dom.window
  await waitFor(w4, () => w4.document.body.textContent.includes('ورود'), 10000, 'login form')
  check('simple-mode: no video band', !w4.document.querySelector('[data-landing-video]'))
  check('simple-mode: no teaser overlay', !w4.document.querySelector('[data-teaser]'))
  check('simple-mode: login card is visible immediately',
    !!w4.document.querySelector('.glass-card-landing') && !w4.document.querySelector('.teaser-card-hidden'))
  check('simple-mode: sign-in form renders', signInFormRenders(w4))
  check('simple-mode: 0 non-Realtime JS errors', realErrors(m4.errors).length === 0, JSON.stringify(realErrors(m4.errors).slice(0, 3)))
  m4.dom.window.close()

  console.log(failures === 0 ? 'ALL LANDING-VIDEO PROBES PASSED' : `${failures} PROBE(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.log('LANDING-VIDEO PROBE FAILED:', e.message)
  process.exit(1)
})
