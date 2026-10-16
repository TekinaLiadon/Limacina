import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
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

const projectConfig = ref({ online: true })
const isLoaded = ref(true)

const navItems = [
  { key: 'launcher', label: 'Лаунчер', routeName: 'SettingsLauncher', isAvailable: true, reason: '' },
  { key: 'project', label: 'Проект', routeName: 'SettingsProject', isAvailable: true, reason: '' },
  { key: 'game', label: 'Игра', routeName: 'SettingsGame', isAvailable: false, reason: 'Проект ещё не инициализирован' },
]

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useProjectSettings: () => ({ config: projectConfig, isLoaded }),
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

beforeEach((): void => {
  currentRoute.name = 'SettingsLauncher'
  projectConfig.value = { online: true }
  isLoaded.value = true
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

  it('renders the page title and mounts the tabs widget over the route outlet', () => {
    const wrapper = mountSettings()

    expect(wrapper.find('.settings-page__title').text()).toBe('Настройки')

    const panel = wrapper.find('.settings-tabs__panel')
    expect(panel.attributes('role')).toBe('tabpanel')
    expect(panel.find('router-view-stub').exists()).toBe(true)

    wrapper.unmount()
  })

  it('redirects off the account tab to the launcher tab when the project is offline', () => {
    currentRoute.name = 'SettingsAccount'
    projectConfig.value = { online: false }
    const wrapper = mountSettings()

    expect(routerReplace).toHaveBeenCalledWith({ name: 'SettingsLauncher' })

    wrapper.unmount()
  })

  it('keeps the account tab until the project config is loaded', () => {
    currentRoute.name = 'SettingsAccount'
    projectConfig.value = { online: false }
    isLoaded.value = false
    const wrapper = mountSettings()

    expect(routerReplace).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('leaves the other tabs alone when the project is offline', () => {
    currentRoute.name = 'SettingsProject'
    projectConfig.value = { online: false }
    const wrapper = mountSettings()

    expect(routerReplace).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
