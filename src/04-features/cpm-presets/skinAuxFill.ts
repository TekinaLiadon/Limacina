import { LOGICAL_ATLAS_SIZE, type PresetAuxRegion } from './presetTypes'
import type { SkinImage } from './skinPng'

export function fillAuxRegions(image: SkinImage, regions: PresetAuxRegion[] | undefined): SkinImage {
  if (!regions || regions.length === 0) return image

  const scale = image.width / LOGICAL_ATLAS_SIZE
  const rgba = new Uint8Array(image.rgba)
  for (const region of regions) {
    const startX = region.sx * scale
    const endX = region.ex * scale
    for (let y = region.sy * scale; y < region.ey * scale; y++) {
      rgba.fill(0, (y * image.width + startX) * 4, (y * image.width + endX) * 4)
    }
  }
  return { width: image.width, height: image.height, rgba }
}
