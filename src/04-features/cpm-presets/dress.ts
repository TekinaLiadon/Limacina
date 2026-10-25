import type { CPMConfig, SkinModelMode } from '@/05-entities'
import type { PresetSkinType } from './presetTypes'
import { encodePngSkin, type SkinImage } from './skinPng'

export interface DressedModel {
  config: CPMConfig
  skinPng: Uint8Array
}

export function presetSkinTypeWarning(skinType: PresetSkinType, mode: SkinModelMode): string | null {
  if (skinType === 'both') return null
  if ((skinType === 'slim') === (mode === 'slim')) return null
  return `Пресет рассчитан на ${skinType}-модель, а выбран ${mode}-скин: руки могут отображаться неточно`
}

export async function compose(config: CPMConfig, skin: SkinImage, mode: SkinModelMode): Promise<DressedModel> {
  const skinPng = await encodePngSkin(skin)
  return {
    config: { ...config, skinType: mode === 'slim' ? 'slim' : 'default' },
    skinPng,
  }
}
