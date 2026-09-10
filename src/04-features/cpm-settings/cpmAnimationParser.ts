import JSZip from 'jszip'
import type {
  CPMAnimation,
  CPMAnimationInterpolator,
  CPMAnimationFrame,
  CPMAnimationKind,
} from '@/05-entities/core/types'

const LAYER_PREFIX = '$layer$'
const VALUE_LAYER_PREFIX = '$value$'
const SETUP_PREFIX = '$pre$'
const FINISH_PREFIX = '$post$'

const VANILLA_POSES = [
  'standing', 'walking', 'running', 'sneaking', 'sneak_walk', 'swimming',
  'falling', 'flying', 'creative_flying', 'sitting', 'riding', 'jumping',
  'sleeping', 'on_ladder', 'climbing_on_ladder', 'crawling', 'dying',
  'blocking_left', 'blocking_right', 'eating_left', 'eating_right', 'holding_left',
  'holding_right', 'punch_left', 'punch_right', 'bow_left', 'bow_right',
  'trident_left', 'trident_right', 'spyglass_left', 'spyglass_right',
  'toot_horn_left', 'toot_horn_right', 'first_person_mod', 'global',
  'retro_swimming', 'head_rotation_yaw', 'head_rotation_pitch', 'skull_render',
  'wearing_skull', 'in_gui', 'hurt', 'hurtlight', 'creative', 'suckspin',
]

const INTERPOLATORS: CPMAnimationInterpolator[] = [
  'linear_loop', 'linear_single', 'poly_loop', 'poly_single',
  'trig_loop', 'trig_single', 'no',
]

interface RawAnimation {
  name?: string
  duration?: number
  priority?: number
  loop?: boolean
  additive?: boolean
  interpolator?: string
  hidden?: boolean
  frames?: CPMAnimationFrame[]
}

function detectVanillaPose(posePart: string): string | null {
  const name = posePart.endsWith('.json') ? posePart.slice(0, -5) : posePart
  return VANILLA_POSES.find((pose) => name.startsWith(pose)) ?? null
}

function classify(fileName: string, displayName: string): { kind: CPMAnimationKind; name: string } {
  const [prefix, rest] = fileName.split('_', 2)

  if (prefix === 'v' && rest !== undefined) {
    const pose = detectVanillaPose(rest)
    if (pose) return { kind: 'vanilla-pose', name: pose }
  } else if (prefix === 'c') {
    return { kind: 'custom-pose', name: displayName }
  } else if (prefix === 'g') {
    if (displayName.startsWith(LAYER_PREFIX)) {
      return { kind: 'layer', name: displayName.slice(LAYER_PREFIX.length) }
    }
    if (displayName.startsWith(VALUE_LAYER_PREFIX)) {
      return { kind: 'value-layer', name: displayName.slice(VALUE_LAYER_PREFIX.length) }
    }
    if (displayName.startsWith(SETUP_PREFIX)) {
      return { kind: 'setup', name: displayName.slice(SETUP_PREFIX.length) }
    }
    if (displayName.startsWith(FINISH_PREFIX)) {
      return { kind: 'finish', name: displayName.slice(FINISH_PREFIX.length) }
    }
    return { kind: 'gesture', name: displayName }
  }

  return { kind: 'gesture', name: displayName || fileName }
}

function normalizeInterpolator(raw: string | undefined): CPMAnimationInterpolator {
  const value = (raw ?? 'poly_loop') as CPMAnimationInterpolator
  return INTERPOLATORS.includes(value) ? value : 'poly_loop'
}

export async function parseCpmAnimations(zip: JSZip): Promise<CPMAnimation[]> {
  const files = Object.keys(zip.files)
    .filter((path) => path.startsWith('animations/') && path.endsWith('.json'))
    .sort()

  const animations: CPMAnimation[] = []

  for (const path of files) {
    const file = zip.file(path)
    if (!file) continue

    let raw: RawAnimation
    try {
      raw = JSON.parse(await file.async('string')) as RawAnimation
    } catch {
      continue
    }

    const fileName = path.slice('animations/'.length)
    const { kind, name } = classify(fileName, raw.name ?? 'Unnamed')

    animations.push({
      id: fileName,
      name: name || fileName,
      kind,
      duration: raw.duration ?? 1000,
      priority: raw.priority ?? 0,
      loop: raw.loop ?? false,
      additive: raw.additive ?? true,
      interpolator: normalizeInterpolator(raw.interpolator),
      hidden: raw.hidden ?? false,
      frames: raw.frames ?? [],
    })
  }

  return animations
}
