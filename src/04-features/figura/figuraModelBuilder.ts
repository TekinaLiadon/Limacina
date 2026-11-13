import * as THREE from 'three'
import { setFaceQuad } from '@/06-shared'
import type {
  FiguraCubeFace,
  FiguraCubeNode,
  FiguraEntry,
  FiguraMeshFace,
  FiguraMeshNode,
  FiguraModel,
  FiguraUvQuad,
  FiguraVec3,
} from './figuraParser'

const CUBE_FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'] as const
const MIN_SIZE = 0.001
const MIN_UV_SIZE = 1
const MAX_COORD = 1_000_000
const DEFAULT_UV_SIZE = 16

type Quad = Array<[number, number]>

interface CubeBox {
  width: number
  height: number
  depth: number
  uvWidth: number
  uvHeight: number
  uvDepth: number
  center: THREE.Vector3
}

interface BoxRect {
  from: [number, number]
  size: [number, number]
}

interface BuildContext {
  uvWidth: number
  uvHeight: number
  material: THREE.MeshLambertMaterial
}

interface MeshCorner {
  x: number
  y: number
  z: number
  u: number
  v: number
}

interface GeometryWriter {
  positions: number[]
  normals: number[]
  uvs: number[]
}

const ORIGIN: FiguraVec3 = { x: 0, y: 0, z: 0 }
const FALLBACK_UV: [number, number] = [0, 0]

function coord(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, value))
}

function uvSizeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, MIN_UV_SIZE), MAX_COORD) : fallback
}

function cubeBoxOf(node: FiguraCubeNode): CubeBox {
  const fromX = coord(node.from.x)
  const fromY = coord(node.from.y)
  const fromZ = coord(node.from.z)
  const toX = coord(node.to.x)
  const toY = coord(node.to.y)
  const toZ = coord(node.to.z)
  const inflate = coord(node.inflate)
  const uvWidth = Math.abs(toX - fromX)
  const uvHeight = Math.abs(toY - fromY)
  const uvDepth = Math.abs(toZ - fromZ)
  return {
    width: Math.max(uvWidth + inflate * 2, MIN_SIZE),
    height: Math.max(uvHeight + inflate * 2, MIN_SIZE),
    depth: Math.max(uvDepth + inflate * 2, MIN_SIZE),
    uvWidth,
    uvHeight,
    uvDepth,
    center: new THREE.Vector3(
      coord((fromX + toX) / 2 - coord(node.origin.x)),
      coord((fromY + toY) / 2 - coord(node.origin.y)),
      coord((fromZ + toZ) / 2 - coord(node.origin.z)),
    ),
  }
}

function boxRectTable(box: CubeBox): Record<string, BoxRect> {
  const { uvWidth: width, uvHeight: height, uvDepth: depth } = box
  return {
    east: { from: [0, depth], size: [depth, height] },
    west: { from: [depth + width, depth], size: [depth, height] },
    up: { from: [depth + width, depth], size: [-width, -depth] },
    down: { from: [depth + width * 2, 0], size: [-width, depth] },
    south: { from: [depth * 2 + width, depth], size: [width, height] },
    north: { from: [depth, depth], size: [width, height] },
  }
}

function boxUvRect(direction: string, node: FiguraCubeNode, table: Record<string, BoxRect>): FiguraUvQuad {
  const definition = table[direction] ?? table.north
  if (definition === undefined) return [0, 0, 0, 0]
  const [fromU, fromV] = definition.from
  const [sizeU, sizeV] = definition.size
  const [offsetU, offsetV] = node.uvOffset
  const startU = node.mirrorUv ? mirroredStartU(direction, definition, table) : fromU
  const width = node.mirrorUv ? mirroredWidth(direction, sizeU, table) : sizeU
  return [startU + offsetU, fromV + offsetV, startU + width + offsetU, fromV + sizeV + offsetV]
}

function oppositeRect(direction: string, table: Record<string, BoxRect>): BoxRect | undefined {
  if (direction !== 'east' && direction !== 'west') return undefined
  return table[direction === 'east' ? 'west' : 'east']
}

function mirroredStartU(direction: string, definition: BoxRect, table: Record<string, BoxRect>): number {
  const other = oppositeRect(direction, table)
  return other === undefined ? definition.from[0] + definition.size[0] : other.from[0] + other.size[0]
}

function mirroredWidth(direction: string, sizeU: number, table: Record<string, BoxRect>): number {
  const other = oppositeRect(direction, table)
  return other === undefined ? -sizeU : -other.size[0]
}

function rotateQuad(quad: Quad): Quad {
  const [first, second, third, fourth] = quad
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return quad
  return [third, first, fourth, second]
}

function rotationSteps(rotation: number): number {
  return Math.floor((((coord(rotation) % 360) + 360) % 360) / 90)
}

function quadOf(rect: FiguraUvQuad, rotation: number, context: BuildContext): Quad {
  const [u1, v1, u2, v2] = rect
  const top = 1 - coord(v1) / context.uvHeight
  const bottom = 1 - coord(v2) / context.uvHeight
  let quad: Quad = [
    [coord(u1) / context.uvWidth, top],
    [coord(u2) / context.uvWidth, top],
    [coord(u1) / context.uvWidth, bottom],
    [coord(u2) / context.uvWidth, bottom],
  ]
  let steps = rotationSteps(rotation)
  while (steps > 0) {
    quad = rotateQuad(quad)
    steps -= 1
  }
  return quad
}

function faceRectOf(node: FiguraCubeNode, direction: string, face: FiguraCubeFace): FiguraUvQuad {
  if (!node.boxUv) return face.uv
  return boxUvRect(direction, node, boxRectTable(cubeBoxOf(node)))
}

function applyCubeUvs(geo: THREE.BoxGeometry, node: FiguraCubeNode, context: BuildContext): void {
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
  CUBE_FACE_ORDER.forEach((direction, faceIndex) => {
    const face = node.faces[direction]
    if (face === undefined) return
    setFaceQuad(uvAttr, faceIndex * 4, quadOf(faceRectOf(node, direction, face), face.rotation, context))
  })
  uvAttr.needsUpdate = true
}

function dropDisabledFaces(geo: THREE.BoxGeometry, node: FiguraCubeNode): void {
  const source = geo.getIndex()
  if (source === null || Object.keys(node.faces).length === 0) return
  const indices: number[] = []
  CUBE_FACE_ORDER.forEach((direction, faceIndex) => {
    const face = node.faces[direction]
    if (face !== undefined && face.texture === null) return
    for (let offset = 0; offset < 6; offset++) indices.push(source.getX(faceIndex * 6 + offset))
  })
  if (indices.length === 0) return
  geo.setIndex(indices)
}

function buildCubeMesh(node: FiguraCubeNode, context: BuildContext): THREE.Mesh {
  const box = cubeBoxOf(node)
  const geo = new THREE.BoxGeometry(box.width, box.height, box.depth)
  geo.translate(box.center.x, box.center.y, box.center.z)
  applyCubeUvs(geo, node, context)
  dropDisabledFaces(geo, node)
  return new THREE.Mesh(geo, context.material)
}

function cornersOfFace(node: FiguraMeshNode, face: FiguraMeshFace, context: BuildContext): MeshCorner[] {
  const corners: MeshCorner[] = []
  for (const key of face.vertices) {
    const vertex = node.vertices[key]
    if (vertex === undefined) continue
    const [u, v] = face.uv[key] ?? FALLBACK_UV
    corners.push({
      x: coord(vertex.x),
      y: coord(vertex.y),
      z: coord(vertex.z),
      u: coord(u) / context.uvWidth,
      v: 1 - coord(v) / context.uvHeight,
    })
  }
  return corners
}

function faceNormalOf(corners: MeshCorner[]): THREE.Vector3 {
  const [first, second, third] = corners
  if (first === undefined || second === undefined || third === undefined) return new THREE.Vector3(0, 1, 0)
  const edgeA = new THREE.Vector3(second.x - first.x, second.y - first.y, second.z - first.z)
  const edgeB = new THREE.Vector3(third.x - first.x, third.y - first.y, third.z - first.z)
  const normal = new THREE.Vector3().crossVectors(edgeA, edgeB)
  const length = normal.length()
  if (!Number.isFinite(length) || length === 0) return new THREE.Vector3(0, 1, 0)
  return normal.divideScalar(length)
}

function pushTriangle(writer: GeometryWriter, corners: MeshCorner[], normal: THREE.Vector3): void {
  for (const corner of corners) {
    writer.positions.push(corner.x, corner.y, corner.z)
    writer.normals.push(normal.x, normal.y, normal.z)
    writer.uvs.push(corner.u, corner.v)
  }
}

function pushFace(writer: GeometryWriter, corners: MeshCorner[]): void {
  const [first] = corners
  if (first === undefined || corners.length < 3) return
  const normal = faceNormalOf(corners)
  for (let index = 1; index < corners.length - 1; index++) {
    const second = corners[index]
    const third = corners[index + 1]
    if (second === undefined || third === undefined) continue
    pushTriangle(writer, [first, second, third], normal)
  }
}

function buildMeshGeometry(node: FiguraMeshNode, context: BuildContext): THREE.BufferGeometry {
  const writer: GeometryWriter = { positions: [], normals: [], uvs: [] }
  for (const face of Object.values(node.faces)) {
    if (face.texture === null || face.vertices.length < 3) continue
    pushFace(writer, cornersOfFace(node, face, context))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(writer.positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(writer.normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(writer.uvs, 2))
  return geo
}

function offsetOf(origin: FiguraVec3, parentOrigin: FiguraVec3): THREE.Vector3 {
  return new THREE.Vector3(
    coord(origin.x - parentOrigin.x),
    coord(origin.y - parentOrigin.y),
    coord(origin.z - parentOrigin.z),
  )
}

function buildEntryObject(entry: FiguraEntry, parentOrigin: FiguraVec3, context: BuildContext): THREE.Group {
  const group = new THREE.Group()
  group.name = entry.name
  group.position.copy(offsetOf(entry.origin, parentOrigin))
  group.rotation.set(
    THREE.MathUtils.degToRad(coord(entry.rotation.x)),
    THREE.MathUtils.degToRad(coord(entry.rotation.y)),
    THREE.MathUtils.degToRad(coord(entry.rotation.z)),
    'ZYX',
  )
  group.visible = entry.visible
  group.userData.uuid = entry.uuid
  group.userData.kind = entry.kind
  if (entry.kind === 'cube') {
    group.add(buildCubeMesh(entry, context))
    return group
  }
  if (entry.kind === 'mesh') {
    group.add(new THREE.Mesh(buildMeshGeometry(entry, context), context.material))
    return group
  }
  entry.children.forEach((child) => {
    group.add(buildEntryObject(child, entry.origin, context))
  })
  return group
}

function createContext(model: FiguraModel, texture: THREE.Texture): BuildContext {
  return {
    uvWidth: uvSizeOr(model.textureSize.width, uvSizeOr(model.resolution.width, DEFAULT_UV_SIZE)),
    uvHeight: uvSizeOr(model.textureSize.height, uvSizeOr(model.resolution.height, DEFAULT_UV_SIZE)),
    material: new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
    }),
  }
}

function centerRoot(rootGroup: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(rootGroup)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  rootGroup.position.set(-coord(center.x), -coord(center.y), -coord(center.z))
}

export function buildFiguraModel(model: FiguraModel, texture: THREE.Texture): THREE.Group {
  const rootGroup = new THREE.Group()
  const context = createContext(model, texture)
  model.roots.forEach((entry) => {
    rootGroup.add(buildEntryObject(entry, ORIGIN, context))
  })
  centerRoot(rootGroup)
  return rootGroup
}
