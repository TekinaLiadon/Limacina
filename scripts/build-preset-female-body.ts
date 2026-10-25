import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBbmodel } from '../src/04-features/cpm-convert/bbmodelParser'
import { serializeCpmAnimationFile } from '../src/04-features/cpm-convert/cpmAnimationJsonWriter'
import {
  validatePresetConfig,
  validatePresetPair,
  validatePresetSkinFit,
} from '../src/04-features/cpm-presets/presetValidator'
import type { PresetMeta } from '../src/04-features/cpm-presets/presetTypes'
import type { CPMChild, CPMElement, CPMFaceUV } from '../src/05-entities/core/types/index'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/04-features/cpm-presets/assets')
const SOURCE_PATH = join(ASSETS_DIR, 'female-body.bbmodel')
const CONFIG_PATH = join(ASSETS_DIR, 'female-body.config.json')
const ANIMATIONS_PATH = join(ASSETS_DIR, 'female-body.animations.json')
const PREVIEW_PATH = join(ASSETS_DIR, 'female-body.preview.png.b64')

const LOGICAL_ATLAS_SIZE = 64

const FACE_TO_CPM: Record<string, string> = {
  north: 'south',
  south: 'north',
  east: 'east',
  west: 'west',
  up: 'up',
  down: 'down',
}
const UPSIDE_DOWN_FACES = new Set(['up', 'down'])
const ROT_BY_DEG: Record<number, string> = { 0: '0', 90: '90', 180: '180', 270: '270' }

const META: PresetMeta = {
  name: 'Женское тело',
  slug: 'female-body',
  skinType: 'both',
  auxRegions: [
    { name: 'body-aux', sx: 58, sy: 0, ex: 64, ey: 4 },
    { name: 'body-jacket', sx: 16, sy: 32, ex: 40, ey: 48 },
  ],
}

interface RawFace {
  uv?: unknown
  rotation?: unknown
  texture?: unknown
}

const approximatedFaces: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} должен быть числом, получено ${String(value)}`)
  }
  return value
}

function collectRawCubes(nodes: unknown[], byUuid: Map<string, Record<string, unknown>>, sink: Record<string, unknown>[]): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      const cube = byUuid.get(node)
      if (cube) sink.push(cube)
      continue
    }
    if (isRecord(node) && Array.isArray(node.children)) {
      collectRawCubes(node.children as unknown[], byUuid, sink)
    }
  }
}

function rawCubesUnder(node: unknown, byUuid: Map<string, Record<string, unknown>>): number {
  if (!isRecord(node) || !Array.isArray(node.children)) return 0
  const sink: Record<string, unknown>[] = []
  collectRawCubes(node.children as unknown[], byUuid, sink)
  return sink.length
}

function rawCubeCountOf(parsed: Record<string, unknown>): number {
  const elements = Array.isArray(parsed.elements) ? (parsed.elements as unknown[]) : []
  const byUuid = new Map<string, Record<string, unknown>>()
  for (const element of elements) {
    if (!isRecord(element)) continue
    if (element.type !== undefined && element.type !== 'cube') continue
    if (typeof element.uuid === 'string') byUuid.set(element.uuid, element)
  }
  const outliner = Array.isArray(parsed.outliner) ? (parsed.outliner as unknown[]) : []
  const sink: Record<string, unknown>[] = []
  collectRawCubes(outliner, byUuid, sink)
  return sink.length
}

function curateChildren(rawNodes: unknown[], byUuid: Map<string, Record<string, unknown>>, children: CPMChild[]): void {
  let index = 0
  for (const node of rawNodes) {
    const child = children[index]
    if (!child) throw new Error(`В конфиге не хватает детей для узла .bbmodel (куб/группа №${index + 1})`)
    if (typeof node === 'string') {
      curateCube(child, byUuid.get(node))
      index += 1
      continue
    }
    if (isRecord(node) && Array.isArray(node.children)) {
      curateChildren(node.children as unknown[], byUuid, child.children ?? [])
      index += 1
    }
  }
}

function normalizedFace(cubeName: string, faceName: string, rawFace: RawFace): CPMFaceUV | null {
  if (rawFace.texture === null || !Array.isArray(rawFace.uv) || rawFace.uv.length < 4) return null
  const [rawSx, rawSy, rawEx, rawEy] = rawFace.uv
  const sx = num(rawSx, `uv грани ${faceName} куба "${cubeName}"`)
  const sy = num(rawSy, `uv грани ${faceName} куба "${cubeName}"`)
  const ex = num(rawEx, `uv грани ${faceName} куба "${cubeName}"`)
  const ey = num(rawEy, `uv грани ${faceName} куба "${cubeName}"`)

  let degrees = Math.round(typeof rawFace.rotation === 'number' ? rawFace.rotation : 0)
  if (UPSIDE_DOWN_FACES.has(faceName)) degrees += 180
  const flipX = sx > ex
  const flipY = sy > ey
  if (flipX && flipY) degrees += 180
  if (flipX !== flipY) approximatedFaces.push(`"${cubeName}".${faceName}`)
  if (sx === ex || sy === ey) return null

  const rot = ROT_BY_DEG[((degrees % 360) + 360) % 360]
  if (rot === undefined) {
    throw new Error(`Поворот грани ${faceName} куба "${cubeName}" должен быть кратен 90, получено ${degrees}`)
  }
  return {
    sx: Math.min(sx, ex),
    sy: Math.min(sy, ey),
    ex: Math.max(sx, ex),
    ey: Math.max(sy, ey),
    rot,
    autoUV: false,
  }
}

function faceUVFromRaw(cubeName: string, faces: unknown): Record<string, CPMFaceUV> | undefined {
  if (!isRecord(faces)) return undefined
  const faceUV: Record<string, CPMFaceUV> = {}
  for (const [bbFace, cpmFace] of Object.entries(FACE_TO_CPM)) {
    const face = normalizedFace(cubeName, bbFace, faces[bbFace] as RawFace)
    if (face) faceUV[cpmFace] = face
  }
  return Object.keys(faceUV).length > 0 ? faceUV : undefined
}

function boxUvOverflows(child: CPMChild): boolean {
  const texSize = Math.abs(child.textureSize ?? 1)
  const u = child.u ?? 0
  const v = child.v ?? 0
  const size = child.size ?? { x: 0, y: 0, z: 0 }
  const dx = Math.ceil(size.x * texSize)
  const dy = Math.ceil(size.y * texSize)
  const dz = Math.ceil(size.z * texSize)
  const extentX = u * texSize + 2 * dx + 2 * dz
  const extentY = v * texSize + dz + dy
  return extentX > LOGICAL_ATLAS_SIZE || extentY > LOGICAL_ATLAS_SIZE
}

function curateCube(child: CPMChild, raw: Record<string, unknown> | undefined): void {
  if (!raw) throw new Error(`Кубу "${child.name}" не найден исходный элемент .bbmodel`)
  const rawName = typeof raw.name === 'string' ? raw.name : 'cube'

  if (child.u !== undefined && child.v !== undefined && boxUvOverflows(child)) {
    const faceUV = faceUVFromRaw(rawName, raw.faces)
    if (!faceUV) throw new Error(`Куб "${child.name}" не удалось переложить на по-граневую UV-развёртку`)
    child.faceUV = faceUV
    delete child.u
    delete child.v
    delete child.textureSize
    delete child.singleTex
    delete child.mirror
    return
  }

  if (child.faceUV) {
    const faceUV = faceUVFromRaw(rawName, raw.faces)
    if (faceUV) child.faceUV = faceUV
  }
}

function extractPreviewBase64(parsed: Record<string, unknown>): string {
  const { textures } = parsed
  if (!Array.isArray(textures)) return ''
  for (const texture of textures) {
    if (!isRecord(texture) || typeof texture.source !== 'string') continue
    const comma = texture.source.indexOf(',')
    if (!texture.source.startsWith('data:image/png;base64,') || comma < 0) continue
    return texture.source.slice(comma + 1)
  }
  return ''
}

const sourceBytes = new Uint8Array(readFileSync(SOURCE_PATH))
const rawParsed = JSON.parse(new TextDecoder().decode(sourceBytes)) as Record<string, unknown>
const { config, animations } = parseBbmodel(sourceBytes)

const rawElements = Array.isArray(rawParsed.elements) ? (rawParsed.elements as unknown[]) : []
const byUuid = new Map<string, Record<string, unknown>>()
for (const element of rawElements) {
  if (!isRecord(element)) continue
  if (element.type !== undefined && element.type !== 'cube') continue
  if (typeof element.uuid === 'string') byUuid.set(element.uuid, element)
}
const rawOutliner = Array.isArray(rawParsed.outliner) ? (rawParsed.outliner as unknown[]) : []
const configRoots = config.elements as CPMElement[]
const rawCubeCount = rawCubeCountOf(rawParsed)
const countConfigCubes = (children: CPMChild[]): number => {
  let total = 0
  for (const child of children) {
    if (child.children === undefined) total += 1
    else total += countConfigCubes(child.children)
  }
  return total
}
const configCubeCount = configRoots.reduce((sum, root) => sum + countConfigCubes(root.children ?? []), 0)
if (rawCubeCount !== configCubeCount) {
  throw new Error(`Количество кубов не сходится: .bbmodel ${rawCubeCount}, конфиг ${configCubeCount}`)
}
for (const node of rawOutliner) {
  if (!isRecord(node) || !Array.isArray(node.children)) continue
  const root = configRoots.find((item) => item.name === node.name)
  if (!root) {
    if (rawCubesUnder(node, byUuid) > 0) {
      throw new Error(`Корню .bbmodel "${String(node.name)}" не найден корень конфига`)
    }
    continue
  }
  curateChildren(node.children as unknown[], byUuid, root.children ?? [])
}

const errors = [
  ...validatePresetConfig(config),
  ...validatePresetPair(config, META),
  ...validatePresetSkinFit(config, 512, 512),
]
if (errors.length > 0) {
  console.error(errors.join('\n'))
  throw new Error(`Курация не прошла валидацию: ${errors.length} ошибок`)
}

writeFileSync(CONFIG_PATH, JSON.stringify(config))
const animationFiles = animations.map((animation) => serializeCpmAnimationFile(animation))
writeFileSync(ANIMATIONS_PATH, JSON.stringify(animationFiles))
const previewBase64 = extractPreviewBase64(rawParsed)
if (previewBase64 === '') throw new Error('В .bbmodel нет PNG-текстуры для превью')
writeFileSync(PREVIEW_PATH, previewBase64)

console.log(`кубов: ${configCubeCount}, корней: ${config.elements.length}, анимаций: ${animationFiles.length}`)
console.log(`зеркальные грани (примерно): ${approximatedFaces.length} — ${approximatedFaces.join(', ')}`)
console.log(`записано: ${CONFIG_PATH}, ${ANIMATIONS_PATH}, ${PREVIEW_PATH}`)
