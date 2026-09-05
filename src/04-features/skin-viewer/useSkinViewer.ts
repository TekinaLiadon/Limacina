import { watch, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene } from '@/06-shared'
import type { ViewerControls } from '@/03-widgets/types'

interface BodyPart {
  w: number
  h: number
  d: number
  pos: [number, number, number]
  faces: Array<[number, number]>
}

function createParts(slim: boolean): BodyPart[] {
  const armW = slim ? 3 : 4
  const armX = slim ? 5.5 : 6
  const rightArmFaces: Array<[number, number]> = slim
    ? [[40, 20], [46, 20], [44, 16], [47, 16], [43, 20], [49, 20]]
    : [[40, 20], [48, 20], [44, 16], [48, 16], [44, 20], [52, 20]]
  const leftArmFaces: Array<[number, number]> = slim
    ? [[32, 52], [38, 52], [36, 48], [39, 48], [35, 52], [41, 52]]
    : [[32, 52], [40, 52], [36, 48], [40, 48], [36, 52], [44, 52]]

  return [
    {
      w: 8, h: 8, d: 8, pos: [0, 10, 0],
      faces: [[16, 8], [0, 8], [8, 0], [16, 0], [8, 8], [24, 8]],
    },
    {
      w: 8, h: 12, d: 4, pos: [0, 0, 0],
      faces: [[16, 20], [28, 20], [20, 16], [28, 16], [20, 20], [32, 20]],
    },
    {
      w: armW, h: 12, d: 4, pos: [-armX, 0, 0],
      faces: rightArmFaces,
    },
    {
      w: armW, h: 12, d: 4, pos: [armX, 0, 0],
      faces: leftArmFaces,
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
}

function buildPlayerModel(texture: THREE.Texture, slim: boolean): THREE.Group {
  const group = new THREE.Group()
  const img = texture.image as HTMLImageElement
  const texW = img.width
  const texH = img.height
  const s = texW / 64
  const isOldFormat = texH === 32 * s
  const parts = createParts(slim)

  parts.forEach((part, index) => {
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
          [u, v] = parts[2].faces[i]
        } else if (index === 5) {
          [u, v] = parts[4].faces[i]
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
    controls: ViewerControls,
    slim: Ref<boolean>,
) {
  const { scene, camera, getOrbitControls } = useThreeScene(container, { autoRotate: false })
  const playerGroup = shallowRef<THREE.Group | null>(null)
  let loadGeneration = 0
  let currentTexture: THREE.Texture | null = null

  function applyCamera(): void {
    if (!camera.value) return

    const dist = controls.zoomLevel.value
    const elevation = THREE.MathUtils.degToRad(controls.rotationX.value)
    camera.value.position.set(0, dist * Math.sin(elevation), dist * Math.cos(elevation))
    camera.value.lookAt(0, 0, 0)
  }

  function fitModelToView(): void {
    if (!playerGroup.value || !camera.value) return

    const box = new THREE.Box3().setFromObject(playerGroup.value)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.value.fov * (Math.PI / 180)
    const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.2

    controls.zoomLevel.value = distance
    controls.fitDistance.value = distance
    applyCamera()
  }

  function disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
    })
  }

  function removeCurrentModel(): void {
    if (!playerGroup.value || !scene.value) return

    scene.value.remove(playerGroup.value)
    disposeGroup(playerGroup.value)
    playerGroup.value = null
  }

  function rebuildModel(): void {
    if (!scene.value || !currentTexture) return

    removeCurrentModel()
    const player = buildPlayerModel(currentTexture, slim.value)
    scene.value.add(player)
    playerGroup.value = player
    fitModelToView()
  }

  function loadSkin(url: string): void {
    if (!scene.value) return

    const generation = ++loadGeneration

    const loader = new THREE.TextureLoader()
    loader.load(url, (texture) => {
      if (generation !== loadGeneration || !scene.value) return

      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.colorSpace = THREE.SRGBColorSpace

      removeCurrentModel()
      if (currentTexture) currentTexture.dispose()
      currentTexture = texture

      const player = buildPlayerModel(texture, slim.value)
      scene.value.add(player)
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

  watch(slim, () => {
    rebuildModel()
  })

  watch(controls.autoRotate, (enabled: boolean) => {
    const orbit = getOrbitControls()
    if (orbit) orbit.autoRotate = enabled
  })

  watch(controls.zoomLevel, () => {
    applyCamera()
  })

  watch(controls.rotationX, () => {
    applyCamera()
  })

  watch(controls.rotationY, (angle: number) => {
    if (playerGroup.value) {
      playerGroup.value.rotation.y = THREE.MathUtils.degToRad(angle)
    }
  })

  return {}
}
