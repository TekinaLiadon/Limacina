import type {
  CPMAnimation,
  CPMAnimationInterpolator,
  CPMAnimationKind,
  CPMVec3,
} from '@/05-entities'

export const EDITOR_QUANTIZATION_EPSILON = 0.01

export const EDITOR_KIND_LABELS: Record<CPMAnimationKind, string> = {
  gesture: 'Жест',
  'custom-pose': 'Своя поза',
  'vanilla-pose': 'Ванильная поза',
  layer: 'Слой',
  'value-layer': 'Слой-значение',
  setup: 'Подготовка',
  finish: 'Завершение',
}

export const EDITOR_NEW_ANIMATION_NAME = 'Новая анимация'

export interface EditorPose {
  rotation: CPMVec3
  pos: CPMVec3
  show: boolean
}

export interface EditorBoneFrame extends EditorPose {
  scale: CPMVec3
  color: string
}

export interface EditorBoneInfo {
  storeId: number
  name: string
  rest: EditorPose
  scale: CPMVec3
  showInEditor: boolean
}

export interface EditorBoneIndex {
  bones: Map<number, EditorBoneInfo>
  order: number[]
}

export interface EditorBoneTrack {
  storeId: number
  frames: EditorBoneFrame[]
  keys: number[]
}

export interface EditorAnimationModel {
  frameCount: number
  bones: Map<number, EditorBoneTrack>
}

export type EditorAnimationData = Omit<CPMAnimation, 'frames'>

export interface EditorAnimationState {
  data: EditorAnimationData
  index: EditorBoneIndex
  model: EditorAnimationModel
  frameColors: ReadonlyMap<number, string>
  holdLastPose: boolean
}

export interface EditorKeyFrame {
  frame: number
  data: EditorBoneFrame
}

export type EditorInterpolator = CPMAnimationInterpolator
export type EditorAnimationKind = CPMAnimationKind

export type EditorBeadMode = 'single' | 'proportional'

export interface EditorTimeBead {
  fromFrame: number
  toFrame: number
}
