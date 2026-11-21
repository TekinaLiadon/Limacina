import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, type Ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type * as THREE from 'three'
import { useCoreStore } from '@/05-entities'
import { useFiguraAvatarUpload, useFiguraAvatars, type FiguraAvatarsApi, type FiguraViewerSource } from '@/04-features'
import ModelTabFigura from '../model-tab/ModelTabFigura.vue'
import { EMPTY_STATES, ERRORS, FIGURA_UPLOAD_LABEL, MODEL_TAB_TITLES } from '../model-tab/copy'

const onDragDropEvent = vi.hoisted(() => vi.fn(async (): Promise<() => void> => () => {}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({ onDragDropEvent }),
}))

vi.mock('@/06-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/06-shared')>()
  const { onMounted, shallowRef } = await import('vue')
  const three = await import('three')
  return {
    ...actual,
    useThreeScene: vi.fn((): Record<string, unknown> => {
      const scene = shallowRef<THREE.Scene | null>(null)
      const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
      onMounted((): void => {
        scene.value = new three.Scene()
        camera.value = new three.PerspectiveCamera()
      })
      return {
        scene,
        camera,
        renderer: shallowRef<THREE.WebGLRenderer | null>(null),
        getOrbitControls: (): null => null,
      }
    }),
  }
})

const listFiguraAvatars = vi.hoisted(() => vi.fn())
const readFiguraAvatar = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listFiguraAvatars,
  readFiguraAvatar,
}))

vi.mock('@/04-features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features')>()),
  useFiguraAvatars: vi.fn(),
  useFiguraAvatarUpload: vi.fn(),
}))

interface AvatarEntry {
  name: string
  authors: string[]
  description: string
  hasModel: boolean
  hasTexture: boolean
}

interface FiguraState {
  avatars: Ref<AvatarEntry[] | null>
  selectedName: Ref<string | null>
  isListLoading: Ref<boolean>
  listError: Ref<string>
  modelError: Ref<string>
  textureError: Ref<string>
  viewerSource: Ref<FiguraViewerSource | null>
  loadList: () => Promise<void>
  selectAvatar: (name: string | null) => Promise<void>
}

const loadListSpy = vi.fn(async (): Promise<void> => {})
const selectAvatarSpy = vi.fn(async (_name: string | null): Promise<void> => {})

const makeEntry = (name: string, overrides: Partial<AvatarEntry> = {}): AvatarEntry => ({
  name,
  authors: ['tekina'],
  description: `${name} avatar`,
  hasModel: true,
  hasTexture: true,
  ...overrides,
})

const openArchiveSpy = vi.fn()

const uploadApiOf = (): ReturnType<typeof useFiguraAvatarUpload> => ({
  isInstalling: ref<boolean>(false),
  isDragOver: ref<boolean>(false),
  installError: ref<string>(''),
  openArchiveDialog: openArchiveSpy,
  loadFromPath: vi.fn(async (): Promise<void> => {}),
})

const createState = (): FiguraState => ({
  avatars: ref<AvatarEntry[] | null>(null),
  selectedName: ref<string | null>(null),
  isListLoading: ref<boolean>(false),
  listError: ref<string>(''),
  modelError: ref<string>(''),
  textureError: ref<string>(''),
  viewerSource: ref<FiguraViewerSource | null>(null),
  loadList: loadListSpy,
  selectAvatar: selectAvatarSpy,
})

const sourceOf = (): FiguraViewerSource => ({
  model: {
    resolution: { width: 64, height: 64 },
    textureSize: { width: 64, height: 64 },
    nodes: [],
    roots: [],
  },
  texturePng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
})

let state: FiguraState

const apiOf = (current: FiguraState): FiguraAvatarsApi => ({
  avatars: computed((): AvatarEntry[] | null => current.avatars.value),
  selectedName: computed((): string | null => current.selectedName.value),
  selected: computed((): AvatarEntry | null => {
    const entries = current.avatars.value
    const name = current.selectedName.value
    if (entries === null || name === null) return null
    return entries.find((entry) => entry.name === name) ?? null
  }),
  isListLoading: current.isListLoading,
  listError: current.listError,
  isModelLoading: ref<boolean>(false),
  modelError: current.modelError,
  textureError: current.textureError,
  viewerSource: current.viewerSource,
  loadList: current.loadList,
  selectAvatar: current.selectAvatar,
  loadModel: vi.fn(async (): Promise<void> => {}),
  reset: vi.fn(),
})

const mountPanel = (): VueWrapper => mount(ModelTabFigura, { attachTo: document.body })

const avatarButtons = (wrapper: VueWrapper) => wrapper.findAll('.model-tab__figura-avatar')

const avatarButton = (wrapper: VueWrapper, name: string) =>
  avatarButtons(wrapper).find((item) => item.text().includes(name))

beforeEach((): void => {
  setActivePinia(createPinia())
  state = createState()
  vi.mocked(useFiguraAvatars).mockImplementation((): FiguraAvatarsApi => apiOf(state))
  vi.mocked(useFiguraAvatarUpload).mockImplementation((): ReturnType<typeof useFiguraAvatarUpload> => uploadApiOf())
  openArchiveSpy.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach((): void => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ModelTabFigura', () => {
  it('shows the empty catalog caption without an error', () => {
    state.avatars.value = []
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain(EMPTY_STATES.figuraNoAvatars)
    expect(wrapper.find('.model-tab__figura-error').exists()).toBe(false)
  })

  it('renders one list item per avatar of the project', () => {
    state.avatars.value = [makeEntry('alpha'), makeEntry('beta')]
    const wrapper = mountPanel()

    expect(avatarButtons(wrapper)).toHaveLength(2)
    expect(wrapper.text()).not.toContain(EMPTY_STATES.figuraNoAvatars)
  })

  it('opens the archive dialog from the upload button', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.model-tab__figura-upload').trigger('click')

    expect(openArchiveSpy).toHaveBeenCalledOnce()
  })

  it('labels the upload button and shows the archive hint under the viewer', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.model-tab__figura-upload').text()).toBe(FIGURA_UPLOAD_LABEL)
    expect(wrapper.text()).toContain('model.bbmodel')
  })

  it('reloads the catalog when the active project changes', async () => {
    const core = useCoreStore()
    core.currentProject = 'Cordelia'
    mountPanel()
    loadListSpy.mockClear()

    core.currentProject = 'Avelmor'
    await nextTick()

    expect(loadListSpy).toHaveBeenCalledTimes(1)
  })

  it('loads the catalog on mount and again on refresh', async () => {
    state.avatars.value = [makeEntry('alpha')]
    const wrapper = mountPanel()

    await wrapper.find('.model-tab__figura-refresh').trigger('click')

    expect(loadListSpy).toHaveBeenCalledTimes(2)
  })

  it('asks the composable for the avatar picked in the list', async () => {
    state.avatars.value = [makeEntry('alpha'), makeEntry('beta')]
    const wrapper = mountPanel()

    await avatarButton(wrapper, 'beta')?.trigger('click')

    expect(selectAvatarSpy).toHaveBeenCalledWith('beta')
  })

  it('shows the name, author and description of the selected avatar', () => {
    state.avatars.value = [makeEntry('alpha', { authors: ['tekina', 'lima'], description: 'Морской слизень' })]
    state.selectedName.value = 'alpha'
    const wrapper = mountPanel()

    expect(wrapper.find('.model-tab__figura-card-name').text()).toBe('alpha')
    expect(wrapper.find('.model-tab__figura-card-author').text()).toBe('tekina, lima')
    expect(wrapper.find('.model-tab__figura-card-description').text()).toBe('Морской слизень')
  })

  it('marks the selected avatar with aria-pressed and leaves the rest unpressed', () => {
    state.avatars.value = [makeEntry('alpha'), makeEntry('beta')]
    state.selectedName.value = 'beta'
    const wrapper = mountPanel()

    expect(avatarButtons(wrapper).map((item) => item.attributes('aria-pressed'))).toEqual(['false', 'true'])
    expect(avatarButton(wrapper, 'beta')?.classes()).toContain('model-tab__figura-avatar--active')
  })

  it('labels the avatar group for screen readers', () => {
    state.avatars.value = [makeEntry('alpha')]
    const wrapper = mountPanel()

    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe(MODEL_TAB_TITLES.figura)
  })

  it('tells the missing selection state apart from the empty catalog', () => {
    state.avatars.value = [makeEntry('alpha')]
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain(EMPTY_STATES.figuraNoSelection)
    expect(wrapper.text()).not.toContain(EMPTY_STATES.figuraNoAvatars)
  })

  it('builds its own three.js scene with zoom, not a shared cpm one', async () => {
    const shared = await import('@/06-shared')
    mountPanel()

    expect(vi.mocked(shared.useThreeScene)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(shared.useThreeScene)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enableZoom: true }),
    )
  })

  it('gives every mounted viewer its own independent scene', async () => {
    const shared = await import('@/06-shared')
    mountPanel()
    mountPanel()

    expect(vi.mocked(shared.useThreeScene)).toHaveBeenCalledTimes(2)
  })

  it('does not reuse the shared cpm viewer chrome', () => {
    state.avatars.value = [makeEntry('alpha')]
    const wrapper = mountPanel()

    expect(wrapper.find('.viewer-3d').exists()).toBe(false)
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(false)
    expect(wrapper.find('.figura-viewer__canvas').exists()).toBe(true)
  })

  it('gives the viewport an accessible name', () => {
    const wrapper = mountPanel()
    const viewport = wrapper.find('[role="img"]')

    expect(viewport.attributes('aria-label')).toBe('Просмотр аватара Figura')
    expect(viewport.classes()).toContain('figura-viewer__canvas')
  })

  it('opens the fullscreen overlay and closes it on Escape', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[aria-label="Развернуть на весь экран"]').trigger('click')

    const panel = document.body.querySelector('.figura-viewer__fullscreen-content')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('Просмотр аватара Figura')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(panel?.parentElement?.style.display).toBe('none')
  })

  it('reports a missing model over the list and keeps the viewport mounted', () => {
    state.avatars.value = [makeEntry('alpha', { hasModel: false })]
    state.selectedName.value = 'alpha'
    state.modelError.value = ERRORS.figuraModelMissing
    const wrapper = mountPanel()

    expect(wrapper.find('.model-tab__figura-error').text()).toContain(ERRORS.figuraModelMissing)
    expect(wrapper.find('.figura-viewer').exists()).toBe(true)
    expect(wrapper.find('.model-tab__figura-card').exists()).toBe(true)
  })

  it('reports a missing texture while keeping the geometry on screen', () => {
    state.avatars.value = [makeEntry('alpha', { hasTexture: false })]
    state.selectedName.value = 'alpha'
    state.viewerSource.value = sourceOf()
    state.textureError.value = ERRORS.figuraTextureMissing
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain(ERRORS.figuraTextureMissing)
    expect(wrapper.find('.figura-viewer').exists()).toBe(true)
  })

  it('turns a viewer texture failure into the readable message', async () => {
    state.avatars.value = [makeEntry('alpha')]
    state.selectedName.value = 'alpha'
    const wrapper = mountPanel()

    wrapper.findComponent({ name: 'FiguraViewer' }).vm.$emit('texture-error')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain(ERRORS.figuraTextureMissing)
  })

  it('reports a failed catalog read above the list without dropping the viewport', () => {
    state.avatars.value = null
    state.listError.value = 'Ошибка файловой системы'
    const wrapper = mountPanel()

    expect(wrapper.find('.model-tab__figura-error').text()).toContain('Ошибка файловой системы')
    expect(wrapper.find('.figura-viewer').exists()).toBe(true)
    expect(avatarButtons(wrapper)).toHaveLength(0)
  })

  it('shows a loading placeholder instead of an empty catalog caption', () => {
    state.avatars.value = null
    state.isListLoading.value = true
    const wrapper = mountPanel()

    expect(wrapper.findAll('.skeleton--line')).toHaveLength(3)
    expect(wrapper.text()).not.toContain(EMPTY_STATES.figuraNoAvatars)
  })

  it('feeds the parsed model and texture of the selected avatar into the viewport', () => {
    state.avatars.value = [makeEntry('alpha')]
    state.selectedName.value = 'alpha'
    state.viewerSource.value = sourceOf()
    const wrapper = mountPanel()

    expect(wrapper.findComponent({ name: 'FiguraViewer' }).props('source')).toBe(state.viewerSource.value)
    expect(wrapper.text()).not.toContain(EMPTY_STATES.figuraNoSelection)
  })
})

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII='

const encodeModel = (withTexture: boolean): Uint8Array => new TextEncoder().encode(JSON.stringify({
  resolution: { width: 64, height: 64 },
  elements: [{
    name: 'head',
    type: 'cube',
    uuid: 'cube-head',
    from: [-4, 0, -4],
    to: [4, 8, 4],
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    faces: { north: { uv: [0, 0, 8, 8], texture: 0 } },
  }],
  outliner: ['cube-head'],
  textures: withTexture
    ? [{ name: 'skin.png', width: 64, height: 64, uv_width: 64, uv_height: 64, source: PNG_DATA_URL }]
    : [],
}))

describe('ModelTabFigura with the real avatar composable', () => {
  beforeEach(async (): Promise<void> => {
    const features = await vi.importActual<typeof import('@/04-features')>('@/04-features')
    vi.mocked(useFiguraAvatars).mockImplementation(features.useFiguraAvatars)
    useCoreStore().currentProject = 'Cordelia'
    listFiguraAvatars.mockReset()
    readFiguraAvatar.mockReset()
    listFiguraAvatars.mockResolvedValue([makeEntry('alpha')])
  })

  afterEach((): void => {
    document.body.innerHTML = ''
  })

  const selectAvatarInList = async (wrapper: VueWrapper): Promise<void> => {
    await vi.waitFor((): void => {
      if (avatarButtons(wrapper).length === 0) throw new Error('список аватаров не загрузился')
    })
    await avatarButton(wrapper, 'alpha')?.trigger('click')
    await flushPromises()
  }

  it('renders the avatar name, author and description of avatar.json', async () => {
    listFiguraAvatars.mockResolvedValue([
      makeEntry('alpha', { authors: ['tekina', 'lima'], description: 'Морской слизень' }),
    ])
    readFiguraAvatar.mockResolvedValue({
      name: 'alpha',
      authors: ['tekina', 'lima'],
      description: 'Морской слизень',
      color: null,
      model: encodeModel(true),
    })
    const wrapper = mountPanel()

    await selectAvatarInList(wrapper)

    expect(wrapper.find('.model-tab__figura-card-name').text()).toBe('alpha')
    expect(wrapper.find('.model-tab__figura-card-author').text()).toBe('tekina, lima')
    expect(wrapper.find('.model-tab__figura-card-description').text()).toBe('Морской слизень')
    expect(wrapper.text()).not.toContain(ERRORS.figuraModelMissing)
  })

  it('reports a missing model.bbmodel without dropping the viewport', async () => {
    listFiguraAvatars.mockResolvedValue([makeEntry('alpha', { hasModel: false })])
    const wrapper = mountPanel()

    await selectAvatarInList(wrapper)

    expect(wrapper.text()).toContain(ERRORS.figuraModelMissing)
    expect(wrapper.find('.figura-viewer').exists()).toBe(true)
    expect(wrapper.find('.model-tab__figura-card').exists()).toBe(true)
  })

  it('reports a missing texture and still hands the geometry to the viewport', async () => {
    listFiguraAvatars.mockResolvedValue([makeEntry('alpha', { hasTexture: false })])
    readFiguraAvatar.mockResolvedValue({
      name: 'alpha',
      authors: ['tekina'],
      description: 'alpha avatar',
      color: null,
      model: encodeModel(false),
    })
    const wrapper = mountPanel()

    await selectAvatarInList(wrapper)

    expect(wrapper.text()).toContain(ERRORS.figuraTextureMissing)
    expect(wrapper.findComponent({ name: 'FiguraViewer' }).props('source')).not.toBeNull()
    expect(wrapper.text()).not.toContain(ERRORS.figuraModelMissing)
  })
})
