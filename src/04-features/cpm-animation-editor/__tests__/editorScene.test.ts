import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, shallowRef, type Ref } from 'vue'
import type { CPMAnimation, CPMConfig, CPMData } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'
import { CpmAnimationPlayer, indexModelNodes } from '../../cpm-viewer/cpmAnimationPlayer'
import { createCpmEditorBridge, type CpmEditorBridge } from '../../cpm-viewer/cpmEditorBridge'
import { useCpmAnimationEditor, type CpmAnimationEditorApi } from '../useCpmAnimationEditor'
import { useCpmEditorScene } from '../editorScene'

const vec = (x = 0, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z })

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'custom',
      name: 'Кость',
      pos: vec(),
      rotation: vec(),
      customPart: true,
      storeID: 50,
      children: [
        {
          name: 'Куб',
          size: vec(2, 4, 2),
          offset: vec(2, 0, 0),
          pos: vec(0, 4, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 100,
        },
      ],
    },
    {
      id: 'custom_dup',
      name: 'Кость-дубль',
      pos: vec(),
      rotation: vec(),
      customPart: true,
      storeID: 60,
      children: [
        {
          name: 'Куб',
          size: vec(2, 4, 2),
          offset: vec(2, 0, 0),
          pos: vec(0, 4, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 101,
        },
      ],
    },
  ],
}

const makeAnimation = (): CPMAnimation => ({
  id: 'g_wave.json',
  name: 'Машет',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  frames: Array.from({ length: 6 }, () => ({ components: [] })),
})

function buildScene(): { scene: THREE.Scene; model: THREE.Group } {
  const scene = new THREE.Scene()
  const model = new THREE.Group()
  const root = new THREE.Group()
  root.userData.storeID = 50
  root.userData.isRoot = true
  const bone = new THREE.Group()
  bone.userData.storeID = 100
  bone.position.set(0, 4, 0)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial())
  mesh.position.set(3, -2, 0)
  bone.add(mesh)
  root.add(bone)
  model.add(root)
  scene.add(model)
  return { scene, model }
}

interface Harness {
  editor: CpmAnimationEditorApi
  bridge: CpmEditorBridge
  scene: THREE.Scene
  model: THREE.Group
  camera: THREE.PerspectiveCamera
  container: HTMLDivElement
  frames: FrameRequestCallback[]
  unmount: () => void
}

let harness: Harness | null = null
let rafId = 0

function setup(): Harness {
  const pinia = createPinia()
  setActivePinia(pinia)
  const data = shallowRef<CPMData | null>({
    config,
    textureUrl: 'blob:model',
    animations: [makeAnimation()],
    animEnc: null,
  })
  const bytes: Ref<Uint8Array | null> = ref(null)
  const bridge = createCpmEditorBridge()
  const { scene, model } = buildScene()
  const index = indexModelNodes(model)
  const host = {
    activeLayerIds: ref<number[]>([]),
    isPlaying: ref(false),
    onFinished: (): void => {},
  }
  const player = new CpmAnimationPlayer(index, host)
  const camera = new THREE.PerspectiveCamera()
  const container = document.createElement('div')
  container.setPointerCapture = (): void => {}
  container.releasePointerCapture = (): void => {}
  container.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    toJSON: (): Record<string, number> => ({}),
  })
  bridge.modelGroup.value = model
  bridge.nodeIndex.value = index
  bridge.player.value = player
  bridge.camera.value = camera
  bridge.container.value = container

  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafId += 1
    frames.push(callback)
    return rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (): void => {})

  const editorResult = withSetup(
    (): CpmAnimationEditorApi => useCpmAnimationEditor({ data, projectBytes: bytes, bridge }),
    [pinia],
  )
  editorResult.result.setSimpleMode(false)
  const sceneResult = withSetup((): null => {
    useCpmEditorScene(editorResult.result, bridge)
    return null
  })

  harness = {
    editor: editorResult.result,
    bridge,
    scene,
    model,
    camera,
    container,
    frames,
    unmount: (): void => {
      sceneResult.unmount()
      editorResult.unmount()
    },
  }
  return harness
}

function pointerEvent(type: string, clientX: number, clientY: number, button = 0): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

function runFrames(frames: FrameRequestCallback[]): void {
  const pending = frames.splice(0, frames.length)
  pending.forEach((callback) => callback(0))
}

function overlayOf(scene: THREE.Scene): THREE.Group | undefined {
  return scene.children.find((child): boolean => child.name === 'cpm-editor-overlay') as
    | THREE.Group
    | undefined
}

function gizmoOf(scene: THREE.Scene): THREE.Object3D | undefined {
  return scene.getObjectByName('cpm-editor-gizmo')
}

function gizmoTargetOf(model: THREE.Group): THREE.Object3D | undefined {
  return model.getObjectByName('cpm-editor-gizmo-target')
}

function rotationHandlesOf(scene: THREE.Scene): THREE.Object3D | undefined {
  return scene.getObjectByName('cpm-editor-rotation-handles')
}

function dragAt(
  container: HTMLDivElement,
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  deltaX: number,
  deltaY: number,
): void {
  camera.position.set(target.x, target.y, target.z + 10)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)

  const projected = target.clone().project(camera)
  const clientX = ((projected.x + 1) / 2) * 200
  const clientY = ((1 - projected.y) / 2) * 200

  container.dispatchEvent(pointerEvent('pointerdown', clientX, clientY))
  window.dispatchEvent(pointerEvent('pointermove', clientX + deltaX, clientY + deltaY))
  window.dispatchEvent(pointerEvent('pointerup', clientX + deltaX, clientY + deltaY))
}

beforeEach((): void => {
  rafId = 0
})

describe('useCpmEditorScene', () => {
  it('draws the arc and ghosts inside the existing scene', async () => {
    const { editor, scene, model, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.setGhostFrames(2, 2)
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    await nextTick()
    runFrames(frames)

    const overlay = overlayOf(scene)
    expect(overlay).toBeDefined()
    expect(overlay?.parent).toBe(scene)
    expect(model.parent).toBe(scene)

    const line = overlay?.children.find((child): boolean => child instanceof THREE.Line)
    expect(line).toBeInstanceOf(THREE.Line)

    const overlayMeshes = overlay?.children.filter(
      (child): boolean => child instanceof THREE.Mesh,
    )
    expect(overlayMeshes).toHaveLength(0)

    const ghosts = overlay?.children.filter((child): boolean => child instanceof THREE.Group)
    expect(ghosts).toHaveLength(3)
    ghosts?.forEach((ghost) => {
      ghost.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const material = object.material as THREE.MeshBasicMaterial
          expect(material.transparent).toBe(true)
          expect(material.opacity).toBeLessThan(1)
        }
      })
    })

    harness?.unmount()
    harness = null
  })

  it('does not recompute the arc and ghosts on every playback frame', async () => {
    const { editor, frames, scene } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)
    await nextTick()
    runFrames(frames)

    editor.isPlaying.value = true
    await nextTick()
    frames.splice(0, frames.length)

    editor.currentFrame.value = 2
    editor.currentFrame.value = 3
    await nextTick()
    expect(frames).toHaveLength(0)

    editor.isPlaying.value = false
    await nextTick()
    expect(frames).toHaveLength(1)
    runFrames(frames)

    expect(overlayOf(scene)).toBeDefined()

    harness?.unmount()
    harness = null
  })

  it('shows a translate gizmo on the selected bone', async () => {
    const { editor, model, scene, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)
    scene.updateMatrixWorld(true)

    const gizmo = gizmoOf(scene)
    expect(gizmo).toBeDefined()
    expect(gizmo?.visible).toBe(true)

    const target = gizmoTargetOf(model)
    const bone = model.children[0]?.children[0]
    expect(bone).toBeDefined()
    expect(target).toBeDefined()
    expect(target?.parent).toBe(bone?.parent)
    expect(target?.position.toArray()).toEqual([0, 4, 0])

    harness?.unmount()
    harness = null
  })

  it('shortens the top green arrow', async () => {
    const { editor, scene, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    await nextTick()
    runFrames(frames)

    const upperY: Array<{ min: number; max: number }> = []
    gizmoOf(scene)?.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.name !== 'Y') return
      const { material } = object
      if (!(material instanceof THREE.MeshBasicMaterial) || material.color.getHex() !== 0x00ff00) return
      object.geometry.computeBoundingBox()
      const box = object.geometry.boundingBox
      if (box !== null && box.min.y >= 0) upperY.push({ min: box.min.y, max: box.max.y })
    })

    expect(upperY.some(({ min, max }): boolean => Math.abs(min) < 0.001 && Math.abs(max - 0.3) < 0.001)).toBe(true)
    expect(upperY.every(({ max }): boolean => max <= 0.4 + 0.001)).toBe(true)

    harness?.unmount()
    harness = null
  })

  it('centers the rotation arrows on the bone pivot', async () => {
    const { editor, model, scene, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)
    scene.updateMatrixWorld(true)

    const handles = rotationHandlesOf(scene)
    const target = gizmoTargetOf(model)
    expect(handles).toBeDefined()
    expect(target).toBeDefined()
    if (handles === undefined || target === undefined) throw new Error('Гизмо не найдено')

    const targetWorld = target.getWorldPosition(new THREE.Vector3())
    expect(handles.position.toArray()).toEqual(targetWorld.toArray())
    expect(handles.getObjectByName('cpm-editor-rotation-handle-x')?.position.toArray())
      .toEqual([0, 0, 0])
    expect(handles.getObjectByName('cpm-editor-rotation-handle-y')?.position.toArray())
      .toEqual([0, 0, 0])
    expect(handles.getObjectByName('cpm-editor-rotation-handle-z')?.position.toArray())
      .toEqual([0, 0, 0])

    harness?.unmount()
    harness = null
  })

  it('highlights a rotation arrow on hover and restores it on leave', async () => {
    const { editor, scene, camera, container, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)

    camera.position.set(0, 4, 10)
    camera.lookAt(0, 4, 0)
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)

    const head = scene.getObjectByName('cpm-editor-rotation-head-y')
    expect(head).toBeInstanceOf(THREE.Mesh)
    if (!(head instanceof THREE.Mesh)) throw new Error('Стрелка поворота не найдена')
    const material = head.material as THREE.MeshBasicMaterial
    expect(material.color.getHex()).toBe(0x00ff00)

    const projected = head.getWorldPosition(new THREE.Vector3()).project(camera)
    const clientX = ((projected.x + 1) / 2) * 200
    const clientY = ((1 - projected.y) / 2) * 200

    container.dispatchEvent(pointerEvent('pointermove', clientX, clientY))
    expect(material.color.getHex()).toBe(0xffff00)

    container.dispatchEvent(pointerEvent('pointermove', 2, 2))
    expect(material.color.getHex()).toBe(0x00ff00)

    harness?.unmount()
    harness = null
  })

  it('syncs editor-hidden duplicate bones through the bridge', async () => {
    const { editor, bridge, frames } = setup()
    editor.startEditing('g_wave.json')
    await nextTick()
    runFrames(frames)

    expect([...bridge.hiddenBoneIds.value]).toEqual([101])

    expect(await editor.stopEditing()).toBe(true)
    await nextTick()
    expect(bridge.hiddenBoneIds.value.size).toBe(0)

    harness?.unmount()
    harness = null
  })

  it('shows the gizmo only while editing a selected bone and not during playback', async () => {
    const { editor, scene, frames } = setup()
    editor.startEditing('g_wave.json')
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)
    expect(rotationHandlesOf(scene)?.visible).toBe(true)

    editor.selectBone(null)
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(false)
    expect(rotationHandlesOf(scene)?.visible).toBe(false)

    editor.selectBone(100)
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)
    expect(rotationHandlesOf(scene)?.visible).toBe(true)

    editor.isPlaying.value = true
    await nextTick()
    expect(gizmoOf(scene)?.visible).toBe(false)
    expect(rotationHandlesOf(scene)?.visible).toBe(false)

    editor.isPlaying.value = false
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)
    expect(rotationHandlesOf(scene)?.visible).toBe(true)

    harness?.unmount()
    harness = null
  })

  it('translates the selected bone along a gizmo axis', async () => {
    const { editor, scene, camera, container, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)

    camera.position.set(0, 4, 10)
    camera.lookAt(0, 4, 0)
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)

    container.dispatchEvent(pointerEvent('pointerdown', 120, 100))
    container.dispatchEvent(pointerEvent('pointermove', 150, 100, -1))
    container.dispatchEvent(pointerEvent('pointerup', 150, 100))

    const position = editor.animation.value?.frames[0]?.components
      .find((component) => component.storeID === 100)?.pos
    expect(position?.x).toBeGreaterThan(0)
    expect(position?.y).toBeCloseTo(4)
    expect(position?.z).toBeCloseTo(0)

    harness?.unmount()
    harness = null
  })

  it('does not move the bone by dragging its geometry', async () => {
    const { editor, model, scene, camera, container, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)
    scene.updateMatrixWorld(true)

    const meshes: THREE.Mesh[] = []
    model.traverse((object): void => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    const [mesh] = meshes
    if (mesh === undefined) throw new Error('Меш кости не найден')
    const target = mesh.getWorldPosition(new THREE.Vector3())

    dragAt(container, camera, target, 30, 0)

    const position = editor.animation.value?.frames[0]?.components
      .find((component) => component.storeID === 100)?.pos
    expect(position).toBeUndefined()

    harness?.unmount()
    harness = null
  })

  it('rotates the bone from a gizmo rotation arrow', async () => {
    const { editor, scene, camera, container, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    await nextTick()
    runFrames(frames)

    camera.position.set(0, 4, 10)
    camera.lookAt(0, 4, 0)
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)

    const head = scene.getObjectByName('cpm-editor-rotation-head-y')
    expect(head).toBeDefined()
    if (head === undefined) throw new Error('Стрелка поворота не найдена')

    const projected = head.getWorldPosition(new THREE.Vector3()).project(camera)
    const clientX = ((projected.x + 1) / 2) * 200
    const clientY = ((1 - projected.y) / 2) * 200

    container.dispatchEvent(pointerEvent('pointerdown', clientX, clientY))
    window.dispatchEvent(pointerEvent('pointermove', clientX + 40, clientY))
    window.dispatchEvent(pointerEvent('pointerup', clientX + 40, clientY))

    const rotation = editor.animation.value?.frames[0]?.components
      .find((component) => component.storeID === 100)?.rotation.y
    expect(rotation).toBeCloseTo(340)

    harness?.unmount()
    harness = null
  })
})
