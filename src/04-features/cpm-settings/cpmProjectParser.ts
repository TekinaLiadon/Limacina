import { parseCpmAnimEnc, parseCpmAnimations } from './cpmAnimationParser'
import { readCpmProjectZip } from '../cpm-convert/cpmProjectZip'
import type { CPMAnimEnc, CPMAnimation, CPMConfig } from '@/05-entities'

export { readCpmProjectZip } from '../cpm-convert/cpmProjectZip'
export type { CpmProjectZip } from '../cpm-convert/cpmProjectZip'

export interface CpmProject {
  config: CPMConfig
  textureBlob: Blob
  animations: CPMAnimation[]
  animEnc: CPMAnimEnc | null
}

export interface PresetCpmProject {
  config: CPMConfig
  animations: CPMAnimation[]
  animEnc: CPMAnimEnc | null
}

export interface CpmProjectParseOptions {
  preset?: boolean
}

export function parseCpmProjectFile(data: Uint8Array): Promise<CpmProject>
export function parseCpmProjectFile(data: Uint8Array, options: { preset: true }): Promise<PresetCpmProject>
export async function parseCpmProjectFile(
  data: Uint8Array,
  options: CpmProjectParseOptions = {},
): Promise<CpmProject | PresetCpmProject> {
  const { zip, config, skinPng, budget } = await readCpmProjectZip(data)
  if (options.preset === true && skinPng !== null) throw new Error('Пресет не должен содержать skin.png')
  if (options.preset !== true && skinPng === null) throw new Error('Файл не содержит skin.png')

  const animations = await parseCpmAnimations(zip, budget)
  const animEnc = await parseCpmAnimEnc(zip, budget)
  if (skinPng === null) return { config, animations, animEnc }

  const textureBlob = new Blob([skinPng])
  return { config, textureBlob, animations, animEnc }
}
