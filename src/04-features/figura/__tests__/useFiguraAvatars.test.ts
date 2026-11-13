import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { listFiguraAvatars, readFiguraAvatar } from '@/06-shared/api'
import { useCoreStore, useFiguraStore, type FiguraAvatarEntry } from '@/05-entities'
import { useFiguraAvatars } from '../useFiguraAvatars'
import { withSetup } from '@/test-support/withSetup'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  listFiguraAvatars: vi.fn(),
  readFiguraAvatar: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError: vi.fn(),
}))

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]
const PNG_DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`

const makeEntry = (name: string, overrides: Partial<FiguraAvatarEntry> = {}): FiguraAvatarEntry => ({
  name,
  authors: ['tekina'],
  description: `${name} avatar`,
  hasModel: true,
  hasTexture: true,
  ...overrides,
})

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

const makeAvatarData = (withTexture = true): Awaited<ReturnType<typeof readFiguraAvatar>> => ({
  name: 'alpha',
  authors: ['tekina'],
  description: 'alpha avatar',
  color: '#7a4b8f',
  model: encodeModel(withTexture),
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const setupFigura = (): ReturnType<typeof useFiguraAvatars> => {
  const { result } = withSetup(() => useFiguraAvatars())
  return result
}

const setProject = (name: string): void => {
  useCoreStore().currentProject = name
}

describe('useFiguraAvatars', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(listFiguraAvatars).mockReset()
    vi.mocked(readFiguraAvatar).mockReset()
    setProject('Cordelia')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the avatar list of the current project', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha'), makeEntry('beta')])
    const figura = setupFigura()

    await figura.loadList()

    expect(listFiguraAvatars).toHaveBeenCalledWith('Cordelia')
    expect(figura.avatars.value?.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
    expect(figura.listError.value).toBe('')
    expect(figura.isListLoading.value).toBe(false)
  })

  it('keeps an empty avatar directory as an empty list without an error', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([])
    const figura = setupFigura()

    await figura.loadList()

    expect(figura.avatars.value).toEqual([])
    expect(figura.listError.value).toBe('')
  })

  it('reports a failed list load and keeps the tab usable', async () => {
    vi.mocked(listFiguraAvatars).mockRejectedValue(new Error('Ошибка файловой системы'))
    const figura = setupFigura()

    await figura.loadList()

    expect(figura.avatars.value).toBeNull()
    expect(figura.listError.value).toContain('Ошибка файловой системы')
    expect(figura.isListLoading.value).toBe(false)
  })

  it('skips the call when no project is selected', async () => {
    setProject('')
    const figura = setupFigura()

    await figura.loadList()

    expect(listFiguraAvatars).not.toHaveBeenCalled()
    expect(figura.avatars.value).toBeNull()
  })

  it('selects an avatar and builds the viewer source from its model', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha')])
    vi.mocked(readFiguraAvatar).mockResolvedValue(makeAvatarData())
    const figura = setupFigura()
    await figura.loadList()

    await figura.selectAvatar('alpha')

    expect(readFiguraAvatar).toHaveBeenCalledWith('Cordelia', 'alpha')
    expect(figura.selectedName.value).toBe('alpha')
    expect(figura.selected.value?.authors).toEqual(['tekina'])
    expect(figura.viewerSource.value?.model.nodes).toHaveLength(1)
    expect(figura.viewerSource.value?.texturePng).not.toBeNull()
    expect(figura.modelError.value).toBe('')
    expect(figura.textureError.value).toBe('')
  })

  it('shows the geometry without a texture when the model has none', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha', { hasTexture: false })])
    vi.mocked(readFiguraAvatar).mockResolvedValue(makeAvatarData(false))
    const figura = setupFigura()
    await figura.loadList()

    await figura.selectAvatar('alpha')

    expect(figura.viewerSource.value?.model.nodes).toHaveLength(1)
    expect(figura.viewerSource.value?.texturePng).toBeNull()
    expect(figura.textureError.value).not.toBe('')
    expect(figura.modelError.value).toBe('')
  })

  it('fails with a readable message when the avatar has no model file', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha', { hasModel: false })])
    const figura = setupFigura()
    await figura.loadList()

    await figura.selectAvatar('alpha')

    expect(readFiguraAvatar).not.toHaveBeenCalled()
    expect(figura.modelError.value).not.toBe('')
    expect(figura.viewerSource.value).toBeNull()
  })

  it('reports a failed model read and clears the previous scene', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha'), makeEntry('beta')])
    vi.mocked(readFiguraAvatar)
      .mockResolvedValueOnce(makeAvatarData())
      .mockRejectedValueOnce(new Error('Файл слишком большой'))
    const figura = setupFigura()
    await figura.loadList()
    await figura.selectAvatar('alpha')

    await figura.selectAvatar('beta')

    expect(figura.modelError.value).toContain('Файл слишком большой')
    expect(figura.viewerSource.value).toBeNull()
    expect(figura.selectedName.value).toBe('beta')
  })

  it('reports a corrupt model instead of throwing', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha')])
    vi.mocked(readFiguraAvatar).mockResolvedValue({
      ...makeAvatarData(),
      model: new TextEncoder().encode('не json'),
    })
    const figura = setupFigura()
    await figura.loadList()

    await figura.selectAvatar('alpha')

    expect(figura.modelError.value).not.toBe('')
    expect(figura.viewerSource.value).toBeNull()
  })

  it('drops a stale list response when a newer load already started', async () => {
    const first = deferred<FiguraAvatarEntry[]>()
    const second = deferred<FiguraAvatarEntry[]>()
    vi.mocked(listFiguraAvatars)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const figura = setupFigura()

    const firstLoad = figura.loadList()
    const secondLoad = figura.loadList()
    second.resolve([makeEntry('beta')])
    await secondLoad
    first.resolve([makeEntry('alpha')])
    await firstLoad

    expect(figura.avatars.value?.map((entry) => entry.name)).toEqual(['beta'])
  })

  it('keeps the newer model when the older read resolves last', async () => {
    const first = deferred<Awaited<ReturnType<typeof readFiguraAvatar>>>()
    const second = deferred<Awaited<ReturnType<typeof readFiguraAvatar>>>()
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha'), makeEntry('beta')])
    vi.mocked(readFiguraAvatar)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const figura = setupFigura()
    await figura.loadList()

    const firstSelect = figura.selectAvatar('alpha')
    const secondSelect = figura.selectAvatar('beta')
    second.resolve(makeAvatarData())
    await secondSelect
    first.resolve(makeAvatarData())
    await firstSelect

    expect(figura.selectedName.value).toBe('beta')
    expect(figura.viewerSource.value).not.toBeNull()
  })

  it('clears the selection and the scene when the refreshed list lost the avatar', async () => {
    vi.mocked(listFiguraAvatars)
      .mockResolvedValueOnce([makeEntry('alpha')])
      .mockResolvedValueOnce([makeEntry('beta')])
    vi.mocked(readFiguraAvatar).mockResolvedValue(makeAvatarData())
    const figura = setupFigura()
    await figura.loadList()
    await figura.selectAvatar('alpha')

    await figura.loadList()

    expect(figura.selectedName.value).toBeNull()
    expect(figura.viewerSource.value).toBeNull()
  })

  it('resets the selection and scene when the project changes', async () => {
    vi.mocked(listFiguraAvatars).mockResolvedValue([makeEntry('alpha')])
    vi.mocked(readFiguraAvatar).mockResolvedValue(makeAvatarData())
    const figura = setupFigura()
    await figura.loadList()
    await figura.selectAvatar('alpha')

    useCoreStore().currentProject = 'Avelmor'
    await nextTick()

    expect(figura.avatars.value).toBeNull()
    expect(figura.selectedName.value).toBeNull()
    expect(figura.viewerSource.value).toBeNull()
    expect(useFiguraStore().list).toBeNull()
  })
})
