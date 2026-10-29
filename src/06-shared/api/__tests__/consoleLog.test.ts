import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendConsoleLog } from '../consoleLog'

describe('sendConsoleLog', () => {
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invoke = vi.fn()
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke }
    invoke.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('sends the line and the error flag to send_frontend_log', async () => {
    await sendConsoleLog('[frontend] сбой', true)

    expect(invoke).toHaveBeenCalledWith(
      'send_frontend_log',
      { line: '[frontend] сбой', isError: true },
      undefined,
    )
  })

  it('marks regular log lines as non-errors', async () => {
    await sendConsoleLog('строка', false)

    expect(invoke).toHaveBeenCalledWith('send_frontend_log', { line: 'строка', isError: false }, undefined)
  })
})
