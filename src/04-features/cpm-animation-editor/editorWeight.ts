import { cpmProjectToBytes, type CpmAnimationSource } from '../cpm-convert/cpmProjectExporter'

export const CPM_PROJECT_SAVE_MAX_BYTES = 20 * 1024 * 1024

export interface CpmProjectWeight {
  bytes: number
  limitBytes: number
  exceedsLimit: boolean
  warning: string | null
}

export function evaluateCpmProjectWeight(
  bytes: number,
  limitBytes: number = CPM_PROJECT_SAVE_MAX_BYTES,
): CpmProjectWeight {
  const exceedsLimit = bytes > limitBytes
  const limitMb = Math.max(1, Math.round(limitBytes / (1024 * 1024)))
  return {
    bytes,
    limitBytes,
    exceedsLimit,
    warning: exceedsLimit ? `Вес проекта превышает предел ${limitMb} МБ` : null,
  }
}

export function formatProjectWeight(weight: CpmProjectWeight): string {
  const limitMb = Math.max(1, Math.round(weight.limitBytes / (1024 * 1024)))
  if (weight.bytes < 1024 * 1024) {
    const kb = Math.max(1, Math.round(weight.bytes / 1024))
    return `${kb} КБ из ${limitMb} МБ`
  }
  return `${(weight.bytes / (1024 * 1024)).toFixed(1)} МБ из ${limitMb} МБ`
}

export async function measureCpmProjectWeight(
  originalBytes: Uint8Array,
  source: CpmAnimationSource,
): Promise<CpmProjectWeight> {
  const bytes = await cpmProjectToBytes(originalBytes, source)
  return evaluateCpmProjectWeight(bytes.byteLength)
}
