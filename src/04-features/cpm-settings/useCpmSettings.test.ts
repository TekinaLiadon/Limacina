import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  deleteModel,
  getPlayerModelsLimit,
  listModels,
  readCpmProjectFile,
  savePlayerModel,
  setPlayerModelsLimit,
  uploadModel,
} from '@/06-shared/api'
import {
  useCoreStore,
  useNotificationStore,
  type CPMChild,
  type CPMElement,
  type UserContentItem,
} from '@/05-entities'
import { useCpmSettings } from './useCpmSettings'
import { withSetup } from '@/test-support/withSetup'

const exporter = vi.hoisted(() => ({
  cpmProjectToBytes: vi.fn(),
  cpmProjectToLinkBase64: vi.fn(),
}))

const parser = vi.hoisted(() => ({
  parseCpmProjectFile: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  deleteModel: vi.fn(),
  getPlayerModelsLimit: vi.fn(),
  listModels: vi.fn(),
  readCpmProjectFile: vi.fn(),
  savePlayerModel: vi.fn(),
  setPlayerModelsLimit: vi.fn(),
  uploadModel: vi.fn(),
}))

vi.mock('@/04-features/cpm-convert/cpmProjectExporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/cpm-convert/cpmProjectExporter')>()),
  cpmProjectToBytes: exporter.cpmProjectToBytes,
  cpmProjectToLinkBase64: exporter.cpmProjectToLinkBase64,
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
})

const makeModel = (id: number): UserContentItem => ({ id, url: `https://cdn/${id}.cpm` })

describe('useCpmSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteModel).mockReset()
    vi.mocked(getPlayerModelsLimit).mockReset()
    vi.mocked(listModels).mockReset()
    vi.mocked(readCpmProjectFile).mockReset()
    vi.mocked(savePlayerModel).mockReset()
    vi.mocked(setPlayerModelsLimit).mockReset()
    vi.mocked(uploadModel).mockReset()
    vi.mocked(listModels).mockResolvedValue([])
    vi.mocked(getPlayerModelsLimit).mockResolvedValue(null)
    exporter.cpmProjectToBytes.mockReset()
    exporter.cpmProjectToLinkBase64.mockReset()
    parser.parseCpmProjectFile.mockReset()
    createObjectURLMock.mockClear()
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.projectConfig = {
      projectName: 'proj',
      mcVersion: '1.20.1',
      modLoader: 'vanilla',
      loaderVersion: null,
      javaPath: null,
      javaVersion: null,
      jvmArgs: [],
      minMemory: '512',
      maxMemory: '4096',
      online: true,
      initialized: true,
      serverUrl: null,
      autoJoinServer: false,
    }
    core.session = { uuid: 'u-1', username: 'alice' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupCpm = (): ReturnType<typeof useCpmSettings> => {
    const { result } = withSetup(() => useCpmSettings())
    return result
  }

  it('loads the model list and the limit on setup', async () => {
    vi.mocked(listModels).mockResolvedValue([makeModel(1)])
    vi.mocked(getPlayerModelsLimit).mockResolvedValue(5)
    const cpm = setupCpm()

    await vi.waitFor(() => expect(cpm.uploadedModels.value).toHaveLength(1))

    expect(cpm.modelsLimit.value).toBe(5)
    expect(cpm.limitLoadError.value).toBe('')
  })

  it('reports the limit load failure instead of showing unlimited', async () => {
    vi.mocked(getPlayerModelsLimit).mockRejectedValue(new Error('ipc down'))
    const cpm = setupCpm()

    await vi.waitFor(() => expect(cpm.limitLoadError.value).toBe('ipc down'))

    expect(cpm.isLimitLoading.value).toBe(false)
    expect(cpm.modelsLimit.value).toBeNull()
  })

  it('saves a valid models limit and clears the stale load error', async () => {
    vi.mocked(getPlayerModelsLimit).mockRejectedValue(new Error('ipc down'))
    vi.mocked(setPlayerModelsLimit).mockResolvedValue(undefined)
    const cpm = setupCpm()
    await vi.waitFor(() => expect(cpm.limitLoadError.value).toBe('ipc down'))

    await cpm.handleSaveModelsLimit(3)

    expect(setPlayerModelsLimit).toHaveBeenCalledWith(3)
    expect(cpm.modelsLimit.value).toBe(3)
    expect(cpm.limitLoadError.value).toBe('')

    await cpm.handleSaveModelsLimit(null)
    expect(setPlayerModelsLimit).toHaveBeenLastCalledWith(null)
    expect(cpm.modelsLimit.value).toBeNull()
  })

  it('rejects a non-positive limit without a command call', async () => {
    vi.mocked(setPlayerModelsLimit).mockResolvedValue(undefined)
    const cpm = setupCpm()
    await vi.waitFor(() => expect(cpm.isLimitLoading.value).toBe(false))

    await cpm.handleSaveModelsLimit(0)

    expect(cpm.limitSaveError.value).toBe('Лимит моделей — положительное число или пустое значение')
    expect(setPlayerModelsLimit).not.toHaveBeenCalled()
  })

  it('reports the limit save failure', async () => {
    vi.mocked(setPlayerModelsLimit).mockRejectedValue(new Error('denied'))
    const cpm = setupCpm()
    await vi.waitFor(() => expect(cpm.isLimitLoading.value).toBe(false))

    await cpm.handleSaveModelsLimit(2)

    expect(cpm.limitSaveError.value).toBe('denied')
    expect(cpm.modelsLimit.value).toBeNull()
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

  it('rejects an oversized pending project file with the dialog message', async () => {
    vi.mocked(readCpmProjectFile).mockResolvedValue(new Uint8Array(3 * 1024 * 1024))
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.errorMessage.value).not.toBe(''))

    expect(core.pendingCpmProjectPath).toBeNull()
    expect(cpm.errorMessage.value).toBe('Размер файла не должен превышать 2048 КБ (загружено 3072 КБ)')
    expect(parser.parseCpmProjectFile).not.toHaveBeenCalled()
    expect(cpm.cpmData.value).toBeNull()
  })

  it('collects the layers skipping empty and hidden parts', async () => {
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
    expect(cpm.activeLayerIds.value).toEqual([5])

    cpm.showEmptyLayers.value = true
    expect(cpm.displayLayers.value).toHaveLength(3)
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

    expect(exporter.cpmProjectToLinkBase64).toHaveBeenCalledWith(bytes)
    expect(uploadModel).toHaveBeenCalledWith('base64-link')
    expect(savePlayerModel).toHaveBeenCalledWith({
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

  it('skips the upload without an opened model', async () => {
    vi.mocked(uploadModel).mockResolvedValue(makeModel(1))
    const cpm = setupCpm()

    await cpm.handleUploadModel()

    expect(uploadModel).not.toHaveBeenCalled()
  })

  it('saves the model into the game as raw bytes', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    exporter.cpmProjectToBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    await cpm.handleSaveModelOffline()

    expect(exporter.cpmProjectToBytes).toHaveBeenCalledWith(bytes)
    expect(savePlayerModel).toHaveBeenCalledWith({
      name: 'hero',
      url: null,
      modelId: null,
      slim: false,
      data: [1, 2, 3],
    })
    expect(useNotificationStore().message).toBe('Модель сохранена в игру')
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

  it('resets the loaded model and reloads the limit when the project switches', async () => {
    const bytes = new Uint8Array(8)
    vi.mocked(readCpmProjectFile).mockResolvedValue(bytes)
    parser.parseCpmProjectFile.mockResolvedValue(makeProject())
    const core = useCoreStore()
    const cpm = setupCpm()

    core.pendingCpmProjectPath = '/models/hero.cpmproject'
    await vi.waitFor(() => expect(cpm.cpmData.value).not.toBeNull())

    vi.mocked(getPlayerModelsLimit).mockClear()
    vi.mocked(getPlayerModelsLimit).mockResolvedValue(7)
    core.currentProject = 'other'
    core.clearSessionState()
    await nextTick()

    expect(cpm.cpmData.value).toBeNull()
    expect(cpm.uploadedModels.value).toEqual([])
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:mock-texture')
    await vi.waitFor(() => expect(cpm.modelsLimit.value).toBe(7))
  })

  it('drops the limit save result when the project switches mid-save', async () => {
    let releaseSave: () => void = () => {}
    vi.mocked(setPlayerModelsLimit).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )
    const core = useCoreStore()
    const cpm = setupCpm()
    await vi.waitFor(() => expect(cpm.isLimitLoading.value).toBe(false))

    const pending = cpm.handleSaveModelsLimit(3)
    core.currentProject = 'other'
    await nextTick()
    releaseSave()
    await pending

    expect(cpm.modelsLimit.value).toBeNull()
    expect(cpm.isSavingLimit.value).toBe(false)
    expect(cpm.limitSaveError.value).toBe('')
  })
})
