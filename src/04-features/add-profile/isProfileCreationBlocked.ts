import { useLaunchStore, useNotificationStore } from '@/05-entities'

export function isProfileCreationBlocked(): boolean {
  const launchStore = useLaunchStore()
  const notification = useNotificationStore()

  if (launchStore.gameUsernames.length > 0) {
    notification.show('Нельзя добавить профиль, пока запущена игра')
    return true
  }
  if (launchStore.isLaunching) {
    notification.show('Дождитесь завершения запуска игры')
    return true
  }
  return false
}
