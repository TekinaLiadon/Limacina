import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import CpmSettings from '../CpmSettings.vue'

enableAutoUnmount(afterEach)

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (): void => {},
}))

interface WeightValue {
  bytes: number
  limitBytes: number
  exceedsLimit: boolean
  warning: string | null
}

interface MockEditor {
  isEditing: Ref<boolean>
  isPlaying: Ref<boolean>
  selectedBoneId: Ref<number | null>
  activeAnimations: ComputedRef<unknown>
  animation: ComputedRef<unknown>
  weight: ShallowRef<WeightValue | null>
  isWeightLoading: Ref<boolean>
  weightError: Ref<string>
  startEditing: ReturnType<typeof vi.fn>
  setPlaying: ReturnType<typeof vi.fn>
  stopEditing: ReturnType<typeof vi.fn>
  confirmLeave: ReturnType<typeof vi.fn>
  prepareSave: ReturnType<typeof vi.fn>
  markSaved: ReturnType<typeof vi.fn>
  selectBone: ReturnType<typeof vi.fn>
}

interface TestMocks {
  editor: MockEditor
  settings: Record<string, unknown>
  animations: Record<string, unknown>
  offline: Record<string, unknown>
  errorMessage: Ref<string>
  isUploading: Ref<boolean>
  handlers: {
    handleUploadModel: ReturnType<typeof vi.fn>
    handleSaveModelOffline: ReturnType<typeof vi.fn>
    resetCpm: ReturnType<typeof vi.fn>
    selectCpmFile: ReturnType<typeof vi.fn>
  }
}

const mocks = vi.hoisted((): { api: unknown; weight: WeightValue } => ({
  api: null,
  weight: {
    bytes: 2048,
    limitBytes: 20 * 1024 * 1024,
    exceedsLimit: false,
    warning: null as string | null,
  },
}))
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
  const editor: MockEditor = {
    isEditing: vue.ref(false),
    isPlaying: vue.ref(false),
    selectedBoneId: vue.ref<number | null>(null),
    activeAnimations: vue.computed(() => []),
    animation: vue.computed(() => null),
    weight: vue.shallowRef(mocks.weight),
    isWeightLoading: vue.ref(false),
    weightError: vue.ref(''),
    startEditing: vi.fn(),
    setPlaying: vi.fn(),
    stopEditing: vi.fn().mockResolvedValue(true),
    confirmLeave: vi.fn().mockResolvedValue(true),
    prepareSave: vi.fn().mockReturnValue(true),
    markSaved: vi.fn(),
    selectBone: vi.fn(),
  }
  const handlers = {
    handleUploadModel: vi.fn().mockResolvedValue(undefined),
    handleSaveModelOffline: vi.fn().mockResolvedValue(undefined),
    resetCpm: vi.fn().mockResolvedValue(undefined),
    selectCpmFile: vi.fn(),
  }

  mocks.api = {
    editor,
    errorMessage,
    isUploading,
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
      displayLayers: vue.computed(() => []),
      activeLayerIds: vue.computed(() => []),
      layerPanelData,
      visibleLayerKeys,
      setVisibleLayerKeys: vi.fn(),
      toggleLayer: vi.fn(),
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
    useCpmAnimationEditor: (): unknown => (mocks.api as TestMocks).editor,
    useCpmEditorScene: vi.fn(),
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

const CpmAnimationEditorHeadStub = {
  name: 'CpmAnimationEditorHead',
  props: {
    editor: { type: Object, required: true },
    isSaving: { type: Boolean, required: true },
    saveError: { type: String, required: true },
  },
  emits: ['save'],
  template: '<div class="cpm-editor-head-stub" />',
}

const CpmAnimationToolsStub = {
  name: 'CpmAnimationTools',
  props: { editor: { type: Object, required: true } },
  template: '<div class="cpm-editor-tools-stub" />',
}

const CpmAnimationTimelineStub = {
  name: 'CpmAnimationTimeline',
  props: {
    editor: { type: Object, required: true },
    speed: { type: Number, required: true },
    canSpeedDown: { type: Boolean, required: true },
    canSpeedUp: { type: Boolean, required: true },
    isLooped: { type: Boolean, required: true },
  },
  template: '<div class="cpm-editor-timeline-stub" />',
}

const mountSettings = (): VueWrapper =>
  mount(CpmSettings, {
    global: {
      stubs: {
        CpmViewer: CpmViewerStub,
        CpmAnimationPanel: CpmAnimationPanelStub,
        CpmAnimationEditorHead: CpmAnimationEditorHeadStub,
        CpmAnimationTools: CpmAnimationToolsStub,
        CpmAnimationTimeline: CpmAnimationTimelineStub,
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
  api.isUploading.value = false
  ;(api.settings.isOffline as Ref<boolean>).value = false
  ;(api.offline.isSaving as Ref<boolean>).value = false
  api.editor.isEditing.value = false
  api.editor.isPlaying.value = false
  api.editor.isWeightLoading.value = false
  api.editor.weightError.value = ''
  api.editor.weight.value = mocks.weight
  api.editor.startEditing.mockClear()
  api.editor.setPlaying.mockClear()
  api.editor.stopEditing.mockClear()
  api.editor.stopEditing.mockResolvedValue(true)
  api.editor.markSaved.mockClear()
  api.editor.confirmLeave.mockResolvedValue(true)
  api.editor.prepareSave.mockReturnValue(true)
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

describe('CpmSettings editor integration', () => {
  it('shows the editor entry next to the playback panel', () => {
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-settings__playback .cpm-animation-panel-stub').exists()).toBe(true)
    expect(wrapper.find('.cpm-animation-panel-stub .cpm-settings__edit').exists()).toBe(true)
    expect(wrapper.find('.cpm-settings__edit').text()).toBe('Создать анимацию')
    expect(wrapper.find('.cpm-settings__weight').text()).toBe('Вес: 2 КБ из 20 МБ')
  })

  it('keeps the create action available without animations', () => {
    ;(mocked().animations.animationGroups as Ref<unknown[]>).value = []
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-animation-panel-stub').exists()).toBe(true)
    expect(wrapper.find('.cpm-animation-panel-stub .cpm-settings__edit').text()).toBe('Создать анимацию')
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

  it('opens the selected animation in the editor', async () => {
    ;(mocked().animations.selectedAnimationIds as Ref<string[]>).value = ['g_wave']
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-settings__edit').text()).toBe('Редактировать анимацию')
    await wrapper.find('.cpm-settings__edit').trigger('click')

    expect(mocked().editor.startEditing).toHaveBeenCalledWith('g_wave')
  })

  it('opens the fullscreen workspace on editing and closes it after finishing', async () => {
    const api = mocked()
    api.editor.startEditing.mockImplementationOnce((): void => {
      api.editor.isEditing.value = true
    })
    const wrapper = mountSettings()

    await wrapper.find('.cpm-settings__edit').trigger('click')
    await flushPromises()

    expect(document.body.querySelector('.viewer-3d-fullscreen__content--workspace')).not.toBeNull()
    expect((document.body.querySelector<HTMLElement>('.popup-shell__overlay'))?.style.display).not.toBe('none')

    api.editor.isEditing.value = false
    await flushPromises()

    expect((document.body.querySelector<HTMLElement>('.popup-shell__overlay'))?.style.display).toBe('none')
  })

  it('replaces the playback panel with the fullscreen editor in edit mode', async () => {
    const wrapper = mountSettings()
    mocked().editor.isEditing.value = true
    await flushPromises()

    expect(document.body.querySelector('.viewer-3d-fullscreen__content--workspace')).not.toBeNull()
    expect(document.body.querySelector('.cpm-editor-head-stub')).not.toBeNull()
    expect(document.body.querySelector('.cpm-editor-tools-stub')).not.toBeNull()
    expect(document.body.querySelector('.cpm-editor-timeline-stub')).not.toBeNull()
    expect(wrapper.find('.cpm-animation-panel-stub').exists()).toBe(false)
    expect((document.body.querySelector<HTMLElement>('.popup-shell__overlay'))?.style.display).not.toBe('none')
  })

  it('closes the editor through the confirm flow when the fullscreen is dismissed', async () => {
    const api = mocked()
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'Viewer3D' }).vm.$emit('update:fullscreen', false)
    await flushPromises()

    expect(api.editor.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('keeps the editor open when leaving is declined', async () => {
    const api = mocked()
    api.editor.stopEditing.mockResolvedValue(false)
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'Viewer3D' }).vm.$emit('update:fullscreen', false)
    await flushPromises()

    expect(api.editor.stopEditing).toHaveBeenCalledTimes(1)
    expect((document.body.querySelector<HTMLElement>('.popup-shell__overlay'))?.style.display).not.toBe('none')
  })

  it('saves the model from the editor and leaves on success', async () => {
    const api = mocked()
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'CpmAnimationEditorHead' }).vm.$emit('save')
    await flushPromises()

    expect(api.handlers.handleUploadModel).toHaveBeenCalledTimes(1)
    expect(api.editor.markSaved).toHaveBeenCalledTimes(1)
    expect(api.editor.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('saves the model to the game from an offline editor', async () => {
    const api = mocked()
    ;(api.settings.isOffline as Ref<boolean>).value = true
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'CpmAnimationEditorHead' }).vm.$emit('save')
    await flushPromises()

    expect(api.handlers.handleSaveModelOffline).toHaveBeenCalledTimes(1)
    expect(api.editor.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('stays in the editor when the model save fails', async () => {
    const api = mocked()
    api.handlers.handleUploadModel.mockImplementationOnce(async (): Promise<void> => {
      api.errorMessage.value = 'Не удалось сохранить модель'
    })
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'CpmAnimationEditorHead' }).vm.$emit('save')
    await flushPromises()

    expect(api.editor.markSaved).not.toHaveBeenCalled()
    expect(api.editor.stopEditing).not.toHaveBeenCalled()
  })

  it('shows the model save error', async () => {
    const api = mocked()
    api.handlers.handleUploadModel.mockImplementationOnce(async (): Promise<void> => {
      api.errorMessage.value = 'Не удалось сохранить модель'
    })
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    wrapper.findComponent({ name: 'CpmAnimationEditorHead' }).vm.$emit('save')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'CpmAnimationEditorHead' }).props('saveError')).toBe(
      'Не удалось сохранить модель',
    )
    expect(wrapper.find('.user-content-viewer__error').text()).toContain('Не удалось сохранить модель')
  })

  it('shows the weight loading state and measurement errors', async () => {
    const api = mocked()
    const wrapper = mountSettings()

    api.editor.isWeightLoading.value = true
    await flushPromises()
    expect(wrapper.find('.cpm-settings__weight').text()).toBe('Вес: …')

    api.editor.isWeightLoading.value = false
    api.editor.weightError.value = 'Не удалось оценить вес проекта'
    await flushPromises()
    const texts = wrapper.findAll('.cpm-settings__weight').map((item) => item.text())
    expect(texts.join(' ')).toContain('Не удалось оценить вес')
  })

  it('shows the over-limit weight warning without hovering', async () => {
    const api = mocked()
    api.editor.weight.value = {
      bytes: 21 * 1024 * 1024,
      limitBytes: 20 * 1024 * 1024,
      exceedsLimit: true,
      warning: 'Вес проекта превышает предел 20 МБ',
    }
    const wrapper = mountSettings()
    await flushPromises()

    const warning = wrapper.find('.cpm-settings__weight-warning')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('20 МБ')
    expect(warning.attributes('role')).toBe('alert')
  })

  it('blocks saving an invalid draft and saves a valid one', async () => {
    const api = mocked()
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()

    api.editor.prepareSave.mockReturnValueOnce(false)
    await clickAction(wrapper, 'Отправить')
    expect(api.handlers.handleUploadModel).not.toHaveBeenCalled()

    api.editor.prepareSave.mockReturnValueOnce(true)
    await clickAction(wrapper, 'Отправить')
    expect(api.handlers.handleUploadModel).toHaveBeenCalledTimes(1)
    expect(api.editor.markSaved).toHaveBeenCalledTimes(1)
  })

  it('does not mark the draft saved when the save fails', async () => {
    const api = mocked()
    const wrapper = mountSettings()
    api.editor.isEditing.value = true
    await flushPromises()
    api.handlers.handleUploadModel.mockImplementationOnce(async (): Promise<void> => {
      api.errorMessage.value = 'Не удалось сохранить модель'
    })

    await clickAction(wrapper, 'Отправить')

    expect(api.editor.markSaved).not.toHaveBeenCalled()
  })

  it('asks the editor before replacing or resetting the model', async () => {
    const api = mocked()
    api.editor.confirmLeave.mockResolvedValue(false)
    const wrapper = mountSettings()

    await clickAction(wrapper, 'Заменить модель')
    await clickAction(wrapper, 'Сбросить модель')

    expect(api.handlers.selectCpmFile).not.toHaveBeenCalled()
    expect(api.handlers.resetCpm).not.toHaveBeenCalled()

    api.editor.confirmLeave.mockResolvedValue(true)
    await clickAction(wrapper, 'Сбросить модель')
    expect(api.handlers.resetCpm).toHaveBeenCalledTimes(1)
  })
})
