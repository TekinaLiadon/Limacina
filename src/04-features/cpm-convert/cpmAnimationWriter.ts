import { CpmBinaryWriter, wrapAngle360 } from './cpmBinaryWriter'
import { parseHexColor, reportError } from '@/06-shared'
import {
  SKIN_LAYERS,
  skinLayerMask,
  type CPMAnimEnc,
  type CPMAnimation,
  type CPMAnimationFrameComponent,
  type CPMAnimationInterpolator,
  type CPMSkinLayer,
  type CPMVec3,
} from '@/05-entities'

export const ANIMATION_DATA_PART = 10

const TYPE = {
  END: 0, POSE: 1, GESTURE: 2, ANIMATION_DATA_ROTATION: 3, ANIMATION_DATA_POS: 4,
  ANIMATION_DATA_VIS: 5, ANIMATION_DATA_COLOR: 6, ANIMATION_INFO: 7, ENCODING: 8,
  CTRL_IDS: 9, ANIMATION_DATA_EXTRA: 10, ANIMATION_DATA_INTERPOLATION: 11,
  ANIMATION_DATA_SCALE: 12, ANIMATION_DATA_LAYER_DEFAULT: 13, ANIMATION_DATA_ORDER: 14,
  ANIMATION_DATA_IS_PROPERTY: 15, ANIMATION_DATA_GROUP: 16, ANIMATION_DATA_COMMAND: 18,
  ANIMATION_DATA_ENC: 19, ANIMATION_MUST_FINISH: 20, ANIMATION_SLIDER_OPT: 21,
  ANIMATION_BUTTON_HIDDEN: 22,
}

const INTERPOLATOR_INDEX: Record<CPMAnimationInterpolator, number> = {
  poly_loop: 0,
  poly_single: 1,
  linear_loop: 2,
  linear_single: 3,
  no: 4,
  trig_loop: 5,
  trig_single: 6,
}

const NAME_PREFIXES: Partial<Record<CPMAnimation['kind'], string>> = {
  layer: '$layer$',
  'value-layer': '$value$',
  setup: '$pre$',
  finish: '$post$',
}

const CUSTOM_POSE_INDEX = 0
const UNKNOWN_GID = -1
const MAX_ANIMATION_ID = 250
const MAX_GID = 0xFF
const CHANGE_EPSILON = 0.01
const VEC_DIV = Math.floor(32767 / 48)
const MIN_FREE_LAYERS = 2
const LAYER_FALLBACK_MESSAGE =
  'Анимации сохранены без привязки к слоям скина: в проекте нет подходящего anim_enc.json'

export interface CpmAnimationElement {
  id: number
  pos: CPMVec3
  rotation: CPMVec3
  hidden: boolean
  texture: boolean
  recolor: boolean
  rgb: number
}

export type CpmAnimationElementIndex = Map<number, CpmAnimationElement>

export interface CpmAnimationExport {
  animations: CPMAnimation[]
  animEnc: CPMAnimEnc | null
  elements: CpmAnimationElementIndex
}

interface ChannelData {
  pos: CPMVec3
  rot: CPMVec3
  scale: CPMVec3
  show: boolean
  color: CPMVec3
}

interface TrackChannels {
  pos: CPMVec3[] | null
  rot: CPMVec3[] | null
  scale: CPMVec3[] | null
  show: boolean[] | null
  color: CPMVec3[] | null
}

interface ResolvedAnimation {
  id: number
  frames: CPMAnimationFrameComponent[][]
  poseIndex: number | null
  poseName: string | null
  name: string | null
  add: boolean
  loop: boolean
  duration: number
  priority: number
  interpolator: number
  gid: number
  layerCtrl: boolean
  componentIds: number[]
  tracks: TrackChannels[]
  defaultValue: number
  order: number
  isProperty: boolean
  group: string | null
  command: boolean
  mustFinish: boolean
  maxValue: number
  interpolateValue: boolean
  buttonHidden: boolean
}

function isStaged(kind: CPMAnimation['kind']): boolean {
  return kind === 'setup' || kind === 'finish'
}

function isLayer(kind: CPMAnimation['kind']): boolean {
  return kind === 'layer' || kind === 'value-layer'
}

function isCustom(kind: CPMAnimation['kind']): boolean {
  return kind !== 'vanilla-pose'
}

function isTriggerable(kind: CPMAnimation['kind']): boolean {
  return kind !== 'vanilla-pose' && !isStaged(kind) && !isLayer(kind)
}

function nameId(name: string): string {
  const index = name.indexOf('#')
  if (index === -1) return name
  if (index === 0) return ''
  return name.slice(0, index)
}

function animationName(animation: CPMAnimation): string {
  const base = nameId(animation.name)
  const prefix = NAME_PREFIXES[animation.kind]
  return prefix === undefined ? base : prefix + base
}

function rgbToVec(rgb: number): CPMVec3 {
  return { x: (rgb >> 16) & 0xFF, y: (rgb >> 8) & 0xFF, z: rgb & 0xFF }
}

function componentColor(component: CPMAnimationFrameComponent): CPMVec3 {
  return rgbToVec(parseHexColor(component.color ?? '0') ?? 0)
}

function defaultChannels(element: CpmAnimationElement, add: boolean): ChannelData {
  return {
    pos: add ? { x: 0, y: 0, z: 0 } : element.pos,
    rot: add ? { x: 0, y: 0, z: 0 } : element.rotation,
    scale: { x: 1, y: 1, z: 1 },
    show: !element.hidden,
    color: add ? { x: 0, y: 0, z: 0 } : rgbToVec(element.rgb),
  }
}

function componentChannels(component: CPMAnimationFrameComponent): ChannelData {
  return {
    pos: component.pos,
    rot: component.rotation,
    scale: component.scale,
    show: component.show,
    color: componentColor(component),
  }
}

function changed(a: number, b: number): boolean {
  return Math.abs(a - b) > CHANGE_EPSILON
}

function hasPosChanges(data: ChannelData, element: CpmAnimationElement, add: boolean): boolean {
  const target = add ? { x: 0, y: 0, z: 0 } : element.pos
  return changed(data.pos.x, target.x) || changed(data.pos.y, target.y) || changed(data.pos.z, target.z)
}

function hasRotChanges(data: ChannelData, element: CpmAnimationElement, add: boolean): boolean {
  const target = add ? { x: 0, y: 0, z: 0 } : element.rotation
  return changed(data.rot.x, target.x) || changed(data.rot.y, target.y) || changed(data.rot.z, target.z)
}

function hasScaleChanges(data: ChannelData): boolean {
  return changed(data.scale.x, 1) || changed(data.scale.y, 1) || changed(data.scale.z, 1)
}

function hasColorChanges(data: ChannelData, element: CpmAnimationElement): boolean {
  if (element.texture && !element.recolor) return false
  const target = rgbToVec(element.rgb)
  return data.color.x !== target.x || data.color.y !== target.y || data.color.z !== target.z
}

function hasShowChanges(data: ChannelData, element: CpmAnimationElement): boolean {
  return element.hidden === data.show
}

function buildTrack(
  frames: CPMAnimationFrameComponent[][],
  storeId: number,
  element: CpmAnimationElement,
  add: boolean,
): TrackChannels | null {
  const components = frames.map((frame) => frame.find((component) => component.storeID === storeId) ?? null)
  const empty = defaultChannels(element, add)
  const filled = components.map((component) => component === null ? empty : componentChannels(component))
  const present = filled.filter((_, index) => components[index] !== null)

  const any = (predicate: (data: ChannelData) => boolean): boolean => present.some(predicate)
  const hasPos = any((data) => hasPosChanges(data, element, add))
  const hasRot = any((data) => hasRotChanges(data, element, add))
  const hasScale = any((data) => hasScaleChanges(data))
  const hasColor = any((data) => hasColorChanges(data, element))
  const hasShow = any((data) => hasShowChanges(data, element))
  if (!hasPos && !hasRot && !hasScale && !hasColor && !hasShow) return null

  return {
    pos: hasPos ? filled.map((data) => data.pos) : null,
    rot: hasRot ? filled.map((data) => data.rot) : null,
    scale: hasScale ? filled.map((data) => data.scale) : null,
    show: hasShow ? filled.map((data) => data.show) : null,
    color: hasColor ? filled.map((data) => data.color) : null,
  }
}

function buildAnimation(animation: CPMAnimation, elements: CpmAnimationElementIndex): ResolvedAnimation | null {
  if (animation.kind === 'vanilla-pose' && animation.poseIndex === undefined) return null

  const frames = animation.frames.map((frame) => frame.components)
  const storeIds = frames
    .flatMap((components) => components.map((component) => component.storeID))
    .filter((storeId, index, all) => all.indexOf(storeId) === index)

  const tracks: TrackChannels[] = []
  const componentIds: number[] = []
  const add = animation.additive
  for (const storeId of storeIds) {
    const element = elements.get(storeId)
    if (element === undefined) continue
    const track = buildTrack(frames, storeId, element, add)
    if (track === null) continue
    tracks.push(track)
    componentIds.push(element.id)
  }
  if (tracks.length === 0) return null

  const entry: ResolvedAnimation = {
    id: 0,
    frames,
    poseIndex: null,
    poseName: null,
    name: null,
    add,
    loop: animation.loop,
    duration: animation.duration,
    priority: animation.priority,
    interpolator: INTERPOLATOR_INDEX[animation.interpolator],
    gid: 0,
    layerCtrl: false,
    componentIds,
    tracks,
    defaultValue: 0,
    order: 0,
    isProperty: false,
    group: null,
    command: false,
    mustFinish: animation.mustFinish ?? false,
    maxValue: 0,
    interpolateValue: true,
    buttonHidden: false,
  }

  if (animation.kind === 'vanilla-pose') {
    entry.poseIndex = animation.poseIndex ?? null
    return entry
  }
  if (animation.kind === 'custom-pose') {
    entry.poseName = nameId(animation.name)
    return entry
  }

  entry.name = animationName(animation)
  if (isLayer(animation.kind)) {
    entry.defaultValue = Math.trunc((animation.layerDefault ?? 0) * 0xFF) & 0xFF
  }
  if (isCustom(animation.kind) && !isStaged(animation.kind)) {
    entry.command = animation.command ?? false
    if (!entry.command) entry.order = animation.order ?? 0
    entry.buttonHidden = animation.hidden
  }
  if (isLayer(animation.kind) && !entry.command) entry.isProperty = animation.isProperty ?? false
  if (animation.kind === 'layer' && (animation.group ?? '') !== '') entry.group = animation.group ?? null
  if (animation.kind === 'value-layer') {
    entry.maxValue = (animation.maxValue ?? 100) & 0xFF
    entry.interpolateValue = animation.interpolateValue ?? true
  }
  return entry
}

function enabledLayers(animEnc: CPMAnimEnc): CPMSkinLayer[] {
  const enabled: CPMSkinLayer[] = []
  for (const layer of SKIN_LAYERS) {
    if (animEnc.defaultValues[layer] === true) enabled.push(layer)
  }
  return enabled
}

function encodingMask(id: number, freeLayers: CPMSkinLayer[]): number | null {
  let mask = 0
  freeLayers.forEach((layer, index) => {
    if ((id & (1 << index)) !== 0) mask |= 1 << SKIN_LAYERS.indexOf(layer)
  })
  return mask === skinLayerMask(freeLayers) ? null : mask
}

function resetIdOf(defMask: number, valMask: number): number {
  return (defMask | valMask) & 0xFF
}

function animationKey(animation: CPMAnimation, entry: ResolvedAnimation): string {
  return animation.kind === 'custom-pose' ? animation.name : entry.name ?? ''
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function writeAnimationVec(writer: CpmBinaryWriter, v: CPMVec3): void {
  writer.writeShort(clamp(Math.trunc(v.x * VEC_DIV), -32768, 32767))
  writer.writeShort(clamp(Math.trunc(v.y * VEC_DIV), -32768, 32767))
  writer.writeShort(clamp(Math.trunc(v.z * VEC_DIV), -32768, 32767))
}

function writeAnimationAngle(writer: CpmBinaryWriter, v: CPMVec3): void {
  writer.writeShort(clamp(Math.trunc(wrapAngle360(v.x) / 360 * 65535), 0, 65535))
  writer.writeShort(clamp(Math.trunc(wrapAngle360(v.y) / 360 * 65535), 0, 65535))
  writer.writeShort(clamp(Math.trunc(wrapAngle360(v.z) / 360 * 65535), 0, 65535))
}

function writeShowFrames(writer: CpmBinaryWriter, frames: boolean[]): void {
  for (let frame = 0; frame < frames.length; frame += 8) {
    let flags = 0
    for (let bit = 0; bit < 8 && frame + bit < frames.length; bit++) {
      if (frames[frame + bit] === true) flags |= 1 << bit
    }
    writer.writeByte(flags)
  }
}

function writeChannels(writer: CpmBinaryWriter, animationId: number, track: TrackChannels, index: number): void {
  const channel = (type: number, writeFn: (block: CpmBinaryWriter) => void): void => {
    writer.writeObjectBlock(type, (block) => {
      block.writeByte(animationId)
      block.writeByte(index)
      writeFn(block)
    })
  }

  const { pos, rot, scale, show, color } = track
  if (pos !== null) channel(TYPE.ANIMATION_DATA_POS, (block) => pos.forEach((v) => writeAnimationVec(block, v)))
  if (rot !== null) channel(TYPE.ANIMATION_DATA_ROTATION, (block) => rot.forEach((v) => writeAnimationAngle(block, v)))
  if (color !== null) {
    channel(TYPE.ANIMATION_DATA_COLOR, (block) => color.forEach((v) => {
      block.writeByte(v.x)
      block.writeByte(v.y)
      block.writeByte(v.z)
    }))
  }
  if (show !== null) channel(TYPE.ANIMATION_DATA_VIS, (block) => writeShowFrames(block, show))
  if (scale !== null) channel(TYPE.ANIMATION_DATA_SCALE, (block) => scale.forEach((v) => writeAnimationVec(block, v)))
}

function writeEntry(writer: CpmBinaryWriter, entry: ResolvedAnimation): void {
  if (entry.poseIndex !== null || entry.poseName !== null) {
    writer.writeObjectBlock(TYPE.POSE, (block) => {
      block.writeByte(entry.poseIndex ?? CUSTOM_POSE_INDEX)
      block.writeByte(entry.id)
      block.writeByte(entry.add ? 1 : 0)
      if (entry.poseName !== null) block.writeUTF(entry.poseName)
    })
  } else {
    writer.writeObjectBlock(TYPE.GESTURE, (block) => {
      block.writeByte(entry.id)
      block.writeUTF(entry.name ?? '')
      block.writeByte((entry.add ? 1 : 0) | (entry.loop ? 2 : 0))
    })
  }

  writer.writeObjectBlock(TYPE.ANIMATION_INFO, (block) => {
    block.writeByte(entry.id)
    block.writeByte(entry.componentIds.length)
    block.writeByte(entry.frames.length)
    block.writeShort(entry.duration)
    entry.componentIds.forEach((componentId) => block.writeVarInt(componentId))
  })

  if (entry.gid !== UNKNOWN_GID) {
    writer.writeObjectBlock(entry.layerCtrl ? TYPE.ENCODING : TYPE.ANIMATION_DATA_ENC, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.gid)
    })
  }

  entry.tracks.forEach((track, index) => writeChannels(writer, entry.id, track, index))

  if (entry.priority !== 0) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_EXTRA, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.priority)
    })
  }
  if (entry.interpolator !== INTERPOLATOR_INDEX.poly_loop) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_INTERPOLATION, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.interpolator)
    })
  }
  if (entry.defaultValue !== 0) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_LAYER_DEFAULT, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.defaultValue)
    })
  }
  if (entry.order !== 0) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_ORDER, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.order)
    })
  }
  if (entry.isProperty) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_IS_PROPERTY, (block) => {
      block.writeByte(entry.id)
    })
  }
  if (entry.group !== null) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_GROUP, (block) => {
      block.writeByte(entry.id)
      block.writeUTF(entry.group ?? '')
    })
  }
  if (entry.command) {
    writer.writeObjectBlock(TYPE.ANIMATION_DATA_COMMAND, (block) => {
      block.writeByte(entry.id)
    })
  }
  if (entry.mustFinish) {
    writer.writeObjectBlock(TYPE.ANIMATION_MUST_FINISH, (block) => {
      block.writeByte(entry.id)
    })
  }
  if (entry.maxValue !== 0) {
    writer.writeObjectBlock(TYPE.ANIMATION_SLIDER_OPT, (block) => {
      block.writeByte(entry.id)
      block.writeByte(entry.interpolateValue ? 1 : 0)
      block.writeByte(entry.maxValue)
    })
  }
  if (entry.buttonHidden) {
    writer.writeObjectBlock(TYPE.ANIMATION_BUTTON_HIDDEN, (block) => {
      block.writeByte(entry.id)
    })
  }
}

function buildPart(entries: ResolvedAnimation[], blankId: number, resetId: number): Uint8Array {
  const writer = new CpmBinaryWriter()
  entries.forEach((entry) => writeEntry(writer, entry))
  writer.writeObjectBlock(TYPE.CTRL_IDS, (block) => {
    block.writeByte(blankId)
    block.writeByte(resetId)
  })
  writer.writeObjectBlock(TYPE.END, () => {})
  return writer.toArray()
}

export function writeAnimationParts(source: CpmAnimationExport): Uint8Array[] {
  const { animEnc } = source
  const freeLayers = animEnc === null ? [] : SKIN_LAYERS.filter((layer) => animEnc.freeLayers.includes(layer))
  const usableEncoding = freeLayers.length >= MIN_FREE_LAYERS
  const valMask = animEnc === null ? 0 : skinLayerMask(animEnc.freeLayers)
  const defMask = (animEnc === null ? 0 : skinLayerMask(enabledLayers(animEnc))) & ~valMask

  const entries: ResolvedAnimation[] = []
  const rest: ResolvedAnimation[] = []
  const addedPoses = new Set<string>()
  const addedGestures = new Set<string>()
  let usedFallback = false
  let encId = 1

  for (const animation of source.animations) {
    const entry = buildAnimation(animation, source.elements)
    if (entry === null) continue

    if (isTriggerable(animation.kind)) {
      const added = animation.kind === 'custom-pose' ? addedPoses : addedGestures
      const key = animationKey(animation, entry)
      if (usableEncoding && animation.layerControlled !== false) {
        if (!added.has(key)) {
          added.add(key)
          const mask = encodingMask(encId++, freeLayers)
          if (mask === null) {
            usedFallback = true
            rest.push(entry)
          } else {
            entry.gid = mask
            entry.layerCtrl = true
          }
        } else {
          entry.gid = UNKNOWN_GID
        }
      } else {
        if (animation.layerControlled !== false) usedFallback = true
        if (!added.has(key)) {
          added.add(key)
          rest.push(entry)
        } else {
          entry.gid = UNKNOWN_GID
        }
      }
    }

    entry.gid = (entry.gid & valMask) | defMask
    if (isStaged(animation.kind) || isLayer(animation.kind)) entry.gid = UNKNOWN_GID
    entries.push(entry)
  }

  const resetId = resetIdOf(defMask, valMask)
  rest.forEach((entry) => {
    let next = encId++
    if (next === resetId) next = encId++
    if (next > MAX_GID) throw new Error(`Контрольный id ${next} не помещается в однобайтовый диапазон`)
    entry.gid = next
  })

  if (usedFallback) reportError(LAYER_FALLBACK_MESSAGE)
  if (entries.length === 0) return []

  const chunks: ResolvedAnimation[][] = []
  let current: ResolvedAnimation[] = []
  let idCounter = 0
  for (const entry of entries) {
    let id = idCounter++
    if (id > MAX_ANIMATION_ID) {
      idCounter = 1
      id = 0
      chunks.push(current)
      current = []
    }
    entry.id = id
    current.push(entry)
  }
  if (current.length > 0) chunks.push(current)

  const blankId = defMask & 0xFF
  return chunks.map((chunk, index) => buildPart(
    chunk,
    index === chunks.length - 1 ? blankId : 0,
    index === chunks.length - 1 ? resetId : 0,
  ))
}
