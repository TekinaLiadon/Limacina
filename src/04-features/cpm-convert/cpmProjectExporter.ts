import { CpmBinaryWriter, HEADER, bytesToBase64 } from './cpmBinaryWriter'
import JSZip from 'jszip'
import type { CPMChild, CPMConfig, CPMElement, CPMFaceUV } from '@/05-entities/core/types'

const PT = {
  END: 0, PLAYER: 1, DEFINITION: 3, SKIN: 5, PLAYER_PARTPOS: 7,
  RENDER_EFFECT: 8, SKIN_TYPE: 11, MODEL_ROOT: 12, DUP_ROOT: 14,
}

const RE = {
  GLOW: 0, SCALE: 1, HIDE: 2, COLOR: 3, SINGLE_TEX: 4,
  PER_FACE_UV: 5, UV_OVERFLOW: 6, HIDE_SKULL: 8, REMOVE_ARMOR_OFFSET: 9,
  EXTRUDE: 10, SCALING: 13, DISABLE_VANILLA: 16, REMOVE_BED_OFFSET: 17, INVIS_GLOW: 18,
}

const ROOT_MODEL_TYPE: Record<string, number> = {
  cape: 0, elytra_left: 1, elytra_right: 2,
  armor_helmet: 3, armor_body: 4, armor_left_arm: 5, armor_right_arm: 6,
  armor_leggings_body: 7, armor_left_leg: 8, armor_right_leg: 9,
  armor_left_foot: 10, armor_right_foot: 11,
}

const PLAYER_PART_INDEX: Record<string, number> = {
  head: 0, body: 1, left_arm: 2, right_arm: 3, left_leg: 4, right_leg: 5, custom_part: 6,
}

const ROT_ORDINAL: Record<string, number> = { '0': 0, '90': 1, '180': 2, '270': 3 }
const FACE_ORDER = ['up', 'down', 'north', 'south', 'east', 'west']

interface V1Cube {
  size: { x: number; y: number; z: number }
  pos: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  parentId: number
  id: number
  texSize: number
  u: number
  v: number
  rgb: number
}

function parseHexColor(color: string | undefined): number {
  if (!color) return 0
  const value = parseInt(color, 16)
  if (Number.isNaN(value)) return 0
  return value
}

function texSizeOf(child: CPMChild): number {
  if (child.texture === false) return 0
  const ts = child.textureSize ?? 1
  return child.mirror ? -Math.abs(ts) : ts
}

function writeVec3ub(w: CpmBinaryWriter, v: { x: number; y: number; z: number }): void {
  const clamp = (val: number): number => Math.max(0, Math.min(255, Math.round(val * 10)))
  w.writeByte(clamp(v.x))
  w.writeByte(clamp(v.y))
  w.writeByte(clamp(v.z))
}

function writeCubeV1(w: CpmBinaryWriter, cube: V1Cube): void {
  writeVec3ub(w, cube.size)
  w.writeVec6b(cube.pos)
  w.writeVec6b(cube.offset)
  w.writeAngle(cube.rotation)
  w.writeVarInt(cube.parentId)
  w.writeByte(cube.texSize)
  if (cube.texSize === 0) {
    w.writeByte((cube.rgb >>> 16) & 0xFF)
    w.writeByte((cube.rgb >>> 8) & 0xFF)
    w.writeByte(cube.rgb & 0xFF)
  } else {
    w.writeByte(cube.u & 0xFF)
    w.writeByte(cube.v & 0xFF)
  }
}

function writeFaceUVs(w: CpmBinaryWriter, faceUV: Record<string, CPMFaceUV>): void {
  let bits = 0
  FACE_ORDER.forEach((dir, i) => {
    if (faceUV[dir]) bits |= 1 << i
  })
  w.writeByte(bits)
  FACE_ORDER.forEach((dir) => {
    const f = faceUV[dir]
    if (!f) return
    w.writeVarInt(Math.round(f.sx))
    w.writeVarInt(Math.round(f.sy))
    w.writeVarInt(Math.round(f.ex))
    w.writeVarInt(Math.round(f.ey))
    w.writeEnum(ROT_ORDINAL[f.rot] ?? 0)
  })
}

function epsilonVec(v: { x: number; y: number; z: number } | undefined, eps: number): boolean {
  if (!v) return true
  return Math.abs(v.x) < eps && Math.abs(v.y) < eps && Math.abs(v.z) < eps
}

function vecNear(v: { x: number; y: number; z: number } | undefined, base: number, eps: number): boolean {
  if (!v) return base === 1
  return Math.abs(v.x - base) < eps && Math.abs(v.y - base) < eps && Math.abs(v.z - base) < eps
}

function pngSize(png: Uint8Array): { w: number; h: number } {
  const w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]
  const h = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]
  return { w, h }
}

interface FlatModel {
  cubes: V1Cube[]
  elementIds: Map<CPMElement | CPMChild, number>
}

function flatten(config: CPMConfig): FlatModel {
  const cubes: V1Cube[] = []
  const elementIds = new Map<CPMElement | CPMChild, number>()
  let nextId = 10

  const walk = (elements: (CPMElement | CPMChild)[], parentId: number): void => {
    for (const el of elements) {
      if ('id' in el) {
        const root = el as CPMElement
        if (root.customPart === true || root.dup === true) {
          const fakeId = nextId++
          elementIds.set(root, fakeId)
          cubes.push({
            size: { x: 0, y: 0, z: 0 },
            pos: root.pos ?? { x: 0, y: 0, z: 0 },
            offset: { x: 0, y: 0, z: 0 },
            rotation: root.rotation ?? { x: 0, y: 0, z: 0 },
            parentId: PLAYER_PART_INDEX.custom_part,
            id: fakeId,
            texSize: 0,
            u: 0,
            v: 0,
            rgb: 0,
          })
          walk(root.children ?? [], fakeId)
          continue
        }
        const ordinal = PLAYER_PART_INDEX[root.id] ?? 0
        elementIds.set(root, ordinal)
        walk(root.children ?? [], ordinal)
        continue
      }
      const child = el as CPMChild
      const id = nextId++
      elementIds.set(child, id)
      cubes.push({
        size: child.size ?? { x: 0, y: 0, z: 0 },
        pos: child.pos ?? { x: 0, y: 0, z: 0 },
        offset: child.offset ?? { x: 0, y: 0, z: 0 },
        rotation: child.rotation ?? { x: 0, y: 0, z: 0 },
        parentId,
        id,
        texSize: texSizeOf(child),
        u: child.u ?? 0,
        v: child.v ?? 0,
        rgb: parseHexColor(child.color),
      })
      walk(child.children ?? [], id)
    }
  }

  walk(config.elements ?? [], 0)
  return { cubes, elementIds }
}

export async function cpmProjectToBase64(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')
  const config: CPMConfig = JSON.parse(await configFile.async('string'))
  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? new Uint8Array(await skinFile.async('arraybuffer')) : null
  return cpmConfigToBase64(config, skinPng)
}

export function cpmConfigToBase64(config: CPMConfig, skinPng: Uint8Array | null = null): string {
  const { cubes, elementIds } = flatten(config)

  const def = new CpmBinaryWriter()
  def.writeVarInt(cubes.length)
  const sorted = [...cubes].sort((a, b) => a.id - b.id)
  for (const cube of sorted) {
    writeCubeV1(def, cube)
  }

  const keepBits = new Array(8).fill(false)
  for (const el of config.elements ?? []) {
    if (el.customPart === true || el.dup === true) continue
    const idx = PLAYER_PART_INDEX[el.id]
    if (idx === undefined) continue
    keepBits[idx] = el.show !== false
  }
  def.writeObjectBlock(PT.PLAYER, (w) => {
    let v = 0
    keepBits.forEach((keep, i) => {
      if (keep) v |= 1 << i
    })
    w.writeByte(v)
  })

  if (skinPng) {
    def.writeObjectBlock(PT.SKIN, (w) => {
      const { w: pw, h: ph } = pngSize(skinPng)
      w.writeShort(pw)
      w.writeShort(ph)
      w.writeVarInt(skinPng.length)
      w.writeBytes(skinPng)
    })
  }

  for (const el of config.elements ?? []) {
    if (el.customPart === true || el.dup === true) continue
    if (PLAYER_PART_INDEX[el.id] === undefined) continue
    if (!epsilonVec(el.pos, 0.1) || !epsilonVec(el.rotation, 0.1)) {
      const id = elementIds.get(el) ?? 0
      def.writeObjectBlock(PT.PLAYER_PARTPOS, (w) => {
        w.writeVarInt(id)
        w.writeVec6b(el.pos ?? { x: 0, y: 0, z: 0 })
        w.writeAngle(el.rotation ?? { x: 0, y: 0, z: 0 })
      })
    }
  }

  const writeChildEffects = (child: CPMChild): void => {
    const id = elementIds.get(child) ?? 0
    const rgb = parseHexColor(child.color)

    if (child.glow) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.GLOW)
        w.writeVarInt(id)
      })
    }
    const meshScale = child.scale
    const mcScale = child.mcScale ?? 0
    if (Math.abs(mcScale) > 0.0001 || !vecNear(meshScale, 1, 0.001)) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.SCALE)
        w.writeVarInt(id)
        w.writeFloat2(mcScale)
        w.writeVec6b(meshScale ?? { x: 1, y: 1, z: 1 })
      })
    }
    if (child.hidden === true) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.HIDE)
        w.writeVarInt(id)
      })
    }
    if (child.recolor) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.COLOR)
        w.writeVarInt(id)
        w.writeByte((rgb >>> 16) & 0xFF)
        w.writeByte((rgb >>> 8) & 0xFF)
        w.writeByte(rgb & 0xFF)
      })
    }
    if (child.singleTex) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.SINGLE_TEX)
        w.writeVarInt(id)
      })
    }
    if (child.extrude) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.EXTRUDE)
        w.writeVarInt(id)
      })
    }
    if (child.faceUV && Object.keys(child.faceUV).length > 0) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.PER_FACE_UV)
        w.writeVarInt(id)
        writeFaceUVs(w, child.faceUV as Record<string, CPMFaceUV>)
      })
    } else if ((child.u ?? 0) > 255 || (child.v ?? 0) > 255) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.UV_OVERFLOW)
        w.writeVarInt(id)
        w.writeVarInt(child.u ?? 0)
        w.writeVarInt(child.v ?? 0)
      })
    }
  }

  const walkEffects = (elements: (CPMElement | CPMChild)[]): void => {
    for (const el of elements) {
      if ('id' in el) {
        const root = el as CPMElement
        walkEffects(root.children ?? [])
      } else {
        const child = el as CPMChild
        writeChildEffects(child)
        walkEffects(child.children ?? [])
      }
    }
  }
  walkEffects(config.elements ?? [])

  for (const el of config.elements ?? []) {
    const id = elementIds.get(el) ?? 0
    if (el.dup === true) {
      if (el.show === false) {
        def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
          w.writeEnum(RE.HIDE)
          w.writeVarInt(id)
        })
      }
      def.writeObjectBlock(PT.DUP_ROOT, (w) => {
        w.writeVarInt(id)
        w.writeEnum(PLAYER_PART_INDEX[el.id] ?? 0)
      })
    } else if (el.customPart === true) {
      if (el.show === false) {
        def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
          w.writeEnum(RE.HIDE)
          w.writeVarInt(id)
        })
      }
      def.writeObjectBlock(PT.MODEL_ROOT, (w) => {
        w.writeVarInt(id)
        w.writeEnum(ROOT_MODEL_TYPE[el.id] ?? 0)
      })
    }
    if (el.disableVanillaAnim === true) {
      def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.DISABLE_VANILLA)
        w.writeVarInt(id)
      })
    }
  }

  const scaling = config.scaling ?? 1
  if (scaling !== 0 && scaling !== 1) {
    def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.SCALING)
      w.writeEnum(0)
      w.writeFloat2(scaling)
    })
  }

  if (config.hideHeadIfSkull !== true) {
    def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.HIDE_SKULL)
      w.writeByte(0)
    })
  }

  if (config.removeArmorOffset === true) {
    def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.REMOVE_ARMOR_OFFSET)
      w.writeByte(1)
    })
  }

  if (config.removeBedOffset === true) {
    def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.REMOVE_BED_OFFSET)
    })
  }

  if (config.enableInvisGlow === true) {
    def.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.INVIS_GLOW)
    })
  }

  def.writeObjectBlock(PT.END, () => {})

  const w = new CpmBinaryWriter()
  w.writeByte(HEADER)
  w.writeObjectBlock(PT.SKIN_TYPE, (ww) => {
    ww.writeByte(config.skinType === 'slim' ? 0 : 1)
  })
  w.writeObjectBlock(PT.DEFINITION, (ww) => {
    ww.writeBytes(def.toArray())
  })
  w.writeObjectBlock(PT.END, () => {})

  const raw = w.toArray()
  let checksum = 0
  for (let i = 1; i < raw.length; i++) checksum = (checksum + raw[i]) & 0xFFFF

  const result = new Uint8Array(raw.length + 2)
  result.set(raw)
  result[raw.length] = (checksum >>> 8) & 0xFF
  result[raw.length + 1] = checksum & 0xFF

  return bytesToBase64(result)
}
