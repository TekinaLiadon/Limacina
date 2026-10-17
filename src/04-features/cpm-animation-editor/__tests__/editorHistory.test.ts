import { describe, expect, it } from 'vitest'
import type {
  CPMAnimation,
  CPMAnimationFrame,
  CPMConfig,
  CPMVec3,
} from '@/05-entities'
import { buildEditorBoneIndex, buildEditorState } from '../editorModel'
import { setBonePose, updateAnimationData } from '../editorOperations'
import {
  canRedoEditorHistory,
  canUndoEditorHistory,
  commitEditorHistory,
  createEditorHistory,
  currentEditorState,
  redoEditorHistory,
  undoEditorHistory,
} from '../editorHistory'
import type { EditorAnimationState, EditorPose } from '../types'

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Head',
      pos: vec(),
      rotation: vec(),
      children: [
        {
          name: 'Hat',
          size: vec(8, 8, 8),
          offset: vec(),
          pos: vec(0, 4, 0),
          rotation: vec(),
          scale: vec(1, 1, 1),
          storeID: 100,
        },
      ],
    },
  ],
}

const index = buildEditorBoneIndex(config)

const emptyFrames = (count: number): CPMAnimationFrame[] =>
  Array.from({ length: count }, () => ({ components: [] }))

const animation: CPMAnimation = {
  id: 'g_wave.json',
  name: 'Wave',
  kind: 'gesture',
  duration: 1000,
  priority: 0,
  loop: false,
  additive: false,
  interpolator: 'linear_loop',
  hidden: false,
  frames: emptyFrames(4),
}

const pose = (rotation: CPMVec3 = vec()): EditorPose => ({
  rotation: { ...rotation },
  pos: vec(0, 4, 0),
  show: true,
})

const apply = (state: EditorAnimationState | null): EditorAnimationState => {
  if (!state) throw new Error('Операция не применилась')
  return state
}

function makeStates(): {
  initial: EditorAnimationState
  withKey: EditorAnimationState
  withData: EditorAnimationState
} {
  const initial = buildEditorState(animation, index)
  const withKey = apply(setBonePose(initial, 100, 1, pose(vec(0, 20, 0))))
  const withData = apply(updateAnimationData(withKey, {
    name: 'Renamed',
    kind: 'setup',
    loop: true,
    hidden: true,
    priority: 5,
  }))
  return { initial, withKey, withData }
}

describe('editorHistory', () => {
  it('undoes and redoes pose and animation data changes', () => {
    const { initial, withKey, withData } = makeStates()
    let history = createEditorHistory(initial)
    history = commitEditorHistory(history, withKey, 'Ключ')
    history = commitEditorHistory(history, withData, 'Свойства')

    expect(canUndoEditorHistory(history)).toBe(true)
    expect(canRedoEditorHistory(history)).toBe(false)
    expect(currentEditorState(history).data.name).toBe('Renamed')

    history = undoEditorHistory(history)
    expect(currentEditorState(history).data.name).toBe('Wave')
    expect(currentEditorState(history).data.kind).toBe('gesture')
    expect(currentEditorState(history).model.bones.has(100)).toBe(true)

    history = undoEditorHistory(history)
    expect(currentEditorState(history).data.name).toBe('Wave')
    expect(currentEditorState(history).model.bones.has(100)).toBe(false)
    expect(canUndoEditorHistory(history)).toBe(false)

    history = redoEditorHistory(history)
    expect(currentEditorState(history).model.bones.has(100)).toBe(true)
    expect(currentEditorState(history).data.kind).toBe('gesture')

    history = redoEditorHistory(history)
    expect(currentEditorState(history).data.name).toBe('Renamed')
    expect(currentEditorState(history).data.kind).toBe('setup')
    expect(currentEditorState(history).data.loop).toBe(true)
    expect(currentEditorState(history).data.hidden).toBe(true)
    expect(currentEditorState(history).data.priority).toBe(5)
    expect(canRedoEditorHistory(history)).toBe(false)
  })

  it('drops the redo branch when a new change is committed after undo', () => {
    const { initial, withKey, withData } = makeStates()
    let history = createEditorHistory(initial)
    history = commitEditorHistory(history, withKey, 'Ключ')
    history = commitEditorHistory(history, withData, 'Свойства')
    history = undoEditorHistory(history)

    const alternative = apply(updateAnimationData(withKey, { name: 'Alternative' }))
    history = commitEditorHistory(history, alternative, 'Другое имя')

    expect(canRedoEditorHistory(history)).toBe(false)
    expect(currentEditorState(history).data.name).toBe('Alternative')
    history = undoEditorHistory(history)
    expect(currentEditorState(history).data.name).toBe('Wave')
  })

  it('keeps the history within its limit', () => {
    const { initial, withKey, withData } = makeStates()
    let history = createEditorHistory(initial, 'Начальное состояние', 2)
    history = commitEditorHistory(history, withKey, 'Ключ')
    history = commitEditorHistory(history, withData, 'Свойства')

    expect(history.entries).toHaveLength(2)
    expect(currentEditorState(history).data.name).toBe('Renamed')
    expect(canUndoEditorHistory(history)).toBe(true)

    history = undoEditorHistory(history)
    expect(currentEditorState(history).model.bones.has(100)).toBe(true)
    expect(canUndoEditorHistory(history)).toBe(false)
  })
})
