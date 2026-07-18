import { watch, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene } from '@/06-shared'

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

export function useSkinViewer(
    container: Ref<HTMLDivElement | null>,
    skinUrl: Ref<string>,
    zoomLevel: Ref<number>,
    rotationY: Ref<number>,
) {
  const { scene, camera } = useThreeScene(container, { autoRotate: false })
  const playerGroup = shallowRef<THREE.Group | null>(null)
  let loadGeneration = 0

  function fitModelToView(): void {
    if (!playerGroup.value || !camera.value) return

    const box = new THREE.Box3().setFromObject(playerGroup.value)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.value.fov * (Math.PI / 180)
    const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.2

    camera.value.position.set(0, 5, distance)
    camera.value.lookAt(0, 5, 0)
    zoomLevel.value = distance
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
      fitModelToView()
    })
  }

  watch(skinUrl, (url: string) => {
    if (url) loadSkin(url)
  })

  watch(scene, (s) => {
    if (s && skinUrl.value) loadSkin(skinUrl.value)
  })

  watch(zoomLevel, (dist) => {
    if (camera.value) {
      camera.value.position.set(0, 5, dist)
      camera.value.lookAt(0, 5, 0)
    }
  })

  watch(rotationY, (angle) => {
    if (playerGroup.value) {
      playerGroup.value.rotation.y = THREE.MathUtils.degToRad(angle)
    }
  })

  return {}
}
