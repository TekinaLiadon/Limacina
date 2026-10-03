import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  modrinthCheckUpdates,
  modrinthInstall,
  modrinthInstalled,
  modrinthProject,
  modrinthSearch,
  modrinthUninstall,
} from '@/06-shared/api'
import {
  useCoreStore,
  type ModrinthInstallResult,
  type ModrinthInstalledMod,
  type ModrinthSearchHit,
  type ModrinthSearchResult,
} from '@/05-entities'
import { fetchModrinthProjectDetails, PAGE_SIZE, useModrinth } from './useModrinth'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  modrinthSearch: vi.fn(),
  modrinthProject: vi.fn(),
  modrinthInstalled: vi.fn(),
  modrinthCheckUpdates: vi.fn(),
  modrinthInstall: vi.fn(),
  modrinthUninstall: vi.fn(),
}))

const makeHit = (id: string): ModrinthSearchHit => ({
  project_id: id,
  project_type: 'mod',
  slug: id,
  author: null,
  title: id,
  description: '',
  categories: [],
  downloads: 0,
  follows: 0,
  icon_url: null,
  date_created: null,
  date_modified: null,
  latest_version: null,
  license: null,
  client_side: null,
  server_side: null,
})

const makeResult = (overrides: Partial<ModrinthSearchResult> = {}): ModrinthSearchResult => ({
  hits: [],
  total: 0,
  offset: 0,
  limit: PAGE_SIZE,
  version_numbers: {},
  ...overrides,
})

const makeInstalled = (id: string): ModrinthInstalledMod => ({
  project_id: id,
  slug: id,
  title: id,
  icon_url: null,
  filename: `${id}.jar`,
  version_number: '1.0.0',
  sha1: 'deadbeef',
})

describe('useModrinth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(modrinthSearch).mockReset()
    vi.mocked(modrinthProject).mockReset()
    vi.mocked(modrinthInstalled).mockReset()
    vi.mocked(modrinthCheckUpdates).mockReset()
    vi.mocked(modrinthInstall).mockReset()
    vi.mocked(modrinthUninstall).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the search result and derives pagination', async () => {
    vi.mocked(modrinthSearch).mockResolvedValue(
      makeResult({ hits: [makeHit('a')], total: PAGE_SIZE + 5, version_numbers: { a: '2.0' } }),
    )
    const mods = useModrinth()

    await mods.search()

    expect(modrinthSearch).toHaveBeenCalledWith({
      query: '',
      index: 'relevance',
      categories: [],
      offset: 0,
    })
    expect(mods.hits.value).toHaveLength(1)
    expect(mods.total.value).toBe(PAGE_SIZE + 5)
    expect(mods.totalPages.value).toBe(2)
    expect(mods.currentPage.value).toBe(1)
    expect(mods.versionNumbers.value).toEqual({ a: '2.0' })
    expect(mods.isSearching.value).toBe(false)
  })

  it('drops a stale search response after a newer query', async () => {
    let releaseFirst: (result: ModrinthSearchResult) => void = () => {}
    vi.mocked(modrinthSearch)
      .mockImplementationOnce(
        () =>
          new Promise<ModrinthSearchResult>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(makeResult({ hits: [makeHit('fresh')], total: 1 }))
    const mods = useModrinth()

    const first = mods.search()
    const second = mods.search()
    await second
    releaseFirst(makeResult({ hits: [makeHit('stale')], total: 99 }))
    await first

    expect(mods.hits.value.map((hit) => hit.project_id)).toEqual(['fresh'])
    expect(mods.total.value).toBe(1)
    expect(mods.isSearching.value).toBe(false)
  })

  it('surfaces the search error', async () => {
    vi.mocked(modrinthSearch).mockRejectedValue(new Error('rate limited'))
    const mods = useModrinth()

    await mods.search()

    expect(mods.searchError.value).toBe('rate limited')
    expect(mods.isSearching.value).toBe(false)
  })

  it('clamps the requested page into the available range', async () => {
    vi.mocked(modrinthSearch).mockResolvedValue(makeResult({ total: PAGE_SIZE * 3 }))
    const mods = useModrinth()

    await mods.loadPage(0)
    expect(modrinthSearch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))

    await mods.loadPage(2)
    expect(modrinthSearch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: PAGE_SIZE }))
    expect(mods.currentPage.value).toBe(2)

    await mods.loadPage(99)
    expect(modrinthSearch).toHaveBeenLastCalledWith(expect.objectContaining({ offset: PAGE_SIZE * 2 }))
    expect(mods.currentPage.value).toBe(3)
  })

  it('replaces the catalog versions with each search instead of accumulating them', async () => {
    vi.mocked(modrinthSearch)
      .mockResolvedValueOnce(makeResult({ hits: [makeHit('a')], version_numbers: { a: '2.0' } }))
      .mockResolvedValueOnce(makeResult({ hits: [makeHit('b')], version_numbers: { b: '1.0' } }))
    const mods = useModrinth()

    await mods.search()
    await mods.search()

    expect(mods.versionNumbers.value).toEqual({ b: '1.0' })
  })

  it('loads the installed list and reports load failures', async () => {
    vi.mocked(modrinthInstalled).mockResolvedValue([makeInstalled('sodium')])
    const mods = useModrinth()

    await mods.loadInstalled()
    expect(mods.installed.value).toHaveLength(1)
    expect(mods.installedIds.value.has('sodium')).toBe(true)

    vi.mocked(modrinthInstalled).mockRejectedValue(new Error('denied'))
    await mods.loadInstalled()
    expect(mods.installedError.value).toBe('denied')
  })

  it('collects available updates and skips checked mods without one', async () => {
    vi.mocked(modrinthCheckUpdates).mockResolvedValue([
      { project_id: 'a', current_version: '1.0', available_version: '2.0' },
      { project_id: 'b', current_version: '1.0', available_version: null },
    ])
    const mods = useModrinth()

    await mods.checkForUpdates()

    expect(mods.updates.value).toEqual({ a: '2.0' })
    expect(mods.isCheckingUpdates.value).toBe(false)
  })

  it('reports the update-check failure', async () => {
    vi.mocked(modrinthCheckUpdates).mockRejectedValue(new Error('offline'))
    const mods = useModrinth()

    await mods.checkForUpdates()

    expect(mods.actionError.value).toBe('offline')
  })

  it('installs a mod and reloads the installed list clearing its update badge', async () => {
    vi.mocked(modrinthInstall).mockResolvedValue({ installed: ['a'], skipped: [] })
    vi.mocked(modrinthInstalled).mockResolvedValue([makeInstalled('a')])
    const mods = useModrinth()
    mods.updates.value = { a: '2.0', b: '3.0' }

    const installed = await mods.install('a')

    expect(installed).toBe(true)
    expect(modrinthInstall).toHaveBeenCalledWith('a')
    expect(mods.installed.value).toHaveLength(1)
    expect(mods.updates.value).toEqual({ b: '3.0' })
    expect(mods.installingId.value).toBeNull()
  })

  it('keeps the action error when the install fails', async () => {
    vi.mocked(modrinthInstall).mockRejectedValue(new Error('no space'))
    const mods = useModrinth()

    const installed = await mods.install('a')

    expect(installed).toBe(false)
    expect(mods.actionError.value).toBe('no space')
    expect(mods.installingId.value).toBeNull()
  })

  it('uninstalls a mod and clears its pending update', async () => {
    vi.mocked(modrinthUninstall).mockResolvedValue(undefined)
    vi.mocked(modrinthInstalled).mockResolvedValue([])
    const mods = useModrinth()
    mods.updates.value = { a: '2.0', b: '3.0' }

    const uninstalled = await mods.uninstall('a')

    expect(uninstalled).toBe(true)
    expect(modrinthUninstall).toHaveBeenCalledWith('a')
    expect(mods.updates.value).toEqual({ b: '3.0' })
    expect(mods.installed.value).toHaveLength(0)
  })

  it('reports the uninstall failure', async () => {
    vi.mocked(modrinthUninstall).mockRejectedValue(new Error('locked'))
    const mods = useModrinth()
    mods.updates.value = { a: '2.0' }

    const uninstalled = await mods.uninstall('a')

    expect(uninstalled).toBe(false)
    expect(mods.actionError.value).toBe('locked')
    expect(mods.updates.value).toEqual({ a: '2.0' })
  })

  it('rejects a parallel install while another install is running', async () => {
    let releaseInstall: (result: ModrinthInstallResult) => void = () => {}
    vi.mocked(modrinthInstall).mockImplementation(
      () =>
        new Promise<ModrinthInstallResult>((resolve) => {
          releaseInstall = resolve
        }),
    )
    vi.mocked(modrinthInstalled).mockResolvedValue([makeInstalled('a')])
    const mods = useModrinth()

    const first = mods.install('a')
    const second = await mods.install('b')

    expect(second).toBe(false)
    expect(modrinthInstall).toHaveBeenCalledTimes(1)
    expect(mods.installingId.value).toBe('a')

    releaseInstall({ installed: ['a'], skipped: [] })
    await first
    expect(mods.installingId.value).toBeNull()
  })

  it('rejects an uninstall while an install is running and keeps the flag', async () => {
    let releaseInstall: (result: ModrinthInstallResult) => void = () => {}
    vi.mocked(modrinthInstall).mockImplementation(
      () =>
        new Promise<ModrinthInstallResult>((resolve) => {
          releaseInstall = resolve
        }),
    )
    const mods = useModrinth()

    const first = mods.install('a')
    const uninstalled = await mods.uninstall('b')

    expect(uninstalled).toBe(false)
    expect(modrinthUninstall).not.toHaveBeenCalled()
    expect(mods.installingId.value).toBe('a')

    releaseInstall({ installed: ['a'], skipped: [] })
    await first
    expect(mods.installingId.value).toBeNull()
  })

  it('rejects further actions while an uninstall is running', async () => {
    let releaseUninstall: () => void = () => {}
    vi.mocked(modrinthUninstall).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseUninstall = resolve
        }),
    )
    const mods = useModrinth()
    mods.updates.value = { a: '2.0' }

    const first = mods.uninstall('a')
    expect(await mods.install('b')).toBe(false)
    expect(await mods.uninstall('c')).toBe(false)
    expect(modrinthInstall).not.toHaveBeenCalled()
    expect(modrinthUninstall).toHaveBeenCalledTimes(1)
    expect(mods.installingId.value).toBe('a')

    releaseUninstall()
    await first
    expect(mods.installingId.value).toBeNull()
  })

  it('fetches the project details for the popup without a composable instance', async () => {
    const details = { project: { id: 'a' }, versions: [] } as never
    vi.mocked(modrinthProject).mockResolvedValue(details)

    await fetchModrinthProjectDetails('a')

    expect(modrinthProject).toHaveBeenCalledWith('a')
  })

  it('reloads the tab state when the project switches', async () => {
    vi.mocked(modrinthInstalled).mockResolvedValue([makeInstalled('fresh')])
    vi.mocked(modrinthSearch).mockResolvedValue(
      makeResult({ hits: [makeHit('fresh')], version_numbers: { fresh: '2.0' } }),
    )
    const core = useCoreStore()
    core.currentProject = 'old'
    const mods = useModrinth()

    await mods.search()
    mods.query.value = 'sodium'
    mods.categories.value = ['utility']
    mods.updates.value = { stale: '9.9' }
    vi.mocked(modrinthInstalled).mockClear()
    vi.mocked(modrinthSearch).mockClear()

    core.currentProject = 'new'
    await nextTick()
    await vi.waitFor(() => expect(modrinthInstalled).toHaveBeenCalledTimes(1))

    expect(modrinthSearch).toHaveBeenCalledWith({
      query: '',
      index: 'relevance',
      categories: [],
      offset: 0,
    })
    expect(mods.query.value).toBe('')
    expect(mods.categories.value).toEqual([])
    expect(mods.updates.value).toEqual({})
    expect(mods.versionNumbers.value).toEqual({ fresh: '2.0' })
    expect(mods.installed.value.map((mod) => mod.project_id)).toEqual(['fresh'])
  })

  it('keeps the tab state when the project name is emptied', async () => {
    vi.mocked(modrinthSearch).mockResolvedValue(makeResult({ hits: [makeHit('a')] }))
    const core = useCoreStore()
    core.currentProject = 'old'
    const mods = useModrinth()

    await mods.search()
    vi.mocked(modrinthInstalled).mockClear()
    vi.mocked(modrinthSearch).mockClear()

    core.currentProject = ''
    await nextTick()

    expect(modrinthInstalled).not.toHaveBeenCalled()
    expect(modrinthSearch).not.toHaveBeenCalled()
    expect(mods.query.value).toBe('')
    expect(mods.hits.value).toHaveLength(1)
  })
})
