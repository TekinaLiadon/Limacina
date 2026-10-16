import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type VNode } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import App from '../App.vue'
import { useCoreStore } from '@/05-entities'

const currentRoute = { name: 'Accounts' }
const startConsoleStream = vi.fn()
const startLaunchStepsStream = vi.fn()
const startSystemNotifications = vi.fn()
const startServerStatusSync = vi.fn()
const startServerAvailabilitySync = vi.fn()
const startGameSessionSync = vi.fn()
const retryInit = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: (): { replace: (location: unknown) => void } => ({ replace: vi.fn() }),
  useRoute: (): { name: string } => currentRoute,
}))

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  const { ref: createRef } = await import('vue')
  return {
    ...actual,
    useAppInit: () => ({ preloaderText: createRef('Загрузка'), startupError, retryInit }),
    useTheme: () => ({ isSwitching: createRef(false), switchDirection: createRef('dark-to-light') }),
    useConsoleStream: () => ({ startConsoleStream }),
    useLaunchStepsStream: () => ({ startLaunchStepsStream }),
    useSystemNotifications: () => ({ startSystemNotifications }),
    useServerStatus: () => ({ startServerStatusSync }),
    useServerAvailability: () => ({ startServerAvailabilitySync }),
    useGameSession: () => ({ startGameSessionSync }),
    useCpmProjectOpen: (): void => {},
    useAppNavigation: () => ({ isDebugTabVisible }),
  }
})

const startupError = ref('')
const isDebugTabVisible = ref(false)

let pinia: Pinia

beforeEach((): void => {
  pinia = createPinia()
  setActivePinia(pinia)
  startupError.value = ''
  isDebugTabVisible.value = false
  currentRoute.name = 'Accounts'
})

afterEach((): void => {
  retryInit.mockClear()
})

const AppLayoutStub = defineComponent({
  name: 'AppLayoutStub',
  props: { showDebug: { type: Boolean, required: true } },
  setup: () => (): VNode => h('div', { class: 'app-layout-stub' }),
})

const mountApp = () =>
  mount(App, {
    global: {
      plugins: [pinia],
      stubs: {
        AppLayout: AppLayoutStub,
        Preloader: true,
        StartupError: true,
        PushNotification: true,
        ConfirmPopup: true,
        ThemeSwitchAnimation: true,
        'router-view': true,
      },
    },
  })

const findLayout = (wrapper: ReturnType<typeof mountApp>) => wrapper.findComponent(AppLayoutStub)

describe('App', () => {
  it('shows only the preloader while the launcher is starting', () => {
    const wrapper = mountApp()

    expect(wrapper.find('preloader-stub').exists()).toBe(true)
    expect(findLayout(wrapper).exists()).toBe(false)
    expect(wrapper.find('router-view-stub').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the startup error above the layout', async () => {
    useCoreStore().isLoading = false
    startupError.value = 'Не удалось получить данные лаунчера'
    const wrapper = mountApp()

    expect(wrapper.find('startup-error-stub').exists()).toBe(true)
    expect(findLayout(wrapper).exists()).toBe(false)

    wrapper.unmount()
  })

  it('renders the layout for regular routes and the bare route view for fullscreen routes', () => {
    useCoreStore().isLoading = false
    const layout = mountApp()

    expect(findLayout(layout).exists()).toBe(true)
    expect(layout.find('router-view-stub').exists()).toBe(false)
    layout.unmount()

    currentRoute.name = 'Setup'
    const fullscreen = mountApp()

    expect(findLayout(fullscreen).exists()).toBe(false)
    expect(fullscreen.find('router-view-stub').exists()).toBe(true)
    fullscreen.unmount()
  })

  it('passes the debug flag to the layout and shows the launcher version', async () => {
    useCoreStore().isLoading = false
    useCoreStore().version = '0.6.4'
    isDebugTabVisible.value = true
    const wrapper = mountApp()

    await nextTick()
    expect(findLayout(wrapper).props('showDebug')).toBe(true)
    expect(wrapper.find('.app__version').text()).toBe('v0.6.4')

    wrapper.unmount()
  })
})
