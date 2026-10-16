import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore, type ModrinthInstalledMod, type ModrinthSearchHit } from '@/05-entities'
import Mods from '../Mods.vue'

const query = ref('')
const sort = ref('relevance')
const categories = ref<string[]>([])
const hits = ref<ModrinthSearchHit[]>([])
const total = ref(0)
const totalPages = ref(1)
const currentPage = ref(1)
const versionNumbers = ref<Record<string, string>>({})
const searchVersionsFailed = ref(false)
const isSearching = ref(false)
const searchError = ref('')
const installed = ref<ModrinthInstalledMod[]>([])
const isLoadingInstalled = ref(false)
const installedIds = computed((): Set<string> => new Set(installed.value.map((mod) => mod.project_id)))
const updates = ref<Record<string, string>>({})
const isCheckingUpdates = ref(false)
const installingId = ref<string | null>(null)
const isOpeningFolder = ref(false)
const actionError = ref('')
const installedError = ref('')
const activeHit = ref<ModrinthSearchHit | null>(null)
const isPopupVisible = ref(false)
const popupDetails = ref(null)
const isPopupLoading = ref(false)
const popupError = ref('')

const search = vi.fn()
const loadPage = vi.fn()
const loadInstalled = vi.fn()
const checkForUpdates = vi.fn()
const install = vi.fn()
const uninstall = vi.fn()
const openFolder = vi.fn()
const openDetails = vi.fn()
const closeDetails = vi.fn()

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useModrinth: () => ({
      query,
      sort,
      categories,
      hits,
      total,
      totalPages,
      currentPage,
      versionNumbers,
      searchVersionsFailed,
      isSearching,
      searchError,
      installed,
      isLoadingInstalled,
      installedIds,
      updates,
      isCheckingUpdates,
      installingId,
      isOpeningFolder,
      actionError,
      installedError,
      activeHit,
      isPopupVisible,
      popupDetails,
      isPopupLoading,
      popupError,
      search,
      loadPage,
      loadInstalled,
      checkForUpdates,
      install,
      uninstall,
      openFolder,
      openDetails,
      closeDetails,
    }),
  }
})

const makeHit = (id: string): ModrinthSearchHit => ({
  project_id: id,
  project_type: 'mod',
  slug: id,
  author: 'Автор',
  title: id,
  description: '',
  categories: [],
  downloads: 0,
  follows: 0,
  icon_url: null,
  date_created: null,
  date_modified: null,
  latest_version: null,
  license: null,
  client_side: null,
  server_side: null,
})

const makeInstalled = (id: string): ModrinthInstalledMod => ({
  project_id: id,
  slug: id,
  title: id,
  icon_url: null,
  filename: `${id}.jar`,
  version_number: '1.0.0',
  sha1: '0'.repeat(40),
})

const mountMods = () =>
  mount(Mods, {
    global: {
      plugins: [createPinia()],
      stubs: { ModrinthProjectPopup: true },
    },
  })

const viewTab = (wrapper: ReturnType<typeof mountMods>, label: string) =>
  wrapper.findAll('[role="tab"]').find((tab) => tab.text().startsWith(label))

describe('Mods', () => {
  beforeEach((): void => {
    setActivePinia(createPinia())
    hits.value = [makeHit('sodium')]
    total.value = 1
    installed.value = [makeInstalled('sodium')]
    sort.value = 'relevance'
    categories.value = []
    activeHit.value = null
    searchError.value = ''
    actionError.value = ''
    installedError.value = ''
    search.mockClear()
    loadPage.mockClear()
    loadInstalled.mockClear()
    uninstall.mockClear()
    openDetails.mockClear()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('opens on the catalog and loads both lists', () => {
    const wrapper = mountMods()

    expect(loadInstalled).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith(0)
    expect(wrapper.get('.mods-page__hint').text()).toBe(
      'Моды Modrinth для одиночного профиля. Требуемые зависимости устанавливаются автоматически.',
    )
    expect(wrapper.find('.modrinth-search').exists()).toBe(true)
    expect(wrapper.find('.modrinth-installed').exists()).toBe(false)

    wrapper.unmount()
  })

  it('switches to the installed list and back to the catalog', async () => {
    const wrapper = mountMods()

    await viewTab(wrapper, 'Установленные')?.trigger('click')
    expect(wrapper.find('.modrinth-installed').exists()).toBe(true)
    expect(wrapper.find('.modrinth-search').exists()).toBe(false)

    await viewTab(wrapper, 'Каталог')?.trigger('click')
    expect(wrapper.find('.modrinth-search').exists()).toBe(true)
    expect(wrapper.find('.modrinth-installed').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the profile loader error from both requests as a single line', () => {
    const message = 'моды Modrinth требуют загрузчик модов: выберите Fabric, Forge или NeoForge для профиля'
    searchError.value = message
    installedError.value = message

    const wrapper = mountMods()

    const errors = wrapper.findAll('.modrinth-catalog__error').map((node) => node.text())
    expect(errors).toEqual([message])

    wrapper.unmount()
  })

  it('reloads the first page when the filters change', async () => {
    const wrapper = mountMods()
    loadPage.mockClear()

    sort.value = 'downloads'
    await nextTick()
    expect(loadPage).toHaveBeenCalledWith(1)

    categories.value = ['optimization']
    await nextTick()
    expect(loadPage).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('asks for the first page again through the feature action', async () => {
    const wrapper = mountMods()
    loadPage.mockClear()

    await wrapper.get('.modrinth-search input').setValue('sodium')
    await wrapper.get('.modrinth-search .btn-primary').trigger('click')

    expect(loadPage).toHaveBeenCalledWith(1)

    wrapper.unmount()
  })

  it('opens the details popup for the catalog row', async () => {
    const wrapper = mountMods()

    await wrapper.get('.modrinth-row .btn-secondary').trigger('click')

    expect(openDetails).toHaveBeenCalledWith(hits.value[0])

    wrapper.unmount()
  })

  it('uninstalls a mod only after the confirmation', async () => {
    const wrapper = mountMods()
    await viewTab(wrapper, 'Установленные')?.trigger('click')

    const notificationStore = useNotificationStore()
    const confirm = vi.spyOn(notificationStore, 'confirm').mockResolvedValue(false)

    await wrapper.get('.modrinth-row .btn-danger').trigger('click')
    expect(confirm).toHaveBeenCalledWith('Удалить этот мод из профиля?')
    expect(uninstall).not.toHaveBeenCalled()

    confirm.mockResolvedValue(true)
    await wrapper.get('.modrinth-row .btn-danger').trigger('click')
    expect(uninstall).toHaveBeenCalledWith('sodium')

    wrapper.unmount()
  })
})
