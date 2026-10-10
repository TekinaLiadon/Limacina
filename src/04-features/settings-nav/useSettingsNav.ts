import { computed, type ComputedRef } from 'vue'
import { useCoreStore, useAccountsStore, useProjectSettingsStore } from '@/05-entities'

export type SettingsNavKey = 'launcher' | 'project' | 'game' | 'account' | 'skin' | 'model'

export interface SettingsNavItem {
  key: SettingsNavKey
  label: string
  routeName: string
  isAvailable: boolean
  reason: string
}

interface SettingsNavSeed {
  key: SettingsNavKey
  label: string
  routeName: string
  needsInit?: boolean
  needsAuth?: boolean
  hiddenOffline?: boolean
}

const SEEDS: SettingsNavSeed[] = [
  { key: 'launcher', label: 'Лаунчер', routeName: 'SettingsLauncher' },
  { key: 'project', label: 'Проект', routeName: 'SettingsProject', needsInit: true },
  { key: 'game', label: 'Игра', routeName: 'SettingsGame', needsInit: true },
  { key: 'account', label: 'Аккаунт', routeName: 'SettingsAccount', needsInit: true, needsAuth: true, hiddenOffline: true },
  { key: 'skin', label: 'Скин', routeName: 'SettingsSkin', needsInit: true, needsAuth: true },
  { key: 'model', label: 'Модель', routeName: 'SettingsModel', needsInit: true, needsAuth: true },
]

export function useSettingsNav(): {
  items: ComputedRef<SettingsNavItem[]>
} {
  const coreStore = useCoreStore()
  const accountsStore = useAccountsStore()
  const settingsStore = useProjectSettingsStore()

  const items = computed((): SettingsNavItem[] => {
    const isProjectReady = settingsStore.isLoaded && (coreStore.projectConfig?.initialized ?? settingsStore.config.initialized)
    const isOffline = settingsStore.isLoaded && !settingsStore.config.online
    const isLoadFailed = settingsStore.loadError !== ''

    return SEEDS.map((seed): SettingsNavItem => {
      let isAvailable = true
      let reason = ''
      if (isLoadFailed && (seed.needsInit === true || seed.needsAuth === true || seed.hiddenOffline === true)) {
        isAvailable = false
        reason = 'Не удалось загрузить настройки проекта'
      } else if (isOffline) {
        if (seed.hiddenOffline === true) {
          isAvailable = false
          reason = 'Недоступно в офлайн-режиме'
        }
      } else if (seed.needsInit === true && !isProjectReady) {
        isAvailable = false
        reason = 'Проект ещё не инициализирован'
      } else if (seed.needsAuth === true && !accountsStore.isLoggedIn) {
        isAvailable = false
        reason = 'Требуется авторизация'
      }
      return {
        key: seed.key,
        label: seed.label,
        routeName: seed.routeName,
        isAvailable,
        reason,
      }
    })
  })

  return { items }
}
