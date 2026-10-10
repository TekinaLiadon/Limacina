import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/05-entities'
import { useThemeSwitchState } from '@/04-features/theme/useTheme'
import ThemeModeToggle from '../ThemeModeToggle.vue'

const mountToggle = (variant: 'icons' | 'labels' = 'labels') =>
  mount(ThemeModeToggle, {
    props: { variant },
    global: { plugins: [createPinia()] },
  })

const segments = (wrapper: ReturnType<typeof mountToggle>) =>
  wrapper.findAll('button.theme-mode-toggle__segment')

describe('ThemeModeToggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('marks the active mode from the settings store', () => {
    useSettingsStore().setTheme('default-dark')
    const wrapper = mountToggle()

    const [dark, light] = segments(wrapper)
    expect(dark?.classes()).toContain('theme-mode-toggle__segment--active')
    expect(dark?.attributes('aria-pressed')).toBe('true')
    expect(light?.classes()).not.toContain('theme-mode-toggle__segment--active')
    expect(light?.attributes('aria-pressed')).toBe('false')

    wrapper.unmount()
  })

  it('switches the theme mode on click', async () => {
    useSettingsStore().setTheme('default-dark')
    const wrapper = mountToggle()

    const [, light] = segments(wrapper)
    await light?.trigger('click')

    expect(useSettingsStore().themeMode).toBe('light')

    wrapper.unmount()
  })

  it('disables the segments while the theme switch animation runs', async () => {
    const wrapper = mountToggle()
    const { isSwitching } = useThemeSwitchState()

    expect(segments(wrapper).every((segment) => segment.attributes('disabled') === undefined)).toBe(true)

    isSwitching.value = true
    await nextTick()

    expect(segments(wrapper).every((segment) => segment.attributes('disabled') !== undefined)).toBe(true)

    isSwitching.value = false
    await nextTick()
    expect(segments(wrapper).every((segment) => segment.attributes('disabled') === undefined)).toBe(true)

    wrapper.unmount()
  })

  it('renders icon segments for the icons variant', () => {
    const wrapper = mountToggle('icons')

    expect(wrapper.findAll('svg')).toHaveLength(2)
    expect(wrapper.find('button[aria-label="Тёмная тема"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Светлая тема"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
