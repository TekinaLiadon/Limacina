import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ThemeSwitchAnimation from '../ThemeSwitchAnimation.vue'

type Direction = 'to-light' | 'to-dark'

const mountAnimation = (visible: boolean, direction: Direction = 'to-light') =>
  mount(ThemeSwitchAnimation, {
    props: { visible, direction },
    attachTo: document.body,
  })

describe('ThemeSwitchAnimation', () => {
  it('renders nothing while invisible', () => {
    const wrapper = mountAnimation(false)

    expect(wrapper.find('.theme-switch-overlay').exists()).toBe(false)

    wrapper.unmount()
  })

  it('renders the girl with the to-light modifier while switching', () => {
    const wrapper = mountAnimation(true, 'to-light')

    expect(wrapper.find('.theme-switch-overlay').exists()).toBe(true)
    expect(wrapper.find('.theme-switch-overlay__girl--to-light').exists()).toBe(true)
    expect(wrapper.find('img.theme-switch-overlay__girl-anim').exists()).toBe(true)

    wrapper.unmount()
  })

  it('renders the girl with the to-dark modifier for dark transition', () => {
    const wrapper = mountAnimation(true, 'to-dark')

    expect(wrapper.find('.theme-switch-overlay__girl--to-dark').exists()).toBe(true)
    expect(wrapper.find('.theme-switch-overlay__girl--to-light').exists()).toBe(false)

    wrapper.unmount()
  })

  it('hides the overlay when visible turns false', async () => {
    const wrapper = mountAnimation(true, 'to-dark')

    await wrapper.setProps({ visible: false })
    await nextFrame()

    expect(wrapper.find('.theme-switch-overlay').exists()).toBe(false)

    wrapper.unmount()
  })
})

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}
