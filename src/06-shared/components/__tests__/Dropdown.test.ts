import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Dropdown from '../Dropdown.vue'

const options = [
  { value: 'a', title: 'Alpha' },
  { value: 'b', title: 'Beta' },
]

describe('Dropdown', () => {
  it('opens the closed list with Enter and selects an option from the keyboard', async () => {
    const wrapper = mount(Dropdown, { props: { options, modelValue: 'a' } })
    const trigger = (): ReturnType<typeof wrapper.find> => wrapper.find('.select-base__value')

    const openEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    trigger().element.dispatchEvent(openEvent)
    await nextTick()

    expect(wrapper.find('.select-base-options').exists()).toBe(true)
    expect(openEvent.defaultPrevented).toBe(true)

    await trigger().trigger('keydown', { key: 'ArrowDown' })
    await trigger().trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toEqual([['b']])
    expect(wrapper.find('.select-base-options').exists()).toBe(false)
  })

  it('marks the selected option and starts keyboard navigation from it', async () => {
    const wrapper = mount(Dropdown, { props: { options, modelValue: 'b' } })
    const trigger = (): ReturnType<typeof wrapper.find> => wrapper.find('.select-base__value')

    await trigger().trigger('keydown', { key: 'Enter' })
    await nextTick()

    const items = wrapper.findAll('.select-base-options__item')
    expect(items[0]?.attributes('aria-selected')).toBe('false')
    expect(items[1]?.attributes('aria-selected')).toBe('true')
    expect(trigger().attributes('aria-activedescendant')).toBe(items[1]?.attributes('id'))

    await trigger().trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toEqual([['b']])
  })
})
