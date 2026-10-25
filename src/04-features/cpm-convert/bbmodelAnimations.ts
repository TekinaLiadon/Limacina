import { isRecord } from './cpmProjectZip'
import type { CPMAnimation, CPMAnimationFrame, CPMAnimationFrameComponent, CPMVec3 } from '@/05-entities'

export interface BbmodelAnimatorTarget {
  id: number
  hidden: boolean
}

export type BbmodelAnimatorIndex = ReadonlyMap<string, BbmodelAnimatorTarget>

const CHANNELS = ['rotation', 'position', 'scale'] as const

type ChannelName = (typeof CHANNELS)[number]

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const VEC_LIMIT = 32767 / 682
const SAMPLES_PER_SECOND = 20
const MIN_FRAME_COUNT = 2
const MAX_FRAME_COUNT = 255
const MAX_ANIMATED_PARTS = 255
const MAX_DURATION_MS = 65535
const IDENTITY_EPSILON = 0.01
const FALLBACK_NAME = 'Анимация'

const ZERO: CPMVec3 = { x: 0, y: 0, z: 0 }
const ONE: CPMVec3 = { x: 1, y: 1, z: 1 }

interface ChannelKeyframe {
  time: number
  pre: CPMVec3
  post: CPMVec3
  step: boolean
  catmullrom: boolean
}

interface AnimatorTrack {
  target: BbmodelAnimatorTarget
  channels: Partial<Record<ChannelName, ChannelKeyframe[]>>
}

interface SampledTrack {
  target: BbmodelAnimatorTarget
  pos: CPMVec3[]
  rot: CPMVec3[]
  scale: CPMVec3[]
}

export function isLegacyBbmodel(meta: unknown): boolean {
  if (!isRecord(meta) || typeof meta.format_version !== 'string') return true
  const major = Number.parseInt(meta.format_version, 10)
  return Number.isNaN(major) || major < 5
}

function molangNum(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const text = value.trim()
    if (text !== '' && NUMBER_PATTERN.test(text)) {
      const parsed = Number(text)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  throw new Error(`Файл .bbmodel повреждён: ${label} должен быть числом, выражения Molang не поддерживаются`)
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function keyframeVec(point: unknown, animName: string, channel: ChannelName): CPMVec3 {
  const label = `координата канала ${channel} анимации "${animName}"`
  if (!isRecord(point)) {
    throw new Error(`Файл .bbmodel повреждён: кейфрейм канала ${channel} анимации "${animName}" не содержит координат`)
  }
  return {
    x: molangNum(point.x, `${label} x`),
    y: molangNum(point.y, `${label} y`),
    z: molangNum(point.z, `${label} z`),
  }
}

function applySigns(channel: ChannelName, value: CPMVec3, legacySigns: boolean): CPMVec3 {
  if (channel === 'scale') return { x: value.x, y: value.y, z: value.z }
  const x = (legacySigns ? -value.x : value.x) + 0
  if (channel === 'position') return { x, y: -value.y + 0, z: -value.z + 0 }
  return { x: wrap360(x), y: wrap360(legacySigns ? value.y : -value.y), z: wrap360(-value.z) }
}

function parseTrack(
  uuid: string,
  entry: unknown,
  animators: BbmodelAnimatorIndex,
  animName: string,
  legacySigns: boolean,
): AnimatorTrack | null {
  const target = animators.get(uuid)
  if (target === undefined) return null
  if (!isRecord(entry)) return null
  const rawKeyframes = Array.isArray(entry.keyframes) ? entry.keyframes : []

  const channels: Partial<Record<ChannelName, ChannelKeyframe[]>> = {}
  for (const raw of rawKeyframes) {
    if (!isRecord(raw)) continue
    const channel = CHANNELS.find((name) => name === raw.channel)
    if (channel === undefined) continue
    const points = Array.isArray(raw.data_points) ? raw.data_points : []
    const pre = applySigns(channel, keyframeVec(points[0], animName, channel), legacySigns)
    const post = points.length > 1
      ? applySigns(channel, keyframeVec(points[1], animName, channel), legacySigns)
      : pre
    const list = channels[channel] ?? []
    list.push({
      time: molangNum(raw.time, `время кейфрейма анимации "${animName}"`),
      pre,
      post,
      step: raw.interpolation === 'step',
      catmullrom: raw.interpolation === 'catmullrom',
    })
    channels[channel] = list
  }

  let hasKeyframes = false
  for (const list of Object.values(channels)) {
    if (list === undefined || list.length === 0) continue
    list.sort((a, b) => a.time - b.time)
    hasKeyframes = true
  }
  if (!hasKeyframes) return null
  return { target, channels }
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * u
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  )
}

function sampleChannel(keyframes: ChannelKeyframe[], t: number): CPMVec3 {
  const [first] = keyframes
  const [last] = keyframes.slice(-1)
  if (first === undefined || last === undefined) return { ...ZERO }
  if (t < first.time) return { ...first.pre }
  if (t >= last.time) return { ...last.post }

  let k = 0
  for (let i = 0; i < keyframes.length - 1; i++) {
    const left = keyframes[i]
    const right = keyframes[i + 1]
    if (left === undefined || right === undefined) continue
    if (t >= left.time && t < right.time) {
      k = i
      break
    }
  }
  const left = keyframes[k]
  const right = keyframes[k + 1]
  if (left === undefined || right === undefined) return { ...last.post }

  const span = right.time - left.time
  const u = span > 0 ? (t - left.time) / span : 0
  if (left.step) return { ...left.post }

  const p0 = keyframes[k - 1]?.post ?? left.post
  const p3 = keyframes[k + 2]?.pre ?? right.pre
  return {
    x: left.catmullrom
      ? catmullRom(p0.x, left.post.x, right.pre.x, p3.x, u)
      : lerp(left.post.x, right.pre.x, u),
    y: left.catmullrom
      ? catmullRom(p0.y, left.post.y, right.pre.y, p3.y, u)
      : lerp(left.post.y, right.pre.y, u),
    z: left.catmullrom
      ? catmullRom(p0.z, left.post.z, right.pre.z, p3.z, u)
      : lerp(left.post.z, right.pre.z, u),
  }
}

function assertVecLimit(value: CPMVec3, channel: 'position' | 'scale', animName: string): void {
  if (Math.abs(value.x) > VEC_LIMIT || Math.abs(value.y) > VEC_LIMIT || Math.abs(value.z) > VEC_LIMIT) {
    throw new Error(`Координаты канала ${channel} анимации "${animName}" не помещаются в формат вектора`)
  }
}

function sampleTrack(
  keyframes: ChannelKeyframe[],
  times: number[],
  channel: ChannelName,
  animName: string,
): CPMVec3[] {
  if (keyframes.length === 0) return times.map(() => (channel === 'scale' ? { ...ONE } : { ...ZERO }))
  return times.map((t) => {
    const value = sampleChannel(keyframes, t)
    if (channel !== 'rotation') assertVecLimit(value, channel, animName)
    return value
  })
}

function isIdentity(values: CPMVec3[], base: number): boolean {
  return values.every((value) =>
    Math.abs(value.x - base) <= IDENTITY_EPSILON
    && Math.abs(value.y - base) <= IDENTITY_EPSILON
    && Math.abs(value.z - base) <= IDENTITY_EPSILON)
}

function convertAnimation(
  raw: Record<string, unknown>,
  index: number,
  animators: BbmodelAnimatorIndex,
  legacySigns: boolean,
): CPMAnimation | null {
  const id = typeof raw.uuid === 'string' && raw.uuid !== '' ? raw.uuid : `bbmodel-${index}`
  const rawName = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : FALLBACK_NAME
  const name = rawName.replace(/#/g, '').trim()
  const displayName = name === '' ? FALLBACK_NAME : name
  const loop = raw.loop === 'loop'

  const tracks: AnimatorTrack[] = []
  if (isRecord(raw.animators)) {
    for (const [uuid, entry] of Object.entries(raw.animators)) {
      if (uuid === 'effects') continue
      const track = parseTrack(uuid, entry, animators, rawName, legacySigns)
      if (track !== null) tracks.push(track)
    }
  }
  if (tracks.length === 0) return null

  let lastKeyframeTime = 0
  for (const track of tracks) {
    for (const list of Object.values(track.channels)) {
      const lastTime = list?.[list.length - 1]?.time ?? 0
      if (lastTime > lastKeyframeTime) lastKeyframeTime = lastTime
    }
  }
  const length = raw.length === undefined ? 0 : molangNum(raw.length, `длина анимации "${rawName}"`)
  const totalLength = Math.max(length, lastKeyframeTime)
  if (!(totalLength > 0)) return null

  const duration = Math.round(totalLength * 1000)
  if (duration > MAX_DURATION_MS) {
    throw new Error(`Длительность анимации "${displayName}" превышает 65 секунд`)
  }
  const frameCount = Math.min(MAX_FRAME_COUNT, Math.max(MIN_FRAME_COUNT, Math.ceil(totalLength * SAMPLES_PER_SECOND)))
  const denominator = loop ? frameCount : frameCount - 1
  const times = Array.from({ length: frameCount }, (_, i) => (i * totalLength) / denominator)

  const samples = tracks.map((track): SampledTrack => ({
    target: track.target,
    pos: sampleTrack(track.channels.position ?? [], times, 'position', displayName),
    rot: sampleTrack(track.channels.rotation ?? [], times, 'rotation', displayName),
    scale: sampleTrack(track.channels.scale ?? [], times, 'scale', displayName),
  }))

  const animated = samples.filter((sample) =>
    !isIdentity(sample.pos, 0) || !isIdentity(sample.rot, 0) || !isIdentity(sample.scale, 1))
  if (animated.length === 0) return null
  if (animated.length > MAX_ANIMATED_PARTS) {
    throw new Error(`Анимация "${displayName}" затрагивает больше ${MAX_ANIMATED_PARTS} элементов модели`)
  }

  const frames: CPMAnimationFrame[] = times.map((_, frameIndex) => ({
    components: animated.map((sample): CPMAnimationFrameComponent => ({
      storeID: sample.target.id,
      pos: sample.pos[frameIndex] ?? { ...ZERO },
      rotation: sample.rot[frameIndex] ?? { ...ZERO },
      scale: sample.scale[frameIndex] ?? { ...ONE },
      show: !sample.target.hidden,
    })),
  }))

  return {
    id,
    name: displayName,
    kind: 'gesture',
    duration,
    priority: 0,
    loop,
    additive: true,
    interpolator: loop ? 'linear_loop' : 'linear_single',
    hidden: false,
    frames,
    layerControlled: false,
  }
}

function uniqueName(used: Set<string>, base: string): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} (${suffix})`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

export function convertBbmodelAnimations(
  animations: unknown,
  animators: BbmodelAnimatorIndex,
  legacySigns: boolean,
): CPMAnimation[] {
  if (!Array.isArray(animations)) return []
  const usedNames = new Set<string>()
  const result: CPMAnimation[] = []
  animations.forEach((raw, index) => {
    if (!isRecord(raw)) return
    const animation = convertAnimation(raw, index, animators, legacySigns)
    if (animation === null) return
    animation.name = uniqueName(usedNames, animation.name)
    result.push(animation)
  })
  return result
}
