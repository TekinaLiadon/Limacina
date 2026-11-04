import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLaunchStore, useNotificationStore } from '@/05-entities'
import { withSetup } from '@/test-support/withSetup'

const shared = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}))

const api = vi.hoisted(() => ({
  getStartupLogs: vi.fn(),
  listenGameConsole: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getStartupLogs: api.getStartupLogs,
  listenGameConsole: api.listenGameConsole,
}))

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  copyToClipboard: shared.copyToClipboard,
}))

interface DebugApi {
  logs: { value: { line: string; isError: boolean; session: string | null }[] }
  sessionTabs: { value: { name: string; isLive: boolean }[] }
  activeSession: { value: string | null }
  activeLogs: { value: { line: string; isError: boolean; session: string | null }[] }
  filteredLogs: { value: { line: string; isError: boolean; session: string | null }[] }
  searchQuery: { value: string }
  onlyErrors: { value: boolean }
  linesCount: { value: number }
  startConsoleStream: () => Promise<void>
  handleCopy: () => Promise<void>
  closeSession: (name: string) => void
}

describe('useDebugConsole', () => {
  let ingest: ((log: { line: string; isError: boolean; session: string | null }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ingest = undefined
    shared.copyToClipboard.mockReset()
    api.getStartupLogs.mockReset()
    api.listenGameConsole.mockReset()
    api.getStartupLogs.mockResolvedValue([
      { line: '[main] started', isError: false, session: null },
      { line: '[render] texture missing', isError: true, session: null },
      { line: '[audio] ready', isError: false, session: null },
    ])
    api.listenGameConsole.mockImplementation(
      async (handler: (log: { line: string; isError: boolean; session: string | null }) => void) => {
        ingest = handler
        return () => {}
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const loadConsole = async (): Promise<DebugApi> => {
    const { useDebugConsole } = await import('../useDebugConsole')
    const { result } = withSetup(() => useDebugConsole())
    await result.startConsoleStream()
    return result
  }

  it('filters the logs by the query and the error flag', async () => {
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)

    expect(debug.logs.value).toHaveLength(3)
    expect(debug.linesCount.value).toBe(3)

    debug.searchQuery.value = 'RENDER'
    expect(debug.linesCount.value).toBe(1)
    expect(debug.filteredLogs.value[0]?.line).toBe('[render] texture missing')

    debug.searchQuery.value = ''
    debug.onlyErrors.value = true
    expect(debug.linesCount.value).toBe(1)

    debug.searchQuery.value = '[audio]'
    expect(debug.linesCount.value).toBe(0)
  })

  it('activates the stream while mounted and deactivates on unmount', async () => {
    const { useDebugConsole } = await import('../useDebugConsole')
    const mounted = withSetup(() => useDebugConsole())
    await mounted.result.startConsoleStream()

    ingest?.({ line: 'live line', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)
    expect(mounted.result.logs.value.some((log) => log.line === 'live line')).toBe(true)

    const firstCount = mounted.result.logs.value.length
    mounted.unmount()
    ingest?.({ line: 'hidden line', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)
    expect(mounted.result.logs.value.length).toBe(firstCount)
  })

  it('copies the filtered lines to the clipboard', async () => {
    shared.copyToClipboard.mockResolvedValue(undefined)
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)
    debug.onlyErrors.value = true

    await debug.handleCopy()

    expect(shared.copyToClipboard).toHaveBeenCalledWith('[render] texture missing')
  })

  it('toasts on the copy failure', async () => {
    shared.copyToClipboard.mockRejectedValue(new Error('clipboard blocked'))
    const debug = await loadConsole()

    await debug.handleCopy()

    expect(useNotificationStore().message).toBe('Не удалось скопировать логи')
  })

  it('builds the session tabs from the stream and the live games and switches between them', async () => {
    useLaunchStore().addGameSession('Steve')
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)
    ingest?.({ line: 'alex live', isError: false, session: 'Alex' })
    ingest?.({ line: 'steve live', isError: false, session: 'Steve' })
    await vi.advanceTimersByTimeAsync(500)

    expect(debug.sessionTabs.value).toEqual([
      { name: 'Alex', isLive: false },
      { name: 'Steve', isLive: true },
    ])

    expect(debug.activeLogs.value).toHaveLength(5)

    debug.activeSession.value = 'Steve'
    expect(debug.activeLogs.value.map((log) => log.line)).toEqual(['steve live'])
    expect(debug.linesCount.value).toBe(1)

    debug.activeSession.value = 'Alex'
    expect(debug.activeLogs.value.map((log) => log.line)).toEqual(['alex live'])

    debug.activeSession.value = null
    expect(debug.activeLogs.value).toHaveLength(5)
  })

  it('keeps the filters and the copy inside the active session tab', async () => {
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)
    ingest?.({ line: 'steve boom', isError: true, session: 'Steve' })
    ingest?.({ line: 'alex boom', isError: true, session: 'Alex' })
    await vi.advanceTimersByTimeAsync(500)

    debug.activeSession.value = 'Steve'
    debug.onlyErrors.value = true

    expect(debug.linesCount.value).toBe(1)
    expect(debug.filteredLogs.value[0]?.line).toBe('steve boom')

    shared.copyToClipboard.mockResolvedValue(undefined)
    await debug.handleCopy()

    expect(shared.copyToClipboard).toHaveBeenCalledWith('steve boom')
  })

  it('parks the tab after the game exits and drops it on close', async () => {
    const launch = useLaunchStore()
    launch.addGameSession('Steve')
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)
    ingest?.({ line: 'steve crash', isError: true, session: 'Steve' })
    await vi.advanceTimersByTimeAsync(500)

    launch.removeGameSession('Steve')

    expect(debug.sessionTabs.value).toEqual([{ name: 'Steve', isLive: false }])

    debug.activeSession.value = 'Steve'
    expect(debug.activeLogs.value.map((log) => log.line)).toEqual(['steve crash'])

    debug.closeSession('Steve')

    expect(debug.sessionTabs.value).toEqual([])
    expect(debug.activeSession.value).toBeNull()
    expect(debug.logs.value.some((log) => log.line === 'steve crash')).toBe(false)
  })

  it('restores parked session tabs from the startup logs after a webview restart', async () => {
    api.getStartupLogs.mockResolvedValue([
      { line: 'steve old line', isError: false, session: 'Steve' },
    ])
    const debug = await loadConsole()
    await vi.advanceTimersByTimeAsync(500)

    expect(debug.sessionTabs.value).toEqual([{ name: 'Steve', isLive: false }])

    debug.activeSession.value = 'Steve'
    expect(debug.activeLogs.value.map((log) => log.line)).toEqual(['steve old line'])
  })
})
