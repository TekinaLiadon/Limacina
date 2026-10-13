import JSZip from 'jszip'
import { hasPngSignature } from '@/06-shared'
import type { CPMConfig } from '@/05-entities'

export interface CpmProjectZip {
  zip: JSZip
  config: CPMConfig
  skinPng: Uint8Array | null
  budget: ZipReadBudget
}

export interface ZipReadBudget {
  limitBytes: number
  spentBytes: number
}

const INVALID_CONFIG_MESSAGE = 'Некорректный config.json в файле проекта'
const PNG_SIGNATURE_MESSAGE = 'skin.png в файле проекта не является PNG-изображением'
const ZIP_SIZE_MESSAGE = 'Файл проекта слишком большой после распаковки'

const MAX_UNCOMPRESSED_PROJECT_BYTES = 32 * 1024 * 1024

interface ZipEntrySizeMeta {
  uncompressedSize?: unknown
}

function declaredEntrySize(file: JSZip.JSZipObject): number {
  const meta = file as unknown as Record<string, ZipEntrySizeMeta | undefined>
  const declared = meta['_data']?.uncompressedSize
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0 ? declared : 0
}

export function createZipReadBudget(limitBytes: number = MAX_UNCOMPRESSED_PROJECT_BYTES): ZipReadBudget {
  return { limitBytes, spentBytes: 0 }
}

function enforceBudget(budget: ZipReadBudget): void {
  if (budget.spentBytes > budget.limitBytes) throw new Error(ZIP_SIZE_MESSAGE)
}

export async function readZipEntryBytes(budget: ZipReadBudget, file: JSZip.JSZipObject): Promise<Uint8Array> {
  const declared = declaredEntrySize(file)
  budget.spentBytes += declared
  enforceBudget(budget)
  const bytes = new Uint8Array(await file.async('arraybuffer'))
  if (bytes.byteLength > declared) {
    budget.spentBytes += bytes.byteLength - declared
    enforceBudget(budget)
  }
  return bytes
}

export async function readZipEntryText(budget: ZipReadBudget, file: JSZip.JSZipObject): Promise<string> {
  const bytes = await readZipEntryBytes(budget, file)
  return new TextDecoder().decode(bytes)
}

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
  const budget = createZipReadBudget()

  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')

  const configText = await readZipEntryText(budget, configFile)
  const config = parseCpmConfig(configText)

  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? await readZipEntryBytes(budget, skinFile) : null
  if (skinPng !== null && !hasPngSignature(skinPng)) throw new Error(PNG_SIGNATURE_MESSAGE)

  return { zip, config, skinPng, budget }
}
