import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import AddProfileTab from '../AddProfileTab.vue'

vi.mock('vue-router', () => ({
  useRouter: (): { push: (location: unknown) => void } => ({ push: vi.fn() }),
}))

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
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

const mountTab = (embedded: boolean) =>
  mount(AddProfileTab, {
    props: { embedded },
    global: {
      stubs: {
        ServerProfileForm: true,
        OfflineProfileForm: true,
      },
    },
  })

describe('AddProfileTab', () => {
  it('renders its own title and no step eyebrow on the standalone route', () => {
    const wrapper = mountTab(false)

    expect(wrapper.get('h2').text()).toBe('Добавить профиль')
    expect(wrapper.find('.add-profile-tab__eyebrow').exists()).toBe(false)
    expect(wrapper.classes()).not.toContain('add-profile-tab--embedded')

    wrapper.unmount()
  })

  it('carries the first-run step head when embedded in the setup wizard', () => {
    const wrapper = mountTab(true)

    expect(wrapper.get('.add-profile-tab__eyebrow').text()).toBe('Первый запуск')
    expect(wrapper.get('h1').text()).toBe('Добавить профиль')
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.classes()).toContain('add-profile-tab--embedded')

    wrapper.unmount()
  })
})
