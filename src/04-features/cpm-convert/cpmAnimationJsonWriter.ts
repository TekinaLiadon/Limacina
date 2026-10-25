import {
  FINISH_PREFIX,
  LAYER_PREFIX,
  SETUP_PREFIX,
  VALUE_LAYER_PREFIX,
  VANILLA_POSES,
} from '@/04-features/cpm-settings/cpmAnimationParser'
import type { CPMAnimation, CPMAnimationKind } from '@/05-entities'

export interface CpmAnimationFileEntry {
  fileName: string
  body: Record<string, unknown>
}

const PATH_SEPARATORS = /[/\\]/g

const DISPLAY_PREFIX_BY_KIND: Partial<Record<CPMAnimationKind, string>> = {
  layer: LAYER_PREFIX,
  'value-layer': VALUE_LAYER_PREFIX,
  setup: SETUP_PREFIX,
  finish: FINISH_PREFIX,
}

function displayNameOf(animation: CPMAnimation): string {
  const prefix = DISPLAY_PREFIX_BY_KIND[animation.kind]
  return prefix === undefined ? animation.name : `${prefix}${animation.name}`
}

function fileNameOf(animation: CPMAnimation, displayName: string): string {
  const safeName = displayName.replace(PATH_SEPARATORS, '_')
  if (animation.kind === 'vanilla-pose') {
    const pose = animation.poseIndex === undefined ? undefined : VANILLA_POSES[animation.poseIndex]
    return `v_${pose ?? safeName}.json`
  }
  if (animation.kind === 'custom-pose') return `c_${safeName}.json`
  return `g_${safeName}.json`
}

export function serializeCpmAnimationFile(animation: CPMAnimation): CpmAnimationFileEntry {
  const displayName = displayNameOf(animation)
  const body: Record<string, unknown> = {
    name: displayName,
    duration: animation.duration,
    priority: animation.priority,
    loop: animation.loop,
    additive: animation.additive,
    interpolator: animation.interpolator,
    hidden: animation.hidden,
    frames: animation.frames,
  }
  if (animation.layerDefault !== undefined) body.layerDefault = animation.layerDefault
  if (animation.order !== undefined) body.order = animation.order
  if (animation.isProperty !== undefined) body.isProperty = animation.isProperty
  if (animation.group !== undefined) body.group = animation.group
  if (animation.command !== undefined) body.command = animation.command
  if (animation.layerControlled !== undefined) body.layerControlled = animation.layerControlled
  if (animation.maxValue !== undefined) body.maxValue = animation.maxValue
  if (animation.interpolateValue !== undefined) body.interpolateVal = animation.interpolateValue
  if (animation.mustFinish !== undefined) body.mustFinish = animation.mustFinish
  return { fileName: fileNameOf(animation, displayName), body }
}
