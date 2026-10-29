import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  deleteModel,
  listModels,
  readCpmProjectFile,
  savePlayerModel,
  uploadModel,
} from '@/06-shared/api'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type CPMAnimation,
  type CPMChild,
  type CPMElement,
  type UserContentItem,
} from '@/05-entities'
import { useCpmSettings, type CpmLayerPanelData, type CpmLayerTabItem } from '../useCpmSettings'
import { useModelUserContent } from '@/04-features/user-content/useUserContent'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'

const exporter = vi.hoisted(() => ({
  cpmProjectToLinkBase64: vi.fn(),
  cpmConfigToLinkBytes: vi.fn(),
}))

const bbmodel = vi.hoisted(() => ({
  parseBbmodel: vi.fn(),
}))

const writer = vi.hoisted(() => ({
  bytesToBase64: vi.fn(),
}))

const parser = vi.hoisted(() => ({
  parseCpmProjectFile: vi.fn(),
}))

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError,
}))

vi.mock('@/06-shared/utils/reportError', () => ({ reportError }))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  deleteModel: vi.fn(),
  listModels: vi.fn(),
  readCpmProjectFile: vi.fn(),
  savePlayerModel: vi.fn(),
  uploadModel: vi.fn(),
}))

vi.mock('@/04-features/cpm-convert/cpmProjectExporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/cpm-convert/cpmProjectExporter')>()),
  cpmProjectToLinkBase64: exporter.cpmProjectToLinkBase64,
  cpmConfigToLinkBytes: exporter.cpmConfigToLinkBytes,
}))

vi.mock('@/04-features/cpm-convert/bbmodelParser', () => ({
  parseBbmodel: bbmodel.parseBbmodel,
}))

vi.mock('@/04-features/cpm-convert/cpmBinaryWriter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/cpm-convert/cpmBinaryWriter')>()),
  bytesToBase64: writer.bytesToBase64,
}))

vi.mock('@/04-features/cpm-settings/cpmProjectParser', () => ({
  parseCpmProjectFile: parser.parseCpmProjectFile,
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (): Promise<() => void> => () => {},
  }),
}))

const createObjectURLMock = vi.fn((): string => 'blob:mock-texture')
URL.createObjectURL = createObjectURLMock
URL.revokeObjectURL = vi.fn()

const makeChild = (overrides: Partial<CPMChild> = {}): CPMChild => ({
  name: 'Part',
  size: { x: 1, y: 1, z: 1 },
  offset: { x: 0, y: 0, z: 0 },
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
})

const makeElement = (children: CPMChild[]): CPMElement => ({
  id: 'root',
  name: 'Root',
  pos: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  children,
})

const makeProject = (skinType: 'default' | 'slim' = 'default') => ({
  config: {
    skinSize: { x: 64, y: 64 },
    skinType,
    elements: [makeElement([])],
  },
  textureBlob: new Blob(['png']),
  animations: [],
  animEnc: null,
})

const makeModel = (id: number): UserContentItem => ({ id, url: `https://cdn/${id}.cpm` })

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
    elements: [makeElement([])],
  },
  skinPng: new Uint8Array([1, 2, 3]),
  animations: [makeGesture()],
})

const panelItems = (data: CpmLayerPanelData, tab: string): CpmLayerTabItem[] =>
  data[tab] as CpmLayerTabItem[]

describe('useCpmSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteModel).mockReset()
    vi.mocked(listModels).mockReset()
    vi.mocked(readCpmProjectFile).mockReset()
    vi.mocked(savePlayerModel).mockReset()
    vi.mocked(uploadModel).mockReset()
    vi.mocked(listModels).mockResolvedValue([])
    exporter.cpmProjectToLinkBase64.mockReset()
    exporter.cpmConfigToLinkBytes.mockReset()
    bbmodel.parseBbmodel.mockReset()
    writer.bytesToBase64.mockReset()
    parser.parseCpmProjectFile.mockReset()
    reportError.mockClear()
    createObjectURLMock.mockClear()
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.projectConfig = makeProjectConfig()
    useAccountsStore().session = { uuid: 'u-1', username: 'alice' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupCpm = (): ReturnType<typeof useCpmSettings> => {
    const { result } = withSetup(() => useCpmSettings())
    return result
  }

  it('loads the model list on setup', async () => {
    vi.mocked(listModels).mockResolvedValue([makeModel(1)])
    const cpm = setupCpm()

    await vi.waitFor(() => expect(cpm.uploadedModels.value).toHaveLength(1))

    expect(cpm.listError.value).toBe('')
  })

  it('uses the injected user content instance', async () => {
    const { result: content } = withSetup(() => useModelUserContent())
    const cpm = withSetup(() => useCpmSettings(content)).result

    await vi.waitFor(() => expect(cpm.uploadedModels.value).toEqual([]))

    expect(cpm.errorMessage).toBe(content.errorMessage)
    expect(cpm.isOffline).toBe(content.isOffline)
    expect(cpm.handleDeleteModel).toBeDefined()
    expect(vi.mocked(listModels)).toHaveBeenCalledTimes(1)
  })

  it('opens the pending project file from the launch args', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(core.pendingCpmProjectPath).toBeNull()
    expect(readCpmProjectFile).toHaveBeenCalledWith('/models/hero.cpmproject')
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('loads a bbmodel with its animations through the converter', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    bbmodel.parseBbmodel.mockReturnValue(makeBbmodelResult())
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.bbmodel'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(bbmodel.parseBbmodel).toHaveBeenCalledWith(bytes)
    expect(parser.parseCpmProjectFile).not.toHaveBeenCalled()
    expect(cpm.cpmData.value?.animations).toHaveLength(1)
    expect(cpm.cpmData.value?.textureUrl).toBe('blob:mock-texture')
    expect(cpm.cpmSkinPng.value).toEqual(new Uint8Array([1, 2, 3]))
    expect(cpm.modelName.value).toBe('hero')
  })

  it('rejects a bbmodel without a texture', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    bbmodel.parseBbmodel.mockReturnValue({ ...makeBbmodelResult(), skinPng: null })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.bbmodel'
    await vi.waitFor(() => expect(cpm.errorMessage.value).not.toBe(''))

    expect(cpm.errorMessage.value).toBe('В файле .bbmodel нет текстуры модели')
    expect(cpm.cpmData.value).toBeNull()
    expect(cpm.cpmSkinPng.value).toBeNull()
  })

  it('surfaces the bbmodel conversion error', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    bbmodel.parseBbmodel.mockImplementation(() => {
      throw new Error('Файл .bbmodel повреждён: длительность анимации "wave" превышает 65 секунд')
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/bad.bbmodel'
    await vi.waitFor(() => expect(cpm.errorMessage.value).not.toBe(''))

    expect(cpm.errorMessage.value).toContain('повреждён')
    expect(cpm.cpmData.value).toBeNull()
    expect(cpm.cpmSkinPng.value).toBeNull()
  })

  it('uploads the bbmodel model through the config exporter', async () => {
    const result = makeBbmodelResult()
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(8))
    bbmodel.parseBbmodel.mockReturnValue(result)
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    exporter.cpmConfigToLinkBytes.mockReturnValue(new Uint8Array([7]))
    writer.bytesToBase64.mockReturnValue('bb-base64')
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.bbmodel'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleUploadModel()

    expect(exporter.cpmConfigToLinkBytes).toHaveBeenCalledWith(
      result.config,
      result.skinPng,
      { animations: result.animations },
    )
    expect(writer.bytesToBase64).toHaveBeenCalledWith(new Uint8Array([7]))
    expect(exporter.cpmProjectToLinkBase64).not.toHaveBeenCalled()
    expect(uploadModel).toHaveBeenCalledWith('bb-base64')
    expect(savePlayerModel).toHaveBeenCalledWith('proj', expect.objectContaining({ name: 'hero' }))
    expect(cpm.isUploading.value).toBe(false)
  })

  it('drops the bbmodel skin bytes when a cpmproject is loaded next', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    bbmodel.parseBbmodel.mockReturnValue(makeBbmodelResult())
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    exporter.cpmProjectToLinkBase64.mockResolvedValue('base64-link')
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.bbmodel'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())
    expect(cpm.cpmSkinPng.value).not.toBeNull()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmSkinPng.value).toBeNull())

    await cpm.handleUploadModel()

    expect(exporter.cpmConfigToLinkBytes).not.toHaveBeenCalled()
    expect(exporter.cpmProjectToLinkBase64).toHaveBeenCalledWith(bytes, expect.objectContaining({ animations: [] }))
  })

  it('revokes the previous texture url when a new model is loaded', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    bbmodel.parseBbmodel.mockReturnValue(makeBbmodelResult())
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.bbmodel'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    core.pendingCpmProjectPath = '/models/hero-reload.bbmodel'
    await vi.waitFor(() => expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:mock-texture'))
  })

  it('does not create the texture blob url when the load finishes after disposal', async () => {
    let releaseRead: (bytes: Uint8Array) => void = () => {}
    vi.mocked(readCpmProjectFile).mockImplementation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releaseRead = resolve
        }),
    )
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    const core = useCoreStore()
    const { result, unmount } = withSetup(() => useCpmSettings())

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(readCpmProjectFile).toHaveBeenCalledTimes(1))

    unmount()
    expect(result.cpmData.value).toBeNull()

    releaseRead(new Uint8Array(8))
    await vi.waitFor(() => expect(parser.parseCpmProjectFile).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(result.errorMessage.value).toBe(''))

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(result.cpmData.value).toBeNull()
    expect(result.cpmFileBytes.value).toBeNull()
    expect(result.modelName.value).toBe('Модель')
  })

  it('rejects an oversized pending project file with the dialog message', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(5 * 1024 * 1024))
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.errorMessage.value).not.toBe(''))

    expect(core.pendingCpmProjectPath).toBeNull()
    expect(cpm.errorMessage.value).toBe('Размер файла не должен превышать 4096 КБ (загружено 5120 КБ)')
    expect(parser.parseCpmProjectFile).not.toHaveBeenCalled()
    expect(cpm.cpmData.value).toBeNull()
  })

  it('collects the layers skipping only empty parts', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [
          makeElement([
            makeChild({ name: 'Body', storeID: 5 }),
            makeChild({ name: 'Empty', size: { x: 0, y: 0, z: 0 }, storeID: 6 }),
            makeChild({ name: 'Hidden', hidden: true, storeID: 7 }),
          ]),
        ],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(cpm.displayLayers.value.map((layer) => layer.name)).toEqual(['Body', 'Hidden'])
    expect(cpm.activeLayerIds.value).toEqual([5, 7])
    expect(cpm.visibleLayerKeys.value).toEqual(['5', '7'])

    expect(cpm.layerPanelData.value.tabs).toEqual(['Root'])
    expect(panelItems(cpm.layerPanelData.value, 'Root').map((item) => item.label)).toEqual(['Body', 'Hidden'])
    expect(panelItems(cpm.layerPanelData.value, 'Root').map((item) => item.id)).toEqual(['5', '7'])

    cpm.showEmptyLayers.value = true
    expect(cpm.displayLayers.value).toHaveLength(3)
    expect(panelItems(cpm.layerPanelData.value, 'Root').map((item) => item.label)).toEqual([
      'Body',
      'Empty',
      'Hidden',
    ])
  })

  it('groups layers by the root part and applies visibility through the panel keys', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [
          { ...makeElement([makeChild({ name: 'Helmet', storeID: 5 })]), id: 'head', name: 'Head' },
          { ...makeElement([makeChild({ name: 'Cape', storeID: 7 })]), id: 'body', name: 'Body' },
        ],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(cpm.layerPanelData.value.tabs).toEqual(['Head', 'Body'])
    expect(panelItems(cpm.layerPanelData.value, 'Head')).toEqual([
      { id: '5', label: 'Helmet', disabled: false },
    ])
    expect(panelItems(cpm.layerPanelData.value, 'Body')).toEqual([
      { id: '7', label: 'Cape', disabled: false },
    ])
    expect(cpm.visibleLayerKeys.value).toEqual(['5', '7'])

    cpm.setVisibleLayerKeys(['5'])
    expect(cpm.activeLayerIds.value).toEqual([5])
    expect(cpm.visibleLayerKeys.value).toEqual(['5'])

    cpm.setVisibleLayerKeys(['7'])
    expect(cpm.activeLayerIds.value).toEqual([7])
    expect(cpm.visibleLayerKeys.value).toEqual(['7'])
  })

  it('labels standard root parts when the root name is empty', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [
          { ...makeElement([makeChild({ name: 'Helmet', storeID: 5 })]), id: 'head', name: '' },
          { ...makeElement([makeChild({ name: 'Cape', storeID: 7 })]), id: 'body', name: '' },
          { ...makeElement([makeChild({ name: 'Glove', storeID: 9 })]), id: 'left_arm', name: '' },
          { ...makeElement([makeChild({ name: 'Boot', storeID: 11 })]), id: 'right_leg', name: '' },
        ],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(cpm.layerPanelData.value.tabs).toEqual([
      'Голова',
      'Тело',
      'Левая рука',
      'Правая нога',
    ])
    expect(panelItems(cpm.layerPanelData.value, 'Голова')).toEqual([
      { id: '5', label: 'Helmet', disabled: false },
    ])
  })

  it('keeps hidden expression layers active so animation show tracks can reveal them', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    const hiddenExpression = makeChild({ name: 'Expression Happy', hidden: true, storeID: 11 })
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [
          makeElement([
            makeChild({ name: 'Body', storeID: 5 }),
            hiddenExpression,
          ]),
        ],
      },
      textureBlob: new Blob(['png']),
      animations: [
        {
          id: 'happy',
          name: 'happy',
          kind: 'gesture',
          duration: 1000,
          priority: 0,
          loop: false,
          additive: true,
          interpolator: 'poly_loop',
          hidden: false,
          frames: [
            {
              components: [
                { storeID: 5, pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: false },
                { storeID: 11, pos: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: true },
              ],
            },
          ],
        },
      ],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    expect(cpm.activeLayerIds.value).toContain(11)
    expect(cpm.displayLayers.value.map((layer) => layer.name)).toContain('Expression Happy')
  })

  it('keeps layer visibility choices across the cpm data reload', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [
          makeElement([
            makeChild({ name: 'Body', storeID: 5 }),
            makeChild({ name: 'Cloak', storeID: 7 }),
          ]),
        ],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    cpm.toggleLayer(5)
    expect(cpm.activeLayerIds.value).toEqual([7])

    core.pendingCpmProjectPath = '/models/hero-reload.cpmproject'
    await vi.waitFor(() => {
      const body = cpm.displayLayers.value.find((layer) => layer.name === 'Body')
      expect(body?.visible).toBe(false)
    })

    expect(cpm.displayLayers.value.map((layer) => layer.name)).toEqual(['Body', 'Cloak'])
    expect(cpm.activeLayerIds.value).toEqual([7])
  })

  it('drops hidden layer ids missing from the reloaded model', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [makeElement([makeChild({ name: 'Body', storeID: 5 })])],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    cpm.toggleLayer(5)
    expect(cpm.activeLayerIds.value).toEqual([])

    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [makeElement([makeChild({ name: 'Cape', storeID: 9 })])],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    core.pendingCpmProjectPath = '/models/other.cpmproject'
    await vi.waitFor(() => expect(cpm.activeLayerIds.value).toEqual([9]))
  })

  it('ignores toggles for layers without a store id', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue({
      config: {
        skinSize: { x: 64, y: 64 },
        elements: [makeElement([makeChild({ name: 'Body', storeID: 5 })])],
      },
      textureBlob: new Blob(['png']),
      animations: [],
    })
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    cpm.toggleLayer(null)
    expect(cpm.activeLayerIds.value).toEqual([5])
  })

  it('sets the texture load error through the composable action', async () => {
    const cpm = setupCpm()
    await vi.waitFor(() => expect(cpm.isListLoading.value).toBe(false))

    expect(cpm.errorMessage.value).toBe('')
    cpm.setTextureError()

    expect(cpm.errorMessage.value).toBe('Не удалось загрузить текстуру модели')
  })

  it('uploads the model as a link and registers it in the game', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject('slim'))
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    exporter.cpmProjectToLinkBase64.mockResolvedValue('base64-link')
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleUploadModel()

    expect(exporter.cpmProjectToLinkBase64).toHaveBeenCalledWith(bytes, expect.objectContaining({
      animations: [],
      animEnc: null,
    }))
    expect(uploadModel).toHaveBeenCalledWith('base64-link')
    expect(savePlayerModel).toHaveBeenCalledWith('proj', {
      name: 'hero',
      url: 'https://cdn/9.cpm',
      modelId: 9,
      slim: true,
      data: null,
    })
    expect(useNotificationStore().message).toBe('Модель добавлена в игру')
    expect(cpm.isUploading.value).toBe(false)
  })

  it('surfaces the upload failure', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    vi.mocked(uploadModel).mockRejectedValue(new Error('bad archive'))
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleUploadModel()

    expect(cpm.errorMessage.value).toBe('bad archive')
    expect(savePlayerModel).not.toHaveBeenCalled()
  })

  it('deletes the orphaned uploaded model when savePlayerModel fails', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(savePlayerModel).mockRejectedValue(new Error('denied'))
    vi.mocked(deleteModel).mockResolvedValue(undefined)
    vi.mocked(listModels).mockResolvedValue([])
    exporter.cpmProjectToLinkBase64.mockResolvedValue('base64-link')
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleUploadModel()

    expect(savePlayerModel).toHaveBeenCalledOnce()
    expect(deleteModel).toHaveBeenCalledWith(9)
    expect(cpm.errorMessage.value).toBe('denied')
    expect(useNotificationStore().message).not.toBe('Модель добавлена в игру')
    expect(cpm.isUploading.value).toBe(false)
  })

  it('keeps the orphaned model deletable when the rollback delete fails too', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(savePlayerModel).mockRejectedValue(new Error('denied'))
    vi.mocked(deleteModel).mockRejectedValue(new Error('also down'))
    exporter.cpmProjectToLinkBase64.mockResolvedValue('base64-link')
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleUploadModel()

    expect(cpm.errorMessage.value).toBe('denied')
    expect(reportError).toHaveBeenCalledWith('Не удалось удалить модель', expect.objectContaining({ message: 'also down' }))
    expect(reportError).toHaveBeenCalledWith('Не удалось сохранить модель', expect.objectContaining({ message: 'denied' }))
    expect(cpm.isUploading.value).toBe(false)
  })

  it('rolls back the uploaded model without an error after the project switches mid-upload', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    vi.mocked(uploadModel).mockResolvedValue(makeModel(9))
    vi.mocked(deleteModel).mockResolvedValue(undefined)
    vi.mocked(listModels).mockResolvedValue([])
    exporter.cpmProjectToLinkBase64.mockResolvedValue('base64-link')
    let rejectSave: (error: Error) => void = () => {}
    vi.mocked(savePlayerModel).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        }),
    )
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    const pending = cpm.handleUploadModel()
    await vi.waitFor(() => expect(savePlayerModel).toHaveBeenCalledOnce())

    core.currentProject = 'other'
    await nextTick()
    rejectSave(new Error('denied'))
    await pending

    expect(deleteModel).toHaveBeenCalledWith(9)
    expect(cpm.errorMessage.value).toBe('')
    expect(cpm.isUploading.value).toBe(false)
  })

  it('skips the upload without an opened model', async () => {
    vi.mocked(uploadModel).mockResolvedValue(makeModel(1))
    const cpm = setupCpm()

    await cpm.handleUploadModel()

    expect(uploadModel).not.toHaveBeenCalled()
  })

  it('resets the model after confirmation', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    const core = useCoreStore()
    const cpm = setupCpm()
    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    const declined = cpm.resetCpm()
    useNotificationStore().resolvePopup(false)
    await declined
    expect(cpm.cpmData.value).not.toBeNull()

    const confirmed = cpm.resetCpm()
    useNotificationStore().resolvePopup(true)
    await confirmed

    expect(cpm.cpmData.value).toBeNull()
    expect(cpm.displayLayers.value).toEqual([])
    expect(cpm.activeLayerIds.value).toEqual([])
  })

  it('deletes the uploaded model after confirmation', async () => {
    vi.mocked(deleteModel).mockResolvedValue(undefined)
    const cpm = setupCpm()

    const pending = cpm.handleDeleteModel(4)
    useNotificationStore().resolvePopup(true)
    await pending

    expect(deleteModel).toHaveBeenCalledWith(4)
  })

  it('resets the loaded model when the project switches', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    core.currentProject = 'other'
    useAccountsStore().clearSessionState()
    await nextTick()

    expect(cpm.cpmData.value).toBeNull()
    expect(cpm.uploadedModels.value).toEqual([])
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:mock-texture')
  })
})
