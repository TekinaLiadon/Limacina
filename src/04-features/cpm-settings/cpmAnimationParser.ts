import JSZip from 'jszip'
import { reportError } from '@/06-shared'
import type {
  CPMAnimation,
  CPMAnimationInterpolator,
  CPMAnimationFrame,
  CPMAnimationFrameComponent,
  CPMAnimationKind,
  CPMVec3,
} from '@/05-entities'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isVec3(value: unknown): value is CPMVec3 {
  return isRecord(value)
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.z === 'number'
}

function sanitizeFrameComponent(value: unknown): CPMAnimationFrameComponent | null {
  if (!isRecord(value) || typeof value.storeID !== 'number') return null
  if (!isVec3(value.pos) || !isVec3(value.rotation) || !isVec3(value.scale)) return null
  return {
    storeID: value.storeID,
    pos: value.pos,
    rotation: value.rotation,
    scale: value.scale,
    show: asBoolean(value.show) ?? value.show === 1,
  }
}

function sanitizeFrames(value: unknown): CPMAnimationFrame[] {
  if (!Array.isArray(value)) return []
  const frames: CPMAnimationFrame[] = []
  for (const frame of value) {
    if (!isRecord(frame) || !Array.isArray(frame.components)) continue
    const components = frame.components
      .map(sanitizeFrameComponent)
      .filter((component): component is CPMAnimationFrameComponent => component !== null)
    frames.push({ components })
  }
  return frames
}

function detectVanillaPose(posePart: string): string | null {
  const name = posePart.endsWith('.json') ? posePart.slice(0, -5) : posePart
  let best: string | null = null
  for (const pose of VANILLA_POSES) {
    if (!name.startsWith(pose)) continue
    if (best === null || pose.length > best.length) best = pose
  }
  return best
}

function classify(fileName: string, displayName: string): { kind: CPMAnimationKind; name: string } {
  const separatorIndex = fileName.indexOf('_')
  const prefix = separatorIndex === -1 ? fileName : fileName.slice(0, separatorIndex)
  const rest = separatorIndex === -1 ? '' : fileName.slice(separatorIndex + 1)

  if (prefix === 'v' && rest !== '') {
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

function normalizeInterpolator(raw: unknown): CPMAnimationInterpolator {
  return INTERPOLATORS.find((value) => value === raw) ?? 'poly_loop'
}

export async function parseCpmAnimations(zip: JSZip): Promise<CPMAnimation[]> {
  const files = Object.keys(zip.files)
    .filter((path) => path.startsWith('animations/') && path.endsWith('.json'))
    .sort()

  const animations: CPMAnimation[] = []
  const brokenFiles: string[] = []

  for (const path of files) {
    const file = zip.file(path)
    if (!file) continue

    let raw: Record<string, unknown> | null
    try {
      const parsed: unknown = JSON.parse(await file.async('string'))
      raw = isRecord(parsed) ? parsed : null
    } catch {
      raw = null
    }
    if (raw === null) {
      brokenFiles.push(path.slice('animations/'.length))
      continue
    }

    const fileName = path.slice('animations/'.length)
    const { kind, name } = classify(fileName, asString(raw.name) ?? 'Unnamed')

    animations.push({
      id: fileName,
      name: name || fileName,
      kind,
      duration: asNumber(raw.duration) ?? 1000,
      priority: asNumber(raw.priority) ?? 0,
      loop: asBoolean(raw.loop) ?? false,
      additive: asBoolean(raw.additive) ?? true,
      interpolator: normalizeInterpolator(raw.interpolator),
      hidden: asBoolean(raw.hidden) ?? false,
      frames: sanitizeFrames(raw.frames),
    })
  }

  if (brokenFiles.length > 0) {
    reportError(`Не удалось разобрать файлы анимаций: ${brokenFiles.join(', ')}`)
  }

  return animations
}
