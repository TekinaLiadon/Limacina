import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ThemeSelector from '../ThemeSelector.vue'
import { useSettingsStore } from '@/05-entities'

const FAMILY_IDS = ['default', 'night', 'lime', 'spark', 'monologue']

const mountSelector = () => {
  setActivePinia(createPinia())
  return mount(ThemeSelector, { attachTo: document.body })
}

describe('ThemeSelector', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('renders the families as a radiogroup with a roving tabindex on the active one', () => {
    const wrapper = mountSelector()

    const group = wrapper.find('[role="radiogroup"]')
    expect(group.attributes('aria-label')).toBe('Тема оформления')

    const radios = wrapper.findAll('[role="radio"]')
    expect(radios).toHaveLength(FAMILY_IDS.length)
    const checked = radios.findIndex((radio) => radio.attributes('aria-checked') === 'true')
    expect(checked).toBe(0)
    radios.forEach((radio, index) => {
      expect(radio.attributes('tabindex')).toBe(index === checked ? '0' : '-1')
    })

    wrapper.unmount()
  })

  it('moves focus and the selection to the next family with ArrowDown', async () => {
    const wrapper = mountSelector()
    const first = wrapper.get('#theme-family-default')
    ;(first.element as HTMLElement).focus()

    await first.trigger('keydown', { key: 'ArrowDown' })

    expect(document.activeElement?.id).toBe('theme-family-night')
    const night = wrapper.get('#theme-family-night')
    expect(night.attributes('aria-checked')).toBe('true')
    expect(night.attributes('tabindex')).toBe('0')
    expect(wrapper.get('#theme-family-default').attributes('tabindex')).toBe('-1')
    expect(useSettingsStore().themeFamily).toBe('night')

    wrapper.unmount()
  })

  it('wraps to the last family with ArrowLeft', async () => {
    const wrapper = mountSelector()
    const first = wrapper.get('#theme-family-default')
    ;(first.element as HTMLElement).focus()

    await first.trigger('keydown', { key: 'ArrowLeft' })

    expect(document.activeElement?.id).toBe('theme-family-monologue')
    expect(wrapper.get('#theme-family-monologue').attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })

  it('keeps click selecting the family', async () => {
    const wrapper = mountSelector()

    await wrapper.get('#theme-family-lime').trigger('click')

    expect(useSettingsStore().themeFamily).toBe('lime')
    expect(wrapper.get('#theme-family-lime').attributes('aria-checked')).toBe('true')

    wrapper.unmount()
  })
})
