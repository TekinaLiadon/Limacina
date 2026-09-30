import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { parseCpmAnimations } from './cpmAnimationParser'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

async function buildZip(files: Record<string, string>): Promise<JSZip> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content)
  }
  return zip
}

describe('parseCpmAnimations', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  it('parses a vanilla pose animation', async () => {
    const zip = await buildZip({
      'animations/v_walking.json': JSON.stringify({
        name: 'walking',
        duration: 800,
        priority: 3,
        loop: true,
        additive: false,
        interpolator: 'linear_single',
        hidden: true,
      }),
    })

    const animations = await parseCpmAnimations(zip)

    expect(animations).toHaveLength(1)
    expect(animations[0]).toMatchObject({
      id: 'v_walking.json',
      name: 'walking',
      kind: 'vanilla-pose',
      duration: 800,
      priority: 3,
      loop: true,
      additive: false,
      interpolator: 'linear_single',
      hidden: true,
    })
  })

  it('classifies custom poses, gestures and layers by prefix', async () => {
    const zip = await buildZip({
      'animations/c_dance.json': JSON.stringify({ name: 'Dance' }),
      'animations/g_wave.json': JSON.stringify({ name: 'Wave' }),
      'animations/g_$layer$hat.json': JSON.stringify({ name: '$layer$Hat' }),
    })

    const animations = await parseCpmAnimations(zip)

    expect(animations).toHaveLength(3)
    expect(animations.find((animation) => animation.id === 'c_dance.json')).toMatchObject({
      kind: 'custom-pose',
      name: 'Dance',
    })
    expect(animations.find((animation) => animation.id === 'g_wave.json')).toMatchObject({
      kind: 'gesture',
      name: 'Wave',
    })
    expect(animations.find((animation) => animation.id === 'g_$layer$hat.json')).toMatchObject({
      kind: 'layer',
      name: 'Hat',
    })
  })

  it('applies defaults for a minimal animation file', async () => {
    const zip = await buildZip({ 'animations/extra.json': JSON.stringify({}) })

    const animations = await parseCpmAnimations(zip)

    expect(animations[0]).toEqual({
      id: 'extra.json',
      name: 'Unnamed',
      kind: 'gesture',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: true,
      interpolator: 'poly_loop',
      hidden: false,
      frames: [],
    })
  })

  it('falls back to the default interpolator for unknown values', async () => {
    const zip = await buildZip({
      'animations/weird.json': JSON.stringify({ interpolator: 'turbo' }),
    })

    const animations = await parseCpmAnimations(zip)

    expect(animations[0]?.interpolator).toBe('poly_loop')
  })

  it('reports broken json files by name and keeps the valid ones', async () => {
    const zip = await buildZip({
      'animations/ok.json': JSON.stringify({ name: 'Ok' }),
      'animations/broken.json': '{ not json',
    })

    const animations = await parseCpmAnimations(zip)

    expect(animations).toHaveLength(1)
    expect(animations[0]?.id).toBe('ok.json')
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('broken.json'))
  })

  it('returns an empty list when the archive has no animations', async () => {
    const zip = await buildZip({ 'config.json': '{}' })

    const animations = await parseCpmAnimations(zip)

    expect(animations).toEqual([])
    expect(reportError).not.toHaveBeenCalled()
  })
})
