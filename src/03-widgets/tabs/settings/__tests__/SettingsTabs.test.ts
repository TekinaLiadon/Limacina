import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import SettingsTabs from '../SettingsTabs.vue'

const routeState = vi.hoisted(() => ({ name: 'SettingsLauncher' }))
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRouter: (): { push: (location: unknown) => void } => ({ push: routerPush }),
  useRoute: (): { name: string } => routeState,
}))

const navItems = [
  { key: 'launcher', label: 'Лаунчер', routeName: 'SettingsLauncher', isAvailable: true, reason: '' },
  { key: 'project', label: 'Проект', routeName: 'SettingsProject', isAvailable: true, reason: '' },
  { key: 'game', label: 'Игра', routeName: 'SettingsGame', isAvailable: false, reason: 'Проект ещё не инициализирован' },
]

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useSettingsNav: () => ({ items: ref(navItems) }),
  }
})

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')

beforeAll((): void => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: (): Element | null => document.body,
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
})

afterAll((): void => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent)
  vi.unstubAllGlobals()
})

beforeEach((): void => {
  routeState.name = 'SettingsLauncher'
  navItems[2] = { key: 'game', label: 'Игра', routeName: 'SettingsGame', isAvailable: false, reason: 'Проект ещё не инициализирован' }
})

const setGameTabAvailable = (): void => {
  navItems[2] = { key: 'game', label: 'Игра', routeName: 'SettingsGame', isAvailable: true, reason: '' }
}

const mountTabs = () =>
  mount(SettingsTabs, {
    attachTo: document.body,
    slots: { default: '<div class="settings-tabs__probe">Панель</div>' },
  })

describe('SettingsTabs', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
    routerPush.mockClear()
  })

  it('labels the tablist and gives every tab an id, controls and roving tabindex', () => {
    const wrapper = mountTabs()

    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.attributes('aria-label')).toBe('Настройки')

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)

    const active = wrapper.find('#settings-tab-launcher')
    expect(active.attributes('role')).toBe('tab')
    expect(active.attributes('aria-selected')).toBe('true')
    expect(active.attributes('tabindex')).toBe('0')
    expect(active.attributes('aria-controls')).toBe('settings-tabpanel')

    const inactive = wrapper.find('#settings-tab-project')
    expect(inactive.attributes('aria-selected')).toBe('false')
    expect(inactive.attributes('tabindex')).toBe('-1')

    const unavailable = wrapper.find('#settings-tab-game')
    expect(unavailable.attributes('tabindex')).toBe('-1')

    wrapper.unmount()
  })

  it('binds the tabpanel to the active tab and renders the slot inside it', () => {
    routeState.name = 'SettingsProject'
    const wrapper = mountTabs()

    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe('settings-tabpanel')
    expect(panel.attributes('aria-labelledby')).toBe('settings-tab-project')
    expect(panel.find('.settings-tabs__probe').exists()).toBe(true)

    wrapper.unmount()
  })

  it('moves the roving focus with arrow keys and wraps at the ends', async () => {
    routeState.name = 'SettingsProject'
    setGameTabAvailable()
    const wrapper = mountTabs()

    const active = wrapper.find('#settings-tab-project')
    ;(active.element as HTMLElement).focus()
    active.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement?.id).toBe('settings-tab-game')

    const last = wrapper.find('#settings-tab-game')
    ;(last.element as HTMLElement).focus()
    last.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement?.id).toBe('settings-tab-launcher')

    const first = wrapper.find('#settings-tab-launcher')
    ;(first.element as HTMLElement).focus()
    first.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement?.id).toBe('settings-tab-game')

    wrapper.unmount()
  })

  it('skips unavailable tabs when moving the focus', () => {
    const wrapper = mountTabs()

    const first = wrapper.find('#settings-tab-launcher')
    ;(first.element as HTMLElement).focus()
    first.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement?.id).toBe('settings-tab-project')

    const second = wrapper.find('#settings-tab-project')
    ;(second.element as HTMLElement).focus()
    second.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement?.id).toBe('settings-tab-launcher')

    wrapper.unmount()
  })

  it('navigates only available tabs on click', async () => {
    const wrapper = mountTabs()

    await wrapper.find('#settings-tab-project').trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'SettingsProject' })

    await wrapper.find('#settings-tab-game').trigger('click')
    expect(routerPush).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
