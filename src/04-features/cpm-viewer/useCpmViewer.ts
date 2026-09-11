import { watch, shallowRef, onBeforeUnmount, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene, configurePixelTexture, disposeObjectTree } from '@/06-shared'
import { useViewerCamera } from '@/04-features/viewer/useViewerCamera'
import type { CPMConfig, CPMData, CPMVec3, CPMFaceUV, CPMChild, CPMElement } from '@/05-entities/core/types'
import type { ViewerControls } from '@/03-widgets/types'
import { CpmAnimationPlayer, indexModelNodes, PLAYER_PART_IDS } from './cpmAnimationPlayer'
import type { CPMAnimation } from '@/05-entities/core/types'

const FACE_MAP: Record<string, number> = {
  east: 0,
  west: 1,
  up: 2,
  down: 3,
  north: 4,
  south: 5,
}

const ROOT_PIVOTS: Record<string, CPMVec3> = {
  head:             { x: 0,  y: 24, z: 0 },
  body:             { x: 0,  y: 24, z: 0 },
  left_arm:         { x: 5,  y: 22, z: 0 },
  right_arm:        { x: -5, y: 22, z: 0 },
  left_leg:         { x: 2,  y: 12, z: 0 },
  right_leg:        { x: -2, y: 12, z: 0 },
  cape:             { x: 0,  y: 24, z: 0 },
  elytra_left:      { x: 0,  y: 24, z: 0 },
  elytra_right:     { x: 0,  y: 24, z: 0 },
  armor_helmet:     { x: 0,  y: 24, z: 0 },
  armor_body:       { x: 0,  y: 24, z: 0 },
  armor_left_arm:   { x: 5,  y: 22, z: 0 },
  armor_right_arm:  { x: -5, y: 22, z: 0 },
  armor_leggings_body: { x: 0,  y: 24, z: 0 },
  armor_left_leg:   { x: 2,  y: 12, z: 0 },
  armor_right_leg:  { x: -2, y: 12, z: 0 },
  armor_left_foot:  { x: 2,  y: 12, z: 0 },
  armor_right_foot: { x: -2, y: 12, z: 0 },
}

function parseColor(color: string | undefined): number | null {
  if (!color) return null
  const value = parseInt(color, 16)
  return Number.isNaN(value) ? null : value
}

function setFaceQuad(uvAttr: THREE.BufferAttribute, base: number, quad: Array<[number, number]>): void {
  quad.forEach(([u, v], i) => {
    uvAttr.setXY(base + i, u, v)
  })
}

function applyFaceUVs(geo: THREE.BoxGeometry, faceUV: Record<string, CPMFaceUV>, skinW: number, skinH: number): void {
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute

  Object.entries(faceUV).forEach(([face, uv]) => {
    const faceIndex = FACE_MAP[face]
    if (faceIndex === undefined) return

    const base = faceIndex * 4
    const u0 = uv.sx / skinW
    const v0 = 1 - uv.sy / skinH
    const u1 = uv.ex / skinW
    const v1 = 1 - uv.ey / skinH

    let quad: Array<[number, number]>
    switch (uv.rot || '0') {
      case '90':
        quad = [[u0, v1], [u0, v0], [u1, v1], [u1, v0]]
        break
      case '180':
        quad = [[u1, v1], [u0, v1], [u1, v0], [u0, v0]]
        break
      case '270':
        quad = [[u1, v0], [u1, v1], [u0, v0], [u0, v1]]
        break
      default:
        quad = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]
    }

    setFaceQuad(uvAttr, base, quad)
  })

  uvAttr.needsUpdate = true
}

function applyBoxUVs(
    geo: THREE.BoxGeometry,
    u: number, v: number,
    w: number, h: number, d: number,
    texSize: number,
    skinW: number, skinH: number,
    singleTex: boolean,
    mirror: boolean,
): void {
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  const ts = Math.abs(texSize)
  const dx = Math.ceil(w * ts)
  const dy = Math.ceil(h * ts)
  const dz = Math.ceil(d * ts)
  const tu = u * ts
  const tv = v * ts

  const s = (px: number, py: number): [number, number] => [px / skinW, 1 - py / skinH]

  let faces: Array<[number, number, number, number]>
  if (singleTex) {
    const side = Math.max(dx, dy, dz)
    faces = Array.from({ length: 6 }, () => [tu, tv, tu + side, tv + side])
  } else {
    const x1 = tu + dz
    const x2 = tu + dz + dx
    const x3 = tu + dz + dx + dx
    const x4 = tu + dz + dx + dz
    const x5 = tu + dz + dx + dz + dx
    const y1 = tv + dz
    const y2 = tv + dz + dy
    faces = [
      [x2, y1, x4, y2],
      [tu, y1, x1, y2],
      [x1, tv, x2, y1],
      [x2, y1, x3, tv],
      [x1, y1, x2, y2],
      [x4, y1, x5, y2],
    ]
  }

  if (mirror) {
    const east = faces[0]
    faces = [faces[1], east, ...faces.slice(2)]
  }

  faces.forEach((rect, threeFace) => {
    const [u1, v1, u2, v2] = rect
    const base = threeFace * 4
    setFaceQuad(uvAttr, base, [s(u1, v1), s(u2, v1), s(u1, v2), s(u2, v2)])
  })
  uvAttr.needsUpdate = true
}

function buildCpmModel(config: CPMConfig, texture: THREE.Texture): THREE.Group {
  const rootGroup = new THREE.Group()
  const skinW = config.skinSize.x
  const skinH = config.skinSize.y

  function buildNode(node: CPMElement | CPMChild, isRoot: boolean, rootId?: string): THREE.Group {
    const group = new THREE.Group()

    const pivot = isRoot ? (ROOT_PIVOTS[rootId as string] ?? { x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 }
    group.position.set(
        pivot.x + (node.pos?.x || 0),
        pivot.y - (node.pos?.y || 0),
        -(pivot.z + (node.pos?.z || 0)),
    )

    if (node.rotation) {
      group.rotation.set(
          THREE.MathUtils.degToRad(node.rotation.x),
          THREE.MathUtils.degToRad(-node.rotation.y),
          THREE.MathUtils.degToRad(-node.rotation.z),
          'ZYX'
      )
    }

    if (node.scale) group.scale.set(node.scale.x, node.scale.y, node.scale.z)
    group.name = 'id' in node ? node.id : node.name

    if (isRoot) {
      const element = node as CPMElement
      const isVanillaRoot = element.customPart !== true && element.dup !== true
      group.userData.storeID = isVanillaRoot
        ? PLAYER_PART_IDS[element.id]
        : element.storeID
      group.userData.isRoot = true
    } else {
      const child = node as CPMChild
      group.userData.storeID = child.storeID
      const defaultVisible = child.hidden !== true
      group.visible = defaultVisible
      group.userData.defaultVisible = defaultVisible

      const size = child.size
      const hasSize = size && (size.x > 0 || size.y > 0 || size.z > 0)

      if (hasSize) {
        const mcScale = child.mcScale || 0
        const meshScale = child.scale || { x: 1, y: 1, z: 1 }
        const geo = new THREE.BoxGeometry(
            size.x * meshScale.x + mcScale * 2,
            size.y * meshScale.y + mcScale * 2,
            size.z * meshScale.z + mcScale * 2,
        )
        const position = new THREE.Vector3(
            child.offset.x + size.x * meshScale.x / 2,
            -child.offset.y - size.y * meshScale.y / 2,
            -child.offset.z - size.z * meshScale.z / 2
        )

        let mat: THREE.MeshLambertMaterial
        if (child.texture === false) {
          const rgb = parseColor(child.color)
          mat = new THREE.MeshLambertMaterial({
            color: rgb === null ? 0xffffff : rgb,
            side: THREE.DoubleSide,
          })
        } else {
          const texSize = child.textureSize ?? 1
          const effTexSize = child.mirror ? -Math.abs(texSize) : texSize
          if (child.faceUV && Object.keys(child.faceUV).length > 0) {
            applyFaceUVs(geo, child.faceUV, skinW, skinH)
          } else {
            applyBoxUVs(
                geo,
                child.u || 0, child.v || 0,
                size.x, size.y, size.z,
                effTexSize,
                skinW, skinH,
                !!child.singleTex,
                !!child.mirror,
            )
          }

          mat = new THREE.MeshLambertMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.3,
            side: THREE.DoubleSide,
          })
        }

        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.copy(position)
        mesh.userData.layerId = child.storeID
        mesh.userData.defaultVisible = child.hidden !== true

        group.add(mesh)
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((childNode) => {
        group.add(buildNode(childNode, false))
      })
    }

    return group
  }

  const seenVanilla = new Set<string>()
  config.elements.forEach((element) => {
    if (!element.customPart && !element.dup) {
      seenVanilla.add(element.id)
    }
  })

  const dupIndex: Record<string, number> = {}
  config.elements.forEach((element) => {
    if (element.customPart) {
      rootGroup.add(buildNode(element, true, element.id))
      return
    }
    if (element.dup) {
      dupIndex[element.id] = (dupIndex[element.id] || 0) + 1
      if (seenVanilla.has(element.id) || dupIndex[element.id] > 1) return
    }
    rootGroup.add(buildNode(element, true, element.id))
  })

  const scale = config.scaling || 1
  rootGroup.scale.set(scale, scale, scale)

  const box = new THREE.Box3().setFromObject(rootGroup)
  const center = box.getCenter(new THREE.Vector3())
  rootGroup.position.set(-center.x, -center.y, -center.z)

  return rootGroup
}

export interface CpmViewerOptions {
  onAnimationsChanged?: (playing: boolean) => void
  onAnimationFinished?: () => void
}

export function useCpmViewer(
    container: Ref<HTMLDivElement | null>,
    cpmData: Ref<CPMData | null>,
    activeLayerIds: Ref<number[]>,
    controls: ViewerControls,
    activeAnimations: Ref<CPMAnimation[]>,
    isAnimationPlaying: Ref<boolean>,
    animationSpeed: Ref<number>,
    isAnimationLooped: Ref<boolean>,
    options: CpmViewerOptions = {},
) {
  const { scene, camera, getOrbitControls } = useThreeScene(container, { enableZoom: false, autoRotate: false })
  const modelGroup = shallowRef<THREE.Group | null>(null)
  let loadGeneration = 0
  let player: CpmAnimationPlayer | null = null
  let currentTexture: THREE.Texture | null = null
  let tickId = 0

  const { setFitDistance, modelBoundingSphereRadius } = useViewerCamera(
      { camera, getOrbitControls },
      modelGroup,
      controls,
  )

  function removeCurrentModel(): void {
    if (!modelGroup.value || !scene.value) return

    scene.value.remove(modelGroup.value)
    disposeObjectTree(modelGroup.value)
    modelGroup.value = null
  }

  function loadModel(data: CPMData): void {
    if (!scene.value) return

    removeCurrentModel()

    const generation = ++loadGeneration

    const loader = new THREE.TextureLoader()
    loader.load(data.textureUrl, (texture) => {
      if (generation !== loadGeneration || !scene.value) return

      configurePixelTexture(texture)
      if (currentTexture) currentTexture.dispose()
      currentTexture = texture

      const model = buildCpmModel(data.config, texture)
      scene.value.add(model)
      modelGroup.value = model

      player = new CpmAnimationPlayer(indexModelNodes(model), {
        activeLayerIds,
        onFinished: () => {
          options.onAnimationFinished?.()
        },
      })

      player.setSpeed(animationSpeed.value)
      player.setForceLoop(isAnimationLooped.value)
      player.setAnimations(activeAnimations.value)
      player.setPlaying(isAnimationPlaying.value)

      updateVisibility()

      const radius = modelBoundingSphereRadius()
      const perspectiveCamera = camera.value
      if (radius !== null && perspectiveCamera) {
        const fovV = perspectiveCamera.fov * (Math.PI / 180)
        const fovH = 2 * Math.atan(Math.tan(fovV / 2) * perspectiveCamera.aspect)
        setFitDistance((radius / Math.sin(Math.min(fovV, fovH) / 2)) * 1.08)
      }
    })
  }

  function updateVisibility(): void {
    if (!modelGroup.value) return

    modelGroup.value.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const layerId = object.userData.layerId as number | undefined
        const animVisible = object.userData.animVisible !== false
        if (layerId !== undefined) {
          object.visible = activeLayerIds.value.includes(layerId) && animVisible
        } else {
          object.visible = animVisible && object.userData.defaultVisible !== false
        }
      }
    })

    if (player && activeAnimations.value.length > 0) {
      player.applyCurrentFrame()
    }
  }

  function tickAnimation(): void {
    if (player && isAnimationPlaying.value) player.update()
    tickId = requestAnimationFrame(tickAnimation)
  }

  watch(cpmData, (data) => {
    if (data) loadModel(data)
  }, { immediate: true })

  watch(activeAnimations, (animations) => {
    if (!player) return
    player.setAnimations(animations)
    options.onAnimationsChanged?.(animations.length > 0)
  }, { deep: true })

  watch(isAnimationPlaying, (playing: boolean) => {
    player?.setPlaying(playing)
  })

  watch(animationSpeed, (speed: number) => {
    player?.setSpeed(speed)
  })

  watch(isAnimationLooped, (looped: boolean) => {
    player?.setForceLoop(looped)
  })

  watch(scene, (s) => {
    if (s && cpmData.value) loadModel(cpmData.value)
  })

  watch(activeLayerIds, () => {
    updateVisibility()
  })

  tickId = requestAnimationFrame(tickAnimation)

  onBeforeUnmount(() => {
    cancelAnimationFrame(tickId)
    removeCurrentModel()
    if (currentTexture) {
      currentTexture.dispose()
      currentTexture = null
    }
  })

  return {}
}
