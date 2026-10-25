import { LOGICAL_ATLAS_SIZE } from './presetTypes'
import { decodePngSkin, type SkinImage } from './skinPng'

interface LimbCopy {
  sx: number
  sy: number
  dx: number
  dy: number
}

interface FaceCopy {
  srcX: number
  dstX: number
  y: number
  w: number
  h: number
}

const LEGACY_LIMB_COPIES: LimbCopy[] = [
  { sx: 0, sy: 16, dx: 16, dy: 48 },
  { sx: 40, sy: 16, dx: 32, dy: 48 },
]

const LEGACY_ARM_WIDTH = 4
const LEGACY_DEPTH = 4

const LEGACY_FACE_COPIES: FaceCopy[] = [
  { srcX: 0, dstX: LEGACY_DEPTH + LEGACY_ARM_WIDTH, y: LEGACY_DEPTH, w: LEGACY_DEPTH, h: 12 },
  { srcX: LEGACY_DEPTH + LEGACY_ARM_WIDTH, dstX: 0, y: LEGACY_DEPTH, w: LEGACY_DEPTH, h: 12 },
  { srcX: LEGACY_DEPTH, dstX: LEGACY_DEPTH, y: LEGACY_DEPTH, w: LEGACY_ARM_WIDTH, h: 12 },
  { srcX: LEGACY_DEPTH + LEGACY_ARM_WIDTH + LEGACY_DEPTH, dstX: LEGACY_DEPTH + LEGACY_ARM_WIDTH + LEGACY_DEPTH, y: LEGACY_DEPTH, w: LEGACY_ARM_WIDTH, h: 12 },
  { srcX: LEGACY_DEPTH, dstX: LEGACY_DEPTH, y: 0, w: LEGACY_ARM_WIDTH, h: LEGACY_DEPTH },
  { srcX: LEGACY_DEPTH + LEGACY_ARM_WIDTH, dstX: LEGACY_DEPTH + LEGACY_ARM_WIDTH, y: 0, w: LEGACY_ARM_WIDTH, h: LEGACY_DEPTH },
]

function copyMirroredRect(
  dst: Uint8Array,
  dstWidth: number,
  src: Uint8Array,
  srcWidth: number,
  limb: LimbCopy,
  face: FaceCopy,
  scale: number,
): void {
  const physW = face.w * scale
  const physH = face.h * scale
  for (let y = 0; y < physH; y++) {
    for (let x = 0; x < physW; x++) {
      const srcOffset = (((limb.sy + face.y) * scale + y) * srcWidth + (limb.sx + face.srcX) * scale + x) * 4
      const dstX = (limb.dx + face.dstX) * scale + (physW - 1 - x)
      const dstOffset = (((limb.dy + face.y) * scale + y) * dstWidth + dstX) * 4
      dst[dstOffset] = src[srcOffset] ?? 0
      dst[dstOffset + 1] = src[srcOffset + 1] ?? 0
      dst[dstOffset + 2] = src[srcOffset + 2] ?? 0
      dst[dstOffset + 3] = src[srcOffset + 3] ?? 0
    }
  }
}

export async function normalizeSkin(bytes: Uint8Array): Promise<SkinImage> {
  const image = await decodePngSkin(bytes)
  if (image.height === image.width) return image
  if (image.height * 2 !== image.width || image.width % LOGICAL_ATLAS_SIZE !== 0) {
    throw new Error(`Скин ${image.width}×${image.height} не является квадратным или устаревшим форматом`)
  }

  const scale = image.width / LOGICAL_ATLAS_SIZE
  const rgba = new Uint8Array(image.width * image.width * 4)
  rgba.set(image.rgba)
  for (const limb of LEGACY_LIMB_COPIES) {
    for (const face of LEGACY_FACE_COPIES) {
      copyMirroredRect(rgba, image.width, image.rgba, image.width, limb, face, scale)
    }
  }
  return { width: image.width, height: image.width, rgba }
}
