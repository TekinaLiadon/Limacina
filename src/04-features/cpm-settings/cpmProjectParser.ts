import JSZip from 'jszip'
import { parseCpmAnimations } from './cpmAnimationParser'
import type { CPMAnimation, CPMConfig } from '@/05-entities/core/types'

export interface CpmProject {
  config: CPMConfig
  textureBlob: Blob
  animations: CPMAnimation[]
}

export async function parseCpmProjectFile(data: ArrayBuffer): Promise<CpmProject> {
  const zip = await JSZip.loadAsync(data)

  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('Файл не содержит config.json')

  const skinFile = zip.file('skin.png')
  if (!skinFile) throw new Error('Файл не содержит skin.png')

  const configText = await configFile.async('string')
  const config: CPMConfig = JSON.parse(configText)
  const animations = await parseCpmAnimations(zip)
  const textureBlob = await skinFile.async('blob')

  return { config, textureBlob, animations }
}
