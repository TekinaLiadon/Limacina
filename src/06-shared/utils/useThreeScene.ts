import { onMounted, onBeforeUnmount, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface ThreeSceneOptions {
  background?: number | string
  cameraPosition?: [number, number, number]
  cameraFov?: number
  enableZoom?: boolean
  autoRotate?: boolean
  autoRotateSpeed?: number
}

interface ThreeSceneState {
  scene: Ref<THREE.Scene | null>
  camera: Ref<THREE.PerspectiveCamera | null>
  renderer: Ref<THREE.WebGLRenderer | null>
  getOrbitControls: () => OrbitControls | null
}

export function useThreeScene(
  container: Ref<HTMLDivElement | null>,
  options: ThreeSceneOptions = {}
): ThreeSceneState {
  const {
    cameraPosition = [0, 5, 22],
    cameraFov = 35,
    enableZoom = false,
    autoRotate = false,
    autoRotateSpeed = 1.5,
    background,
  } = options

  const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
  const scene = shallowRef<THREE.Scene | null>(null)
  const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
  let animationId = 0
  let orbitControls: OrbitControls | null = null
  let resizeObserver: ResizeObserver | null = null
  let themeObserver: MutationObserver | null = null

  const resolveBackground = (): number | string => {
    if (background !== undefined) return background
    return getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim()
  }

  const applyBackground = (s: THREE.Scene): void => {
    const cssBackground = resolveBackground()
    s.background = cssBackground === '' ? null : new THREE.Color(cssBackground)
  }

  function initScene(): void {
    if (!container.value) return

    const w = container.value.clientWidth
    const h = container.value.clientHeight
    const aspect = w > 0 && h > 0 ? w / h : 1
    const s = new THREE.Scene()
    applyBackground(s)
    scene.value = s

    const cam = new THREE.PerspectiveCamera(cameraFov, aspect, 0.1, 2000)
    cam.position.set(...cameraPosition)
    camera.value = cam

    const r = new THREE.WebGLRenderer({ antialias: true })
    r.setSize(w, h)
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.value.appendChild(r.domElement)
    renderer.value = r

    s.add(new THREE.AmbientLight(0xffffff, 0.85))

    const dLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dLight.position.set(5, 12, 8)
    s.add(dLight)

    const bLight = new THREE.DirectionalLight(0xffffff, 0.3)
    bLight.position.set(-5, 5, -8)
    s.add(bLight)

    const ctrl = new OrbitControls(cam, r.domElement)
    ctrl.enableDamping = true
    ctrl.dampingFactor = 0.08
    ctrl.enableZoom = enableZoom
    ctrl.enablePan = false
    ctrl.minPolarAngle = Math.PI / 4
    ctrl.maxPolarAngle = Math.PI / 1.6
    ctrl.autoRotate = autoRotate
    ctrl.autoRotateSpeed = autoRotateSpeed
    orbitControls = ctrl

    updateRenderLoop()
  }

  function renderTick(): void {
    const r = renderer.value
    const s = scene.value
    const cam = camera.value
    if (r === null || s === null || cam === null || orbitControls === null) {
      animationId = 0
      return
    }
    animationId = requestAnimationFrame(renderTick)
    orbitControls.update()
    r.render(s, cam)
  }

  const isSceneActive = (): boolean => {
    const el = container.value
    if (el === null || el.clientWidth === 0 || el.clientHeight === 0) return false
    if (renderer.value === null || camera.value === null || orbitControls === null) return false
    return document.visibilityState === 'visible'
  }

  const startRenderLoop = (): void => {
    if (animationId !== 0) return
    animationId = requestAnimationFrame(renderTick)
  }

  const stopRenderLoop = (): void => {
    if (animationId === 0) return
    cancelAnimationFrame(animationId)
    animationId = 0
  }

  const updateRenderLoop = (): void => {
    if (isSceneActive()) startRenderLoop()
    else stopRenderLoop()
  }

  function onResize(): void {
    updateRenderLoop()
    if (!container.value || !camera.value || !renderer.value) return
    const w = container.value.clientWidth
    const h = container.value.clientHeight
    if (w === 0 || h === 0) return
    camera.value.aspect = w / h
    camera.value.updateProjectionMatrix()
    renderer.value.setSize(w, h)
  }

  function cleanup(): void {
    stopRenderLoop()
    themeObserver?.disconnect()
    themeObserver = null
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', updateRenderLoop)
    resizeObserver?.disconnect()
    resizeObserver = null
    orbitControls?.dispose()
    orbitControls = null
    const r = renderer.value
    if (r) {
      r.forceContextLoss()
      r.dispose()
      r.domElement.remove()
    }
    renderer.value = null
    scene.value = null
    camera.value = null
  }

  onMounted(() => {
    initScene()
    themeObserver = new MutationObserver(() => {
      const s = scene.value
      if (s) applyBackground(s)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', updateRenderLoop)
    if (container.value) {
      resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(container.value)
    }
  })

  onBeforeUnmount(() => {
    cleanup()
  })

  return {
    scene,
    camera,
    renderer,
    getOrbitControls: () => orbitControls,
  }
}
