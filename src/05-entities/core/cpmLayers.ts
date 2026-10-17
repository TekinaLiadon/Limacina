import type { CPMSkinLayer } from './types'

export const SKIN_LAYERS: CPMSkinLayer[] = [
  'hat',
  'jacket',
  'left_pants_leg',
  'right_pants_leg',
  'left_sleeve',
  'right_sleeve',
]

export function isSkinLayer(name: string): name is CPMSkinLayer {
  return (SKIN_LAYERS as string[]).includes(name)
}

export function skinLayerMask(layers: Iterable<CPMSkinLayer>): number {
  let mask = 0
  for (const layer of layers) {
    mask |= 1 << SKIN_LAYERS.indexOf(layer)
  }
  return mask
}
