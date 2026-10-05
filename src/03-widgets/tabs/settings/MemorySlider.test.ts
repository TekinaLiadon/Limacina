import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MemorySlider from './MemorySlider.vue'

const mountSlider = (modelValue: [number, number], max = 4096) =>
  mount(MemorySlider, { props: { modelValue, max } })

describe('MemorySlider', () => {
  it('renders in-range values as they are', () => {
    const wrapper = mountSlider([512, 4096])

    expect(wrapper.find('.memory-slider__values').text()).toBe('512M — 4G')
  })

  it('clamps saved values above the limit in the display and the handles', () => {
    const wrapper = mountSlider([512, 8192], 2048)

    expect(wrapper.find('.memory-slider__values').text()).toBe('512M — 2G')
    expect(wrapper.find('input.memory-slider__input--max').attributes('value')).toBe('2048')
  })

  it('clamps both ends when the saved range sits entirely above the limit', () => {
    const wrapper = mountSlider([8192, 8192], 4096)

    expect(wrapper.find('.memory-slider__values').text()).toBe('4G — 4G')
  })

  it('emits a clamped value when the handle moves back into range', async () => {
    const wrapper = mountSlider([512, 8192], 2048)

    await wrapper.find('input.memory-slider__input--max').setValue('1024')

    const emitted = wrapper.emitted('update:modelValue') ?? []
    expect(emitted[emitted.length - 1]).toEqual([[512, 1024]])
  })
})
