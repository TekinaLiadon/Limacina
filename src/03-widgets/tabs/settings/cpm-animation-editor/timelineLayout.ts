export const TIMELINE_MIN_PX_PER_FRAME = 8
export const TIMELINE_MAX_PX_PER_FRAME = 48
export const TIMELINE_DEFAULT_PX_PER_FRAME = 20
export const TIMELINE_TRACK_PAD_PX = 16

const TICK_STEPS_MS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 15000, 30000, 60000]

export function clampZoom(pxPerFrame: number): number {
  if (!Number.isFinite(pxPerFrame)) return TIMELINE_DEFAULT_PX_PER_FRAME
  return Math.min(
    TIMELINE_MAX_PX_PER_FRAME,
    Math.max(TIMELINE_MIN_PX_PER_FRAME, Math.round(pxPerFrame)),
  )
}

export function timelineContentWidth(frameCount: number, pxPerFrame: number): number {
  return Math.max(1, frameCount) * pxPerFrame + TIMELINE_TRACK_PAD_PX * 2
}

export function frameOffsetPx(frame: number, pxPerFrame: number): number {
  return TIMELINE_TRACK_PAD_PX + frame * pxPerFrame
}

export function timeOffsetPx(
  timeMs: number,
  durationMs: number,
  frameCount: number,
  pxPerFrame: number,
): number {
  const duration = Math.max(durationMs, 1)
  const progress = Math.min(1, Math.max(0, timeMs / duration))
  return TIMELINE_TRACK_PAD_PX + progress * Math.max(1, frameCount) * pxPerFrame
}

export function playheadOffsetPx(
  progress: number,
  frameCount: number,
  pxPerFrame: number,
): number {
  return TIMELINE_TRACK_PAD_PX + Math.min(1, Math.max(0, progress)) * Math.max(1, frameCount) * pxPerFrame
}

export function frameAtPointer(
  clientX: number,
  rectLeft: number,
  pxPerFrame: number,
  frameCount: number,
): number {
  const frame = Math.round((clientX - rectLeft - TIMELINE_TRACK_PAD_PX) / pxPerFrame)
  return Math.min(Math.max(frame, 0), Math.max(0, frameCount - 1))
}

export function scrubProgressAtPointer(
  clientX: number,
  rectLeft: number,
  pxPerFrame: number,
  frameCount: number,
): number {
  const width = Math.max(1, frameCount) * pxPerFrame
  return Math.min(1, Math.max(0, (clientX - rectLeft - TIMELINE_TRACK_PAD_PX) / width))
}

export function pickTickStep(
  durationMs: number,
  trackWidthPx: number,
  minSpacingPx = 56,
): number {
  const duration = Math.max(durationMs, 1)
  for (const step of TICK_STEPS_MS) {
    if ((step / duration) * trackWidthPx >= minSpacingPx) return step
  }
  return TICK_STEPS_MS[TICK_STEPS_MS.length - 1] ?? 60000
}

export function buildTimeTicks(durationMs: number, stepMs: number): number[] {
  const duration = Math.max(durationMs, 1)
  const step = Math.max(1, Math.round(stepMs))
  const ticks: number[] = []
  for (let time = 0; time <= duration; time += step) ticks.push(time)

  const last = ticks[ticks.length - 1] ?? 0
  if (last < duration) {
    if (ticks.length === 1 || duration - last >= step * 0.5) ticks.push(duration)
    else ticks[ticks.length - 1] = duration
  }
  return ticks
}

export function formatTimeTick(ms: number): string {
  if (ms <= 0) return '0'
  const seconds = ms / 1000
  const text = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${text} с`
}
