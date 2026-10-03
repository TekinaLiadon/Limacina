import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import SelectBase from './SelectBase.vue'

const options = [
  { value: 'a', title: 'Alpha' },
  { value: 'b', title: 'Beta' },
]

const mountSelect = (disabled = false): VueWrapper =>
  mount(SelectBase, {
    props: {
      options,
      title: 'Pick one',
      isSelected: (value: string): boolean => value === 'a',
      disabled,
    },
  })

const pressKey = async (wrapper: VueWrapper, key: string): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  wrapper.find('.select-base__value').element.dispatchEvent(event)
  await nextTick()
  return event
}

describe('SelectBase', () => {
  it.each(['Enter', ' '])('opens the closed dropdown on %s and prevents the default action', async (key) => {
    const wrapper = mountSelect()
    expect(wrapper.find('.select-base-options').exists()).toBe(false)

    const event = await pressKey(wrapper, key)

    expect(wrapper.find('.select-base-options').exists()).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not open the closed dropdown on Enter while disabled', async () => {
    const wrapper = mountSelect(true)

    const event = await pressKey(wrapper, 'Enter')

    expect(wrapper.find('.select-base-options').exists()).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps the open-state keyboard behavior: arrows move, Enter selects, Escape closes', async () => {
    const wrapper = mountSelect()

    await pressKey(wrapper, 'ArrowDown')
    expect(wrapper.find('.select-base-options').exists()).toBe(true)

    await pressKey(wrapper, 'ArrowDown')
    expect(wrapper.find('.select-base-options__item--active').text()).toBe('Beta')

    await pressKey(wrapper, 'Enter')
    expect(wrapper.emitted('select')).toEqual([['b']])

    const escapeEvent = await pressKey(wrapper, 'Escape')
    expect(wrapper.find('.select-base-options').exists()).toBe(false)
    expect(escapeEvent.defaultPrevented).toBe(true)
  })

  it('selects the active option with Space while open', async () => {
    const wrapper = mountSelect()

    await pressKey(wrapper, 'ArrowDown')
    await pressKey(wrapper, ' ')

    expect(wrapper.emitted('select')).toEqual([['a']])
  })
})
