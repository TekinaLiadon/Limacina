import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import Setup from '../Setup.vue'

const step = ref<1 | 2>(1)
const needsProfile = ref<boolean>(true)

vi.mock('vue-router', () => ({
  useRouter: (): { push: (location: unknown) => void; replace: (location: unknown) => void } => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useRoute: (): { name: string } => ({ name: 'Setup' }),
}))

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useOfflineSetup: () => ({ step, needsProfile }),
    useSetup: () => ({
      selectedPath: ref(''),
      isLoading: ref(false),
      fullDisplayPath: computed((): string => ''),
      selectFolder: vi.fn(),
      save: vi.fn(),
    }),
    useAddProfile: () => ({
      isSubmitting: ref(false),
      errorMessage: ref(''),
      serverForm: ref({ serverUrl: '' }),
      isServerValid: computed((): boolean => false),
      submitServer: vi.fn(),
    }),
    useOfflineProfileForm: () => ({
      kind: ref('offline'),
      offlineForm: ref({}),
      mcVersionOptions: ref([]),
      loaderOptions: ref([]),
      loaderVersionOptions: ref([]),
      needsLoaderVersion: computed((): boolean => false),
      isLoadingMcVersions: ref(false),
      isLoadingLoaderVersions: ref(false),
      mcVersionsError: ref(''),
      loaderVersionsError: ref(''),
      isOfflineValid: computed((): boolean => false),
      selectKind: vi.fn(),
      submitOffline: vi.fn(),
    }),
  }
})

const mountSetup = () =>
  mount(Setup, {
    global: {
      stubs: {
        ServerProfileForm: true,
        OfflineProfileForm: true,
      },
    },
  })

describe('Setup', () => {
  beforeEach((): void => {
    step.value = 1
    needsProfile.value = true
  })

  it('opens on the folder step and marks it in the wizard progress', () => {
    const wrapper = mountSetup()

    expect(wrapper.get('h1').text()).toBe('Настройка лаунчера')
    expect(wrapper.find('.setup-path-step').exists()).toBe(true)

    const items = wrapper.findAll('.setup-steps__item')
    expect(items).toHaveLength(2)
    expect(items[0]?.classes()).toContain('setup-steps__item--active')
    expect(items[1]?.classes()).not.toContain('setup-steps__item--active')

    wrapper.unmount()
  })

  it('switches to the profile step and leaves the head to the profile widget', () => {
    step.value = 2
    const wrapper = mountSetup()

    expect(wrapper.find('.setup-path-step').exists()).toBe(false)
    expect(wrapper.get('.add-profile-tab__eyebrow').text()).toBe('Первый запуск')
    expect(wrapper.get('h1').text()).toBe('Добавить профиль')

    const items = wrapper.findAll('.setup-steps__item')
    expect(items[1]?.classes()).toContain('setup-steps__item--active')

    wrapper.unmount()
  })

  it('hides the wizard progress when the launcher folder is already chosen', () => {
    needsProfile.value = false
    const wrapper = mountSetup()

    expect(wrapper.find('.setup-steps').exists()).toBe(false)

    wrapper.unmount()
  })
})
