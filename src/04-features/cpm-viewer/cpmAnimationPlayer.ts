import * as THREE from 'three'
import type { Ref } from 'vue'
import type { CPMAnimation, CPMVec3 } from '@/05-entities/core/types'

const PLAYER_PART_IDS: Record<string, number> = {
  head: 0,
  body: 1,
  left_arm: 2,
  right_arm: 3,
  left_leg: 4,
  right_leg: 5,
}

const MODEL_ORIGIN_Y = 24

interface AnimatedNode {
  group: THREE.Group
  basePos: THREE.Vector3
  baseRot: THREE.Euler
  baseScale: THREE.Vector3
  baseVisible: boolean
  isRoot: boolean
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

    const baseVisible = isRoot || (object.userData.defaultVisible as boolean | undefined) !== false

    index.set(storeId, {
      group: object,
      basePos: object.position.clone(),
      baseRot: object.rotation.clone(),
      baseScale: object.scale.clone(),
      baseVisible,
      isRoot,
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
  if (values.length === 0) return values
  const result: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    result.push(result[i - 1] + shortestDelta(values[i - 1], values[i]))
  }
  return result
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function sampleChannel(values: number[], framePos: number, loop: boolean, poly: boolean): number {
  const count = values.length
  if (count === 0) return 0
  if (count === 1) return values[0]

  const idx = Math.floor(framePos)
  const t = framePos - idx

  if (!poly) return lerp(values[Math.min(idx, count - 1)], values[Math.min(idx + 1, count - 1)], t)

  if (loop) {
    const i0 = ((idx - 1) % count + count) % count
    const i1 = idx % count
    const i2 = (idx + 1) % count
    const i3 = (idx + 2) % count
    return catmullRom(values[i0], values[i1], values[i2], values[i3], t)
  }

  const clamped = Math.min(idx, count - 2)
  const i0 = Math.max(clamped - 1, 0)
  const i3 = Math.min(clamped + 2, count - 1)
  return catmullRom(values[i0], values[clamped], values[clamped + 1], values[i3], t)
}

function sampleStep(values: number[], framePos: number): number {
  if (values.length === 0) return 0
  const idx = Math.floor(framePos)
  return values[Math.min(idx, values.length - 1)]
}

type AxisTracks = [number[], number[], number[]]

interface ChannelTrack {
  storeId: number
  pos: AxisTracks
  rot: AxisTracks
  scale: AxisTracks
  show: boolean[]
}

interface NodeFill {
  pos: CPMVec3
  rot: CPMVec3
  scale: CPMVec3
  show: boolean
}

function buildTracks(animation: CPMAnimation, index: NodeIndex): ChannelTrack[] {
  const tracks = new Map<number, ChannelTrack>()

  const getTrack = (storeId: number): ChannelTrack => {
    let track = tracks.get(storeId)
    if (!track) {
      track = { storeId, pos: [[], [], []], rot: [[], [], []], scale: [[], [], []], show: [] }
      tracks.set(storeId, track)
    }
    return track
  }

  const additive = animation.additive

  const fillFor = (node: AnimatedNode | undefined): NodeFill => {
    if (!node) return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: true }

    if (additive) {
      return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, show: node.baseVisible }
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
      show: node.baseVisible,
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
      track.show.push(component.show)
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

  return [...tracks.values()].map((track) => ({
    ...track,
    rot: track.rot.map(unwrapChannel) as AxisTracks,
  }))
}

function isPolyInterpolator(interpolator: string): boolean {
  return interpolator.startsWith('poly')
}

function isLoopInterpolator(interpolator: string, animLoop: boolean): boolean {
  if (interpolator.endsWith('_loop')) return true
  if (interpolator.endsWith('_single')) return false
  return animLoop
}

export interface CpmPlayerHost {
  activeLayerIds: Ref<number[]>
  onFinished: () => void
}

interface SharedClock {
  startedAt: number
  pausedAt: number
  speed: number
  playing: boolean
  forceLoop: boolean
}

interface AnimationEntry {
  animation: CPMAnimation
  tracks: ChannelTrack[]
  clock: SharedClock
}

const sharedClocks = new Map<string, SharedClock>()
let defaultSpeed = 1
let defaultForceLoop = false

export class CpmAnimationPlayer {
  private index: NodeIndex
  private host: CpmPlayerHost
  private entries: AnimationEntry[] = []

  constructor(index: NodeIndex, host: CpmPlayerHost) {
    this.index = index
    this.host = host
  }

  setAnimations(animations: CPMAnimation[]): void {
    this.resetNodes()

    const activeIds = new Set(animations.map((animation) => animation.id))
    sharedClocks.forEach((_clock, id) => {
      if (!activeIds.has(id)) sharedClocks.delete(id)
    })

    this.entries = [...animations]
      .sort((a, b) => a.priority - b.priority)
      .map((animation) => {
        let clock = sharedClocks.get(animation.id)
        if (!clock) {
          clock = {
            startedAt: performance.now(),
            pausedAt: 0,
            speed: defaultSpeed,
            playing: true,
            forceLoop: defaultForceLoop,
          }
          sharedClocks.set(animation.id, clock)
        }
        return { animation, tracks: buildTracks(animation, this.index), clock }
      })

    if (this.entries.length > 0) this.applyCurrentFrame()
  }

  setSpeed(speed: number): void {
    const clamped = Math.max(0.25, Math.min(3, speed))
    if (sharedClocks.size === 0) {
      defaultSpeed = clamped
      return
    }
    sharedClocks.forEach((clock) => {
      if (clock.speed === clamped) return
      if (clock.playing) {
        const virtualElapsed = (performance.now() - clock.startedAt) * clock.speed
        clock.startedAt = performance.now() - virtualElapsed / clamped
      }
      clock.speed = clamped
    })
  }

  setForceLoop(forceLoop: boolean): void {
    defaultForceLoop = forceLoop
    sharedClocks.forEach((clock) => {
      clock.forceLoop = forceLoop
    })
  }

  setPlaying(playing: boolean): void {
    this.entries.forEach((entry) => {
      const clock = entry.clock
      if (clock.playing === playing) return

      const duration = Math.max(entry.animation.duration, 1)
      if (playing) {
        if (clock.pausedAt >= duration) {
          clock.startedAt = performance.now()
          clock.pausedAt = 0
        } else {
          clock.startedAt = performance.now() - clock.pausedAt / clock.speed
        }
        clock.playing = true
      } else {
        clock.pausedAt = (performance.now() - clock.startedAt) * clock.speed
        clock.playing = false
      }
    })
  }

  update(): void {
    if (this.entries.length === 0) return

    this.entries.forEach((entry) => {
      const clock = entry.clock
      if (!clock.playing) return

      const duration = Math.max(entry.animation.duration, 1)
      const elapsed = (performance.now() - clock.startedAt) * clock.speed
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
    const clock = entry.clock
    if (!clock.playing) return clock.pausedAt
    return (performance.now() - clock.startedAt) * clock.speed
  }

  resetNodes(): void {
    this.index.forEach((node) => {
      node.group.position.copy(node.basePos)
      node.group.rotation.copy(node.baseRot)
      node.group.scale.copy(node.baseScale)
      node.group.visible = node.baseVisible
      node.meshes.forEach((mesh) => {
        const layerId = mesh.userData.layerId as number | undefined
        mesh.userData.animVisible = true
        mesh.visible = layerId !== undefined
          ? this.host.activeLayerIds.value.includes(layerId)
          : mesh.userData.defaultVisible !== false
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
    const animation = entry.animation
    const frameCount = animation.frames.length
    if (frameCount === 0) return

    const loop = isLoopInterpolator(animation.interpolator, animation.loop)
    const poly = isPolyInterpolator(animation.interpolator)
    const stepped = animation.interpolator === 'no'
    const additive = animation.additive
    const duration = Math.max(animation.duration, 1)

    const loops = animation.loop || entry.clock.forceLoop
    const wrappedElapsed = loops && elapsed >= duration ? elapsed % duration : elapsed
    const framePos = (wrappedElapsed / duration) * frameCount

    entry.tracks.forEach((track) => {
      const node = this.index.get(track.storeId)
      if (!node) return

      const sample = (values: number[]): number => {
        if (stepped) return sampleStep(values, framePos)
        return sampleChannel(values, framePos, loop, poly)
      }

      const px = sample(track.pos[0])
      const py = sample(track.pos[1])
      const pz = sample(track.pos[2])
      const rx = sample(track.rot[0])
      const ry = sample(track.rot[1])
      const rz = sample(track.rot[2])
      const sx = sample(track.scale[0])
      const sy = sample(track.scale[1])
      const sz = sample(track.scale[2])
      const show = track.show.length > 0 && sampleStep(track.show.map((visible) => (visible ? 1 : 0)), framePos) !== 0

      if (additive) {
        node.group.position.set(node.group.position.x + px, node.group.position.y - py, node.group.position.z - pz)
        node.group.rotation.set(
          node.group.rotation.x + THREE.MathUtils.degToRad(rx),
          node.group.rotation.y - THREE.MathUtils.degToRad(ry),
          node.group.rotation.z + THREE.MathUtils.degToRad(rz),
          'ZYX',
        )
        node.group.scale.set(
          sx !== 0 ? node.group.scale.x * sx : node.group.scale.x,
          sy !== 0 ? node.group.scale.y * sy : node.group.scale.y,
          sz !== 0 ? node.group.scale.z * sz : node.group.scale.z,
        )
      } else if (node.isRoot) {
        node.group.position.set(px, MODEL_ORIGIN_Y - py, -pz)
        node.group.rotation.set(
          THREE.MathUtils.degToRad(rx),
          THREE.MathUtils.degToRad(-ry),
          THREE.MathUtils.degToRad(-rz),
          'ZYX',
        )
        node.group.scale.set(sx !== 0 ? sx : node.baseScale.x, sy !== 0 ? sy : node.baseScale.y, sz !== 0 ? sz : node.baseScale.z)
      } else {
        node.group.position.set(px, -py, -pz)
        node.group.rotation.set(
          THREE.MathUtils.degToRad(rx),
          THREE.MathUtils.degToRad(-ry),
          THREE.MathUtils.degToRad(-rz),
          'ZYX',
        )
        node.group.scale.set(sx !== 0 ? sx : node.baseScale.x, sy !== 0 ? sy : node.baseScale.y, sz !== 0 ? sz : node.baseScale.z)
      }

      if (!node.isRoot) {
        node.group.visible = show
        node.meshes.forEach((mesh) => {
          mesh.userData.animVisible = show
          mesh.visible = show
        })
      }
    })
  }
}

export { PLAYER_PART_IDS }
