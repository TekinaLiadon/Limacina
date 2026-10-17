import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, shallowRef, type Ref } from 'vue'
import type { CPMAnimation, CPMConfig, CPMData } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'
import { CpmAnimationPlayer, indexModelNodes } from '../../cpm-viewer/cpmAnimationPlayer'
import { createCpmEditorBridge } from '../../cpm-viewer/cpmEditorBridge'
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
  it('draws the arc, key markers and ghosts inside the existing scene', async () => {
    const { editor, scene, model, frames } = setup()
    editor.startEditing('g_wave.json')
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

    const markers = overlay?.children.filter(
      (child): boolean => child instanceof THREE.Mesh && typeof child.userData.keyFrame === 'number',
    )
    expect(markers).toHaveLength(2)

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

  it('shows the gizmo only while editing a selected bone and not during playback', async () => {
    const { editor, scene, frames } = setup()
    editor.startEditing('g_wave.json')
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)

    editor.selectBone(null)
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(false)

    editor.selectBone(100)
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)

    editor.isPlaying.value = true
    await nextTick()
    expect(gizmoOf(scene)?.visible).toBe(false)

    editor.isPlaying.value = false
    await nextTick()
    runFrames(frames)
    expect(gizmoOf(scene)?.visible).toBe(true)

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

  it('rotates the bone from a dragged key marker', async () => {
    const { editor, scene, camera, container, frames } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)
    await nextTick()
    runFrames(frames)
    scene.updateMatrixWorld(true)

    const overlay = overlayOf(scene)
    const marker = (overlay?.children ?? []).find(
      (child): boolean => child instanceof THREE.Mesh && child.userData.keyFrame === 4,
    )
    expect(marker).toBeInstanceOf(THREE.Mesh)
    if (!(marker instanceof THREE.Mesh)) throw new Error('Маркер ключа не найден')

    camera.position.set(marker.position.x, marker.position.y, marker.position.z + 10)
    camera.lookAt(marker.position)
    camera.updateMatrixWorld(true)

    const rotationBefore = editor.animation.value?.frames[4]?.components
      .find((component) => component.storeID === 100)?.rotation.y
    expect(rotationBefore).toBe(50)

    container.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    expect(editor.currentFrame.value).toBe(4)
    window.dispatchEvent(pointerEvent('pointermove', 120, 100))
    window.dispatchEvent(pointerEvent('pointerup', 120, 100))

    const rotationAfter = editor.animation.value?.frames[4]?.components
      .find((component) => component.storeID === 100)?.rotation.y
    expect(rotationAfter).not.toBe(rotationBefore)
    expect(rotationAfter).toBeCloseTo(60)

    harness?.unmount()
    harness = null
  })
})
