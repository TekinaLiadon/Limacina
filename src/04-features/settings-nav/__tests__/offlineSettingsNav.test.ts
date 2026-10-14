import { beforeEach, describe, expect, it } from 'vitest'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectSettingsStore } from '@/05-entities'
import { useOfflineSettingsNav } from '../offlineSettingsNav'
import type { SettingsNavItem } from '../useSettingsNav'

const serverItem = (key: SettingsNavItem['key'], isAvailable: boolean, reason: string): SettingsNavItem => ({
  key,
  label: key,
  routeName: `Settings-${key}`,
  isAvailable,
  reason,
})

const setupNav = (items: SettingsNavItem[]): ReturnType<typeof useOfflineSettingsNav> => {
  const serverItems = computed((): SettingsNavItem[] => items)
  return useOfflineSettingsNav(serverItems)
}

describe('useOfflineSettingsNav', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('passes the server items through for an online project', () => {
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.online = true
    const items = setupNav([serverItem('account', false, 'Требуется авторизация')])

    expect(items.value).toEqual([serverItem('account', false, 'Требуется авторизация')])
  })

  it('blocks only the account entry for an offline project', () => {
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.online = false
    const items = setupNav([
      serverItem('launcher', true, ''),
      serverItem('account', false, 'Требуется авторизация'),
    ])

    expect(items.value[0]).toEqual(serverItem('launcher', true, ''))
    expect(items.value[1]).toEqual({
      key: 'account',
      label: 'account',
      routeName: 'Settings-account',
      isAvailable: false,
      reason: 'Недоступно в офлайн-режиме',
    })
  })

  it('makes the auth-gated entries available for an offline project', () => {
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.online = false
    const items = setupNav([
      serverItem('skin', false, 'Проект ещё не инициализирован'),
      serverItem('model', false, 'Требуется авторизация'),
    ])

    expect(items.value[0]?.isAvailable).toBe(true)
    expect(items.value[0]?.reason).toBe('')
    expect(items.value[1]?.isAvailable).toBe(true)
    expect(items.value[1]?.reason).toBe('')
  })

  it('keeps the load failure blocks for an offline project', () => {
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.online = false
    store.loadError = 'Не удалось загрузить'
    const items = setupNav([
      serverItem('account', false, 'Не удалось загрузить настройки проекта'),
      serverItem('skin', false, 'Не удалось загрузить настройки проекта'),
    ])

    expect(items.value).toEqual([
      serverItem('account', false, 'Не удалось загрузить настройки проекта'),
      serverItem('skin', false, 'Не удалось загрузить настройки проекта'),
    ])
  })
})
