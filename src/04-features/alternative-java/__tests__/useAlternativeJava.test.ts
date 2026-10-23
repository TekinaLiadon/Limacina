import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  downloadAlternativeJava,
  getJavaDistributions,
  getJavaVersion,
} from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { useCoreStore, useNotificationStore, type JavaDistribution, type LauncherConfig } from '@/05-entities'
import { useAlternativeJava } from '../useAlternativeJava'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  downloadAlternativeJava: vi.fn(),
  getJavaDistributions: vi.fn(),
  getJavaVersion: vi.fn(),
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError: vi.fn(),
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
    vi.mocked(reportError).mockClear()
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

  it('opens the popup immediately and keeps the loading state until distributions arrive', async () => {
    let releaseDistributions: (distributions: JavaDistribution[]) => void = () => {}
    vi.mocked(getJavaDistributions).mockImplementationOnce(
      () =>
        new Promise<JavaDistribution[]>((resolve) => {
          releaseDistributions = resolve
        }),
    )
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    const java = useAlternativeJava()

    const opening = java.openPopup('1.20.1')

    expect(getJavaVersion).toHaveBeenCalledWith('1.20.1')
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDistributionsLoading.value).toBe(true)
    expect(java.distributions.value).toHaveLength(0)

    releaseDistributions([makeDistribution('temurin')])
    await opening

    expect(java.distributions.value).toHaveLength(1)
    expect(java.selectedDistribution.value).toBe('temurin')
    expect(java.javaVersion.value).toBe('17')
    expect(java.isDistributionsLoading.value).toBe(false)
  })

  it('drops the stale java version when the popup reopens for another version', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    let releaseOld: (version: string) => void = () => {}
    vi.mocked(getJavaVersion)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseOld = resolve
          }),
      )
      .mockResolvedValueOnce('21')
    vi.mocked(downloadAlternativeJava).mockResolvedValue(undefined)
    const java = useAlternativeJava()

    const first = java.openPopup('1.20.1')
    await java.openPopup('1.21')
    expect(java.javaVersion.value).toBe('21')

    releaseOld('17')
    await first
    expect(java.javaVersion.value).toBe('21')

    await java.startDownload()

    expect(downloadAlternativeJava).toHaveBeenCalledWith('temurin-api', '21', false)
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

  it('reports a missing distribution instead of failing silently', async () => {
    const java = useAlternativeJava()

    const result = await java.startDownload()

    expect(result).toBe('unavailable')
    expect(downloadAlternativeJava).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe('Выберите дистрибутив Java')
  })

  it('downloads the selected distribution and closes the popup', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockResolvedValue(undefined)
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')
    java.replaceDefault.value = true

    const result = await java.startDownload()

    expect(result).toBe('replaced')
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

    const result = await java.startDownload()

    expect(result).toBe('downloaded')
    expect(downloadAlternativeJava).toHaveBeenCalledWith('temurin-api', null, false)
  })

  it('shows and reports the download error and keeps the popup open', async () => {
    const failure = new Error('checksum mismatch')
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockRejectedValue(failure)
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const result = await java.startDownload()

    expect(result).toBe('failed')
    expect(reportError).toHaveBeenCalledWith('Не удалось скачать Java', failure)
    expect(useNotificationStore().message).toBe('Ошибка загрузки Java: checksum mismatch')
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

  it('drops the stale distributions response when the list is loaded twice', async () => {
    let releaseFirst: (distributions: JavaDistribution[]) => void = () => {}
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(getJavaDistributions)
      .mockImplementationOnce(
        () =>
          new Promise<JavaDistribution[]>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce([makeDistribution('zulu')])
    const java = useAlternativeJava()

    const first = java.openPopup('1.20.1')
    await java.openPopup('1.20.1')

    releaseFirst([makeDistribution('stale')])
    await first

    expect(java.distributions.value.map((d) => d.name)).toEqual(['zulu'])
    expect(java.selectedDistribution.value).toBe('zulu')
  })

  it('drops the stale distributions error when a newer load already succeeded', async () => {
    let releaseFirst: (error: Error) => void = () => {}
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(getJavaDistributions)
      .mockImplementationOnce(
        () =>
          new Promise<JavaDistribution[]>((_resolve, reject) => {
            releaseFirst = reject
          }),
      )
      .mockResolvedValueOnce([makeDistribution('zulu')])
    const java = useAlternativeJava()

    const first = java.openPopup('1.20.1')
    await java.openPopup('1.20.1')

    releaseFirst(new Error('mirror down'))
    await first

    expect(java.distributions.value.map((d) => d.name)).toEqual(['zulu'])
    expect(java.distributionsError.value).toBe('')
  })

  it('ignores a repeated download call while one is already running', async () => {
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDownload = resolve
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    const repeated = await java.startDownload()

    expect(repeated).toBe('busy')
    expect(downloadAlternativeJava).toHaveBeenCalledTimes(1)

    releaseDownload()
    await pending
    expect(java.isDownloading.value).toBe(false)
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
