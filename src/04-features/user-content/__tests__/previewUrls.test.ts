import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAsyncRaceGuard } from '@/06-shared'
import { createPreviewBlobHolder, runPreviewLoad, type PreviewLoadSpec } from '../previewUrls'

const reportErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared')>()),
  reportError: reportErrorMock,
}))

const revokeObjectURLMock = vi.fn()
URL.revokeObjectURL = revokeObjectURLMock

const makeSpec = (overrides: Partial<PreviewLoadSpec> = {}): PreviewLoadSpec => {
  const guard = useAsyncRaceGuard()
  return {
    generation: guard.next(),
    guard,
    fetchBytes: async (): Promise<Uint8Array | null> => new Uint8Array([1, 2, 3]),
    createUrl: async (bytes: Uint8Array): Promise<string> => `blob:${bytes.length}`,
    adopt: vi.fn(),
    discard: vi.fn(),
    errorTarget: ref<string>(''),
    reportMessage: 'Не удалось загрузить превью',
    ...overrides,
  }
}

describe('runPreviewLoad', () => {
  beforeEach(() => {
    revokeObjectURLMock.mockClear()
    reportErrorMock.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adopts the created url when the load stays current', async () => {
    const spec = makeSpec()

    await runPreviewLoad(spec)

    expect(spec.adopt).toHaveBeenCalledWith('blob:3')
    expect(spec.discard).not.toHaveBeenCalled()
    expect(spec.errorTarget.value).toBe('')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('stops before the url creation when the guard turns stale after the fetch', async () => {
    const guard = useAsyncRaceGuard()
    const generation = guard.next()
    const createUrl = vi.fn(async (): Promise<string> => 'blob:x')
    const spec = makeSpec({
      generation,
      guard,
      fetchBytes: async (): Promise<Uint8Array | null> => {
        guard.cancel()
        return new Uint8Array([1])
      },
      createUrl,
    })

    await runPreviewLoad(spec)

    expect(createUrl).not.toHaveBeenCalled()
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.discard).not.toHaveBeenCalled()
  })

  it('discards the created url when the guard turns stale after the creation', async () => {
    const guard = useAsyncRaceGuard()
    const generation = guard.next()
    const spec = makeSpec({
      generation,
      guard,
      createUrl: async (): Promise<string> => {
        guard.next()
        return 'blob:stale'
      },
    })

    await runPreviewLoad(spec)

    expect(spec.discard).toHaveBeenCalledWith('blob:stale')
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.errorTarget.value).toBe('')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('keeps the error target silent when the fetch fails while stale', async () => {
    const guard = useAsyncRaceGuard()
    const generation = guard.next()
    const spec = makeSpec({
      generation,
      guard,
      fetchBytes: async (): Promise<Uint8Array | null> => {
        guard.cancel()
        throw new Error('gone')
      },
    })

    await runPreviewLoad(spec)

    expect(spec.errorTarget.value).toBe('')
    expect(reportErrorMock).not.toHaveBeenCalled()
    expect(spec.discard).not.toHaveBeenCalled()
  })

  it('writes the fetch error to the target and reports it when current', async () => {
    const spec = makeSpec({
      fetchBytes: async (): Promise<Uint8Array | null> => {
        throw new Error('cache miss')
      },
    })

    await runPreviewLoad(spec)

    expect(spec.errorTarget.value).toBe('cache miss')
    expect(reportErrorMock).toHaveBeenCalledWith(
      'Не удалось загрузить превью',
      expect.objectContaining({ message: 'cache miss' }),
    )
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.discard).not.toHaveBeenCalled()
  })

  it('runs beforeAdopt before the adoption', async () => {
    const order: string[] = []
    const adopt = vi.fn((): void => {
      order.push('adopt')
    })
    const spec = makeSpec({
      adopt,
      beforeAdopt: async (): Promise<void> => {
        order.push('before')
      },
    })

    await runPreviewLoad(spec)

    expect(order).toEqual(['before', 'adopt'])
  })

  it('discards the url when beforeAdopt leaves the guard stale', async () => {
    const guard = useAsyncRaceGuard()
    const generation = guard.next()
    const spec = makeSpec({
      generation,
      guard,
      createUrl: async (): Promise<string> => 'blob:soon-stale',
      beforeAdopt: async (): Promise<void> => {
        guard.next()
      },
    })

    await runPreviewLoad(spec)

    expect(spec.discard).toHaveBeenCalledWith('blob:soon-stale')
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.errorTarget.value).toBe('')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('discards the pending url and reports when beforeAdopt fails', async () => {
    const spec = makeSpec({
      beforeAdopt: async (): Promise<void> => {
        throw new Error('model gone')
      },
    })

    await runPreviewLoad(spec)

    expect(spec.discard).toHaveBeenCalledWith('blob:3')
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.errorTarget.value).toBe('model gone')
    expect(reportErrorMock).toHaveBeenCalledWith(
      'Не удалось загрузить превью',
      expect.objectContaining({ message: 'model gone' }),
    )
  })

  it('stops on empty bytes without creating the url', async () => {
    const createUrl = vi.fn(async (): Promise<string> => 'blob:x')
    const spec = makeSpec({
      fetchBytes: async (): Promise<Uint8Array | null> => null,
      createUrl,
    })

    await runPreviewLoad(spec)

    expect(createUrl).not.toHaveBeenCalled()
    expect(spec.adopt).not.toHaveBeenCalled()
    expect(spec.discard).not.toHaveBeenCalled()
  })
})

describe('createPreviewBlobHolder', () => {
  beforeEach(() => {
    revokeObjectURLMock.mockClear()
  })

  it('adopts the url replacing and revoking the previous current', () => {
    const current = ref('')
    const holder = createPreviewBlobHolder({
      getCurrentUrl: (): string => current.value,
      applyCurrentUrl: (url: string): void => {
        current.value = url
      },
      clearCurrentUrl: (): void => {
        current.value = ''
      },
    })

    holder.track('blob:first')
    holder.adopt('blob:first')
    expect(current.value).toBe('blob:first')

    holder.track('blob:second')
    holder.adopt('blob:second')
    expect(current.value).toBe('blob:second')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:first')
    expect(revokeObjectURLMock).not.toHaveBeenCalledWith('blob:second')
  })

  it('discards the tracked url revoking it once', () => {
    const holder = createPreviewBlobHolder({
      getCurrentUrl: (): string => '',
    })

    holder.track('blob:pending')
    holder.discard('blob:pending')
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:pending')

    holder.revokePending()
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
  })

  it('releases the current url and clears the slot', () => {
    const current = ref('blob:current')
    const holder = createPreviewBlobHolder({
      getCurrentUrl: (): string => current.value,
      clearCurrentUrl: (): void => {
        current.value = ''
      },
    })

    holder.releaseCurrent()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:current')
    expect(current.value).toBe('')
  })

  it('keeps a non-blob current url untouched', () => {
    const current = ref('https://cdn/skin.png')
    const holder = createPreviewBlobHolder({
      getCurrentUrl: (): string => current.value,
      clearCurrentUrl: (): void => {
        current.value = ''
      },
    })

    holder.releaseCurrent()
    expect(revokeObjectURLMock).not.toHaveBeenCalled()
    expect(current.value).toBe('')
  })

  it('revokes every pending url on dispose', () => {
    const holder = createPreviewBlobHolder({
      getCurrentUrl: (): string => '',
    })

    holder.track('blob:a')
    holder.track('blob:b')
    holder.revokePending()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:a')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:b')
  })
})
