import JSZip from 'jszip'
import type { CPMConfig } from '@/05-entities'

export interface CpmProjectZip {
  zip: JSZip
  config: CPMConfig
  skinPng: Uint8Array | null
}

const INVALID_CONFIG_MESSAGE = 'Некорректный config.json в файле проекта'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidCpmConfig(value: unknown): value is CPMConfig {
  if (!isRecord(value)) return false
  const { skinSize, elements } = value
  if (!isRecord(skinSize) || typeof skinSize.x !== 'number' || typeof skinSize.y !== 'number') return false
  return Array.isArray(elements) && elements.every(isRecord)
}

function parseCpmConfig(configText: string): CPMConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(configText)
  } catch {
    throw new Error(INVALID_CONFIG_MESSAGE)
  }
  if (!isValidCpmConfig(parsed)) throw new Error(INVALID_CONFIG_MESSAGE)

  return parsed
}

export async function readCpmProjectZip(data: Uint8Array): Promise<CpmProjectZip> {
  const zip = await JSZip.loadAsync(data)

  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')

  const configText = await configFile.async('string')
  const config = parseCpmConfig(configText)

  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? new Uint8Array(await skinFile.async('arraybuffer')) : null

  return { zip, config, skinPng }
}
