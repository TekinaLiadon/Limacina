import { describe, expect, it, vi } from 'vitest'
import { builtinPresetSource } from '../builtinPresetSource'
import { parsePresetProject } from '../presetLoader'

const syntheticAnimationFiles = vi.hoisted(() => [
  {
    fileName: 'g_wave.json',
    body: {
      name: 'Wave',
      duration: 500,
      priority: 1,
      loop: true,
      additive: false,
      interpolator: 'linear_loop',
      hidden: false,
      layerControlled: false,
      frames: [
        {
          components: [
            {
              storeID: 100,
              pos: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 30, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              show: true,
            },
          ],
        },
      ],
    },
  },
])

vi.mock('../assets/female-body.animations.json?raw', () => ({
  default: JSON.stringify(syntheticAnimationFiles),
}))

describe('builtinPresetSource с ассетом анимаций', () => {
  it('складывает анимации из ассета в генерируемый zip пресета', async () => {
    const pkg = await builtinPresetSource.fetch('female-body')

    const parsed = await parsePresetProject(pkg.projectData, pkg.metaData)

    expect(parsed.animations).toHaveLength(1)
    expect(parsed.animations[0]).toMatchObject({
      id: 'g_wave.json',
      name: 'Wave',
      kind: 'gesture',
      duration: 500,
      priority: 1,
      loop: true,
      layerControlled: false,
    })
    expect(parsed.animations[0]?.frames[0]?.components[0]?.rotation).toEqual({ x: 0, y: 30, z: 0 })
  })

  it('сохраняет список пресетов без изменений', async () => {
    const entries = await builtinPresetSource.list()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.slug).toBe('female-body')
  })
})
