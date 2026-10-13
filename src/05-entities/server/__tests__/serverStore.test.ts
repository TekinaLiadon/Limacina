import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useServerStore } from '../serverStore'
import type { ServerStatus } from '../../core/types'

describe('useServerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with an unknown status and reachability', () => {
    const store = useServerStore()
    expect(store.serverStatus).toBeNull()
    expect(store.isServerReachable).toBeNull()
  })

  it('writes the status and reachability through actions', () => {
    const store = useServerStore()
    const status: ServerStatus = { online: 2, max: 20, version: '1.20.1' }

    store.setServerStatus(status)
    store.setReachable(false)
    expect(store.serverStatus).toEqual(status)
    expect(store.isServerReachable).toBe(false)

    store.setServerStatus(null)
    store.setReachable(true)
    expect(store.serverStatus).toBeNull()
    expect(store.isServerReachable).toBe(true)
  })

  it('resets the whole state', () => {
    const store = useServerStore()
    store.setServerStatus({ online: 1, max: 10, version: '1.20.1' })
    store.setReachable(true)

    store.resetServerState()

    expect(store.serverStatus).toBeNull()
    expect(store.isServerReachable).toBeNull()
  })
})
