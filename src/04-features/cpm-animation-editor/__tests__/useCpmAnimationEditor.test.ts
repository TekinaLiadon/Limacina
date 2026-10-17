import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useNotificationStore, type CPMAnimation, type CPMConfig, type CPMData } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'
import { createCpmEditorBridge } from '../../cpm-viewer/cpmEditorBridge'
import {
  hasUnsavedCpmAnimationChanges,
  useCpmAnimationEditor,
  type CpmAnimationEditorApi,
} from '../useCpmAnimationEditor'
import { EDITOR_MAX_ANIMATIONS } from '../editorValidation'
import { frameToTimeMs } from '../editorTimeline'
import { VANILLA_POSES } from '../../cpm-settings/cpmAnimationParser'
import type { CpmProjectWeight } from '../editorWeight'

const measureCpmProjectWeight = vi.hoisted(() => vi.fn())
const reportError = vi.hoisted(() => vi.fn())

vi.mock('../editorWeight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editorWeight')>()),
  measureCpmProjectWeight,
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

const vec = (x = 0, y = 0, z = 0): { x: number; y: number; z: number } => ({ x, y, z })

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Голова',
      pos: vec(),
      rotation: vec(),
      children: [
        {
          name: 'Шляпа',
          size: vec(8, 8, 8),
          offset: vec(),
          pos: vec(0, 4, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 100,
        },
      ],
    },
    {
      id: 'body',
      name: 'Тело',
      pos: vec(),
      rotation: vec(),
    },
  ],
}

const makeAnimation = (overrides: Partial<CPMAnimation> = {}): CPMAnimation => ({
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
  ...overrides,
})

const weightResult = (bytes = 2048): CpmProjectWeight => ({
  bytes,
  limitBytes: 20 * 1024 * 1024,
  exceedsLimit: false,
  warning: null,
})

const makeData = (animations: CPMAnimation[]): CPMData => ({
  config,
  textureUrl: 'blob:model',
  animations,
  animEnc: null,
})

interface Harness {
  editor: CpmAnimationEditorApi
  data: ShallowRef<CPMData | null>
  bytes: Ref<Uint8Array | null>
  notification: ReturnType<typeof useNotificationStore>
  unmount: () => void
}

let harness: Harness | null = null

function setup(
  animations: CPMAnimation[] = [makeAnimation()],
  simpleMode: boolean | null = false,
): Harness {
  const pinia = createPinia()
  setActivePinia(pinia)
  const data = shallowRef<CPMData | null>(makeData(animations))
  const bytes = ref<Uint8Array | null>(new Uint8Array([1, 2, 3]))
  const bridge = createCpmEditorBridge()
  const { result, unmount } = withSetup(
    (): CpmAnimationEditorApi => useCpmAnimationEditor({ data, projectBytes: bytes, bridge }),
    [pinia],
  )
  if (simpleMode !== null) result.setSimpleMode(simpleMode)
  const notification = useNotificationStore()
  harness = { editor: result, data, bytes, notification, unmount }
  return harness
}

const componentOf = (
  animation: CPMAnimation | null,
  frame: number,
  storeId: number,
): { rotation: { x: number; y: number; z: number }; pos: { x: number; y: number; z: number }; show: boolean } | null => {
  const component = animation?.frames[frame]?.components.find((item) => item.storeID === storeId)
  return component ?? null
}

beforeEach((): void => {
  measureCpmProjectWeight.mockResolvedValue(weightResult())
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach((): void => {
  harness?.unmount()
  harness = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useCpmAnimationEditor', () => {
  it('starts in simple mode by default', () => {
    const { editor } = setup([makeAnimation()], null)
    expect(editor.isSimpleMode.value).toBe(true)
  })

  it('opens an existing animation without marking it dirty', () => {
    const { editor, data } = setup()

    expect(editor.isEditing.value).toBe(false)
    editor.startEditing('g_wave.json')

    expect(editor.isEditing.value).toBe(true)
    expect(editor.isDirty.value).toBe(false)
    expect(editor.frameCount.value).toBe(6)
    expect(editor.kindLabel.value).toBe('Жест')
    expect(editor.selectedBoneId.value).toBe(0)
    expect(data.value?.animations).toHaveLength(1)
  })

  it('creates a new gesture animation and appends it to the project', async () => {
    const { editor, data, notification } = setup()
    vi.spyOn(notification, 'confirm').mockResolvedValue(true)

    editor.startEditing(null)

    expect(editor.isEditing.value).toBe(true)
    expect(editor.isDirty.value).toBe(true)
    expect(editor.animation.value?.kind).toBe('gesture')
    expect(data.value?.animations).toHaveLength(2)
    expect(editor.saveErrors.value.join(' ')).toContain('ключей')

    editor.setName('Машет рукой')
    editor.setBoneRotation('y', 30)
    await nextTick()

    expect(editor.saveErrors.value).toEqual([])
    expect(editor.animation.value?.name).toBe('Машет рукой')
    expect(componentOf(editor.animation.value, 0, 0)?.rotation.y).toBe(30)

    editor.markSaved()
    expect(editor.isDirty.value).toBe(false)
    expect(editor.prepareSave()).toBe(true)
  })

  it('edits only the selected bone', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')

    editor.selectBone(100)
    editor.setBoneRotation('z', 45)

    expect(componentOf(editor.animation.value, 0, 100)?.rotation.z).toBe(45)
    expect(componentOf(editor.animation.value, 0, 0)).toBeNull()
  })

  it('undoes and redoes pose edits', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')

    editor.setBoneRotation('y', 30)
    expect(componentOf(editor.animation.value, 0, 0)?.rotation.y).toBe(30)
    expect(editor.canUndo.value).toBe(true)

    editor.undo()
    expect(componentOf(editor.animation.value, 0, 0)).toBeNull()
    expect(editor.canRedo.value).toBe(true)

    editor.redo()
    expect(componentOf(editor.animation.value, 0, 0)?.rotation.y).toBe(30)
  })

  it('tracks keys, steps frames and jumps between keys', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)

    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(5)
    editor.setBoneRotation('y', 50)

    expect(editor.selectedBoneKeys.value).toEqual([0, 5])

    editor.goToFrame(0)
    expect(editor.canJumpToNextKey.value).toBe(true)
    editor.jumpToKey(1)
    expect(editor.currentFrame.value).toBe(5)
    editor.jumpToKey(-1)
    expect(editor.currentFrame.value).toBe(0)

    editor.goToFrame(2)
    expect(editor.canAddKey.value).toBe(true)
    editor.addKey()
    expect(editor.selectedBoneKeys.value).toEqual([0, 2, 5])
    expect(editor.canRemoveKey.value).toBe(true)

    editor.removeKey()
    expect(editor.selectedBoneKeys.value).toEqual([0, 5])

    editor.stepFrame(1)
    expect(editor.currentFrame.value).toBe(3)
    editor.stepFrame(-10)
    expect(editor.currentFrame.value).toBe(0)
  })

  it('snaps navigation and pose edits to whole seconds in simple mode', () => {
    const { editor } = setup([makeAnimation({ duration: 3000 })])
    editor.startEditing('g_wave.json')
    editor.selectBone(100)

    editor.setSimpleMode(true)
    expect(editor.isSimpleMode.value).toBe(true)
    expect(editor.currentFrame.value).toBe(0)

    editor.goToFrame(3)
    expect(editor.currentFrame.value).toBe(2)
    editor.setBoneRotation('y', 40)
    expect(componentOf(editor.animation.value, 2, 100)?.rotation.y).toBe(40)

    editor.goToFrame(4)
    editor.setBoneRotation('y', 80)
    expect(editor.selectedBoneKeys.value).toEqual([2, 4])
    expect(componentOf(editor.animation.value, 3, 100)?.rotation.y).toBeCloseTo(60)

    editor.currentFrame.value = 3
    expect(editor.editFrame.value).toBe(2)
    expect(editor.selectedBonePose.value?.rotation.y).toBe(40)
    editor.setBoneRotation('x', 15)
    expect(editor.currentFrame.value).toBe(2)
    expect(componentOf(editor.animation.value, 2, 100)?.rotation.x).toBe(15)
  })

  it('goes to a second and steps between second boundaries', () => {
    const { editor } = setup([makeAnimation({ duration: 3000 })])
    editor.startEditing('g_wave.json')
    editor.setSimpleMode(true)

    editor.goToSecond(1)
    expect(editor.currentFrame.value).toBe(2)
    editor.goToSecond(2)
    expect(editor.currentFrame.value).toBe(4)

    editor.goToFrame(0)
    editor.stepFrame(1)
    expect(editor.currentFrame.value).toBe(2)
    editor.stepFrame(1)
    expect(editor.currentFrame.value).toBe(4)
    editor.stepFrame(1)
    expect(editor.currentFrame.value).toBe(5)
    editor.stepFrame(-1)
    expect(editor.currentFrame.value).toBe(4)
  })

  it('returns to frame-level navigation after leaving simple mode', () => {
    const { editor } = setup([makeAnimation({ duration: 3000 })])
    editor.startEditing('g_wave.json')
    editor.setSimpleMode(true)
    editor.goToFrame(4)

    editor.setSimpleMode(false)
    editor.goToFrame(3)
    expect(editor.currentFrame.value).toBe(3)
    expect(editor.editFrame.value).toBe(3)
  })

  it('translates the dragged bone from its start pose', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)

    editor.beginBoneDrag(100, 0)
    editor.dragBoneTranslation(1.5, -2, 0.5)
    editor.endBoneDrag()

    expect(componentOf(editor.animation.value, 0, 100)?.pos).toEqual({ x: 1.5, y: 2, z: 0.5 })
    expect(editor.canUndo.value).toBe(true)
  })

  it('applies a pivot offset together with a dragged rotation', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)

    editor.beginBoneDrag(100, 0)
    editor.dragBoneRotation(40, 10, { x: 1.5, y: -2, z: 0.5 })
    editor.endBoneDrag()

    const component = componentOf(editor.animation.value, 0, 100)
    expect(component?.rotation.x).toBe(10)
    expect(component?.rotation.y).toBe(40)
    expect(component?.pos).toEqual({ x: 1.5, y: 2, z: 0.5 })
  })

  it('reverts the last edit of the selected bone', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)

    editor.setBoneRotation('y', 30)
    editor.setBonePosition('x', 2)

    expect(editor.canRevertBoneStep.value).toBe(true)
    editor.revertBoneStep()

    const restored = componentOf(editor.animation.value, 0, 100)
    expect(restored?.rotation.y).toBe(30)
    expect(restored?.pos).toEqual({ x: 0, y: 4, z: 0 })

    editor.revertBoneStep()
    expect(componentOf(editor.animation.value, 0, 100)).toBeNull()
    expect(editor.canRevertBoneStep.value).toBe(false)
  })

  it('reverts an accidental bone drag as one step', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)

    editor.beginBoneDrag(100, 0)
    editor.dragBoneTranslation(3, 0, 0)
    editor.endBoneDrag()

    expect(componentOf(editor.animation.value, 0, 100)?.pos.x).toBe(3)
    expect(editor.canRevertBoneStep.value).toBe(true)

    editor.revertBoneStep()
    expect(componentOf(editor.animation.value, 0, 100)).toBeNull()
  })

  it('reverts one bone without touching another', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')

    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBonePosition('x', 2)

    editor.selectBone(0)
    editor.setBoneRotation('y', 40)

    editor.selectBone(100)
    editor.revertBoneStep()

    expect(componentOf(editor.animation.value, 0, 100)).toBeNull()
    expect(componentOf(editor.animation.value, 0, 0)?.rotation.y).toBe(40)
  })

  it('switches the rotation pivot', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')

    expect(editor.rotationPivot.value).toBe('base')
    editor.setRotationPivot('tip')
    expect(editor.rotationPivot.value).toBe('tip')
    editor.setRotationPivot('base')
    expect(editor.rotationPivot.value).toBe('base')
  })

  it('toggles playback and keeps the playhead at the paused frame', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')

    editor.togglePlayback()
    expect(editor.isPlaying.value).toBe(true)

    editor.togglePlayback()
    expect(editor.isPlaying.value).toBe(false)
  })
  it('handles editor hotkeys and ignores text inputs', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 30)
    editor.goToFrame(3)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    expect(editor.isPlaying.value).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    expect(editor.isPlaying.value).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(editor.currentFrame.value).toBe(2)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(editor.currentFrame.value).toBe(3)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(componentOf(editor.animation.value, 0, 0)).toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }))
    expect(componentOf(editor.animation.value, 0, 0)?.rotation.y).toBe(30)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(editor.currentFrame.value).toBe(3)
    input.remove()
  })

  it('does not toggle playback when Space activates a focused button', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    const control = document.createElement('button')
    document.body.appendChild(control)

    control.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))

    expect(editor.isPlaying.value).toBe(false)
    control.remove()
  })

  it('asks for confirmation before discarding unsaved changes', async () => {
    const { editor, data, notification } = setup()
    const confirm = vi.spyOn(notification, 'confirm')
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 30)
    expect(editor.isDirty.value).toBe(true)

    confirm.mockResolvedValueOnce(false)
    expect(await editor.stopEditing()).toBe(false)
    expect(editor.isEditing.value).toBe(true)

    confirm.mockResolvedValueOnce(true)
    expect(await editor.stopEditing()).toBe(true)
    expect(editor.isEditing.value).toBe(false)
    expect(componentOf(data.value?.animations?.[0] ?? null, 0, 0)).toBeNull()
  })

  it('keeps saved changes on exit without a confirmation', async () => {
    const { editor, data, notification } = setup()
    const confirm = vi.spyOn(notification, 'confirm')
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 30)
    editor.markSaved()

    expect(await editor.confirmLeave()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(componentOf(data.value?.animations?.[0] ?? null, 0, 0)?.rotation.y).toBe(30)
  })

  it('discards unsaved changes back to the last saved state', async () => {
    const { editor, data, notification } = setup()
    vi.spyOn(notification, 'confirm').mockResolvedValue(true)
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 30)
    editor.markSaved()
    editor.setBoneRotation('x', 20)

    expect(await editor.stopEditing()).toBe(true)
    expect(componentOf(data.value?.animations?.[0] ?? null, 0, 0)?.rotation.y).toBe(30)
    expect(componentOf(data.value?.animations?.[0] ?? null, 0, 0)?.rotation.x).toBe(0)
  })

  it('blocks saving an invalid draft and shows the reason', () => {
    const { editor, notification } = setup()
    const show = vi.spyOn(notification, 'show')
    editor.startEditing(null)

    editor.setName('   ')

    expect(editor.saveErrors.value.length).toBeGreaterThan(0)
    expect(editor.prepareSave()).toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('rejects a duplicate of the trigger and name pair', () => {
    const duplicates = [makeAnimation(), makeAnimation({ id: 'g_other.json', name: 'Другая' })]
    const { editor } = setup(duplicates)
    editor.startEditing('g_other.json')

    editor.setName('Машет')

    expect(editor.saveErrors.value.join(' ')).toContain('уже существует')
  })

  it('recalculates weight after a user action with a debounce', async () => {
    vi.useFakeTimers()
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    await vi.advanceTimersByTimeAsync(400)
    expect(measureCpmProjectWeight).toHaveBeenCalled()
    expect(editor.weight.value?.bytes).toBe(2048)

    measureCpmProjectWeight.mockClear()
    editor.setBoneRotation('x', 20)
    await vi.advanceTimersByTimeAsync(399)
    expect(measureCpmProjectWeight).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(measureCpmProjectWeight).toHaveBeenCalledTimes(1)
  })

  it('surfaces a weight measurement failure', async () => {
    measureCpmProjectWeight.mockRejectedValue(new Error('boom'))
    const { editor } = setup()

    await editor.refreshWeight()

    expect(editor.weightError.value).not.toBe('')
    expect(editor.weight.value).toBeNull()
    expect(reportError).toHaveBeenCalled()
  })

  it('exposes the dirty state to the project switch and launch guards', () => {
    const { editor, notification } = setup()
    vi.spyOn(notification, 'confirm').mockResolvedValue(true)

    editor.startEditing('g_wave.json')
    expect(hasUnsavedCpmAnimationChanges()).toBe(false)

    editor.setBoneRotation('y', 30)
    expect(hasUnsavedCpmAnimationChanges()).toBe(true)

    editor.markSaved()
    expect(hasUnsavedCpmAnimationChanges()).toBe(false)
  })

  it('builds time beads between the keys of the selected bone', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)

    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(2)
    editor.setBoneRotation('y', 30)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    expect(editor.timeBeads.value).toEqual([
      { fromFrame: 0, toFrame: 2 },
      { fromFrame: 2, toFrame: 4 },
    ])
  })

  it('moves a single key from a time bead without changing its pose', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    editor.beginBeadDrag(0, 4)
    editor.dragBead(1)
    editor.dragBead(1)
    editor.endBeadDrag()

    expect(editor.selectedBoneKeys.value).toEqual([0, 5])
    expect(componentOf(editor.animation.value, 5, 100)?.rotation.y).toBe(50)

    editor.undo()
    expect(editor.selectedBoneKeys.value).toEqual([0, 4])
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(50)
  })

  it('shifts a group of keys proportionally in the group bead mode', () => {
    const { editor } = setup()
    editor.setBeadMode('proportional')
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(2)
    editor.setBoneRotation('y', 30)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    expect(editor.beadMode.value).toBe('proportional')

    editor.beginBeadDrag(0, 4)
    editor.dragBead(1)
    editor.endBeadDrag()

    expect(editor.selectedBoneKeys.value).toEqual([0, 3, 5])
    expect(componentOf(editor.animation.value, 3, 100)?.rotation.y).toBe(30)
    expect(componentOf(editor.animation.value, 5, 100)?.rotation.y).toBe(50)
  })

  it('keeps a bead drag without movement out of the history', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)
    const before = JSON.stringify(editor.animation.value)

    editor.beginBeadDrag(0, 4)
    editor.dragBead(0)
    editor.endBeadDrag()

    expect(JSON.stringify(editor.animation.value)).toBe(before)
    expect(editor.canUndo.value).toBe(true)
    editor.undo()
    expect(editor.selectedBoneKeys.value).toEqual([0])
  })

  it('stops a bead drag before the next key instead of overwriting it', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(2)
    editor.setBoneRotation('y', 30)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    editor.beginBeadDrag(0, 2)
    editor.dragBead(5)
    editor.endBeadDrag()

    expect(editor.selectedBoneKeys.value).toEqual([0, 3, 4])
    expect(componentOf(editor.animation.value, 3, 100)?.rotation.y).toBe(30)
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(50)
  })

  it('copies a key and pastes it into another frame', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(2)
    editor.setBoneRotation('y', 30)

    editor.goToFrame(0)
    expect(editor.canCopyKey.value).toBe(true)
    editor.copyKey()
    expect(editor.canPasteKey.value).toBe(true)

    editor.goToFrame(3)
    editor.pasteKey()

    expect(editor.selectedBoneKeys.value).toEqual([0, 2, 3])
    expect(componentOf(editor.animation.value, 3, 100)?.rotation.y).toBe(10)
    editor.undo()
    expect(editor.selectedBoneKeys.value).toEqual([0, 2])
  })

  it('inserts an intermediate pose at a fraction between neighboring keys', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)
    editor.goToFrame(1)

    editor.insertPoseAtFraction(0.5)

    expect(editor.selectedBoneKeys.value).toEqual([0, 2, 4])
    expect(componentOf(editor.animation.value, 2, 100)?.rotation.y).toBe(30)
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(50)
  })

  it('mirrors the current pose relative to rest', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('x', 20)
    editor.setBonePosition('x', 2)

    expect(editor.canMirrorPose.value).toBe(true)
    editor.mirrorPose()

    expect(componentOf(editor.animation.value, 0, 100)?.rotation.x).toBe(20)
    expect(componentOf(editor.animation.value, 0, 100)?.pos.x).toBe(-2)
  })

  it('smooths the inner keys of the selected bone', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(2)
    editor.setBoneRotation('y', 100)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 10)

    expect(editor.canSmoothTrack.value).toBe(true)
    editor.smoothTrack()

    expect(componentOf(editor.animation.value, 0, 100)?.rotation.y).toBe(10)
    expect(componentOf(editor.animation.value, 2, 100)?.rotation.y).toBe(55)
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(10)
  })

  it('rotates the selected bone from an arc marker at its key frame', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    editor.beginBoneDrag(100, 4)
    expect(editor.currentFrame.value).toBe(4)

    editor.dragBoneRotation(20, -10)
    editor.dragBoneRotation(40, -20)
    editor.endBoneDrag()

    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(90)
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.x).toBe(340)

    editor.undo()
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(50)
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.x).toBe(0)
  })

  it('clamps the ghost frame counts', () => {
    const { editor } = setup()

    editor.setGhostFrames(3, -2)
    expect(editor.ghostBefore.value).toBe(3)
    expect(editor.ghostAfter.value).toBe(0)

    editor.setGhostFrames(100, 2)
    expect(editor.ghostBefore.value).toBe(8)
    expect(editor.ghostAfter.value).toBe(2)
  })

  it('refuses to create an animation beyond the project limit', () => {
    const animations = Array.from({ length: EDITOR_MAX_ANIMATIONS }, (_, index) => makeAnimation({
      id: `g_${index}.json`,
      name: `Машет ${index}`,
    }))
    const { editor, data, notification } = setup(animations)
    const show = vi.spyOn(notification, 'show')

    editor.startEditing(null)

    expect(editor.isEditing.value).toBe(false)
    expect(show).toHaveBeenCalledWith(expect.stringContaining(String(EDITOR_MAX_ANIMATIONS)))
    expect(data.value?.animations).toHaveLength(EDITOR_MAX_ANIMATIONS)
  })

  it('switches the trigger and the vanilla pose', () => {
    const { editor, data } = setup()
    editor.startEditing('g_wave.json')

    editor.setKind('setup')
    expect(editor.animation.value?.kind).toBe('setup')
    expect(data.value?.animations?.[0]?.kind).toBe('setup')

    editor.setKind('vanilla-pose')
    expect(editor.animation.value?.poseIndex).toBe(1)
    expect(editor.animation.value?.name).toBe('standing')
    expect(editor.animation.value?.loop).toBe(false)
    expect(editor.kindLabel.value).toBe('Ванильная поза')

    editor.setVanillaPose(5)
    expect(editor.animation.value?.poseIndex).toBe(5)
    expect(editor.animation.value?.name).toBe('swimming')
    expect(data.value?.animations?.[0]?.poseIndex).toBe(5)
  })

  it('does not rename a vanilla pose animation', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setKind('vanilla-pose')

    editor.setName('Своё имя')

    expect(editor.animation.value?.name).toBe('standing')
  })

  it('blocks a name that becomes a duplicate after a trigger change', () => {
    const items = [
      makeAnimation(),
      makeAnimation({ id: 'g_setup.json', name: 'Машет', kind: 'setup' }),
    ]
    const { editor } = setup(items)
    editor.startEditing('g_wave.json')

    editor.setKind('setup')

    expect(editor.saveErrors.value.join(' ')).toContain('уже существует')
  })

  it('stores the visible and advanced properties in the project', () => {
    const { editor, data } = setup()
    editor.startEditing('g_wave.json')

    editor.setDuration(1500)
    editor.setLoop(true)
    editor.setAdditive(true)
    editor.setInterpolator('trig_single')
    editor.setPriority(4)
    editor.setOrder(2)
    editor.setGroup('Основная')
    editor.setMustFinish(true)
    editor.setCommand(true)
    editor.setHidden(true)

    expect(editor.animation.value).toMatchObject({
      duration: 1500,
      loop: true,
      additive: true,
      interpolator: 'trig_single',
      priority: 4,
      order: 2,
      group: 'Основная',
      mustFinish: true,
      command: true,
      hidden: true,
    })
    expect(data.value?.animations?.[0]).toMatchObject({
      duration: 1500,
      additive: true,
      interpolator: 'trig_single',
      priority: 4,
      order: 2,
      group: 'Основная',
      mustFinish: true,
      command: true,
      hidden: true,
    })
  })

  it('ignores looping for non-gesture triggers and clamps numeric properties', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setKind('setup')

    editor.setLoop(true)
    editor.setDuration(0)
    editor.setPriority(500)
    editor.setOrder(-500)

    expect(editor.animation.value?.loop).toBe(false)
    expect(editor.animation.value?.duration).toBe(1)
    expect(editor.animation.value?.priority).toBe(127)
    expect(editor.animation.value?.order).toBe(-128)
  })

  it('keeps the key indexes and stretches their time when the duration changes', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    editor.setDuration(2000)

    expect(editor.selectedBoneKeys.value).toEqual([0, 4])
    expect(componentOf(editor.animation.value, 4, 100)?.rotation.y).toBe(50)
    expect(frameToTimeMs(4, editor.frameCount.value, 2000)).toBeCloseTo(1333.33, 1)
  })

  it('inserts a frame without moving the existing keys in time', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)
    const before = frameToTimeMs(4, editor.frameCount.value, editor.animation.value?.duration ?? 0)

    editor.insertFrame()

    expect(editor.frameCount.value).toBe(7)
    expect(editor.animation.value?.duration).toBe(1167)
    expect(editor.selectedBoneKeys.value).toEqual([0, 4])
    const after = frameToTimeMs(4, editor.frameCount.value, editor.animation.value?.duration ?? 0)
    expect(Math.abs(after - before)).toBeLessThan(1)
  })

  it('asks before trimming keys when the frame count decreases', async () => {
    const { editor, notification } = setup()
    const confirm = vi.spyOn(notification, 'confirm')
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 50)

    confirm.mockResolvedValueOnce(false)
    expect(await editor.setFrameCount(3)).toBe(false)
    expect(editor.frameCount.value).toBe(6)
    expect(editor.selectedBoneKeys.value).toEqual([0, 4])

    confirm.mockResolvedValueOnce(true)
    expect(await editor.setFrameCount(3)).toBe(true)
    expect(editor.frameCount.value).toBe(3)
    expect(editor.selectedBoneKeys.value).toEqual([0])
    expect(editor.animation.value?.duration).toBe(500)
    expect(editor.currentFrame.value).toBeLessThan(3)
  })

  it('changes the frame count without a confirmation when no keys are lost', async () => {
    const { editor, notification } = setup()
    const confirm = vi.spyOn(notification, 'confirm')
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)

    expect(await editor.setFrameCount(3)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(editor.frameCount.value).toBe(3)
  })

  it('deletes the current animation after a confirmation', async () => {
    const { editor, data, notification } = setup()
    const confirm = vi.spyOn(notification, 'confirm').mockResolvedValue(true)
    editor.startEditing('g_wave.json')

    expect(await editor.deleteCurrentAnimation()).toBe(true)

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(editor.isEditing.value).toBe(false)
    expect(data.value?.animations).toHaveLength(0)
    expect(hasUnsavedCpmAnimationChanges()).toBe(true)

    confirm.mockResolvedValue(true)
    expect(await editor.confirmLeave()).toBe(true)
    expect(data.value?.animations).toHaveLength(1)
    expect(hasUnsavedCpmAnimationChanges()).toBe(false)
  })

  it('keeps the animation when the deletion is cancelled', async () => {
    const { editor, data, notification } = setup()
    vi.spyOn(notification, 'confirm').mockResolvedValue(false)
    editor.startEditing('g_wave.json')

    expect(await editor.deleteCurrentAnimation()).toBe(false)
    expect(editor.isEditing.value).toBe(true)
    expect(data.value?.animations).toHaveLength(1)
  })

  it('clears the project dirty flag after a successful save', async () => {
    const { editor, notification } = setup()
    vi.spyOn(notification, 'confirm').mockResolvedValue(true)
    editor.startEditing('g_wave.json')
    await editor.deleteCurrentAnimation()

    editor.markSaved()

    expect(hasUnsavedCpmAnimationChanges()).toBe(false)
  })

  it('toggles the vanilla pose preview', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setKind('vanilla-pose')

    expect(editor.activeAnimations.value).toHaveLength(1)
    editor.setPreviewEnabled(false)
    expect(editor.activeAnimations.value).toHaveLength(0)
    editor.setPreviewEnabled(true)
    expect(editor.activeAnimations.value).toHaveLength(1)

    editor.setPreviewEnabled(false)
    editor.togglePlayback()
    expect(editor.isPreviewEnabled.value).toBe(true)
    expect(editor.isPlaying.value).toBe(true)
  })

  it('warns about a mechanical transition for a linear interpolator', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.selectBone(100)
    editor.goToFrame(0)
    editor.setBoneRotation('y', 10)
    editor.goToFrame(4)
    editor.setBoneRotation('y', 100)

    expect(editor.saveWarnings.value.join(' ')).toContain('механический')

    editor.setInterpolator('poly_loop')
    expect(editor.saveWarnings.value.join(' ')).not.toContain('механический')
  })

  it('warns about the missing anim_enc when a layer trigger is selected', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setBoneRotation('y', 10)

    editor.setKind('layer')

    expect(editor.saveErrors.value).toEqual([])
    expect(editor.saveWarnings.value.join(' ')).toContain('anim_enc.json')
  })

  it('hints the multiplier duration for a state-driven vanilla pose', () => {
    const { editor } = setup()
    editor.startEditing('g_wave.json')
    editor.setKind('vanilla-pose')

    editor.setVanillaPose(VANILLA_POSES.indexOf('punch_left'))

    expect(editor.vanillaPoseHint.value).toContain('множитель')

    editor.setVanillaPose(VANILLA_POSES.indexOf('standing'))
    expect(editor.vanillaPoseHint.value).toBeNull()
  })
})
