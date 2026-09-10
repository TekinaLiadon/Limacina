import { watch, shallowRef, onBeforeUnmount, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene } from '@/06-shared'
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

const VANILLA_PIVOTS: Record<string, CPMVec3> = {
  head:      { x: 0,  y: 24, z: 0 },
  body:      { x: 0,  y: 24, z: 0 },
  left_arm:  { x: 5,  y: 22, z: 0 },
  right_arm: { x: -5, y: 22, z: 0 },
  left_leg:  { x: 2,  y: 12, z: 0 },
  right_leg: { x: -2, y: 12, z: 0 },
}

const ROOT_PIVOTS: Record<string, CPMVec3> = {
  cape:            { x: 0,   y: 24, z: 0 },
  elytra_left:     { x: 0,   y: 24, z: 0 },
  elytra_right:    { x: 0,   y: 24, z: 0 },
  armor_helmet:    { x: 0,   y: 24, z: 0 },
  armor_body:      { x: 0,   y: 24, z: 0 },
  armor_left_arm:  { x: 5,   y: 22, z: 0 },
  armor_right_arm: { x: -5,  y: 22, z: 0 },
  armor_leggings_body: { x: 0,   y: 24, z: 0 },
  armor_left_leg:  { x: 2,   y: 12, z: 0 },
  armor_right_leg: { x: -2,  y: 12, z: 0 },
  armor_left_foot: { x: 2,   y: 12, z: 0 },
  armor_right_foot: { x: -2, y: 12, z: 0 },
}

const PLAYER_PART_INDEX: Record<string, number> = PLAYER_PART_IDS

function parseColor(color: string | undefined): number | null {
  if (!color) return null
  const value = parseInt(color, 16)
  if (Number.isNaN(value)) return null
  return value
}

function applyFaceUVs(geo: THREE.BoxGeometry, faceUV: Record<string, CPMFaceUV>, skinW: number, skinH: number) {
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  Object.entries(faceUV).forEach(([face, uv]) => {
    const faceIndex = FACE_MAP[face]
    if (faceIndex === undefined) return

    const base = faceIndex * 4
    const u0 = uv.sx / skinW
    const v0 = uv.sy / skinH
    const u1 = uv.ex / skinW
    const v1 = uv.ey / skinH

    const rot = uv.rot || '0'
    let tl = { u: u0, v: 1 - v0 }
    let tr = { u: u1, v: 1 - v0 }
    let bl = { u: u0, v: 1 - v1 }
    let br = { u: u1, v: 1 - v1 }

    if (rot === '180') {
      tl = { u: u1, v: 1 - v1 }
      tr = { u: u0, v: 1 - v1 }
      bl = { u: u1, v: 1 - v0 }
      br = { u: u0, v: 1 - v0 }
    } else if (rot === '90') {
      tl = { u: u0, v: 1 - v1 }
      tr = { u: u0, v: 1 - v0 }
      bl = { u: u1, v: 1 - v1 }
      br = { u: u1, v: 1 - v0 }
    } else if (rot === '270') {
      tl = { u: u1, v: 1 - v0 }
      tr = { u: u1, v: 1 - v1 }
      bl = { u: u0, v: 1 - v0 }
      br = { u: u0, v: 1 - v1 }
    }

    uvAttr.setXY(base, tl.u, tl.v)
    uvAttr.setXY(base + 1, tr.u, tr.v)
    uvAttr.setXY(base + 2, bl.u, bl.v)
    uvAttr.setXY(base + 3, br.u, br.v)
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
) {
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  const ts = Math.abs(texSize)
  const dx = Math.ceil(w * ts)
  const dy = Math.ceil(h * ts)
  const dz = Math.ceil(d * ts)
  const tu = u * ts
  const tv = v * ts

  const s = (px: number, py: number): [number, number] => [px / skinW, 1 - py / skinH]

  let faces: [number, number, number, number][]
  if (singleTex) {
    const txS = Math.max(dx, dy, dz)
    faces = [
      [tu, tv, tu + txS, tv + txS],
      [tu, tv, tu + txS, tv + txS],
      [tu, tv, tu + txS, tv + txS],
      [tu, tv, tu + txS, tv + txS],
      [tu, tv, tu + txS, tv + txS],
      [tu, tv, tu + txS, tv + txS],
    ]
    if (mirror) {
      const east = faces[0]
      faces[0] = faces[1]
      faces[1] = east
      faces = faces.map(([a, b, c, r]) => [c, b, a, r])
    }
  } else {
    const f4 = tu
    const f5 = tu + dz
    const f6 = tu + dz + dx
    const f7 = tu + dz + dx + dx
    const f8 = tu + dz + dx + dz
    const f9 = tu + dz + dx + dz + dx
    const f10 = tv
    const f11 = tv + dz
    const f12 = tv + dz + dy
    faces = [
      [f6, f11, f8, f12],
      [f4, f11, f5, f12],
      [f5, f10, f6, f11],
      [f6, f11, f7, f10],
      [f5, f11, f6, f12],
      [f8, f11, f9, f12],
    ]
    if (mirror) {
      const east = faces[0]
      faces[0] = faces[1]
      faces[1] = east
      faces = faces.map(([a, b, c, r]) => [c, b, a, r])
    }
  }

  faces.forEach((rect, threeFace) => {
    const [u1, v1, u2, v2] = rect
    const base = threeFace * 4
    uvAttr.setXY(base, ...s(u1, v1))
    uvAttr.setXY(base + 1, ...s(u2, v1))
    uvAttr.setXY(base + 2, ...s(u1, v2))
    uvAttr.setXY(base + 3, ...s(u2, v2))
  })
  uvAttr.needsUpdate = true
}

function buildCpmModel(config: CPMConfig, texture: THREE.Texture): THREE.Group {
  const rootGroup = new THREE.Group()
  const skinW = config.skinSize.x
  const skinH = config.skinSize.y

  function buildNode(node: CPMElement | CPMChild, isRoot: boolean, rootId?: string): THREE.Group {
    const group = new THREE.Group()

    if (isRoot) {
      const id = rootId as string
      const pivot = VANILLA_PIVOTS[id] || ROOT_PIVOTS[id] || { x: 0, y: 0, z: 0 }
      const px = pivot.x + (node.pos?.x || 0)
      const py = pivot.y - (node.pos?.y || 0)
      const pz = -(pivot.z + (node.pos?.z || 0))
      group.position.set(px, py, pz)
    } else {
      const px = node.pos?.x || 0
      const py = -(node.pos?.y || 0)
      const pz = -(node.pos?.z || 0)
      group.position.set(px, py, pz)
    }

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
        ? PLAYER_PART_INDEX[element.id]
        : element.storeID
      group.userData.isRoot = true
    } else {
      group.userData.storeID = (node as CPMChild).storeID
      const defaultVisible = (node as CPMChild).hidden !== true
      group.visible = defaultVisible
      group.userData.defaultVisible = defaultVisible
    }

    if (!isRoot) {
      const child = node as CPMChild
      const size = child.size
      const hasSize = size && (size.x > 0 || size.y > 0 || size.z > 0)

      if (hasSize) {
        const mcScale = child.mcScale || 0
        const meshScale = child.scale || { x: 1, y: 1, z: 1 }
        const w = size.x * meshScale.x + mcScale * 2
        const h = size.y * meshScale.y + mcScale * 2
        const d = size.z * meshScale.z + mcScale * 2

        const geo = new THREE.BoxGeometry(w, h, d)
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
        const childGroup = buildNode(childNode, false)
        group.add(childGroup)
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
      const elementGroup = buildNode(element, true, element.id)
      rootGroup.add(elementGroup)
      return
    }
    if (element.dup) {
      dupIndex[element.id] = (dupIndex[element.id] || 0) + 1
      if (seenVanilla.has(element.id) || dupIndex[element.id] > 1) return
    }
    const elementGroup = buildNode(element, true, element.id)
    rootGroup.add(elementGroup)
  })

  const scale = config.scaling || 1
  rootGroup.scale.set(scale, scale, scale)

  const box = new THREE.Box3().setFromObject(rootGroup)
  const center = box.getCenter(new THREE.Vector3())
  rootGroup.position.set(-center.x, -center.y, -center.z)

  return rootGroup
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
) {
  const { scene, camera, getOrbitControls } = useThreeScene(container, { enableZoom: false, autoRotate: false })
  const modelGroup = shallowRef<THREE.Group | null>(null)
  const isAnimating = shallowRef<boolean>(false)
  let loadGeneration = 0
  let player: CpmAnimationPlayer | null = null
  let tickId = 0

  function applyCamera(): void {
    if (!camera.value) return

    const dist = controls.zoomLevel.value
    const elevation = THREE.MathUtils.degToRad(controls.rotationX.value)
    camera.value.position.set(0, dist * Math.sin(elevation), dist * Math.cos(elevation))
    camera.value.lookAt(0, 0, 0)
  }

  function fitModelToView(): void {
    if (!modelGroup.value || !camera.value) return

    const box = new THREE.Box3().setFromObject(modelGroup.value)
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.sqrt(
        (size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2
    )
    const fovV = camera.value.fov * (Math.PI / 180)
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.value.aspect)
    const fov = Math.min(fovV, fovH)
    const distance = (radius / Math.sin(fov / 2)) * 1.08

    controls.zoomLevel.value = distance
    controls.fitDistance.value = distance
    applyCamera()
  }

  function stopAnimation(): void {
    isAnimationPlaying.value = false
    isAnimating.value = false
  }

  function loadModel(data: CPMData): void {
    if (!scene.value) return

    if (modelGroup.value) {
      scene.value.remove(modelGroup.value)
      modelGroup.value = null
    }

    const generation = ++loadGeneration

    const loader = new THREE.TextureLoader()
    loader.load(data.textureUrl, (texture) => {
      if (generation !== loadGeneration) return

      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.colorSpace = THREE.SRGBColorSpace

      const model = buildCpmModel(data.config, texture)
      scene.value!.add(model)
      modelGroup.value = model

      player = new CpmAnimationPlayer(indexModelNodes(model), {
        activeLayerIds,
        onFinished: () => {
          stopAnimation()
        },
      })

      player.setSpeed(animationSpeed.value)
      player.setForceLoop(isAnimationLooped.value)
      player.setAnimations(activeAnimations.value)
      player.setPlaying(isAnimationPlaying.value)

      updateVisibility()
      fitModelToView()
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
    isAnimationPlaying.value = animations.length > 0
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
    if (modelGroup.value) {
      modelGroup.value.rotation.y = THREE.MathUtils.degToRad(angle)
    }
  })

  tickId = requestAnimationFrame(tickAnimation)

  onBeforeUnmount(() => {
    cancelAnimationFrame(tickId)
  })

  return {
    isAnimating,
  }
}
