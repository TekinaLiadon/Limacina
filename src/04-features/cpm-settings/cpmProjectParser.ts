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

export async function parseCpmProjectFile(data: Uint8Array): Promise<CpmProject> {
  const { zip, config, skinPng, budget } = await readCpmProjectZip(data)
  if (skinPng === null) throw new Error('Файл не содержит skin.png')

  const animations = await parseCpmAnimations(zip, budget)
  const animEnc = await parseCpmAnimEnc(zip, budget)
  const textureBlob = new Blob([skinPng])

  return { config, textureBlob, animations, animEnc }
}
