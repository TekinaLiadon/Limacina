import type {
  CPMAnimation,
  CPMAnimationFrame,
  CPMAnimationFrameComponent,
  CPMChild,
  CPMConfig,
  CPMElement,
  CPMVec3,
} from '@/05-entities'
import type {
  EditorAnimationData,
  EditorAnimationModel,
  EditorAnimationState,
  EditorBoneFrame,
  EditorBoneIndex,
  EditorBoneInfo,
  EditorBoneTrack,
  EditorPose,
} from './types'
import { PLAYER_PART_ORDINALS } from '../cpm-viewer/playerParts'

const zeroVec = (): CPMVec3 => ({ x: 0, y: 0, z: 0 })
const oneVec = (): CPMVec3 => ({ x: 1, y: 1, z: 1 })

export function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = (normalizeAngle(to) - normalizeAngle(from)) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

function normalizeVec(value: CPMVec3): CPMVec3 {
  return {
    x: normalizeAngle(value.x),
    y: normalizeAngle(value.y),
    z: normalizeAngle(value.z),
  }
}

export function createRestFrame(rest: EditorPose): EditorBoneFrame {
  return {
    rotation: { ...rest.rotation },
    pos: { ...rest.pos },
    show: rest.show,
    scale: oneVec(),
    color: '0',
  }
}

export function resolveBoneRest(bone: EditorBoneInfo, additive: boolean): EditorPose {
  if (!additive) {
    return {
      rotation: { ...bone.rest.rotation },
      pos: { ...bone.rest.pos },
      show: bone.rest.show,
    }
  }
  return {
    rotation: zeroVec(),
    pos: zeroVec(),
    show: bone.rest.show,
  }
}

function addBone(index: EditorBoneIndex, bone: EditorBoneInfo): void {
  if (!index.bones.has(bone.storeId)) index.order.push(bone.storeId)
  index.bones.set(bone.storeId, bone)
}

function walkChildren(children: CPMChild[] | undefined, index: EditorBoneIndex): void {
  if (!children) return
  for (const child of children) {
    if (typeof child.storeID === 'number') {
      addBone(index, {
        storeId: child.storeID,
        name: child.name,
        rest: {
          rotation: normalizeVec(child.rotation ?? zeroVec()),
          pos: { ...(child.pos ?? zeroVec()) },
          show: child.hidden !== true,
        },
        scale: { ...(child.scale ?? oneVec()) },
        showInEditor: child.show !== false,
      })
    }
    walkChildren(child.children, index)
  }
}

function addElementBone(element: CPMElement, storeId: number, index: EditorBoneIndex): void {
  addBone(index, {
    storeId,
    name: element.name || element.id,
    rest: {
      rotation: normalizeVec(element.rotation ?? zeroVec()),
      pos: { ...(element.pos ?? zeroVec()) },
      show: element.show !== false,
    },
    scale: { ...(element.scale ?? oneVec()) },
    showInEditor: element.showInEditor !== false,
  })
}

export function resolveRootStoreId(element: CPMElement): number | null {
  const isPivot = element.customPart === true || element.dup === true
  const ordinal = PLAYER_PART_ORDINALS[element.id]
  const storeId = isPivot || ordinal === undefined ? element.storeID : ordinal
  return typeof storeId === 'number' ? storeId : null
}

export function buildEditorBoneIndex(config: CPMConfig): EditorBoneIndex {
  const index: EditorBoneIndex = { bones: new Map(), order: [] }

  for (const element of config.elements ?? []) {
    const storeId = resolveRootStoreId(element)
    if (storeId !== null) addElementBone(element, storeId, index)
    walkChildren(element.children, index)
  }

  return index
}

function isFrameDefault(frame: EditorBoneFrame, rest: EditorPose): boolean {
  return frame.show === rest.show
    && frame.rotation.x === rest.rotation.x
    && frame.rotation.y === rest.rotation.y
    && frame.rotation.z === rest.rotation.z
    && frame.pos.x === rest.pos.x
    && frame.pos.y === rest.pos.y
    && frame.pos.z === rest.pos.z
    && frame.scale.x === 1
    && frame.scale.y === 1
    && frame.scale.z === 1
    && frame.color === '0'
}

export function isTrackDefault(track: EditorBoneTrack, rest: EditorPose): boolean {
  return track.frames.every((frame) => isFrameDefault(frame, rest))
}

function componentToFrame(component: CPMAnimationFrameComponent): EditorBoneFrame {
  return {
    rotation: normalizeVec(component.rotation),
    pos: { ...component.pos },
    show: component.show,
    scale: { ...component.scale },
    color: component.color ?? '0',
  }
}

function buildModel(
  frames: CPMAnimationFrame[],
  additive: boolean,
  index: EditorBoneIndex,
): EditorAnimationModel {
  const touched = new Set<number>()
  for (const frame of frames) {
    for (const component of frame.components) touched.add(component.storeID)
  }

  const bones = new Map<number, EditorBoneTrack>()
  for (const storeId of [...touched].sort((a, b) => a - b)) {
    const bone = index.bones.get(storeId)
    if (!bone) continue

    const rest = resolveBoneRest(bone, additive)
    const trackFrames: EditorBoneFrame[] = []
    const keys: number[] = []
    frames.forEach((frame, frameIndex) => {
      const component = frame.components.find((item) => item.storeID === storeId)
      if (!component) {
        trackFrames.push(createRestFrame(rest))
        return
      }
      keys.push(frameIndex)
      trackFrames.push(componentToFrame(component))
    })

    const track: EditorBoneTrack = { storeId, frames: trackFrames, keys }
    if (!isTrackDefault(track, rest)) bones.set(storeId, track)
  }

  return { frameCount: frames.length, bones }
}

export function buildEditorModel(animation: CPMAnimation, index: EditorBoneIndex): EditorAnimationModel {
  return buildModel(animation.frames, animation.additive, index)
}

export function buildEditorState(
  animation: CPMAnimation,
  index: EditorBoneIndex,
  frameColors: ReadonlyMap<number, string> = new Map(),
  holdLastPose = false,
): EditorAnimationState {
  const { frames, ...data } = animation
  return {
    data: data as EditorAnimationData,
    index,
    model: buildModel(frames, animation.additive, index),
    frameColors,
    holdLastPose,
  }
}

export function bonePoseAt(
  state: EditorAnimationState,
  bone: EditorBoneInfo,
  frame: number,
): EditorPose {
  const track = state.model.bones.get(bone.storeId)
  const frameData = track?.frames[frame]
  if (frameData) {
    return {
      rotation: { ...frameData.rotation },
      pos: { ...frameData.pos },
      show: frameData.show,
    }
  }
  return resolveBoneRest(bone, state.data.additive)
}

export function isBoneKeyAt(state: EditorAnimationState, storeId: number, frame: number): boolean {
  return state.model.bones.get(storeId)?.keys.includes(frame) ?? false
}

export function serializeEditorAnimation(state: EditorAnimationState): CPMAnimation {
  const frames: CPMAnimationFrame[] = Array.from(
    { length: state.model.frameCount },
    () => ({ components: [] as CPMAnimationFrameComponent[] }),
  )

  for (const track of state.model.bones.values()) {
    track.frames.forEach((pose, frameIndex) => {
      const frame = frames[frameIndex]
      if (!frame) return
      frame.components.push({
        storeID: track.storeId,
        pos: { ...pose.pos },
        rotation: { ...pose.rotation },
        scale: { ...pose.scale },
        show: pose.show,
        color: pose.color,
      })
    })
  }

  return { ...state.data, frames }
}
