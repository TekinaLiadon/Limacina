import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { createBackoffPoller } from './createBackoffPoller'

const OK_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 8_000

interface HarnessOptions {
  failureThreshold?: number
}

interface Harness {
  project: Ref<string | null>
  fetch: Mock<(name: string) => Promise<string>>
  applySuccess: Mock<(result: string) => void>
  applyError: Mock<() => void>
  applyIdle: Mock<() => void>
  onFailureStreak: Mock<() => void>
  state: { shouldPollFlag: boolean }
}

const flushJobs = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

function setupHarness(options: HarnessOptions = {}): Harness {
  const project = ref<string | null>(null)
  const fetch = vi.fn<(name: string) => Promise<string>>()
  const applySuccess = vi.fn<(result: string) => void>()
  const applyError = vi.fn<() => void>()
  const applyIdle = vi.fn<() => void>()
  const onFailureStreak = vi.fn<() => void>()
  const state = { shouldPollFlag: true }

  const config: Parameters<typeof createBackoffPoller<string>>[0] = {
    okIntervalMs: OK_INTERVAL_MS,
    maxIntervalMs: MAX_INTERVAL_MS,
    watchSource: () => project.value,
    isWatched: () => project.value !== null,
    shouldPoll: () => state.shouldPollFlag,
    fetch: () => fetch(project.value ?? ''),
    applySuccess,
    applyError,
    applyIdle,
    onFailureStreak,
  }
  if (options.failureThreshold !== undefined) config.failureThreshold = options.failureThreshold
  const poller = createBackoffPoller<string>(config)
  poller.startSync()

  return { project, fetch, applySuccess, applyError, applyIdle, onFailureStreak, state }
}

describe('createBackoffPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls immediately when a watched value appears', async () => {
    const harness = setupHarness()
    harness.fetch.mockResolvedValue('ok')

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.applySuccess).toHaveBeenCalledWith('ok')
    expect(harness.applyError).not.toHaveBeenCalled()
  })

  it('polls immediately when the watched value is already set at startSync', async () => {
    const project = ref<string | null>('proj')
    const fetch = vi.fn<(name: string) => Promise<string>>()
    const applySuccess = vi.fn<(result: string) => void>()
    const applyIdle = vi.fn<() => void>()
    fetch.mockResolvedValue('ok')

    createBackoffPoller<string>({
      okIntervalMs: OK_INTERVAL_MS,
      maxIntervalMs: MAX_INTERVAL_MS,
      watchSource: () => project.value,
      isWatched: () => project.value !== null,
      fetch: () => fetch(project.value ?? ''),
      applySuccess,
      applyIdle,
    }).startSync()
    await flushJobs()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(applySuccess).toHaveBeenCalledWith('ok')
    expect(applyIdle).not.toHaveBeenCalled()

    project.value = 'proj-2'
    await nextTick()
    await flushJobs()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('applies idle once when the watched value is unset at startSync', async () => {
    const project = ref<string | null>(null)
    const fetch = vi.fn<(name: string) => Promise<string>>()
    const applyIdle = vi.fn<() => void>()

    createBackoffPoller<string>({
      okIntervalMs: OK_INTERVAL_MS,
      maxIntervalMs: MAX_INTERVAL_MS,
      watchSource: () => project.value,
      isWatched: () => project.value !== null,
      fetch: () => fetch(project.value ?? ''),
      applySuccess: vi.fn<() => void>(),
      applyIdle,
    }).startSync()
    await flushJobs()

    expect(applyIdle).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops the pending chain and applies idle when the value stops being watched', async () => {
    const harness = setupHarness()
    harness.fetch.mockResolvedValue('ok')

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    harness.project.value = null
    await nextTick()
    await flushJobs()
    expect(harness.applyIdle).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(MAX_INTERVAL_MS * 2)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('doubles the delay after consecutive failures up to the cap', async () => {
    const harness = setupHarness()
    harness.fetch.mockRejectedValue(new Error('down'))

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2 - 1)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 4 - 1)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetch).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 8 - 1)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetch).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 8)
    expect(harness.fetch).toHaveBeenCalledTimes(5)
  })

  it('resets the backoff after a success', async () => {
    const harness = setupHarness()
    harness.fetch.mockRejectedValueOnce(new Error('down'))
    harness.fetch.mockResolvedValue('ok')

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(harness.fetch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS - 1)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
  })

  it('applies errors and keeps polling after failures', async () => {
    const harness = setupHarness()
    harness.fetch.mockRejectedValue(new Error('down'))

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()

    expect(harness.applyError).toHaveBeenCalledTimes(1)
    expect(harness.applySuccess).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(harness.applyError).toHaveBeenCalledTimes(2)
  })

  it('passes the fetch failure to applyError', async () => {
    const harness = setupHarness()
    const cause = new Error('dns down')
    harness.fetch.mockRejectedValue(cause)

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()

    expect(harness.applyError).toHaveBeenCalledWith(cause)
  })

  it('fires the failure streak callback once per threshold crossing', async () => {
    const harness = setupHarness({ failureThreshold: 3 })
    harness.fetch.mockRejectedValue(new Error('down'))

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    expect(harness.onFailureStreak).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 2)
    expect(harness.onFailureStreak).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(OK_INTERVAL_MS * 4)
    expect(harness.onFailureStreak).toHaveBeenCalledTimes(1)
  })

  it('does not fire the streak callback without a threshold', async () => {
    const harness = setupHarness()
    harness.fetch.mockRejectedValue(new Error('down'))

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    await vi.advanceTimersByTimeAsync(MAX_INTERVAL_MS * 3)

    expect(harness.onFailureStreak).not.toHaveBeenCalled()
  })

  it('discards a stale in-flight result after a watched switch', async () => {
    const harness = setupHarness()
    let resolveFirst: (value: string) => void = () => {}
    harness.fetch.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve
        }),
    )
    harness.fetch.mockResolvedValue('ok-b')

    harness.project.value = 'proj-a'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    harness.project.value = 'proj-b'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(2)

    resolveFirst('stale-a')
    await flushJobs()

    expect(harness.applySuccess).toHaveBeenCalledTimes(1)
    expect(harness.applySuccess).toHaveBeenCalledWith('ok-b')
  })

  it('skips cycles while shouldPoll returns false and resumes afterwards', async () => {
    const harness = setupHarness()
    harness.state.shouldPollFlag = false
    harness.fetch.mockResolvedValue('ok')

    harness.project.value = 'proj'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).not.toHaveBeenCalled()

    harness.project.value = 'proj-2'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).not.toHaveBeenCalled()

    harness.state.shouldPollFlag = true
    harness.project.value = 'proj-3'
    await nextTick()
    await flushJobs()
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.applySuccess).toHaveBeenCalledWith('ok')
  })
})
