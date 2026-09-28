import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { copyToClipboard } from '@/06-shared'
import { useCoreStore, useNotificationStore, type ProjectConfig, type UserContentItem } from '@/05-entities'
import { useUserContent } from './useUserContent'

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  copyToClipboard: vi.fn(),
}))

interface FakePayload {
  data: string
}

const makeItem = (id: number): UserContentItem => ({ id, url: `https://cdn/${id}.png` })

const makeApi = () => ({
  list: vi.fn<(uuid: string) => Promise<UserContentItem[]>>(),
  upload: vi.fn<(payload: FakePayload) => Promise<UserContentItem>>(),
  delete: vi.fn<(id: number) => Promise<void>>(),
  activate: vi.fn<(id: number) => Promise<void>>(),
  uploadSuccessMessage: 'Контент загружен',
  listLoadErrorMessage: 'Не удалось загрузить список',
})

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useUserContent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(copyToClipboard).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupContent = (): { content: ReturnType<typeof useUserContent<FakePayload>>; api: ReturnType<typeof makeApi> } => {
    const api = makeApi()
    return { content: useUserContent<FakePayload>(api), api }
  }

  const loginSession = (): void => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(true)
    core.session = { uuid: 'u-1', username: 'alice' }
  }

  it('skips the list load for an offline project', async () => {
    useCoreStore().projectConfig = makeProjectConfig(false)
    const { content, api } = setupContent()

    await content.loadItems()

    expect(api.list).not.toHaveBeenCalled()
  })

  it('skips the list load without a session', async () => {
    useCoreStore().projectConfig = makeProjectConfig(true)
    const { content, api } = setupContent()

    await content.loadItems()

    expect(api.list).not.toHaveBeenCalled()
  })

  it('loads the items for the session', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.list.mockResolvedValue([makeItem(1)])

    await content.loadItems()

    expect(api.list).toHaveBeenCalledWith('u-1')
    expect(content.items.value).toEqual([makeItem(1)])
    expect(content.isListLoading.value).toBe(false)
    expect(content.listError.value).toBe('')
  })

  it('composes the list error from the api failure', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.list.mockRejectedValue(new Error('denied'))

    await content.loadItems()

    expect(content.listError.value).toBe('Не удалось загрузить список: denied')
  })

  it('uploads, reloads the list and returns the item', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.upload.mockResolvedValue(makeItem(7))
    api.list.mockResolvedValue([makeItem(7)])

    const uploaded = await content.handleUpload({ data: 'base64' })

    expect(uploaded).toEqual(makeItem(7))
    expect(api.upload).toHaveBeenCalledWith({ data: 'base64' })
    expect(useNotificationStore().message).toBe('Контент загружен')
    expect(content.items.value).toHaveLength(1)
    expect(content.isUploading.value).toBe(false)
  })

  it('keeps the error message on the upload failure', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.upload.mockRejectedValue(new Error('bad png'))

    const uploaded = await content.handleUpload({ data: 'base64' })

    expect(uploaded).toBeNull()
    expect(content.errorMessage.value).toBe('bad png')
    expect(useNotificationStore().visible).toBe(false)
  })

  it('deletes an item and reloads the list', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.delete.mockResolvedValue(undefined)
    api.list.mockResolvedValue([])

    await content.handleDelete(3)

    expect(api.delete).toHaveBeenCalledWith(3)
    expect(content.items.value).toEqual([])
    expect(content.isMutating.value).toBe(false)
  })

  it('ignores a delete while another mutation is running', async () => {
    loginSession()
    const { content, api } = setupContent()
    let releaseDelete: () => void = () => {}
    api.delete.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDelete = resolve
        }),
    )

    const first = content.handleDelete(3)
    await content.handleDelete(4)
    expect(api.delete).toHaveBeenCalledTimes(1)

    releaseDelete()
    await first
  })

  it('reports the delete failure', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.delete.mockRejectedValue(new Error('locked'))

    await content.handleDelete(3)

    expect(content.errorMessage.value).toBe('locked')
    expect(content.isMutating.value).toBe(false)
  })

  it('activates the item when the api supports it', async () => {
    loginSession()
    const { content, api } = setupContent()
    api.activate.mockResolvedValue(undefined)
    api.list.mockResolvedValue([])

    await content.handleActivate(2)

    expect(api.activate).toHaveBeenCalledWith(2)
    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('does nothing on activate without the api support', async () => {
    loginSession()
    const api = makeApi()
    const { activate: _unused, ...rest } = api
    const content = useUserContent<FakePayload>(rest)

    await content.handleActivate(2)

    expect(api.list).not.toHaveBeenCalled()
  })

  it('copies the url and shows the toast', async () => {
    loginSession()
    const { content } = setupContent()
    vi.mocked(copyToClipboard).mockResolvedValue(undefined)

    await content.handleCopyUrl('https://cdn/1.png')

    expect(copyToClipboard).toHaveBeenCalledWith('https://cdn/1.png')
    expect(useNotificationStore().message).toBe('Ссылка скопирована')
  })

  it('reports the copy failure', async () => {
    loginSession()
    const { content } = setupContent()
    vi.mocked(copyToClipboard).mockRejectedValue(new Error('denied'))

    await content.handleCopyUrl('https://cdn/1.png')

    expect(content.errorMessage.value).toBe('Не удалось скопировать')
  })
})
