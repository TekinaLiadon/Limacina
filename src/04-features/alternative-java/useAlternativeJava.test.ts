import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  downloadAlternativeJava,
  getJavaDistributions,
  getJavaVersion,
} from '@/06-shared/api'
import { useCoreStore, type JavaDistribution, type LauncherConfig } from '@/05-entities'
import { useAlternativeJava } from './useAlternativeJava'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  downloadAlternativeJava: vi.fn(),
  getJavaDistributions: vi.fn(),
  getJavaVersion: vi.fn(),
}))

const makeDistribution = (name: string): JavaDistribution => ({
  name,
  apiParameter: `${name}-api`,
})

const makeLauncherConfig = (overrides: Partial<LauncherConfig> = {}): LauncherConfig => ({
  launcherPath: '/games/limacina',
  installId: null,
  discordActivity: false,
  keepOldConfigs: true,
  downloadSpeedLimit: null,
  autoUpdate: false,
  systemNotifications: false,
  debugMode: false,
  startWithSystem: false,
  closeAfterLaunch: false,
  minimizeToTray: true,
  theme: 'default-dark',
  animationsEnabled: true,
  projectNames: ['proj'],
  currentProject: 'proj',
  projects: {},
  ...overrides,
})

describe('useAlternativeJava', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(downloadAlternativeJava).mockReset()
    vi.mocked(getJavaDistributions).mockReset()
    vi.mocked(getJavaVersion).mockReset()
    useCoreStore().launcherConfig = makeLauncherConfig()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads distributions, picks the first one and opens the popup', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin'), makeDistribution('zulu')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    const java = useAlternativeJava()

    await java.openPopup('1.20.1')

    expect(getJavaDistributions).toHaveBeenCalledTimes(1)
    expect(java.distributions.value).toHaveLength(2)
    expect(java.selectedDistribution.value).toBe('temurin')
    expect(java.javaVersion.value).toBe('17')
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDistributionsLoading.value).toBe(false)
  })

  it('keeps the manual selection and skips a repeated list load', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    const java = useAlternativeJava()

    await java.openPopup('1.20.1')
    java.selectedDistribution.value = 'zulu'
    await java.openPopup('1.20.4')

    expect(getJavaDistributions).toHaveBeenCalledTimes(1)
    expect(java.selectedDistribution.value).toBe('zulu')
  })

  it('surfaces the distributions error and still opens the popup', async () => {
    vi.mocked(getJavaDistributions).mockRejectedValue(new Error('mirror down'))
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    const java = useAlternativeJava()

    await java.openPopup('1.20.1')

    expect(java.distributionsError.value).toBe('mirror down')
    expect(java.isPopupOpen.value).toBe(true)
  })

  it('reports the java version lookup failure', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockRejectedValue(new Error('unknown version'))
    const java = useAlternativeJava()

    await java.openPopup('99.0')

    expect(java.versionError.value).toBe('unknown version')
    expect(java.javaVersion.value).toBe('')
  })

  it('returns false without a selection', async () => {
    const java = useAlternativeJava()

    const started = await java.startDownload()

    expect(started).toBe(false)
    expect(downloadAlternativeJava).not.toHaveBeenCalled()
  })

  it('downloads the selected distribution and closes the popup', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockResolvedValue(undefined)
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')
    java.replaceDefault.value = true

    const started = await java.startDownload()

    expect(started).toBe(true)
    expect(downloadAlternativeJava).toHaveBeenCalledWith('temurin-api', '17', true)
    expect(java.isPopupOpen.value).toBe(false)
    expect(java.isDownloading.value).toBe(false)
  })

  it('passes a null version when the lookup failed', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockRejectedValue(new Error('unknown version'))
    vi.mocked(downloadAlternativeJava).mockResolvedValue(undefined)
    const java = useAlternativeJava()
    await java.openPopup('99.0')

    await java.startDownload()

    expect(downloadAlternativeJava).toHaveBeenCalledWith('temurin-api', null, false)
  })

  it('shows the download error and keeps the popup open', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockRejectedValue(new Error('checksum mismatch'))
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const started = await java.startDownload()

    expect(started).toBe(false)
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDownloading.value).toBe(false)
  })

  it('keeps the popup open while downloading', async () => {
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDownload = resolve
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    java.closePopup()
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDownloading.value).toBe(true)

    releaseDownload()
    await pending
    expect(java.isPopupOpen.value).toBe(false)
  })

  it('closes the popup when idle', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    java.closePopup()

    expect(java.isPopupOpen.value).toBe(false)
  })
})
