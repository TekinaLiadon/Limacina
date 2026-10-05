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
})
