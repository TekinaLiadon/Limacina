import { ref, type Ref } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { captureProjectScope, getErrorMessage, reportError } from '@/06-shared'
import { getCommandError, installFiguraAvatar, readFiguraArchive } from '@/06-shared/api'
import { useUserContentFile } from '../user-content/useUserContentFile'
import { avatarNameError, avatarNameFromArchive } from './figuraArchiveName'

const ARCHIVE_ACCEPT = '.zip'
const ARCHIVE_EXTENSIONS: string[] = ['zip']
export const FIGURA_ARCHIVE_MAX_BYTES: number = 64 * 1024 * 1024
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
const ZIP_EMPTY_SIGNATURE = [0x50, 0x4b, 0x05, 0x06]

const AVATAR_EXISTS_CODE = 'figura_avatar_exists'
const INSTALL_ERROR = 'Не удалось установить аватар Figura'
const PROJECT_MISSING = 'Выберите проект, чтобы установить аватар'
const NOT_ZIP = 'Выбранный файл не является ZIP-архивом'

const existsConfirm = (name: string): string =>
  `Аватар Figura «${name}» уже существует. Заменить его?`

const installedToast = (name: string): string => `Аватар Figura «${name}» установлен`

export interface FiguraAvatarUploadOptions {
  onInstalled: (name: string) => void
}

export interface FiguraAvatarUploadApi {
  isInstalling: Ref<boolean>
  isDragOver: Ref<boolean>
  installError: Ref<string>
  openArchiveDialog: () => void
  loadFromPath: (path: string) => Promise<void>
}

function hasZipSignature(bytes: Uint8Array): boolean {
  const matches = (signature: number[]): boolean =>
    signature.every((value, index) => bytes[index] === value)
  return matches(ZIP_SIGNATURE) || matches(ZIP_EMPTY_SIGNATURE)
}

export function useFiguraAvatarUpload(options: FiguraAvatarUploadOptions): FiguraAvatarUploadApi {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const isInstalling = ref<boolean>(false)
  const installError = ref<string>('')

  const install = async (name: string, bytes: Uint8Array): Promise<void> => {
    const project = coreStore.currentProject
    if (!project) {
      installError.value = PROJECT_MISSING
      return
    }
    const scope = captureProjectScope((): string => coreStore.currentProject)
    const failure = avatarNameError(name)
    if (failure !== null) {
      installError.value = failure
      return
    }

    isInstalling.value = true
    installError.value = ''
    try {
      try {
        await installFiguraAvatar(project, name, false, bytes)
      } catch (e: unknown) {
        if (getCommandError(e).code !== AVATAR_EXISTS_CODE) throw e
        const confirmed = await notification.confirm(existsConfirm(name))
        if (!confirmed) return
        await installFiguraAvatar(project, name, true, bytes)
      }
      if (!scope.isCurrent()) return
      notification.show(installedToast(name))
      options.onInstalled(name)
    } catch (e: unknown) {
      if (!scope.isCurrent()) return
      reportError(INSTALL_ERROR, e)
      installError.value = getErrorMessage(e)
    } finally {
      isInstalling.value = false
    }
  }

  const processFile = async (bytes: Uint8Array, fileName: string): Promise<void> => {
    await install(avatarNameFromArchive(fileName), bytes)
  }

  const { isDragOver, openFileDialog, loadFromPath } = useUserContentFile({
    accept: ARCHIVE_ACCEPT,
    extensions: ARCHIVE_EXTENSIONS,
    maxBytes: FIGURA_ARCHIVE_MAX_BYTES,
    readFile: readFiguraArchive,
    validateBytes: (bytes: Uint8Array): string | null =>
      hasZipSignature(bytes) ? null : NOT_ZIP,
    processFile,
    errorMessage: installError,
  })

  const openArchiveDialog = (): void => {
    if (isInstalling.value) return
    openFileDialog()
  }

  return {
    isInstalling,
    isDragOver,
    installError,
    openArchiveDialog,
    loadFromPath,
  }
}
