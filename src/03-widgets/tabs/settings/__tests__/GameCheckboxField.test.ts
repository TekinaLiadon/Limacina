import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GameCheckboxField from '../game/GameCheckboxField.vue'

const mountField = (modelValue = false) =>
  mount(GameCheckboxField, { props: { label: 'Тени', modelValue } })

describe('GameCheckboxField', () => {
  it('keeps the input inside a label that carries the field text', () => {
    const wrapper = mountField()

    const input = wrapper.find('input[type="checkbox"]')
    expect(input.exists()).toBe(true)
    const label = input.element.closest('label')
    expect(label).not.toBeNull()
    expect(label?.textContent).toContain('Тени')

    wrapper.unmount()
  })

  it('reaches the input from the row text click', async () => {
    const wrapper = mountField(false)

    const input = wrapper.find('input[type="checkbox"]')
    let clicks = 0
    input.element.addEventListener('click', () => {
      clicks += 1
    })

    await wrapper.find('.checkbox__label').trigger('click')

    expect(clicks).toBe(1)

    wrapper.unmount()
  })

  it('emits the toggled value when the checkbox activates', async () => {
    const wrapper = mountField(false)

    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])

    await wrapper.find('input[type="checkbox"]').setValue(false)
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([false])

    wrapper.unmount()
  })
})
