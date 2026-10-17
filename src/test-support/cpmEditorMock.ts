import { computed, ref, shallowRef } from 'vue'
import { vi } from 'vitest'
import type { CpmAnimationEditorApi } from '@/04-features'

export const mockEditorAnimation = {
  id: 'g_wave.json',
  name: 'Машет',
  kind: 'gesture' as const,
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop' as const,
  hidden: false,
  frames: [],
}

export const mockEditorPose = {
  rotation: { x: 0, y: 30, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  show: true,
}

export function createCpmEditorMock(
  overrides: Partial<CpmAnimationEditorApi> = {},
): CpmAnimationEditorApi {
  return {
    isEditing: ref(true),
    isDirty: computed(() => false),
    animation: computed(() => mockEditorAnimation),
    animationData: computed(() => {
      const { frames: _frames, ...data } = mockEditorAnimation
      return data
    }),
    activeAnimations: computed(() => []),
    kindLabel: computed(() => 'Жест'),
    vanillaPoseIndex: computed(() => null),
    vanillaPoseHint: computed(() => null),
    isPreviewEnabled: ref(true),
    saveErrors: computed(() => []),
    saveWarnings: computed(() => []),
    frameCount: computed(() => 6),
    currentFrame: ref(2),
    isPlaying: ref(false),
    canUndo: computed(() => true),
    canRedo: computed(() => false),
    selectedBoneId: ref(0),
    boneRows: computed(() => [
      { storeId: 0, name: 'Голова', depth: 0 },
      { storeId: 100, name: 'Шляпа', depth: 1 },
    ]),
    selectedBoneName: computed(() => 'Голова'),
    selectedBonePose: computed(() => mockEditorPose),
    selectedBoneKeys: computed(() => [0, 4]),
    isKeyAtCurrentFrame: computed(() => false),
    canAddKey: computed(() => true),
    canRemoveKey: computed(() => false),
    canCopyKey: computed(() => true),
    canPasteKey: computed(() => false),
    canMirrorPose: computed(() => true),
    canSmoothTrack: computed(() => true),
    canRevertBoneStep: computed(() => true),
    canJumpToPreviousKey: computed(() => false),
    canJumpToNextKey: computed(() => true),
    ghostBefore: ref(2),
    ghostAfter: ref(2),
    beadMode: ref<'single' | 'proportional'>('single'),
    timeBeads: computed(() => [{ fromFrame: 0, toFrame: 4 }]),
    isSimpleMode: ref(false),
    simpleFrames: computed(() => [
      { frame: 0, seconds: 0 },
      { frame: 5, seconds: 1 },
    ]),
    editFrame: computed(() => 2),
    rotationPivot: ref<'base' | 'tip'>('base'),
    weight: shallowRef(null),
    isWeightLoading: ref(false),
    weightError: ref(''),
    startEditing: vi.fn(),
    stopEditing: vi.fn().mockResolvedValue(true),
    confirmLeave: vi.fn().mockResolvedValue(true),
    prepareSave: vi.fn().mockReturnValue(true),
    markSaved: vi.fn(),
    refreshWeight: vi.fn().mockResolvedValue(undefined),
    selectBone: vi.fn(),
    setBoneRotation: vi.fn(),
    setBonePosition: vi.fn(),
    setBoneVisible: vi.fn(),
    setName: vi.fn(),
    setKind: vi.fn(),
    setVanillaPose: vi.fn(),
    setDuration: vi.fn(),
    setFrameCount: vi.fn().mockResolvedValue(true),
    insertFrame: vi.fn(),
    setLoop: vi.fn(),
    setAdditive: vi.fn(),
    setInterpolator: vi.fn(),
    setPriority: vi.fn(),
    setOrder: vi.fn(),
    setGroup: vi.fn(),
    setMustFinish: vi.fn(),
    setCommand: vi.fn(),
    setHidden: vi.fn(),
    setPreviewEnabled: vi.fn(),
    deleteCurrentAnimation: vi.fn().mockResolvedValue(true),
    setGhostFrames: vi.fn(),
    setBeadMode: vi.fn(),
    setSimpleMode: vi.fn(),
    goToSecond: vi.fn(),
    setRotationPivot: vi.fn(),
    beginBeadDrag: vi.fn(),
    dragBead: vi.fn(),
    endBeadDrag: vi.fn(),
    beginBoneDrag: vi.fn(),
    dragBoneRotation: vi.fn(),
    dragBoneTranslation: vi.fn(),
    endBoneDrag: vi.fn(),
    addKey: vi.fn(),
    removeKey: vi.fn(),
    copyKey: vi.fn(),
    pasteKey: vi.fn(),
    mirrorPose: vi.fn(),
    smoothTrack: vi.fn(),
    revertBoneStep: vi.fn(),
    insertPoseAtFraction: vi.fn(),
    togglePlayback: vi.fn(),
    setPlaying: vi.fn(),
    stepFrame: vi.fn(),
    goToFrame: vi.fn(),
    jumpToKey: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  }
}

export function createCpmEditorMockWith(
  kind: 'gesture' | 'vanilla-pose',
  overrides: Partial<CpmAnimationEditorApi> = {},
): CpmAnimationEditorApi {
  const data = { ...mockEditorAnimation, kind }
  const animationData = kind === 'vanilla-pose'
    ? { ...data, poseIndex: 3 }
    : data
  const { frames: _frames, ...animationDataWithoutFrames } = animationData

  return createCpmEditorMock({
    animation: computed(() => data),
    animationData: computed(() => animationDataWithoutFrames),
    vanillaPoseIndex: computed(() => (kind === 'vanilla-pose' ? 3 : null)),
    ...overrides,
  })
}
