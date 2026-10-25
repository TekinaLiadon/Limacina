import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { serializeCpmAnimationFile } from '../cpmAnimationJsonWriter'
import { parseCpmAnimations } from '@/04-features/cpm-settings/cpmAnimationParser'
import { createZipReadBudget } from '../cpmProjectZip'
import type { CPMAnimation, CPMAnimationKind } from '@/05-entities'

async function parseSerialized(animation: CPMAnimation): Promise<ReturnType<typeof parseCpmAnimations>> {
  const entry = serializeCpmAnimationFile(animation)
  const zip = new JSZip()
  zip.file(`animations/${entry.fileName}`, JSON.stringify(entry.body))
  return parseCpmAnimations(zip, createZipReadBudget())
}

describe('serializeCpmAnimationFile', () => {
  it('проводит gesture-анимацию туда и обратно со всеми полями', async () => {
    const original: CPMAnimation = {
      id: 'uuid-1',
      name: 'Wave',
      kind: 'gesture',
      duration: 750,
      priority: 2,
      loop: true,
      additive: true,
      interpolator: 'linear_loop',
      hidden: true,
      frames: [
        {
          components: [
            {
              storeID: 100,
              pos: { x: 1, y: 2, z: 3 },
              rotation: { x: 0, y: 45, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              show: true,
              color: 'ff8000',
            },
          ],
        },
      ],
      layerDefault: 0.5,
      order: 3,
      isProperty: true,
      group: 'Head',
      command: false,
      layerControlled: false,
      maxValue: 42,
      interpolateValue: false,
      mustFinish: true,
    }

    const entry = serializeCpmAnimationFile(original)

    expect(entry.fileName).toBe('g_Wave.json')
    await expect(parseSerialized(original)).resolves.toEqual([{ ...original, id: 'g_Wave.json' }])
  })

  it('дополняет минимальную анимацию значениями по умолчанию парсера', async () => {
    const original: CPMAnimation = {
      id: 'uuid-2',
      name: 'Idle',
      kind: 'gesture',
      duration: 1000,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'poly_loop',
      hidden: false,
      frames: [],
    }

    await expect(parseSerialized(original)).resolves.toEqual([
      {
        ...original,
        id: 'g_Idle.json',
        layerDefault: 0,
        order: 0,
        isProperty: false,
        group: null,
        command: false,
        layerControlled: true,
        maxValue: 100,
        interpolateValue: true,
        mustFinish: false,
      },
    ])
  })

  it.each<[CPMAnimationKind, string, string]>([
    ['layer', '$layer$', 'g_$layer$Cover.json'],
    ['value-layer', '$value$', 'g_$value$Cover.json'],
    ['setup', '$pre$', 'g_$pre$Cover.json'],
    ['finish', '$post$', 'g_$post$Cover.json'],
  ])('кодирует kind %s префиксом имени для классификации парсера', async (kind, prefix, fileName) => {
    const original: CPMAnimation = {
      id: 'uuid-3',
      name: 'Cover',
      kind,
      duration: 400,
      priority: 0,
      loop: true,
      additive: true,
      interpolator: 'linear_loop',
      hidden: false,
      frames: [],
      layerControlled: true,
    }

    const entry = serializeCpmAnimationFile(original)

    expect(entry.fileName).toBe(fileName)
    expect(entry.body['name']).toBe(`${prefix}Cover`)
    await expect(parseSerialized(original)).resolves.toEqual([
      {
        ...original,
        id: fileName,
        layerDefault: 0,
        order: 0,
        isProperty: false,
        group: null,
        command: false,
        maxValue: 100,
        interpolateValue: true,
        mustFinish: false,
      },
    ])
  })

  it('кодирует vanilla-позу именем файла v_*.json', async () => {
    const original: CPMAnimation = {
      id: 'uuid-4',
      name: 'walking',
      kind: 'vanilla-pose',
      duration: 800,
      priority: 3,
      loop: true,
      additive: false,
      interpolator: 'linear_single',
      hidden: false,
      frames: [],
      poseIndex: 2,
    }

    const entry = serializeCpmAnimationFile(original)

    expect(entry.fileName).toBe('v_walking.json')
    expect(entry.body).not.toHaveProperty('poseIndex')
    await expect(parseSerialized(original)).resolves.toEqual([
      {
        ...original,
        id: 'v_walking.json',
        layerDefault: 0,
        order: 0,
        isProperty: false,
        group: null,
        command: false,
        layerControlled: true,
        maxValue: 100,
        interpolateValue: true,
        mustFinish: false,
      },
    ])
  })

  it('проводит custom-pose туда и обратно', async () => {
    const original: CPMAnimation = {
      id: 'uuid-5',
      name: 'Dance',
      kind: 'custom-pose',
      duration: 1200,
      priority: 1,
      loop: false,
      additive: false,
      interpolator: 'trig_single',
      hidden: false,
      frames: [],
    }

    const entry = serializeCpmAnimationFile(original)

    expect(entry.fileName).toBe('c_Dance.json')
    await expect(parseSerialized(original)).resolves.toEqual([
      {
        ...original,
        id: 'c_Dance.json',
        layerDefault: 0,
        order: 0,
        isProperty: false,
        group: null,
        command: false,
        layerControlled: true,
        maxValue: 100,
        interpolateValue: true,
        mustFinish: false,
      },
    ])
  })

  it('убирает разделители путей из имени файла, сохраняя имя анимации', async () => {
    const original: CPMAnimation = {
      id: 'uuid-6',
      name: 'wave/motion\\fast',
      kind: 'gesture',
      duration: 100,
      priority: 0,
      loop: false,
      additive: false,
      interpolator: 'no',
      hidden: false,
      frames: [],
    }

    const entry = serializeCpmAnimationFile(original)

    expect(entry.fileName).toBe('g_wave_motion_fast.json')
    await expect(parseSerialized(original)).resolves.toEqual([
      expect.objectContaining({ id: 'g_wave_motion_fast.json', name: 'wave/motion\\fast' }),
    ])
  })
})
