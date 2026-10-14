import { computed, type ComputedRef } from 'vue'
import { useProjectSettingsStore } from '@/05-entities'
import type { SettingsNavItem, SettingsNavKey } from './useSettingsNav'

const OFFLINE_BLOCKED_TABS: ReadonlySet<SettingsNavKey> = new Set(['account'])
const OFFLINE_BLOCK_REASON = 'Недоступно в офлайн-режиме'

export function useOfflineSettingsNav(serverItems: ComputedRef<SettingsNavItem[]>): ComputedRef<SettingsNavItem[]> {
  const settingsStore = useProjectSettingsStore()

  const isOffline = computed((): boolean => settingsStore.isLoaded && !settingsStore.config.online)

  return computed((): SettingsNavItem[] => {
    if (!isOffline.value) return serverItems.value
    if (settingsStore.loadError !== '') return serverItems.value
    return serverItems.value.map((item): SettingsNavItem => {
      if (!OFFLINE_BLOCKED_TABS.has(item.key)) {
        return { ...item, isAvailable: true, reason: '' }
      }
      return { ...item, isAvailable: false, reason: OFFLINE_BLOCK_REASON }
    })
  })
}
