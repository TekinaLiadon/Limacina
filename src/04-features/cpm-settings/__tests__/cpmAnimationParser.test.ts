import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { parseCpmAnimEnc, parseCpmAnimations } from '../cpmAnimationParser'
import { createZipReadBudget } from '../../cpm-convert/cpmProjectZip'

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

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

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

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

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

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]).toEqual({
      id: 'extra.json',
      name: 'Unnamed',
      kind: 'gesture',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'poly_loop',
      hidden: false,
      frames: [],
      layerDefault: 0,
      order: 0,
      isProperty: false,
      group: null,
      command: false,
      layerControlled: true,
      maxValue: 100,
      interpolateValue: true,
      mustFinish: false,
    })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('falls back to the looping spline interpolator and reports unknown values', async () => {
    const zip = await buildZip({
      'animations/weird.json': JSON.stringify({ interpolator: 'turbo' }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]?.interpolator).toBe('poly_loop')
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('weird.json'))
  })

  it('maps vanilla pose files onto the game pose list', async () => {
    const zip = await buildZip({
      'animations/v_crawling_1.json': JSON.stringify({ name: 'crawling' }),
      'animations/v_hurtlight_2.json': JSON.stringify({ name: 'hurt' }),
      'animations/v_unknown_pose_3.json': JSON.stringify({ name: 'Unknown' }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations.find((animation) => animation.id === 'v_crawling_1.json')).toMatchObject({
      kind: 'vanilla-pose',
      name: 'crawling',
      poseIndex: 69,
    })
    expect(animations.find((animation) => animation.id === 'v_hurtlight_2.json')).toMatchObject({
      kind: 'vanilla-pose',
      name: 'hurt',
      poseIndex: 44,
    })
    expect(animations.find((animation) => animation.id === 'v_unknown_pose_3.json')).toMatchObject({
      kind: 'gesture',
      name: 'Unknown',
    })
  })

  it('keeps the export fields of an animation', async () => {
    const zip = await buildZip({
      'animations/g_$layer$hat.json': JSON.stringify({
        name: '$layer$Hat',
        additive: true,
        layerDefault: 0.5,
        order: 3,
        isProperty: true,
        group: 'Head',
        command: false,
        layerControlled: false,
        maxValue: 42,
        interpolateVal: false,
        mustFinish: true,
        hidden: true,
      }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]).toMatchObject({
      kind: 'layer',
      name: 'Hat',
      additive: true,
      layerDefault: 0.5,
      order: 3,
      isProperty: true,
      group: 'Head',
      layerControlled: false,
      maxValue: 42,
      interpolateValue: false,
      mustFinish: true,
      hidden: true,
    })
  })

  it('reports broken json files by name and keeps the valid ones', async () => {
    const zip = await buildZip({
      'animations/ok.json': JSON.stringify({ name: 'Ok' }),
      'animations/broken.json': '{ not json',
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations).toHaveLength(1)
    expect(animations[0]?.id).toBe('ok.json')
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('broken.json'))
  })

  it('reports non-object animation bodies as broken instead of crashing', async () => {
    const zip = await buildZip({
      'animations/ok.json': JSON.stringify({ name: 'Ok' }),
      'animations/null.json': 'null',
      'animations/list.json': '[1, 2]',
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations).toHaveLength(1)
    expect(animations[0]?.id).toBe('ok.json')
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('null.json'))
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('list.json'))
  })

  it('falls back to defaults for wrongly typed scalar fields', async () => {
    const zip = await buildZip({
      'animations/scalars.json': JSON.stringify({
        name: 5,
        duration: '800',
        priority: null,
        loop: 'yes',
        additive: 0,
        hidden: 1,
      }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]).toMatchObject({
      name: 'Unnamed',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      hidden: false,
    })
  })

  it('sanitizes damaged frame structures to plain component lists', async () => {
    const zip = await buildZip({
      'animations/frames.json': JSON.stringify({
        name: 'Frames',
        frames: [
          {
            components: [
              {
                storeID: 3,
                pos: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                show: true,
              },
              { storeID: 'head' },
              { storeID: 4, pos: { x: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: 1 },
            ],
          },
          { components: 'all' },
          5,
        ],
      }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations).toHaveLength(1)
    expect(animations[0]?.frames).toEqual([
      {
        components: [
          {
            storeID: 3,
            pos: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            show: true,
            color: '0',
          },
        ],
      },
    ])
  })

  it('keeps the frame color of a component', async () => {
    const zip = await buildZip({
      'animations/color.json': JSON.stringify({
        name: 'Color',
        frames: [
          {
            components: [
              {
                storeID: 7,
                pos: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                show: true,
                color: 'ff8000',
              },
            ],
          },
        ],
      }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]?.frames[0]?.components[0]?.color).toBe('ff8000')
  })

  it('uses an empty frame list when frames are not an array', async () => {
    const zip = await buildZip({
      'animations/no-frames.json': JSON.stringify({ name: 'NoFrames', frames: { all: true } }),
    })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations[0]?.frames).toEqual([])
  })

  it('returns an empty list when the archive has no animations', async () => {
    const zip = await buildZip({ 'config.json': '{}' })

    const animations = await parseCpmAnimations(zip, createZipReadBudget())

    expect(animations).toEqual([])
    expect(reportError).not.toHaveBeenCalled()
  })
})

describe('parseCpmAnimEnc', () => {
  beforeEach(() => {
    reportError.mockReset()
  })

  it('reads the free layers and their default values', async () => {
    const zip = await buildZip({
      'anim_enc.json': JSON.stringify({
        freeLayers: ['jacket', 'hat', 'left_sleeve'],
        defaultValues: { hat: true, jacket: false },
      }),
    })

    const animEnc = await parseCpmAnimEnc(zip, createZipReadBudget())

    expect(animEnc).toEqual({
      freeLayers: ['jacket', 'hat', 'left_sleeve'],
      defaultValues: { hat: true, jacket: false },
    })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('returns null when the archive has no animation encoding', async () => {
    const zip = await buildZip({ 'config.json': '{}' })

    expect(await parseCpmAnimEnc(zip, createZipReadBudget())).toBeNull()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('drops unknown layers and reports a broken file', async () => {
    const zip = await buildZip({
      'anim_enc.json': JSON.stringify({
        freeLayers: ['hat', 'beam', 5],
        defaultValues: { beam: true, jacket: true, other: 'yes' },
      }),
    })

    const animEnc = await parseCpmAnimEnc(zip, createZipReadBudget())

    expect(animEnc).toEqual({
      freeLayers: ['hat'],
      defaultValues: { jacket: true },
    })

    const broken = await buildZip({ 'anim_enc.json': '{ not json' })

    expect(await parseCpmAnimEnc(broken, createZipReadBudget())).toBeNull()
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('anim_enc.json'))
  })
})
