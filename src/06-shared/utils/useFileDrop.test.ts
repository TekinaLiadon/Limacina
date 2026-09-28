import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileDrop } from './useFileDrop'
import { withSetup } from '@/test-support/withSetup'

const webview = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: webview.onDragDropEvent,
  }),
}))

interface DropEvent {
  payload:
    | { type: 'enter'; paths: string[] }
    | { type: 'leave' }
    | { type: 'drop'; paths: string[] }
}

describe('useFileDrop', () => {
  let handler: ((event: DropEvent) => void) | undefined
  const stop = vi.fn<() => void>()

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    handler = undefined
    stop.mockReset()
    webview.onDragDropEvent.mockReset()
    webview.onDragDropEvent.mockImplementation(
      async (callback: (event: DropEvent) => void): Promise<() => void> => {
        handler = callback
        return (): void => {
          stop()
        }
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupDrop = (accept: string[]): { isDragOver: { value: boolean }; onDrop: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> } => {
    const onDrop = vi.fn()
    const onError = vi.fn()
    const { result } = withSetup(() =>
      useFileDrop({ accept, onDrop, onError }),
    )
    return { isDragOver: result.isDragOver, onDrop, onError }
  }

  const waitHandler = async (): Promise<void> => {
    await vi.waitFor(() => expect(handler).toBeDefined())
  }

  it('lights up the drag overlay for an accepted enter', async () => {
    const drop = setupDrop(['png'])
    await waitHandler()

    handler?.({ payload: { type: 'enter', paths: ['/tmp/hero.png'] } })
    expect(drop.isDragOver.value).toBe(true)

    handler?.({ payload: { type: 'leave' } })
    expect(drop.isDragOver.value).toBe(false)
  })

  it('ignores an enter without accepted extensions', async () => {
    const drop = setupDrop(['png'])
    await waitHandler()

    handler?.({ payload: { type: 'enter', paths: ['/tmp/archive.zip'] } })

    expect(drop.isDragOver.value).toBe(false)
  })

  it('drops an accepted file and reports a rejected one', async () => {
    const drop = setupDrop(['png', 'cpmproject'])
    await waitHandler()

    handler?.({ payload: { type: 'drop', paths: ['/tmp/hero.png'] } })
    expect(drop.onDrop).toHaveBeenCalledWith('/tmp/hero.png')
    expect(drop.isDragOver.value).toBe(false)

    handler?.({ payload: { type: 'drop', paths: ['/tmp/archive.zip'] } })
    expect(drop.onError).toHaveBeenCalledWith('Допустимый формат — .png, .cpmproject')
    expect(drop.onDrop).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty drop payload', async () => {
    const drop = setupDrop(['png'])
    await waitHandler()

    handler?.({ payload: { type: 'drop', paths: [] } })

    expect(drop.onDrop).not.toHaveBeenCalled()
    expect(drop.onError).not.toHaveBeenCalled()
  })

  it('stops listening on unmount', async () => {
    const { unmount } = withSetup(() => useFileDrop({ accept: ['png'], onDrop: (): void => {}, onError: (): void => {} }))
    await waitHandler()

    unmount()

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
