import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Input from '../Input.vue'

const mountInput = (modelValue = '') =>
  mount(Input, {
    props: { modelValue, options: { list: ['alpha', 'alphabet', 'beta'] } },
  })

describe('Input', () => {
  it('opens the filtered dropdown on focus', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').trigger('focus')

    expect(wrapper.findAll('.input__dropdown-item')).toHaveLength(3)
  })

  it('resets the active suggest when the filtered list changes', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    const staleItems = wrapper.findAll('.input__dropdown-item')
    const [, , third] = staleItems
    expect(third).toBeDefined()
    await third?.trigger('mousemove')
    expect(third?.classes()).toContain('input__dropdown-item--active')

    await wrapper.setProps({ modelValue: 'al' })

    const filtered = wrapper.findAll('.input__dropdown-item')
    expect(filtered).toHaveLength(2)
    expect(filtered[0]?.classes()).toContain('input__dropdown-item--active')
    expect(filtered[1]?.classes()).not.toContain('input__dropdown-item--active')
    expect(input.attributes('aria-activedescendant')).toMatch(/-opt-0$/)
  })

  it('selects the first filtered suggest on Enter after typing', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.trigger('focus')

    await input.setValue('al')
    await wrapper.setProps({ modelValue: 'al' })
    await input.trigger('keydown', { key: 'Enter' })

    const emissions = wrapper.emitted('update:modelValue')
    const lastEmission = emissions?.[emissions.length - 1]
    expect(lastEmission).toEqual(['alpha'])
  })
})
