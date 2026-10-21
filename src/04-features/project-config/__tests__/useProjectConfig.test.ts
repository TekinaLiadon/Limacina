import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { loadSettingsProject } from '@/06-shared/api'
import { useCoreStore, type ProjectConfig } from '@/05-entities'
import { useProjectConfig } from '../useProjectConfig'
import { withSetup } from '@/test-support/withSetup'
import { makeProjectConfig } from '@/test-support/fixtures'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  loadSettingsProject: vi.fn(),
}))

describe('useProjectConfig', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadSettingsProject).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the config on mount for the current project', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    vi.mocked(loadSettingsProject).mockResolvedValue(makeProjectConfig({ projectName: 'proj' }))

    const { unmount } = withSetup(() => useProjectConfig())
    await vi.waitFor(() => expect(core.projectConfig).not.toBeNull())

    expect(loadSettingsProject).toHaveBeenCalledWith('proj')
    expect(core.projectConfig?.projectName).toBe('proj')
    unmount()
  })

  it('skips the load when the config is already current', () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.projectConfig = makeProjectConfig({ projectName: 'proj' })

    const { unmount } = withSetup(() => useProjectConfig())

    expect(loadSettingsProject).not.toHaveBeenCalled()
    unmount()
  })

  it('skips the load without a project', () => {
    const { unmount } = withSetup(() => useProjectConfig())

    expect(loadSettingsProject).not.toHaveBeenCalled()
    unmount()
  })

  it('drops a stale response after the project has switched', async () => {
    const core = useCoreStore()
    core.currentProject = 'alpha'
    let releaseConfig: (config: ProjectConfig) => void = () => {}
    vi.mocked(loadSettingsProject).mockImplementationOnce(
      () =>
        new Promise<ProjectConfig>((resolve) => {
          releaseConfig = resolve
        }),
    )

    const { unmount } = withSetup(() => useProjectConfig())
    core.currentProject = 'beta'
    releaseConfig(makeProjectConfig({ projectName: 'alpha' }))
    await Promise.resolve()

    expect(core.projectConfig).toBeNull()
    unmount()
  })

  it('reports a load failure without throwing', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    vi.mocked(loadSettingsProject).mockRejectedValue(new Error('ipc down'))

    const { unmount } = withSetup(() => useProjectConfig())
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled())

    expect(core.projectConfig).toBeNull()
    unmount()
  })
})
