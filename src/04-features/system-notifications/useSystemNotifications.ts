import { useCoreStore, useNotificationStore, type StepEvent, type GameExitInfo } from '@/05-entities'
import { isWindowMinimized, listenLaunchSteps, listenGameExit, listenGameStarted, getNotificationIcon } from '@/06-shared/api'
import { reportError, DOWNLOAD_STEP_IDS, FLOW_ENTRY_STEP_IDS, STEP_IDS, isNotificationPermissionGranted, requestNotificationPermission, sendOsNotification, type NotificationOptions } from '@/06-shared'

const GAME_START_TITLE = 'Игра запущена'
const gameStartBody = (username: string): string => `Сессия ${username} запущена — лаунчер ждёт в трее`
const GAME_EXIT_OK_TITLE = 'Игра завершена'
const GAME_EXIT_OK_BODY = 'Игра закрыта — лаунчер ждёт в трее'

let notificationsStarted = false
let downloadRan = false
let notificationIcon: string | null | undefined
let pendingStartUsername: string | null = null

const resolveNotificationIcon = async (): Promise<string | null> => {
  if (notificationIcon === undefined) {
    try {
      notificationIcon = await getNotificationIcon()
    } catch (e: unknown) {
      reportError('Не удалось получить иконку для уведомлений', e)
      notificationIcon = null
    }
  }
  return notificationIcon
}

export function useSystemNotifications(): {
  sendSystemNotification: (title: string, body: string) => Promise<void>
  startSystemNotifications: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const isWindowHidden = async (): Promise<boolean> => {
    if (document.visibilityState === 'hidden') return true
    return isWindowMinimized()
  }

  const sendSystemNotification = async (title: string, body: string): Promise<void> => {
    if (!(coreStore.launcherConfig?.systemNotifications ?? true)) return
    try {
      if (!(await isWindowHidden())) return
      let granted = await isNotificationPermissionGranted()
      if (!granted) {
        granted = (await requestNotificationPermission()) === 'granted'
      }
      if (granted) {
        const payload: NotificationOptions = { title, body }
        const icon = await resolveNotificationIcon()
        if (icon) payload.icon = icon
        await sendOsNotification(payload)
      }
    } catch (e: unknown) {
      reportError('Не удалось отправить системное уведомление', e)
    }
  }

  const handleStepEvent = (event: StepEvent): void => {
    if (event.type === 'started') {
      if (FLOW_ENTRY_STEP_IDS.has(event.id) || event.id === STEP_IDS.javaExtract) {
        downloadRan = false
      }
      if (event.id === STEP_IDS.launchConfig && downloadRan) {
        downloadRan = false
        void sendSystemNotification('Файлы загружены', 'Все файлы проекта загружены, запускаем игру')
      }
    }
    if (event.type === 'finished' && !event.skipped) {
      if (event.id === STEP_IDS.javaExtract) {
        void sendSystemNotification('Java установлена', 'Загрузка и распаковка Java завершены')
      }
      if (DOWNLOAD_STEP_IDS.has(event.id)) {
        downloadRan = true
      }
    }
    if (event.type === 'failed') {
      void sendSystemNotification('Не удалось запустить игру', event.message)
    }
  }

  const exitBody = (info: GameExitInfo): string =>
    info.reason ??
    (info.code != null
      ? `Процесс игры завершился с кодом ${info.code}`
      : 'Процесс игры был аварийно завершён')

  const sendStartNotification = async (): Promise<void> => {
    const username = pendingStartUsername
    if (username === null) return
    pendingStartUsername = null
    await sendSystemNotification(GAME_START_TITLE, gameStartBody(username))
  }

  const handleGameStarted = async (username: string): Promise<void> => {
    pendingStartUsername = username
    if (!(await isWindowHidden())) return
    await sendStartNotification()
  }

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'hidden') return
    void sendStartNotification()
  }

  const handleGameExit = async (info: GameExitInfo): Promise<void> => {
    pendingStartUsername = null
    const windowHidden = await isWindowHidden()
    if (info.success) {
      if (windowHidden) {
        await sendSystemNotification(GAME_EXIT_OK_TITLE, GAME_EXIT_OK_BODY)
      }
      return
    }
    if (windowHidden) {
      await sendSystemNotification('Игра завершилась с ошибкой', exitBody(info))
      return
    }
    notification.show(
      info.reason ??
        (info.code != null
          ? `Игра завершилась с ошибкой (код ${info.code})`
          : 'Игра была аварийно завершена')
    )
  }

  const startSystemNotifications = async (): Promise<void> => {
    if (notificationsStarted) return
    notificationsStarted = true
    document.addEventListener('visibilitychange', handleVisibilityChange)

    let unlistenSteps: (() => void) | null = null
    let unlistenStarted: (() => void) | null = null
    let unlistenExit: (() => void) | null = null
    try {
      unlistenSteps = await listenLaunchSteps(handleStepEvent)
      unlistenStarted = await listenGameStarted(handleGameStarted)
      unlistenExit = await listenGameExit(handleGameExit)
    } catch (e: unknown) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      unlistenSteps?.()
      unlistenStarted?.()
      unlistenExit?.()
      notificationsStarted = false
      reportError('Не удалось запустить поток системных уведомлений', e)
    }
  }

  return {
    sendSystemNotification,
    startSystemNotifications,
  }
}
