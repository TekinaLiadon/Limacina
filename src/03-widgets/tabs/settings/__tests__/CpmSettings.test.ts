import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import CpmSettings from '../CpmSettings.vue'

enableAutoUnmount(afterEach)

interface TestMocks {
  settings: Record<string, unknown>
  animations: Record<string, unknown>
  offline: Record<string, unknown>
  errorMessage: Ref<string>
  handlers: {
    handleUploadModel: ReturnType<typeof vi.fn>
    handleSaveModelOffline: ReturnType<typeof vi.fn>
    resetCpm: ReturnType<typeof vi.fn>
    selectCpmFile: ReturnType<typeof vi.fn>
  }
}

const mocks = vi.hoisted(() => ({ api: null as unknown }))
const mocked = (): TestMocks => mocks.api as TestMocks

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  const vue = await import('vue')

  const errorMessage = vue.ref('')
  const isUploading = vue.ref(false)
  const selectedAnimationIds = vue.ref<string[]>([])
  const animationGroups = vue.ref([{
    group: null,
    animations: [{ id: 'g_wave', name: 'Машет' }],
  }])
  const layerPanelData = vue.ref({
    tabs: ['Root'],
    Root: [{ id: '5', label: 'Body', disabled: false }],
  })
  const visibleLayerKeys = vue.ref<string[]>(['5'])
  const handlers = {
    handleUploadModel: vi.fn().mockResolvedValue(undefined),
    handleSaveModelOffline: vi.fn().mockResolvedValue(undefined),
    resetCpm: vi.fn().mockResolvedValue(undefined),
    selectCpmFile: vi.fn(),
  }

  mocks.api = {
    errorMessage,
    handlers,
    settings: {
      cpmData: vue.shallowRef({
        config: { skinSize: { x: 64, y: 64 }, elements: [] },
        textureUrl: 'blob:model',
      }),
      cpmFileBytes: vue.ref(new Uint8Array([1, 2, 3])),
      modelName: vue.computed(() => 'Модель'),
      errorMessage,
      showEmptyLayers: vue.ref(false),
      activeLayerIds: vue.computed(() => []),
      layerPanelData,
      visibleLayerKeys,
      setVisibleLayerKeys: vi.fn(),
      setTextureError: vi.fn(),
      isUploading,
      isOffline: vue.ref(false),
      uploadedModels: vue.ref([]),
      isListLoading: vue.ref(false),
      listError: vue.ref(''),
      loadList: vi.fn(),
      isDragOver: vue.ref(false),
      selectCpmFile: handlers.selectCpmFile,
      resetCpm: handlers.resetCpm,
      handleUploadModel: handlers.handleUploadModel,
      handleDeleteModel: vi.fn(),
      handleCopyUrl: vi.fn(),
    },
    animations: {
      animationGroups,
      selectedAnimationIds,
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
    offline: {
      isSaving: vue.ref(false),
      handleSaveModelOffline: handlers.handleSaveModelOffline,
    },
  }

  return {
    ...actual,
    useCpmSettings: (): unknown => (mocks.api as TestMocks).settings,
    useCpmAnimations: (): unknown => (mocks.api as TestMocks).animations,
    useOfflineCpmModel: (): unknown => (mocks.api as TestMocks).offline,
  }
})

const CpmViewerStub = {
  name: 'CpmViewer',
  template: '<div class="cpm-viewer__canvas" />',
}

const CpmAnimationPanelStub = {
  name: 'CpmAnimationPanel',
  props: ['data', 'modelValue', 'hasAnimation', 'isPlaying', 'isLooped', 'speed', 'canSpeedDown', 'canSpeedUp'],
  template: '<div class="cpm-animation-panel-stub"><slot name="actions" /></div>',
}

const mountSettings = (): VueWrapper =>
  mount(CpmSettings, {
    global: {
      stubs: {
        CpmViewer: CpmViewerStub,
        CpmAnimationPanel: CpmAnimationPanelStub,
      },
    },
  })

const clickAction = async (wrapper: VueWrapper, label: string): Promise<void> => {
  const action = wrapper.findAll('button').find((item) => item.text() === label)
  if (!action) throw new Error(`кнопка «${label}» не найдена`)
  await action.trigger('click')
  await flushPromises()
}

beforeEach((): void => {
  const api = mocked()
  api.errorMessage.value = ''
  ;(api.settings.isOffline as Ref<boolean>).value = false
  ;(api.settings.isUploading as Ref<boolean>).value = false
  ;(api.offline.isSaving as Ref<boolean>).value = false
  ;(api.settings.cpmData as Ref<unknown>).value = {
    config: { skinSize: { x: 64, y: 64 }, elements: [] },
    textureUrl: 'blob:model',
  }
  api.handlers.handleUploadModel.mockClear()
  api.handlers.handleSaveModelOffline.mockClear()
  api.handlers.resetCpm.mockClear()
  api.handlers.selectCpmFile.mockClear()
  ;(api.animations.selectedAnimationIds as Ref<string[]>).value = []
  ;(api.animations.animationGroups as Ref<unknown[]>).value = [{
    group: null,
    animations: [{ id: 'g_wave', name: 'Машет' }],
  }]
  ;(api.settings.layerPanelData as Ref<unknown>).value = {
    tabs: ['Root'],
    Root: [{ id: '5', label: 'Body', disabled: false }],
  }
  ;(api.settings.visibleLayerKeys as Ref<string[]>).value = ['5']
  ;(api.settings.showEmptyLayers as Ref<boolean>).value = false
})

describe('CpmSettings', () => {
  it('renders the playback panel for the loaded model', () => {
    const wrapper = mountSettings()

    const panel = wrapper.findComponent({ name: 'CpmAnimationPanel' })
    expect(panel.exists()).toBe(true)
    expect(panel.props('data')).toEqual({
      tabs: ['Без группы'],
      'Без группы': [{ id: 'g_wave', label: 'Машет' }],
    })
  })

  it('hides the playback panel without a model', () => {
    ;(mocked().settings.cpmData as Ref<unknown>).value = null
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-animation-panel-stub').exists()).toBe(false)
  })

  it('renders the grouped layer panel', () => {
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-settings__layer-panel .cpm-tabbed-panel__title').text()).toContain('Слои')
    expect(wrapper.find('.cpm-settings__layer-panel .cpm-tabbed-panel__count').text()).toBe('Показано: 1 из 1')
    expect(wrapper.find('.cpm-settings__layer-panel .cpm-tabbed-panel__item').text()).toBe('Body')
  })

  it('places the empty-layer toggle in the layer panel header actions', async () => {
    const wrapper = mountSettings()

    const actions = wrapper.find('.cpm-settings__layer-panel .cpm-tabbed-panel__actions')
    expect(actions.exists()).toBe(true)
    expect(actions.find('.checkbox__label').text()).toBe('Показать пустые слои')

    await actions.find('.checkbox__input').setValue(true)

    expect((mocked().settings.showEmptyLayers as Ref<boolean>).value).toBe(true)
  })

  it('replaces and resets the model through the viewer actions', async () => {
    const wrapper = mountSettings()

    await clickAction(wrapper, 'Заменить модель')
    await clickAction(wrapper, 'Сбросить модель')

    expect(mocked().handlers.selectCpmFile).toHaveBeenCalledTimes(1)
    expect(mocked().handlers.resetCpm).toHaveBeenCalledTimes(1)
  })

  it('sends the model through the server action', async () => {
    const wrapper = mountSettings()

    await clickAction(wrapper, 'Отправить')

    expect(mocked().handlers.handleUploadModel).toHaveBeenCalledTimes(1)
  })

  it('saves the model to the game through the offline action', async () => {
    const api = mocked()
    ;(api.settings.isOffline as Ref<boolean>).value = true
    const wrapper = mountSettings()

    await clickAction(wrapper, 'Сохранить в игру')

    expect(api.handlers.handleSaveModelOffline).toHaveBeenCalledTimes(1)
  })

  it('shows the model error', () => {
    const api = mocked()
    api.errorMessage.value = 'Не удалось сохранить модель'
    const wrapper = mountSettings()

    expect(wrapper.find('.user-content-viewer__error').text()).toContain('Не удалось сохранить модель')
  })
})
