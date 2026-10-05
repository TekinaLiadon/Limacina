import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { changePassword, getSessionInfo } from '@/06-shared/api'
import {
  useCoreStore,
  useNotificationStore,
  type ProjectConfig,
  type SessionInfo,
} from '@/05-entities'
import { useAccountSettings } from './useAccountSettings'

vi.mock('@/06-shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/06-shared/api')>()),
  changePassword: vi.fn(),
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

const makeSession = (username: string): SessionInfo => ({ uuid: 'u-1', username })

const fillForm = (settings: ReturnType<typeof useAccountSettings>): void => {
  settings.oldPassword.value = 'oldpassword'
  settings.newPassword.value = 'newpassword'
  settings.confirmPassword.value = 'newpassword'
}

describe('useAccountSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(changePassword).mockReset()
    vi.mocked(getSessionInfo).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives the username and the offline flag from the stores', () => {
    const core = useCoreStore()
    core.session = makeSession('alice')
    core.projectConfig = makeProjectConfig(false)
    const settings = useAccountSettings()

    expect(settings.username.value).toBe('alice')
    expect(settings.isOffline.value).toBe(true)
  })

  it('disables the submit for an offline project even with a valid form', () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(false)
    const settings = useAccountSettings()
    settings.oldPassword.value = 'oldpassword'
    settings.newPassword.value = 'newpassword'
    settings.confirmPassword.value = 'newpassword'

    expect(settings.isFormValid.value).toBe(true)
    expect(settings.isSubmitDisabled.value).toBe(true)
  })

  it('enables the submit for an online project only with a valid form', () => {
    const core = useCoreStore()
    core.projectConfig = makeProjectConfig(true)
    const settings = useAccountSettings()

    expect(settings.isSubmitDisabled.value).toBe(true)

    settings.oldPassword.value = 'oldpassword'
    settings.newPassword.value = 'newpassword'
    settings.confirmPassword.value = 'newpassword'

    expect(settings.isSubmitDisabled.value).toBe(false)
  })

  it('treats an empty confirmation as matching', () => {
    const settings = useAccountSettings()
    settings.newPassword.value = 'newpassword'

    expect(settings.passwordsMatch.value).toBe(true)

    settings.confirmPassword.value = 'different'
    expect(settings.passwordsMatch.value).toBe(false)
  })

  it('rejects a new password equal to the old one', () => {
    const settings = useAccountSettings()
    settings.oldPassword.value = 'samepassword'
    settings.newPassword.value = 'samepassword'

    expect(settings.isSamePassword.value).toBe(true)
    expect(settings.isFormValid.value).toBe(false)
  })

  it('requires both passwords to reach the minimum length', () => {
    const settings = useAccountSettings()
    settings.oldPassword.value = 'short'
    settings.newPassword.value = 'short'
    settings.confirmPassword.value = 'short'

    expect(settings.isFormValid.value).toBe(false)

    settings.oldPassword.value = 'oldpassword'
    settings.newPassword.value = 'newpassword'
    expect(settings.isFormValid.value).toBe(false)

    settings.confirmPassword.value = 'newpassword'
    expect(settings.isFormValid.value).toBe(true)
  })

  it('does not submit an invalid form', async () => {
    const settings = useAccountSettings()

    await settings.handleChangePassword()

    expect(changePassword).not.toHaveBeenCalled()
  })

  it('changes the password, refreshes the session and resets the form', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.session = makeSession('alice')
    vi.mocked(changePassword).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockResolvedValue(makeSession('alice'))
    const settings = useAccountSettings()
    fillForm(settings)

    await settings.handleChangePassword()

    expect(changePassword).toHaveBeenCalledWith('proj', 'oldpassword', 'newpassword')
    expect(core.session).toEqual(makeSession('alice'))
    expect(core.isLoggedIn).toBe(true)
    expect(useNotificationStore().message).toBe('Пароль изменён')
    expect(settings.oldPassword.value).toBe('')
    expect(settings.newPassword.value).toBe('')
    expect(settings.confirmPassword.value).toBe('')
    expect(settings.isChanging.value).toBe(false)
  })

  it('surfaces the change error and skips the session refresh', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    vi.mocked(changePassword).mockRejectedValue(new Error('wrong old password'))
    const settings = useAccountSettings()
    fillForm(settings)

    await settings.handleChangePassword()

    expect(settings.errorMessage.value).toBe('wrong old password')
    expect(getSessionInfo).not.toHaveBeenCalled()
    expect(settings.isChanging.value).toBe(false)
  })

  it('still notifies when the session refresh fails after the change', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.session = makeSession('alice')
    vi.mocked(changePassword).mockResolvedValue(undefined)
    vi.mocked(getSessionInfo).mockRejectedValue(new Error('ipc down'))
    const settings = useAccountSettings()
    fillForm(settings)

    await settings.handleChangePassword()

    expect(useNotificationStore().message).toBe('Пароль изменён')
    expect(settings.oldPassword.value).toBe('')
    expect(core.session).toEqual(makeSession('alice'))
  })

  it('skips the session refresh and the toast when the project changed during the change', async () => {
    const core = useCoreStore()
    core.currentProject = 'proj'
    core.session = makeSession('alice')
    vi.mocked(changePassword).mockImplementation(async () => {
      core.currentProject = 'other'
    })
    const settings = useAccountSettings()
    fillForm(settings)

    await settings.handleChangePassword()

    expect(getSessionInfo).not.toHaveBeenCalled()
    expect(useNotificationStore().message).toBe('')
    expect(settings.isChanging.value).toBe(false)
  })
})
