import { useCoreStore, useNotificationStore, type StepEvent, type GameExitInfo } from '@/05-entities'
import { listenLaunchSteps, listenGameExit, getNotificationIcon } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isPermissionGranted, requestPermission, sendNotification, type Options } from '@tauri-apps/plugin-notification'

const DOWNLOAD_STEP_IDS: ReadonlySet<string> = new Set([
  'java.download',
  'files.download',
  'mc.jar',
  'mc.libs',
  'mc.assets',
  'mc.natives',
  'loader',
  'mods.download',
])

const FLOW_ENTRY_STEP_IDS: ReadonlySet<string> = new Set(['java.check', 'files.list'])

let notificationsStarted = false
let downloadRan = false
let notificationIcon: string | null | undefined

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
    return await getCurrentWindow().isMinimized()
  }

  const sendSystemNotification = async (title: string, body: string): Promise<void> => {
    if (!(coreStore.launcherConfig?.systemNotifications ?? true)) return
    try {
      if (!(await isWindowHidden())) return
      let granted = await isPermissionGranted()
      if (!granted) {
        granted = (await requestPermission()) === 'granted'
      }
      if (granted) {
        const payload: Options = { title, body }
        const icon = await resolveNotificationIcon()
        if (icon) payload.icon = icon
        sendNotification(payload)
      }
    } catch (e: unknown) {
      reportError('Не удалось отправить системное уведомление', e)
    }
  }

  const handleStepEvent = (event: StepEvent): void => {
    if (event.type === 'started') {
      if (FLOW_ENTRY_STEP_IDS.has(event.id) || event.id === 'java.extract') {
        downloadRan = false
      }
      if (event.id === 'launch.config' && downloadRan) {
        downloadRan = false
        void sendSystemNotification('Файлы загружены', 'Все файлы проекта загружены, запускаем игру')
      }
    }
    if (event.type === 'finished' && !event.skipped) {
      if (event.id === 'java.extract') {
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

  const handleGameExit = async (info: GameExitInfo): Promise<void> => {
    if (info.success) return
    if (await isWindowHidden()) {
      const body =
        info.code != null
          ? `Процесс игры завершился с кодом ${info.code}`
          : 'Процесс игры был аварийно завершён'
      await sendSystemNotification('Игра завершилась с ошибкой', body)
      return
    }
    notification.show(
      info.code != null
        ? `Игра завершилась с ошибкой (код ${info.code})`
        : 'Игра была аварийно завершена'
    )
  }

  const startSystemNotifications = async (): Promise<void> => {
    if (notificationsStarted) return
    notificationsStarted = true
    try {
      await listenLaunchSteps(handleStepEvent)
      await listenGameExit(handleGameExit)
    } catch (e: unknown) {
      notificationsStarted = false
      reportError('Не удалось запустить поток системных уведомлений', e)
    }
  }

  return {
    sendSystemNotification,
    startSystemNotifications,
  }
}
