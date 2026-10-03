import { onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore, useSettingsDirtyStore, type SettingsDirtyTab } from '@/05-entities'

const TAB_BY_ROUTE: Partial<Record<string, SettingsDirtyTab>> = {
  SettingsLauncher: 'launcher',
  SettingsGame: 'game',
}

const LEAVE_MESSAGE = 'На вкладке есть несохранённые изменения. Покинуть её?'

export function useSettingsDirtyGuard(): void {
  const router = useRouter()
  const dirtyStore = useSettingsDirtyStore()
  const notification = useNotificationStore()

  const stop = router.beforeEach(async (_to, from) => {
    const tab = from.name !== null && from.name !== undefined ? TAB_BY_ROUTE[String(from.name)] : undefined
    if (tab === undefined || !dirtyStore.dirtyTabs.includes(tab)) return true
    return await notification.confirm(LEAVE_MESSAGE)
  })

  onBeforeUnmount(stop)
}
