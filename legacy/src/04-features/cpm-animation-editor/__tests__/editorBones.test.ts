import { describe, expect, it } from 'vitest'
import type { CPMChild, CPMConfig } from '@/05-entities'
import {
  buildEditorBoneTree,
  findDuplicateBoneIds,
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

const hiddenConfig: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'head',
      name: 'Голова',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      children: [
        {
          name: 'Видимая',
          size: { x: 1, y: 1, z: 1 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          storeID: 100,
        },
        {
          name: 'Скрытая',
          size: { x: 1, y: 1, z: 1 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          storeID: 101,
          show: false,
          children: [
            {
              name: 'Вложенная',
              size: { x: 1, y: 1, z: 1 },
              offset: { x: 0, y: 0, z: 0 },
              pos: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              storeID: 102,
            },
          ],
        },
      ],
    },
    {
      id: 'pivot',
      name: 'Скрытая группа',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customPart: true,
      storeID: 7,
      showInEditor: false,
      children: [
        {
          name: 'Куб скрытой группы',
          size: { x: 1, y: 1, z: 1 },
          offset: { x: 0, y: 0, z: 0 },
          pos: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          storeID: 103,
        },
      ],
    },
    {
      id: 'body',
      name: 'Тело',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  ],
}

const duplicateCube = (storeID: number): CPMChild => ({
  name: 'Left Arm Top',
  size: { x: 4, y: 8, z: 4 },
  offset: { x: 0, y: 0, z: 0 },
  pos: { x: 1, y: 2, z: 3 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  storeID,
})

const duplicateConfig: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [
    {
      id: 'custom_a',
      name: 'Рука A',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customPart: true,
      storeID: 7,
      children: [duplicateCube(100)],
    },
    {
      id: 'custom_b',
      name: 'Рука B',
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customPart: true,
      storeID: 8,
      children: [duplicateCube(101)],
    },
  ],
}

const layeredConfig: CPMConfig = {
  skinSize: { x: 64, y: 64 },
  elements: [{
    id: 'custom_a',
    name: 'Рука A',
    pos: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    customPart: true,
    storeID: 7,
    children: [duplicateCube(100), duplicateCube(101)],
  }],
}

describe('findDuplicateBoneIds', () => {
  it('flags coincident same-name bones coming from different roots', () => {
    expect([...findDuplicateBoneIds(duplicateConfig)]).toEqual([101])
  })

  it('keeps coincident same-name bones inside one root', () => {
    expect(findDuplicateBoneIds(layeredConfig).size).toBe(0)
  })

  it('builds the tree without the flagged duplicates', () => {
    const rows = flattenEditorBoneTree(
      buildEditorBoneTree(duplicateConfig, new Set([101])),
    )

    expect(rows.map((row) => row.storeId)).toEqual([7, 100, 8])
  })
})

describe('buildEditorBoneTree', () => {
  it('omits bones hidden from the model editor together with their subtrees', () => {
    const tree = buildEditorBoneTree(hiddenConfig)

    expect(flattenEditorBoneTree(tree).map((row) => row.storeId)).toEqual([0, 100, 1])
    expect(firstAnimatableBoneId(tree)).toBe(0)
  })

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
