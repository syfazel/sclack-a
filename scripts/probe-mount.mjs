// Smoke check: mount the built app in jsdom and report JS errors +
// whether the login form renders.
// Why window.eval: jsdom does not execute <script type="module">, so the
// bundle source is evaluated in the jsdom window instead. Since S5 the
// bundle is code-split: Vite's dynamic-import helper uses import.meta
// (module-only) and Rollup emits a trailing facade export — both are
// parse errors in a classic script, so the eval'd copy is patched
// (import.meta -> safe values, facade export stripped). The real
// browser loads the bundle as a module, where both work.
// Usage: node scripts/probe-mount.mjs   (run after `npm run build`)
import { spawn } from 'node:child_process'
import { JSDOM, VirtualConsole } from 'jsdom'

const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}/sclack-a`
const errors = []

const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe']
})

async function waitForPreview() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/')
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('preview did not serve HTTP 200 in 15s')
}

try {
  await waitForPreview()
  const html = await (await fetch(BASE + '/')).text()
  const jsMatch = html.match(/\/sclack-a\/assets\/index-[^"]+\.js/)
  if (!jsMatch) throw new Error('no JS asset in index.html')
  const js = await (await fetch(`http://127.0.0.1:${PORT}${jsMatch[0]}`)).text()
  console.log('bundle bytes:', js.length)

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || e)))
  virtualConsole.on('error', (msg) => errors.push('console.error: ' + msg))

  const dom = new JSDOM(html, {
    url: BASE + '/',
 // no key in the URL; the app reads the key from the build
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  })
  dom.window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)))
  try {
    // See the header comment: patch the eval'd copy for code-split bundles.
    const jsForEval = js
      .replaceAll('import.meta.resolve', 'void 0')
      .replaceAll('import.meta.url', "'http://localhost/'")
      .replace(/export\{[^}]*\};?\s*$/, '')
    dom.window.eval(jsForEval)
  } catch (e) {
    errors.push('eval threw: ' + (e.message || e))
  }
  await new Promise((r) => setTimeout(r, 2000))
  const appHtml = dom.window.document.getElementById('app')?.innerHTML || ''
  console.log('app rendered length:', appHtml.length)
  console.log('has login form (ورود):', appHtml.includes('ورود'))
  console.log('has key notice (هنوز به سایت وصل نشده):', appHtml.includes('هنوز به سایت وصل نشده'))
  console.log('has brand (sclack_A):', appHtml.includes('sclack_A'))
  console.log('JS errors:', errors.length === 0 ? 'none' : errors)
  const ok = appHtml.length > 100 && appHtml.includes('ورود') && errors.length === 0
  console.log(ok ? 'MOUNT PROBE PASSED' : 'MOUNT PROBE FAILED')
  dom.window.close()
  process.exit(ok ? 0 : 1)
} catch (e) {
  console.log('MOUNT PROBE FAILED:', e.message)
  process.exit(1)
} finally {
  preview.kill()
}
