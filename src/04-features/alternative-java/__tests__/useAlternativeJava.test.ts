import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  cancelAlternativeJava,
  downloadAlternativeJava,
  getJavaDistributions,
  getJavaVersion,
  listenJavaDownloadSteps,
} from '@/06-shared/api'
import { reportError, STEP_IDS } from '@/06-shared'
import { useCoreStore, useNotificationStore, type JavaDistribution, type LauncherConfig, type StepEvent } from '@/05-entities'
import { useAlternativeJava } from '../useAlternativeJava'

const sendSystemNotification = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  cancelAlternativeJava: vi.fn(),
  downloadAlternativeJava: vi.fn(),
  getJavaDistributions: vi.fn(),
  getJavaVersion: vi.fn(),
  listenJavaDownloadSteps: vi.fn(),
}))

vi.mock('@/04-features/system-notifications/useSystemNotifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/04-features/system-notifications/useSystemNotifications')
  >()),
  useSystemNotifications: () => ({ sendSystemNotification }),
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
  let emitJavaStep: ((event: StepEvent) => void) | undefined
  let unlistenJavaSteps: Mock

  const flushSubscription = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    emitJavaStep = undefined
    unlistenJavaSteps = vi.fn()
    sendSystemNotification.mockClear()
    vi.mocked(cancelAlternativeJava).mockReset()
    vi.mocked(cancelAlternativeJava).mockResolvedValue(true)
    vi.mocked(downloadAlternativeJava).mockReset()
    vi.mocked(getJavaDistributions).mockReset()
    vi.mocked(getJavaVersion).mockReset()
    vi.mocked(listenJavaDownloadSteps).mockReset()
    vi.mocked(listenJavaDownloadSteps).mockImplementation(async (handler: (event: StepEvent) => void) => {
      emitJavaStep = handler
      return unlistenJavaSteps
    })
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

  it('reflects java download progress and closes the popup on success', async () => {
    const megabyte = 1024 * 1024
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
    await flushSubscription()

    expect(emitJavaStep).toBeDefined()
    emitJavaStep?.({ type: 'progress', id: STEP_IDS.javaAltDownload, current: 5 * megabyte, total: 10 * megabyte })
    expect(java.downloaded.value).toBe(5 * megabyte)
    expect(java.total.value).toBe(10 * megabyte)

    emitJavaStep?.({ type: 'progress', id: STEP_IDS.javaCheck, current: 999 * megabyte, total: 10 * megabyte })
    expect(java.downloaded.value).toBe(5 * megabyte)

    emitJavaStep?.({ type: 'started', id: STEP_IDS.javaAltExtract, label: 'Распаковка Java' })
    expect(java.phase.value).toBe('extract')

    releaseDownload()
    const result = await pending

    expect(result).toBe('downloaded')
    expect(sendSystemNotification).toHaveBeenCalledWith(
      'Java установлена',
      'Дистрибутив temurin готов к использованию',
    )
    expect(java.isPopupOpen.value).toBe(false)
    expect(java.isDownloading.value).toBe(false)
    expect(java.downloaded.value).toBe(0)
    expect(java.total.value).toBe(0)
    expect(java.phase.value).toBe('download')
    expect(unlistenJavaSteps).toHaveBeenCalledTimes(1)
  })

  it('cancels the download, closes the popup without an error toast and restarts cleanly', async () => {
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          releaseDownload = (): void => reject({ code: 'cancelled', message: 'Загрузка отменена' })
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    await flushSubscription()
    emitJavaStep?.({ type: 'progress', id: STEP_IDS.javaAltDownload, current: 1024, total: 4096 })

    await java.cancelDownload()
    expect(cancelAlternativeJava).toHaveBeenCalledTimes(1)
    expect(java.downloadRequested.value).toBe(true)
    expect(java.isPopupOpen.value).toBe(true)

    releaseDownload()
    const result = await pending

    expect(result).toBe('failed')
    expect(java.isPopupOpen.value).toBe(false)
    expect(java.isDownloading.value).toBe(false)
    expect(java.downloaded.value).toBe(0)
    expect(java.total.value).toBe(0)
    expect(java.phase.value).toBe('download')
    expect(java.downloadRequested.value).toBe(false)
    expect(useNotificationStore().message).not.toContain('Ошибка загрузки Java')
    expect(reportError).not.toHaveBeenCalled()
    expect(unlistenJavaSteps).toHaveBeenCalledTimes(1)

    vi.mocked(downloadAlternativeJava).mockResolvedValue(undefined)
    const retried = await java.startDownload()
    expect(retried).toBe('downloaded')
    expect(cancelAlternativeJava).toHaveBeenCalledTimes(1)
  })

  it('keeps the popup open and resets progress when the download fails mid-flight', async () => {
    const failure = new Error('checksum mismatch')
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          releaseDownload = (): void => reject(failure)
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    await flushSubscription()
    emitJavaStep?.({ type: 'progress', id: STEP_IDS.javaAltDownload, current: 1024, total: 4096 })
    expect(java.downloaded.value).toBe(1024)
    expect(java.total.value).toBe(4096)

    releaseDownload()
    const result = await pending

    expect(result).toBe('failed')
    expect(reportError).toHaveBeenCalledWith('Не удалось скачать Java', failure)
    expect(useNotificationStore().message).toBe('Ошибка загрузки Java: checksum mismatch')
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDownloading.value).toBe(false)
    expect(java.downloaded.value).toBe(0)
    expect(java.total.value).toBe(0)
    expect(java.phase.value).toBe('download')
    expect(java.downloadRequested.value).toBe(false)
    expect(unlistenJavaSteps).toHaveBeenCalledTimes(1)
  })

  it('treats closing the popup during download as a cancel request', async () => {
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          releaseDownload = (): void => reject({ code: 'cancelled', message: 'Загрузка отменена' })
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    await flushSubscription()

    java.closePopup()
    expect(cancelAlternativeJava).toHaveBeenCalledTimes(1)
    expect(java.downloadRequested.value).toBe(true)
    expect(java.isPopupOpen.value).toBe(true)
    expect(java.isDownloading.value).toBe(true)

    releaseDownload()
    const result = await pending

    expect(result).toBe('failed')
    expect(java.isPopupOpen.value).toBe(false)
    expect(java.isDownloading.value).toBe(false)
    expect(useNotificationStore().message).not.toContain('Ошибка загрузки Java')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('surfaces a real error raised after a cancel request', async () => {
    const failure = new Error('распаковка сломалась')
    let releaseDownload: () => void = () => {}
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          releaseDownload = (): void => reject(failure)
        }),
    )
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const pending = java.startDownload()
    await flushSubscription()

    await java.cancelDownload()
    releaseDownload()
    const result = await pending

    expect(result).toBe('failed')
    expect(reportError).toHaveBeenCalledWith('Не удалось скачать Java', failure)
    expect(useNotificationStore().message).toBe('Ошибка загрузки Java: распаковка сломалась')
    expect(java.isDownloading.value).toBe(false)
    expect(unlistenJavaSteps).toHaveBeenCalledTimes(1)
  })

  it('reports busy without an error toast when the backend rejects a parallel download', async () => {
    vi.mocked(getJavaDistributions).mockResolvedValue([makeDistribution('temurin')])
    vi.mocked(getJavaVersion).mockResolvedValue('17')
    vi.mocked(downloadAlternativeJava).mockRejectedValueOnce({
      code: 'launch_in_progress',
      message: 'Установка или запуск уже выполняются, дождитесь завершения',
    })
    const java = useAlternativeJava()
    await java.openPopup('1.20.1')

    const result = await java.startDownload()

    expect(result).toBe('busy')
    expect(reportError).not.toHaveBeenCalled()
    expect(useNotificationStore().message).not.toContain('Ошибка загрузки Java')
    expect(java.isDownloading.value).toBe(false)
    expect(java.isPopupOpen.value).toBe(true)
    expect(unlistenJavaSteps).toHaveBeenCalledTimes(1)
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
