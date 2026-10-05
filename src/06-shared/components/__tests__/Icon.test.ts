import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from '../Icon.vue'
import type { IconType } from '@/06-shared/types'

const ICON_TYPES: IconType[] = ['home', 'referals', 'settings', 'puzzle', 'chevron-down', 'arrow-right']

describe('Icon', () => {
  it.each(ICON_TYPES)('renders the %s svg with the icon envelope', (type) => {
    const wrapper = mount(Icon, { props: { type } })
    const svg = wrapper.find('svg.icon')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 1024 1024')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.find('path').exists()).toBe(true)
  })
})
