import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { listModels, readCpmProjectFile, savePlayerModel } from '@/06-shared/api'
import { useAccountsStore, useCoreStore, useNotificationStore } from '@/05-entities'
import ModelTabBbmodel from '../model-tab/ModelTabBbmodel.vue'
import { BLOCKBENCH_CARD_HINT, EMPTY_STATES, FORMAT_HINTS, LIST_TITLES } from '../model-tab/copy'
import { makeProjectConfig } from '@/test-support/fixtures'

const MODEL_MAX_BYTES = 4 * 1024 * 1024

const shared = vi.hoisted(() => ({
  selectFile: vi.fn(),
}))

const dropHandler = vi.hoisted(() => ({
  current: undefined as ((event: unknown) => void) | undefined,
}))

vi.mock('@/06-shared/utils/reportError', () => ({ reportError: vi.fn() }))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  selectFile: shared.selectFile,
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listModels: vi.fn().mockResolvedValue([]),
  readCpmProjectFile: vi.fn(),
  savePlayerModel: vi.fn(),
  uploadModel: vi.fn(),
  deleteModel: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: (): unknown => ({
    onDragDropEvent: async (callback: (event: unknown) => void): Promise<() => void> => {
      dropHandler.current = callback
      return (): void => {}
    },
  }),
}))

const TINY_PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]

const TINY_PNG_BASE64 = btoa(String.fromCharCode(...TINY_PNG_BYTES))

const makeCube = (name: string, from: number[], to: number[]): Record<string, unknown> => ({
  name,
  type: 'cube',
  uuid: `uuid-${name}`,
  box_uv: false,
  origin: [0, 24, 0],
  from,
  to,
  faces: {},
})

const makeGroup = (name: string, children: unknown[]): Record<string, unknown> => ({
  name,
  uuid: `group-${name}`,
  origin: [0, 24, 0],
  children,
})

const makeWaveAnimation = (): Record<string, unknown> => ({
  uuid: 'anim-wave',
  name: 'Wave',
  loop: 'once',
  length: 0.5,
  animators: {
    'group-head': {
      channels: ['rotation'],
      keyframes: [{ channel: 'rotation', time: 0, data_points: [{ x: 90, y: 0, z: 0 }] }],
    },
  },
})

const makeBbmodel = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  meta: { format_version: '4.10', model_format: 'free', box_uv: false },
  name: 'TestModel',
  model_identifier: '',
  resolution: { width: 64, height: 64 },
  elements: [makeCube('Head', [-4, 24, -4], [4, 32, 4])],
  outliner: [makeGroup('head', ['uuid-Head'])],
  textures: [{ name: 'skin.png', source: `data:image/png;base64,${TINY_PNG_BASE64}` }],
  ...overrides,
})

const encode = (model: Record<string, unknown>): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(model))

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const mountPanel = (): VueWrapper => mount(ModelTabBbmodel)

const findButton = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label)

const button = (wrapper: VueWrapper, label: string) => {
  const found = findButton(wrapper, label)
  if (!found) throw new Error(`кнопка «${label}» не найдена`)
  return found
}

interface DialogOptions {
  accept: string
  maxBytes: number
  readAs: string
  onLoad: (file: { name: string }, result: string | ArrayBuffer) => Promise<void>
  onError: (message: string) => void
}

const lastDialogOptions = (): DialogOptions => {
  const { calls } = shared.selectFile.mock
  const options = calls[calls.length - 1]?.[0] as DialogOptions | undefined
  if (options === undefined) throw new Error('диалог выбора файла не открывался')
  return options
}

const pickBbmodel = async (wrapper: VueWrapper, model: Record<string, unknown>, name: string): Promise<void> => {
  await button(wrapper, 'Загрузить модель').trigger('click')
  await lastDialogOptions().onLoad({ name }, toArrayBuffer(encode(model)))
  await flushPromises()
}

const waitForDropHandler = async (): Promise<(event: unknown) => void> => {
  await vi.waitFor(() => {
    if (dropHandler.current === undefined) throw new Error('слушатель дропа не поставлен')
  })
  return dropHandler.current as (event: unknown) => void
}

const online = (): void => {
  const core = useCoreStore()
  core.currentProject = 'proj'
  core.projectConfig = makeProjectConfig({ online: true })
  useAccountsStore().session = { uuid: 'u-1', username: 'alice' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(console, 'error').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((): string => 'blob:mock-texture')
  URL.revokeObjectURL = vi.fn()
  shared.selectFile.mockReset()
  dropHandler.current = undefined
  vi.mocked(listModels).mockReset()
  vi.mocked(listModels).mockResolvedValue([])
  vi.mocked(readCpmProjectFile).mockReset()
  vi.mocked(savePlayerModel).mockReset()
  vi.mocked(savePlayerModel).mockResolvedValue(undefined)
  online()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ModelTabBbmodel empty state', () => {
  it('shows the bbmodel empty label and no model card', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.model-tab__viewer-empty').text()).toBe(EMPTY_STATES.blockbench)
    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(false)
  })

  it('hints only the bbmodel format with the 4 MB cap', () => {
    const wrapper = mountPanel()
    const hint = wrapper.find('.user-content-viewer__hint').text()

    expect(hint).toBe(FORMAT_HINTS.blockbench(MODEL_MAX_BYTES))
    expect(hint).not.toContain('.cpmproject')
  })

  it('hides the upload and reset actions until a model is loaded', () => {
    const wrapper = mountPanel()

    expect(findButton(wrapper, 'Отправить')).toBeUndefined()
    expect(findButton(wrapper, 'Сбросить модель')).toBeUndefined()
    expect(button(wrapper, 'Загрузить модель').exists()).toBe(true)
  })
})

describe('ModelTabBbmodel conversion', () => {
  it('converts a cube model into the card with element and animation counts', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(true)
    expect(wrapper.find('.model-tab__viewer-empty').exists()).toBe(false)
    expect(wrapper.find('.model-tab__bbmodel-name').text()).toBe('hero')
    expect(wrapper.findAll('.model-tab__bbmodel-value').map((node) => node.text())).toEqual(['1', '0'])
    expect(wrapper.find('.model-tab__bbmodel-hint').text()).toBe(BLOCKBENCH_CARD_HINT)
    expect(wrapper.find('.user-content-viewer__error').exists()).toBe(false)
  })

  it('counts every root element and animation of the converted model', async () => {
    const model = makeBbmodel({
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        makeCube('Arm', [4, 12, -2], [8, 24, 2]),
      ],
      outliner: [makeGroup('head', ['uuid-Head']), makeGroup('left_arm', ['uuid-Arm'])],
      animations: [makeWaveAnimation()],
    })
    const wrapper = mountPanel()
    await flushPromises()

    await pickBbmodel(wrapper, model, 'hero.bbmodel')

    expect(wrapper.findAll('.model-tab__bbmodel-value').map((node) => node.text())).toEqual(['2', '1'])
  })

  it('shows the converter error for a model with mesh elements', async () => {
    const model = makeBbmodel({
      elements: [
        makeCube('Head', [-4, 24, -4], [4, 32, 4]),
        { name: 'Curl', type: 'mesh', uuid: 'uuid-mesh' },
      ],
    })
    const wrapper = mountPanel()
    await flushPromises()

    await pickBbmodel(wrapper, model, 'hero.bbmodel')

    const error = wrapper.find('.user-content-viewer__error')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('Конвертер поддерживает только кубы')
    expect(error.text()).toContain('Curl')
    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(false)
    expect(wrapper.find('.model-tab__viewer-empty').text()).toBe(EMPTY_STATES.blockbench)
  })

  it('shows the converter error for a model without a texture', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await pickBbmodel(wrapper, makeBbmodel({ textures: [] }), 'hero.bbmodel')

    expect(wrapper.find('.user-content-viewer__error').text()).toBe(
      'В файле .bbmodel нет текстуры модели',
    )
    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(false)
  })

  it('replaces the card of the previous model with the new one', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    await button(wrapper, 'Заменить модель').trigger('click')
    await lastDialogOptions().onLoad({ name: 'villain.bbmodel' }, toArrayBuffer(encode(makeBbmodel())))
    await flushPromises()

    expect(wrapper.find('.model-tab__bbmodel-name').text()).toBe('villain')
  })
})

describe('ModelTabBbmodel format routing', () => {
  it('opens the file dialog for bbmodel only with the 4 MB cap', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await button(wrapper, 'Загрузить модель').trigger('click')

    expect(shared.selectFile).toHaveBeenCalledWith(expect.objectContaining({
      accept: '.bbmodel',
      maxBytes: MODEL_MAX_BYTES,
      readAs: 'arrayBuffer',
    }))
  })

  it('rejects a cpmproject dropped onto the blockbench panel', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    const handler = await waitForDropHandler()

    handler({ payload: { type: 'drop', paths: ['/models/hero.cpmproject'] } })
    await flushPromises()

    expect(wrapper.find('.user-content-viewer__error').text()).toBe('Допустимый формат: .bbmodel')
    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(false)
    expect(wrapper.find('.model-tab__viewer-empty').text()).toBe(EMPTY_STATES.blockbench)
    expect(readCpmProjectFile).not.toHaveBeenCalled()
  })

  it('loads a bbmodel dropped onto the blockbench panel', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(encode(makeBbmodel()))
    const wrapper = mountPanel()
    await flushPromises()
    const handler = await waitForDropHandler()

    handler({ payload: { type: 'drop', paths: ['/models/hero.bbmodel'] } })
    await flushPromises()

    expect(readCpmProjectFile).toHaveBeenCalledWith('/models/hero.bbmodel')
    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(true)
    expect(wrapper.find('.model-tab__bbmodel-name').text()).toBe('hero')
  })

  it('lists only bbmodel records and titles the list for blockbench', async () => {
    vi.mocked(listModels).mockResolvedValue([
      { id: 1, url: 'https://cdn/1.cpm' },
      { id: 2, url: 'https://cdn/2.cpm', format: 'bbmodel' },
    ])
    const wrapper = mountPanel()

    await vi.waitFor(() => {
      expect(wrapper.findAll('.user-content-list__item')).toHaveLength(1)
    })
    expect(wrapper.find('.user-content-list__url').text()).toBe('https://cdn/2.cpm')
    expect(wrapper.find('.user-content-list__title').text()).toBe(LIST_TITLES.blockbench)
  })

  it('shows no list and no error when only cpm records exist', async () => {
    vi.mocked(listModels).mockResolvedValue([{ id: 1, url: 'https://cdn/1.cpm' }])
    const wrapper = mountPanel()

    await vi.waitFor(() => {
      expect(listModels).toHaveBeenCalledWith('u-1')
    })
    await flushPromises()

    expect(wrapper.find('.user-content-list').exists()).toBe(false)
    expect(wrapper.find('.load-error-row').exists()).toBe(false)
    expect(wrapper.find('.user-content-viewer__error').exists()).toBe(false)
  })
})

describe('ModelTabBbmodel offline saving', () => {
  beforeEach(() => {
    useCoreStore().projectConfig = makeProjectConfig({ online: false })
  })

  it('offers the offline save action instead of the server upload', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    expect(findButton(wrapper, 'Отправить')).toBeUndefined()
    expect(button(wrapper, 'Сохранить в игру').exists()).toBe(true)
  })

  it('saves the converted model with the bbmodel format', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    await button(wrapper, 'Сохранить в игру').trigger('click')

    await vi.waitFor(() => {
      expect(savePlayerModel).toHaveBeenCalledWith(
        'proj',
        expect.objectContaining({ name: 'hero', format: 'bbmodel' }),
      )
    })
    expect(useNotificationStore().message).toBe('Модель сохранена в игру')
  })

  it('keeps the offline save action disabled while the save is running', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    vi.mocked(savePlayerModel).mockImplementation(
      () => new Promise<void>(() => {}),
    )
    await button(wrapper, 'Сохранить в игру').trigger('click')

    expect(button(wrapper, 'Сохранить в игру').attributes('disabled')).toBeDefined()
    expect(findButton(wrapper, 'Отправить')).toBeUndefined()
  })

  it('clears the loaded model through the reset action', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    await pickBbmodel(wrapper, makeBbmodel(), 'hero.bbmodel')

    await button(wrapper, 'Сбросить модель').trigger('click')
    useNotificationStore().resolvePopup(true)
    await flushPromises()

    expect(wrapper.find('.model-tab__bbmodel-card').exists()).toBe(false)
    expect(wrapper.find('.model-tab__viewer-empty').text()).toBe(EMPTY_STATES.blockbench)
  })
})
