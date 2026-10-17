import { describe, expect, it } from 'vitest'
import type { CPMConfig } from '@/05-entities'
import {
  buildEditorBoneTree,
  firstAnimatableBoneId,
  flattenEditorBoneTree,
} from '../editorBones'

const config: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Голова',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [
        {
          name: 'Шляпа',
          size: { x: 8, y: 8, z: 8 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 4, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          storeID: 100,
          children: [
            {
              name: 'Перо',
              size: { x: 1, y: 4, z: 1 },
              offset: { x: 0, y: 0, z: 0 },
              pos: { x: 0, y: 6, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              storeID: 101,
            },
          ],
        },
        {
          name: '',
          size: { x: 1, y: 1, z: 1 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    },
    {
      id: 'pivot',
      name: 'Крылья',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customPart: true,
      storeID: 7,
      children: [],
    },
  ],
}

describe('buildEditorBoneTree', () => {
  it('builds a nested tree with vanilla and custom store ids', () => {
    const tree = buildEditorBoneTree(config)

    expect(tree.map((node) => node.storeId)).toEqual([0, 7])
    expect(tree[0]?.name).toBe('Голова')
    expect(tree[0]?.children.map((node) => node.storeId)).toEqual([100, null])
    expect(tree[0]?.children[0]?.children[0]?.storeId).toBe(101)
  })

  it('keeps a readable name for empty child names', () => {
    const tree = buildEditorBoneTree(config)

    expect(tree[0]?.children[1]?.name).toBe('Без имени')
  })

  it('flattens the tree with depth levels', () => {
    const rows = flattenEditorBoneTree(buildEditorBoneTree(config))

    expect(rows).toEqual([
      { storeId: 0, name: 'Голова', depth: 0 },
      { storeId: 100, name: 'Шляпа', depth: 1 },
      { storeId: 101, name: 'Перо', depth: 2 },
      { storeId: null, name: 'Без имени', depth: 1 },
      { storeId: 7, name: 'Крылья', depth: 0 },
    ])
  })

  it('finds the first animatable bone depth-first', () => {
    const tree = buildEditorBoneTree(config)

    expect(firstAnimatableBoneId(tree)).toBe(0)
    expect(firstAnimatableBoneId([{ storeId: null, name: 'Пусто', children: tree }])).toBe(0)
    expect(firstAnimatableBoneId([])).toBeNull()
  })
})
