import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import IconButton from './IconButton.vue'
import type { IconType } from '@/06-shared/types'

describe('IconButton', () => {
  it('renders a submit-safe button by default', () => {
    const wrapper = mount(IconButton, { props: { icon: 'settings' satisfies IconType } })

    expect(wrapper.find('button.icon-btn').attributes('type')).toBe('button')
  })

  it('omits the type attribute for non-button tags', () => {
    const wrapper = mount(IconButton, { props: { icon: 'settings' satisfies IconType, tag: 'span' } })

    expect(wrapper.find('span.icon-btn').attributes('type')).toBeUndefined()
  })
})
