import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import CpmSettings from '../CpmSettings.vue'

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
  const animationOptions = vue.computed(() => [{ title: 'Машет', value: 'g_wave' }])
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
      animationOptions,
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
  }
})

const CpmViewerStub = {
  name: 'CpmViewer',
  template: '<div class="cpm-viewer__canvas" />',
}

const CpmAnimationBarStub = {
  name: 'CpmAnimationBar',
  props: ['options', 'modelValue', 'hasAnimation', 'isPlaying', 'isLooped', 'speed', 'canSpeedDown', 'canSpeedUp'],
  template: '<div class="cpm-anim-bar-stub" />',
}

const CpmAnimationEditorStub = {
  name: 'CpmAnimationEditor',
  props: { editor: { type: Object, required: true } },
  template: '<div class="cpm-editor-stub" />',
}

const mountSettings = (): VueWrapper =>
  mount(CpmSettings, {
    global: {
      stubs: {
        CpmViewer: CpmViewerStub,
        CpmAnimationBar: CpmAnimationBarStub,
        CpmAnimationEditor: CpmAnimationEditorStub,
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
  api.editor.isEditing.value = false
  api.editor.isPlaying.value = false
  api.editor.isWeightLoading.value = false
  api.editor.weightError.value = ''
  api.editor.weight.value = mocks.weight
  api.editor.startEditing.mockClear()
  api.editor.setPlaying.mockClear()
  api.editor.markSaved.mockClear()
  api.editor.confirmLeave.mockResolvedValue(true)
  api.editor.prepareSave.mockReturnValue(true)
  api.handlers.handleUploadModel.mockClear()
  api.handlers.handleSaveModelOffline.mockClear()
  api.handlers.resetCpm.mockClear()
  api.handlers.selectCpmFile.mockClear()
  ;(api.animations.selectedAnimationIds as Ref<string[]>).value = []
})

describe('CpmSettings editor integration', () => {
  it('shows the editor entry next to the playback panel', () => {
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-settings__playback .cpm-anim-bar-stub').exists()).toBe(true)
    expect(wrapper.find('.cpm-settings__edit').text()).toBe('Создать анимацию')
    expect(wrapper.find('.cpm-settings__weight').text()).toBe('Вес: 2 КБ из 20 МБ')
  })

  it('opens the selected animation in the editor', async () => {
    ;(mocked().animations.selectedAnimationIds as Ref<string[]>).value = ['g_wave']
    const wrapper = mountSettings()

    expect(wrapper.find('.cpm-settings__edit').text()).toBe('Редактировать анимацию')
    await wrapper.find('.cpm-settings__edit').trigger('click')

    expect(mocked().editor.startEditing).toHaveBeenCalledWith('g_wave')
  })

  it('replaces the playback panel with the editor in edit mode', async () => {
    mocked().editor.isEditing.value = true
    const wrapper = mountSettings()
    await flushPromises()

    expect(wrapper.find('.cpm-editor-stub').exists()).toBe(true)
    expect(wrapper.find('.cpm-anim-bar-stub').exists()).toBe(false)
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
    api.editor.isEditing.value = true
    const wrapper = mountSettings()

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
    api.editor.isEditing.value = true
    const wrapper = mountSettings()
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
