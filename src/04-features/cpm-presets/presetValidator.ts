import { isRecord } from '@/04-features/cpm-convert/cpmProjectZip'
import { VANILLA_PLAYER_PARTS } from '@/04-features/cpm-viewer/playerParts'
import { getErrorMessage } from '@/06-shared/api'
import type { CPMChild, CPMConfig, CPMElement, CPMFaceUV } from '@/05-entities'
import {
  type PresetMeta,
  LOGICAL_ATLAS_SIZE,
  MAX_CUBE_SIZE,
  MAX_SKIN_SCALE,
  MAX_TEXTURE_SIZE,
  MIN_SKIN_SCALE,
  MIN_TEXTURE_SIZE,
} from './presetTypes'

const FACE_KEYS = ['up', 'down', 'north', 'south', 'east', 'west']
const ROTATIONS = ['0', '90', '180', '270']
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const VANILLA_ROOT_IDS = new Set(VANILLA_PLAYER_PARTS.map((part) => part.id))

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function skinScaleOf(width: number, height: number): number {
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new Error(`Некорректный размер скина ${width}×${height}`)
  }
  if (width % LOGICAL_ATLAS_SIZE !== 0) {
    throw new Error(`Ширина скина ${width} должна быть кратна ${LOGICAL_ATLAS_SIZE}`)
  }
  if (height !== width) {
    throw new Error(`Скин должен быть квадратным ${LOGICAL_ATLAS_SIZE}·S × ${LOGICAL_ATLAS_SIZE}·S, получено ${width}×${height}`)
  }
  const scale = width / LOGICAL_ATLAS_SIZE
  if (scale < MIN_SKIN_SCALE || scale > MAX_SKIN_SCALE) {
    throw new Error(`Масштаб скина S=${scale} вне диапазона ${MIN_SKIN_SCALE}…${MAX_SKIN_SCALE}`)
  }
  return scale
}

function pushAtlasRectErrors(
  errors: string[],
  label: string,
  sx: number, sy: number, ex: number, ey: number,
): void {
  if (
    !isFiniteNumber(sx) || !isFiniteNumber(sy) || !isFiniteNumber(ex) || !isFiniteNumber(ey) ||
    sx < 0 || sy < 0 || ex > LOGICAL_ATLAS_SIZE || ey > LOGICAL_ATLAS_SIZE
  ) {
    errors.push(`${label} выходит за логический атлас ${LOGICAL_ATLAS_SIZE}×${LOGICAL_ATLAS_SIZE}`)
    return
  }
  if (sx >= ex || sy >= ey) {
    errors.push(`${label} должна задавать непустую область`)
  }
}

function pushFaceUVErrors(errors: string[], child: CPMChild, faceUV: Record<string, CPMFaceUV>): void {
  for (const [face, rect] of Object.entries(faceUV)) {
    if (!FACE_KEYS.includes(face)) {
      errors.push(`Грань "${face}" куба "${child.name}" не входит в набор up/down/north/south/east/west`)
      continue
    }
    if (!isRecord(rect)) {
      errors.push(`Грань "${face}" куба "${child.name}" должна быть объектом UV-прямоугольника`)
      continue
    }
    if (typeof rect.rot !== 'string' || !ROTATIONS.includes(rect.rot)) {
      errors.push(`Поворот грани "${face}" куба "${child.name}" должен быть 0, 90, 180 или 270, получено ${rect.rot}`)
    }
    pushAtlasRectErrors(errors, `UV грани "${face}" куба "${child.name}"`, rect.sx as number, rect.sy as number, rect.ex as number, rect.ey as number)
  }
}

function pushBoxUVErrors(errors: string[], child: CPMChild, texSize: number): void {
  const u = child.u ?? 0
  const v = child.v ?? 0
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0) {
    errors.push(`UV куба "${child.name}" должны быть целыми неотрицательными координатами, получено u=${u}, v=${v}`)
    return
  }
  const size = child.size ?? { x: 0, y: 0, z: 0 }
  const dx = Math.ceil(size.x * texSize)
  const dy = Math.ceil(size.y * texSize)
  const dz = Math.ceil(size.z * texSize)
  let extentX: number
  let extentY: number
  if (child.singleTex) {
    const side = Math.max(dx, dy, dz)
    extentX = u * texSize + side
    extentY = v * texSize + side
  } else if (child.extrude) {
    extentX = u * texSize + dx
    extentY = v * texSize + dy
  } else {
    extentX = u * texSize + 2 * dx + 2 * dz
    extentY = v * texSize + dz + dy
  }
  if (extentX > LOGICAL_ATLAS_SIZE || extentY > LOGICAL_ATLAS_SIZE) {
    errors.push(`UV-раскладка куба "${child.name}" выходит за логический атлас ${LOGICAL_ATLAS_SIZE}×${LOGICAL_ATLAS_SIZE}`)
  }
}

function pushCubeErrors(errors: string[], child: CPMChild): void {
  const size = child.size ?? { x: 0, y: 0, z: 0 }
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = size[axis]
    if (!isFiniteNumber(value) || value < 0 || value > MAX_CUBE_SIZE) {
      errors.push(`Размер куба "${child.name}" по оси ${axis} = ${value} вне диапазона 0…${MAX_CUBE_SIZE}`)
    }
  }

  if (child.texture === false) return

  const texSize = child.textureSize ?? 1
  if (!Number.isInteger(texSize)) {
    errors.push(`textureSize куба "${child.name}" должен быть целым числом, получено ${texSize}`)
  } else if (texSize === 0) {
    errors.push(`textureSize куба "${child.name}" не может быть 0 у текстурированного куба, используйте texture: false`)
  } else if (texSize < 1) {
    errors.push(`textureSize куба "${child.name}" не может быть отрицательным у пресета, зеркальность задаётся флагом mirror`)
  } else if (texSize > (child.mirror ? -MIN_TEXTURE_SIZE : MAX_TEXTURE_SIZE)) {
    errors.push(`textureSize куба "${child.name}" = ${texSize} не помещается в байт`)
  }

  if (child.faceUV && Object.keys(child.faceUV).length > 0) {
    pushFaceUVErrors(errors, child, child.faceUV)
  } else {
    pushBoxUVErrors(errors, child, Math.abs(texSize))
  }
}

function walkChildren(errors: string[], children: CPMChild[]): void {
  for (const child of children) {
    pushCubeErrors(errors, child)
    walkChildren(errors, child.children ?? [])
  }
}

function pushRootErrors(errors: string[], root: CPMElement, seenVanillaRoots: Set<string>): void {
  if (root.customPart === true) return

  if (root.dup === true) {
    if (!VANILLA_ROOT_IDS.has(root.id)) {
      errors.push(`dup-корень "${root.id}" должен ссылаться на ванильную часть`)
    }
    return
  }

  if (!VANILLA_ROOT_IDS.has(root.id)) {
    errors.push(`Корень "${root.id}" не сопоставим ванильным частям, отметьте кастомную часть через customPart`)
    return
  }
  if (seenVanillaRoots.has(root.id)) {
    errors.push(`Повторный корень "${root.id}" конфликтует с битами PT.PLAYER`)
  }
  seenVanillaRoots.add(root.id)
}

export function validatePresetConfig(config: CPMConfig): string[] {
  const errors: string[] = []
  if (config.skinSize.x !== LOGICAL_ATLAS_SIZE || config.skinSize.y !== LOGICAL_ATLAS_SIZE) {
    errors.push(`skinSize пресета должен быть ${LOGICAL_ATLAS_SIZE}×${LOGICAL_ATLAS_SIZE}`)
  }

  const elements = config.elements ?? []
  if (elements.length === 0) {
    errors.push('Пресет должен содержать хотя бы один корень')
  }

  const seenVanillaRoots = new Set<string>()
  for (const root of elements) {
    pushRootErrors(errors, root, seenVanillaRoots)
    walkChildren(errors, root.children ?? [])
  }

  return errors
}

export function validatePresetPair(config: CPMConfig, meta: PresetMeta): string[] {
  if (meta.skinType === 'both') return []
  const configSlim = config.skinType === 'slim'
  const declared = config.skinType ?? 'default'
  if (meta.skinType === 'slim' && configSlim) return []
  if (meta.skinType === 'classic' && !configSlim) return []
  return [
    `config.skinType пресета должен быть ${meta.skinType === 'slim' ? 'slim' : 'default'} по meta.skinType "${meta.skinType}", получено ${declared}`,
  ]
}

export function maxPresetSkinScale(config: CPMConfig): number {
  let ceiling = MAX_SKIN_SCALE
  const visit = (children: CPMChild[]): void => {
    for (const child of children) {
      if (child.texture !== false) {
        const texSize = Math.abs(child.textureSize ?? 1)
        if (Number.isFinite(texSize) && texSize >= 1) {
          const numerator = child.mirror ? -MIN_TEXTURE_SIZE : MAX_TEXTURE_SIZE
          const cubeCeiling = Math.floor(numerator / texSize)
          if (cubeCeiling < ceiling) ceiling = cubeCeiling
        }
      }
      visit(child.children ?? [])
    }
  }
  for (const root of config.elements ?? []) visit(root.children ?? [])
  return ceiling
}

export function validatePresetSkinFit(config: CPMConfig, width: number, height: number): string[] {
  let scale: number
  try {
    scale = skinScaleOf(width, height)
  } catch (e: unknown) {
    return [getErrorMessage(e)]
  }
  const ceiling = maxPresetSkinScale(config)
  if (scale > ceiling) {
    const edge = LOGICAL_ATLAS_SIZE * ceiling
    return [`Пресет поддерживает скины до ${edge}×${edge} (S ≤ ${ceiling}): textureSize × S не помещается в байт`]
  }
  return []
}

export function validatePresetMeta(meta: unknown): string[] {
  if (!isRecord(meta)) return ['meta.json пресета должен быть объектом']

  const errors: string[] = []
  const { name, slug, skinType, auxRegions, previewSkin } = meta

  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('name пресета должен быть непустой строкой')
  }
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    errors.push('slug пресета должен быть строкой в kebab-case')
  }
  if (skinType !== 'slim' && skinType !== 'classic' && skinType !== 'both') {
    errors.push('skinType пресета должен быть slim, classic или both')
  }

  if (auxRegions !== undefined) {
    if (!Array.isArray(auxRegions)) {
      errors.push('auxRegions пресета должны быть массивом')
    } else {
      auxRegions.forEach((region: unknown, index: number) => {
        if (!isRecord(region) || typeof region.name !== 'string' || region.name.trim() === '') {
          errors.push(`Имя aux-зоны №${index + 1} должно быть непустой строкой`)
          return
        }
        pushAtlasRectErrors(
          errors,
          `aux-зона "${region.name}"`,
          region.sx as number, region.sy as number, region.ex as number, region.ey as number,
        )
      })
    }
  }

  if (
    previewSkin !== undefined &&
    (typeof previewSkin !== 'string' || previewSkin === '' || previewSkin.includes('/') || previewSkin.includes('\\'))
  ) {
    errors.push('previewSkin пресета должен быть именем файла внутри пакета пресета')
  }

  return errors
}
