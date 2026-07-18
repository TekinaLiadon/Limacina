import { watch, shallowRef, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeScene } from '@/06-shared'
import type { CPMConfig, CPMData, CPMVec3, CPMFaceUV, CPMChild, CPMElement } from '@/05-entities/core/types'

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

function applyUVs(geo: THREE.BoxGeometry, faceUV: Record<string, CPMFaceUV> | undefined, skinW: number, skinH: number, mirror: boolean) {
  if (!faceUV || Object.keys(faceUV).length === 0) return

  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  Object.entries(faceUV).forEach(([face, uv]) => {
    const faceIndex = FACE_MAP[face]
    if (faceIndex === undefined) return

    const base = faceIndex * 4
    let u0 = uv.sx / skinW
    let v0 = uv.sy / skinH
    let u1 = uv.ex / skinW
    let v1 = uv.ey / skinH

    if (mirror) {
      const uMirror = u0
      u0 = u1
      u1 = uMirror
    }

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

function buildCpmModel(config: CPMConfig, texture: THREE.Texture): THREE.Group {
  const rootGroup = new THREE.Group()
  const skinW = config.skinSize.x
  const skinH = config.skinSize.y

  function buildNode(node: CPMElement | CPMChild, isRoot: boolean): THREE.Group {
    const group = new THREE.Group()

    if (isRoot) {
      const id = (node as CPMElement).id
      const vanilla = VANILLA_PIVOTS[id] || { x: 0, y: 0, z: 0 }
      const px = vanilla.x + (node.pos?.x || 0)
      const py = vanilla.y - (node.pos?.y || 0)
      const pz = -(vanilla.z + (node.pos?.z || 0))
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

    if (!isRoot) {
      const child = node as CPMChild
      const hasSize = child.size && (child.size.x > 0 || child.size.y > 0 || child.size.z > 0)

      if (hasSize && child.texture) {
        const mcScale = child.mcScale || 0
        const w = child.size.x + mcScale * 2
        const h = child.size.y + mcScale * 2
        const d = child.size.z + mcScale * 2

        const geo = new THREE.BoxGeometry(w, h, d)
        applyUVs(geo, child.faceUV, skinW, skinH, !!child.mirror)

        const mat = new THREE.MeshLambertMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.3,
          side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(
            child.offset.x + child.size.x / 2,
            -child.offset.y - child.size.y / 2,
            -child.offset.z - child.size.z / 2
        )
        mesh.userData.layerName = child.name || group.name
        mesh.userData.isCustom = true
        mesh.userData.defaultVisible = (child.show !== false) && (child.hidden !== true)

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

  config.elements.forEach((element) => {
    const elementGroup = buildNode(element, true)
    rootGroup.add(elementGroup)
  })

  const scale = config.scaling || 1
  rootGroup.scale.set(scale, scale, scale)

  const box = new THREE.Box3().setFromObject(rootGroup)
  const center = box.getCenter(new THREE.Vector3())
  rootGroup.position.y = -center.y + 10

  return rootGroup
}

export function useCpmViewer(
    container: Ref<HTMLDivElement | null>,
    cpmData: Ref<CPMData | null>,
    activeLayers: Ref<string[]>,
    zoomLevel: Ref<number>,
    rotationY: Ref<number>,
) {
  const { scene, camera } = useThreeScene(container, { enableZoom: false, autoRotate: false })
  const modelGroup = shallowRef<THREE.Group | null>(null)
  let loadGeneration = 0

  function fitModelToView(): void {
    if (!modelGroup.value || !camera.value) return

    const box = new THREE.Box3().setFromObject(modelGroup.value)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.value.fov * (Math.PI / 180)
    const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.2

    camera.value.position.set(0, 5, distance)
    camera.value.lookAt(0, 5, 0)
    zoomLevel.value = distance
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

      updateVisibility()
      fitModelToView()
    })
  }

  function updateVisibility(): void {
    if (!modelGroup.value) return

    const VANILLA_LAYERS = ['hat', 'jacket', 'left_sleeve', 'right_sleeve', 'left_pants_leg', 'right_pants_leg', 'cape']

    modelGroup.value.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const layerName = object.userData.layerName as string
        const isCustom = object.userData.isCustom as boolean

        if (layerName && VANILLA_LAYERS.includes(layerName.toLowerCase())) {
          object.visible = activeLayers.value.includes(layerName)
        } else if (isCustom && layerName) {
          object.visible = activeLayers.value.includes(layerName)
        }
      }
    })
  }

  watch(cpmData, (data) => {
    if (data) loadModel(data)
  }, { immediate: true })

  watch(scene, (s) => {
    if (s && cpmData.value) loadModel(cpmData.value)
  })

  watch(activeLayers, () => {
    updateVisibility()
  }, { deep: true })

  watch(zoomLevel, (dist) => {
    if (camera.value) {
      camera.value.position.set(0, 5, dist)
      camera.value.lookAt(0, 5, 0)
    }
  })

  watch(rotationY, (angle) => {
    if (modelGroup.value) {
      modelGroup.value.rotation.y = THREE.MathUtils.degToRad(angle)
    }
  })

  return {}
}
