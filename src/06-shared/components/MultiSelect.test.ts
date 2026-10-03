import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import MultiSelect from './MultiSelect.vue'

const options = [
  { value: 'a', title: 'Alpha' },
  { value: 'b', title: 'Beta' },
]

describe('MultiSelect', () => {
  it('opens the closed list with Space and toggles options with the keyboard', async () => {
    const wrapper = mount(MultiSelect, { props: { options, modelValue: [] } })
    const trigger = (): ReturnType<typeof wrapper.find> => wrapper.find('.select-base__value')

    const openEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    trigger().element.dispatchEvent(openEvent)
    await nextTick()

    expect(wrapper.find('.select-base-options').exists()).toBe(true)
    expect(openEvent.defaultPrevented).toBe(true)

    await trigger().trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['a']])

    await wrapper.setProps({ modelValue: ['a'] })

    await trigger().trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([[]])
  })
})
