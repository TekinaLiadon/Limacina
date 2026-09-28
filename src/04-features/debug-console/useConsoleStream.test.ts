import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const api = vi.hoisted(() => ({
  getStartupLogs: vi.fn(),
  listenGameConsole: vi.fn(),
}))

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getStartupLogs: api.getStartupLogs,
  listenGameConsole: api.listenGameConsole,
}))

interface ConsoleApi {
  logs: { value: { line: string; isError: boolean }[] }
  streamError: { value: string }
  startConsoleStream: () => Promise<void>
  setConsoleActive: (active: boolean) => void
}

describe('useConsoleStream', () => {
  let ingest: ((log: { line: string; isError: boolean }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ingest = undefined
    api.getStartupLogs.mockReset()
    api.listenGameConsole.mockReset()
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

  const loadStream = async (): Promise<ConsoleApi> => {
    const { useConsoleStream } = await import('./useConsoleStream')
    return useConsoleStream()
  }

  it('keeps the startup logs in the backlog until the console opens', async () => {
    api.getStartupLogs.mockResolvedValue([
      { line: '\x1B[32m[render]\x1B[0m ready', isError: false },
      { line: 'crash\x07', isError: true },
    ])
    const stream = await loadStream()

    await stream.startConsoleStream()
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)

    expect(stream.logs.value).toEqual([
      { line: '[render] ready', isError: false },
      { line: 'crash', isError: true },
    ])
    expect(stream.streamError.value).toBe('')
  })

  it('keeps the live lines in the backlog until the console opens', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()

    ingest?.({ line: 'boot', isError: false })
    ingest?.({ line: '\x1B[31mboom\x1B[0m', isError: true })
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)

    expect(stream.logs.value).toEqual([
      { line: 'boot', isError: false },
      { line: 'boom', isError: true },
    ])
  })

  it('flushes the buffer periodically while active', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'tick 1', isError: false })
    ingest?.({ line: 'tick 2', isError: false })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['tick 1', 'tick 2'])
  })

  it('caps the kept lines at the limit while active', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    for (let i = 0; i < 2100; i += 1) {
      ingest?.({ line: `line ${i}`, isError: false })
    }
    await vi.advanceTimersByTimeAsync(500 * 22)

    expect(stream.logs.value).toHaveLength(2000)
    expect(stream.logs.value[0]?.line).toBe('line 100')
    expect(stream.logs.value[1999]?.line).toBe('line 2099')
  })

  it('caps the backlog while inactive and drains it in batches', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()

    for (let i = 0; i < 2100; i += 1) {
      ingest?.({ line: `line ${i}`, isError: false })
    }
    stream.setConsoleActive(true)
    expect(stream.logs.value).toHaveLength(100)

    await vi.advanceTimersByTimeAsync(500 * 25)

    expect(stream.logs.value).toHaveLength(2000)
    expect(stream.logs.value[0]?.line).toBe('line 100')
    expect(stream.logs.value[1999]?.line).toBe('line 2099')
  })

  it('reports the subscription failure and allows a retry', async () => {
    api.getStartupLogs.mockResolvedValue([])
    api.listenGameConsole.mockRejectedValueOnce(new Error('no bus'))
    const stream = await loadStream()

    await stream.startConsoleStream()

    expect(stream.streamError.value).toBe('no bus')

    await stream.startConsoleStream()

    expect(api.listenGameConsole).toHaveBeenCalledTimes(2)
    expect(stream.streamError.value).toBe('')
  })

  it('loads the startup logs only once across restarts', async () => {
    api.getStartupLogs.mockResolvedValue([{ line: 'boot', isError: false }])
    const stream = await loadStream()
    await stream.startConsoleStream()
    await stream.startConsoleStream()

    expect(api.getStartupLogs).toHaveBeenCalledTimes(1)
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)
    expect(stream.logs.value).toEqual([{ line: 'boot', isError: false }])
  })
})
