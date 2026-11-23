// E2 — پورت ماژول گرافیکی E1 به داخل سایت Vite (بخش ۵ P01).
//
// صحنهٔ هیرو: چهار نقطهٔ لوگو روی منحنی S + ذره‌های نور حضور +
// کارت‌های شیشه‌ای تزئینی. فقط پوسته (ورود/خانه) — در چت، سند و
// ردیف تسک هرگز لود نمی‌شود (قانون لایه‌ها، G10).
//
// API همان E1 است: create / setProps / explode / dispose روی handle.
// رندرر فقط وقتی ساخته می‌شود که WebGL2 واقعاً حاضر باشد؛ در غیر
// این صورت handle با webgl:false برمی‌گردد و کامپوننت fallback ‏SVG
// را نشان می‌دهد. گراف صحنه (Scene/Geometry/Material) به GL نیاز
// ندارد، پس درگ و انفجار در سندباکس هم با ورودی واقعی قابل تست‌اند.
//
// three@0.187.0 پین‌شده؛ WebGL2؛ بودجه: ذرهٔ سنگین ۹۰۰ / سبک ۲۴۰؛
// سقف pixelRatio ‏۲ دسکتاپ / ۱٫۵ لمسی؛ حلقهٔ رندر با پنهان‌شدن تب،
// خارج‌شدن از دید یا prefers-reduced-motion کامل متوقف می‌شود.
import * as THREE from 'three'

export const HEAVY_PARTICLES = 900
export const LIGHT_PARTICLES = 240

// چهار نقطهٔ لوگو — همان مختصات SVG (viewBox ‏64×32) به فضای سه‌بعدی:
// x = (px - 32) * 0.1 ، y = (16 - py) * 0.1
export const LOGO_DOTS = [
  { x: -2.4, y: -0.9, color: '#D1D5DB' },
  { x: -0.7, y: 0.5, color: '#9CA3AF' },
  { x: 0.8, y: -0.5, color: '#6B7280' },
  { x: 2.4, y: -0.9, color: '#7F1D1D' }
]

// سه نمای دوربین (T2: نمای «از بالا» phi ‏0.34 برای پایداری).
export const CAMERA_VIEWS = {
  logo: { position: [0, 0.4, 9], label: 'لوگو' },
  workspace: { position: [5.5, 3.2, 6.5], label: 'فضای کاری' },
  top: { position: [0, 8.48, 3.0], label: 'از بالا', phi: 0.34 }
}

// رنگ‌های ذره‌ها — خاکستری و جیگری، از پالت تازه.
const PARTICLE_COLORS = ['#7F1D1D', '#991B1B', '#9CA3AF', '#D1D5DB']

// RNG قطعی (mulberry32) تا هندسهٔ ذره‌ها در پروب تکرارپذیر باشد.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function webgl2Available() {
  if (typeof document === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

// تصمیم خالص حالت گرافیک — ورودی: قابلیت دستگاه؛ خروجی: حالت و بودجه.
export function resolveGraphicsPrefs({ isTouch = false, prefersReducedMotion = false, webgl2 = true } = {}) {
  const animate = webgl2 && !prefersReducedMotion
  const mode = isTouch ? 'light' : 'heavy'
  return {
    mode,
    particles: mode === 'heavy' ? HEAVY_PARTICLES : LIGHT_PARTICLES,
    pixelRatioCap: isTouch ? 1.5 : 2,
    animate
  }
}

// هندسهٔ خالص ذره‌ها: count ذره در پوستهٔ کروی دور منحنی، با جهت
// انفجار (بردار یکه از مرکز) برای هر ذره.
export function buildParticleGeometry(count, seed = 20261121) {
  const rng = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const directions = new Float32Array(count * 3)
  const tmp = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // نقطهٔ تصادفی در پوستهٔ کرویِ شعاع ۱٫۲ تا ۴٫۲، تخت‌شده در Y.
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const r = 1.2 + rng() * 3.0
    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.cos(phi) * 0.55
    const z = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    const len = Math.hypot(x, y, z) || 1
    directions[i * 3] = x / len
    directions[i * 3 + 1] = y / len
    directions[i * 3 + 2] = z / len
    tmp.set(PARTICLE_COLORS[Math.floor(rng() * PARTICLE_COLORS.length)])
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  return { positions, colors, directions }
}

// چرخش با درگ — خالص و قابل تست: dx به راست = چرخش به راست.
export function applyDragRotation(rot, dx, dy) {
  const rotY = rot.rotY + dx * 0.005
  const rotX = Math.max(-0.6, Math.min(0.6, rot.rotX + dy * 0.003))
  return { rotY, rotX }
}

// پیشرفت انفجار در میلی‌ثانیه: ۰→۱ در ۲۵۰ms، برگشت به ۰ تا ۹۰۰ms.
export function burstProgress(elapsedMs) {
  if (elapsedMs <= 0) return 0
  if (elapsedMs >= 900) return 0
  if (elapsedMs <= 250) return elapsedMs / 250
  return 1 - (elapsedMs - 250) / 650
}

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  )
}

// نمونه‌برداری از همان دو منحنی بِزیهٔ لوگو (S) به نقاط سه‌بعدی.
function sCurvePoints() {
  const pts = []
  const seg1 = [
    [8, 25],
    [20, 25],
    [22, 7],
    [32, 7]
  ]
  const seg2 = [
    [32, 7],
    [42, 7],
    [44, 25],
    [56, 25]
  ]
  for (const seg of [seg1, seg2]) {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      const px = cubicBezier(seg[0][0], seg[1][0], seg[2][0], seg[3][0], t)
      const py = cubicBezier(seg[0][1], seg[1][1], seg[2][1], seg[3][1], t)
      pts.push(new THREE.Vector3((px - 32) * 0.1, (16 - py) * 0.1, 0))
    }
  }
  return pts
}

export function create(container, props = {}) {
  // jsdom reports 'ontouchstart' in window even with zero touch points,
  // so touch needs maxTouchPoints > 0 as well — otherwise every jsdom
  // run (and any no-touch browser exposing the handler) falls to light.
  const isTouch =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches ||
      ('ontouchstart' in window &&
        typeof navigator !== 'undefined' &&
        (navigator.maxTouchPoints ?? 0) > 0))
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const prefs = resolveGraphicsPrefs({
    isTouch,
    prefersReducedMotion,
    webgl2: webgl2Available()
  })

  const state = {
    mode: props.mode || prefs.mode,
    view: props.view || 'logo',
    calm: props.calm === true,
    onlineCount: props.onlineCount ?? 4,
    rotY: 0,
    rotX: 0,
    spin: 0,
    burstStart: -1,
    running: false,
    paused: !prefs.animate,
    frames: 0,
    disposed: false
  }

  // --- گراف صحنه (بدون نیاز به GL) ---
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 640 / 320, 0.1, 100)
  const group = new THREE.Group()
  scene.add(group)
  // Landing framing (0.13.1): the login card sits in the lower half, so
  // the logo group is shifted up into the free upper zone. Rotation and
  // burst only touch group.rotation / particle positions, never
  // group.position, so the shift persists.
  if (props.shiftY) group.position.y = props.shiftY

  const curve = new THREE.CatmullRomCurve3(sCurvePoints())
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 64, 0.045, 8, false),
    new THREE.MeshBasicMaterial({ color: '#D1D5DB' })
  )
  group.add(tube)

  const dotMeshes = LOGO_DOTS.map((d) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 16),
      new THREE.MeshBasicMaterial({ color: d.color })
    )
    m.position.set(d.x, d.y, 0)
    group.add(m)
    return m
  })

  // ذره‌های حضور — همیشه با سقف سنگین ساخته می‌شوند؛ حالت سبک فقط
  // drawRange را به ۲۴۰ برمی‌گرداند (تعویض ارزان، بدون بازسازی).
  const geo = buildParticleGeometry(HEAVY_PARTICLES)
  const pointsGeo = new THREE.BufferGeometry()
  pointsGeo.setAttribute('position', new THREE.BufferAttribute(geo.positions.slice(), 3))
  pointsGeo.setAttribute('color', new THREE.BufferAttribute(geo.colors, 3))
  const points = new THREE.Points(
    pointsGeo,
    new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.9 })
  )
  group.add(points)
  const basePositions = geo.positions.slice()

  // ۵ کارت شیشه‌ای تزئینی — فقط پس‌زمینهٔ پوسته.
  const cardMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.16
  })
  const cardGeo = new THREE.PlaneGeometry(1.5, 0.95)
  const cardSpots = [
    [-3.6, 1.3, -1.2, 0.25],
    [3.7, 1.1, -1.0, -0.3],
    [-3.9, -1.2, -0.6, -0.2],
    [3.9, -1.3, -0.8, 0.35],
    [0, 2.1, -1.6, 0]
  ]
  for (const [x, y, z, rz] of cardSpots) {
    const card = new THREE.Mesh(cardGeo, cardMat)
    card.position.set(x, y, z)
    card.rotation.z = rz
    group.add(card)
  }

  function applyMode() {
    const n = state.mode === 'heavy' ? HEAVY_PARTICLES : LIGHT_PARTICLES
    pointsGeo.setDrawRange(0, n)
  }
  function applyOnlineCount() {
    dotMeshes.forEach((m, i) => {
      const on = i < state.onlineCount
      m.material.color.set(LOGO_DOTS[i].color)
      m.material.opacity = on ? 1 : 0.35
      m.material.transparent = !on
    })
  }
  function applyView() {
    const v = CAMERA_VIEWS[state.view] || CAMERA_VIEWS.logo
    cameraTarget.set(v.position[0], v.position[1], v.position[2])
  }
  const cameraTarget = new THREE.Vector3(...CAMERA_VIEWS.logo.position)
  camera.position.copy(cameraTarget)
  camera.lookAt(0, 0, 0)
  applyMode()
  applyOnlineCount()
  applyView()

  // --- رندرر (فقط با WebGL2 واقعی) ---
  let renderer = null
  let canvas = null
  const webgl = prefs.animate && webgl2Available()
  if (webgl) {
    try {
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      container.appendChild(canvas)
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, prefs.pixelRatioCap)
      )
      const w = container.clientWidth || 640
      const h = container.clientHeight || 320
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    } catch {
      renderer = null
      if (canvas && canvas.parentNode === container) container.removeChild(canvas)
      canvas = null
    }
  }
  const hasRenderer = !!renderer

  // --- ورودی: درگ (موس/انگشت) + زوم با چرخ موس ---
  let dragging = false
  let lastX = 0
  let lastY = 0
  function onPointerDown(e) {
    // فقط درگ روی خود بوم/پس‌زمینه — کلیک روی دکمه‌های کنترل
    // (فرزند کانتینر) چرخش را شروع نمی‌کند.
    if (e.target !== container && e.target !== canvas) return
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    try {
      container.setPointerCapture?.(e.pointerId)
    } catch {
      /* jsdom / مرورگر قدیمی */
    }
  }
  function onPointerMove(e) {
    if (!dragging) return
    const next = applyDragRotation(state, e.clientX - lastX, e.clientY - lastY)
    state.rotY = next.rotY
    state.rotX = next.rotX
    lastX = e.clientX
    lastY = e.clientY
  }
  function onPointerUp() {
    dragging = false
  }
  function onWheel(e) {
    e.preventDefault()
    const p = CAMERA_VIEWS[state.view] || CAMERA_VIEWS.logo
    const dir = new THREE.Vector3(...p.position).normalize()
    const dist = camera.position.length()
    const next = Math.max(6, Math.min(12, dist + (e.deltaY > 0 ? 0.6 : -0.6)))
    cameraTarget.copy(dir.multiplyScalar(next))
  }
  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerUp)
  container.addEventListener('pointercancel', onPointerUp)
  container.addEventListener('wheel', onWheel, { passive: false })

  // --- توقف حلقه: تب پنهان / خارج از دید ---
  function onVisibility() {
    if (typeof document !== 'undefined') {
      setPaused(document.visibilityState === 'hidden')
    }
  }
  let observer = null
  if (typeof document !== 'undefined' && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      setPaused(!entries[0]?.isIntersecting)
    })
    observer.observe(container)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  function setPaused(v) {
    state.paused = !!v
    if (!state.paused && hasRenderer && !state.disposed) startLoop()
  }

  let rafId = 0
  let lastT = 0
  function tick(t) {
    if (state.disposed || state.paused || !renderer) return
    rafId = requestAnimationFrame(tick)
    const dt = lastT ? Math.min(t - lastT, 100) : 16
    lastT = t
    // چرخش آرام خودکار (در حالت آرام کندتر) + درگ کاربر.
    state.spin += (state.calm ? 0.0006 : 0.0015) * (dt / 16)
    group.rotation.y = state.rotY + state.spin
    group.rotation.x = state.rotX
    points.rotation.y += (state.calm ? 0.0004 : 0.0009) * (dt / 16)
    // انفجار: ذره‌ها از مرکز دور می‌شوند و برمی‌گردند.
    if (state.burstStart >= 0) {
      const f = burstProgress(t - state.burstStart)
      const pos = pointsGeo.attributes.position.array
      for (let i = 0; i < HEAVY_PARTICLES; i++) {
        pos[i * 3] = basePositions[i * 3] + geo.directions[i * 3] * f * 1.2
        pos[i * 3 + 1] = basePositions[i * 3 + 1] + geo.directions[i * 3 + 1] * f * 1.2
        pos[i * 3 + 2] = basePositions[i * 3 + 2] + geo.directions[i * 3 + 2] * f * 1.2
      }
      pointsGeo.attributes.position.needsUpdate = true
      if (f === 0 && t - state.burstStart >= 900) state.burstStart = -1
    }
    // دوربین نرم به سمت نمای هدف می‌لغزد.
    camera.position.lerp(cameraTarget, 0.08)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    state.frames++
  }
  function startLoop() {
    if (!renderer || state.disposed || state.paused || state.running) return
    state.running = true
    lastT = 0
    rafId = requestAnimationFrame(tick)
  }
  function stopLoop() {
    state.running = false
    cancelAnimationFrame(rafId)
  }

  // تغییر اندازه با کانتینر.
  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined' && renderer) {
    resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 640
      const h = container.clientHeight || 320
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(container)
  }

  if (hasRenderer && !state.paused) startLoop()

  const handle = {
    mode: state.mode,
    view: state.view,
    webgl: hasRenderer,
    group,
    camera,
    renderer,
    setProps(p = {}) {
      if (p.mode && p.mode !== state.mode) {
        state.mode = p.mode
        handle.mode = p.mode
        applyMode()
      }
      if (p.view && p.view !== state.view) handle.setView(p.view)
      if (typeof p.onlineCount === 'number') {
        state.onlineCount = Math.max(0, Math.min(4, p.onlineCount))
        applyOnlineCount()
      }
      if (typeof p.calm === 'boolean') state.calm = p.calm
    },
    setView(v) {
      if (!CAMERA_VIEWS[v]) return
      state.view = v
      handle.view = v
      applyView()
    },
    explode() {
      state.burstStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (hasRenderer && state.paused) {
        // حتی در توقف، یک فریم انفجار را رندر کن تا اثر دیده شود.
        state.paused = false
        startLoop()
        setTimeout(() => {
          if (state.burstStart < 0) setPaused(true)
        }, 950)
      }
    },
    setPaused,
    dispose() {
      state.disposed = true
      stopLoop()
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('wheel', onWheel)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      observer?.disconnect()
      resizeObserver?.disconnect()
      if (renderer) renderer.dispose()
      if (canvas && canvas.parentNode === container) container.removeChild(canvas)
      scene.traverse((o) => {
        o.geometry?.dispose?.()
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.())
        else o.material?.dispose?.()
      })
    },
    getState() {
      return {
        mode: state.mode,
        view: state.view,
        calm: state.calm,
        onlineCount: state.onlineCount,
        rotY: state.rotY,
        rotX: state.rotX,
        burstActive: state.burstStart >= 0,
        paused: state.paused,
        running: state.running,
        frames: state.frames,
        webgl: hasRenderer,
        particlesShown: state.mode === 'heavy' ? HEAVY_PARTICLES : LIGHT_PARTICLES,
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        cameraTarget: [cameraTarget.x, cameraTarget.y, cameraTarget.z],
        groupChildren: group.children.length,
        groupPositionY: group.position.y,
        disposed: state.disposed
      }
    }
  }
  return handle
}

// API هم‌نام E1.
export const SclackGraphics = { create, resolveGraphicsPrefs, webgl2Available }
export default SclackGraphics
