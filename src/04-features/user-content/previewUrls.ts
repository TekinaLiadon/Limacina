import { type Ref } from 'vue'
import { getErrorMessage, reportError, type AsyncRaceGuard } from '@/06-shared'

export interface PreviewLoadSpec {
  generation: number
  guard: AsyncRaceGuard
  fetchBytes: () => Promise<Uint8Array | null>
  createUrl: (bytes: Uint8Array) => Promise<string>
  adopt: (url: string) => void
  discard: (url: string) => void
  errorTarget: Ref<string>
  reportMessage: string
  beforeAdopt?: (bytes: Uint8Array) => Promise<void>
}

export async function runPreviewLoad(spec: PreviewLoadSpec): Promise<void> {
  let url: string | null = null
  try {
    const bytes = await spec.fetchBytes()
    if (bytes === null) return
    if (!spec.guard.isCurrent(spec.generation)) return
    url = await spec.createUrl(bytes)
    if (!spec.guard.isCurrent(spec.generation)) {
      spec.discard(url)
      url = null
      return
    }
    if (spec.beforeAdopt !== undefined) {
      await spec.beforeAdopt(bytes)
      if (!spec.guard.isCurrent(spec.generation)) {
        spec.discard(url)
        url = null
        return
      }
    }
    spec.adopt(url)
  } catch (e: unknown) {
    if (url !== null) spec.discard(url)
    if (!spec.guard.isCurrent(spec.generation)) return
    spec.errorTarget.value = getErrorMessage(e)
    reportError(spec.reportMessage, e)
  }
}

export interface PreviewBlobHolderOptions {
  getCurrentUrl: () => string | null | undefined
  applyCurrentUrl?: ((url: string) => void) | undefined
  clearCurrentUrl?: (() => void) | undefined
}

export interface PreviewBlobHolder {
  track: (url: string) => void
  adopt: (url: string) => void
  discard: (url: string) => void
  releaseCurrent: () => void
  revokePending: () => void
}

export function createPreviewBlobHolder(options: PreviewBlobHolderOptions): PreviewBlobHolder {
  const pending = new Set<string>()
  const revokeUrl = (url: string): void => {
    URL.revokeObjectURL(url)
    pending.delete(url)
  }
  const revokeCurrent = (): void => {
    const current = options.getCurrentUrl()
    if (current !== null && current !== undefined && current.startsWith('blob:')) revokeUrl(current)
  }
  return {
    track: (url: string): void => {
      pending.add(url)
    },
    adopt: (url: string): void => {
      pending.delete(url)
      revokeCurrent()
      options.applyCurrentUrl?.(url)
    },
    discard: revokeUrl,
    releaseCurrent: (): void => {
      revokeCurrent()
      options.clearCurrentUrl?.()
    },
    revokePending: (): void => {
      for (const url of pending) URL.revokeObjectURL(url)
      pending.clear()
    },
  }
}
