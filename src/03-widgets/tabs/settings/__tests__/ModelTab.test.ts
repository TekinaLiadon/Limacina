import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref, ShallowRef } from 'vue'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ModelTab from '../ModelTab.vue'

enableAutoUnmount(afterEach)

interface TestHandlers {
  selectCpmFile: ReturnType<typeof vi.fn>
  resetCpm: ReturnType<typeof vi.fn>
  handleUploadModel: ReturnType<typeof vi.fn>
  handleDeleteModel: ReturnType<typeof vi.fn>
  handleSaveModelOffline: ReturnType<typeof vi.fn>
  loadCatalog: ReturnType<typeof vi.fn>
  selectPreset: ReturnType<typeof vi.fn>
  retryPreset: ReturnType<typeof vi.fn>
  clearSelection: ReturnType<typeof vi.fn>
  selectSkinFile: ReturnType<typeof vi.fn>
  applyPreset: ReturnType<typeof vi.fn>
  loadItems: ReturnType<typeof vi.fn>
}

interface TestMocks {
  content: Record<string, unknown>
  settings: Record<string, unknown>
  models: Record<string, unknown>
  flow: Record<string, unknown>
  animations: Record<string, unknown>
  handlers: TestHandlers
  injections: {
    modelContent: unknown[]
    cpmSettings: unknown[]
    presetApply: unknown[]
  }
}

const mocks = vi.hoisted(() => ({ api: null as unknown }))
const mocked = (): TestMocks => mocks.api as TestMocks

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  const vue = await import('vue')

  const handlers: TestHandlers = {
    selectCpmFile: vi.fn(),
    resetCpm: vi.fn().mockResolvedValue(undefined),
    handleUploadModel: vi.fn().mockResolvedValue(undefined),
    handleDeleteModel: vi.fn().mockResolvedValue(undefined),
    handleSaveModelOffline: vi.fn().mockResolvedValue(undefined),
    loadCatalog: vi.fn().mockResolvedValue(undefined),
    selectPreset: vi.fn().mockResolvedValue(undefined),
    retryPreset: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
    selectSkinFile: vi.fn(),
    applyPreset: vi.fn().mockResolvedValue(undefined),
    loadItems: vi.fn().mockResolvedValue(undefined),
  }

  const errorMessage = vue.ref('')
  const isOffline = vue.ref(false)

  const preview = {
    cpmData: { config: { skinSize: { x: 64, y: 64 }, elements: [] }, textureUrl: 'blob:preview' },
    dressed: null,
  }

  const injections = { modelContent: [], cpmSettings: [], presetApply: [] }

  mocks.api = {
    handlers,
    injections,
    content: {
      items: vue.ref([]),
      isListLoading: vue.ref(false),
      listError: vue.ref(''),
      errorMessage,
      isOffline,
      loadItems: handlers.loadItems,
      handleCopyUrl: vi.fn(),
    },
    settings: {
      cpmData: vue.shallowRef(null),
      cpmFileBytes: vue.ref(new Uint8Array([1, 2, 3])),
      cpmSkinPng: vue.ref(null),
      modelName: vue.computed(() => 'Модель'),
      errorMessage,
      showEmptyLayers: vue.ref(false),
      activeLayerIds: vue.computed(() => []),
      layerPanelData: vue.ref({
        tabs: ['Root'],
        Root: [{ id: '5', label: 'Body', disabled: false }],
      }),
      visibleLayerKeys: vue.ref<string[]>(['5']),
      setVisibleLayerKeys: vi.fn(),
      setTextureError: vi.fn(),
      isUploading: vue.ref(false),
      isDragOver: vue.ref(false),
      selectCpmFile: handlers.selectCpmFile,
      resetCpm: handlers.resetCpm,
      handleUploadModel: handlers.handleUploadModel,
      handleDeleteModel: handlers.handleDeleteModel,
      handleCopyUrl: vi.fn(),
    },
    models: {
      entries: vue.ref([]),
      isListLoading: vue.ref(false),
      listError: vue.ref(''),
      loadCatalog: handlers.loadCatalog,
      selectedSlug: vue.ref<string | null>(null),
      preset: vue.shallowRef(null),
      previewSkinBytes: vue.shallowRef<Uint8Array | null>(null),
      isPresetLoading: vue.ref(false),
      presetError: vue.ref(''),
      selectPreset: handlers.selectPreset,
      retryPreset: handlers.retryPreset,
      clearSelection: handlers.clearSelection,
    },
    flow: {
      skinImage: vue.shallowRef(null),
      skinMode: vue.ref<'classic' | 'slim'>('classic'),
      skinWarnings: vue.ref<string[]>([]),
      preview: vue.shallowRef(preview),
      activeLayerIds: vue.ref<number[]>([]),
      isApplying: vue.ref(false),
      isDragOver: vue.ref(false),
      selectSkinFile: handlers.selectSkinFile,
      applyPreset: handlers.applyPreset,
    },
    animations: {
      animationGroups: vue.ref([]),
      selectedAnimationIds: vue.ref<string[]>([]),
      activeAnimations: vue.computed(() => []),
      isAnimationPlaying: vue.ref(false),
      isAnimationLooped: vue.ref(false),
      animationSpeed: vue.ref(1),
      canSpeedDown: vue.computed(() => true),
      canSpeedUp: vue.computed(() => true),
      toggleAnimationPlayback: vi.fn(),
      toggleAnimationLoop: vi.fn(),
      speedDown: vi.fn(),
      speedUp: vi.fn(),
    },
  }

  const api = mocks.api as unknown as TestMocks

  return {
    ...actual,
    useModelUserContent: (): unknown => {
      api.injections.modelContent.push(api.content)
      return api.content
    },
    useCpmSettings: (content: unknown): unknown => {
      api.injections.cpmSettings.push(content)
      return api.settings
    },
    useOfflineCpmModel: (): unknown => ({
      isSaving: vue.ref(false),
      handleSaveModelOffline: handlers.handleSaveModelOffline,
    }),
    usePresetModels: (): unknown => {
      void api.injections
      return api.models
    },
    usePresetSkinApply: (source: { content?: unknown }): unknown => {
      api.injections.presetApply.push(source.content)
      return api.flow
    },
    useCpmAnimations: (): unknown => api.animations,
  }
})

const CpmViewerStub = {
  name: 'CpmViewer',
  template: '<div class="cpm-viewer__canvas" />',
}

const CpmAnimationPanelStub = {
  name: 'CpmAnimationPanel',
  props: ['data', 'modelValue', 'hasAnimation', 'isPlaying', 'isLooped', 'speed', 'canSpeedDown', 'canSpeedUp'],
  template: '<div class="cpm-animation-panel-stub" />',
}

const OWN_CPM_DATA = {
  config: { skinSize: { x: 64, y: 64 }, elements: [] },
  textureUrl: 'blob:model',
}

const PRESET = {
  config: { skinSize: { x: 64, y: 64 }, elements: [] },
  meta: { name: 'Женское тело', slug: 'female-body', skinType: 'both' },
  animations: [],
  animEnc: null,
}

const CATALOG = [
  { slug: 'female-body', name: 'Женское тело', skinType: 'both', previewUrl: 'blob:preview' },
  { slug: 'hero', name: 'Hero', skinType: 'slim', previewUrl: null },
]

const SKIN = { width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4) }

const mountTab = (): VueWrapper =>
  mount(ModelTab, {
    global: {
      stubs: {
        CpmViewer: CpmViewerStub,
        CpmAnimationPanel: CpmAnimationPanelStub,
      },
    },
  })

const findButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label)

const clickAction = async (wrapper: VueWrapper, label: string): Promise<void> => {
  const action = findButton(wrapper, label)
  if (!action) throw new Error(`кнопка «${label}» не найдена`)
  await action.trigger('click')
  await flushPromises()
}

const openPresetTab = async (wrapper: VueWrapper): Promise<void> => {
  await clickAction(wrapper, 'Готовая модель')
}

beforeEach(() => {
  const api = mocked()
  ;(api.content.items as Ref<unknown[]>).value = []
  ;(api.content.isListLoading as Ref<boolean>).value = false
  ;(api.content.listError as Ref<string>).value = ''
  ;(api.content.errorMessage as Ref<string>).value = ''
  ;(api.content.isOffline as Ref<boolean>).value = false
  ;(api.settings.cpmData as ShallowRef<unknown>).value = null
  ;(api.models.entries as Ref<unknown[]>).value = CATALOG
  ;(api.models.isListLoading as Ref<boolean>).value = false
  ;(api.models.listError as Ref<string>).value = ''
  ;(api.models.selectedSlug as Ref<string | null>).value = null
  ;(api.models.preset as ShallowRef<unknown>).value = null
  ;(api.models.isPresetLoading as Ref<boolean>).value = false
  ;(api.models.presetError as Ref<string>).value = ''
  ;(api.flow.skinImage as ShallowRef<unknown>).value = null
  ;(api.flow.skinMode as Ref<'classic' | 'slim'>).value = 'classic'
  ;(api.flow.skinWarnings as Ref<string[]>).value = []
  ;(api.flow.preview as ShallowRef<unknown>).value = null
  ;(api.flow.isApplying as Ref<boolean>).value = false
  ;(api.animations.animationGroups as Ref<unknown[]>).value = []
  api.injections.modelContent.length = 0
  api.injections.cpmSettings.length = 0
  api.injections.presetApply.length = 0
  for (const handler of Object.values(api.handlers)) handler.mockClear()
})

describe('ModelTab', () => {
  it('shares the user content instance between both flows', () => {
    mountTab()
    const api = mocked()

    expect(api.injections.modelContent).toHaveLength(1)
    expect(api.injections.cpmSettings).toEqual([api.injections.modelContent[0]])
    expect(api.injections.presetApply).toEqual([api.injections.modelContent[0]])
  })

  it('defaults to the own model tab with an empty viewer hint', () => {
    const wrapper = mountTab()

    const modes = wrapper.findAll('.model-tab__mode-btn')
    expect(modes.map((mode) => mode.text())).toEqual(['Своя модель', 'Готовая модель'])
    expect(modes[0]!.classes()).toContain('model-tab__mode-btn--active')
    expect(wrapper.find('.model-tab__viewer-empty').text()).toContain('Загрузите модель')
    expect(wrapper.find('.user-content-viewer__hint').text()).toBe('Формат: .cpmproject или .bbmodel, не более 4 МБ')
    expect(wrapper.find('.model-tab__preset').exists()).toBe(false)
  })

  it('offers the model dialog with a replace label once a model is loaded', async () => {
    const api = mocked()
    const wrapper = mountTab()

    await clickAction(wrapper, 'Загрузить модель')
    expect(api.handlers.selectCpmFile).toHaveBeenCalledTimes(1)

    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    await flushPromises()

    expect(findButton(wrapper, 'Заменить модель')).toBeDefined()
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(true)
    expect(wrapper.find('.model-tab__viewer-empty').exists()).toBe(false)
  })

  it('renders the layers panel with the empty layers checkbox', async () => {
    const api = mocked()
    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    const wrapper = mountTab()

    expect(wrapper.find('.model-tab__layer-panel').exists()).toBe(true)
    expect(wrapper.find('.cpm-tabbed-panel__title').text()).toContain('Слои')
    expect(findButton(wrapper, 'Загрузить модель')).toBeUndefined()
  })

  it('sends the own model online', async () => {
    const api = mocked()
    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    const wrapper = mountTab()

    await clickAction(wrapper, 'Отправить')
    expect(api.handlers.handleUploadModel).toHaveBeenCalledTimes(1)
    expect(api.handlers.handleSaveModelOffline).not.toHaveBeenCalled()
  })

  it('saves the own model into the game offline with a notice', async () => {
    const api = mocked()
    ;(api.content.isOffline as Ref<boolean>).value = true
    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    const wrapper = mountTab()

    expect(wrapper.find('.user-content-viewer__notice').text()).toContain('Локальный профиль')

    await clickAction(wrapper, 'Сохранить в игру')
    expect(api.handlers.handleSaveModelOffline).toHaveBeenCalledTimes(1)
    expect(api.handlers.handleUploadModel).not.toHaveBeenCalled()
  })

  it('resets the own model and deletes list items through the shared content', async () => {
    const api = mocked()
    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    ;(api.content.items as Ref<unknown[]>).value = [{ id: 3, url: 'https://cdn/m.txt', active: false }]
    const wrapper = mountTab()

    await clickAction(wrapper, 'Сбросить модель')
    expect(api.handlers.resetCpm).toHaveBeenCalledTimes(1)

    await wrapper.find('.user-content-list .btn-danger').trigger('click')
    await flushPromises()
    expect(api.handlers.handleDeleteModel).toHaveBeenCalledWith(3)
  })

  it('auto-selects the first catalog entry for the preset tab', async () => {
    const api = mocked()
    mountTab()
    await flushPromises()

    expect(api.handlers.selectPreset).toHaveBeenCalledWith('female-body')
  })

  it('renders the preset catalog states', async () => {
    const api = mocked()
    ;(api.models.entries as Ref<unknown[]>).value = []
    ;(api.models.isListLoading as Ref<boolean>).value = true
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(wrapper.find('.preloader').exists()).toBe(true)

    ;(api.models.isListLoading as Ref<boolean>).value = false
    ;(api.models.listError as Ref<string>).value = 'Не удалось загрузить каталог моделей'
    await flushPromises()
    expect(wrapper.find('.load-error-row').text()).toContain('каталог')
    await wrapper.find('.load-error-row__btn').trigger('click')
    expect(api.handlers.loadCatalog).toHaveBeenCalledTimes(1)

    ;(api.models.listError as Ref<string>).value = ''
    await flushPromises()
    expect(wrapper.find('.model-tab__preset-empty').text()).toContain('Готовых моделей пока нет')
  })

  it('selects a preset by name in the dropdown', async () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    ;(api.models.selectedSlug as Ref<string | null>).value = 'female-body'
    ;(api.flow.preview as ShallowRef<unknown>).value = {
      cpmData: { config: { skinSize: { x: 64, y: 64 }, elements: [] }, textureUrl: 'blob:preview' },
      dressed: null,
    }
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(wrapper.find('.model-tab__preset-select .select-base__title').text()).toBe('Женское тело')
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(true)

    await wrapper.find('.model-tab__preset-select .select-base__value').trigger('click')
    const options = wrapper.findAll('.select-base-options__item')
    expect(options.map((option) => option.text())).toEqual(['Женское тело', 'Hero'])
    await options[1]!.trigger('click')
    expect(api.handlers.selectPreset).toHaveBeenCalledWith('hero')
  })

  it('requires a skin before applying the preset', async () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(wrapper.find('.model-tab__hint').text()).toContain('Загрузите свой скин')
    expect(findButton(wrapper, 'Отправить')!.attributes('disabled')).toBeDefined()

    await clickAction(wrapper, 'Загрузить скин')
    expect(api.handlers.selectSkinFile).toHaveBeenCalledTimes(1)
  })

  it('applies the preset with warnings and the skin mode switch', async () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    ;(api.flow.skinImage as ShallowRef<unknown>).value = SKIN
    ;(api.flow.skinWarnings as Ref<string[]>).value = ['Пресет рассчитан на slim-модель, а выбран classic-скин']
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(wrapper.find('.model-tab__hint').exists()).toBe(false)
    expect(wrapper.find('.model-tab__warning').text()).toContain('рассчитан на slim')
    expect(findButton(wrapper, 'Отправить')!.attributes('disabled')).toBeUndefined()

    await clickAction(wrapper, 'Слим')
    expect((api.flow.skinMode as Ref<'classic' | 'slim'>).value).toBe('slim')

    await clickAction(wrapper, 'Отправить')
    expect(api.handlers.applyPreset).toHaveBeenCalledTimes(1)
  })

  it('saves the dressed preset into the game offline', async () => {
    const api = mocked()
    ;(api.content.isOffline as Ref<boolean>).value = true
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    ;(api.flow.skinImage as ShallowRef<unknown>).value = SKIN
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(findButton(wrapper, 'Отправить')).toBeUndefined()

    await clickAction(wrapper, 'Сохранить в игру')
    expect(api.handlers.applyPreset).toHaveBeenCalledTimes(1)
  })

  it('resets the preset selection without the model confirm', async () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    await clickAction(wrapper, 'Сбросить выбор')
    expect(api.handlers.clearSelection).toHaveBeenCalledTimes(1)
    expect(api.handlers.resetCpm).not.toHaveBeenCalled()
  })

  it('shows the preset error row with a retry', async () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = PRESET
    ;(api.models.presetError as Ref<string>).value = 'Пресет некорректен'
    const wrapper = mountTab()
    await openPresetTab(wrapper)

    expect(wrapper.find('.load-error-row').text()).toContain('Пресет некорректен')
    await wrapper.find('.load-error-row__btn').trigger('click')
    expect(api.handlers.retryPreset).toHaveBeenCalledTimes(1)
  })

  it('renders the drop overlay when either flow is dragging', async () => {
    const api = mocked()
    const wrapper = mountTab()

    expect(wrapper.find('.user-content-viewer__drop-overlay').exists()).toBe(false)

    ;(api.flow.isDragOver as Ref<boolean>).value = true
    await flushPromises()
    expect(wrapper.find('.user-content-viewer__drop-overlay').exists()).toBe(true)
  })

  it('shows the animation panel when the active model has animations', async () => {
    const api = mocked()
    ;(api.settings.cpmData as ShallowRef<unknown>).value = OWN_CPM_DATA
    ;(api.animations.animationGroups as Ref<unknown[]>).value = [
      { group: null, animations: [{ id: 'g_wave', name: 'Машет' }] },
    ]
    const wrapper = mountTab()

    expect(wrapper.find('.cpm-animation-panel-stub').exists()).toBe(true)
  })
})
