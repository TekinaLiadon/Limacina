import JSZip from 'jszip'
import { parseCpmAnimations } from './cpmAnimationParser'
import type { CPMAnimation, CPMConfig } from '@/05-entities'

export interface CpmProject {
  config: CPMConfig
  textureBlob: Blob
  animations: CPMAnimation[]
}

export interface CpmProjectZip {
  zip: JSZip
  config: CPMConfig
  skinPng: Uint8Array | null
}

export async function readCpmProjectZip(data: ArrayBuffer): Promise<CpmProjectZip> {
  const zip = await JSZip.loadAsync(data)

  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')

  const configText = await configFile.async('string')
  const config: CPMConfig = JSON.parse(configText)

  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? new Uint8Array(await skinFile.async('arraybuffer')) : null

  return { zip, config, skinPng }
}

export async function parseCpmProjectFile(data: ArrayBuffer): Promise<CpmProject> {
  const { zip, config, skinPng } = await readCpmProjectZip(data)
  if (skinPng === null) throw new Error('Файл не содержит skin.png')

  const animations = await parseCpmAnimations(zip)
  const textureBlob = new Blob([skinPng])

  return { config, textureBlob, animations }
}
