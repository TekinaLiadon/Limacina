import type { CPMChild, CPMConfig, CPMElement, CPMFaceUV } from '@/05-entities'
import { LOGICAL_ATLAS_SIZE } from './presetTypes'

function scaleFaceUV(face: CPMFaceUV, scale: number): CPMFaceUV {
  return {
    ...face,
    sx: face.sx * scale,
    sy: face.sy * scale,
    ex: face.ex * scale,
    ey: face.ey * scale,
  }
}

function scaleChild(child: CPMChild, scale: number): CPMChild {
  const next: CPMChild = { ...child }
  if (child.texture !== false) {
    next.textureSize = (child.textureSize ?? 1) * scale
    if (child.faceUV) {
      next.faceUV = Object.fromEntries(
        Object.entries(child.faceUV).map(([face, rect]) => [face, scaleFaceUV(rect, scale)]),
      )
    }
  }
  if (child.children) next.children = child.children.map((nested) => scaleChild(nested, scale))
  return next
}

function scaleRoot(root: CPMElement, scale: number): CPMElement {
  const next: CPMElement = { ...root }
  if (root.children) next.children = root.children.map((child) => scaleChild(child, scale))
  return next
}

export function scaleSkinLayout(config: CPMConfig, scale: number): CPMConfig {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`Масштаб раскладки S=${scale} должен быть целым числом не меньше 1`)
  }
  return {
    ...config,
    skinSize: { x: LOGICAL_ATLAS_SIZE * scale, y: LOGICAL_ATLAS_SIZE * scale },
    elements: config.elements.map((root) => scaleRoot(root, scale)),
  }
}
