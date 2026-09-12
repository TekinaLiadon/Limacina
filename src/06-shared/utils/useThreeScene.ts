import { ref, onMounted, onBeforeUnmount, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface ThreeSceneOptions {
  background?: number
  cameraPosition?: [number, number, number]
  cameraFov?: number
  enableZoom?: boolean
  autoRotate?: boolean
  autoRotateSpeed?: number
}

export function useThreeScene(
  container: Ref<HTMLDivElement | null>,
  options: ThreeSceneOptions = {}
) {
  const {
    background = 0x1a1d2e,
    cameraPosition = [0, 5, 22],
    cameraFov = 35,
    enableZoom = false,
    autoRotate = false,
    autoRotateSpeed = 1.5,
  } = options

  const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
  const scene = shallowRef<THREE.Scene | null>(null)
  const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
  const animationId = ref<number>(0)
  let orbitControls: OrbitControls | null = null

  function initScene(): void {
    if (!container.value) return

    const w = container.value.clientWidth
    const h = container.value.clientHeight
    const s = new THREE.Scene()
    s.background = new THREE.Color(background)
    scene.value = s

    const cam = new THREE.PerspectiveCamera(cameraFov, w / h, 0.1, 2000)
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

    const animate = (): void => {
      animationId.value = requestAnimationFrame(animate)
      ctrl.update()
      r.render(s, cam)
    }
    animate()
  }

  function onResize(): void {
    if (!container.value || !camera.value || !renderer.value) return
    const w = container.value.clientWidth
    const h = container.value.clientHeight
    camera.value.aspect = w / h
    camera.value.updateProjectionMatrix()
    renderer.value.setSize(w, h)
  }

  function cleanup(): void {
    cancelAnimationFrame(animationId.value)
    window.removeEventListener('resize', onResize)
    orbitControls?.dispose()
    renderer.value?.dispose()
  }

  onMounted(() => {
    initScene()
    window.addEventListener('resize', onResize)
  })

  onBeforeUnmount(() => {
    cleanup()
  })

  return {
    scene,
    camera,
    renderer,
    controls: orbitControls,
    getOrbitControls: () => orbitControls,
  }
}
