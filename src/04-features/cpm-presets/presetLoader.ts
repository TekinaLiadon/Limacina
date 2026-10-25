import { parseCpmProjectFile } from '@/04-features/cpm-settings/cpmProjectParser'
import type { CPMAnimEnc, CPMAnimation } from '@/05-entities'
import type { PresetMeta, SkinCompatiblePreset } from './presetTypes'
import { validatePresetConfig, validatePresetMeta, validatePresetPair } from './presetValidator'

export interface ParsedPreset extends SkinCompatiblePreset {
  animations: CPMAnimation[]
  animEnc: CPMAnimEnc | null
}

const INVALID_META_MESSAGE = 'Некорректный meta.json пресета'

export async function parsePresetProject(projectData: Uint8Array, metaData: Uint8Array): Promise<ParsedPreset> {
  const project = await parseCpmProjectFile(projectData, { preset: true })

  let metaJson: unknown
  try {
    metaJson = JSON.parse(new TextDecoder().decode(metaData))
  } catch {
    throw new Error(INVALID_META_MESSAGE)
  }

  const metaErrors = validatePresetMeta(metaJson)
  if (metaErrors.length > 0) throw new Error(`Пресет некорректен: ${metaErrors.join('; ')}`)

  const meta = metaJson as PresetMeta
  const errors = [...validatePresetConfig(project.config), ...validatePresetPair(project.config, meta)]
  if (errors.length > 0) throw new Error(`Пресет некорректен: ${errors.join('; ')}`)

  return { config: project.config, meta, animations: project.animations, animEnc: project.animEnc }
}
