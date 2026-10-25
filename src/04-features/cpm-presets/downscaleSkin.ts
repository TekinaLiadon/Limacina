import type { SkinImage } from './skinPng'

export function downscaleSkin(image: SkinImage, targetSize: number): SkinImage {
  if (targetSize >= image.width) return image

  const rgba = new Uint8Array(targetSize * targetSize * 4)
  for (let y = 0; y < targetSize; y++) {
    const srcY = Math.min(image.height - 1, Math.floor((y * image.height) / targetSize))
    for (let x = 0; x < targetSize; x++) {
      const srcX = Math.min(image.width - 1, Math.floor((x * image.width) / targetSize))
      const srcOffset = (srcY * image.width + srcX) * 4
      const dstOffset = (y * targetSize + x) * 4
      rgba[dstOffset] = image.rgba[srcOffset] ?? 0
      rgba[dstOffset + 1] = image.rgba[srcOffset + 1] ?? 0
      rgba[dstOffset + 2] = image.rgba[srcOffset + 2] ?? 0
      rgba[dstOffset + 3] = image.rgba[srcOffset + 3] ?? 0
    }
  }
  return { width: targetSize, height: targetSize, rgba }
}
