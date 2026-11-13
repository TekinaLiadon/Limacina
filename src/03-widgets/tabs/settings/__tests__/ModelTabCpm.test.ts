import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ModelTabCpm from '../model-tab/ModelTabCpm.vue'
import { useAccountsStore, useCoreStore, type CPMAnimation, type CPMChild, type CPMElement } from '@/05-entities'
import { listModels, readCpmProjectFile } from '@/06-shared/api'
import { parseCpmProjectFile } from '@/04-features/cpm-settings/cpmProjectParser'
import { parseBbmodel } from '@/04-features/cpm-convert/bbmodelParser'
import { makeProjectConfig } from '@/test-support/fixtures'
import { EMPTY_STATES, LIST_TITLES } from '../model-tab/copy'

const webview = vi.hoisted(() => ({ onDragDropEvent: vi.fn() }))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({ onDragDropEvent: webview.onDragDropEvent }),
}))

vi.mock('@/06-shared/utils/reportError', () => ({ reportError: vi.fn() }))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listModels: vi.fn().mockResolvedValue([]),
  readCpmProjectFile: vi.fn(),
  savePlayerModel: vi.fn(),
  uploadModel: vi.fn(),
  deleteModel: vi.fn(),
}))

vi.mock('@/04-features/cpm-settings/cpmProjectParser', () => ({
  parseCpmProjectFile: vi.fn(),
}))

vi.mock('@/04-features/cpm-convert/bbmodelParser', () => ({
  parseBbmodel: vi.fn(),
}))

const CpmViewerStub = {
  name: 'CpmViewer',
  template: '<div class="cpm-viewer__canvas" />',
}

interface DropEvent {
  payload: { type: 'drop'; paths: string[] }
}

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'Рука',
  size: { x: 4, y: 12, z: 4 },
  offset: { x: 0, y: 0, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  storeID: 7,
  ...overrides,
})

const makeElement = (children: CPMChild[]): CPMElement => ({
  id: 'root',
  name: 'Root',
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  children,
})

const makeProject = (animations: CPMAnimation[] = []) => ({
  config: {
    skinSize: { x: 64, y: 64 },
    skinType: 'default' as const,
    elements: [makeElement([makeChild()])],
  },
  textureBlob: new Blob(['png']),
  animations,
  animEnc: null,
})

const makeGesture = (): CPMAnimation => ({
  id: 'wave',
  name: 'wave',
  kind: 'gesture',
  duration: 500,
  priority: 0,
  loop: true,
  additive: true,
  interpolator: 'linear_loop',
  hidden: false,
  frames: [],
  layerControlled: false,
})

const makeBbmodelResult = () => ({
  config: {
    skinSize: { x: 64, y: 64 },
    elements: [makeElement([makeChild()])],
  },
  skinPng: new Uint8Array([1, 2, 3]),
  animations: [makeGesture()],
})

let dropHandler: ((event: DropEvent) => void) | undefined

const mountPanel = (): VueWrapper =>
  mount(ModelTabCpm, { global: { stubs: { CpmViewer: CpmViewerStub } } })

const findButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label)

const buttonLabels = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('button').map((item) => item.text())

const loadPendingModel = async (wrapper: VueWrapper, path: string): Promise<void> => {
  useCoreStore().pendingCpmProjectPath = path
  await vi.waitFor((): void => {
    if (!wrapper.find('.cpm-viewer__canvas').exists()) throw new Error('модель не загружена')
  })
}

const dropPath = async (path: string): Promise<void> => {
  await vi.waitFor((): void => {
    if (dropHandler === undefined) throw new Error('слушатель дропа не зарегистрирован')
  })
  dropHandler?.({ payload: { type: 'drop', paths: [path] } })
  await flushPromises()
}

beforeEach((): void => {
  setActivePinia(createPinia())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((): string => 'blob:cpm-texture')
  URL.revokeObjectURL = vi.fn()
  dropHandler = undefined
  webview.onDragDropEvent.mockReset()
  webview.onDragDropEvent.mockImplementation(
    async (callback: (event: DropEvent) => void): Promise<() => void> => {
      dropHandler = callback
      return (): void => {}
    },
  )
  vi.mocked(listModels).mockReset()
  vi.mocked(listModels).mockResolvedValue([])
  vi.mocked(readCpmProjectFile).mockReset()
  vi.mocked(parseCpmProjectFile).mockReset()
  vi.mocked(parseBbmodel).mockReset()

  const core = useCoreStore()
  core.currentProject = 'proj'
  core.projectConfig = makeProjectConfig({ online: true })
  useAccountsStore().session = { uuid: 'u-1', username: 'alice' }
})

afterEach((): void => {
  vi.restoreAllMocks()
})

describe('ModelTabCpm empty state', () => {
  it('shows the cpm empty label instead of the viewer', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('.model-tab__viewer-empty').text()).toBe(EMPTY_STATES.cpm)
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(false)
  })

  it('offers only the load action without a model', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(buttonLabels(wrapper)).toContain('Загрузить модель')
    expect(findButton(wrapper, 'Отправить')).toBeUndefined()
    expect(findButton(wrapper, 'Сохранить в игру')).toBeUndefined()
    expect(findButton(wrapper, 'Сбросить модель')).toBeUndefined()
  })

  it('hides the layers and animations panels without a model', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('.model-tab__layer-panel').exists()).toBe(false)
    expect(wrapper.find('.cpm-animation-panel').exists()).toBe(false)
  })
})

describe('ModelTabCpm loaded model', () => {
  it('shows the viewer, the layers panel and every action', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseCpmProjectFile).mockResolvedValue(makeProject())
    const wrapper = mountPanel()

    await loadPendingModel(wrapper, '/models/hero.cpmproject')

    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(true)
    expect(wrapper.find('.model-tab__viewer-empty').exists()).toBe(false)
    expect(wrapper.find('.model-tab__layer-panel').exists()).toBe(true)
    expect(wrapper.find('.model-tab__layer-panel').text()).toContain('Показать пустые слои')
    expect(findButton(wrapper, 'Заменить модель')).toBeDefined()
    expect(findButton(wrapper, 'Отправить')).toBeDefined()
    expect(findButton(wrapper, 'Сбросить модель')).toBeDefined()
  })

  it('keeps the animation panel off for a model without animations', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseCpmProjectFile).mockResolvedValue(makeProject())
    const wrapper = mountPanel()

    await loadPendingModel(wrapper, '/models/hero.cpmproject')

    expect(wrapper.find('.cpm-animation-panel').exists()).toBe(false)
  })

  it('renders the animation panel for a model with animations', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseBbmodel).mockReturnValue(makeBbmodelResult())
    const wrapper = mountPanel()

    await loadPendingModel(wrapper, '/models/hero.bbmodel')

    expect(wrapper.find('.cpm-animation-panel').exists()).toBe(true)
    expect(wrapper.find('.cpm-animation-panel').text()).toContain('wave')
  })

  it('toggles animation playback and looping from the panel', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseBbmodel).mockReturnValue(makeBbmodelResult())
    const wrapper = mountPanel()

    await loadPendingModel(wrapper, '/models/hero.bbmodel')
    await wrapper.find('.cpm-tabbed-panel__item .checkbox__input').setValue(true)

    const play = wrapper.find('button[aria-label="Воспроизвести"]')
    expect(play.exists()).toBe(true)

    await play.trigger('click')
    expect(wrapper.find('button[aria-label="Пауза"]').exists()).toBe(true)

    const loop = wrapper.find('button[aria-label="Повторять анимацию"]')
    expect(loop.attributes('aria-pressed')).toBe('false')

    await loop.trigger('click')
    expect(wrapper.find('button[aria-label="Повторять анимацию"]').attributes('aria-pressed')).toBe('true')
  })

  it('shows the offline save action instead of the server action in an offline project', async () => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseCpmProjectFile).mockResolvedValue(makeProject())
    const wrapper = mountPanel()

    await loadPendingModel(wrapper, '/models/hero.cpmproject')

    expect(findButton(wrapper, 'Сохранить в игру')).toBeDefined()
    expect(findButton(wrapper, 'Отправить')).toBeUndefined()
    expect(wrapper.find('.user-content-viewer__notice').exists()).toBe(true)
  })
})

describe('ModelTabCpm model list', () => {
  it('keeps only cpm entries in the list', async () => {
    vi.mocked(listModels).mockResolvedValue([
      { id: 1, url: 'https://cdn/one.cpm' },
      { id: 2, url: 'https://cdn/two.cpm', format: 'cpm' },
      { id: 3, url: 'https://cdn/three.bbmodel', format: 'bbmodel' },
    ])
    const wrapper = mountPanel()

    await vi.waitFor((): void => {
      if (wrapper.findAll('.user-content-list__url').length !== 2) throw new Error('список не отфильтрован')
    })

    expect(wrapper.findAll('.user-content-list__url').map((item) => item.text())).toEqual([
      'https://cdn/one.cpm',
      'https://cdn/two.cpm',
    ])
    expect(wrapper.find('.user-content-list__title').text()).toBe(LIST_TITLES.cpm)
  })

  it('keeps the list empty without turning it into an error', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.findAll('.user-content-list__url')).toHaveLength(0)
    expect(wrapper.find('.user-content-list').exists()).toBe(false)
    expect(wrapper.find('.user-content-viewer__error').exists()).toBe(false)
  })
})

describe('ModelTabCpm file drop', () => {
  it('rejects a png drop with the accepted format message', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseCpmProjectFile).mockResolvedValue(makeProject())
    const wrapper = mountPanel()
    await loadPendingModel(wrapper, '/models/hero.cpmproject')
    vi.mocked(readCpmProjectFile).mockClear()

    await dropPath('/models/skin.png')

    expect(wrapper.find('.user-content-viewer__error').text()).toBe('Допустимый формат: .cpmproject, .bbmodel')
    expect(readCpmProjectFile).not.toHaveBeenCalled()
    expect(wrapper.find('.cpm-viewer__canvas').exists()).toBe(true)
    expect(findButton(wrapper, 'Отправить')).toBeDefined()
  })

  it('loads the model from a bbmodel drop', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseBbmodel).mockReturnValue(makeBbmodelResult())
    const wrapper = mountPanel()
    await flushPromises()

    await dropPath('/models/hero.bbmodel')

    await vi.waitFor((): void => {
      if (!wrapper.find('.cpm-viewer__canvas').exists()) throw new Error('модель не загружена')
    })

    expect(readCpmProjectFile).toHaveBeenCalledWith('/models/hero.bbmodel')
    expect(parseBbmodel).toHaveBeenCalledWith(new Uint8Array(8))
    expect(wrapper.find('.user-content-viewer__error').exists()).toBe(false)
    expect(findButton(wrapper, 'Отправить')).toBeDefined()
  })

  it('loads the model from a cpmproject drop', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    vi.mocked(parseCpmProjectFile).mockResolvedValue(makeProject())
    const wrapper = mountPanel()
    await flushPromises()

    await dropPath('/models/hero.cpmproject')

    await vi.waitFor((): void => {
      if (!wrapper.find('.cpm-viewer__canvas').exists()) throw new Error('модель не загружена')
    })

    expect(parseCpmProjectFile).toHaveBeenCalledWith(new Uint8Array(8))
    expect(wrapper.find('.model-tab__layer-panel').exists()).toBe(true)
  })
})
