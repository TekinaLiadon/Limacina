import { ref, watch, onMounted, onBeforeUnmount, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface BodyPart {
  w: number
  h: number
  d: number
  pos: [number, number, number]
  faces: Array<[number, number]>
}

const PARTS: BodyPart[] = [
  {
    w: 8, h: 8, d: 8, pos: [0, 10, 0],
    faces: [[16, 8], [0, 8], [8, 0], [16, 0], [8, 8], [24, 8]],
  },
  {
    w: 8, h: 12, d: 4, pos: [0, 0, 0],
    faces: [[16, 20], [28, 20], [20, 16], [28, 16], [20, 20], [32, 20]],
  },
  {
    w: 4, h: 12, d: 4, pos: [-6, 0, 0],
    faces: [[40, 20], [48, 20], [44, 16], [48, 16], [44, 20], [52, 20]],
  },
  {
    w: 4, h: 12, d: 4, pos: [6, 0, 0],
    faces: [[32, 52], [40, 52], [36, 48], [40, 48], [36, 52], [44, 52]],
  },
  {
    w: 4, h: 12, d: 4, pos: [-2, -12, 0],
    faces: [[8, 20], [0, 20], [4, 16], [8, 16], [4, 20], [12, 20]],
  },
  {
    w: 4, h: 12, d: 4, pos: [2, -12, 0],
    faces: [[24, 52], [16, 52], [20, 48], [24, 48], [20, 52], [28, 52]],
  },
]

function buildPlayerModel(texture: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  const img = texture.image as HTMLImageElement
  const texW = img.width
  const texH = img.height
  const s = texW / 64

  const isOldFormat = texH === 32 * s

  PARTS.forEach((part, index) => {
    const geo = new THREE.BoxGeometry(part.w, part.h, part.d)
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute

    const faceDims: Array<[number, number]> = [
      [part.d, part.h],
      [part.d, part.h],
      [part.w, part.d],
      [part.w, part.d],
      [part.w, part.h],
      [part.w, part.h],
    ]

    for (let i = 0; i < 6; i++) {
      let [u, v] = part.faces[i]
      const [fw, fh] = faceDims[i]

      if (isOldFormat) {
        if (index === 3) {
          [u, v] = PARTS[2].faces[i]
        } else if (index === 5) {
          [u, v] = PARTS[4].faces[i]
        }
      }

      const u0 = (u * s) / texW
      const v0 = 1 - (v * s) / texH
      const u1 = (u * s + fw * s) / texW
      const v1 = 1 - (v * s + fh * s) / texH

      const base = i * 4

      if (i === 2 || i === 3) {
        uvAttr.setXY(base + 0, u0, v1)
        uvAttr.setXY(base + 1, u1, v1)
        uvAttr.setXY(base + 2, u0, v0)
        uvAttr.setXY(base + 3, u1, v0)
      } else {
        uvAttr.setXY(base + 0, u0, v0)
        uvAttr.setXY(base + 1, u1, v0)
        uvAttr.setXY(base + 2, u0, v1)
        uvAttr.setXY(base + 3, u1, v1)
      }
    }
    uvAttr.needsUpdate = true

    const mat = new THREE.MeshLambertMaterial({ map: texture })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(...part.pos)
    group.add(mesh)
  })

  group.scale.set(0.4, 0.4, 0.4)
  group.position.y = 0
  return group
}

export function useSkinViewer(container: Ref<HTMLDivElement | null>, skinUrl: Ref<string>) {
  const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
  const scene = shallowRef<THREE.Scene | null>(null)
  const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
  const playerGroup = shallowRef<THREE.Group | null>(null)
  const animationId = ref<number>(0)
  let loadGeneration = 0
  let orbitControls: OrbitControls | null = null

  function initScene(): void {
    if (!container.value) return

    const w = container.value.clientWidth
    const h = container.value.clientHeight

    const s = new THREE.Scene()
    s.background = new THREE.Color(0x1a1d2e)
    scene.value = s

    const cam = new THREE.PerspectiveCamera(35, w / h, 0.1, 100)
    cam.position.set(0, 5, 22)
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
    ctrl.enableZoom = false
    ctrl.enablePan = false
    ctrl.minPolarAngle = Math.PI / 4
    ctrl.maxPolarAngle = Math.PI / 1.6
    ctrl.autoRotate = true
    ctrl.autoRotateSpeed = 1.5
    orbitControls = ctrl

    r.domElement.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault = () => {}
    }, { capture: true, passive: true })

    const animate = (): void => {
      animationId.value = requestAnimationFrame(animate)
      ctrl.update()
      r.render(s, cam)
    }
    animate()
  }

  function loadSkin(url: string): void {
    if (!scene.value) return

    if (playerGroup.value) {
      scene.value.remove(playerGroup.value)
      playerGroup.value = null
    }

    const generation = ++loadGeneration

    const loader = new THREE.TextureLoader()
    loader.load(url, (texture) => {
      if (generation !== loadGeneration) return

      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.colorSpace = THREE.SRGBColorSpace

      const player = buildPlayerModel(texture)
      scene.value!.add(player)
      playerGroup.value = player
    })
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
    if (skinUrl.value) loadSkin(skinUrl.value)
  })

  watch(skinUrl, (url: string) => {
    if (url) loadSkin(url)
  })

  onBeforeUnmount(() => {
    cleanup()
  })

  return {}
}
