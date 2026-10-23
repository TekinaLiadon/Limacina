import {
  EDITOR_QUANTIZATION_EPSILON,
  type EditorAnimationData,
  type EditorAnimationState,
  type EditorBoneFrame,
  type EditorBoneInfo,
  type EditorBoneTrack,
  type EditorPose,
} from './types'
import {
  bonePoseAt,
  createRestFrame,
  normalizeAngle,
  resolveBoneRest,
  shortestAngleDelta,
} from './editorModel'
import { vanillaPoseName } from './editorTriggers'
import { EDITOR_SIMPLE_STEP_MS } from './editorTimeline'
import {
  copyFrameData,
  copyPose,
  poseFromFrame,
  refillTrack,
  refreshTrackFrames,
  resetFrame,
  sortedKeys,
} from './editorInterpolation'

function isFrameInRange(frameCount: number, frame: number): boolean {
  return Number.isInteger(frame) && frame >= 0 && frame < frameCount
}

function cloneFrame(frame: EditorBoneFrame): EditorBoneFrame {
  return {
    rotation: { ...frame.rotation },
    pos: { ...frame.pos },
    show: frame.show,
    scale: { ...frame.scale },
    color: frame.color,
  }
}

export function cloneBoneTrack(track: EditorBoneTrack): EditorBoneTrack {
  return {
    storeId: track.storeId,
    frames: track.frames.map(cloneFrame),
    keys: [...track.keys],
  }
}

export function boneTracksEqual(
  first: EditorBoneTrack | null,
  second: EditorBoneTrack | null,
): boolean {
  if (first === null || second === null) return first === second
  if (first.storeId !== second.storeId) return false
  if (first.frames.length !== second.frames.length) return false
  if (first.keys.length !== second.keys.length) return false

  for (let index = 0; index < first.keys.length; index++) {
    if (first.keys[index] !== second.keys[index]) return false
  }

  for (let index = 0; index < first.frames.length; index++) {
    const left = first.frames[index]
    const right = second.frames[index]
    if (!left || !right) return false
    if (left.rotation.x !== right.rotation.x
      || left.rotation.y !== right.rotation.y
      || left.rotation.z !== right.rotation.z) return false
    if (left.pos.x !== right.pos.x
      || left.pos.y !== right.pos.y
      || left.pos.z !== right.pos.z) return false
    if (left.show !== right.show) return false
    if (left.scale.x !== right.scale.x
      || left.scale.y !== right.scale.y
      || left.scale.z !== right.scale.z) return false
    if (left.color !== right.color) return false
  }

  return true
}

export function restoreBoneTrack(
  state: EditorAnimationState,
  storeId: number,
  track: EditorBoneTrack | null,
): EditorAnimationState | null {
  if (!state.index.bones.has(storeId)) return null
  const bones = new Map(state.model.bones)
  if (track === null) bones.delete(storeId)
  else bones.set(storeId, cloneBoneTrack(track))
  return { ...state, model: { ...state.model, bones } }
}

function addKey(keys: number[], frame: number): number[] {
  if (keys.includes(frame)) return [...keys]
  return [...keys, frame].sort((a, b) => a - b)
}

function normalizePose(pose: EditorPose): EditorPose {
  return {
    rotation: {
      x: normalizeAngle(pose.rotation.x),
      y: normalizeAngle(pose.rotation.y),
      z: normalizeAngle(pose.rotation.z),
    },
    pos: { ...pose.pos },
    show: pose.show,
  }
}

function snapValue(value: number, restValue: number): number {
  return Math.abs(value - restValue) <= EDITOR_QUANTIZATION_EPSILON ? restValue : value
}

function snapAngle(value: number, restValue: number): number {
  return Math.abs(shortestAngleDelta(restValue, value)) <= EDITOR_QUANTIZATION_EPSILON
    ? restValue
    : normalizeAngle(value)
}

function snapPose(pose: EditorPose, rest: EditorPose): EditorPose {
  return {
    rotation: {
      x: snapAngle(pose.rotation.x, rest.rotation.x),
      y: snapAngle(pose.rotation.y, rest.rotation.y),
      z: snapAngle(pose.rotation.z, rest.rotation.z),
    },
    pos: {
      x: snapValue(pose.pos.x, rest.pos.x),
      y: snapValue(pose.pos.y, rest.pos.y),
      z: snapValue(pose.pos.z, rest.pos.z),
    },
    show: pose.show,
  }
}

function poseEquals(first: EditorPose, second: EditorPose): boolean {
  return first.show === second.show
    && first.rotation.x === second.rotation.x
    && first.rotation.y === second.rotation.y
    && first.rotation.z === second.rotation.z
    && first.pos.x === second.pos.x
    && first.pos.y === second.pos.y
    && first.pos.z === second.pos.z
}

function ensureTrack(state: EditorAnimationState, bone: EditorBoneInfo): EditorBoneTrack {
  const existing = state.model.bones.get(bone.storeId)
  if (existing) return cloneBoneTrack(existing)

  const rest = resolveBoneRest(bone, state.data.additive)
  return {
    storeId: bone.storeId,
    frames: Array.from({ length: state.model.frameCount }, () => createRestFrame(rest)),
    keys: [],
  }
}

function commitTrack(
  state: EditorAnimationState,
  track: EditorBoneTrack,
): EditorAnimationState {
  const bones = new Map(state.model.bones)
  if (track.keys.length === 0) bones.delete(track.storeId)
  else bones.set(track.storeId, track)
  return { ...state, model: { ...state.model, bones } }
}

function findTrack(
  state: EditorAnimationState,
  storeId: number,
): { bone: EditorBoneInfo; track: EditorBoneTrack } | null {
  const bone = state.index.bones.get(storeId)
  const track = state.model.bones.get(storeId)
  if (!bone || !track) return null
  return { bone, track }
}

function insertKeyWithPose(
  state: EditorAnimationState,
  bone: EditorBoneInfo,
  frame: number,
  pose: EditorPose,
): EditorAnimationState | null {
  const rest = resolveBoneRest(bone, state.data.additive)
  const track = ensureTrack(state, bone)
  const target = track.frames[frame]
  if (!target) return null

  const snapped = snapPose(normalizePose(pose), rest)
  if (track.keys.includes(frame) && poseEquals(target, snapped)) return null

  copyPose(target, snapped)
  track.keys = addKey(track.keys, frame)
  refreshTrackFrames(track, [frame], rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, track)
}

export function ensureBoundaryKeys(
  state: EditorAnimationState,
  storeId: number,
  frame: number,
  boundaries: readonly number[],
): EditorAnimationState | null {
  const bone = state.index.bones.get(storeId)
  if (!bone) return null

  const position = boundaries.indexOf(frame)
  if (position < 0) return null

  const keySet = new Set(state.model.bones.get(storeId)?.keys ?? [])
  const candidates: (number | undefined)[] = [boundaries[position - 1]]
  if (!state.holdLastPose) candidates.push(boundaries[position + 1])
  const targets: number[] = []
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    if (!isFrameInRange(state.model.frameCount, candidate)) continue
    if (keySet.has(candidate)) continue
    targets.push(candidate)
  }
  if (targets.length === 0) return null

  const poses = targets.map((target): EditorPose => bonePoseAt(state, bone, target))
  let next: EditorAnimationState | null = null
  for (const [targetIndex, target] of targets.entries()) {
    const pose = poses[targetIndex]
    if (pose === undefined) continue
    const inserted = insertKeyWithPose(next ?? state, bone, target, pose)
    if (inserted !== null) next = inserted
  }

  return next
}

export function setBonePose(
  state: EditorAnimationState,
  storeId: number,
  frame: number,
  pose: EditorPose,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, frame)) return null
  const bone = state.index.bones.get(storeId)
  if (!bone) return null

  const rest = resolveBoneRest(bone, state.data.additive)
  const snapped = snapPose(normalizePose(pose), rest)
  const track = ensureTrack(state, bone)
  const current = track.frames[frame]
  if (!current || poseEquals(current, snapped)) return null

  copyPose(current, snapped)
  track.keys = addKey(track.keys, frame)
  refreshTrackFrames(track, [frame], rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, track)
}

export function addBoneKey(
  state: EditorAnimationState,
  storeId: number,
  frame: number,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, frame)) return null
  const bone = state.index.bones.get(storeId)
  if (!bone) return null

  const track = state.model.bones.get(storeId)
  if (track?.keys.includes(frame)) return null

  const source = track?.frames[frame]
  const pose = source === undefined ? bonePoseAt(state, bone, frame) : poseFromFrame(source)
  return insertKeyWithPose(state, bone, frame, pose)
}

export function eraseBoneKey(
  state: EditorAnimationState,
  storeId: number,
  frame: number,
): EditorAnimationState | null {
  const found = findTrack(state, storeId)
  if (!found || !found.track.keys.includes(frame)) return null

  const rest = resolveBoneRest(found.bone, state.data.additive)
  const nextTrack = cloneBoneTrack(found.track)
  nextTrack.keys = nextTrack.keys.filter((key) => key !== frame)
  const removed = nextTrack.frames[frame]
  if (removed) resetFrame(removed, rest)
  refreshTrackFrames(nextTrack, [frame], rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, nextTrack)
}

export function insertPoseAtFraction(
  state: EditorAnimationState,
  storeId: number,
  fromFrame: number,
  toFrame: number,
  fraction: number,
): EditorAnimationState | null {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null
  const found = findTrack(state, storeId)
  if (!found) return null
  if (!found.track.keys.includes(fromFrame) || !found.track.keys.includes(toFrame)) return null
  if (toFrame <= fromFrame) return null

  const targetFrame = Math.round(fromFrame + (toFrame - fromFrame) * fraction)
  if (targetFrame <= fromFrame || targetFrame >= toFrame) return null
  if (found.track.keys.includes(targetFrame)) return null

  const source = found.track.frames[targetFrame]
  if (!source) return null
  return insertKeyWithPose(state, found.bone, targetFrame, poseFromFrame(source))
}

export function duplicateBonePose(
  state: EditorAnimationState,
  storeId: number,
  fromFrame: number,
  toFrame: number,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, fromFrame)) return null
  if (!isFrameInRange(state.model.frameCount, toFrame)) return null
  if (fromFrame === toFrame) return null

  const found = findTrack(state, storeId)
  if (!found) return null
  const source = found.track.frames[fromFrame]
  if (!source) return null
  return insertKeyWithPose(state, found.bone, toFrame, poseFromFrame(source))
}

export function moveBoneKey(
  state: EditorAnimationState,
  storeId: number,
  fromFrame: number,
  toFrame: number,
): EditorAnimationState | null {
  if (fromFrame === toFrame) return null
  if (!isFrameInRange(state.model.frameCount, toFrame)) return null

  const found = findTrack(state, storeId)
  if (!found || !found.track.keys.includes(fromFrame)) return null

  const rest = resolveBoneRest(found.bone, state.data.additive)
  const nextTrack = cloneBoneTrack(found.track)
  const source = nextTrack.frames[fromFrame]
  const target = nextTrack.frames[toFrame]
  if (!source || !target) return null

  copyFrameData(target, source)
  nextTrack.keys = addKey(nextTrack.keys.filter((key) => key !== fromFrame), toFrame)
  resetFrame(source, rest)
  refreshTrackFrames(nextTrack, [fromFrame, toFrame], rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, nextTrack)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function shiftKeysProportionally(
  state: EditorAnimationState,
  storeId: number,
  fromFrame: number,
  toFrame: number,
  deltaFrames: number,
): EditorAnimationState | null {
  if (!Number.isInteger(deltaFrames) || deltaFrames === 0) return null

  const found = findTrack(state, storeId)
  if (!found) return null
  if (!found.track.keys.includes(fromFrame) || !found.track.keys.includes(toFrame)) return null
  if (toFrame <= fromFrame) return null

  const newTo = toFrame + deltaFrames
  if (newTo <= fromFrame || newTo >= state.model.frameCount) return null

  const rest = resolveBoneRest(found.bone, state.data.additive)
  const nextTrack = cloneBoneTrack(found.track)
  const oldKeys = sortedKeys(found.track)
  const toFrameData = nextTrack.frames[toFrame]
  if (!toFrameData) return null

  const mappings: { oldFrame: number; newFrame: number }[] = []
  const minInterior = fromFrame + 1
  const maxInterior = Math.max(minInterior, newTo - 1)
  for (const key of oldKeys) {
    if (key <= fromFrame || key >= toFrame) continue
    const mapped = fromFrame + Math.round(((key - fromFrame) * (newTo - fromFrame)) / (toFrame - fromFrame))
    mappings.push({ oldFrame: key, newFrame: clamp(mapped, minInterior, maxInterior) })
  }

  const assignments = new Map<number, EditorBoneFrame>()
  for (const mapping of mappings) {
    const source = nextTrack.frames[mapping.oldFrame]
    if (source) assignments.set(mapping.newFrame, cloneFrame(source))
  }
  assignments.set(newTo, cloneFrame(toFrameData))

  const newKeys: number[] = []
  for (const key of oldKeys) {
    if (key === toFrame) continue
    if (key > fromFrame && key < toFrame) continue
    newKeys.push(key)
  }
  for (const mapping of mappings) newKeys.push(mapping.newFrame)
  newKeys.push(newTo)
  const uniqueKeys = [...new Set(newKeys)].sort((a, b) => a - b)
  const uniqueSet = new Set(uniqueKeys)

  for (const key of oldKeys) {
    if (uniqueSet.has(key)) continue
    const frame = nextTrack.frames[key]
    if (frame) resetFrame(frame, rest)
  }
  for (const [frameIndex, data] of assignments) {
    const target = nextTrack.frames[frameIndex]
    if (target) copyFrameData(target, data)
  }

  nextTrack.keys = uniqueKeys
  refreshTrackFrames(nextTrack, [...oldKeys, ...uniqueKeys], rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, nextTrack)
}

function mirrorPose(pose: EditorPose, rest: EditorPose): EditorPose {
  return {
    rotation: {
      x: normalizeAngle(rest.rotation.x + shortestAngleDelta(rest.rotation.x, pose.rotation.x)),
      y: normalizeAngle(rest.rotation.y - shortestAngleDelta(rest.rotation.y, pose.rotation.y)),
      z: normalizeAngle(rest.rotation.z - shortestAngleDelta(rest.rotation.z, pose.rotation.z)),
    },
    pos: {
      x: rest.pos.x - (pose.pos.x - rest.pos.x),
      y: pose.pos.y,
      z: pose.pos.z,
    },
    show: pose.show,
  }
}

export function mirrorBonePose(
  state: EditorAnimationState,
  storeId: number,
  frame: number,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, frame)) return null
  const found = findTrack(state, storeId)
  if (!found) return null
  const source = found.track.frames[frame]
  if (!source) return null

  const rest = resolveBoneRest(found.bone, state.data.additive)
  const sourcePose = poseFromFrame(source)
  const mirrored = mirrorPose(sourcePose, rest)
  if (poseEquals(sourcePose, mirrored)) return null
  return insertKeyWithPose(state, found.bone, frame, mirrored)
}

function smoothValue(previous: number, current: number, next: number): number {
  return previous * 0.25 + current * 0.5 + next * 0.25
}

function smoothAngle(previous: number, current: number, next: number): number {
  const adjustedCurrent = previous + shortestAngleDelta(previous, current)
  const adjustedNext = adjustedCurrent + shortestAngleDelta(current, next)
  return normalizeAngle(previous * 0.25 + adjustedCurrent * 0.5 + adjustedNext * 0.25)
}

export function smoothBoneTrack(
  state: EditorAnimationState,
  storeId: number,
): EditorAnimationState | null {
  const found = findTrack(state, storeId)
  if (!found) return null

  const keys = sortedKeys(found.track)
  if (keys.length < 3) return null

  const rest = resolveBoneRest(found.bone, state.data.additive)
  const nextTrack = cloneBoneTrack(found.track)
  let changed = false

  for (let index = 1; index < keys.length - 1; index++) {
    const previous = nextTrack.frames[keys[index - 1] ?? 0]
    const current = nextTrack.frames[keys[index] ?? 0]
    const next = nextTrack.frames[keys[index + 1] ?? 0]
    if (!previous || !current || !next) continue

    const smoothed = snapPose({
      rotation: {
        x: smoothAngle(previous.rotation.x, current.rotation.x, next.rotation.x),
        y: smoothAngle(previous.rotation.y, current.rotation.y, next.rotation.y),
        z: smoothAngle(previous.rotation.z, current.rotation.z, next.rotation.z),
      },
      pos: {
        x: smoothValue(previous.pos.x, current.pos.x, next.pos.x),
        y: smoothValue(previous.pos.y, current.pos.y, next.pos.y),
        z: smoothValue(previous.pos.z, current.pos.z, next.pos.z),
      },
      show: current.show,
    }, rest)

    if (!poseEquals(current, smoothed)) {
      changed = true
      copyPose(current, smoothed)
    }
  }

  if (!changed) return null
  refillTrack(nextTrack, rest, state.data.interpolator, state.holdLastPose)
  return commitTrack(state, nextTrack)
}

export function updateAnimationData(
  state: EditorAnimationState,
  patch: Partial<EditorAnimationData>,
): EditorAnimationState | null {
  const patchKeys = Object.keys(patch) as (keyof EditorAnimationData)[]
  const changedKeys = patchKeys.filter((key) => !Object.is(state.data[key], patch[key]))
  if (changedKeys.length === 0) return null

  const data: EditorAnimationData = { ...state.data, ...patch }
  const settingsChanged = changedKeys.some((key) => key === 'interpolator' || key === 'additive')
  if (!settingsChanged) return { ...state, data }

  const bones = new Map<number, EditorBoneTrack>()
  for (const track of state.model.bones.values()) {
    const bone = state.index.bones.get(track.storeId)
    if (!bone) continue
    const rest = resolveBoneRest(bone, data.additive)
    const nextTrack = cloneBoneTrack(track)
    refillTrack(nextTrack, rest, data.interpolator, state.holdLastPose)
    if (nextTrack.keys.length > 0) bones.set(nextTrack.storeId, nextTrack)
  }

  return { ...state, data, model: { ...state.model, bones } }
}

export const EDITOR_MIN_FRAMES = 1
export const EDITOR_MAX_FRAMES = 255
export const EDITOR_MIN_DURATION_MS = 1
export const EDITOR_MAX_DURATION_MS = 65535
export const EDITOR_MIN_SIGNED_PROPERTY = -128
export const EDITOR_MAX_SIGNED_PROPERTY = 127
export const EDITOR_DEFAULT_VANILLA_POSE_INDEX = 1

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function normalizeEditorDuration(value: number): number {
  return clampInteger(value, EDITOR_MIN_DURATION_MS, EDITOR_MAX_DURATION_MS)
}

export function normalizeEditorFrameCount(value: number): number {
  return clampInteger(value, EDITOR_MIN_FRAMES, EDITOR_MAX_FRAMES)
}

export function normalizeEditorPriority(value: number): number {
  return clampInteger(value, EDITOR_MIN_SIGNED_PROPERTY, EDITOR_MAX_SIGNED_PROPERTY)
}

export function normalizeEditorOrder(value: number): number {
  return clampInteger(value, EDITOR_MIN_SIGNED_PROPERTY, EDITOR_MAX_SIGNED_PROPERTY)
}

export function changeAnimationKind(
  state: EditorAnimationState,
  kind: EditorAnimationData['kind'],
): EditorAnimationState | null {
  if (state.data.kind === kind) return null

  if (kind === 'vanilla-pose') {
    const currentIndex = state.data.poseIndex
    const poseIndex = vanillaPoseName(currentIndex) === null
      ? EDITOR_DEFAULT_VANILLA_POSE_INDEX
      : currentIndex ?? EDITOR_DEFAULT_VANILLA_POSE_INDEX
    const name = vanillaPoseName(poseIndex)
    if (name === null) return null
    return {
      ...state,
      data: { ...state.data, kind, name, poseIndex, loop: false },
    }
  }

  const data: EditorAnimationData = {
    ...state.data,
    kind,
    loop: kind === 'gesture' ? state.data.loop : false,
  }
  if (kind === 'custom-pose') data.poseIndex = 0
  else delete data.poseIndex
  return { ...state, data }
}

export function changeAnimationPose(
  state: EditorAnimationState,
  poseIndex: number,
): EditorAnimationState | null {
  const name = vanillaPoseName(poseIndex)
  if (name === null) return null
  if (state.data.kind === 'vanilla-pose' && state.data.poseIndex === poseIndex) return null
  return {
    ...state,
    data: { ...state.data, kind: 'vanilla-pose', name, poseIndex, loop: false },
  }
}

export function countEditorKeysBeyond(
  state: EditorAnimationState,
  frameCount: number,
): number {
  const safeFrameCount = Math.max(0, Math.round(frameCount))
  let count = 0
  for (const track of state.model.bones.values()) {
    count += track.keys.filter((key) => key >= safeFrameCount).length
  }
  return count
}

export function resizeEditorModel(
  state: EditorAnimationState,
  frameCount: number,
): EditorAnimationState | null {
  const target = normalizeEditorFrameCount(frameCount)
  if (target === state.model.frameCount) return null

  const bones = new Map<number, EditorBoneTrack>()
  for (const track of state.model.bones.values()) {
    const bone = state.index.bones.get(track.storeId)
    if (!bone) continue

    const rest = resolveBoneRest(bone, state.data.additive)
    const frames = track.frames.slice(0, target)
    while (frames.length < target) frames.push(createRestFrame(rest))
    const keys = track.keys.filter((key) => key < target)
    if (keys.length === 0) continue

    const nextTrack: EditorBoneTrack = { storeId: track.storeId, frames, keys }
    refillTrack(nextTrack, rest, state.data.interpolator, state.holdLastPose)
    bones.set(nextTrack.storeId, nextTrack)
  }

  return {
    ...state,
    model: { frameCount: target, bones },
    frameColors: new Map([...state.frameColors].filter(([frame]) => frame < target)),
  }
}

function relocateFrameIndex(index: number, fromFrame: number, toFrame: number): number {
  if (index === fromFrame) return toFrame
  if (fromFrame < toFrame && index > fromFrame && index <= toFrame) return index - 1
  if (toFrame < fromFrame && index >= toFrame && index < fromFrame) return index + 1
  return index
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  if (item === undefined) return next
  next.splice(toIndex, 0, item)
  return next
}

function moveFrameColors(
  colors: ReadonlyMap<number, string>,
  fromFrame: number,
  toFrame: number,
): Map<number, string> {
  const next = new Map<number, string>()
  for (const [frame, color] of colors) {
    next.set(relocateFrameIndex(frame, fromFrame, toFrame), color)
  }
  return next
}

export function moveEditorFrame(
  state: EditorAnimationState,
  fromFrame: number,
  toFrame: number,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, fromFrame)) return null
  if (!isFrameInRange(state.model.frameCount, toFrame)) return null
  if (fromFrame === toFrame) return null

  const bones = new Map<number, EditorBoneTrack>()
  for (const track of state.model.bones.values()) {
    const bone = state.index.bones.get(track.storeId)
    if (!bone) continue

    const rest = resolveBoneRest(bone, state.data.additive)
    const keys = [...new Set(track.keys.map((key) => relocateFrameIndex(key, fromFrame, toFrame)))]
      .sort((first, second) => first - second)
    const nextTrack: EditorBoneTrack = {
      storeId: track.storeId,
      frames: moveArrayItem(track.frames, fromFrame, toFrame),
      keys,
    }

    refillTrack(nextTrack, rest, state.data.interpolator, state.holdLastPose)
    bones.set(nextTrack.storeId, nextTrack)
  }

  return {
    ...state,
    model: { ...state.model, bones },
    frameColors: moveFrameColors(state.frameColors, fromFrame, toFrame),
  }
}

export function setFrameColor(
  state: EditorAnimationState,
  frame: number,
  color: string | null,
): EditorAnimationState | null {
  if (!isFrameInRange(state.model.frameCount, frame)) return null

  const next = new Map(state.frameColors)
  if (color === null) {
    if (!next.delete(frame)) return null
  } else {
    if (next.get(frame) === color) return null
    next.set(frame, color)
  }

  return { ...state, frameColors: next }
}

export function scaleEditorDuration(
  duration: number,
  fromFrameCount: number,
  toFrameCount: number,
): number {
  if (fromFrameCount <= 0 || toFrameCount <= 0) return normalizeEditorDuration(duration)
  return normalizeEditorDuration((duration * toFrameCount) / fromFrameCount)
}

export function insertEditorFrame(state: EditorAnimationState): EditorAnimationState | null {
  if (state.model.frameCount >= EDITOR_MAX_FRAMES) return null

  const next = resizeEditorModel(state, state.model.frameCount + 1)
  if (next === null) return null
  const duration = scaleEditorDuration(
    state.data.duration,
    state.model.frameCount,
    next.model.frameCount,
  )
  return { ...next, data: { ...next.data, duration } }
}

export function insertEditorStep(state: EditorAnimationState): EditorAnimationState | null {
  const duration = Math.max(state.data.duration, 1)
  if (duration >= EDITOR_MAX_DURATION_MS) return null

  const nextDuration = normalizeEditorDuration(duration + EDITOR_SIMPLE_STEP_MS)
  if (nextDuration <= duration) return null

  const target = Math.min(
    EDITOR_MAX_FRAMES,
    Math.max(
      state.model.frameCount + 1,
      Math.round((state.model.frameCount * nextDuration) / duration),
    ),
  )
  if (target === state.model.frameCount) return null

  const next = resizeEditorModel(state, target)
  if (next === null) return null
  return { ...next, data: { ...next.data, duration: nextDuration } }
}

export function removeEditorFrame(state: EditorAnimationState): EditorAnimationState | null {
  if (state.model.frameCount <= EDITOR_MIN_FRAMES) return null

  const next = resizeEditorModel(state, state.model.frameCount - 1)
  if (next === null) return null
  const duration = scaleEditorDuration(
    state.data.duration,
    state.model.frameCount,
    next.model.frameCount,
  )
  return { ...next, data: { ...next.data, duration } }
}
