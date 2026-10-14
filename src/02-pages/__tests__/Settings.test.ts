import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Settings from '../Settings.vue'

const currentRoute = { name: 'SettingsLauncher' }
const routerPush = vi.fn()
const routerReplace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: (): { push: (location: unknown) => void; replace: (location: unknown) => void } => ({
    push: routerPush,
    replace: routerReplace,
  }),
  useRoute: (): { name: string } => currentRoute,
}))

const navItems = [
  { key: 'launcher', label: 'Лаунчер', routeName: 'SettingsLauncher', isAvailable: true, reason: '' },
  { key: 'project', label: 'Проект', routeName: 'SettingsProject', isAvailable: true, reason: '' },
  { key: 'game', label: 'Игра', routeName: 'SettingsGame', isAvailable: false, reason: 'Проект ещё не инициализирован' },
]

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  const { ref } = await import('vue')
  return {
    ...actual,
    useProjectSettings: () => ({
      config: ref({ online: true }),
      isLoaded: ref(true),
    }),
    useSettingsNav: () => ({ items: ref(navItems) }),
    useSettingsDirtyGuard: (): void => {},
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

const mountSettings = () =>
  mount(Settings, {
    attachTo: document.body,
    global: {
      stubs: {
        'router-view': true,
      },
    },
  })

describe('Settings', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
    routerPush.mockClear()
    routerReplace.mockClear()
  })

  it('labels the tablist and gives every tab an id, controls and roving tabindex', () => {
    const wrapper = mountSettings()

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

  it('binds the tabpanel to the active tab', () => {
    const wrapper = mountSettings()

    const panel = wrapper.find('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe('settings-tabpanel')
    expect(panel.attributes('aria-labelledby')).toBe('settings-tab-launcher')

    wrapper.unmount()
  })

  it('moves the roving focus with arrow keys and wraps at the ends', async () => {
    currentRoute.name = 'SettingsProject'
    navItems[2] = { ...navItems[2]!, isAvailable: true }
    const wrapper = mountSettings()

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
    currentRoute.name = 'SettingsLauncher'
    navItems[2] = { ...navItems[2]!, isAvailable: false }
  })

  it('navigates only available tabs on click', async () => {
    const wrapper = mountSettings()

    await wrapper.find('#settings-tab-project').trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'SettingsProject' })

    await wrapper.find('#settings-tab-game').trigger('click')
    expect(routerPush).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
