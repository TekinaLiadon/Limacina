import JSZip from 'jszip'
import { readZipEntryText, type ZipReadBudget } from '../cpm-convert/cpmProjectZip'
import { reportError } from '@/06-shared'
import {
  isSkinLayer,
  type CPMAnimation,
  type CPMAnimationInterpolator,
  type CPMAnimationFrame,
  type CPMAnimationFrameComponent,
  type CPMAnimationKind,
  type CPMAnimEnc,
  type CPMSkinLayer,
  type CPMVec3,
} from '@/05-entities'

const LAYER_PREFIX = '$layer$'
const VALUE_LAYER_PREFIX = '$value$'
const SETUP_PREFIX = '$pre$'
const FINISH_PREFIX = '$post$'

const ANIM_ENC_FILE = 'anim_enc.json'
const ANIMATIONS_DIR = 'animations/'

export const VANILLA_POSES = [
  'custom',
  'standing', 'walking', 'running', 'sneaking', 'swimming', 'falling', 'sleeping', 'riding', 'flying',
  'dying', 'skull_render', 'global', 'creative_flying', 'eating_left', 'eating_right', 'retro_swimming',
  'jumping', 'sneak_walk', 'punch_left', 'punch_right', 'armor_head', 'armor_body', 'armor_legs',
  'armor_boots', 'wearing_elytra', 'bow_left', 'bow_right', 'crossbow_left', 'crossbow_right',
  'crossbow_ch_left', 'crossbow_ch_right', 'trident_left', 'trident_right', 'trident_spin',
  'spyglass_left', 'spyglass_right', 'holding_left', 'holding_right', 'wearing_skull', 'blocking_left',
  'blocking_right', 'parrot_left', 'parrot_right', 'hurt', 'on_fire', 'freezing', 'on_ladder',
  'climbing_on_ladder', 'speaking', 'toot_horn_left', 'toot_horn_right', 'in_gui', 'first_person_mod',
  'voice_muted', 'vr_first_person', 'vr_third_person_sitting', 'vr_third_person_standing',
  'first_person_hand', 'health', 'hunger', 'air', 'in_menu', 'invisible', 'light', 'head_rotation_yaw',
  'head_rotation_pitch', 'brush_left', 'brush_right', 'crawling', 'spear_left', 'spear_right',
]

export const VANILLA_DYNAMIC_DURATION_POSES: ReadonlySet<string> = new Set([
  'punch_left', 'punch_right', 'bow_left', 'bow_right', 'crossbow_ch_left', 'crossbow_ch_right',
  'speaking', 'health', 'hunger', 'air', 'light', 'head_rotation_yaw', 'head_rotation_pitch',
])

const INTERPOLATORS: CPMAnimationInterpolator[] = [
  'linear_loop', 'linear_single', 'poly_loop', 'poly_single', 'trig_loop', 'trig_single', 'no',
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
    color: asString(value.color) ?? '0',
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

function detectVanillaPose(posePart: string): { name: string; index: number } | null {
  const name = posePart.endsWith('.json') ? posePart.slice(0, -5) : posePart
  let best: { name: string; index: number } | null = null
  for (let index = 1; index < VANILLA_POSES.length; index++) {
    const pose = VANILLA_POSES[index]
    if (pose === undefined || !name.startsWith(pose)) continue
    if (best === null || pose.length > best.name.length) best = { name: pose, index }
  }
  return best
}

function classify(fileName: string, displayName: string): {
  kind: CPMAnimationKind
  name: string
  poseIndex?: number
} {
  const separatorIndex = fileName.indexOf('_')
  const prefix = separatorIndex === -1 ? fileName : fileName.slice(0, separatorIndex)
  const rest = separatorIndex === -1 ? '' : fileName.slice(separatorIndex + 1)

  if (prefix === 'v' && rest !== '') {
    const pose = detectVanillaPose(rest)
    if (pose) return { kind: 'vanilla-pose', name: pose.name, poseIndex: pose.index }
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

function findInterpolator(raw: unknown): CPMAnimationInterpolator | undefined {
  return INTERPOLATORS.find((value) => value === raw)
}

function toSkinLayers(value: unknown): CPMSkinLayer[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CPMSkinLayer => typeof item === 'string' && isSkinLayer(item))
}

export async function parseCpmAnimEnc(zip: JSZip, budget: ZipReadBudget): Promise<CPMAnimEnc | null> {
  const file = zip.file(ANIM_ENC_FILE)
  if (!file) return null

  const text = await readZipEntryText(budget, file)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!isRecord(parsed)) {
    reportError('Не удалось разобрать anim_enc.json в файле проекта')
    return null
  }

  const defaultValues: Partial<Record<CPMSkinLayer, boolean>> = {}
  if (isRecord(parsed.defaultValues)) {
    for (const [layer, enabled] of Object.entries(parsed.defaultValues)) {
      if (typeof enabled !== 'boolean') continue
      if (!isSkinLayer(layer)) continue
      defaultValues[layer] = enabled
    }
  }

  return { freeLayers: toSkinLayers(parsed.freeLayers), defaultValues }
}

export async function parseCpmAnimations(zip: JSZip, budget: ZipReadBudget): Promise<CPMAnimation[]> {
  const files = Object.keys(zip.files)
    .filter((path) => path.startsWith(ANIMATIONS_DIR) && path.endsWith('.json'))
    .sort()

  const animations: CPMAnimation[] = []
  const brokenFiles: string[] = []
  const unknownInterpolators: string[] = []

  for (const path of files) {
    const file = zip.file(path)
    if (!file) continue

    const text = await readZipEntryText(budget, file)
    let raw: Record<string, unknown> | null
    try {
      const parsed: unknown = JSON.parse(text)
      raw = isRecord(parsed) ? parsed : null
    } catch {
      raw = null
    }
    if (raw === null) {
      brokenFiles.push(path.slice(ANIMATIONS_DIR.length))
      continue
    }

    const fileName = path.slice(ANIMATIONS_DIR.length)
    const displayName = asString(raw.name) ?? 'Unnamed'
    const { kind, name, poseIndex } = classify(fileName, displayName)

    const rawInterpolator = raw.interpolator
    const hasInterpolator = rawInterpolator !== undefined && rawInterpolator !== null
    if (hasInterpolator && findInterpolator(rawInterpolator) === undefined) {
      unknownInterpolators.push(fileName)
    }

    animations.push({
      id: fileName,
      name: name || fileName,
      kind,
      duration: asNumber(raw.duration) ?? 1000,
      priority: asNumber(raw.priority) ?? 0,
      loop: asBoolean(raw.loop) ?? false,
      additive: asBoolean(raw.additive) ?? false,
      interpolator: findInterpolator(rawInterpolator) ?? 'poly_loop',
      hidden: asBoolean(raw.hidden) ?? false,
      frames: sanitizeFrames(raw.frames),
      layerDefault: asNumber(raw.layerDefault) ?? 0,
      order: asNumber(raw.order) ?? 0,
      isProperty: asBoolean(raw.isProperty) ?? false,
      group: asString(raw.group),
      command: asBoolean(raw.command) ?? false,
      layerControlled: asBoolean(raw.layerControlled) ?? true,
      maxValue: asNumber(raw.maxValue) ?? 100,
      interpolateValue: asBoolean(raw.interpolateVal) ?? true,
      mustFinish: asBoolean(raw.mustFinish) ?? false,
      ...(poseIndex === undefined ? {} : { poseIndex }),
    })
  }

  if (brokenFiles.length > 0) {
    reportError(`Не удалось разобрать файлы анимаций: ${brokenFiles.join(', ')}`)
  }

  if (unknownInterpolators.length > 0) {
    reportError(`Неизвестные интерполяторы в файлах анимаций: ${unknownInterpolators.join(', ')}`)
  }

  return animations
}
