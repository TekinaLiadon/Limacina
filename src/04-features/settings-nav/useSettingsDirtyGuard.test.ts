import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore, useSettingsDirtyStore } from '@/05-entities'
import { useSettingsDirtyGuard } from './useSettingsDirtyGuard'
import { withSetup } from '@/test-support/withSetup'

const Empty = defineComponent({ render: () => h('div') })

const buildRouter = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/launcher', name: 'SettingsLauncher', component: Empty },
      { path: '/settings/game', name: 'SettingsGame', component: Empty },
      { path: '/settings/project', name: 'SettingsProject', component: Empty },
      { path: '/accounts', name: 'Accounts', component: Empty },
    ],
  })

describe('useSettingsDirtyGuard', () => {
  let router: Router

  beforeEach(() => {
    setActivePinia(createPinia())
    router = buildRouter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mountGuard = async (startRoute: string): Promise<ReturnType<typeof withSetup>> => {
    router.push(startRoute)
    await router.isReady()
    return withSetup(() => useSettingsDirtyGuard(), [router])
  }

  it('lets navigation through when no tab is dirty', async () => {
    const { unmount } = await mountGuard('/settings/launcher')

    await router.push('/settings/game')

    expect(router.currentRoute.value.name).toBe('SettingsGame')
    expect(useNotificationStore().popupVisible).toBe(false)
    unmount()
  })

  it('blocks leaving a dirty tab until the confirmation is accepted', async () => {
    useSettingsDirtyStore().setTabDirty('launcher', true)
    const { unmount } = await mountGuard('/settings/launcher')

    const pending = router.push('/settings/game')
    expect(router.currentRoute.value.name).toBe('SettingsLauncher')
    await vi.waitFor(() => expect(useNotificationStore().popupVisible).toBe(true))

    useNotificationStore().resolvePopup(true)
    await pending

    expect(router.currentRoute.value.name).toBe('SettingsGame')
    unmount()
  })

  it('keeps the dirty tab when the confirmation is declined', async () => {
    useSettingsDirtyStore().setTabDirty('game', true)
    const { unmount } = await mountGuard('/settings/game')

    const pending = router.push('/accounts')
    await vi.waitFor(() => expect(useNotificationStore().popupVisible).toBe(true))

    useNotificationStore().resolvePopup(false)
    await pending

    expect(router.currentRoute.value.name).toBe('SettingsGame')
    unmount()
  })

  it('ignores dirty state of the tab that is not being left', async () => {
    useSettingsDirtyStore().setTabDirty('game', true)
    const { unmount } = await mountGuard('/settings/launcher')

    await router.push('/settings/project')

    expect(router.currentRoute.value.name).toBe('SettingsProject')
    expect(useNotificationStore().popupVisible).toBe(false)
    unmount()
  })

  it('stops guarding after unmount', async () => {
    useSettingsDirtyStore().setTabDirty('launcher', true)
    const { unmount } = await mountGuard('/settings/launcher')
    unmount()

    await router.push('/accounts')

    expect(router.currentRoute.value.name).toBe('Accounts')
    expect(useNotificationStore().popupVisible).toBe(false)
  })
})
