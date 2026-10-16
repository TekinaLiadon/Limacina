import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import AppLayout from '../AppLayout.vue'
import { Sidebar, ThemeModeToggle } from '@/03-widgets'
import { useCoreStore, type ProjectConfig } from '@/05-entities'

const currentRoute = { name: 'Accounts' }
const routerPush = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: (): { push: (location: unknown) => void } => ({ push: routerPush }),
  useRoute: (): { name: string } => currentRoute,
}))

const canSwitch = ref<boolean>(true)
const isProjectSwitching = ref<boolean>(false)
const projectOptions = ref([{ title: 'Cordelia', value: 'Cordelia' }])
const selectProject = vi.fn()
const settingsNavItems = ref([
  { key: 'launcher', label: 'Лаунчер', routeName: 'SettingsLauncher', isAvailable: true, reason: '' },
  { key: 'skin', label: 'Скин', routeName: 'SettingsSkin', isAvailable: true, reason: '' },
])

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useSettingsNav: () => ({ items: settingsNavItems }),
    useProjectSwitch: () => ({ projectOptions, canSwitch, isSwitching: isProjectSwitching, selectProject }),
  }
})

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
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

let pinia: Pinia

beforeEach((): void => {
  pinia = createPinia()
  setActivePinia(pinia)
  canSwitch.value = true
  isProjectSwitching.value = false
  currentRoute.name = 'Accounts'
})

afterEach((): void => {
  routerPush.mockClear()
  selectProject.mockClear()
})

const mountLayout = (showDebug = false) =>
  mount(AppLayout, {
    props: { showDebug },
    global: {
      plugins: [pinia],
      stubs: {
        ServerStatus: true,
        ServerUnavailableBanner: true,
        'router-view': true,
      },
    },
  })

describe('AppLayout', () => {
  it('renders the routed page and the server banner inside the content area', () => {
    const wrapper = mountLayout()

    const contentInner = wrapper.find('.app-layout__content-inner')
    expect(contentInner.find('server-unavailable-banner-stub').exists()).toBe(true)
    expect(contentInner.find('router-view-stub').exists()).toBe(true)

    wrapper.unmount()
  })

  it('resolves the sidebar active tab from the route name', () => {
    const accounts = mountLayout()
    expect(accounts.findComponent(Sidebar).props('activeTab')).toBe('accounts')
    accounts.unmount()

    currentRoute.name = 'SettingsSkin'
    const settings = mountLayout()
    expect(settings.findComponent(Sidebar).props('activeTab')).toBe('settings')
    expect(settings.findComponent(Sidebar).props('settingsSubTab')).toBe('SettingsSkin')
    settings.unmount()
  })

  it('passes the debug flag and the offline state to the sidebar', () => {
    useCoreStore().projectConfig = makeProjectConfig(false)
    const wrapper = mountLayout(true)

    const sidebar = wrapper.findComponent(Sidebar)
    expect(sidebar.props('showDebug')).toBe(true)
    expect(sidebar.props('showMods')).toBe(true)

    wrapper.unmount()
  })

  it('shows the project dropdown only when the launcher knows its projects', async () => {
    const wrapper = mountLayout()
    expect(wrapper.find('.app-layout__project').exists()).toBe(false)
    expect(wrapper.findComponent(ThemeModeToggle).exists()).toBe(true)

    useCoreStore().projects = ['Cordelia']
    await nextTick()
    expect(wrapper.find('.app-layout__project').exists()).toBe(true)

    canSwitch.value = false
    await nextTick()
    expect(wrapper.find('.select-base').classes()).toContain('disabled')

    wrapper.unmount()
  })

  it('navigates through the sidebar events and ignores tabs without a route', async () => {
    const wrapper = mountLayout()
    const sidebar = wrapper.findComponent(Sidebar)

    sidebar.vm.$emit('navigate', 'settings')
    expect(routerPush).toHaveBeenCalledWith({ name: 'SettingsLauncher' })

    sidebar.vm.$emit('navigate-settings', 'SettingsSkin')
    expect(routerPush).toHaveBeenCalledWith({ name: 'SettingsSkin' })

    sidebar.vm.$emit('navigate', 'debug')
    expect(routerPush).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })
})
