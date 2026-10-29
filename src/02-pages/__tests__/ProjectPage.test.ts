import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { vFocus } from '@/06-shared'
import type { ProjectSettingsForm } from '@/05-entities'
import ProjectPage from '../settings/ProjectPage.vue'

const config = ref<ProjectSettingsForm>({
  projectName: 'Cordelia',
  mcVersion: '1.20.1',
  modLoader: 'fabric',
  loaderVersion: '0.15.0',
  javaPath: '/usr/lib/jvm/java-21',
  javaVersion: 21,
  jvmArgs: '',
  memoryRange: [512, 4096],
  cpuCores: null,
  online: true,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

const canDeleteProject = ref(true)

const handleSave = vi.fn()
const handleRefreshManifests = vi.fn()
const handleClearMinecraftConfig = vi.fn()
const handleDeleteProject = vi.fn()
const handleGetConnectUrl = vi.fn()
const handleCopyConnectUrl = vi.fn()
const selectJavaFolder = vi.fn()

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useProjectSettings: () => ({
      config,
      isLoaded: ref(true),
      isLoading: ref(false),
      loadError: ref(''),
      isDirty: ref(false),
      maxMemoryLimit: ref(8192),
      jvmArgsError: ref(''),
      isSaving: ref(false),
      isClearingConfig: ref(false),
      isRefreshingManifests: ref(false),
      isDeleting: ref(false),
      canDeleteProject,
      serverConnectUrl: ref(''),
      isLoadingConnectUrl: ref(false),
      selectJavaFolder,
      handleSave,
      handleClearMinecraftConfig,
      handleRefreshManifests,
      handleDeleteProject,
      handleGetConnectUrl,
      handleCopyConnectUrl,
      loadConfig: vi.fn(),
      retryLoad: vi.fn(),
    }),
    useAlternativeJava: () => ({
      distributions: ref([]),
      selectedDistribution: ref(''),
      javaVersion: ref(''),
      replaceDefault: ref(false),
      isDownloading: ref(false),
      isPopupOpen: ref(false),
      isDistributionsLoading: ref(false),
      distributionsError: ref(''),
      versionError: ref(''),
      openPopup: vi.fn(),
      closePopup: vi.fn(),
      startDownload: vi.fn(),
    }),
    useIntegrityCheck: () => ({
      steps: ref([]),
      progress: ref(0),
      isChecking: ref(false),
      isCheckingNow: ref(false),
      isPopupHidden: ref(false),
      report: ref(null),
      errorMessage: ref(''),
      hasErrors: ref(false),
      isClean: ref(false),
      resultText: ref(''),
      handleCheck: vi.fn(),
      closeResult: vi.fn(),
    }),
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
  setActivePinia(createPinia())
  config.value = {
    projectName: 'Cordelia',
    mcVersion: '1.20.1',
    modLoader: 'fabric',
    loaderVersion: '0.15.0',
    javaPath: '/usr/lib/jvm/java-21',
    javaVersion: 21,
    jvmArgs: '',
    memoryRange: [512, 4096],
    cpuCores: null,
    online: true,
    initialized: true,
    serverUrl: null,
    autoJoinServer: false,
  }
  canDeleteProject.value = true
  for (const handler of [handleSave, handleRefreshManifests, handleClearMinecraftConfig, handleDeleteProject, handleGetConnectUrl, handleCopyConnectUrl, selectJavaFolder]) {
    handler.mockClear()
  }
})

const mountProject = () =>
  mount(ProjectPage, {
    global: {
      directives: { focus: vFocus },
    },
  })

const sectionTitles = (wrapper: ReturnType<typeof mountProject>): string[] =>
  wrapper.findAll('.settings-section__title').map((title) => title.text())

describe('ProjectPage', () => {
  it('assembles the page from one widget per section', () => {
    const wrapper = mountProject()

    expect(sectionTitles(wrapper)).toEqual([
      'Сборка',
      'Запуск',
      'Java',
      'Подключение к серверу',
      'Обслуживание',
      'Опасная зона',
    ])

    wrapper.unmount()
  })

  it('drops the connect section for offline projects', async () => {
    const wrapper = mountProject()

    config.value.online = false
    await nextTick()

    expect(sectionTitles(wrapper)).not.toContain('Подключение к серверу')

    wrapper.unmount()
  })

  it('writes the build fields straight into the loaded form', async () => {
    const wrapper = mountProject()

    await wrapper.find('input.input__text').setValue('0.16.0')

    expect(config.value.loaderVersion).toBe('0.16.0')

    wrapper.unmount()
  })

  it('routes the save button to the project settings handler', async () => {
    const wrapper = mountProject()

    await wrapper.find('.settings-save-bar__btn').trigger('click')

    expect(handleSave).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('refreshes the manifests through the build widget', async () => {
    const wrapper = mountProject()

    await wrapper.find('.project-build__refresh-btn').trigger('click')

    expect(handleRefreshManifests).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('hides the project deletion for a pinned project', async () => {
    canDeleteProject.value = false
    const wrapper = mountProject()

    expect(wrapper.find('.project-danger__button').exists()).toBe(false)

    wrapper.unmount()
  })

  it('routes the project deletion to the project settings handler', async () => {
    const wrapper = mountProject()

    await wrapper.find('.project-danger__button').trigger('click')

    expect(handleDeleteProject).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
