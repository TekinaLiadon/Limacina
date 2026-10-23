import { describe, expect, it } from 'vitest'
import {
  TIMELINE_DEFAULT_PX_PER_FRAME,
  TIMELINE_MAX_PX_PER_FRAME,
  TIMELINE_MIN_PX_PER_FRAME,
  TIMELINE_TRACK_PAD_PX,
  buildTimeTicks,
  clampZoom,
  formatTimeTick,
  frameAtPointer,
  frameOffsetPx,
  pickTickStep,
  playheadOffsetPx,
  scrubProgressAtPointer,
  timeOffsetPx,
  timelineContentWidth,
} from '../cpm-animation-editor/timelineLayout'

describe('timelineLayout', () => {
  it('clamps zoom to the supported range', () => {
    expect(clampZoom(2)).toBe(TIMELINE_MIN_PX_PER_FRAME)
    expect(clampZoom(100)).toBe(TIMELINE_MAX_PX_PER_FRAME)
    expect(clampZoom(Number.NaN)).toBe(TIMELINE_DEFAULT_PX_PER_FRAME)
    expect(clampZoom(20.4)).toBe(20)
  })

  it('maps frames and time to pixel offsets with track padding', () => {
    expect(frameOffsetPx(0, 20)).toBe(TIMELINE_TRACK_PAD_PX)
    expect(frameOffsetPx(4, 20)).toBe(TIMELINE_TRACK_PAD_PX + 80)
    expect(timeOffsetPx(500, 1000, 10, 20)).toBe(TIMELINE_TRACK_PAD_PX + 100)
    expect(timeOffsetPx(2000, 1000, 10, 20)).toBe(TIMELINE_TRACK_PAD_PX + 200)
    expect(playheadOffsetPx(0.5, 10, 20)).toBe(TIMELINE_TRACK_PAD_PX + 100)
    expect(playheadOffsetPx(-1, 10, 20)).toBe(TIMELINE_TRACK_PAD_PX)
    expect(playheadOffsetPx(2, 10, 20)).toBe(TIMELINE_TRACK_PAD_PX + 200)
    expect(timelineContentWidth(10, 20)).toBe(TIMELINE_TRACK_PAD_PX * 2 + 200)
  })

  it('maps pointer positions to frame and scrub progress', () => {
    const left = 100
    expect(frameAtPointer(left + TIMELINE_TRACK_PAD_PX, left, 20, 10)).toBe(0)
    expect(frameAtPointer(left + TIMELINE_TRACK_PAD_PX + 61, left, 20, 10)).toBe(3)
    expect(frameAtPointer(left - 999, left, 20, 10)).toBe(0)
    expect(frameAtPointer(left + 9999, left, 20, 10)).toBe(9)

    expect(scrubProgressAtPointer(left + TIMELINE_TRACK_PAD_PX, left, 20, 10)).toBe(0)
    expect(scrubProgressAtPointer(left + TIMELINE_TRACK_PAD_PX + 100, left, 20, 10)).toBe(0.5)
    expect(scrubProgressAtPointer(left + 9999, left, 20, 10)).toBe(1)
  })

  it('picks a readable ruler step for the current zoom', () => {
    expect(pickTickStep(1000, 1000)).toBe(100)
    expect(pickTickStep(1000, 200)).toBe(500)
    expect(pickTickStep(5000, 1000)).toBe(500)
    expect(pickTickStep(60000, 1000)).toBe(5000)
  })

  it('builds ticks and avoids a cramped last label', () => {
    expect(buildTimeTicks(1000, 250)).toEqual([0, 250, 500, 750, 1000])
    expect(buildTimeTicks(1100, 500)).toEqual([0, 500, 1100])
    expect(buildTimeTicks(1000, 5000)).toEqual([0, 1000])
    expect(buildTimeTicks(1, 100)).toEqual([0, 1])
  })

  it('formats tick labels in seconds', () => {
    expect(formatTimeTick(0)).toBe('0')
    expect(formatTimeTick(1000)).toBe('1 с')
    expect(formatTimeTick(250)).toBe('0.25 с')
    expect(formatTimeTick(500)).toBe('0.5 с')
    expect(formatTimeTick(2500)).toBe('2.5 с')
  })
})
