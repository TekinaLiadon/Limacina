import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCoreStore, useProjectSettingsStore } from '@/05-entities'
import { useSettingsNav } from '../useSettingsNav'

const setupNav = (): ReturnType<typeof useSettingsNav> => useSettingsNav()

describe('useSettingsNav', () => {
  it('keeps the launcher entry always available for a ready project', () => {
    setActivePinia(createPinia())
    const core = useCoreStore()
    const store = useProjectSettingsStore()
    core.projectConfig = {
      projectName: 'proj',
      mcVersion: '1.20.1',
      modLoader: 'vanilla',
      loaderVersion: null,
      javaPath: null,
      javaVersion: null,
      jvmArgs: [],
      minMemory: '512',
      maxMemory: '4096',
      online: true,
      initialized: true,
      serverUrl: null,
      autoJoinServer: false,
    }
    store.isLoaded = true
    store.config.initialized = true
    core.isLoggedIn = true

    const items = setupNav().items.value

    expect(items.map((item) => item.key)).toEqual([
      'launcher',
      'project',
      'game',
      'account',
      'skin',
      'model',
    ])
    expect(items.every((item) => item.isAvailable && item.reason === '')).toBe(true)
  })

  it('blocks the project-dependent entries while the project is uninitialized', () => {
    setActivePinia(createPinia())
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.initialized = false

    const items = setupNav().items.value

    const blocked = items.filter((item) => !item.isAvailable)
    expect(blocked.map((item) => item.key)).toEqual(['project', 'game', 'account', 'skin', 'model'])
    expect(blocked.every((item) => item.reason === 'Проект ещё не инициализирован')).toBe(true)
    expect(items[0]?.isAvailable).toBe(true)
  })

  it('hides the account entry for an offline project', () => {
    setActivePinia(createPinia())
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.initialized = true
    store.config.online = false

    const items = setupNav().items.value
    const account = items.find((item) => item.key === 'account')

    expect(account?.isAvailable).toBe(false)
    expect(account?.reason).toBe('Недоступно в офлайн-режиме')
    expect(items.find((item) => item.key === 'skin')?.isAvailable).toBe(true)
    expect(items.find((item) => item.key === 'model')?.isAvailable).toBe(true)
  })

  it('blocks everything but the launcher while the load failed', () => {
    setActivePinia(createPinia())
    const store = useProjectSettingsStore()
    store.loadError = 'Не удалось загрузить'

    const items = setupNav().items.value

    const blocked = items.filter((item) => !item.isAvailable)
    expect(blocked.map((item) => item.key)).toEqual(['project', 'game', 'account', 'skin', 'model'])
    expect(blocked.every((item) => item.reason === 'Не удалось загрузить настройки проекта')).toBe(true)
    expect(items[0]?.isAvailable).toBe(true)
  })

  it('requires authorization for the auth-gated entries', () => {
    setActivePinia(createPinia())
    const store = useProjectSettingsStore()
    store.isLoaded = true
    store.config.initialized = true

    const items = setupNav().items.value
    const blocked = items.filter((item) => !item.isAvailable)

    expect(blocked.map((item) => item.key)).toEqual(['account', 'skin', 'model'])
    expect(blocked.every((item) => item.reason === 'Требуется авторизация')).toBe(true)
  })
})
