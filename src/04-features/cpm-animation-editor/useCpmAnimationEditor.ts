import {
  computed,
  nextTick,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'
import { useNotificationStore, type CPMAnimation, type CPMAnimationFrame, type CPMAnimationInterpolator, type CPMAnimationKind, type CPMData, type CPMVec3 } from '@/05-entities'
import { reportError } from '@/06-shared'
import type { ActiveCpmAnimation } from '../cpm-viewer/cpmAnimationPlayer'
import type { CpmEditorBridge } from '../cpm-viewer/cpmEditorBridge'
import {
  bonePoseAt,
  buildEditorBoneIndex,
  buildEditorState,
  normalizeAngle,
  serializeEditorAnimation,
} from './editorModel'
import {
  addBoneKey,
  boneTracksEqual,
  changeAnimationKind,
  changeAnimationPose,
  cloneBoneTrack,
  countEditorKeysBeyond,
  eraseBoneKey,
  insertEditorFrame,
  insertPoseAtFraction as insertPoseAtFractionOp,
  mirrorBonePose,
  moveBoneKey,
  normalizeEditorDuration,
  normalizeEditorFrameCount,
  normalizeEditorOrder,
  normalizeEditorPriority,
  resizeEditorModel,
  restoreBoneTrack,
  scaleEditorDuration,
  setBonePose,
  shiftKeysProportionally,
  smoothBoneTrack,
  updateAnimationData,
} from './editorOperations'
import {
  canRedoEditorHistory,
  canUndoEditorHistory,
  commitEditorHistory,
  createEditorHistory,
  currentEditorState,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory,
} from './editorHistory'
import {
  EDITOR_LINEAR_WARNING,
  EDITOR_MAX_ANIMATIONS,
  hasMechanicalLinearTransition,
  validateAnimationDraft,
} from './editorValidation'
import { vanillaPoseHint as resolveVanillaPoseHint } from './editorTriggers'
import { measureCpmProjectWeight, type CpmProjectWeight } from './editorWeight'
import {
  buildEditorBoneTree,
  firstAnimatableBoneId,
  flattenEditorBoneTree,
  type EditorBoneTreeRow,
} from './editorBones'
import {
  buildSimpleFrames,
  buildTimeBeads,
  clampBeadDelta,
  clampFrame,
  EDITOR_DEFAULT_FRAME_COUNT,
  nearestSimpleFrame,
  nextKeyFrame,
  previousKeyFrame,
  secondsToEditorFrame,
  stepSimpleFrame,
  timeToFrame,
  type EditorSimpleFrame,
} from './editorTimeline'
import { clampGhostCount, GHOST_DEFAULT_AFTER, GHOST_DEFAULT_BEFORE } from './editorArc'
import {
  EDITOR_KIND_LABELS,
  EDITOR_NEW_ANIMATION_NAME,
  type EditorAnimationData,
  type EditorAnimationState,
  type EditorBeadMode,
  type EditorBoneTrack,
  type EditorPose,
  type EditorRotationPivot,
  type EditorTimeBead,
} from './types'

const WEIGHT_DEBOUNCE_MS = 400
const NEW_ANIMATION_ID_PREFIX = 'cpm-editor-'
const DIRTY_EXIT_MESSAGE = 'В анимации есть несохранённые изменения. Выйти из редактора и потерять их?'
const DIRTY_PROJECT_EXIT_MESSAGE = 'Изменения проекта не сохранены. Выйти и потерять их?'
const EMPTY_ANIMATION_MESSAGE = 'В анимации нет ключей: измените хотя бы одну кость'
const WEIGHT_ERROR_MESSAGE = 'Не удалось оценить вес проекта'
const ANIMATION_LIMIT_MESSAGE = `В проекте не может быть больше ${EDITOR_MAX_ANIMATIONS} анимаций`
const frameTrimMessage = (count: number): string =>
  `За новым последним кадром останутся ключи (${count}). Они будут удалены. Продолжить?`

let activeEditorGuard: (() => boolean) | null = null

export function hasUnsavedCpmAnimationChanges(): boolean {
  return activeEditorGuard?.() ?? false
}

export interface CpmAnimationEditorSource {
  data: ShallowRef<CPMData | null>
  projectBytes: Ref<Uint8Array | null>
  bridge: CpmEditorBridge
  isPlaybackLooped?: Ref<boolean>
}

export interface CpmAnimationEditorApi {
  isEditing: Ref<boolean>
  isDirty: ComputedRef<boolean>
  animation: ComputedRef<CPMAnimation | null>
  animationData: ComputedRef<EditorAnimationData | null>
  activeAnimations: ComputedRef<ActiveCpmAnimation[]>
  kindLabel: ComputedRef<string>
  vanillaPoseIndex: ComputedRef<number | null>
  vanillaPoseHint: ComputedRef<string | null>
  isPreviewEnabled: Ref<boolean>
  saveErrors: ComputedRef<string[]>
  saveWarnings: ComputedRef<string[]>
  frameCount: ComputedRef<number>
  currentFrame: Ref<number>
  isPlaying: Ref<boolean>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  selectedBoneId: Ref<number | null>
  boneRows: ComputedRef<EditorBoneTreeRow[]>
  selectedBoneName: ComputedRef<string | null>
  selectedBonePose: ComputedRef<EditorPose | null>
  selectedBoneKeys: ComputedRef<number[]>
  isKeyAtCurrentFrame: ComputedRef<boolean>
  canAddKey: ComputedRef<boolean>
  canRemoveKey: ComputedRef<boolean>
  canCopyKey: ComputedRef<boolean>
  canPasteKey: ComputedRef<boolean>
  canMirrorPose: ComputedRef<boolean>
  canSmoothTrack: ComputedRef<boolean>
  canRevertBoneStep: ComputedRef<boolean>
  canJumpToPreviousKey: ComputedRef<boolean>
  canJumpToNextKey: ComputedRef<boolean>
  ghostBefore: Ref<number>
  ghostAfter: Ref<number>
  beadMode: Ref<EditorBeadMode>
  timeBeads: ComputedRef<EditorTimeBead[]>
  isSimpleMode: Ref<boolean>
  simpleFrames: ComputedRef<EditorSimpleFrame[]>
  editFrame: ComputedRef<number>
  rotationPivot: Ref<EditorRotationPivot>
  weight: ShallowRef<CpmProjectWeight | null>
  isWeightLoading: Ref<boolean>
  weightError: Ref<string>
  startEditing: (animationId?: string | null) => void
  stopEditing: () => Promise<boolean>
  confirmLeave: () => Promise<boolean>
  prepareSave: () => boolean
  markSaved: (snapshot?: string) => void
  refreshWeight: () => Promise<void>
  selectBone: (storeId: number | null) => void
  setBoneRotation: (axis: 'x' | 'y' | 'z', value: number) => void
  setBonePosition: (axis: 'x' | 'y' | 'z', value: number) => void
  setBoneVisible: (visible: boolean) => void
  setName: (name: string) => void
  setKind: (kind: CPMAnimationKind) => void
  setVanillaPose: (poseIndex: number) => void
  setDuration: (durationMs: number) => void
  setFrameCount: (frameCount: number) => Promise<boolean>
  insertFrame: () => void
  setLoop: (loop: boolean) => void
  setAdditive: (additive: boolean) => void
  setInterpolator: (interpolator: CPMAnimationInterpolator) => void
  setPriority: (priority: number) => void
  setOrder: (order: number) => void
  setGroup: (group: string) => void
  setMustFinish: (mustFinish: boolean) => void
  setCommand: (command: boolean) => void
  setHidden: (hidden: boolean) => void
  setPreviewEnabled: (enabled: boolean) => void
  deleteCurrentAnimation: () => Promise<boolean>
  setGhostFrames: (before: number, after: number) => void
  setBeadMode: (mode: EditorBeadMode) => void
  setSimpleMode: (enabled: boolean) => void
  goToSecond: (seconds: number) => void
  setRotationPivot: (pivot: EditorRotationPivot) => void
  beginBoneDrag: (storeId: number, frame: number) => void
  dragBoneRotation: (deltaYaw: number, deltaPitch: number, posOffset?: CPMVec3) => void
  dragBoneTranslation: (deltaX: number, deltaY: number, deltaZ: number) => void
  endBoneDrag: () => void
  beginBeadDrag: (fromFrame: number, toFrame: number) => void
  dragBead: (deltaFrames: number) => void
  endBeadDrag: () => void
  addKey: () => void
  removeKey: () => void
  copyKey: () => void
  pasteKey: () => void
  mirrorPose: () => void
  smoothTrack: () => void
  revertBoneStep: () => void
  insertPoseAtFraction: (fraction: number) => void
  togglePlayback: () => void
  setPlaying: (playing: boolean) => void
  stepFrame: (delta: number) => void
  goToFrame: (frame: number) => void
  jumpToKey: (direction: -1 | 1) => void
  undo: () => void
  redo: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

function isButtonLikeTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'A')
}

function createAnimationId(data: CPMData): string {
  const existing = new Set((data.animations ?? []).map((animation) => animation.id))
  let candidate = ''
  do {
    candidate = `${NEW_ANIMATION_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  } while (existing.has(candidate))
  return candidate
}

function createNewAnimation(data: CPMData): CPMAnimation {
  const taken = new Set(
    (data.animations ?? [])
      .filter((animation) => animation.kind === 'gesture')
      .map((animation) => animation.name.trim()),
  )
  let name = EDITOR_NEW_ANIMATION_NAME
  let counter = 2
  while (taken.has(name)) {
    name = `${EDITOR_NEW_ANIMATION_NAME} ${counter}`
    counter += 1
  }

  return {
    id: createAnimationId(data),
    name,
    kind: 'gesture',
    duration: 1000,
    priority: 0,
    loop: false,
    additive: false,
    interpolator: 'poly_loop',
    hidden: false,
    frames: Array.from({ length: EDITOR_DEFAULT_FRAME_COUNT }, (): CPMAnimationFrame => ({ components: [] })),
  }
}

function ensureAnimationFrames(animation: CPMAnimation): CPMAnimation {
  if (animation.frames.length > 0) return animation
  return {
    ...animation,
    frames: Array.from({ length: EDITOR_DEFAULT_FRAME_COUNT }, (): CPMAnimationFrame => ({ components: [] })),
  }
}

function frameFromElapsed(elapsed: number, animation: CPMAnimation, looping: boolean): number {
  const duration = Math.max(animation.duration, 1)
  if (elapsed >= duration && !looping) {
    return Math.max(0, animation.frames.length - 1)
  }
  return timeToFrame(elapsed, animation.frames.length, animation.duration)
}

interface BoneDragSession {
  kind: 'bone'
  baseHistory: EditorHistory
  baseState: EditorAnimationState
  storeId: number
  frame: number
  startPose: EditorPose
}

interface BeadDragSession {
  kind: 'bead'
  baseHistory: EditorHistory
  baseState: EditorAnimationState
  storeId: number
  fromFrame: number
  toFrame: number
  mode: EditorBeadMode
  delta: number
}

type EditorDragSession = BoneDragSession | BeadDragSession

const BONE_UNDO_LIMIT = 50

interface BoneUndoSnapshot {
  track: EditorBoneTrack | null
  frameCount: number
}

export function useCpmAnimationEditor(source: CpmAnimationEditorSource): CpmAnimationEditorApi {
  const notification = useNotificationStore()

  const isEditing = ref<boolean>(false)
  const isNew = ref<boolean>(false)
  const history = shallowRef<EditorHistory | null>(null)
  const savedSnapshot = ref<string>('')
  const selectedBoneId = ref<number | null>(null)
  const currentFrame = ref<number>(0)
  const isPlaying = ref<boolean>(false)
  const weight = shallowRef<CpmProjectWeight | null>(null)
  const isWeightLoading = ref<boolean>(false)
  const weightError = ref<string>('')
  const ghostBefore = ref<number>(GHOST_DEFAULT_BEFORE)
  const ghostAfter = ref<number>(GHOST_DEFAULT_AFTER)
  const beadMode = ref<EditorBeadMode>('single')
  const simpleMode = ref<boolean>(true)
  const rotationPivot = ref<EditorRotationPivot>('base')
  const isPreviewEnabled = ref<boolean>(true)
  const projectDirty = ref<boolean>(false)
  const copiedPose = shallowRef<EditorPose | null>(null)
  const boneUndo = shallowRef<Map<number, BoneUndoSnapshot[]>>(new Map())
  const fallbackPlaybackLooped = ref<boolean>(false)
  const playbackLooped = source.isPlaybackLooped ?? fallbackPlaybackLooped
  let dragSession: EditorDragSession | null = null

  let baselineAnimations: CPMAnimation[] = []
  let weightTimer: ReturnType<typeof setTimeout> | null = null
  let weightGeneration = 0
  let playbackTick = 0

  const currentState = computed((): EditorAnimationState | null =>
    history.value === null ? null : currentEditorState(history.value),
  )

  const animation = computed((): CPMAnimation | null =>
    currentState.value === null ? null : serializeEditorAnimation(currentState.value),
  )

  const animationData = computed((): EditorAnimationData | null => currentState.value?.data ?? null)

  const vanillaPoseIndex = computed((): number | null => animation.value?.poseIndex ?? null)

  const vanillaPoseHint = computed((): string | null => resolveVanillaPoseHint(vanillaPoseIndex.value))

  const frameCount = computed((): number => currentState.value?.model.frameCount ?? 0)

  const simpleFrames = computed((): EditorSimpleFrame[] =>
    buildSimpleFrames(frameCount.value, animation.value?.duration ?? 0),
  )

  const editFrame = computed((): number => {
    if (!simpleMode.value) return currentFrame.value
    return nearestSimpleFrame(currentFrame.value, frameCount.value, animation.value?.duration ?? 0)
  })

  const isDirty = computed((): boolean => {
    if (!isEditing.value) return false
    if (isNew.value) return true
    if (animation.value === null) return false
    return JSON.stringify(animation.value) !== savedSnapshot.value
  })

  const activeAnimations = computed((): ActiveCpmAnimation[] => {
    const current = animation.value
    if (!isEditing.value || current === null || !isPreviewEnabled.value) return []
    return [{ animation: current, startDelayMs: 0 }]
  })

  const kindLabel = computed((): string =>
    animation.value === null ? '' : EDITOR_KIND_LABELS[animation.value.kind],
  )

  const boneRows = computed((): EditorBoneTreeRow[] => {
    const data = source.data.value
    return data === null ? [] : flattenEditorBoneTree(buildEditorBoneTree(data.config))
  })

  const selectedBone = computed(() => {
    if (selectedBoneId.value === null || currentState.value === null) return null
    return currentState.value.index.bones.get(selectedBoneId.value) ?? null
  })

  const selectedBoneName = computed((): string | null => selectedBone.value?.name ?? null)

  const selectedBonePose = computed((): EditorPose | null => {
    if (currentState.value === null || selectedBone.value === null) return null
    return bonePoseAt(currentState.value, selectedBone.value, editFrame.value)
  })

  const selectedBoneKeys = computed((): number[] =>
    selectedBoneId.value === null
      ? []
      : [...(currentState.value?.model.bones.get(selectedBoneId.value)?.keys ?? [])].sort((a, b) => a - b),
  )

  const timeBeads = computed((): EditorTimeBead[] => buildTimeBeads(selectedBoneKeys.value))

  const isKeyAtCurrentFrame = computed((): boolean =>
    selectedBoneKeys.value.includes(editFrame.value),
  )

  const canAddKey = computed((): boolean => {
    if (currentState.value === null || selectedBoneId.value === null) return false
    if (isKeyAtCurrentFrame.value) return false
    return currentState.value.model.bones.has(selectedBoneId.value)
  })

  const canRemoveKey = computed((): boolean => isKeyAtCurrentFrame.value)

  const canCopyKey = computed((): boolean => isKeyAtCurrentFrame.value)

  const canPasteKey = computed((): boolean =>
    copiedPose.value !== null && selectedBoneId.value !== null,
  )

  const canMirrorPose = computed((): boolean =>
    selectedBoneId.value !== null
    && (currentState.value?.model.bones.has(selectedBoneId.value) ?? false),
  )

  const canSmoothTrack = computed((): boolean => selectedBoneKeys.value.length >= 3)

  const canRevertBoneStep = computed((): boolean => {
    if (selectedBoneId.value === null) return false
    const stack = boneUndo.value.get(selectedBoneId.value)
    const snapshot = stack?.[stack.length - 1]
    return snapshot !== undefined && snapshot.frameCount === frameCount.value
  })

  const canJumpToPreviousKey = computed((): boolean =>
    previousKeyFrame(selectedBoneKeys.value, currentFrame.value) !== null,
  )

  const canJumpToNextKey = computed((): boolean =>
    nextKeyFrame(selectedBoneKeys.value, currentFrame.value) !== null,
  )

  const saveErrors = computed((): string[] => {
    const current = animation.value
    const data = source.data.value
    if (!isEditing.value || current === null || data === null) return []

    const others = (data.animations ?? []).filter((item) => item.id !== current.id)
    const result = validateAnimationDraft(
      { id: current.id, name: current.name, kind: current.kind, poseIndex: current.poseIndex },
      { animations: others, animEnc: data.animEnc ?? null, isNew: isNew.value },
    )
    const errors = [...result.errors]
    if ((currentState.value?.model.bones.size ?? 0) === 0) errors.push(EMPTY_ANIMATION_MESSAGE)
    return errors
  })

  const saveWarnings = computed((): string[] => {
    const current = animation.value
    const data = source.data.value
    if (!isEditing.value || current === null || data === null) return []
    const result = validateAnimationDraft(
      { id: current.id, name: current.name, kind: current.kind, poseIndex: current.poseIndex },
      { animations: (data.animations ?? []).filter((item) => item.id !== current.id), animEnc: data.animEnc ?? null, isNew: isNew.value },
    )
    const warnings = [...result.warnings]
    if (currentState.value !== null && hasMechanicalLinearTransition(currentState.value)) {
      warnings.push(EDITOR_LINEAR_WARNING)
    }
    return warnings
  })

  const canUndo = computed((): boolean =>
    history.value === null ? false : canUndoEditorHistory(history.value),
  )

  const canRedo = computed((): boolean =>
    history.value === null ? false : canRedoEditorHistory(history.value),
  )

  function syncPlayhead(): void {
    const current = animation.value
    if (current === null || current.frames.length === 0) return
    source.bridge.seekFrame(currentFrame.value, current.frames.length, current.duration)
  }

  function syncToData(): void {
    const data = source.data.value
    const current = animation.value
    if (data === null || current === null) return

    const animations = [...(data.animations ?? [])]
    const index = animations.findIndex((item) => item.id === current.id)
    if (index >= 0) animations[index] = current
    else animations.push(current)
    source.data.value = { ...data, animations }
  }

  function clearWeightTimer(): void {
    if (weightTimer !== null) {
      clearTimeout(weightTimer)
      weightTimer = null
    }
  }

  async function refreshWeight(): Promise<void> {
    const data = source.data.value
    const bytes = source.projectBytes.value
    if (data === null || bytes === null) {
      weight.value = null
      return
    }

    const generation = ++weightGeneration
    isWeightLoading.value = true
    weightError.value = ''
    try {
      const result = await measureCpmProjectWeight(bytes, {
        animations: data.animations ?? [],
        animEnc: data.animEnc ?? null,
      })
      if (generation !== weightGeneration) return
      weight.value = result
    } catch (e: unknown) {
      if (generation !== weightGeneration) return
      weight.value = null
      weightError.value = WEIGHT_ERROR_MESSAGE
      reportError(WEIGHT_ERROR_MESSAGE, e)
    } finally {
      if (generation === weightGeneration) isWeightLoading.value = false
    }
  }

  function scheduleWeight(): void {
    clearWeightTimer()
    weightTimer = setTimeout((): void => {
      weightTimer = null
      void refreshWeight()
    }, WEIGHT_DEBOUNCE_MS)
  }

  function clearBoneUndo(): void {
    boneUndo.value = new Map()
  }

  function pushBoneUndo(state: EditorAnimationState, storeId: number): void {
    const track = state.model.bones.get(storeId)
    const snapshot: BoneUndoSnapshot = {
      track: track === undefined ? null : cloneBoneTrack(track),
      frameCount: state.model.frameCount,
    }
    const next = new Map(boneUndo.value)
    const stack = [...(next.get(storeId) ?? []), snapshot]
    if (stack.length > BONE_UNDO_LIMIT) stack.splice(0, stack.length - BONE_UNDO_LIMIT)
    next.set(storeId, stack)
    boneUndo.value = next
  }

  function popBoneUndo(storeId: number): BoneUndoSnapshot | null {
    const stack = boneUndo.value.get(storeId)
    if (stack === undefined || stack.length === 0) return null
    const next = new Map(boneUndo.value)
    const rest = [...stack]
    const snapshot = rest.pop() ?? null
    next.set(storeId, rest)
    boneUndo.value = next
    return snapshot
  }

  function captureBoneUndo(next: EditorAnimationState): void {
    const current = currentState.value
    const storeId = selectedBoneId.value
    if (current === null || storeId === null) return
    if (current.model.frameCount !== next.model.frameCount) {
      clearBoneUndo()
      return
    }
    const before = current.model.bones.get(storeId) ?? null
    const after = next.model.bones.get(storeId) ?? null
    if (boneTracksEqual(before, after)) return
    pushBoneUndo(current, storeId)
  }

  function discardUnchangedBoneUndo(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    const stack = boneUndo.value.get(storeId)
    const snapshot = stack?.[stack.length - 1]
    if (snapshot === undefined) return
    const current = state.model.bones.get(storeId) ?? null
    if (snapshot.frameCount === state.model.frameCount && boneTracksEqual(snapshot.track, current)) {
      popBoneUndo(storeId)
    }
  }

  function commit(next: EditorAnimationState | null, label: string, recordUndo = true): void {
    const current = history.value
    if (next === null || current === null) return
    if (recordUndo) captureBoneUndo(next)
    history.value = commitEditorHistory(current, next, label)
    syncToData()
    scheduleWeight()
    syncPlayhead()
  }

  function previewHistory(
    baseHistory: EditorHistory,
    next: EditorAnimationState | null,
    label: string,
  ): void {
    history.value = next === null ? baseHistory : commitEditorHistory(baseHistory, next, label)
    syncToData()
    syncPlayhead()
  }

  function afterHistoryMove(): void {
    syncToData()
    scheduleWeight()
    syncPlayhead()
  }

  function selectBone(storeId: number | null): void {
    if (storeId !== null && !(currentState.value?.index.bones.has(storeId) ?? false)) return
    selectedBoneId.value = storeId
  }

  function alignEditFrame(): number {
    const frame = editFrame.value
    if (currentFrame.value !== frame) {
      currentFrame.value = frame
      syncPlayhead()
    }
    return frame
  }

  function applyBonePose(mutate: (pose: EditorPose) => void, label: string): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    const bone = state.index.bones.get(storeId)
    if (bone === undefined) return

    const frame = alignEditFrame()
    const pose = bonePoseAt(state, bone, frame)
    mutate(pose)
    commit(setBonePose(state, storeId, frame, pose), label)
  }

  function setBoneRotation(axis: 'x' | 'y' | 'z', value: number): void {
    if (!Number.isFinite(value)) return
    applyBonePose((pose): void => {
      pose.rotation[axis] = value
    }, 'Поворот кости')
  }

  function setBonePosition(axis: 'x' | 'y' | 'z', value: number): void {
    if (!Number.isFinite(value)) return
    applyBonePose((pose): void => {
      pose.pos[axis] = value
    }, 'Смещение кости')
  }

  function setBoneVisible(visible: boolean): void {
    applyBonePose((pose): void => {
      pose.show = visible
    }, 'Видимость кости')
  }

  function setGhostFrames(before: number, after: number): void {
    ghostBefore.value = clampGhostCount(before)
    ghostAfter.value = clampGhostCount(after)
  }

  function setBeadMode(mode: EditorBeadMode): void {
    if (mode !== 'single' && mode !== 'proportional') return
    beadMode.value = mode
  }

  function setSimpleMode(enabled: boolean): void {
    if (simpleMode.value === enabled) return
    simpleMode.value = enabled
    if (!enabled) return
    if (isPlaying.value) pausePlayback()
    currentFrame.value = nearestSimpleFrame(
      currentFrame.value,
      frameCount.value,
      animation.value?.duration ?? 0,
    )
    syncPlayhead()
  }

  function goToSecond(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    goToFrame(secondsToEditorFrame(seconds, frameCount.value, animation.value?.duration ?? 0))
  }

  function setRotationPivot(pivot: EditorRotationPivot): void {
    if (pivot !== 'base' && pivot !== 'tip') return
    rotationPivot.value = pivot
  }

  function beginBoneDrag(storeId: number, frame: number): void {
    const current = history.value
    const state = currentState.value
    if (current === null || state === null) return
    const bone = state.index.bones.get(storeId)
    if (!bone) return
    const targetFrame = simpleMode.value
      ? nearestSimpleFrame(frame, state.model.frameCount, state.data.duration)
      : frame
    if (!Number.isInteger(targetFrame) || targetFrame < 0 || targetFrame >= state.model.frameCount) return

    pushBoneUndo(state, storeId)
    goToFrame(targetFrame)
    dragSession = {
      kind: 'bone',
      baseHistory: current,
      baseState: state,
      storeId,
      frame: targetFrame,
      startPose: bonePoseAt(state, bone, targetFrame),
    }
  }

  function dragBoneRotation(deltaYaw: number, deltaPitch: number, posOffset?: CPMVec3): void {
    const session = dragSession
    if (session === null || session.kind !== 'bone') return
    if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) return

    const start = session.startPose
    const offset = posOffset ?? { x: 0, y: 0, z: 0 }
    const next = setBonePose(session.baseState, session.storeId, session.frame, {
      rotation: {
        x: normalizeAngle(start.rotation.x + deltaPitch),
        y: normalizeAngle(start.rotation.y + deltaYaw),
        z: start.rotation.z,
      },
      pos: {
        x: start.pos.x + offset.x,
        y: start.pos.y + offset.y,
        z: start.pos.z + offset.z,
      },
      show: start.show,
    })
    previewHistory(session.baseHistory, next, 'Поворот кости')
  }

  function dragBoneTranslation(deltaX: number, deltaY: number, deltaZ: number): void {
    const session = dragSession
    if (session === null || session.kind !== 'bone') return
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(deltaZ)) return

    const start = session.startPose
    const next = setBonePose(session.baseState, session.storeId, session.frame, {
      rotation: { ...start.rotation },
      pos: {
        x: start.pos.x + deltaX,
        y: start.pos.y + deltaY,
        z: start.pos.z + deltaZ,
      },
      show: start.show,
    })
    previewHistory(session.baseHistory, next, 'Смещение кости')
  }

  function endBoneDrag(): void {
    if (dragSession === null || dragSession.kind !== 'bone') return
    discardUnchangedBoneUndo()
    dragSession = null
    scheduleWeight()
  }

  function beginBeadDrag(fromFrame: number, toFrame: number): void {
    const current = history.value
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (current === null || state === null || storeId === null) return
    const track = state.model.bones.get(storeId)
    if (!track || !track.keys.includes(fromFrame) || !track.keys.includes(toFrame)) return
    if (toFrame <= fromFrame) return

    pushBoneUndo(state, storeId)
    dragSession = {
      kind: 'bead',
      baseHistory: current,
      baseState: state,
      storeId,
      fromFrame,
      toFrame,
      mode: beadMode.value,
      delta: 0,
    }
  }

  function dragBead(deltaFrames: number): void {
    const session = dragSession
    if (session === null || session.kind !== 'bead') return

    const keys = session.baseState.model.bones.get(session.storeId)?.keys ?? []
    const nextKey = nextKeyFrame(keys, session.toFrame)
    const delta = clampBeadDelta(
      deltaFrames,
      session.fromFrame,
      session.toFrame,
      nextKey ?? session.baseState.model.frameCount,
    )
    if (delta === session.delta) return
    session.delta = delta

    const next = session.mode === 'single'
      ? moveBoneKey(session.baseState, session.storeId, session.toFrame, session.toFrame + delta)
      : shiftKeysProportionally(
        session.baseState,
        session.storeId,
        session.fromFrame,
        session.toFrame,
        delta,
      )
    previewHistory(
      session.baseHistory,
      next,
      session.mode === 'single' ? 'Сдвиг ключа' : 'Сдвиг ключей',
    )
  }

  function endBeadDrag(): void {
    if (dragSession === null || dragSession.kind !== 'bead') return
    discardUnchangedBoneUndo()
    dragSession = null
    scheduleWeight()
  }

  function setName(name: string): void {
    const state = currentState.value
    if (state === null || state.data.kind === 'vanilla-pose') return
    commit(updateAnimationData(state, { name: name.trim() }), 'Имя анимации')
  }

  function setKind(kind: CPMAnimationKind): void {
    const state = currentState.value
    if (state === null) return
    const next = changeAnimationKind(state, kind)
    if (next === null) return
    commit(next, 'Триггер анимации')
    if (kind !== 'vanilla-pose' && !isPreviewEnabled.value) setPreviewEnabled(true)
  }

  function setVanillaPose(poseIndex: number): void {
    const state = currentState.value
    if (state === null) return
    const next = changeAnimationPose(state, poseIndex)
    if (next === null) return
    commit(next, 'Ванильная поза')
  }

  function setDuration(durationMs: number): void {
    const state = currentState.value
    if (state === null || !Number.isFinite(durationMs)) return
    commit(
      updateAnimationData(state, { duration: normalizeEditorDuration(durationMs) }),
      'Длительность анимации',
    )
    if (simpleMode.value) {
      currentFrame.value = nearestSimpleFrame(
        currentFrame.value,
        frameCount.value,
        animation.value?.duration ?? 0,
      )
    }
  }

  async function setFrameCount(value: number): Promise<boolean> {
    const state = currentState.value
    if (state === null || !Number.isFinite(value)) return false

    const target = normalizeEditorFrameCount(value)
    if (target === state.model.frameCount) return true

    if (target < state.model.frameCount) {
      const lostKeys = countEditorKeysBeyond(state, target)
      if (lostKeys > 0) {
        const confirmed = await notification.confirm(frameTrimMessage(lostKeys))
        if (!confirmed) return false
      }
    }

    const resized = resizeEditorModel(state, target)
    if (resized === null) return true

    const duration = scaleEditorDuration(state.data.duration, state.model.frameCount, target)
    currentFrame.value = clampFrame(currentFrame.value, target)
    commit({ ...resized, data: { ...resized.data, duration } }, 'Количество кадров')
    if (simpleMode.value) {
      currentFrame.value = nearestSimpleFrame(
        currentFrame.value,
        frameCount.value,
        animation.value?.duration ?? 0,
      )
    }
    return true
  }

  function insertFrame(): void {
    const state = currentState.value
    if (state === null) return
    const next = insertEditorFrame(state)
    if (next === null) return
    currentFrame.value = clampFrame(currentFrame.value, next.model.frameCount)
    commit(next, 'Вставка кадра')
    if (simpleMode.value) {
      currentFrame.value = nearestSimpleFrame(
        currentFrame.value,
        frameCount.value,
        animation.value?.duration ?? 0,
      )
    }
  }

  function setLoop(loop: boolean): void {
    const state = currentState.value
    if (state === null || state.data.kind !== 'gesture') return
    commit(updateAnimationData(state, { loop }), 'Зацикливание')
  }

  function setAdditive(additive: boolean): void {
    const state = currentState.value
    if (state === null) return
    commit(updateAnimationData(state, { additive }), 'Аддитивность')
  }

  function setInterpolator(interpolator: CPMAnimationInterpolator): void {
    const state = currentState.value
    if (state === null) return
    commit(updateAnimationData(state, { interpolator }), 'Интерполятор')
  }

  function setPriority(priority: number): void {
    const state = currentState.value
    if (state === null || !Number.isFinite(priority)) return
    commit(
      updateAnimationData(state, { priority: normalizeEditorPriority(priority) }),
      'Приоритет анимации',
    )
  }

  function setOrder(order: number): void {
    const state = currentState.value
    if (state === null || !Number.isFinite(order)) return
    commit(updateAnimationData(state, { order: normalizeEditorOrder(order) }), 'Порядок анимации')
  }

  function setGroup(group: string): void {
    const state = currentState.value
    if (state === null) return
    const trimmed = group.trim()
    commit(
      updateAnimationData(state, { group: trimmed === '' ? null : trimmed }),
      'Группа анимации',
    )
  }

  function setMustFinish(mustFinish: boolean): void {
    const state = currentState.value
    if (state === null) return
    commit(updateAnimationData(state, { mustFinish }), 'Завершение анимации')
  }

  function setCommand(command: boolean): void {
    const state = currentState.value
    if (state === null) return
    commit(updateAnimationData(state, { command }), 'Признак команды')
  }

  function setHidden(hidden: boolean): void {
    const state = currentState.value
    if (state === null) return
    commit(updateAnimationData(state, { hidden }), 'Видимость анимации')
  }

  function setPreviewEnabled(enabled: boolean): void {
    if (isPreviewEnabled.value === enabled) return
    isPreviewEnabled.value = enabled
    if (!enabled) {
      isPlaying.value = false
      stopPlaybackTick()
      return
    }
    void nextTick(syncPlayhead)
  }

  function addKey(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    commit(addBoneKey(state, storeId, alignEditFrame()), 'Ключ кости')
  }

  function removeKey(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    commit(eraseBoneKey(state, storeId, alignEditFrame()), 'Удаление ключа')
  }

  function copyKey(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null || !isKeyAtCurrentFrame.value) return
    const bone = state.index.bones.get(storeId)
    if (bone === undefined) return
    copiedPose.value = bonePoseAt(state, bone, alignEditFrame())
  }

  function pasteKey(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    const pose = copiedPose.value
    if (state === null || storeId === null || pose === null) return
    commit(setBonePose(state, storeId, alignEditFrame(), pose), 'Вставка ключа')
  }

  function mirrorPose(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    commit(mirrorBonePose(state, storeId, alignEditFrame()), 'Зеркалирование позы')
  }

  function smoothTrack(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return
    commit(smoothBoneTrack(state, storeId), 'Сглаживание кости')
  }

  function revertBoneStep(): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null) return

    const snapshot = popBoneUndo(storeId)
    if (snapshot === null) return
    if (snapshot.frameCount !== state.model.frameCount) {
      clearBoneUndo()
      return
    }

    commit(restoreBoneTrack(state, storeId, snapshot.track), 'Возврат кости на шаг назад', false)
  }

  function insertPoseAtFraction(fraction: number): void {
    const state = currentState.value
    const storeId = selectedBoneId.value
    if (state === null || storeId === null || !Number.isFinite(fraction)) return

    const frame = alignEditFrame()
    const keys = selectedBoneKeys.value
    const fromFrame = isKeyAtCurrentFrame.value ? frame : previousKeyFrame(keys, frame)
    const toFrame = nextKeyFrame(keys, frame)
    if (fromFrame === null || toFrame === null || toFrame <= fromFrame) return

    commit(
      insertPoseAtFractionOp(state, storeId, fromFrame, toFrame, fraction),
      'Поза в долю пути',
    )
  }

  function undo(): void {
    dragSession = null
    clearBoneUndo()
    const current = history.value
    if (current === null) return
    history.value = undoEditorHistory(current)
    afterHistoryMove()
  }

  function redo(): void {
    dragSession = null
    clearBoneUndo()
    const current = history.value
    if (current === null) return
    history.value = redoEditorHistory(current)
    afterHistoryMove()
  }

  function stopPlaybackTick(): void {
    if (playbackTick !== 0) {
      cancelAnimationFrame(playbackTick)
      playbackTick = 0
    }
  }

  function startPlaybackTick(): void {
    if (playbackTick !== 0) return
    const tick = (): void => {
      playbackTick = 0
      const current = animation.value
      const player = source.bridge.player.value
      if (!isPlaying.value || current === null || player === null) return
      currentFrame.value = frameFromElapsed(
        player.elapsedOf(current.id),
        current,
        current.loop || playbackLooped.value,
      )
      playbackTick = requestAnimationFrame(tick)
    }
    playbackTick = requestAnimationFrame(tick)
  }

  function pausePlayback(): void {
    const current = animation.value
    const player = source.bridge.player.value
    if (current !== null && player !== null) {
      currentFrame.value = frameFromElapsed(
        player.elapsedOf(current.id),
        current,
        current.loop || playbackLooped.value,
      )
    }
    isPlaying.value = false
    syncPlayhead()
  }

  function togglePlayback(): void {
    if (!isEditing.value || animation.value === null) return
    if (isPlaying.value) {
      pausePlayback()
      return
    }
    if (!isPreviewEnabled.value) setPreviewEnabled(true)
    isPlaying.value = true
  }

  function setPlaying(playing: boolean): void {
    if (playing) {
      isPlaying.value = true
      return
    }
    if (isPlaying.value) pausePlayback()
  }

  function goToFrame(frame: number): void {
    if (!isEditing.value) return
    if (isPlaying.value) pausePlayback()
    const target = simpleMode.value
      ? nearestSimpleFrame(frame, frameCount.value, animation.value?.duration ?? 0)
      : frame
    currentFrame.value = clampFrame(target, frameCount.value)
    syncPlayhead()
  }

  function stepFrame(delta: number): void {
    if (delta === 0) return
    if (simpleMode.value) {
      const target = stepSimpleFrame(
        currentFrame.value,
        delta < 0 ? -1 : 1,
        simpleFrames.value,
      )
      if (target !== null) goToFrame(target)
      return
    }
    goToFrame(currentFrame.value + delta)
  }

  function jumpToKey(direction: -1 | 1): void {
    const frame = editFrame.value
    const target = direction < 0
      ? previousKeyFrame(selectedBoneKeys.value, frame)
      : nextKeyFrame(selectedBoneKeys.value, frame)
    if (target === null) return
    goToFrame(target)
  }

  function startEditing(animationId: string | null = null): void {
    const data = source.data.value
    if (data === null || isEditing.value) return
    if (animationId === null && (data.animations ?? []).length >= EDITOR_MAX_ANIMATIONS) {
      notification.show(ANIMATION_LIMIT_MESSAGE)
      return
    }

    baselineAnimations = [...(data.animations ?? [])]
    const existing = animationId === null
      ? undefined
      : baselineAnimations.find((item) => item.id === animationId)
    const initial = ensureAnimationFrames(existing ?? createNewAnimation(data))
    const index = buildEditorBoneIndex(data.config)
    const state = buildEditorState(initial, index)
    const tree = buildEditorBoneTree(data.config)

    isNew.value = existing === undefined
    savedSnapshot.value = existing === undefined
      ? ''
      : JSON.stringify(serializeEditorAnimation(state))
    clearBoneUndo()
    history.value = createEditorHistory(state, existing === undefined ? 'Новая анимация' : 'Открытие анимации')
    selectedBoneId.value = firstAnimatableBoneId(tree)
    currentFrame.value = 0
    isEditing.value = true
    isPlaying.value = false
    isPreviewEnabled.value = true
    syncToData()
    scheduleWeight()
    void nextTick(syncPlayhead)
  }

  function discardChanges(): void {
    const data = source.data.value
    if (data === null) return
    source.data.value = { ...data, animations: baselineAnimations }
  }

  function endSession(): void {
    stopPlaybackTick()
    clearWeightTimer()
    clearBoneUndo()
    dragSession = null
    isEditing.value = false
    isPlaying.value = false
    history.value = null
    selectedBoneId.value = null
    currentFrame.value = 0
    isNew.value = false
    savedSnapshot.value = ''
  }

  async function stopEditing(): Promise<boolean> {
    if (!isEditing.value) return true
    if (isDirty.value) {
      const confirmed = await notification.confirm(DIRTY_EXIT_MESSAGE)
      if (!confirmed) return false
      discardChanges()
    }
    endSession()
    void refreshWeight()
    return true
  }

  function restoreProject(): void {
    const data = source.data.value
    if (data === null) return
    source.data.value = { ...data, animations: baselineAnimations }
    projectDirty.value = false
    void refreshWeight()
  }

  async function deleteCurrentAnimation(): Promise<boolean> {
    if (!isEditing.value) return false
    const current = animation.value
    const data = source.data.value
    if (current === null || data === null) return false

    const confirmed = await notification.confirm(`Удалить анимацию «${current.name}»?`)
    if (!confirmed) return false

    source.data.value = {
      ...data,
      animations: (data.animations ?? []).filter((item) => item.id !== current.id),
    }
    projectDirty.value = true
    endSession()
    void refreshWeight()
    return true
  }

  async function confirmLeave(): Promise<boolean> {
    if (isEditing.value) return stopEditing()
    if (!projectDirty.value) return true

    const confirmed = await notification.confirm(DIRTY_PROJECT_EXIT_MESSAGE)
    if (!confirmed) return false
    restoreProject()
    return true
  }

  function prepareSave(): boolean {
    if (!isEditing.value) return true
    const [firstError] = saveErrors.value
    if (firstError !== undefined) {
      notification.show(firstError)
      return false
    }
    syncToData()
    return true
  }

  function markSaved(snapshot?: string): void {
    const data = source.data.value
    if (isEditing.value) {
      const current = animation.value
      if (current === null) return
      const currentJson = JSON.stringify(current)
      if (snapshot !== undefined && currentJson !== snapshot) return
      isNew.value = false
      savedSnapshot.value = currentJson
    }
    if (data !== null) baselineAnimations = [...(data.animations ?? [])]
    projectDirty.value = false
    scheduleWeight()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!isEditing.value || isEditableTarget(event.target)) return

    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
      return
    }
    if (modifier || event.altKey) return

    if (event.code === 'Space') {
      if (isButtonLikeTarget(event.target)) return
      event.preventDefault()
      togglePlayback()
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      stepFrame(-1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      stepFrame(1)
    }
  }

  watch(isPlaying, (playing: boolean): void => {
    if (playing) startPlaybackTick()
    else stopPlaybackTick()
  })

  watch(
    (): string | null => source.data.value?.textureUrl ?? null,
    (url: string | null, previous: string | null | undefined): void => {
      if (previous !== undefined && url !== previous && isEditing.value) {
        endSession()
        return
      }
      if (!isEditing.value) void refreshWeight()
    },
    { immediate: true },
  )

  const guard = (): boolean => (isEditing.value && isDirty.value) || projectDirty.value
  activeEditorGuard = guard

  window.addEventListener('keydown', handleKeydown)

  onScopeDispose((): void => {
    if (activeEditorGuard === guard) activeEditorGuard = null
    window.removeEventListener('keydown', handleKeydown)
    stopPlaybackTick()
    clearWeightTimer()
  })

  return {
    isEditing,
    isDirty,
    animation,
    animationData,
    activeAnimations,
    kindLabel,
    vanillaPoseIndex,
    vanillaPoseHint,
    isPreviewEnabled,
    saveErrors,
    saveWarnings,
    frameCount,
    currentFrame,
    isPlaying,
    canUndo,
    canRedo,
    selectedBoneId,
    boneRows,
    selectedBoneName,
    selectedBonePose,
    selectedBoneKeys,
    isKeyAtCurrentFrame,
    canAddKey,
    canRemoveKey,
    canCopyKey,
    canPasteKey,
    canMirrorPose,
    canSmoothTrack,
    canRevertBoneStep,
    canJumpToPreviousKey,
    canJumpToNextKey,
    ghostBefore,
    ghostAfter,
    beadMode,
    timeBeads,
    isSimpleMode: simpleMode,
    simpleFrames,
    editFrame,
    rotationPivot,
    weight,
    isWeightLoading,
    weightError,
    startEditing,
    stopEditing,
    confirmLeave,
    prepareSave,
    markSaved,
    refreshWeight,
    selectBone,
    setBoneRotation,
    setBonePosition,
    setBoneVisible,
    setName,
    setKind,
    setVanillaPose,
    setDuration,
    setFrameCount,
    insertFrame,
    setLoop,
    setAdditive,
    setInterpolator,
    setPriority,
    setOrder,
    setGroup,
    setMustFinish,
    setCommand,
    setHidden,
    setPreviewEnabled,
    deleteCurrentAnimation,
    setGhostFrames,
    setBeadMode,
    setSimpleMode,
    goToSecond,
    setRotationPivot,
    beginBoneDrag,
    dragBoneRotation,
    dragBoneTranslation,
    endBoneDrag,
    beginBeadDrag,
    dragBead,
    endBeadDrag,
    addKey,
    removeKey,
    copyKey,
    pasteKey,
    mirrorPose,
    smoothTrack,
    revertBoneStep,
    insertPoseAtFraction,
    togglePlayback,
    setPlaying,
    stepFrame,
    goToFrame,
    jumpToKey,
    undo,
    redo,
  }
}
