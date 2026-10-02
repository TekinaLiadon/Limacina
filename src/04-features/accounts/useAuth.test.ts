import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { authLogin, authLogins, authRegister, getSessionInfo } from '@/06-shared/api'
import { useAuth } from './useAuth'
import { withSetup } from '@/test-support/withSetup'
import {
  useAccountsStore,
  useCoreStore,
  useNotificationStore,
  MIN_LOGIN_LENGTH,
  MIN_PASSWORD_LENGTH,
  type ProjectConfig,
} from '@/05-entities'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
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
  legacy: false,
  legacyProfile: null,
})

const setupAuth = () => {
  const { result, unmount } = withSetup(() => useAuth())
  return { auth: result, unmount }
}

const fillLoginForm = (): void => {
  useCoreStore().currentProject = 'proj'
  useAccountsStore().loginFormData = {
    username: 'user',
    password: 'password',
    rememberMe: true,
  }
}

describe('useAuth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires a project, a login and a password for an online project', () => {
    const { auth, unmount } = setupAuth()
    expect(auth.isLoginValid.value).toBe(false)

    useCoreStore().currentProject = 'proj'
    expect(auth.isLoginValid.value).toBe(false)

    useAccountsStore().loginFormData.username = 'user'
    expect(auth.isLoginValid.value).toBe(false)

    useAccountsStore().loginFormData.password = 'password'
    expect(auth.isLoginValid.value).toBe(true)
    unmount()
  })

  it('does not require a password for an offline project', () => {
    useCoreStore().currentProject = 'proj'
    useCoreStore().projectConfig = makeProjectConfig(false)
    useAccountsStore().loginFormData.username = 'user'
    const { auth, unmount } = setupAuth()
    expect(auth.isOffline.value).toBe(true)
    expect(auth.isLoginValid.value).toBe(true)
    unmount()
  })

  it('requires matching filled passwords for registration', () => {
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    const { auth, unmount } = setupAuth()

    store.registerFormData = { login: 'user', password: 'password', confirmPassword: '' }
    expect(auth.isRegisterValid.value).toBe(false)

    store.registerFormData.confirmPassword = 'mismatch'
    expect(auth.isRegisterValid.value).toBe(false)
    expect(auth.passwordsMatch.value).toBe(false)

    store.registerFormData.confirmPassword = 'password'
    expect(auth.isRegisterValid.value).toBe(true)
    expect(auth.passwordsMatch.value).toBe(true)
    unmount()
  })

  it('explains the login requirement while the registration login is too short', () => {
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    const { auth, unmount } = setupAuth()

    expect(auth.registerLoginHint.value).toBeNull()

    store.registerFormData.login = 'abc'
    expect(auth.registerLoginHint.value).toBe(`Логин — минимум ${MIN_LOGIN_LENGTH} символа`)
    expect(auth.registerLoginHint.value).toContain(String(MIN_LOGIN_LENGTH))

    store.registerFormData.login = 'user'
    expect(auth.registerLoginHint.value).toBeNull()
    unmount()
  })

  it('explains the password requirement while the registration password is too short', () => {
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    const { auth, unmount } = setupAuth()

    expect(auth.registerPasswordHint.value).toBeNull()

    store.registerFormData.password = 'pas'
    expect(auth.registerPasswordHint.value).toBe(`Пароль — минимум ${MIN_PASSWORD_LENGTH} символов`)
    expect(auth.registerPasswordHint.value).toContain(String(MIN_PASSWORD_LENGTH))

    store.registerFormData.password = 'password'
    expect(auth.registerPasswordHint.value).toBeNull()
    unmount()
  })

  it('prefills the login from saved accounts on mount', () => {
    const store = useAccountsStore()
    store.logins = ['alice', 'bob']
    const { unmount } = setupAuth()
    expect(store.loginFormData.username).toBe('alice')
    unmount()
  })

  it('does not overwrite a typed username on mount', () => {
    const store = useAccountsStore()
    store.logins = ['alice']
    store.loginFormData.username = 'carol'
    const { unmount } = setupAuth()
    expect(store.loginFormData.username).toBe('carol')
    unmount()
  })

  it('skips the prefill for an already logged in user', () => {
    const coreStore = useCoreStore()
    coreStore.isLoggedIn = true
    const store = useAccountsStore()
    store.logins = ['alice']
    const { unmount } = setupAuth()
    expect(store.loginFormData.username).toBe('')
    unmount()
  })

  it('logs in, hydrates the session and closes the form', async () => {
    fillLoginForm()
    vi.mocked(getSessionInfo).mockResolvedValue({ uuid: 'u-1', username: 'user' })
    vi.mocked(authLogins).mockResolvedValue(['user'])
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()

    expect(authLogin).toHaveBeenCalledWith({
      projectName: 'proj',
      username: 'user',
      password: 'password',
      rememberMe: true,
    })
    const coreStore = useCoreStore()
    expect(coreStore.session).toEqual({ uuid: 'u-1', username: 'user' })
    expect(coreStore.isLoggedIn).toBe(true)
    expect(useAccountsStore().showAuthForm).toBe(false)
    expect(useNotificationStore().message).toBe('Авторизация прошла успешно')
    expect(auth.isLoading.value).toBe(false)
    expect(auth.errorMessage.value).toBe('')
    unmount()
  })

  it('completes the flow when the session command returns null', async () => {
    fillLoginForm()
    vi.mocked(getSessionInfo).mockResolvedValue(null)
    vi.mocked(authLogins).mockResolvedValue([])
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()

    expect(useCoreStore().isLoggedIn).toBe(false)
    expect(useAccountsStore().showAuthForm).toBe(false)
    unmount()
  })

  it('does not keep the password in the store after a successful login', async () => {
    fillLoginForm()
    vi.mocked(getSessionInfo).mockResolvedValue({ uuid: 'u-1', username: 'user' })
    vi.mocked(authLogins).mockResolvedValue(['user'])
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()

    const store = useAccountsStore()
    expect(store.showAuthForm).toBe(false)
    expect(store.loginFormData.password).toBe('')
    expect(store.loginFormData.username).toBe('user')
    unmount()
  })

  it('keeps the password for a retry when the login fails', async () => {
    fillLoginForm()
    useAccountsStore().showAuthForm = true
    vi.mocked(authLogin).mockRejectedValue({ code: 'bad_credentials', message: 'Неверный пароль' })
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()

    expect(useAccountsStore().loginFormData.password).toBe('password')
    unmount()
  })

  it('surfaces the command error and keeps the form open on login failure', async () => {
    fillLoginForm()
    useAccountsStore().showAuthForm = true
    vi.mocked(authLogin).mockRejectedValue({ code: 'bad_credentials', message: 'Неверный пароль' })
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()

    expect(auth.errorMessage.value).toBe('Неверный пароль')
    expect(auth.isLoading.value).toBe(false)
    expect(useCoreStore().isLoggedIn).toBe(false)
    expect(useAccountsStore().showAuthForm).toBe(true)
    unmount()
  })

  it('clears the auth error through clearError', async () => {
    fillLoginForm()
    useAccountsStore().showAuthForm = true
    vi.mocked(authLogin).mockRejectedValue({ code: 'bad_credentials', message: 'Неверный пароль' })
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()
    expect(auth.errorMessage.value).toBe('Неверный пароль')

    auth.clearError()

    expect(auth.errorMessage.value).toBe('')
    unmount()
  })

  it('does not submit an invalid or already running login', async () => {
    const { auth, unmount } = setupAuth()

    await auth.handleLogin()
    expect(authLogin).not.toHaveBeenCalled()

    fillLoginForm()
    let releaseLogin: () => void = () => {}
    vi.mocked(authLogin).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseLogin = resolve
        }),
    )
    const first = auth.handleLogin()
    await auth.handleLogin()
    expect(authLogin).toHaveBeenCalledTimes(1)

    releaseLogin()
    await first
    unmount()
  })

  it('registers, resets the form and switches to the login tab', async () => {
    useCoreStore().currentProject = 'proj'
    useAccountsStore().registerFormData = {
      login: 'user',
      password: 'password',
      confirmPassword: 'password',
    }
    vi.mocked(authLogins).mockResolvedValue([])
    const { auth, unmount } = setupAuth()

    await auth.handleRegister()

    expect(authRegister).toHaveBeenCalledWith('proj', 'user', 'password')
    const store = useAccountsStore()
    expect(store.registerFormData).toEqual({ login: '', password: '', confirmPassword: '' })
    expect(store.showAuthForm).toBe(false)
    expect(store.activeSubTab).toBe('login')
    expect(useNotificationStore().message).toContain('Аккаунт успешно создан')
    expect(auth.isLoading.value).toBe(false)
    unmount()
  })

  it('surfaces the registration error and keeps the form', async () => {
    useCoreStore().currentProject = 'proj'
    const store = useAccountsStore()
    store.showAuthForm = true
    store.registerFormData = {
      login: 'user',
      password: 'password',
      confirmPassword: 'password',
    }
    vi.mocked(authRegister).mockRejectedValue(new Error('login taken'))
    const { auth, unmount } = setupAuth()

    await auth.handleRegister()

    expect(auth.errorMessage.value).toBe('login taken')
    expect(store.registerFormData.login).toBe('user')
    expect(store.showAuthForm).toBe(true)
    unmount()
  })

  it('does not submit an invalid registration', async () => {
    const { auth, unmount } = setupAuth()
    await auth.handleRegister()
    expect(authRegister).not.toHaveBeenCalled()
    unmount()
  })
})
