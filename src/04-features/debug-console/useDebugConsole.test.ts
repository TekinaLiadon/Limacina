import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationStore } from '@/05-entities'
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
  logs: { value: { line: string; isError: boolean }[] }
  filteredLogs: { value: { line: string; isError: boolean }[] }
  searchQuery: { value: string }
  onlyErrors: { value: boolean }
  linesCount: { value: number }
  startConsoleStream: () => Promise<void>
  handleCopy: () => Promise<void>
}

describe('useDebugConsole', () => {
  let ingest: ((log: { line: string; isError: boolean }) => void) | undefined

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
      { line: '[main] started', isError: false },
      { line: '[render] texture missing', isError: true },
      { line: '[audio] ready', isError: false },
    ])
    api.listenGameConsole.mockImplementation(
      async (handler: (log: { line: string; isError: boolean }) => void) => {
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
    const { useDebugConsole } = await import('./useDebugConsole')
    const { result } = withSetup(() => useDebugConsole())
    await result.startConsoleStream()
    return result
  }

  it('filters the logs by the query and the error flag', async () => {
    const debug = await loadConsole()

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
    const { useDebugConsole } = await import('./useDebugConsole')
    const mounted = withSetup(() => useDebugConsole())
    await mounted.result.startConsoleStream()

    ingest?.({ line: 'live line', isError: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(mounted.result.logs.value.some((log) => log.line === 'live line')).toBe(true)

    const firstCount = mounted.result.logs.value.length
    mounted.unmount()
    ingest?.({ line: 'hidden line', isError: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(mounted.result.logs.value.length).toBe(firstCount)
  })

  it('copies the filtered lines to the clipboard', async () => {
    shared.copyToClipboard.mockResolvedValue(undefined)
    const debug = await loadConsole()
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
})
