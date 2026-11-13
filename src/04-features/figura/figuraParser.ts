import { hasPngSignature } from '@/06-shared'

interface FiguraSize {
  width: number
  height: number
}

export interface FiguraVec3 {
  x: number
  y: number
  z: number
}

export type FiguraUvQuad = [number, number, number, number]

export interface FiguraCubeFace {
  uv: FiguraUvQuad
  rotation: number
  texture: number | null
}

export interface FiguraMeshFace {
  vertices: string[]
  uv: Record<string, [number, number]>
  texture: number | null
}

interface FiguraNodeBase {
  name: string
  uuid: string
  origin: FiguraVec3
  rotation: FiguraVec3
  visible: boolean
}

export interface FiguraCubeNode extends FiguraNodeBase {
  kind: 'cube'
  from: FiguraVec3
  to: FiguraVec3
  inflate: number
  boxUv: boolean
  mirrorUv: boolean
  uvOffset: [number, number]
  faces: Record<string, FiguraCubeFace>
}

export interface FiguraMeshNode extends FiguraNodeBase {
  kind: 'mesh'
  vertices: Record<string, FiguraVec3>
  faces: Record<string, FiguraMeshFace>
}

type FiguraNode = FiguraCubeNode | FiguraMeshNode

export interface FiguraGroup extends FiguraNodeBase {
  kind: 'group'
  children: FiguraEntry[]
}

export type FiguraEntry = FiguraGroup | FiguraNode

export interface FiguraModel {
  resolution: FiguraSize
  textureSize: FiguraSize
  nodes: FiguraNode[]
  roots: FiguraEntry[]
}

export interface FiguraParseResult {
  model: FiguraModel
  texturePng: Uint8Array | null
  skipped: string[]
}

type BbRecord = Record<string, unknown>

interface ElementRecords {
  byUuid: Map<string, BbRecord>
  skipped: string[]
}

interface ParserState {
  elements: Map<string, BbRecord>
  groups: Map<string, BbRecord>
  nodes: FiguraNode[]
  skipped: string[]
  emitted: Set<string>
  skippedUuids: Set<string>
  visitedGroups: Set<string>
}

const INVALID_JSON_MESSAGE = 'Файл .bbmodel не является корректным JSON'
const NO_ELEMENTS_MESSAGE = 'Файл .bbmodel не содержит поддерживаемых элементов модели'
const DAMAGED_MESSAGE = 'Файл .bbmodel повреждён'
const NO_NAME = 'без имени'
const CUBE_TYPE = 'cube'
const MESH_TYPE = 'mesh'
const MAX_DEPTH = 64
const ZERO: FiguraVec3 = { x: 0, y: 0, z: 0 }

function isRecord(value: unknown): value is BbRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nameOf(value: BbRecord, fallback: string): string {
  const { name } = value
  return typeof name === 'string' && name.trim() !== '' ? name : fallback
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${DAMAGED_MESSAGE}: ${label} должен быть числом`)
  }
  return value
}

function optionalNum(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0
  return num(value, label)
}

function vec3Of(value: unknown, label: string): FiguraVec3 {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${DAMAGED_MESSAGE}: ${label} должен быть тройкой координат`)
  }
  const [x, y, z] = value
  return { x: num(x, label), y: num(y, label), z: num(z, label) }
}

function originOf(value: unknown, label: string): FiguraVec3 {
  if (value === undefined || value === null) return { ...ZERO }
  return vec3Of(value, label)
}

function rotationOf(value: unknown): FiguraVec3 {
  if (!Array.isArray(value) || value.length < 3) return { ...ZERO }
  const [x, y, z] = value
  return { x: optionalNum(x, 'rotation'), y: optionalNum(y, 'rotation'), z: optionalNum(z, 'rotation') }
}

function pairOf(value: unknown, label: string, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback
  const [first, second] = value
  return [num(first, label), num(second, label)]
}

function textureIndexOf(value: unknown): number | null {
  if (value === null || value === false) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function faceTextureOf(face: BbRecord): number | null {
  return face.enabled === false ? null : textureIndexOf(face.texture)
}

function uvQuadOf(value: unknown, label: string): FiguraUvQuad {
  if (!Array.isArray(value) || value.length < 4) return [0, 0, 0, 0]
  const [u1, v1, u2, v2] = value
  return [num(u1, label), num(v1, label), num(u2, label), num(v2, label)]
}

function cubeFacesOf(element: BbRecord, name: string): Record<string, FiguraCubeFace> {
  const faces: Record<string, FiguraCubeFace> = {}
  if (!isRecord(element.faces)) return faces
  for (const [direction, face] of Object.entries(element.faces)) {
    if (!isRecord(face)) continue
    faces[direction] = {
      uv: uvQuadOf(face.uv, `UV грани ${direction} куба "${name}"`),
      rotation: optionalNum(face.rotation, `поворот грани ${direction} куба "${name}"`),
      texture: faceTextureOf(face),
    }
  }
  return faces
}

function meshVerticesOf(element: BbRecord, name: string): Record<string, FiguraVec3> {
  const vertices: Record<string, FiguraVec3> = {}
  if (!isRecord(element.vertices)) return vertices
  for (const [key, value] of Object.entries(element.vertices)) {
    vertices[key] = vec3Of(value, `вершины ${key} меша "${name}"`)
  }
  return vertices
}

function meshUvsOf(value: unknown, name: string): Record<string, [number, number]> {
  const uv: Record<string, [number, number]> = {}
  if (!isRecord(value)) return uv
  for (const [key, pair] of Object.entries(value)) {
    uv[key] = pairOf(pair, `UV меша "${name}"`, [0, 0])
  }
  return uv
}

function meshFacesOf(element: BbRecord, name: string): Record<string, FiguraMeshFace> {
  const faces: Record<string, FiguraMeshFace> = {}
  if (!isRecord(element.faces)) return faces
  for (const [key, face] of Object.entries(element.faces)) {
    if (!isRecord(face)) continue
    const vertices = Array.isArray(face.vertices)
      ? face.vertices.filter((entry): entry is string => typeof entry === 'string')
      : []
    faces[key] = {
      vertices,
      uv: meshUvsOf(face.uv, name),
      texture: faceTextureOf(face),
    }
  }
  return faces
}

function nodeBaseOf(element: BbRecord, name: string): FiguraNodeBase {
  return {
    name,
    uuid: typeof element.uuid === 'string' ? element.uuid : '',
    origin: originOf(element.origin, `origin "${name}"`),
    rotation: rotationOf(element.rotation),
    visible: element.visibility !== false,
  }
}

function cubeNodeOf(element: BbRecord): FiguraCubeNode {
  const name = nameOf(element, CUBE_TYPE)
  return {
    ...nodeBaseOf(element, name),
    kind: CUBE_TYPE,
    from: vec3Of(element.from, `from куба "${name}"`),
    to: vec3Of(element.to, `to куба "${name}"`),
    inflate: optionalNum(element.inflate, `inflate куба "${name}"`),
    boxUv: element.box_uv === true,
    mirrorUv: element.mirror_uv === true,
    uvOffset: pairOf(element.uv_offset, `uv_offset куба "${name}"`, [0, 0]),
    faces: cubeFacesOf(element, name),
  }
}

function meshNodeOf(element: BbRecord): FiguraMeshNode {
  const name = nameOf(element, MESH_TYPE)
  return {
    ...nodeBaseOf(element, name),
    kind: MESH_TYPE,
    vertices: meshVerticesOf(element, name),
    faces: meshFacesOf(element, name),
  }
}

function elementRecordsOf(elements: unknown): ElementRecords {
  const byUuid = new Map<string, BbRecord>()
  const skipped: string[] = []
  if (!Array.isArray(elements)) return { byUuid, skipped }
  for (const element of elements) {
    if (!isRecord(element)) continue
    const { uuid } = element
    if (typeof uuid !== 'string' || uuid === '') {
      skipped.push(nameOf(element, NO_NAME))
      continue
    }
    if (byUuid.has(uuid)) {
      skipped.push(nameOf(element, NO_NAME))
      continue
    }
    byUuid.set(uuid, element)
  }
  return { byUuid, skipped }
}

function groupRecordsOf(groups: unknown): Map<string, BbRecord> {
  const byUuid = new Map<string, BbRecord>()
  if (!Array.isArray(groups)) return byUuid
  for (const group of groups) {
    if (!isRecord(group) || typeof group.uuid !== 'string') continue
    byUuid.set(group.uuid, group)
  }
  return byUuid
}

function markSkipped(state: ParserState, uuid: string, name: string): void {
  if (state.skippedUuids.has(uuid)) return
  state.skippedUuids.add(uuid)
  state.skipped.push(name)
}

function elementEntry(uuid: string, state: ParserState): FiguraNode | null {
  const element = state.elements.get(uuid)
  if (element === undefined || state.emitted.has(uuid) || state.skippedUuids.has(uuid)) return null
  const { type } = element
  if (type !== undefined && type !== CUBE_TYPE && type !== MESH_TYPE) {
    markSkipped(state, uuid, nameOf(element, NO_NAME))
    return null
  }
  const node = type === MESH_TYPE ? meshNodeOf(element) : cubeNodeOf(element)
  state.emitted.add(uuid)
  state.nodes.push(node)
  return node
}

function groupDataOf(node: BbRecord, groups: Map<string, BbRecord>): BbRecord {
  const { uuid } = node
  if (typeof uuid !== 'string') return node
  return groups.get(uuid) ?? node
}

function groupEntry(node: BbRecord, state: ParserState, depth: number): FiguraGroup {
  const data = groupDataOf(node, state.groups)
  const name = nameOf(data, 'group')
  return {
    ...nodeBaseOf(data, name),
    kind: 'group',
    visible: data.visibility !== false && node.visibility !== false,
    children: buildEntries(Array.isArray(node.children) ? node.children : [], state, depth + 1),
  }
}

function buildEntries(nodes: unknown[], state: ParserState, depth: number): FiguraEntry[] {
  const entries: FiguraEntry[] = []
  if (depth > MAX_DEPTH) return entries
  for (const node of nodes) {
    if (typeof node === 'string') {
      const entry = elementEntry(node, state)
      if (entry !== null) entries.push(entry)
      continue
    }
    if (!isRecord(node) || !Array.isArray(node.children)) continue
    const { uuid } = node
    if (typeof uuid === 'string') {
      if (state.visitedGroups.has(uuid)) continue
      state.visitedGroups.add(uuid)
    }
    entries.push(groupEntry(node, state, depth))
  }
  return entries
}

function collectUnreferenced(state: ParserState): void {
  for (const [uuid, element] of state.elements) {
    if (state.emitted.has(uuid) || state.skippedUuids.has(uuid)) continue
    markSkipped(state, uuid, nameOf(element, NO_NAME))
  }
}

function findTexture(textures: unknown): BbRecord | null {
  if (!Array.isArray(textures)) return null
  for (const texture of textures) {
    if (isRecord(texture) && typeof texture.source === 'string' && texture.source !== '') return texture
  }
  return null
}

function decodeTexturePng(source: string, name: string): Uint8Array {
  const comma = source.indexOf(',')
  const base64 = comma >= 0 ? source.slice(comma + 1) : source
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  } catch {
    throw new Error(`Текстура "${name}" повреждена`)
  }
  if (!hasPngSignature(bytes)) throw new Error(`Текстура "${name}" не является PNG-изображением`)
  return bytes
}

function extractTexturePng(textures: unknown): Uint8Array | null {
  const texture = findTexture(textures)
  if (texture === null) return null
  return decodeTexturePng(String(texture.source), nameOf(texture, 'texture'))
}

function textureSizeOf(textures: unknown, resolution: FiguraSize): FiguraSize {
  const texture = findTexture(textures)
  if (texture === null) return resolution
  const { uv_width: uvWidth, uv_height: uvHeight } = texture
  return {
    width: typeof uvWidth === 'number' && uvWidth > 0 ? uvWidth : resolution.width,
    height: typeof uvHeight === 'number' && uvHeight > 0 ? uvHeight : resolution.height,
  }
}

function resolutionOf(parsed: BbRecord): FiguraSize {
  const { resolution } = parsed
  return {
    width: num(isRecord(resolution) ? resolution.width : undefined, 'resolution.width'),
    height: num(isRecord(resolution) ? resolution.height : undefined, 'resolution.height'),
  }
}

function parseDocument(data: Uint8Array): BbRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new Error(INVALID_JSON_MESSAGE)
  }
  if (!isRecord(parsed)) throw new Error(INVALID_JSON_MESSAGE)
  return parsed
}

export function parseFiguraModel(data: Uint8Array): FiguraParseResult {
  const parsed = parseDocument(data)
  const records = elementRecordsOf(parsed.elements)
  if (records.byUuid.size === 0) throw new Error(NO_ELEMENTS_MESSAGE)
  const { outliner } = parsed
  if (!Array.isArray(outliner)) throw new Error(NO_ELEMENTS_MESSAGE)

  const resolution = resolutionOf(parsed)
  const state: ParserState = {
    elements: records.byUuid,
    groups: groupRecordsOf(parsed.groups),
    nodes: [],
    skipped: records.skipped,
    emitted: new Set(),
    skippedUuids: new Set(),
    visitedGroups: new Set(),
  }
  const roots = buildEntries(outliner, state, 0)
  collectUnreferenced(state)
  if (state.nodes.length === 0) throw new Error(NO_ELEMENTS_MESSAGE)

  return {
    model: {
      resolution,
      textureSize: textureSizeOf(parsed.textures, resolution),
      nodes: state.nodes,
      roots,
    },
    texturePng: extractTexturePng(parsed.textures),
    skipped: state.skipped,
  }
}
