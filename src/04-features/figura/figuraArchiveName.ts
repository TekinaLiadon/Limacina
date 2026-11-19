export const AVATAR_NAME_MAX_CHARS: number = 64

const RESERVED_NAME_CHARS: readonly string[] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']

const ZIP_SUFFIX = /\.zip$/i

export function avatarNameFromArchive(fileName: string): string {
  const baseName = (fileName.split(/[\\/]/).pop() ?? fileName).trim()
  return baseName.replace(ZIP_SUFFIX, '').trim()
}

export function avatarNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    return 'Пустое имя аватара из архива. Переименуйте архив и повторите загрузку'
  }
  if (RESERVED_NAME_CHARS.some((char) => trimmed.includes(char))) {
    return `Некорректное имя аватара из архива: «${trimmed}». Переименуйте архив и повторите загрузку`
  }
  if (trimmed.length > AVATAR_NAME_MAX_CHARS) {
    return `Имя аватара из архива длиннее ${AVATAR_NAME_MAX_CHARS} символов. Переименуйте архив и повторите загрузку`
  }
  return null
}
