import { isRecord } from './cpmProjectZip'
import { ROOT_PIVOTS } from '@/04-features/cpm-viewer/playerParts'
import { hasPngSignature } from '@/06-shared'
import type { CPMChild, CPMConfig, CPMElement, CPMFaceUV, CPMVec3 } from '@/05-entities'

export interface BbmodelParseResult {
  config: CPMConfig
  skinPng: Uint8Array | null
}

const VANILLA_PART_IDS = ['head', 'body', 'left_arm', 'right_arm', 'left_leg', 'right_leg']
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

const INVALID_JSON_MESSAGE = 'Файл .bbmodel не является корректным JSON'
const NO_ELEMENTS_MESSAGE = 'Файл .bbmodel не содержит поддерживаемых элементов модели'

const ZERO: CPMVec3 = { x: 0, y: 0, z: 0 }
const ONE: CPMVec3 = { x: 1, y: 1, z: 1 }

type CubeNode = Record<string, unknown>

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Файл .bbmodel повреждён: ${label} должен быть числом`)
  }
  return value
}

function vec3Of(value: unknown, label: string): CPMVec3 {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`Файл .bbmodel повреждён: ${label} должен быть тройкой координат`)
  }
  const [x, y, z] = value
  return { x: num(x, label), y: num(y, label), z: num(z, label) }
}

function nameOf(node: CubeNode, fallback: string): string {
  const { name } = node
  return typeof name === 'string' && name.trim() !== '' ? name : fallback
}

function rotationAxesOf(value: unknown, label: string): CPMVec3 {
  if (!Array.isArray(value) || value.length < 3) return { ...ZERO }
  const [x, y, z] = value
  return {
    x: num(x ?? 0, label),
    y: num(y ?? 0, label),
    z: num(z ?? 0, label),
  }
}

function rotationOf(value: unknown): CPMVec3 {
  const axes = rotationAxesOf(value, 'rotation')
  if (axes.x === 0 && axes.y === 0 && axes.z === 0) return { ...ZERO }
  return { x: axes.x + 0, y: -axes.y + 0, z: -axes.z + 0 }
}

function isRotated(value: unknown): boolean {
  const axes = rotationAxesOf(value, 'rotation')
  return axes.x !== 0 || axes.y !== 0 || axes.z !== 0
}

function matchVanillaPart(groupName: string): string | null {
  const normalized = groupName.trim().toLowerCase()
  let best: string | null = null
  for (const partId of VANILLA_PART_IDS) {
    if (normalized.startsWith(partId) && (best === null || partId.length > best.length)) {
      best = partId
    }
  }
  return best
}

function customRootId(name: string): string {
  return matchVanillaPart(name) === null ? name : `${name}_custom`
}

function extractSkinPng(textures: unknown): Uint8Array | null {
  if (!Array.isArray(textures)) return null
  for (const texture of textures) {
    if (!isRecord(texture) || typeof texture.source !== 'string' || texture.source === '') continue
    const comma = texture.source.indexOf(',')
    const base64 = comma >= 0 ? texture.source.slice(comma + 1) : texture.source
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    if (!hasPngSignature(bytes)) {
      throw new Error(`Текстура "${nameOf(texture, 'texture')}" не является PNG-изображением`)
    }
    return bytes
  }
  return null
}

function faceUVOf(cube: CubeNode): Record<string, CPMFaceUV> | undefined {
  const { faces } = cube
  if (!isRecord(faces)) return undefined
  const cubeName = nameOf(cube, 'cube')
  const faceUV: Record<string, CPMFaceUV> = {}
  for (const [bbFace, cpmFace] of Object.entries(FACE_TO_CPM)) {
    const face = faces[bbFace]
    if (!isRecord(face) || face.texture === null || !Array.isArray(face.uv) || face.uv.length < 4) continue
    const [sx, sy, ex, ey] = face.uv
    const label = `UV грани ${bbFace} куба "${cubeName}"`
    const bbRotation = typeof face.rotation === 'number' ? face.rotation : 0
    const degrees = (Math.round(bbRotation) + (UPSIDE_DOWN_FACES.has(cpmFace) ? 180 : 0) + 360) % 360
    const rot = ROT_BY_DEG[degrees]
    if (rot === undefined) {
      throw new Error(`Поворот грани ${bbFace} куба "${cubeName}" должен быть 0, 90, 180 или 270`)
    }
    faceUV[cpmFace] = {
      sx: num(sx, label),
      sy: num(sy, label),
      ex: num(ex, label),
      ey: num(ey, label),
      rot,
      autoUV: false,
    }
  }
  return Object.keys(faceUV).length > 0 ? faceUV : undefined
}

function applyUv(cube: CubeNode, child: CPMChild): void {
  if (cube.box_uv === true && Array.isArray(cube.uv_offset)) {
    const [u, v] = cube.uv_offset
    child.u = Math.round(num(u, 'uv_offset куба'))
    child.v = Math.round(num(v, 'uv_offset куба'))
    child.textureSize = 1
    return
  }
  const faceUV = faceUVOf(cube)
  if (faceUV) child.faceUV = faceUV
}

function parseCube(cube: CubeNode, refOrigin: CPMVec3): CPMChild {
  const name = nameOf(cube, 'cube')
  const from = vec3Of(cube.from, `from куба "${name}"`)
  const to = vec3Of(cube.to, `to куба "${name}"`)
  const inflate = typeof cube.inflate === 'number' && Number.isFinite(cube.inflate) ? cube.inflate : 0
  const rotated = isRotated(cube.rotation)
  const origin = rotated ? vec3Of(cube.origin, `origin куба "${name}"`) : refOrigin
  const child: CPMChild = {
    name,
    size: {
      x: to.x - from.x + inflate * 2,
      y: to.y - from.y + inflate * 2,
      z: to.z - from.z + inflate * 2,
    },
    pos: rotated
      ? { x: origin.x - refOrigin.x, y: refOrigin.y - origin.y, z: refOrigin.z - origin.z }
      : { ...ZERO },
    offset: {
      x: from.x - inflate - origin.x,
      y: origin.y - (to.y + inflate),
      z: origin.z - (to.z + inflate),
    },
    rotation: rotationOf(cube.rotation),
    scale: { ...ONE },
  }
  if (cube.visibility === false) child.hidden = true
  applyUv(cube, child)
  return child
}

function childrenOf(nodes: unknown[], byUuid: Map<string, CubeNode>, parentOrigin: CPMVec3): CPMChild[] {
  const children: CPMChild[] = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      const cube = byUuid.get(node)
      if (cube) children.push(parseCube(cube, parentOrigin))
      continue
    }
    if (isRecord(node) && Array.isArray(node.children)) {
      children.push(parseGroup(node, byUuid, parentOrigin))
    }
  }
  return children
}

function parseGroup(node: CubeNode, byUuid: Map<string, CubeNode>, parentOrigin: CPMVec3): CPMChild {
  const name = nameOf(node, 'group')
  const origin = vec3Of(node.origin, `origin группы "${name}"`)
  return {
    name,
    size: { ...ZERO },
    offset: { ...ZERO },
    pos: {
      x: origin.x - parentOrigin.x,
      y: parentOrigin.y - origin.y,
      z: parentOrigin.z - origin.z,
    },
    rotation: rotationOf(node.rotation),
    scale: { ...ONE },
    children: childrenOf(node.children as unknown[], byUuid, origin),
  }
}

function parseRootGroup(
  node: CubeNode,
  byUuid: Map<string, CubeNode>,
  claimedParts: Set<string>,
): CPMElement | null {
  const name = nameOf(node, 'group')
  const origin = vec3Of(node.origin, `origin группы "${name}"`)
  const children = childrenOf(node.children as unknown[], byUuid, origin)
  if (children.length === 0) return null

  const partId = matchVanillaPart(name)
  if (partId !== null && !claimedParts.has(partId)) {
    claimedParts.add(partId)
    const pivot = ROOT_PIVOTS[partId] ?? ZERO
    return {
      id: partId,
      name,
      pos: {
        x: origin.x - pivot.x,
        y: pivot.y - origin.y,
        z: pivot.z - origin.z,
      },
      rotation: rotationOf(node.rotation),
      children,
    }
  }
  return {
    id: customRootId(name),
    name,
    customPart: true,
    pos: { x: origin.x, y: -origin.y, z: -origin.z },
    rotation: rotationOf(node.rotation),
    children,
  }
}

function parseLooseCubeRoot(cube: CubeNode): CPMElement {
  const name = nameOf(cube, 'cube')
  const origin = vec3Of(cube.origin, `origin куба "${name}"`)
  return {
    id: customRootId(name),
    name,
    customPart: true,
    pos: { x: origin.x, y: -origin.y, z: -origin.z },
    rotation: { ...ZERO },
    children: [parseCube(cube, origin)],
  }
}

export function parseBbmodel(data: Uint8Array): BbmodelParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new Error(INVALID_JSON_MESSAGE)
  }
  if (!isRecord(parsed)) throw new Error(INVALID_JSON_MESSAGE)

  const { elements } = parsed
  if (!Array.isArray(elements)) throw new Error(NO_ELEMENTS_MESSAGE)

  const rejected: string[] = []
  const byUuid = new Map<string, CubeNode>()
  for (const element of elements) {
    if (!isRecord(element)) continue
    if (element.type !== undefined && element.type !== 'cube') {
      rejected.push(nameOf(element, 'без имени'))
      continue
    }
    const { uuid } = element
    if (typeof uuid === 'string') byUuid.set(uuid, element)
  }
  if (rejected.length > 0) {
    throw new Error(`Конвертер поддерживает только кубы, в модели найдены другие элементы: ${rejected.join(', ')}`)
  }

  const { outliner } = parsed
  if (!Array.isArray(outliner) || byUuid.size === 0) throw new Error(NO_ELEMENTS_MESSAGE)

  const skinPng = extractSkinPng(parsed.textures)
  const { resolution } = parsed
  const width = num(isRecord(resolution) ? resolution.width : undefined, 'resolution.width')
  const height = num(isRecord(resolution) ? resolution.height : undefined, 'resolution.height')

  const claimedParts = new Set<string>()
  const roots: CPMElement[] = []
  for (const node of outliner) {
    if (typeof node === 'string') {
      const cube = byUuid.get(node)
      if (cube) roots.push(parseLooseCubeRoot(cube))
      continue
    }
    if (!isRecord(node) || !Array.isArray(node.children)) continue
    const root = parseRootGroup(node, byUuid, claimedParts)
    if (root) roots.push(root)
  }
  if (roots.length === 0) throw new Error(NO_ELEMENTS_MESSAGE)

  return {
    config: {
      skinSize: { x: width, y: height },
      elements: roots,
    },
    skinPng,
  }
}
