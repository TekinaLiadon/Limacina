import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref, ShallowRef } from 'vue'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import PresetGallery from '../PresetGallery.vue'

enableAutoUnmount(afterEach)

interface TestMocks {
  models: Record<string, unknown>
  flow: Record<string, unknown>
  animations: Record<string, unknown>
  handlers: {
    loadCatalog: ReturnType<typeof vi.fn>
    selectPreset: ReturnType<typeof vi.fn>
    retryPreset: ReturnType<typeof vi.fn>
    clearSelection: ReturnType<typeof vi.fn>
    selectSkinFile: ReturnType<typeof vi.fn>
    applyPreset: ReturnType<typeof vi.fn>
  }
}

const mocks = vi.hoisted(() => ({ api: null as unknown }))
const mocked = (): TestMocks => mocks.api as TestMocks

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  const vue = await import('vue')

  const handlers = {
    loadCatalog: vi.fn().mockResolvedValue(undefined),
    selectPreset: vi.fn().mockResolvedValue(undefined),
    retryPreset: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
    selectSkinFile: vi.fn(),
    applyPreset: vi.fn().mockResolvedValue(undefined),
  }

  const preview = {
    cpmData: { config: { skinSize: { x: 64, y: 64 }, elements: [] }, textureUrl: 'blob:preview' },
    dressed: null,
  }

  mocks.api = {
    handlers,
    models: {
      entries: vue.ref([
        { slug: 'female-body', name: 'Female Body', skinType: 'slim', previewUrl: 'blob:preview' },
        { slug: 'hero', name: 'Hero', skinType: 'both', previewUrl: null },
      ]),
      isListLoading: vue.ref(false),
      listError: vue.ref(''),
      loadCatalog: handlers.loadCatalog,
      selectedSlug: vue.ref<string | null>(null),
      preset: vue.shallowRef(null),
      previewSkinBytes: vue.shallowRef<Uint8Array | null>(new Uint8Array([1])),
      isPresetLoading: vue.ref(false),
      presetError: vue.ref(''),
      selectPreset: handlers.selectPreset,
      retryPreset: handlers.retryPreset,
      clearSelection: handlers.clearSelection,
    },
    flow: {
      skinImage: vue.shallowRef(null),
      skinMode: vue.ref<'classic' | 'slim'>('classic'),
      errorMessage: vue.ref(''),
      skinWarnings: vue.ref<string[]>([]),
      preview: vue.shallowRef(preview),
      activeLayerIds: vue.ref<number[]>([]),
      isOffline: vue.ref(false),
      isApplying: vue.ref(false),
      isDragOver: vue.ref(false),
      selectSkinFile: handlers.selectSkinFile,
      setSkin: vi.fn().mockResolvedValue(undefined),
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

  return {
    ...actual,
    usePresetModels: (): unknown => (mocks.api as TestMocks).models,
    usePresetSkinApply: (): unknown => (mocks.api as TestMocks).flow,
    useCpmAnimations: (): unknown => (mocks.api as TestMocks).animations,
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

const mountGallery = (): VueWrapper =>
  mount(PresetGallery, {
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

const makePreview = (dressed: unknown): unknown => ({
  cpmData: { config: { skinSize: { x: 64, y: 64 }, elements: [] }, textureUrl: 'blob:preview' },
  dressed,
})

const makeSkin = (): unknown => ({ width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4) })

beforeEach(() => {
  const api = mocked()
  ;(api.models.entries as Ref<unknown[]>).value = [
    { slug: 'female-body', name: 'Female Body', skinType: 'slim', previewUrl: 'blob:preview' },
    { slug: 'hero', name: 'Hero', skinType: 'both', previewUrl: null },
  ]
  ;(api.models.isListLoading as Ref<boolean>).value = false
  ;(api.models.listError as Ref<string>).value = ''
  ;(api.models.selectedSlug as Ref<string | null>).value = null
  ;(api.models.preset as ShallowRef<unknown>).value = {
    config: { skinSize: { x: 64, y: 64 }, elements: [] },
    meta: { name: 'Female Body', slug: 'female-body', skinType: 'slim' },
    animations: [],
    animEnc: null,
  }
  ;(api.models.isPresetLoading as Ref<boolean>).value = false
  ;(api.models.presetError as Ref<string>).value = ''
  ;(api.flow.skinImage as ShallowRef<unknown>).value = null
  ;(api.flow.skinMode as Ref<'classic' | 'slim'>).value = 'classic'
  ;(api.flow.errorMessage as Ref<string>).value = ''
  ;(api.flow.skinWarnings as Ref<string[]>).value = []
  ;(api.flow.preview as ShallowRef<unknown>).value = makePreview(null)
  ;(api.flow.isOffline as Ref<boolean>).value = false
  ;(api.flow.isApplying as Ref<boolean>).value = false
  api.handlers.loadCatalog.mockClear()
  api.handlers.selectPreset.mockClear()
  api.handlers.retryPreset.mockClear()
  api.handlers.clearSelection.mockClear()
  api.handlers.selectSkinFile.mockClear()
  api.handlers.applyPreset.mockClear()
})

describe('PresetGallery', () => {
  it('renders the catalog skeleton while loading', () => {
    ;(mocked().models.isListLoading as Ref<boolean>).value = true
    const wrapper = mountGallery()

    expect(wrapper.find('.skeleton').exists()).toBe(true)
    expect(wrapper.findAll('.preset-gallery__card:not(.preset-gallery__card--skeleton)')).toHaveLength(0)
  })

  it('renders the catalog error with a retry', async () => {
    ;(mocked().models.isListLoading as Ref<boolean>).value = false
    ;(mocked().models.listError as Ref<string>).value = 'Не удалось загрузить каталог моделей'
    const wrapper = mountGallery()

    expect(wrapper.find('.load-error-row').text()).toContain('Не удалось загрузить каталог моделей')
    await wrapper.find('.load-error-row__btn').trigger('click')
    expect(mocked().handlers.loadCatalog).toHaveBeenCalledTimes(1)
  })

  it('renders the empty catalog state without cards', () => {
    ;(mocked().models.entries as Ref<unknown[]>).value = []
    const wrapper = mountGallery()

    expect(wrapper.find('.preset-gallery__empty').text()).toContain('Готовых моделей пока нет')
    expect(wrapper.findAll('.preset-gallery__card')).toHaveLength(0)
  })

  it('renders preset cards with names and skin type badges', () => {
    const wrapper = mountGallery()

    const cards = wrapper.findAll('.preset-gallery__card')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Female Body')
    expect(cards[0]!.find('.preset-gallery__card-badge').text()).toBe('Слим')
    expect(cards[0]!.find('.preset-gallery__card-image').attributes('src')).toBe('blob:preview')
    expect(cards[1]!.find('.preset-gallery__card-badge').text()).toBe('Любой скин')
    expect(cards[1]!.find('.preset-gallery__card-fallback').exists()).toBe(true)
  })

  it('marks and selects a card', async () => {
    ;(mocked().models.selectedSlug as Ref<string | null>).value = 'female-body'
    const wrapper = mountGallery()

    const cards = wrapper.findAll('.preset-gallery__card')
    expect(cards[0]!.classes()).toContain('preset-gallery__card--selected')
    expect(cards[0]!.attributes('aria-pressed')).toBe('true')
    expect(cards[1]!.attributes('aria-pressed')).toBe('false')

    await cards[1]!.trigger('click')
    await flushPromises()
    expect(mocked().handlers.selectPreset).toHaveBeenCalledWith('hero')
  })

  it('shows the preset loading state', () => {
    ;(mocked().models.isPresetLoading as Ref<boolean>).value = true
    const wrapper = mountGallery()

    expect(wrapper.find('.preloader').exists()).toBe(true)
    expect(wrapper.findAll('.preset-gallery__card')).toHaveLength(2)
  })

  it('retries a failed selection', async () => {
    ;(mocked().models.presetError as Ref<string>).value = 'Пресет некорректен'
    const wrapper = mountGallery()

    expect(wrapper.find('.load-error-row').text()).toContain('Пресет некорректен')
    await wrapper.find('.load-error-row__btn').trigger('click')
    expect(mocked().handlers.retryPreset).toHaveBeenCalledTimes(1)
  })

  it('asks for a skin and disables apply before one is uploaded', async () => {
    const wrapper = mountGallery()

    expect(wrapper.find('.preset-gallery__hint').text()).toContain('Загрузите свой скин')

    const send = findButton(wrapper, 'Отправить')
    expect(send).toBeDefined()
    expect(send!.attributes('disabled')).toBeDefined()

    await clickAction(wrapper, 'Загрузить скин')
    expect(mocked().handlers.selectSkinFile).toHaveBeenCalledTimes(1)
  })

  it('shows warnings and applies the dressed model online', async () => {
    const api = mocked()
    ;(api.flow.skinImage as ShallowRef<unknown>).value = makeSkin()
    ;(api.flow.preview as ShallowRef<unknown>).value = makePreview({ config: {}, skinPng: new Uint8Array([1]) })
    ;(api.flow.skinWarnings as Ref<string[]>).value = ['Пресет рассчитан на slim-модель, а выбран classic-скин']

    const wrapper = mountGallery()

    expect(wrapper.find('.preset-gallery__hint').exists()).toBe(false)
    expect(wrapper.find('.preset-gallery__warning').text()).toContain('рассчитан на slim')
    expect(findButton(wrapper, 'Отправить')!.attributes('disabled')).toBeUndefined()

    await clickAction(wrapper, 'Отправить')
    expect(api.handlers.applyPreset).toHaveBeenCalledTimes(1)

    await clickAction(wrapper, 'Заменить скин')
    expect(api.handlers.selectSkinFile).toHaveBeenCalledTimes(1)
  })

  it('switches the skin mode of the preview', async () => {
    const api = mocked()
    const wrapper = mountGallery()

    await clickAction(wrapper, 'Слим')
    expect((api.flow.skinMode as Ref<'classic' | 'slim'>).value).toBe('slim')

    await clickAction(wrapper, 'Классик')
    expect((api.flow.skinMode as Ref<'classic' | 'slim'>).value).toBe('classic')
  })

  it('offers the offline save action with a notice', async () => {
    const api = mocked()
    ;(api.flow.isOffline as Ref<boolean>).value = true
    ;(api.flow.skinImage as ShallowRef<unknown>).value = makeSkin()
    ;(api.flow.preview as ShallowRef<unknown>).value = makePreview({ config: {}, skinPng: new Uint8Array([1]) })

    const wrapper = mountGallery()

    expect(wrapper.find('.preset-gallery__notice').text()).toContain('Локальный профиль')
    expect(findButton(wrapper, 'Отправить')).toBeUndefined()

    await clickAction(wrapper, 'Сохранить в игру')
    expect(api.handlers.applyPreset).toHaveBeenCalledTimes(1)
  })

  it('renders the flow error and resets the selection', async () => {
    const api = mocked()
    ;(api.flow.errorMessage as Ref<string>).value = 'Не удалось сохранить модель'
    const wrapper = mountGallery()

    expect(wrapper.find('.preset-gallery__error').text()).toContain('Не удалось сохранить модель')

    await clickAction(wrapper, 'Сбросить выбор')
    expect(api.handlers.clearSelection).toHaveBeenCalledTimes(1)
  })

  it('hides the preset panel when the selection is cleared', () => {
    const api = mocked()
    ;(api.models.preset as ShallowRef<unknown>).value = null
    ;(api.flow.preview as ShallowRef<unknown>).value = null
    const wrapper = mountGallery()

    expect(findButton(wrapper, 'Загрузить скин')).toBeUndefined()
    expect(wrapper.find('.preset-gallery__hint').exists()).toBe(false)
  })
})
