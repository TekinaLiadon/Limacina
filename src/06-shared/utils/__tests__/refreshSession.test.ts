import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionInfo } from '@/06-shared/api'
import { captureProjectScope } from '../captureProjectScope'
import { refreshSession } from '../refreshSession'

const reportError = vi.hoisted(() => vi.fn())

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  getSessionInfo: vi.fn(),
}))

vi.mock('../reportError', () => ({ reportError }))

describe('refreshSession', () => {
  beforeEach(() => {
    vi.mocked(getSessionInfo).mockReset()
    reportError.mockReset()
  })

  it('applies the session for the current project', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ uuid: 'u-1', username: 'alice' })
    const apply = vi.fn()

    await refreshSession(
      captureProjectScope((): string => 'proj'),
      apply,
      'Не удалось проверить сессию',
    )

    expect(apply).toHaveBeenCalledWith({ uuid: 'u-1', username: 'alice' })
  })

  it('skips the apply when there is no session', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null)
    const apply = vi.fn()

    await refreshSession(
      captureProjectScope((): string => 'proj'),
      apply,
      'Не удалось проверить сессию',
    )

    expect(apply).not.toHaveBeenCalled()
  })

  it('skips the apply when the project changed during the read', async () => {
    let currentProject = 'proj'
    vi.mocked(getSessionInfo).mockImplementation(async () => {
      currentProject = 'other'
      return { uuid: 'u-1', username: 'alice' }
    })
    const apply = vi.fn()

    await refreshSession(
      captureProjectScope((): string => currentProject),
      apply,
      'Не удалось проверить сессию',
    )

    expect(apply).not.toHaveBeenCalled()
  })

  it('reports and swallows a failed read', async () => {
    const failure = new Error('ipc down')
    vi.mocked(getSessionInfo).mockRejectedValue(failure)
    const apply = vi.fn()

    await expect(
      refreshSession(
        captureProjectScope((): string => 'proj'),
        apply,
        'Не удалось проверить сессию',
      ),
    ).resolves.toBeUndefined()

    expect(apply).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith('Не удалось проверить сессию', failure)
  })
})
