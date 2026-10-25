export const randomId = (): string => `re-${crypto.randomUUID()}`

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function joinPath(parent: string, child: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  const trimmed = parent.replace(/[\\/]+$/, '')
  return `${trimmed}${separator}${child}`
}

export function stripPathSuffix(path: string, suffix: string): string {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return path.replace(new RegExp(`[\\\\/]${escaped}$`), '')
}

export function getPathBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function matchesExtension(name: string, accept: readonly string[]): boolean {
  const lowerName = name.toLowerCase()
  return accept.some((token) => {
    const extension = token.trim().replace(/^\./, '').toLowerCase()
    return lowerName.endsWith(`.${extension}`) || lowerName === extension
  })
}
