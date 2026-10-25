import { hasPngSignature } from '@/06-shared'
import { LOGICAL_ATLAS_SIZE, MAX_SKIN_PIXELS, MAX_SKIN_SCALE } from './presetTypes'

export const MAX_SKIN_FILE_BYTES = 2 * 1024 * 1024

export interface SkinValidation {
  width: number
  height: number
  scale: number
  errors: string[]
}

export function validateSkin(bytes: Uint8Array): SkinValidation {
  if (bytes.byteLength > MAX_SKIN_FILE_BYTES) {
    return { width: 0, height: 0, scale: 0, errors: ['Файл скина больше 2 МБ'] }
  }
  if (!hasPngSignature(bytes)) {
    return { width: 0, height: 0, scale: 0, errors: ['Файл не является PNG-изображением'] }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = bytes.byteLength >= 24 ? view.getUint32(16) : 0
  const height = bytes.byteLength >= 24 ? view.getUint32(20) : 0

  const errors: string[] = []
  if (width <= 0 || width % LOGICAL_ATLAS_SIZE !== 0) {
    errors.push(`Ширина скина ${width} должна быть кратна ${LOGICAL_ATLAS_SIZE}`)
    return { width, height, scale: 0, errors }
  }
  if (height !== width && height * 2 !== width) {
    errors.push(
      `Скин ${width}×${height} должен быть квадратным ${LOGICAL_ATLAS_SIZE}·S × ${LOGICAL_ATLAS_SIZE}·S или устаревшим ${LOGICAL_ATLAS_SIZE}·S × ${LOGICAL_ATLAS_SIZE / 2}·S`,
    )
    return { width, height, scale: 0, errors }
  }
  if (width * height > MAX_SKIN_PIXELS) {
    errors.push(`Скин ${width}×${height} слишком большой: не более ${MAX_SKIN_PIXELS} пикселей`)
    return { width, height, scale: 0, errors }
  }

  const scale = width / LOGICAL_ATLAS_SIZE
  if (scale > MAX_SKIN_SCALE) {
    errors.push(`Масштаб скина S=${scale} выше потолка ${MAX_SKIN_SCALE}`)
  }
  return { width, height, scale, errors }
}
