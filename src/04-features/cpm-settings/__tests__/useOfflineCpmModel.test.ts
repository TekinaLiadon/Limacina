import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, type Ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { savePlayerModel } from '@/06-shared/api'
import { useNotificationStore, type CPMData } from '@/05-entities'
import { useOfflineCpmModel } from '../useOfflineCpmModel'
import { withSetup } from '@/test-support/withSetup'

const exporter = vi.hoisted(() => ({
  cpmProjectToBytes: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  savePlayerModel: vi.fn(),
}))

vi.mock('@/04-features/cpm-convert/cpmProjectExporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/04-features/cpm-convert/cpmProjectExporter')>()),
  cpmProjectToBytes: exporter.cpmProjectToBytes,
}))

const makeCpmData = (skinType: 'default' | 'slim'): CPMData => ({
  config: {
    skinSize: { x: 64, y: 64 },
    skinType,
    elements: [],
  },
  textureUrl: 'blob:mock-texture',
  animations: [],
})

describe('useOfflineCpmModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(savePlayerModel).mockReset()
    exporter.cpmProjectToBytes.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupOffline = (
    bytes: Uint8Array | null,
    cpmData: CPMData | null,
  ): { offline: ReturnType<typeof useOfflineCpmModel>; errorMessage: Ref<string> } => {
    const { result } = withSetup(() => {
      const errorMessage = ref('')
      const offline = useOfflineCpmModel({
        cpmFileBytes: ref(bytes),
        cpmData: shallowRef(cpmData),
        modelName: computed((): string => 'hero'),
        errorMessage,
      })
      return { offline, errorMessage }
    })
    return result
  }

  it('saves the model into the game as raw bytes', async () => {
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    exporter.cpmProjectToBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { offline } = setupOffline(new Uint8Array(8), makeCpmData('default'))

    await offline.handleSaveModelOffline()

    expect(exporter.cpmProjectToBytes).toHaveBeenCalledWith(new Uint8Array(8))
    expect(savePlayerModel).toHaveBeenCalledWith({
      name: 'hero',
      url: null,
      modelId: null,
      slim: false,
      data: [1, 2, 3],
    })
    expect(useNotificationStore().message).toBe('Модель сохранена в игру')
    expect(offline.isSaving.value).toBe(false)
  })

  it('passes the slim flag from the opened model', async () => {
    vi.mocked(savePlayerModel).mockResolvedValue(undefined)
    exporter.cpmProjectToBytes.mockResolvedValue(new Uint8Array([1]))
    const { offline } = setupOffline(new Uint8Array(4), makeCpmData('slim'))

    await offline.handleSaveModelOffline()

    expect(savePlayerModel).toHaveBeenCalledWith(expect.objectContaining({ slim: true }))
  })

  it('surfaces the offline save failure', async () => {
    exporter.cpmProjectToBytes.mockRejectedValue(new Error('bad archive'))
    const { offline, errorMessage } = setupOffline(new Uint8Array(8), makeCpmData('default'))

    await offline.handleSaveModelOffline()

    expect(errorMessage.value).toBe('bad archive')
    expect(useNotificationStore().message).not.toBe('Модель сохранена в игру')
    expect(offline.isSaving.value).toBe(false)
  })

  it('skips the save without an opened model', async () => {
    const { offline } = setupOffline(null, null)

    await offline.handleSaveModelOffline()

    expect(savePlayerModel).not.toHaveBeenCalled()
    expect(exporter.cpmProjectToBytes).not.toHaveBeenCalled()
  })
})
