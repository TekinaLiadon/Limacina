import { describe, expect, it } from 'vitest'
import {
  buildSimpleFrames,
  buildTimeBeads,
  clampBeadDelta,
  clampFrame,
  frameToTimeMs,
  nearestSimpleFrame,
  nextKeyFrame,
  previousKeyFrame,
  secondsToEditorFrame,
  stepSimpleFrame,
  timeToFrame,
} from '../editorTimeline'

describe('clampFrame', () => {
  it('keeps the frame inside the animation range', () => {
    expect(clampFrame(-3, 20)).toBe(0)
    expect(clampFrame(0, 20)).toBe(0)
    expect(clampFrame(19, 20)).toBe(19)
    expect(clampFrame(40, 20)).toBe(19)
  })

  it('rounds fractional frames and survives an empty animation', () => {
    expect(clampFrame(3.6, 20)).toBe(4)
    expect(clampFrame(3, 0)).toBe(0)
    expect(clampFrame(Number.NaN, 20)).toBe(0)
  })
})

describe('frameToTimeMs', () => {
  it('maps the frame index to the position inside the animation', () => {
    expect(frameToTimeMs(0, 20, 1000)).toBe(0)
    expect(frameToTimeMs(10, 20, 1000)).toBe(500)
    expect(frameToTimeMs(19, 20, 1000)).toBe(950)
  })

  it('clamps the frame and the duration', () => {
    expect(frameToTimeMs(40, 20, 1000)).toBe(950)
    expect(frameToTimeMs(0, 20, 0)).toBe(0)
  })
})

describe('timeToFrame', () => {
  it('inverts the frame to time mapping', () => {
    expect(timeToFrame(0, 20, 1000)).toBe(0)
    expect(timeToFrame(500, 20, 1000)).toBe(10)
    expect(timeToFrame(999, 20, 1000)).toBe(19)
  })

  it('wraps time by the duration like the game player', () => {
    expect(timeToFrame(1500, 20, 1000)).toBe(10)
    expect(timeToFrame(-250, 20, 1000)).toBe(15)
  })

  it('returns the first frame for an empty animation', () => {
    expect(timeToFrame(500, 0, 1000)).toBe(0)
  })
})

describe('key navigation', () => {
  const keys = [0, 4, 9, 15]

  it('finds the next key after the current frame', () => {
    expect(nextKeyFrame(keys, 0)).toBe(4)
    expect(nextKeyFrame(keys, 5)).toBe(9)
    expect(nextKeyFrame(keys, 15)).toBeNull()
  })

  it('finds the previous key before the current frame', () => {
    expect(previousKeyFrame(keys, 15)).toBe(9)
    expect(previousKeyFrame(keys, 9)).toBe(4)
    expect(previousKeyFrame(keys, 0)).toBeNull()
  })

  it('skips the current frame when it is a key', () => {
    expect(nextKeyFrame(keys, 4)).toBe(9)
    expect(previousKeyFrame(keys, 9)).toBe(4)
  })
})

describe('buildTimeBeads', () => {
  it('builds a bead between every pair of neighboring keys', () => {
    expect(buildTimeBeads([15, 0, 4, 9])).toEqual([
      { fromFrame: 0, toFrame: 4 },
      { fromFrame: 4, toFrame: 9 },
      { fromFrame: 9, toFrame: 15 },
    ])
  })

  it('drops duplicates and non-integer frames', () => {
    expect(buildTimeBeads([0, 0, 3, 3.5])).toEqual([{ fromFrame: 0, toFrame: 3 }])
  })

  it('returns nothing for a single key', () => {
    expect(buildTimeBeads([])).toEqual([])
    expect(buildTimeBeads([7])).toEqual([])
  })
})

describe('clampBeadDelta', () => {
  it('keeps the moved key inside the animation and after the left anchor', () => {
    expect(clampBeadDelta(3, 0, 4, 10)).toBe(3)
    expect(clampBeadDelta(10, 0, 4, 10)).toBe(5)
    expect(clampBeadDelta(-10, 0, 4, 10)).toBe(-3)
    expect(clampBeadDelta(2, 4, 9, 10)).toBe(0)
  })

  it('rounds the delta to whole frames', () => {
    expect(clampBeadDelta(1.6, 0, 4, 10)).toBe(2)
    expect(clampBeadDelta(1.4, 0, 4, 10)).toBe(1)
  })

  it('rejects invalid input', () => {
    expect(clampBeadDelta(Number.NaN, 0, 4, 10)).toBe(0)
    expect(clampBeadDelta(1, 4, 4, 10)).toBe(0)
    expect(clampBeadDelta(1, 0, 4, 0)).toBe(0)
  })
})

describe('buildSimpleFrames', () => {
  it('maps every half-second step to its frame and keeps the last frame', () => {
    expect(buildSimpleFrames(20, 2500)).toEqual([
      { frame: 0, seconds: 0 },
      { frame: 4, seconds: 0.5 },
      { frame: 8, seconds: 1 },
      { frame: 12, seconds: 1.5 },
      { frame: 16, seconds: 2 },
      { frame: 19, seconds: 2.5 },
    ])
  })

  it('keeps both ends when the duration is a multiple of the step', () => {
    expect(buildSimpleFrames(20, 1000)).toEqual([
      { frame: 0, seconds: 0 },
      { frame: 10, seconds: 0.5 },
      { frame: 19, seconds: 1 },
    ])
  })

  it('drops duplicate frames when the animation has more steps than frames', () => {
    expect(buildSimpleFrames(2, 5000)).toEqual([
      { frame: 0, seconds: 0 },
      { frame: 1, seconds: 5 },
    ])
  })

  it('returns nothing for an empty animation', () => {
    expect(buildSimpleFrames(0, 1000)).toEqual([])
  })
})

describe('nearestSimpleFrame', () => {
  it('snaps to the closest step boundary', () => {
    expect(nearestSimpleFrame(1, 6, 3000)).toBe(1)
    expect(nearestSimpleFrame(3, 6, 3000)).toBe(3)
    expect(nearestSimpleFrame(5, 6, 3000)).toBe(5)
  })

  it('keeps the earlier boundary when the distances are equal', () => {
    expect(nearestSimpleFrame(5, 20, 1000)).toBe(0)
  })

  it('clamps when there are no simple frames', () => {
    expect(nearestSimpleFrame(4, 0, 1000)).toBe(0)
  })
})

describe('secondsToEditorFrame', () => {
  it('maps a time in seconds to the frame grid', () => {
    expect(secondsToEditorFrame(0, 6, 3000)).toBe(0)
    expect(secondsToEditorFrame(1, 6, 3000)).toBe(2)
    expect(secondsToEditorFrame(2, 6, 3000)).toBe(4)
  })

  it('clamps the end of the animation to the last frame', () => {
    expect(secondsToEditorFrame(3, 6, 3000)).toBe(5)
    expect(secondsToEditorFrame(99, 6, 3000)).toBe(5)
    expect(secondsToEditorFrame(Number.NaN, 6, 3000)).toBe(0)
  })
})

describe('stepSimpleFrame', () => {
  const frames = buildSimpleFrames(6, 3000)

  it('moves between step boundaries', () => {
    expect(stepSimpleFrame(0, 1, frames)).toBe(1)
    expect(stepSimpleFrame(1, 1, frames)).toBe(2)
    expect(stepSimpleFrame(2, -1, frames)).toBe(1)
  })

  it('returns null at the edges', () => {
    expect(stepSimpleFrame(0, -1, frames)).toBeNull()
    expect(stepSimpleFrame(5, 1, frames)).toBeNull()
  })
})
