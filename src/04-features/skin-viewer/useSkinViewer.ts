import { watch, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene, configurePixelTexture, disposeObjectTree } from '@/06-shared'
import { useViewerCamera } from '@/04-features/viewer/useViewerCamera'
import type { ViewerControls } from '@/03-widgets/types'

interface BodyPart {
  w: number
  h: number
  d: number
  pos: [number, number, number]
  faces: Array<[number, number]>
  overlayDelta: [number, number]
  inflate: number
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
      overlayDelta: [32, 0], inflate: 0.5,
    },
    {
      w: 8, h: 12, d: 4, pos: [0, 0, 0],
      faces: [[16, 20], [28, 20], [20, 16], [28, 16], [20, 20], [32, 20]],
      overlayDelta: [0, 16], inflate: 0.25,
    },
    {
      w: armW, h: 12, d: 4, pos: [-armX, 0, 0],
      faces: rightArmFaces,
      overlayDelta: [0, 16], inflate: 0.25,
    },
    {
      w: armW, h: 12, d: 4, pos: [armX, 0, 0],
      faces: leftArmFaces,
      overlayDelta: [16, 0], inflate: 0.25,
    },
    {
      w: 4, h: 12, d: 4, pos: [-2, -12, 0],
      faces: [[8, 20], [0, 20], [4, 16], [8, 16], [4, 20], [12, 20]],
      overlayDelta: [0, 16], inflate: 0.25,
    },
    {
      w: 4, h: 12, d: 4, pos: [2, -12, 0],
      faces: [[24, 52], [16, 52], [20, 48], [24, 48], [20, 52], [28, 52]],
      overlayDelta: [-16, 0], inflate: 0.25,
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

  const addMesh = (
    part: BodyPart,
    mirrorFrom: BodyPart | null,
    uvShift: [number, number],
    inflate: number,
    material: THREE.Material,
  ): void => {
    const geo = new THREE.BoxGeometry(
      part.w + inflate * 2,
      part.h + inflate * 2,
      part.d + inflate * 2,
    )
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
      const source = mirrorFrom ?? part
      const u = source.faces[i][0] + uvShift[0]
      const v = source.faces[i][1] + uvShift[1]
      const [fw, fh] = faceDims[i]

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

    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(...part.pos)
    group.add(mesh)
  }

  const baseMat = new THREE.MeshLambertMaterial({ map: texture })
  const overlayMat = new THREE.MeshLambertMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
  })

  parts.forEach((part, index) => {
    const mirrorFrom = isOldFormat && index === 3
      ? parts[2]
      : isOldFormat && index === 5
        ? parts[4]
        : null
    addMesh(part, mirrorFrom, [0, 0], 0, baseMat)
    if (!isOldFormat || index === 0) {
      addMesh(part, null, part.overlayDelta, part.inflate, overlayMat)
    }
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

  const { applyCamera } = useViewerCamera(
      { camera, getOrbitControls },
      playerGroup,
      controls,
  )

  function fitSkinToView(): void {
    const group = playerGroup.value
    const perspectiveCamera = camera.value
    if (!group || !perspectiveCamera) return

    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = perspectiveCamera.fov * (Math.PI / 180)
    const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.2

    controls.zoomLevel.value = distance
    controls.fitDistance.value = distance
    applyCamera()
  }

  function removeCurrentModel(): void {
    if (!playerGroup.value || !scene.value) return

    scene.value.remove(playerGroup.value)
    disposeObjectTree(playerGroup.value)
    playerGroup.value = null
  }

  function showModel(texture: THREE.Texture): void {
    if (!scene.value) return

    removeCurrentModel()
    const player = buildPlayerModel(texture, slim.value)
    scene.value.add(player)
    playerGroup.value = player
    fitSkinToView()
  }

  function rebuildModel(): void {
    if (!currentTexture) return
    showModel(currentTexture)
  }

  function loadSkin(url: string): void {
    if (!scene.value) return

    const generation = ++loadGeneration

    const loader = new THREE.TextureLoader()
    loader.load(url, (texture) => {
      if (generation !== loadGeneration || !scene.value) return

      configurePixelTexture(texture)
      if (currentTexture) currentTexture.dispose()
      currentTexture = texture

      showModel(texture)
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

  return {}
}
