import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authLogin, authLogins, getSessionInfo } from '@/06-shared/api'
import { useAuth } from '../useAuth'
import { useOfflineLogin } from '../useOfflineLogin'
import { withSetup } from '@/test-support/withSetup'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
} from '@/05-entities'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogin: vi.fn(),
  authLogins: vi.fn(),
  getSessionInfo: vi.fn(),
}))

const makeProjectConfig = (online: boolean): ProjectConfig => ({
  projectName: 'proj',
  mcVersion: '1.20.1',
  modLoader: 'vanilla',
  loaderVersion: null,
  javaPath: null,
  javaVersion: null,
  jvmArgs: [],
  minMemory: '512',
  maxMemory: '4096',
  online,
  initialized: true,
  serverUrl: null,
  autoJoinServer: false,
})

describe('useOfflineLogin', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(authLogin).mockReset()
    vi.mocked(authLogins).mockReset()
    vi.mocked(getSessionInfo).mockReset()
    vi.mocked(authLogins).mockResolvedValue([])
    vi.mocked(getSessionInfo).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setupAuth = (): { unmount: () => void; offline: ReturnType<typeof useOfflineLogin> } => {
    const { result, unmount } = withSetup(() => {
      const auth = useAuth()
      const offline = useOfflineLogin({ isLoginValid: auth.isLoginValid, submitLogin: auth.submitLogin })
      return offline
    })
    return { unmount, offline: result }
  }

  it('does not require a password for an offline project', () => {
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = 'user'
    const { offline, unmount } = setupAuth()

    expect(offline.isOffline.value).toBe(true)
    expect(offline.isLoginValid.value).toBe(true)
    unmount()
  })

  it('validates the offline login by its trimmed length', () => {
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = '  ab  '
    const { offline, unmount } = setupAuth()

    expect(offline.isLoginValid.value).toBe(false)

    useAccountsStore().loginFormData.username = '  user  '
    expect(offline.isLoginValid.value).toBe(true)
    unmount()
  })

  it('requires a project for the offline login', () => {
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = 'user'
    const { offline, unmount } = setupAuth()

    expect(offline.isLoginValid.value).toBe(false)
    unmount()
  })

  it('falls back to the server validation for an online project', () => {
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(true)
    useAccountsStore().loginFormData.username = 'user'
    const { offline, unmount } = setupAuth()

    expect(offline.isOffline.value).toBe(false)
    expect(offline.isLoginValid.value).toBe(false)

    useAccountsStore().loginFormData.password = 'password'
    expect(offline.isLoginValid.value).toBe(true)
    unmount()
  })

  it('does not submit an invalid offline login', async () => {
    useCoreStore().projectConfig = makeProjectConfig(false)
    const { offline, unmount } = setupAuth()

    await offline.handleLogin()

    expect(authLogin).not.toHaveBeenCalled()
    unmount()
  })

  it('logs in without a password for an offline project', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ uuid: 'u-1', username: 'user' })
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = 'user'
    const { offline, unmount } = setupAuth()

    await offline.handleLogin()

    expect(authLogin).toHaveBeenCalledWith('proj', 'user', '', false)
    expect(useAccountsStore().showAuthForm).toBe(false)
    expect(useNotificationStore().message).toBe('Авторизация прошла успешно')
    unmount()
  })

  it('trims the nickname before an offline login', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null)
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = '  user  '
    const { offline, unmount } = setupAuth()

    await offline.handleLogin()

    expect(authLogin).toHaveBeenCalledWith('proj', 'user', '', false)
    unmount()
  })
})
