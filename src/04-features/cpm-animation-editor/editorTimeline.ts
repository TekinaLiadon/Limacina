import type { EditorTimeBead } from './types'

export const EDITOR_DEFAULT_FRAME_COUNT = 20
export const EDITOR_SIMPLE_STEP_MS = 500

export interface EditorSimpleFrame {
  frame: number
  seconds: number
}

export function clampFrame(frame: number, frameCount: number): number {
  if (frameCount <= 0 || !Number.isFinite(frame)) return 0
  return Math.min(frameCount - 1, Math.max(0, Math.round(frame)))
}

export function frameToTimeMs(frame: number, frameCount: number, durationMs: number): number {
  if (frameCount <= 0) return 0
  const duration = Math.max(durationMs, 1)
  return (clampFrame(frame, frameCount) / frameCount) * duration
}

export function timeToFrame(elapsedMs: number, frameCount: number, durationMs: number): number {
  if (frameCount <= 0 || !Number.isFinite(elapsedMs)) return 0
  const duration = Math.max(durationMs, 1)
  const wrapped = ((elapsedMs % duration) + duration) % duration
  return clampFrame(Math.floor((wrapped / duration) * frameCount), frameCount)
}

export function nextKeyFrame(keys: number[], frame: number): number | null {
  let result: number | null = null
  for (const key of keys) {
    if (key <= frame) continue
    if (result === null || key < result) result = key
  }
  return result
}

export function previousKeyFrame(keys: number[], frame: number): number | null {
  let result: number | null = null
  for (const key of keys) {
    if (key >= frame) continue
    if (result === null || key > result) result = key
  }
  return result
}

export function buildTimeBeads(keys: number[]): EditorTimeBead[] {
  const unique = [...new Set(keys.filter((key): boolean => Number.isInteger(key) && key >= 0))]
    .sort((first, second) => first - second)
  const beads: EditorTimeBead[] = []

  for (let index = 0; index < unique.length - 1; index++) {
    const fromFrame = unique[index]
    const toFrame = unique[index + 1]
    if (fromFrame === undefined || toFrame === undefined) continue
    beads.push({ fromFrame, toFrame })
  }

  return beads
}

export function clampBeadDelta(
  delta: number,
  fromFrame: number,
  toFrame: number,
  frameCount: number,
): number {
  if (!Number.isFinite(delta) || frameCount <= 0 || toFrame <= fromFrame) return 0
  const minDelta = fromFrame + 1 - toFrame
  const maxDelta = frameCount - 1 - toFrame
  if (maxDelta < minDelta) return 0
  return Math.max(minDelta, Math.min(maxDelta, Math.round(delta)))
}

export function buildSimpleFrames(
  frameCount: number,
  durationMs: number,
  stepMs: number = EDITOR_SIMPLE_STEP_MS,
): EditorSimpleFrame[] {
  if (frameCount <= 0) return []
  const duration = Math.max(durationMs, 1)
  const step = Math.max(1, Math.round(stepMs))
  const lastFrame = frameCount - 1
  const seen = new Set<number>()
  const frames: EditorSimpleFrame[] = []

  for (let elapsed = 0; elapsed < duration; elapsed += step) {
    const frame = clampFrame(Math.round((elapsed / duration) * frameCount), frameCount)
    if (seen.has(frame)) continue
    seen.add(frame)
    frames.push({ frame, seconds: elapsed / 1000 })
  }

  if (!seen.has(lastFrame)) {
    frames.push({ frame: lastFrame, seconds: duration / 1000 })
  } else {
    const tail = frames.find((item): boolean => item.frame === lastFrame)
    if (tail !== undefined) tail.seconds = duration / 1000
  }

  return frames.sort((first, second) => first.frame - second.frame)
}

export function nearestSimpleFrame(
  frame: number,
  frameCount: number,
  durationMs: number,
  stepMs: number = EDITOR_SIMPLE_STEP_MS,
): number {
  const frames = buildSimpleFrames(frameCount, durationMs, stepMs)
  const [first] = frames
  if (first === undefined) return clampFrame(frame, frameCount)

  let best = first.frame
  for (const item of frames) {
    if (Math.abs(item.frame - frame) < Math.abs(best - frame)) best = item.frame
  }
  return best
}

export function secondsToEditorFrame(
  seconds: number,
  frameCount: number,
  durationMs: number,
): number {
  if (!Number.isFinite(seconds)) return 0
  const duration = Math.max(durationMs, 1)
  return clampFrame(Math.round((seconds * 1000 * frameCount) / duration), frameCount)
}

export function stepSimpleFrame(
  frame: number,
  delta: -1 | 1,
  frames: EditorSimpleFrame[],
): number | null {
  let result: number | null = null
  for (const item of frames) {
    const fits = delta < 0 ? item.frame < frame : item.frame > frame
    if (!fits) continue
    if (result === null) {
      result = item.frame
      continue
    }
    result = delta < 0 ? Math.max(result, item.frame) : Math.min(result, item.frame)
  }
  return result
}
