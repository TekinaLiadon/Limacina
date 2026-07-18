import type { CpmBinaryWriter } from './cpmBinaryWriter'

export interface CpmCube {
  size: { x: number; y: number; z: number }
  pos: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  meshScale?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  parentId: number
  id: number
  texSize: number
  u: number
  v: number
  rgb: number
  mcScale: number
  hidden: boolean
}

export function writeCubeV1(writer: CpmBinaryWriter, cube: CpmCube): void {
  writer.writeVec3ub(cube.size)
  writer.writeVec6b(cube.pos)
  writer.writeVec6b(cube.offset)

  let rot = { ...cube.rotation }
  if (rot.x < 0 || rot.x > 360 || rot.y < 0 || rot.y > 360 || rot.z < 0 || rot.z > 360) {
    while (rot.x < 0) rot.x += 360
    while (rot.x >= 360) rot.x -= 360
    while (rot.y < 0) rot.y += 360
    while (rot.y >= 360) rot.y -= 360
    while (rot.z < 0) rot.z += 360
    while (rot.z >= 360) rot.z -= 360
  }
  writer.writeAngle(rot)
  writer.writeVarInt(cube.parentId)
  writer.writeByte(cube.texSize)

  if (cube.texSize === 0) {
    writer.writeByte((cube.rgb >>> 16) & 0xFF)
    writer.writeByte((cube.rgb >>> 8) & 0xFF)
    writer.writeByte((cube.rgb >>> 0) & 0xFF)
  } else {
    writer.writeByte(cube.u)
    writer.writeByte(cube.v)
  }
}
