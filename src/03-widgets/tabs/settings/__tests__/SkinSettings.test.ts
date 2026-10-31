import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import SkinSettings from '../SkinSettings.vue'
import SkinViewer from '../SkinViewer.vue'

const skinUrl = ref<string>('')
const isSkinLoading = ref<boolean>(false)
const modelMode = ref<'classic' | 'slim'>('classic')

vi.mock('@/04-features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/04-features')>()
  return {
    ...actual,
    useOfflineSkinSettings: (): Record<string, unknown> => ({
      skinUrl,
      errorMessage: ref<string>(''),
      setTextureError: vi.fn(),
      isUploading: ref(false),
      isMutating: ref(false),
      isSkinLoading,
      isOffline: ref(false),
      hasSkin: computed((): boolean => skinUrl.value !== ''),
      uploadedSkins: ref([]),
      isListLoading: ref(false),
      listError: ref(''),
      loadList: vi.fn(),
      isDragOver: ref(false),
      modelMode,
      selectSkin: vi.fn(),
      handleUpload: vi.fn(),
      handleActivate: vi.fn(),
      handleDelete: vi.fn(),
      handleCopyUrl: vi.fn(),
      resetSkin: vi.fn(),
    }),
  }
})

const skinViewerStub = {
  name: 'SkinViewer',
  props: { skinUrl: { type: String, required: true }, slim: { type: Boolean, default: false } },
  template: '<div class="skin-viewer__canvas" />',
}

const mountSettings = (): VueWrapper =>
  mount(SkinSettings, { global: { stubs: { SkinViewer: skinViewerStub } } })

const scene = (wrapper: VueWrapper) => wrapper.find('.viewer-3d')

const viewerUrl = (wrapper: VueWrapper): string =>
  wrapper.findComponent(SkinViewer).props('skinUrl') as string

beforeEach((): void => {
  skinUrl.value = ''
  isSkinLoading.value = false
  modelMode.value = 'classic'
})

describe('SkinSettings', () => {
  it('shows the empty 3d scene while no skin is loaded', () => {
    const wrapper = mountSettings()

    expect(isSkinLoading.value).toBe(false)
    expect(scene(wrapper).exists()).toBe(true)
    expect(wrapper.find('.skin-viewer__canvas').exists()).toBe(true)
    expect(viewerUrl(wrapper)).toBe('')
    expect(wrapper.find('.skin-settings__model-mode').exists()).toBe(false)
  })

  it('replaces the scene with the loading placeholder while the skin loads', () => {
    isSkinLoading.value = true
    const wrapper = mountSettings()

    expect(wrapper.find('.skin-settings__loading').exists()).toBe(true)
    expect(scene(wrapper).exists()).toBe(false)
  })

  it('loads the current skin into the scene and offers the model switch', () => {
    skinUrl.value = 'blob:skin'
    const wrapper = mountSettings()

    expect(scene(wrapper).exists()).toBe(true)
    expect(viewerUrl(wrapper)).toBe('blob:skin')
    expect(wrapper.find('.skin-settings__model-mode').exists()).toBe(true)
    expect(wrapper.find('.skin-settings__mode-btn--active').text()).toBe('Классик')
  })

  it('switches the scene to the slim model', async () => {
    skinUrl.value = 'blob:skin'
    const wrapper = mountSettings()

    const [, slimButton] = wrapper.findAll('.skin-settings__mode-btn')
    await slimButton?.trigger('click')

    expect(modelMode.value).toBe('slim')
    expect(wrapper.find('.skin-settings__mode-btn--active').text()).toBe('Слим')
  })

  it('marks the active model mode with aria-pressed', async () => {
    skinUrl.value = 'blob:skin'
    const wrapper = mountSettings()

    const buttons = wrapper.findAll('.skin-settings__mode-btn')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.attributes('aria-pressed')).toBe('true')
    expect(buttons[1]?.attributes('aria-pressed')).toBe('false')

    modelMode.value = 'slim'
    await nextTick()

    expect(buttons[0]?.attributes('aria-pressed')).toBe('false')
    expect(buttons[1]?.attributes('aria-pressed')).toBe('true')
  })
})
