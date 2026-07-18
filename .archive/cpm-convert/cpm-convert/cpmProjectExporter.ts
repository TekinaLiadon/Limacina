import { CpmBinaryWriter, HEADER } from './cpmBinaryWriter'
import { writeCubeV1 } from './cpmCubeWriter'
import type { CpmCube } from './cpmCubeWriter'
import type { CpmConfig } from './cpmTypes'
import type { ModelPartAnimation } from './cpmAnimSerializer'
import { writeAnimationPart } from './cpmAnimSerializer'
import { exportAnimations } from './cpmAnimExporter'
import JSZip from 'jszip'

const PT = {
  END: 0, TEMPLATE: 2, RENDER_EFFECT: 8, SKIN_TYPE: 11,
  CLONEABLE: 15, TEXTURE: 17, ANIMATED_TEX: 18, TAGS: 19,
  CUBES: 21, ROOT_INFO: 22, ANIMATION_NEW: 23,
}

const RE = {
  GLOW: 0, SCALE: 1, HIDE: 2, COLOR: 3, SINGLE_TEX: 4,
  PER_FACE_UV: 5, UV_OVERFLOW: 6, ITEM: 7, HIDE_SKULL: 8,
  REMOVE_ARMOR_OFFSET: 9, EXTRUDE: 10, PLAYER_SCALE: 11,
  MODEL_SCALE: 12, SCALING: 13, COPY_TRANSFORM: 14,
  FIRST_PERSON_HAND: 15, DISABLE_VANILLA: 16, REMOVE_BED_OFFSET: 17,
  INVIS_GLOW: 18,
}

const TEX_SHEET = { SKIN: 0 }

let nextId = 10

function childToCube(child: Record<string, unknown>, parentId: number): CpmCube {
  const size = (child.size as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 }
  const pos = (child.pos as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 }
  const offset = (child.offset as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 }
  const rotation = (child.rotation as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 }
  const meshScale = (child.scale as { x: number; y: number; z: number }) ?? { x: 1, y: 1, z: 1 }
  const scale = (child.rscale as { x: number; y: number; z: number }) ?? { x: 1, y: 1, z: 1 }

  let rgb = 0xFFFFFFFF
  const texSize = (child.textureSize as number) ?? 0
  if (child.color && typeof child.color === 'string') {
    rgb = parseInt(child.color, 16)
    if ((rgb >>> 24) === 0) rgb |= 0xFF000000
  }

  return {
    size, pos, offset, rotation, meshScale, scale,
    parentId, id: nextId++, texSize,
    u: (child.u as number) ?? 0,
    v: (child.v as number) ?? 0,
    rgb, mcScale: (child.mcScale as number) ?? 0,
    hidden: (child.hidden as boolean) ?? false,
  }
}

function writeEffects(w: CpmBinaryWriter, children: Record<string, unknown>[]): void {
  for (const c of children) {
    const id = (c._cubeId as number) ?? 0
    if (c.glow) w.writeObjectBlock(PT.RENDER_EFFECT, (w) => { w.writeEnum(RE.GLOW); w.writeVarInt(id) })
    if (c.recolor) w.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
      w.writeEnum(RE.COLOR); w.writeVarInt(id)
      let cl = parseInt((c.color as string) ?? 'ffffff', 16)
      if ((cl >>> 24) === 0) cl |= 0xFF000000
      w.writeByte((cl >>> 16) & 0xFF); w.writeByte((cl >>> 8) & 0xFF); w.writeByte((cl >>> 0) & 0xFF)
    })
    if (c.singleTex) w.writeObjectBlock(PT.RENDER_EFFECT, (w) => { w.writeEnum(RE.SINGLE_TEX); w.writeVarInt(id) })
    if (c.extrude) w.writeObjectBlock(PT.RENDER_EFFECT, (w) => { w.writeEnum(RE.EXTRUDE); w.writeVarInt(id) })
  }
}

function writeSkinTexture(w: CpmBinaryWriter, skinPng: Uint8Array): void {
  w.writeObjectBlock(PT.TEXTURE, (w) => {
    w.writeEnum(TEX_SHEET.SKIN)
    w.writeShort(64)
    w.writeShort(64)
    w.writeVarInt(skinPng.length)
    w.writeBytes(skinPng)
  })
}

function writeScalingEffect(w: CpmBinaryWriter, scaling: number): void {
  if (!scaling || scaling === 1) return
  w.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
    w.writeEnum(RE.SCALING)
    w.writeVarFloat(scaling)
  })
}

function writeScaleEffect(
  w: CpmBinaryWriter,
  pos: { x: number; y: number; z: number },
  rot: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
): void {
  const changed = Math.abs(pos.x) > 0.001 || Math.abs(pos.y) > 0.001 || Math.abs(pos.z) > 0.001 ||
    Math.abs(rot.x) > 0.001 || Math.abs(rot.y) > 0.001 || Math.abs(rot.z) > 0.001 ||
    Math.abs(scale.x - 1) > 0.001 || Math.abs(scale.y - 1) > 0.001 || Math.abs(scale.z - 1) > 0.001
  if (!changed) return
  w.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
    w.writeEnum(RE.MODEL_SCALE)
    w.writeVarVec3(pos)
    w.writeAngle(rot)
    w.writeVarVec3(scale)
  })
}

export async function cpmProjectToBase64(filePath: string): Promise<string> {
  const response = await fetch(filePath)
  const data = await response.arrayBuffer()
  return cpmArrayBufferToBase64(data)
}

export async function cpmArrayBufferToBase64(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  const configFile = zip.file('config.json')
  if (!configFile) throw new Error('ZIP не содержит config.json')
  const config: CpmConfig = JSON.parse(await configFile.async('string'))

  const skinFile = zip.file('skin.png')
  const skinPng = skinFile ? new Uint8Array(await skinFile.async('arraybuffer')) : null

  const animationFiles: Record<string, unknown> = {}
  const animFiles = zip.folder('animations')
  if (animFiles) {
    animFiles.forEach((relativePath, file) => {
      if (relativePath.endsWith('.json')) {
        animationFiles[relativePath] = file
      }
    })
  }

  const parsedAnimations: Record<string, unknown> = {}
  for (const [name, file] of Object.entries(animationFiles)) {
    try {
      const content = await (file as JSZip.JSZipObject).async('string')
      parsedAnimations[name] = JSON.parse(content)
    } catch {
      // skip broken animation files
    }
  }

  let animPart: ModelPartAnimation | null = null
  if (Object.keys(parsedAnimations).length > 0) {
    const animEncFile = zip.file('anim_enc.json')
    let animEnc: { freeLayers?: string[]; defaultValues?: Record<string, boolean> } | undefined
    if (animEncFile) {
      try {
        animEnc = JSON.parse(await animEncFile.async('string'))
      } catch { /* skip */ }
    }
    animPart = exportAnimations(parsedAnimations as Record<string, { name?: string; hidden?: boolean; frames?: unknown[]; duration?: number; priority?: number; loop?: boolean; interpolator?: string; additive?: boolean; mustFinish?: boolean; layerDefault?: number; order?: number; isProperty?: boolean; command?: boolean; layerControlled?: boolean; maxValue?: number; interpolateVal?: boolean }>, animEnc)
  }

  return cpmConfigToBase64(config, skinPng, animPart)
}

export function cpmConfigToBase64(config: CpmConfig, skinPng: Uint8Array | null = null, animPart: ModelPartAnimation | null = null): string {
  const w = new CpmBinaryWriter()
  nextId = 10

  w.writeByte(HEADER)

  const allCubes: CpmCube[] = []
  const cubeIdMap: Record<string, number> = {}
  const elemOrder: string[] = []

  if (config.elements) {
    for (const elem of config.elements) {
      const elemId = nextId++
      cubeIdMap[elem.id] = elemId
      elemOrder.push(elem.id)

      if (elem.children && elem.children.length > 0) {
        for (const child of elem.children) {
          const cubeId = nextId++
          allCubes.push(childToCube(child as unknown as Record<string, unknown>, elemId))
          ;(child as unknown as Record<string, unknown>)._cubeId = cubeId - 1
        }
      }
    }
  }

  w.writeVarInt(allCubes.length)
  for (const cube of allCubes) {
    writeCubeV1(w, cube)
  }

  if (config.elements) {
    for (const elem of config.elements) {
      if (elem.children && elem.children.length > 0) {
        writeEffects(w, elem.children as unknown as Record<string, unknown>[])
      }
    }
  }

  if (skinPng) {
    writeSkinTexture(w, skinPng)
  }

  const scaling = config.scaling
  if (scaling && scaling !== 1) {
    writeScalingEffect(w, scaling)
  }

  if (config.scalingEx) {
    const se = config.scalingEx as Record<string, unknown>
    const rs = se.render_scale as { x: number; y: number; z: number } | undefined
    const rp = se.render_position as { x: number; y: number; z: number } | undefined
    const rr = se.render_rotation as { x: number; y: number; z: number } | undefined
    if (rs || rp || rr) {
      writeScaleEffect(
        w,
        rp ?? { x: 0, y: 0, z: 0 },
        rr ?? { x: 0, y: 0, z: 0 },
        rs ?? { x: 1, y: 1, z: 1 },
      )
    }
  }

  if (config.firstPersonHand) {
    const fph = config.firstPersonHand as Record<string, Record<string, { x: number; y: number; z: number }>>
    const left = fph.left
    const right = fph.right
    const leftChanged = left && (Math.abs(left.position.x) > 0.001 || Math.abs(left.position.y) > 0.001 ||
      Math.abs(left.position.z) > 0.001 || Math.abs(left.rotation.x) > 0.001 || Math.abs(left.rotation.y) > 0.001 ||
      Math.abs(left.rotation.z) > 0.001 || Math.abs(left.scale.x) > 0.001 || Math.abs(left.scale.y) > 0.001 ||
      Math.abs(left.scale.z) > 0.001)
    const rightChanged = right && (Math.abs(right.position.x) > 0.001 || Math.abs(right.position.y) > 0.001 ||
      Math.abs(right.position.z) > 0.001 || Math.abs(right.rotation.x) > 0.001 || Math.abs(right.rotation.y) > 0.001 ||
      Math.abs(right.rotation.z) > 0.001 || Math.abs(right.scale.x) > 0.001 || Math.abs(right.scale.y) > 0.001 ||
      Math.abs(right.scale.z) > 0.001)
    if (leftChanged || rightChanged) {
      w.writeObjectBlock(PT.RENDER_EFFECT, (w) => {
        w.writeEnum(RE.FIRST_PERSON_HAND)
        const lPos = left?.position ?? { x: 0, y: 0, z: 0 }
        const lRot = left?.rotation ?? { x: 0, y: 0, z: 0 }
        const lScl = left?.scale ?? { x: 0, y: 0, z: 0 }
        const rPos = right?.position ?? { x: 0, y: 0, z: 0 }
        const rRot = right?.rotation ?? { x: 0, y: 0, z: 0 }
        const rScl = right?.scale ?? { x: 0, y: 0, z: 0 }
        w.writeVarVec3(lPos)
        w.writeAngle(lRot)
        w.writeVarVec3(lScl)
        w.writeVarVec3(rPos)
        w.writeAngle(rRot)
        w.writeVarVec3(rScl)
      })
    }
  }

  if (animPart) {
    writeAnimationPart(w, animPart)
  }

  w.writeObjectBlock(PT.END, () => {})

  const raw = w.toArray()
  let sum = 0
  for (let i = 0; i < raw.length; i++) sum = (sum + raw[i]) & 0xFFFF
  const checksum = new Uint8Array([(sum >>> 8) & 0xFF, (sum >>> 0) & 0xFF])

  const result = new Uint8Array(raw.length + checksum.length)
  result.set(raw)
  result.set(checksum, raw.length)

  let binary = ''
  for (let i = 0; i < result.length; i++) binary += String.fromCharCode(result[i])
  return btoa(binary)
}
