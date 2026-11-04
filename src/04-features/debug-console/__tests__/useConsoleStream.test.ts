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
  logs: { value: { line: string; isError: boolean; session: string | null }[] }
  sessionLogs: { value: Record<string, { line: string; isError: boolean; session: string | null }[]> }
  streamError: { value: string }
  startConsoleStream: () => Promise<void>
  setConsoleActive: (active: boolean) => void
  closeSession: (name: string) => void
}

describe('useConsoleStream', () => {
  let ingest: ((log: { line: string; isError: boolean; session: string | null }) => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ingest = undefined
    api.getStartupLogs.mockReset()
    api.listenGameConsole.mockReset()
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

  const loadStream = async (): Promise<ConsoleApi> => {
    const { useConsoleStream } = await import('../useConsoleStream')
    return useConsoleStream()
  }

  it('keeps the startup logs in the backlog until the console opens', async () => {
    api.getStartupLogs.mockResolvedValue([
      { line: '\x1B[32m[render]\x1B[0m ready', isError: false, session: null },
      { line: 'crash\x07', isError: true, session: null },
    ])
    const stream = await loadStream()

    await stream.startConsoleStream()
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)

    expect(stream.logs.value).toEqual([
      { line: '[render] ready', isError: false, session: null },
      { line: 'crash', isError: true, session: null },
    ])
    expect(stream.streamError.value).toBe('')
  })

  it('strips OSC sequences with both BEL and ST terminators', async () => {
    api.getStartupLogs.mockResolvedValue([
      { line: '\x1B]0;window title\x07after-bel', isError: false, session: null },
      { line: '\x1B]8;;http://example.com\x1B\\after-st', isError: false, session: null },
    ])
    const stream = await loadStream()
    await stream.startConsoleStream()

    stream.setConsoleActive(true)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['after-bel', 'after-st'])
  })

  it('keeps the live lines in the backlog until the console opens', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()

    ingest?.({ line: 'boot', isError: false, session: null })
    ingest?.({ line: '\x1B[31mboom\x1B[0m', isError: true, session: null })
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)

    expect(stream.logs.value).toEqual([
      { line: 'boot', isError: false, session: null },
      { line: 'boom', isError: true, session: null },
    ])
  })

  it('keeps the session marker alongside the stripped line', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: '[MC|Steve] Sound engine started', isError: false, session: 'Steve' })
    ingest?.({ line: 'launcher line', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value).toEqual([
      { line: '[MC|Steve] Sound engine started', isError: false, session: 'Steve' },
      { line: 'launcher line', isError: false, session: null },
    ])
  })

  it('flushes the buffer periodically while active', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'tick 1', isError: false, session: null })
    ingest?.({ line: 'tick 2', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['tick 1', 'tick 2'])
  })

  it('stops the flush timer once the buffer drains and restarts it on new lines', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'tick 1', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)
    expect(stream.logs.value.map((log) => log.line)).toEqual(['tick 1'])
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5000)
    expect(stream.logs.value).toHaveLength(1)

    ingest?.({ line: 'tick 2', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['tick 1', 'tick 2'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps the buffered lines while they outpace the flush', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    for (let i = 0; i < 2100; i += 1) {
      ingest?.({ line: `line ${i}`, isError: false, session: null })
    }
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(500 * 25)

    expect(stream.logs.value).toHaveLength(2000)
    expect(stream.logs.value[0]?.line).toBe('line 100')
    expect(stream.logs.value[1999]?.line).toBe('line 2099')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps the kept lines at the limit while active', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    for (let i = 0; i < 2100; i += 1) {
      ingest?.({ line: `line ${i}`, isError: false, session: null })
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
      ingest?.({ line: `line ${i}`, isError: false, session: null })
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

  it('shows the startup lines before the live lines that arrive while they are loading', async () => {
    let resolveStartup: (logs: { line: string; isError: boolean; session: string | null }[]) => void = () => {}
    const startupPromise = new Promise<{ line: string; isError: boolean; session: string | null }[]>((resolve) => {
      resolveStartup = resolve
    })
    api.getStartupLogs.mockImplementationOnce(() => startupPromise)
    const stream = await loadStream()

    const pending = stream.startConsoleStream()
    expect(api.listenGameConsole).toHaveBeenCalledTimes(1)

    ingest?.({ line: 'live line', isError: false, session: null })
    resolveStartup([{ line: 'startup line', isError: false, session: null }])
    await pending

    stream.setConsoleActive(true)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['startup line', 'live line'])
  })

  it('shows the startup lines before the live lines when the console opens during the load', async () => {
    let resolveStartup: (logs: { line: string; isError: boolean; session: string | null }[]) => void = () => {}
    const startupPromise = new Promise<{ line: string; isError: boolean; session: string | null }[]>((resolve) => {
      resolveStartup = resolve
    })
    api.getStartupLogs.mockImplementationOnce(() => startupPromise)
    const stream = await loadStream()

    const pending = stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'live line', isError: false, session: null })
    resolveStartup([{ line: 'startup line', isError: false, session: null }])
    await pending
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['startup line', 'live line'])
  })

  it('cleans up the subscription when the startup logs fail and allows a retry', async () => {
    api.getStartupLogs.mockRejectedValueOnce(new Error('logs gone'))
    const stopFirst = vi.fn()
    api.listenGameConsole.mockImplementationOnce(async () => stopFirst)
    const stream = await loadStream()

    await stream.startConsoleStream()

    expect(stopFirst).toHaveBeenCalledTimes(1)
    expect(stream.streamError.value).toBe('logs gone')

    api.getStartupLogs.mockResolvedValue([])
    await stream.startConsoleStream()

    expect(api.listenGameConsole).toHaveBeenCalledTimes(2)
    expect(stream.streamError.value).toBe('')
  })

  it('routes lines into per-session buffers alongside the combined stream', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'steve line', isError: false, session: 'Steve' })
    ingest?.({ line: 'alex line', isError: true, session: 'Alex' })
    ingest?.({ line: 'launcher line', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value.map((log) => log.line)).toEqual(['steve line', 'alex line', 'launcher line'])
    expect(stream.sessionLogs.value['Steve']?.map((log) => log.line)).toEqual(['steve line'])
    expect(stream.sessionLogs.value['Alex']?.map((log) => log.isError)).toEqual([true])
    expect(stream.sessionLogs.value['launcher line']).toBeUndefined()
  })

  it('caps each session buffer independently while the game outpaces the flush', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    for (let i = 0; i < 2100; i += 1) {
      ingest?.({ line: `steve ${i}`, isError: false, session: 'Steve' })
    }
    await vi.advanceTimersByTimeAsync(500 * 25)

    expect(stream.sessionLogs.value['Steve']).toHaveLength(2000)
    expect(stream.sessionLogs.value['Steve']?.[0]?.line).toBe('steve 100')

    ingest?.({ line: 'alex line', isError: false, session: 'Alex' })
    await vi.advanceTimersByTimeAsync(500)

    for (let i = 2100; i < 4200; i += 1) {
      ingest?.({ line: `steve ${i}`, isError: false, session: 'Steve' })
    }
    await vi.advanceTimersByTimeAsync(500 * 25)

    expect(stream.sessionLogs.value['Steve']).toHaveLength(2000)
    expect(stream.sessionLogs.value['Steve']?.[0]?.line).toBe('steve 2200')
    expect(stream.sessionLogs.value['Steve']?.[1999]?.line).toBe('steve 4199')
    expect(stream.sessionLogs.value['Alex']?.map((log) => log.line)).toEqual(['alex line'])
  })

  it('restores session buffers separately from the startup logs', async () => {
    api.getStartupLogs.mockResolvedValue([
      { line: 'steve old', isError: false, session: 'Steve' },
      { line: 'alex old', isError: false, session: 'Alex' },
      { line: 'launcher old', isError: false, session: null },
    ])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    expect(stream.sessionLogs.value['Steve']?.map((log) => log.line)).toEqual(['steve old'])
    expect(stream.sessionLogs.value['Alex']?.map((log) => log.line)).toEqual(['alex old'])
    expect(stream.sessionLogs.value).not.toHaveProperty('launcher old')
  })

  it('keeps the backlog lines out of the session buffers until the console opens', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()

    ingest?.({ line: 'steve idle', isError: false, session: 'Steve' })
    expect(stream.sessionLogs.value).toEqual({})

    stream.setConsoleActive(true)

    expect(stream.sessionLogs.value['Steve']?.map((log) => log.line)).toEqual(['steve idle'])
  })

  it('closes a session tab by purging its lines and recreates the buffer on later lines', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'steve first', isError: false, session: 'Steve' })
    ingest?.({ line: 'launcher line', isError: false, session: null })
    await vi.advanceTimersByTimeAsync(500)

    stream.closeSession('Steve')

    expect(stream.sessionLogs.value['Steve']).toBeUndefined()
    expect(stream.logs.value.map((log) => log.line)).toEqual(['launcher line'])

    ingest?.({ line: 'steve second', isError: false, session: 'Steve' })
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.sessionLogs.value['Steve']?.map((log) => log.line)).toEqual(['steve second'])
  })

  it('drops the pending session lines from the buffers on close', async () => {
    api.getStartupLogs.mockResolvedValue([])
    const stream = await loadStream()
    await stream.startConsoleStream()
    stream.setConsoleActive(true)

    ingest?.({ line: 'steve pending', isError: false, session: 'Steve' })
    stream.closeSession('Steve')
    await vi.advanceTimersByTimeAsync(500)

    expect(stream.logs.value).toEqual([])
    expect(stream.sessionLogs.value['Steve']).toBeUndefined()
  })

  it('loads the startup logs only once across restarts', async () => {
    api.getStartupLogs.mockResolvedValue([{ line: 'boot', isError: false, session: null }])
    const stream = await loadStream()
    await stream.startConsoleStream()
    await stream.startConsoleStream()

    expect(api.getStartupLogs).toHaveBeenCalledTimes(1)
    expect(stream.logs.value).toEqual([])

    stream.setConsoleActive(true)
    expect(stream.logs.value).toEqual([{ line: 'boot', isError: false, session: null }])
  })
})
