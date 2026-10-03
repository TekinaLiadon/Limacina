import JSZip from 'jszip'
import type { CPMConfig } from '@/05-entities'

export interface CpmProjectZip {
  zip: JSZip
  config: CPMConfig
  skinPng: Uint8Array | null
}

function parseCpmConfig(configText: string): CPMConfig {
  let config: CPMConfig
  try {
    config = JSON.parse(configText) as CPMConfig
  } catch {
    throw new Error('Некорректный config.json в файле проекта')
  }

  const { skinSize } = config
  if (!skinSize || typeof skinSize.x !== 'number' || typeof skinSize.y !== 'number' || !Array.isArray(config.elements)) {
    throw new Error('Некорректный config.json в файле проекта')
  }

  return config
}

export async function readCpmProjectZip(data: ArrayBuffer): Promise<CpmProjectZip> {
  const zip = await JSZip.loadAsync(data)

  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')

  const configText = await configFile.async('string')
  const config = parseCpmConfig(configText)

  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? new Uint8Array(await skinFile.async('arraybuffer')) : null

  return { zip, config, skinPng }
}
