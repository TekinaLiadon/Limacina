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
