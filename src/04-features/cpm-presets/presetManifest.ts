import { isRecord } from '@/04-features/cpm-convert/cpmProjectZip'
import type { PresetSkinType } from './presetTypes'
import { validatePresetMeta } from './presetValidator'

export const PRESET_MANIFEST_VERSION = 1

export interface PresetManifestEntry {
  slug: string
  name: string
  skinType: PresetSkinType
  hash: string
  projectUrl: string
  metaUrl: string
  previewUrl: string | null
}

export interface PresetManifest {
  version: number
  presets: PresetManifestEntry[]
}

const INVALID_MANIFEST_MESSAGE = 'Некорректный манифест каталога пресетов'
const REQUIRED_URL_FIELDS = ['hash', 'projectUrl', 'metaUrl'] as const

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

export function parsePresetManifest(value: unknown): PresetManifest {
  if (!isRecord(value)) throw new Error(`${INVALID_MANIFEST_MESSAGE}: ожидается объект`)
  if (value.version !== PRESET_MANIFEST_VERSION) {
    throw new Error(
      `${INVALID_MANIFEST_MESSAGE}: неподдерживаемая версия ${String(value.version)}, ожидается ${PRESET_MANIFEST_VERSION}`
    )
  }
  if (!Array.isArray(value.presets)) {
    throw new Error(`${INVALID_MANIFEST_MESSAGE}: presets должен быть массивом`)
  }

  const seenSlugs = new Set<string>()
  const presets: PresetManifestEntry[] = []
  value.presets.forEach((raw: unknown, index: number): void => {
    const label = `пресет №${index + 1} манифеста`

    const metaErrors = validatePresetMeta(raw)
    if (metaErrors.length > 0) throw new Error(`${INVALID_MANIFEST_MESSAGE}: ${label}: ${metaErrors.join('; ')}`)

    const record = raw as Record<string, unknown>
    for (const field of REQUIRED_URL_FIELDS) {
      if (!isNonEmptyString(record[field])) {
        throw new Error(`${INVALID_MANIFEST_MESSAGE}: ${label}: ${field} должен быть непустой строкой`)
      }
    }
    const previewUrl = record.previewUrl ?? null
    if (previewUrl !== null && !isNonEmptyString(previewUrl)) {
      throw new Error(`${INVALID_MANIFEST_MESSAGE}: ${label}: previewUrl должен быть непустой строкой или null`)
    }

    const slug = record.slug as string
    if (seenSlugs.has(slug)) {
      throw new Error(`${INVALID_MANIFEST_MESSAGE}: ${label}: дублирующийся slug "${slug}"`)
    }
    seenSlugs.add(slug)

    presets.push({
      slug,
      name: record.name as string,
      skinType: record.skinType as PresetSkinType,
      hash: record.hash as string,
      projectUrl: record.projectUrl as string,
      metaUrl: record.metaUrl as string,
      previewUrl,
    })
  })

  return { version: PRESET_MANIFEST_VERSION, presets }
}
