import { describe, expect, it } from 'vitest'
import type { CPMElement, CPMVec3 } from '@/05-entities'
import { resolveRootStoreId } from '../../cpm-animation-editor/editorModel'
import { CUSTOM_PART_ORDINAL, PLAYER_PART_ORDINALS, ROOT_PIVOTS, VANILLA_PLAYER_PARTS } from '../playerParts'

const vec = (x = 0, y = 0, z = 0): CPMVec3 => ({ x, y, z })

const makeElement = (id: string, overrides: Partial<CPMElement> = {}): CPMElement => ({
  id,
  name: id,
  pos: vec(),
  rotation: vec(),
  ...overrides,
})

describe('player parts registry', () => {
  it('maps the vanilla parts to the game ordinals', () => {
    expect(PLAYER_PART_ORDINALS).toEqual({
      head: 0,
      body: 1,
      left_arm: 2,
      right_arm: 3,
      left_leg: 4,
      right_leg: 5,
      custom_part: 6,
    })
    expect(CUSTOM_PART_ORDINAL).toBe(PLAYER_PART_ORDINALS.custom_part)
  })

  it('gives every vanilla part a unique ordinal matching the table order', () => {
    const ordinals = VANILLA_PLAYER_PARTS.map((part) => part.ordinal)
    expect(ordinals).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(ordinals).size).toBe(ordinals.length)
  })

  it('builds the root pivots from the same vanilla table', () => {
    for (const part of VANILLA_PLAYER_PARTS) {
      expect(ROOT_PIVOTS[part.id]).toEqual(part.pivot)
    }
  })

  it('aligns the armor pivots with their vanilla counterparts', () => {
    expect(ROOT_PIVOTS.armor_helmet).toEqual(ROOT_PIVOTS.head)
    expect(ROOT_PIVOTS.armor_body).toEqual(ROOT_PIVOTS.body)
    expect(ROOT_PIVOTS.armor_left_arm).toEqual(ROOT_PIVOTS.left_arm)
    expect(ROOT_PIVOTS.armor_right_arm).toEqual(ROOT_PIVOTS.right_arm)
    expect(ROOT_PIVOTS.armor_left_leg).toEqual(ROOT_PIVOTS.left_leg)
    expect(ROOT_PIVOTS.armor_right_leg).toEqual(ROOT_PIVOTS.right_leg)
  })

  it('resolves the editor roots through the shared ordinals', () => {
    for (const part of VANILLA_PLAYER_PARTS) {
      expect(resolveRootStoreId(makeElement(part.id))).toBe(part.ordinal)
    }
  })

  it('keeps the store id of custom and duplicated roots', () => {
    expect(resolveRootStoreId(makeElement('custom_part', { customPart: true, storeID: 42 }))).toBe(42)
    expect(resolveRootStoreId(makeElement('head', { dup: true, storeID: 43 }))).toBe(43)
  })
})
