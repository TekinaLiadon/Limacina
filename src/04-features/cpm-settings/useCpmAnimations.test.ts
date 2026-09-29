import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { CPMAnimation, CPMData } from '@/05-entities'
import { useCpmAnimations } from './useCpmAnimations'

const makeAnimation = (id: string, hidden = false): CPMAnimation => ({
  id,
  name: `Анимация ${id}`,
  kind: 'gesture',
  duration: 1,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_single',
  hidden,
  frames: [],
})

const makeData = (animations: CPMAnimation[]): CPMData => ({
  config: { skinSize: { x: 64, y: 64 }, elements: [] },
  textureUrl: 'blob:mock',
  animations,
})

describe('useCpmAnimations', () => {
  it('exposes only the visible animations as options', () => {
    const data = ref<CPMData | null>(makeData([makeAnimation('wave'), makeAnimation('secret', true)]))
    const animations = useCpmAnimations(data)

    expect(animations.animationOptions.value).toEqual([
      { title: 'Анимация wave', value: 'wave' },
    ])
  })

  it('tracks the selected animations and plays them back', () => {
    const data = ref<CPMData | null>(makeData([makeAnimation('wave'), makeAnimation('sit')]))
    const animations = useCpmAnimations(data)

    animations.toggleAnimationPlayback()
    expect(animations.isAnimationPlaying.value).toBe(false)

    animations.selectedAnimationIds.value = ['wave']
    animations.toggleAnimationPlayback()
    expect(animations.isAnimationPlaying.value).toBe(true)
    animations.toggleAnimationPlayback()
    expect(animations.isAnimationPlaying.value).toBe(false)

    expect(animations.activeAnimations.value.map((animation) => animation.id)).toEqual(['wave'])
  })

  it('prunes selections that disappear from the model', async () => {
    const data = ref<CPMData | null>(makeData([makeAnimation('wave'), makeAnimation('ghost')]))
    const animations = useCpmAnimations(data)
    animations.selectedAnimationIds.value = ['wave', 'ghost']

    const current = data.value
    if (current) current.animations = [makeAnimation('wave')]
    await nextTick()

    expect(animations.selectedAnimationIds.value).toEqual(['wave'])
  })

  it('resets the playback state when another model opens', async () => {
    const data = ref<CPMData | null>(makeData([makeAnimation('wave')]))
    const animations = useCpmAnimations(data)
    animations.selectedAnimationIds.value = ['wave']
    animations.toggleAnimationPlayback()
    animations.toggleAnimationLoop()
    animations.speedUp()

    data.value = makeData([makeAnimation('sit')])
    await Promise.resolve()

    expect(animations.selectedAnimationIds.value).toEqual([])
    expect(animations.isAnimationPlaying.value).toBe(false)
    expect(animations.isAnimationLooped.value).toBe(false)
    expect(animations.animationSpeed.value).toBe(1)
  })

  it('clamps the speed to the supported range', () => {
    const data = ref<CPMData | null>(makeData([makeAnimation('wave')]))
    const animations = useCpmAnimations(data)

    animations.speedDown()
    expect(animations.animationSpeed.value).toBe(0.75)
    expect(animations.canSpeedDown.value).toBe(true)

    for (let i = 0; i < 20; i += 1) animations.speedDown()
    expect(animations.animationSpeed.value).toBe(0.25)
    expect(animations.canSpeedDown.value).toBe(false)

    for (let i = 0; i < 20; i += 1) animations.speedUp()
    expect(animations.animationSpeed.value).toBe(3)
    expect(animations.canSpeedUp.value).toBe(false)
  })

  it('handles the null model without options', () => {
    const data = ref<CPMData | null>(null)
    const animations = useCpmAnimations(data)

    expect(animations.animationOptions.value).toEqual([])
    expect(animations.activeAnimations.value).toEqual([])
    animations.toggleAnimationPlayback()
    expect(animations.isAnimationPlaying.value).toBe(false)
  })
})
