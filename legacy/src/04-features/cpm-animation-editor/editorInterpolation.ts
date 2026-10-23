import type { CPMAnimationInterpolator } from '@/05-entities'
import type { EditorBoneFrame, EditorBoneTrack, EditorPose } from './types'
import { createRestFrame, normalizeAngle, shortestAngleDelta } from './editorModel'

type Axis = 'x' | 'y' | 'z'
type ChannelKind = 'rotation' | 'pos'

interface SplineChannel {
  x: number[]
  y: number[]
  secondDerivatives: number[]
}

function lerp(t: number, from: number, to: number): number {
  return from + (to - from) * t
}

function ease(t: number, interpolator: CPMAnimationInterpolator): number {
  if (interpolator === 'trig_loop' || interpolator === 'trig_single') {
    return Math.sin((t * Math.PI) / 2)
  }
  return t
}

export function copyPose(target: EditorPose, source: EditorPose): void {
  target.rotation.x = source.rotation.x
  target.rotation.y = source.rotation.y
  target.rotation.z = source.rotation.z
  target.pos.x = source.pos.x
  target.pos.y = source.pos.y
  target.pos.z = source.pos.z
  target.show = source.show
}

export function copyFrameData(target: EditorBoneFrame, source: EditorBoneFrame): void {
  copyPose(target, source)
  target.scale.x = source.scale.x
  target.scale.y = source.scale.y
  target.scale.z = source.scale.z
  target.color = source.color
}

export function frameDataEquals(first: EditorBoneFrame, second: EditorBoneFrame): boolean {
  return first.show === second.show
    && first.rotation.x === second.rotation.x
    && first.rotation.y === second.rotation.y
    && first.rotation.z === second.rotation.z
    && first.pos.x === second.pos.x
    && first.pos.y === second.pos.y
    && first.pos.z === second.pos.z
    && first.scale.x === second.scale.x
    && first.scale.y === second.scale.y
    && first.scale.z === second.scale.z
    && first.color === second.color
}

export function resetFrame(frame: EditorBoneFrame, rest: EditorPose): void {
  copyPose(frame, rest)
  frame.scale.x = 1
  frame.scale.y = 1
  frame.scale.z = 1
  frame.color = '0'
}

export function sortedKeys(track: EditorBoneTrack): number[] {
  return [...track.keys].sort((a, b) => a - b)
}

function naturalSecondDerivatives(x: number[], y: number[]): number[] {
  const count = x.length
  const secondDerivatives = new Array<number>(count).fill(0)
  if (count < 3) return secondDerivatives

  const u = new Array<number>(count).fill(0)
  for (let index = 1; index < count - 1; index++) {
    const xPrev = x[index - 1] ?? 0
    const xCurrent = x[index] ?? 0
    const xNext = x[index + 1] ?? 0
    const yPrev = y[index - 1] ?? 0
    const yCurrent = y[index] ?? 0
    const yNext = y[index + 1] ?? 0

    const sigma = (xCurrent - xPrev) / (xNext - xPrev)
    const p = sigma * (secondDerivatives[index - 1] ?? 0) + 2
    secondDerivatives[index] = (sigma - 1) / p
    const slope = (yNext - yCurrent) / (xNext - xCurrent) - (yCurrent - yPrev) / (xCurrent - xPrev)
    u[index] = (6 * slope / (xNext - xPrev) - sigma * (u[index - 1] ?? 0)) / p
  }

  for (let index = count - 2; index >= 0; index--) {
    secondDerivatives[index] = (secondDerivatives[index] ?? 0) * (secondDerivatives[index + 1] ?? 0)
      + (u[index] ?? 0)
  }

  return secondDerivatives
}

function buildSplineChannel(
  track: EditorBoneTrack,
  keys: number[],
  kind: ChannelKind,
  axis: Axis,
): SplineChannel {
  const y: number[] = []
  let previousRaw = 0
  let unwrapped = 0
  keys.forEach((key, index) => {
    const frame = track.frames[key]
    const raw = frame ? frame[kind][axis] : 0
    if (index === 0) {
      unwrapped = normalizeAngle(raw)
    } else {
      unwrapped += shortestAngleDelta(previousRaw, raw)
    }
    previousRaw = raw
    y.push(kind === 'rotation' ? unwrapped : raw)
  })
  return { x: [...keys], y, secondDerivatives: naturalSecondDerivatives(keys, y) }
}

function sampleSpline(channel: SplineChannel, value: number): number {
  const { x, y, secondDerivatives } = channel
  const count = x.length
  if (count === 0) return 0
  if (count === 1) return y[0] ?? 0

  let low = 0
  let high = count - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if ((x[middle] ?? 0) <= value) low = middle
    else high = middle
  }

  const xLow = x[low] ?? 0
  const xHigh = x[high] ?? 0
  const span = xHigh - xLow
  if (span === 0) return y[low] ?? 0

  const a = (xHigh - value) / span
  const b = (value - xLow) / span
  return a * (y[low] ?? 0)
    + b * (y[high] ?? 0)
    + ((a * a * a - a) * (secondDerivatives[low] ?? 0)
      + (b * b * b - b) * (secondDerivatives[high] ?? 0)) * (span * span) / 6
}

function previousKeyShow(track: EditorBoneTrack, keys: number[], frame: number): boolean {
  let result = track.frames[frame]?.show ?? true
  for (const key of keys) {
    if (key >= frame) break
    const keyFrame = track.frames[key]
    if (keyFrame) result = keyFrame.show
  }
  return result
}

function fillPolyGap(
  track: EditorBoneTrack,
  fromFrame: number,
  toFrame: number,
  keySet: Set<number>,
): void {
  const keys = sortedKeys(track)
  if (keys.length < 2) return

  const rotX = buildSplineChannel(track, keys, 'rotation', 'x')
  const rotY = buildSplineChannel(track, keys, 'rotation', 'y')
  const rotZ = buildSplineChannel(track, keys, 'rotation', 'z')
  const posX = buildSplineChannel(track, keys, 'pos', 'x')
  const posY = buildSplineChannel(track, keys, 'pos', 'y')
  const posZ = buildSplineChannel(track, keys, 'pos', 'z')

  for (let frame = fromFrame + 1; frame < toFrame; frame++) {
    if (keySet.has(frame)) continue
    const target = track.frames[frame]
    if (!target) continue
    target.rotation.x = normalizeAngle(sampleSpline(rotX, frame))
    target.rotation.y = normalizeAngle(sampleSpline(rotY, frame))
    target.rotation.z = normalizeAngle(sampleSpline(rotZ, frame))
    target.pos.x = sampleSpline(posX, frame)
    target.pos.y = sampleSpline(posY, frame)
    target.pos.z = sampleSpline(posZ, frame)
    target.show = previousKeyShow(track, keys, frame)
  }
}

function fillGap(
  track: EditorBoneTrack,
  fromFrame: number,
  toFrame: number,
  interpolator: CPMAnimationInterpolator,
): void {
  const from = track.frames[fromFrame]
  const to = track.frames[toFrame]
  if (!from || !to || toFrame <= fromFrame + 1) return

  if (interpolator === 'poly_loop' || interpolator === 'poly_single') {
    fillPolyGap(track, fromFrame, toFrame, new Set(track.keys))
    return
  }

  for (let frame = fromFrame + 1; frame < toFrame; frame++) {
    const target = track.frames[frame]
    if (!target || track.keys.includes(frame)) continue

    if (interpolator === 'no') {
      copyPose(target, from)
      continue
    }

    const t = (frame - fromFrame) / (toFrame - fromFrame)
    const factor = ease(t, interpolator)
    target.rotation.x = normalizeAngle(lerp(factor, from.rotation.x, from.rotation.x + shortestAngleDelta(from.rotation.x, to.rotation.x)))
    target.rotation.y = normalizeAngle(lerp(factor, from.rotation.y, from.rotation.y + shortestAngleDelta(from.rotation.y, to.rotation.y)))
    target.rotation.z = normalizeAngle(lerp(factor, from.rotation.z, from.rotation.z + shortestAngleDelta(from.rotation.z, to.rotation.z)))
    target.pos.x = lerp(factor, from.pos.x, to.pos.x)
    target.pos.y = lerp(factor, from.pos.y, to.pos.y)
    target.pos.z = lerp(factor, from.pos.z, to.pos.z)
    target.show = from.show
  }
}

interface GapPair {
  from: number | null
  to: number | null
}

export function fillTrackTail(
  track: EditorBoneTrack,
  rest: EditorPose,
  holdLastPose: boolean,
): boolean {
  const keys = sortedKeys(track)
  const last = keys[keys.length - 1]
  if (last === undefined) return false
  const source = track.frames[last]
  if (source === undefined) return false

  const restFrame = createRestFrame(rest)
  const keySet = new Set(keys)
  let changed = false

  for (let frame = last + 1; frame < track.frames.length; frame++) {
    if (keySet.has(frame)) continue
    const target = track.frames[frame]
    if (target === undefined) continue

    if (holdLastPose) {
      if (frameDataEquals(target, source)) continue
      copyFrameData(target, source)
    } else {
      if (frameDataEquals(target, restFrame)) continue
      resetFrame(target, rest)
    }
    changed = true
  }

  return changed
}

export function resetTrackRange(
  track: EditorBoneTrack,
  start: number,
  end: number,
  rest: EditorPose,
): void {
  const keySet = new Set(track.keys)
  const first = Math.max(0, start)
  const last = Math.min(end, track.frames.length)
  for (let frame = first; frame < last; frame++) {
    if (keySet.has(frame)) continue
    const target = track.frames[frame]
    if (target) resetFrame(target, rest)
  }
}

export function refreshTrackFrames(
  track: EditorBoneTrack,
  positions: number[],
  rest: EditorPose,
  interpolator: CPMAnimationInterpolator,
  holdLastPose = false,
): void {
  const keys = sortedKeys(track)
  const keySet = new Set(keys)
  const pairs = new Map<string, GapPair>()
  const addPair = (from: number | null, to: number | null): void => {
    pairs.set(`${from ?? 'start'}:${to ?? 'end'}`, { from, to })
  }

  for (const position of positions) {
    let previous: number | null = null
    let next: number | null = null
    for (const key of keys) {
      if (key < position) previous = key
      else if (key > position) {
        next = key
        break
      }
    }

    if (keySet.has(position)) {
      addPair(previous, position)
      addPair(position, next)
    } else {
      addPair(previous, next)
    }
  }

  for (const pair of pairs.values()) {
    if (pair.from === null && pair.to === null) {
      resetTrackRange(track, 0, track.frames.length, rest)
      continue
    }
    if (pair.from === null && pair.to !== null) {
      resetTrackRange(track, 0, pair.to, rest)
      continue
    }
    if (pair.from !== null && pair.to === null) {
      fillTrackTail(track, rest, holdLastPose)
      continue
    }
    fillGap(track, pair.from ?? 0, pair.to ?? 0, interpolator)
  }

  if (interpolator === 'poly_loop' || interpolator === 'poly_single') {
    refillTrack(track, rest, interpolator, holdLastPose)
  }
}

export function refillTrack(
  track: EditorBoneTrack,
  rest: EditorPose,
  interpolator: CPMAnimationInterpolator,
  holdLastPose = false,
): void {
  const keys = sortedKeys(track)
  const keySet = new Set(keys)
  const [first] = keys
  const last = keys[keys.length - 1]

  for (let frame = 0; frame < track.frames.length; frame++) {
    if (keySet.has(frame)) continue
    if (first === undefined || last === undefined || frame < first) {
      const target = track.frames[frame]
      if (target) resetFrame(target, rest)
    }
  }

  for (let index = 0; index < keys.length - 1; index++) {
    fillGap(track, keys[index] ?? 0, keys[index + 1] ?? 0, interpolator)
  }

  fillTrackTail(track, rest, holdLastPose)
}

export function poseFromFrame(frame: EditorBoneFrame): EditorPose {
  return {
    rotation: { ...frame.rotation },
    pos: { ...frame.pos },
    show: frame.show,
  }
}
