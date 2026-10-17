import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { indexModelNodes, type AnimatedNode, type NodeIndex } from '../../cpm-viewer/cpmAnimationPlayer'
import {
  arcFrameRange,
  arcSampleFrames,
  boneTipWorld,
  clampGhostCount,
  computeBoneTipLocal,
  ghostFrames,
  GHOST_MAX_FRAMES,
} from '../editorArc'

const mesh = (width: number, height: number, depth: number, position: [number, number, number]): THREE.Mesh => {
  const result = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial(),
  )
  result.position.set(...position)
  return result
}

function nodeAt(index: NodeIndex, storeId: number): AnimatedNode {
  const node = index.get(storeId)
  if (!node) throw new Error(`Нет узла ${storeId}`)
  return node
}

function makeBoneModel(): NodeIndex {
  const root = new THREE.Group()
  const bone = new THREE.Group()
  bone.userData.storeID = 100
  bone.position.set(0, 4, 0)
  bone.add(mesh(2, 4, 2, [0, -2, 0]))
  root.add(bone)
  return indexModelNodes(root)
}

function makeRootModel(): NodeIndex {
  const root = new THREE.Group()
  const head = new THREE.Group()
  head.userData.storeID = 0
  head.userData.isRoot = true
  const hat = new THREE.Group()
  hat.userData.storeID = 100
  hat.position.set(0, 4, 0)
  hat.add(mesh(2, 4, 2, [0, -2, 0]))
  head.add(hat)
  root.add(head)
  return indexModelNodes(root)
}

describe('computeBoneTipLocal', () => {
  it('puts the tip on the far face of the bone box along its longest axis', () => {
    const index = makeBoneModel()
    const node = nodeAt(index, 100)

    const tip = computeBoneTipLocal(node, index)

    expect(tip.x).toBeCloseTo(0)
    expect(tip.y).toBeCloseTo(-4)
    expect(tip.z).toBeCloseTo(0)
  })

  it('uses the whole subtree for a root bone without its own geometry', () => {
    const index = makeRootModel()
    const node = nodeAt(index, 0)

    const tip = computeBoneTipLocal(node, index)

    expect(tip.x).toBeCloseTo(0)
    expect(tip.y).toBeCloseTo(4)
    expect(tip.z).toBeCloseTo(0)
  })

  it('uses only its own geometry when a root bone has one', () => {
    const root = new THREE.Group()
    const head = new THREE.Group()
    head.userData.storeID = 0
    head.userData.isRoot = true
    head.add(mesh(2, 4, 2, [0, -2, 0]))
    const hat = new THREE.Group()
    hat.userData.storeID = 100
    hat.position.set(0, 4, 0)
    hat.add(mesh(2, 20, 2, [0, -10, 0]))
    head.add(hat)
    root.add(head)
    const index = indexModelNodes(root)

    const tip = computeBoneTipLocal(nodeAt(index, 0), index)

    expect(tip.x).toBeCloseTo(0)
    expect(tip.y).toBeCloseTo(-4)
    expect(tip.z).toBeCloseTo(0)
  })

  it('stays stable when the animated transform of the bone changes', () => {
    const index = makeBoneModel()
    const node = nodeAt(index, 100)
    const first = computeBoneTipLocal(node, index)

    node.group.position.set(12, -7, 3)
    node.group.rotation.set(0.4, 1.1, -0.6)
    node.group.scale.set(1.4, 0.8, 2)
    const second = computeBoneTipLocal(node, index)
    const repeated = computeBoneTipLocal(node, index)

    expect(second.toArray()).toEqual(first.toArray())
    expect(repeated.toArray()).toEqual(first.toArray())
  })

  it('returns the pivot for a bone without geometry', () => {
    const root = new THREE.Group()
    const bone = new THREE.Group()
    bone.userData.storeID = 7
    root.add(bone)
    const index = indexModelNodes(root)

    const tip = computeBoneTipLocal(nodeAt(index, 7), index)

    expect(tip.toArray()).toEqual([0, 0, 0])
  })
})

describe('boneTipWorld', () => {
  it('transforms the local tip by the current world matrix', () => {
    const index = makeBoneModel()
    const node = nodeAt(index, 100)
    const tip = computeBoneTipLocal(node, index)
    node.group.position.set(10, 0, 0)
    node.group.updateMatrixWorld(true)

    const world = boneTipWorld(node, tip)

    expect(world.x).toBeCloseTo(10)
    expect(world.y).toBeCloseTo(-4)
    expect(world.z).toBeCloseTo(0)
  })
})

describe('arcFrameRange', () => {
  it('clamps the window around the current frame', () => {
    expect(arcFrameRange(0, 20)).toEqual({ start: 0, end: 6 })
    expect(arcFrameRange(10, 20)).toEqual({ start: 4, end: 16 })
    expect(arcFrameRange(19, 20)).toEqual({ start: 13, end: 19 })
    expect(arcFrameRange(10, 20, 3)).toEqual({ start: 7, end: 13 })
  })

  it('survives an empty animation', () => {
    expect(arcFrameRange(5, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('arcSampleFrames', () => {
  it('samples sub-frame positions and keeps the anchor frames', () => {
    expect(arcSampleFrames({ start: 1, end: 3 }, 2)).toEqual([1, 1.5, 2, 2.5, 3])
    expect(arcSampleFrames({ start: 2, end: 2 }, 2)).toEqual([2])
  })
})

describe('ghostFrames', () => {
  it('returns neighboring frames inside the animation', () => {
    expect(ghostFrames(2, 2, 2, 8)).toEqual([
      { frame: 0, offset: -2 },
      { frame: 1, offset: -1 },
      { frame: 3, offset: 1 },
      { frame: 4, offset: 2 },
    ])
  })

  it('clips the neighbors at the animation edges', () => {
    expect(ghostFrames(0, 2, 1, 5)).toEqual([
      { frame: 1, offset: 1 },
    ])
    expect(ghostFrames(4, 1, 2, 5)).toEqual([
      { frame: 3, offset: -1 },
    ])
  })

  it('returns nothing when ghosts are disabled', () => {
    expect(ghostFrames(2, 0, 0, 8)).toEqual([])
  })
})

describe('clampGhostCount', () => {
  it('keeps the ghost count inside the allowed range', () => {
    expect(clampGhostCount(-2)).toBe(0)
    expect(clampGhostCount(3.7)).toBe(4)
    expect(clampGhostCount(99)).toBe(GHOST_MAX_FRAMES)
    expect(clampGhostCount(Number.NaN)).toBe(0)
  })
})
