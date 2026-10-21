import * as THREE from 'three'
import type { Ref } from 'vue'
import type { CPMAnimation, CPMAnimationInterpolator, CPMVec3 } from '@/05-entities'
import { computeMeshVisible } from './meshVisibility'

export const SPEED_MIN = 0.25
export const SPEED_MAX = 3

const MODEL_ORIGIN_Y = 24

export interface AnimatedNode {
  group: THREE.Group
  basePos: THREE.Vector3
  baseRot: THREE.Euler
  baseScale: THREE.Vector3
  baseVisible: boolean
  isRoot: boolean
  isVanillaPart: boolean
  meshes: THREE.Mesh[]
}

export type NodeIndex = Map<number, AnimatedNode>

export function indexModelNodes(modelGroup: THREE.Group): NodeIndex {
  const index: NodeIndex = new Map()

  modelGroup.traverse((object) => {
    if (!(object instanceof THREE.Group)) return
    const storeId = object.userData.storeID
    if (typeof storeId !== 'number') return
    if (index.has(storeId)) return

    const isRoot = object.userData.isRoot === true
    const isVanillaPart = isRoot && object.userData.isVanillaPart === true
    const meshes: THREE.Mesh[] = []
    if (isRoot) {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child)
      })
    } else {
      object.children.forEach((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child)
      })
    }

    const baseVisible = (object.userData.defaultVisible as boolean | undefined) !== false

    index.set(storeId, {
      group: object,
      basePos: object.position.clone(),
      baseRot: object.rotation.clone(),
      baseScale: object.scale.clone(),
      baseVisible,
      isRoot,
      isVanillaPart,
      meshes,
    })
  })

  return index
}

function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

function unwrapChannel(values: number[]): number[] {
  const result: number[] = []
  let unwrapped = 0
  let previousRaw = 0
  for (const value of values) {
    unwrapped = result.length === 0 ? value : unwrapped + shortestDelta(previousRaw, value)
    result.push(unwrapped)
    previousRaw = value
  }
  return result
}

function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * t
}

function trigInt(t: number, a: number, b: number): number {
  return a + Math.sin((t * Math.PI) / 2) * (b - a)
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length
}

export type StepSampler = (step: number) => number

export function animationStep(millis: number, duration: number, frames: number): number {
  const safeDuration = Math.max(duration, 1)
  return ((millis % safeDuration) / safeDuration) * frames
}

export function createStepSampler(values: number[]): StepSampler {
  if (values.length === 0) return () => 0
  const len = values.length
  return (step) => values[wrapIndex(Math.floor(step), len)] ?? 0
}

function createLinearLoopSampler(values: number[]): StepSampler {
  const len = values.length
  return (step) => {
    const frm = Math.floor(step)
    return lerp(step - frm, values[wrapIndex(frm, len)] ?? 0, values[wrapIndex(frm + 1, len)] ?? 0)
  }
}

function createLinearSingleSampler(values: number[]): StepSampler {
  const len = values.length
  const last = len - 1
  return (step) => {
    const v = (step / len) * last
    const frm = Math.min(Math.abs(Math.floor(v)), last)
    return lerp(v - Math.floor(v), values[frm] ?? 0, values[Math.min(frm + 1, last)] ?? 0)
  }
}

function createTrigLoopSampler(values: number[]): StepSampler {
  const len = values.length
  return (step) => {
    const frm = Math.floor(step)
    return trigInt(step - frm, values[wrapIndex(frm, len)] ?? 0, values[wrapIndex(frm + 1, len)] ?? 0)
  }
}

function createTrigSingleSampler(values: number[]): StepSampler {
  const len = values.length
  const last = len - 1
  return (step) => {
    const v = (step / len) * last
    const frm = Math.min(Math.abs(Math.floor(v)), last)
    return trigInt(v - Math.floor(v), values[frm] ?? 0, values[Math.min(frm + 1, last)] ?? 0)
  }
}

function createNaturalSpline(x: number[], y: number[]): StepSampler {
  const n = x.length - 1
  const h = new Array<number>(n)
  for (let i = 0; i < n; i++) h[i] = (x[i + 1] ?? 0) - (x[i] ?? 0)

  const mu = new Array<number>(n).fill(0)
  const z = new Array<number>(n + 1).fill(0)
  for (let i = 1; i < n; i++) {
    const span = (x[i + 1] ?? 0) - (x[i - 1] ?? 0)
    const nextH = h[i] ?? 0
    const prevH = h[i - 1] ?? 0
    const g = 2 * span - prevH * (mu[i - 1] ?? 0)
    mu[i] = nextH / g
    z[i] = (
      3 * ((y[i + 1] ?? 0) * prevH - (y[i] ?? 0) * span + (y[i - 1] ?? 0) * nextH) / (prevH * nextH)
      - prevH * (z[i - 1] ?? 0)
    ) / g
  }

  const b = new Array<number>(n).fill(0)
  const c = new Array<number>(n + 1).fill(0)
  const d = new Array<number>(n).fill(0)
  for (let j = n - 1; j >= 0; j--) {
    const span = h[j] ?? 0
    c[j] = (z[j] ?? 0) - (mu[j] ?? 0) * (c[j + 1] ?? 0)
    b[j] = ((y[j + 1] ?? 0) - (y[j] ?? 0)) / span - (span * ((c[j + 1] ?? 0) + 2 * (c[j] ?? 0))) / 3
    d[j] = ((c[j + 1] ?? 0) - (c[j] ?? 0)) / (3 * span)
  }

  const first = x[0] ?? 0
  const last = x[n] ?? 0
  return (step) => {
    const v = Math.min(Math.max(step, first), last)
    let segment = n - 1
    if (v < last) {
      let lo = 0
      let hi = n
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if ((x[mid] ?? 0) <= v) lo = mid
        else hi = mid
      }
      segment = lo
    }
    const dx = v - (x[segment] ?? 0)
    return (y[segment] ?? 0)
      + (b[segment] ?? 0) * dx
      + (c[segment] ?? 0) * dx * dx
      + (d[segment] ?? 0) * dx * dx * dx
  }
}

function createPolynomialSampler(values: number[], loop: boolean): StepSampler {
  const frames = values.length
  const count = frames + (loop ? 5 : 2)
  const x = new Array<number>(count)
  const y = new Array<number>(count)
  for (let j = 0; j < count; j++) {
    x[j] = loop ? j - 2 : j - 1
    y[j] = loop
      ? (values[wrapIndex(j + frames - 2, frames)] ?? 0)
      : (values[Math.min(Math.max(j - 1, 0), frames - 1)] ?? 0)
  }
  return createNaturalSpline(x, y)
}

export function createChannelSampler(values: number[], interpolator: CPMAnimationInterpolator): StepSampler {
  if (values.length === 0) return () => 0
  if (values.length === 1) {
    const only = values[0] ?? 0
    return () => only
  }
  switch (interpolator) {
    case 'linear_loop':
      return createLinearLoopSampler(values)
    case 'linear_single':
      return createLinearSingleSampler(values)
    case 'trig_loop':
      return createTrigLoopSampler(values)
    case 'trig_single':
      return createTrigSingleSampler(values)
    case 'poly_loop':
      return createPolynomialSampler(values, true)
    case 'poly_single':
      return createPolynomialSampler(values, false)
    case 'no':
      return createStepSampler(values)
  }
}

type AxisTracks = [number[], number[], number[]]
type AxisSamplers = [StepSampler, StepSampler, StepSampler]

interface RawChannelTrack {
  storeId: number
  pos: AxisTracks
  rot: AxisTracks
  scale: AxisTracks
  show: number[]
}

interface ChannelTrack extends RawChannelTrack {
  samplers: {
    pos: AxisSamplers
    rot: AxisSamplers
    scale: AxisSamplers
    show: StepSampler
  }
}

interface NodeFill {
  pos: CPMVec3
  rot: CPMVec3
  scale: CPMVec3
  show: number
}

function buildTracks(animation: CPMAnimation, index: NodeIndex): ChannelTrack[] {
  const tracks = new Map<number, RawChannelTrack>()

  const getTrack = (storeId: number): RawChannelTrack => {
    let track = tracks.get(storeId)
    if (!track) {
      track = { storeId, pos: [[], [], []], rot: [[], [], []], scale: [[], [], []], show: [] }
      tracks.set(storeId, track)
    }
    return track
  }

  const {additive} = animation

  const fillFor = (node: AnimatedNode | undefined): NodeFill => {
    if (!node) return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: 1 }

    if (additive) {
      return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: node.baseVisible ? 1 : 0 }
    }

    const pos = node.isRoot
      ? { x: node.basePos.x, y: MODEL_ORIGIN_Y - node.basePos.y, z: -node.basePos.z }
      : { x: node.basePos.x, y: -node.basePos.y, z: -node.basePos.z }

    return {
      pos,
      rot: {
        x: THREE.MathUtils.radToDeg(node.baseRot.x),
        y: -THREE.MathUtils.radToDeg(node.baseRot.y),
        z: -THREE.MathUtils.radToDeg(node.baseRot.z),
      },
      scale: { x: node.baseScale.x, y: node.baseScale.y, z: node.baseScale.z },
      show: node.baseVisible ? 1 : 0,
    }
  }

  animation.frames.forEach((frame) => {
    const seen = new Set<number>()

    frame.components.forEach((component) => {
      const track = getTrack(component.storeID)
      seen.add(component.storeID)

      track.pos[0].push(component.pos.x)
      track.pos[1].push(component.pos.y)
      track.pos[2].push(component.pos.z)
      track.rot[0].push(component.rotation.x)
      track.rot[1].push(component.rotation.y)
      track.rot[2].push(component.rotation.z)
      track.scale[0].push(component.scale.x)
      track.scale[1].push(component.scale.y)
      track.scale[2].push(component.scale.z)
      track.show.push(component.show ? 1 : 0)
    })

    tracks.forEach((track) => {
      if (seen.has(track.storeId)) return
      const fill = fillFor(index.get(track.storeId))
      track.pos[0].push(fill.pos.x)
      track.pos[1].push(fill.pos.y)
      track.pos[2].push(fill.pos.z)
      track.rot[0].push(fill.rot.x)
      track.rot[1].push(fill.rot.y)
      track.rot[2].push(fill.rot.z)
      track.scale[0].push(fill.scale.x)
      track.scale[1].push(fill.scale.y)
      track.scale[2].push(fill.scale.z)
      track.show.push(fill.show)
    })
  })

  const samplerFor = (values: number[]): StepSampler => createChannelSampler(values, animation.interpolator)

  return [...tracks.values()].map((track) => {
    const rot = track.rot.map(unwrapChannel) as AxisTracks
    return {
      ...track,
      rot,
      samplers: {
        pos: track.pos.map(samplerFor) as AxisSamplers,
        rot: rot.map(samplerFor) as AxisSamplers,
        scale: track.scale.map(samplerFor) as AxisSamplers,
        show: createStepSampler(track.show),
      },
    }
  })
}

export interface CpmPlayerHost {
  activeLayerIds: Ref<number[]>
  isPlaying: Ref<boolean>
  onFinished: () => void
  hiddenStoreIds?: Ref<ReadonlySet<number>> | undefined
}

export interface SharedClock {
  startedAt: number
  pausedAt: number
  speed: number
  playing: boolean
  forceLoop: boolean
  delayMs: number
}

export interface ActiveCpmAnimation {
  animation: CPMAnimation
  startDelayMs: number
}

interface AnimationEntry {
  animation: CPMAnimation
  tracks: ChannelTrack[]
  clock: SharedClock
}

export class CpmAnimationPlayer {
  private index: NodeIndex
  private host: CpmPlayerHost
  private entries: AnimationEntry[] = []
  private clocks: Map<string, SharedClock>
  private defaultSpeed = 1
  private defaultForceLoop = false

  constructor(index: NodeIndex, host: CpmPlayerHost, clocks?: Map<string, SharedClock>) {
    this.index = index
    this.host = host
    this.clocks = clocks ?? new Map()
  }

  dispose(): void {
    this.clocks.clear()
    this.entries = []
  }

  setAnimations(entries: ActiveCpmAnimation[]): void {
    this.resetNodes()

    const unique: ActiveCpmAnimation[] = []
    const activeIds = new Set<string>()
    for (const entry of entries) {
      if (activeIds.has(entry.animation.id)) continue
      activeIds.add(entry.animation.id)
      unique.push(entry)
    }
    this.clocks.forEach((_clock, id) => {
      if (!activeIds.has(id)) this.clocks.delete(id)
    })

    this.entries = unique
      .sort((a, b) => a.animation.priority - b.animation.priority)
      .map((entry) => {
        let clock = this.clocks.get(entry.animation.id)
        if (!clock) {
          clock = {
            startedAt: performance.now(),
            pausedAt: 0,
            speed: this.defaultSpeed,
            playing: this.host.isPlaying.value,
            forceLoop: this.defaultForceLoop,
            delayMs: entry.startDelayMs,
          }
          this.clocks.set(entry.animation.id, clock)
        }
        clock.delayMs = entry.startDelayMs
        return { animation: entry.animation, tracks: buildTracks(entry.animation, this.index), clock }
      })

    if (this.entries.length > 0) this.applyCurrentFrame()
  }

  setSpeed(speed: number): void {
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed))
    this.defaultSpeed = clamped
    this.clocks.forEach((clock) => {
      if (clock.speed === clamped) return
      if (clock.playing) {
        const virtualElapsed = Math.max(0, (performance.now() - clock.startedAt) * clock.speed - clock.delayMs)
        clock.startedAt = performance.now() - virtualElapsed / clamped
      }
      clock.speed = clamped
    })
  }

  setForceLoop(forceLoop: boolean): void {
    this.defaultForceLoop = forceLoop
    this.clocks.forEach((clock) => {
      clock.forceLoop = forceLoop
    })
  }

  setPlaying(playing: boolean): void {
    this.entries.forEach((entry) => {
      const {clock} = entry
      if (clock.playing === playing) return

      const duration = Math.max(entry.animation.duration, 1)
      if (playing) {
        if (clock.pausedAt >= duration) {
          clock.startedAt = performance.now()
          clock.pausedAt = 0
        } else {
          clock.startedAt = performance.now() - (clock.pausedAt + clock.delayMs) / clock.speed
        }
        clock.playing = true
      } else {
        clock.pausedAt = (performance.now() - clock.startedAt) * clock.speed - clock.delayMs
        clock.playing = false
      }
    })
  }

  seek(elapsedMs: number): void {
    this.entries.forEach((entry) => {
      const duration = Math.max(entry.animation.duration, 1)
      const clamped = Math.max(0, Math.min(elapsedMs, duration))
      const {clock} = entry
      clock.pausedAt = clamped
      if (clock.playing) {
        clock.startedAt = performance.now() - (clamped + clock.delayMs) / clock.speed
      }
    })
  }

  elapsedOf(animationId: string): number {
    const entry = this.entries.find((item) => item.animation.id === animationId)
    if (!entry) return 0
    return this.clockElapsed(entry)
  }

  update(): void {
    if (this.entries.length === 0) return

    this.entries.forEach((entry) => {
      const {clock} = entry
      if (!clock.playing) return

      const duration = Math.max(entry.animation.duration, 1)
      const elapsed = this.clockElapsed(entry)
      const loops = entry.animation.loop || clock.forceLoop

      if (!loops && elapsed >= duration) {
        clock.playing = false
        clock.pausedAt = duration
      }
    })

    this.applyCurrentFrame()

    if (this.entries.every((entry) => !entry.clock.playing)) {
      this.host.onFinished()
    }
  }

  private clockElapsed(entry: AnimationEntry): number {
    const {clock} = entry
    if (!clock.playing) return clock.pausedAt
    return (performance.now() - clock.startedAt) * clock.speed - clock.delayMs
  }

  resetNodes(): void {
    this.index.forEach((node, storeId) => {
      node.group.position.copy(node.basePos)
      node.group.rotation.copy(node.baseRot)
      node.group.scale.copy(node.baseScale)
      node.group.visible = node.baseVisible && !this.isHiddenByEditor(storeId)
      node.meshes.forEach((mesh) => {
        const layerId = mesh.userData.layerId as number | undefined
        mesh.userData.animVisible = mesh.userData.defaultVisible !== false
        mesh.visible = computeMeshVisible(
          mesh.userData.animVisible,
          layerId,
          this.host.activeLayerIds.value,
        )
      })
    })
  }

  applyCurrentFrame(): void {
    if (this.entries.length === 0) return
    this.resetNodes()
    this.entries.forEach((entry) => {
      this.applyEntryFrame(entry, this.clockElapsed(entry))
    })
  }

  private applyEntryFrame(entry: AnimationEntry, elapsed: number): void {
    const {animation} = entry
    const frameCount = animation.frames.length
    if (frameCount === 0) return
    if (elapsed < 0) return
    const {clock} = entry
    if (!clock.playing && clock.pausedAt === 0 && clock.delayMs > 0) return

    const {additive} = animation
    const duration = Math.max(animation.duration, 1)
    const loops = animation.loop || entry.clock.forceLoop
    const finished = !loops && !clock.playing && elapsed >= duration
    const step = finished ? frameCount : animationStep(elapsed, duration, frameCount)

    entry.tracks.forEach((track) => {
      const node = this.index.get(track.storeId)
      if (!node) return

      const px = track.samplers.pos[0](step)
      const py = track.samplers.pos[1](step)
      const pz = track.samplers.pos[2](step)
      const rx = track.samplers.rot[0](step)
      const ry = track.samplers.rot[1](step)
      const rz = track.samplers.rot[2](step)
      const sx = track.samplers.scale[0](step)
      const sy = track.samplers.scale[1](step)
      const sz = track.samplers.scale[2](step)
      const show = track.samplers.show(step) !== 0

      if (additive) {
        node.group.position.set(node.group.position.x + px, node.group.position.y - py, node.group.position.z - pz)
        node.group.rotation.set(
            node.group.rotation.x + THREE.MathUtils.degToRad(rx),
            node.group.rotation.y - THREE.MathUtils.degToRad(ry),
            node.group.rotation.z - THREE.MathUtils.degToRad(rz),
            'ZYX',
        )
        node.group.scale.set(
            sx !== 0 ? node.group.scale.x * sx : node.group.scale.x,
            sy !== 0 ? node.group.scale.y * sy : node.group.scale.y,
            sz !== 0 ? node.group.scale.z * sz : node.group.scale.z,
        )
      } else {
        node.group.position.set(
            px,
            node.isRoot ? MODEL_ORIGIN_Y - py : -py,
            -pz,
        )
        node.group.rotation.set(
            THREE.MathUtils.degToRad(rx),
            THREE.MathUtils.degToRad(-ry),
            THREE.MathUtils.degToRad(-rz),
            'ZYX',
        )
        node.group.scale.set(
            sx !== 0 ? sx : node.baseScale.x,
            sy !== 0 ? sy : node.baseScale.y,
            sz !== 0 ? sz : node.baseScale.z,
        )
      }

      if (!node.isVanillaPart) {
        const visible = show && !this.isHiddenByEditor(track.storeId)
        node.group.visible = visible
        node.meshes.forEach((mesh) => {
          mesh.userData.animVisible = visible
          const layerId = mesh.userData.layerId as number | undefined
          mesh.visible = computeMeshVisible(
            visible,
            layerId,
            this.host.activeLayerIds.value,
          )
        })
      }
    })
  }

  private isHiddenByEditor(storeId: number): boolean {
    return this.host.hiddenStoreIds?.value.has(storeId) === true
  }
}
