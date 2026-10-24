import type { CPMConfig } from '@/05-entities'

export const LOGICAL_ATLAS_SIZE = 64
export const MIN_SKIN_SCALE = 1
export const MAX_SKIN_SCALE = 127
export const MAX_SKIN_PIXELS = 2048 * 2048
export const MAX_CUBE_SIZE = 25.5
export const MIN_TEXTURE_SIZE = -128
export const MAX_TEXTURE_SIZE = 127

export type PresetSkinType = 'slim' | 'classic' | 'both'

export interface PresetAuxRegion {
  name: string
  sx: number
  sy: number
  ex: number
  ey: number
}

export interface PresetMeta {
  name: string
  slug: string
  skinType: PresetSkinType
  auxRegions?: PresetAuxRegion[]
  previewSkin?: string
}

export interface SkinCompatiblePreset {
  config: CPMConfig
  meta: PresetMeta
}
