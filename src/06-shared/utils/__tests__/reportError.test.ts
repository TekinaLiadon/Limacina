import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  sendConsoleLog: vi.fn(),
}))

vi.mock('@/06-shared/api/consoleLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api/consoleLog')>()),
  sendConsoleLog: api.sendConsoleLog,
}))

const loadReportError = async (): Promise<typeof import('../reportError')['reportError']> => {
  const module = await import('../reportError')
  return module.reportError
}

describe('reportError', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    api.sendConsoleLog.mockReset()
    api.sendConsoleLog.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends distinct errors to the debug console IPC', async () => {
    const reportError = await loadReportError()

    reportError('boom', new Error('first'))
    reportError('boom', new Error('second'))

    expect(api.sendConsoleLog).toHaveBeenCalledTimes(2)
    expect(api.sendConsoleLog).toHaveBeenLastCalledWith('[frontend] boom: second', true)
  })

  it('deduplicates the identical error within the window', async () => {
    const reportError = await loadReportError()

    reportError('boom', new Error('same'))
    vi.advanceTimersByTime(1000)
    reportError('boom', new Error('same'))

    expect(api.sendConsoleLog).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(6000)
    reportError('boom', new Error('same'))

    expect(api.sendConsoleLog).toHaveBeenCalledTimes(2)
  })

  it('caps the IPC storm from distinct repeating errors', async () => {
    const reportError = await loadReportError()

    for (let i = 0; i < 40; i += 1) {
      reportError('render loop', new Error(`e-${i}`))
    }

    expect(api.sendConsoleLog).toHaveBeenCalledTimes(20)
  })

  it('always mirrors errors into the browser console', async () => {
    const reportError = await loadReportError()

    for (let i = 0; i < 25; i += 1) {
      reportError('render loop', new Error(`e-${i}`))
    }

    expect(console.error).toHaveBeenCalledTimes(25)
  })
})
